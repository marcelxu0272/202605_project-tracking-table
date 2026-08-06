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
  const MSG_FORECAST_COMPLETION_EXCEEDS = '已完成额加未来月份预测完成额将超过总合同额。请调整完成额预测，或先完成 CRB 合同额变更后再填报。';
  const MSG_COMPLETION_NEGATIVE = '未来月份完成合同额（预测）不能小于 0。';
  const MSG_CURRENT_COMPLETION_NEGATIVE_REMARK = '当前月份完成合同额为负时，备注不能为空。';

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

  function totalContract(project) {
    var p = project || {};
    var n = Number(p.total_contract);
    if (!isNaN(n)) return n;
    return (Number(p.prev_year_contract) || 0) + (Number(p.adj_value) || 0);
  }

  function projectedCompletionTotal(project) {
    if (!project) return 0;
    var flat = window.FieldConfig ? FieldConfig.arraysToFlat(project) : Object.assign({}, project);
    var total = Number(flat.prev_year_completion) || 0;
    for (var i = 0; i < 12; i++) {
      total += Number(flat['mc_' + i]) || 0;
    }
    return total;
  }

  function hasProjectedCompletionViolation(project) {
    return projectedCompletionTotal(project) - totalContract(project) > EPS;
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

  /** 手工编辑完成额时实时校验，禁止保存后导致 S 列为负 */
  function validateCompletionEdit(project, field, newVal, monthIdx) {
    if (!isCompletionField(field)) return { ok: true };
    var amount = parseCompletionAmount(newVal);
    if (isNaN(amount)) {
      return { ok: false, message: '请输入有效的完成额金额。' };
    }
    if (!window.FieldConfig) return { ok: true };
    var flat = FieldConfig.arraysToFlat(project);
    var key = FieldConfig.COL_TO_KEY[field.col] || ('mc_' + monthIdx);
    var editMonthIdx = FieldConfig.getMonthlyMonthIndex(field.col);
    if (editMonthIdx > monthIdx && amount < -EPS) {
      return { ok: false, message: MSG_COMPLETION_NEGATIVE };
    }
    flat[key] = amount;
    var next = computeProject(FieldConfig.flatToArrays(flat), monthIdx);
    if (contractStock(next) < -EPS) {
      return { ok: false, message: MSG_COMPLETION_EXCEEDS };
    }
    if (hasProjectedCompletionViolation(next)) {
      return { ok: false, message: MSG_FORECAST_COMPLETION_EXCEEDS };
    }
    return { ok: true };
  }

  function validateNegativeCompletionRemark(project, monthIdx) {
    if (!project || !window.FieldConfig) return { ok: true };
    var flat = FieldConfig.arraysToFlat(project);
    var currentCompletion = Number(flat['mc_' + monthIdx]) || 0;
    if (currentCompletion >= -EPS) return { ok: true };
    var remark = String(flat.completion_remark || '').trim();
    if (remark) return { ok: true };
    return {
      ok: false,
      message: MSG_CURRENT_COMPLETION_NEGATIVE_REMARK,
      project_no: flat.project_no,
      project_name: flat.project_name
    };
  }

  /**
   * 仅当「当前月完成额本次由非负改为负」时返回 true，用于自动开抽屉/聚焦备注引导。
   * 已是负值时再次编辑不重复强弹。
   */
  function shouldGuideNegativeRemark(oldVal, newVal, field, monthIdx) {
    if (!isCompletionField(field) || !window.FieldConfig) return false;
    if (FieldConfig.getMonthlyMonthIndex(field.col) !== monthIdx) return false;
    var oldAmount = parseCompletionAmount(oldVal);
    if (isNaN(oldAmount)) oldAmount = 0;
    var newAmount = parseCompletionAmount(newVal);
    if (isNaN(newAmount)) return false;
    return oldAmount >= -EPS && newAmount < -EPS;
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

  function listProjectedCompletionViolations(projects, monthIdx) {
    return (projects || []).filter(function (p) {
      var computed = computeProject(p, monthIdx);
      return hasProjectedCompletionViolation(computed);
    }).map(function (p) {
      var computed = computeProject(p, monthIdx);
      return {
        project_no: p.project_no,
        project_name: p.project_name,
        total_contract: totalContract(computed),
        projected_completion_total: projectedCompletionTotal(computed)
      };
    });
  }

  function buildViolationMessage(count, violations, prefix) {
    const sample = violations.slice(0, 3).map(function (v) {
      return v.project_no + (v.project_name ? '（' + v.project_name + '）' : '');
    }).join('、');
    const suffix = count > 3 ? ' 等' : '';
    return prefix + (sample ? ' 例如：' + sample + suffix : '');
  }

  function validateProjectsForSubmit(projects, monthIdx, lockStatus) {
    var list = (projects || []).slice();
    var remarkViolations = list.map(function (p) {
      return validateNegativeCompletionRemark(p, monthIdx);
    }).filter(function (r) { return !r.ok; });
    if (remarkViolations.length) {
      var nRemark = remarkViolations.length;
      return {
        ok: false,
        violations: remarkViolations,
        message: buildViolationMessage(
          nRemark,
          remarkViolations,
          '有 ' + nRemark + ' 个项目当前月份完成合同额为负且未填写备注，请补充备注后再提交。'
        )
      };
    }
    const violations = listContractViolations(list, monthIdx);
    if (!violations.length) {
      const forecastViolations = listProjectedCompletionViolations(list, monthIdx);
      if (!forecastViolations.length) return { ok: true, violations: [] };
      const forecastN = forecastViolations.length;
      return {
        ok: false,
        violations: forecastViolations,
        message: buildViolationMessage(
          forecastN,
          forecastViolations,
          '有 ' + forecastN + ' 个项目已完成额加未来月份预测完成额超过总合同额，请调整完成额预测或完成 CRB 合同额变更后再提交。'
        )
      };
    }
    const n = violations.length;
    return {
      ok: false,
      violations: violations,
      message: buildViolationMessage(
        n,
        violations,
        '有 ' + n + ' 个项目存量合同额为负（累计完成已超过总合同额），请调减完成额或完成 CRB 合同变更后再提交。'
      )
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
    MSG_FORECAST_COMPLETION_EXCEEDS: MSG_FORECAST_COMPLETION_EXCEEDS,
    MSG_COMPLETION_NEGATIVE: MSG_COMPLETION_NEGATIVE,
    MSG_CURRENT_COMPLETION_NEGATIVE_REMARK: MSG_CURRENT_COMPLETION_NEGATIVE_REMARK,
    parseCompletionAmount: parseCompletionAmount,
    isCompletionField: isCompletionField,
    isStockColumn: isStockColumn,
    hasStockWarning: hasStockWarning,
    hasInvoiceStockWarning: hasInvoiceStockWarning,
    hasContractStockViolation: hasContractStockViolation,
    hasProjectedCompletionViolation: hasProjectedCompletionViolation,
    isStockWarningCell: isStockWarningCell,
    applyOpenPeriodStockHedge: applyOpenPeriodStockHedge,
    syncOpenPeriodStockHedge: syncOpenPeriodStockHedge,
    validateCompletionEdit: validateCompletionEdit,
    validateNegativeCompletionRemark: validateNegativeCompletionRemark,
    shouldGuideNegativeRemark: shouldGuideNegativeRemark,
    validateProjectsForSubmit: validateProjectsForSubmit,
    countWarnings: countWarnings,
    countContractViolations: countContractViolations,
    listContractViolations: listContractViolations,
    listProjectedCompletionViolations: listProjectedCompletionViolations,
    projectedCompletionTotal: projectedCompletionTotal
  };
})(window);
