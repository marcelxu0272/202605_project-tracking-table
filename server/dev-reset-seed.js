'use strict';

/**
 * 开发/重置后的演示数据：清洗导入元数据 + 预警演示；新增项目高亮由 I 版 baseline 排除演示项目号实现
 */
const dbm = require('./db');
const snapSvc = require('./snapshot-service');
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
  return snapSvc.stripEphemeralMeta(p);
}

function normalizeProjects(projects) {
  return (projects || []).map(stripEphemeralMeta);
}

/** 从大库中均匀抽取 N 个项目号，作为「相对 I 版 baseline 的新增项目」演示 */
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
 * 重置/重导 Excel 后写入演示环境（不含 I 版写入，由调用方在适当时机 createImportSnapshot）
 * @returns {{ demoNewProjectNos, normalizedCount, projectsForBaseline }}
 */
function seedDevEnvironment(db, modules, options) {
  options = options || {};
  const reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || dbm.DEFAULT_PERIOD_CONFIG.reportingMonth;

  const rows = db.prepare('SELECT project_no, payload FROM projects ORDER BY project_no ASC').all();
  if (rows.length === 0) {
    throw new Error('项目库为空，无法生成演示数据');
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
        return patched.some(function (p) { return p.project_no === no; });
      });
    }
  }
  if (!demoNewProjectNos || !demoNewProjectNos.length) {
    demoNewProjectNos = pickDemoNewProjectNos(patched, options.removeCount || DEV_DEMO_NEW_COUNT);
  }
  demoNewProjectNos = demoNewProjectNos.slice(0, DEV_DEMO_NEW_COUNT);
  const demoSet = {};
  demoNewProjectNos.forEach(function (no) { demoSet[no] = true; });

  const projectsForBaseline = patched.filter(function (p) {
    return !demoSet[p.project_no];
  });

  dbm.setMeta(db, 'demoNewProjectNos', demoNewProjectNos);
  dbm.setMeta(db, 'alertDemoProjectNos', alertDemo.ALERT_DEMO_PROJECTS);
  dbm.setMeta(db, 'devSeedVersion', 4);
  dbm.setMeta(db, 'devSeedAppliedAt', new Date().toISOString());

  return {
    demoNewProjectNos,
    alertDemoProjectNos: alertDemo.ALERT_DEMO_PROJECTS,
    alertDemoTimesheets: timesheetDemo,
    normalizedCount: patched.length,
    reportingMonth,
    projectsForBaseline
  };
}

/** 开发重置：写 I 版 baseline（排除演示新增项目号） */
function createDevImportSnapshot(db, devSeedResult, options) {
  options = options || {};
  const projects = (devSeedResult && devSeedResult.projectsForBaseline) || [];
  if (!projects.length) {
    throw new Error('无法生成导入快照：baseline 项目集为空');
  }
  return snapSvc.createImportSnapshot(db, projects, {
    reportingMonth: devSeedResult.reportingMonth,
    sourceFile: options.sourceFile || '初始数据.xlsx',
    userName: options.userName || '系统',
    role: options.role || 'system_admin'
  });
}

module.exports = {
  DEV_DEMO_NEW_COUNT,
  DEMO_NEW_PROJECT_NOS_SMALL,
  stripEphemeralMeta,
  normalizeProjects,
  pickDemoNewProjectNos,
  seedDevEnvironment,
  createDevImportSnapshot
};
