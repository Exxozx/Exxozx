'use strict';
/*
 * Languages, theme and accent colour.
 * t('English text', { var }) returns the text in the current language, falling back to
 * English, so a missing translation never breaks the screen. To add a language, add a
 * dictionary to I18N and its name to LANGUAGE_NAMES.
 */
const LANGUAGE_NAMES = { en: 'English', ar: 'العربية' };
const I18N = { en: {}, ar: {} }; // the Arabic dictionary is filled in by i18n-ar.js
let currentLang = 'en';

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key]) || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

const ACCENT_SWATCHES = {
  teal: { name: 'Teal', color: '#0f766e' },
  saffron: { name: 'Saffron', color: '#b45309' },
  indigo: { name: 'Indigo', color: '#4338ca' },
  rose: { name: 'Rose', color: '#be123c' },
  olive: { name: 'Olive', color: '#4d7c0f' },
};

// The page host may already set a theme on <html>; "System" hands control back to it.
const HOST_THEME = document.documentElement.getAttribute('data-theme');
const PREFS_CACHE = 'muratab.prefs';

function applyPrefs(prefs = {}) {
  const root = document.documentElement;
  const p = { theme: 'system', accent: 'teal', language: 'en', ...prefs };
  if (p.theme === 'system') {
    if (HOST_THEME) root.setAttribute('data-theme', HOST_THEME);
    else root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', p.theme);
  }
  root.setAttribute('data-accent', p.accent);
  currentLang = I18N[p.language] ? p.language : 'en';
  root.lang = currentLang;
  root.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  try { localStorage.setItem(PREFS_CACHE, JSON.stringify(p)); } catch {}
  return p;
}

/** Apply the last-used look straight away so the page doesn't flash before data loads. */
function applyCachedPrefs() {
  try { return applyPrefs(JSON.parse(localStorage.getItem(PREFS_CACHE) || '{}')); } catch { return applyPrefs({}); }
}
