'use strict';
/* StockChain web client – vanilla JS, no build step. */

const state = {
  view: 'dashboard',
  branchId: null,
  branches: [],
  ingredients: [],
  menu: [],
  meta: {},
  cart: {},
  invFilter: 'all',
  invSearch: '',
  prices: null,
  prevPrices: {},
  priceSearch: '',
  priceCat: 'all',
  setupTab: 'menu',
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const price = (n) => (n == null ? '—' : `${state.meta.currency || ''} ${Number(n).toFixed(2)}`);
const money = (n) => `${state.meta.currency || ''} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const branchName = (id) => (id === 'HQ' ? 'HQ' : state.branches.find((b) => b.id === id)?.name || id);
const ingName = (id) => state.ingredients.find((i) => i.id === id)?.name || id;
const ingUnit = (id) => state.ingredients.find((i) => i.id === id)?.unit || '';
const STATUS_LABEL = { out: 'Out of stock', critical: 'Critical', low: 'Low', ok: 'Healthy', excess: 'Excess', idle: 'No usage',
  requested: 'Requested', in_transit: 'In transit', received: 'Received', rejected: 'Rejected', cancelled: 'Cancelled', draft: 'Draft', sent: 'Sent' };
const chip = (s, label) => `<span class="chip s-${esc(s)}">${esc(label || STATUS_LABEL[s] || s)}</span>`;
const linesText = (lines) => lines.map((l) => `${num(l.qty, 2)} ${ingUnit(l.ingredientId)} ${ingName(l.ingredientId)}`).join(', ');

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.error || `Request failed (${res.status})`;
    if (data.shortages) msg += ': ' + data.shortages.map((s) => `${ingName(s.ingredientId)} needs ${num(s.needed, 2)}, has ${num(s.available, 2)}`).join('; ');
    throw new Error(msg);
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), isError ? 5000 : 2600);
}

/** Run an action, toast the result, re-render. */
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message, true);
  }
  render();
}

/**
 * Open a form dialog. `onSubmit(data, form)` may throw to keep the dialog open.
 * Row editors: an element with [data-rows="name"] holds rows; a button with
 * [data-add-row="name"] appends ROW_TEMPLATES[name](); [data-del-row] removes its row.
 */
const ROW_TEMPLATES = {};
function modal(html, onSubmit, { wide = false } = {}) {
  const dlg = $('#modal');
  const form = $('#modalForm');
  dlg.classList.toggle('wide', wide);
  form.innerHTML = html;
  form.onclick = (ev) => {
    const add = ev.target.closest('[data-add-row]');
    const del = ev.target.closest('[data-del-row]');
    if (add) {
      ev.preventDefault();
      form.querySelector(`[data-rows="${add.dataset.addRow}"]`).insertAdjacentHTML('beforeend', ROW_TEMPLATES[add.dataset.addRow]());
    } else if (del) {
      ev.preventDefault();
      del.closest('.edit-row').remove();
    }
  };
  form.onsubmit = async (ev) => {
    if (ev.submitter?.value === 'cancel') return;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await onSubmit(data, form);
      dlg.close();
      render();
    } catch (e) {
      toast(e.message, true);
    }
  };
  dlg.showModal();
}

/** Read every .edit-row inside [data-rows=name] as an object of its named fields. */
const readRows = (form, name) =>
  [...form.querySelectorAll(`[data-rows="${name}"] .edit-row`)].map((row) =>
    Object.fromEntries([...row.querySelectorAll('[data-f]')].map((el) => [el.dataset.f, el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value]))
  );

function confirmDialog(title, body, okLabel, onOk) {
  modal(`<h2>${esc(title)}</h2><p style="margin:0">${body}</p>
    <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">${esc(okLabel)}</button></div>`, onOk);
}

const modalFoot = (label) => `<div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">${label}</button></div>`;

const otherBranchOptions = (selected) =>
  state.branches.filter((b) => b.id !== state.branchId).map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
