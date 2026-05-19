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
    if (body.reportingSubmitted !== undefined) {
      dbm.setMeta(db, 'reportingSubmitted', !!body.reportingSubmitted);
    }
    res.json(dbm.getBootstrapState(db));
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/admin/reseed', (_req, res) => {
  try {
    const xlsxPath = resolveInitXlsx();
    if (!xlsxPath) {
      res.status(400).json({ error: '未找到 初始数据.xlsx（或 S520 xlsx / PTRACK_INIT_XLSX）' });
      return;
    }
    dbm.ensureDefaultMeta(db);
    const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
    const buf = fs.readFileSync(xlsxPath);
    const projects = projectsFromXlsxBuffer(buf, modules, reportingMonth);
    if (projects.length === 0) {
      res.status(400).json({ error: '文件中未解析出有效项目' });
      return;
    }
    dbm.replaceAllProjects(db, projects);
    dbm.clearAudit(db);
    dbm.clearSnapshots(db);
    dbm.clearLockOverride(db);
    dbm.setMeta(db, 'approvalStatus', 'draft');
    dbm.setMeta(db, 'reportingSubmitted', false);
    res.json({ ok: true, count: projects.length, file: path.basename(xlsxPath) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`[ptrack] http://127.0.0.1:${PORT}/  | SQLite: ${dbm.DB_PATH}`);
});
