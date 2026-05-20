'use strict';

/**
 * 基于当前库项目生成「上一报告月」归档快照（项目子集），用于本月「新增项目」高亮对比。
 */
function priorMonthSnapshotVersion(reportingMonth) {
  const parts = String(reportingMonth || '2026-05').split('-').map(Number);
  let y = parts[0];
  let m = parts[1];
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return 'Month:' + y + '-' + String(m).padStart(2, '0');
}

function priorReportingMonth(reportingMonth) {
  const v = priorMonthSnapshotVersion(reportingMonth);
  return v.slice('Month:'.length);
}

function stripEphemeralMeta(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy._field_change_log;
  copy._changed_fields = [];
  copy._added_this_month = false;
  return copy;
}

function zeroMonthsAfterIdx(p, monthIdx) {
  const mc = (p.monthly_completion || []).slice();
  const mi = (p.monthly_invoice || []).slice();
  const mp = (p.monthly_payment || []).slice();
  while (mc.length < 12) mc.push(0);
  while (mi.length < 12) mi.push(0);
  while (mp.length < 12) mp.push(0);
  for (let i = monthIdx + 1; i < 12; i++) {
    mc[i] = 0;
    mi[i] = 0;
    mp[i] = 0;
  }
  p.monthly_completion = mc;
  p.monthly_invoice = mi;
  p.monthly_payment = mp;
  return p;
}

/**
 * @param {object[]} projects 当前库项目（报告月为 reportingMonth）
 * @param {{ FormulaEngine: object }} modules
 * @param {string} reportingMonth 如 2026-05
 * @param {number} removeCount 从当前集中剔除的项目数（不出现在上月快照中 → 本月视为新增）
 * @param {string[]} [removeProjectNos] 指定剔除的项目号（优先于 removeCount 自动抽样）
 */
function buildPriorMonthSnapshotProjects(projects, modules, reportingMonth, removeCount, removeProjectNos) {
  const { FormulaEngine } = modules;
  const priorMonth = priorReportingMonth(reportingMonth);
  const priorMonthIdx = FormulaEngine.getMonthIdx(priorMonth);

  const sorted = projects.slice().sort(function (a, b) {
    return String(a.project_no).localeCompare(String(b.project_no), 'zh-CN');
  });

  const removed = new Set();
  if (Array.isArray(removeProjectNos) && removeProjectNos.length) {
    removeProjectNos.forEach(function (no) {
      if (no) removed.add(String(no).trim());
    });
  }

  const removeN = Math.max(0, Math.min(removeCount || 0, sorted.length - 1));
  const step = removeN > 0 ? Math.max(1, Math.floor(sorted.length / removeN)) : sorted.length + 1;
  if (removed.size === 0 && removeN > 0) {
    let picked = 0;
    for (let i = 0; i < sorted.length && picked < removeN; i += step) {
      removed.add(sorted[i].project_no);
      picked++;
    }
    for (let i = 0; i < sorted.length && picked < removeN; i++) {
      if (!removed.has(sorted[i].project_no)) {
        removed.add(sorted[i].project_no);
        picked++;
      }
    }
  }

  const kept = sorted.filter(function (p) {
    return !removed.has(p.project_no);
  });

  const snapshotProjects = kept.map(function (p) {
    let copy = stripEphemeralMeta(p);
    copy = zeroMonthsAfterIdx(copy, priorMonthIdx);
    return FormulaEngine.compute(copy, priorMonthIdx);
  });

  return {
    version: priorMonthSnapshotVersion(reportingMonth),
    priorMonth,
    priorMonthIdx,
    removedProjectNos: Array.from(removed),
    snapshotProjects
  };
}

function seedPriorMonthSnapshot(db, modules, options) {
  const dbm = require('./db');
  dbm.ensureDefaultMeta(db);
  const reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || '2026-05';
  const removeCount = options.removeCount != null ? options.removeCount : 5;
  const removeProjectNos = options.removeProjectNos || null;

  const rows = db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all();
  const projects = rows.map(function (r) { return JSON.parse(r.payload); });
  if (projects.length === 0) {
    throw new Error('项目库为空，请先导入初始 Excel');
  }

  const built = buildPriorMonthSnapshotProjects(
    projects, modules, reportingMonth, removeCount, removeProjectNos
  );

  const snap = {
    version: built.version,
    time: options.time || new Date('2026-04-28T18:00:00.000Z').toISOString(),
    user: options.user || '系统',
    role: options.role || 'system_admin',
    reportingMonth: built.priorMonth,
    label: built.priorMonth.replace('-', '年') + '月归档',
    projects: built.snapshotProjects
  };

  dbm.putSnapshot(db, built.version, snap);
  dbm.setMeta(db, 'priorMonthSnapshotVersion', built.version);

  return {
    version: built.version,
    priorMonth: built.priorMonth,
    projectCount: built.snapshotProjects.length,
    removedCount: built.removedProjectNos.length,
    removedSample: built.removedProjectNos.slice(0, 8),
    currentCount: projects.length
  };
}

module.exports = {
  priorMonthSnapshotVersion,
  priorReportingMonth,
  stripEphemeralMeta,
  buildPriorMonthSnapshotProjects,
  seedPriorMonthSnapshot
};
