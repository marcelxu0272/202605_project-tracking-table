'use strict';

/**
 * 开发/重置后的演示数据：清洗导入元数据 + 生成上一报告月归档快照（供「五月新增」高亮）
 */
const dbm = require('./db');
const prior = require('./prior-month-snapshot');
const alertDemo = require('./alert-demo-seed');

const DEV_DEMO_NEW_COUNT = 5;

/** 初始数据.xlsx（约 20 条）时的固定演示新增项目，保证每次重置结果一致 */
const DEMO_NEW_PROJECT_NOS_SMALL = [
  'B24194-0078',
  'B24264-0039',
  'B25001-0044',
  'B25126-0002',
  'B25126-0004'
];

function stripEphemeralMeta(p) {
  return prior.stripEphemeralMeta(p);
}

function normalizeProjects(projects) {
  return (projects || []).map(stripEphemeralMeta);
}

/** 从大库中均匀抽取 N 个项目号，作为「本月新增」演示 */
function pickDemoNewProjectNos(projects, count) {
  const n = count != null ? count : DEV_DEMO_NEW_COUNT;
  const sorted = projects.slice().sort(function (a, b) {
    return String(a.project_no).localeCompare(String(b.project_no), 'zh-CN');
  });
  if (sorted.length <= n) return sorted.map(function (p) { return p.project_no; });

  if (sorted.length <= 30) {
    const fixed = DEMO_NEW_PROJECT_NOS_SMALL.filter(function (no) {
      return sorted.some(function (p) { return p.project_no === no; });
    });
    if (fixed.length >= Math.min(n, DEMO_NEW_PROJECT_NOS_SMALL.length)) {
      return fixed.slice(0, n);
    }
  }

  const picked = [];
  const step = Math.max(1, Math.floor(sorted.length / (n + 2)));
  for (let i = step; i < sorted.length && picked.length < n; i += step) {
    picked.push(sorted[i].project_no);
  }
  for (let i = 0; i < sorted.length && picked.length < n; i++) {
    const no = sorted[i].project_no;
    if (picked.indexOf(no) < 0) picked.push(no);
  }
  return picked.slice(0, n);
}

/**
 * 重置/重导 Excel 后写入演示环境：干净项目 payload + Month:YYYY-MM 上月快照
 * @returns {{ priorSnapshot, demoNewProjectNos, normalizedCount }}
 */
function seedDevEnvironment(db, modules, options) {
  options = options || {};
  const reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || dbm.DEFAULT_PERIOD_CONFIG.reportingMonth;

  const rows = db.prepare('SELECT project_no, payload FROM projects ORDER BY project_no ASC').all();
  if (rows.length === 0) {
    throw new Error('项目库为空，无法生成演示快照');
  }

  const projects = rows.map(function (r) { return JSON.parse(r.payload); });
  const normalized = normalizeProjects(projects);
  const patched = alertDemo.applyAlertDemoPatches(normalized, modules, reportingMonth);
  dbm.replaceAllProjects(db, patched);

  let timesheetDemo = null;
  try {
    timesheetDemo = alertDemo.seedAlertDemoTimesheets(db);
  } catch (e) {
    console.warn('[ptrack] 预警演示工时写入失败:', e.message);
  }

  let demoNewProjectNos = options.removeProjectNos;
  if (!demoNewProjectNos || !demoNewProjectNos.length) {
    const saved = dbm.getMeta(db, 'demoNewProjectNos', null);
    if (saved && saved.length && !options.repickDemoNew) {
      demoNewProjectNos = saved.filter(function (no) {
        return normalized.some(function (p) { return p.project_no === no; });
      });
    }
  }
  if (!demoNewProjectNos || !demoNewProjectNos.length) {
    demoNewProjectNos = pickDemoNewProjectNos(normalized, options.removeCount || DEV_DEMO_NEW_COUNT);
  }
  demoNewProjectNos = demoNewProjectNos.slice(0, DEV_DEMO_NEW_COUNT);

  const priorMonth = prior.priorReportingMonth(reportingMonth);
  const priorResult = prior.seedPriorMonthSnapshot(db, modules, {
    reportingMonth,
    removeCount: 0,
    removeProjectNos: demoNewProjectNos,
    time: options.snapshotTime || (priorMonth + '-28T10:00:00.000Z'),
    user: options.user || '系统',
    role: options.role || 'system_admin'
  });

  dbm.setMeta(db, 'demoNewProjectNos', demoNewProjectNos);
  dbm.setMeta(db, 'alertDemoProjectNos', alertDemo.ALERT_DEMO_PROJECTS);
  dbm.setMeta(db, 'devSeedVersion', 3);
  dbm.setMeta(db, 'devSeedAppliedAt', new Date().toISOString());

  return {
    priorSnapshot: priorResult,
    demoNewProjectNos,
    alertDemoProjectNos: alertDemo.ALERT_DEMO_PROJECTS,
    alertDemoTimesheets: timesheetDemo,
    normalizedCount: patched.length,
    reportingMonth,
    priorMonth
  };
}

module.exports = {
  DEV_DEMO_NEW_COUNT,
  DEMO_NEW_PROJECT_NOS_SMALL,
  stripEphemeralMeta,
  normalizeProjects,
  pickDemoNewProjectNos,
  seedDevEnvironment
};
