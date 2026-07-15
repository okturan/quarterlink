import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/quarterlink-shell-v3.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../public/quarterlink-v3.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('critical product views and controls are present', () => {
  for (const id of ['landing', 'setup', 'join', 'room', 'loading', 'game', 'game-files', 'quality-pill']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('all runtime scripts are same-origin', () => {
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(client, /cdn\.|unpkg|jsdelivr/i);
});

test('pinned FBNeo runtime assets are vendored', async () => {
  const core = await stat(new URL('../public/emulatorjs/data/cores/fbneo-wasm.data', import.meta.url));
  assert.ok(core.size > 8_000_000, `unexpected core size ${core.size}`);
  await stat(new URL('../public/emulatorjs/data/loader.js', import.meta.url));
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

test('client uses direct WebRTC channels and original File objects', () => {
  assert.match(client, /new RTCPeerConnection/);
  assert.match(client, /maxRetransmits: 0/);
  assert.match(client, /EJS_gameUrl = state\.romFile/);
  assert.match(client, /EJS_biosUrl = state\.biosFile/);
  assert.match(client, /canvas\.captureStream\(60\)/);
  assert.match(client, /collectScreenRecordingMediaTracks/);
  assert.match(client, /GAMEPAD_TO_LIBRETRO = \[8, 0, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7\]/);
  assert.match(client, /receivedTracks\.has\('audio'\).*receivedTracks\.has\('video'\)/);
  assert.match(client, /type: 'seat\.ready'/);
  assert.match(client, /function maybeReportMediaReady/);
  assert.match(client, /state\.peerCreating/);
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
});

test('join UI asks for the complete private link, not a fake join code', () => {
  assert.match(html, /invite link/i);
  assert.match(html, /Paste the complete link/);
  assert.doesNotMatch(html, /Join with code|Invite link or room code/);
  assert.doesNotMatch(html, /18 ms|Ready in Tirana|Direct encrypted connection/);
  assert.match(html, /Encrypted WebRTC link/);
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

test('versioned application shell cannot enter Cloudflare HTML redirect normalization', () => {
  assert.match(worker, /quarterlink-shell-v3\.html/);
  assert.match(wrangler, /"html_handling": "none"/);
});
