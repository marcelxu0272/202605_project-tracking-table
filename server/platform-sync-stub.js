'use strict';

const fs = require('fs');
const path = require('path');
const { projectsFromXlsxBuffer } = require('./xlsx-seed');

const ROOT = path.join(__dirname, '..');

function resolveInitXlsx() {
  const env = process.env.PTRACK_INIT_XLSX;
  const candidates = [
    env && path.isAbsolute(env) ? env : env && path.join(ROOT, env),
    path.join(ROOT, '初始数据.xlsx'),
    path.join(ROOT, 'S520_金山中心_项目执行追踪详细数据2026年05月.xlsx')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** 按日期的确定性微调量（同日多次同步结果一致） */
function dayBumpOffset() {
  const d = new Date();
  return ((d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) % 5000) + 500;
}

/**
 * 开发期平台快照：优先读初始化 xlsx 作为「平台真值」；否则基于当前库克隆并微调当月开票/回款。
 * @param {import('better-sqlite3').Database} db
 * @param {{ FieldConfig: object, FormulaEngine: object }} modules
 * @param {string} reportingMonth
 */
function fetchPlatformSnapshot(db, modules, reportingMonth) {
  const { FormulaEngine } = modules;
  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');
  const xlsxPath = resolveInitXlsx();

  if (xlsxPath) {
    const buf = fs.readFileSync(xlsxPath);
    return projectsFromXlsxBuffer(buf, modules, reportingMonth);
  }

  const rows = db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all();
  const projects = rows.map(r => JSON.parse(r.payload));
  const bump = dayBumpOffset();

  return projects.map((p, i) => {
    const copy = JSON.parse(JSON.stringify(p));
    if (i % 7 !== 0) return copy;
    if (!copy.monthly_invoice) copy.monthly_invoice = Array(12).fill(0);
    if (!copy.monthly_payment) copy.monthly_payment = Array(12).fill(0);
    copy.monthly_invoice[monthIdx] = bump;
    copy.monthly_payment[monthIdx] = Math.round(bump * 0.85);
    copy['mi_' + monthIdx] = copy.monthly_invoice[monthIdx];
    copy['mp_' + monthIdx] = copy.monthly_payment[monthIdx];
    return copy;
  });
}

module.exports = { fetchPlatformSnapshot };
