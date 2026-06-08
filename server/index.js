'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { loadBrowserScripts } = require('./load-modules');
const { projectsFromXlsxBuffer } = require('./xlsx-seed');
const snapSvc = require('./snapshot-service');
const { seedDevEnvironment, createDevImportSnapshot, normalizeProjects } = require('./dev-reset-seed');
const { ensureInitXlsx } = require('./init-xlsx-export');
const dbm = require('./db');
const sw = require('./sector-workflow');
const platformSync = require('./platform-sync');
const timesheetImport = require('./timesheet-import');
const timesheetStats = require('./timesheet-stats');
const costImport = require('./cost-import');
const costStats = require('./cost-stats');
const alertDemo = require('./alert-demo-seed');
const fieldDict = require('./fields/dictionary');
const alertService = require('./alert-service');
const reportLineService = require('./report-line-service');
const reportLineSeed = require('./report-line-seed');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PTRACK_PORT) || 3000;

const modules = loadBrowserScripts();

function resolveInitXlsx() {
  return require('./init-xlsx-export').findExistingInitXlsx();
}

/** 初始化导入后与平台数据合并（Excel 值优先） */
function mergeWithPlatformAfterImport(projects, reportingMonth) {
  try {
    const platformProjects = platformSync.fetchPlatformSnapshot(db, modules, reportingMonth);
    const { projects: merged, stats } = platformSync.mergeInitialImportWithPlatform(
      projects, platformProjects, reportingMonth, modules
    );
    console.log('[ptrack] 初始化平台合并:', JSON.stringify(stats));
    return { projects: merged, stats };
  } catch (e) {
    console.warn('[ptrack] 初始化平台合并失败（继续使用 Excel 数据）:', e.message);
    return { projects, stats: null };
  }
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
  const { projects: mergedProjects, stats: mergeStats } = mergeWithPlatformAfterImport(projects, reportingMonth);
  dbm.replaceAllProjects(db, mergedProjects);
  dbm.setMeta(db, 'systemDataSyncedAt', new Date().toISOString());
  dbm.setMeta(db, 'systemDataSyncMeta', { trigger: 'seed', at: new Date().toISOString(), mergeStats });
  let devSeed = null;
  let importSnapshot = null;
  try {
    devSeed = seedDevEnvironment(db, modules, { reportingMonth, repickDemoNew: true });
    importSnapshot = createDevImportSnapshot(db, devSeed, {
      sourceFile: path.basename(xlsxPath)
    });
    console.log('[ptrack] 已生成导入快照', importSnapshot.version,
      '| 新增项目演示', devSeed.demoNewProjectNos.join(', '));
  } catch (e) {
    console.warn('[ptrack] 演示/导入快照生成失败:', e.message);
  }
  console.log('[ptrack] 已从', xlsxPath, '初始化', projects.length, '条项目');
  return { seeded: true, count: projects.length, file: xlsxPath, devSeed, importSnapshot };
}

const db = dbm.openDb();
dbm.ensureDefaultMeta(db);
seedFromXlsxIfEmpty(db);
try {
  const snapMaint = snapSvc.maintainSnapshotStore(db);
  if (snapMaint.repaired) {
    console.log('[ptrack] 快照库已修复', snapMaint.action, snapMaint.baselineVersion || '');
  } else if (snapMaint.purged) {
    console.log('[ptrack] 已清理旧版快照', snapMaint.purged, '条');
  }
} catch (e) {
  console.warn('[ptrack] 快照库维护失败:', e.message);
}
timesheetImport.seedTimesheetsIfEmpty(db, dbm);
try {
  alertDemo.seedAlertDemoTimesheets(db);
} catch (e) {
  console.warn('[ptrack] 预警演示工时初始化失败:', e.message);
}
costImport.seedCostIfEmpty(db, dbm);
reportLineSeed.seedReportLines(db);

const app = express();
app.use(express.json({ limit: '80mb' }));

