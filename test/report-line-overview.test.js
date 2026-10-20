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

test('buildCompletionRank 过滤近零金额、最多取前 8、负值按从高到低', () => {
  const mod = loadOverviewModule();
  const projects = [
    { projectNo: 'Z', projectName: '零元', pmName: '甲', monthCompletion: 0 },
    { projectNo: 'N', projectName: '近零', pmName: '乙', monthCompletion: 49 },
    { projectNo: 'A', projectName: '高', pmName: '丙', monthCompletion: 500000 },
    { projectNo: 'B', projectName: '中', pmName: '丁', monthCompletion: 200000 },
    { projectNo: 'C', projectName: '负', pmName: '戊', monthCompletion: -100000 },
    { projectNo: 'D', projectName: '刚过阈', pmName: '己', monthCompletion: 50 },
    { projectNo: 'E', projectName: '五', pmName: '庚', monthCompletion: 90000 },
    { projectNo: 'F', projectName: '六', pmName: '辛', monthCompletion: 80000 },
    { projectNo: 'G', projectName: '七', pmName: '壬', monthCompletion: 70000 },
    { projectNo: 'H', projectName: '八', pmName: '癸', monthCompletion: 60000 },
    { projectNo: 'I', projectName: '九', pmName: '子', monthCompletion: 55000 }
  ];
  const ranked = mod.buildCompletionRank(projects, 8);
  assert.equal(ranked.length, 8);
  assert.deepEqual(ranked.map((r) => r.projectNo), ['A', 'B', 'E', 'F', 'G', 'H', 'I', 'D']);
  assert.ok(!ranked.some((r) => r.projectNo === 'Z' || r.projectNo === 'N' || r.projectNo === 'C'));
  const withNeg = mod.buildCompletionRank([
    { projectNo: 'P', projectName: '正', pmName: '甲', monthCompletion: 100 },
    { projectNo: 'N', projectName: '负大', pmName: '乙', monthCompletion: -500 },
    { projectNo: 'M', projectName: '负小', pmName: '丙', monthCompletion: -100 },
    { projectNo: 'Z', projectName: '近零负', pmName: '丁', monthCompletion: -49 }
  ], 8);
  assert.deepEqual(withNeg.map((r) => r.projectNo), ['P', 'M', 'N']);
});

function tileNos(result) {
  return result.tiles.filter((t) => t.kind === 'project').map((t) => t.projectNo);
}

test('buildCompletionTreemap 低于最大块 15% 的并入其他项目，近零不进块，净额决定正负', () => {
  const mod = loadOverviewModule();
  const result = mod.buildCompletionTreemap([
    { projectNo: 'A', projectName: '最大', pmName: '甲', monthCompletion: 1000000 },
    { projectNo: 'B', projectName: '二梯队', pmName: '乙', monthCompletion: 200000 },
    { projectNo: 'C', projectName: '长尾正', pmName: '丙', monthCompletion: 100000 },
    { projectNo: 'D', projectName: '长尾负', pmName: '丁', monthCompletion: -100000 },
    { projectNo: 'E', projectName: '大负', pmName: '戊', monthCompletion: -200000 },
    { projectNo: 'Z', projectName: '近零', pmName: '己', monthCompletion: 49 },
    { projectNo: 'Y', projectName: '近零负', pmName: '庚', monthCompletion: -10 }
  ]);
  assert.equal(tileNos(result).join(','), 'A,B,E');
  // C+100000 与 D-100000 净额近零，不画「其他项目」
  assert.equal(result.tiles.some((t) => t.kind === 'other'), false);
  assert.equal(result.nearZeroCount, 2);
  const bigNeg = result.tiles.find((t) => t.projectNo === 'E');
  assert.equal(bigNeg.monthCompletion, -200000);

  const netPos = mod.buildCompletionTreemap([
    { projectNo: 'A', projectName: '最大', pmName: '甲', monthCompletion: 1000000 },
    { projectNo: 'C', projectName: '长尾正', pmName: '丙', monthCompletion: 100000 },
    { projectNo: 'D', projectName: '长尾负小', pmName: '丁', monthCompletion: -30000 }
  ]);
  const otherPos = netPos.tiles.find((t) => t.kind === 'other');
  assert.equal(otherPos.label, '其他项目');
  assert.equal(otherPos.count, 2);
  assert.equal(otherPos.monthCompletion, 70000);
  assert.equal(otherPos.projectNos.join(','), 'C,D');

  const netNeg = mod.buildCompletionTreemap([
    { projectNo: 'A', projectName: '最大', pmName: '甲', monthCompletion: 1000000 },
    { projectNo: 'C', projectName: '长尾正小', pmName: '丙', monthCompletion: 30000 },
    { projectNo: 'D', projectName: '长尾负', pmName: '丁', monthCompletion: -100000 }
  ]);
  assert.equal(netNeg.tiles.find((t) => t.kind === 'other').monthCompletion, -70000);
});
test('buildCompletionTreemap 单独成块最多 12，其余并入其他项目', () => {
  const mod = loadOverviewModule();
  const projects = [];
  for (let i = 0; i < 14; i++) {
    projects.push({
      projectNo: 'P' + i,
      projectName: '项' + i,
      pmName: '甲',
      monthCompletion: 100000
    });
  }
  const result = mod.buildCompletionTreemap(projects);
  assert.equal(tileNos(result).length, 12);
  const other = result.tiles.find((t) => t.kind === 'other');
  assert.equal(other.label, '其他项目');
  assert.equal(other.count, 2);
  assert.equal(other.monthCompletion, 200000);
  assert.equal(result.nearZeroCount, 0);
});

test('buildCompletionTreemap 没有非近零项目时不画块', () => {
  const mod = loadOverviewModule();
  const empty = mod.buildCompletionTreemap([]);
  assert.equal(empty.tiles.length, 0);
  assert.equal(empty.nearZeroCount, 0);
  const zeros = mod.buildCompletionTreemap([
    { projectNo: 'Z', projectName: '零', pmName: '甲', monthCompletion: 0 },
    { projectNo: 'N', projectName: '近', pmName: '乙', monthCompletion: -49 }
  ]);
  assert.equal(zeros.tiles.length, 0);
  assert.equal(zeros.nearZeroCount, 2);
});

test('buildAlertTypeRank 按条数降序，条数相同按六类固定顺序，零不出现', () => {
  const mod = loadOverviewModule();
  const items = [
    { type: 'hours_no_completion', label: '有工时无完成额' },
    { type: 'completion_no_hours', label: '有完成额无工时' },
    { type: 'hours_no_completion', label: '有工时无完成额' },
    { type: 'invoice_exceeds_contract', label: '累计开票超总合同额' },
    { type: 'payment_exceeds_invoice', label: '累计回款超累计开票' },
    { type: 'invoice_exceeds_contract', label: '累计开票超总合同额' },
    { type: 'completion_no_hours', label: '有完成额无工时' }
  ];
  const ranked = mod.buildAlertTypeRank(items);
  assert.equal(
    ranked.map((r) => r.label + ':' + r.count).join('|'),
    '累计开票超总合同额:2|有完成额无工时:2|有工时无完成额:2|累计回款超累计开票:1'
  );
  assert.ok(!ranked.some((r) => r.label === '累计回款超总合同额' || r.label === '存量合同额为负'));
  assert.equal(mod.buildAlertTypeRank([]).length, 0);
});
