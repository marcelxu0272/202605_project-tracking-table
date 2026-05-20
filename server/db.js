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
  `);

  return db;
}

const DEFAULT_PERIOD_CONFIG = {
  reminderDay: 19,
  lockDay: 25,
  unlockDay: 9,
  reportingMonth: '2026-05',
  systemYear: 2026
};

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
  const isCurrentMonth = (year === ry && month === rm);
  if (isCurrentMonth && day >= periodConfig.lockDay) return 'locked';
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
  const lockOverride = getMeta(db, 'lockStatus', null);
  const lockStatus = lockOverride != null
    ? _normalizeLockStatus(lockOverride, periodConfig)
    : _calcLockStatus(periodConfig);
  if (lockOverride === 'finance_only') {
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

  const priorMonthSnapshotVersion = getMeta(db, 'priorMonthSnapshotVersion', null);

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
    priorMonthSnapshotVersion,
    sectorFlows,
    sectorRegistry,
    sectorNames: sw.getSectorNames(getMeta, db),
    companyFlow
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

function clearLockOverride(db) {
  db.prepare('DELETE FROM meta WHERE key = ?').run('lockStatus');
}

/** 开发测试：流程与配置恢复为默认值（不含项目数据，需配合 xlsx 重导） */
function resetDevMeta(db) {
  const pc = Object.assign({}, DEFAULT_PERIOD_CONFIG);
  setMeta(db, 'periodConfig', pc);
  setMeta(db, 'reportingMonth', pc.reportingMonth);
  clearLockOverride(db);
  clearAudit(db);
  clearSnapshots(db);
  db.prepare('DELETE FROM meta WHERE key = ?').run('priorMonthSnapshotVersion');
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

module.exports = {
  openDb,
  DB_PATH,
  getMeta,
  setMeta,
  getPmSubmissions,
  setPmSubmissions,
  getBootstrapState,
  replaceAllProjects,
  upsertProject,
  pushAudit,
  putSnapshot,
  clearSnapshots,
  clearAudit,
  clearLockOverride,
  resetDevMeta,
  ensureDefaultMeta,
  DEFAULT_PERIOD_CONFIG,
  _calcLockStatus
};
