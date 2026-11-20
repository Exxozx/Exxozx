'use strict';
/*
 * Restaurant setup wizard. Runs once on the first visit (and can be resumed: every step
 * saves straight away). The same steps are reused later to edit the profile.
 */
const WIZARD_STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'restaurant', title: 'Restaurant & manager' },
  { id: 'locations', title: 'Locations & tables' },
  { id: 'stock', title: 'Ingredients & stock' },
  { id: 'menu', title: 'Menu & favourites' },
  { id: 'kitchenware', title: 'Kitchenware & utilities' },
  { id: 'channels', title: 'Ordering channels' },
  { id: 'review', title: 'Review & finish' },
];
const EQUIPMENT_CATEGORIES = ['Cookware', 'Appliances', 'Utensils', 'Tableware', 'Cleaning', 'Utilities'];
const SUGGESTED_EQUIPMENT = [['Oven', 'Appliances'], ['Deep fryer', 'Appliances'], ['Refrigerator', 'Appliances'], ['Chef knives', 'Utensils'], ['Cutting boards', 'Utensils'],
  ['Frying pans', 'Cookware'], ['Saucepans', 'Cookware'], ['Dinner plates', 'Tableware'], ['Glasses', 'Tableware'], ['Cutlery sets', 'Tableware'],
  ['Gas cylinders', 'Utilities'], ['Fire extinguishers', 'Utilities'], ['First-aid kits', 'Utilities'], ['Mops & buckets', 'Cleaning']];
const SUGGESTED_INGREDIENTS = [['Rice', 'kg', 'Dry Goods', 365], ['Flour', 'kg', 'Dry Goods', 180], ['Chicken', 'kg', 'Meat', 3], ['Eggs', 'pcs', 'Dairy', 21],
  ['Milk', 'L', 'Dairy', 7], ['Tomato', 'kg', 'Produce', 6], ['Onion', 'kg', 'Produce', 30], ['Cooking oil', 'L', 'Dry Goods', 180], ['Bread', 'pcs', 'Bakery', 3]];

function openWizard(step = 1) {
  state.wizard = { step, drafts: {} };
  state.view = 'wizard';
  render();
}

