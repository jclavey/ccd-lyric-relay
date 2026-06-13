const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const MSG = {
  HELLO: 'hello',
  LYRICS: 'lyrics',
  CLEAR: 'clear',
  PRESENTATION: 'presentation',
  AUDIENCE_SCREENS: 'audience_screens',
  CONNECTION_STATUS: 'connection_status',
  INBOUND_CONNECTION_STATUS: 'inbound_connection_status',
  LOOK: 'look'
};

const state = {
  [MSG.CONNECTION_STATUS]: { type: MSG.CONNECTION_STATUS, status: 'disconnected' },
  [MSG.INBOUND_CONNECTION_STATUS]: { type: MSG.INBOUND_CONNECTION_STATUS, status: 'disconnected' },
};

function startLyricsServer(emitter, config) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Serve the lyrics display page, injecting the WebSocket connection details
  app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // Serve any other static assets (fonts, icons, etc.) if needed in future
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Accept client connections
  wss.on('connection', (clientWs) => {
    console.log('[Lyrics] Client connected');
    sendInitialState(clientWs);
  });

  server.listen(config.port, () => {
    console.log(`[Lyrics] Serving lyrics on port ${config.port}`);
  });

  emitter.on('event', (event) => {
    broadcast(wss, event);
  });
}

function sendInitialState(client) {
  Object.keys(state).forEach((key) => {
    safeSend(client, state[key]);
  });
}

function broadcast(wss, payload) {
  const json = JSON.stringify(payload);
  let sent = 0;

  const key = payload.type || 'unknown';
  state[key] = payload;

  for (const client of wss.clients) {
    if (safeSend(client, payload)) {
      sent++;
    }
  }

  console.log(`[Lyrics] Broadcast to ${sent} client(s):`, payload);
}

function safeSend(ws, payload) {
  let success = false;

  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
      success = true;
    } catch (err) {
      console.error('[Lyrics] safeSend error:', err.message);
    }
  }

  return success;
}

module.exports = { startLyricsServer, MSG };