const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const validation = require('../server/completion-negative-validation');

function loadStockValidation() {
  const sandbox = {
    window: {},
    console,
    FieldConfig: {
      MC_COLS: ['AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG'],
      COL_TO_KEY: {
        AV: 'mc_0', AW: 'mc_1', AX: 'mc_2', AY: 'mc_3', AZ: 'mc_4', BA: 'mc_5',
        BB: 'mc_6', BC: 'mc_7', BD: 'mc_8', BE: 'mc_9', BF: 'mc_10', BG: 'mc_11'
      },
      arraysToFlat(project) {
        const p = Object.assign({}, project);
        (p.monthly_completion || []).forEach((v, i) => { p['mc_' + i] = v; });
        return p;
      },
      flatToArrays(flatProject) {
        const p = Object.assign({}, flatProject);
        p.monthly_completion = Array(12).fill(0).map((_, i) => p['mc_' + i] || 0);
        return p;
      },
      getMonthlyMonthIndex(col) {
        return this.MC_COLS.indexOf(col);
      }
    },
    FormulaEngine: {
      compute(project) {
        return Object.assign({}, project);
      }
    }
  };
  sandbox.window.FieldConfig = sandbox.FieldConfig;
  sandbox.window.FormulaEngine = sandbox.FormulaEngine;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'stock-validation.js'), 'utf8');
  vm.runInContext(source, sandbox);
  return sandbox.window.StockValidation;
}

test('allows negative completion in historical months without remark', () => {
  const check = validation.validateProjectCompletionRules({
    project_no: 'P-HIS',
    mc_0: -30,
    mc_1: 50,
    completion_remark: ''
  }, 1, { mode: 'submit' });
  assert.equal(check.ok, true);
});

test('save mode allows current month negative without remark', () => {
  const check = validation.validateProjectCompletionRules({
    project_no: 'P-CUR',
    mc_1: -20,
    completion_remark: ''
  }, 1, { mode: 'save' });
  assert.equal(check.ok, true);
});

test('submit mode requires remark for current month negative completion', () => {
  const check = validation.validateProjectCompletionRules({
    project_no: 'P-CUR',
    mc_1: -20,
    completion_remark: ''
  }, 1, { mode: 'submit' });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'current_completion_negative_missing_remark');
});

test('submit mode allows current month negative with remark', () => {
  const check = validation.validateProjectCompletionRules({
    project_no: 'P-CUR',
    mc_1: -20,
    completion_remark: '冲减上期误报'
  }, 1, { mode: 'submit' });
  assert.equal(check.ok, true);
});

test('rejects negative completion for future months in save mode', () => {
  const check = validation.validateProjectCompletionRules({
    project_no: 'P-FUT',
    mc_1: 10,
    mc_2: -1,
    completion_remark: '说明'
  }, 1, { mode: 'save' });
  assert.equal(check.ok, false);
  assert.equal(check.code, 'future_completion_negative');
});

test('shouldGuideNegativeRemark only when changing from non-negative to negative', () => {
  const StockValidation = loadStockValidation();
  assert.equal(
    StockValidation.shouldGuideNegativeRemark(10, -5, { col: 'AW' }, 1),
    true
  );
  assert.equal(
    StockValidation.shouldGuideNegativeRemark(-5, -8, { col: 'AW' }, 1),
    false
  );
  assert.equal(
    StockValidation.shouldGuideNegativeRemark(10, -5, { col: 'AV' }, 1),
    false
  );
  assert.equal(
    StockValidation.shouldGuideNegativeRemark('', -1, { col: 'AW' }, 1),
    true
  );
});
