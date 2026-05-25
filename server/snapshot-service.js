'use strict';

const dbm = require('./db');
const sw = require('./sector-workflow');

const STAGE = { IMPORT: 'I', DRAFT: 'D', FINAL: 'J' };

function stripEphemeralMeta(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy._field_change_log;
  copy._changed_fields = [];
  copy._added_this_month = false;
  copy._added_since_baseline = false;
  return copy;
}

function cloneProjectsForSnapshot(projects) {
  return (projects || []).map(stripEphemeralMeta);
}

function formatDateYmd(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return '' + y + m + day;
}

function formatDisplayDate(ymd) {
  if (!ymd || ymd.length !== 8) return ymd || '';
  const y = ymd.slice(0, 4);
  const m = parseInt(ymd.slice(4, 6), 10);
  const d = parseInt(ymd.slice(6, 8), 10);
  return y + '年' + m + '月' + d + '日';
}

function normalizeScope(scope) {
  if (!scope || scope === 'ALL') return 'ALL';
  return sw.normalizeSectorCode(scope);
}

/** @returns {{ version: string, seq: number, dateYmd: string }} */
function buildVersionKey(db, stage, scope, at) {
  const dateYmd = formatDateYmd(at);
  const normScope = normalizeScope(scope);
  const prefix = stage + ':' + dateYmd + ':' + normScope + ':';
  const rows = db.prepare('SELECT version FROM snapshots WHERE version LIKE ?').all(prefix + '%');
  let maxSeq = 0;
  rows.forEach(function (row) {
    const parts = String(row.version).split(':');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  });
  const seq = maxSeq + 1;
  const seqStr = String(seq).padStart(2, '0');
  return { version: prefix + seqStr, seq, dateYmd };
}

function putSnapshotRecord(db, snap) {
  dbm.putSnapshot(db, snap.version, snap);
  return snap;
}

function buildLabel(stage, dateYmd, scope, seq) {
  const dateLabel = formatDisplayDate(dateYmd);
  const seqLabel = '第' + seq + '次';
  if (stage === STAGE.IMPORT) {
    return dateLabel + ' · 导入初始化 · ' + seqLabel;
  }
  if (stage === STAGE.FINAL) {
    return dateLabel + ' · J版 · ' + seqLabel;
  }
  const sectorName = sw.SECTOR_NAMES[scope] || scope;
  return dateLabel + ' · D版 · ' + sectorName + ' · ' + seqLabel;
}

function createImportSnapshot(db, projects, options) {
  options = options || {};
  const at = options.at ? new Date(options.at) : new Date();
  const reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || '2026-05';
  const { version, seq, dateYmd } = buildVersionKey(db, STAGE.IMPORT, 'ALL', at);
  const scope = { kind: 'company', code: 'ALL' };
  const snap = {
    snapshotType: 'import',
    version,
    time: at.toISOString(),
    user: (options.user && options.user.name) || options.userName || '系统',
    role: (options.user && options.user.role) || options.role || 'system_admin',
    reportingMonth,
    scope,
    sourceFile: options.sourceFile || null,
    label: buildLabel(STAGE.IMPORT, dateYmd, 'ALL', seq),
    projects: cloneProjectsForSnapshot(projects)
  };
  putSnapshotRecord(db, snap);
  dbm.setMeta(db, 'latestIVersion', version);
  dbm.setMeta(db, 'baselineVersion', version);
  return { version, snap, projectCount: snap.projects.length };
}

function createDraftSnapshot(db, sectorCode, projects, user) {
  const code = normalizeScope(sectorCode);
  const at = new Date();
  const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
  const { version, seq, dateYmd } = buildVersionKey(db, STAGE.DRAFT, code, at);
  const subset = sw.filterProjectsBySector(projects, code);
  const snap = {
    snapshotType: 'draft',
    version,
    time: at.toISOString(),
    user: (user && user.name) || user || '板块管理员',
    role: (user && user.role) || 'sector_admin',
    reportingMonth,
    sector: code,
    scope: { kind: 'sector', code },
    label: buildLabel(STAGE.DRAFT, dateYmd, code, seq),
    projects: cloneProjectsForSnapshot(subset)
  };
  putSnapshotRecord(db, snap);
  const latestBySector = dbm.getMeta(db, 'sectorLatestDVersion', {}) || {};
  latestBySector[code] = version;
  dbm.setMeta(db, 'sectorLatestDVersion', latestBySector);
  return { version, snap, projectCount: subset.length };
}