const setupMode = () => !state.profile?.setupComplete;
const inp = (label, name, value, attrs = '') => `<label>${t(label)}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;

// ---------- steps ----------
const STEP_VIEWS = {};

STEP_VIEWS.welcome = {
  render: () => `
    <div class="welcome-hero">
      <span class="logo xl" aria-hidden="true"></span>
      <h1>${t('Welcome to Muratab')} <span class="ar" lang="ar">مرتب</span></h1>
      <p>${t('Muratab means “neat”. Tell us about your restaurant once – locations, tables, menu, stock and kitchenware – and every screen works from your real information.')}</p>
    </div>
    <h3>${t('Make it yours')}</h3>
    ${prefsControls(state.prefs)}
    ${setupMode() ? `<h3>${t('How would you like to start?')}</h3>
    <div class="choice-grid">
      <label class="choice"><input type="radio" name="start" value="blank" checked><span><strong>${t('Set up my restaurant')}</strong>${t('Start empty and enter your own locations, menu and stock.')}</span></label>
      <label class="choice"><input type="radio" name="start" value="sample"><span><strong>${t('Start from the sample restaurant')}</strong>${t('A three-branch group with menu, stock and orders already filled in. Edit anything as you go.')}</span></label>
    </div>` : ''}`,
  bind: (root) => bindPrefs(root),
  async save(root) {
    const choice = root.querySelector('input[name=start]:checked')?.value;
    if (setupMode() && choice === 'blank' && !state.wizard.startedBlank) {
      await api('POST', '/api/import', { data: {
        meta: { chainName: '', currency: state.meta.currency || 'AED' },
        profile: { setupComplete: false, setupStep: 1, managerName: '', managerTitle: 'General Manager', cuisine: '', preferences: state.prefs },
        branches: [{ id: 'main', name: t('Main branch'), location: '', tables: [] }],
        ingredients: [], menu: [], suppliers: [], equipment: [],
      } });
      state.wizard.startedBlank = true;
      state.prices = null;
      await refreshRefs();
    }
  },
};

STEP_VIEWS.restaurant = {
  render: () => {
    const p = state.profile;
    return `<div class="form-grid">
      ${inp('Restaurant or group name', 'restaurantName', p.restaurantName, 'required maxlength="80" autocomplete="organization"')}
      ${inp('Cuisine / concept', 'cuisine', p.cuisine, `maxlength="60" placeholder="${t('e.g. Lebanese grill, casual dining')}"`)}
      ${inp("Manager's name", 'managerName', p.managerName, 'required maxlength="60" autocomplete="name"')}
      ${inp('Job title', 'managerTitle', p.managerTitle ? t(p.managerTitle) : '', 'maxlength="60"')}
      ${inp('Phone', 'phone', p.phone, 'type="tel" maxlength="30" autocomplete="tel"')}
      ${inp('Email', 'email', p.email, 'type="email" maxlength="120" autocomplete="email"')}
      ${inp('Currency code', 'currency', p.currency, 'required maxlength="6"')}
    </div>`;
  },
  async save(root) {
    const d = Object.fromEntries(new FormData(root));
    if (!d.restaurantName.trim()) throw new Error(t('Add the restaurant name'));
    if (!d.managerName.trim()) throw new Error(t("Add the manager's name"));
    await api('PATCH', '/api/profile', { ...d, requireManager: true });
    await refreshRefs();
  },
};

// Locations & tables: edited as a draft, saved in one go.
function locationDraft() {
  return (state.wizard.drafts.locations ||= state.branches.map((b) => ({ id: b.id, name: b.name, location: b.location || '', phone: b.phone || '', hours: b.hours || '', tables: (b.tables || []).map((x) => ({ ...x })) })));
}
function collectLocations(root) {
  state.wizard.drafts.locations = [...root.querySelectorAll('.loc-card')].map((card) => ({
    id: card.dataset.id || undefined,
    ...Object.fromEntries(['name', 'location', 'phone', 'hours'].map((f) => [f, card.querySelector(`[data-f="${f}"]`).value])),
    tables: [...card.querySelectorAll('[data-rows] .edit-row')].map((r) => ({
      id: r.dataset.id || undefined,
      label: r.querySelector('[data-f=label]').value,
      seats: Number(r.querySelector('[data-f=seats]').value) || 1,
      area: r.querySelector('[data-f=area]').value,
    })),
  }));
  return state.wizard.drafts.locations;
}
const tableRow = (x = {}) => `<div class="edit-row tbl" data-id="${esc(x.id || '')}">
  <input data-f="label" value="${esc(x.label || '')}" aria-label="${t('Table name')}" placeholder="T1" required>
  <input data-f="seats" type="number" min="1" max="40" value="${x.seats ?? 4}" aria-label="${t('Seats')}">
  <input data-f="area" value="${esc(x.area || 'Indoor')}" aria-label="${t('Area')}" list="areaList">
  <button type="button" class="btn danger" data-del-table title="${t('Remove')}">✕</button></div>`;

STEP_VIEWS.locations = {
  render: () => {
    const list = locationDraft();
    return `<datalist id="areaList">${['Indoor', 'Terrace', 'Outdoor', 'Bar', 'Private room', 'Concourse'].map((a) => `<option value="${a}">`).join('')}</datalist>
    <div class="edit-rows">${list.map((b, i) => `
      <div class="card loc-card" data-id="${esc(b.id || '')}" data-idx="${i}">
        <div class="card-head"><h3>${esc(b.name || t('New location'))}</h3>
          ${list.length > 1 ? `<button type="button" class="btn sm danger" data-del-loc="${i}">${t('Remove location')}</button>` : ''}</div>
        <div class="card-body edit-rows">
          <div class="form-grid">
            <label>${t('Location name')}<input data-f="name" value="${esc(b.name)}" required maxlength="60"></label>
            <label>${t('Address / area')}<input data-f="location" value="${esc(b.location)}" maxlength="80"></label>
            <label>${t('Phone')}<input data-f="phone" type="tel" value="${esc(b.phone)}" maxlength="30"></label>
            <label>${t('Opening hours')}<input data-f="hours" value="${esc(b.hours)}" maxlength="60" placeholder="10:00 – 23:00"></label>
          </div>
          <div class="edit-head">${t('Tables')} · ${t('{n} tables, {s} seats', { n: b.tables.length, s: b.tables.reduce((s, x) => s + (Number(x.seats) || 0), 0) })}</div>
          <div class="edit-row tbl edit-head"><span>${t('Table')}</span><span>${t('Seats')}</span><span>${t('Area')}</span><span></span></div>
          <div class="edit-rows tables" data-rows="tables">${b.tables.map(tableRow).join('')}</div>
          <div class="quick-add">
            <span>${t('Add')}</span><input type="number" min="1" max="100" value="4" data-q="count" aria-label="${t('How many tables')}">
            <span>${t('tables with')}</span><input type="number" min="1" max="40" value="4" data-q="seats" aria-label="${t('Seats each')}">
            <span>${t('seats in')}</span><input value="Indoor" data-q="area" list="areaList" aria-label="${t('Area')}">
            <button type="button" class="btn sm" data-add-tables="${i}">${t('Add tables')}</button>
          </div>
        </div>
      </div>`).join('')}
      <div>${typeBtn('data-add-loc', t('+ Add another location'))}</div>
    </div>`;
  },
  bind(root) {
    root.querySelectorAll('[data-del-table]').forEach((b) => b.addEventListener('click', () => b.closest('.edit-row').remove()));
    root.querySelector('[data-add-loc]').addEventListener('click', () => {
      collectLocations(root).push({ name: '', location: '', phone: '', hours: '', tables: [] });
      render();
    });
    root.querySelectorAll('[data-del-loc]').forEach((b) => b.addEventListener('click', () => {
      collectLocations(root).splice(Number(b.dataset.delLoc), 1);
      render();
    }));
    root.querySelectorAll('[data-add-tables]').forEach((b) => b.addEventListener('click', () => {
      const wrap = b.closest('.quick-add');
      const q = (k) => wrap.querySelector(`[data-q=${k}]`).value;
      const list = collectLocations(root);
      const loc = list[Number(b.dataset.addTables)];
      const used = new Set(loc.tables.map((x) => x.label.toLowerCase()));
      let n = loc.tables.length;
      for (let i = 0; i < Math.min(100, Number(q('count')) || 0); i++) {
        let label;
        do label = `T${++n}`; while (used.has(label.toLowerCase()));
        used.add(label.toLowerCase());
        loc.tables.push({ label, seats: Number(q('seats')) || 4, area: q('area') || 'Indoor' });
      }
      render();
    }));
  },
  async save(root) {
    const list = collectLocations(root);
    if (list.some((b) => !b.name.trim())) throw new Error(t('Every location needs a name'));
    await api('PUT', '/api/profile/branches', { branches: list });
    await refreshRefs();
  },
};

// Ingredients & stock
async function stockDraft() {
  if (state.wizard.drafts.stock) return state.wizard.drafts.stock;
  const reports = await Promise.all(state.branches.map((b) => api('GET', `/api/branches/${b.id}/inventory`)));
  const qty = (bi, id) => reports[bi].find((r) => r.ingredientId === id)?.qty ?? 0;
  state.wizard.drafts.stock = state.ingredients.map((i) => ({ ...i, stock: Object.fromEntries(state.branches.map((b, bi) => [b.id, qty(bi, i.id)])) }));
  return state.wizard.drafts.stock;
}
function collectStock(root) {
  state.wizard.drafts.stock = [...root.querySelectorAll('tr[data-ing]')].map((r) => {
    const f = (k) => r.querySelector(`[data-f="${k}"]`).value;
    return {
      id: r.dataset.ing || undefined, name: f('name'), unit: f('unit'), category: f('category'), shelfLifeDays: Number(f('shelfLifeDays')) || 1,
      stock: Object.fromEntries(state.branches.map((b) => [b.id, r.querySelector(`[data-stock="${b.id}"]`).value])),
    };
  });
  return state.wizard.drafts.stock;
}
const ingRow = (i) => `<tr data-ing="${esc(i.id || '')}">
  <td><input data-f="name" value="${esc(i.name)}" required aria-label="${t('Ingredient')}"></td>
  <td><input data-f="unit" value="${esc(i.unit || 'kg')}" list="unitList" class="w-s" aria-label="${t('Unit')}"></td>
  <td><input data-f="category" value="${esc(i.category || '')}" list="ingCatList" aria-label="${t('Category')}"></td>
  <td><input data-f="shelfLifeDays" type="number" min="1" value="${i.shelfLifeDays ?? 7}" class="w-s" aria-label="${t('Shelf life (days)')}"></td>
  ${state.branches.map((b) => `<td><input data-stock="${b.id}" type="number" min="0" step="any" value="${i.stock?.[b.id] ?? 0}" class="w-s" aria-label="${esc(b.name)}"></td>`).join('')}
  <td><button type="button" class="btn sm danger" data-del-ing title="${t('Remove')}">✕</button></td></tr>`;

STEP_VIEWS.stock = {
  async render() {
    const rows = await stockDraft();
    const cats = [...new Set(rows.map((r) => r.category).concat(['Produce', 'Meat', 'Seafood', 'Dairy', 'Bakery', 'Dry Goods', 'Spices', 'Drinks']).filter(Boolean))];
    return `<p class="muted">${t('List what you cook with and how much is on the shelf now at each location. Muratab subtracts what every order uses and warns you before you run out.')}</p>
    <datalist id="unitList">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
    <datalist id="ingCatList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="quotes">${t('Quick add:')} ${SUGGESTED_INGREDIENTS.filter(([n]) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase())).map(([n], k) => `<button type="button" class="quote" data-suggest-ing="${k}">+ ${t(n)}</button>`).join('')}</div>
    <div class="table-wrap"><table class="grid-edit">
      <thead><tr><th>${t('Ingredient')}</th><th>${t('Unit')}</th><th>${t('Category')}</th><th>${t('Shelf life (days)')}</th>${state.branches.map((b) => `<th>${t('On hand')} · ${esc(b.name)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(ingRow).join('')}</tbody></table></div>
    <div>${typeBtn('data-add-ing', t('+ Add ingredient'))}</div>`;
  },
  bind(root) {
    root.querySelector('[data-add-ing]').addEventListener('click', () => { collectStock(root).push({ name: '', unit: 'kg', category: '', shelfLifeDays: 7, stock: {} }); render(); });
    root.querySelectorAll('[data-del-ing]').forEach((b) => b.addEventListener('click', () => b.closest('tr').remove()));
    root.querySelectorAll('[data-suggest-ing]').forEach((b) => b.addEventListener('click', () => {
      const rows = collectStock(root);
      const avail = SUGGESTED_INGREDIENTS.filter(([n]) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase()));
      const [name, unit, category, shelfLifeDays] = avail[Number(b.dataset.suggestIng)];
      rows.push({ name: t(name), unit, category, shelfLifeDays, stock: {} });
      render();
    }));
  },
  async save(root) {
    const rows = collectStock(root).filter((r) => r.name.trim());
    await api('PUT', '/api/profile/ingredients', { ingredients: rows });
    state.wizard.drafts.stock = null;
    await refreshRefs();
  },
};

