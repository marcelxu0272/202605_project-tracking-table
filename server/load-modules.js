/**
 * 在 Node 中通过 vm 加载 fields-data / formula-engine / field-config（与浏览器同源）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const fieldDict = require('./fields/dictionary');

function loadBrowserScripts() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);

  const files = [
    fieldDict.FIELDS_DATA_JS,
    path.join(ROOT, 'js', 'formula-engine.js'),
    path.join(ROOT, 'js', 'field-config.js'),
    path.join(ROOT, 'js', 'system-ref-meta.js'),
    path.join(ROOT, 'js', 'new-existing-ref.js'),
    path.join(ROOT, 'js', 'stock-validation.js'),
    path.join(ROOT, 'js', 'project-alerts.js')
  ];

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, ctx, { filename: file });
  }

  return {
    FieldConfig: ctx.FieldConfig,
    FormulaEngine: ctx.FormulaEngine,
    SystemRefMeta: ctx.SystemRefMeta,
    NewExistingRef: ctx.NewExistingRef,
    FIELD_DICTIONARY: ctx.FIELD_DICTIONARY,
    StockValidation: ctx.StockValidation,
    ProjectAlerts: ctx.ProjectAlerts
  };
}

module.exports = { loadBrowserScripts };
