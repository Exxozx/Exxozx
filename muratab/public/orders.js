'use strict';
/* Orders: take orders (dine-in by table, takeaway), run the kitchen board, and manage delivery apps. */

state.ordersTab ||= 'new';
state.pos = { channel: 'dine_in', tableId: '', cart: {}, customer: '', phone: '', notes: '' };

const ORDER_TABS = [['new', 'New order'], ['kitchen', 'Kitchen board'], ['tables', 'Tables'], ['history', 'Order history'], ['apps', 'Delivery apps']];
const KITCHEN_COLUMNS = [['received', 'New from apps'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready']];
const minutesAgo = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const tableLabel = (id) => state.branches.find((b) => b.id === state.branchId)?.tables?.find((x) => x.id === id)?.label || '';

function orderWho(o) {
  if (o.tableId) return `${t('Table')} ${esc(tableLabel(o.tableId) || '?')}`;
  if (o.customer?.name) return esc(o.customer.name);
  return channelName(o.channel || 'dine_in');
}

const ACTIONS = {
  received: [['accept', 'Accept', 'primary'], ['reject', 'Reject', 'danger']],
  accepted: [['start', 'Start cooking', 'primary'], ['cancel', 'Cancel', 'danger']],
  preparing: [['ready', 'Mark ready', 'primary']],
  ready: [['complete', 'Served / picked up', 'primary']],
};

function orderCard(o) {
  const age = minutesAgo(o.at);
  const late = o.status !== 'ready' && age > (o.prepMinutes || 20);
  return `<article class="ticket ${late ? 'late' : ''}" data-order="${o.id}">
    <header><strong>#${o.number}</strong><span class="ch ch-${esc(o.channel)}">${channelName(o.channel)}</span><span class="age ${late ? 'up' : 'muted'}">${t('{n} min', { n: age })}</span></header>
    <div class="who">${orderWho(o)}${o.external?.code ? ` <span class="muted mono">${esc(o.external.code)}</span>` : ''}${o.external?.simulated ? ` <span class="chip s-simulated">${t('Simulated')}</span>` : ''}</div>
    <ul>${o.items.map((i) => `<li><b>${i.qty}×</b> ${esc(i.name)}${i.notes ? `<span class="sub muted">${esc(i.notes)}</span>` : ''}</li>`).join('')}</ul>
    ${o.notes ? `<p class="note">${esc(o.notes)}</p>` : ''}
    <footer><span class="num">${price(o.total)}</span><div class="actions">${(ACTIONS[o.status] || []).map(([a, l, cls]) => `<button type="button" class="btn sm ${cls}" data-act-order="${a}" data-id="${o.id}">${t(l)}</button>`).join('')}</div></footer>
  </article>`;
}

const orderPanels = {
  async new() {
    const [avail, tables] = await Promise.all([api('GET', `/api/branches/${state.branchId}/menu-availability`), api('GET', `/api/branches/${state.branchId}/tables`)]);
    const pos = state.pos;
    if (pos.tableId && !tables.some((x) => x.id === pos.tableId)) pos.tableId = '';
    const byId = Object.fromEntries(avail.map((a) => [a.menuItemId, a]));
    const groups = {};
    for (const m of state.menu) if (!m.channels || m.channels.includes(pos.channel)) (groups[m.category || t('Menu')] ||= []).push(m);
    const cart = Object.entries(pos.cart).filter(([id, q]) => q > 0 && byId[id]);
    const total = cart.reduce((s, [id, q]) => s + q * byId[id].price, 0);
    return `<section class="grid pos">
      <div class="card"><div class="card-head">
        <div class="seg">${[['dine_in', 'Dine-in'], ['takeaway', 'Takeaway']].map(([c, l]) => `<button type="button" data-pos-ch="${c}" class="${pos.channel === c ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
        <span class="muted">${t('portions you can still make')}</span></div>
        <div class="card-body edit-rows">${Object.entries(groups).map(([cat, dishes]) => `<div class="edit-head">${esc(cat)}</div>
          <div class="menu-grid">${dishes.map((m) => { const a = byId[m.id] || { portions: 0 }; return `
            <button type="button" class="dish" data-add="${m.id}" ${a.portions <= (pos.cart[m.id] || 0) ? 'disabled' : ''}>
              <strong>${m.popular ? '★ ' : ''}${esc(m.name)}</strong><span class="price">${price(m.price)}</span>
              <span class="avail ${a.portions < 20 ? 'lowp' : ''}">${a.portions <= 0 ? t('Sold out') : t('{n} portions', { n: a.portions })}</span>
            </button>`; }).join('')}</div>`).join('') || `<div class="empty">${t('No dishes yet – add them in Setup.')}</div>`}
        </div></div>
      <div class="card cart"><div class="card-head"><h2>${t('Current order')}</h2></div>
        <div class="card-body edit-rows">
          ${pos.channel === 'dine_in' ? `<label>${t('Table')}<select id="posTable"><option value="">${t('No table (bar / counter)')}</option>${tables.map((x) => `<option value="${x.id}" ${x.id === pos.tableId ? 'selected' : ''}>${esc(x.label)} · ${t('{n} seats', { n: x.seats })} · ${esc(x.area)}${x.occupied ? ` · ${t('in use')}` : ''}</option>`).join('')}</select></label>`
          : `<div class="row"><label>${t('Customer name')}<input id="posCustomer" value="${esc(pos.customer)}"></label><label>${t('Phone')}<input id="posPhone" type="tel" value="${esc(pos.phone)}"></label></div>`}
          ${cart.map(([id, q]) => `<div class="cart-line"><span>${esc(byId[id].name)}</span>
            <span class="qty"><button type="button" data-dec="${id}" aria-label="${t('Remove one')}">−</button><b>${q}</b><button type="button" data-add="${id}" aria-label="${t('Add one')}" ${q >= byId[id].portions ? 'disabled' : ''}>+</button></span></div>`).join('') || `<div class="empty">${t('Tap a dish to add it.')}</div>`}
          <label>${t('Kitchen note')}<input id="posNotes" value="${esc(pos.notes)}" placeholder="${t('e.g. no onions, allergy…')}"></label>
          <div class="cart-total"><strong>${t('Total')}</strong><strong>${price(total)}</strong></div>
          <div class="actions"><button type="button" class="btn primary" id="placeOrder" ${cart.length ? '' : 'disabled'}>${t('Send to kitchen')}</button><button type="button" class="btn" id="clearCart" ${cart.length ? '' : 'disabled'}>${t('Clear')}</button></div>
        </div></div>
    </section>`;
  },

  async kitchen() {
    const orders = await api('GET', `/api/orders?branchId=${state.branchId}&status=active&limit=200`);
    return `<p class="muted">${t('Orders from every channel in one place. Accepting an order takes its ingredients out of stock; delivery apps are told about every change.')}</p>
    <section class="board">${KITCHEN_COLUMNS.map(([s, l]) => {
      const list = orders.filter((o) => o.status === s).reverse();
      return `<div class="col col-${s}"><h3>${t(l)} <span class="count">${list.length}</span></h3>${list.map(orderCard).join('') || `<div class="empty">${t('Nothing here')}</div>`}</div>`;
    }).join('')}</section>`;
  },

  async tables() {
    const tables = await api('GET', `/api/branches/${state.branchId}/tables`);
    const areas = {};
    for (const x of tables) (areas[x.area] ||= []).push(x);
    return `<p class="muted">${t('{free} of {n} tables free. Tap a free table to start an order for it.', { free: tables.filter((x) => !x.occupied).length, n: tables.length })}</p>
    ${Object.entries(areas).map(([area, list]) => `<h3>${esc(area)}</h3><div class="tables-grid">${list.map((x) => `
      <button type="button" class="table-tile ${x.occupied ? 'busy' : ''}" data-table="${x.id}">
        <strong>${esc(x.label)}</strong><span>${t('{n} seats', { n: x.seats })}</span>
        <span class="state">${x.occupied ? `${price(x.openTotal)} · ${t('{n} min', { n: minutesAgo(x.since) })}` : t('Free')}</span>
      </button>`).join('')}</div>`).join('') || `<div class="card empty">${t('No tables yet.')} ${editLink(2, 'Add tables')}</div>`}`;
  },

  async history() {
    const orders = await api('GET', `/api/orders?branchId=${state.branchId}&limit=60`);
    return `<div class="card"><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>${t('Time')}</th><th>${t('Channel')}</th><th>${t('Table / customer')}</th><th>${t('Items')}</th><th class="num">${t('Total')}</th><th>${t('Status')}</th></tr></thead>
      <tbody>${orders.map((o) => `<tr><td class="mono">${o.number ?? '—'}</td><td>${when(o.at)}</td><td>${channelName(o.channel || 'dine_in')}</td><td>${orderWho(o)}</td>
        <td>${esc(o.items.map((i) => `${i.qty}× ${i.name || state.menu.find((m) => m.id === i.menuItemId)?.name || i.menuItemId}`).join(', '))}</td>
        <td class="num">${price(o.total)}</td><td>${chip(o.status || 'completed')}${o.rejectReason ? `<span class="sub muted">${esc(o.rejectReason)}</span>` : ''}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  },

  async apps() {
    const [{ list, config }, log] = await Promise.all([api('GET', '/api/channels'), api('GET', '/api/integrations/log')]);
    state.integrationLog = log;
    const ext = list.filter((c) => c.kind !== 'internal');
    return `<div class="callout">${LOCAL
      ? t('This prototype simulates the delivery apps: “Simulate order” creates a realistic platform order and sends it through the same webhook code a real platform would call. Status updates back to the app are recorded below instead of being sent.')
      : t('Platforms send orders to the webhook shown in Setup → Ordering channels. Status updates are sent for real when the platform’s API URL and token are set on the server (for example TALABAT_API_URL and TALABAT_API_TOKEN); otherwise they are recorded below as simulated.')}</div>
    <div class="channel-grid">${ext.map((c) => {
      const cfg = config[c.id] || {};
      const store = cfg.storeIds?.[state.branchId];
      return `<div class="card channel-card"><div class="card-head"><h3>${esc(channelName(c.id))}</h3>${chip(cfg.enabled ? 'ok' : 'idle', cfg.enabled ? 'On' : 'Off')}</div>
        <div class="card-body edit-rows"><span class="sub muted">${esc(c.platform)}</span>
          <span>${store ? `${t('Store ID')}: <span class="mono">${esc(store)}</span>` : `<span class="muted">${t('No store ID for {b}', { b: esc(branchName(state.branchId)) })}</span>`}</span>
          <span class="sub muted">${cfg.autoAccept ? t('Accepts orders automatically') : t('Orders wait for you to accept')}</span>
          <div class="actions">
            <button type="button" class="btn sm primary" data-sim="${c.id}" ${cfg.enabled && store ? '' : 'disabled'}>${t('Simulate order')}</button>
            <button type="button" class="btn sm" data-menu-sync="${c.id}" ${cfg.enabled ? '' : 'disabled'}>${t('Send menu')}</button>
            ${editLink(6, 'Settings')}
          </div></div></div>`;
    }).join('')}</div>
    <div class="card"><div class="card-head"><h2>${t('Activity with delivery apps')}</h2><span class="muted">${t('latest first')}</span></div>
      <div class="table-wrap"><table><thead><tr><th>${t('Time')}</th><th></th><th>${t('App')}</th><th>${t('Event')}</th><th>${t('Details')}</th><th>${t('Status')}</th><th></th></tr></thead>
      <tbody>${log.map((e, i) => `<tr><td>${when(e.at)}</td><td title="${t(e.direction === 'in' ? 'Received from the app' : 'Sent to the app')}">${e.direction === 'in' ? '↓' : '↑'}</td>
        <td>${channelName(e.channel)}</td><td>${esc(t(e.event || ''))}</td><td>${esc(e.summary || e.error || '')}</td><td>${chip(e.status)}</td>
        <td>${e.request ? `<button type="button" class="btn sm" data-payload="${i}">${t('View data')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${t('No activity yet.')}</td></tr>`}</tbody></table></div></div>`;
  },
};

views.orders = async () => {
  const tab = state.ordersTab;
  return `<div class="page-head"><div><h1>${t('Orders')} · ${esc(branchName(state.branchId))}</h1></div>
    <div class="seg">${ORDER_TABS.map(([k, l]) => `<button type="button" data-otab="${k}" class="${tab === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div></div>
    ${await orderPanels[tab]()}`;
};

views.orders.bind = (root) => {
  const pos = state.pos;
  root.querySelectorAll('[data-otab]').forEach((b) => b.addEventListener('click', () => { state.ordersTab = b.dataset.otab; render(); }));
  root.querySelectorAll('[data-edit-step]').forEach((b) => b.addEventListener('click', () => openWizard(Number(b.dataset.editStep))));
  const keepFields = () => {
    pos.tableId = $('#posTable')?.value ?? pos.tableId;
    pos.customer = $('#posCustomer')?.value ?? pos.customer;
    pos.phone = $('#posPhone')?.value ?? pos.phone;
    pos.notes = $('#posNotes')?.value ?? pos.notes;
  };
  root.querySelectorAll('[data-pos-ch]').forEach((b) => b.addEventListener('click', () => { keepFields(); pos.channel = b.dataset.posCh; render(); }));
  root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { keepFields(); pos.cart[b.dataset.add] = (pos.cart[b.dataset.add] || 0) + 1; render(); }));
  root.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => { keepFields(); pos.cart[b.dataset.dec] = Math.max(0, (pos.cart[b.dataset.dec] || 0) - 1); render(); }));
  $('#clearCart', root)?.addEventListener('click', () => { pos.cart = {}; pos.notes = ''; render(); });
  $('#placeOrder', root)?.addEventListener('click', () => act(async () => {
    keepFields();
    const items = Object.entries(pos.cart).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty }));
    const o = await api('POST', `/api/branches/${state.branchId}/orders`, {
      items, channel: pos.channel, tableId: pos.channel === 'dine_in' ? pos.tableId || undefined : undefined,
      customer: pos.channel === 'takeaway' ? { name: pos.customer, phone: pos.phone } : undefined, notes: pos.notes,
    });
    Object.assign(pos, { cart: {}, notes: '', customer: '', phone: '', tableId: '' });
    toast(t('Order #{n} sent to the kitchen', { n: o.number }));
  }));
  root.querySelectorAll('[data-act-order]').forEach((b) => b.addEventListener('click', () => {
    const { actOrder: action, id } = b.dataset;
    if (action === 'reject' || action === 'cancel') {
      return modal(`<h2>${t(action === 'reject' ? 'Reject order' : 'Cancel order')}</h2>
        <label>${t('Reason (sent to the delivery app)')}<select name="reason">
          ${['ITEM_UNAVAILABLE', 'TOO_BUSY', 'CLOSED', 'ADDRESS_INCOMPLETE', 'OTHER'].map((r) => `<option value="${r}">${t(r)}</option>`).join('')}</select></label>
        ${modalFoot(action === 'reject' ? 'Reject order' : 'Cancel order')}`,
      (d) => api('POST', `/api/orders/${id}/${action}`, { reason: d.reason }).then(() => toast(t('Order updated'))));
    }
    act(() => api('POST', `/api/orders/${id}/${action}`), t('Order updated'));
  }));
  root.querySelectorAll('[data-table]').forEach((b) => b.addEventListener('click', () => {
    state.pos.channel = 'dine_in';
    state.pos.tableId = b.dataset.table;
    state.ordersTab = b.classList.contains('busy') ? 'kitchen' : 'new';
    render();
  }));
  root.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => act(async () => {
    const r = await api('POST', `/api/integrations/${b.dataset.sim}/simulate`, { branchId: state.branchId });
    toast(t('{app} order #{n} received – {status}', { app: channelName(b.dataset.sim), n: r.order.number, status: t(STATUS_LABEL[r.order.status]) }));
  })));
  root.querySelectorAll('[data-menu-sync]').forEach((b) => b.addEventListener('click', () => act(() => api('POST', `/api/integrations/${b.dataset.menuSync}/menu`), t('Menu sent'))));
  root.querySelectorAll('[data-payload]').forEach((b) => b.addEventListener('click', () => {
    const e = state.integrationLog[Number(b.dataset.payload)];
    modal(`<h2>${channelName(e.channel)} · ${esc(t(e.event))}</h2>
      ${e.request?.path ? `<div class="mono">${esc(e.request.method)} ${esc(e.request.path)}</div>` : ''}
      <pre class="payload mono">${esc(JSON.stringify(e.request?.body ?? e.request, null, 2))}</pre>
      ${e.response ? `<div class="edit-head">${t('Response')}</div><pre class="payload mono">${esc(JSON.stringify(e.response, null, 2))}</pre>` : ''}
      <div class="foot"><button class="btn" value="cancel" formnovalidate>${t('Close')}</button></div>`, async () => {}, { wide: true });
  }));
};

// Keep the kitchen board, tables and app activity fresh while they are on screen.
setInterval(() => {
  if (document.hidden || $('#modal').open || state.view !== 'orders' || !['kitchen', 'tables', 'apps'].includes(state.ordersTab)) return;
  render();
}, 5000);
