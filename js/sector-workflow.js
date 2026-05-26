/**
 * sector-workflow.js — 分板块审批流（前端纯函数）
 */
(function (window) {
  'use strict';

  const SECTOR_FLOW = ['draft', 'approve1', 'approve2'];
  const FLOW_LABELS = {
    draft: '填报/草稿',
    approve1: '总监初审',
    approve2: '群主复审'
  };

  /** 十二板块（执行单位编码 SAS*，与组织架构一致） */
  const DEFAULT_SECTOR_REGISTRY = [
    'SAS170', 'SAS610', 'SAS680', 'SAS650', 'SAS710',
    'SAS690', 'SAS720', 'SAS670', 'SAS520', 'SAS560',
    'SAS550', 'SAS530'
  ];

  const SECTOR_NAMES = {
    SAS170: 'PMC板块',
    SAS610: '咨询板块',
    SAS680: '数字技术板块',
    SAS650: '新材料板块',
    SAS710: '生命科学板块',
    SAS690: 'COII板块',
    SAS720: '模块化板块',
    SAS670: '供应链板块',
    SAS520: '金山中心',
    SAS560: '沈阳中心',
    SAS550: '惠湛中心',
    SAS530: '银川中心',
    S520: '金山中心'
  };

  const SECTOR_STEP_LABELS = ['提交填报', '总监初审', '群主复审'];

  function normalizeSectorCode(code) {
    if (code == null || code === '') return 'SAS520';
    const c = String(code).trim().toUpperCase();
    if (/^S\d+$/.test(c) && c.indexOf('SAS') !== 0) {
      return 'SAS' + c.slice(1);
    }
    return c;
  }

  function sectorName(code, store) {
    const c = normalizeSectorCode(code);
    const fromMeta = store && store.sectorNames && store.sectorNames[c];
    if (fromMeta) return String(fromMeta);
    return SECTOR_NAMES[c] || SECTOR_NAMES[code] || '';
  }

  function sectorDisplayLabel(code, store) {
    const c = normalizeSectorCode(code);
    const name = sectorName(c, store);
    return name ? c + ' · ' + name : c;
  }

  function projectSector(p) {
    return normalizeSectorCode(p && p.unit_code);
  }

  function filterProjectsBySector(projects, sectorCode) {
    const code = normalizeSectorCode(sectorCode);
    return (projects || []).filter(function (p) {
      return projectSector(p) === code;
    });
  }

  function sectorSnapshotKey(label, sectorCode) {
    return label + ':' + normalizeSectorCode(sectorCode);
  }

  function defaultSectorFlow() {
    return { approvalStatus: 'draft', reportingSubmitted: false };
  }

  function getSectorFlow(sectorFlows, code) {
    const c = normalizeSectorCode(code);
    if (sectorFlows && sectorFlows[c]) return sectorFlows[c];
    const raw = code != null ? String(code).trim() : '';
    if (raw && sectorFlows && sectorFlows[raw]) return sectorFlows[raw];
    return defaultSectorFlow();
  }

  function listSectors(store) {
    const out = DEFAULT_SECTOR_REGISTRY.slice();
    const seen = new Set(out);
    const reg = (store && store.sectorRegistry) || [];
    reg.forEach(function (c) {
      const n = normalizeSectorCode(c);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    });
    (store && store.projects || []).forEach(function (p) {
      const n = projectSector(p);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    });
    return out;
  }

  function sectorActiveFlowIdx(flow) {
    const f = flow || defaultSectorFlow();
    if (f.approvalStatus === 'approve2') return -1;
    if (f.approvalStatus === 'approve1') return 2;
    if (f.approvalStatus === 'draft' && f.reportingSubmitted) return 1;
    return 0;
  }

  function sectorFlowStatusText(flow, companyArchived) {
    if (companyArchived) return '公司已归档';
    const f = flow || defaultSectorFlow();
    if (f.approvalStatus === 'approve2') return '已完成审批';
    if (f.approvalStatus === 'approve1') return FLOW_LABELS.approve2 + ' 进行中';
    if (f.reportingSubmitted) return '总监初审 进行中';
    return FLOW_LABELS.draft + ' 进行中';
  }

  function allSectorsReadyForArchive(sectorFlows, sectors) {
    const codes = sectors && sectors.length ? sectors : DEFAULT_SECTOR_REGISTRY;
    if (!codes.length) return false;
    return codes.every(function (code) {
      const f = getSectorFlow(sectorFlows, code);
      return f.reportingSubmitted && f.approvalStatus === 'approve2';
    });
  }

  function countSectorStats(projects, sectorCode, pmSubmissions, reportingMonth) {
    const scoped = filterProjectsBySector(projects, sectorCode);
    let added = 0;
    let changed = 0;
    scoped.forEach(function (p) {
      if (p._added_this_month) added++;
      else if (p._changed_fields && p._changed_fields.length) changed++;
    });
    let pendingPm = 0;
    const subs = (pmSubmissions && pmSubmissions[reportingMonth]) || {};
    Object.keys(subs).forEach(function (pmName) {
      const sub = subs[pmName];
      if (sub.status !== 'submitted') return;
      const pmProjects = scoped.filter(function (p) { return p.pm_name === pmName; });
      if (pmProjects.length) pendingPm++;
    });
    return { added, changed, pendingPm, total: scoped.length };
  }

  function isReviewProject(p) {
    if (p._added_this_month) return true;
    return !!(p._changed_fields && p._changed_fields.length);
  }

  window.SectorWorkflow = {
    SECTOR_FLOW,
    FLOW_LABELS,
    DEFAULT_SECTOR_REGISTRY,
    SECTOR_NAMES,
    SECTOR_STEP_LABELS,
    normalizeSectorCode,
    sectorName,
    sectorDisplayLabel,
    projectSector,
    filterProjectsBySector,
    sectorSnapshotKey,
    getSectorFlow,
    listSectors,
    sectorActiveFlowIdx,
    sectorFlowStatusText,
    allSectorsReadyForArchive,
    countSectorStats,
    isReviewProject
  };
})(window);
