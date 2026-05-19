/**
 * 在 Node 中通过 vm 加载 fields-data / formula-engine / field-config（与浏览器同源）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBrowserScripts() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);

  const files = [
    path.join(ROOT, 'fields-data.js'),
    path.join(ROOT, 'js', 'formula-engine.js'),
    path.join(ROOT, 'js', 'field-config.js')
  ];

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, ctx, { filename: file });
  }

  return {
    FieldConfig: ctx.FieldConfig,
    FormulaEngine: ctx.FormulaEngine,
    FIELD_DICTIONARY: ctx.FIELD_DICTIONARY
  };
}

module.exports = { loadBrowserScripts };
