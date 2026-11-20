'use strict';
/**
 * The Muratab API as plain functions: (method, url, body) -> { status, data }.
 * Used by the HTTP server, and called directly by the standalone browser build
 * so both share exactly the same behaviour.
 */
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

function createRouter(app) {
  const routes = buildRoutes(app);
  return async function route(method, url, body = {}) {
    const u = new URL(url, 'http://local');
    const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
    if (!r) return { status: 404, data: { error: 'Not found' } };
    try {
      const m = u.pathname.match(r.re);
      const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { status: 200, data: await r.handler({ p, q: u.searchParams, body: body || {} }) };
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return { status, data: { error: err.message, ...(err.details || {}) } };
    }
  };
}

module.exports = { createRouter };
