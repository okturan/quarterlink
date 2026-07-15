const $ = (selector) => document.querySelector(selector);
const views = [...document.querySelectorAll('.view')];
const state = {
  mode: 'friends',
  roomId: null, role: null, inviteSecret: null, ws: null, pc: null,
  control: null, input: null, peerConnected: false, controllerReady: false,
  gameReady: false, gameTitle: 'Metal Slug 2', guestReady: false, guestDeviceReady: false, romFile: null, biosFile: null, pingSeq: 0, pings: new Map(),
  rtts: [], jitter: 0, packetCount: 0, emulatorLoaded: false, streamStarted: false,
  pendingIce: [], relayAvailable: false, mediaReady: false, receivedTracks: new Set(), reconnectAttempts: 0, peerCreating: null,
  sourceSelection: 0, creating: false, joining: false, confirmAction: null,
};
let emulatorBootPromise = null;

function show(id) {
  views.forEach((view) => view.classList.toggle('hidden', view.id !== id));
  document.body.classList.toggle('playing', id === 'game');
  window.scrollTo({ top: 0, behavior: 'instant' });
  const title = $(`#${id} h1, #${id} [tabindex="-1"]`);
  if (title) requestAnimationFrame(() => title.focus({ preventScroll: true }));
  document.title = id === 'landing' ? 'QuarterLink — Your couch has a second seat' : `${title?.textContent?.trim() || 'QuarterLink'} — QuarterLink`;
}

function toast(message) {
  const node = $('#toast'); node.querySelector('strong').textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 4500);
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
  if (!state.gameReady) { $('#setup-error').textContent = 'Choose your game files or the free test game first.'; return; }
  if (state.mode === 'solo') {
    if (state.creating) return;
    state.creating = true; const button = $('#create-room-button'); button.disabled = true; button.textContent = 'Opening the arcade…';
    try { await startSolo(); }
    catch (error) {
      state.role = null; state.roomId = null; state.emulatorLoaded = false;
      $('#setup-error').textContent = `The game could not start: ${error.message}`;
      show('setup'); toast('The game could not start. Your selected files are still here.');
    } finally { state.creating = false; syncSetupButton(); }
    return;
  }
  if (!name) { $('#setup-error').textContent = 'Enter a display name.'; input.focus(); return; }
  if (state.creating) return;
  state.creating = true; const button = $('#create-room-button'); button.disabled = true; button.textContent = 'Creating private room…';
  try {
    const result = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) });
    saveName(input); state.roomId = result.roomId; state.inviteSecret = result.inviteSecret; state.role = 'host';
    sessionStorage.setItem(`quarterlink.invite.${state.roomId}`, state.inviteSecret);
    history.replaceState({}, '', `/room/${state.roomId}`); await enterRoom();
  } catch (error) { $('#setup-error').textContent = error.message; }
  finally { state.creating = false; button.disabled = false; button.textContent = 'Create private room →'; }
}

async function joinRoom() {
  const input = $('#guest-name'); let invite = parseInvite();
  if (!invite) invite = parseInvite($('#room-code').value.trim());
  showJoinError('');
  if (!input.value.trim()) { showJoinError('Enter a display name first.'); input.focus(); return; }
  if (!invite) { showJoinError('Paste the complete invite link your friend sent, including the # section.'); return; }
  if (state.joining) return;
  state.joining = true; const button = $('#join-room-button'); button.disabled = true; button.textContent = 'Joining private room…';
  try {
    await api(`/api/rooms/${invite.roomId}/redeem`, { method: 'POST', body: JSON.stringify({ name: input.value.trim(), secret: invite.secret }) });
    saveName(input); state.roomId = invite.roomId; state.role = 'guest'; state.mode = 'friends';
    history.replaceState({}, '', `/room/${state.roomId}`); await enterRoom();
  } catch (error) {
    const message = error.message === 'full' ? 'Both seats are already claimed.' : error.message === 'expired' ? 'This invite expired. Ask your friend for a fresh link.' : error.message === 'invalid' ? 'This invite is invalid or has already been used.' : `QuarterLink could not join this room: ${error.message}`;
    showJoinError(message);
  } finally {
    state.joining = false; button.disabled = false; button.textContent = 'Join room →';
  }
}

