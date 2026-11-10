#!/usr/bin/env node
// WebRTC screen-share app: static file host + in-memory signaling relay.
// Run on BOTH machines:  node server.js   (then open http://localhost:8080)
//
// Signaling model:
//   - Each side stores its own offer/answer/ICE candidates on ITS OWN server.
//   - Each side polls the PEER's address (the one typed into the UI) to read
//     the other side's messages. Cross-origin requests are allowed via CORS.

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory signaling state. One session per server run; restart to reset.
const signal = { offer: null, answer: null, candidates: [] };

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

  // ---- signaling API (polled cross-origin by the other peer) ----
  if (url.pathname.startsWith('/signal/')) {
    try {
      if (req.method === 'POST' && url.pathname === '/signal/offer') {
        const body = JSON.parse((await readBody(req)) || 'null');
        if (!body || !body.sdp) throw new Error('missing sdp');
        signal.offer = body;
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/signal/offer') {
        return json(res, 200, { data: signal.offer });
      }
      if (req.method === 'POST' && url.pathname === '/signal/answer') {
        const body = JSON.parse((await readBody(req)) || 'null');
        if (!body || !body.sdp) throw new Error('missing sdp');
        signal.answer = body;
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/signal/answer') {
        return json(res, 200, { data: signal.answer });
      }
      if (req.method === 'POST' && url.pathname === '/signal/ice') {
        const body = JSON.parse((await readBody(req)) || 'null');
        if (!body || !body.candidate) throw new Error('missing candidate');
        signal.candidates.push(body);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/signal/ice') {
        const since = Number(url.searchParams.get('since') || 0);
        return json(res, 200, {
          candidates: signal.candidates.slice(since),
          next: signal.candidates.length,
        });
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
    console.log(`  Network: http://${ip}:${PORT}   <-- give this address to the other person`);
  }
  console.log('\nPress Ctrl+C to stop.');
});
