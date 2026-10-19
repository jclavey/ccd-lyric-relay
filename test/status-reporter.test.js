const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { startStatusReporter, countOpenClients } = require('../src/status-reporter');
const { startDisplayServer } = require('../src/display-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN = 60 * 1000;

/**
 * A reporter with a fake dashboard, a count the test controls and a clock the
 * test moves. `ticks` are driven by hand; the real timer is set far in the
 * future so it never fires.
 */
function setup(t, overrides = {}, initial = {}) {
  const state = { count: 0, time: 1_000_000, requests: [], respond: () => ({ ok: true, status: 200 }), logs: [], ...initial };
  const log = {
    log: (message) => state.logs.push(['log', message]),
    warn: (message) => state.logs.push(['warn', message]),
  };
  const reporter = startStatusReporter({
    url: 'https://status.example.com/',
    token: 'secret',
    getCount: () => state.count,
    intervalMs: 2 ** 30,
    keepaliveMs: 10 * MIN,
    now: () => state.time,
    log,
    fetchImpl: async (url, options) => {
      state.requests.push({ url, options, body: JSON.parse(options.body) });
      const result = state.respond();
      if (result instanceof Error) throw result;
      return result;
    },
    ...overrides,
  });
  t.after(() => reporter.close());
  const bodies = () => state.requests.map((r) => r.body);
  return { state, reporter, bodies };
}

test('sends a start marker with a zero count when it starts, to /ingest/users with the bearer token', async (t) => {
  const { state, reporter, bodies } = setup(t);
  await reporter.ready;

  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].url, 'https://status.example.com/ingest/users', 'a trailing slash is not doubled');
  assert.equal(state.requests[0].options.method, 'POST');
  assert.equal(state.requests[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(state.requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(bodies(), [{ at: 1_000_000, count: 0, reason: 'start' }]);
  assert.ok(state.requests[0].options.signal, 'requests have a timeout');
});

test('sends nothing while the count stays at zero, however long that lasts', async (t) => {
  const { state, reporter } = setup(t);
  await reporter.ready;
  for (let i = 0; i < 200; i++) {
    state.time += MIN;
    await reporter.tick();
  }
  assert.equal(state.requests.length, 1, 'only the start marker');
});

test('sends a change once, and not again while the count is unchanged', async (t) => {
  const { state, reporter, bodies } = setup(t);
  await reporter.ready;

  state.count = 3;
  state.time += MIN;
  await reporter.tick();
  await reporter.tick();
  assert.deepEqual(bodies().slice(1), [{ at: state.time, count: 3, reason: 'change' }]);

  state.count = 5;
  state.time += MIN;
  await reporter.tick();
  assert.deepEqual(bodies().map((b) => b.count), [0, 3, 5]);
});

test('re-sends a non-zero count as a keepalive only after the keepalive time', async (t) => {
  const { state, reporter, bodies } = setup(t);
  await reporter.ready;
  state.count = 4;
  state.time += MIN;
  await reporter.tick(); // change

  state.time += 9 * MIN;
  await reporter.tick();
  assert.equal(state.requests.length, 2, 'not yet: 9 minutes since the change');

  state.time += MIN;
  await reporter.tick();
  assert.deepEqual(bodies()[2], { at: state.time, count: 4, reason: 'keepalive' });

  state.time += 10 * MIN;
  await reporter.tick();
  assert.equal(bodies()[3].reason, 'keepalive', 'and again every keepalive time');
});

test('goes quiet again once the count returns to zero', async (t) => {
  const { state, reporter, bodies } = setup(t);
  await reporter.ready;
  state.count = 2;
  state.time += MIN;
  await reporter.tick();
  state.count = 0;
  state.time += MIN;
  await reporter.tick();
  assert.deepEqual(bodies().map((b) => [b.count, b.reason]), [[0, 'start'], [2, 'change'], [0, 'change']]);

  for (let i = 0; i < 30; i++) {
    state.time += MIN;
    await reporter.tick();
  }
  assert.equal(state.requests.length, 3, 'no keepalives at zero');
});

test('a failed send is not queued: the next tick sends the count as it is then', async (t) => {
  const { state, reporter, bodies } = setup(t);
  await reporter.ready;

  state.respond = () => new Error('connect ECONNREFUSED');
  state.count = 3;
  state.time += MIN;
  await reporter.tick(); // fails
  state.count = 7; // the 3 is never reported
  state.time += MIN;
  await reporter.tick(); // fails again

  state.respond = () => ({ ok: true, status: 200 });
  state.count = 9;
  state.time += MIN;
  await reporter.tick();
  assert.deepEqual(bodies().slice(-1), [{ at: state.time, count: 9, reason: 'change' }]);

  state.time += MIN;
  await reporter.tick();
  assert.equal(state.requests.length, 4, 'and then quiet again');
});

test('an unchanged count is re-sent after a failure, because the dashboard may not have it', async (t) => {
  const { state, reporter } = setup(t);
  await reporter.ready;
  state.count = 2;
  state.time += MIN;
  await reporter.tick(); // change, ok

  state.respond = () => ({ ok: false, status: 502 });
  state.time += 10 * MIN;
  await reporter.tick(); // keepalive fails
  state.respond = () => ({ ok: true, status: 200 });
  state.time += MIN;
  await reporter.tick();
  assert.equal(state.requests.length, 4);
  assert.equal(state.requests[3].body.count, 2);
});

test('an HTTP error counts as a failure', async (t) => {
  const { state, reporter } = setup(t, { fetchImpl: async () => ({ ok: false, status: 401 }) });
  await reporter.ready;
  assert.match(state.logs[state.logs.length - 1][1], /HTTP 401/);
});

test('a failed start marker is retried as a start, with the count at that time', async (t) => {
  const { state, reporter, bodies } = setup(t, {}, { respond: () => new Error('down') });
  await reporter.ready;

  state.respond = () => ({ ok: true, status: 200 });
  state.count = 2;
  state.time += MIN;
  await reporter.tick();
  assert.deepEqual(bodies().map((b) => [b.count, b.reason]), [[0, 'start'], [2, 'start']]);

  state.time += MIN;
  await reporter.tick();
  assert.equal(state.requests.length, 2, 'then it carries on as normal');
});

test('logs when failures start and when they clear, not on every attempt', async (t) => {
  const { state, reporter } = setup(t);
  await reporter.ready;
  state.logs.length = 0;

  state.respond = () => new Error('boom');
  for (let i = 1; i <= 5; i++) {
    state.count = i;
    state.time += MIN;
    await reporter.tick();
  }
  assert.equal(state.logs.filter(([level]) => level === 'warn').length, 1);
  assert.match(state.logs[0][1], /boom/);

  state.respond = () => ({ ok: true, status: 200 });
  state.count = 9;
  state.time += MIN;
  await reporter.tick();
  assert.equal(state.logs.filter(([level]) => level === 'log').length, 1);
  assert.match(state.logs[state.logs.length - 1][1], /accepting viewer counts again/);
});

test('requests never overlap: a tick during a send does nothing', async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let calls = 0;
  const { state, reporter } = setup(t, {
    fetchImpl: async () => {
      calls++;
      await gate;
      return { ok: true, status: 200 };
    },
  });
  await sleep(10); // the start marker is in flight
  state.count = 5;
  await reporter.tick();
  await reporter.tick();
  assert.equal(calls, 1);

  release();
  await reporter.ready;
  await reporter.tick();
  assert.equal(calls, 2, 'the change goes out once the first request has finished');
});

test('a dashboard that never answers cannot stop later ticks once the timeout fires', async (t) => {
  // AbortSignal.timeout does not keep the process alive. In the relay the servers do; here this does.
  const keepAlive = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(keepAlive));
  const { state, reporter } = setup(t, {
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('The operation was aborted due to timeout')));
      }),
  });
  await reporter.ready; // resolves because the request timed out
  state.count = 1;
  await reporter.tick();
  assert.ok(state.logs.some(([level, message]) => level === 'warn' && /timeout/.test(message)));
});

