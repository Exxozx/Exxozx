'use strict';
/**
 * Restaurant profile: who the restaurant is, its locations and tables, kitchenware and
 * utilities, ordering channels and the owner's preferences. Filled in once by the setup
 * wizard and editable at any time; every save is immediate so the wizard can be resumed.
 */
const { HttpError, round, uid, assert } = require('./util');
const { CHANNELS, DEFAULT_CHANNEL_CONFIG } = require('./integrations');
const inv = require('./inventory');

const EQUIPMENT_CATEGORIES = ['Cookware', 'Appliances', 'Utensils', 'Tableware', 'Cleaning', 'Utilities'];
const THEMES = ['system', 'light', 'dark'];
const ACCENTS = ['teal', 'saffron', 'indigo', 'rose', 'olive'];
const LANGUAGES = ['en', 'ar'];

function createProfileService(ctx) {
  const { save, iso, branch, text, number } = ctx;
  const db = () => ctx.db;

  function defaults() {
    return {
      setupComplete: false,
      setupStep: 0,
      cuisine: '',
      managerName: '',
      managerTitle: 'General Manager',
      phone: '',
      email: '',
      preferences: { theme: 'system', accent: 'teal', language: 'en' },
    };
  }

  function get() {
    const p = (db().profile ||= defaults());
    p.preferences ||= defaults().preferences;
    db().channels ||= DEFAULT_CHANNEL_CONFIG();
    db().equipment ||= [];
    return { ...p, restaurantName: db().meta.chainName, currency: db().meta.currency };
  }

  function update(body = {}) {
    get();
    const p = db().profile;
    if (body.restaurantName !== undefined) db().meta.chainName = text(body.restaurantName, 'Restaurant name', { max: 80 });
    if (body.currency !== undefined) db().meta.currency = text(body.currency, 'Currency', { max: 6 }).toUpperCase();
    for (const [k, label, max] of [['cuisine', 'Cuisine', 60], ['managerName', "Manager's name", 60], ['managerTitle', 'Job title', 60], ['phone', 'Phone', 30], ['email', 'Email', 120]]) {
      if (body[k] !== undefined) p[k] = text(body[k], label, { required: k === 'managerName' && body.requireManager, max });
    }
    if (body.email) assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email), 400, 'Email address looks incomplete');
    if (body.preferences) {
      const pr = body.preferences;
      if (pr.theme !== undefined) { assert(THEMES.includes(pr.theme), 400, 'Unknown theme'); p.preferences.theme = pr.theme; }
      if (pr.accent !== undefined) { assert(ACCENTS.includes(pr.accent), 400, 'Unknown accent colour'); p.preferences.accent = pr.accent; }
      if (pr.language !== undefined) { assert(LANGUAGES.includes(pr.language), 400, 'Unknown language'); p.preferences.language = pr.language; }
    }
    if (body.setupStep !== undefined) p.setupStep = Math.max(0, Math.floor(Number(body.setupStep) || 0));
    if (body.setupComplete !== undefined) {
      if (body.setupComplete) assert(p.managerName, 400, "Add the manager's name before finishing setup");
      p.setupComplete = Boolean(body.setupComplete);
      if (p.setupComplete) p.completedAt = iso();
    }
    save();
    return get();
  }

  function cleanTables(list) {
    assert(Array.isArray(list), 400, 'Tables must be a list');
    assert(list.length <= 300, 400, 'That is a lot of tables – up to 300 per location');
    const seen = new Set();
    return list.map((t, i) => {
      const label = text(t.label || `T${i + 1}`, 'Table name', { max: 20 });
      assert(!seen.has(label.toLowerCase()), 400, `Two tables are called ${label}`);
      seen.add(label.toLowerCase());
      return {
        id: t.id && /^[\w-]{1,40}$/.test(t.id) ? t.id : uid('tbl'),
        label,
        seats: Math.round(number(t.seats ?? 4, `Seats at ${label}`, { min: 1, max: 40 })),
        area: text(t.area || 'Indoor', 'Area', { required: false, max: 30 }) || 'Indoor',
      };
    });
  }

  function saveTables(branchId, list) {
    const b = branch(branchId);
    const next = cleanTables(list);
    const removed = (b.tables || []).filter((t) => !next.some((n) => n.id === t.id));
    const busy = removed.find((t) => db().orders.some((o) => o.tableId === t.id && ['received', 'accepted', 'preparing', 'ready'].includes(o.status)));
    assert(!busy, 409, `Table ${busy?.label} has an open order – close it before removing the table`);
    b.tables = next;
    save();
    return b.tables;
  }

  /** Upsert every location in one go (the wizard's "Locations & tables" step). */
  function saveBranches(list) {
    assert(Array.isArray(list) && list.length > 0, 400, 'Add at least one location');
    const keep = new Set(list.filter((b) => b.id).map((b) => b.id));
    for (const b of db().branches.filter((x) => !keep.has(x.id))) ctx.deleteBranch(b.id);
    for (const item of list) {
      const data = { name: item.name, location: item.location };
      const b = item.id ? ctx.updateBranch(item.id, data) : ctx.createBranch(data);
      b.phone = text(item.phone, 'Phone', { required: false, max: 30 });
      b.hours = text(item.hours, 'Opening hours', { required: false, max: 60 });
      if (item.tables) saveTables(b.id, item.tables);
    }
    save();
    return db().branches;
  }

  /** Upsert ingredients with their on-hand stock per branch (the wizard's "Stock" step). */
  function saveIngredients(rows) {
    assert(Array.isArray(rows), 400, 'Ingredients must be a list');
    const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
    for (const ing of db().ingredients.filter((i) => !keep.has(i.id))) ctx.deleteIngredient(ing.id);
    for (const r of rows) {
      const ing = ctx.saveIngredient(r.id || null, r);
      for (const [branchId, qty] of Object.entries(r.stock || {})) {
        if (qty === '' || qty == null) continue;
        branch(branchId);
        const q = number(qty, `${ing.name} stock`);
        const s = (db().stock[branchId] ||= {});
        if ((s[ing.id] || 0) !== q) {
          db().adjustments.push({ id: uid('adj'), branchId, ingredientId: ing.id, before: s[ing.id] || 0, after: round(q, 3), reason: 'profile setup', at: iso() });
          s[ing.id] = round(q, 3);
        }
      }
    }
    save();
    return db().ingredients;
  }

  function saveEquipment(rows) {
    assert(Array.isArray(rows), 400, 'Kitchenware must be a list');
    const branchIds = new Set(db().branches.map((b) => b.id));
    db().equipment = rows.map((r) => {
      const name = text(r.name, 'Item name', { max: 60 });
      const category = EQUIPMENT_CATEGORIES.includes(r.category) ? r.category : 'Cookware';
      const counts = {};
      for (const [b, q] of Object.entries(r.counts || {})) if (branchIds.has(b) && q !== '' && q != null) counts[b] = Math.round(number(q, `${name} count`));
      return { id: r.id || uid('eq'), name, category, counts, minimum: r.minimum === '' || r.minimum == null ? null : Math.round(number(r.minimum, `${name} minimum`)) };
    });
    save();
    return db().equipment;
  }

  function updateChannels(body = {}) {
    get();
    const ch = db().channels;
    for (const [id, c] of Object.entries(body)) {
      assert(CHANNELS[id], 400, `Unknown channel: ${id}`);
      const cur = (ch[id] ||= {});
      if (c.enabled !== undefined) cur.enabled = Boolean(c.enabled);
      if (c.autoAccept !== undefined) cur.autoAccept = Boolean(c.autoAccept);
      if (c.prepMinutes !== undefined) cur.prepMinutes = Math.round(number(c.prepMinutes, 'Preparation time', { min: 1, max: 240 }));
      if (c.storeIds) {
        cur.storeIds = {};
        for (const [b, sid] of Object.entries(c.storeIds)) {
          branch(b);
          const v = text(sid, 'Store ID', { required: false, max: 60 });
          if (v) cur.storeIds[b] = v;
        }
      }
    }
    save();
    return ch;
  }

  /** Everything the welcome screen shows, in one call. */
  function summary(nowMs) {
    const p = get();
    const d = db();
    const since = nowMs - 14 * 24 * 3600 * 1000;
    const dayStart = new Date(nowMs);
    dayStart.setHours(0, 0, 0, 0);
    const sold = new Map();
    const today = { orders: 0, revenue: 0, byChannel: {} };
    let active = 0;
    for (const o of d.orders) {
      const t = Date.parse(o.at);
      const counted = !['rejected', 'cancelled'].includes(o.status);
      if (counted && t >= since) for (const i of o.items) sold.set(i.menuItemId, (sold.get(i.menuItemId) || 0) + i.qty);
      if (counted && t >= dayStart.getTime()) {
        today.orders++;
        today.revenue += o.total;
        const ch = o.channel || 'dine_in';
        today.byChannel[ch] = (today.byChannel[ch] || 0) + 1;
      }
      if (['received', 'accepted', 'preparing', 'ready'].includes(o.status)) active++;
    }
    const dishes = new Map(d.menu.map((m) => [m.id, m]));
    const bestSellers = [...sold].filter(([id]) => dishes.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, qty]) => ({ menuItemId: id, name: dishes.get(id).name, qty }));
    const categories = {};
    for (const m of d.menu) categories[m.category || 'Menu'] = (categories[m.category || 'Menu'] || 0) + 1;

    const locations = d.branches.map((b) => {
      const rows = ctx.inventory(b.id);
      const count = (s) => rows.filter((r) => r.status === s).length;
      const tables = b.tables || [];
      return {
        id: b.id, name: b.name, location: b.location, phone: b.phone || '', hours: b.hours || '',
        tables: tables.length, seats: tables.reduce((s, t) => s + t.seats, 0),
        occupied: new Set(d.orders.filter((o) => o.branchId === b.id && o.tableId && ['received', 'accepted', 'preparing', 'ready'].includes(o.status)).map((o) => o.tableId)).size,
        stock: { items: rows.length, short: count('out') + count('critical') + count('low'), excess: count('excess'), healthy: count('ok'), value: round(rows.reduce((s, r) => s + r.stockValue, 0), 2) },
      };
    });

    const byCat = {};
    const lowEquipment = [];
    for (const e of d.equipment || []) {
      const total = Object.values(e.counts).reduce((s, q) => s + q, 0);
      byCat[e.category] = (byCat[e.category] || 0) + total;
      if (e.minimum != null) for (const b of d.branches) if ((e.counts[b.id] || 0) < e.minimum) lowEquipment.push({ name: e.name, branchId: b.id, branchName: b.name, have: e.counts[b.id] || 0, minimum: e.minimum });
    }

    const channels = Object.values(CHANNELS).map((c) => ({
      id: c.id, name: c.name, kind: c.kind,
      enabled: Boolean(d.channels[c.id]?.enabled),
      linkedStores: Object.keys(d.channels[c.id]?.storeIds || {}).length,
      today: today.byChannel[c.id] || 0,
    }));

    return {
      profile: p,
      locations,
      menu: { dishes: d.menu.length, categories, averagePrice: d.menu.length ? round(d.menu.reduce((s, m) => s + m.price, 0) / d.menu.length, 2) : 0, picks: d.menu.filter((m) => m.popular).map((m) => ({ menuItemId: m.id, name: m.name, price: m.price })) },
      bestSellers,
      stock: { ingredients: d.ingredients.length, value: round(locations.reduce((s, l) => s + l.stock.value, 0), 2), short: locations.reduce((s, l) => s + l.stock.short, 0) },
      kitchenware: { items: (d.equipment || []).length, byCategory: byCat, low: lowEquipment },
      channels,
      today: { ...today, revenue: round(today.revenue, 2), active },
    };
  }

  return { get, update, saveTables, saveBranches, saveIngredients, saveEquipment, updateChannels, summary, EQUIPMENT_CATEGORIES };
}

module.exports = { createProfileService, EQUIPMENT_CATEGORIES, THEMES, ACCENTS, LANGUAGES };
