const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLayout() {
  const FieldConfig = {
    COL_TO_KEY: {
      P: 'total_contract',
      U: 'cum_completed',
      S: 'contract_minus_completed',
      AV: 'mc_0',
      AW: 'mc_1',
      BH: 'mi_0',
      BI: 'mp_0'
    },
    getSections(fields) {
      const sections = [];
      fields.forEach((field) => {
        let section = sections.find((item) => item.name === field.section);
        if (!section) {
          section = { name: field.section, fields: [] };
          sections.push(section);
        }
        section.fields.push(field);
      });
      return sections;
    },
    getMonthlyMonthIndex(col) {
      return { AV: 0, AW: 1, BH: 0, BI: 0 }[col];
    }
  };
  const context = { window: {}, FieldConfig, Set, Date, Number, Math, isFinite, isNaN };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../js/project-drawer-layout.js'), 'utf8'),
    context
  );
  return context.window.ProjectDrawerLayout;
}

test('computes drawer completion and future forecast metrics', () => {
  const layout = loadLayout();
  const metrics = layout.computeDrawerMetrics({
    total_contract: 1000,
    prev_year_completion: 425,
    contract_minus_completed: 375,
    mc_0: 200,
    mi_0: 150,
    mp_0: 100,
    mc_6: 30,
    mc_7: 40,
    mi_6: 20,
    mp_6: 10,
    start_date: '2026-01-10'
  }, 5, 2026);

  assert.equal(metrics.completionRate, 62.5);
  assert.equal(metrics.remainingContract, 375);
  assert.equal(metrics.elapsedMonths, 6);
  assert.equal(metrics.kpis[0].label, '完成合同额');
  assert.equal(metrics.kpis[0].forecast, 70);
  assert.equal(metrics.kpis[0].remaining, 730);
  assert.equal(metrics.kpis[1].forecast, 20);
  assert.equal(metrics.kpis[1].remaining, 830);
  assert.equal(metrics.kpis[2].forecast, 10);
  assert.equal(metrics.kpis[2].remaining, 890);
});

test('maps monthly fields to forecast and removes baseline duplicates from extended data', () => {
  const layout = loadLayout();
  const fields = [
    { col: 'P', section: '合同额', data_type: '金额' },
    { col: 'S', section: '存量指标', data_type: '金额' },
    { col: 'AV', section: '完成额统计与预测', data_type: '金额' },
    { col: 'BH', section: '开票与回款统计预测', data_type: '金额' },
    { col: 'BI', section: '开票与回款统计预测', data_type: '金额' }
  ];
  const result = layout.buildTabLayout(fields, () => false);

  assert.deepEqual(
    Array.from(result.baselineFields, (field) => field.col),
    ['S']
  );
  assert.ok(layout.RATE_CARD_METRIC_COLS.indexOf('P') >= 0);
  assert.ok(layout.RATE_CARD_METRIC_COLS.indexOf('U') >= 0);
  assert.equal(result.tabs.extended.length, 0);
  assert.equal(result.tabs.forecast[0].monthly.completion[0].col, 'AV');
  assert.equal(result.tabs.forecast[1].monthly.invoice[0].col, 'BH');
  assert.equal(result.tabs.forecast[1].monthly.payment[0].col, 'BI');
});
