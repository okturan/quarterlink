const $ = (selector) => document.querySelector(selector);
const views = [...document.querySelectorAll('.view')];
const state = {
  roomId: null, role: null, inviteSecret: null, ws: null, pc: null,
  control: null, input: null, peerConnected: false, controllerReady: false,
  gameReady: false, romUrl: null, biosUrl: null, pingSeq: 0, pings: new Map(),
  rtts: [], jitter: 0, packetCount: 0, emulatorLoaded: false, streamStarted: false,
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
  show('room'); connectSignaling(); startControllerProbe(); updateReady();
}

function updateGuest(name) {
  const node = $('#guest-seat');
  node.classList.toggle('empty', !name); node.classList.toggle('ready', Boolean(name));
  node.querySelector('strong').textContent = name || 'Waiting for your friend';
  node.querySelector('small').textContent = name ? 'Player two' : 'Send the private invite link';
  node.querySelector('.seat-status').textContent = name ? 'Connected' : 'Empty';
  $('#seat-count').textContent = name ? '2 of 2 seats filled' : '1 of 2 seats filled';
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
    } else if (message.type === 'rtc.offer') {
      if (!state.pc) await createPeer(); await state.pc.setRemoteDescription(message.description);
      await state.pc.setLocalDescription(await state.pc.createAnswer()); signal({ type: 'rtc.answer', description: state.pc.localDescription });
    } else if (message.type === 'rtc.answer') {
      await state.pc?.setRemoteDescription(message.description);
    } else if (message.type === 'rtc.ice' && message.candidate) {
      await state.pc?.addIceCandidate(message.candidate).catch(() => {});
    } else if (message.type === 'peer.disconnected') {
      connectionLost();
    } else if (message.type === 'room.expired') {
      toast('This room has closed.'); setTimeout(() => location.assign('/'), 1200);
    }
  };
  ws.onclose = () => {
    if (state.roomId && !state.peerConnected) setTimeout(connectSignaling, 1200);
  };
}

function signal(message) { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message)); }

async function createPeer() {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
  state.pc = pc;
  pc.onicecandidate = ({ candidate }) => candidate && signal({ type: 'rtc.ice', candidate });
  pc.onconnectionstatechange = () => {
    const connected = pc.connectionState === 'connected';
    state.peerConnected = connected;
    setCheck('#check-network', connected, connected ? 'Direct' : 'Checking'); updateReady();
    if (connected) { startPing(); $('#connection-overlay').classList.add('hidden'); }
    if (['failed', 'disconnected'].includes(pc.connectionState)) connectionLost();
  };
  pc.ontrack = (event) => {
    const video = $('#guest-video'); video.srcObject = event.streams[0]; video.classList.remove('hidden');
    $('#game-placeholder').classList.add('hidden');
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
      if (msg.type === 'start' && state.role === 'guest') beginGuestPlay();
    };
  } else if (channel.label === 'input') {
    state.input = channel;
    channel.onmessage = (event) => applyRemoteInput(JSON.parse(event.data));
  }
  channel.onopen = () => { state.peerConnected = true; setCheck('#check-network', true, 'Direct'); updateReady(); };
}

