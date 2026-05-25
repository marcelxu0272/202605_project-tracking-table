'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const dbm = require('./db');
const snapSvc = require('./snapshot-service');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INIT_XLSX = path.join(ROOT, '初始数据.xlsx');

function resolveInitXlsxCandidates() {
  const env = process.env.PTRACK_INIT_XLSX;
  return [
    env && path.isAbsolute(env) ? env : env && path.join(ROOT, env),
    DEFAULT_INIT_XLSX,
    path.join(ROOT, 'S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx')
  ].filter(Boolean);
}

function findExistingInitXlsx() {
  for (const c of resolveInitXlsxCandidates()) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 将项目数组写入 初始数据.xlsx（83 列，与 xlsx-seed / xlsx-importer 对齐）
 */
function exportProjectsToInitXlsx(projects, outPath, modules, reportingMonth) {
  const { FieldConfig } = modules;
  const fields = FieldConfig.buildFieldConfig();
  const colMap = FieldConfig.COL_TO_KEY;
  const sections = FieldConfig.getSections(fields);

  const header1 = [];
  const header2 = [];
  sections.forEach(function (sec) {
    sec.fields.forEach(function (f, i) {
      header1.push(i === 0 ? sec.name : '');
      header2.push(f.name_cn);
    });
  });

  const rows = [header1, header2];
  (projects || []).forEach(function (p) {
    const clean = snapSvc.stripEphemeralMeta(p);
    const flat = FieldConfig.arraysToFlat(clean);
    const row = fields.map(function (f) {
      const key = colMap[f.col];
      if (!key) return '';
      let val = flat[key];
      if (val == null) return '';
      if (f.data_type === '日期') return String(val).slice(0, 10);
      return val;
    });
    rows.push(row);
  });

  const sheetName = reportingMonth || '2026-05';
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(wb, outPath);
  return { path: outPath, count: projects.length, sheetName };
}

function loadProjectsFromDb(db) {
  return db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all()
    .map(function (r) { return JSON.parse(r.payload); });
}

/**
 * 若根目录无初始化 xlsx，则从当前库导出 初始数据.xlsx
 * @returns {{ path: string, generated: boolean, count?: number }}
 */
function ensureInitXlsx(db, modules, options) {
  options = options || {};
  const existing = findExistingInitXlsx();
  if (existing) {
    return { path: existing, generated: false };
  }

  const outPath = options.outPath || DEFAULT_INIT_XLSX;
  const projects = loadProjectsFromDb(db);
  if (!projects.length) {
    const err = new Error(
      '未找到 初始数据.xlsx（或 S520 源表 / PTRACK_INIT_XLSX），且项目库为空，无法自动生成。'
        + '请将 初始数据.xlsx 置于项目根目录，或先完成一次数据导入。'
    );
    err.status = 400;
    throw err;
  }

  const reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || '2026-05';
  const result = exportProjectsToInitXlsx(projects, outPath, modules, reportingMonth);
  console.log('[ptrack] 已从 SQLite 自动生成', outPath, '（', result.count, '条）');
  return { path: outPath, generated: true, count: result.count };
}

module.exports = {
  DEFAULT_INIT_XLSX,
  findExistingInitXlsx,
  exportProjectsToInitXlsx,
  ensureInitXlsx,
  loadProjectsFromDb
};
