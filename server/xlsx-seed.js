/**
 * 将 Excel buffer 解析为 project 数组（逻辑对齐 js/xlsx-importer.js）
 */
'use strict';

const XLSX = require('xlsx');

function cellValue(cell) {
  if (!cell) return null;
  if (cell.t === 'd') return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : cell.w;
  if (cell.t === 'n') return cell.v;
  return cell.v !== undefined ? cell.v : (cell.w || null);
}

function sheetToRows(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push(cellValue(ws[addr]));
    }
    rows.push(row);
  }
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row) continue;
    const hasProjectNo = row.some(v =>
      v && (String(v).includes('项目号') || String(v).includes('Project No'))
    );
    if (hasProjectNo) return { headerRowIdx: i, dataStartIdx: i + 1 };
  }
  return { headerRowIdx: 1, dataStartIdx: 2 };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

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

/**
 * @param {Buffer} buf
 * @param {{ FieldConfig: object, FormulaEngine: object }} modules
 * @param {string} reportingMonth YYYY-MM
 */
function projectsFromXlsxBuffer(buf, modules, reportingMonth) {
  const { FieldConfig, FormulaEngine } = modules;
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = sheetToRows(ws);
  const { headerRowIdx, dataStartIdx } = findHeaderRow(rows);
  const fields = FieldConfig.buildFieldConfig();
  const colMap = FieldConfig.COL_TO_KEY;
  const projects = [];
  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');

  for (let ri = dataStartIdx; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || row.every(v => v === null || v === '')) continue;
    const p = {};
    fields.forEach((f, colIdx) => {
      const key = colMap[f.col];
      if (!key) return;
      const val = row[colIdx] !== undefined ? row[colIdx] : null;
      if (key.startsWith('mc_') || key.startsWith('mi_') || key.startsWith('mp_')) {
        p[key] = toNum(val);
      } else if (f.data_type === '金额' || f.data_type === '比率') {
        p[key] = toNum(val);
      } else if (f.data_type === '日期') {
        p[key] = normalizeDateValue(val);
      } else {
        p[key] = val !== null && val !== undefined ? String(val) : '';
      }
    });

    const merged = FieldConfig.flatToArrays(p);
    if (!merged.sign_year && merged.start_date) {
      merged.sign_year = parseInt(String(merged.start_date).slice(0, 4)) || 2026;
    }
    merged.crb_status = merged.signed === '已签署' ? '已确认' : '';
    if (!merged._added_this_month) merged._added_this_month = false;
    if (!merged._changed_fields) merged._changed_fields = [];

    if (!merged.project_no) continue;

    merged.id = merged.project_no;
    const computed = FormulaEngine.compute(merged, monthIdx);
    projects.push(computed);
  }

  return projects;
}

module.exports = { projectsFromXlsxBuffer };
