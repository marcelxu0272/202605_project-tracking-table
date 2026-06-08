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
    CREATE TABLE IF NOT EXISTS project_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_no TEXT NOT NULL,
      project_name TEXT NOT NULL DEFAULT '',
      sector_code TEXT NOT NULL DEFAULT '',
      sector_name TEXT NOT NULL DEFAULT '',
      alert_type TEXT NOT NULL,
      alert_label TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      year INTEGER NOT NULL,
      month_idx INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      first_detected_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      UNIQUE(project_no, alert_type, year, month_idx)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON project_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_project ON project_alerts(project_no);
    CREATE TABLE IF NOT EXISTS project_alert_dismissals (
      project_no TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      dismissed_at TEXT NOT NULL,
      dismissed_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (project_no, alert_type)
    );
    CREATE TABLE IF NOT EXISTS report_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector_code TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      approval_node TEXT,
      baseline_version TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(sector_code, period)
    );
    CREATE INDEX IF NOT EXISTS idx_rl_sector ON report_lines(sector_code);
    CREATE INDEX IF NOT EXISTS idx_rl_period ON report_lines(period);
    CREATE INDEX IF NOT EXISTS idx_rl_status ON report_lines(status);
    CREATE TABLE IF NOT EXISTS report_line_pm_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      pm_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      submitted_at TEXT,
      FOREIGN KEY (report_line_id) REFERENCES report_lines(id),
      UNIQUE(report_line_id, pm_name)
    );
    CREATE INDEX IF NOT EXISTS idx_rlpm_report_line ON report_line_pm_status(report_line_id);
    CREATE INDEX IF NOT EXISTS idx_rlpm_status ON report_line_pm_status(status);
    CREATE TABLE IF NOT EXISTS report_line_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      comment TEXT,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (report_line_id) REFERENCES report_lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_rla_report_line ON report_line_approvals(report_line_id);
    CREATE INDEX IF NOT EXISTS idx_rla_action ON report_line_approvals(action);
    CREATE TABLE IF NOT EXISTS report_line_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      project_no TEXT NOT NULL,
      field_data TEXT,
      change_diff TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (report_line_id) REFERENCES report_lines(id),
      UNIQUE(report_line_id, project_no)
    );
    CREATE INDEX IF NOT EXISTS idx_rld_report_line ON report_line_data(report_line_id);
    CREATE INDEX IF NOT EXISTS idx_rld_project ON report_line_data(project_no);
  `);

  return db;
}

const DEFAULT_PERIOD_CONFIG = {
  reminderDay: 5,
  lockDay: 25,
  unlockDay: 9,
  autoUnlockEnabled: false,
  reportingMonth: '2026-06',
  systemYear: 2026,
  platformSyncHour: 2
};

const DEFAULT_GROUP_REGISTRY = {
  GRP_JS: {
    name: '金山项目群',
    sectors: ['SAS520', 'SAS560', 'SAS550', 'SAS530']
  },
  GRP_ZB: {
    name: '总部项目群',
    sectors: ['SAS170', 'SAS610', 'SAS680', 'SAS650', 'SAS710', 'SAS690', 'SAS720', 'SAS670']
  }
};

/** 各板块管理员（板块汇总与提交审批） */
const DEFAULT_SECTOR_ADMINS = {
  SAS520: { adminName: '运营总监 周明',     adminUserId: 'u_sa_520' },
  SAS530: { adminName: '银川板块管理员 宁刚', adminUserId: 'u_sa_530' },
  SAS550: { adminName: '惠湛板块管理员 郑涛', adminUserId: 'u_sa_550' },
  SAS560: { adminName: '沈阳板块管理员 杨帆', adminUserId: 'u_sa_560' },
  SAS670: { adminName: '供应链板块管理员 夏磊', adminUserId: 'u_sa_670' },
  SAS170: { adminName: 'PMC板块管理员 吴敏',  adminUserId: 'u_sa_170' },
  SAS610: { adminName: '咨询板块管理员 曹琳',  adminUserId: 'u_sa_610' },
  SAS680: { adminName: '数字技术板块管理员 朱彤', adminUserId: 'u_sa_680' },
  SAS650: { adminName: '新材料板块管理员 梁欢', adminUserId: 'u_sa_650' },
  SAS710: { adminName: '生命科学板块管理员 秦伟', adminUserId: 'u_sa_710' },
  SAS690: { adminName: 'COII板块管理员 贾峰',  adminUserId: 'u_sa_690' },
  SAS720: { adminName: '模块化板块管理员 许涛', adminUserId: 'u_sa_720' }
};

/** 各板块审批负责人（板块总监审批） */
const DEFAULT_SECTOR_REVIEWERS = {
  SAS520: { reviewerName: '板块总监 陈磊',     reviewerUserId: 'u_sd_520' },
  SAS530: { reviewerName: '银川板块总监 马军',  reviewerUserId: 'u_sd_530' },
  SAS550: { reviewerName: '惠湛板块总监 林海',  reviewerUserId: 'u_sd_550' },
  SAS560: { reviewerName: '沈阳板块总监 王刚',  reviewerUserId: 'u_sd_560' },
  SAS670: { reviewerName: '供应链板块总监 方博', reviewerUserId: 'u_sd_670' },
  SAS170: { reviewerName: 'PMC板块总监 钱进',  reviewerUserId: 'u_sd_170' },
  SAS610: { reviewerName: '咨询板块总监 孙洁',  reviewerUserId: 'u_sd_610' },
  SAS680: { reviewerName: '数字技术板块总监 卢峰', reviewerUserId: 'u_sd_680' },
  SAS650: { reviewerName: '新材料板块总监 魏来',  reviewerUserId: 'u_sd_650' },
  SAS710: { reviewerName: '生命科学板块总监 谢云', reviewerUserId: 'u_sd_710' },
  SAS690: { reviewerName: 'COII板块总监 杜超',   reviewerUserId: 'u_sd_690' },
  SAS720: { reviewerName: '模块化板块总监 侯强',  reviewerUserId: 'u_sd_720' }
};

/** 各项目群审批负责人（群主终审） */
const DEFAULT_GROUP_REVIEWERS = {
  GRP_JS: { reviewerName: '项目群主 王总', reviewerUserId: 'u_gl_js' },
  GRP_ZB: { reviewerName: '总部群主 刘总', reviewerUserId: 'u_gl_zb' }
};

const DEFAULT_USERS = [
  { id: 'u_admin',      name: '管理员 Admin',     role: 'system_admin',     status: 'active' },
  { id: 'u_ev_company', name: '财务总监 张颖',     role: 'executive_viewer', dataScope: 'company',            status: 'active' },
  { id: 'u_ev_sector',  name: '板块领导 李强',     role: 'executive_viewer', dataScope: 'sector', sectorCode: 'SAS520', status: 'active' },
  { id: 'u_ev_group',   name: '群领导 孙总',       role: 'executive_viewer', dataScope: 'group',  groupCode: 'GRP_JS',  status: 'active' },
  // 金山中心 SAS520
  { id: 'u_sa_520',  name: '运营总监 周明',     role: 'sector_admin',     sector: 'SAS520', status: 'active' },
  { id: 'u_pm1',     name: '何孝刚',            role: 'pm',               sector: 'SAS520', status: 'active' },
  { id: 'u_pm2',     name: '宋建生',            role: 'pm',               sector: 'SAS520', status: 'active' },
  { id: 'u_sd_520',  name: '板块总监 陈磊',     role: 'sector_director',  sector: 'SAS520', status: 'active' },
  // 银川中心 SAS530
  { id: 'u_sa_530',  name: '银川板块管理员 宁刚', role: 'sector_admin',    sector: 'SAS530', status: 'active' },
  { id: 'u_sd_530',  name: '银川板块总监 马军',  role: 'sector_director',  sector: 'SAS530', status: 'active' },
  // 惠湛中心 SAS550
  { id: 'u_sa_550',  name: '惠湛板块管理员 郑涛', role: 'sector_admin',    sector: 'SAS550', status: 'active' },
  { id: 'u_sd_550',  name: '惠湛板块总监 林海',  role: 'sector_director',  sector: 'SAS550', status: 'active' },
  // 沈阳中心 SAS560
  { id: 'u_sa_560',  name: '沈阳板块管理员 杨帆', role: 'sector_admin',    sector: 'SAS560', status: 'active' },
  { id: 'u_sd_560',  name: '沈阳板块总监 王刚',  role: 'sector_director',  sector: 'SAS560', status: 'active' },
  // 供应链板块 SAS670
  { id: 'u_sa_670',  name: '供应链板块管理员 夏磊', role: 'sector_admin',  sector: 'SAS670', status: 'active' },
  { id: 'u_sd_670',  name: '供应链板块总监 方博', role: 'sector_director',  sector: 'SAS670', status: 'active' },
  // PMC板块 SAS170
  { id: 'u_sa_170',  name: 'PMC板块管理员 吴敏',  role: 'sector_admin',    sector: 'SAS170', status: 'active' },
  { id: 'u_sd_170',  name: 'PMC板块总监 钱进',   role: 'sector_director',  sector: 'SAS170', status: 'active' },
  // 咨询板块 SAS610
  { id: 'u_sa_610',  name: '咨询板块管理员 曹琳', role: 'sector_admin',    sector: 'SAS610', status: 'active' },
  { id: 'u_sd_610',  name: '咨询板块总监 孙洁',  role: 'sector_director',  sector: 'SAS610', status: 'active' },
  // 数字技术板块 SAS680
  { id: 'u_sa_680',  name: '数字技术板块管理员 朱彤', role: 'sector_admin', sector: 'SAS680', status: 'active' },
  { id: 'u_sd_680',  name: '数字技术板块总监 卢峰', role: 'sector_director', sector: 'SAS680', status: 'active' },
  // 新材料板块 SAS650
  { id: 'u_sa_650',  name: '新材料板块管理员 梁欢', role: 'sector_admin',  sector: 'SAS650', status: 'active' },
  { id: 'u_sd_650',  name: '新材料板块总监 魏来', role: 'sector_director',  sector: 'SAS650', status: 'active' },
  // 生命科学板块 SAS710
  { id: 'u_sa_710',  name: '生命科学板块管理员 秦伟', role: 'sector_admin', sector: 'SAS710', status: 'active' },
  { id: 'u_sd_710',  name: '生命科学板块总监 谢云', role: 'sector_director', sector: 'SAS710', status: 'active' },
  // COII板块 SAS690
  { id: 'u_sa_690',  name: 'COII板块管理员 贾峰', role: 'sector_admin',    sector: 'SAS690', status: 'active' },
  { id: 'u_sd_690',  name: 'COII板块总监 杜超',  role: 'sector_director',  sector: 'SAS690', status: 'active' },
  // 模块化板块 SAS720
  { id: 'u_sa_720',  name: '模块化板块管理员 许涛', role: 'sector_admin',  sector: 'SAS720', status: 'active' },
  { id: 'u_sd_720',  name: '模块化板块总监 侯强', role: 'sector_director',  sector: 'SAS720', status: 'active' },
  // 群主
  { id: 'u_gl_js',   name: '项目群主 王总',      role: 'group_leader',     groupCode: 'GRP_JS', status: 'active' },
  { id: 'u_gl_zb',   name: '总部群主 刘总',      role: 'group_leader',     groupCode: 'GRP_ZB', status: 'active' },
  // 兼容旧 ID（供已存在数据引用）
  { id: 'u_sa',  name: '运营总监 周明',  role: 'sector_admin',    sector: 'S520',   status: 'active' },
  { id: 'u_sd',  name: '板块总监 陈磊',  role: 'sector_director', sector: 'S520',   status: 'active' },
  { id: 'u_gl',  name: '项目群主 王总',  role: 'group_leader',                      status: 'active' }
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
  } else {
    const existing = getMeta(db, 'users', []);
    const existingIds = new Set(existing.map(u => u && u.id).filter(Boolean));
    const newUsers = DEFAULT_USERS.filter(u => !existingIds.has(u.id));
    if (newUsers.length > 0) {
      setMeta(db, 'users', existing.concat(newUsers));
    }
  }
  if (getMeta(db, 'groupRegistry', null) === null) {
    setMeta(db, 'groupRegistry', DEFAULT_GROUP_REGISTRY);
  } else {
    const existing = getMeta(db, 'groupRegistry', {});
    const merged = Object.assign({}, DEFAULT_GROUP_REGISTRY, existing);
    setMeta(db, 'groupRegistry', merged);
  }
  if (getMeta(db, 'sectorAdmins', null) === null) {
    setMeta(db, 'sectorAdmins', DEFAULT_SECTOR_ADMINS);
  } else {
    const existing = getMeta(db, 'sectorAdmins', {});
    const merged = Object.assign({}, DEFAULT_SECTOR_ADMINS, existing);
    setMeta(db, 'sectorAdmins', merged);
  }
  if (getMeta(db, 'sectorReviewers', null) === null) {
    setMeta(db, 'sectorReviewers', DEFAULT_SECTOR_REVIEWERS);
  } else {
    const existing = getMeta(db, 'sectorReviewers', {});
    const merged = Object.assign({}, DEFAULT_SECTOR_REVIEWERS, existing);
    setMeta(db, 'sectorReviewers', merged);
  }
  if (getMeta(db, 'groupReviewers', null) === null) {
    setMeta(db, 'groupReviewers', DEFAULT_GROUP_REVIEWERS);
  } else {
    const existing = getMeta(db, 'groupReviewers', {});
    const merged = Object.assign({}, DEFAULT_GROUP_REVIEWERS, existing);
    setMeta(db, 'groupReviewers', merged);
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
    sectorAdmins: getMeta(db, 'sectorAdmins', DEFAULT_SECTOR_ADMINS),
    sectorReviewers: getMeta(db, 'sectorReviewers', DEFAULT_SECTOR_REVIEWERS),
    groupReviewers: getMeta(db, 'groupReviewers', DEFAULT_GROUP_REVIEWERS)
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

function clearProjectChangeTracking(db) {
  const rows = db.prepare('SELECT project_no, payload FROM projects').all();
  const update = db.prepare('UPDATE projects SET payload = ? WHERE project_no = ?');
  const run = db.transaction(function () {
    rows.forEach(function (row) {
      let project;
      try {
        project = JSON.parse(row.payload);
      } catch {
        return;
      }
      delete project._field_change_log;
      project._changed_fields = [];
      project._added_this_month = false;
      project._added_since_baseline = false;
      update.run(JSON.stringify(project), row.project_no);
    });
  });
  run();
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

/** J 版归档成功后：流程态归零进入新一轮（不改 lockStatus，不清快照/项目） */
function resetWorkflowCycleAfterArchive(db) {
  ensureDefaultMeta(db);
  setMeta(db, 'approvalStatus', 'draft');
  setMeta(db, 'reportingSubmitted', false);
  setMeta(db, 'pmSubmissions', {});
  setMeta(db, 'companyFlow', { archiveStatus: 'pending', archivedAt: null });
  setMeta(db, 'sectorLatestDVersion', {});
  db.prepare('DELETE FROM meta WHERE key = ?').run('priorMonthSnapshotVersion');
  const registry = getMeta(db, 'sectorRegistry', null);
  const codes = Array.isArray(registry) && registry.length
    ? registry.slice()
    : sw.DEFAULT_SECTOR_REGISTRY.slice();
  const flows = {};
  codes.forEach(function (code) {
    if (code && !String(code).startsWith('_')) {
      flows[code] = sw.defaultSectorFlowEntry();
    }
  });
  setMeta(db, 'sectorFlows', flows);
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

function getAllTimesheetEntriesForYear(db, year) {
  const y = String(year);
  const rows = db.prepare(`
    SELECT project_no, work_date, profession, engineer_sector, engineer,
           unit_no, unit_name, approved_hours, approved_cost, rate, remark
    FROM timesheet_entries
    WHERE substr(work_date, 1, 4) = ?
    ORDER BY project_no, work_date ASC, id ASC
  `).all(y);
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

function upsertAlert(db, alert) {
  db.prepare(`
    INSERT INTO project_alerts (project_no, project_name, sector_code, sector_name,
      alert_type, alert_label, detail, year, month_idx, status,
      first_detected_at, resolved_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_no, alert_type, year, month_idx) DO UPDATE SET
      project_name = excluded.project_name,
      sector_code = excluded.sector_code,
      sector_name = excluded.sector_name,
      alert_label = excluded.alert_label,
      detail = excluded.detail,
      status = excluded.status,
      first_detected_at = excluded.first_detected_at,
      resolved_at = excluded.resolved_at,
      last_seen_at = excluded.last_seen_at
  `).run(
    alert.projectNo, alert.projectName, alert.sectorCode, alert.sectorName,
    alert.alertType, alert.alertLabel, alert.detail,
    alert.year, alert.monthIdx, alert.status,
    alert.firstDetectedAt, alert.resolvedAt, alert.lastSeenAt
  );
}

function getAlertsByScope(db, year, monthIdx) {
  return db.prepare(`
    SELECT * FROM project_alerts
    WHERE year = ? AND month_idx = ?
    ORDER BY status ASC, first_detected_at DESC
  `).all(year, monthIdx).map(r => ({
    id: r.id,
    projectNo: r.project_no,
    projectName: r.project_name,
    sectorCode: r.sector_code,
    sectorName: r.sector_name,
    alertType: r.alert_type,
    alertLabel: r.alert_label,
    detail: r.detail,
    year: r.year,
    monthIdx: r.month_idx,
    status: r.status,
    firstDetectedAt: r.first_detected_at,
    resolvedAt: r.resolved_at,
    lastSeenAt: r.last_seen_at
  }));
}

function getDismissals(db) {
  return db.prepare('SELECT * FROM project_alert_dismissals').all().map(r => ({
    projectNo: r.project_no,
    alertType: r.alert_type,
    dismissedAt: r.dismissed_at,
    dismissedBy: r.dismissed_by
  }));
}

function dismissAlert(db, projectNo, alertType, dismissedBy) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO project_alert_dismissals (project_no, alert_type, dismissed_at, dismissed_by)
    VALUES (?, ?, ?, ?)
  `).run(projectNo, alertType, now, dismissedBy || '');
  return { projectNo, alertType, dismissedAt: now, dismissedBy: dismissedBy || '' };
}

