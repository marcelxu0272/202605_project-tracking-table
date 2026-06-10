const test = require('node:test');
const assert = require('node:assert/strict');

const WipValidation = require('../js/wip-validation');

test('requires WIP cause and high-risk flag when pending invoice WIP is non-zero', () => {
  const check = WipValidation.validateProjectsForSubmit([
    {
      project_no: 'P-001',
      project_name: '测试项目',
      wip_pending_invoice: 12.3,
      wip_cause: '',
      high_risk_wip: ''
    }
  ]);

  assert.equal(check.ok, false);
  assert.equal(check.violations.length, 1);
  assert.match(check.message, /WIP形成原因/);
  assert.match(check.message, /高风险WIP/);
});

test('clears WIP analysis fields when pending invoice WIP becomes zero', () => {
  const project = {
    wip_pending_invoice: 99,
    wip_cause: 'D、其它原因',
    cause_desc: '等待客户确认',
    high_risk_wip: '是'
  };

  const result = WipValidation.applyPendingInvoiceWipChange(project, 0);

  assert.equal(result.changed, true);
  assert.equal(result.project.wip_pending_invoice, 0);
  assert.equal(result.project.wip_cause, '');
  assert.equal(result.project.cause_desc, '');
  assert.equal(result.project.high_risk_wip, '');
});
