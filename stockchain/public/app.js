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
};

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
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

function modal(html, onSubmit) {
  const dlg = $('#modal');
  const form = $('#modalForm');
  form.innerHTML = html;
  form.onsubmit = async (ev) => {
    if (ev.submitter?.value === 'cancel') return;
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await onSubmit(data);
      dlg.close();
      render();
    } catch (e) {
      toast(e.message, true);
    }
  };
  dlg.showModal();
}

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

// ---------- shell ----------
async function render() {
  const root = $('#view');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  try {
    root.innerHTML = await views[state.view]();
    views[state.view].bind?.(root);
  } catch (e) {
    root.innerHTML = `<div class="card empty">Could not load: ${esc(e.message)}</div>`;
  }
  root.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => setBranch(b.dataset.switch)));
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
  render();
}

init();
