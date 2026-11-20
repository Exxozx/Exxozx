'use strict';
/**
 * Ordering channels and delivery-platform adapters.
 *
 * Every external order goes through the same path:
 *   platform -> POST /api/integrations/:channel/orders (webhook)
 *            -> adapter.parseOrder(payload)            (platform format -> Muratab order)
 *            -> order hub (stock check, kitchen, status changes)
 *            -> adapter.statusRequest(order, event)    (Muratab status -> platform API call)
 *            -> transport(request)                     (real HTTP on the server, simulated in the prototype)
 *
 * IMPORTANT: The platform field names below follow the publicly described shape of
 * each platform's POS integration (Talabat = Delivery Hero POS plugin API, Deliveroo
 * Order API). Their full specs are only issued to approved partners, so each adapter
 * MUST be checked against the official spec before going live. All platform-specific
 * code lives in this file so that check touches nothing else.
 */
const { round } = require('./util');

const CHANNELS = {
  dine_in: { id: 'dine_in', name: 'Dine-in', kind: 'internal' },
  takeaway: { id: 'takeaway', name: 'Takeaway', kind: 'internal' },
  talabat: { id: 'talabat', name: 'Talabat', kind: 'delivery', platform: 'Delivery Hero POS plugin API' },
  deliveroo: { id: 'deliveroo', name: 'Deliveroo', kind: 'delivery', platform: 'Deliveroo Order API' },
  careem: { id: 'careem', name: 'Careem Food', kind: 'delivery', platform: 'Generic webhook (Careem partner API to be mapped)' },
  website: { id: 'website', name: 'Website / app', kind: 'online', platform: 'Muratab order API (native format)' },
};

const DEFAULT_CHANNEL_CONFIG = () => ({
  dine_in: { enabled: true },
  takeaway: { enabled: true },
  talabat: { enabled: false, autoAccept: false, prepMinutes: 20, storeIds: {} },
  deliveroo: { enabled: false, autoAccept: false, prepMinutes: 20, storeIds: {} },
  careem: { enabled: false, autoAccept: false, prepMinutes: 20, storeIds: {} },
  website: { enabled: false, autoAccept: true, prepMinutes: 15, storeIds: {} },
});

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const NAMES = [['Aisha', 'Rahman'], ['Omar', 'Haddad'], ['Fatima', 'Al Mansoori'], ['Rohan', 'Mehta'], ['Sara', 'Khalil'], ['James', 'Carter'], ['Noura', 'Saeed'], ['Yusuf', 'Ibrahim']];
const NOTES = ['', '', '', 'No onions please', 'Extra sauce on the side', 'Leave at reception', 'Ring the bell twice'];

function sampleItems(menu, rand) {
  const count = 1 + Math.floor(rand() * 3);
  const chosen = new Map();
  for (let i = 0; i < count; i++) {
    const d = pick(menu, rand);
    chosen.set(d.id, (chosen.get(d.id) || 0) + 1 + Math.floor(rand() * 2));
  }
  return [...chosen].map(([id, qty]) => ({ dish: menu.find((m) => m.id === id), qty }));
}

/** Talabat via Delivery Hero's POS plugin/middleware API (shape to be verified against the partner spec). */
const talabat = {
  parseOrder(p) {
    return {
      externalId: p.token,
      code: p.code,
      storeId: p.platformRestaurant?.id,
      fulfilment: p.expeditionType === 'pickup' ? 'pickup' : 'delivery',
      customer: { name: [p.customer?.firstName, p.customer?.lastName].filter(Boolean).join(' '), phone: p.customer?.mobilePhone || '' },
      notes: p.comments?.customerComment || '',
      items: (p.products || []).map((x) => ({
        remoteCode: x.remoteCode,
        name: x.name,
        qty: Number(x.quantity),
        unitPrice: Number(x.unitPrice),
        notes: [x.comment, ...(x.selectedToppings || []).map((t) => t.name)].filter(Boolean).join(', '),
      })),
      total: Number(p.price?.grandTotal ?? NaN),
    };
  },
  ack: (order) => ({ remoteResponse: { remoteOrderId: order.id } }),
  statusRequest(order, event) {
    const status = { accepted: 'order_accepted', rejected: 'order_rejected', picked_up: 'order_picked_up' }[event];
    if (!status) return null;
    const body = { status, remoteOrderId: order.id };
    if (event === 'accepted') body.acceptanceTime = new Date(Date.parse(order.at) + (order.prepMinutes || 20) * 60000).toISOString();
    if (event === 'rejected') body.reason = order.rejectReason || 'ITEM_UNAVAILABLE';
    return { method: 'POST', path: `/v2/order/status/${encodeURIComponent(order.external.orderId)}`, body };
  },
  menuRequest: (storeId, items) => ({
    method: 'PUT',
    path: `/v2/chains/menu/${encodeURIComponent(storeId)}`,
    body: { products: items.map((d) => ({ remoteCode: d.remoteCode, name: d.name, price: d.price, category: d.category, isAvailable: d.available })) },
  }),
  sample(menu, storeId, rand) {
    const items = sampleItems(menu, rand);
    const [firstName, lastName] = pick(NAMES, rand);
    return {
      token: `tb-${Math.floor(rand() * 1e9).toString(36)}`,
      code: `T${100000 + Math.floor(rand() * 899999)}`,
      expeditionType: rand() < 0.85 ? 'delivery' : 'pickup',
      platformRestaurant: { id: storeId },
      customer: { firstName, lastName, mobilePhone: `+9715${Math.floor(10000000 + rand() * 89999999)}` },
      comments: { customerComment: pick(NOTES, rand) },
      products: items.map(({ dish, qty }) => ({ remoteCode: dish.id, name: dish.name, quantity: qty, unitPrice: dish.price, selectedToppings: [] })),
      price: { grandTotal: round(items.reduce((s, i) => s + i.qty * i.dish.price, 0), 2) },
      createdAt: new Date().toISOString(),
    };
  },
};

