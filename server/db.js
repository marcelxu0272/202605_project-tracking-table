'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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

function _calcLockStatus(periodConfig) {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [ry, rm] = (periodConfig.reportingMonth || '2026-05').split('-').map(Number);
  const isCurrentMonth = (year === ry && month === rm);
  const isPrevMonthFirst3 = (
    (month === 1 ? year - 1 : year) === ry &&
    (month === 1 ? 12 : month - 1) === rm &&
    day <= 3
  );
  if (isPrevMonthFirst3) return 'finance_only';
  if (isCurrentMonth && day >= periodConfig.lockDay) return 'locked';
  return 'open';
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

function getBootstrapState(db) {
  ensureDefaultMeta(db);
  const periodConfig = Object.assign({}, DEFAULT_PERIOD_CONFIG, getMeta(db, 'periodConfig') || {});
  const reportingMonth = getMeta(db, 'reportingMonth') || periodConfig.reportingMonth;
  const approvalStatus = getMeta(db, 'approvalStatus') || 'draft';
  const lockOverride = getMeta(db, 'lockStatus', null);
  const lockStatus = lockOverride != null ? lockOverride : _calcLockStatus(periodConfig);

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

  return {
    projects,
    auditLog,
    snapshots,
    periodConfig,
    reportingMonth,
    approvalStatus,
    lockStatus
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

module.exports = {
  openDb,
  DB_PATH,
  getMeta,
  setMeta,
  getBootstrapState,
  replaceAllProjects,
  upsertProject,
  pushAudit,
  putSnapshot,
  clearSnapshots,
  clearAudit,
  clearLockOverride,
  ensureDefaultMeta,
  DEFAULT_PERIOD_CONFIG,
  _calcLockStatus
};
