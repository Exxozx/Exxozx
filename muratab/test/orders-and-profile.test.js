'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { createServer } = require('../server');

const NOW = Date.parse('2026-11-20T10:00:00Z');
const freshApp = (opts = {}) => createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'muratab-')), now: () => NOW, ...opts });
const stock = (app, b, i) => app.inventory(b).find((r) => r.ingredientId === i).qty;
const settle = () => new Promise((r) => setTimeout(r, 20));
const talabatOrder = (over = {}) => ({
  token: 'tb-test-1', code: 'T123456', expeditionType: 'delivery',
  platformRestaurant: { id: 'TLB-DXB-40212' },
  customer: { firstName: 'Aisha', lastName: 'R', mobilePhone: '+971500000001' },
  comments: { customerComment: 'No onions' },
  products: [{ remoteCode: 'fries', name: 'Fries', quantity: 2, unitPrice: 15 }],
  price: { grandTotal: 30 },
  ...over,
});

test('POS orders run through the kitchen lifecycle', () => {
  const app = freshApp();
  const table = app.branches().find((b) => b.id === 'marina').tables[0];
  const potato = stock(app, 'marina', 'potato');
  const o = app.placeOrder('marina', { channel: 'dine_in', tableId: table.id, items: [{ menuItemId: 'fries', qty: 4 }] });
  assert.equal(o.status, 'accepted');
  assert.equal(stock(app, 'marina', 'potato'), Math.round((potato - 1) * 100) / 100);
  assert.ok(app.hub.tables('marina').find((t) => t.id === table.id).occupied);
  app.hub.transition(o.id, 'start');
  assert.throws(() => app.hub.transition(o.id, 'complete'), (e) => e.status === 409);
  app.hub.transition(o.id, 'ready');
  app.hub.transition(o.id, 'complete');
  assert.equal(o.status, 'completed');
  assert.ok(!app.hub.tables('marina').find((t) => t.id === table.id).occupied);
  assert.deepEqual(o.history.map((h) => h.status), ['received', 'accepted', 'preparing', 'ready', 'completed']);
});

test('cancelling before cooking returns the ingredients', () => {
  const app = freshApp();
  const before = stock(app, 'marina', 'potato');
  const o = app.placeOrder('marina', { channel: 'takeaway', items: [{ menuItemId: 'fries', qty: 4 }] });
  app.hub.transition(o.id, 'cancel', { reason: 'Customer left' });
  assert.equal(stock(app, 'marina', 'potato'), before);
  assert.equal(o.consumption, null);
});

test('Talabat webhook: order is mapped to the branch, accepted, and status is sent back', async () => {
  const sent = [];
  const app = freshApp({ transport: async (channel, req) => (sent.push({ channel, req }), { simulated: false, status: 200, body: {} }) });
  app.profile.updateChannels({ talabat: { autoAccept: true } });
  const potato = stock(app, 'marina', 'potato');
  const { order, response } = app.hub.receiveExternal('talabat', talabatOrder());
  assert.deepEqual(response, { remoteResponse: { remoteOrderId: order.id } });
  assert.equal(order.branchId, 'marina');
  assert.equal(order.status, 'accepted');
  assert.equal(order.customer.name, 'Aisha R');
  assert.equal(stock(app, 'marina', 'potato'), Math.round((potato - 0.5) * 100) / 100);
  await settle();
  const accepted = sent.find((s) => s.req.body.status === 'order_accepted');
  assert.equal(accepted.req.path, '/v2/order/status/tb-test-1');
  // Same webhook again (platform retry) does not create a second order.
  const again = app.hub.receiveExternal('talabat', talabatOrder());
  assert.equal(again.duplicate, true);
  assert.equal(app.hub.listOrders({ channel: 'talabat', status: 'accepted' }).filter((o) => o.external.orderId === 'tb-test-1').length, 1);
  app.hub.transition(order.id, 'ready');
  app.hub.transition(order.id, 'complete');
  await settle();
  assert.ok(sent.some((s) => s.req.body.status === 'order_picked_up'));
  assert.equal(app.hub.integrationLog({ channel: 'talabat' }).filter((e) => e.direction === 'out' && e.status === 'ok').length >= 2, true);
});

test('platform orders that cannot be made are rejected with a reason', async () => {
  const app = freshApp();
  app.profile.updateChannels({ talabat: { autoAccept: true } });
  const unknown = app.hub.receiveExternal('talabat', talabatOrder({ token: 'tb-2', products: [{ remoteCode: 'lobster', name: 'Lobster', quantity: 1, unitPrice: 200 }] })).order;
  assert.equal(unknown.status, 'rejected');
  assert.equal(unknown.rejectReason, 'ITEM_UNAVAILABLE');
  const tooMany = app.hub.receiveExternal('talabat', talabatOrder({ token: 'tb-3', products: [{ remoteCode: 'grilled-salmon', name: 'Salmon', quantity: 500, unitPrice: 89 }] })).order;
  assert.equal(tooMany.status, 'rejected');
  assert.throws(() => app.hub.receiveExternal('talabat', talabatOrder({ token: 'tb-4', platformRestaurant: { id: 'nope' } })), (e) => e.status === 404);
  assert.throws(() => app.hub.receiveExternal('careem', { id: 'x' }), (e) => e.status === 403);
});

