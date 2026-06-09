# CCD Lyrics Relay

A minimal web server that serves a lyrics display page. The page accepts connections from a propresenter scraping app and shows the current slide text as large as possible on a black background.

## The display page

- **Black background, white text** — nothing else visible during normal operation
- **Auto-sizing font** — binary searches for the largest font size where the longest line still fits on one line without wrapping
- **Re-fits on resize** — rotating a phone or resizing a browser window re-calculates the font size
- **Blanking support** — when ProPresenter's audience screens are disabled, lyrics fade out
- **Auto-reconnect** — if the WebSocket drops (e.g. lyrics-server restarts), the page reconnects automatically
- **Instant state** — connecting mid-service shows the current lyrics immediately (served from the lyrics-server's state cache)

## Message types handled

| Type | Behaviour |
|---|---|
| `hello` | Shows "Waiting for first slide…" |
| `lyrics` | Displays lines at maximum fitting font size |
| `clear` | Clears the display (blank slide) |
| `presentation` | Logged to console (song name available if needed) |
| `audience_screens` | Fades lyrics out when screens are disabled |
