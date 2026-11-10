#!/usr/bin/env node
// WebRTC screen-share app: static file host + in-memory signaling relay.
//
// Signaling model (rendezvous at the broadcaster's server):
//   - The broadcaster starts a broadcast and gets a session id (sid).
//   - Viewers only need the broadcaster's address: they POST their offers to
//     the broadcaster's server and poll it for answers and ICE candidates.
//     Any number of viewers can connect to one broadcast.
//   - Every viewer connection has its own attempt id (aid), so candidates and
//     answers from old/failed attempts never leak into a new connection
//     (which browsers reject with "Unknown ufrag").
//   - Media flows directly peer-to-peer; this server only relays setup data.
//   - One broadcast per server run; announcing a new sid resets all state.

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// All signaling state, scoped to the broadcaster's session id (sid):
//   sid        current broadcast session id (null = nobody broadcasting)
//   offers     viewer offers:      [{ sid, aid, type, sdp }]
//   answers    per viewer:         `${sid}/${aid}` -> { type, sdp }
//   casterIce  broadcaster->viewer `${sid}/${aid}` -> [candidateInit...]
//   viewerIce  viewer->broadcaster [{ aid, candidate }]
//   prefs      viewer quality wishes [{ sid, aid, res, fps, bitrate }]
const signal = {
  sid: null,
  offers: [],
  answers: {},
  casterIce: {},
  viewerIce: [],
  prefs: [],
};

