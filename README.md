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
Broadcasts are also advertised automatically on the local network (UDP port
41234): each page lists the broadcasts its own server can see, so viewers can
usually just click **Watch** instead of typing an address. Set `DISCOVERY=0`
to disable advertising/listening, or `DISCOVERY_PORT=...` to use another port.

## Use

- **Broadcast** — pick *Broadcast my screen*, set a **nickname** (stored in the
  browser, so it survives reloads), click **Choose what to share &
  broadcast**, and select entire screen / window / browser tab in the browser's
  dialog. Give your address (shown on the page) to everyone who should watch.
  Any number of viewers can connect at the same time; each gets its own
  peer connection carrying the same stream. The nickname is shown above the
  stream on every viewer's tile, in *Only streams* mode as a floating badge, and
  in each stream's picture-in-picture window (via Document PiP; see notes).
- **Quality controls** — three independent sliders, adjustable before or
  during a broadcast: **Resolution** (10%–100% multiplier of the native capture
  size, so odd/ultrawide/window captures scale proportionally; 100% = full
  resolution), **Frame rate** (15 / 24 / 30 / 60 / 120 fps) and **Bitrate**
  (200 kbps – 100 Mbps, logarithmic scale). 60/120 fps needs a display that
  fast and a strong encoder. The resolution label shows both the multiplier and
  the absolute output size (estimated from the screen with `≈` before sharing,
  exact from the capture afterwards and kept up to date if the shared window is
  resized); the hint line adds frame rate, bitrate and approximate traffic per
  viewer (MB/min). Changes apply live to every connected viewer and need no
  reconnection. Lower settings are the main way to cut CPU/GPU usage on weak
  devices — both the broadcaster (capture + encode) and viewers (decode +
  render) benefit.
- **Watch** — pick *Watch broadcasts*. *Available broadcasts* is filled
  automatically from the server's LAN discovery; click **Watch** to open a tile,
  or add an address by hand (e.g. `192.168.1.20:8080`). Every added address
  becomes its own live video tile, so one page can watch several broadcasts (or
  several tiles of the same one) simultaneously. Each tile shows the
  broadcaster's nickname above the video and has a **PiP** button for
  picture-in-picture. Drag a tile's top bar to move it, drag its lower-right
  corner to resize it. Tiles reconnect automatically if the broadcaster
  restarts its stream.
- **Requested quality (viewers)** — in *Watch broadcasts*, expand *Requested
  quality for this viewer* to ask for lower resolution / frame rate / bitrate.
  Use the **Apply to** dropdown to target **All streams** or one specific
  stream; each stream keeps its own wish, and picking it loads its values into
  the sliders. The wish is sent to the broadcaster(s) of the targeted stream(s)
  and each connection gets the **minimum** of your wish and the broadcaster's
  own settings — you can only ask for less, never more. Lowering it cuts
  decoding/rendering CPU on your machine without affecting other viewers.
  Default is "max", i.e. exactly what the broadcaster offers. The broadcaster
  can switch the whole wishes system off with **Let viewers request lower
  quality for themselves** (unchecked = everyone gets the broadcaster's own
  quality; stored wishes take effect again if it is re-enabled).
- **Only streams** — the button above the stage hides all controls and expands
  the stage to the whole window, leaving just the stream tiles (handy for a
  clean presentation). Hover a tile to reveal its bar for moving/removing it;
  press **Esc** or the floating button to exit.

Signaling rendezvous happens at the broadcaster's server: viewers POST their
offers there and poll it for answers and ICE candidates. Each connection is
identified by a session id (per broadcast) plus an attempt id (per viewer
connection), so leftover candidates from earlier attempts are never applied
to a new connection. The broadcast's nickname travels with the session
(renaming re-announces the same session without disturbing viewers) and is
also returned to viewers with the answer. Viewers also post live quality wishes
(`/signal/viewer-pref`); the broadcaster polls them (`/signal/viewer-prefs`)
and applies the per-connection minimum. Every server advertises its active
broadcast over UDP and collects the announcements it hears from other servers;
`GET /discover` returns the merged list used by the *Available broadcasts*
pane.

## Notes / limits

- You can test alone on one machine: start a broadcast in one tab
  (`http://localhost:8080`), then open a second tab and add `localhost:8080`
  as a stream. Add it twice to see multiple tiles.
- One broadcast per server run (state is in memory); restarting the broadcast
  resets it and viewers reconnect automatically.
- Nicknames and other UI state live in the browser's `localStorage`, so each
  browser remembers its own broadcaster name; viewers see the nick announced by
  the broadcaster and it updates live thanks to discovery.
- Picture-in-picture with the nickname bar uses the Document PiP API (Chrome /
  Edge 116+). Browsers with only classic video PiP still get a PiP window, but
  the OS draws no DOM overlay there, so the nickname is not visible; the page
  logs this when it happens.
- LAN discovery sends UDP to the loopback and each interface's broadcast
  address on port 41234 (best effort; some firewalls drop broadcast traffic).
  It always works for broadcasts on the same server (listed as *this server*),
  and on a LAN when UDP 41234 is allowed. Discovery is only a convenience — the
  manual address flow works without it.
- Browsers only allow screen capture on localhost/HTTPS pages, so the
  broadcasting machine must open the page via `http://localhost:8080`.
  Receiving (watching) works fine over plain HTTP.
- Audio is shared only if the browser's share dialog offers it (screen or tab
  audio, depending on browser/OS).
- Performance: without an SFU each viewer gets its own encoder on the
  broadcaster, so many simultaneous viewers cost the broadcaster CPU. Use a
  lower quality preset when broadcasting to several low-end machines at once.
  Weak devices (4 or fewer CPU threads / 4 GB or less RAM) start from a lighter
  preset (25% resolution, 15 fps, ~500 kbps) instead of the defaults. The
  broadcaster pane shows a live **Encoding** line (output size, fps, bitrate,
  codec, hardware/software encoder and the encoder's own limitation reason),
  which is the quickest way to see where the CPU goes. Once a viewer connection
  is established its ICE polling stops altogether (a reconnect starts it
  again), so idle viewers cost almost nothing. The page also slows signaling
  polling after setup and skips UI/stat updates while the tab is in the
  background. The viewer count only includes live connections; failed
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
