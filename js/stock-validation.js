/**
 * stock-validation.js — R/S 存量列预警与完成额校验
 * R 存量开票额 (P-AC)：小于 0 为预警
 * S 存量合同额 (P-U)：小于 0 为违规，禁止继续调增完成额并阻断提交
 */
(function (window) {
  'use strict';

  const STOCK_WARNING_STYLE = {
    bg: '#fee2e2',
    fc: '#dc2626'
  };

  const MSG_COMPLETION_EXCEEDS = '累计完成额将超过总合同额（存量合同额将为负）。请调减完成额，或先在 CRB 办理合同额变更后再填报。';

  const EPS = 0.005;

  function computeProject(project, monthIdx) {
    if (!window.FormulaEngine) return project;
    return FormulaEngine.compute(project, monthIdx);
  }

  function isCompletionField(field) {
    if (!field || !window.FieldConfig) return false;
    return FieldConfig.MC_COLS.indexOf(field.col) >= 0;
  }

  function isStockColumn(field) {
    return field && (field.col === 'R' || field.col === 'S');
  }

  function invoiceStock(project) {
    return Number(project && project.contract_minus_invoice) || 0;
  }

  function contractStock(project) {
    return Number(project && project.contract_minus_completed) || 0;
  }

  function hasInvoiceStockWarning(project, monthIdx) {
    const p = computeProject(project, monthIdx);
    return invoiceStock(p) < -EPS;
  }

  function hasContractStockViolation(project, monthIdx) {
    const p = computeProject(project, monthIdx);
    return contractStock(p) < -EPS;
  }

  /** 项目是否命中预警筛选（R 或 S 为负） */
  function hasStockWarning(project, monthIdx) {
    return hasInvoiceStockWarning(project, monthIdx)
      || hasContractStockViolation(project, monthIdx);
  }

  function isStockWarningCell(project, field, monthIdx) {
    if (!field || !isStockColumn(field)) return false;
    const p = computeProject(project, monthIdx);
    if (field.col === 'R') return invoiceStock(p) < -EPS;
    if (field.col === 'S') return contractStock(p) < -EPS;
    return false;
  }

  function validateCompletionEdit(project, field, newVal, monthIdx) {
    if (!isCompletionField(field)) return { ok: true };
    const before = computeProject(project, monthIdx);
    const oldStock = contractStock(before);
    const flat = FieldConfig.arraysToFlat(project);
    const key = FieldConfig.COL_TO_KEY[field.col];
    flat[key] = newVal;
    const updated = FieldConfig.flatToArrays(flat);
    const recomputed = computeProject(updated, monthIdx);
    const newStock = contractStock(recomputed);
    if (newStock < -EPS && newStock < oldStock - EPS) {
      return { ok: false, message: MSG_COMPLETION_EXCEEDS };
    }
    return { ok: true };
  }

  function listContractViolations(projects, monthIdx) {
    return (projects || []).filter(function (p) {
      return hasContractStockViolation(p, monthIdx);
    }).map(function (p) {
      const computed = computeProject(p, monthIdx);
      return {
        project_no: p.project_no,
        project_name: p.project_name,
        contract_minus_completed: contractStock(computed)
      };
    });
  }

  function validateProjectsForSubmit(projects, monthIdx) {
    const violations = listContractViolations(projects, monthIdx);
    if (!violations.length) return { ok: true, violations: [] };
    const n = violations.length;
    const sample = violations.slice(0, 3).map(function (v) {
      return v.project_no + (v.project_name ? '（' + v.project_name + '）' : '');
    }).join('、');
    const suffix = n > 3 ? ' 等' : '';
    return {
      ok: false,
      violations: violations,
      message: '有 ' + n + ' 个项目存量合同额为负（累计完成已超过总合同额），请调减完成额或完成 CRB 合同变更后再提交。'
        + (sample ? ' 例如：' + sample + suffix : '')
    };
  }

  function countWarnings(projects, monthIdx) {
    return (projects || []).filter(function (p) {
      return hasStockWarning(p, monthIdx);
    }).length;
  }

  function countContractViolations(projects, monthIdx) {
    return listContractViolations(projects, monthIdx).length;
  }

  window.StockValidation = {
    STOCK_WARNING_STYLE: STOCK_WARNING_STYLE,
    MSG_COMPLETION_EXCEEDS: MSG_COMPLETION_EXCEEDS,
    isCompletionField: isCompletionField,
    isStockColumn: isStockColumn,
    hasStockWarning: hasStockWarning,
    hasInvoiceStockWarning: hasInvoiceStockWarning,
    hasContractStockViolation: hasContractStockViolation,
    isStockWarningCell: isStockWarningCell,
    validateCompletionEdit: validateCompletionEdit,
    validateProjectsForSubmit: validateProjectsForSubmit,
    countWarnings: countWarnings,
    countContractViolations: countContractViolations,
    listContractViolations: listContractViolations
  };
})(window);