/** Deliveroo Order API (shape to be verified against the partner spec). Prices are in minor units. */
const deliveroo = {
  parseOrder(p) {
    const o = p.order || p;
    return {
      externalId: o.id,
      code: o.display_id,
      storeId: o.location_id,
      fulfilment: o.fulfillment_type === 'customer' ? 'pickup' : 'delivery',
      customer: { name: o.customer?.first_name || '', phone: o.customer?.contact_number || '' },
      notes: o.notes || '',
      items: (o.items || []).map((x) => ({
        remoteCode: x.pos_item_id,
        name: x.name,
        qty: Number(x.quantity),
        unitPrice: Number(x.unit_price?.fractional) / 100,
        notes: (x.modifiers || []).map((m) => m.name).join(', '),
      })),
      total: Number(o.total_price?.fractional) / 100,
    };
  },
  ack: () => ({ ok: true }),
  statusRequest(order, event) {
    const status = { accepted: 'accepted', rejected: 'rejected', ready: 'ready_for_collection', picked_up: 'collected' }[event];
    if (!status) return null;
    return { method: 'PATCH', path: `/order/v1/orders/${encodeURIComponent(order.external.orderId)}`, body: { status, reason: event === 'rejected' ? order.rejectReason : undefined } };
  },
  menuRequest: (storeId, items) => ({
    method: 'PUT',
    path: `/menu/v1/brands/muratab/menus/${encodeURIComponent(storeId)}`,
    body: { items: items.map((d) => ({ id: d.remoteCode, name: { en: d.name }, price_info: { price: Math.round(d.price * 100) }, available: d.available })) },
  }),
  sample(menu, storeId, rand) {
    const items = sampleItems(menu, rand);
    const [first] = pick(NAMES, rand);
    return {
      order: {
        id: `dr-${Math.floor(rand() * 1e9).toString(36)}`,
        display_id: String(1000 + Math.floor(rand() * 8999)),
        location_id: storeId,
        fulfillment_type: 'deliveroo',
        customer: { first_name: first, contact_number: '+97140000000' },
        notes: pick(NOTES, rand),
        items: items.map(({ dish, qty }) => ({ pos_item_id: dish.id, name: dish.name, quantity: qty, unit_price: { fractional: Math.round(dish.price * 100), currency_code: 'AED' }, modifiers: [] })),
        total_price: { fractional: Math.round(items.reduce((s, i) => s + i.qty * i.dish.price, 0) * 100), currency_code: 'AED' },
      },
    };
  },
};

/** Muratab's own order format: used for the website/app and as the template for any new platform. */
const native = {
  parseOrder: (p) => ({
    externalId: p.id,
    code: p.code || p.id,
    storeId: p.storeId,
    fulfilment: p.fulfilment || 'delivery',
    customer: { name: p.customer?.name || '', phone: p.customer?.phone || '' },
    notes: p.notes || '',
    items: (p.items || []).map((x) => ({ remoteCode: x.code, name: x.name, qty: Number(x.qty), unitPrice: Number(x.unitPrice), notes: x.notes || '' })),
    total: Number(p.total ?? NaN),
  }),
  ack: (order) => ({ orderId: order.id, number: order.number, status: order.status }),
  statusRequest: (order, event) => ({ method: 'POST', path: `/orders/${encodeURIComponent(order.external.orderId)}/status`, body: { status: event, muratabOrderId: order.id } }),
  menuRequest: (storeId, items) => ({ method: 'PUT', path: `/stores/${encodeURIComponent(storeId)}/menu`, body: { items } }),
  sample(menu, storeId, rand) {
    const items = sampleItems(menu, rand);
    const [first, last] = pick(NAMES, rand);
    return {
      id: `web-${Math.floor(rand() * 1e9).toString(36)}`,
      storeId,
      fulfilment: rand() < 0.5 ? 'delivery' : 'pickup',
      customer: { name: `${first} ${last}`, phone: '+971500000000' },
      notes: pick(NOTES, rand),
      items: items.map(({ dish, qty }) => ({ code: dish.id, name: dish.name, qty, unitPrice: dish.price })),
      total: round(items.reduce((s, i) => s + i.qty * i.dish.price, 0), 2),
    };
  },
};

const ADAPTERS = { talabat, deliveroo, careem: native, website: native };

/** Prototype / unconfigured transport: records the call instead of sending it. */
const simulatedTransport = async (channel, request) => ({ simulated: true, status: 200, body: { ok: true, note: `Simulated ${CHANNELS[channel].name} response` } });

/**
 * Real transport for the server: sends to the platform when its base URL + token are configured,
 * e.g. TALABAT_API_URL / TALABAT_API_TOKEN. Otherwise falls back to simulation.
 */
function httpTransport(config) {
  return async (channel, request) => {
    const c = config[channel];
    if (!c?.baseUrl || !c?.token) return simulatedTransport(channel, request);
    const res = await fetch(c.baseUrl.replace(/\/$/, '') + request.path, {
      method: request.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
      body: JSON.stringify(request.body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${CHANNELS[channel].name} answered ${res.status}: ${text.slice(0, 200)}`);
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { simulated: false, status: res.status, body };
  };
}

module.exports = { CHANNELS, DEFAULT_CHANNEL_CONFIG, ADAPTERS, simulatedTransport, httpTransport };