const ingredientOptions = (ids, selected) =>
  state.ingredients.filter((i) => !ids || ids.includes(i.id)).map((i) => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)} (${i.unit})</option>`).join('');

// ---------- views ----------
const views = {};

views.dashboard = async () => {
  const [ov, rows] = await Promise.all([api('GET', '/api/overview'), api('GET', `/api/branches/${state.branchId}/inventory`)]);
  const me = ov.branches.find((b) => b.id === state.branchId);
  const attention = rows.filter((r) => ['out', 'critical', 'low'].includes(r.status)).sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const excess = rows.filter((r) => r.status === 'excess');
  const shortCount = me.counts.out + me.counts.critical;

  const suggestionAction = (s) => {
    if (s.fromBranchId === state.branchId)
      return `<button class="btn sm primary" data-sugg="send" data-s='${esc(JSON.stringify(s))}'>Send now</button>`;
    if (s.toBranchId === state.branchId)
      return `<button class="btn sm primary" data-sugg="request" data-s='${esc(JSON.stringify(s))}'>Request</button>`;
    return `<button class="btn sm" data-switch="${s.toBranchId}">Act as ${esc(branchName(s.toBranchId))}</button>`;
  };

  const seg = (c, n, total) => (n ? `<i style="width:${(n / total) * 100}%;background:${c}" title="${n}"></i>` : '');
  const branchCards = ov.branches.map((b) => {
    const total = Object.values(b.counts).reduce((a, c) => a + c, 0) || 1;
    return `<div class="card branch-card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div><h3>${esc(b.name)}</h3><span class="muted" style="font-size:12px">${esc(b.location)}</span></div>
        ${b.id === state.branchId ? chip('ok', 'You') : `<button class="btn sm" data-switch="${b.id}">Switch</button>`}
      </div>
      <div class="bar">${seg('var(--red)', b.counts.out + b.counts.critical, total)}${seg('var(--amber)', b.counts.low, total)}${seg('var(--green)', b.counts.ok, total)}${seg('var(--blue)', b.counts.excess, total)}${seg('var(--border)', b.counts.idle, total)}</div>
      <div class="legend"><span style="--c:var(--red)">${b.counts.out + b.counts.critical} critical</span><span style="--c:var(--amber)">${b.counts.low} low</span><span style="--c:var(--green)">${b.counts.ok} ok</span><span style="--c:var(--blue)">${b.counts.excess} excess</span></div>
      <div class="stats"><div>Stock value<b>${money(b.stockValue)}</b></div><div>Sales 24h<b>${money(b.revenue24h)}</b></div><div>Open POs<b>${b.openPurchaseOrders}</b></div></div>
    </div>`;
  }).join('');

  return `
  <div class="page-head">
    <div><h1>${esc(me.name)} overview</h1><p>${esc(me.location)} · stock levels are forecast from the last 14 days of orders.</p></div>
    <button class="btn primary" id="autoPo" ${attention.length ? '' : 'disabled'}>Auto-order from trusted suppliers</button>
  </div>
  <section class="kpis">
    <div class="card kpi ${shortCount ? 'alert' : ''}"><div class="label">Critical / out of stock</div><div class="value">${shortCount}</div><div class="sub">runs out before a delivery</div></div>
    <div class="card kpi ${me.counts.low ? 'warn' : ''}"><div class="label">Below reorder point</div><div class="value">${me.counts.low}</div><div class="sub">order soon</div></div>
    <div class="card kpi"><div class="label">Excess items</div><div class="value">${me.counts.excess}</div><div class="sub">spoilage risk · can be transferred</div></div>
    <div class="card kpi"><div class="label">Stock on hand</div><div class="value">${money(me.stockValue)}</div><div class="sub">at best trusted price</div></div>
    <div class="card kpi"><div class="label">Sales last 24h</div><div class="value">${money(me.revenue24h)}</div><div class="sub">${me.orders24h} orders</div></div>
    <div class="card kpi"><div class="label">Inbound</div><div class="value">${me.openPurchaseOrders + me.inboundTransfers}</div><div class="sub">${me.openPurchaseOrders} POs · ${me.inboundTransfers} transfers</div></div>
  </section>

  <section class="grid cols-2">
    <div class="card">
      <div class="card-head"><h2>Needs attention</h2><span class="muted">${attention.length} items</span></div>
      <div class="list">${attention.length ? attention.map((r) => `
        <div class="list-item">
          <div><strong>${esc(r.name)}</strong> ${chip(r.status)}
            <span class="sub muted" style="display:block;font-size:12px">${num(r.qty, 2)} ${r.unit} on hand · ${num(r.daysOfCover)} days cover · lead time ${r.leadTimeDays}d${r.incoming ? ` · ${num(r.incoming, 2)} ${r.unit} inbound` : ''}</span></div>
          <div class="num">${r.recommendedOrderQty ? `<strong>+${num(r.recommendedOrderQty, 2)} ${r.unit}</strong><span class="sub muted" style="display:block;font-size:12px">${esc(r.supplier?.name || '')}</span>` : '<span class="muted">covered by inbound</span>'}</div>
        </div>`).join('') : '<div class="empty">Everything is above its reorder point.</div>'}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Rebalance between branches</h2><span class="muted">surplus → shortage</span></div>
      <div class="list">${ov.suggestions.length ? ov.suggestions.map((s) => `
        <div class="list-item">
          <div><span class="route">${esc(branchName(s.fromBranchId))}<span class="arrow">→</span>${esc(branchName(s.toBranchId))}</span>
            <span class="muted" style="display:block;font-size:12px">${num(s.qty, 2)} ${s.unit} ${esc(s.name)} · avoids ~${money(s.estimatedSavings)} of purchasing</span></div>
          ${suggestionAction(s)}
        </div>`).join('') : '<div class="empty">No surplus matches a shortage right now.</div>'}
      </div>
    </div>
  </section>

  <section>
    <div class="page-head" style="margin-bottom:12px"><h2>Branch network</h2>
      <span class="chip ${ov.ledger.valid ? 's-ok' : 's-critical'}">Ledger ${ov.ledger.valid ? 'verified' : 'INVALID'} · ${ov.ledger.blocks} blocks</span></div>
    <div class="grid cols-3">${branchCards}</div>
  </section>
  ${excess.length ? `<p class="muted">Excess here: ${excess.map((r) => `${esc(r.name)} (${num(r.surplusQty, 2)} ${r.unit} above target)`).join(', ')}.</p>` : ''}`;
};

views.dashboard.bind = (root) => {
  $('#autoPo', root)?.addEventListener('click', () =>
    act(async () => {
      const pos = await api('POST', `/api/branches/${state.branchId}/purchase-orders/auto`);
      if (!pos.length) throw new Error('Nothing to order – inbound stock already covers the shortfall');
      state.view = 'suppliers';
      toast(`Created ${pos.length} draft purchase order${pos.length > 1 ? 's' : ''}. Review and send them below.`);
    })
  );
  root.querySelectorAll('[data-sugg]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const s = JSON.parse(btn.dataset.s);
      const lines = [{ ingredientId: s.ingredientId, qty: s.qty }];
      if (btn.dataset.sugg === 'send')
        act(() => api('POST', '/api/transfers/dispatch', { branchId: state.branchId, toBranchId: s.toBranchId, lines, note: 'Rebalancing suggestion' }), 'Transfer dispatched and signed onto the ledger');
      else
        act(() => api('POST', '/api/transfers/request', { branchId: state.branchId, fromBranchId: s.fromBranchId, lines, note: 'Rebalancing suggestion' }), 'Request signed onto the ledger');
    })
  );
};

views.inventory = async () => {
  const rows = await api('GET', `/api/branches/${state.branchId}/inventory`);
  const branch = state.branches.find((b) => b.id === state.branchId);
  const f = state.invFilter;
  const q = state.invSearch.toLowerCase();
  const shown = rows.filter((r) =>
    (f === 'all' || (f === 'reorder' && ['out', 'critical', 'low'].includes(r.status)) || (f === 'excess' && r.status === 'excess')) &&
    (!q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
  );
  const barColor = { out: 'var(--red)', critical: 'var(--red)', low: 'var(--amber)', ok: 'var(--green)', excess: 'var(--blue)', idle: 'var(--border)' };
  const totalValue = rows.reduce((s, r) => s + r.stockValue, 0);

  return `
  <div class="page-head">
    <div><h1>Inventory · ${esc(branch.name)}</h1><p>${rows.length} ingredients · ${money(totalValue)} on hand. Thresholds use supplier lead time + ${branch.settings.safetyDays} safety days, capped by shelf life.</p></div>
    <button class="btn" id="settingsBtn">Thresholds</button>
  </div>
  <div class="card">
    <div class="card-head">
      <div class="seg">${[['all', 'All'], ['reorder', 'Needs reorder'], ['excess', 'Excess']].map(([k, l]) => `<button data-filter="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="invSearch" type="search" placeholder="Search ingredient or category" value="${esc(state.invSearch)}" />
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Ingredient</th><th>Status</th><th class="num">On hand</th><th class="num">Daily use</th><th>Days of cover</th>
        <th class="num hide-sm">Reorder / target</th><th class="num">Inbound</th><th class="num">Order</th><th class="num">Surplus</th><th></th></tr></thead>
      <tbody>${shown.map((r) => `
        <tr>
          <td><strong>${esc(r.name)}</strong><span class="sub">${esc(r.category)}</span></td>
          <td>${chip(r.status)}</td>
          <td class="num">${num(r.qty, 2)} ${r.unit}</td>
          <td class="num">${num(r.avgDailyUsage, 2)}</td>
          <td><span class="cover-bar"><i style="width:${Math.min(100, ((r.daysOfCover ?? 0) / 14) * 100)}%;background:${barColor[r.status]}"></i></span> ${num(r.daysOfCover)}d</td>
          <td class="num hide-sm">${num(r.reorderPoint, 1)} / ${num(r.targetLevel, 1)}</td>
          <td class="num">${r.incoming ? num(r.incoming, 2) : '<span class="muted">—</span>'}</td>
          <td class="num">${r.recommendedOrderQty ? `<strong>${num(r.recommendedOrderQty, 2)}</strong>` : '<span class="muted">—</span>'}</td>
          <td class="num">${r.surplusQty ? num(r.surplusQty, 2) : '<span class="muted">—</span>'}</td>
          <td><div class="actions"><button class="btn sm" data-count="${r.ingredientId}">Count</button><button class="btn sm" data-waste="${r.ingredientId}">Waste</button></div></td>
        </tr>`).join('') || '<tr><td colspan="10" class="empty">No ingredients match.</td></tr>'}
      </tbody>
    </table></div>
  </div>`;
};

views.inventory.bind = (root) => {
  root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.invFilter = b.dataset.filter; render(); }));
  const search = $('#invSearch', root);
  search.addEventListener('input', () => {
    state.invSearch = search.value;
    clearTimeout(search._t);
    search._t = setTimeout(async () => { await render(); const s = $('#invSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
  });
  root.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.count;
    modal(`<h2>Stock count · ${esc(ingName(id))}</h2>
      <label>Counted quantity (${ingUnit(id)})<input name="countedQty" type="number" step="any" min="0" required autofocus></label>
      <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">Save count</button></div>`,
      (d) => api('POST', `/api/branches/${state.branchId}/inventory/adjust`, { ingredientId: id, countedQty: Number(d.countedQty), reason: 'stock count' }).then(() => toast('Count saved')));
  }));
  root.querySelectorAll('[data-waste]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.waste;
    modal(`<h2>Record waste · ${esc(ingName(id))}</h2>
      <label>Quantity wasted (${ingUnit(id)})<input name="qty" type="number" step="any" min="0" required autofocus></label>
      <label>Reason<select name="reason"><option>spoiled</option><option>dropped / damaged</option><option>expired</option><option>other</option></select></label>
      <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">Record</button></div>`,
      (d) => api('POST', `/api/branches/${state.branchId}/inventory/adjust`, { ingredientId: id, delta: -Number(d.qty), reason: `waste: ${d.reason}` }).then(() => toast('Waste recorded')));
  }));
  $('#settingsBtn', root).addEventListener('click', () => {
    const s = state.branches.find((b) => b.id === state.branchId).settings;
    modal(`<h2>Stock thresholds</h2>
      <p class="muted" style="margin:0">Applied on top of each supplier's lead time. Fresh items are capped by shelf life.</p>
      <div class="row"><label>Safety days (reorder point)<input name="safetyDays" type="number" min="0" step="0.5" value="${s.safetyDays}"></label>
      <label>Target days of cover<input name="targetDays" type="number" min="0" step="0.5" value="${s.targetDays}"></label></div>
      <label>Excess above (days of cover)<input name="maxDays" type="number" min="0" step="0.5" value="${s.maxDays}"></label>
      <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">Save</button></div>`,
      async (d) => {
        await api('PATCH', `/api/branches/${state.branchId}/settings`, d);
        state.branches = await api('GET', '/api/branches');
        toast('Thresholds updated');
      });
  });
};

