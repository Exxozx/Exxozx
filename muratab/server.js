'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./src/app');
const { createRouter } = require('./src/routes');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };


function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20e6) reject(Object.assign(new Error('Body too large'), { status: 413 }));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/** Fan-out of live price snapshots to connected browsers (Server-Sent Events). */
function createPriceHub() {
  const clients = new Set();
  return {
    clients,
    broadcast(snapshot) {
      const msg = `event: prices\ndata: ${JSON.stringify(snapshot)}\n\n`;
      for (const res of clients) res.write(msg);
    },
    attach(req, res, initial) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 3000\nevent: prices\ndata: ${JSON.stringify(initial)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
  };
}

function createServer(app, hub = createPriceHub()) {
  const route = createRouter(app);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    if (req.method === 'GET' && url.pathname === '/api/prices/stream') return hub.attach(req, res, app.prices.snapshot());
    let body = {};
    try {
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) body = await readBody(req);
    } catch (err) {
      return send(res, err.status || 400, { error: err.message });
    }
    const { status, data } = await route(req.method, url.pathname + url.search, body);
    send(res, status, data);
  });
}

if (require.main === module) {
  const hub = createPriceHub();
  const app = createApp({
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    livePrices: process.env.LIVE_PRICES !== 'off',
    priceFeedUrl: process.env.PRICE_FEED_URL,
    priceIntervalMs: Number(process.env.PRICE_INTERVAL_MS) || 5000,
    onPriceTick: hub.broadcast,
  });
  const port = Number(process.env.PORT) || 3000;
  createServer(app, hub).listen(port, () => {
    const feed = process.env.PRICE_FEED_URL ? `from ${process.env.PRICE_FEED_URL}` : '(simulated market)';
    console.log(`Muratab running at http://localhost:${port} · live prices ${feed}`);
  });
}

module.exports = { createServer, createPriceHub };
