/**
 * index.js
 *
 * Starts the two halves of the relay, joined by a shared EventEmitter:
 *
 *   ccd-propresenter-bridge ──ws──▶ inbound-server (EVENT_SOURCE_PORT)
 *                                        │ 'event'
 *                                        ▼
 *                 browsers ◀──ws── display-server (DISPLAY_SERVER_PORT)
 */

require('dotenv').config({ quiet: true });
const { EventEmitter } = require('events');
const { startInboundServer } = require('./inbound-server');
const { startDisplayServer } = require('./display-server');

const EVENT_SOURCE_PORT = parseInt(process.env.EVENT_SOURCE_PORT || '3000', 10);
const DISPLAY_SERVER_PORT = parseInt(process.env.DISPLAY_SERVER_PORT || '8080', 10);
const INBOUND_API_TOKEN = process.env.INBOUND_API_TOKEN || process.env.API_TOKEN;

// --- Shared event bus ---
const emitter = new EventEmitter();

startInboundServer(emitter, { port: EVENT_SOURCE_PORT, apiToken: INBOUND_API_TOKEN });
startDisplayServer(emitter, { port: DISPLAY_SERVER_PORT });