function showJoinError(message) {
  $('#join-error').textContent = message;
  $('#join-error-card').classList.toggle('hidden', !message);
}

function openSetup(mode) {
  state.mode = mode;
  $('#setup-mode-label').textContent = mode === 'solo' ? 'PLAY SOLO' : 'OPEN A PRIVATE ROOM';
  $('#setup-title').textContent = mode === 'solo' ? 'Choose your game.' : 'Set up your run.';
  $('#setup-copy').textContent = mode === 'solo' ? 'The game runs entirely in this browser—no room or connection needed.' : 'Choose a game source, then open a private room.';
  $('#display-name-step').classList.toggle('hidden', mode === 'solo');
  $('.source-step .step-number').textContent = mode === 'solo' ? '1' : '2';
  $('#create-room-button').textContent = mode === 'solo' ? 'Start solo →' : 'Create private room →';
  show('setup'); startControllerProbe(); updateGamePresentation(); syncSetupButton();
  if (mode === 'friends') requestAnimationFrame(() => $('#host-name').focus());
}

async function enterRoom() {
  const snapshot = await api(`/api/rooms/${state.roomId}`);
  state.role = snapshot.role;
  const host = snapshot.room.peers.host; const guest = snapshot.room.peers.guest;
  state.mode = 'friends';
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
  node.classList.toggle('empty', !name); node.classList.toggle('occupied', Boolean(name));
  node.querySelector('strong').textContent = name || 'Waiting for your friend';
  node.querySelector('small').textContent = name ? 'Player 2 · Seat claimed' : 'Send the private invite link';
  node.querySelector('.seat-status').textContent = name ? 'Joined' : 'Empty';
  $('#seat-count').textContent = name ? '2 of 2 seats filled' : '1 of 2 seats filled';
  $('#reset-seat').classList.toggle('hidden', !name || state.role !== 'host');
}