STEP_VIEWS.menu = {
  render: () => {
    const byCat = {};
    for (const m of state.menu) (byCat[m.category || t('Menu')] ||= []).push(m);
    return `<p class="muted">${t('Add each dish with its price and recipe. Tap the star on your most popular dishes – they appear on the home screen. Changes here save immediately.')}</p>
    ${state.ingredients.length ? '' : `<p class="up">${t('Add your ingredients first – recipes are built from them.')}</p>`}
    ${Object.entries(byCat).map(([cat, dishes]) => `<div class="card"><div class="card-head"><h3>${esc(cat)}</h3><span class="muted">${dishes.length}</span></div><div class="list">
      ${dishes.map((m) => `<div class="list-item">
        <div class="dish-line"><button type="button" class="star ${m.popular ? 'on' : ''}" data-star="${m.id}" aria-pressed="${Boolean(m.popular)}" title="${t('Most popular')}">★</button>
          <div><strong>${esc(m.name)}</strong> <span class="muted">${price(m.price)}</span>
          <span class="sub muted">${esc(m.recipe.map((r) => `${r.qty} ${ingUnit(r.ingredientId)} ${ingName(r.ingredientId)}`).join(', '))}</span></div></div>
        <div class="actions">${typeBtn(`data-edit-dish="${m.id}"`, t('Edit'))}${typeBtn(`data-del-dish="${m.id}"`, t('Delete'), 'btn sm danger')}</div></div>`).join('')}
    </div></div>`).join('') || `<div class="card empty">${t('No dishes yet.')}</div>`}
    <div>${typeBtn('data-add-dish', t('+ Add dish'), 'btn primary')}</div>`;
  },
  bind(root) {
    root.querySelector('[data-add-dish]').addEventListener('click', () => dishForm());
    root.querySelectorAll('[data-edit-dish]').forEach((b) => b.addEventListener('click', () => dishForm(state.menu.find((m) => m.id === b.dataset.editDish))));
    root.querySelectorAll('[data-del-dish]').forEach((b) => b.addEventListener('click', () => {
      const m = state.menu.find((x) => x.id === b.dataset.delDish);
      confirmDialog(t('Delete dish?'), `<b>${esc(m.name)}</b>`, t('Delete'), async () => { await api('DELETE', `/api/menu/${m.id}`); await refreshRefs(); });
    }));
    root.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => act(async () => {
      const m = state.menu.find((x) => x.id === b.dataset.star);
      await api('PUT', `/api/menu/${m.id}`, { ...m, popular: !m.popular });
      await refreshRefs();
    })));
  },
  save: async () => {},
};

