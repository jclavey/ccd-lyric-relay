const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { MSG } = require('./lyrics-server');

function startInboundServer(emitter, config) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

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
        emitter.emit('event', json);
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
}

module.exports = { startInboundServer };