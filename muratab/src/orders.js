'use strict';
/**
 * Order hub: one lifecycle for every channel (dine-in, takeaway, delivery apps, website).
 *
 *   received ──accept──> accepted ──start──> preparing ──ready──> ready ──complete──> completed
 *      └──reject──> rejected          └───────────cancel───────────┘──> cancelled
 *
 * Stock is deducted when an order is accepted (the kitchen commits to it), and given
 * back if it is cancelled before cooking starts. Each change on a delivery-app order
 * is reported back to that platform through its adapter (see integrations.js).
 */
const { HttpError, round, uid, assert } = require('./util');
const inv = require('./inventory');
const { CHANNELS, ADAPTERS } = require('./integrations');

const ACTIVE = ['received', 'accepted', 'preparing', 'ready'];
const FLOW = {
  accept: { from: ['received'], to: 'accepted', event: 'accepted' },
  start: { from: ['accepted'], to: 'preparing', event: 'preparing' },
  ready: { from: ['accepted', 'preparing'], to: 'ready', event: 'ready' },
  complete: { from: ['ready'], to: 'completed', event: 'picked_up' },
  reject: { from: ['received'], to: 'rejected', event: 'rejected' },
  cancel: { from: ['accepted', 'preparing', 'ready'], to: 'cancelled', event: 'cancelled' },
};
const LOG_LIMIT = 300;

