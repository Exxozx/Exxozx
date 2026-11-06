'use strict';
/**
 * Pure inventory calculations: consumption from menu recipes, demand forecasting,
 * stock status (shortage / excess), reorder quantities, supplier selection and
 * cross-branch transfer suggestions.
 */
const { DAY_MS, round } = require('./util');

const USAGE_WINDOW_DAYS = 14;

/** Ingredient quantities consumed by an order of menu items. */
function consumptionFor(menu, items) {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const totals = {};
  for (const { menuItemId, qty } of items) {
    const dish = byId.get(menuItemId);
    if (!dish) throw Object.assign(new Error(`Unknown menu item: ${menuItemId}`), { status: 400 });
    for (const r of dish.recipe) totals[r.ingredientId] = round((totals[r.ingredientId] || 0) + r.qty * qty);
  }
  return totals;
}

/** Average daily usage per ingredient for a branch over the trailing window. */
function dailyUsage(orders, branchId, now) {
  const since = now - USAGE_WINDOW_DAYS * DAY_MS;
  const totals = {};
  let earliest = now;
  for (const o of orders) {
    if (o.branchId !== branchId) continue;
    const t = Date.parse(o.at);
    if (t < since || t > now) continue;
    earliest = Math.min(earliest, t);
    for (const [id, q] of Object.entries(o.consumption)) totals[id] = (totals[id] || 0) + q;
  }
  const days = Math.max(1, Math.min(USAGE_WINDOW_DAYS, (now - earliest) / DAY_MS));
  const usage = {};
  for (const [id, q] of Object.entries(totals)) usage[id] = q / days;
  return usage;
}

/** Score trusted suppliers for an ingredient: cheapest price adjusted for reliability. */
function rankSuppliers(suppliers, ingredientId) {
  return suppliers
    .filter((s) => s.trusted)
    .flatMap((s) => {
      const item = s.catalog.find((c) => c.ingredientId === ingredientId);
      return item ? [{ supplier: s, item, score: item.unitPrice / (s.onTimeRate || 0.5) }] : [];
    })
    .sort((a, b) => a.score - b.score);
}

function bestSupplier(suppliers, ingredientId) {
  return rankSuppliers(suppliers, ingredientId)[0] || null;
}

/** Day-based thresholds, before multiplying by usage. */
function thresholdDays({ leadTimeDays, shelfLifeDays, settings }) {
  const targetDays = Math.min(leadTimeDays + settings.targetDays, shelfLifeDays);
  const reorderDays = Math.min(leadTimeDays + settings.safetyDays, targetDays);
  const maxDays = Math.max(targetDays * 1.2, Math.min(settings.maxDays, shelfLifeDays));
  return { targetDays, reorderDays, maxDays };
}

function roundQty(qty, unit, minOrderQty = 0) {
  let q = Math.max(qty, minOrderQty);
  q = unit === 'pcs' ? Math.ceil(q) : Math.ceil(q * 10) / 10;
  return round(q, 2);
}

/**
 * Full inventory report for one branch.
 * @param ctx { db, branchId, now, incoming: {ingredientId: qty} }
 */