// Kitchenware & utilities
async function equipmentDraft() {
  return (state.wizard.drafts.equipment ||= await api('GET', '/api/equipment'));
}
function collectEquipment(root) {
  state.wizard.drafts.equipment = [...root.querySelectorAll('tr[data-eq]')].map((r) => ({
    id: r.dataset.eq || undefined,
    name: r.querySelector('[data-f=name]').value,
    category: r.querySelector('[data-f=category]').value,
    minimum: r.querySelector('[data-f=minimum]').value,
    counts: Object.fromEntries(state.branches.map((b) => [b.id, r.querySelector(`[data-count="${b.id}"]`).value])),
  }));
  return state.wizard.drafts.equipment;
}
const eqRow = (e) => `<tr data-eq="${esc(e.id || '')}">
  <td><input data-f="name" value="${esc(e.name)}" required aria-label="${t('Item')}"></td>
  <td><select data-f="category" aria-label="${t('Category')}">${EQUIPMENT_CATEGORIES.map((c) => `<option value="${c}" ${c === e.category ? 'selected' : ''}>${t(c)}</option>`).join('')}</select></td>
  ${state.branches.map((b) => `<td><input data-count="${b.id}" type="number" min="0" value="${e.counts?.[b.id] ?? 0}" class="w-s" aria-label="${esc(b.name)}"></td>`).join('')}
  <td><input data-f="minimum" type="number" min="0" value="${e.minimum ?? ''}" class="w-s" placeholder="—" aria-label="${t('Minimum')}"></td>
  <td><button type="button" class="btn sm danger" data-del-eq title="${t('Remove')}">✕</button></td></tr>`;

