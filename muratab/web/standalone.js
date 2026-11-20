// Entry point for the standalone build: runs the whole Muratab back end inside the
// page and exposes it to the UI as window.MuratabLocal (same routes as the server).
import { createApp } from '../src/app.js';
import { createRouter } from '../src/routes.js';
import { browserStorage } from './storage-browser.js';

const listeners = new Set();
let app;
try {
  app = createApp({ livePrices: true, priceIntervalMs: 4000, onPriceTick: (snap) => listeners.forEach((fn) => fn(snap)) });
} catch (e) {
  // Saved data from an older version could not be loaded: start fresh.
  console.error(e);
  try { localStorage.removeItem('muratab.v1.db'); localStorage.removeItem('muratab.v1.keys'); } catch {}
  app = createApp({ livePrices: true, priceIntervalMs: 4000, onPriceTick: (snap) => listeners.forEach((fn) => fn(snap)) });
}
const route = createRouter(app);
const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

window.MuratabLocal = {
  mode: 'standalone',
  get persistent() { return browserStorage.persistent; },
  async request(method, url, body) {
    const { status, data } = await route(method, url, copy(body));
    return { status, data: copy(data) }; // behave like a network call: no shared objects
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(copy(app.prices.snapshot()));
    return () => listeners.delete(fn);
  },
};