views.orders = async () => {
  const [avail, orders] = await Promise.all([
    api('GET', `/api/branches/${state.branchId}/menu-availability`),
    api('GET', `/api/branches/${state.branchId}/orders?limit=15`),
  ]);
  const byId = Object.fromEntries(avail.map((a) => [a.menuItemId, a]));
  const cartLines = Object.entries(state.cart).filter(([, q]) => q > 0);
  const total = cartLines.reduce((s, [id, q]) => s + q * byId[id].price, 0);

  return `
  <div class="page-head"><div><h1>Orders · ${esc(branchName(state.branchId))}</h1><p>Each order deducts its recipe ingredients from stock and feeds the demand forecast.</p></div></div>
  <section class="grid" style="grid-template-columns:minmax(0,2fr) minmax(280px,1fr)">
    <div class="card"><div class="card-head"><h2>Menu</h2><span class="muted">portions you can still make</span></div>
      <div class="card-body menu-grid">${avail.map((a) => `
        <button class="dish" data-add="${a.menuItemId}" ${a.portions <= (state.cart[a.menuItemId] || 0) ? 'disabled' : ''}>
          <strong>${esc(a.name)}</strong><span class="price">${money(a.price)}</span>
          <span class="avail ${a.portions < 30 ? 'lowp' : ''}">${a.portions} portions${a.portions < 30 ? ` · limited by ${esc(ingName(a.limitingIngredient))}` : ''}</span>
        </button>`).join('')}
      </div></div>
    <div class="card"><div class="card-head"><h2>Current order</h2></div>
      <div class="card-body">${cartLines.length ? cartLines.map(([id, q]) => `
        <div class="cart-line"><span>${esc(byId[id].name)}</span>
          <span class="qty"><button data-dec="${id}" aria-label="Remove one">−</button><b>${q}</b><button data-add="${id}" aria-label="Add one" ${q >= byId[id].portions ? 'disabled' : ''}>+</button></span></div>`).join('') : '<div class="empty">Tap a dish to add it.</div>'}
        <div style="display:flex;justify-content:space-between;margin:14px 0"><strong>Total</strong><strong>${money(total)}</strong></div>
        <div class="actions"><button class="btn primary" id="placeOrder" ${cartLines.length ? '' : 'disabled'}>Place order</button><button class="btn" id="clearCart" ${cartLines.length ? '' : 'disabled'}>Clear</button></div>
      </div></div>
  </section>
  <div class="card"><div class="card-head"><h2>Recent orders</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Items</th><th class="num">Total</th><th>Source</th></tr></thead><tbody>
    ${orders.map((o) => `<tr><td>${when(o.at)}</td><td>${o.items.map((i) => `${i.qty}× ${esc(state.menu.find((m) => m.id === i.menuItemId)?.name)}`).join(', ')}</td><td class="num">${money(o.total)}</td><td class="muted">${o.source === 'pos' ? 'Live POS' : 'POS history'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
};

views.orders.bind = (root) => {
  root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.add] = (state.cart[b.dataset.add] || 0) + 1; render(); }));
  root.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.dec] = Math.max(0, (state.cart[b.dataset.dec] || 0) - 1); render(); }));
  $('#clearCart', root)?.addEventListener('click', () => { state.cart = {}; render(); });
  $('#placeOrder', root)?.addEventListener('click', () => act(async () => {
    const items = Object.entries(state.cart).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty }));
    await api('POST', `/api/branches/${state.branchId}/orders`, { items });
    state.cart = {};
  }, 'Order placed – stock updated'));
};

