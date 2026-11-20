'use strict';
/* Home: the restaurant's profile at a glance, greeting the manager, with theme/language controls. */

function greeting() {
  const h = new Date().getHours();
  return t(h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
}

/** Theme, colour and language pickers – shared by the home screen and the setup wizard. */
function prefsControls(prefs) {
  const seg = (name, options) => `<div class="seg" role="radiogroup" aria-label="${t(name)}">${options.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${prefs[name] === v}" data-pref="${name}" data-val="${v}" ${name === 'language' ? `lang="${v}"` : ''} class="${prefs[name] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<div class="prefs">
    <div class="pref"><span class="edit-head">${t('Theme')}</span>${seg('theme', [['system', t('System')], ['light', t('Light')], ['dark', t('Dark')]])}</div>
    <div class="pref"><span class="edit-head">${t('Colour')}</span><div class="swatches" role="radiogroup" aria-label="${t('Colour')}">${Object.entries(ACCENT_SWATCHES).map(([k, v]) =>
      `<button type="button" role="radio" aria-checked="${prefs.accent === k}" class="swatch ${prefs.accent === k ? 'on' : ''}" data-pref="accent" data-val="${k}" style="--sw:${v.color}" title="${t(v.name)}"><span class="sr">${t(v.name)}</span></button>`).join('')}</div></div>
    <div class="pref"><span class="edit-head">${t('Language')}</span>${seg('language', Object.entries(LANGUAGE_NAMES))}</div>
  </div>`;
}

function bindPrefs(root) {
  root.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => setPref(b.dataset.pref, b.dataset.val)));
}

async function setPref(key, value) {
  state.prefs = applyPrefs({ ...state.prefs, [key]: value });
  updateLivePill();
  $('#chainName').textContent = state.meta.chainName || t('Inventory & supply network');
  render();
  try {
    await api('PATCH', '/api/profile', { preferences: { [key]: value } });
  } catch (e) {
    toast(e.message, true);
  }
}

const editLink = (step, label = 'Edit') => `<button type="button" class="btn sm" data-edit-step="${step}">${t(label)}</button>`;

