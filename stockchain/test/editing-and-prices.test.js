'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { createServer, createPriceHub } = require('../server');

const NOW = Date.parse('2026-11-06T10:00:00Z');
const freshApp = (opts = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockchain-'));
  return { app: createApp({ dataDir: dir, now: () => NOW, ...opts }), dir };
};
const row = (app, b, i) => app.inventory(b).find((r) => r.ingredientId === i);

test('live price ticks move catalog prices within bounds and feed downstream costs', async () => {
  const { app } = freshApp();
  const before = app.prices.snapshot();
  assert.ok(before.ingredients.every((i) => i.history.length >= 2), 'warm-up history exists');
  for (let n = 0; n < 25; n++) await app.prices.tick();
  const after = app.prices.snapshot();
  assert.equal(after.status.ticks, 25);
  const moved = after.ingredients.filter((i, k) => i.marketPrice !== before.ingredients[k].marketPrice);
  assert.ok(moved.length > 0, 'some prices moved');
  for (const s of app.suppliers()) {
    for (const c of s.catalog) assert.ok(c.unitPrice >= c.basePrice * 0.6 - 0.01 && c.unitPrice <= c.basePrice * 1.6 + 0.01);
  }
  // Inventory uses the live best trusted price.
  const tomato = after.ingredients.find((i) => i.ingredientId === 'tomato');
  assert.equal(row(app, 'downtown', 'tomato').unitCost, tomato.bestTrusted.price);
  // Untrusted QuickCheap is quoted but never "best".
  assert.ok(tomato.quotes.some((q) => q.supplierId === 'quickcheap' && !q.trusted));
  assert.notEqual(tomato.bestTrusted.supplierId, 'quickcheap');
  // Purchase orders lock in the live price at creation time.
  const po = app.createPurchaseOrder({ branchId: 'downtown', supplierId: 'gulf-fresh', lines: [{ ingredientId: 'tomato', qty: 10 }] });
  const live = app.suppliers().find((s) => s.id === 'gulf-fresh').catalog.find((c) => c.ingredientId === 'tomato').unitPrice;
  assert.equal(po.lines[0].unitPrice, live);
  // Menu food cost is recipe × best price.
  const fries = after.menu.find((m) => m.menuItemId === 'fries');
  const best = (id) => after.ingredients.find((i) => i.ingredientId === id).bestTrusted.price;
  assert.equal(fries.foodCost, Math.round((0.25 * best('potato') + 0.02 * best('frying-oil')) * 100) / 100);
});

test('price feed reads quotes from an external HTTP source', async () => {
  const http = require('http');
  const srv = http.createServer((req, res) => res.end(JSON.stringify([{ supplierId: 'gulf-fresh', ingredientId: 'tomato', price: 7.77 }]))).listen(0);
  try {
    const { app } = freshApp({ priceFeedUrl: `http://127.0.0.1:${srv.address().port}/quotes` });
    await app.prices.tick();
    const snap = app.prices.snapshot();
    assert.equal(snap.status.mode, 'http');
    assert.equal(snap.status.error, null);
    assert.equal(snap.ingredients.find((i) => i.ingredientId === 'tomato').quotes.find((q) => q.supplierId === 'gulf-fresh').price, 7.77);
  } finally {
    srv.close();
  }
});

test('ingredients and dishes can be created, edited and deleted', () => {
  const { app } = freshApp();
  const ing = app.saveIngredient(null, { name: 'Halloumi', unit: 'kg', category: 'Dairy', shelfLifeDays: 20 });
  assert.equal(ing.id, 'halloumi');
  assert.equal(row(app, 'marina', 'halloumi').qty, 0);
  app.saveIngredient(ing.id, { name: 'Halloumi Cheese', unit: 'kg', category: 'Dairy', shelfLifeDays: 25 });
  assert.equal(app.ingredients().find((i) => i.id === 'halloumi').name, 'Halloumi Cheese');

  const dish = app.saveMenuItem(null, { name: 'Halloumi Wrap', price: 36, recipe: [{ ingredientId: 'halloumi', qty: 0.08 }, { ingredientId: 'lettuce', qty: 0.03 }] });
  assert.throws(() => app.deleteIngredient('halloumi'), (e) => e.status === 409 && /Halloumi Wrap/.test(e.message));
  assert.throws(() => app.saveMenuItem(null, { name: 'Bad', price: 1, recipe: [] }), (e) => e.status === 400);
  assert.throws(() => app.saveMenuItem(null, { name: 'Bad', price: 1, recipe: [{ ingredientId: 'nope', qty: 1 }] }), (e) => e.status === 400);

  app.adjustStock('marina', { ingredientId: 'halloumi', countedQty: 1 });
  app.placeOrder('marina', { items: [{ menuItemId: dish.id, qty: 5 }] });
  assert.equal(row(app, 'marina', 'halloumi').qty, 0.6);

  app.deleteMenuItem(dish.id);
  app.deleteIngredient('halloumi');
  assert.ok(!app.ingredients().some((i) => i.id === 'halloumi'));
});

