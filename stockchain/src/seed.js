'use strict';
/** Demo data for a fictional three-branch restaurant chain. */
const { DAY_MS, round } = require('./util');
const { consumptionFor, dailyUsage, bestSupplier, thresholdDays } = require('./inventory');

const INGREDIENTS = [
  { id: 'burger-bun', name: 'Burger Bun', unit: 'pcs', category: 'Bakery', shelfLifeDays: 4 },
  { id: 'beef-patty', name: 'Beef Patty', unit: 'pcs', category: 'Meat', shelfLifeDays: 5 },
  { id: 'chicken-breast', name: 'Chicken Breast', unit: 'kg', category: 'Meat', shelfLifeDays: 4 },
  { id: 'salmon', name: 'Salmon Fillet', unit: 'kg', category: 'Seafood', shelfLifeDays: 3 },
  { id: 'cheddar', name: 'Cheddar Cheese', unit: 'kg', category: 'Dairy', shelfLifeDays: 21 },
  { id: 'mozzarella', name: 'Mozzarella', unit: 'kg', category: 'Dairy', shelfLifeDays: 14 },
  { id: 'cream', name: 'Cooking Cream', unit: 'L', category: 'Dairy', shelfLifeDays: 7 },
  { id: 'lettuce', name: 'Lettuce', unit: 'kg', category: 'Produce', shelfLifeDays: 5 },
  { id: 'tomato', name: 'Tomato', unit: 'kg', category: 'Produce', shelfLifeDays: 6 },
  { id: 'onion', name: 'Onion', unit: 'kg', category: 'Produce', shelfLifeDays: 30 },
  { id: 'potato', name: 'Potato', unit: 'kg', category: 'Produce', shelfLifeDays: 30 },
  { id: 'frying-oil', name: 'Frying Oil', unit: 'L', category: 'Dry Goods', shelfLifeDays: 180 },
  { id: 'rice', name: 'Basmati Rice', unit: 'kg', category: 'Dry Goods', shelfLifeDays: 365 },
  { id: 'flour', name: 'Pizza Flour', unit: 'kg', category: 'Dry Goods', shelfLifeDays: 180 },
  { id: 'pasta', name: 'Penne Pasta', unit: 'kg', category: 'Dry Goods', shelfLifeDays: 365 },
  { id: 'tomato-sauce', name: 'Tomato Sauce', unit: 'L', category: 'Dry Goods', shelfLifeDays: 30 },
];

const MENU = [
  { id: 'classic-burger', name: 'Classic Burger', price: 42, recipe: [
    { ingredientId: 'burger-bun', qty: 1 }, { ingredientId: 'beef-patty', qty: 1 }, { ingredientId: 'cheddar', qty: 0.03 },
    { ingredientId: 'lettuce', qty: 0.02 }, { ingredientId: 'tomato', qty: 0.03 }, { ingredientId: 'onion', qty: 0.015 } ] },
  { id: 'chicken-burger', name: 'Crispy Chicken Burger', price: 38, recipe: [
    { ingredientId: 'burger-bun', qty: 1 }, { ingredientId: 'chicken-breast', qty: 0.15 },
    { ingredientId: 'lettuce', qty: 0.02 }, { ingredientId: 'tomato', qty: 0.03 }, { ingredientId: 'frying-oil', qty: 0.01 } ] },
  { id: 'fries', name: 'Fries', price: 15, recipe: [
    { ingredientId: 'potato', qty: 0.25 }, { ingredientId: 'frying-oil', qty: 0.02 } ] },
  { id: 'margherita', name: 'Margherita Pizza', price: 48, recipe: [
    { ingredientId: 'flour', qty: 0.25 }, { ingredientId: 'mozzarella', qty: 0.15 }, { ingredientId: 'tomato-sauce', qty: 0.1 } ] },
  { id: 'penne-alfredo', name: 'Penne Alfredo', price: 52, recipe: [
    { ingredientId: 'pasta', qty: 0.12 }, { ingredientId: 'cream', qty: 0.1 },
    { ingredientId: 'mozzarella', qty: 0.02 }, { ingredientId: 'onion', qty: 0.01 } ] },
  { id: 'chicken-bowl', name: 'Chicken Rice Bowl', price: 45, recipe: [
    { ingredientId: 'rice', qty: 0.15 }, { ingredientId: 'chicken-breast', qty: 0.18 },
    { ingredientId: 'onion', qty: 0.02 }, { ingredientId: 'tomato', qty: 0.04 } ] },
  { id: 'grilled-salmon', name: 'Grilled Salmon', price: 89, recipe: [
    { ingredientId: 'salmon', qty: 0.2 }, { ingredientId: 'rice', qty: 0.12 }, { ingredientId: 'lettuce', qty: 0.03 } ] },
  { id: 'garden-salad', name: 'Garden Salad', price: 32, recipe: [
    { ingredientId: 'lettuce', qty: 0.1 }, { ingredientId: 'tomato', qty: 0.08 }, { ingredientId: 'onion', qty: 0.03 } ] },
];

const cat = (ingredientId, unitPrice, leadTimeDays, minOrderQty = 0) => ({ ingredientId, unitPrice, leadTimeDays, minOrderQty });

