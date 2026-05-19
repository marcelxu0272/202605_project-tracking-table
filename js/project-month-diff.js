/**
 * project-month-diff.js — 与上月（Month:YYYY-MM）快照对比，标记本月新增项目
 */
(function (window) {
  'use strict';

  function priorMonthSnapshotVersion(reportingMonth) {
    const parts = String(reportingMonth || '').split('-').map(Number);
    if (!parts[0] || !parts[1]) return null;
    let y = parts[0];
    let m = parts[1] - 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    return 'Month:' + y + '-' + String(m).padStart(2, '0');
  }

  function resolvePriorSnapshot(snapshots, reportingMonth, metaVersion) {
    const snaps = snapshots || {};
    const key = metaVersion || priorMonthSnapshotVersion(reportingMonth);
    if (key && snaps[key] && snaps[key].projects) return snaps[key];
    return null;
  }

  function applyAddedThisMonthFlags(projects, priorSnapshotProjects) {
    if (!priorSnapshotProjects || !priorSnapshotProjects.length) {
      return projects;
    }
    const priorSet = {};
    priorSnapshotProjects.forEach(function (p) {
      if (p && p.project_no) priorSet[p.project_no] = true;
    });
    return projects.map(function (p) {
      const out = Object.assign({}, p);
      if (!priorSet[p.project_no]) {
        out._added_this_month = true;
      } else if (out._added_this_month === undefined) {
        out._added_this_month = false;
      }
      return out;
    });
  }

  window.ProjectMonthDiff = {
    NEW_PROJECT_BG: '#d9e7d8',
    priorMonthSnapshotVersion,
    resolvePriorSnapshot,
    applyAddedThisMonthFlags
  };
})(window);
