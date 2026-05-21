'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { COST_CATEGORIES } = require('./cost-categories');

const ROOT = path.join(__dirname, '..');

function resolveCostDataDir() {
  const env = process.env.PTRACK_COST_DIR || process.env.PTRACK_TIMESHEET_DIR;
  if (env) return path.isAbsolute(env) ? env : path.join(ROOT, env);
  return path.join(ROOT, 'docs', '参考数据');
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 2026年03月 → 2026-03 */
function parseMonthLabel(label) {
  const s = str(label);
  const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  const mo = String(parseInt(m[2], 10)).padStart(2, '0');
  return m[1] + '-' + mo;
}

function projectNoFromFilename(filename) {
  const m = filename.match(/成本中心[_-]?(.+?)\.xlsx$/i);
  if (m) return m[1].trim();
  return null;
}

/**
 * 解析平台「成本中心」透视表：首列为月份/总计，表头为各成本项。
 */
function parseCostCenterXlsxBuffer(buf, fallbackProjectNo) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (COST_CATEGORIES.includes(str(row[c]))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) break;
  }
  if (headerIdx < 0) return [];

  const headerRow = rows[headerIdx];
  const categoryCols = [];
  for (let c = 0; c < headerRow.length; c++) {
    const cat = str(headerRow[c]);
    if (COST_CATEGORIES.includes(cat)) {
      categoryCols.push({ category: cat, colIdx: c });
    }
  }
  if (!categoryCols.length) return [];

  const entries = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const costMonth = parseMonthLabel(row[0]);
    if (!costMonth) continue;

    for (const { category, colIdx } of categoryCols) {
      const amount = toNum(row[colIdx]);
      entries.push({
        project_no: fallbackProjectNo,
        cost_month: costMonth,
        category,
        amount
      });
    }
  }
  return entries;
}

function listCostXlsxFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .filter(f => f.includes('成本中心') || projectNoFromFilename(f))
    .map(f => path.join(dir, f));
}

function importCostFromDir(db, dbm, options = {}) {
  const dir = resolveCostDataDir();
  const files = listCostXlsxFiles(dir);
  if (!files.length) {
    return { imported: false, reason: 'no_files', dir, stats: { files: 0, projects: 0, rows: 0 } };
  }

  const existing = dbm.countCostEntries(db);
  if (existing > 0 && !options.force) {
    return { imported: false, reason: 'already_imported', dir, existing, stats: { files: files.length } };
  }

  const byProject = new Map();
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const fallbackNo = projectNoFromFilename(filename);
    if (!fallbackNo) continue;
    const buf = fs.readFileSync(filePath);
    const entries = parseCostCenterXlsxBuffer(buf, fallbackNo);
    if (!byProject.has(fallbackNo)) byProject.set(fallbackNo, []);
    byProject.get(fallbackNo).push(...entries);
  }

  let totalRows = 0;
  for (const [projectNo, rows] of byProject) {
    dbm.replaceProjectCostEntries(db, projectNo, rows);
    totalRows += rows.length;
  }

  const stats = { files: files.length, projects: byProject.size, rows: totalRows, dir };
  const syncedAt = new Date().toISOString();
  dbm.setMeta(db, 'costImportedAt', syncedAt);
  dbm.setMeta(db, 'costImportStats', stats);

  return { imported: true, syncedAt, stats };
}

function seedCostIfEmpty(db, dbm) {
  if (dbm.countCostEntries(db) > 0) return { seeded: false };
  const result = importCostFromDir(db, dbm, { force: false });
  if (result.imported) {
    console.log('[ptrack] 已导入成本中心', result.stats.rows, '条，', result.stats.projects, '个项目');
  }
  return { seeded: result.imported, ...result };
}

module.exports = {
  resolveCostDataDir,
  parseCostCenterXlsxBuffer,
  importCostFromDir,
  seedCostIfEmpty,
  projectNoFromFilename
};
