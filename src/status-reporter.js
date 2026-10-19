/**
 * status-reporter.js
 *
 * Reports how many people are viewing the lyrics to the ccd-bridge-status
 * dashboard (`POST <url>/ingest/users`, `Authorization: Bearer <token>`).
 *
 * Most of the time nobody is connected, so this sends as little as possible:
 *
 *  - once when it starts (`reason: start`, count 0), so the dashboard knows
 *    any earlier count ended with the previous run;
 *  - when the count differs from the last one sent (`change`), checked every
 *    `intervalMs`, so a visit shorter than one interval can be missed;
 *  - while the count is above 0, the same count again every `keepaliveMs`
 *    (`keepalive`), so the dashboard can tell "still 5" from "the relay died
 *    with 5". Nothing is sent while the count stays at 0.
 *
 * It is fire-and-forget and never touches lyric delivery: it holds only the
 * latest count (a failed send is not queued, the next tick sends whatever the
 * count is then), requests never overlap, and failures are logged once when
 * they start and once when they clear.
 */

const WebSocket = require('ws');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_KEEPALIVE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The ingest endpoint for a base URL. A URL pasted without a scheme (as
 * Railway shows domains) is taken to be https, since `fetch` cannot parse it.
 * @param {string} url
 */
function ingestEndpoint(url) {
  const trimmed = url.trim().replace(/\/+$/, '');
  const base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `${base}/ingest/users`;
}

/**
 * @param {import('ws').Server} wss
 * @returns {number} browsers with an open connection
 */
function countOpenClients(wss) {
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) count++;
  }
  return count;
}

/**
 * @param {object} options
 * @param {string} options.url                 Status app base URL
 * @param {string} options.token               Bearer token (the status app's INBOUND_API_TOKEN)
 * @param {() => number} options.getCount      Current number of viewers
 * @param {number} [options.intervalMs]        How often the count is checked
 * @param {number} [options.keepaliveMs]       Re-send an unchanged non-zero count this often
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {Pick<Console, 'log' | 'warn'>} [options.log]
 */
function startStatusReporter({
  url,
  token,
  getCount,
  intervalMs = DEFAULT_INTERVAL_MS,
  keepaliveMs = DEFAULT_KEEPALIVE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  now = Date.now,
  log = console,
}) {
  if (!url) throw new Error('A status app URL is required');
  if (!token) throw new Error('A status app token is required');

  const endpoint = ingestEndpoint(url);
  let lastSent = null; // { count, at } of the last send that succeeded
  let needsStart = true;
  let sending = false;
  let failing = false;
  let closed = false;

  async function send(count, reason) {
    sending = true;
    const at = now();
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ at, count, reason }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      lastSent = { count, at };
      if (reason === 'start') needsStart = false;
      if (failing) {
        failing = false;
        log.log('[Status] Dashboard is accepting viewer counts again');
      }
    } catch (err) {
      // Not queued: forget what was sent, so the next tick sends the count as it is then.
      lastSent = null;
      if (!failing) {
        failing = true;
        log.warn(`[Status] Could not report the viewer count (${err.message}); will keep trying`);
      }
    } finally {
      sending = false;
    }
  }

  /** Sends if there is something to say. Never rejects. */
  async function tick() {
    if (closed || sending) return;

    const count = getCount();
    let reason = null;
    if (needsStart) reason = 'start';
    else if (!lastSent || count !== lastSent.count) reason = 'change';
    else if (count > 0 && now() - lastSent.at >= keepaliveMs) reason = 'keepalive';

    if (reason) await send(count, reason);
  }

  const timer = setInterval(() => {
    tick().catch((err) => log.warn(`[Status] Unexpected error: ${err.message}`));
  }, intervalMs);
  timer.unref();

  log.log(`[Status] Reporting viewer counts to ${endpoint} every ${intervalMs / 1000}s`);
  const ready = tick(); // the start marker

  return {
    /** Resolves when the start marker has been attempted. */
    ready,
    tick,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startStatusReporter, countOpenClients, ingestEndpoint, DEFAULT_INTERVAL_MS, DEFAULT_KEEPALIVE_MS };
