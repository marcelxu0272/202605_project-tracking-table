/**
 * data-scope.js — 经营管理（只读）等角色的数据范围过滤
 */
(function (window) {
  'use strict';

  const SCOPE_LABELS = {
    company: '全公司',
    sector: '板块',
    group: '项目群'
  };

  function filterProjects(user, projects, groupRegistry) {
    const list = projects || [];
    if (!user) return list;
    const role = user.role;

    if (role === 'pm') {
      const pmName = user.pmName || user.name;
      return list.filter(function (p) { return p.pm_name === pmName; });
    }
    if (role === 'sector_admin') {
      const sector = user.sector || 'S520';
      return list.filter(function (p) { return (p.unit_code || 'S520') === sector; });
    }
    if (role === 'executive_viewer') {
      const scope = user.dataScope || 'company';
      if (scope === 'company') return list.slice();
      if (scope === 'sector') {
        const code = user.sectorCode || user.sector || 'SAS520';
        return list.filter(function (p) { return (p.unit_code || '') === code; });
      }
      if (scope === 'group') {
        const reg = groupRegistry || {};
        const grp = reg[user.groupCode];
        if (!grp || !Array.isArray(grp.sectors) || !grp.sectors.length) return [];
        const set = new Set(grp.sectors);
        return list.filter(function (p) { return set.has(p.unit_code); });
      }
    }
    return list;
  }

  function getScopeLabel(user, groupRegistry, sectorNames) {
    if (!user || user.role !== 'executive_viewer') return '';
    const scope = user.dataScope || 'company';
    if (scope === 'company') return SCOPE_LABELS.company;
    if (scope === 'sector') {
      const code = user.sectorCode || user.sector || 'SAS520';
      const names = sectorNames || {};
      return (names[code] || code) + ' · ' + SCOPE_LABELS.sector;
    }
    if (scope === 'group') {
      const reg = groupRegistry || {};
      const grp = reg[user.groupCode];
      const name = (grp && grp.name) || user.groupCode || '项目群';
      return name + ' · ' + SCOPE_LABELS.group;
    }
    return SCOPE_LABELS.company;
  }

  function isExecutiveViewer(user) {
    return !!(user && user.role === 'executive_viewer');
  }

  window.DataScope = {
    filterProjects,
    getScopeLabel,
    isExecutiveViewer,
    SCOPE_LABELS
  };
})(window);
