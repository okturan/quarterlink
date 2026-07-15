const $ = (selector) => document.querySelector(selector);
const views = [...document.querySelectorAll('.view')];
const state = {
  roomId: null, role: null, inviteSecret: null, ws: null, pc: null,
  control: null, input: null, peerConnected: false, controllerReady: false,
  gameReady: false, gameTitle: 'Metal Slug 2', guestReady: false, guestDeviceReady: false, romFile: null, biosFile: null, pingSeq: 0, pings: new Map(),
  rtts: [], jitter: 0, packetCount: 0, emulatorLoaded: false, streamStarted: false,
  pendingIce: [], relayAvailable: false, mediaReady: false, receivedTracks: new Set(), reconnectAttempts: 0, peerCreating: null,
};

function show(id) {
  views.forEach((view) => view.classList.toggle('hidden', view.id !== id));
  document.body.classList.toggle('playing', id === 'game');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function setCheck(id, done, label) {
  const node = $(id); node.classList.toggle('done', done); node.querySelector('b').textContent = label;
}

function saveName(input) { localStorage.setItem('quarterlink.name', input.value.trim()); }
function api(path, options = {}) {
  return fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Request failed');
      return body;
    });
}

function parseInvite(value = location.href) {
  try {
    const url = new URL(value, location.origin);
    const match = url.pathname.match(/^\/join\/([A-Za-z0-9_-]+)/);
    const secret = url.hash.slice(1);
    return match && secret ? { roomId: match[1], secret } : null;
  } catch { return null; }
}

async function createRoom() {
  const input = $('#host-name'); const name = input.value.trim();
  $('#setup-error').textContent = '';
  try {
    const result = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) });
    saveName(input); state.roomId = result.roomId; state.inviteSecret = result.inviteSecret; state.role = 'host';
    sessionStorage.setItem(`quarterlink.invite.${state.roomId}`, state.inviteSecret);
    history.replaceState({}, '', `/room/${state.roomId}`); await enterRoom();
  } catch (error) { $('#setup-error').textContent = error.message; }
}

async function joinRoom() {
  const input = $('#guest-name'); let invite = parseInvite();
  if (!invite) invite = parseInvite($('#room-code').value.trim());
  $('#join-error').textContent = '';
  if (!invite) { $('#join-error').textContent = 'Paste the complete invite link your friend sent.'; return; }
  try {
    await api(`/api/rooms/${invite.roomId}/redeem`, { method: 'POST', body: JSON.stringify({ name: input.value.trim(), secret: invite.secret }) });
    saveName(input); state.roomId = invite.roomId; state.role = 'guest';
    history.replaceState({}, '', `/room/${state.roomId}`); await enterRoom();
  } catch (error) {
    $('#join-error').textContent = error.message === 'full' ? 'Both seats in this room are already taken.' : 'This invite has clocked out. Ask your friend for a fresh one.';
  }
}

async function enterRoom() {
  const snapshot = await api(`/api/rooms/${state.roomId}`);
  state.role = snapshot.role;
  const host = snapshot.room.peers.host; const guest = snapshot.room.peers.guest;
  $('#host-display').textContent = host?.name || 'Host';
  $('#room-code-display').textContent = state.roomId.slice(0, 4).toUpperCase() + '-' + state.roomId.slice(4, 7).toUpperCase();
  $('#invite-box').classList.toggle('hidden', state.role !== 'host');
  $('#file-picker').classList.toggle('hidden', state.role !== 'host');
  updateGuest(guest?.name);
  if (state.role === 'host' && !guest) {
    state.inviteSecret = sessionStorage.getItem(`quarterlink.invite.${state.roomId}`);
    if (!state.inviteSecret) {
      const rotated = await api(`/api/rooms/${state.roomId}/invite`, { method: 'POST', body: '{}' });
      state.inviteSecret = rotated.secret;
      sessionStorage.setItem(`quarterlink.invite.${state.roomId}`, state.inviteSecret);
    }
  }
  show('room'); connectSignaling(); startControllerProbe(); updateReady();
}

function updateGuest(name) {
  const node = $('#guest-seat');
  node.classList.toggle('empty', !name); node.classList.toggle('ready', Boolean(name));
  node.querySelector('strong').textContent = name || 'Waiting for your friend';
  node.querySelector('small').textContent = name ? 'Player two' : 'Send the private invite link';
  node.querySelector('.seat-status').textContent = name ? 'Connected' : 'Empty';
  $('#seat-count').textContent = name ? '2 of 2 seats filled' : '1 of 2 seats filled';
  $('#reset-seat').classList.toggle('hidden', !name || state.role !== 'host');
}