function resetSession(sid) {
  signal.sid = sid;
  signal.offers = [];
  signal.answers = {};
  signal.casterIce = {};
  signal.viewerIce = [];
  signal.prefs = [];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function localIPv4s() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (isV4 && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const raw = await readBody(req);
  const body = JSON.parse(raw || 'null');
  if (body === null || typeof body !== 'object') throw new Error('expected a JSON object');
  return body;
}

function need(body, ...fields) {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined || v === null || v === '') throw new Error('missing field: ' + f);
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (err) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ---- signaling API (viewers POST/poll here cross-origin) ----
  if (url.pathname.startsWith('/signal/')) {
    const q = url.searchParams;
    try {
      // Broadcaster: start (new sid) / stop (sid=null) a broadcast.
      if (req.method === 'POST' && url.pathname === '/signal/announce') {
        const body = await readJSON(req);
        let sid = body.sid === undefined ? null : body.sid;
        if (sid !== null && (typeof sid !== 'string' || !sid.trim())) {
          return json(res, 400, { error: 'sid must be a non-empty string or null' });
        }
        resetSession(sid ? sid.trim() : null);
        return json(res, 200, { ok: true, sid: signal.sid });
      }
      if (req.method === 'GET' && url.pathname === '/signal/announce') {
        return json(res, 200, { sid: signal.sid });
      }

      // Viewer -> broadcaster: post an offer for one connection attempt.
      if (req.method === 'POST' && url.pathname === '/signal/viewer-offer') {
        const body = await readJSON(req);
        need(body, 'sid', 'aid', 'sdp');
        if (body.sid !== signal.sid) return json(res, 409, { error: 'broadcast session changed - reconnect' });
        signal.offers.push({ sid: body.sid, aid: body.aid, type: 'offer', sdp: body.sdp });
        return json(res, 200, { ok: true });
      }
      // Broadcaster: poll for new viewer offers.
      if (req.method === 'GET' && url.pathname === '/signal/viewer-offers') {
        const since = Number(q.get('since') || 0) || 0;
        if (q.get('sid') !== signal.sid) return json(res, 200, { offers: [], next: 0 });
        return json(res, 200, { offers: signal.offers.slice(since), next: signal.offers.length });
      }

      // Viewer -> broadcaster: what quality this viewer wants for its own
      // connection (res = resolution multiplier, fps, bitrate).
      if (req.method === 'POST' && url.pathname === '/signal/viewer-pref') {
        const body = await readJSON(req);
        need(body, 'sid', 'aid', 'res', 'fps', 'bitrate');
        if (body.sid !== signal.sid) return json(res, 409, { error: 'broadcast session changed - reconnect' });
        signal.prefs.push({
          sid: body.sid,
          aid: body.aid,
          res: Number(body.res),
          fps: Number(body.fps),
          bitrate: Number(body.bitrate),
        });
        return json(res, 200, { ok: true });
      }
      // Broadcaster: poll all viewers' quality wishes.
      if (req.method === 'GET' && url.pathname === '/signal/viewer-prefs') {
        const since = Number(q.get('since') || 0) || 0;
        if (q.get('sid') !== signal.sid) return json(res, 200, { prefs: [], next: 0 });
        return json(res, 200, { prefs: signal.prefs.slice(since), next: signal.prefs.length });
      }

      // Broadcaster: post the answer for one viewer attempt.
      if (req.method === 'POST' && url.pathname === '/signal/answer') {
        const body = await readJSON(req);
        need(body, 'sid', 'aid', 'sdp');
        if (body.sid !== signal.sid) return json(res, 409, { error: 'broadcast session changed - reconnect' });
        signal.answers[body.sid + '/' + body.aid] = { type: 'answer', sdp: body.sdp };
        return json(res, 200, { ok: true });
      }
      // Viewer: poll for the answer to own offer.
      if (req.method === 'GET' && url.pathname === '/signal/answer') {
        const data = q.get('sid') === signal.sid ? signal.answers[q.get('sid') + '/' + q.get('aid')] || null : null;
        return json(res, 200, { data });
      }

      // Broadcaster: post own ICE candidates for one viewer attempt.
      if (req.method === 'POST' && url.pathname === '/signal/caster-ice') {
        const body = await readJSON(req);
        need(body, 'sid', 'aid', 'candidate');
        if (body.sid !== signal.sid) return json(res, 409, { error: 'broadcast session changed - reconnect' });
        const key = body.sid + '/' + body.aid;
        (signal.casterIce[key] || (signal.casterIce[key] = [])).push(body);
        return json(res, 200, { ok: true });
      }
      // Viewer: poll broadcaster's ICE candidates for own attempt.
      if (req.method === 'GET' && url.pathname === '/signal/caster-ice') {
        const since = Number(q.get('since') || 0) || 0;
        const list = q.get('sid') === signal.sid ? signal.casterIce[q.get('sid') + '/' + q.get('aid')] || [] : [];
        return json(res, 200, { candidates: list.slice(since), next: list.length });
      }

      // Viewer: post own ICE candidates (routed to the broadcaster by aid).
      if (req.method === 'POST' && url.pathname === '/signal/viewer-ice') {
        const body = await readJSON(req);
        need(body, 'sid', 'aid', 'candidate');
        if (body.sid !== signal.sid) return json(res, 409, { error: 'broadcast session changed - reconnect' });
        signal.viewerIce.push({ aid: body.aid, candidate: body });
        return json(res, 200, { ok: true });
      }
      // Broadcaster: poll all viewers' ICE candidates.
      if (req.method === 'GET' && url.pathname === '/signal/viewer-ice') {
        const since = Number(q.get('since') || 0) || 0;
        if (q.get('sid') !== signal.sid) return json(res, 200, { candidates: [], next: 0 });
        return json(res, 200, { candidates: signal.viewerIce.slice(since), next: signal.viewerIce.length });
      }

      return json(res, 404, { error: 'unknown signal endpoint' });
    } catch (err) {
      try {
        json(res, 400, { error: String((err && err.message) || err) });
      } catch (_) {}
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/my-address') {
    return json(res, 200, { port: PORT, ips: localIPv4s() });
  }

  // ---- static files ----
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }

  let rel;
  try {
    rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (err) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('WebRTC screen-share app');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of localIPv4s()) {
    console.log(`  Network: http://${ip}:${PORT}   <-- give this address to viewers`);
  }
  console.log('\nPress Ctrl+C to stop.');
});
