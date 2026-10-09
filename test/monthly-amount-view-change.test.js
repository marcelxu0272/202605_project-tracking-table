const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../server/load-modules');

const { FieldConfig } = loadBrowserScripts();

test('有变化筛选只认三十六列月度金额', () => {
  const cols = FieldConfig.MONTHLY_AMOUNT_CHANGE_COLS;
  assert.equal(cols.length, 36);
  assert.equal(new Set(cols).size, 36);
  assert.deepEqual(cols.slice(0, 12), FieldConfig.MC_COLS);
  assert.deepEqual(cols.slice(12, 24), FieldConfig.MI_COLS);
  assert.deepEqual(cols.slice(24), FieldConfig.MP_COLS);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('CF'), false);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('AM'), false);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('AZ'), true);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('ce'), true);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('mc_11'), true);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('mi_4'), true);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('mp_0'), true);
  assert.equal(FieldConfig.isMonthlyAmountChangeToken('mc_12'), false);
});

test('仅备注或 WIP 变化的项目不进入有变化', () => {
  assert.equal(FieldConfig.projectHasMonthlyAmountChange({
    _changed_fields: ['CF', 'AM', 'M']
  }), false);
  assert.equal(FieldConfig.projectHasMonthlyAmountChange({
    _changed_fields: [],
    _field_change_log: { CF: [{ role: 'PM', old: '', value: '补记' }] }
  }), false);
  assert.equal(FieldConfig.projectHasMonthlyAmountChange({
    _changed_fields: ['AZ'],
    _field_change_log: {}
  }), true);
  assert.equal(FieldConfig.projectHasMonthlyAmountChange({
    _changed_fields: [],
    _field_change_log: { BH: [{ role: 'PM', old: '0', value: '100' }], CF: [] }
  }), true);
  assert.equal(FieldConfig.projectHasMonthlyAmountChange({
    _changed_fields: ['mc_4']
  }), true);
  assert.equal(FieldConfig.projectHasMonthlyAmountChange(null), false);
});
