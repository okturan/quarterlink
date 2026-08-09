import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/quarterlink-shell-v3.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../public/quarterlink-v3.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const gameCss = await readFile(new URL('../public/game-v3.css', import.meta.url), 'utf8');

test('critical product views and controls are present', () => {
  for (const id of ['landing', 'setup', 'join', 'room', 'loading', 'game', 'game-files', 'quality-pill']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('all runtime scripts are same-origin', () => {
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(client, /cdn\.|unpkg|jsdelivr/i);
});

test('pinned emulator runtime assets are vendored', async () => {
  const cores = [
    ['fbneo-wasm.data', 8_273_551, '315a25e0bcd61d58ee0d9e8b1dbf3740b9e0ca4b7d0726f848ce1068de73437c'],
    ['fbneo-legacy-wasm.data', 8_272_960, '9dbb6242c028f4179549f324688b654353881beb552292f939bc6171a0828b5f'],
    ['snes9x-wasm.data', 1_093_765, 'eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee'],
    ['snes9x-legacy-wasm.data', 1_092_437, '7d427a575cefad98ff400493fa1d7e892da63fe7bab68979babd9cea0bfaaf3b'],
    ['fceumm-wasm.data', 1_054_015, '8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493'],
    ['fceumm-legacy-wasm.data', 1_053_006, 'f1054b094e7149fd6278485bc1b2e51ff75c5259048ddb1134171e53d651f239'],
    ['genesis_plus_gx-wasm.data', 1_203_661, '190297a6f86757405090f1a2266f67dfe1a570a528c583434ed3641a5664f768'],
    ['genesis_plus_gx-legacy-wasm.data', 1_204_803, '2a1edeb68d7ec882149ed3cd5d3aa95a6ac231ebabaf82cdb56175a8b62967cc'],
  ];
  for (const [name, expectedSize, expectedHash] of cores) {
    const core = await readFile(new URL(`../public/emulatorjs/data/cores/${name}`, import.meta.url));
    assert.equal(core.byteLength, expectedSize, `unexpected ${name} size`);
    assert.equal(createHash('sha256').update(core).digest('hex'), expectedHash, `unexpected ${name} hash`);
  }
  const reports = [
    ['fbneo.json', 'd2c5e07c2afc2b53937f14b721d7d025ad599d111e9627fc77e9b3fd17450e70'],
    ['snes9x.json', 'dc7ac963eb7935a7ac78956235ac0b8912ec785c57026336825aa2ed8031b3ad'],
    ['fceumm.json', '13dbbfba0ea1bea087c97c38f47dd49c3fb8f16c3f5ed5678dd75d352b737132'],
    ['genesis_plus_gx.json', '5936a8ce8d7f010d5bfdd8c3bba2b2414f103b3a703121e56f2724b24dbe7ff3'],
  ];
  for (const [name, expectedHash] of reports) {
    const report = await readFile(new URL(`../public/emulatorjs/data/cores/reports/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(report).digest('hex'), expectedHash, `unexpected ${name} hash`);
  }
  for (const path of ['loader.js', 'emulator.min.js', 'emulator.min.css']) {
    await stat(new URL(`../public/emulatorjs/data/${path}`, import.meta.url));
  }
});

test('freely distributable FBNeo smoke game is pinned and credited', async () => {
  const fixture = await readFile(new URL('../public/demo/cps1frog.zip', import.meta.url));
  assert.equal(createHash('sha256').update(fixture).digest('hex'), 'd1b07899f946336768ed68ff734e1b843a1083608887c20e2456bbb0a91916bf');
  const notice = await readFile(new URL('../public/demo/NOTICE.md', import.meta.url), 'utf8');
  assert.match(notice, /Copyright 2006 Charles Doty/);
  assert.match(html, /Use free test game/);
});

test('room snapshots explicitly strip sensitive tokens', () => {
  assert.match(worker, /session: _session/);
  assert.match(worker, /inviteHash: _inviteHash/);
  assert.match(worker, /crypto\.getRandomValues/);
});

test('client uses direct WebRTC channels and local File sources', () => {
  assert.match(client, /new RTCPeerConnection/);
  assert.match(client, /maxRetransmits: 0/);
  assert.match(client, /EJS_gameUrl = state\.romFile/);
  assert.match(client, /EJS_externalFiles = \{ \[state\.biosMountPath\]: state\.biosFile \}/);
  assert.match(client, /delete window\.EJS_biosUrl/);
  assert.match(client, /window\.EJS_core = state\.emulatorCore/);
  assert.match(client, /async function detectGameSelection/);
  assert.match(client, /emulatorCore: 'snes9x'/);
  assert.match(client, /canvas\.captureStream\(60\)/);
  assert.match(client, /collectScreenRecordingMediaTracks/);
  assert.match(client, /GAMEPAD_TO_LIBRETRO = \[8, 0, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7\]/);
  assert.match(client, /receivedTracks\.has\('audio'\).*receivedTracks\.has\('video'\)/);
  assert.match(client, /type: 'seat\.ready'/);
  assert.match(client, /function maybeReportMediaReady/);
  assert.match(client, /state\.peerCreating/);
});

test('setup no longer hardcodes Metal Slug filenames', () => {
  assert.doesNotMatch(html, /mslug2\.zip/);
  assert.doesNotMatch(client, /mslug2\.zip/);
  assert.match(html, /SNES · NES · Genesis · Arcade ZIP/);
  assert.match(html, /accept="\.zip,\.sfc,\.smc,\.snes,\.nes,\.md,\.gen,\.smd"/);
});

test('room recovery, relay credentials, and websocket origin checks are wired', () => {
  assert.match(client, /quarterlink\.invite\./);
  assert.match(worker, /\/credentials\/generate-ice-servers/);
  assert.match(worker, /origin !== url\.origin/);
  assert.match(worker, /sendToOtherRole/);
  assert.match(worker, /Superseded by a newer connection/);
  assert.match(worker, /async removeGuest/);
  assert.match(client, /resetGuestSeat/);
  assert.match(client, /showConnectionOverlay\('failed'\)/);
  assert.match(client, /now - started > 10000/);
  assert.match(worker, /cache-control.*no-store/);
  assert.match(worker, /script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:/);
  assert.doesNotMatch(worker, /script-src[^;]*'unsafe-inline'/);
  assert.match(worker, /connect-src 'self' blob: wss: ws:/);
});

test('join UI asks for the complete private link, not a fake join code', () => {
  assert.match(html, /invite link/i);
  assert.match(html, /Paste the complete link/);
  assert.doesNotMatch(html, /Join with code|Invite link or room code/);
  assert.doesNotMatch(html, /18 ms|Ready in Tirana|Direct encrypted connection/);
  assert.match(html, /Encrypted connection/);
  assert.match(html, /Friend sessions use WebRTC/);
});

test('redesigned shell preserves every client-bound DOM id and nested contract', () => {
  const ids = [...client.matchAll(/\$\(['"]#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  for (const id of new Set(ids)) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  for (const id of ['check-controller', 'check-game', 'check-network']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*>[\\s\\S]*?<b>`), `${id} must contain a b status`);
  }
  assert.match(html, /id="guest-seat"[\s\S]*?<strong>[\s\S]*?<small>[\s\S]*?class="seat-status"/);
  assert.match(html, /id="file-picker"[\s\S]*?<p>/);
});

test('solo is a first-class local flow with no room requirement', () => {
  assert.match(html, /data-action="open-solo"/);
  assert.match(client, /async function startSolo/);
  assert.match(client, /state\.roomId = 'solo'/);
  assert.match(client, /Solo · Local/);
  const soloBody = client.match(/async function startSolo\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(soloBody, /await loadEmulator\(\)/);
  assert.doesNotMatch(soloBody, /api\(|createPeer\(|connectSignaling\(|maybeAttachStream\(|signal\(/);
});

test('emulator boot reports internal failures instead of hanging silently', () => {
  assert.match(client, /window\.EJS_ready/);
  assert.match(client, /EJS_emulator\?\.failedToStart/);
  assert.match(client, /unhandledrejection/);
  assert.match(client, /checkForUpdates/);
  assert.match(client, /emulatorBootPromise/);
  assert.match(client, /The game could not start: \$\{error\.message\}/);
});

test('guest video is displayable and controlled only by the hidden-class contract', () => {
  assert.doesNotMatch(gameCss, /video:empty/);
  assert.match(html, /<video id="guest-video" class="hidden"/);
  assert.match(client, /video\.classList\.remove\('hidden'\)/);
  assert.match(gameCss, /\.emulator-frame canvas, \.emulator-frame video/);
  assert.match(gameCss, /#emulator-player, \.emulator-frame video \{ grid-area: 1 \/ 1; \}/);
});

test('interrupted runs and replaced guests can always recover a stream', () => {
  assert.match(client, /type: 'start\.failed'/);
  assert.match(client, /state\.streamStarted = false; state\.mediaReady = false; state\.pendingIce = \[\]/);
  assert.match(client, /if \(!state\.streamStarted\) state\.mediaReady = false/);
  assert.match(client, /signalingState === 'have-local-offer'/);
});

test('signaling reconnects back off, give up, and stay warm through keepalives', () => {
  assert.match(client, /state\.wsRetries/);
  assert.match(client, /Math\.min\(1200 \* state\.wsRetries, 8000\)/);
  assert.match(client, /ws\.ping/);
  assert.match(worker, /setWebSocketAutoResponse/);
  assert.match(worker, /ws\.pong/);
});

test('room lobby is role-aware for host and guest', () => {
  assert.match(client, /'You · Host' : 'Your friend · Host'/);
  assert.match(client, /'You · Player 2' : 'Player 2 · Seat claimed'/);
  assert.match(client, /state\.role !== 'host' \|\| Boolean\(name\)/);
  assert.match(client, /'Your controls \(Player 2\)' : 'Player 1 controls'/);
  assert.match(html, /invite-strip/);
  const testers = [...html.matchAll(/class="control-tester[^"]*" data-action="open-controls"/g)];
  assert.equal(testers.length, 2, 'both seats need their own control tester');
});

test('game keyboard input keeps focus on the emulator surface', () => {
  assert.match(client, /function focusGameSurface/);
  assert.match(client, /id === 'game' && window\.EJS_emulator\?\.elements\?\.parent/);
  assert.match(client, /if \(!open\) focusGameSurface\(\)/);
});

test('sessions are scoped per room so one browser can hold several seats', () => {
  assert.match(worker, /SESSION_COOKIE_PREFIX = "ql_s_"/);
  assert.match(worker, /sessionCookie\(roomId, session\)/);
  assert.match(worker, /sessionCookie\(redeemMatch\[1\], session\)/);
  assert.doesNotMatch(worker, /cookieValue\(request\)[^,]/);
});

test('worker hardens token handling and upstream relay failures', () => {
  assert.match(worker, /timingSafeEqual/);
  assert.match(worker, /body\.secret\.length > 256/);
  assert.match(worker, /AbortSignal\.timeout/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /webSocketError[\s\S]{0,400}peer\.disconnected/);
});

test('versioned application shell cannot enter Cloudflare HTML redirect normalization', () => {
  assert.match(worker, /quarterlink-shell-v3\.html/);
  assert.match(worker, /url\.pathname === "\/"/);
  assert.doesNotMatch(worker, /headers\.get\("accept"\).*text\/html/);
  assert.match(wrangler, /"html_handling": "none"/);
});