function branchReport({ db, branchId, now, incoming = {} }) {
  const branch = db.branches.find((b) => b.id === branchId);
  const usage = dailyUsage(db.orders, branchId, now);
  const stock = db.stock[branchId] || {};

  return db.ingredients.map((ing) => {
    const qty = stock[ing.id] || 0;
    const avg = usage[ing.id] || 0;
    const best = bestSupplier(db.suppliers, ing.id);
    const leadTimeDays = best ? best.item.leadTimeDays : 3;
    const d = thresholdDays({ leadTimeDays, shelfLifeDays: ing.shelfLifeDays, settings: branch.settings });
    const reorderPoint = avg * d.reorderDays;
    const targetLevel = avg * d.targetDays;
    const maxLevel = avg * d.maxDays;
    const inbound = incoming[ing.id] || 0;

    let status;
    if (qty <= 0 && avg > 0) status = 'out';
    else if (avg === 0) status = 'idle';
    else if (qty < avg * leadTimeDays) status = 'critical';
    else if (qty < reorderPoint) status = 'low';
    else if (qty > maxLevel) status = 'excess';
    else status = 'ok';

    const short = ['out', 'critical', 'low'].includes(status);
    const gap = targetLevel - qty - inbound;
    const recommendedOrderQty = short && gap > 0 && best ? roundQty(gap, ing.unit, best.item.minOrderQty) : 0;

    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      category: ing.category,
      qty: round(qty, 2),
      avgDailyUsage: round(avg, 3),
      daysOfCover: avg > 0 ? round(qty / avg, 1) : null,
      leadTimeDays,
      reorderPoint: round(reorderPoint, 2),
      targetLevel: round(targetLevel, 2),
      maxLevel: round(maxLevel, 2),
      incoming: round(inbound, 2),
      status,
      shortfall: short ? round(Math.max(0, gap), 2) : 0,
      surplusQty: status === 'excess' ? round(qty - targetLevel, 2) : 0,
      recommendedOrderQty,
      unitCost: best ? best.item.unitPrice : null,
      stockValue: best ? round(qty * best.item.unitPrice, 2) : 0,
      supplier: best ? { id: best.supplier.id, name: best.supplier.name, unitPrice: best.item.unitPrice } : null,
    };
  });
}

/**
 * Match branches with surplus to branches with a shortfall of the same ingredient.
 * Moving surplus internally is cheaper (and reduces waste) versus buying more.
 */
function transferSuggestions(reports) {
  const suggestions = [];
  const ingredientIds = new Set(Object.values(reports).flatMap((rows) => rows.map((r) => r.ingredientId)));
  for (const ingId of ingredientIds) {
    const donors = [];
    const needs = [];
    for (const [branchId, rows] of Object.entries(reports)) {
      const r = rows.find((x) => x.ingredientId === ingId);
      if (r.surplusQty > 0) donors.push({ branchId, avail: r.surplusQty, row: r });
      if (r.shortfall > 0) needs.push({ branchId, need: r.shortfall, row: r });
    }
    needs.sort((a, b) => (a.row.daysOfCover ?? 0) - (b.row.daysOfCover ?? 0));
    donors.sort((a, b) => b.avail - a.avail);
    for (const n of needs) {
      for (const d of donors) {
        if (n.need <= 0) break;
        if (d.avail <= 0) continue;
        let qty = Math.min(n.need, d.avail);
        qty = n.row.unit === 'pcs' ? Math.floor(qty) : Math.floor(qty * 10) / 10;
        if (qty <= 0) continue;
        d.avail -= qty;
        n.need -= qty;
        suggestions.push({
          ingredientId: ingId,
          name: n.row.name,
          unit: n.row.unit,
          fromBranchId: d.branchId,
          toBranchId: n.branchId,
          qty: round(qty, 2),
          receiverStatus: n.row.status,
          estimatedSavings: n.row.unitCost ? round(qty * n.row.unitCost, 2) : 0,
        });
      }
    }
  }
  return suggestions.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

/** How many portions of each dish can be produced from current stock. */
function menuAvailability(menu, stock) {
  return menu.map((dish) => {
    const portions = Math.min(
      ...dish.recipe.map((r) => Math.floor(((stock[r.ingredientId] || 0) + 1e-9) / r.qty))
    );
    const limiting = dish.recipe
      .map((r) => ({ ingredientId: r.ingredientId, portions: Math.floor(((stock[r.ingredientId] || 0) + 1e-9) / r.qty) }))
      .sort((a, b) => a.portions - b.portions)[0];
    return { menuItemId: dish.id, name: dish.name, price: dish.price, portions, limitingIngredient: limiting?.ingredientId };
  });
}

module.exports = {
  USAGE_WINDOW_DAYS,
  consumptionFor,
  dailyUsage,
  rankSuppliers,
  bestSupplier,
  thresholdDays,
  roundQty,
  branchReport,
  transferSuggestions,
  menuAvailability,
};