views.suppliers = async () => {
  const [suppliers, pos] = await Promise.all([api('GET', '/api/suppliers'), api('GET', `/api/purchase-orders?branchId=${state.branchId}`)]);
  state.suppliers = suppliers;
  const poActions = (p) => {
    if (p.status === 'draft') return `<button class="btn sm primary" data-po="send" data-id="${p.id}">Send to supplier</button><button class="btn sm danger" data-po="cancel" data-id="${p.id}">Cancel</button>`;
    if (p.status === 'sent') return `<button class="btn sm primary" data-po="receive" data-id="${p.id}">Mark received</button><button class="btn sm danger" data-po="cancel" data-id="${p.id}">Cancel</button>`;
    return '';
  };
  return `
  <div class="page-head">
    <div><h1>Suppliers &amp; purchasing</h1><p>Only trusted suppliers can receive orders. The best supplier per item balances price and on-time delivery.</p></div>
    <div class="actions"><button class="btn" id="newPo">New purchase order</button><button class="btn primary" id="autoPo">Auto-order shortages</button></div>
  </div>
  <div class="card"><div class="card-head"><h2>Purchase orders · ${esc(branchName(state.branchId))}</h2><span class="muted">${pos.length} total</span></div>
    <div class="table-wrap"><table><thead><tr><th>Order</th><th>Supplier</th><th>Lines</th><th class="num">Total</th><th>Status</th><th>Expected</th><th></th></tr></thead><tbody>
    ${pos.map((p) => `<tr>
      <td><span class="mono">${esc(p.id)}</span><span class="sub">${when(p.createdAt)}${p.auto ? ' · auto' : ''}</span></td>
      <td>${esc(p.supplierName)}${p.confirmation ? `<span class="sub mono">${esc(p.confirmation)}</span>` : ''}</td>
      <td>${esc(linesText(p.lines))}</td>
      <td class="num">${money(p.total)}</td>
      <td>${chip(p.status)}</td>
      <td>${p.status === 'received' ? `<span class="muted">received ${when(p.receivedAt)}</span>` : when(p.expectedAt)}</td>
      <td><div class="actions">${poActions(p)}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No purchase orders yet. Use “Auto-order shortages” to draft them from the forecast.</td></tr>'}
    </tbody></table></div></div>
  <section class="grid cols-3">${suppliers.map((s) => `
    <div class="card branch-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
        <div><h3>${esc(s.name)}</h3><span class="muted" style="font-size:12px">${esc(s.contact)}</span></div>
        ${chip(s.trusted ? 'trusted' : 'untrusted', s.trusted ? 'Trusted' : 'Not trusted')}
      </div>
      <div class="stats"><div>Rating<b>${s.rating.toFixed(1)} / 5</b></div><div>On time<b>${Math.round(s.onTimeRate * 100)}%</b></div><div>Items<b>${s.catalog.length}</b></div></div>
      <div style="font-size:12px" class="muted">${s.catalog.map((c) => `${esc(ingName(c.ingredientId))} ${money(c.unitPrice)}/${ingUnit(c.ingredientId)} · ${c.leadTimeDays}d`).join('<br>')}</div>
      <button class="btn sm" data-trust="${s.id}" data-val="${!s.trusted}">${s.trusted ? 'Revoke trust' : 'Mark as trusted'}</button>
    </div>`).join('')}
  </section>`;
};

views.suppliers.bind = (root) => {
  $('#autoPo', root).addEventListener('click', () => act(async () => {
    const pos = await api('POST', `/api/branches/${state.branchId}/purchase-orders/auto`);
    if (!pos.length) throw new Error('Nothing to order – no shortages that are not already covered');
    toast(`Created ${pos.length} draft purchase order${pos.length > 1 ? 's' : ''}`);
  }));
  root.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', () => {
    const labels = { send: 'Order sent to supplier', receive: 'Delivery received – stock added', cancel: 'Purchase order cancelled' };
    act(() => api('POST', `/api/purchase-orders/${b.dataset.id}/${b.dataset.po}`), labels[b.dataset.po]);
  }));
  root.querySelectorAll('[data-trust]').forEach((b) => b.addEventListener('click', () =>
    act(() => api('PATCH', `/api/suppliers/${b.dataset.trust}`, { trusted: b.dataset.val === 'true' }), 'Supplier updated')));
  $('#newPo', root).addEventListener('click', () => {
    const trusted = state.suppliers.filter((s) => s.trusted);
    const opts = (sid) => ingredientOptions(trusted.find((s) => s.id === sid).catalog.map((c) => c.ingredientId));
    modal(`<h2>New purchase order</h2>
      <label>Trusted supplier<select name="supplierId" id="poSupplier">${trusted.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <div class="row"><label>Ingredient<select name="ingredientId" id="poIng">${opts(trusted[0].id)}</select></label>
      <label>Quantity<input name="qty" type="number" min="0" step="any" required></label></div>
      <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">Create draft</button></div>`,
      (d) => api('POST', '/api/purchase-orders', { branchId: state.branchId, supplierId: d.supplierId, lines: [{ ingredientId: d.ingredientId, qty: Number(d.qty) }] }).then(() => toast('Draft created')));
    $('#poSupplier').addEventListener('change', (e) => ($('#poIng').innerHTML = opts(e.target.value)));
  });
};

views.transfers = async () => {
  const [transfers, blocks, verify] = await Promise.all([
    api('GET', `/api/transfers?branchId=${state.branchId}`),
    api('GET', '/api/ledger'),
    api('GET', '/api/ledger/verify'),
  ]);
  const me = state.branchId;
  const actions = (t) => {
    const a = [];
    if (t.status === 'requested' && t.fromBranchId === me) a.push(`<button class="btn sm primary" data-tr="fulfil" data-id="${t.id}">Approve &amp; send</button>`, `<button class="btn sm danger" data-tr="reject" data-id="${t.id}">Reject</button>`);
    if (t.status === 'requested' && t.toBranchId === me) a.push(`<button class="btn sm danger" data-tr="cancel" data-id="${t.id}">Cancel</button>`);
    if (t.status === 'in_transit' && t.toBranchId === me) a.push(`<button class="btn sm primary" data-tr="receive" data-id="${t.id}">Confirm receipt</button>`);
    return a.join('');
  };
  const txSummary = (tx) => {
    const p = tx.payload;
    if (tx.type === 'GENESIS' || tx.type === 'MEMBER_ADD') return `Registered ${p.members.map((m) => esc(m.name)).join(', ')} as signing members`;
    const t = transfers.find((x) => x.id === p.transferId);
    const route = p.fromBranchId ? `${esc(branchName(p.fromBranchId))} → ${esc(branchName(p.toBranchId))}` : t ? `${esc(branchName(t.fromBranchId))} → ${esc(branchName(t.toBranchId))}` : '';
    return `<span class="mono">${esc(p.transferId)}</span> ${route}${p.lines ? ` · ${esc(linesText(p.lines))}` : ''}${p.reason ? ` · “${esc(p.reason)}”` : ''}`;
  };
  return `
  <div class="page-head">
    <div><h1>Branch transfers</h1><p>Every movement of stock between branches is a signed block on the shared ledger. Each branch can only sign its own side.</p></div>
    <div class="actions"><button class="btn" id="reqBtn">Request stock</button><button class="btn primary" id="sendBtn">Send stock</button></div>
  </div>
  <div class="card"><div class="card-head"><h2>Transfers involving ${esc(branchName(me))}</h2><span class="muted">${transfers.length}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Transfer</th><th>Route</th><th>Items</th><th>Status</th><th>Last update</th><th></th></tr></thead><tbody>
    ${transfers.map((t) => {
      const last = t.history[t.history.length - 1];
      return `<tr><td><span class="mono">${esc(t.id)}</span>${t.note ? `<span class="sub">${esc(t.note)}</span>` : ''}</td>
        <td><span class="route">${esc(branchName(t.fromBranchId))}<span class="arrow">→</span>${esc(branchName(t.toBranchId))}</span></td>
        <td>${esc(linesText(t.lines))}</td><td>${chip(t.status)}</td>
        <td>${when(last.at)}<span class="sub">block #${last.block} · signed by ${esc(branchName(last.by))}</span></td>
        <td><div class="actions">${actions(t)}</div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No transfers yet.</td></tr>'}
    </tbody></table></div></div>

  <div class="card">
    <div class="card-head"><h2>Shared ledger</h2><button class="btn sm" id="verifyBtn">Re-verify chain</button></div>
    <div class="card-body" style="padding-bottom:0">
      <div class="verify ${verify.valid ? 'ok' : 'bad'}"><strong>${verify.valid ? '✓ Chain valid' : '✗ Chain invalid'}</strong>
        <span>${verify.blocks} blocks · every hash link and Ed25519 signature checked${verify.errors.length ? ' · ' + esc(verify.errors.join('; ')) : ''}</span></div>
    </div>
    <div class="chain">${blocks.map((b) => `
      <div class="block">
        <div class="block-index">#${b.index}</div>
        <div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><strong>${esc(b.tx.type.replace('_', ' ').toLowerCase())}</strong>
          <span class="muted">signed by ${esc(branchName(b.validator))} · ${when(b.timestamp)}</span></div>
          <div>${txSummary(b.tx)}</div>
          <div class="hashes mono"><span>hash ${esc(b.hash)}</span><span>prev ${esc(b.prevHash)}</span><span>sig ${esc(b.signature.slice(0, 44))}…</span></div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
};

views.transfers.bind = (root) => {
  const lineForm = (title, who, btn) => `<h2>${title}</h2>
    <label>${who}<select name="other" required>${otherBranchOptions()}</select></label>
    <div class="row"><label>Ingredient<select name="ingredientId">${ingredientOptions()}</select></label>
    <label>Quantity<input name="qty" type="number" min="0" step="any" required></label></div>
    <label>Note<input name="note" placeholder="optional"></label>
    <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">${btn}</button></div>`;
  $('#sendBtn', root).addEventListener('click', () => modal(lineForm('Send stock to another branch', 'Destination branch', 'Sign &amp; dispatch'), (d) =>
    api('POST', '/api/transfers/dispatch', { branchId: state.branchId, toBranchId: d.other, lines: [{ ingredientId: d.ingredientId, qty: Number(d.qty) }], note: d.note }).then(() => toast('Dispatched – block added to ledger'))));
  $('#reqBtn', root).addEventListener('click', () => modal(lineForm('Request stock from another branch', 'Ask branch', 'Sign &amp; request'), (d) =>
    api('POST', '/api/transfers/request', { branchId: state.branchId, fromBranchId: d.other, lines: [{ ingredientId: d.ingredientId, qty: Number(d.qty) }], note: d.note }).then(() => toast('Request added to ledger'))));
  $('#verifyBtn', root).addEventListener('click', () => act(() => api('GET', '/api/ledger/verify').then((v) => { if (!v.valid) throw new Error(v.errors.join('; ')); }), 'Every block verified'));
  root.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    const body = { branchId: state.branchId };
    if (b.dataset.tr === 'fulfil') return act(() => api('POST', '/api/transfers/dispatch', { ...body, transferId: id }), 'Request approved and dispatched');
    if (b.dataset.tr === 'reject') return modal(`<h2>Reject request</h2><label>Reason<input name="reason" required autofocus></label>
      <div class="foot"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary">Reject</button></div>`,
      (d) => api('POST', `/api/transfers/${id}/reject`, { ...body, reason: d.reason }).then(() => toast('Request rejected')));
    const msg = { receive: 'Receipt confirmed – stock added', cancel: 'Request cancelled' }[b.dataset.tr];
    act(() => api('POST', `/api/transfers/${id}/${b.dataset.tr}`, body), msg);
  }));
};

