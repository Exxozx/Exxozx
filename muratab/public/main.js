'use strict';
/* Start-up: load the restaurant, apply its look and language, and open the setup wizard on the first visit. */

async function init() {
  state.prefs = applyCachedPrefs();
  const [branches, ingredients, menu, ov, profile] = await Promise.all([
    api('GET', '/api/branches'), api('GET', '/api/ingredients'), api('GET', '/api/menu'), api('GET', '/api/overview'), api('GET', '/api/profile'),
  ]);
  Object.assign(state, { branches, ingredients, menu, meta: ov.meta, profile });
  state.prefs = applyPrefs(profile.preferences);
  $('#chainName').textContent = ov.meta.chainName || t('Inventory & supply network');

  let saved = null;
  try { saved = localStorage.getItem('muratab.branch'); } catch {}
  state.branchId = branches.some((b) => b.id === saved) ? saved : branches[0].id;
  const sel = $('#branchSelect');
  sel.innerHTML = branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  sel.value = state.branchId;
  sel.addEventListener('change', () => setBranch(sel.value));

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  $('#livePill').addEventListener('click', () => { state.view = 'prices'; render(); });
  $('#langToggle').addEventListener('click', () => setPref('language', state.prefs.language === 'ar' ? 'en' : 'ar'));

  if (profile.setupComplete) {
    state.view = 'home';
  } else {
    state.view = 'wizard';
    state.wizard = { step: profile.setupStep || 0, drafts: {} };
  }
  connectPrices();
  render();
}

init().catch((e) => {
  $('#view').innerHTML = `<div class="card empty">${t('Could not load')}: ${esc(e.message)}</div>`;
});
