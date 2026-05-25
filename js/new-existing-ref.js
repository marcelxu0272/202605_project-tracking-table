/**
 * new-existing-ref.js — A 列「新/旧项目」系统引用值判定与年末 rollover
 */
(function (window) {
  'use strict';

  var REF_KEY = 'new_existing';
  var NEW_LABEL = '新项目';
  var OLD_LABEL = '旧项目';

  function reportingYearFromMonth(reportingMonth) {
    return Number(String(reportingMonth || '').slice(0, 4)) || new Date().getFullYear();
  }

  function normalizeLabel(val) {
    if (val === NEW_LABEL || val === '新') return NEW_LABEL;
    return OLD_LABEL;
  }

  function buildRefEntry(value, syncedAt) {
    return {
      value: value,
      status: 'ok',
      syncedAt: syncedAt || new Date().toISOString()
    };
  }

  /** 平台同步新增项目：默认为当年新项目 */
  function applyPlatformInsertMeta(project, reportingYear, syncedAt) {
    project._new_existing_year = reportingYear;
    project.new_existing = NEW_LABEL;
    if (!project._system_ref) project._system_ref = {};
    project._system_ref[REF_KEY] = buildRefEntry(NEW_LABEL, syncedAt);
    return project;
  }

  /** 已有项目：按 _new_existing_year 与报告年更新引用快照（不改显示值） */
  function updateExistingRef(project, reportingYear, syncedAt) {
    if (!project._system_ref) project._system_ref = {};
    var val = project._new_existing_year === reportingYear ? NEW_LABEL : OLD_LABEL;
    project._system_ref[REF_KEY] = buildRefEntry(val, syncedAt);
    return project;
  }

  /** Excel 导入 / 初始化：从显示值写入引用快照 */
  function seedImportRefs(project, reportingYear, syncedAt) {
    if (!project._system_ref) project._system_ref = {};
    var display = normalizeLabel(project.new_existing);
    if (display === NEW_LABEL) {
      project._new_existing_year = reportingYear;
    } else {
      delete project._new_existing_year;
    }
    project._system_ref[REF_KEY] = buildRefEntry(display, syncedAt);
    return project;
  }

  /** 年末 rollover：全部引用值改为旧项目；未覆盖的显示值同步为旧项目 */
  function applyYearEndRolloverProject(project, syncedAt) {
    if (!project._system_ref) project._system_ref = {};
    project._system_ref[REF_KEY] = buildRefEntry(OLD_LABEL, syncedAt);
    delete project._new_existing_year;
    var overridden = project._system_override && project._system_override[REF_KEY];
    if (!overridden) project.new_existing = OLD_LABEL;
    return project;
  }

  function needsYearRollover(storedYear, reportingYear) {
    if (storedYear == null || storedYear === '') return false;
    return reportingYear > Number(storedYear);
  }

  window.NewExistingRef = {
    REF_KEY: REF_KEY,
    NEW_LABEL: NEW_LABEL,
    OLD_LABEL: OLD_LABEL,
    reportingYearFromMonth: reportingYearFromMonth,
    normalizeLabel: normalizeLabel,
    buildRefEntry: buildRefEntry,
    applyPlatformInsertMeta: applyPlatformInsertMeta,
    updateExistingRef: updateExistingRef,
    seedImportRefs: seedImportRefs,
    applyYearEndRolloverProject: applyYearEndRolloverProject,
    needsYearRollover: needsYearRollover
  };
})(window);