const SUPPLIERS = [
  { id: 'gulf-fresh', name: 'Gulf Fresh Produce', trusted: true, rating: 4.8, onTimeRate: 0.97,
    contact: 'orders@gulffresh.example', catalog: [cat('lettuce', 9, 1, 2), cat('tomato', 6, 1, 5), cat('onion', 3.5, 1, 5), cat('potato', 3, 1, 10)] },
  { id: 'prime-meats', name: 'Prime Meats Co.', trusted: true, rating: 4.7, onTimeRate: 0.95,
    contact: 'supply@primemeats.example', catalog: [cat('beef-patty', 5.5, 1, 50), cat('chicken-breast', 24, 1, 5), cat('salmon', 78, 1, 2)] },
  { id: 'ocean-catch', name: 'Ocean Catch Seafood', trusted: true, rating: 4.4, onTimeRate: 0.88,
    contact: 'hello@oceancatch.example', catalog: [cat('salmon', 72, 2, 3)] },
  { id: 'al-noor-dairy', name: 'Al Noor Dairy', trusted: true, rating: 4.6, onTimeRate: 0.93,
    contact: 'trade@alnoordairy.example', catalog: [cat('cheddar', 38, 2, 2), cat('mozzarella', 34, 2, 5), cat('cream', 14, 2, 5)] },
  { id: 'dry-goods', name: 'Emirates Dry Goods Wholesale', trusted: true, rating: 4.5, onTimeRate: 0.9,
    contact: 'b2b@edgw.example', catalog: [cat('rice', 7, 3, 25), cat('flour', 4, 3, 25), cat('pasta', 8, 3, 10),
      cat('frying-oil', 9, 3, 20), cat('tomato-sauce', 11, 3, 10), cat('burger-bun', 1.2, 1, 100)] },
  { id: 'quickcheap', name: 'QuickCheap Traders', trusted: false, rating: 2.9, onTimeRate: 0.68,
    contact: 'sales@quickcheap.example', catalog: [cat('tomato', 4, 1, 5), cat('chicken-breast', 17, 2, 5), cat('beef-patty', 3.9, 2, 50)] },
];

const BRANCHES = [
  { id: 'downtown', name: 'Downtown', location: 'Downtown Dubai', demand: 1.25 },
  { id: 'marina', name: 'Marina', location: 'Dubai Marina', demand: 1.0 },
  { id: 'airport', name: 'Airport T3', location: 'DXB Terminal 3', demand: 0.8 },
];

const BASE_DAILY_DEMAND = {
  'classic-burger': 60, 'chicken-burger': 40, fries: 90, margherita: 35,
  'penne-alfredo': 25, 'chicken-bowl': 30, 'grilled-salmon': 15, 'garden-salad': 20,
};

/** Days of cover to seed, so the demo shows shortages and surpluses. */
const COVER_OVERRIDES = {
  downtown: { 'beef-patty': 0.6, tomato: 0.8, 'chicken-breast': 1.6, salmon: 0.4, mozzarella: 1.5 },
  marina: { potato: 1.2, cream: 0.5, 'chicken-breast': 9, rice: 2.5, tomato: 2.4 },
  airport: { 'beef-patty': 10, tomato: 14, rice: 40, cheddar: 40, lettuce: 1.2 },
};

const SERVICE_SLOTS = [12, 15, 19, 22]; // hours of day the POS batches are recorded

function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeedData(now) {
  const rand = mulberry32(20261106);
  const branches = BRANCHES.map(({ demand, ...b }) => ({
    ...b,
    settings: { safetyDays: 2, targetDays: 5, maxDays: 14 },
  }));

  const orders = [];
  let seq = 1;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  for (let day = 14; day >= 1; day--) {
    for (const b of BRANCHES) {
      for (const hour of SERVICE_SLOTS) {
        const at = startOfToday.getTime() - day * DAY_MS + hour * 3600 * 1000;
        const items = Object.entries(BASE_DAILY_DEMAND)
          .map(([menuItemId, base]) => ({
            menuItemId,
            qty: Math.max(0, Math.round((base * b.demand * (0.75 + rand() * 0.5)) / SERVICE_SLOTS.length)),
          }))
          .filter((i) => i.qty > 0);
        const total = items.reduce((s, i) => s + i.qty * MENU.find((m) => m.id === i.menuItemId).price, 0);
        orders.push({
          id: `ord-${String(seq++).padStart(5, '0')}`,
          branchId: b.id,
          at: new Date(at).toISOString(),
          items,
          total,
          consumption: consumptionFor(MENU, items),
          source: 'pos-history',
        });
      }
    }
  }

  const stock = {};
  for (const b of branches) {
    const usage = dailyUsage(orders, b.id, now);
    stock[b.id] = {};
    for (const ing of INGREDIENTS) {
      const best = bestSupplier(SUPPLIERS, ing.id);
      const d = thresholdDays({ leadTimeDays: best.item.leadTimeDays, shelfLifeDays: ing.shelfLifeDays, settings: b.settings });
      const cover = COVER_OVERRIDES[b.id][ing.id] ?? (d.reorderDays + d.targetDays) / 2 + rand() * 0.8;
      const qty = (usage[ing.id] || 0) * cover;
      stock[b.id][ing.id] = ing.unit === 'pcs' ? Math.round(qty) : round(qty, 1);
    }
  }

  return structuredClone({
    meta: { chainName: 'Saffron & Salt Group', currency: 'AED', seededAt: new Date(now).toISOString() },
    branches,
    ingredients: INGREDIENTS,
    menu: MENU,
    suppliers: SUPPLIERS,
    stock,
    orders,
    adjustments: [],
    purchaseOrders: [],
    chain: [],
  });
}

module.exports = { buildSeedData, INGREDIENTS, MENU, SUPPLIERS, BRANCHES };
