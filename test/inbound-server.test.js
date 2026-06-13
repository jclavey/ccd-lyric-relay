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
