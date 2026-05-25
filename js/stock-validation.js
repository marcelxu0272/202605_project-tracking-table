/**
 * stock-validation.js — R/S 存量列预警与完成额校验
 * R 存量开票额 (P-AC)：小于 0 为预警
 * S 存量合同额 (P-U)：小于 0 为违规；填报期可自动对冲，仅提交时阻断
 */
(function (window) {
  'use strict';

  const STOCK_WARNING_STYLE = {
    bg: '#fee2e2',
    fc: '#dc2626'
  };

  const MSG_COMPLETION_EXCEEDS = '累计完成额将超过总合同额（存量合同额将为负）。请调减完成额，或先在 CRB 办理合同额变更后再填报。';
  const MSG_COMPLETION_NEGATIVE = '月度完成额不能小于 0。';

  const EPS = 0.005;

  function parseCompletionAmount(val) {
    if (val == null || val === '') return 0;
    var n = Number(String(val).replace(/,/g, '').trim());
    return isNaN(n) ? NaN : n;
  }

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

  /**
   * 填报开放期：存量合同额为负时，将报告月完成额调减 S（可为负）使 S 归零
   * @returns {{ project: object, changed: boolean }}
   */
  function applyOpenPeriodStockHedge(project, monthIdx, lockStatus) {
    if (lockStatus !== 'open' || !project || !window.FieldConfig) {
      return { project: project, changed: false };
    }
    var computed = computeProject(project, monthIdx);
    var stock = contractStock(computed);
    if (stock >= -EPS) {
      return { project: project, changed: false };
    }
    var flat = FieldConfig.arraysToFlat(project);
    var key = 'mc_' + monthIdx;
    var nextMc = (Number(flat[key]) || 0) + stock;
    flat[key] = nextMc;
    var merged = FieldConfig.flatToArrays(flat);
    var out = Object.assign({}, project, flat);
    out.monthly_completion = merged.monthly_completion;
    return { project: computeProject(out, monthIdx), changed: true };
  }

  function syncOpenPeriodStockHedge(projects, monthIdx, lockStatus) {
    if (lockStatus !== 'open' || !projects || !projects.length) return false;
    var anyChanged = false;
    projects.forEach(function (p) {
      var r = applyOpenPeriodStockHedge(p, monthIdx, lockStatus);
      if (!r.changed) return;
      anyChanged = true;
      var key = 'mc_' + monthIdx;
      p[key] = r.project[key];
      p.monthly_completion = (r.project.monthly_completion || []).slice();
    });
    return anyChanged;
  }

  /** 编辑时仅校验数值格式；S 列约束仅在提交时校验（§2.7.1） */
  function validateCompletionEdit(project, field, newVal, monthIdx) {
    if (!isCompletionField(field)) return { ok: true };
    var amount = parseCompletionAmount(newVal);
    if (isNaN(amount)) {
      return { ok: false, message: '请输入有效的完成额金额。' };
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

  function validateProjectsForSubmit(projects, monthIdx, lockStatus) {
    var list = (projects || []).slice();
    if (lockStatus === 'open') {
      syncOpenPeriodStockHedge(list, monthIdx, lockStatus);
    }
    const violations = listContractViolations(list, monthIdx);
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
    MSG_COMPLETION_NEGATIVE: MSG_COMPLETION_NEGATIVE,
    parseCompletionAmount: parseCompletionAmount,
    isCompletionField: isCompletionField,
    isStockColumn: isStockColumn,
    hasStockWarning: hasStockWarning,
    hasInvoiceStockWarning: hasInvoiceStockWarning,
    hasContractStockViolation: hasContractStockViolation,
    isStockWarningCell: isStockWarningCell,
    applyOpenPeriodStockHedge: applyOpenPeriodStockHedge,
    syncOpenPeriodStockHedge: syncOpenPeriodStockHedge,
    validateCompletionEdit: validateCompletionEdit,
    validateProjectsForSubmit: validateProjectsForSubmit,
    countWarnings: countWarnings,
    countContractViolations: countContractViolations,
    listContractViolations: listContractViolations
  };
})(window);