app.get('/api/bootstrap', (_req, res) => {
  try {
    snapSvc.maintainSnapshotStore(db);
    const state = dbm.getBootstrapState(db);
    state.fieldDictionary = fieldDict.readFields();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** 字段字典只读（与项目追踪表同源） */
app.get('/api/fields', (_req, res) => {
  try {
    const fields = fieldDict.readFields();
    res.json({ fields, count: fields.length });
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
    const periodChanged = body.periodConfig != null || body.reportingMonth != null;
    if (body.periodConfig != null) dbm.setMeta(db, 'periodConfig', body.periodConfig);
    if (body.reportingMonth != null) dbm.setMeta(db, 'reportingMonth', body.reportingMonth);
    if (body.approvalStatus != null) dbm.setMeta(db, 'approvalStatus', body.approvalStatus);
    if (body.lockStatus !== undefined) dbm.setMeta(db, 'lockStatus', body.lockStatus);
    if (periodChanged && body.lockStatus === undefined) dbm.resetLockStatus(db);
    // reportingSubmitted 只允许 sector_admin / system_admin 通过此接口置 true
    // PM 的提交由专用端点处理
    if (body.reportingSubmitted !== undefined) {
      dbm.setMeta(db, 'reportingSubmitted', !!body.reportingSubmitted);
    }
    const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
    platformSync.maybeRunNewExistingYearRollover(db, dbm, modules, reportingMonth);
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

// ── PM 提交端点 ──────────────────────────────────────────
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

    const subs = dbm.getPmSubmissions(db);
    if (!subs[reportingMonth]) subs[reportingMonth] = {};
    const prev = subs[reportingMonth][pmName] || {};
    if (prev.status === 'submitted' || prev.status === 'received') {
      res.status(409).json({ error: '本月已提交，不可重复提交；如有问题请联系板块管理员修正' });
      return;
    }
    subs[reportingMonth][pmName] = {
      status: 'submitted',
      submittedAt: new Date().toISOString(),
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
      projectCount: pmProjects.length
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
    const snapResult = snapSvc.createDraftSnapshot(
      db, sectorCode, allProjects, { name: userName, role: role || 'sector_admin' }
    );
    const versionKey = snapResult.version;
    const snap = snapResult.snap;
    const normalizedSector = sw.normalizeSectorCode(sectorCode);
    const sectorAdmins = dbm.getMeta(db, 'sectorAdmins', dbm.DEFAULT_SECTOR_ADMINS);
    const adminConfig = (sectorAdmins && sectorAdmins[normalizedSector]) || {};
    const users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS);
    const skipDirectorApproval = sw.shouldSkipDirectorApproval(adminConfig, users, normalizedSector);
    sw.setSectorFlow(db, dbm.setMeta, dbm.getMeta, sectorCode, {
      approvalStatus: skipDirectorApproval ? 'approve1' : 'draft',
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
      newVal: skipDirectorApproval ? versionKey + '（跳过总监初审）' : versionKey,
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
    if (flow.approvalStatus === 'draft' && flow.reportingSubmitted) {
      nextStatus = 'approve1';
    } else if (flow.approvalStatus === 'approve1') {
      nextStatus = 'approve2';
    } else {
      res.status(409).json({ error: '当前板块状态不可推进审批' });
      return;
    }
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
    res.json({ ok: true, state: dbm.getBootstrapState(db) });
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
    const lockStatus = dbm.getEffectiveLockStatus(db);
    if (lockStatus !== 'locked') {
      res.status(403).json({ error: '归档仅可在锁定期提交' });
      return;
    }
    const { userName, role } = req.body || {};
    const allProjects = getAllProjectsFromDb(db);
    const result = snapSvc.createFinalSnapshot(db, allProjects, {
      name: userName || '系统管理员',
      role: role || 'system_admin'
    });
    const snap = result.snap;
    dbm.clearProjectChangeTracking(db);
    dbm.resetWorkflowCycleAfterArchive(db);
    dbm.pushAudit(db, {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: '—',
      projectName: '全公司',
      fieldName: 'archive',
      fieldCN: '公司归档',
      oldVal: 'pending_archive',
      newVal: result.version,
      userId: role || 'system_admin',
      userName: userName || '系统管理员'
    });
    res.json({ ok: true, version: result.version, snapshot: snap, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/pm-submissions/receive', (_req, res) => {
  res.status(410).json({ error: '已废弃：PM 提交后无需板块确认接收' });
});

function importProjectsFromInitXlsx(reportingMonth) {
  const ensured = ensureInitXlsx(db, modules, { reportingMonth });
  const xlsxPath = ensured.path;
  const buf = fs.readFileSync(xlsxPath);
  const projects = projectsFromXlsxBuffer(buf, modules, reportingMonth);
  if (projects.length === 0) {
    const err = new Error('文件中未解析出有效项目');
    err.status = 400;
    throw err;
  }
  const { projects: mergedProjects, stats: mergeStats } = mergeWithPlatformAfterImport(projects, reportingMonth);
  dbm.replaceAllProjects(db, normalizeProjects(mergedProjects));
  return {
    count: mergedProjects.length,
    file: path.basename(xlsxPath),
    xlsxGenerated: ensured.generated,
    mergeStats
  };
}

function applyDevSeedAfterImport(reportingMonth, sourceFile) {
  const devSeed = seedDevEnvironment(db, modules, {
    reportingMonth,
    repickDemoNew: true
  });
  const importSnapshot = createDevImportSnapshot(db, devSeed, { sourceFile });
  return Object.assign({}, devSeed, { importSnapshot });
}

function resetWorkflowMeta(db) {
  dbm.resetLockStatus(db);
  dbm.setMeta(db, 'approvalStatus', 'draft');
  dbm.setMeta(db, 'reportingSubmitted', false);
  dbm.setMeta(db, 'pmSubmissions', {});
  dbm.setMeta(db, 'companyFlow', { archiveStatus: 'pending', archivedAt: null });
  const registry = sw.DEFAULT_SECTOR_REGISTRY.slice();
  const flows = {};
  registry.forEach(code => { flows[code] = sw.defaultSectorFlowEntry(); });
  dbm.setMeta(db, 'sectorFlows', flows);
  dbm.setMeta(db, 'sectorRegistry', registry);
}

app.post('/api/admin/reseed', (_req, res) => {
  try {
    dbm.ensureDefaultMeta(db);
    const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
    const { count, file } = importProjectsFromInitXlsx(reportingMonth);
    dbm.clearAudit(db);
    resetWorkflowMeta(db);
    const allProjects = getAllProjectsFromDb(db);
    const importSnapshot = snapSvc.createImportSnapshot(db, allProjects, {
      reportingMonth,
      sourceFile: file,
      userName: '系统',
      role: 'system_admin'
    });
    res.json({
      ok: true,
      count,
      file,
      importSnapshot,
      state: dbm.getBootstrapState(db)
    });
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

/** 填报页刷新：工程平台引用 + 库内最新项目（含 PM/板块已保存数据） */
app.post('/api/editor/refresh-data', (req, res) => {
  try {
    const body = req.body || {};
    const user = body.user || body.actor || {};
    const role = user.role || user.id;
    if (role !== 'system_admin' && role !== 'sector_admin') {
      res.status(403).json({ error: '仅系统管理员或板块管理员可刷新' });
      return;
    }
    const result = platformSync.runPlatformSync(db, dbm, modules, {
      trigger: 'manual',
      actor: user ? { id: user.id || user.role, name: user.name || user.userName } : null
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

/** 手动从中台/CRB/财务同步系统字段（兼容旧调用，等同 refresh-data） */
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
    const devSeed = applyDevSeedAfterImport(reportingMonth, file);
    const reportLineReseed = reportLineSeed.seedReportLines(db, { force: true });
    res.json({
      ok: true,
      count,
      file,
      devSeed,
      importSnapshot: devSeed.importSnapshot,
      reportLineReseed,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

/** 开发测试：重建填报管理（报告线）演示数据 */
app.post('/api/admin/reseed-report-lines', (_req, res) => {
  try {
    const result = reportLineSeed.seedReportLines(db, { force: true });
    res.json({
      ok: true,
      ...result,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

app.get('/api/admin/users', (_req, res) => {
  try {
    dbm.ensureDefaultMeta(db);
    res.json({
      users: dbm.getMeta(db, 'users', dbm.DEFAULT_USERS),
      groupRegistry: dbm.getMeta(db, 'groupRegistry', dbm.DEFAULT_GROUP_REGISTRY),
      sectorAdmins: dbm.getMeta(db, 'sectorAdmins', dbm.DEFAULT_SECTOR_ADMINS),
      sectorReviewers: dbm.getMeta(db, 'sectorReviewers', dbm.DEFAULT_SECTOR_REVIEWERS),
      groupReviewers: dbm.getMeta(db, 'groupReviewers', dbm.DEFAULT_GROUP_REVIEWERS),
      sectorRegistry: dbm.getBootstrapState(db).sectorRegistry
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.patch('/api/admin/users', (req, res) => {
  try {
    const body = req.body || {};
    if (body.users != null) {
      if (!Array.isArray(body.users)) {
        res.status(400).json({ error: 'users 必须为数组' });
        return;
      }
      dbm.setMeta(db, 'users', body.users);
    }
    if (body.groupRegistry != null) {
      dbm.setMeta(db, 'groupRegistry', body.groupRegistry);
    }
    if (body.sectorAdmins != null) {
      if (!body.sectorAdmins || typeof body.sectorAdmins !== 'object' || Array.isArray(body.sectorAdmins)) {
        res.status(400).json({ error: 'sectorAdmins 必须为对象' });
        return;
      }
      const sanitized = {};
      Object.keys(body.sectorAdmins).forEach(function (code) {
        const cfg = body.sectorAdmins[code] || {};
        sanitized[sw.normalizeSectorCode(code)] = {
          adminName: String(cfg.adminName || '').trim(),
          adminUserId: String(cfg.adminUserId || '').trim()
        };
      });
      dbm.setMeta(db, 'sectorAdmins', sanitized);
    }
    if (body.sectorReviewers != null) {
      if (!body.sectorReviewers || typeof body.sectorReviewers !== 'object' || Array.isArray(body.sectorReviewers)) {
        res.status(400).json({ error: 'sectorReviewers 必须为对象' });
        return;
      }
      const sanitizedReviewers = {};
      Object.keys(body.sectorReviewers).forEach(function (code) {
        const cfg = body.sectorReviewers[code] || {};
        sanitizedReviewers[sw.normalizeSectorCode(code)] = {
          reviewerName: String(cfg.reviewerName || '').trim(),
          reviewerUserId: String(cfg.reviewerUserId || '').trim()
        };
      });
      dbm.setMeta(db, 'sectorReviewers', sanitizedReviewers);
    }
    if (body.groupReviewers != null) {
      if (!body.groupReviewers || typeof body.groupReviewers !== 'object' || Array.isArray(body.groupReviewers)) {
        res.status(400).json({ error: 'groupReviewers 必须为对象' });
        return;
      }
      const sanitizedGroupReviewers = {};
      Object.keys(body.groupReviewers).forEach(function (code) {
        const cfg = body.groupReviewers[code] || {};
        sanitizedGroupReviewers[String(code).trim()] = {
          reviewerName: String(cfg.reviewerName || '').trim(),
          reviewerUserId: String(cfg.reviewerUserId || '').trim()
        };
      });
      dbm.setMeta(db, 'groupReviewers', sanitizedGroupReviewers);
    }
    const actor = body.user || {};
    const sectorAdminCount = body.sectorAdmins ? Object.keys(body.sectorAdmins).length : 0;
    const sectorReviewerCount = body.sectorReviewers ? Object.keys(body.sectorReviewers).length : 0;
    const groupReviewerCount = body.groupReviewers ? Object.keys(body.groupReviewers).length : 0;
    const auditField = body.sectorAdmins ? 'sectorAdmins'
      : body.sectorReviewers ? 'sectorReviewers'
      : body.groupReviewers ? 'groupReviewers'
      : 'users';
    const auditLabel = body.sectorAdmins ? '板块管理员配置'
      : body.sectorReviewers ? '板块审批人员配置'
      : body.groupReviewers ? '项目群审批人员配置'
      : '用户与权限配置';
    const auditSummary = body.sectorAdmins
      ? sectorAdminCount + ' 个板块管理员'
      : body.sectorReviewers
        ? sectorReviewerCount + ' 个板块审批'
        : body.groupReviewers
          ? groupReviewerCount + ' 个项目群审批'
          : ((body.users && body.users.length) ? body.users.length + ' 用户' : '群配置更新');
    dbm.pushAudit(db, {
      id: Date.now() + '_users_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      operation_type: 'user_config',
      projectNo: '—',
      projectName: '用户权限',
      fieldName: auditField,
      fieldCN: auditLabel,
      oldVal: '—',
      newVal: auditSummary,
      userId: actor.role || 'system_admin',
      userName: actor.name || '系统管理员'
    });
    res.json({ ok: true, state: dbm.getBootstrapState(db) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** 项目预警聚合：计算全部预警并持久化同步（仅系统管理员） */
app.get('/api/admin/alerts', (req, res) => {
  try {
    let year = req.query.year != null ? Number(req.query.year) : dbm.resolveSystemYear(db);
    if (!year || isNaN(year)) year = dbm.resolveSystemYear(db);
    let monthIdx = req.query.monthIdx != null ? Number(req.query.monthIdx) : null;
    if (monthIdx == null) {
      const rm = dbm.getMeta(db, 'reportingMonth', null);
      monthIdx = rm ? parseInt(String(rm).slice(5, 7), 10) - 1 : new Date().getMonth();
    }
    const result = alertService.collectAllAlerts(db, modules, dbm, timesheetStats, monthIdx, year);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** 永久忽略预警：系统管理员手动消除（仅系统管理员） */
app.post('/api/admin/alerts/:id/dismiss', (req, res) => {
  try {
    const alertId = Number(req.params.id);
    if (!alertId || isNaN(alertId)) return res.status(400).json({ error: '无效的预警 ID' });
    const dismissedBy = (req.body && req.body.dismissedBy) || 'system_admin';
    const dismissal = alertService.dismissAlertById(db, dbm, alertId, dismissedBy);
    dbm.pushAudit(db, {
      id: Date.now() + '_alert_dismiss_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      projectNo: dismissal.projectNo,
      projectName: '预警管理',
      fieldName: 'alert_dismiss',
      fieldCN: '预警消除',
      oldVal: 'active',
      newVal: 'dismissed（永久忽略）',
      userId: dismissedBy,
      userName: dismissedBy
    });
    res.json({ ok: true, dismissal });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** 字段字典：读写 fields.json + 同步 fields-data.js（仅系统管理员） */
app.get('/api/admin/fields', (_req, res) => {
  try {
    const fields = fieldDict.readFields();
    res.json({ fields, count: fields.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/admin/fields', (req, res) => {
  try {
    const body = req.body || {};
    const fields = body.fields;
    if (!Array.isArray(fields)) {
      res.status(400).json({ error: 'fields 必须为数组' });
      return;
    }
    const result = fieldDict.writeFields(fields);
    const actor = body.user || {};
    dbm.pushAudit(db, {
      id: Date.now() + '_fields_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      operation_type: 'field_dictionary',
      projectNo: '—',
      projectName: '字段字典',
      fieldName: 'fields.json',
      fieldCN: '字段字典',
      oldVal: '—',
      newVal: result.count + ' 个字段',
      userId: actor.role || 'system_admin',
      userName: actor.name || '系统管理员'
    });
    res.json({ ok: true, count: result.count, fields: fieldDict.readFields() });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message) });
  }
});

// ============ 报告线 API ============

// 发起填报预览（需 system_admin）
app.get('/api/report-lines/fork-preview', (req, res) => {
  try {
    const { role } = req.query;
    if (role !== 'system_admin') {
      res.status(403).json({ error: '仅系统管理员可查看发起预览' });
      return;
    }
    const preview = reportLineService.getForkPreview();
    res.json(preview);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 查询列表
app.get('/api/report-lines', (req, res) => {
  try {
    const { status, sector, period, role, sectorCode, groupCode, group } = req.query;
    const user = role ? { role: role, sector: sectorCode, sectorCode: sectorCode, groupCode: groupCode, group: group } : null;
    const filters = {};
    if (status) filters.status = status;
    if (sector) filters.sector = sector;
    if (period) filters.period = period;
    const rows = reportLineService.getReportLines(user, filters);
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 单条详情
app.get('/api/report-lines/:id', (req, res) => {
  try {
    const detail = reportLineService.getReportLineDetail(req.params.id);
    res.json(detail);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 字段级变更 diff
app.get('/api/report-lines/:id/diff', (req, res) => {
  try {
    const diffs = reportLineService.getDiff(req.params.id);
    res.json(diffs);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 审批记录
app.get('/api/report-lines/:id/approvals', (req, res) => {
  try {
    const detail = reportLineService.getReportLineDetail(req.params.id);
    res.json(detail.approvals || []);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 导出 Excel
app.get('/api/report-lines/:id/export', (req, res) => {
  try {
    const result = reportLineService.exportReportLine(req.params.id, {
      role: req.query.role,
      pmName: req.query.pmName,
      sectorCode: req.query.sectorCode
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent(result.filename));
    res.send(result.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 保存填报数据
app.put('/api/report-lines/:id/data', (req, res) => {
  try {
    const { projectNo, fieldData, userName } = req.body || {};
    if (!projectNo) {
      res.status(400).json({ error: 'projectNo 必填' });
      return;
    }
    const result = reportLineService.saveData(req.params.id, projectNo, fieldData, userName);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// PM 提交
app.post('/api/report-lines/:id/pm-submit', (req, res) => {
  try {
    const { pmName } = req.body || {};
    if (!pmName) {
      res.status(400).json({ error: 'pmName 必填' });
      return;
    }
    const result = reportLineService.pmSubmit(req.params.id, pmName);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 板块管理员提交审批
app.post('/api/report-lines/:id/submit-approval', (req, res) => {
  try {
    const { userName } = req.body || {};
    if (!userName) {
      res.status(400).json({ error: 'userName 必填' });
      return;
    }
    const result = reportLineService.submitApproval(req.params.id, userName);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 导出提交节点快照 Excel
app.get('/api/report-lines/:id/approvals/:approvalId/export', (req, res) => {
  try {
    const result = reportLineService.exportApprovalSnapshot(req.params.id, req.params.approvalId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(result.filename) + '"');
    res.send(result.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 审批通过/退回
app.post('/api/report-lines/:id/review', (req, res) => {
  try {
    const { action, role, userName, comment } = req.body || {};
    if (!action || !role || !userName) {
      res.status(400).json({ error: 'action、role、userName 必填' });
      return;
    }
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'action 必须为 approve 或 reject' });
      return;
    }
    const result = reportLineService.reviewApproval(req.params.id, action, role, userName, comment);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

// 创建新周期
app.post('/api/report-lines/fork-period', (req, res) => {
  try {
    const { period, role, userName, distributedColumns } = req.body || {};
    if (role !== 'system_admin') {
      res.status(403).json({ error: '仅系统管理员可创建新周期' });
      return;
    }
    if (!period) {
      res.status(400).json({ error: 'period 必填' });
      return;
    }
    const result = reportLineService.forkPeriod(period, {
      userName: userName || '系统管理员',
      distributedColumns: Array.isArray(distributedColumns) ? distributedColumns : null
    });
    const state = dbm.getBootstrapState(db);
    res.json({ ok: true, created: result.created, skipped: result.skipped, baselineVersion: result.baselineVersion, period: result.period, state });
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
