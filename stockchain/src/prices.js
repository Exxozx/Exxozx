'use strict';
/**
 * Live price feed for every supplier catalog item.
 *
 * Each tick asks a *source* for fresh quotes and writes them into
 * `supplier.catalog[i].unitPrice`, so everything downstream (best-supplier
 * choice, purchase-order pricing, stock value, menu food cost) uses live prices.
 * `basePrice` is the contracted / list price that the item was set up with.
 *
 * Sources:
 *  - simulatedSource(): mean-reverting random walk per item, volatility by category.
 *  - httpSource(url):   GET url -> [{ supplierId, ingredientId, price }]. Plug a real
 *                       supplier or market API in here (or behind a small proxy).
 */
const { round } = require('./util');

const HISTORY_POINTS = 60;
const VOLATILITY = { Produce: 0.02, Seafood: 0.022, Meat: 0.012, Dairy: 0.008, Bakery: 0.006, 'Dry Goods': 0.005 };

function gaussian(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function simulatedSource({ rand = Math.random } = {}) {
  return {
    mode: 'simulated',
    quotes(entries) { // synchronous on purpose so warm-up can run during startup
      return entries.map(({ supplierId, ingredientId, price, basePrice, category }) => {
        const vol = VOLATILITY[category] ?? 0.01;
        const drift = 0.08 * ((basePrice - price) / basePrice); // pulls back toward list price
        let next = price * (1 + gaussian(rand) * vol + drift);
        next = Math.min(basePrice * 1.6, Math.max(basePrice * 0.6, next));
        return { supplierId, ingredientId, price: round(next, 2) };
      });
    },
  };
}

function httpSource(url) {
  return {
    mode: 'http',
    url,
    async quotes() {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Price feed responded ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Price feed must return an array of { supplierId, ingredientId, price }');
      return data;
    },
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param getDb   () => db (db object is replaced on reset/import, so always read through this)
 * @param source  price source (see above)
 * @param now     clock
 */
function createPriceFeed({ getDb, source = simulatedSource(), now = () => Date.now(), intervalMs = 5000, onTick = () => {} }) {
  const history = new Map(); // `${supplierId}:${ingredientId}` -> [{t, p}]
  const market = new Map(); // ingredientId -> [{t, p}]
  const status = { mode: source.mode, url: source.url, running: false, intervalMs, lastTickAt: null, ticks: 0, error: null };
  let timer = null;
  let ticking = false;

  const key = (s, i) => `${s}:${i}`;
  const push = (map, k, point) => {
    const arr = map.get(k) || [];
    arr.push(point);
    if (arr.length > HISTORY_POINTS) arr.splice(0, arr.length - HISTORY_POINTS);
    map.set(k, arr);
  };

  function entries() {
    const db = getDb();
    const cat = new Map(db.ingredients.map((i) => [i.id, i.category]));
    return db.suppliers.flatMap((s) =>
      s.catalog.map((c) => {
        c.basePrice ??= c.unitPrice;
        return { supplierId: s.id, ingredientId: c.ingredientId, price: c.unitPrice, basePrice: c.basePrice, category: cat.get(c.ingredientId), item: c };
      })
    );
  }

  function record(t) {
    const db = getDb();
    const byIng = new Map();
    for (const s of db.suppliers) {
      for (const c of s.catalog) {
        push(history, key(s.id, c.ingredientId), { t, p: c.unitPrice });
        if (!byIng.has(c.ingredientId)) byIng.set(c.ingredientId, []);
        byIng.get(c.ingredientId).push(c.unitPrice);
      }
    }
    for (const [id, ps] of byIng) push(market, id, { t, p: round(median(ps), 2) });
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const list = entries();
      const quotes = await source.quotes(list.map(({ item, ...e }) => e));
      const idx = new Map(list.map((e) => [key(e.supplierId, e.ingredientId), e.item]));
      for (const q of quotes) {
        const item = idx.get(key(q.supplierId, q.ingredientId));
        const p = Number(q.price);
        if (item && Number.isFinite(p) && p > 0) item.unitPrice = round(p, 2);
      }
      status.error = null;
    } catch (e) {
      status.error = e.message;
    } finally {
      ticking = false;
    }
    status.lastTickAt = new Date(now()).toISOString();
    status.ticks++;
    record(now());
    onTick(snapshot());
  }

  /** Pre-fill history so charts have context immediately (simulated mode only). */
  function warmup(points = 40) {
    if (source.mode !== 'simulated') return record(now());
    const t0 = now() - points * intervalMs;
    for (let i = 0; i < points; i++) {
      const list = entries();
      const quotes = source.quotes(list.map(({ item, ...e }) => e));
      quotes.forEach((q, j) => (list[j].item.unitPrice = q.price));
      record(t0 + i * intervalMs);
    }
  }

  function start() {
    if (timer) return;
    status.running = true;
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    status.running = false;
  }

  function reset() {
    history.clear();
    market.clear();
  }

  /** Everything the UI needs: per-ingredient market price, all quotes, and live menu food cost. */
  function snapshot() {
    const db = getDb();
    const pct = (a, b) => (b ? round(((a - b) / b) * 100, 1) : 0);
    const ingredients = db.ingredients.map((ing) => {
      const quotes = db.suppliers
        .flatMap((s) => {
          const c = s.catalog.find((x) => x.ingredientId === ing.id);
          if (!c) return [];
          const h = history.get(key(s.id, ing.id)) || [];
          const prev = h.length > 1 ? h[h.length - 2].p : c.unitPrice;
          return [{
            supplierId: s.id,
            supplierName: s.name,
            trusted: s.trusted,
            price: c.unitPrice,
            basePrice: c.basePrice ?? c.unitPrice,
            vsListPct: pct(c.unitPrice, c.basePrice ?? c.unitPrice),
            tickPct: pct(c.unitPrice, prev),
            leadTimeDays: c.leadTimeDays,
          }];
        })
        .sort((a, b) => a.price - b.price);
      const trusted = quotes.filter((q) => q.trusted);
      const mh = market.get(ing.id) || [];
      const marketPrice = quotes.length ? round(median(quotes.map((q) => q.price)), 2) : null;
      const first = mh[0]?.p ?? marketPrice;
      const prev = mh.length > 1 ? mh[mh.length - 2].p : marketPrice;
      return {
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        category: ing.category,
        marketPrice,
        changePct: pct(marketPrice, first),
        tickPct: pct(marketPrice, prev),
        bestTrusted: trusted[0] ? { supplierId: trusted[0].supplierId, supplierName: trusted[0].supplierName, price: trusted[0].price } : null,
        history: mh.map((x) => x.p),
        quotes,
      };
    });

    const best = new Map(ingredients.map((i) => [i.ingredientId, i.bestTrusted?.price ?? i.marketPrice ?? 0]));
    const menu = db.menu.map((m) => {
      const foodCost = round(m.recipe.reduce((s, r) => s + r.qty * (best.get(r.ingredientId) || 0), 0), 2);
      return { menuItemId: m.id, name: m.name, price: m.price, foodCost, foodCostPct: m.price ? round((foodCost / m.price) * 100, 1) : null, margin: round(m.price - foodCost, 2) };
    });

    return { status: { ...status }, at: status.lastTickAt, windowMinutes: round((HISTORY_POINTS * intervalMs) / 60000, 1), ingredients, menu };
  }

  return { tick, warmup, start, stop, reset, snapshot, status, setIntervalMs(ms) { status.intervalMs = intervalMs = ms; if (timer) { stop(); start(); } } };
}

module.exports = { createPriceFeed, simulatedSource, httpSource, HISTORY_POINTS };
