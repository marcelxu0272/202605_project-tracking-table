'use strict';

const { COST_CATEGORIES } = require('./cost-categories');

function emptyMonths() {
  return Array.from({ length: 12 }, () => ({ amount: 0 }));
}

function monthIndexFromCostMonth(costMonth) {
  if (!costMonth || costMonth.length < 7) return -1;
  const m = parseInt(costMonth.slice(5, 7), 10);
  if (isNaN(m) || m < 1 || m > 12) return -1;
  return m - 1;
}

/**
 * @param {Array<{ costMonth: string, category: string, amount: number }>} entries
 * @param {number} year
 */
function buildCostCenterStats(entries, year) {
  const y = String(year);
  const yearEntries = entries.filter(e => e.costMonth && e.costMonth.slice(0, 4) === y);

  const map = new Map();
  COST_CATEGORIES.forEach(cat => {
    map.set(cat, { key: cat, months: emptyMonths(), totalAmount: 0, isTotal: false });
  });

  for (const e of yearEntries) {
    const row = map.get(e.category);
    if (!row) continue;
    const mi = monthIndexFromCostMonth(e.costMonth);
    if (mi < 0) continue;
    const amt = Number(e.amount) || 0;
    row.months[mi].amount += amt;
    row.totalAmount += amt;
  }

  const categoryRows = COST_CATEGORIES.map(cat => map.get(cat));
  const totalRow = {
    key: '总计',
    isTotal: true,
    months: emptyMonths(),
    totalAmount: 0
  };
  categoryRows.forEach(row => {
    row.months.forEach((cell, mi) => {
      totalRow.months[mi].amount += cell.amount;
    });
    totalRow.totalAmount += row.totalAmount;
  });

  const hasData = yearEntries.some(e => Math.abs(Number(e.amount) || 0) >= 1e-9);

  const details = yearEntries
    .filter(e => Math.abs(Number(e.amount) || 0) >= 1e-9)
    .map(e => ({
      costMonth: e.costMonth,
      category: e.category,
      amount: Number(e.amount) || 0
    }))
    .sort((a, b) => {
      const cm = b.costMonth.localeCompare(a.costMonth);
      if (cm !== 0) return cm;
      return a.category.localeCompare(b.category, 'zh-CN');
    });

  return {
    year,
    empty: !hasData,
    detailCount: details.length,
    categories: COST_CATEGORIES.slice(),
    rows: [totalRow].concat(categoryRows),
    details
  };
}

module.exports = {
  buildCostCenterStats,
  monthIndexFromCostMonth
};
