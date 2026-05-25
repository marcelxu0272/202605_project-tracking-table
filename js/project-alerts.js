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
      if (StockValidation.hasInvoiceStockWarning(project, monthIdx)) {
        alerts.push({ id: 'invoice_stock_negative', label: '存量开票额为负' });
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

  window.ProjectAlerts = {
    EPS_AMOUNT: EPS_AMOUNT,
    EPS_HOURS: EPS_HOURS,
    monthCompletionAmount: monthCompletionAmount,
    monthApprovedHours: monthApprovedHours,
    getProjectAlerts: getProjectAlerts,
    hasAnyAlert: hasAnyAlert
  };
})(window);
