'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { loadBrowserScripts } = require('./load-modules');
const { projectsFromXlsxBuffer } = require('./xlsx-seed');
const dbm = require('./db');

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
  console.log('[ptrack] 已从', xlsxPath, '初始化', projects.length, '条项目');
  return { seeded: true, count: projects.length, file: xlsxPath };
}

const db = dbm.openDb();
dbm.ensureDefaultMeta(db);
seedFromXlsxIfEmpty(db);

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

function getPmProjectsFromDb(db, pmName) {
  return db.prepare('SELECT payload FROM projects').all()
    .map(r => JSON.parse(r.payload))
    .filter(p => p.pm_name === pmName);
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

    // 校验：板块未正式提交
    const reportingSubmitted = dbm.getMeta(db, 'reportingSubmitted', false);
    if (reportingSubmitted === true) {
      res.status(409).json({ error: '板块已正式提交审批，PM 无法再次提交' });
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
  dbm.replaceAllProjects(db, projects);
  return { count: projects.length, file: path.basename(xlsxPath) };
}

app.post('/api/admin/reseed', (_req, res) => {
  try {
    dbm.ensureDefaultMeta(db);
    const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
    const { count, file } = importProjectsFromInitXlsx(reportingMonth);
    dbm.clearAudit(db);
    dbm.clearSnapshots(db);
    dbm.clearLockOverride(db);
    dbm.setMeta(db, 'approvalStatus', 'draft');
    dbm.setMeta(db, 'reportingSubmitted', false);
    dbm.setMeta(db, 'pmSubmissions', {});
    res.json({ ok: true, count, file });
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
    res.json({
      ok: true,
      count,
      file,
      state: dbm.getBootstrapState(db)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message) });
  }
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`[ptrack] http://127.0.0.1:${PORT}/  | SQLite: ${dbm.DB_PATH}`);
});
