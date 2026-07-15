import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SESSION_COOKIE = "ql_session";
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

type Role = "host" | "guest";
type Peer = { session: string; name: string; role: Role; ready: boolean };
type RoomState = {
	createdAt: number;
	expiresAt: number;
	inviteHash: string;
	inviteUsed: boolean;
	phase: "waiting" | "connecting" | "ready" | "playing" | "ended";
	peers: Partial<Record<Role, Peer>>;
};

function json(value: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(value), { ...init, headers: { ...JSON_HEADERS, ...init.headers } });
}

function securityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Cross-Origin-Embedder-Policy", "require-corp");
	headers.set("Cross-Origin-Resource-Policy", "same-origin");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function randomToken(bytes = 24): string {
	const data = crypto.getRandomValues(new Uint8Array(bytes));
	return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request): string | null {
	const cookie = request.headers.get("cookie") ?? "";
	const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
	return match?.[1] ?? null;
}

function sessionCookie(session: string): string {
	return `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`;
}

function validName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim().replace(/\s+/g, " ");
	return name.length >= 1 && name.length <= 24 ? name : null;
}

export class GameRoom extends DurableObject<Env> {
	private sockets = new Map<WebSocket, Role>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as { role?: Role } | null;
			if (attachment?.role) this.sockets.set(socket, attachment.role);
		}
	}

	private async state(): Promise<RoomState | null> {
		return (await this.ctx.storage.get<RoomState>("room")) ?? null;
	}

	async initialize(inviteHash: string, host: Peer): Promise<void> {
		if (await this.state()) throw new Error("Room already exists");
		const now = Date.now();
		await this.ctx.storage.put<RoomState>("room", {
			createdAt: now,
			expiresAt: now + ROOM_TTL_MS,
			inviteHash,
			inviteUsed: false,
			phase: "waiting",
			peers: { host },
		});
		await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
	}

	async redeem(secret: string, guest: Peer): Promise<{ ok: boolean; error?: string }> {
		const room = await this.state();
		if (!room || room.expiresAt < Date.now()) return { ok: false, error: "expired" };
		if (room.inviteUsed || room.peers.guest) return { ok: false, error: "full" };
		if ((await sha256(secret)) !== room.inviteHash) return { ok: false, error: "invalid" };
		room.inviteUsed = true;
		room.peers.guest = guest;
		room.phase = "connecting";
		await this.ctx.storage.put("room", room);
		this.broadcast({ type: "peer.joined", name: guest.name, role: "guest" });
		return { ok: true };
	}

	async rotateInvite(session: string): Promise<{ secret: string } | null> {
		const room = await this.state();
		if (!room || room.peers.host?.session !== session || room.peers.guest) return null;
		const secret = randomToken(24);
		room.inviteHash = await sha256(secret);
		room.inviteUsed = false;
		await this.ctx.storage.put("room", room);
		return { secret };
	}

	async snapshot(session: string): Promise<{ room: Omit<RoomState, "inviteHash" | "peers"> & { peers: Partial<Record<Role, Omit<Peer, "session">>> }; role: Role } | null> {
		const room = await this.state();
		if (!room) return null;
		const role = room.peers.host?.session === session ? "host" : room.peers.guest?.session === session ? "guest" : null;
		if (!role) return null;
		const { inviteHash: _inviteHash, peers, ...safeRoom } = room;
		const publicPeers: Partial<Record<Role, Omit<Peer, "session">>> = {};
		for (const peerRole of ["host", "guest"] as const) {
			const peer = peers[peerRole];
			if (peer) {
				const { session: _session, ...publicPeer } = peer;
				publicPeers[peerRole] = publicPeer;
			}
		}
		return { room: { ...safeRoom, peers: publicPeers }, role };
	}

	private broadcast(message: unknown, except?: WebSocket): void {
		const body = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			if (socket !== except) {
				try { socket.send(body); } catch { /* stale socket is cleaned by close/error */ }
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const session = request.headers.get("x-quarterlink-session");
		if (!session || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Unauthorized", { status: 401 });
		const snap = await this.snapshot(session);
		if (!snap) return new Response("Forbidden", { status: 403 });
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		server.serializeAttachment({ role: snap.role, session });
		this.ctx.acceptWebSocket(server);
		this.sockets.set(server, snap.role);
		queueMicrotask(() => {
			server.send(JSON.stringify({ type: "room.snapshot", ...snap }));
			this.broadcast({ type: "peer.connected", role: snap.role }, server);
		});
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string" || message.length > 64 * 1024) {
			socket.close(1009, "Message too large");
			return;
		}
		let parsed: { type?: string; [key: string]: unknown };
		try { parsed = JSON.parse(message) as typeof parsed; } catch { socket.close(1007, "Invalid JSON"); return; }
		const allowed = new Set(["rtc.offer", "rtc.answer", "rtc.ice", "peer.ready", "game.start", "game.pause", "game.resume", "ping", "pong", "stream.ready", "diagnostic"]);
		if (!parsed.type || !allowed.has(parsed.type)) return;
		if (parsed.type === "peer.ready") {
			const room = await this.state();
			const role = this.sockets.get(socket);
			if (room && role && room.peers[role]) {
				room.peers[role]!.ready = Boolean(parsed.ready);
				room.phase = room.peers.host?.ready && room.peers.guest?.ready ? "ready" : room.phase;
				await this.ctx.storage.put("room", room);
			}
		}
		this.broadcast(parsed, socket);
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		const role = this.sockets.get(socket);
		this.sockets.delete(socket);
		if (role) this.broadcast({ type: "peer.disconnected", role });
	}

	async webSocketError(socket: WebSocket): Promise<void> {
		this.sockets.delete(socket);
		try { socket.close(1011, "Connection error"); } catch { /* already closed */ }
	}

	async alarm(): Promise<void> {
		this.broadcast({ type: "room.expired" });
		for (const socket of this.ctx.getWebSockets()) socket.close(1000, "Room expired");
		await this.ctx.storage.deleteAll();
	}
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
	if (url.pathname === "/api/health") return json({ ok: true, service: "quarterlink", time: new Date().toISOString() });

	if (url.pathname === "/api/rooms" && request.method === "POST") {
		const body: { name?: unknown } = await request.json<{ name?: unknown }>().catch(() => ({}));
		const name = validName(body.name);
		if (!name) return json({ error: "Enter a display name (1–24 characters)." }, { status: 400 });
		const roomId = randomToken(9);
		const inviteSecret = randomToken(24);
		const session = randomToken(24);
		await env.GAME_ROOMS.getByName(roomId).initialize(await sha256(inviteSecret), { session, name, role: "host", ready: false });
		return json({ roomId, inviteSecret }, { status: 201, headers: { "set-cookie": sessionCookie(session) } });
	}

	const redeemMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/redeem$/);
	if (redeemMatch && request.method === "POST") {
		const body: { name?: unknown; secret?: unknown } = await request.json<{ name?: unknown; secret?: unknown }>().catch(() => ({}));
		const name = validName(body.name);
		if (!name || typeof body.secret !== "string") return json({ error: "Name and invite are required." }, { status: 400 });
		const session = randomToken(24);
		const result = await env.GAME_ROOMS.getByName(redeemMatch[1]).redeem(body.secret, { session, name, role: "guest", ready: false });
		if (!result.ok) return json({ error: result.error }, { status: result.error === "full" ? 409 : 403 });
		return json({ ok: true }, { headers: { "set-cookie": sessionCookie(session) } });
	}

	const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)$/);
	if (roomMatch && request.method === "GET") {
		const session = cookieValue(request);
		if (!session) return json({ error: "Unauthorized" }, { status: 401 });
		const snapshot = await env.GAME_ROOMS.getByName(roomMatch[1]).snapshot(session);
		return snapshot ? json(snapshot) : json({ error: "Forbidden" }, { status: 403 });
	}

	const inviteMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/invite$/);
	if (inviteMatch && request.method === "POST") {
		const session = cookieValue(request);
		if (!session) return json({ error: "Unauthorized" }, { status: 401 });
		const result = await env.GAME_ROOMS.getByName(inviteMatch[1]).rotateInvite(session);
		return result ? json(result) : json({ error: "Invite cannot be rotated" }, { status: 409 });
	}

	const iceMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/ice$/);
	if (iceMatch && request.method === "POST") {
		const session = cookieValue(request);
		if (!session || !(await env.GAME_ROOMS.getByName(iceMatch[1]).snapshot(session))) return json({ error: "Unauthorized" }, { status: 401 });
		const turnKeyId = Reflect.get(env, "TURN_KEY_ID");
		const turnKeyToken = Reflect.get(env, "TURN_KEY_TOKEN");
		if (typeof turnKeyId !== "string" || typeof turnKeyToken !== "string") {
			return json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], relayAvailable: false });
		}
		const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`, {
			method: "POST",
			headers: { authorization: `Bearer ${turnKeyToken}`, "content-type": "application/json" },
			body: JSON.stringify({ ttl: 7200 }),
		});
		if (response.status !== 201) {
			console.error(JSON.stringify({ event: "turn_mint_failed", status: response.status }));
			return json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], relayAvailable: false });
		}
		const body: unknown = await response.json();
		if (!body || typeof body !== "object" || !Array.isArray(Reflect.get(body, "iceServers"))) return json({ error: "Invalid relay response" }, { status: 502 });
		const iceServers = (Reflect.get(body, "iceServers") as Array<{ urls?: unknown }>).map((server) => ({
			...server,
			urls: Array.isArray(server.urls) ? server.urls.filter((url) => typeof url === "string" && !url.includes(":53")) : server.urls,
		}));
		return json({ iceServers, relayAvailable: true });
	}

	const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/ws$/);
	if (wsMatch) {
		const origin = request.headers.get("origin");
		if (origin !== url.origin) return new Response("Forbidden origin", { status: 403 });
		const session = cookieValue(request);
		if (!session) return new Response("Unauthorized", { status: 401 });
		const headers = new Headers(request.headers);
		headers.set("x-quarterlink-session", session);
		return env.GAME_ROOMS.getByName(wsMatch[1]).fetch(new Request(request, { headers }));
	}

	return json({ error: "Not found" }, { status: 404 });
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		try {
			const response = url.pathname.startsWith("/api/") ? await api(request, env, url) : await env.ASSETS.fetch(request);
			return response.status === 101 ? response : securityHeaders(response);
		} catch (error) {
			console.error(JSON.stringify({ event: "request_error", path: url.pathname, error: error instanceof Error ? error.message : "unknown" }));
			return securityHeaders(json({ error: "QuarterLink hit a temporary problem.", supportCode: crypto.randomUUID().slice(0, 8) }, { status: 500 }));
		}
	},
} satisfies ExportedHandler<Env>;
