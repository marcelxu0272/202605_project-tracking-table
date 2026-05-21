'use strict';

function emptyMonths() {
  return Array.from({ length: 12 }, () => ({ hours: 0, cost: 0 }));
}

function monthIndexFromDate(workDate) {
  if (!workDate || workDate.length < 7) return -1;
  const m = parseInt(workDate.slice(5, 7), 10);
  if (isNaN(m) || m < 1 || m > 12) return -1;
  return m - 1;
}

function aggregateByKey(entries, keyField) {
  const map = new Map();
  for (const e of entries) {
    const key = e[keyField] || '（未分类）';
    if (!map.has(key)) {
      map.set(key, { key, months: emptyMonths(), totalHours: 0, totalCost: 0 });
    }
    const row = map.get(key);
    const mi = monthIndexFromDate(e.workDate);
    if (mi < 0) continue;
    const h = Number(e.approvedHours) || 0;
    const c = Number(e.approvedCost) || 0;
    row.months[mi].hours += h;
    row.months[mi].cost += c;
    row.totalHours += h;
    row.totalCost += c;
  }
  const rows = Array.from(map.values());
  rows.sort((a, b) => b.totalHours - a.totalHours || a.key.localeCompare(b.key, 'zh-CN'));
  return { rows };
}

/**
 * @param {Array<object>} entries - getTimesheetEntries 返回值（已按年过滤）
 * @param {number} year
 */
function buildTimesheetStats(entries, year) {
  const details = entries.map(e => ({
    date: e.workDate,
    engineer: e.engineer,
    engineerSector: e.engineerSector,
    profession: e.profession,
    unitName: e.unitName,
    approvedHours: e.approvedHours,
    approvedCost: e.approvedCost,
    remark: e.remark
  }));

  return {
    year,
    empty: details.length === 0,
    detailCount: details.length,
    byProfession: aggregateByKey(entries, 'profession'),
    bySector: aggregateByKey(entries, 'engineerSector'),
    details
  };
}

module.exports = {
  buildTimesheetStats,
  aggregateByKey,
  monthIndexFromDate
};