function connectSignaling() {
  if (state.ws) state.ws.close();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${state.roomId}/ws`);
  state.ws = ws;
  ws.onopen = () => { $('#room-state').textContent = 'Room online'; $('#room-state').className = 'pill green'; };
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
    setCheck('#check-network', connected, connected ? 'Connected' : 'Checking'); updateReady();
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
      $('#sound-gate').classList.remove('hidden');
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
      if (msg.type === 'prepare' && state.role === 'guest') {
        if (msg.gameTitle) { state.gameTitle = msg.gameTitle; updateGamePresentation(); }
        show('loading'); $('#loading-title').textContent = `Your friend is starting ${state.gameTitle}`;
      }
      if (msg.type === 'media.ready' && state.role === 'host') state.mediaReady = true;
      if (msg.type === 'start' && state.role === 'guest') beginGuestPlay();
    };
  } else if (channel.label === 'input') {
    lastRemoteSeq = 0; remoteValues.fill(0); lastInput = ''; lastInputAt = 0;
    state.input = channel;
    channel.onmessage = (event) => applyRemoteInput(JSON.parse(event.data));
  }
  channel.onopen = () => {
    state.peerConnected = true; setCheck('#check-network', true, 'Detecting route');
    if (channel.label === 'control' && state.role === 'guest') channel.send(JSON.stringify({ type: 'device.ready', ready: state.controllerReady }));
    if (channel.label === 'control') maybeReportMediaReady();
    updateReady();
  };
}

function startControllerProbe() {
  if (startControllerProbe.started) return;
  startControllerProbe.started = true;
  let hadPad = false;
  const poll = () => {
    if (!state.roomId && $('#setup').classList.contains('hidden')) return;
    const pad = navigator.getGamepads?.()[0];
    if (pad && !state.controllerReady) {
      state.controllerReady = true; hadPad = true; setCheck('#check-controller', true, pad.mapping === 'standard' ? 'Controller ready' : 'Check mapping');
      $('#gamepad-test-state').textContent = pad.mapping === 'standard' ? 'Detected' : 'Nonstandard'; sendDeviceReady(); updateReady();
    }
    if (state.role === 'guest' && state.input?.readyState === 'open' && pad) sendGamepad(pad);
    if (!pad && hadPad) { hadPad = false; sendNeutralInput(); state.controllerReady = false; state.guestReady = false; setCheck('#check-controller', false, 'Disconnected'); $('#gamepad-test-state').textContent = 'Disconnected'; sendDeviceReady(); sendSeatReady(false); updateReady(); }
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
  if (index === undefined) return;
  if (state.role === 'guest') {
    event.preventDefault(); keyboardState[index] = type === 'keydown' ? 1 : 0;
    if (!state.controllerReady) { state.controllerReady = true; setCheck('#check-controller', true, 'Keyboard ready'); sendDeviceReady(); updateReady(); }
    sendInputValues(keyboardState, true);
  } else if (type === 'keydown' && (state.role === 'host' || !$('#setup').classList.contains('hidden'))) {
    state.controllerReady = true; setCheck('#check-controller', true, 'Keyboard ready'); updateReady();
  }
  if (type === 'keydown' && $('#controls-dialog').open) $('#keyboard-test-state').textContent = event.code.replace(/^Key/, '');
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
    button.textContent = state.guestReady ? 'Ready · click to unready' : state.peerConnected ? "I'm ready" : 'Connecting to host';
    button.disabled = !state.peerConnected || !state.controllerReady;
    setCheck('#check-game', true, 'Host provides game');
  } else {
    const ready = state.controllerReady && state.gameReady && state.peerConnected && state.guestDeviceReady && state.guestReady;
    button.disabled = !ready;
    button.textContent = ready ? 'Start the run →' : !state.gameReady ? 'Choose a game source' : !state.controllerReady ? 'Test Player 1 controls' : !state.peerConnected ? 'Waiting for your friend' : !state.guestDeviceReady ? 'Player 2 needs controls' : !state.guestReady ? 'Waiting for Player 2 readiness' : 'Start the run →';
  }
}

async function handleFiles(files) {
  const selection = ++state.sourceSelection;
  const entries = [...files]; const rom = entries.find((f) => f.name.toLowerCase() === 'mslug2.zip'); const bios = entries.find((f) => f.name.toLowerCase() === 'neogeo.zip');
  if (!rom || !bios) {
    const missing = [!rom && 'mslug2.zip', !bios && 'neogeo.zip'].filter(Boolean).join(' and ');
    state.gameReady = false; $('#setup-error').textContent = `Missing ${missing}. Select both original ZIP archives together.`;
    updateSourceStatus(`Missing ${missing}.`, false); setCheck('#check-game', false, 'Files missing'); updateReady(); return;
  }
  if (selection !== state.sourceSelection) return;
  state.romFile = rom; state.biosFile = bios; state.gameTitle = 'Metal Slug 2'; state.gameReady = true;
  $('#setup-error').textContent = ''; setCheck('#check-game', true, 'Files selected');
  updateSourceStatus('Metal Slug 2 files selected. Compatibility is checked at launch.', true); updateGamePresentation(); updateReady();
}

async function loadDemo() {
  const selection = ++state.sourceSelection;
  updateSourceStatus('Loading the free test game…', false);
  document.querySelectorAll('[data-action="load-demo"]').forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch('/demo/cps1frog.zip');
    if (!response.ok) throw new Error('The free test game could not be loaded.');
    if (selection !== state.sourceSelection) return;
    state.romFile = new File([await response.blob()], 'cps1frog.zip', { type: 'application/zip' });
    state.biosFile = null; state.gameTitle = 'Frog Feast'; state.gameReady = true;
    setCheck('#check-game', true, 'Frog Feast ready');
    updateSourceStatus('Frog Feast is ready. No BIOS is required.', true); updateGamePresentation(); updateReady();
  } finally {
    document.querySelectorAll('[data-action="load-demo"]').forEach((button) => { button.disabled = false; });
  }
}

function updateSourceStatus(message, ready) {
  const status = $('#setup-source-status'); status.querySelector('p').textContent = message; status.classList.toggle('ready', ready);
  $('#file-picker p').textContent = message;
}

function updateGamePresentation() {
  document.querySelectorAll('[data-game-title]').forEach((node) => { node.textContent = state.gameReady ? state.gameTitle : 'No game selected'; });
  syncSetupButton();
}

function syncSetupButton() {
  const button = $('#create-room-button'); if (!button || state.creating) return;
  button.disabled = (state.mode === 'friends' && !$('#host-name').value.trim()) || !state.gameReady;
  button.textContent = state.mode === 'solo' ? 'Start solo →' : 'Create private room →';
}

async function startGame() {
  if (state.role === 'guest') {
    if (!state.peerConnected || !state.controllerReady) return;
    state.guestReady = !state.guestReady; sendDeviceReady(); sendSeatReady(state.guestReady); updateReady(); toast(state.guestReady ? 'Ready — your friend can start the run.' : 'You are no longer ready.'); return;
  }
  if (!state.gameReady || !state.peerConnected || !state.guestReady) return;
  state.control?.send(JSON.stringify({ type: 'prepare', gameTitle: state.gameTitle }));
  show('loading');
  $('#loading-title').textContent = `Preparing ${state.gameTitle}`;
  $('#stage-connect').classList.add('done'); $('#stage-connect').textContent = 'Encrypted connection established';
  await loadEmulator();
  $('#stage-sync').classList.add('done'); $('#stage-sync').textContent = 'Game compatibility confirmed';
  show('game');
  $('#game-peer-label').textContent = 'Player 1 + Player 2'; $('#quality-pill').classList.remove('hidden');
  state.mediaReady = false;
  await maybeAttachStream(true);
  await waitForMedia();
  $('#stage-ready').classList.add('done'); $('#stage-ready').textContent = 'Audio and video ready';
  state.control?.send(JSON.stringify({ type: 'start' }));
}

async function startSolo() {
  if (!state.gameReady) return;
  const input = $('#host-name'); if (input.value.trim()) saveName(input);
  state.role = 'host'; state.roomId = 'solo'; state.mode = 'solo';
  startControllerProbe(); updateGamePresentation(); show('loading');
  $('#loading-title').textContent = `Preparing ${state.gameTitle}`;
  $('#stage-connect').classList.add('done'); $('#stage-connect').textContent = 'Solo session · no network needed';
  await loadEmulator();
  $('#stage-sync').classList.add('done'); $('#stage-sync').textContent = 'Game compatibility confirmed';
  $('#stage-ready').classList.add('done'); $('#stage-ready').textContent = 'Ready to play';
  show('game'); $('#game-peer-label').textContent = 'Player 1 · Solo';
  $('#quality-pill').textContent = 'Solo · Local'; $('#quality-pill').classList.add('hidden');
  $('[data-action="show-diagnostics"]').classList.add('hidden');
}

function loadEmulator() {
  if (state.emulatorLoaded) return Promise.resolve();
  if (emulatorBootPromise) return emulatorBootPromise;

  emulatorBootPromise = new Promise((resolve, reject) => {
    let settled = false; let failurePoll; let timeout;
    const onPolicyViolation = (event) => {
      const directive = event.effectiveDirective || event.violatedDirective || '';
      if (event.blockedURI?.startsWith('blob:') && /^(script-src|worker-src)/.test(directive)) {
        finish(new Error('The browser security policy blocked the emulator runtime.'));
      }
    };
    const finish = (error) => {
      if (settled) return;
      settled = true; clearInterval(failurePoll); clearTimeout(timeout);
      document.removeEventListener('securitypolicyviolation', onPolicyViolation);
      delete window.EJS_ready; delete window.EJS_onGameStart;
      if (error) { state.emulatorLoaded = false; reject(error); }
      else { state.emulatorLoaded = true; $('#game-placeholder').classList.add('hidden'); resolve(); }
    };

    document.addEventListener('securitypolicyviolation', onPolicyViolation);

    window.EJS_player = '#emulator-player'; window.EJS_gameName = state.romFile.name; window.EJS_gameUrl = state.romFile;
    if (state.biosFile) window.EJS_biosUrl = state.biosFile; else delete window.EJS_biosUrl;
    window.EJS_core = 'fbneo'; window.EJS_pathtodata = '/emulatorjs/data/';
    window.EJS_startOnLoaded = true; window.EJS_color = '#315cf5'; window.EJS_language = 'en-US';
    window.EJS_ready = () => { $('#loading-note').textContent = 'Arcade core ready. Starting the game…'; };
    window.EJS_onGameStart = () => finish();
    const script = document.createElement('script'); script.src = '/emulatorjs/data/loader.js'; script.dataset.quarterlinkLoader = 'true';
    script.onerror = () => finish(new Error('The emulator frontend could not be loaded.'));
    script.onload = () => {
      failurePoll = setInterval(() => {
        if (!window.EJS_emulator?.failedToStart) return;
        const detail = $('#emulator-player .ejs_error_text')?.textContent?.trim();
        finish(new Error(detail || 'The emulator could not start this game.'));
      }, 100);
    };
    document.body.append(script);
    timeout = setTimeout(() => finish(new Error('The arcade took too long to start. Check the connection and try again.')), 30000);
  }).finally(() => { emulatorBootPromise = null; });

  return emulatorBootPromise;
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
    $('#sound-gate').classList.add('hidden');
  }
}

async function enableMedia() {
  await $('#guest-video').play();
  maybeReportMediaReady();
}

function beginGuestPlay() {
  show('game'); $('#game-peer-label').textContent = 'Player 1 + Player 2';
  const playable = $('#guest-video').readyState >= 2 && state.receivedTracks.has('video');
  $('#game-placeholder').classList.toggle('hidden', playable);
}
function connectionLost() {
  if (!state.peerConnected && state.reconnectAttempts) return;
  state.peerConnected = false; state.guestReady = false; state.guestDeviceReady = false; resetRemoteInputs(); updateReady();
  if (!$('#game').classList.contains('hidden')) showConnectionOverlay('reconnecting');
  if (state.role === 'host') setTimeout(restartConnection, 2500);
}

async function restartConnection() {
  if (!state.pc || state.pc.connectionState === 'connected') return;
  if (state.reconnectAttempts >= 3) { showConnectionOverlay('failed'); return; }
  state.reconnectAttempts++;
  try {
    state.pc.restartIce();
    await state.pc.setLocalDescription(await state.pc.createOffer({ iceRestart: true }));
    signal({ type: 'rtc.offer', description: state.pc.localDescription });
    setTimeout(restartConnection, 5000);
  } catch { setTimeout(restartConnection, 2500); }
}

function showConnectionOverlay(mode) {
  const failed = mode === 'failed';
  $('#connection-overlay').classList.remove('hidden');
  $('#connection-title').textContent = failed ? 'Connection could not be restored' : `Reconnecting${state.reconnectAttempts ? ` · attempt ${state.reconnectAttempts + 1} of 3` : '…'}`;
  $('#connection-copy').textContent = failed ? 'The host game is still open. Retry the connection or end this session.' : 'Player two was released; the host game is still running while we restore the link.';
  $('#retry-connection').classList.toggle('hidden', !failed);
  $('#end-session').classList.toggle('hidden', !failed);
}

function retryConnection() {
  state.reconnectAttempts = 0; showConnectionOverlay('reconnecting'); restartConnection();
}

function startPing() {
  if (startPing.timer) return;
  startPing.timer = setInterval(() => {
    if (state.control?.readyState !== 'open') return;
    const now = performance.now();
    for (const [pendingSeq, started] of state.pings) if (now - started > 10000) state.pings.delete(pendingSeq);
    const seq = ++state.pingSeq; state.pings.set(seq, now); state.control.send(JSON.stringify({ type: 'ping', seq }));
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

function openControls() {
  const dialog = $('#controls-dialog');
  if (!dialog.open) dialog.showModal();
}

function toggleSheet(id, open) {
  const node = $(id); node.classList.toggle('hidden', !open);
  if (id === '#diagnostics') $('#quality-pill').setAttribute('aria-expanded', String(open));
  if (id === '#game-menu-panel') $('[data-action="game-menu"]').setAttribute('aria-expanded', String(open));
}

function requestEndSession() {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = state.mode === 'solo' ? 'End this solo run?' : 'End this session?';
  $('#confirm-copy').textContent = state.mode === 'solo' ? 'The local game will close and return to the home screen.' : 'The private room and its current invite will stop working.';
  $('#confirm-action').textContent = 'End session'; state.confirmAction = () => location.assign('/');
  dialog.returnValue = ''; if (!dialog.open) dialog.showModal();
}

function requestGuestRemoval() {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = 'Remove Player 2?';
  $('#confirm-copy').textContent = 'Their current seat and invite will stop working. QuarterLink will create a fresh private link.';
  $('#confirm-action').textContent = 'Remove and reinvite'; state.confirmAction = resetGuestSeat;
  dialog.returnValue = ''; if (!dialog.open) dialog.showModal();
}

$('#confirm-dialog').addEventListener('close', (event) => {
  if (event.target.returnValue === 'confirm') Promise.resolve(state.confirmAction?.()).catch((error) => toast(error.message));
  state.confirmAction = null;
});

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  if (['create-room', 'join-room'].includes(action)) event.preventDefault();
  if (action === 'open-host') openSetup('friends');
  if (action === 'open-solo') openSetup('solo');
  if (action === 'open-join') { $('#code-field').classList.remove('hidden'); show('join'); }
  if (action === 'home') location.assign('/');
  if (action === 'leave' || action === 'end-session') requestEndSession();
  if (action === 'create-room') createRoom();
  if (action === 'join-room') joinRoom();
  if (action === 'copy-invite') copyInvite();
  if (action === 'reset-seat') requestGuestRemoval();
  if (action === 'load-demo') loadDemo().catch((error) => toast(error.message));
  if (action === 'start-game') startGame().catch((error) => { toast(error.message); show('room'); });
  if (action === 'enable-media') enableMedia().catch(() => toast('Sound is still blocked. Check the browser site controls.'));
  if (action === 'retry-connection') retryConnection();
  if (action === 'fullscreen') $('#game').requestFullscreen?.();
  if (action === 'game-menu') toggleSheet('#game-menu-panel', $('#game-menu-panel').classList.contains('hidden'));
  if (action === 'close-game-menu') toggleSheet('#game-menu-panel', false);
  if (action === 'show-diagnostics') { toggleSheet('#game-menu-panel', false); toggleSheet('#diagnostics', true); }
  if (action === 'close-diagnostics') toggleSheet('#diagnostics', false);
  if (action === 'open-controls') { toggleSheet('#game-menu-panel', false); openControls(); }
  if (action === 'dismiss-toast') $('#toast').classList.remove('show');
});
$('#quality-pill').addEventListener('click', () => toggleSheet('#diagnostics', $('#diagnostics').classList.contains('hidden')));
$('#game-files').addEventListener('change', (event) => handleFiles(event.target.files));
$('#host-name').addEventListener('input', syncSetupButton);

const remembered = localStorage.getItem('quarterlink.name') || '';
$('#host-name').value = remembered; $('#guest-name').value = remembered;
const supported = typeof RTCPeerConnection !== 'undefined' && typeof WebAssembly !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
if (!supported) {
  document.querySelectorAll('[data-action="open-host"], [data-action="open-solo"], [data-action="open-join"]').forEach((button) => { button.disabled = true; });
  toast('QuarterLink requires a current Chrome or Edge browser.');
}
const invite = parseInvite();
updateGamePresentation();
if (invite) { state.mode = 'friends'; state.roomId = invite.roomId; $('#join-title').textContent = 'Your friend saved you a seat.'; show('join'); }
else if (location.pathname.startsWith('/room/')) {
  state.roomId = location.pathname.split('/')[2]; enterRoom().catch(() => { history.replaceState({}, '', '/'); show('landing'); toast('That room is no longer available.'); });
}