STEP_VIEWS.kitchenware = {
  async render() {
    const rows = await equipmentDraft();
    return `<p class="muted">${t('Count your kitchenware, tableware and utilities at each location. Set a minimum and Muratab flags anything that falls below it.')}</p>
    <div class="quotes">${t('Quick add:')} ${SUGGESTED_EQUIPMENT.filter(([n]) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase())).map(([n], k) => `<button type="button" class="quote" data-suggest-eq="${k}">+ ${t(n)}</button>`).join('')}</div>
    <div class="table-wrap"><table class="grid-edit">
      <thead><tr><th>${t('Item')}</th><th>${t('Category')}</th>${state.branches.map((b) => `<th>${esc(b.name)}</th>`).join('')}<th>${t('Minimum')}</th><th></th></tr></thead>
      <tbody>${rows.map(eqRow).join('')}</tbody></table></div>
    <div>${typeBtn('data-add-eq', t('+ Add item'))}</div>`;
  },
  bind(root) {
    root.querySelector('[data-add-eq]').addEventListener('click', () => { collectEquipment(root).push({ name: '', category: 'Cookware', counts: {} }); render(); });
    root.querySelectorAll('[data-del-eq]').forEach((b) => b.addEventListener('click', () => b.closest('tr').remove()));
    root.querySelectorAll('[data-suggest-eq]').forEach((b) => b.addEventListener('click', () => {
      const rows = collectEquipment(root);
      const avail = SUGGESTED_EQUIPMENT.filter(([n]) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase()));
      const [name, category] = avail[Number(b.dataset.suggestEq)];
      rows.push({ name: t(name), category, counts: {} });
      render();
    }));
  },
  async save(root) {
    await api('PUT', '/api/equipment', { equipment: collectEquipment(root).filter((r) => r.name.trim()) });
    state.wizard.drafts.equipment = null;
  },
};

