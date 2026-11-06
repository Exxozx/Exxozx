'use strict';
const fs = require('fs');
const path = require('path');
const { HttpError, DAY_MS, round, uid, assert } = require('./util');
const { Ledger, HQ, generateKeyPair } = require('./blockchain');
const inv = require('./inventory');
const { buildSeedData } = require('./seed');
const { createPriceFeed, simulatedSource, httpSource } = require('./prices');

const OPEN_PO = ['draft', 'sent'];

function createApp({
  dataDir,
  now = () => Date.now(),
  livePrices = false,
  priceFeedUrl,
  priceIntervalMs = 5000,
  onPriceTick = () => {},
} = {}) {
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
      reseed();
    }
  }

  function reset() {
    reseed();
    feed.reset();
    feed.warmup();
    return overview();
  }

  function reseed() {
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

  // ---------- editable master data (menu, ingredients, suppliers, branches) ----------
  const slug = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  function uniqueId(list, name) {
    const base = slug(name);
    let id = base;
    for (let n = 2; list.some((x) => x.id === id); n++) id = `${base}-${n}`;
    return id;
  }
  function text(v, field, { required = true, max = 80 } = {}) {
    const out = String(v ?? '').trim();
    assert(!required || out, 400, `${field} is required`);
    assert(out.length <= max, 400, `${field} must be at most ${max} characters`);
    return out;
  }
  function number(v, field, { min = 0, max = Infinity, gt = false } = {}) {
    const n = Number(v);
    assert(v !== '' && v !== null && Number.isFinite(n) && (gt ? n > min : n >= min) && n <= max, 400,
      `${field} must be a number ${gt ? '>' : '≥'} ${min}${max !== Infinity ? ` and ≤ ${max}` : ''}`);
    return n;
  }
  const find404 = (list, id, what) => {
    const x = list.find((i) => i.id === id);
    assert(x, 404, `Unknown ${what}: ${id}`);
    return x;
  };
  const openTransfersWith = (ingredientId) =>
    ledger.transfers().some((t) => ['requested', 'in_transit'].includes(t.status) && t.lines.some((l) => l.ingredientId === ingredientId));

  function saveIngredient(id, body = {}) {
    const data = {
      name: text(body.name, 'Name'),
      unit: text(body.unit, 'Unit', { max: 12 }),
      category: text(body.category, 'Category', { max: 40 }),
      shelfLifeDays: number(body.shelfLifeDays, 'Shelf life (days)', { min: 0, gt: true }),
    };
    if (id) {
      const ing = find404(db.ingredients, id, 'ingredient');
      Object.assign(ing, data);
      save();
      return ing;
    }
    const ing = { id: uniqueId(db.ingredients, data.name), ...data };
    db.ingredients.push(ing);
    for (const b of db.branches) stockOf(b.id)[ing.id] = 0;
    save();
    return ing;
  }

  function deleteIngredient(id) {
    find404(db.ingredients, id, 'ingredient');
    const usedIn = db.menu.filter((m) => m.recipe.some((r) => r.ingredientId === id)).map((m) => m.name);
    assert(!usedIn.length, 409, `Still used in: ${usedIn.join(', ')}. Remove it from those recipes first.`);
    assert(!db.purchaseOrders.some((p) => OPEN_PO.includes(p.status) && p.lines.some((l) => l.ingredientId === id)), 409,
      'There are open purchase orders for this ingredient');
    assert(!openTransfersWith(id), 409, 'There are open transfers for this ingredient');
    db.ingredients = db.ingredients.filter((i) => i.id !== id);
    for (const s of db.suppliers) s.catalog = s.catalog.filter((c) => c.ingredientId !== id);
    for (const b of Object.keys(db.stock)) delete db.stock[b][id];
    save();
    return { deleted: id };
  }

  function cleanRecipe(recipe) {
    assert(Array.isArray(recipe) && recipe.length > 0, 400, 'A dish needs at least one ingredient in its recipe');
    const merged = new Map();
    for (const r of recipe) {
      ingredient(r.ingredientId);
      merged.set(r.ingredientId, round((merged.get(r.ingredientId) || 0) + number(r.qty, `Quantity of ${r.ingredientId}`, { gt: true }), 4));
    }
    return [...merged].map(([ingredientId, qty]) => ({ ingredientId, qty }));
  }

  function saveMenuItem(id, body = {}) {
    const data = {
      name: text(body.name, 'Dish name'),
      price: round(number(body.price, 'Price'), 2),
      recipe: cleanRecipe(body.recipe),
    };
    if (id) {
      const m = find404(db.menu, id, 'menu item');
      Object.assign(m, data);
      save();
      return m;
    }
    const m = { id: uniqueId(db.menu, data.name), ...data };
    db.menu.push(m);
    save();
    return m;
  }

  function deleteMenuItem(id) {
    find404(db.menu, id, 'menu item');
    db.menu = db.menu.filter((m) => m.id !== id);
    save();
    return { deleted: id };
  }

  function cleanCatalog(catalog = [], existing = []) {
    assert(Array.isArray(catalog), 400, 'Catalog must be a list');
    const seen = new Set();
    return catalog.map((c) => {
      ingredient(c.ingredientId);
      assert(!seen.has(c.ingredientId), 400, `${ingName(c.ingredientId)} is listed twice`);
      seen.add(c.ingredientId);
      const listPrice = round(number(c.unitPrice, `Price of ${ingName(c.ingredientId)}`, { gt: true }), 2);
      const prev = existing.find((x) => x.ingredientId === c.ingredientId);
      // Editing the list price resets the live quote to it; otherwise keep the live price running.
      const unchanged = prev && (prev.basePrice ?? prev.unitPrice) === listPrice;
      return {
        ingredientId: c.ingredientId,
        unitPrice: unchanged ? prev.unitPrice : listPrice,
        basePrice: listPrice,
        leadTimeDays: number(c.leadTimeDays, 'Lead time (days)'),
        minOrderQty: number(c.minOrderQty ?? 0, 'Minimum order'),
      };
    });
  }
  const ingName = (id) => db.ingredients.find((i) => i.id === id)?.name || id;

  function saveSupplier(id, body = {}) {
    const existing = id ? find404(db.suppliers, id, 'supplier') : null;
    const data = {
      name: text(body.name, 'Supplier name'),
      contact: text(body.contact, 'Contact', { required: false, max: 120 }),
      rating: round(number(body.rating ?? 0, 'Rating', { max: 5 }), 1),
      onTimeRate: round(number(body.onTimeRate ?? 0.9, 'On-time rate', { max: 1 }), 3),
      trusted: Boolean(body.trusted),
      catalog: cleanCatalog(body.catalog, existing?.catalog),
    };
    if (existing) {
      Object.assign(existing, data);
      save();
      return existing;
    }
    const s = { id: uniqueId(db.suppliers, data.name), ...data };
    db.suppliers.push(s);
    save();
    return s;
  }

  function deleteSupplier(id) {
    find404(db.suppliers, id, 'supplier');
    assert(!db.purchaseOrders.some((p) => p.supplierId === id && OPEN_PO.includes(p.status)), 409,
      'This supplier has open purchase orders. Receive or cancel them first.');
    db.suppliers = db.suppliers.filter((s) => s.id !== id);
    save();
    return { deleted: id };
  }

  /** New branches get their own signing key and are admitted to the ledger by HQ. */
  function createBranch(body = {}) {
    const name = text(body.name, 'Branch name', { max: 60 });
    const location = text(body.location, 'Location', { required: false, max: 80 });
    const id = uniqueId([...db.branches, ...[...ledger.state.members.keys()].map((k) => ({ id: k }))], name);
    keys.branches[id] = generateKeyPair();
    writeAtomic(keyFile, keys);
    ledger.append({ type: 'MEMBER_ADD', payload: { members: [{ branchId: id, name, publicKey: keys.branches[id].publicKey }] } }, HQ, keys.hq.privateKey, iso());
    const b = { id, name, location, settings: { safetyDays: 2, targetDays: 5, maxDays: 14 } };
    db.branches.push(b);
    db.stock[id] = Object.fromEntries(db.ingredients.map((i) => [i.id, 0]));
    save();
    return b;
  }

  function updateBranch(id, body = {}) {
    const b = branch(id);
    if (body.name !== undefined) b.name = text(body.name, 'Branch name', { max: 60 });
    if (body.location !== undefined) b.location = text(body.location, 'Location', { required: false, max: 80 });
    save();
    return b;
  }

  function updateMeta(body = {}) {
    if (body.chainName !== undefined) db.meta.chainName = text(body.chainName, 'Business name', { max: 80 });
    if (body.currency !== undefined) db.meta.currency = text(body.currency, 'Currency', { max: 6 }).toUpperCase();
    save();
    return db.meta;
  }

  // ---------- export / import (work on a draft data set, share it, load it back) ----------
  const DATA_KEYS = ['meta', 'branches', 'ingredients', 'menu', 'suppliers', 'stock', 'orders', 'adjustments', 'purchaseOrders'];

  function exportData() {
    return {
      format: 'stockchain/v1',
      exportedAt: iso(),
      data: Object.fromEntries(DATA_KEYS.map((k) => [k, db[k]])),
      ledger: ledger.chain, // for reference; signatures cannot be re-used without the original keys
    };
  }

  function importData(file = {}) {
    const d = file.data || file;
    for (const k of ['branches', 'ingredients', 'menu', 'suppliers']) assert(Array.isArray(d[k]), 400, `Import is missing "${k}"`);
    assert(d.branches.length > 0, 400, 'Import needs at least one branch');
    const ingIds = new Set(d.ingredients.map((i) => i.id));
    for (const m of d.menu) {
      for (const r of m.recipe || []) assert(ingIds.has(r.ingredientId), 400, `Dish "${m.name}" uses unknown ingredient ${r.ingredientId}`);
    }
    for (const s of d.suppliers) {
      for (const c of s.catalog || []) assert(ingIds.has(c.ingredientId), 400, `Supplier "${s.name}" lists unknown ingredient ${c.ingredientId}`);
    }
    const next = {
      meta: { chainName: 'My Restaurant Group', currency: 'AED', ...(d.meta || {}), importedAt: iso() },
      branches: d.branches.map((b) => ({ location: '', ...b, settings: { safetyDays: 2, targetDays: 5, maxDays: 14, ...(b.settings || {}) } })),
      ingredients: d.ingredients,
      menu: d.menu,
      suppliers: d.suppliers.map((s) => ({ contact: '', rating: 0, onTimeRate: 0.9, trusted: false, catalog: [], ...s })),
      stock: d.stock || {},
      orders: d.orders || [],
      adjustments: d.adjustments || [],
      purchaseOrders: d.purchaseOrders || [],
      chain: [],
    };
    for (const b of next.branches) next.stock[b.id] ||= {};
    // A fresh ledger is started: private keys are never exported, so old blocks can't be re-signed.
    db = next;
    keys = { hq: generateKeyPair(), branches: {} };
    for (const b of db.branches) keys.branches[b.id] = generateKeyPair();
    db.hqPublicKey = keys.hq.publicKey;
    ledger = Ledger.create({
      hqKeys: keys.hq,
      members: db.branches.map((b) => ({ branchId: b.id, name: b.name, publicKey: keys.branches[b.id].publicKey })),
      timestamp: iso(),
    });
    writeAtomic(keyFile, keys);
    save();
    feed.reset();
    feed.warmup();
    return overview();
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

  // ---------- live prices ----------
  let lastPriceSave = 0;
  const feed = createPriceFeed({
    getDb: () => db,
    source: priceFeedUrl ? httpSource(priceFeedUrl) : simulatedSource(),
    now,
    intervalMs: priceIntervalMs,
    onTick: (snap) => {
      if (Date.now() - lastPriceSave > 30000) {
        lastPriceSave = Date.now();
        save();
      }
      onPriceTick(snap);
    },
  });

  load();
  feed.warmup();
  if (livePrices) feed.start();

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
    saveIngredient, deleteIngredient, saveMenuItem, deleteMenuItem, saveSupplier, deleteSupplier,
    createBranch, updateBranch, updateMeta, exportData, importData,
    prices: {
      snapshot: () => feed.snapshot(),
      tick: () => feed.tick(),
      start: () => (feed.start(), feed.snapshot().status),
      stop: () => (feed.stop(), feed.snapshot().status),
    },
    close: () => feed.stop(),
    HQ,
  };
}

module.exports = { createApp };
