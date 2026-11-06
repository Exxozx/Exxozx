'use strict';
const fs = require('fs');
const path = require('path');
const { HttpError, DAY_MS, round, uid, assert } = require('./util');
const { Ledger, HQ, generateKeyPair } = require('./blockchain');
const inv = require('./inventory');
const { buildSeedData } = require('./seed');

const OPEN_PO = ['draft', 'sent'];

function createApp({ dataDir, now = () => Date.now() } = {}) {
  const dbFile = path.join(dataDir, 'db.json');
  // Private keys are kept apart from the shared data. In production each branch
  // would hold only its own key (e.g. in an HSM / KMS) and HQ's key stays at HQ.
  const keyFile = path.join(dataDir, 'keys.json');
  let db;
  let keys;
  let ledger;

  const iso = () => new Date(now()).toISOString();

  function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  }

  function save() {
    db.chain = ledger.chain;
    writeAtomic(dbFile, db);
  }

  function load() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(dbFile) && fs.existsSync(keyFile)) {
      db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      keys = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      ledger = new Ledger(db.chain, db.hqPublicKey);
    } else {
      reset();
    }
  }

  function reset() {
    db = buildSeedData(now());
    keys = { hq: generateKeyPair(), branches: {} };
    for (const b of db.branches) keys.branches[b.id] = generateKeyPair();
    db.hqPublicKey = keys.hq.publicKey;
    const t0 = new Date(now() - 15 * DAY_MS).toISOString();
    ledger = Ledger.create({
      hqKeys: keys.hq,
      members: db.branches.map((b) => ({ branchId: b.id, name: b.name, publicKey: keys.branches[b.id].publicKey })),
      timestamp: t0,
    });
    fs.mkdirSync(dataDir, { recursive: true });
    writeAtomic(keyFile, keys);
    save();
    seedActivity();
    return overview();
  }

  /** A little ledger + purchasing history so every state is visible in the demo. */
  function seedActivity() {
    const t = dispatchTransfer({ branchId: 'marina', toBranchId: 'downtown', lines: [{ ingredientId: 'cheddar', qty: 2 }], note: 'Weekend top-up' });
    receiveTransfer(t.id, { branchId: 'downtown' });
    dispatchTransfer({ branchId: 'airport', toBranchId: 'marina', lines: [{ ingredientId: 'flour', qty: 10 }], note: 'Surplus flour' });
    requestTransfer({ branchId: 'downtown', fromBranchId: 'marina', lines: [{ ingredientId: 'salmon', qty: 1.5 }], note: 'Dinner rush' });
    const po = createPurchaseOrder({ branchId: 'downtown', supplierId: 'al-noor-dairy', lines: [{ ingredientId: 'mozzarella', qty: 20 }] });
    sendPurchaseOrder(po.id);
  }

  // ---------- lookups ----------
  const branch = (id) => {
    const b = db.branches.find((x) => x.id === id);
    assert(b, 404, `Unknown branch: ${id}`);
    return b;
  };
  const ingredient = (id) => {
    const i = db.ingredients.find((x) => x.id === id);
    assert(i, 400, `Unknown ingredient: ${id}`);
    return i;
  };
  const supplier = (id) => {
    const s = db.suppliers.find((x) => x.id === id);
    assert(s, 404, `Unknown supplier: ${id}`);
    return s;
  };
  const purchaseOrder = (id) => {
    const p = db.purchaseOrders.find((x) => x.id === id);
    assert(p, 404, `Unknown purchase order: ${id}`);
    return p;
  };
  const stockOf = (branchId) => (db.stock[branchId] ||= {});

  function normaliseLines(lines) {
    assert(Array.isArray(lines) && lines.length > 0, 400, 'At least one line is required');
    const merged = new Map();
    for (const l of lines) {
      ingredient(l.ingredientId);
      const qty = Number(l.qty);
      assert(Number.isFinite(qty) && qty > 0, 400, `Quantity for ${l.ingredientId} must be positive`);
      merged.set(l.ingredientId, round((merged.get(l.ingredientId) || 0) + qty, 3));
    }
    return [...merged].map(([ingredientId, qty]) => ({ ingredientId, qty }));
  }

  function requireStock(branchId, lines) {
    const stock = stockOf(branchId);
    const shortages = lines
      .filter((l) => (stock[l.ingredientId] || 0) + 1e-9 < l.qty)
      .map((l) => ({ ingredientId: l.ingredientId, needed: l.qty, available: round(stock[l.ingredientId] || 0, 3) }));
    assert(shortages.length === 0, 409, 'Insufficient stock', { shortages });
  }

  function moveStock(branchId, lines, sign) {
    const stock = stockOf(branchId);
    for (const l of lines) stock[l.ingredientId] = round((stock[l.ingredientId] || 0) + sign * l.qty, 3);
  }

  // ---------- inventory ----------
  function incomingFor(branchId) {
    const incoming = {};
    const add = (id, q) => (incoming[id] = (incoming[id] || 0) + q);
    for (const po of db.purchaseOrders) {
      if (po.branchId === branchId && OPEN_PO.includes(po.status)) po.lines.forEach((l) => add(l.ingredientId, l.qty));
    }
    for (const t of ledger.transfers()) {
      if (t.toBranchId === branchId && t.status === 'in_transit') t.lines.forEach((l) => add(l.ingredientId, l.qty));
    }
    return incoming;
  }

  function inventory(branchId) {
    branch(branchId);
    return inv.branchReport({ db, branchId, now: now(), incoming: incomingFor(branchId) });
  }

  function adjustStock(branchId, { ingredientId, countedQty, delta, reason = 'manual' }) {
    branch(branchId);
    ingredient(ingredientId);
    const stock = stockOf(branchId);
    const before = stock[ingredientId] || 0;
    let after;
    if (countedQty !== undefined) after = Number(countedQty);
    else after = before + Number(delta);
    assert(Number.isFinite(after) && after >= 0, 400, 'Resulting quantity must be a non-negative number');
    stock[ingredientId] = round(after, 3);
    const entry = { id: uid('adj'), branchId, ingredientId, before, after: stock[ingredientId], reason, at: iso() };
    db.adjustments.push(entry);
    save();
    return entry;
  }

  function updateSettings(branchId, settings) {
    const b = branch(branchId);
    for (const k of ['safetyDays', 'targetDays', 'maxDays']) {
      if (settings[k] !== undefined) {
        const v = Number(settings[k]);
        assert(Number.isFinite(v) && v >= 0, 400, `${k} must be a non-negative number`);
        b.settings[k] = v;
      }
    }
    save();
    return b;
  }

  // ---------- orders ----------
  function placeOrder(branchId, { items }) {
    branch(branchId);
    assert(Array.isArray(items) && items.length > 0, 400, 'Order must contain items');
    const clean = items
      .map((i) => ({ menuItemId: i.menuItemId, qty: Math.floor(Number(i.qty)) }))
      .filter((i) => i.qty > 0);
    assert(clean.length > 0, 400, 'Order must contain at least one item with positive quantity');
    let consumption;
    try {
      consumption = inv.consumptionFor(db.menu, clean);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const lines = Object.entries(consumption).map(([ingredientId, qty]) => ({ ingredientId, qty }));
    requireStock(branchId, lines);
    moveStock(branchId, lines, -1);
    const total = clean.reduce((s, i) => s + i.qty * db.menu.find((m) => m.id === i.menuItemId).price, 0);
    const order = { id: uid('ord'), branchId, at: iso(), items: clean, total, consumption, source: 'pos' };
    db.orders.push(order);
    save();
    return order;
  }

  function listOrders(branchId, limit = 25) {
    return db.orders.filter((o) => !branchId || o.branchId === branchId).slice(-limit).reverse();
  }

  function menuAvailability(branchId) {
    branch(branchId);
    return inv.menuAvailability(db.menu, stockOf(branchId));
  }

  // ---------- suppliers & purchase orders ----------
  function updateSupplier(id, patch) {
    const s = supplier(id);
    if (patch.trusted !== undefined) s.trusted = Boolean(patch.trusted);
    save();
    return s;
  }

  function createPurchaseOrder({ branchId, supplierId, lines, auto = false }) {
    branch(branchId);
    const s = supplier(supplierId);
    assert(s.trusted, 403, `${s.name} is not a trusted supplier`);
    const clean = normaliseLines(lines).map((l) => {
      const item = s.catalog.find((c) => c.ingredientId === l.ingredientId);
      assert(item, 400, `${s.name} does not supply ${l.ingredientId}`);
      return { ...l, unitPrice: item.unitPrice, leadTimeDays: item.leadTimeDays };
    });
    const po = {
      id: uid('po'),
      branchId,
      supplierId,
      supplierName: s.name,
      lines: clean,
      total: round(clean.reduce((sum, l) => sum + l.qty * l.unitPrice, 0), 2),
      status: 'draft',
      auto,
      createdAt: iso(),
    };
    db.purchaseOrders.push(po);
    save();
    return po;
  }

  /** Create draft POs (one per trusted supplier) for everything below its reorder point. */
  function autoReplenish(branchId) {
    const bySupplier = new Map();
    for (const r of inventory(branchId)) {
      if (r.recommendedOrderQty > 0 && r.supplier) {
        if (!bySupplier.has(r.supplier.id)) bySupplier.set(r.supplier.id, []);
        bySupplier.get(r.supplier.id).push({ ingredientId: r.ingredientId, qty: r.recommendedOrderQty });
      }
    }
    return [...bySupplier].map(([supplierId, lines]) => createPurchaseOrder({ branchId, supplierId, lines, auto: true }));
  }

  /**
   * Transmit a PO to the supplier. This simulates the supplier integration; in
   * production this is where an EDI / API adapter per supplier would be called.
   */
  function sendPurchaseOrder(id) {
    const po = purchaseOrder(id);
    assert(po.status === 'draft', 409, `Purchase order is ${po.status}`);
    const s = supplier(po.supplierId);
    assert(s.trusted, 403, `${s.name} is no longer a trusted supplier`);
    const lead = Math.max(...po.lines.map((l) => l.leadTimeDays));
    po.status = 'sent';
    po.sentAt = iso();
    po.expectedAt = new Date(now() + lead * DAY_MS).toISOString();
    po.confirmation = `${s.id.slice(0, 3).toUpperCase()}-${uid('').slice(1).toUpperCase()}`;
    save();
    return po;
  }

  function receivePurchaseOrder(id) {
    const po = purchaseOrder(id);
    assert(po.status === 'sent', 409, `Only sent purchase orders can be received (this one is ${po.status})`);
    moveStock(po.branchId, po.lines, +1);
    po.status = 'received';
    po.receivedAt = iso();
    save();
    return po;
  }

  function cancelPurchaseOrder(id) {
    const po = purchaseOrder(id);
    assert(OPEN_PO.includes(po.status), 409, `Purchase order is already ${po.status}`);
    po.status = 'cancelled';
    po.cancelledAt = iso();
    save();
    return po;
  }

  function listPurchaseOrders(branchId) {
    return db.purchaseOrders.filter((p) => !branchId || p.branchId === branchId).slice().reverse();
  }

  // ---------- inter-branch transfers (on the ledger) ----------
  function signAs(branchId, tx) {
    branch(branchId);
    try {
      return ledger.append(tx, branchId, keys.branches[branchId].privateKey, iso());
    } catch (e) {
      throw new HttpError(e.status || 400, e.message);
    }
  }

  const transfer = (id) => {
    const t = ledger.getTransfer(id);
    assert(t, 404, `Unknown transfer: ${id}`);
    return t;
  };

  /** Receiving branch asks another branch for stock. No stock moves yet. */
  function requestTransfer({ branchId, fromBranchId, lines, note }) {
    branch(fromBranchId);
    assert(branchId !== fromBranchId, 400, 'Cannot request stock from yourself');
    const transferId = uid('trf');
    signAs(branchId, { type: 'TRANSFER_REQUEST', payload: { transferId, fromBranchId, toBranchId: branchId, lines: normaliseLines(lines), note } });
    save();
    return transfer(transferId);
  }

  /** Sending branch ships stock (new, or fulfilling a request). Stock leaves the sender now. */
  function dispatchTransfer({ branchId, toBranchId, lines, note, transferId }) {
    let existing;
    if (transferId) {
      existing = transfer(transferId);
      assert(existing.fromBranchId === branchId, 403, 'Only the asked branch can fulfil this request');
      toBranchId = existing.toBranchId;
      lines = lines || existing.lines;
    }
    branch(toBranchId);
    assert(branchId !== toBranchId, 400, 'Cannot send stock to yourself');
    const clean = normaliseLines(lines);
    requireStock(branchId, clean);
    const id = transferId || uid('trf');
    signAs(branchId, { type: 'TRANSFER_DISPATCH', payload: { transferId: id, fromBranchId: branchId, toBranchId, lines: clean, note: note ?? existing?.note } });
    moveStock(branchId, clean, -1);
    save();
    return transfer(id);
  }

  /** Receiving branch confirms arrival. Stock is added to the receiver. */
  function receiveTransfer(id, { branchId }) {
    const t = transfer(id);
    assert(t.toBranchId === branchId, 403, 'Only the receiving branch can confirm receipt');
    signAs(branchId, { type: 'TRANSFER_RECEIVE', payload: { transferId: id, lines: t.lines } });
    moveStock(branchId, t.lines, +1);
    save();
    return transfer(id);
  }

  function rejectTransfer(id, { branchId, reason }) {
    assert(transfer(id).fromBranchId === branchId, 403, 'Only the asked branch can reject');
    signAs(branchId, { type: 'TRANSFER_REJECT', payload: { transferId: id, reason } });
    save();
    return transfer(id);
  }

  function cancelTransfer(id, { branchId }) {
    assert(transfer(id).toBranchId === branchId, 403, 'Only the requesting branch can cancel');
    signAs(branchId, { type: 'TRANSFER_CANCEL', payload: { transferId: id } });
    save();
    return transfer(id);
  }

  function listTransfers(branchId) {
    return ledger
      .transfers()
      .filter((t) => !branchId || t.fromBranchId === branchId || t.toBranchId === branchId)
      .reverse();
  }

  function allReports() {
    return Object.fromEntries(db.branches.map((b) => [b.id, inventory(b.id)]));
  }

  function suggestions() {
    return inv.transferSuggestions(allReports());
  }

  function ledgerBlocks() {
    return ledger.chain.slice().reverse();
  }

  // ---------- overview ----------
  function overview() {
    const reports = allReports();
    const cutoff = now() - DAY_MS;
    const branches = db.branches.map((b) => {
      const rows = reports[b.id];
      const count = (s) => rows.filter((r) => r.status === s).length;
      const recent = db.orders.filter((o) => o.branchId === b.id && Date.parse(o.at) >= cutoff);
      return {
        id: b.id,
        name: b.name,
        location: b.location,
        settings: b.settings,
        counts: { out: count('out'), critical: count('critical'), low: count('low'), ok: count('ok'), excess: count('excess'), idle: count('idle') },
        stockValue: round(rows.reduce((s, r) => s + r.stockValue, 0), 2),
        openPurchaseOrders: db.purchaseOrders.filter((p) => p.branchId === b.id && OPEN_PO.includes(p.status)).length,
        inboundTransfers: ledger.transfers().filter((t) => t.toBranchId === b.id && t.status === 'in_transit').length,
        pendingRequests: ledger.transfers().filter((t) => t.fromBranchId === b.id && t.status === 'requested').length,
        revenue24h: recent.reduce((s, o) => s + o.total, 0),
        orders24h: recent.length,
      };
    });
    return {
      meta: db.meta,
      branches,
      suggestions: inv.transferSuggestions(reports),
      ledger: ledger.verify(),
    };
  }

  load();

  return {
    get db() { return db; },
    get ledger() { return ledger; },
    reset, overview,
    branches: () => db.branches,
    ingredients: () => db.ingredients,
    menu: () => db.menu,
    suppliers: () => db.suppliers,
    inventory, adjustStock, updateSettings,
    placeOrder, listOrders, menuAvailability,
    updateSupplier, createPurchaseOrder, autoReplenish, sendPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder, listPurchaseOrders,
    requestTransfer, dispatchTransfer, receiveTransfer, rejectTransfer, cancelTransfer, listTransfers, suggestions,
    ledgerBlocks, verifyLedger: () => ledger.verify(),
    HQ,
  };
}

module.exports = { createApp };
