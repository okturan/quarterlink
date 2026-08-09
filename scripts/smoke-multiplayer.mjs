import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseUrl = (process.env.QUARTERLINK_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const chromeBinary = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shotDir = process.env.QUARTERLINK_SHOT_DIR || tmpdir();
const guestNarrowWidth = Number(process.env.QUARTERLINK_GUEST_NARROW || 390);

class Browser {
  constructor(label) {
    this.label = label;
    this.consoleErrors = [];
    this.exceptions = [];
    this.requestId = 0;
    this.pending = new Map();
  }

  async launch() {
    this.profile = await mkdtemp(join(tmpdir(), `quarterlink-${this.label}-`));
    this.process = spawn(chromeBinary, [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.profile}`,
      '--window-size=1280,860',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const portFile = join(this.profile, 'DevToolsActivePort');
    let port;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const contents = await readFile(portFile, 'utf8').catch(() => '');
      port = Number(contents.split('\n')[0]);
      if (port) break;
      if (this.process.exitCode !== null) throw new Error(`${this.label}: Chrome exited early (${this.process.exitCode}).`);
      await delay(50);
    }
    if (!port) throw new Error(`${this.label}: DevTools did not become ready.`);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error(`${this.label}: DevTools socket failed.`)), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params?.exceptionDetails;
        this.exceptions.push(detail?.exception?.description || detail?.text || 'Unknown exception');
      }
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
        this.consoleErrors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.consoleErrors.push(`console: ${message.params.args?.map((arg) => arg.description || arg.value).join(' ')}`);
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${this.label}: ${message.error.message}`));
      else resolve(message.result);
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Log.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) {
      throw new Error(`${this.label} evaluation failed: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
    }
    return response.result.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete'`, 15_000, 'navigation');
  }

  async waitFor(expression, timeoutMs, description) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression).catch(() => false)) return;
      await delay(200);
    }
    const visible = await this.evaluate(`[...document.querySelectorAll('.view')].find((node) => !node.classList.contains('hidden'))?.id`).catch(() => 'unknown');
    throw new Error(`${this.label}: ${description} timed out (visible view: ${visible}; exceptions: ${JSON.stringify(this.exceptions.slice(-3))})`);
  }

  async shot(name) {
    const image = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const path = join(shotDir, `mp-${this.label}-${name}.png`);
    await writeFile(path, Buffer.from(image.data, 'base64'));
    return path;
  }

  async setWidth(width, height = 860) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  }

  async close() {
    this.socket?.close();
    if (this.process && this.process.exitCode === null) {
      const exited = new Promise((resolve) => this.process.once('exit', resolve));
      this.process.kill('SIGTERM');
      await Promise.race([exited, delay(4000)]);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { if (this.profile) await rm(this.profile, { recursive: true, force: true }); return; }
      catch { await delay(300); }
    }
  }
}

const typeInto = (browser, selector, value) => browser.evaluate(`(() => {
  const input = document.querySelector('${selector}');
  input.value = ${JSON.stringify(value)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`);

const pressKey = (browser, code, keyCode) => browser.evaluate(`(() => {
  for (const type of ['keydown', 'keyup']) {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, code: '${code}' });
    Object.defineProperty(event, 'keyCode', { get: () => ${keyCode} });
    window.dispatchEvent(event);
  }
  return true;
})()`);

