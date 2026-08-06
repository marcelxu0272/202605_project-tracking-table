/**
 * project-alerts.js — 项目预警标签（Drawer / 筛选等）
 */
(function (window) {
  'use strict';

  var EPS_AMOUNT = 0.005;
  var EPS_HOURS = 0.05;

  function monthCompletionAmount(project, monthIdx) {
    if (!project || monthIdx == null || monthIdx < 0) return 0;
    var flat = window.FieldConfig ? FieldConfig.arraysToFlat(project) : project;
    return Number(flat['mc_' + monthIdx]) || 0;
  }

  function monthApprovedCost(timesheetStats, monthIdx) {
    if (!timesheetStats || timesheetStats.empty || monthIdx == null || monthIdx < 0) return 0;
    var matrix = timesheetStats.byProfession;
    if (!matrix || !matrix.rows || !matrix.rows.length) return 0;
    var totalRow = null;
    for (var i = 0; i < matrix.rows.length; i++) {
      if (matrix.rows[i].isTotal) {
        totalRow = matrix.rows[i];
        break;
      }
    }
    if (!totalRow || !totalRow.months || !totalRow.months[monthIdx]) return 0;
    return Number(totalRow.months[monthIdx].cost) || 0;
  }

  function monthApprovedHours(timesheetStats, monthIdx) {
    if (!timesheetStats || timesheetStats.empty || monthIdx == null || monthIdx < 0) return 0;
    var matrix = timesheetStats.byProfession;
    if (!matrix || !matrix.rows || !matrix.rows.length) return 0;
    var totalRow = null;
    for (var i = 0; i < matrix.rows.length; i++) {
      if (matrix.rows[i].isTotal) {
        totalRow = matrix.rows[i];
        break;
      }
    }
    if (!totalRow || !totalRow.months || !totalRow.months[monthIdx]) return 0;
    return Number(totalRow.months[monthIdx].hours) || 0;
  }

  function hasCompletionNoHours(project, monthIdx, timesheetStats) {
    var completion = monthCompletionAmount(project, monthIdx);
    var hours = monthApprovedHours(timesheetStats, monthIdx);
    return completion > EPS_AMOUNT && hours < EPS_HOURS;
  }

  function hasHoursNoCompletion(project, monthIdx, timesheetStats) {
    var completion = monthCompletionAmount(project, monthIdx);
    var hours = monthApprovedHours(timesheetStats, monthIdx);
    return hours > EPS_HOURS && completion < EPS_AMOUNT;
  }

  /**
   * @param {object} project
   * @param {number} monthIdx - 报告月索引 0–11
   * @param {object|null} timesheetStats - buildTimesheetStats 返回值
   * @param {{ timesheetReady?: boolean }} [options]
   * @returns {Array<{ id: string, label: string }>}
   */
  function getProjectAlerts(project, monthIdx, timesheetStats, options) {
    options = options || {};
    var alerts = [];
    if (!project) return alerts;

    if (window.StockValidation) {
      if (StockValidation.hasInvoiceExceedsContract(project, monthIdx)) {
        alerts.push({ id: 'invoice_exceeds_contract', label: '累计开票超总合同额' });
      }
      if (StockValidation.hasPaymentExceedsContract(project, monthIdx)) {
        alerts.push({ id: 'payment_exceeds_contract', label: '累计回款超总合同额' });
      }
      if (StockValidation.hasPaymentExceedsInvoice(project, monthIdx)) {
        alerts.push({ id: 'payment_exceeds_invoice', label: '累计回款超累计开票' });
      }
      if (StockValidation.hasContractStockViolation(project, monthIdx)) {
        alerts.push({ id: 'contract_stock_negative', label: '存量合同额为负' });
      }
    }

    if (options.timesheetReady) {
      if (hasCompletionNoHours(project, monthIdx, timesheetStats)) {
        alerts.push({ id: 'completion_no_hours', label: '有完成额无工时' });
      }
      if (hasHoursNoCompletion(project, monthIdx, timesheetStats)) {
        alerts.push({ id: 'hours_no_completion', label: '有工时无完成额' });
      }
    }

    return alerts;
  }

  function hasAnyAlert(project, monthIdx, timesheetStats, options) {
    return getProjectAlerts(project, monthIdx, timesheetStats, options).length > 0;
  }

  /** 截止上月（不含报告月）始累完成合同额 = T + Σ(1月..报告月前一月) */
  function cumCompletedBeforeMonth(project, monthIdx, flatOverride) {
    if (!project || monthIdx == null || monthIdx < 0) return 0;
    var flat = flatOverride || (window.FieldConfig ? FieldConfig.arraysToFlat(project) : project);
    var prev = Number(flat.prev_year_completion) || 0;
    var sum = 0;
    for (var i = 0; i < monthIdx; i++) {
      sum += Number(flat['mc_' + i]) || 0;
    }
    return prev + sum;
  }

  function projectTotalContract(project, flatOverride) {
    if (!project) return 0;
    var flat = flatOverride || (window.FieldConfig ? FieldConfig.arraysToFlat(project) : project);
    return Number(flat.total_contract) || 0;
  }

  /**
   * Drawer 完成额填报辅助参考（报告月聚焦时展示）
   * @param {object} project
   * @param {number} monthIdx
   * @param {object|null} timesheetStats
   * @param {object} [flatOverride] - 当前 draft 扁平字段
   */
  function getCompletionFillAux(project, monthIdx, timesheetStats, flatOverride) {
    return {
      totalContract: projectTotalContract(project, flatOverride),
      cumCompletedBeforeMonth: cumCompletedBeforeMonth(project, monthIdx, flatOverride),
      monthHours: monthApprovedHours(timesheetStats, monthIdx),
      monthLaborCost: monthApprovedCost(timesheetStats, monthIdx),
      timesheetReady: !!(timesheetStats && !timesheetStats.empty)
    };
  }

  window.ProjectAlerts = {
    EPS_AMOUNT: EPS_AMOUNT,
    EPS_HOURS: EPS_HOURS,
    monthCompletionAmount: monthCompletionAmount,
    monthApprovedHours: monthApprovedHours,
    monthApprovedCost: monthApprovedCost,
    cumCompletedBeforeMonth: cumCompletedBeforeMonth,
    projectTotalContract: projectTotalContract,
    getCompletionFillAux: getCompletionFillAux,
    getProjectAlerts: getProjectAlerts,
    hasAnyAlert: hasAnyAlert
  };
})(window);