// Ordering channels
const webhookUrl = (id) => `${location.origin}/api/integrations/${id}/orders`;
STEP_VIEWS.channels = {
  async render() {
    const { list, config } = await api('GET', '/api/channels');
    return `<p class="muted">${t('Choose where orders come from. Delivery-app orders arrive in the same kitchen board as dine-in, and every status change is sent back to the app.')}</p>
    <div class="channel-grid">${list.map((c) => {
      const cfg = config[c.id] || {};
      const ext = c.kind !== 'internal';
      return `<div class="card channel-card" data-ch="${c.id}">
        <div class="card-head"><h3>${esc(channelName(c.id))}</h3>
          <label class="switch"><input type="checkbox" data-f="enabled" ${cfg.enabled ? 'checked' : ''}><span>${t('On')}</span></label></div>
        <div class="card-body edit-rows">
          ${ext ? `<span class="sub muted">${esc(c.platform)}</span>
          <div class="form-grid">${state.branches.map((b) => `<label>${t('Store ID')} · ${esc(b.name)}<input data-store="${b.id}" value="${esc(cfg.storeIds?.[b.id] || '')}" placeholder="${t('from the platform')}"></label>`).join('')}</div>
          <div class="form-grid">
            <label class="check"><input type="checkbox" data-f="autoAccept" ${cfg.autoAccept ? 'checked' : ''}> ${t('Accept orders automatically')}</label>
            <label>${t('Preparation time (minutes)')}<input data-f="prepMinutes" type="number" min="1" max="240" value="${cfg.prepMinutes ?? 20}"></label>
          </div>
          <div class="edit-head">${t('Order webhook for the platform')}</div>
          ${LOCAL ? `<span class="sub muted">${t('Available when Muratab runs on your server. In this prototype, use “Simulate order” on the Orders screen.')}</span>` : `<code class="mono copyable">${esc(webhookUrl(c.id))}</code>`}`
          : `<span class="sub muted">${t(c.id === 'dine_in' ? 'Orders taken at the table, linked to your floor plan.' : 'Orders collected at the counter.')}</span>`}
        </div></div>`;
    }).join('')}</div>`;
  },
  async save(root) {
    const body = {};
    root.querySelectorAll('[data-ch]').forEach((card) => {
      const f = (k) => card.querySelector(`[data-f=${k}]`);
      const c = { enabled: f('enabled').checked };
      if (f('autoAccept')) {
        c.autoAccept = f('autoAccept').checked;
        c.prepMinutes = Number(f('prepMinutes').value) || 20;
        c.storeIds = Object.fromEntries([...card.querySelectorAll('[data-store]')].map((i) => [i.dataset.store, i.value]));
      }
      body[card.dataset.ch] = c;
    });
    await api('PATCH', '/api/channels', body);
  },
};

