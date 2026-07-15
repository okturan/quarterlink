# QuarterLink

**Arcade night, without the distance.** QuarterLink is a zero-install, private two-player browser arcade. A host opens a room, shares a single-use link, loads local arcade files, and plays with a friend over a direct WebRTC connection.

## Current playable path

- Metal Slug 2 runs in the host browser using a pinned FBNeo WebAssembly core.
- The guest joins without an account or installation.
- Guest controller input travels directly to the host over an unordered WebRTC data channel.
- The authoritative game canvas streams directly back to the guest.
- Cloudflare Durable Objects coordinate single-use invites and WebRTC signaling only; gameplay does not travel through the Worker.
- The in-game HUD measures peer data-channel RTT and jitter rather than misleading API latency.

The host supplies `mslug2.zip` and `neogeo.zip` in the room. Files remain local and are never uploaded. QuarterLink does not contain or distribute game ROMs.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8787` in current Chrome or Edge. Create a room, select both required ZIP files, then send the invite to a second browser profile/device.

## Verify

```bash
npm test
npm run check
```

`npm run check` regenerates Cloudflare binding types, type-checks the Worker, and performs a Wrangler deployment dry-run.

## Architecture

```text
Host browser ─── WebRTC video + input ─── Guest browser
      │                                      │
      └──── WebSocket signaling only ────────┘
                         │
            Cloudflare GameRoom Durable Object
```

Each room has its own SQLite-backed Durable Object, two seats, a 2-hour TTL, a hashed single-use invite, and HttpOnly room-scoped sessions. Invite secrets are placed in the URL fragment so browsers do not include them in HTTP requests, referrers, or server logs.

## Security and privacy

- `COOP`, `COEP`, and `CORP` enable an isolated Wasm runtime.
- Strict CSP, no third-party scripts, no analytics, and no ROM uploads.
- Cryptographic room IDs, sessions, and invite secrets.
- Signaling messages are allowlisted and bounded to 64 KiB.
- Durable Object WebSocket hibernation avoids always-on coordination instances.
- Room state returned to clients excludes session tokens and invite hashes.

## Runtime licensing

The browser runtime vendors EmulatorJS 4.2.3 under GPL-3.0 and its FBNeo WebAssembly core. See [`public/vendor-licenses`](public/vendor-licenses). FBNeo is non-commercial software; QuarterLink must remain non-commercial unless a separate license is obtained. Game ROMs and BIOS files are not included.

## Known production gates

- Audio forwarding needs a direct WebAudio graph bridge; video and controller transport are implemented.
- TURN credentials are not configured yet, so symmetric NAT/corporate networks may fail instead of relaying.
- The current product path is authoritative streaming, not GGPO rollback. Do not market it as rollback.
- Full device-matrix and real two-network gameplay QA must be completed with the host-provided game files before a stable release tag.

## Deployment

```bash
npx wrangler login
npm run deploy
```

The Worker uses static assets plus the `GAME_ROOMS` Durable Object binding defined in `wrangler.jsonc`.
