const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { startDisplayServer, MSG } = require('../src/display-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(t) {
  const emitter = new EventEmitter();
  const { server, wss } = startDisplayServer(emitter, { port: 0 });
  t.after(() => new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    server.close(resolve);
  }));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `ws://127.0.0.1:${server.address().port}`;

  // Opens a browser and collects everything it receives.
  async function browser() {
    const messages = [];
    const socket = new WebSocket(url);
    socket.on('message', (data) => messages.push(JSON.parse(data)));
    await new Promise((resolve) => socket.once('open', resolve));
    await sleep(50);
    return messages;
  }

  return { emitter, browser };
}

const thumb = (timestamp, index = 0) => ({ type: MSG.THUMBNAIL, timestamp, index, mime: 'image/jpeg', data: 'AAAA' });
const state = { type: MSG.INBOUND_EVENT, payload: { type: 'state', version: 2, look: 'Presentation' } };
const types = (messages) => messages.map((m) => m.type);

test('replays the cached thumbnail, after the state, to a new browser', async (t) => {
  const { emitter, browser } = await start(t);
  emitter.emit('event', thumb(10));
  emitter.emit('event', state); // a heartbeat must not evict the image

  const messages = await browser();
  assert.deepEqual(types(messages), ['inbound_event', 'inbound_connection_status', 'thumbnail']);
  assert.equal(messages.find((m) => m.type === 'thumbnail').timestamp, 10);
});

test('broadcasts thumbnails to connected browsers', async (t) => {
  const { emitter, browser } = await start(t);
  const messages = await browser();
  emitter.emit('event', thumb(10));
  await sleep(50);
  assert.equal(messages.filter((m) => m.type === 'thumbnail').length, 1);
});

test('thumbnail_clear removes the cached thumbnail and is not itself replayed', async (t) => {
  const { emitter, browser } = await start(t);
  emitter.emit('event', thumb(10));
  emitter.emit('event', { type: MSG.THUMBNAIL_CLEAR, timestamp: 11 });

  assert.ok(!types(await browser()).some((type) => type.startsWith('thumbnail')));
});

test('ignores a thumbnail older than the newest one seen', async (t) => {
  const { emitter, browser } = await start(t);
  emitter.emit('event', thumb(20, 5));
  emitter.emit('event', thumb(10, 6));

  const cached = (await browser()).find((m) => m.type === 'thumbnail');
  assert.equal(cached.index, 5);
});

test('ignores a thumbnail that arrives after a newer clear', async (t) => {
  const { emitter, browser } = await start(t);
  emitter.emit('event', { type: MSG.THUMBNAIL_CLEAR, timestamp: 20 });
  emitter.emit('event', thumb(10));

  assert.ok(!types(await browser()).includes('thumbnail'));
});

test('a clear without a timestamp resets the ordering', async (t) => {
  const { emitter, browser } = await start(t);
  emitter.emit('event', thumb(1000));
  emitter.emit('event', { type: MSG.THUMBNAIL_CLEAR });
  emitter.emit('event', thumb(5)); // bridge restarted with a different clock

  assert.ok(types(await browser()).includes('thumbnail'));
});
