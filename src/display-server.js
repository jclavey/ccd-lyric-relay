/**
 * display-server.js
 *
 * Serves the lyrics display page (public/) and a WebSocket that browsers
 * connect to. Every event from the inbound server is cached by type and
 * broadcast to all connected browsers; newly connected browsers receive the
 * cached events straight away so they don't wait for the next change.
 *
 * Thumbnails are cached separately from the state (state heartbeats must not
 * evict the image) and are ordered by their own `timestamp`, which is only
 * ever compared with other thumbnail timestamps. A `thumbnail_clear` removes
 * the cached image rather than being cached itself; one without a timestamp
 * (sent by the relay when state is cleared) also resets the ordering.
 */

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { keepAlive } = require('./keep-alive');

const MSG = {
  INBOUND_CONNECTION_STATUS: 'inbound_connection_status',
  INBOUND_EVENT: 'inbound_event',
  THUMBNAIL: 'thumbnail',
  THUMBNAIL_CLEAR: 'thumbnail_clear',
};

/**
 * @param {import('events').EventEmitter} emitter
 * @param {{ port: number, pingIntervalMs?: number }} config
 */
function startDisplayServer(emitter, config) {
  const state = {
    [MSG.INBOUND_EVENT]: { type: MSG.INBOUND_EVENT, payload: null },
    [MSG.INBOUND_CONNECTION_STATUS]: { type: MSG.INBOUND_CONNECTION_STATUS, status: 'disconnected' },
  };

  // Newest thumbnail/clear timestamp seen; anything older is stale.
  let thumbnailOrder = -Infinity;

  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });
  keepAlive(wss, config.pingIntervalMs ?? 30 * 1000);

  wss.on('connection', (clientWs) => {
    console.log(`[Display] Client connected (${wss.clients.size} total)`);
    for (const event of Object.values(state)) {
      safeSend(clientWs, event);
    }
  });

  function isStaleThumbnail(event) {
    return typeof event.timestamp === 'number' && event.timestamp < thumbnailOrder;
  }

  function handleThumbnailEvent(event) {
    if (isStaleThumbnail(event)) {
      console.log(`[Display] Ignored stale ${event.type}`);
      return;
    }
    thumbnailOrder = typeof event.timestamp === 'number' ? event.timestamp : -Infinity;

    if (event.type === MSG.THUMBNAIL) {
      state[MSG.THUMBNAIL] = event;
    } else {
      delete state[MSG.THUMBNAIL];
    }

    let sent = 0;
    for (const client of wss.clients) {
      if (safeSend(client, event)) sent++;
    }
    console.log(`[Display] ${describe(event)} → ${sent} client(s)`);
  }

  emitter.on('event', (event) => {
    if (event.type === MSG.THUMBNAIL || event.type === MSG.THUMBNAIL_CLEAR) {
      handleThumbnailEvent(event);
      return;
    }

    const changed = !sameIgnoringTimestamp(state[event.type], event);
    state[event.type] = event;

    let sent = 0;
    for (const client of wss.clients) {
      if (safeSend(client, event)) sent++;
    }

    // Heartbeats repeat the same state every few seconds; only log changes.
    if (changed) {
      console.log(`[Display] ${describe(event)} → ${sent} client(s)`);
    }
  });

  server.listen(config.port, () => {
    console.log(`[Display] Serving lyrics on port ${server.address().port}`);
  });

  return { server, wss };
}

function sameIgnoringTimestamp(a, b) {
  const strip = (event) => JSON.stringify(event, (key, value) => (key === 'timestamp' ? undefined : value));
  return a != null && strip(a) === strip(b);
}

function describe(event) {
  if (event.type === MSG.INBOUND_CONNECTION_STATUS) {
    return `Bridge ${event.status}`;
  }

  if (event.type === MSG.THUMBNAIL) {
    // base64 encodes 3 bytes in 4 characters
    const bytes = Math.floor((event.data?.length ?? 0) * 3 / 4);
    return `Thumbnail: index=${event.index ?? '?'}, ${event.mime ?? 'unknown type'}, ${bytes} bytes`;
  }
  if (event.type === MSG.THUMBNAIL_CLEAR) {
    return 'Thumbnail cleared';
  }

  const payload = event.payload;
  if (!payload) return 'State cleared';
  const lines = payload.slide?.lines?.length ?? 0;
  return `State: look=${payload.look ?? 'none'}, ${lines} line(s)`;
}

function safeSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return false;

  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('[Display] safeSend error:', err.message);
    return false;
  }
}

module.exports = { startDisplayServer, MSG };