views.home = async () => {
  const s = await api('GET', '/api/profile/summary');
  state.profile = s.profile;
  const p = s.profile;
  const today = new Date().toLocaleDateString(state.prefs.language === 'ar' ? 'ar-AE' : undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const maxSold = Math.max(1, ...s.bestSellers.map((b) => b.qty));
  const kwTotal = Object.values(s.kitchenware.byCategory).reduce((a, b) => a + b, 0);

  const locations = s.locations.map((l) => {
    const tot = l.stock.items || 1;
    return `<div class="loc">
      <div class="loc-head"><div><strong>${esc(l.name)}</strong><span class="sub muted">${esc(l.location)}${l.hours ? ` · ${esc(l.hours)}` : ''}</span></div>
        <span class="chip ${l.stock.short ? 's-low' : 's-ok'}">${l.stock.short ? t('{n} to restock', { n: l.stock.short }) : t('Stock healthy')}</span></div>
      <div class="bar" aria-hidden="true"><i style="width:${(l.stock.short / tot) * 100}%;background:var(--amber)"></i><i style="width:${(l.stock.healthy / tot) * 100}%;background:var(--green)"></i><i style="width:${(l.stock.excess / tot) * 100}%;background:var(--blue)"></i></div>
      <div class="stats"><div>${t('Tables')}<b>${l.tables}</b></div><div>${t('Seats')}<b>${l.seats}</b></div><div>${t('In use now')}<b>${l.occupied}/${l.tables}</b></div></div>
    </div>`;
  }).join('');

  return `
  <section class="hero card">
    <div class="hero-main">
      <span class="eyebrow">${esc(today)}</span>
      <h1>${greeting()}${p.managerName ? `${t(',')} ${esc(p.managerName)}` : ''}</h1>
      <p class="hero-sub"><strong>${esc(p.restaurantName)}</strong>${p.cuisine ? ` · ${esc(p.cuisine)}` : ''} · ${t('{n} locations', { n: s.locations.length })}</p>
      <div class="hero-stats">
        <div><b>${s.today.orders}</b><span>${t('orders today')}</span></div>
        <div><b>${money(s.today.revenue)}</b><span>${t('sales today')}</span></div>
        <div><b>${s.today.active}</b><span>${t('in the kitchen')}</span></div>
        <div><b>${s.stock.short}</b><span>${t('items to restock')}</span></div>
      </div>
      <div class="actions">
        <button class="btn primary" data-go="orders" data-sub="new">${t('New order')}</button>
        <button class="btn" data-go="orders" data-sub="kitchen">${t('Kitchen board')}</button>
        <button class="btn" data-go="dashboard">${t('Stock dashboard')}</button>
        <button class="btn" data-edit-step="1">${t('Edit profile')}</button>
      </div>
    </div>
    <div class="hero-side">
      <div class="manager"><span class="avatar" aria-hidden="true">${esc((p.managerName || p.restaurantName || 'M').trim().charAt(0).toUpperCase())}</span>
        <div><strong>${esc(p.managerName || t('Manager'))}</strong><span class="sub muted">${esc(t(p.managerTitle || 'Manager'))}</span>
        ${p.phone || p.email ? `<span class="sub muted mono">${esc([p.phone, p.email].filter(Boolean).join(' · '))}</span>` : ''}</div></div>
      ${prefsControls(state.prefs)}
    </div>
  </section>

  <section class="profile-grid">
    <div class="card span-2"><div class="card-head"><h2>${t('Locations & tables')}</h2>${editLink(2)}</div>
      <div class="card-body locs">${locations}</div></div>

    <div class="card"><div class="card-head"><h2>${t('Most popular')}</h2>${editLink(4)}</div>
      <div class="card-body edit-rows">
        <div class="edit-head">${t("Owner's favourites")}</div>
        <div class="quotes">${s.menu.picks.map((d) => `<span class="quote best">★ ${esc(d.name)}</span>`).join('') || `<span class="muted">${t('Mark favourites in the menu')}</span>`}</div>
        <div class="edit-head">${t('Best sellers · last 14 days')}</div>
        ${s.bestSellers.map((b) => `<div class="rank"><span>${esc(b.name)}</span><span class="meter"><i style="width:${(b.qty / maxSold) * 100}%;background:var(--accent)"></i></span><b class="num">${num(b.qty, 0)}</b></div>`).join('') || `<span class="muted">${t('No orders yet')}</span>`}
      </div></div>

    <div class="card"><div class="card-head"><h2>${t('Menu')}</h2>${editLink(4)}</div>
      <div class="card-body edit-rows">
        <div class="big">${s.menu.dishes} <span>${t('dishes')}</span></div>
        <div class="quotes">${Object.entries(s.menu.categories).map(([c, n]) => `<span class="quote">${esc(c)} · ${n}</span>`).join('')}</div>
        <span class="muted">${t('Average price')} ${money(s.menu.averagePrice)}</span>
      </div></div>

    <div class="card"><div class="card-head"><h2>${t('Stock')}</h2><button type="button" class="btn sm" data-go="inventory">${t('Open')}</button></div>
      <div class="card-body edit-rows">
        <div class="big">${s.stock.ingredients} <span>${t('ingredients tracked')}</span></div>
        <span>${t('Worth {v} across all locations', { v: money(s.stock.value) })}</span>
        <span class="${s.stock.short ? 'up' : 'down'}">${s.stock.short ? t('{n} items need restocking', { n: s.stock.short }) : t('Nothing needs restocking')}</span>
        ${editLink(3, 'Edit stock')}
      </div></div>

    <div class="card"><div class="card-head"><h2>${t('Kitchenware & utilities')}</h2>${editLink(5)}</div>
      <div class="card-body edit-rows">
        <div class="big">${num(kwTotal, 0)} <span>${t('items across {n} types', { n: s.kitchenware.items })}</span></div>
        <div class="quotes">${Object.entries(s.kitchenware.byCategory).map(([c, n]) => `<span class="quote">${esc(t(c))} · ${num(n, 0)}</span>`).join('')}</div>
        ${s.kitchenware.low.length ? `<div class="edit-head up">${t('Below minimum')}</div>${s.kitchenware.low.slice(0, 4).map((l) => `<span class="sub">${esc(l.name)} – ${esc(l.branchName)}: ${l.have}/${l.minimum}</span>`).join('')}` : `<span class="down">${t('Everything at or above minimum')}</span>`}
      </div></div>

    <div class="card"><div class="card-head"><h2>${t('Ordering channels')}</h2>${editLink(6)}</div>
      <div class="list">${s.channels.map((c) => `<div class="list-item"><div><strong>${esc(channelName(c.id))}</strong>
        <span class="sub muted">${c.kind === 'internal' ? t('In the restaurant') : c.enabled ? t('{n} locations linked', { n: c.linkedStores }) : t('Not connected')}</span></div>
        <div class="actions">${c.today ? `<span class="muted">${t('{n} today', { n: c.today })}</span>` : ''}${chip(c.enabled ? 'ok' : 'idle', c.enabled ? 'On' : 'Off')}</div></div>`).join('')}</div></div>
  </section>`;
};

views.home.bind = (root) => {
  bindPrefs(root);
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sub) state.ordersTab = b.dataset.sub;
    state.view = b.dataset.go;
    render();
  }));
  root.querySelectorAll('[data-edit-step]').forEach((b) => b.addEventListener('click', () => openWizard(Number(b.dataset.editStep))));
};
