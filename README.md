# BasketRandom

A browser-based **2-player basketball game** with local and online multiplayer. Play on the same device or challenge someone remotely via WebRTC.

Play it live: [catlover125r.github.io/BasketRandom.github.io](https://catlover125r.github.io/BasketRandom.github.io)

## Features

- **Local 2-player** — Both players on one device
- **Online multiplayer** — Host creates a 6-character room ID; opponent joins by browsing available rooms
- **WebRTC video streaming** — The host's canvas is streamed to the joiner's browser at 30fps; input travels back via data channel
- **Mobile support** — Touch input forwarding for online joiners
- **Installable PWA** — Add to home screen via app manifest and service worker

## Tech Stack

- **Game engine:** Construct 3 (exported HTML/JS)
- **Physics:** Box2D compiled to WebAssembly
- **Online multiplayer:** PeerJS v1.5.4 (WebRTC peer-to-peer)
- **Room/lobby backend:** Firebase Realtime Database

## How to Play

### Local
Open the game, select **2 Player**, and share the keyboard.

### Online
1. One player selects **Online** → **Create Room** and shares the room code.
2. The other player selects **Online** → **Join Room**, finds the room, and connects.
3. The host's screen is streamed; the joiner sends inputs back in real time.

## Running Locally

No build step needed — just open `index.html` in a browser, or serve with any static file server:

```bash
npx serve .
```
