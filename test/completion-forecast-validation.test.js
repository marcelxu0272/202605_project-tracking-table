const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
      compute(project, monthIdx) {
        const p = Object.assign({}, project);
        const mc = p.monthly_completion || Array(12).fill(0);
        p.total_contract = (p.prev_year_contract || 0) + (p.adj_value || 0);
        p.ytd_completed = mc.slice(0, monthIdx + 1).reduce((sum, val) => sum + (Number(val) || 0), 0);
        p.cum_completed = (p.prev_year_completion || 0) + p.ytd_completed;
        p.contract_minus_completed = p.total_contract - p.cum_completed;
        return p;
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

test('rejects future completion forecast when projected total exceeds contract', () => {
  const StockValidation = loadStockValidation();
  const project = {
    project_no: 'P-001',
    prev_year_contract: 1000,
    prev_year_completion: 700,
    monthly_completion: [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  const result = StockValidation.validateCompletionEdit(
    project,
    { col: 'BA' },
    150,
    1
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /未来月份预测完成额/);
});

test('rejects submit when existing future forecasts plus completed exceed contract', () => {
  const StockValidation = loadStockValidation();
  const result = StockValidation.validateProjectsForSubmit([
    {
      project_no: 'P-002',
      project_name: '合同核减项目',
      prev_year_contract: 900,
      prev_year_completion: 700,
      monthly_completion: [100, 100, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  ], 1, 'open');

  assert.equal(result.ok, false);
  assert.match(result.message, /未来月份预测完成额/);
  assert.match(result.message, /调整完成额/);
});

test('rejects negative completion in future months', () => {
  const StockValidation = loadStockValidation();
  const project = {
    project_no: 'P-003',
    prev_year_contract: 1200,
    prev_year_completion: 200,
    monthly_completion: [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
  const result = StockValidation.validateCompletionEdit(
    project,
    { col: 'BC' },
    -10,
    1
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /未来月份完成合同额/);
});

test('requires remark when current month completion is negative on submit', () => {
  const StockValidation = loadStockValidation();
  const result = StockValidation.validateProjectsForSubmit([
    {
      project_no: 'P-004',
      project_name: '负值项目',
      prev_year_contract: 1500,
      prev_year_completion: 200,
      monthly_completion: [100, -20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      completion_remark: ''
    }
  ], 1, 'open');
  assert.equal(result.ok, false);
  assert.match(result.message, /备注/);
});
