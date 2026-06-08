/**
 * import-merge.js — 按项目号合并 Excel 导入数据（仅覆盖当前角色可编辑字段）
 */
(function (window) {
  'use strict';

  /**
   * @param {Object[]} importedProjects - XlsxImporter 解析结果
   * @param {Object[]} storeProjects - Store.projects
   * @param {Object} opts
   * @param {string} opts.role
   * @param {string} opts.lockStatus
   * @param {number} opts.monthIdx
   * @param {function(Object): boolean} [opts.scopeFilter] - 是否允许处理该导入行
   * @returns {{ updates: Object[], skipped: Object[], errors: Object[] }}
   */
  function mergeImportedProjects(importedProjects, storeProjects, opts) {
    const role = opts.role || '';
    const lockStatus = opts.lockStatus || 'open';
    const monthIdx = opts.monthIdx != null ? opts.monthIdx : 0;
    const scopeFilter = opts.scopeFilter || function () { return true; };
    const user = opts.user || { name: '—', role: opts.role || '' };
    const fields = FieldConfig.buildFieldConfig();
    const storeByNo = {};
    storeProjects.forEach(function (p) {
      if (p && p.project_no) storeByNo[p.project_no] = p;
    });

    const updates = [];
    const skipped = [];
    const errors = [];

    importedProjects.forEach(function (imp) {
      const projectNo = imp && imp.project_no;
      if (!projectNo) {
        skipped.push({ projectNo: '—', reason: '无项目号' });
        return;
      }
      if (!scopeFilter(imp)) {
        skipped.push({ projectNo: projectNo, reason: '不在当前填报范围' });
        return;
      }
      const existing = storeByNo[projectNo];
      if (!existing) {
        skipped.push({ projectNo: projectNo, reason: '库中无此项目' });
        return;
      }
      try {
        const flat = FieldConfig.arraysToFlat(existing);
        const impFlat = FieldConfig.arraysToFlat(imp);
        const tracking = window.ChangeMeta
          ? ChangeMeta.mergeChangeTracking(existing)
          : { _field_change_log: Object.assign({}, existing._field_change_log || {}), _changed_fields: (existing._changed_fields || []).slice() };
        const changeLog = tracking._field_change_log;
        let changed = false;

        fields.forEach(function (field) {
          if (!FieldConfig.canEdit(field, role, lockStatus, monthIdx)) return;
          const key = FieldConfig.COL_TO_KEY[field.col];
          if (!key) return;
          if (impFlat[key] === undefined) return;
          const newVal = impFlat[key];
          const oldVal = flat[key];
          if (newVal === oldVal || String(newVal) === String(oldVal)) return;
          flat[key] = newVal;
          changed = true;
          if (window.ChangeMeta) {
            ChangeMeta.recordFieldChangeLog(
              { _field_change_log: changeLog }, field, oldVal, newVal, user
            );
          }
        });

        if (!changed) {
          skipped.push({ projectNo: projectNo, reason: '无可合并的可编辑更新内容' });
          return;
        }

        Object.keys(changeLog).forEach(function (col) {
          if (tracking._changed_fields.indexOf(col) < 0) tracking._changed_fields.push(col);
        });

        const merged = FieldConfig.flatToArrays(flat);
        merged.project_no = existing.project_no;
        merged.id = existing.id || existing.project_no;
        merged._added_this_month = existing._added_this_month;
        merged._changed_fields = tracking._changed_fields;
        merged._field_change_log = changeLog;
        const recomputed = FormulaEngine.compute(merged, monthIdx);
        recomputed._changed_fields = tracking._changed_fields;
        recomputed._field_change_log = changeLog;
        updates.push(recomputed);
      } catch (e) {
        errors.push({ projectNo: projectNo, msg: e.message || String(e) });
      }
    });

    return { updates, skipped, errors };
  }

  window.ImportMerge = { mergeImportedProjects };
})(window);
