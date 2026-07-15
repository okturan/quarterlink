import assert from 'node:assert/strict';

const base = process.env.QUARTERLINK_URL || 'https://quarterlink.okan.workers.dev';
const wsBase = base.replace(/^http/, 'ws');

for (const route of ['/', '/join/smoke', '/room/smoke']) {
  const response = await fetch(`${base}${route}?smoke=${Date.now()}`, { headers: { accept: 'text/html,application/xhtml+xml' }, redirect: 'manual' });
  assert.equal(response.status, 200, `${route} returned ${response.status} ${response.headers.get('location') || ''}`);
  assert.equal(response.headers.get('location'), null, `${route} redirected`);
  assert.match(await response.text(), /<script src="\/quarterlink\.js" type="module"><\/script>/);
}

const create = await fetch(`${base}/api/rooms`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Production smoke host' }),
});
assert.equal(create.status, 201);
const hostCookie = create.headers.getSetCookie()[0].split(';')[0];
const { roomId, inviteSecret } = await create.json();

const ice = await fetch(`${base}/api/rooms/${roomId}/ice`, {
  method: 'POST', headers: { cookie: hostCookie, 'content-type': 'application/json' }, body: '{}',
});
assert.equal(ice.status, 200);
const iceBody = await ice.json();
assert.ok(Array.isArray(iceBody.iceServers));

function openSocket(cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/api/rooms/${roomId}/ws`, { headers: { Cookie: cookie, Origin: base } });
    const inbox = [];
    const waiters = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const index = waiters.findIndex(({ predicate }) => predicate(message));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
      else inbox.push(message);
    };
    socket.onerror = () => reject(new Error('WebSocket failed'));
    socket.onopen = () => resolve({
      socket,
      next(predicate, timeout = 8000) {
        const found = inbox.findIndex(predicate);
        if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);
        return new Promise((resolveMessage, rejectMessage) => {
          const waiter = { predicate, resolve: resolveMessage };
          waiters.push(waiter);
          setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            rejectMessage(new Error('Timed out waiting for WebSocket message'));
          }, timeout);
        });
      },
    });
  });
}

const host = await openSocket(hostCookie);
assert.equal((await host.next((message) => message.type === 'room.snapshot')).role, 'host');

const redeem = await fetch(`${base}/api/rooms/${roomId}/redeem`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Production smoke guest', secret: inviteSecret }),
});
assert.equal(redeem.status, 200);
const guestCookie = redeem.headers.getSetCookie()[0].split(';')[0];

// Deliberately connect after redemption. This reproduces the race where an
// eager initial offer could previously be broadcast before the guest existed.
await new Promise((resolve) => setTimeout(resolve, 1200));
const guest = await openSocket(guestCookie);
assert.equal((await guest.next((message) => message.type === 'room.snapshot')).role, 'guest');
await host.next((message) => message.type === 'peer.connected' && message.role === 'guest');

host.socket.send(JSON.stringify({ type: 'rtc.offer', description: { type: 'offer', sdp: 'smoke-offer' } }));
assert.equal((await guest.next((message) => message.type === 'rtc.offer')).description.sdp, 'smoke-offer');
guest.socket.send(JSON.stringify({ type: 'rtc.answer', description: { type: 'answer', sdp: 'smoke-answer' } }));
assert.equal((await host.next((message) => message.type === 'rtc.answer')).description.sdp, 'smoke-answer');

const oldHostClosed = new Promise((resolve) => { host.socket.onclose = (event) => resolve(event.code); });
const replacementHost = await openSocket(hostCookie);
assert.equal((await replacementHost.next((message) => message.type === 'room.snapshot')).role, 'host');
assert.equal(await oldHostClosed, 4001);

replacementHost.socket.close();
guest.socket.close();
console.log(JSON.stringify({ ok: true, base, navigation: 3, room: roomId, relayAvailable: iceBody.relayAvailable, signaling: 'bidirectional', socketReplacement: 'passed' }));
