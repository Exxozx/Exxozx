'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { Ledger, generateKeyPair, replay } = require('../src/blockchain');
const inv = require('../src/inventory');
const { createServer } = require('../server');

const NOW = Date.parse('2026-11-06T10:00:00Z');
function freshApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockchain-'));
  return { app: createApp({ dataDir: dir, now: () => NOW }), dir };
}
const row = (app, branchId, ingredientId) => app.inventory(branchId).find((r) => r.ingredientId === ingredientId);

test('orders deduct recipe ingredients from branch stock', () => {
  const { app } = freshApp();
  const bun = row(app, 'marina', 'burger-bun').qty;
  const patty = row(app, 'marina', 'beef-patty').qty;
  const order = app.placeOrder('marina', { items: [{ menuItemId: 'classic-burger', qty: 3 }] });
  assert.equal(order.total, 126);
  assert.equal(row(app, 'marina', 'burger-bun').qty, bun - 3);
  assert.equal(row(app, 'marina', 'beef-patty').qty, patty - 3);
});

test('orders are rejected when stock is insufficient', () => {
  const { app } = freshApp();
  const salmonPortions = app.menuAvailability('downtown').find((m) => m.menuItemId === 'grilled-salmon').portions;
  assert.throws(
    () => app.placeOrder('downtown', { items: [{ menuItemId: 'grilled-salmon', qty: salmonPortions + 1 }] }),
    (e) => e.status === 409 && e.details.shortages.some((s) => s.ingredientId === 'salmon')
  );
});

test('report flags shortages and excess from forecast demand', () => {
  const { app } = freshApp();
  assert.equal(row(app, 'downtown', 'beef-patty').status, 'critical');
  assert.ok(row(app, 'downtown', 'beef-patty').recommendedOrderQty > 0);
  const airport = row(app, 'airport', 'beef-patty');
  assert.equal(airport.status, 'excess');
  assert.ok(airport.surplusQty > 0);
  assert.equal(airport.recommendedOrderQty, 0);
});

test('untrusted suppliers are never selected or ordered from', () => {
  const { app } = freshApp();
  // QuickCheap is cheapest for beef patties but is not trusted.
  assert.equal(row(app, 'downtown', 'beef-patty').supplier.id, 'prime-meats');
  assert.throws(() => app.createPurchaseOrder({ branchId: 'downtown', supplierId: 'quickcheap', lines: [{ ingredientId: 'tomato', qty: 5 }] }), (e) => e.status === 403);
  // Revoking trust removes a supplier from recommendations.
  app.updateSupplier('prime-meats', { trusted: false });
  assert.equal(row(app, 'downtown', 'beef-patty').supplier, null);
});

test('auto-replenish drafts POs per supplier; receiving them restocks', () => {
  const { app } = freshApp();
  const pos = app.autoReplenish('downtown');
  assert.ok(pos.length > 0);
  assert.equal(new Set(pos.map((p) => p.supplierId)).size, pos.length);
  // Draft POs count as inbound, so running again does not duplicate them.
  assert.equal(app.autoReplenish('downtown').length, 0);
  const meat = pos.find((p) => p.supplierId === 'prime-meats');
  const before = row(app, 'downtown', 'beef-patty').qty;
  const line = meat.lines.find((l) => l.ingredientId === 'beef-patty');
  app.sendPurchaseOrder(meat.id);
  app.receivePurchaseOrder(meat.id);
  assert.equal(row(app, 'downtown', 'beef-patty').qty, before + line.qty);
  assert.throws(() => app.receivePurchaseOrder(meat.id), (e) => e.status === 409);
});

test('transfer suggestions match surplus branches to shortages', () => {
  const { app } = freshApp();
  const s = app.suggestions().find((x) => x.ingredientId === 'beef-patty');
  assert.equal(s.fromBranchId, 'airport');
  assert.equal(s.toBranchId, 'downtown');
  assert.ok(s.qty > 0 && s.estimatedSavings > 0);
});