function startControllerProbe() {
  const poll = () => {
    if (!state.roomId) return;
    const pad = navigator.getGamepads?.()[0];
    if (pad && !state.controllerReady) {
      state.controllerReady = true; setCheck('#check-controller', true, pad.id.slice(0, 18)); updateReady();
    }
    if (state.role === 'guest' && state.input?.readyState === 'open' && pad) sendGamepad(pad);
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  window.addEventListener('keydown', () => {
    if (!state.controllerReady) { state.controllerReady = true; setCheck('#check-controller', true, 'Keyboard'); updateReady(); }
  }, { once: true });
}

let lastInput = '';
function sendGamepad(pad) {
  const payload = { type: 'input', buttons: pad.buttons.map((b) => b.value), axes: pad.axes.map((v) => Math.round(v * 100) / 100) };
  const encoded = JSON.stringify(payload);
  if (encoded !== lastInput) { state.input.send(encoded); state.packetCount++; lastInput = encoded; $('#diag-packets').textContent = String(state.packetCount); }
}

function applyRemoteInput(message) {
  const manager = window.EJS_emulator?.gameManager;
  const simulate = manager?.functions?.simulateInput?.bind(manager.functions) || manager?.simulateInput?.bind(manager);
  if (!simulate || message.type !== 'input') return;
  message.buttons.forEach((value, index) => simulate(1, index, value));
  message.axes.forEach((value, index) => simulate(1, 16 + index, value));
}

function updateReady() {
  const button = $('#play-button');
  if (state.role === 'guest') {
    button.textContent = state.peerConnected ? 'Ready — waiting for host' : 'Connecting to host'; button.disabled = true;
    setCheck('#check-game', state.peerConnected, state.peerConnected ? 'Stream ready' : 'Host provides');
  } else {
    const ready = state.controllerReady && state.gameReady && state.peerConnected;
    button.disabled = !ready; button.textContent = ready ? 'Start Metal Slug 2 →' : !state.gameReady ? 'Choose both game files' : !state.peerConnected ? 'Waiting for your friend' : 'Connect a controller';
  }
}

async function handleFiles(files) {
  const entries = [...files]; const rom = entries.find((f) => f.name.toLowerCase() === 'mslug2.zip'); const bios = entries.find((f) => f.name.toLowerCase() === 'neogeo.zip');
  if (!rom || !bios) { toast('Choose both mslug2.zip and neogeo.zip'); return; }
  state.romUrl = URL.createObjectURL(rom); state.biosUrl = URL.createObjectURL(bios); state.gameReady = true;
  setCheck('#check-game', true, 'Verified locally'); $('#file-picker p').textContent = 'Metal Slug 2 and Neo Geo BIOS ready — files remain local.'; updateReady();
}

async function startGame() {
  if (state.role !== 'host' || !state.gameReady || !state.peerConnected) return;
  show('loading');
  setTimeout(() => $('#stage-connect').classList.add('done'), 450);
  setTimeout(() => $('#stage-connect').textContent = '✓ Connected directly', 450);
  setTimeout(() => { $('#stage-sync').classList.add('done'); $('#stage-sync').textContent = '✓ Syncing players'; }, 850);
  await loadEmulator();
  $('#stage-ready').classList.add('done'); $('#stage-ready').textContent = '✓ Ready';
  setTimeout(async () => { show('game'); await maybeAttachStream(true); state.control?.send(JSON.stringify({ type: 'start' })); }, 450);
}

function loadEmulator() {
  return new Promise((resolve, reject) => {
    window.EJS_player = '#emulator-player'; window.EJS_gameName = 'Metal Slug 2'; window.EJS_gameUrl = state.romUrl;
    window.EJS_biosUrl = state.biosUrl; window.EJS_core = 'fbneo'; window.EJS_pathtodata = '/emulatorjs/data/';
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
  const stream = window.EJS_emulator?.collectScreenRecordingMediaTracks?.(canvas, 60) || canvas.captureStream(60);
  stream.getTracks().forEach((track) => state.pc.addTrack(track, stream)); state.streamStarted = true;
  if (renegotiate) { await state.pc.setLocalDescription(await state.pc.createOffer()); signal({ type: 'rtc.offer', description: state.pc.localDescription }); }
}

function beginGuestPlay() { show('game'); $('#game-placeholder').classList.remove('hidden'); }
function connectionLost() { state.peerConnected = false; if (!$('#game').classList.contains('hidden')) $('#connection-overlay').classList.remove('hidden'); }

function startPing() {
  if (startPing.timer) return;
  startPing.timer = setInterval(() => {
    if (state.control?.readyState !== 'open') return;
    const seq = ++state.pingSeq; state.pings.set(seq, performance.now()); state.control.send(JSON.stringify({ type: 'ping', seq }));
  }, 1000);
}
function recordPong(seq) {
  const started = state.pings.get(seq); if (!started) return; state.pings.delete(seq);
  const rtt = performance.now() - started; const previous = state.rtts.at(-1) ?? rtt; state.jitter += (Math.abs(rtt - previous) - state.jitter) / 16;
  state.rtts.push(rtt); if (state.rtts.length > 30) state.rtts.shift();
  const median = [...state.rtts].sort((a, b) => a - b)[Math.floor(state.rtts.length / 2)];
  $('#quality-pill').textContent = `${Math.round(median)} ms · ${median < 45 ? 'Excellent' : median < 80 ? 'Good' : 'Fair'}`;
  $('#diag-rtt').textContent = `${Math.round(median)} ms`; $('#diag-jitter').textContent = `${state.jitter.toFixed(1)} ms`;
}

function copyInvite() {
  const url = `${location.origin}/join/${state.roomId}#${state.inviteSecret}`;
  navigator.clipboard.writeText(url).then(() => toast('Invite copied — send it to your friend.'));
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  if (action === 'open-host') show('setup');
  if (action === 'open-join') { $('#code-field').classList.remove('hidden'); show('join'); }
  if (action === 'home' || action === 'leave') location.assign('/');
  if (action === 'create-room') createRoom();
  if (action === 'join-room') joinRoom();
  if (action === 'copy-invite') copyInvite();
  if (action === 'start-game') startGame().catch((error) => { toast(error.message); show('room'); });
  if (action === 'fullscreen') $('#game').requestFullscreen?.();
  if (action === 'game-menu') $('#diagnostics').classList.toggle('hidden');
});
$('#quality-pill').addEventListener('click', () => $('#diagnostics').classList.toggle('hidden'));
$('#game-files').addEventListener('change', (event) => handleFiles(event.target.files));

const remembered = localStorage.getItem('quarterlink.name') || '';
$('#host-name').value = remembered; $('#guest-name').value = remembered;
const invite = parseInvite();
if (invite) { state.roomId = invite.roomId; $('#join-title').textContent = 'Your friend saved you a seat.'; show('join'); }
else if (location.pathname.startsWith('/room/')) {
  state.roomId = location.pathname.split('/')[2]; enterRoom().catch(() => { history.replaceState({}, '', '/'); show('landing'); toast('That room is no longer available.'); });
}
