'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./src/app');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function buildRoutes(app) {
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler });
  };

  on('GET', '/api/overview', () => app.overview());
  on('POST', '/api/reset', () => app.reset());
  on('GET', '/api/branches', () => app.branches());
  on('PATCH', '/api/branches/:id/settings', ({ p, body }) => app.updateSettings(p.id, body));
  on('GET', '/api/ingredients', () => app.ingredients());
  on('GET', '/api/menu', () => app.menu());

  on('GET', '/api/branches/:id/inventory', ({ p }) => app.inventory(p.id));
  on('POST', '/api/branches/:id/inventory/adjust', ({ p, body }) => app.adjustStock(p.id, body));
  on('GET', '/api/branches/:id/menu-availability', ({ p }) => app.menuAvailability(p.id));
  on('GET', '/api/branches/:id/orders', ({ p, q }) => app.listOrders(p.id, Number(q.get('limit')) || 25));
  on('POST', '/api/branches/:id/orders', ({ p, body }) => app.placeOrder(p.id, body));

  on('GET', '/api/suppliers', () => app.suppliers());
  on('PATCH', '/api/suppliers/:id', ({ p, body }) => app.updateSupplier(p.id, body));
  on('GET', '/api/purchase-orders', ({ q }) => app.listPurchaseOrders(q.get('branchId')));
  on('POST', '/api/purchase-orders', ({ body }) => app.createPurchaseOrder(body));
  on('POST', '/api/branches/:id/purchase-orders/auto', ({ p }) => app.autoReplenish(p.id));
  on('POST', '/api/purchase-orders/:id/send', ({ p }) => app.sendPurchaseOrder(p.id));
  on('POST', '/api/purchase-orders/:id/receive', ({ p }) => app.receivePurchaseOrder(p.id));
  on('POST', '/api/purchase-orders/:id/cancel', ({ p }) => app.cancelPurchaseOrder(p.id));

  on('GET', '/api/transfers', ({ q }) => app.listTransfers(q.get('branchId')));
  on('GET', '/api/transfers/suggestions', () => app.suggestions());
  on('POST', '/api/transfers/request', ({ body }) => app.requestTransfer(body));
  on('POST', '/api/transfers/dispatch', ({ body }) => app.dispatchTransfer(body));
  on('POST', '/api/transfers/:id/receive', ({ p, body }) => app.receiveTransfer(p.id, body));
  on('POST', '/api/transfers/:id/reject', ({ p, body }) => app.rejectTransfer(p.id, body));
  on('POST', '/api/transfers/:id/cancel', ({ p, body }) => app.cancelTransfer(p.id, body));

  // live prices
  on('GET', '/api/prices', () => app.prices.snapshot());
  on('POST', '/api/prices/tick', async () => (await app.prices.tick(), app.prices.snapshot()));
  on('POST', '/api/prices/start', () => app.prices.start());
  on('POST', '/api/prices/stop', () => app.prices.stop());

  // editable master data
  on('POST', '/api/ingredients', ({ body }) => app.saveIngredient(null, body));
  on('PUT', '/api/ingredients/:id', ({ p, body }) => app.saveIngredient(p.id, body));
  on('DELETE', '/api/ingredients/:id', ({ p }) => app.deleteIngredient(p.id));
  on('POST', '/api/menu', ({ body }) => app.saveMenuItem(null, body));
  on('PUT', '/api/menu/:id', ({ p, body }) => app.saveMenuItem(p.id, body));
  on('DELETE', '/api/menu/:id', ({ p }) => app.deleteMenuItem(p.id));
  on('POST', '/api/suppliers', ({ body }) => app.saveSupplier(null, body));
  on('PUT', '/api/suppliers/:id', ({ p, body }) => app.saveSupplier(p.id, body));
  on('DELETE', '/api/suppliers/:id', ({ p }) => app.deleteSupplier(p.id));
  on('POST', '/api/branches', ({ body }) => app.createBranch(body));
  on('PATCH', '/api/branches/:id', ({ p, body }) => app.updateBranch(p.id, body));
  on('PATCH', '/api/meta', ({ body }) => app.updateMeta(body));
  on('GET', '/api/export', () => app.exportData());
  on('POST', '/api/import', ({ body }) => app.importData(body));

  on('GET', '/api/ledger', () => app.ledgerBlocks());
  on('GET', '/api/ledger/verify', () => app.verifyLedger());
  return routes;
}

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
  const routes = buildRoutes(app);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    if (req.method === 'GET' && url.pathname === '/api/prices/stream') return hub.attach(req, res, app.prices.snapshot());
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return send(res, 404, { error: 'Not found' });
    try {
      const m = url.pathname.match(route.re);
      const p = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      send(res, 200, await route.handler({ p, q: url.searchParams, body }));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: err.message, ...(err.details || {}) });
    }
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
    console.log(`StockChain running at http://localhost:${port} · live prices ${feed}`);
  });
}

module.exports = { createServer, createPriceHub };