test('manual acceptance flow and menu sync', async () => {
  const sent = [];
  const app = freshApp({ transport: async (c, req) => (sent.push(req), { simulated: true, status: 200, body: {} }) });
  const { order } = app.hub.simulateExternal('talabat', 'airport');
  assert.equal(order.status, 'received'); // seed has auto-accept off for Talabat
  app.hub.transition(order.id, 'reject', { reason: 'CLOSING_SOON' });
  await settle();
  assert.equal(sent.at(-1).body.status, 'order_rejected');
  assert.equal(sent.at(-1).body.reason, 'CLOSING_SOON');
  const pushed = app.hub.pushMenu('deliveroo');
  assert.equal(pushed.length, 2); // downtown + marina have Deliveroo store IDs
});

test('selling out a dish tells connected platforms it is unavailable', async () => {
  const app = freshApp();
  app.adjustStock('airport', { ingredientId: 'salmon', countedQty: 0 });
  const log = app.hub.integrationLog({ channel: 'talabat' }).find((e) => e.event === 'availability');
  assert.match(log.summary, /Airport T3: sold out – grilled-salmon/);
  const item = log.request.body.products.find((p) => p.remoteCode === 'grilled-salmon');
  assert.equal(item.isAvailable, false);
});

test('webhook secret is enforced over HTTP when configured', async () => {
  const app = freshApp({ webhookSecrets: { talabat: 's3cret' } });
  const server = createServer(app).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/talabat/orders`;
  try {
    const post = (headers) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(talabatOrder({ token: 'tb-http' })) });
    assert.equal((await post({})).status, 401);
    const ok = await post({ Authorization: 'Bearer s3cret' });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).remoteResponse.remoteOrderId);
  } finally {
    server.close();
  }
});

test('profile setup: restaurant, locations, tables, stock and kitchenware', () => {
  const app = freshApp();
  assert.equal(app.profile.get().setupComplete, false);
  assert.throws(() => app.profile.update({ setupComplete: true }), (e) => e.status === 400);
  app.profile.update({ restaurantName: 'Muratab Test Kitchen', managerName: 'Layla', cuisine: 'Lebanese', preferences: { language: 'ar', theme: 'dark', accent: 'saffron' } });
  assert.throws(() => app.profile.update({ preferences: { accent: 'neon' } }), (e) => e.status === 400);

  const branches = app.branches().map((b) => ({ id: b.id, name: b.name, location: b.location }));
  assert.throws(() => app.profile.saveBranches(branches.slice(0, 2)), (e) => e.status === 409 && /transfers in progress/.test(e.message));
  for (const t of app.listTransfers('airport').filter((x) => x.status === 'in_transit')) app.receiveTransfer(t.id, { branchId: t.toBranchId });
  branches.pop(); // now the airport branch can be closed
  branches.push({ name: 'JLT', location: 'Cluster D', hours: '08:00 – 23:00', tables: [{ label: 'A1', seats: 2 }, { label: 'A2', seats: 4, area: 'Terrace' }] });
  const saved = app.profile.saveBranches(branches);
  assert.deepEqual(saved.map((b) => b.name), ['Downtown', 'Marina', 'JLT']);
  assert.equal(app.ledgerBlocks().find((b) => b.tx.type === 'MEMBER_REMOVE').tx.payload.branchId, 'airport');
  assert.equal(app.verifyLedger().valid, true);
  const jlt = saved.find((b) => b.name === 'JLT');
  assert.equal(jlt.tables.length, 2);
  assert.throws(() => app.profile.saveTables(jlt.id, [{ label: 'A1' }, { label: 'a1' }]), (e) => e.status === 400);

  const ings = app.ingredients().map((i) => ({ ...i }));
  ings.push({ name: 'Zaatar', unit: 'kg', category: 'Spices', shelfLifeDays: 180, stock: { [jlt.id]: 2.5 } });
  app.profile.saveIngredients(ings);
  assert.equal(stock(app, jlt.id, 'zaatar'), 2.5);

  app.profile.saveEquipment([{ name: 'Shawarma grill', category: 'Appliances', counts: { [jlt.id]: 1, downtown: 2 }, minimum: 1 }]);
  app.profile.update({ setupComplete: true });
  const s = app.profileSummary();
  assert.equal(s.profile.restaurantName, 'Muratab Test Kitchen');
  assert.equal(s.profile.preferences.language, 'ar');
  assert.equal(s.locations.find((l) => l.name === 'JLT').seats, 6);
  assert.deepEqual(s.kitchenware.low.map((l) => l.branchName), ['Marina']);
  assert.ok(s.bestSellers.length > 0 && s.menu.picks.length === 3);
});

test('profile, kitchenware and channels survive export/import', () => {
  const app = freshApp();
  app.profile.update({ managerName: 'Layla', setupComplete: true });
  const other = freshApp();
  other.importData(JSON.parse(JSON.stringify(app.exportData())));
  assert.equal(other.profile.get().managerName, 'Layla');
  assert.equal(other.db.equipment.length, app.db.equipment.length);
  assert.equal(other.db.channels.talabat.storeIds.marina, 'TLB-DXB-40212');
});