test('suppliers can be added with a catalog and get live quotes', async () => {
  const { app } = freshApp();
  const s = app.saveSupplier(null, { name: 'Fresh Farms', contact: 'a@b.c', rating: 4.9, onTimeRate: 0.99, trusted: true,
    catalog: [{ ingredientId: 'tomato', unitPrice: 2, leadTimeDays: 1, minOrderQty: 0 }] });
  assert.equal(row(app, 'downtown', 'tomato').supplier.id, s.id, 'cheapest trusted supplier wins');
  await app.prices.tick();
  assert.ok(app.prices.snapshot().ingredients.find((i) => i.ingredientId === 'tomato').quotes.some((q) => q.supplierId === s.id));
  assert.throws(() => app.saveSupplier(s.id, { name: 'X', catalog: [{ ingredientId: 'tomato', unitPrice: 2, leadTimeDays: 1 }, { ingredientId: 'tomato', unitPrice: 3, leadTimeDays: 1 }] }), (e) => e.status === 400);
  const po = app.createPurchaseOrder({ branchId: 'downtown', supplierId: s.id, lines: [{ ingredientId: 'tomato', qty: 5 }] });
  assert.throws(() => app.deleteSupplier(s.id), (e) => e.status === 409);
  app.cancelPurchaseOrder(po.id);
  app.deleteSupplier(s.id);
});

test('new branches are admitted to the ledger by HQ and can transfer immediately', () => {
  const { app } = freshApp();
  const b = app.createBranch({ name: 'JBR Beach', location: 'Jumeirah' });
  const head = app.ledgerBlocks()[0];
  assert.equal(head.tx.type, 'MEMBER_ADD');
  assert.equal(head.validator, 'HQ');
  const t = app.dispatchTransfer({ branchId: 'airport', toBranchId: b.id, lines: [{ ingredientId: 'rice', qty: 10 }] });
  app.receiveTransfer(t.id, { branchId: b.id });
  assert.equal(row(app, b.id, 'rice').qty, 10);
  assert.equal(app.verifyLedger().valid, true);
});

test('export → import round-trips the data and starts a fresh valid ledger', () => {
  const { app } = freshApp();
  app.updateMeta({ chainName: 'Test Group', currency: 'usd' });
  const exported = JSON.parse(JSON.stringify(app.exportData()));
  const { app: other } = freshApp();
  other.importData(exported);
  assert.equal(other.overview().meta.chainName, 'Test Group');
  assert.equal(other.overview().meta.currency, 'USD');
  assert.equal(other.menu().length, app.menu().length);
  assert.equal(row(other, 'downtown', 'tomato').qty, row(app, 'downtown', 'tomato').qty);
  assert.equal(other.ledgerBlocks().length, 1);
  assert.equal(other.verifyLedger().valid, true);
  assert.throws(() => other.importData({ data: { branches: [], ingredients: [], menu: [], suppliers: [] } }), (e) => e.status === 400);
  // Blank template works end to end.
  other.importData({ data: { branches: [{ id: 'main', name: 'Main' }], ingredients: [], menu: [], suppliers: [] } });
  assert.equal(other.overview().branches.length, 1);
  assert.deepEqual(other.inventory('main'), []);
});

test('prices stream over Server-Sent Events', async () => {
  const hub = createPriceHub();
  const { app } = freshApp({ onPriceTick: hub.broadcast });
  const server = createServer(app, hub).listen(0);
  const ctrl = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/prices/stream`, { signal: ctrl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: prices/);
    await app.prices.tick();
    let more = '';
    while (!more.includes('"ticks":1')) more += new TextDecoder().decode((await reader.read()).value);
  } finally {
    ctrl.abort();
    server.closeAllConnections();
    server.close();
  }
});