// ---------- live prices ----------
const dirOf = (pct) => (pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat');
const pctText = (p) => `${p > 0.05 ? '▲' : p < -0.05 ? '▼' : '•'} ${Math.abs(p).toFixed(1)}%`;
const shortName = (n) => { const w = n.split(' '); return w[0].length < 4 && w[1] ? `${w[0]} ${w[1]}` : w[0]; };
function spark(values, cls) {
  if (!values || values.length < 2) return '<span class="muted">—</span>';
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 118 + 1).toFixed(1)},${(27 - ((v - min) / span) * 25).toFixed(1)}`).join(' ');
  return `<svg class="spark ${cls}" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

views.prices = async () => {
  if (!state.prices) state.prices = await api('GET', '/api/prices');
  const cats = [...new Set(state.ingredients.map((i) => i.category))];
  return `
  <div class="page-head">
    <div><h1>Live prices</h1><p id="priceSub"></p></div>
    <div class="actions"><button class="btn" id="tickBtn">Refresh now</button><button class="btn" id="feedToggle">Pause feed</button></div>
  </div>
  <section class="kpis" id="priceKpis"></section>
  <div class="card">
    <div class="card-head">
      <div class="seg">${['all', ...cats].map((c) => `<button data-pcat="${esc(c)}" class="${state.priceCat === c ? 'on' : ''}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>
      <input id="priceSearch" type="search" placeholder="Search ingredient" value="${esc(state.priceSearch)}" />
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Ingredient</th><th class="num" title="Median of every supplier quote, trusted or not">Market price</th><th>Trend</th><th class="num">Change</th><th>Best trusted offer</th><th class="hide-sm">All supplier quotes</th></tr></thead>
      <tbody id="priceRows"></tbody>
    </table></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Menu cost at live prices</h2><span class="muted">food cost = recipe × best trusted price</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Dish</th><th class="num">Menu price</th><th class="num">Food cost</th><th>Food cost %</th><th class="num">Margin per dish</th></tr></thead>
      <tbody id="menuCostRows"></tbody>
    </table></div>
  </div>`;
};

function paintPrices() {
  const snap = state.prices;
  const rowsEl = $('#priceRows');
  if (!snap || !rowsEl) return;
  const st = snap.status;
  const src = st.mode === 'http' ? `feed ${esc(st.url)}` : 'simulated market (connect a real feed with PRICE_FEED_URL)';
  $('#priceSub').innerHTML = `Source: ${src} · ${st.running ? `updates every ${st.intervalMs / 1000}s` : 'paused'} · last update ${snap.at ? new Date(snap.at).toLocaleTimeString() : '—'}${st.error ? ` · <span class="up">${esc(st.error)}</span>` : ''}`;
  $('#feedToggle').textContent = st.running ? 'Pause feed' : 'Resume feed';

  const ings = snap.ingredients.filter((i) => i.marketPrice != null);
  const sorted = [...ings].sort((a, b) => b.changePct - a.changePct);
  const up = ings.filter((i) => dirOf(i.changePct) === 'up').length;
  const down = ings.filter((i) => dirOf(i.changePct) === 'down').length;
  const avgFc = snap.menu.length ? snap.menu.reduce((s, m) => s + (m.foodCostPct || 0), 0) / snap.menu.length : 0;
  const kpi = (label, value, sub, cls = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  $('#priceKpis').innerHTML = sorted.length ? [
    kpi('Biggest increase', pctText(sorted[0].changePct), `${esc(sorted[0].name)} · last ${snap.windowMinutes} min`, dirOf(sorted[0].changePct)),
    kpi('Biggest drop', pctText(sorted.at(-1).changePct), `${esc(sorted.at(-1).name)} · last ${snap.windowMinutes} min`, dirOf(sorted.at(-1).changePct)),
    kpi('Rising / falling', `${up} / ${down}`, `of ${ings.length} priced ingredients`),
    kpi('Avg. food cost', `${avgFc.toFixed(1)}%`, 'of menu price, at live prices', avgFc > 35 ? 'up' : ''),
  ].join('') : '';

  const q = state.priceSearch.toLowerCase();
  const shown = snap.ingredients.filter((i) => (state.priceCat === 'all' || i.category === state.priceCat) && (!q || i.name.toLowerCase().includes(q)));
  rowsEl.innerHTML = shown.map((i) => {
    const prev = state.prevPrices[i.ingredientId];
    const flash = prev != null && i.marketPrice != null && prev !== i.marketPrice ? (i.marketPrice > prev ? 'flash-up' : 'flash-down') : '';
    const d = dirOf(i.changePct);
    return `<tr>
      <td><strong>${esc(i.name)}</strong><span class="sub">${esc(i.category)} · per ${esc(i.unit)}</span></td>
      <td class="num ${flash}"><strong>${price(i.marketPrice)}</strong><span class="sub ${dirOf(i.tickPct)}">${i.marketPrice == null ? 'no supplier' : pctText(i.tickPct) + ' last tick'}</span></td>
      <td>${spark(i.history, d)}</td>
      <td class="num ${d}">${i.marketPrice == null ? '—' : pctText(i.changePct)}</td>
      <td>${i.bestTrusted ? `${price(i.bestTrusted.price)}<span class="sub">${esc(i.bestTrusted.supplierName)}</span>` : '<span class="muted">no trusted supplier</span>'}</td>
      <td class="hide-sm"><div class="quotes">${i.quotes.map((x) => `<span class="quote ${x.trusted ? '' : 'untrusted'} ${i.bestTrusted?.supplierId === x.supplierId ? 'best' : ''}" title="List price ${price(x.basePrice)} · ${x.vsListPct > 0 ? '+' : ''}${x.vsListPct}% vs list${x.trusted ? '' : ' · not trusted'}">${esc(shortName(x.supplierName))} ${Number(x.price).toFixed(2)}</span>`).join('')}</div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">No ingredients match.</td></tr>';

  $('#menuCostRows').innerHTML = snap.menu.map((m) => {
    const pct = m.foodCostPct ?? 0;
    const color = pct > 40 ? 'var(--red)' : pct > 30 ? 'var(--amber)' : 'var(--green)';
    return `<tr><td><strong>${esc(m.name)}</strong></td><td class="num">${price(m.price)}</td><td class="num">${price(m.foodCost)}</td>
      <td><span class="meter"><i style="width:${Math.min(100, pct)}%;background:${color}"></i></span>${pct.toFixed(1)}%</td>
      <td class="num">${price(m.margin)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">No dishes yet – add some in Setup.</td></tr>';
}

views.prices.bind = (root) => {
  paintPrices();
  root.querySelectorAll('[data-pcat]').forEach((b) => b.addEventListener('click', () => {
    state.priceCat = b.dataset.pcat;
    root.querySelectorAll('[data-pcat]').forEach((x) => x.classList.toggle('on', x === b));
    paintPrices();
  }));
  $('#priceSearch', root).addEventListener('input', (e) => { state.priceSearch = e.target.value; paintPrices(); });
  $('#tickBtn', root).addEventListener('click', async () => {
    try { onPrices(await api('POST', '/api/prices/tick')); } catch (e) { toast(e.message, true); }
  });
  $('#feedToggle', root).addEventListener('click', async () => {
    try {
      const status = await api('POST', `/api/prices/${state.prices.status.running ? 'stop' : 'start'}`);
      state.prices.status = status;
      updateLivePill();
      paintPrices();
    } catch (e) { toast(e.message, true); }
  });
};

// ---------- setup (edit everything) ----------
const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'dozen', 'case', 'bottle'];
const typeBtn = (attrs, label, cls = 'btn sm') => `<button type="button" class="${cls}" ${attrs}>${label}</button>`;

ROW_TEMPLATES.recipe = (r = {}) => `<div class="edit-row">
  <select data-f="ingredientId" aria-label="Ingredient">${ingredientOptions(null, r.ingredientId)}</select>
  <input data-f="qty" type="number" step="any" min="0" value="${r.qty ?? ''}" placeholder="qty per dish" aria-label="Quantity per dish" required>
  ${typeBtn('data-del-row title="Remove line"', '✕', 'btn danger')}</div>`;

ROW_TEMPLATES.catalog = (c = {}) => `<div class="edit-row cat">
  <select data-f="ingredientId" aria-label="Ingredient">${ingredientOptions(null, c.ingredientId)}</select>
  <input data-f="unitPrice" type="number" step="0.01" min="0" value="${c.basePrice ?? c.unitPrice ?? ''}" placeholder="price" aria-label="List price" required>
  <input data-f="leadTimeDays" type="number" step="1" min="0" value="${c.leadTimeDays ?? 1}" aria-label="Lead time days" required>
  <input data-f="minOrderQty" type="number" step="any" min="0" value="${c.minOrderQty ?? 0}" aria-label="Minimum order">
  ${typeBtn('data-del-row title="Remove item"', '✕', 'btn danger')}</div>`;

function dishForm(m) {
  modal(`<h2>${m ? `Edit ${esc(m.name)}` : 'Add a dish'}</h2>
    <div class="row"><label>Dish name<input name="name" value="${esc(m?.name)}" required></label>
    <label>Menu price (${esc(state.meta.currency)})<input name="price" type="number" step="0.01" min="0" value="${m?.price ?? ''}" required></label></div>
    <div class="edit-rows"><div class="edit-head">Recipe – how much of each ingredient one portion uses (in the ingredient's unit)</div>
      <div class="edit-rows" data-rows="recipe">${(m?.recipe || [{}]).map(ROW_TEMPLATES.recipe).join('')}</div>
      <div>${typeBtn('data-add-row="recipe"', '+ Add ingredient')}</div></div>
    ${modalFoot(m ? 'Save dish' : 'Add dish')}`,
  async (d, form) => {
    const body = { name: d.name, price: Number(d.price), recipe: readRows(form, 'recipe') };
    await api(m ? 'PUT' : 'POST', m ? `/api/menu/${m.id}` : '/api/menu', body);
    await refreshRefs();
    toast(m ? 'Dish saved' : 'Dish added to the menu');
  }, { wide: true });
}

function ingredientForm(i) {
  const cats = [...new Set(state.ingredients.map((x) => x.category))];
  modal(`<h2>${i ? `Edit ${esc(i.name)}` : 'Add an ingredient'}</h2>
    <label>Name<input name="name" value="${esc(i?.name)}" required></label>
    <div class="row"><label>Unit<input name="unit" list="unitList" value="${esc(i?.unit || 'kg')}" required></label>
    <label>Category<input name="category" list="catList" value="${esc(i?.category)}" required></label></div>
    <label>Shelf life (days)<input name="shelfLifeDays" type="number" min="1" step="1" value="${i?.shelfLifeDays ?? 7}" required></label>
    <datalist id="unitList">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
    <datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    ${i ? '' : '<p class="muted" style="margin:0">Starts at 0 in every branch. Add it to a supplier\'s catalog to get a live price, and to a dish\'s recipe so orders use it.</p>'}
    ${modalFoot(i ? 'Save' : 'Add ingredient')}`,
  async (d) => {
    await api(i ? 'PUT' : 'POST', i ? `/api/ingredients/${i.id}` : '/api/ingredients', { ...d, shelfLifeDays: Number(d.shelfLifeDays) });
    await refreshRefs();
    toast(i ? 'Ingredient saved' : 'Ingredient added');
  });
}

function supplierForm(s) {
  modal(`<h2>${s ? `Edit ${esc(s.name)}` : 'Add a supplier'}</h2>
    <div class="row"><label>Supplier name<input name="name" value="${esc(s?.name)}" required></label>
    <label>Contact<input name="contact" value="${esc(s?.contact)}" placeholder="email or phone"></label></div>
    <div class="row"><label>Rating (0–5)<input name="rating" type="number" min="0" max="5" step="0.1" value="${s?.rating ?? 4}"></label>
    <label>On-time delivery %<input name="onTime" type="number" min="0" max="100" step="1" value="${Math.round((s?.onTimeRate ?? 0.9) * 100)}"></label></div>
    <label class="check"><input type="checkbox" name="trusted" ${s?.trusted ?? true ? 'checked' : ''}> Trusted supplier – allowed to receive purchase orders</label>
    <div class="edit-rows"><div class="edit-row cat edit-head"><span>Catalog item</span><span>List price</span><span>Lead days</span><span>Min order</span><span></span></div>
      <div class="edit-rows" data-rows="catalog">${(s?.catalog || []).map(ROW_TEMPLATES.catalog).join('')}</div>
      <div>${typeBtn('data-add-row="catalog"', '+ Add catalog item')}</div></div>
    ${modalFoot(s ? 'Save supplier' : 'Add supplier')}`,
  async (d, form) => {
    const body = { name: d.name, contact: d.contact, rating: Number(d.rating), onTimeRate: Number(d.onTime) / 100, trusted: d.trusted === 'on', catalog: readRows(form, 'catalog') };
    await api(s ? 'PUT' : 'POST', s ? `/api/suppliers/${s.id}` : '/api/suppliers', body);
    toast(s ? 'Supplier saved' : 'Supplier added');
  }, { wide: true });
}

function branchForm(b) {
  modal(`<h2>${b ? `Edit ${esc(b.name)}` : 'Add a branch'}</h2>
    <label>Branch name<input name="name" value="${esc(b?.name)}" required></label>
    <label>Location<input name="location" value="${esc(b?.location)}"></label>
    ${b ? '' : '<p class="muted" style="margin:0">The new branch gets its own signing key, and HQ adds it to the ledger with a new block, so it can send and receive transfers right away. Stock starts at 0.</p>'}
    ${modalFoot(b ? 'Save' : 'Add branch')}`,
  async (d) => {
    const nb = await api(b ? 'PATCH' : 'POST', b ? `/api/branches/${b.id}` : '/api/branches', d);
    await refreshRefs();
    toast(b ? 'Branch saved' : `${nb.name} added and registered on the ledger`);
  });
}

const setupPanels = {
  async menu() {
    const snap = await api('GET', '/api/prices');
    const cost = Object.fromEntries(snap.menu.map((m) => [m.menuItemId, m]));
    return `<div class="card"><div class="card-head"><h2>Menu &amp; recipes</h2>${typeBtn('data-act="add-dish"', 'Add dish', 'btn primary')}</div>
      <div class="table-wrap"><table><thead><tr><th>Dish</th><th class="num">Price</th><th>Recipe (per portion)</th><th class="num">Food cost</th><th></th></tr></thead><tbody>
      ${state.menu.map((m) => `<tr><td><strong>${esc(m.name)}</strong></td><td class="num">${price(m.price)}</td>
        <td>${esc(m.recipe.map((r) => `${r.qty} ${ingUnit(r.ingredientId)} ${ingName(r.ingredientId)}`).join(', '))}</td>
        <td class="num">${cost[m.id] ? `${cost[m.id].foodCostPct}%` : '—'}</td>
        <td><div class="actions">${typeBtn(`data-act="edit-dish" data-id="${m.id}"`, 'Edit')}${typeBtn(`data-act="del-dish" data-id="${m.id}"`, 'Delete', 'btn sm danger')}</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No dishes yet.</td></tr>'}
      </tbody></table></div></div>`;
  },
  async ingredients() {
    const suppliers = await api('GET', '/api/suppliers');
    return `<div class="card"><div class="card-head"><h2>Ingredients</h2>${typeBtn('data-act="add-ing"', 'Add ingredient', 'btn primary')}</div>
      <div class="table-wrap"><table><thead><tr><th>Ingredient</th><th>Unit</th><th>Category</th><th class="num">Shelf life</th><th>Used in</th><th>Suppliers</th><th></th></tr></thead><tbody>
      ${state.ingredients.map((i) => {
        const used = state.menu.filter((m) => m.recipe.some((r) => r.ingredientId === i.id)).length;
        const sup = suppliers.filter((s) => s.catalog.some((c) => c.ingredientId === i.id)).length;
        return `<tr><td><strong>${esc(i.name)}</strong></td><td>${esc(i.unit)}</td><td>${esc(i.category)}</td><td class="num">${i.shelfLifeDays}d</td>
          <td>${used} dish${used === 1 ? '' : 'es'}</td><td>${sup || '<span class="up">none – no price</span>'}</td>
          <td><div class="actions">${typeBtn(`data-act="edit-ing" data-id="${i.id}"`, 'Edit')}${typeBtn(`data-act="del-ing" data-id="${i.id}"`, 'Delete', 'btn sm danger')}</div></td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No ingredients yet.</td></tr>'}
      </tbody></table></div></div>`;
  },
  async suppliers() {
    state.suppliers = await api('GET', '/api/suppliers');
    return `<div class="card"><div class="card-head"><h2>Suppliers</h2>${typeBtn('data-act="add-sup"', 'Add supplier', 'btn primary')}</div>
      <div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Status</th><th class="num">Rating</th><th class="num">On time</th><th>Supplies</th><th></th></tr></thead><tbody>
      ${state.suppliers.map((s) => `<tr><td><strong>${esc(s.name)}</strong><span class="sub">${esc(s.contact)}</span></td>
        <td>${chip(s.trusted ? 'trusted' : 'untrusted', s.trusted ? 'Trusted' : 'Not trusted')}</td>
        <td class="num">${s.rating.toFixed(1)}</td><td class="num">${Math.round(s.onTimeRate * 100)}%</td>
        <td>${esc(s.catalog.map((c) => ingName(c.ingredientId)).join(', ')) || '<span class="muted">nothing yet</span>'}</td>
        <td><div class="actions">${typeBtn(`data-act="edit-sup" data-id="${s.id}"`, 'Edit')}${typeBtn(`data-act="del-sup" data-id="${s.id}"`, 'Delete', 'btn sm danger')}</div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No suppliers yet.</td></tr>'}
      </tbody></table></div></div>`;
  },
  async branches() {
    return `<div class="card"><div class="card-head"><h2>Branches</h2>${typeBtn('data-act="add-branch"', 'Add branch', 'btn primary')}</div>
      <div class="table-wrap"><table><thead><tr><th>Branch</th><th>Location</th><th>ID</th><th>Ledger</th><th></th></tr></thead><tbody>
      ${state.branches.map((b) => `<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.location) || '<span class="muted">—</span>'}</td><td class="mono">${esc(b.id)}</td>
        <td>${chip('ok', 'Signing member')}</td><td>${typeBtn(`data-act="edit-branch" data-id="${b.id}"`, 'Edit')}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  },
  async business() {
    return `<section class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Business details</h2></div>
        <form class="card-body edit-rows" id="metaForm">
          <label class="edit-rows"><span class="edit-head">Business / group name</span><input name="chainName" value="${esc(state.meta.chainName)}" required></label>
          <label class="edit-rows"><span class="edit-head">Currency code</span><input name="currency" value="${esc(state.meta.currency)}" maxlength="6" required></label>
          <div><button class="btn primary">Save details</button></div>
        </form></div>
      <div class="card"><div class="card-head"><h2>Your data</h2></div>
        <div class="card-body edit-rows">
          <p class="muted" style="margin:0">Download everything (branches, menu, recipes, ingredients, suppliers, stock, orders, POs) as one JSON file. Edit it by hand or keep it as a backup, then import it here or on another machine.</p>
          <div class="actions">${typeBtn('data-act="export"', 'Export JSON', 'btn primary')}
            <label class="btn">Import JSON<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
        </div></div>
      <div class="card danger-zone"><div class="card-head"><h2>Start over</h2></div>
        <div class="card-body edit-rows">
          <p class="muted" style="margin:0"><b>Blank template</b>: one empty branch, no menu or suppliers, ready to fill with your own data. <b>Demo data</b>: puts back the three-branch sample group.</p>
          <div class="actions">${typeBtn('data-act="blank"', 'Start from blank', 'btn danger')}${typeBtn('data-act="reset"', 'Restore demo data', 'btn danger')}</div>
        </div></div>
    </section>`;
  },
};

views.setup = async () => {
  const tabs = [['menu', 'Menu & recipes'], ['ingredients', 'Ingredients'], ['suppliers', 'Suppliers'], ['branches', 'Branches'], ['business', 'Business & data']];
  return `
  <div class="page-head"><div><h1>Setup</h1><p>Everything here can be edited, so you can turn the demo into your own business. Changes save straight away and show up on every screen.</p></div></div>
  <div class="seg" style="overflow-x:auto;max-width:100%;justify-self:start">${tabs.map(([k, l]) => `<button data-stab="${k}" class="${state.setupTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${await setupPanels[state.setupTab]()}`;
};

views.setup.bind = (root) => {
  root.querySelectorAll('[data-stab]').forEach((b) => b.addEventListener('click', () => { state.setupTab = b.dataset.stab; render(); }));
  const del = (what, name, url, after) => confirmDialog(`Delete ${what}?`, `<b>${esc(name)}</b> will be removed. This can't be undone (but you can restore the demo data or import a backup).`, 'Delete',
    async () => { await api('DELETE', url); if (after) await after(); toast(`${name} deleted`); });
  const handlers = {
    'add-dish': () => dishForm(),
    'edit-dish': (id) => dishForm(state.menu.find((m) => m.id === id)),
    'del-dish': (id) => del('dish', state.menu.find((m) => m.id === id).name, `/api/menu/${id}`, refreshRefs),
    'add-ing': () => ingredientForm(),
    'edit-ing': (id) => ingredientForm(state.ingredients.find((i) => i.id === id)),
    'del-ing': (id) => del('ingredient', ingName(id), `/api/ingredients/${id}`, refreshRefs),
    'add-sup': () => supplierForm(),
    'edit-sup': (id) => supplierForm(state.suppliers.find((s) => s.id === id)),
    'del-sup': (id) => del('supplier', state.suppliers.find((s) => s.id === id).name, `/api/suppliers/${id}`),
    'add-branch': () => branchForm(),
    'edit-branch': (id) => branchForm(state.branches.find((b) => b.id === id)),
    export: async () => {
      const data = await api('GET', '/api/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `stockchain-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    blank: () => confirmDialog('Start from a blank template?', 'All current branches, menu, suppliers, stock, orders and ledger history will be replaced with one empty branch. Export first if you want to keep them.', 'Replace with blank',
      async () => {
        await api('POST', '/api/import', { data: { meta: state.meta, branches: [{ id: 'main-branch', name: 'Main branch', location: '' }], ingredients: [], menu: [], suppliers: [] } });
        state.prices = null;
        await refreshRefs();
        state.setupTab = 'ingredients';
        toast('Blank template ready – start by adding ingredients');
      }),
    reset: () => confirmDialog('Restore demo data?', 'Everything will be replaced with the three-branch sample group.', 'Restore demo',
      async () => { await api('POST', '/api/reset'); state.prices = null; await refreshRefs(); toast('Demo data restored'); }),
  };
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => handlers[b.dataset.act](b.dataset.id)));
  $('#metaForm', root)?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    act(async () => { await api('PATCH', '/api/meta', Object.fromEntries(new FormData(ev.target))); await refreshRefs(); }, 'Details saved');
  });
  $('#importFile', root)?.addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    act(async () => {
      let json;
      try { json = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON'); }
      await api('POST', '/api/import', json);
      state.prices = null;
      await refreshRefs();
    }, 'Data imported – a fresh ledger was started for the imported branches');
  });
};

