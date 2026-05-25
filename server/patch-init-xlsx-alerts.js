'use strict';

/**
 * 将预警演示字段写回 初始数据.xlsx（可选运行，便于离线分发初始化文件）
 * 用法：node server/patch-init-xlsx-alerts.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { loadBrowserScripts } = require('./load-modules');
const alertDemo = require('./alert-demo-seed');

const ROOT = path.join(__dirname, '..');
const INIT_XLSX = path.join(ROOT, '初始数据.xlsx');

function resolveInitXlsx() {
  const env = process.env.PTRACK_INIT_XLSX;
  const candidates = [
    env && path.isAbsolute(env) ? env : env && path.join(ROOT, env),
    INIT_XLSX
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function colIndexByKey(fields, colMap, key) {
  for (let i = 0; i < fields.length; i++) {
    if (colMap[fields[i].col] === key) return i;
  }
  return -1;
}

function main() {
  const xlsxPath = resolveInitXlsx();
  if (!xlsxPath) {
    console.error('[patch-init-xlsx-alerts] 未找到 初始数据.xlsx');
    process.exit(1);
  }

  const modules = loadBrowserScripts();
  const { FieldConfig, FormulaEngine } = modules;
  const reportingMonth = '2026-05';
  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth);
  const fields = FieldConfig.buildFieldConfig();
  const colMap = FieldConfig.COL_TO_KEY;

  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 3) {
    console.error('[patch-init-xlsx-alerts] 工作表行数不足');
    process.exit(1);
  }

  let headerRowIdx = 1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some(v => v && String(v).includes('项目号'))) {
      headerRowIdx = i;
      break;
    }
  }
  const dataStartIdx = headerRowIdx + 1;

  const projectNoCol = colIndexByKey(fields, colMap, 'project_no');
  if (projectNoCol < 0) {
    console.error('[patch-init-xlsx-alerts] 未找到项目号列');
    process.exit(1);
  }

  const flatProjects = [];
  const rowIndexes = [];
  for (let ri = dataStartIdx; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || row.every(v => v === null || v === '')) continue;
    const p = {};
    fields.forEach((f, colIdx) => {
      const key = colMap[f.col];
      if (!key) return;
      p[key] = row[colIdx] !== undefined ? row[colIdx] : '';
    });
    const merged = FieldConfig.flatToArrays(p);
    if (!merged.project_no) continue;
    flatProjects.push(merged);
    rowIndexes.push(ri);
  }

  const patched = alertDemo.applyAlertDemoPatches(flatProjects, modules, reportingMonth);
  const byNo = new Map(patched.map(p => [p.project_no, p]));

  const keysWritten = new Set();
  patched.forEach(function (p) {
    if (!Object.values(alertDemo.ALERT_DEMO_PROJECTS).includes(p.project_no)) return;
    keysWritten.add(p.project_no);
  });

  rowIndexes.forEach(function (ri, idx) {
    const orig = flatProjects[idx];
    const p = byNo.get(orig.project_no);
    if (!p) return;
    const flat = FieldConfig.arraysToFlat(Object.assign({}, p));
    fields.forEach((f, colIdx) => {
      const key = colMap[f.col];
      if (!key || flat[key] === undefined) return;
      let val = flat[key];
      if (key.startsWith('mc_') || key.startsWith('mi_') || key.startsWith('mp_')) {
        val = Number(val) || 0;
      }
      rows[ri][colIdx] = val;
    });
  });

  const newWs = XLSX.utils.aoa_to_sheet(rows);
  wb.Sheets[sheetName] = newWs;
  XLSX.writeFile(wb, xlsxPath);

  console.log('[patch-init-xlsx-alerts] 已更新', xlsxPath);
  console.log('[patch-init-xlsx-alerts] 预警演示项目:', alertDemo.ALERT_DEMO_PROJECTS);
  console.log('[patch-init-xlsx-alerts] 已写入行:', Array.from(keysWritten).join(', '));
}

main();