function createOrderHub(ctx) {
  const { save, iso, branch, requireStock, moveStock, transport, rand = Math.random } = ctx;
  const db = () => ctx.db;

  const isExternal = (channel) => CHANNELS[channel]?.kind !== 'internal';
  const cfg = (channel) => db().channels?.[channel] || {};
  const find = (id) => {
    const o = db().orders.find((x) => x.id === id);
    assert(o, 404, `Unknown order: ${id}`);
    return o;
  };
  const dishOnChannel = (d, channel) => !d.channels || d.channels.includes(channel);

  function log(entry) {
    const list = (db().integrationLog ||= []);
    const e = { id: uid('log'), at: iso(), status: 'ok', ...entry };
    list.push(e);
    if (list.length > LOG_LIMIT) list.splice(0, list.length - LOG_LIMIT);
    return e;
  }

  /** Send a request to a platform. Never blocks the kitchen: the result is logged when it arrives. */
  function send(channel, request, meta) {
    const e = log({ channel, direction: 'out', status: 'pending', request, ...meta });
    Promise.resolve()
      .then(() => transport(channel, request))
      .then((res) => {
        e.status = res.simulated ? 'simulated' : 'ok';
        e.response = res.body;
      })
      .catch((err) => {
        e.status = 'error';
        e.error = err.message;
      })
      .finally(() => save());
    return e;
  }

  function notify(order, event) {
    if (!isExternal(order.channel) || !order.external) return;
    const request = ADAPTERS[order.channel]?.statusRequest(order, event);
    if (request) send(order.channel, request, { event: `order ${event}`, orderId: order.id, summary: `#${order.number} → ${event}` });
  }

  function nextNumber() {
    const meta = db().meta;
    meta.orderSeq = (meta.orderSeq || 1000) + 1;
    return meta.orderSeq;
  }

  /** Validate and price items. Unknown or unlisted dishes throw unless `lenient` (then they are reported). */
  function resolveItems(channel, items, { lenient = false } = {}) {
    assert(Array.isArray(items) && items.length > 0, 400, 'Order must contain items');
    const problems = [];
    const out = [];
    for (const i of items) {
      const qty = Math.floor(Number(i.qty));
      if (!(qty > 0)) continue;
      const dish = db().menu.find((m) => m.id === i.menuItemId);
      if (!dish || !dishOnChannel(dish, channel)) {
        const msg = !dish ? `Unknown dish: ${i.name || i.menuItemId}` : `${dish.name} is not offered on ${CHANNELS[channel].name}`;
        if (!lenient) throw new HttpError(400, msg);
        problems.push(msg);
        continue;
      }
      out.push({ menuItemId: dish.id, name: dish.name, qty, unitPrice: Number.isFinite(i.unitPrice) ? i.unitPrice : dish.price, notes: String(i.notes || '').slice(0, 200) });
    }
    assert(out.length > 0 || lenient, 400, 'Order must contain at least one item with a positive quantity');
    return { items: out, problems };
  }

  function consumptionOf(order) {
    return inv.consumptionFor(db().menu, order.items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })));
  }

  function createOrder({ branchId, channel, items, tableId, customer, notes, external, lenient = false }) {
    const b = branch(branchId);
    assert(CHANNELS[channel], 400, `Unknown channel: ${channel}`);
    assert(cfg(channel).enabled !== false, 403, `${CHANNELS[channel].name} orders are switched off in Setup`);
    if (channel === 'dine_in' && tableId) assert((b.tables || []).some((t) => t.id === tableId), 400, `Unknown table: ${tableId}`);
    const resolved = resolveItems(channel, items, { lenient });
    const order = {
      id: uid('ord'),
      number: nextNumber(),
      branchId,
      channel,
      status: 'received',
      at: iso(),
      items: resolved.items,
      total: round(resolved.items.reduce((s, i) => s + i.qty * i.unitPrice, 0), 2),
      consumption: null,
      tableId: channel === 'dine_in' ? tableId || null : null,
      customer: customer && (customer.name || customer.phone) ? { name: String(customer.name || '').slice(0, 80), phone: String(customer.phone || '').slice(0, 30) } : null,
      notes: String(notes || '').slice(0, 300),
      external: external || null,
      prepMinutes: cfg(channel).prepMinutes,
      history: [{ status: 'received', at: iso() }],
      source: isExternal(channel) ? channel : 'pos',
    };
    db().orders.push(order);
    return { order, problems: resolved.problems };
  }

  function transition(id, action, { reason } = {}) {
    const order = find(id);
    const step = FLOW[action];
    assert(step, 400, `Unknown action: ${action}`);
    assert(step.from.includes(order.status), 409, `Order #${order.number} is ${order.status}; it can't be ${step.to} now`);
    if (action === 'accept') {
      const consumption = consumptionOf(order);
      const lines = Object.entries(consumption).map(([ingredientId, qty]) => ({ ingredientId, qty }));
      requireStock(order.branchId, lines);
      moveStock(order.branchId, lines, -1);
      order.consumption = consumption;
    }
    if (action === 'cancel' && order.status === 'accepted' && order.consumption) {
      // Cooking hasn't started, so the ingredients go back on the shelf.
      moveStock(order.branchId, Object.entries(order.consumption).map(([ingredientId, qty]) => ({ ingredientId, qty })), +1);
      order.consumption = null;
    }
    if (action === 'reject' || action === 'cancel') order.rejectReason = reason || (action === 'reject' ? 'ITEM_UNAVAILABLE' : 'CANCELLED_BY_RESTAURANT');
    order.status = step.to;
    order.history.push({ status: step.to, at: iso(), ...(reason ? { reason } : {}) });
    notify(order, step.event); // only delivery-app orders are reported back
    if (action === 'accept') syncAvailability(order.branchId);
    save();
    return order;
  }

  /** Point-of-sale order: created and accepted in one step (the guest is standing there). */
  function placeOrder(branchId, { items, channel = 'dine_in', tableId, customer, notes } = {}) {
    assert(!isExternal(channel), 400, 'Use the integration webhook for delivery-app orders');
    const { order } = createOrder({ branchId, channel, items, tableId, customer, notes });
    try {
      return transition(order.id, 'accept');
    } catch (e) {
      db().orders.pop(); // nothing was cooked or charged: drop the attempt
      throw e;
    }
  }

  function storeBranch(channel, storeId) {
    const ids = cfg(channel).storeIds || {};
    return Object.keys(ids).find((b) => ids[b] && String(ids[b]) === String(storeId));
  }

  /** Webhook entry point for platform orders. Idempotent on the platform's order id. */
  function receiveExternal(channel, payload, { simulated = false } = {}) {
    const adapter = ADAPTERS[channel];
    assert(adapter && isExternal(channel), 404, `No integration for channel: ${channel}`);
    assert(cfg(channel).enabled, 403, `${CHANNELS[channel].name} is not connected. Turn it on in Setup → Ordering channels.`);
    let parsed;
    try {
      parsed = adapter.parseOrder(payload || {});
    } catch (e) {
      log({ channel, direction: 'in', status: 'error', event: 'order received', error: 'Could not read order', request: payload });
      throw new HttpError(400, `Could not read the ${CHANNELS[channel].name} order: ${e.message}`);
    }
    assert(parsed.externalId, 400, 'Order has no platform order id');
    const existing = db().orders.find((o) => o.external?.platform === channel && o.external.orderId === parsed.externalId);
    if (existing) return { order: existing, response: adapter.ack(existing), duplicate: true };

    const branchId = storeBranch(channel, parsed.storeId);
    if (!branchId) {
      log({ channel, direction: 'in', status: 'error', event: 'order received', error: `Unknown store ${parsed.storeId}`, request: payload });
      throw new HttpError(404, `No branch is linked to ${CHANNELS[channel].name} store "${parsed.storeId}"`);
    }
    const byCode = new Map(db().menu.map((d) => [d.externalCodes?.[channel] || d.id, d]));
    const items = parsed.items.map((x) => ({ menuItemId: byCode.get(x.remoteCode)?.id || `unknown:${x.remoteCode}`, name: x.name, qty: x.qty, unitPrice: x.unitPrice, notes: x.notes }));
    const { order, problems } = createOrder({
      branchId,
      channel,
      items,
      customer: parsed.customer,
      notes: [parsed.fulfilment === 'pickup' ? 'Customer pickup' : '', parsed.notes].filter(Boolean).join(' · '),
      external: { platform: channel, orderId: parsed.externalId, code: parsed.code, storeId: parsed.storeId, fulfilment: parsed.fulfilment, simulated },
      lenient: true,
    });
    log({ channel, direction: 'in', status: simulated ? 'simulated' : 'ok', event: 'order received', orderId: order.id, summary: `#${order.number} · ${parsed.code} · ${order.items.length} item(s)`, request: payload });

    if (problems.length || order.items.length === 0) {
      transition(order.id, 'reject', { reason: 'ITEM_UNAVAILABLE' });
    } else if (cfg(channel).autoAccept) {
      try {
        transition(order.id, 'accept');
      } catch (e) {
        if (e.status !== 409) throw e;
        transition(order.id, 'reject', { reason: 'ITEM_UNAVAILABLE' });
      }
    }
    save();
    return { order, response: adapter.ack(order), problems };
  }

  /** Generate a realistic platform payload and push it through the real webhook path. */
  function simulateExternal(channel, branchId) {
    branch(branchId);
    assert(ADAPTERS[channel], 404, `No integration for channel: ${channel}`);
    assert(cfg(channel).enabled, 403, `Turn ${CHANNELS[channel].name} on first`);
    const storeId = cfg(channel).storeIds?.[branchId];
    assert(storeId, 400, `Add a ${CHANNELS[channel].name} store ID for this branch first`);
    const stock = ctx.db.stock[branchId] || {};
    const menu = inv.menuAvailability(db().menu, stock)
      .filter((a) => a.portions > 0)
      .map((a) => db().menu.find((d) => d.id === a.menuItemId))
      .filter((d) => dishOnChannel(d, channel));
    assert(menu.length > 0, 409, 'Nothing on the menu can be made right now');
    return receiveExternal(channel, ADAPTERS[channel].sample(menu, storeId, rand), { simulated: true });
  }

  function menuItemsFor(channel, branchId) {
    const avail = new Map(inv.menuAvailability(db().menu, ctx.db.stock[branchId] || {}).map((a) => [a.menuItemId, a.portions]));
    return db().menu
      .filter((d) => dishOnChannel(d, channel))
      .map((d) => ({ remoteCode: d.externalCodes?.[channel] || d.id, name: d.name, price: d.price, category: d.category || 'Menu', available: (avail.get(d.id) || 0) > 0 }));
  }

  /** Send the menu (with sold-out flags) to a platform for every linked branch. */
  function pushMenu(channel) {
    assert(ADAPTERS[channel], 404, `No integration for channel: ${channel}`);
    assert(cfg(channel).enabled, 403, `Turn ${CHANNELS[channel].name} on first`);
    const sent = [];
    for (const b of db().branches) {
      const storeId = cfg(channel).storeIds?.[b.id];
      if (!storeId) continue;
      const items = menuItemsFor(channel, b.id);
      sent.push(send(channel, ADAPTERS[channel].menuRequest(storeId, items), { event: 'menu sync', summary: `${b.name}: ${items.length} dishes, ${items.filter((i) => !i.available).length} sold out` }));
      ((db().channelState ||= {})[channel] ||= {})[b.id] = items.filter((i) => !i.available).map((i) => i.remoteCode);
    }
    assert(sent.length > 0, 400, `No branch has a ${CHANNELS[channel].name} store ID yet`);
    save();
    return sent;
  }

  /** When dishes sell out (or come back), tell every connected platform for that branch. */
  function syncAvailability(branchId) {
    for (const channel of Object.keys(ADAPTERS)) {
      const c = cfg(channel);
      const storeId = c.storeIds?.[branchId];
      if (!c.enabled || !storeId) continue;
      const items = menuItemsFor(channel, branchId);
      const soldOut = items.filter((i) => !i.available).map((i) => i.remoteCode).sort();
      const state = ((db().channelState ||= {})[channel] ||= {});
      if (JSON.stringify(state[branchId] || []) === JSON.stringify(soldOut)) continue;
      state[branchId] = soldOut;
      send(channel, ADAPTERS[channel].menuRequest(storeId, items), { event: 'availability', summary: `${branch(branchId).name}: ${soldOut.length ? `sold out – ${soldOut.join(', ')}` : 'everything available again'}` });
    }
  }

  function listOrders({ branchId, status, channel, limit = 50 } = {}) {
    const statuses = status === 'active' ? ACTIVE : status ? status.split(',') : null;
    const out = [];
    const all = db().orders;
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const o = all[i];
      if (branchId && o.branchId !== branchId) continue;
      if (statuses && !statuses.includes(o.status || 'completed')) continue;
      if (channel && (o.channel || 'dine_in') !== channel) continue;
      out.push(o);
    }
    return out;
  }

  function tables(branchId) {
    const b = branch(branchId);
    const open = db().orders.filter((o) => o.branchId === branchId && o.tableId && ACTIVE.includes(o.status));
    return (b.tables || []).map((t) => {
      const orders = open.filter((o) => o.tableId === t.id);
      return { ...t, occupied: orders.length > 0, openOrders: orders.map((o) => o.id), openTotal: round(orders.reduce((s, o) => s + o.total, 0), 2), since: orders[0]?.at || null };
    });
  }

  function integrationLog({ channel, limit = 60 } = {}) {
    return (db().integrationLog || []).filter((e) => !channel || e.channel === channel).slice(-limit).reverse();
  }

  return { ACTIVE, createOrder, transition, placeOrder, receiveExternal, simulateExternal, pushMenu, syncAvailability, listOrders, tables, integrationLog };
}

module.exports = { createOrderHub, ACTIVE, FLOW };