// ---------- shell ----------
async function render() {
  const root = $('#view');
  if (render.busy) return void (render.again = true);
  render.busy = true;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  try {
    root.innerHTML = await views[state.view]();
    views[state.view].bind?.(root);
  } catch (e) {
    root.innerHTML = `<div class="card empty">Could not load: ${esc(e.message)}</div>`;
  }
  root.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => setBranch(b.dataset.switch)));
  render.busy = false;
  if (render.again) {
    render.again = false;
    render();
  }
}

/** Reload reference data after edits in Setup (or an import). */
async function refreshRefs() {
  const [branches, ingredients, menu, ov] = await Promise.all([api('GET', '/api/branches'), api('GET', '/api/ingredients'), api('GET', '/api/menu'), api('GET', '/api/overview')]);
  Object.assign(state, { branches, ingredients, menu, meta: ov.meta });
  $('#chainName').textContent = ov.meta.chainName;
  if (!branches.some((b) => b.id === state.branchId)) state.branchId = branches[0].id;
  const sel = $('#branchSelect');
  sel.innerHTML = branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  sel.value = state.branchId;
}

// ---------- live price stream ----------
function updateLivePill() {
  const pill = $('#livePill');
  const st = state.prices?.status;
  const connected = state.streamOpen;
  pill.classList.toggle('on', Boolean(connected && st?.running && !st?.error));
  pill.classList.toggle('err', Boolean(st?.error) || !connected);
  $('#liveText').textContent = !connected ? 'Offline' : st?.error ? 'Feed error' : st?.running ? 'Live prices' : 'Prices paused';
}

