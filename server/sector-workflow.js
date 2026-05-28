'use strict';

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

function normalizeSectorCode(code) {
  if (code == null || code === '') return 'SAS520';
  const c = String(code).trim().toUpperCase();
  if (/^S\d+$/.test(c) && c.indexOf('SAS') !== 0) {
    return 'SAS' + c.slice(1);
  }
  return c;
}

function getSectorNames(getMeta, db) {
  const fromMeta = getMeta(db, 'sectorNames', null);
  if (fromMeta && typeof fromMeta === 'object' && !Array.isArray(fromMeta)) {
    return Object.assign({}, SECTOR_NAMES, fromMeta);
  }
  return Object.assign({}, SECTOR_NAMES);
}

function ensureSectorNames(db, getMeta, setMeta) {
  const names = getSectorNames(getMeta, db);
  if (!getMeta(db, 'sectorNames', null)) {
    setMeta(db, 'sectorNames', names);
  }
  return names;
}

const SECTOR_FLOW = ['draft', 'approve1', 'approve2'];
const SECTOR_SNAP_LABEL = {
  draft: 'Draft',
  approve1: 'Approve1',
  approve2: 'Approve2'
};

function projectSector(p) {
  return normalizeSectorCode(p && p.unit_code);
}

function filterProjectsBySector(projects, sectorCode) {
  const code = normalizeSectorCode(sectorCode);
  return (projects || []).filter(p => projectSector(p) === code);
}

function sectorSnapshotKey(stageLabel, sectorCode) {
  return stageLabel + ':' + normalizeSectorCode(sectorCode);
}

function parseSectorSnapshotKey(version) {
  const m = /^(Draft|Approve1|Approve2):(.+)$/.exec(version || '');
  if (!m) return null;
  return { label: m[1], sector: m[2] };
}

function defaultSectorFlowEntry() {
  return {
    approvalStatus: 'draft',
    reportingSubmitted: false,
    updatedAt: new Date().toISOString()
  };
}

function getSectorRegistry(db, getMeta, projects) {
  const out = DEFAULT_SECTOR_REGISTRY.slice();
  const seen = new Set(out);
  const fromMeta = getMeta(db, 'sectorRegistry', null);
  if (Array.isArray(fromMeta)) {
    fromMeta.forEach(c => {
      const n = normalizeSectorCode(c);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    });
  }
  (projects || []).forEach(p => {
    const n = projectSector(p);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  });
  return out;
}

function listSectorsFromProjects(projects, registry) {
  const set = new Set(registry || []);
  (projects || []).forEach(p => set.add(projectSector(p)));
  return Array.from(set).sort();
}

function resolvePmSector(db, pmName, getProjects) {
  const projects = getProjects(db);
  const hit = projects.find(p => p.pm_name === pmName);
  return hit ? projectSector(hit) : 'SAS520';
}

function migrateSectorFlows(db, getMeta, setMeta, projects, snapshots) {
  let flows = getMeta(db, 'sectorFlows', null);
  const registry = getSectorRegistry(db, getMeta, projects);

  if (!flows || typeof flows !== 'object') {
    flows = {};
    const legacyStatus = getMeta(db, 'approvalStatus', 'draft');
    const legacySubmitted = getMeta(db, 'reportingSubmitted', false);
    registry.forEach(code => {
      flows[code] = {
        approvalStatus: legacyStatus === 'final' ? 'approve2' : (legacyStatus || 'draft'),
        reportingSubmitted: !!legacySubmitted,
        updatedAt: new Date().toISOString()
      };
    });
    if (legacyStatus === 'final') {
      flows._note = 'migrated';
    }
    setMeta(db, 'sectorFlows', flows);
  }

  let changed = false;
  if (flows.S520 && !flows.SAS520) {
    flows.SAS520 = flows.S520;
    delete flows.S520;
    changed = true;
  }
  registry.forEach(code => {
    if (!flows[code]) {
      flows[code] = defaultSectorFlowEntry();
      changed = true;
    }
  });
  if (changed || !getMeta(db, 'sectorFlows', null)) {
    setMeta(db, 'sectorFlows', flows);
  }
  setMeta(db, 'sectorRegistry', registry);
  ensureSectorNames(db, getMeta, setMeta);

  const newSnapshots = {};
  const legacySector = 'SAS520';
  const legacyKeys = [
    { global: 'Draft', label: 'Draft' },
    { global: 'Approve1', label: 'Approve1' },
    { global: 'Approve2', label: 'Approve2' }
  ];
  legacyKeys.forEach(({ global, label }) => {
    const newKey = label + ':' + legacySector;
    const oldKey = label + ':S520';
    if (snapshots[global] && !snapshots[newKey] && !snapshots[oldKey]) {
      const subset = filterProjectsBySector(snapshots[global].projects || projects, legacySector);
      newSnapshots[newKey] = Object.assign({}, snapshots[global], {
        version: newKey,
        sector: legacySector,
        projects: subset
      });
      snapshots[newKey] = newSnapshots[newKey];
    }
    if (snapshots[oldKey] && !snapshots[newKey]) {
      snapshots[newKey] = Object.assign({}, snapshots[oldKey], {
        version: newKey,
        sector: legacySector
      });
    }
  });

  return { flows, registry, newSnapshots };
}

