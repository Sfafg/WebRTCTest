# WebRTC Screen Share

A tiny, dependency-free WebRTC app for sharing your screen with one other
person over the network. The video/audio itself flows directly peer-to-peer;
the small Node.js server on each side only relays the connection setup
(signaling) over HTTP.

## Files

- `server.js` — static file host + in-memory signaling endpoints
- `public/index.html` — the whole client (watch / broadcast UI)

## Run

Run the server on **both** machines (Node.js 14+, no `npm install` needed):

    node server.js            # listens on port 8080 (override with PORT=...)

Then open **http://localhost:8080** in a browser on each machine. The page
shows each machine's LAN address — swap those addresses with each other.

## Use

- **Viewer** — pick *Watch a broadcast*, enter the broadcaster's address
  (e.g. `192.168.1.20:8080`), click **Watch**, and wait for their stream.
- **Broadcaster** — pick *Broadcast my screen*, enter the viewer's address
  (e.g. `192.168.1.30:8080`), click **Choose what to share & broadcast**.
  The browser asks what to share (entire screen, window, or browser tab);
  after picking, the stream is sent to the viewer.

Each side stores its own signaling messages (offer/answer/ICE candidates) on
its own server and polls the peer's address for theirs, so both machines
must be able to reach each other's port 8080 (same LAN, VPN, or forwarded).

## Notes / limits

- You can test alone on one machine with two browser tabs, using
  `localhost:8080` as the address in both tabs.
- One session per server run (state is in memory); restart for a clean slate.
- Browsers only allow screen capture on localhost/HTTPS pages, so the
  broadcasting machine must open the page via `http://localhost:8080`.
- Audio is shared only if the browser's share dialog offers it (screen or tab
  audio, depending on browser/OS).