function onPrices(snap) {
  const prev = {};
  for (const i of state.prices?.ingredients || []) prev[i.ingredientId] = i.marketPrice;
  state.prevPrices = prev;
  state.prices = snap;
  updateLivePill();
  if (state.view === 'prices') paintPrices();
}

function connectPrices() {
  const es = new EventSource('/api/prices/stream');
  es.addEventListener('open', () => { state.streamOpen = true; updateLivePill(); });
  es.addEventListener('prices', (e) => { state.streamOpen = true; onPrices(JSON.parse(e.data)); });
  es.addEventListener('error', () => { state.streamOpen = false; updateLivePill(); });
}

function setBranch(id) {
  state.branchId = id;
  state.cart = {};
  $('#branchSelect').value = id;
  try { localStorage.setItem('stockchain.branch', id); } catch {}
  render();
}

async function init() {
  const [branches, ingredients, menu, ov] = await Promise.all([api('GET', '/api/branches'), api('GET', '/api/ingredients'), api('GET', '/api/menu'), api('GET', '/api/overview')]);
  Object.assign(state, { branches, ingredients, menu, meta: ov.meta });
  $('#chainName').textContent = ov.meta.chainName;
  let saved = null;
  try { saved = localStorage.getItem('stockchain.branch'); } catch {}
  state.branchId = branches.some((b) => b.id === saved) ? saved : branches[0].id;
  const sel = $('#branchSelect');
  sel.innerHTML = branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  sel.value = state.branchId;
  sel.addEventListener('change', () => setBranch(sel.value));
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  $('#livePill').addEventListener('click', () => { state.view = 'prices'; render(); });
  connectPrices();
  render();
}

init();
