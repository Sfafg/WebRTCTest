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
- **Quality controls** — three independent sliders, adjustable before or
  during a broadcast: **Resolution** (10%–100% multiplier of the native capture
  size, so odd/ultrawide/window captures scale proportionally; 100% = full
  resolution), **Frame rate** (15 / 24 / 30 / 60 / 120 fps) and **Bitrate**
  (200 kbps – 20 Mbps, logarithmic scale). 60/120 fps needs a display that
  fast and a strong encoder. The resolution label shows both the multiplier and
  the absolute output size (estimated from the screen with `≈` before sharing,
  exact from the capture afterwards and kept up to date if the shared window is
  resized); the hint line adds frame rate, bitrate and approximate traffic per
  viewer (MB/min). Changes apply live to every connected viewer and need no
  reconnection. Lower settings are the main way to cut CPU/GPU usage on weak
  devices — both the broadcaster (capture + encode) and viewers (decode +
  render) benefit.
- **Watch** — pick *Watch broadcasts* and add the address of each broadcaster
  (e.g. `192.168.1.20:8080`). Every added address becomes its own live video
  tile, so one page can watch several broadcasts (or several tiles of the
  same one) simultaneously. Drag a tile's top bar to move it, drag its
  lower-right corner to resize it. Tiles reconnect automatically if the
  broadcaster restarts its stream.
- **Requested quality (viewers)** — in *Watch broadcasts*, expand *Requested
  quality for this viewer* to ask for lower resolution / frame rate / bitrate.
  Use the **Apply to** dropdown to target **All streams** or one specific
  stream; each stream keeps its own wish, and picking it loads its values into
  the sliders. The wish is sent to the broadcaster(s) of the targeted stream(s)
  and each connection gets the **minimum** of your wish and the broadcaster's
  own settings — you can only ask for less, never more. Lowering it cuts
  decoding/rendering CPU on your machine without affecting other viewers.
  Default is "max", i.e. exactly what the broadcaster offers.
- **Only streams** — the button above the stage hides all controls and expands
  the stage to the whole window, leaving just the stream tiles (handy for a
  clean presentation). Hover a tile to reveal its bar for moving/removing it;
  press **Esc** or the floating button to exit.

Signaling rendezvous happens at the broadcaster's server: viewers POST their
offers there and poll it for answers and ICE candidates. Each connection is
identified by a session id (per broadcast) plus an attempt id (per viewer
connection), so leftover candidates from earlier attempts are never applied
to a new connection. Viewers also post live quality wishes
(`/signal/viewer-pref`); the broadcaster polls them (`/signal/viewer-prefs`)
and applies the per-connection minimum.

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
- Performance: without an SFU each viewer gets its own encoder on the
  broadcaster, so many simultaneous viewers cost the broadcaster CPU. Use a
  lower quality preset when broadcasting to several low-end machines at once.
  The page also polls signaling less often once a connection is established to
  save background CPU. The viewer count only includes live connections; failed
  attempts and viewers that vanish are dropped automatically (8 s grace for a
  network hiccup, 30 s for an unfinished handshake).
- GPU use: screen sharing normally negotiates **VP8**, which browsers encode
  and decode in software (pure CPU; VP8 has no hardware encoder). The page asks
  `navigator.mediaCapabilities` which video codecs have a hardware encoder and
  prefers those (usually H.264 / VP9 / AV1), keeping VP8 as the fallback. The
  broadcaster log prints the negotiated codec. If CPU is still high, hardware
  acceleration is probably unavailable or disabled (check `chrome://gpu`), and
  `chrome://webrtc-internals` shows the `powerEfficientEncoder/Decoder` flags.
  On Linux, WebRTC hardware encode is often unavailable regardless of settings.
