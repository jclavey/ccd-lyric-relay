/**
 * inbound-server.js
 *
 * Accepts the WebSocket connection from ccd-propresenter-bridge (token
 * required) and re-emits each JSON message as an 'event' for the display
 * server. Only one bridge connection is active at a time; a newer one
 * replaces the old.
 *
 * When the bridge disconnects, the last state is kept for `stateGraceMs` so a
 * brief network drop doesn't blank everyone's screen, then cleared. A bridge
 * that closes deliberately (broadcast turned off) clears it immediately.
 */

const WebSocket = require('ws');
const http = require('http');
const { MSG } = require('./display-server');
const { keepAlive } = require('./keep-alive');

// Close code/reason the bridge sends when broadcasting is turned off.
const BROADCAST_DISABLED = { code: 1000, reason: 'broadcast disabled' };

const DEFAULT_STATE_GRACE_MS = 60 * 1000;
const DEFAULT_PING_INTERVAL_MS = 30 * 1000;

/**
 * @param {import('events').EventEmitter} emitter
 * @param {{ port: number, apiToken?: string, stateGraceMs?: number, pingIntervalMs?: number }} config
 */
function startInboundServer(emitter, config) {
  const stateGraceMs = config.stateGraceMs ?? DEFAULT_STATE_GRACE_MS;

  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket connections only');
  });
  const apiToken = config.apiToken;
  const wss = new WebSocket.Server({
    server,
    verifyClient: (info, callback) => {
      const requestUrl = new URL(info.req.url || '/', 'http://localhost');
      const providedToken =
        requestUrl.searchParams.get('token') ||
        requestUrl.searchParams.get('apiToken') ||
        requestUrl.searchParams.get('api_token') ||
        info.req.headers['x-api-token'] ||
        info.req.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (!apiToken) {
        console.warn('[Inbound] No API token configured; rejecting inbound websocket connection');
        callback(false, 401, 'Unauthorized');
        return;
      }

      if (!providedToken || providedToken !== apiToken) {
        console.warn('[Inbound] Rejected inbound websocket connection without a valid API token');
        callback(false, 401, 'Unauthorized');
        return;
      }

      callback(true);
    },
  });

  keepAlive(wss, config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);

  let activeInboundSocket = null;
  let clearStateTimer = null;

  function clearState() {
    clearTimeout(clearStateTimer);
    clearStateTimer = null;
    emitter.emit('event', { type: MSG.INBOUND_EVENT, payload: null });
  }

  function detachInboundSocket(socket) {
    if (activeInboundSocket === socket) {
      activeInboundSocket = null;
    }
  }

  function replaceActiveInboundSocket(newSocket) {
    if (activeInboundSocket && activeInboundSocket !== newSocket) {
      if (activeInboundSocket.readyState === WebSocket.OPEN) {
        activeInboundSocket.close(1000, 'Replaced by a newer inbound connection');
      }
      detachInboundSocket(activeInboundSocket);
    }

    activeInboundSocket = newSocket;
    clearTimeout(clearStateTimer);
    clearStateTimer = null;
    emitter.emit('event', { type: MSG.INBOUND_CONNECTION_STATUS, status: 'connected' });
  }

  // Accept client connections
  wss.on('connection', (clientWs) => {
    console.log('[Inbound] Client connected');

    replaceActiveInboundSocket(clientWs);

    clientWs.on('message', (data) => {
      if (activeInboundSocket !== clientWs) {
        return;
      }

      try {
        const json = JSON.parse(data);
        emitter.emit('event', { type: MSG.INBOUND_EVENT, payload: json });
      } catch (err) {
        console.error('[Inbound] Failed to parse message as JSON:', err.message);
      }
    });

    clientWs.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer.toString();
      console.log(`[Inbound] Client disconnected (${code}${reason ? `: ${reason}` : ''})`);

      if (activeInboundSocket !== clientWs) return;
      detachInboundSocket(clientWs);
      emitter.emit('event', { type: MSG.INBOUND_CONNECTION_STATUS, status: 'disconnected' });

      if (code === BROADCAST_DISABLED.code && reason === BROADCAST_DISABLED.reason) {
        clearState();
      } else {
        clearTimeout(clearStateTimer);
        clearStateTimer = setTimeout(clearState, stateGraceMs).unref();
      }
    });

    // 'close' always follows 'error', so disconnection is handled there.
    clientWs.on('error', (error) => {
      console.error('[Inbound] Client socket error:', error.message);
    });
  });

  server.listen(config.port, () => {
    console.log(`[Inbound] Event source listening on port ${server.address().port}`);
  });

  wss.on('close', () => clearTimeout(clearStateTimer));

  return { server, wss };
}

module.exports = { startInboundServer, BROADCAST_DISABLED };