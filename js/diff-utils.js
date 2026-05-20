/**
 * diff-utils.js — 项目集字段级 diff（填报/审批共用）
 */
(function (window) {
  'use strict';

  function fieldValuesDiffer(leftVal, rightVal, dataType) {
    if (dataType === '金额' || dataType === '比率') {
      return Math.abs((Number(leftVal) || 0) - (Number(rightVal) || 0)) > 1e-6;
    }
    return String(leftVal == null ? '' : leftVal) !== String(rightVal == null ? '' : rightVal);
  }

  function diffProjectSets(leftProjects, rightProjects, compareFields) {
    const results = [];
    const rightList = rightProjects || [];
    const leftList = leftProjects || [];
    rightList.forEach(function (rp) {
      const lp = leftList.find(function (p) { return p.project_no === rp.project_no; });
      const rowDiffs = [];
      if (!lp) {
        rowDiffs.push({ field: '项目', leftVal: '—', rightVal: rp.project_name || '—' });
      } else {
        const lFlat = FieldConfig.arraysToFlat(lp);
        const rFlat = FieldConfig.arraysToFlat(rp);
        (compareFields || []).forEach(function (f) {
          const key = FieldConfig.COL_TO_KEY[f.col];
          if (!key) return;
          const lv = lFlat[key];
          const rv = rFlat[key];
          if (fieldValuesDiffer(lv, rv, f.data_type)) {
            rowDiffs.push({
              field: f.name_cn,
              leftVal: Formatters.formatByType(lv, f.data_type),
              rightVal: Formatters.formatByType(rv, f.data_type)
            });
          }
        });
      }
      if (rowDiffs.length > 0) {
        results.push({
          projectNo: rp.project_no,
          projectName: rp.project_name,
          diffs: rowDiffs
        });
      }
    });
    return results;
  }

  window.DiffUtils = {
    fieldValuesDiffer,
    diffProjectSets
  };
})(window);
