'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { loadBrowserScripts } = require('./load-modules');
const { projectsFromXlsxBuffer } = require('./xlsx-seed');
const { seedPriorMonthSnapshot } = require('./prior-month-snapshot');
const { seedDevEnvironment, normalizeProjects } = require('./dev-reset-seed');
const dbm = require('./db');
const sw = require('./sector-workflow');
const platformSync = require('./platform-sync');
const timesheetImport = require('./timesheet-import');
const timesheetStats = require('./timesheet-stats');
const costImport = require('./cost-import');
const costStats = require('./cost-stats');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PTRACK_PORT) || 3000;

const modules = loadBrowserScripts();

function resolveInitXlsx() {
  const env = process.env.PTRACK_INIT_XLSX;
  const candidates = [
    env && path.isAbsolute(env) ? env : env && path.join(ROOT, env),
    path.join(ROOT, '初始数据.xlsx'),
    path.join(ROOT, 'S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function seedFromXlsxIfEmpty(db) {
  const n = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
  if (n > 0) return { seeded: false, count: n };

  const xlsxPath = resolveInitXlsx();
  if (!xlsxPath) {
    console.warn('[ptrack] 无项目数据且未找到初始化 xlsx（请放置 初始数据.xlsx 于项目根目录后重启或调用 POST /api/admin/reseed）');
    return { seeded: false, count: 0, missingFile: true };
  }

  dbm.ensureDefaultMeta(db);
  const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
  const buf = fs.readFileSync(xlsxPath);
  const projects = projectsFromXlsxBuffer(buf, modules, reportingMonth);
  if (projects.length === 0) {
    console.warn('[ptrack] 初始化文件未解析出有效项目:', xlsxPath);
    return { seeded: false, count: 0 };
  }
  dbm.replaceAllProjects(db, projects);
  dbm.setMeta(db, 'systemDataSyncedAt', new Date().toISOString());
  dbm.setMeta(db, 'systemDataSyncMeta', { trigger: 'seed', at: new Date().toISOString() });
  let devSeed = null;
  try {
    devSeed = seedDevEnvironment(db, modules, { reportingMonth, repickDemoNew: true });
    console.log('[ptrack] 已生成上月对比快照', devSeed.priorSnapshot.version,
      '| 五月新增演示', devSeed.demoNewProjectNos.join(', '));
  } catch (e) {
    console.warn('[ptrack] 演示快照生成失败:', e.message);
  }
  console.log('[ptrack] 已从', xlsxPath, '初始化', projects.length, '条项目');
  return { seeded: true, count: projects.length, file: xlsxPath, devSeed };
}

const db = dbm.openDb();
dbm.ensureDefaultMeta(db);
seedFromXlsxIfEmpty(db);
timesheetImport.seedTimesheetsIfEmpty(db, dbm);
costImport.seedCostIfEmpty(db, dbm);

const app = express();
app.use(express.json({ limit: '80mb' }));

app.get('/api/bootstrap', (_req, res) => {
  try {
    const state = dbm.getBootstrapState(db);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { projects } = req.body || {};
    if (!Array.isArray(projects)) {
      res.status(400).json({ error: 'projects 必须为数组' });
      return;
    }
    dbm.replaceAllProjects(db, projects);
    res.json({ ok: true, count: projects.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/projects/:projectNo', (req, res) => {
  try {
    const p = req.body;
    if (!p || p.project_no !== req.params.projectNo) {
      res.status(400).json({ error: 'project_no 不匹配' });
      return;
    }
    dbm.upsertProject(db, p);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/projects/:projectNo/timesheet', (req, res) => {
  try {
    const projectNo = req.params.projectNo;
    let year = req.query.year != null ? Number(req.query.year) : dbm.resolveSystemYear(db);
    if (!year || isNaN(year)) year = dbm.resolveSystemYear(db);
    const entries = dbm.getTimesheetEntries(db, projectNo, year);
    const stats = timesheetStats.buildTimesheetStats(entries, year);
    stats.projectNo = projectNo;
    stats.importedAt = dbm.getMeta(db, 'timesheetImportedAt', null);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/projects/:projectNo/cost-center', (req, res) => {
  try {
    const projectNo = req.params.projectNo;
    let year = req.query.year != null ? Number(req.query.year) : dbm.resolveSystemYear(db);
    if (!year || isNaN(year)) year = dbm.resolveSystemYear(db);
    const entries = dbm.getCostEntries(db, projectNo, year);
    const stats = costStats.buildCostCenterStats(entries, year);
    stats.projectNo = projectNo;
    stats.importedAt = dbm.getMeta(db, 'costImportedAt', null);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/audit', (req, res) => {
  try {
    const entry = req.body || {};
    const record = Object.assign({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString()
    }, entry);
    dbm.pushAudit(db, record);
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/snapshots/:version', (req, res) => {
  try {
    const snap = req.body;
    if (!snap) {
      res.status(400).json({ error: '空 body' });
      return;
    }
    dbm.putSnapshot(db, req.params.version, snap);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.patch('/api/meta', (req, res) => {
  try {
    const body = req.body || {};
    if (body.periodConfig != null) dbm.setMeta(db, 'periodConfig', body.periodConfig);
    if (body.reportingMonth != null) dbm.setMeta(db, 'reportingMonth', body.reportingMonth);
    if (body.approvalStatus != null) dbm.setMeta(db, 'approvalStatus', body.approvalStatus);
    if (body.lockStatus !== undefined) dbm.setMeta(db, 'lockStatus', body.lockStatus);
    // reportingSubmitted 只允许 sector_admin / system_admin 通过此接口置 true
    // PM 的提交由专用端点处理
    if (body.reportingSubmitted !== undefined) {
      dbm.setMeta(db, 'reportingSubmitted', !!body.reportingSubmitted);
    }
    res.json(dbm.getBootstrapState(db));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

function getAllProjectsFromDb(database) {
  return database.prepare('SELECT payload FROM projects').all()
    .map(r => JSON.parse(r.payload));
}

function getPmProjectsFromDb(database, pmName) {
  return getAllProjectsFromDb(database).filter(p => p.pm_name === pmName);
}

function writeSectorSnapshot(database, versionKey, sectorCode, projects, user, role) {
  const subset = sw.filterProjectsBySector(projects, sectorCode);
  const snap = {
    version: versionKey,
    time: new Date().toISOString(),
    user: user || '系统',
    role: role || 'system',
    sector: sectorCode,
    projects: subset
  };
  dbm.putSnapshot(database, versionKey, snap);
  return snap;
}

/** 为 PM 创建填报基准快照（本轮编辑开始时的数据）；projectsOverride 由前端在首次打开填报页时传入 */
function createPmBaselineSnapshot(db, pmName, reportingMonth, userName, projectsOverride) {
  const pmProjects = (projectsOverride && projectsOverride.length)
    ? projectsOverride
    : getPmProjectsFromDb(db, pmName);
  const version = 'PM:' + pmName + ':' + reportingMonth + ':baseline:' + Date.now();
  const snap = {
    version,
    time: new Date().toISOString(),
    user: userName || pmName,
    role: 'pm_baseline',
    pmName,
    projects: pmProjects
  };
  dbm.putSnapshot(db, version, snap);
  return { version, snap };
}

// ── PM 提交端点 ──────────────────────────────────────────
app.post('/api/pm-submissions/ensure-baseline', (req, res) => {
  try {
    const { pmName, reportingMonth, userName, projects } = req.body || {};
    if (!pmName || !reportingMonth) {
      res.status(400).json({ error: 'pmName 与 reportingMonth 必填' });
      return;
    }
    const subs = dbm.getPmSubmissions(db);
    const monthSubs = subs[reportingMonth] || {};
    const entry = monthSubs[pmName] || {};
    const state = dbm.getBootstrapState(db);
    if (entry.baselineSnapshotVersion && state.snapshots[entry.baselineSnapshotVersion]) {
      res.json({
        ok: true,
        created: false,
        baselineSnapshotVersion: entry.baselineSnapshotVersion
      });
      return;
    }
    const { version, snap } = createPmBaselineSnapshot(
      db, pmName, reportingMonth, userName, projects
    );
    if (!subs[reportingMonth]) subs[reportingMonth] = {};
    subs[reportingMonth][pmName] = Object.assign({}, entry, { baselineSnapshotVersion: version });
    dbm.setPmSubmissions(db, subs);
    res.json({
      ok: true,
      created: true,
      baselineSnapshotVersion: version,
      snapshot: snap
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/pm-submissions/submit', (req, res) => {
  try {
    const { pmName, reportingMonth, userName, projectNos } = req.body || {};
    if (!pmName || !reportingMonth) {
      res.status(400).json({ error: 'pmName 与 reportingMonth 必填' });
      return;
    }

    const sectorFlows = dbm.getMeta(db, 'sectorFlows', {});
    const pmSector = sw.resolvePmSector(db, pmName, getAllProjectsFromDb);
    const sectorFlow = sw.getSectorFlow(sectorFlows, pmSector);
    if (sectorFlow.reportingSubmitted === true) {
      res.status(409).json({ error: '所属板块已正式提交审批，PM 无法再次提交' });
      return;
    }

    const pmProjects = getPmProjectsFromDb(db, pmName);
    const snapVersion = 'PM:' + pmName + ':' + reportingMonth + ':' + Date.now();

    // 写快照（含该 PM 项目子集）
    const snap = {
      version: snapVersion,
      time: new Date().toISOString(),
      user: userName || pmName,
      role: 'pm',
      pmName,
      projects: pmProjects
    };
    dbm.putSnapshot(db, snapVersion, snap);

    // 更新 pmSubmissions（保留 baselineSnapshotVersion 供 diff）
    const subs = dbm.getPmSubmissions(db);
    if (!subs[reportingMonth]) subs[reportingMonth] = {};
    const prev = subs[reportingMonth][pmName] || {};
    const submissionBaseline = prev.baselineSnapshotVersion || null;
    subs[reportingMonth][pmName] = {
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      snapshotVersion: snapVersion,
      baselineSnapshotVersion: submissionBaseline,
      submissionBaselineSnapshotVersion: submissionBaseline,
      projectNos: pmProjects.map(p => p.project_no),
      projectCount: pmProjects.length
    };
    dbm.setPmSubmissions(db, subs);

    // 审计
    const record = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: '全局',
      fieldName: 'pm_submit',
      fieldCN: 'PM提交',
      oldVal: '',
      newVal: '已提交（' + pmProjects.length + '个项目）',
      userId: 'pm',
      userName: userName || pmName
    };
    dbm.pushAudit(db, record);

    res.json({
      ok: true,
      snapshotVersion: snapVersion,
      baselineSnapshotVersion: subs[reportingMonth][pmName].baselineSnapshotVersion,
      submissionBaselineSnapshotVersion: subs[reportingMonth][pmName].submissionBaselineSnapshotVersion,
      projectCount: pmProjects.length,
      snapshot: snap
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/snapshots/:version', (req, res) => {
  try {
    const version = decodeURIComponent(req.params.version);
    const state = dbm.getBootstrapState(db);
    const snap = state.snapshots[version];
    if (!snap) {
      res.status(404).json({ error: '快照不存在' });
      return;
    }
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/sectors/:code/submit-approval', (req, res) => {
  try {
    const sectorCode = req.params.code;
    const { userName, role } = req.body || {};
    const allProjects = getAllProjectsFromDb(db);
    const sectorFlows = dbm.getMeta(db, 'sectorFlows', {});
    const flow = sw.getSectorFlow(sectorFlows, sectorCode);
    if (flow.reportingSubmitted) {
      res.status(409).json({ error: '该板块已提交审批' });
      return;
    }
    const versionKey = sw.sectorSnapshotKey('Draft', sectorCode);
    const snap = writeSectorSnapshot(
      db, versionKey, sectorCode, allProjects, userName, role || 'sector_admin'
    );
    sw.setSectorFlow(db, dbm.setMeta, dbm.getMeta, sectorCode, {
      approvalStatus: 'draft',
      reportingSubmitted: true
    });
    const registry = sw.getSectorRegistry(db, dbm.getMeta, allProjects);
    const updatedFlows = dbm.getMeta(db, 'sectorFlows', {});
    const companyFlow = sw.getCompanyFlow(dbm.getMeta, db);
    sw.syncLegacyMetaFromFlows(db, dbm.getMeta, dbm.setMeta, updatedFlows, companyFlow, registry);
    dbm.pushAudit(db, {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: sectorCode,
      fieldName: 'sector_submit',
      fieldCN: '板块提交审批',
      oldVal: '',
      newVal: versionKey,
      userId: role || 'sector_admin',
      userName: userName || '板块管理员'
    });
    res.json({ ok: true, version: versionKey, snapshot: snap, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/sectors/:code/advance-approval', (req, res) => {
  try {
    const sectorCode = req.params.code;
    const { userName, role } = req.body || {};
    const sectorFlows = dbm.getMeta(db, 'sectorFlows', {});
    const flow = sw.getSectorFlow(sectorFlows, sectorCode);
    const allProjects = getAllProjectsFromDb(db);
    let nextStatus;
    let snapLabel;
    if (flow.approvalStatus === 'draft' && flow.reportingSubmitted) {
      nextStatus = 'approve1';
      snapLabel = 'Approve1';
    } else if (flow.approvalStatus === 'approve1') {
      nextStatus = 'approve2';
      snapLabel = 'Approve2';
    } else {
      res.status(409).json({ error: '当前板块状态不可推进审批' });
      return;
    }
    const versionKey = sw.sectorSnapshotKey(snapLabel, sectorCode);
    const snap = writeSectorSnapshot(
      db, versionKey, sectorCode, allProjects, userName, role
    );
    sw.setSectorFlow(db, dbm.setMeta, dbm.getMeta, sectorCode, { approvalStatus: nextStatus });
    const updatedFlows = dbm.getMeta(db, 'sectorFlows', {});
    const registry = sw.getSectorRegistry(db, dbm.getMeta, allProjects);
    const companyFlow = sw.getCompanyFlow(dbm.getMeta, db);
    sw.syncLegacyMetaFromFlows(db, dbm.getMeta, dbm.setMeta, updatedFlows, companyFlow, registry);
    dbm.pushAudit(db, {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: sectorCode,
      fieldName: 'approvalStatus',
      fieldCN: '板块审批',
      oldVal: flow.approvalStatus,
      newVal: nextStatus,
      userId: role,
      userName: userName
    });
    res.json({ ok: true, version: versionKey, snapshot: snap, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/sectors/:code/reject-approval', (req, res) => {
  try {
    const sectorCode = req.params.code;
    const { userName, role, reason } = req.body || {};
    const flow = sw.getSectorFlow(dbm.getMeta(db, 'sectorFlows', {}), sectorCode);
    sw.setSectorFlow(db, dbm.setMeta, dbm.getMeta, sectorCode, {
      approvalStatus: 'draft',
      reportingSubmitted: false
    });
    const allProjects = getAllProjectsFromDb(db);
    const updatedFlows = dbm.getMeta(db, 'sectorFlows', {});
    const registry = sw.getSectorRegistry(db, dbm.getMeta, allProjects);
    const companyFlow = sw.getCompanyFlow(dbm.getMeta, db);
    sw.syncLegacyMetaFromFlows(db, dbm.getMeta, dbm.setMeta, updatedFlows, companyFlow, registry);
    dbm.pushAudit(db, {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: sectorCode,
      fieldName: 'reject_reason',
      fieldCN: '驳回',
      oldVal: flow.approvalStatus,
      newVal: reason || '已驳回至板块管理员',
      userId: role,
      userName: userName
    });
    res.json({ ok: true, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/company/archive', (req, res) => {
  try {
    const { userName, role } = req.body || {};
    const allProjects = getAllProjectsFromDb(db);
    const companyFlow = sw.getCompanyFlow(dbm.getMeta, db);
    if (companyFlow.archiveStatus === 'final') {
      res.status(409).json({ error: '已完成公司归档' });
      return;
    }
    const snap = {
      version: 'J版',
      time: new Date().toISOString(),
      user: userName || '系统管理员',
      role: role || 'system_admin',
      scope: 'company',
      projects: JSON.parse(JSON.stringify(allProjects))
    };
    dbm.putSnapshot(db, 'J版', snap);
    dbm.setMeta(db, 'companyFlow', {
      archiveStatus: 'final',
      archivedAt: new Date().toISOString()
    });
    dbm.setMeta(db, 'approvalStatus', 'final');
    dbm.pushAudit(db, {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: '全公司',
      fieldName: 'archive',
      fieldCN: '公司归档',
      oldVal: 'pending_archive',
      newVal: 'J版',
      userId: role || 'system_admin',
      userName: userName || '系统管理员'
    });
    res.json({ ok: true, snapshot: snap, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/pm-submissions/receive', (req, res) => {
  try {
    const { pmName, reportingMonth, userName } = req.body || {};
    if (!pmName || !reportingMonth) {
      res.status(400).json({ error: 'pmName 与 reportingMonth 必填' });
      return;
    }

    const subs = dbm.getPmSubmissions(db);
    const monthSubs = subs[reportingMonth] || {};
    if (!monthSubs[pmName] || monthSubs[pmName].status !== 'submitted') {
      res.status(409).json({ error: '该 PM 当前无待接收的提交' });
      return;
    }

    monthSubs[pmName].status = 'received';
    monthSubs[pmName].receivedAt = new Date().toISOString();
    monthSubs[pmName].receivedBy = userName || '板块管理员';
    // 为下一轮填报建立基准快照（不覆盖 submissionBaselineSnapshotVersion，供历史 diff）
    const { version: baselineVersion, snap: baselineSnap } = createPmBaselineSnapshot(
      db, pmName, reportingMonth, userName
    );
    monthSubs[pmName].baselineSnapshotVersion = baselineVersion;
    // submissionBaselineSnapshotVersion 保留本轮提交时的对比基准
    subs[reportingMonth] = monthSubs;
    dbm.setPmSubmissions(db, subs);

    // 审计
    const record = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: '全局',
      fieldName: 'pm_receive',
      fieldCN: '板块接收',
      oldVal: 'submitted',
      newVal: 'received',
      userId: 'sector_admin',
      userName: userName || '板块管理员'
    };
    dbm.pushAudit(db, record);

    res.json({
      ok: true,
      pmName,
      status: 'received',
      baselineSnapshotVersion: baselineVersion,
      baselineSnapshot: baselineSnap
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

function importProjectsFromInitXlsx(reportingMonth) {
  const xlsxPath = resolveInitXlsx();
  if (!xlsxPath) {
    const err = new Error('未找到 初始数据.xlsx（或 S520 xlsx / PTRACK_INIT_XLSX）');
    err.status = 400;
    throw err;
  }
  const buf = fs.readFileSync(xlsxPath);
  const projects = projectsFromXlsxBuffer(buf, modules, reportingMonth);
  if (projects.length === 0) {
    const err = new Error('文件中未解析出有效项目');
    err.status = 400;
    throw err;
  }
  dbm.replaceAllProjects(db, normalizeProjects(projects));
  return { count: projects.length, file: path.basename(xlsxPath) };
}

function applyDevSeedAfterImport(reportingMonth) {
  return seedDevEnvironment(db, modules, {
    reportingMonth,
    repickDemoNew: true
  });
}

/** 基于当前库生成上一报告月对比快照（剔除部分项目，用于「新增项目」演示） */
app.post('/api/admin/seed-prior-month-snapshot', (req, res) => {
  try {
    const body = req.body || {};
    const reportingMonth = body.reportingMonth
      || dbm.getMeta(db, 'reportingMonth')
      || '2026-05';
    const removeCount = body.removeCount != null ? Number(body.removeCount) : 5;
    const result = seedPriorMonthSnapshot(db, modules, {
      reportingMonth,
      removeCount,
      removeProjectNos: body.removeProjectNos,
      user: body.userName || '系统',
      role: body.role || 'system_admin'
    });
    res.json({ ok: true, state: dbm.getBootstrapState(db), ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

app.post('/api/admin/reseed', (_req, res) => {
  try {
    dbm.ensureDefaultMeta(db);
    const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
    const { count, file } = importProjectsFromInitXlsx(reportingMonth);
    dbm.clearAudit(db);
    dbm.clearSnapshots(db);
    db.prepare('DELETE FROM meta WHERE key = ?').run('priorMonthSnapshotVersion');
    dbm.clearLockOverride(db);
    dbm.setMeta(db, 'approvalStatus', 'draft');
    dbm.setMeta(db, 'reportingSubmitted', false);
    dbm.setMeta(db, 'pmSubmissions', {});
    dbm.setMeta(db, 'companyFlow', { archiveStatus: 'pending', archivedAt: null });
    const registry = sw.DEFAULT_SECTOR_REGISTRY.slice();
    const flows = {};
    registry.forEach(code => { flows[code] = sw.defaultSectorFlowEntry(); });
    dbm.setMeta(db, 'sectorFlows', flows);
    dbm.setMeta(db, 'sectorRegistry', registry);
    const devSeed = applyDevSeedAfterImport(reportingMonth);
    res.json({ ok: true, count, file, devSeed });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

/** 从 docs/参考数据 重新导入工时明细 xlsx */
app.post('/api/admin/timesheet-import', (req, res) => {
  try {
    const body = req.body || {};
    const result = timesheetImport.importTimesheetsFromDir(db, dbm, { force: true });
    if (result.imported) {
      const actor = body.user || body.actor || null;
      dbm.pushAudit(db, {
        id: Date.now() + '_tsimport_' + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        operation_type: 'timesheet_import',
        projectNo: '—',
        projectName: '全局',
        fieldName: 'timesheet_import',
        fieldCN: '工时数据导入',
        oldVal: '',
        newVal: JSON.stringify(result.stats),
        userId: actor && actor.id ? actor.id : 'system_admin',
        userName: actor && actor.name ? actor.name : '系统管理员'
      });
    }
    res.json({
      ok: true,
      ...result,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

/** 从 docs/参考数据 重新导入成本中心 xlsx */
app.post('/api/admin/cost-import', (req, res) => {
  try {
    const body = req.body || {};
    const result = costImport.importCostFromDir(db, dbm, { force: true });
    if (result.imported) {
      const actor = body.user || body.actor || null;
      dbm.pushAudit(db, {
        id: Date.now() + '_costimport_' + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        operation_type: 'cost_import',
        projectNo: '—',
        projectName: '全局',
        fieldName: 'cost_import',
        fieldCN: '成本中心数据导入',
        oldVal: '',
        newVal: JSON.stringify(result.stats),
        userId: actor && actor.id ? actor.id : 'system_admin',
        userName: actor && actor.name ? actor.name : '系统管理员'
      });
    }
    res.json({
      ok: true,
      ...result,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

/** 手动从中台/CRB/财务同步系统字段 */
app.post('/api/admin/sync-platform-data', (req, res) => {
  try {
    const body = req.body || {};
    const actor = body.user || body.actor || null;
    const result = platformSync.runPlatformSync(db, dbm, modules, {
      trigger: 'manual',
      actor: actor ? { id: actor.id || actor.userId, name: actor.name || actor.userName } : null
    });
    res.json({
      ok: true,
      systemDataSyncedAt: result.syncedAt,
      stats: result.stats,
      syncMeta: result.syncMeta,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

/** 开发测试：配置/流程/数据全部恢复初始默认 */
app.post('/api/admin/reset-dev', (_req, res) => {
  try {
    dbm.resetDevMeta(db);
    const reportingMonth = dbm.DEFAULT_PERIOD_CONFIG.reportingMonth;
    const { count, file } = importProjectsFromInitXlsx(reportingMonth);
    const devSeed = applyDevSeedAfterImport(reportingMonth);
    res.json({
      ok: true,
      count,
      file,
      devSeed,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

app.use(express.static(ROOT));

function runScheduledPlatformSync() {
  try {
    if (dbm.getEffectiveLockStatus(db) !== 'open') {
      return;
    }
    const result = platformSync.runPlatformSync(db, dbm, modules, { trigger: 'scheduled' });
    console.log('[ptrack] 定时平台同步完成', result.syncedAt, result.stats);
  } catch (e) {
    console.warn('[ptrack] 定时平台同步失败:', e.message);
  }
}

function scheduleDailyPlatformSync() {
  let lastRunDate = '';
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const pc = Object.assign({}, dbm.DEFAULT_PERIOD_CONFIG, dbm.getMeta(db, 'periodConfig') || {});
    const hour = pc.platformSyncHour != null ? Number(pc.platformSyncHour) : 2;
    if (now.getHours() === hour && lastRunDate !== today) {
      lastRunDate = today;
      runScheduledPlatformSync();
    }
  }, 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`[ptrack] http://127.0.0.1:${PORT}/  | SQLite: ${dbm.DB_PATH}`);
  scheduleDailyPlatformSync();
});