function connectSignaling() {
  if (state.ws) state.ws.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${state.roomId}/ws`);
  state.ws = ws;
  ws.onopen = () => { $('#room-state').textContent = 'Connected'; $('#room-state').className = 'pill green'; };
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'room.snapshot') {
      updateGuest(message.room.peers.guest?.name);
      if (message.room.peers.guest && !state.pc) await createPeer();
    } else if (message.type === 'peer.joined') {
      updateGuest(message.name); if (!state.pc) await createPeer();
    } else if (message.type === 'peer.connected') {
      if (!state.pc) await createPeer();
      if (state.role === 'host' && state.pc?.localDescription?.type === 'offer') signal({ type: 'rtc.offer', description: state.pc.localDescription });
    } else if (message.type === 'rtc.offer') {
      if (!state.pc) await createPeer(); await state.pc.setRemoteDescription(message.description); await flushIce();
      await state.pc.setLocalDescription(await state.pc.createAnswer()); signal({ type: 'rtc.answer', description: state.pc.localDescription });
    } else if (message.type === 'rtc.answer') {
      await state.pc?.setRemoteDescription(message.description); await flushIce();
    } else if (message.type === 'rtc.ice' && message.candidate) {
      if (state.pc?.remoteDescription) await state.pc.addIceCandidate(message.candidate);
      else state.pendingIce.push(message.candidate);
    } else if (message.type === 'peer.disconnected') {
      if (state.pc?.connectionState !== 'connected') connectionLost();
    } else if (message.type === 'room.expired') {
      toast('This room has closed.'); setTimeout(() => location.assign('/'), 1200);
    } else if (message.type === 'guest.removed') {
      if (state.role === 'guest') location.assign('/');
      else updateGuest(null);
    }
  };
  ws.onclose = (event) => {
    if (event.code === 4002) { state.roomId = null; location.assign('/'); return; }
    if (state.ws === ws && state.roomId) setTimeout(connectSignaling, 1200);
  };
}

async function flushIce() {
  const queued = state.pendingIce.splice(0);
  for (const candidate of queued) await state.pc?.addIceCandidate(candidate).catch(() => {});
}

function signal(message) { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message)); }

async function createPeer() {
  if (state.peerCreating) return state.peerCreating;
  state.peerCreating = createPeerInternal();
  try { return await state.peerCreating; } finally { state.peerCreating = null; }
}

async function createPeerInternal() {
  const ice = await api(`/api/rooms/${state.roomId}/ice`, { method: 'POST', body: '{}' }).catch(() => ({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], relayAvailable: false }));
  state.relayAvailable = ice.relayAvailable;
  const pc = new RTCPeerConnection({ iceServers: ice.iceServers, bundlePolicy: 'max-bundle' });
  state.pc = pc;
  pc.onicecandidate = ({ candidate }) => candidate && signal({ type: 'rtc.ice', candidate });
  pc.onconnectionstatechange = () => {
    const connected = pc.connectionState === 'connected';
    state.peerConnected = connected;
    setCheck('#check-network', connected, connected ? 'Direct' : 'Checking'); updateReady();
    if (connected) { state.reconnectAttempts = 0; startPing(); $('#connection-overlay').classList.add('hidden'); updateTransportStats(); }
    if (['failed', 'disconnected'].includes(pc.connectionState)) connectionLost();
  };
  pc.ontrack = (event) => {
    const video = $('#guest-video');
    const stream = event.streams[0];
    if (stream) video.srcObject = stream;
    else {
      const current = video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream();
      if (!current.getTracks().some((track) => track.id === event.track.id)) current.addTrack(event.track);
      video.srcObject = current;
    }
    state.receivedTracks.add(event.track.kind); video.classList.remove('hidden');
    $('#game-placeholder').classList.add('hidden');
    video.play().then(maybeReportMediaReady).catch(() => {
      $('#enable-media').classList.remove('hidden');
      toast('One click is needed to enable game sound.');
    });
  };
  pc.ondatachannel = (event) => bindChannel(event.channel);
  if (state.role === 'host') {
    bindChannel(pc.createDataChannel('control', { ordered: true }));
    bindChannel(pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
    await maybeAttachStream();
    await pc.setLocalDescription(await pc.createOffer()); signal({ type: 'rtc.offer', description: pc.localDescription });
  }
}

function bindChannel(channel) {
  if (channel.label === 'control') {
    state.control = channel;
    channel.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ping') channel.send(JSON.stringify({ type: 'pong', seq: msg.seq, at: performance.now() }));
      if (msg.type === 'pong') recordPong(msg.seq);
      if (msg.type === 'device.ready' && state.role === 'host') { state.guestDeviceReady = Boolean(msg.ready); updateReady(); }
      if (msg.type === 'seat.ready' && state.role === 'host') { state.guestReady = Boolean(msg.ready); updateReady(); }
      if (msg.type === 'prepare' && state.role === 'guest') { show('loading'); $('#loading-title').textContent = 'Your friend is starting the arcade'; }
      if (msg.type === 'media.ready' && state.role === 'host') state.mediaReady = true;
      if (msg.type === 'start' && state.role === 'guest') beginGuestPlay();
    };
  } else if (channel.label === 'input') {
    lastRemoteSeq = 0; remoteValues.fill(0); lastInput = ''; lastInputAt = 0;
    state.input = channel;
    channel.onmessage = (event) => applyRemoteInput(JSON.parse(event.data));
  }
  channel.onopen = () => {
    state.peerConnected = true; setCheck('#check-network', true, state.relayAvailable ? 'Connected' : 'Direct');
    if (channel.label === 'control' && state.role === 'guest') channel.send(JSON.stringify({ type: 'device.ready', ready: state.controllerReady }));
    if (channel.label === 'control') maybeReportMediaReady();
    updateReady();
  };
}

function startControllerProbe() {
  let hadPad = false;
  const poll = () => {
    if (!state.roomId) return;
    const pad = navigator.getGamepads?.()[0];
    if (pad && !state.controllerReady) {
      state.controllerReady = true; hadPad = true; setCheck('#check-controller', true, pad.id.slice(0, 18)); sendDeviceReady(); updateReady();
    }
    if (state.role === 'guest' && state.input?.readyState === 'open' && pad) sendGamepad(pad);
    if (!pad && hadPad) { hadPad = false; sendNeutralInput(); state.controllerReady = false; state.guestReady = false; setCheck('#check-controller', false, 'Disconnected'); sendDeviceReady(); sendSeatReady(false); updateReady(); }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

const GAMEPAD_TO_LIBRETRO = [8, 0, 9, 1, 10, 11, 12, 13, 2, 3, 14, 15, 4, 5, 6, 7];
const KEY_TO_LIBRETRO = { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyZ: 0, KeyX: 8, KeyA: 1, KeyS: 9, Enter: 3, ShiftRight: 2 };
let inputSeq = 0;
let lastInput = '';
let lastInputAt = 0;
let lastRemoteSeq = 0;
const keyboardState = Array(16).fill(0);
const remoteValues = Array(16).fill(0);

function sendGamepad(pad) {
  const values = Array(16).fill(0);
  GAMEPAD_TO_LIBRETRO.forEach((target, physical) => { values[target] = pad.buttons[physical]?.pressed ? 1 : 0; });
  const x = pad.axes[0] || 0; const y = pad.axes[1] || 0;
  if (Math.abs(x) > .45) values[x < 0 ? 6 : 7] = 1;
  if (Math.abs(y) > .45) values[y < 0 ? 4 : 5] = 1;
  keyboardState.forEach((value, index) => { if (value) values[index] = value; });
  sendInputValues(values);
}

function sendInputValues(values, force = false) {
  if (state.input?.readyState !== 'open') return;
  const now = performance.now(); const body = JSON.stringify(values);
  if (!force && body === lastInput && now - lastInputAt < 100) return;
  state.input.send(JSON.stringify({ type: 'input', seq: ++inputSeq, values }));
  state.packetCount++; lastInput = body; lastInputAt = now; $('#diag-packets').textContent = String(state.packetCount);
}

function sendNeutralInput() { if (state.role !== 'guest') return; keyboardState.fill(0); sendInputValues(Array(16).fill(0), true); }
function sendDeviceReady() {
  if (state.role === 'guest' && state.control?.readyState === 'open') state.control.send(JSON.stringify({ type: 'device.ready', ready: state.controllerReady }));
}
function sendSeatReady(ready) {
  if (state.role === 'guest' && state.control?.readyState === 'open') state.control.send(JSON.stringify({ type: 'seat.ready', ready }));
}

for (const type of ['keydown', 'keyup']) window.addEventListener(type, (event) => {
  const index = KEY_TO_LIBRETRO[event.code];
  if (index === undefined || state.role !== 'guest') return;
  event.preventDefault(); keyboardState[index] = type === 'keydown' ? 1 : 0;
  if (!state.controllerReady) { state.controllerReady = true; setCheck('#check-controller', true, 'Keyboard'); sendDeviceReady(); updateReady(); }
  sendInputValues(keyboardState, true);
});
window.addEventListener('blur', sendNeutralInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) sendNeutralInput(); });
setInterval(() => {
  if (state.role === 'guest' && !navigator.getGamepads?.()[0]) sendInputValues(keyboardState, true);
}, 100);

function resetRemoteInputs() {
  const simulate = window.EJS_emulator?.gameManager?.functions?.simulateInput;
  if (simulate) remoteValues.forEach((_, index) => simulate(1, index, 0));
  remoteValues.fill(0);
}

function applyRemoteInput(message) {
  const manager = window.EJS_emulator?.gameManager;
  const simulate = manager?.functions?.simulateInput?.bind(manager.functions) || manager?.simulateInput?.bind(manager);
  if (!simulate || message.type !== 'input' || !Array.isArray(message.values) || message.seq <= lastRemoteSeq) return;
  lastRemoteSeq = message.seq;
  message.values.slice(0, 16).forEach((value, index) => {
    const normalized = value ? 1 : 0;
    if (remoteValues[index] !== normalized) { remoteValues[index] = normalized; simulate(1, index, normalized); }
  });
}

function updateReady() {
  const button = $('#play-button');
  if (state.role === 'guest') {
    button.textContent = state.guestReady ? 'Ready — waiting for host' : state.peerConnected ? "I'm ready" : 'Connecting to host';
    button.disabled = !state.peerConnected || !state.controllerReady || state.guestReady;
    setCheck('#check-game', state.peerConnected, state.peerConnected ? 'Stream ready' : 'Host provides');
  } else {
    const ready = state.controllerReady && state.gameReady && state.peerConnected && state.guestDeviceReady && state.guestReady;
    button.disabled = !ready;
    button.textContent = ready ? `Start ${state.gameTitle} →` : !state.gameReady ? 'Choose both game files' : !state.peerConnected ? 'Waiting for your friend' : !state.guestDeviceReady ? 'Player two needs a controller or keyboard' : !state.guestReady ? 'Waiting for player two to ready up' : 'Connect a controller';
  }
}

async function handleFiles(files) {
  const entries = [...files]; const rom = entries.find((f) => f.name.toLowerCase() === 'mslug2.zip'); const bios = entries.find((f) => f.name.toLowerCase() === 'neogeo.zip');
  if (!rom || !bios) { toast('Choose both mslug2.zip and neogeo.zip'); return; }
  state.romFile = rom; state.biosFile = bios; state.gameTitle = 'Metal Slug 2'; state.gameReady = true;
  setCheck('#check-game', true, 'Files selected'); $('#file-picker p').textContent = 'Files selected. Compatibility is checked when the arcade starts.'; updateReady();
}

async function loadDemo() {
  const response = await fetch('/demo/cps1frog.zip');
  if (!response.ok) throw new Error('The free test game could not be loaded.');
  state.romFile = new File([await response.blob()], 'cps1frog.zip', { type: 'application/zip' });
  state.biosFile = null; state.gameTitle = 'Frog Feast'; state.gameReady = true;
  setCheck('#check-game', true, 'Frog Feast ready');
  $('#file-picker p').textContent = 'Free two-player test game selected. No BIOS is required.';
  updateReady();
}

async function startGame() {
  if (state.role === 'guest') {
    if (!state.peerConnected || !state.controllerReady) return;
    state.guestReady = true; sendDeviceReady(); sendSeatReady(true); updateReady(); toast('Ready — your friend can start the run.'); return;
  }
  if (!state.gameReady || !state.peerConnected || !state.guestReady) return;
  state.control?.send(JSON.stringify({ type: 'prepare' }));
  show('loading');
  $('#stage-connect').classList.add('done'); $('#stage-connect').textContent = `✓ ${state.relayAvailable ? 'Connection established' : 'Connected directly'}`;
  await loadEmulator();
  $('#stage-sync').classList.add('done'); $('#stage-sync').textContent = '✓ Game compatibility confirmed';
  show('game');
  state.mediaReady = false;
  await maybeAttachStream(true);
  await waitForMedia();
  $('#stage-ready').classList.add('done'); $('#stage-ready').textContent = '✓ Ready';
  state.control?.send(JSON.stringify({ type: 'start' }));
}

function loadEmulator() {
  return new Promise((resolve, reject) => {
    window.EJS_player = '#emulator-player'; window.EJS_gameName = state.romFile.name; window.EJS_gameUrl = state.romFile;
    if (state.biosFile) window.EJS_biosUrl = state.biosFile; else delete window.EJS_biosUrl;
    window.EJS_core = 'fbneo'; window.EJS_pathtodata = '/emulatorjs/data/';
    window.EJS_startOnLoaded = true; window.EJS_color = '#ffb547'; window.EJS_language = 'en-US';
    window.EJS_onGameStart = () => { state.emulatorLoaded = true; $('#game-placeholder').classList.add('hidden'); resolve(); };
    const script = document.createElement('script'); script.src = '/emulatorjs/data/loader.js'; script.onerror = () => reject(new Error('Emulator failed to load')); document.body.append(script);
    setTimeout(() => state.emulatorLoaded ? resolve() : reject(new Error('The arcade took too long to start.')), 30000);
  });
}

async function maybeAttachStream(renegotiate = false) {
  if (state.role !== 'host' || !state.pc || !state.emulatorLoaded || state.streamStarted) return;
  const canvas = $('#emulator-player canvas'); if (!canvas?.captureStream) return;
  // EmulatorJS bridges its OpenAL/WebAudio graph into this capture stream,
  // giving the guest synchronized game audio without a screen-share prompt.
  let stream = null;
  for (let attempt = 0; attempt < 20 && !stream?.getAudioTracks().length; attempt++) {
    try { stream = window.EJS_emulator?.collectScreenRecordingMediaTracks?.(canvas, 60) || canvas.captureStream(60); } catch { stream = null; }
    if (!stream?.getAudioTracks().length) {
      stream?.getTracks().forEach((track) => track.stop());
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!stream?.getVideoTracks().length || !stream.getAudioTracks().length) throw new Error('Game audio did not initialize. Click the game once, then try again.');
  stream.getTracks().forEach((track) => state.pc.addTrack(track, stream)); state.streamStarted = true;
  if (renegotiate) { await state.pc.setLocalDescription(await state.pc.createOffer()); signal({ type: 'rtc.offer', description: state.pc.localDescription }); }
}

function waitForMedia() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (state.mediaReady) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 12000) { clearInterval(timer); reject(new Error('Your friend did not receive the game stream. Check the connection and try again.')); }
    }, 100);
  });
}

function maybeReportMediaReady() {
  const video = $('#guest-video');
  if (state.role === 'guest' && !video.paused && state.receivedTracks.has('audio') && state.receivedTracks.has('video') && state.control?.readyState === 'open') {
    state.control.send(JSON.stringify({ type: 'media.ready' }));
    $('#enable-media').classList.add('hidden');
  }
}

async function enableMedia() {
  await $('#guest-video').play();
  maybeReportMediaReady();
}

function beginGuestPlay() { show('game'); $('#game-placeholder').classList.remove('hidden'); }
function connectionLost() {
  if (!state.peerConnected && state.reconnectAttempts) return;
  state.peerConnected = false; state.guestReady = false; state.guestDeviceReady = false; resetRemoteInputs(); updateReady();
  if (!$('#game').classList.contains('hidden')) $('#connection-overlay').classList.remove('hidden');
  if (state.role === 'host') setTimeout(restartConnection, 2500);
}

async function restartConnection() {
  if (!state.pc || state.pc.connectionState === 'connected' || state.reconnectAttempts >= 3) return;
  state.reconnectAttempts++;
  try {
    state.pc.restartIce();
    await state.pc.setLocalDescription(await state.pc.createOffer({ iceRestart: true }));
    signal({ type: 'rtc.offer', description: state.pc.localDescription });
    setTimeout(restartConnection, 5000);
  } catch { setTimeout(restartConnection, 2500); }
}

function startPing() {
  if (startPing.timer) return;
  startPing.timer = setInterval(() => {
    if (state.control?.readyState !== 'open') return;
    const seq = ++state.pingSeq; state.pings.set(seq, performance.now()); state.control.send(JSON.stringify({ type: 'ping', seq }));
    updateTransportStats();
  }, 1000);
}

async function updateTransportStats() {
  if (!state.pc) return;
  const stats = await state.pc.getStats().catch(() => null); if (!stats) return;
  let pair;
  stats.forEach((report) => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report; });
  if (!pair) return;
  const local = stats.get(pair.localCandidateId); const remote = stats.get(pair.remoteCandidateId);
  const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
  $('#diag-transport').textContent = relayed ? 'TURN relay' : 'Direct peer-to-peer';
  setCheck('#check-network', true, relayed ? 'Relay' : 'Direct');
}
function recordPong(seq) {
  const started = state.pings.get(seq); if (!started) return; state.pings.delete(seq);
  const rtt = performance.now() - started; const previous = state.rtts.at(-1) ?? rtt; state.jitter += (Math.abs(rtt - previous) - state.jitter) / 16;
  state.rtts.push(rtt); if (state.rtts.length > 30) state.rtts.shift();
  const median = [...state.rtts].sort((a, b) => a - b)[Math.floor(state.rtts.length / 2)];
  $('#quality-pill').textContent = `${Math.round(median)} ms · ${median < 45 ? 'Excellent' : median < 80 ? 'Good' : 'Fair'}`;
  $('#diag-rtt').textContent = `${Math.round(median)} ms`; $('#diag-jitter').textContent = `${state.jitter.toFixed(1)} ms`;
}

async function copyInvite() {
  if (!state.inviteSecret) { toast('Preparing a fresh invite…'); return; }
  const url = `${location.origin}/join/${state.roomId}#${state.inviteSecret}`;
  try { await navigator.clipboard.writeText(url); }
  catch {
    const input = document.createElement('textarea'); input.value = url; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
  }
  toast('Invite copied — send it to your friend.');
}