function createFinalSnapshot(db, projects, user) {
  const at = new Date();
  const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
  const { version, seq, dateYmd } = buildVersionKey(db, STAGE.FINAL, 'ALL', at);
  const snap = {
    snapshotType: 'final',
    version,
    time: at.toISOString(),
    user: (user && user.name) || user || '系统管理员',
    role: (user && user.role) || 'system_admin',
    reportingMonth,
    scope: { kind: 'company', code: 'ALL' },
    label: buildLabel(STAGE.FINAL, dateYmd, 'ALL', seq),
    projects: cloneProjectsForSnapshot(projects)
  };
  putSnapshotRecord(db, snap);
  dbm.setMeta(db, 'latestJVersion', version);
  dbm.setMeta(db, 'baselineVersion', version);
  return { version, snap, projectCount: snap.projects.length };
}

function resolveBaselineSnapshot(db) {
  const version = dbm.getMeta(db, 'baselineVersion', null);
  if (!version) return null;
  const row = db.prepare('SELECT payload FROM snapshots WHERE version = ?').get(version);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function parseSnapshotKey(version) {
  const m = /^(I|D|J):(\d{8}):([^:]+):(\d+)$/.exec(version || '');
  if (!m) return null;
  return {
    stage: m[1],
    dateYmd: m[2],
    scope: m[3],
    seq: parseInt(m[4], 10)
  };
}

function isLegacySnapshotKey(version) {
  if (!version) return false;
  if (/^(I|D|J):\d{8}:/.test(version)) return false;
  return true;
}

function snapshotRowExists(db, version) {
  return !!(version && db.prepare('SELECT 1 FROM snapshots WHERE version = ?').get(version));
}

/** 清理旧版 Month/PM/全局 Draft 等快照键（I/D/J 体系迁移） */
function purgeLegacySnapshots(db) {
  const legacyPatterns = [
    /^Month:/,
    /^PM:/,
    /^(Draft|Approve1|Approve2)$/,
    /^J版$/
  ];
  let purged = 0;
  db.prepare('SELECT version FROM snapshots').all().forEach(function (row) {
    const v = row.version;
    if (legacyPatterns.some(function (re) { return re.test(v); })) {
      db.prepare('DELETE FROM snapshots WHERE version = ?').run(v);
      purged++;
    }
  });
  return purged;
}

function loadAllProjects(db) {
  return db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all()
    .map(function (r) { return JSON.parse(r.payload); });
}

function projectsForBaselineImport(db, projects) {
  const demoNos = dbm.getMeta(db, 'demoNewProjectNos', null) || [];
  if (!demoNos.length) return projects;
  const demoSet = {};
  demoNos.forEach(function (no) { demoSet[no] = true; });
  const filtered = projects.filter(function (p) { return !demoSet[p.project_no]; });
  return filtered.length ? filtered : projects;
}

/**
 * 启动/bootstrap 时：清 legacy 快照、修复 baseline 与快照行不一致、必要时补写 I 版
 */
function maintainSnapshotStore(db) {
  const purged = purgeLegacySnapshots(db);

  function adoptBaseline(version, action) {
    if (!version) return null;
    dbm.setMeta(db, 'baselineVersion', version);
    return { repaired: true, purged, baselineVersion: version, action: action };
  }

  const baseline = dbm.getMeta(db, 'baselineVersion', null);
  if (snapshotRowExists(db, baseline)) {
    return { repaired: false, purged, baselineVersion: baseline };
  }

  const latestJ = dbm.getMeta(db, 'latestJVersion', null);
  if (snapshotRowExists(db, latestJ)) {
    return adoptBaseline(latestJ, 'baseline->latestJ');
  }

  const latestI = dbm.getMeta(db, 'latestIVersion', null);
  if (snapshotRowExists(db, latestI)) {
    return adoptBaseline(latestI, 'baseline->latestI');
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
  if (count === 0) {
    ['baselineVersion', 'latestIVersion', 'latestJVersion'].forEach(function (key) {
      db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    });
    return { repaired: true, purged, action: 'cleared-stale-meta' };
  }

  const projects = loadAllProjects(db);
  const result = createImportSnapshot(db, projectsForBaselineImport(db, projects), {
    sourceFile: 'baseline-repair',
    userName: '系统',
    role: 'system_admin'
  });
  return {
    repaired: true,
    purged,
    baselineVersion: result.version,
    action: 'recreated-I',
    importSnapshot: result
  };
}

module.exports = {
  STAGE,
  stripEphemeralMeta,
  cloneProjectsForSnapshot,
  buildVersionKey,
  createImportSnapshot,
  createDraftSnapshot,
  createFinalSnapshot,
  resolveBaselineSnapshot,
  parseSnapshotKey,
  isLegacySnapshotKey,
  formatDisplayDate,
  purgeLegacySnapshots,
  maintainSnapshotStore
};
