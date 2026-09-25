const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { startInboundServer } = require('../src/inbound-server');

function getServerPort(server) {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : address;
}

test('rejects inbound websocket connections without a valid api token', async (t) => {
  const emitter = new EventEmitter();
  const { server } = startInboundServer(emitter, { port: 0, apiToken: 'secret-token' });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  await new Promise((resolve) => server.once('listening', resolve));

  const port = getServerPort(server);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);

  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('unexpected-response', resolve);
    socket.once('close', resolve);
  });

  assert.notEqual(socket.readyState, WebSocket.OPEN);
});

test('accepts inbound websocket connections with a valid api token', async (t) => {
  const emitter = new EventEmitter();
  const { server } = startInboundServer(emitter, { port: 0, apiToken: 'secret-token' });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  await new Promise((resolve) => server.once('listening', resolve));

  const port = getServerPort(server);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=secret-token`);

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  socket.close();
  await new Promise((resolve) => socket.once('close', resolve));
});

async function connectBridge(server) {
  const socket = new WebSocket(`ws://127.0.0.1:${getServerPort(server)}/`, {
    headers: { 'x-api-token': 'secret-token' },
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function startWithEvents(t, config) {
  const emitter = new EventEmitter();
  const events = [];
  emitter.on('event', (event) => events.push(event));

  const { server } = startInboundServer(emitter, { port: 0, apiToken: 'secret-token', ...config });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  return { server, events };
}

const cleared = (events) => events.filter((event) => event.type === 'inbound_event' && event.payload === null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('keeps state through an unexpected drop until the grace period ends', async (t) => {
  const { server, events } = await startWithEvents(t, { stateGraceMs: 150 });

  const bridge = await connectBridge(server);
  bridge.terminate();

  await sleep(75);
  assert.equal(cleared(events).length, 0, 'should not clear during the grace period');

  await sleep(150);
  assert.equal(cleared(events).length, 1, 'should clear once the grace period ends');
});

test('does not clear state when the bridge reconnects within the grace period', async (t) => {
  const { server, events } = await startWithEvents(t, { stateGraceMs: 150 });

  (await connectBridge(server)).terminate();
  await sleep(50);
  const reconnected = await connectBridge(server);

  await sleep(200);
  assert.equal(cleared(events).length, 0);
  reconnected.close();
});

test('clears state immediately when broadcasting is deliberately disabled', async (t) => {
  const { server, events } = await startWithEvents(t, { stateGraceMs: 60000 });

  const bridge = await connectBridge(server);
  bridge.close(1000, 'broadcast disabled');

  await sleep(100);
  assert.equal(cleared(events).length, 1);
});

test('forwards bridge messages as inbound events', async (t) => {
  const { server, events } = await startWithEvents(t, {});

  const bridge = await connectBridge(server);
  bridge.send(JSON.stringify({ type: 'state', version: 2, look: 'Song' }));

  await sleep(100);
  assert.deepEqual(
    events.filter((event) => event.type === 'inbound_event').map((event) => event.payload),
    [{ type: 'state', version: 2, look: 'Song' }],
  );
  bridge.close();
});

test('drops a bridge connection that stops answering pings', async (t) => {
  const { server, events } = await startWithEvents(t, { pingIntervalMs: 50, stateGraceMs: 60000 });

  // A client that never answers pings, like one whose network has gone away.
  const socket = new WebSocket(`ws://127.0.0.1:${getServerPort(server)}/`, {
    headers: { 'x-api-token': 'secret-token' },
    autoPong: false,
  });
  await new Promise((resolve) => socket.once('open', resolve));

  await sleep(200);
  const statuses = events.filter((event) => event.type === 'inbound_connection_status').map((event) => event.status);
  assert.deepEqual(statuses, ['connected', 'disconnected']);
  socket.terminate();
});
