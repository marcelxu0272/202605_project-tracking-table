'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sw = require('./sector-workflow');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ptrack.sqlite');

function openDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_no TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      version TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timesheet_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_no TEXT NOT NULL,
      work_date TEXT NOT NULL,
      profession TEXT,
      engineer_sector TEXT,
      engineer TEXT,
      unit_no TEXT,
      unit_name TEXT,
      approved_hours REAL DEFAULT 0,
      approved_cost REAL DEFAULT 0,
      rate REAL,
      remark TEXT,
      raw_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ts_project_date ON timesheet_entries(project_no, work_date);
    CREATE TABLE IF NOT EXISTS cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_no TEXT NOT NULL,
      cost_month TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cost_project_month ON cost_entries(project_no, cost_month);
  `);

  return db;
}

const DEFAULT_PERIOD_CONFIG = {
  reminderDay: 19,
  lockDay: 25,
  unlockDay: 9,
  autoUnlockEnabled: false,
  reportingMonth: '2026-05',
  systemYear: 2026,
  platformSyncHour: 2
};

const DEFAULT_GROUP_REGISTRY = {
  GRP_JS: {
    name: '金山项目群',
    sectors: ['SAS520', 'SAS560', 'SAS550', 'SAS530']
  }
};

const DEFAULT_SECTOR_ADMINS = {};

const DEFAULT_USERS = [
  { id: 'u_admin', name: '管理员 Admin', role: 'system_admin', status: 'active' },
  { id: 'u_ev_company', name: '财务总监 张颖', role: 'executive_viewer', dataScope: 'company', status: 'active' },
  { id: 'u_ev_sector', name: '板块领导 李强', role: 'executive_viewer', dataScope: 'sector', sectorCode: 'SAS520', status: 'active' },
  { id: 'u_ev_group', name: '群领导 孙总', role: 'executive_viewer', dataScope: 'group', groupCode: 'GRP_JS', status: 'active' },
  { id: 'u_sa', name: '运营总监 周明', role: 'sector_admin', sector: 'S520', status: 'active' },
  { id: 'u_pm1', name: '何孝刚', role: 'pm', sector: 'S520', status: 'active' },
  { id: 'u_pm2', name: '宋建生', role: 'pm', sector: 'S520', status: 'active' },
  { id: 'u_sd', name: '板块总监 陈磊', role: 'sector_director', sector: 'S520', status: 'active' },
  { id: 'u_gl', name: '项目群主 王总', role: 'group_leader', status: 'active' }
];

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setMeta(db, key, val) {
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, s);
}

function _isFinanceReviewReminder(periodConfig) {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [ry, rm] = (periodConfig.reportingMonth || '2026-05').split('-').map(Number);
  return (
    (month === 1 ? year - 1 : year) === ry &&
    (month === 1 ? 12 : month - 1) === rm &&
    day <= 3
  );
}

function _calcLockStatus(periodConfig) {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [ry, rm] = (periodConfig.reportingMonth || '2026-05').split('-').map(Number);
  const nowMonthIndex = year * 12 + month;
  const reportingMonthIndex = ry * 12 + rm;
  if (nowMonthIndex === reportingMonthIndex) {
    return day >= periodConfig.lockDay ? 'locked' : 'open';
  }
  if (nowMonthIndex === reportingMonthIndex + 1) {
    return periodConfig.autoUnlockEnabled === true && day >= periodConfig.unlockDay ? 'open' : 'locked';
  }
  return 'open';
}

function _normalizeLockStatus(status, periodConfig) {
  if (status === 'finance_only') return 'open';
  if (status === 'open' || status === 'locked') return status;
  return _calcLockStatus(periodConfig);
}

function ensureDefaultMeta(db) {
  if (getMeta(db, 'periodConfig', null) === null) {
    setMeta(db, 'periodConfig', DEFAULT_PERIOD_CONFIG);
  }
  if (getMeta(db, 'reportingMonth', null) === null) {
    const pc = getMeta(db, 'periodConfig');
    setMeta(db, 'reportingMonth', pc.reportingMonth || '2026-05');
  }
  if (getMeta(db, 'approvalStatus', null) === null) {
    setMeta(db, 'approvalStatus', 'draft');
  }
  if (getMeta(db, 'users', null) === null) {
    setMeta(db, 'users', DEFAULT_USERS);
  }
  if (getMeta(db, 'groupRegistry', null) === null) {
    setMeta(db, 'groupRegistry', DEFAULT_GROUP_REGISTRY);
  }
  if (getMeta(db, 'sectorAdmins', null) === null) {
    setMeta(db, 'sectorAdmins', DEFAULT_SECTOR_ADMINS);
  }
  if (getMeta(db, 'newExistingClassYear', null) === null) {
    const rm = getMeta(db, 'reportingMonth') || DEFAULT_PERIOD_CONFIG.reportingMonth;
    setMeta(db, 'newExistingClassYear', Number(String(rm).slice(0, 4)) || new Date().getFullYear());
  }
  patchDemoDirectorSector(db);
}

/** 演示账号：板块总监与金山中心板块管理员同属 SAS520 */
function patchDemoDirectorSector(db) {
  const users = getMeta(db, 'users', null);
  if (!Array.isArray(users)) return;
  let changed = false;
  users.forEach(function (u) {
    if (!u || (u.id !== 'u_sd' && u.id !== 'demo_sd')) return;
    if (u.sector === 'S52X' || u.sector === 'SAS52X') {
      u.sector = 'S520';
      changed = true;
    }
  });
  if (changed) setMeta(db, 'users', users);
}

function getPmSubmissions(db) {
  return getMeta(db, 'pmSubmissions', {});
}

function setPmSubmissions(db, data) {
  setMeta(db, 'pmSubmissions', data);
}

function getBootstrapState(db) {
  ensureDefaultMeta(db);
  const periodConfig = Object.assign({}, DEFAULT_PERIOD_CONFIG, getMeta(db, 'periodConfig') || {});
  const reportingMonth = getMeta(db, 'reportingMonth') || periodConfig.reportingMonth;
  const storedLockStatus = getMeta(db, 'lockStatus', null);
  const lockStatus = storedLockStatus != null
    ? _normalizeLockStatus(storedLockStatus, periodConfig)
    : _calcLockStatus(periodConfig);
  if (storedLockStatus === 'finance_only') {
    setMeta(db, 'lockStatus', 'open');
  }
  const financeReviewReminder = _isFinanceReviewReminder(periodConfig);

  const pmSubmissions = getPmSubmissions(db);

  const projectRows = db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all();
  const projects = projectRows.map(r => JSON.parse(r.payload));

  const auditRows = db.prepare(`
    SELECT payload FROM audit_log ORDER BY id DESC LIMIT 500
  `).all();
  const auditLog = auditRows.map(r => JSON.parse(r.payload));

  const snapRows = db.prepare('SELECT version, payload FROM snapshots').all();
  const snapshots = {};
  for (const row of snapRows) {
    snapshots[row.version] = JSON.parse(row.payload);
  }

  const baselineVersion = getMeta(db, 'baselineVersion', null);
  const latestIVersion = getMeta(db, 'latestIVersion', null);
  const latestJVersion = getMeta(db, 'latestJVersion', null);

  const migrated = sw.migrateSectorFlows(db, getMeta, setMeta, projects, snapshots);
  let sectorFlows = migrated.flows;
  const sectorRegistry = migrated.registry;
  Object.keys(migrated.newSnapshots || {}).forEach(ver => {
    if (!snapshots[ver]) snapshots[ver] = migrated.newSnapshots[ver];
    if (!db.prepare('SELECT 1 FROM snapshots WHERE version = ?').get(ver)) {
      putSnapshot(db, ver, snapshots[ver]);
    }
  });

  const companyFlow = sw.getCompanyFlow(getMeta, db);
  sw.syncLegacyMetaFromFlows(db, getMeta, setMeta, sectorFlows, companyFlow, sectorRegistry);
  const approvalStatus = getMeta(db, 'approvalStatus') || 'draft';
  const reportingSubmitted = getMeta(db, 'reportingSubmitted') === true;

  return {
    projects,
    auditLog,
    snapshots,
    periodConfig,
    reportingMonth,
    approvalStatus,
    lockStatus,
    financeReviewReminder,
    reportingSubmitted,
    pmSubmissions,
    baselineVersion,
    latestIVersion,
    latestJVersion,
    sectorFlows,
    sectorRegistry,
    sectorNames: sw.getSectorNames(getMeta, db),
    companyFlow,
    systemDataSyncedAt: getMeta(db, 'systemDataSyncedAt', null),
    systemDataSyncMeta: getMeta(db, 'systemDataSyncMeta', null),
    users: getMeta(db, 'users', DEFAULT_USERS),
    groupRegistry: getMeta(db, 'groupRegistry', DEFAULT_GROUP_REGISTRY),
    sectorAdmins: getMeta(db, 'sectorAdmins', DEFAULT_SECTOR_ADMINS)
  };
}

function replaceAllProjects(db, projects) {
  const del = db.prepare('DELETE FROM projects');
  const ins = db.prepare('INSERT INTO projects (project_no, payload) VALUES (?, ?)');
  const tx = db.transaction((list) => {
    del.run();
    for (const p of list) {
      ins.run(p.project_no, JSON.stringify(p));
    }
  });
  tx(projects);
}

function upsertProject(db, project) {
  db.prepare('INSERT OR REPLACE INTO projects (project_no, payload) VALUES (?, ?)')
    .run(project.project_no, JSON.stringify(project));
}

function pushAudit(db, record) {
  db.prepare('INSERT INTO audit_log (id, payload) VALUES (?, ?)').run(record.id, JSON.stringify(record));
}

function putSnapshot(db, version, snap) {
  db.prepare('INSERT OR REPLACE INTO snapshots (version, payload) VALUES (?, ?)')
    .run(version, JSON.stringify(snap));
}

function clearSnapshots(db) {
  db.prepare('DELETE FROM snapshots').run();
}

function clearAudit(db) {
  db.prepare('DELETE FROM audit_log').run();
}

function resetLockStatus(db) {
  db.prepare('DELETE FROM meta WHERE key = ?').run('lockStatus');
}

/** 开发测试：流程与配置恢复为默认值（不含项目数据，需配合 xlsx 重导） */
function resetDevMeta(db) {
  const pc = Object.assign({}, DEFAULT_PERIOD_CONFIG);
  setMeta(db, 'periodConfig', pc);
  setMeta(db, 'reportingMonth', pc.reportingMonth);
  resetLockStatus(db);
  clearAudit(db);
  clearSnapshots(db);
  ['baselineVersion', 'latestIVersion', 'latestJVersion', 'priorMonthSnapshotVersion', 'sectorLatestDVersion']
    .forEach(function (key) {
      db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    });
  setMeta(db, 'approvalStatus', 'draft');
  setMeta(db, 'reportingSubmitted', false);
  setMeta(db, 'pmSubmissions', {});
  setMeta(db, 'companyFlow', { archiveStatus: 'pending', archivedAt: null });
  const registry = sw.DEFAULT_SECTOR_REGISTRY.slice();
  const flows = {};
  registry.forEach(code => { flows[code] = sw.defaultSectorFlowEntry(); });
  setMeta(db, 'sectorFlows', flows);
  setMeta(db, 'sectorRegistry', registry);
}

function getEffectiveLockStatus(db) {
  ensureDefaultMeta(db);
  const periodConfig = Object.assign({}, DEFAULT_PERIOD_CONFIG, getMeta(db, 'periodConfig') || {});
  const storedLockStatus = getMeta(db, 'lockStatus', null);
  return storedLockStatus != null
    ? _normalizeLockStatus(storedLockStatus, periodConfig)
    : _calcLockStatus(periodConfig);
}

function countTimesheetEntries(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries').get().c;
}

function replaceProjectTimesheet(db, projectNo, rows) {
  const del = db.prepare('DELETE FROM timesheet_entries WHERE project_no = ?');
  const ins = db.prepare(`
    INSERT INTO timesheet_entries (
      project_no, work_date, profession, engineer_sector, engineer,
      unit_no, unit_name, approved_hours, approved_cost, rate, remark, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((no, list) => {
    del.run(no);
    for (const r of list) {
      ins.run(
        no,
        r.work_date,
        r.profession || '',
        r.engineer_sector || '',
        r.engineer || '',
        r.unit_no || '',
        r.unit_name || '',
        r.approved_hours || 0,
        r.approved_cost || 0,
        r.rate != null ? r.rate : null,
        r.remark || '',
        r.raw_payload ? JSON.stringify(r.raw_payload) : null
      );
    }
  });
  tx(projectNo, rows);
}

