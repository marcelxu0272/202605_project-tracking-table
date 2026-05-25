'use strict';

const path = require('path');
const { loadBrowserScripts } = require('./load-modules');
const dbm = require('./db');
const {
  DEFAULT_INIT_XLSX,
  exportProjectsToInitXlsx,
  loadProjectsFromDb
} = require('./init-xlsx-export');

const db = dbm.openDb();
const modules = loadBrowserScripts();
const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INIT_XLSX;

const projects = loadProjectsFromDb(db);
if (!projects.length) {
  console.error('[export-init-xlsx] 项目库为空，无法导出');
  process.exit(1);
}

const result = exportProjectsToInitXlsx(projects, outPath, modules, reportingMonth);
console.log('[export-init-xlsx] 已写入', result.path, '（', result.count, '条，Sheet', result.sheetName, '）');
