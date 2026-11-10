# WebRTC Screen Share

A tiny, dependency-free WebRTC app for sharing your screen with other people
over the network. Video/audio flows directly peer-to-peer; the small Node.js
server only relays the connection setup (signaling) over HTTP.

## Files

- `server.js` — static file host + in-memory signaling endpoints
- `public/index.html` — the whole client (watch / broadcast UI)

## Run

Run the server on the **broadcasting** machine (Node.js 14+, no
`npm install` needed):

    node server.js            # listens on port 8080 (override with PORT=...)

Then open **http://localhost:8080** there. Viewers only need the broadcaster's
address — they can open the page served by the broadcaster
(`http://<broadcaster-ip>:8080`) and don't need to run anything themselves.

## Use

- **Broadcast** — pick *Broadcast my screen*, click **Choose what to share &
  broadcast**, and select entire screen / window / browser tab in the browser's
  dialog. Give your address (shown on the page) to everyone who should watch.
  Any number of viewers can connect at the same time; each gets its own
  peer connection carrying the same stream.
- **Watch** — pick *Watch broadcasts* and add the address of each broadcaster
  (e.g. `192.168.1.20:8080`). Every added address becomes its own live video
  tile, so one page can watch several broadcasts (or several tiles of the
  same one) simultaneously. Tiles reconnect automatically if the broadcaster
  restarts its stream.

Signaling rendezvous happens at the broadcaster's server: viewers POST their
offers there and poll it for answers and ICE candidates. Each connection is
identified by a session id (per broadcast) plus an attempt id (per viewer
connection), so leftover candidates from earlier attempts are never applied
to a new connection.

## Notes / limits

- You can test alone on one machine: start a broadcast in one tab
  (`http://localhost:8080`), then open a second tab and add `localhost:8080`
  as a stream. Add it twice to see multiple tiles.
- One broadcast per server run (state is in memory); restarting the broadcast
  resets it and viewers reconnect automatically.
- Browsers only allow screen capture on localhost/HTTPS pages, so the
  broadcasting machine must open the page via `http://localhost:8080`.
  Receiving (watching) works fine over plain HTTP.
- Audio is shared only if the browser's share dialog offers it (screen or tab
  audio, depending on browser/OS).
