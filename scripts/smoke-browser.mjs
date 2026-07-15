import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseUrl = process.env.QUARTERLINK_URL || `http://127.0.0.1:8787/?browser-smoke=${Date.now()}`;
const chromeBinary = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.QUARTERLINK_SCREENSHOT || join(tmpdir(), 'quarterlink-browser-smoke.png');
const viewportWidth = Number(process.env.QUARTERLINK_VIEWPORT_WIDTH || 1440);
const viewportHeight = Number(process.env.QUARTERLINK_VIEWPORT_HEIGHT || 900);
const stopAt = process.env.QUARTERLINK_STOP_AT || 'game';
const profile = await mkdtemp(join(tmpdir(), 'quarterlink-chrome-'));
const chrome = spawn(chromeBinary, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  `--window-size=${viewportWidth},${viewportHeight}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
try {
  let port;
  const portFile = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const contents = await readFile(portFile, 'utf8').catch(() => '');
    port = Number(contents.split('\n')[0]);
    if (port) break;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools started (${chrome.exitCode}).`);
    await delay(50);
  }
  if (!port) throw new Error('Chrome DevTools did not become ready.');

  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`Could not create a browser target (${targetResponse.status}).`);
  const target = await targetResponse.json();

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome DevTools socket failed.')), { once: true });
  });

  let requestId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, userGesture = false) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
      throw new Error(`Browser evaluation failed: ${detail}`);
    }
    return response.result.value;
  };
  const waitFor = async (expression, timeoutMs, description) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await delay(200);
    }
    const detail = await evaluate(`({
      title: document.title,
      visible: [...document.querySelectorAll('.view')].find((node) => !node.classList.contains('hidden'))?.id,
      setupError: document.querySelector('#setup-error')?.textContent,
      emulatorText: window.EJS_emulator?.textElem?.textContent,
      failedToStart: window.EJS_emulator?.failedToStart
    })`);
    throw new Error(`${description} timed out: ${JSON.stringify(detail)}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('[data-action="open-solo"]'))`, 15_000, 'Landing page');
  if (stopAt === 'landing') {
    const layout = await evaluate(`(() => {
      const brandText = document.querySelector('.site-header .brand span:last-child');
      const brandRect = brandText.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        brandText: brandText.textContent,
        brandRect: { x: Math.round(brandRect.x), width: Math.round(brandRect.width), height: Math.round(brandRect.height) },
        cardWidths: [...document.querySelectorAll('.mode-card')].map((node) => Math.round(node.getBoundingClientRect().width))
      };
    })()`);
    if (layout.scrollWidth > layout.innerWidth + 1) throw new Error(`Landing page overflows horizontally: ${JSON.stringify(layout)}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ ok: true, stage: 'landing', baseUrl, viewport: { width: viewportWidth, height: viewportHeight }, layout, screenshotPath }, null, 2));
  } else {
    await evaluate(`document.querySelector('[data-action="open-solo"]').click()`, true);
    await waitFor(`!document.querySelector('#setup').classList.contains('hidden')`, 5_000, 'Solo setup');
    await evaluate(`document.querySelector('#setup [data-action="load-demo"]').click()`, true);
    await waitFor(`document.querySelector('#create-room-button').disabled === false`, 10_000, 'Demo selection');
    await evaluate(`document.querySelector('#create-room-button').click()`, true);
    await waitFor(`Boolean(window.EJS_emulator?.started && document.querySelector('#game:not(.hidden) #emulator-player canvas'))`, 60_000, 'Emulator first frame');

    const firstFrame = await evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
    await delay(4_000);
    const secondFrame = await evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
    if (!(Number.isFinite(firstFrame) && Number.isFinite(secondFrame) && secondFrame > firstFrame)) {
      throw new Error(`The emulator canvas appeared but frames did not advance (${firstFrame} -> ${secondFrame}).`);
    }

    const canvas = await evaluate(`(() => {
      const node = document.querySelector('#emulator-player canvas');
      const rect = node.getBoundingClientRect();
      return { width: node.width, height: node.height, cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height) };
    })()`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ ok: true, stage: 'game', baseUrl, viewport: { width: viewportWidth, height: viewportHeight }, firstFrame, secondFrame, canvas, screenshotPath }, null, 2));
  }
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
