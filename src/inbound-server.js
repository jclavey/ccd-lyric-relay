const express = require('express');
const WebSocket = require('ws');
const http = require('http');

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
  }

  // Accept client connections
  wss.on('connection', (clientWs) => {
    console.log('[Inbound] Client connected');

    replaceActiveInboundSocket(clientWs);

    clientWs.on('message', (data) => {
      if (activeInboundSocket !== clientWs) {
        return;
      }

      emitter.emit('event', data);
    });

    clientWs.on('close', () => {
      detachInboundSocket(clientWs);
      console.log('[Inbound] Client disconnected');
    });

    clientWs.on('error', (error) => {
      console.error('[Inbound] Client socket error', error);
      detachInboundSocket(clientWs);
    });
  });

  server.listen(config.port, () => {
    console.log(`[Inbound] Event source listening on port ${config.port}`);
  });
}

module.exports = { startInboundServer };