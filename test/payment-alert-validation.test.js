'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../server/load-modules');

describe('payment / invoice exceed contract alerts', () => {
  const { StockValidation, FormulaEngine } = loadBrowserScripts();
  const monthIdx = 4;

  function baseProject(overrides) {
    return Object.assign({
      project_no: 'TEST-001',
      prev_year_contract: 10000,
      adj_value: 0,
      prev_year_completion: 0,
      prev_year_invoice: 0,
      prev_year_payment: 0,
      monthly_completion: Array(12).fill(0),
      monthly_invoice: Array(12).fill(0),
      monthly_payment: Array(12).fill(0),
      tax_rate: 0.09
    }, overrides || {});
  }

  it('invoice_exceeds_contract when cum_invoice > total_contract', () => {
    const p = baseProject({ prev_year_invoice: 12000 });
    assert.equal(StockValidation.hasInvoiceExceedsContract(p, monthIdx), true);
    assert.equal(StockValidation.hasInvoiceStockWarning(p, monthIdx), true);
  });

  it('payment_exceeds_contract when cum_payment > total_contract', () => {
    const p = baseProject({ prev_year_payment: 11000 });
    assert.equal(StockValidation.hasPaymentExceedsContract(p, monthIdx), true);
    assert.equal(StockValidation.hasPaymentExceedsInvoice(p, monthIdx), true);
  });

  it('payment_exceeds_invoice when cum_payment > cum_invoice but under contract', () => {
    const p = baseProject({
      prev_year_invoice: 6000,
      prev_year_payment: 8000
    });
    const computed = FormulaEngine.compute(p, monthIdx);
    assert.equal(StockValidation.hasPaymentExceedsInvoice(p, monthIdx), true);
    assert.equal(StockValidation.hasPaymentExceedsContract(p, monthIdx), false);
    assert.equal(computed.cum_payment > computed.cum_invoice, true);
  });

  it('no payment alerts when within contract and invoice', () => {
    const p = baseProject({
      prev_year_invoice: 5000,
      prev_year_payment: 4000
    });
    assert.equal(StockValidation.hasInvoiceExceedsContract(p, monthIdx), false);
    assert.equal(StockValidation.hasPaymentExceedsContract(p, monthIdx), false);
    assert.equal(StockValidation.hasPaymentExceedsInvoice(p, monthIdx), false);
  });
});
