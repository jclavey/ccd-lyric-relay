# CCD Lyrics Relay

Receives the live ProPresenter state from
[`ccd-propresenter-bridge`](https://github.com/jclavey/ccd-propresenter-bridge)
and serves a lyrics display page that phones and browsers can open during a
service.

## Architecture

```
ccd-propresenter-bridge ──wss + token──▶ inbound-server  (EVENT_SOURCE_PORT, default 3000)
                                              │ 'event'
                                              ▼
            phones / browsers ◀──ws──── display-server   (DISPLAY_SERVER_PORT, default 8080)
                              ◀──http── public/index.html
```

- **`src/inbound-server.js`**: WebSocket server for the bridge. It requires the
  API token, allows only one bridge connection at a time (a newer one replaces
  the old), and re-emits each message as an event.
- **`src/display-server.js`**: serves `public/` and a WebSocket for browsers.
  It caches the latest event of each type, so a browser that connects
  mid-service gets the current slide immediately.
- **`src/keep-alive.js`**: pings both sets of sockets every 30s and drops any
  that stopped answering, so dead connections are noticed.
- **`src/status-reporter.js`**: optionally reports the number of viewers to the
  [`ccd-bridge-status`](../ccd-bridge-status) dashboard (see
  [Viewer count reporting](#viewer-count-reporting)).

### When the bridge goes away

| How the bridge disconnects | What viewers see |
|---|---|
| Broadcast turned off (bridge closes with `1000 "broadcast disabled"`) | Lyrics clear immediately and the waiting message is shown |
| Unexpected drop (network, restart) | The last slide stays for `STATE_GRACE_MS` (60s). If the bridge reconnects within that time, nothing changes; otherwise the display clears and shows the waiting message |

## Setup

```bash
npm install
cp .env.example .env   # set INBOUND_API_TOKEN
npm start              # or `npm run dev` to restart on file changes
```

Then open `http://localhost:8080`, and point a bridge at
`ws://localhost:3000` with the same token (`LYRIC_RELAY_SERVER` /
`LYRICS_RELAY_TOKEN` in the bridge's `.env`).

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `INBOUND_API_TOKEN` | *(required)* | Token the bridge must send. Without it, all bridge connections are rejected. `API_TOKEN` also works |
| `EVENT_SOURCE_PORT` | `3000` | Port for the bridge's WebSocket |
| `DISPLAY_SERVER_PORT` | `8080` | Port for the display page and browser WebSocket |
| `STATE_GRACE_MS` | `60000` | How long to keep showing the last slide after an unexpected bridge drop |
| `STATUS_URL` | *(off)* | Base URL of the status dashboard, e.g. `https://ccd-bridge-status.up.railway.app` (https is assumed if the scheme is left off). Viewer counts are reported only when this is set |
| `STATUS_TOKEN` | *(none)* | Bearer token for the dashboard (its `INBOUND_API_TOKEN`). Required with `STATUS_URL` |
| `USER_COUNT_INTERVAL_MS` | `60000` | How often the viewer count is checked |
| `USER_COUNT_KEEPALIVE_MS` | `600000` | While anyone is connected, re-send an unchanged count this often |

The bridge may send the token as an `x-api-token` header (what
`ccd-propresenter-bridge` does), an `Authorization: Bearer` header, or a
`?token=` query parameter.

## Viewer count reporting

When `STATUS_URL` and `STATUS_TOKEN` are set, the relay tells the status
dashboard how many browsers are connected to the display page
(`POST <STATUS_URL>/ingest/users`). Without them it does nothing and the relay
behaves exactly as before.

Most of the time nobody is watching, so it sends as little as possible:

- **On start**, a count of 0, so the dashboard knows any earlier count ended
  with the previous run.
- **When the count changes**, checked every `USER_COUNT_INTERVAL_MS`. Someone
  who connects and leaves within one interval is not counted. A browser that
  dropped without closing can take up to a minute to disappear from the count
  (see `keep-alive.js`).
- **While the count is above 0**, the same count again every
  `USER_COUNT_KEEPALIVE_MS`, so the dashboard can tell "still 5 viewers" from
  "the relay died with 5". Nothing is sent while the count stays at 0.

The dashboard shows a non-zero count with no update for
`USER_COUNT_STALE_SECONDS` (default 20 minutes) as unknown, so keep that at
twice `USER_COUNT_KEEPALIVE_MS`.

It never affects the lyrics. It sends one request at a time with a 5 second
timeout, keeps only the latest count (a failed send is not queued, the next
check sends the count as it is then), and logs once when the dashboard becomes
unreachable and once when it recovers.

## Deployment (Railway)

One Railway service with two public domains: one targets `EVENT_SOURCE_PORT`
(the bridge connects to it with `wss://`), the other targets
`DISPLAY_SERVER_PORT` (the URL you share with the congregation).

| Railway environment | Deploys branch |
|---|---|
| dev | `dev` |
| prd | `main` |

Work on `dev`, check it on the dev environment, then merge `dev` into `main`
to release. Set `INBOUND_API_TOKEN` in each environment's variables, and
`STATUS_URL` and `STATUS_TOKEN` to report viewer counts (use the dev dashboard
for the dev environment). Don't commit `.env`.

## The display page

- **Black background, white text.** Nothing else is visible during normal
  operation.
- **Songs** are sized to the largest font at which the longest line fits
  without wrapping.
- **Scripture** (look named `Scripture`): the first line is the reference, shown
  under a bar at the bottom. The remaining lines wrap and are sized to the largest
  font (min 20px) that fits above the bar.
- **Looks other than `Song` or `Scripture`** hide the lyrics.
- **Blanking**: lyrics fade out when ProPresenter's audience screens are
  disabled.
- **Waiting message**: "Lyrics will appear when the service starts" is shown
  whenever nothing is being broadcast.
- **Re-fits on resize** and on phone rotation. **Reconnects automatically** if
  the connection drops.
- **`?debug`** in the URL shows two status dots in the top-left: bridge→relay,
  then ProPresenter→bridge (green = connected).

### Messages sent to browsers

| `type` | Fields | Meaning |
|---|---|---|
| `inbound_event` | `payload`: the bridge's v2 `state` payload, or `null` | Current state; `null` means nothing is being broadcast |
| `thumbnail` | `timestamp`, `presentationUuid`, `index`, `mime`, `data` (base64) | Image of the current slide for non-lyric looks (e.g. `Presentation`); the page shows it full-screen |
| `thumbnail_clear` | `timestamp` (optional) | Hide the image |
| `inbound_connection_status` | `status`: `connected` / `disconnected` | Whether the bridge is connected to the relay |

Thumbnails are cached separately from the state, so heartbeats don't evict
them and a newly connected browser gets both. `timestamp` only orders
thumbnail messages against each other (older ones are dropped, so stepping
backwards through slides works). The relay sends a `thumbnail_clear` without a
timestamp when it clears state (broadcast off, or grace period expired), which
also resets the ordering.

The `state` payload format is documented in the
[bridge README](https://github.com/jclavey/ccd-propresenter-bridge#relay-payload-v2).

## Testing without ProPresenter (mock bridge)

`scripts/mock-bridge.js` stands in for `ccd-propresenter-bridge`, so you can
test the display without running ProPresenter or the bridge. It connects to the
relay's inbound port like the real bridge (token header, 15s heartbeat) and
pages through sample slides, sending the v2 `state` payload each time (plus fake advert thumbnails for the `presentation` look).

```bash
npm start                                  # terminal 1: the relay
npm run mock                               # terminal 2: alternate song and scripture
```

Then open `http://localhost:8080` (add `?debug` to see the status dots).

| Option | Default | Purpose |
|---|---|---|
| `song` / `scripture` / `both` / `presentation` / `all` | `both` | Which sample slides to send (`presentation` sends advert images; `all` mixes every look) |
| `--interval <ms>` | `1000` | Time between slides |
| `--url <ws url>` | `ws://localhost:$EVENT_SOURCE_PORT` | Relay to connect to, e.g. a dev deployment (`wss://...`) |
| `--token <token>` | `INBOUND_API_TOKEN` from `.env` | Token to send |
| `--once` | off | Stop after one pass instead of looping |

```bash
npm run mock -- song                       # song only
npm run mock -- scripture --interval 2000  # scripture, 2s per slide
```

Press Ctrl+C to stop. Like the real bridge, the mock closes with
`1000 "broadcast disabled"`, so the relay clears the display immediately.

The sample slides are in `scripts/mock-bridge-data.js`. For scripture, the
first line is the reference. Add or edit slides there to reproduce a layout
you want to check.

## Tests

```bash
npm test
```
