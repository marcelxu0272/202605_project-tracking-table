/**
 * baseline-diff.js — 相对 baselineVersion（I 或 J 快照）的新增项目与字段 diff
 */
(function (window) {
  'use strict';

  var NEW_PROJECT_BG = '#d9e7d8';

  function resolveBaselineSnapshot(snapshots, baselineVersion) {
    if (!baselineVersion) return null;
    const snaps = snapshots || {};
    const snap = snaps[baselineVersion];
    if (snap && snap.projects) return snap;
    return null;
  }

  function applyAddedSinceBaselineFlags(projects, baselineProjects) {
    if (!baselineProjects || !baselineProjects.length) {
      return projects;
    }
    const priorSet = {};
    baselineProjects.forEach(function (p) {
      if (p && p.project_no) priorSet[p.project_no] = true;
    });
    return projects.map(function (p) {
      const out = Object.assign({}, p);
      const added = !priorSet[p.project_no];
      out._added_since_baseline = added;
      out._added_this_month = added;
      return out;
    });
  }

  function fieldValuesDiffer(leftVal, rightVal, dataType) {
    if (window.DiffUtils && DiffUtils.fieldValuesDiffer) {
      return DiffUtils.fieldValuesDiffer(leftVal, rightVal, dataType);
    }
    if (dataType === '金额' || dataType === '比率') {
      return Math.abs((Number(leftVal) || 0) - (Number(rightVal) || 0)) > 1e-6;
    }
    return String(leftVal == null ? '' : leftVal) !== String(rightVal == null ? '' : rightVal);
  }

  /** 返回相对 baseline 有差异的列号列表 */
  function diffChangedCols(project, baselineProject, compareFields) {
    if (!baselineProject) return [];
    const cols = [];
    const lFlat = FieldConfig.arraysToFlat(project);
    const bFlat = FieldConfig.arraysToFlat(baselineProject);
    (compareFields || []).forEach(function (f) {
      const key = FieldConfig.COL_TO_KEY[f.col];
      if (!key) return;
      if (fieldValuesDiffer(lFlat[key], bFlat[key], f.data_type)) {
        cols.push(f.col);
      }
    });
    return cols;
  }

  function mergeBaselineChangedFields(project, baselineProject, compareFields) {
    const out = Object.assign({}, project);
    const baselineCols = diffChangedCols(out, baselineProject, compareFields);
    const logCols = [];
    if (out._field_change_log && typeof out._field_change_log === 'object') {
      Object.keys(out._field_change_log).forEach(function (col) {
        if (out._field_change_log[col] && out._field_change_log[col].length) logCols.push(col);
      });
    }
    const merged = {};
    baselineCols.concat(logCols).forEach(function (col) { merged[col] = true; });
    out._changed_fields = Object.keys(merged);
    return out;
  }

  function parseSnapshotKey(version) {
    const m = /^(I|D|J):(\d{8}):([^:]+):(\d+)$/.exec(version || '');
    if (!m) return null;
    return { stage: m[1], dateYmd: m[2], scope: m[3], seq: parseInt(m[4], 10) };
  }

  function isModernSnapshotKey(version) {
    return /^(I|D|J):\d{8}:/.test(version || '');
  }

  function isSnapshotVisibleToUser(version, user, sectorCode) {
    if (!version) return false;
    if (isModernSnapshotKey(version)) {
      const parsed = parseSnapshotKey(version);
      if (!parsed) return false;
      if (parsed.stage === 'I' || parsed.stage === 'J') return true;
      if (parsed.stage === 'D') {
        if (!user) return true;
        if (user.role === 'system_admin') return true;
        const sector = sectorCode || user.sector || 'S520';
        const norm = window.SectorWorkflow
          ? SectorWorkflow.normalizeSectorCode(sector)
          : sector;
        return parsed.scope === norm;
      }
    }
    return true;
  }

  window.BaselineDiff = {
    NEW_PROJECT_BG: NEW_PROJECT_BG,
    resolveBaselineSnapshot,
    applyAddedSinceBaselineFlags,
    diffChangedCols,
    mergeBaselineChangedFields,
    parseSnapshotKey,
    isModernSnapshotKey,
    isSnapshotVisibleToUser
  };

  window.ProjectMonthDiff = window.BaselineDiff;
})(window);