test('request → dispatch → receive moves stock and is recorded on the ledger', () => {
  const { app } = freshApp();
  const a0 = row(app, 'airport', 'tomato').qty;
  const d0 = row(app, 'downtown', 'tomato').qty;
  const blocks0 = app.ledgerBlocks().length;

  const req = app.requestTransfer({ branchId: 'downtown', fromBranchId: 'airport', lines: [{ ingredientId: 'tomato', qty: 10 }] });
  assert.equal(req.status, 'requested');
  assert.equal(row(app, 'airport', 'tomato').qty, a0);

  // Only the asked branch can fulfil.
  assert.throws(() => app.dispatchTransfer({ branchId: 'marina', transferId: req.id }), (e) => e.status === 403);
  const sent = app.dispatchTransfer({ branchId: 'airport', transferId: req.id });
  assert.equal(sent.status, 'in_transit');
  assert.equal(row(app, 'airport', 'tomato').qty, a0 - 10);
  assert.equal(row(app, 'downtown', 'tomato').incoming, 10);

  assert.throws(() => app.receiveTransfer(req.id, { branchId: 'airport' }), (e) => e.status === 403);
  const done = app.receiveTransfer(req.id, { branchId: 'downtown' });
  assert.equal(done.status, 'received');
  assert.equal(row(app, 'downtown', 'tomato').qty, d0 + 10);
  assert.throws(() => app.receiveTransfer(req.id, { branchId: 'downtown' }));

  assert.equal(app.ledgerBlocks().length, blocks0 + 3);
  assert.deepEqual(done.history.map((h) => h.by), ['downtown', 'airport', 'downtown']);
  assert.equal(app.verifyLedger().valid, true);
});

test('cannot dispatch more than the sender holds', () => {
  const { app } = freshApp();
  const have = row(app, 'marina', 'salmon').qty;
  assert.throws(() => app.dispatchTransfer({ branchId: 'marina', toBranchId: 'downtown', lines: [{ ingredientId: 'salmon', qty: have + 1 }] }), (e) => e.status === 409);
});

test('state persists and the chain re-verifies after restart', () => {
  const { app, dir } = freshApp();
  app.dispatchTransfer({ branchId: 'airport', toBranchId: 'downtown', lines: [{ ingredientId: 'rice', qty: 5 }] });
  const again = createApp({ dataDir: dir, now: () => NOW });
  assert.equal(again.ledgerBlocks().length, app.ledgerBlocks().length);
  assert.equal(again.verifyLedger().valid, true);
  assert.equal(row(again, 'airport', 'rice').qty, row(app, 'airport', 'rice').qty);
});

test('ledger detects tampering, forged signatures and unauthorised signers', () => {
  const hq = generateKeyPair();
  const a = generateKeyPair();
  const b = generateKeyPair();
  const ledger = Ledger.create({ hqKeys: hq, members: [{ branchId: 'a', publicKey: a.publicKey }, { branchId: 'b', publicKey: b.publicKey }], timestamp: 't0' });
  const lines = [{ ingredientId: 'x', qty: 5 }];
  ledger.append({ type: 'TRANSFER_DISPATCH', payload: { transferId: 't1', fromBranchId: 'a', toBranchId: 'b', lines } }, 'a', a.privateKey, 't1');
  ledger.append({ type: 'TRANSFER_RECEIVE', payload: { transferId: 't1', lines } }, 'b', b.privateKey, 't2');
  assert.equal(ledger.verify().valid, true);

  // Branch b cannot dispatch on behalf of branch a.
  assert.throws(() => ledger.append({ type: 'TRANSFER_DISPATCH', payload: { transferId: 't2', fromBranchId: 'a', toBranchId: 'b', lines } }, 'b', b.privateKey));
  // A key that does not belong to the claimed validator is rejected.
  assert.throws(() => ledger.append({ type: 'TRANSFER_DISPATCH', payload: { transferId: 't3', fromBranchId: 'a', toBranchId: 'b', lines } }, 'a', b.privateKey));

  // Editing a historical quantity breaks the hash.
  const tampered = structuredClone(ledger.chain);
  tampered[1].tx.payload.lines[0].qty = 500;
  assert.match(replay(tampered, hq.publicKey).errors[0], /hash mismatch/);

  // Recomputing the hash still fails: the signature no longer matches and the next block's link breaks.
  const { blockHash } = require('../src/blockchain');
  tampered[1].hash = blockHash(tampered[1]);
  assert.match(replay(tampered, hq.publicKey).errors[0], /invalid signature/);
});

test('consumption and availability calculations', () => {
  const menu = [{ id: 'm', recipe: [{ ingredientId: 'a', qty: 0.25 }, { ingredientId: 'b', qty: 2 }] }];
  assert.deepEqual(inv.consumptionFor(menu, [{ menuItemId: 'm', qty: 4 }]), { a: 1, b: 8 });
  const [av] = inv.menuAvailability(menu, { a: 1, b: 5 });
  assert.equal(av.portions, 2);
  assert.equal(av.limitingIngredient, 'b');
});

test('HTTP API serves overview and reports errors as JSON', async () => {
  const { app } = freshApp();
  const server = createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ov = await (await fetch(`${base}/api/overview`)).json();
    assert.equal(ov.branches.length, 3);
    assert.equal(ov.ledger.valid, true);
    const bad = await fetch(`${base}/api/branches/nowhere/inventory`);
    assert.equal(bad.status, 404);
    const res = await fetch(`${base}/api/branches/marina/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ menuItemId: 'fries', qty: 2 }] }) });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally {
    server.close();
  }
});
