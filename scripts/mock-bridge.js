#!/usr/bin/env node
/**
 * mock-bridge.js
 *
 * Stands in for ccd-propresenter-bridge so the relay can be tested without
 * running ProPresenter. Connects to the relay's inbound port and pages through
 * sample slides, sending the v2 `state` payload each time.
 *
 *   node scripts/mock-bridge.js [song|scripture|both] [--interval 1000]
 *        [--url ws://localhost:3000] [--token xxx] [--once]
 *
 * Defaults: mode `both`, 1s interval, URL/token from .env (EVENT_SOURCE_PORT,
 * INBOUND_API_TOKEN). Loops forever unless --once is given. Ctrl+C closes with
 * "broadcast disabled", like the real bridge, so the relay clears immediately.
 */

require('dotenv').config({ quiet: true });
const WebSocket = require('ws');
const { SONG, SCRIPTURE } = require('./mock-bridge-data');

const HEARTBEAT_MS = 15000;
const MODES = { song: [SONG], scripture: [SCRIPTURE], both: [SONG, SCRIPTURE] };

function parseArgs(argv) {
  const opts = { mode: 'both', once: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') opts.once = true;
    else if (arg === '--interval') opts.interval = parseInt(argv[++i], 10);
    else if (arg === '--url') opts.url = argv[++i];
    else if (arg === '--token') opts.token = argv[++i];
    else if (MODES[arg]) opts.mode = arg;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const interval = opts.interval > 0 ? opts.interval : 1000;
const url = opts.url || `ws://localhost:${process.env.EVENT_SOURCE_PORT || 3000}`;
const token = opts.token || process.env.INBOUND_API_TOKEN || process.env.API_TOKEN;

// Flatten the chosen sets into one ordered list of states.
const steps = MODES[opts.mode].flatMap((set) =>
  set.slides.map((lines) => ({ look: set.look, presentation: set.presentation, lines })),
);

let index = 0;
let current = steps[0];

function payload() {
  return {
    type: 'state',
    version: 2,
    timestamp: Date.now(),
    look: current.look,
    presentation: current.presentation,
    slide: { lines: current.lines },
    audienceScreensEnabled: true,
    proPresenterConnected: true,
  };
}

console.log(`[Mock] Connecting to ${url} (mode=${opts.mode}, every ${interval}ms)`);
const ws = new WebSocket(url, token ? { headers: { 'x-api-token': token } } : undefined);
let slideTimer;
let heartbeatTimer;

function send() {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload()));
}

function showStep() {
  current = steps[index];
  console.log(`[Mock] ${index + 1}/${steps.length} ${current.look}: ${current.lines.join(' / ').slice(0, 70)}`);
  send();
}

function shutdown() {
  clearInterval(slideTimer);
  clearInterval(heartbeatTimer);
  if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'broadcast disabled');
  else process.exit(0);
}

ws.on('open', () => {
  console.log('[Mock] Connected');
  showStep();
  heartbeatTimer = setInterval(send, HEARTBEAT_MS);
  slideTimer = setInterval(() => {
    index++;
    if (index >= steps.length) {
      if (opts.once) return shutdown();
      index = 0;
    }
    showStep();
  }, interval);
});

ws.on('unexpected-response', (_req, res) => {
  console.error(`[Mock] Rejected by relay: HTTP ${res.statusCode} (check the token)`);
  process.exit(1);
});
ws.on('error', (err) => console.error('[Mock] Socket error:', err.message));
ws.on('close', (code, reason) => {
  console.log(`[Mock] Closed (${code}${reason.length ? `: ${reason}` : ''})`);
  process.exit(0);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