function getTimesheetEntries(db, projectNo, year) {
  const y = String(year);
  const rows = db.prepare(`
    SELECT project_no, work_date, profession, engineer_sector, engineer,
           unit_no, unit_name, approved_hours, approved_cost, rate, remark
    FROM timesheet_entries
    WHERE project_no = ? AND substr(work_date, 1, 4) = ?
    ORDER BY work_date ASC, id ASC
  `).all(projectNo, y);
  return rows.map(r => ({
    projectNo: r.project_no,
    workDate: r.work_date,
    profession: r.profession || '',
    engineerSector: r.engineer_sector || '',
    engineer: r.engineer || '',
    unitNo: r.unit_no || '',
    unitName: r.unit_name || '',
    approvedHours: r.approved_hours || 0,
    approvedCost: r.approved_cost || 0,
    rate: r.rate,
    remark: r.remark || ''
  }));
}

function clearAllTimesheetEntries(db) {
  db.prepare('DELETE FROM timesheet_entries').run();
}

function countCostEntries(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM cost_entries').get().c;
}

function replaceProjectCostEntries(db, projectNo, rows) {
  const del = db.prepare('DELETE FROM cost_entries WHERE project_no = ?');
  const ins = db.prepare(`
    INSERT INTO cost_entries (project_no, cost_month, category, amount)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction((no, list) => {
    del.run(no);
    for (const r of list) {
      ins.run(no, r.cost_month, r.category, r.amount || 0);
    }
  });
  tx(projectNo, rows);
}

function getCostEntries(db, projectNo, year) {
  const y = String(year);
  const rows = db.prepare(`
    SELECT project_no, cost_month, category, amount
    FROM cost_entries
    WHERE project_no = ? AND substr(cost_month, 1, 4) = ?
    ORDER BY cost_month ASC, category ASC
  `).all(projectNo, y);
  return rows.map(r => ({
    projectNo: r.project_no,
    costMonth: r.cost_month,
    category: r.category || '',
    amount: r.amount || 0
  }));
}

function clearAllCostEntries(db) {
  db.prepare('DELETE FROM cost_entries').run();
}

function resolveSystemYear(db) {
  ensureDefaultMeta(db);
  const periodConfig = Object.assign({}, DEFAULT_PERIOD_CONFIG, getMeta(db, 'periodConfig') || {});
  if (periodConfig.systemYear) return Number(periodConfig.systemYear);
  const reportingMonth = getMeta(db, 'reportingMonth') || periodConfig.reportingMonth || '2026-05';
  return Number(String(reportingMonth).slice(0, 4)) || new Date().getFullYear();
}

module.exports = {
  openDb,
  DB_PATH,
  getMeta,
  setMeta,
  getPmSubmissions,
  setPmSubmissions,
  getBootstrapState,
  getEffectiveLockStatus,
  replaceAllProjects,
  upsertProject,
  pushAudit,
  putSnapshot,
  clearSnapshots,
  clearAudit,
  resetLockStatus,
  resetDevMeta,
  ensureDefaultMeta,
  DEFAULT_PERIOD_CONFIG,
  DEFAULT_USERS,
  DEFAULT_GROUP_REGISTRY,
  DEFAULT_SECTOR_ADMINS,
  _calcLockStatus,
  countTimesheetEntries,
  replaceProjectTimesheet,
  getTimesheetEntries,
  clearAllTimesheetEntries,
  countCostEntries,
  replaceProjectCostEntries,
  getCostEntries,
  clearAllCostEntries,
  resolveSystemYear
};