test('close stops it', async (t) => {
  const { state, reporter } = setup(t);
  await reporter.ready;
  reporter.close();
  state.count = 3;
  state.time += MIN;
  await reporter.tick();
  assert.equal(state.requests.length, 1);
});

test('the timer drives it without anyone calling tick', async (t) => {
  const requests = [];
  let count = 0;
  const reporter = startStatusReporter({
    url: 'https://status.example.com',
    token: 't',
    getCount: () => count,
    intervalMs: 20,
    log: { log() {}, warn() {} },
    fetchImpl: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    },
  });
  t.after(() => reporter.close());
  await reporter.ready;
  count = 6;
  await sleep(120);
  assert.deepEqual(requests.map((r) => [r.count, r.reason]), [[0, 'start'], [6, 'change']]);
});

test('requires a URL and a token', () => {
  assert.throws(() => startStatusReporter({ token: 't', getCount: () => 0 }), /URL/);
  assert.throws(() => startStatusReporter({ url: 'https://x', getCount: () => 0 }), /token/);
});

test('counts the browsers connected to the display server, and only open ones', async (t) => {
  const emitter = new EventEmitter();
  const { server, wss } = startDisplayServer(emitter, { port: 0 });
  t.after(() => new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    server.close(resolve);
  }));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `ws://127.0.0.1:${server.address().port}`;
  const open = async () => {
    const socket = new WebSocket(url);
    await new Promise((resolve) => socket.once('open', resolve));
    return socket;
  };

  assert.equal(countOpenClients(wss), 0);
  const a = await open();
  const b = await open();
  await sleep(30);
  assert.equal(countOpenClients(wss), 2);

  a.close();
  await sleep(50);
  assert.equal(countOpenClients(wss), 1);
  b.terminate();
  await sleep(50);
  assert.equal(countOpenClients(wss), 0);

  // A reporter wired to it, as index.js does.
  const sent = [];
  const reporter = startStatusReporter({
    url: 'https://status.example.com',
    token: 't',
    getCount: () => countOpenClients(wss),
    intervalMs: 2 ** 30,
    log: { log() {}, warn() {} },
    fetchImpl: async (u, o) => (sent.push(JSON.parse(o.body)), { ok: true, status: 200 }),
  });
  t.after(() => reporter.close());
  await reporter.ready;
  const c = await open();
  await open();
  await sleep(30);
  await reporter.tick();
  assert.deepEqual(sent.map((s) => [s.count, s.reason]), [[0, 'start'], [2, 'change']]);
  c.terminate();
});
