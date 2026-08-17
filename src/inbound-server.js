const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { MSG } = require('./lyrics-server');

function startInboundServer(emitter, config) {
  const app = express();
  const server = http.createServer(app);
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

  let activeInboundSocket = null;

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

    clientWs.on('close', () => {
      if (activeInboundSocket == clientWs) {
        emitter.emit('event', { type: MSG.INBOUND_CONNECTION_STATUS, status: 'disconnected' });
      }
      detachInboundSocket(clientWs);
      console.log('[Inbound] Client disconnected');
    });

    clientWs.on('error', (error) => {
      console.error('[Inbound] Client socket error', error);
      if (activeInboundSocket == clientWs) {
        emitter.emit('event', { type: MSG.INBOUND_CONNECTION_STATUS, status: 'disconnected' });
      }
      detachInboundSocket(clientWs);
    });
  });

  server.listen(config.port, () => {
    console.log(`[Inbound] Event source listening on port ${config.port}`);
  });

  return { server, wss };
}

module.exports = { startInboundServer };