function getCompanyFlow(getMeta, db) {
  const raw = getMeta(db, 'companyFlow', null);
  if (raw && typeof raw === 'object') return raw;
  const approvalStatus = getMeta(db, 'approvalStatus', 'draft');
  if (approvalStatus === 'final') {
    return { archiveStatus: 'final', archivedAt: null };
  }
  return { archiveStatus: 'pending', archivedAt: null };
}

function syncLegacyMetaFromFlows(db, getMeta, setMeta, sectorFlows, companyFlow, registry) {
  const codes = (registry || Object.keys(sectorFlows || {})).filter(c => c && !String(c).startsWith('_'));
  let allApprove2 = codes.length > 0;
  codes.forEach(code => {
    const f = sectorFlows[code];
    if (!f || f.approvalStatus !== 'approve2') allApprove2 = false;
  });

  if (companyFlow.archiveStatus === 'final') {
    setMeta(db, 'approvalStatus', 'final');
  } else if (allApprove2) {
    setMeta(db, 'approvalStatus', 'pending_archive');
  } else {
    const slow = codes.reduce((acc, code) => {
      const st = (sectorFlows[code] && sectorFlows[code].approvalStatus) || 'draft';
      const order = { draft: 0, approve1: 1, approve2: 2 };
      return order[st] < order[acc] ? st : acc;
    }, 'approve2');
    setMeta(db, 'approvalStatus', slow || 'draft');
  }

  const anySubmitted = codes.some(code => sectorFlows[code] && sectorFlows[code].reportingSubmitted);
  setMeta(db, 'reportingSubmitted', anySubmitted);
}

function allSectorsReadyForArchive(sectorFlows, registry) {
  const codes = registry || Object.keys(sectorFlows || {});
  if (!codes.length) return false;
  return codes.every(code => {
    const f = sectorFlows[code];
    return f && f.reportingSubmitted && f.approvalStatus === 'approve2';
  });
}

function userHasRole(user, role) {
  if (!user) return false;
  if (user.role === role) return true;
  return Array.isArray(user.roles) && user.roles.indexOf(role) !== -1;
}

function userSector(user) {
  return normalizeSectorCode(user && (user.sector || user.sectorCode));
}

function shouldSkipDirectorApproval(adminConfig, users, sectorCode) {
  if (!adminConfig) return false;
  const targetSector = normalizeSectorCode(sectorCode);
  const adminUserId = String(adminConfig.adminUserId || '').trim();
  const adminName = String(adminConfig.adminName || '').trim();
  if (!adminUserId && !adminName) return false;
  const matched = (users || []).find(function (user) {
    if (!user) return false;
    if (adminUserId && String(user.id || '').trim() === adminUserId) return true;
    return adminName && String(user.name || '').trim() === adminName;
  });
  return userHasRole(matched, 'sector_director') && userSector(matched) === targetSector;
}

function getSectorFlow(sectorFlows, code) {
  const c = normalizeSectorCode(code);
  if (sectorFlows && sectorFlows[c]) return sectorFlows[c];
  const raw = code != null ? String(code).trim() : '';
  if (raw && sectorFlows && sectorFlows[raw]) return sectorFlows[raw];
  return defaultSectorFlowEntry();
}

function setSectorFlow(db, setMeta, getMeta, code, patch) {
  const c = normalizeSectorCode(code);
  const flows = Object.assign({}, getMeta(db, 'sectorFlows', {}));
  flows[c] = Object.assign({}, getSectorFlow(flows, c), patch, {
    updatedAt: new Date().toISOString()
  });
  setMeta(db, 'sectorFlows', flows);
  return flows[c];
}

module.exports = {
  DEFAULT_SECTOR_REGISTRY,
  SECTOR_NAMES,
  normalizeSectorCode,
  getSectorNames,
  ensureSectorNames,
  SECTOR_FLOW,
  SECTOR_SNAP_LABEL,
  projectSector,
  filterProjectsBySector,
  sectorSnapshotKey,
  parseSectorSnapshotKey,
  defaultSectorFlowEntry,
  getSectorRegistry,
  listSectorsFromProjects,
  resolvePmSector,
  migrateSectorFlows,
  getCompanyFlow,
  syncLegacyMetaFromFlows,
  allSectorsReadyForArchive,
  shouldSkipDirectorApproval,
  getSectorFlow,
  setSectorFlow
};