const host = new Browser('host');
const guest = new Browser('guest');
const shots = [];
try {
  await host.launch();
  await guest.launch();

  // Host: create a room with the demo game.
  await host.goto(`${baseUrl}/?mp-smoke=${Date.now()}`);
  await host.waitFor(`Boolean(document.querySelector('[data-action="open-host"]'))`, 10_000, 'landing');
  await host.evaluate(`document.querySelector('[data-action="open-host"]').click()`);
  await host.waitFor(`!document.querySelector('#setup').classList.contains('hidden')`, 5_000, 'setup view');
  await typeInto(host, '#host-name', 'Smoke Host');
  await host.evaluate(`document.querySelector('#setup [data-action="load-demo"]').click()`);
  await host.waitFor(`document.querySelector('#create-room-button').disabled === false`, 10_000, 'demo ready');
  await host.evaluate(`document.querySelector('#create-room-button').click()`);
  await host.waitFor(`!document.querySelector('#room').classList.contains('hidden')`, 10_000, 'host room view');
  shots.push(await host.shot('room-waiting'));

  const invite = await host.evaluate(`(() => {
    const roomId = location.pathname.split('/')[2];
    return location.origin + '/join/' + roomId + '#' + sessionStorage.getItem('quarterlink.invite.' + roomId);
  })()`);
  if (!/\/join\/[A-Za-z0-9_-]+#./.test(invite)) throw new Error(`Host produced an invalid invite link: ${invite}`);

  // Guest: follow the invite link and claim the seat.
  await guest.goto(invite);
  await guest.waitFor(`!document.querySelector('#join').classList.contains('hidden')`, 10_000, 'guest join view');
  shots.push(await guest.shot('join'));
  await typeInto(guest, '#guest-name', 'Smoke Guest');
  await guest.evaluate(`document.querySelector('#join-room-button').click()`);
  await guest.waitFor(`!document.querySelector('#room').classList.contains('hidden')`, 15_000, 'guest room view');
  shots.push(await guest.shot('room-joined'));

  // Both sides must agree the seat is filled and WebRTC must connect.
  await host.waitFor(`document.querySelector('#guest-seat').classList.contains('occupied')`, 10_000, 'host sees guest');
  await host.waitFor(`document.querySelector('#check-network').classList.contains('done')`, 30_000, 'host RTC connected');
  await guest.waitFor(`document.querySelector('#check-network').classList.contains('done')`, 30_000, 'guest RTC connected');
  shots.push(await host.shot('room-connected'));

  // Readiness: both press a key, guest declares ready.
  await pressKey(guest, 'KeyZ', 90);
  await guest.waitFor(`document.querySelector('#play-button').disabled === false`, 10_000, 'guest ready button');
  await guest.evaluate(`document.querySelector('#play-button').click()`);
  await pressKey(host, 'KeyZ', 90);
  await host.waitFor(`document.querySelector('#play-button').disabled === false`, 15_000, 'host start unlocked');
  shots.push(await guest.shot('room-ready'));

  // Start the run: host boots the emulator and streams to the guest.
  await host.evaluate(`document.querySelector('#play-button').click()`);
  await host.waitFor(`Boolean(window.EJS_emulator?.started) && !document.querySelector('#game').classList.contains('hidden')`, 90_000, 'host in game');
  await guest.waitFor(`!document.querySelector('#game').classList.contains('hidden')`, 30_000, 'guest in game');

  const guestVideo = await guest.evaluate(`(async () => {
    const video = document.querySelector('#guest-video');
    const before = video.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const stream = video.srcObject;
    return {
      hiddenClass: video.classList.contains('hidden'),
      display: getComputedStyle(video).display,
      readyState: video.readyState,
      paused: video.paused,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      advanced: video.currentTime > before,
      tracks: stream ? stream.getTracks().map((track) => track.kind + ':' + track.readyState) : [],
    };
  })()`);
  if (guestVideo.hiddenClass || guestVideo.display === 'none') throw new Error(`Guest video is not visible: ${JSON.stringify(guestVideo)}`);
  if (!guestVideo.advanced || guestVideo.paused) throw new Error(`Guest video is not playing: ${JSON.stringify(guestVideo)}`);
  if (!guestVideo.tracks.includes('video:live') || !guestVideo.tracks.includes('audio:live')) {
    throw new Error(`Guest stream is missing live tracks: ${JSON.stringify(guestVideo)}`);
  }

  // Guest input must reach the host core.
  const inputProbe = await host.evaluate(`window.__qlRemote = null, true`);
  void inputProbe;
  await pressKey(guest, 'ArrowDown', 40);
  await delay(400);
  const hostFrames = await host.evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
  await delay(1000);
  const hostFramesLater = await host.evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
  if (!(hostFramesLater > hostFrames)) throw new Error(`Host frames stalled (${hostFrames} -> ${hostFramesLater}).`);

  shots.push(await host.shot('game-host'));
  shots.push(await guest.shot('game-guest'));

  // Capture the narrow guest layout for design review.
  await guest.setWidth(guestNarrowWidth);
  await delay(400);
  shots.push(await guest.shot('game-narrow'));
  await guest.setWidth(1280);

  const problems = {
    hostExceptions: host.exceptions,
    guestExceptions: guest.exceptions,
    hostConsoleErrors: host.consoleErrors.slice(0, 10),
    guestConsoleErrors: guest.consoleErrors.slice(0, 10),
  };
  console.log(JSON.stringify({ ok: true, baseUrl, invite: invite.replace(/#.+$/, '#…'), guestVideo, hostFrames: [hostFrames, hostFramesLater], shots, problems }, null, 2));
} finally {
  await host.close();
  await guest.close();
}
