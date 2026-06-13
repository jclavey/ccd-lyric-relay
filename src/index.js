/**
 * index.js
 *
 * Simple Express web server that serves the lyrics display page.
 * The page itself connects directly to the lyrics WebSocket server
 * from the browser — this server's only job is to deliver the HTML/JS.
 *
 * The WebSocket host/port are injected into the HTML at serve time so
 * the browser knows where to connect without needing any build step.
 */

require('dotenv').config();
const { EventEmitter } = require('events');
const { startInboundServer } = require('./inbound-server');
const { startLyricsServer } = require('./lyrics-server');

const EVENT_SOURCE_PORT = parseInt(process.env.EVENT_SOURCE_PORT || '3000', 10);
const DISPLAY_SERVER_PORT = parseInt(process.env.DISPLAY_SERVER_PORT || '8080', 10);
const INBOUND_API_TOKEN = process.env.INBOUND_API_TOKEN || process.env.API_TOKEN;

// --- Shared event bus ---
const emitter = new EventEmitter();

startInboundServer(emitter, { port: EVENT_SOURCE_PORT, apiToken: INBOUND_API_TOKEN });
startLyricsServer(emitter, { port: DISPLAY_SERVER_PORT });