function getAlertById(db, id) {
  const r = db.prepare('SELECT * FROM project_alerts WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    projectNo: r.project_no,
    projectName: r.project_name,
    sectorCode: r.sector_code,
    sectorName: r.sector_name,
    alertType: r.alert_type,
    alertLabel: r.alert_label,
    detail: r.detail,
    year: r.year,
    monthIdx: r.month_idx,
    status: r.status,
    firstDetectedAt: r.first_detected_at,
    resolvedAt: r.resolved_at,
    lastSeenAt: r.last_seen_at
  };
}

function resolveSystemYear(db) {
  ensureDefaultMeta(db);
  const periodConfig = Object.assign({}, DEFAULT_PERIOD_CONFIG, getMeta(db, 'periodConfig') || {});
  if (periodConfig.systemYear) return Number(periodConfig.systemYear);
  const reportingMonth = getMeta(db, 'reportingMonth') || periodConfig.reportingMonth || '2026-05';
  return Number(String(reportingMonth).slice(0, 4)) || new Date().getFullYear();
}

let _dbInstance = null;

function getDb() {
  if (!_dbInstance) _dbInstance = openDb();
  return _dbInstance;
}

module.exports = {
  openDb,
  getDb,
  DB_PATH,
  getMeta,
  setMeta,
  getPmSubmissions,
  setPmSubmissions,
  getBootstrapState,
  getEffectiveLockStatus,
  replaceAllProjects,
  upsertProject,
  clearProjectChangeTracking,
  pushAudit,
  putSnapshot,
  clearSnapshots,
  clearAudit,
  resetLockStatus,
  resetWorkflowCycleAfterArchive,
  resetDevMeta,
  ensureDefaultMeta,
  DEFAULT_PERIOD_CONFIG,
  DEFAULT_USERS,
  DEFAULT_GROUP_REGISTRY,
  DEFAULT_SECTOR_ADMINS,
  DEFAULT_SECTOR_REVIEWERS,
  DEFAULT_GROUP_REVIEWERS,
  _calcLockStatus,
  countTimesheetEntries,
  replaceProjectTimesheet,
  getTimesheetEntries,
  clearAllTimesheetEntries,
  getAllTimesheetEntriesForYear,
  countCostEntries,
  replaceProjectCostEntries,
  getCostEntries,
  clearAllCostEntries,
  resolveSystemYear,
  upsertAlert,
  getAlertsByScope,
  getDismissals,
  dismissAlert,
  getAlertById
};
