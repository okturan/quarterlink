import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseUrl = process.env.QUARTERLINK_URL || `http://127.0.0.1:8787/?browser-smoke=${Date.now()}`;
const chromeBinary = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotPath = process.env.QUARTERLINK_SCREENSHOT || join(tmpdir(), 'quarterlink-browser-smoke.png');
const viewportWidth = Number(process.env.QUARTERLINK_VIEWPORT_WIDTH || 1440);
const viewportHeight = Number(process.env.QUARTERLINK_VIEWPORT_HEIGHT || 900);
const stopAt = process.env.QUARTERLINK_STOP_AT || 'game';
const forceLegacyCore = process.env.QUARTERLINK_FORCE_LEGACY_CORE === '1';
const romPath = process.env.QUARTERLINK_ROM;
const biosPath = process.env.QUARTERLINK_BIOS;
const gameSettleMs = Number(process.env.QUARTERLINK_GAME_SETTLE_MS || (romPath ? 25_000 : 4_000));
if (biosPath && !romPath) throw new Error('QUARTERLINK_BIOS requires QUARTERLINK_ROM.');
if ([romPath, biosPath].some((path) => path && !isAbsolute(path))) throw new Error('Browser smoke file paths must be absolute.');
const selectedFileSizes = romPath
  ? { rom: (await stat(romPath)).size, bios: biosPath ? (await stat(biosPath)).size : null }
  : null;
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
  const runtimeExceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      runtimeExceptions.push(detail?.exception?.description || detail?.text || 'Unknown browser exception');
    }
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
      failedToStart: window.EJS_emulator?.failedToStart,
      runtimeExceptions: ${JSON.stringify(runtimeExceptions.slice(-5))}
    })`);
    throw new Error(`${description} timed out: ${JSON.stringify(detail)}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('[data-action="open-solo"]'))`, 15_000, 'Landing page');
  if (forceLegacyCore) await evaluate(`window.EJS_forceLegacyCores = true`);
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
    let gameSource = 'Frog Feast fixture';
    if (romPath) {
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#game-files' });
      if (!nodeId) throw new Error('Could not find the game file input.');
      const files = biosPath ? [romPath, biosPath] : [romPath];
      await send('DOM.setFileInputFiles', { nodeId, files });
      gameSource = files.join(' + ');
    } else {
      await evaluate(`document.querySelector('#setup [data-action="load-demo"]').click()`, true);
    }
    await waitFor(`document.querySelector('#create-room-button').disabled === false`, 10_000, 'Game selection');
    await evaluate(`document.querySelector('#create-room-button').click()`, true);
    await waitFor(`Boolean(window.EJS_emulator?.started && document.querySelector('#game:not(.hidden) #emulator-player canvas'))`, 60_000, 'Emulator first frame');

    const splitFailure = runtimeExceptions.find((message) => /split is not a function/.test(message));
    if (splitFailure) throw new Error(`EmulatorJS treated a local file as a URL string: ${splitFailure}`);

    const firstFrame = await evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
    await delay(gameSettleMs);
    const secondFrame = await evaluate(`window.EJS_emulator.gameManager.getFrameNum()`);
    if (!(Number.isFinite(firstFrame) && Number.isFinite(secondFrame) && secondFrame > firstFrame)) {
      throw new Error(`The emulator canvas appeared but frames did not advance (${firstFrame} -> ${secondFrame}).`);
    }

    const runtime = await evaluate(`(() => {
      const emulator = window.EJS_emulator;
      const fs = emulator?.gameManager?.FS;
      const file = (path) => {
        try { const value = fs.stat(path); return { exists: true, size: value.size }; }
        catch { return { exists: false, size: null }; }
      };
      return {
        started: emulator?.started === true,
        failedToStart: emulator?.failedToStart === true,
        fileName: emulator?.fileName,
        core: emulator?.config?.EJS_core || window.EJS_core || null,
        webgl: (() => {
          const gl = emulator?.canvas?.getContext('webgl2') || emulator?.canvas?.getContext('webgl');
          const debug = gl?.getExtension('WEBGL_debug_renderer_info');
          return gl && debug ? {
            vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          } : null;
        })(),
        rom: file('/' + (emulator?.fileName || '')),
        bios: file('/neogeo.zip')
      };
    })()`);
    if (selectedFileSizes) {
      // Console cores often extract a member from a ZIP; arcade/FBNeo usually keeps the archive.
      const romStaged = runtime.rom.exists && (
        runtime.rom.size === selectedFileSizes.rom
        || (runtime.fileName && runtime.fileName !== romPath.split('/').pop() && runtime.rom.size > 0)
      );
      if (!romStaged) {
        throw new Error(`The selected ROM was not staged: ${JSON.stringify(runtime)}`);
      }
      if (selectedFileSizes.bios != null && (!runtime.bios.exists || runtime.bios.size !== selectedFileSizes.bios)) {
        throw new Error(`The selected BIOS was not staged intact as /neogeo.zip: ${JSON.stringify(runtime)}`);
      }
    }

    const captureCoreScreenshot = () => evaluate(`Promise.race([
      window.EJS_emulator.gameManager.screenshot().then(async (bytes) => {
        const data = new Uint8Array(bytes);
        const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
        const surface = document.createElement('canvas'); surface.width = image.width; surface.height = image.height;
        const context = surface.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let nearWhite = 0; let nearBlack = 0; let greenDominant = 0; let lumaSum = 0; let lumaSquaredSum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index]; const green = pixels[index + 1]; const blue = pixels[index + 2];
          const luma = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
          if (red > 235 && green > 235 && blue > 235) nearWhite += 1;
          if (red < 12 && green < 12 && blue < 12) nearBlack += 1;
          if (green > 180 && green > red * 1.5 && green > blue * 1.25) greenDominant += 1;
          lumaSum += luma; lumaSquaredSum += luma * luma;
        }
        const pixelCount = pixels.length / 4; const meanLuma = lumaSum / pixelCount;
        let binary = '';
        for (let offset = 0; offset < data.length; offset += 0x8000) {
          binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
        }
        return {
          data: btoa(binary), width: image.width, height: image.height,
          nearWhiteRatio: nearWhite / pixelCount, nearBlackRatio: nearBlack / pixelCount,
          greenDominantRatio: greenDominant / pixelCount,
          lumaStdDev: Math.sqrt((lumaSquaredSum / pixelCount) - (meanLuma * meanLuma))
        };
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Core screenshot timed out')), 5000))
    ])`);
    let coreScreenshot;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      coreScreenshot = await captureCoreScreenshot();
      const diagnosticLike = coreScreenshot.nearWhiteRatio > 0.6;
      const blackTransition = coreScreenshot.nearBlackRatio > 0.55;
      const corrupted = coreScreenshot.greenDominantRatio > 0.5;
      const blank = coreScreenshot.lumaStdDev < 15;
      if (!diagnosticLike && !blackTransition && !corrupted && !blank) break;
      if (attempt < 19) await delay(500);
    }
    const coreScreenshotPath = screenshotPath.toLowerCase().endsWith('.png')
      ? `${screenshotPath.slice(0, -4)}.core.png`
      : `${screenshotPath}.core.png`;
    await writeFile(coreScreenshotPath, Buffer.from(coreScreenshot.data, 'base64'));
    delete coreScreenshot.data;
    if (selectedFileSizes && coreScreenshot.nearWhiteRatio > 0.6) {
      throw new Error(`The core rendered an error/diagnostic screen: ${JSON.stringify(coreScreenshot)}`);
    }
    if (selectedFileSizes && coreScreenshot.greenDominantRatio > 0.5) {
      throw new Error(`The framebuffer remained corrupted: ${JSON.stringify(coreScreenshot)}`);
    }
    if (coreScreenshot.nearBlackRatio > 0.55) {
      throw new Error(`The core framebuffer remained in a mostly black transition: ${JSON.stringify(coreScreenshot)}`);
    }
    if (coreScreenshot.lumaStdDev < 15) {
      throw new Error(`The core screenshot was effectively blank: ${JSON.stringify(coreScreenshot)}`);
    }

    const canvas = await evaluate(`(() => {
      const node = document.querySelector('#emulator-player canvas');
      const rect = node.getBoundingClientRect();
      return { width: node.width, height: node.height, cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height) };
    })()`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ ok: true, stage: 'game', gameSource, baseUrl, viewport: { width: viewportWidth, height: viewportHeight }, firstFrame, secondFrame, runtime, coreScreenshot, canvas, screenshotPath, coreScreenshotPath }, null, 2));
  }
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
