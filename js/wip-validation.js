/**
 * wip-validation.js — WIP 催开票必填校验与联动清空
 * AL（wip_pending_invoice）非零时，AM/AO 必填；AL 变为零时清空 AM/AN/AO。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WipValidation = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var EPS = 0.005;
  var WIP_PENDING_KEY = 'wip_pending_invoice';
  var WIP_CAUSE_KEY = 'wip_cause';
  var WIP_CAUSE_DESC_KEY = 'cause_desc';
  var HIGH_RISK_WIP_KEY = 'high_risk_wip';

  function parseAmount(value) {
    if (value == null || value === '') return 0;
    var n = Number(String(value).replace(/,/g, '').trim());
    return isNaN(n) ? 0 : n;
  }

  function isNonZero(value) {
    return Math.abs(parseAmount(value)) >= EPS;
  }

  function isBlank(value) {
    return value == null || String(value).trim() === '';
  }

  function normalizeProject(project) {
    return project || {};
  }

  function listSubmitViolations(projects) {
    return (projects || []).map(normalizeProject).filter(function (p) {
      return isNonZero(p[WIP_PENDING_KEY])
        && (isBlank(p[WIP_CAUSE_KEY]) || isBlank(p[HIGH_RISK_WIP_KEY]));
    }).map(function (p) {
      return {
        project_no: p.project_no,
        project_name: p.project_name,
        wip_pending_invoice: parseAmount(p[WIP_PENDING_KEY]),
        missing_cause: isBlank(p[WIP_CAUSE_KEY]),
        missing_high_risk: isBlank(p[HIGH_RISK_WIP_KEY])
      };
    });
  }

  function validateProjectsForSubmit(projects) {
    var violations = listSubmitViolations(projects);
    if (!violations.length) return { ok: true, violations: [] };
    var sample = violations.slice(0, 3).map(function (v) {
      return v.project_no + (v.project_name ? '（' + v.project_name + '）' : '');
    }).join('、');
    var suffix = violations.length > 3 ? ' 等' : '';
    return {
      ok: false,
      violations: violations,
      message: '有 ' + violations.length + ' 个项目 WIP催开票非零，但 WIP形成原因或高风险WIP为空，请补充后再提交。'
        + (sample ? ' 例如：' + sample + suffix : '')
    };
  }

  function clearAnalysisFields(project) {
    var out = Object.assign({}, normalizeProject(project));
    out[WIP_CAUSE_KEY] = '';
    out[WIP_CAUSE_DESC_KEY] = '';
    out[HIGH_RISK_WIP_KEY] = '';
    return out;
  }

  function applyPendingInvoiceWipChange(project, nextPendingInvoiceWip) {
    var out = Object.assign({}, normalizeProject(project));
    out[WIP_PENDING_KEY] = nextPendingInvoiceWip;
    if (!isNonZero(nextPendingInvoiceWip)) {
      return { project: clearAnalysisFields(out), changed: true };
    }
    return { project: out, changed: false };
  }

  function clearWhenPendingInvoiceWipBecomesZero(previousProject, nextProject) {
    var prev = normalizeProject(previousProject);
    var next = normalizeProject(nextProject);
    if (!isNonZero(prev[WIP_PENDING_KEY]) || isNonZero(next[WIP_PENDING_KEY])) {
      return { project: Object.assign({}, next), changed: false };
    }
    return { project: clearAnalysisFields(next), changed: true };
  }

  return {
    WIP_PENDING_KEY: WIP_PENDING_KEY,
    WIP_CAUSE_KEY: WIP_CAUSE_KEY,
    WIP_CAUSE_DESC_KEY: WIP_CAUSE_DESC_KEY,
    HIGH_RISK_WIP_KEY: HIGH_RISK_WIP_KEY,
    isNonZero: isNonZero,
    listSubmitViolations: listSubmitViolations,
    validateProjectsForSubmit: validateProjectsForSubmit,
    applyPendingInvoiceWipChange: applyPendingInvoiceWipChange,
    clearWhenPendingInvoiceWipBecomesZero: clearWhenPendingInvoiceWipBecomesZero
  };
});
