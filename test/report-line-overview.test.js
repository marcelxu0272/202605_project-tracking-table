const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOverviewModule(extraContext) {
  const context = Object.assign({
    module: { exports: {} },
    exports: {},
    require,
    console,
    Number,
    Math,
    Date,
    isFinite
  }, extraContext || {});
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '../js/report-line-overview.js'), 'utf8');
  vm.runInContext(code, context);
  return context.module.exports;
}

function project(seed) {
  return Object.assign({
    project_no: 'P-1',
    project_name: '示例项目',
    pm_name: '张三',
    total_contract: 1000,
    contract_minus_completed: 200,
    contract_minus_invoice: 300,
    prev_year_completion: 100,
    prev_year_invoice: 80,
    prev_year_payment: 60,
    mc_0: 100,
    mc_1: 120,
    mi_0: 90,
    mi_1: 110,
    mp_0: 70,
    mp_1: 90
  }, seed || {});
}

test('KPI 按 monthIdx 切分本年累计与未来预测', () => {
  const mod = loadOverviewModule();
  const result = mod.buildOverview([project()], [project()], 0);
  const completion = result.kpis.find((item) => item.key === 'completion').values;
  assert.equal(completion.current, 100);
  assert.equal(completion.ytd, 100);
  assert.equal(completion.future, 120);
});

test('diffSummary 计算净变化与新增项目', () => {
  const mod = loadOverviewModule();
  const current = [
    project({ project_no: 'A', mc_0: 200, total_contract: 1200 }),
    project({ project_no: 'B', pm_name: '李四', mc_0: 50, total_contract: 500 })
  ];
  const baseline = [
    project({ project_no: 'A', mc_0: 120, total_contract: 1000 })
  ];
  const result = mod.buildOverview(current, baseline, 0);
  assert.equal(result.diffSummary.newProjects, 1);
  assert.ok(result.diffSummary.deltaYtdCompletion > 0);
  assert.ok(result.diffSummary.deltaContract > 0);
  assert.ok(result.diffSummary.topProjects.length > 0);
  assert.equal(result.diffSummary.topProjects[0].projectNo, 'A');
  assert.equal(result.diffSummary.topProjects[0].monthCompletion, 200);
  assert.equal(result.diffSummary.topProjects[0].totalContract, 1200);
  assert.equal(result.diffSummary.topProjects[0].monthInvoice, 90);
  assert.equal(result.diffSummary.topProjects[0].monthPayment, 70);
});

test('attention 同一项目多条预警逐条列出', () => {
  const ProjectAlerts = {
    getProjectAlerts: () => [
      { id: 'invoice_exceeds_contract', label: '累计开票超总合同额' },
      { id: 'payment_exceeds_invoice', label: '累计回款超累计开票' },
      { id: 'completion_no_hours', label: '有完成额无工时' }
    ]
  };
  const mod = loadOverviewModule({ ProjectAlerts });
  const result = mod.buildOverview([project({ project_no: 'A' })], [], 0);
  assert.equal(result.attention.total, 3);
  assert.equal(result.attention.counts.invoice_exceeds_contract, 1);
  assert.equal(result.attention.counts.completion_no_hours, 1);
  assert.equal(result.attention.items.filter((item) => item.projectNo === 'A').length, 3);
});

test('顶部指标相对上一期（baseline）计算趋势', () => {
  const mod = loadOverviewModule();
  const current = [
    project({
      project_no: 'A',
      mc_0: 200,
      mc_1: 80,
      contract_minus_completed: 150,
      contract_minus_invoice: 220
    })
  ];
  const baseline = [
    project({
      project_no: 'A',
      mc_0: 120,
      mc_1: 80,
      contract_minus_completed: 200,
      contract_minus_invoice: 300
    })
  ];
  const result = mod.buildOverview(current, baseline, 0);
  const completion = result.kpis.find((item) => item.key === 'completion');
  assert.equal(completion.values.current, 200);
  assert.equal(completion.values.deltaCurrent, 80);
  assert.equal(result.backlog.contractStock, 150);
  assert.equal(result.backlog.deltaContractStock, -50);
  assert.equal(result.backlog.invoiceStock, 220);
  assert.equal(result.backlog.deltaInvoiceStock, -80);
  assert.equal(result.backlog.fullYearForecastCompletion, 280);
  assert.equal(result.backlog.deltaFullYearForecastCompletion, 80);
});

test('无 baseline 时趋势为空', () => {
  const mod = loadOverviewModule();
  const result = mod.buildOverview([project()], [], 0);
  const completion = result.kpis.find((item) => item.key === 'completion');
  assert.equal(completion.values.deltaCurrent, null);
  assert.equal(result.backlog.deltaContractStock, null);
  assert.equal(result.backlog.deltaInvoiceStock, null);
  assert.equal(result.backlog.deltaFullYearForecastCompletion, null);
});

test('pmSummary 按项目经理分组并分别计算当月与本年累计占比', () => {
  const mod = loadOverviewModule();
  const result = mod.buildOverview([
    project({ project_no: 'A', pm_name: '张三', mc_0: 100, mc_1: 100 }),
    project({ project_no: 'B', pm_name: '李四', mc_0: 300, mc_1: 100 })
  ], [], 1);
  assert.equal(result.pmSummary.length, 2);
  const zhang = result.pmSummary.find((row) => row.pmName === '张三');
  const lisi = result.pmSummary.find((row) => row.pmName === '李四');
  assert.equal(zhang.sharePctCurrent, 0.5);
  assert.equal(lisi.sharePctCurrent, 0.5);
  assert.equal(zhang.sharePctYtd, 200 / 600);
  assert.equal(lisi.sharePctYtd, 400 / 600);
});
