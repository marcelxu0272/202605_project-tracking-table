'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

function resolveTimesheetDir() {
  const env = process.env.PTRACK_TIMESHEET_DIR;
  if (env) return path.isAbsolute(env) ? env : path.join(ROOT, env);
  return path.join(ROOT, 'docs', '参考数据');
}

function normalizeDateValue(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number' && val >= 20000 && val < 120000) {
    return new Date(EXCEL_EPOCH_UTC_MS + Math.round(val) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = parseFloat(s);
  if (!isNaN(n) && n >= 20000 && n < 120000 && /^\d+(\.\d+)?$/.test(s)) {
    return new Date(EXCEL_EPOCH_UTC_MS + Math.round(n) * 86400000).toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
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

/** 从文件名解析项目号：工时上报明细统计_B25340.xlsx */
function projectNoFromFilename(filename) {
  const m = filename.match(/工时上报明细统计[_-]?(.+?)\.xlsx$/i);
  if (m) return m[1].trim();
  const m2 = filename.match(/^(.+?)_timesheet/i);
  return m2 ? m2[1].trim() : null;
}

function rowToEntry(row, headerMap) {
  const get = (name) => {
    const idx = headerMap[name];
    return idx != null ? row[idx] : undefined;
  };
  const workDate = normalizeDateValue(get('日期'));
  if (!workDate) return null;
  const projectNo = str(get('项目编码'));
  return {
    project_no: projectNo,
    work_date: workDate,
    profession: str(get('专业')),
    engineer_sector: str(get('工程师管理归属')),
    engineer: str(get('工程师')),
    unit_no: str(get('单元号')),
    unit_name: str(get('单元名称')),
    approved_hours: toNum(get('已审工时(H)')),
    approved_cost: toNum(get('已审工时成本')),
    rate: toNum(get('费率')) || null,
    remark: str(get('备注')),
    raw_payload: {
      板块归属: str(get('板块归属')),
      项目经理: str(get('项目经理')),
      主专业: str(get('主专业'))
    }
  };
}

function parseTimesheetXlsxBuffer(buf, fallbackProjectNo) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];

  const headerRow = rows[0].map(h => str(h));
  const headerMap = {};
  headerRow.forEach((h, i) => {
    if (h) headerMap[h] = i;
  });

  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const entry = rowToEntry(rows[i], headerMap);
    if (!entry) continue;
    if (!entry.project_no && fallbackProjectNo) {
      entry.project_no = fallbackProjectNo;
    }
    if (!entry.project_no) continue;
    entries.push(entry);
  }
  return entries;
}

function listTimesheetXlsxFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .filter(f => f.includes('工时') || projectNoFromFilename(f))
    .map(f => path.join(dir, f));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ replaceProjectTimesheet: Function, setMeta: Function, countTimesheetEntries: Function }} dbm
 * @param {{ force?: boolean }} [options]
 */
function importTimesheetsFromDir(db, dbm, options = {}) {
  const dir = resolveTimesheetDir();
  const files = listTimesheetXlsxFiles(dir);
  if (!files.length) {
    return { imported: false, reason: 'no_files', dir, stats: { files: 0, projects: 0, rows: 0 } };
  }

  const existing = dbm.countTimesheetEntries(db);
  if (existing > 0 && !options.force) {
    return { imported: false, reason: 'already_imported', dir, existing, stats: { files: files.length } };
  }

  const byProject = new Map();
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const fallbackNo = projectNoFromFilename(filename);
    const buf = fs.readFileSync(filePath);
    const entries = parseTimesheetXlsxBuffer(buf, fallbackNo);
    for (const e of entries) {
      const no = e.project_no;
      if (!byProject.has(no)) byProject.set(no, []);
      byProject.get(no).push(e);
    }
  }

  let totalRows = 0;
  for (const [projectNo, rows] of byProject) {
    dbm.replaceProjectTimesheet(db, projectNo, rows);
    totalRows += rows.length;
  }

  const stats = {
    files: files.length,
    projects: byProject.size,
    rows: totalRows,
    dir
  };
  const syncedAt = new Date().toISOString();
  dbm.setMeta(db, 'timesheetImportedAt', syncedAt);
  dbm.setMeta(db, 'timesheetImportStats', stats);

  return { imported: true, syncedAt, stats };
}

function seedTimesheetsIfEmpty(db, dbm) {
  if (dbm.countTimesheetEntries(db) > 0) return { seeded: false };
  const result = importTimesheetsFromDir(db, dbm, { force: false });
  if (result.imported) {
    console.log('[ptrack] 已导入工时明细', result.stats.rows, '条，', result.stats.projects, '个项目');
  }
  return { seeded: result.imported, ...result };
}

module.exports = {
  resolveTimesheetDir,
  parseTimesheetXlsxBuffer,
  importTimesheetsFromDir,
  seedTimesheetsIfEmpty,
  projectNoFromFilename
};