STEP_VIEWS.review = {
  async render() {
    const s = await api('GET', '/api/profile/summary');
    const tables = s.locations.reduce((a, l) => a + l.tables, 0);
    const items = [
      [1, 'Restaurant & manager', s.profile.restaurantName && s.profile.managerName, `${esc(s.profile.restaurantName || '—')} · ${esc(s.profile.managerName || t('no manager yet'))}`],
      [2, 'Locations & tables', s.locations.length && tables, t('{n} locations, {t} tables', { n: s.locations.length, t: tables })],
      [3, 'Ingredients & stock', s.stock.ingredients, t('{n} ingredients', { n: s.stock.ingredients })],
      [4, 'Menu & favourites', s.menu.dishes, t('{n} dishes, {p} favourites', { n: s.menu.dishes, p: s.menu.picks.length })],
      [5, 'Kitchenware & utilities', s.kitchenware.items, t('{n} types of item', { n: s.kitchenware.items })],
      [6, 'Ordering channels', s.channels.some((c) => c.enabled), s.channels.filter((c) => c.enabled).map((c) => channelName(c.id)).join(', ') || '—'],
    ];
    return `<div class="list card">${items.map(([step, title, ok, detail]) => `<div class="list-item">
      <div class="dish-line"><span class="tick ${ok ? 'ok' : ''}" aria-hidden="true">${ok ? '✓' : '!'}</span><div><strong>${t(title)}</strong><span class="sub muted">${detail}</span></div></div>
      <button type="button" class="btn sm" data-goto-step="${step}">${t('Edit')}</button></div>`).join('')}</div>
      <p class="muted">${t('You can change any of this later from the home screen.')}</p>`;
  },
  bind(root) {
    root.querySelectorAll('[data-goto-step]').forEach((b) => b.addEventListener('click', () => { state.wizard.step = Number(b.dataset.gotoStep); render(); }));
  },
  async save() {
    if (setupMode()) {
      await api('PATCH', '/api/profile', { setupComplete: true });
    }
  },
};

// ---------- wizard shell ----------
views.wizard = async () => {
  state.profile = await api('GET', '/api/profile');
  state.wizard ||= { step: state.profile.setupComplete ? 1 : state.profile.setupStep || 0, drafts: {} };
  const w = state.wizard;
  const step = WIZARD_STEPS[w.step];
  const first = setupMode();
  const body = await STEP_VIEWS[step.id].render();
  const isLast = w.step === WIZARD_STEPS.length - 1;
  return `<div class="wizard">
    <nav class="steps" aria-label="${t('Setup steps')}"><ol>${WIZARD_STEPS.map((s, i) => `<li>
      <button type="button" data-step="${i}" class="${i === w.step ? 'on' : ''} ${i < (state.profile.setupStep || 0) || !first ? 'done' : ''}" ${first && i > (state.profile.setupStep || 0) ? 'disabled' : ''} ${i === w.step ? 'aria-current="step"' : ''}>
        <span class="n">${i + 1}</span>${t(s.title)}</button></li>`).join('')}</ol></nav>
    <form class="card wizard-panel" id="wizardForm" novalidate>
      <div class="card-head"><div><span class="eyebrow">${t('Step {n} of {total}', { n: w.step + 1, total: WIZARD_STEPS.length })}</span><h1>${t(step.title)}</h1></div>
        ${first ? '' : `<button type="button" class="btn" id="wizHome">${t('Back to home')}</button>`}</div>
      <div class="card-body edit-rows">${body}</div>
      <div class="wizard-foot">
        ${w.step > 0 ? `<button type="button" class="btn" id="wizBack">${t('Back')}</button>` : '<span></span>'}
        <button type="submit" class="btn primary" id="wizNext">${t(isLast ? (first ? 'Finish setup' : 'Done') : first ? 'Save & continue' : 'Save')}</button>
      </div>
    </form></div>`;
};

views.wizard.bind = (root) => {
  const w = state.wizard;
  const step = WIZARD_STEPS[w.step];
  const form = $('#wizardForm', root);
  STEP_VIEWS[step.id].bind?.(form);
  const go = (i) => { w.step = i; window.scrollTo(0, 0); render(); };
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step))));
  $('#wizBack', root)?.addEventListener('click', () => go(w.step - 1));
  $('#wizHome', root)?.addEventListener('click', () => { state.view = 'home'; render(); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#wizNext');
    btn.disabled = true;
    try {
      await STEP_VIEWS[step.id].save(form);
      const first = setupMode();
      const isLast = w.step === WIZARD_STEPS.length - 1;
      if (first && !isLast) await api('PATCH', '/api/profile', { setupStep: Math.max(state.profile.setupStep || 0, w.step + 1) });
      if (isLast) {
        state.wizard = null;
        state.view = 'home';
        toast(first ? t('All set – welcome to Muratab') : t('Saved'));
        render();
      } else if (first) {
        go(w.step + 1);
      } else {
        toast(t('Saved'));
        render();
      }
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  });
};
