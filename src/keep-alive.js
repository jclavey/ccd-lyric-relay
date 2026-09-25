/**
 * keep-alive.js
 *
 * Pings every client of a WebSocket server on an interval and terminates any
 * that didn't answer the previous ping, so connections that died without a
 * clean close (network drop, phone sleeping) don't linger. Terminating fires
 * the socket's normal 'close' event with code 1006.
 */

/**
 * @param {import('ws').Server} wss
 * @param {number} intervalMs
 */
function keepAlive(wss, intervalMs) {
  if (!intervalMs || intervalMs <= 0) return;

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, intervalMs);
  timer.unref();

  wss.on('close', () => clearInterval(timer));
}

module.exports = { keepAlive };
