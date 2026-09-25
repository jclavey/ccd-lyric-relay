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

The bridge may send the token as an `x-api-token` header (what
`ccd-propresenter-bridge` does), an `Authorization: Bearer` header, or a
`?token=` query parameter.

## Deployment (Railway)

One Railway service with two public domains: one targets `EVENT_SOURCE_PORT`
(the bridge connects to it with `wss://`), the other targets
`DISPLAY_SERVER_PORT` (the URL you share with the congregation).

| Railway environment | Deploys branch |
|---|---|
| dev | `dev` |
| prd | `main` |

Work on `dev`, check it on the dev environment, then merge `dev` into `main`
to release. Set `INBOUND_API_TOKEN` in each environment's variables. Don't
commit `.env`.

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
| `inbound_connection_status` | `status`: `connected` / `disconnected` | Whether the bridge is connected to the relay |

The `state` payload format is documented in the
[bridge README](https://github.com/jclavey/ccd-propresenter-bridge#relay-payload-v2).

## Tests

```bash
npm test
```