async function resetGuestSeat() {
  const result = await api(`/api/rooms/${state.roomId}/guest`, { method: 'DELETE', body: '{}' });
  state.inviteSecret = result.secret;
  sessionStorage.setItem(`quarterlink.invite.${state.roomId}`, state.inviteSecret);
  state.pc?.close(); state.pc = null; state.control = null; state.input = null;
  state.peerConnected = false; state.guestReady = false; state.guestDeviceReady = false;
  updateGuest(null); updateReady();
  toast('Player two removed. A fresh invite link is ready.');
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  if (action === 'open-host') show('setup');
  if (action === 'open-join') { $('#code-field').classList.remove('hidden'); show('join'); }
  if (action === 'home' || action === 'leave') location.assign('/');
  if (action === 'create-room') createRoom();
  if (action === 'join-room') joinRoom();
  if (action === 'copy-invite') copyInvite();
  if (action === 'reset-seat') resetGuestSeat().catch((error) => toast(error.message));
  if (action === 'load-demo') loadDemo().catch((error) => toast(error.message));
  if (action === 'start-game') startGame().catch((error) => { toast(error.message); show('room'); });
  if (action === 'enable-media') enableMedia().catch(() => toast('Sound is still blocked. Check the browser site controls.'));
  if (action === 'fullscreen') $('#game').requestFullscreen?.();
  if (action === 'game-menu') $('#diagnostics').classList.toggle('hidden');
});
$('#quality-pill').addEventListener('click', () => $('#diagnostics').classList.toggle('hidden'));
$('#game-files').addEventListener('change', (event) => handleFiles(event.target.files));

const remembered = localStorage.getItem('quarterlink.name') || '';
$('#host-name').value = remembered; $('#guest-name').value = remembered;
const supported = typeof RTCPeerConnection !== 'undefined' && typeof WebAssembly !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
if (!supported) {
  document.querySelectorAll('[data-action="open-host"], [data-action="open-join"]').forEach((button) => { button.disabled = true; });
  toast('QuarterLink requires a current Chrome or Edge browser.');
}
const invite = parseInvite();
if (invite) { state.roomId = invite.roomId; $('#join-title').textContent = 'Your friend saved you a seat.'; show('join'); }
else if (location.pathname.startsWith('/room/')) {
  state.roomId = location.pathname.split('/')[2]; enterRoom().catch(() => { history.replaceState({}, '', '/'); show('landing'); toast('That room is no longer available.'); });
}
