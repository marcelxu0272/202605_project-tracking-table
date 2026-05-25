'use strict';

const stub = require('./platform-sync-stub');

function getSystemSyncKeys(modules) {
  const { FieldConfig } = modules;
  const fields = FieldConfig.buildFieldConfig();
  const colMap = FieldConfig.COL_TO_KEY;
  const keys = [];
  fields.forEach(f => {
    if (f.source_type === 'system_sync') {
      const k = colMap[f.col];
      if (k) keys.push(k);
    }
  });
  return keys;
}

function getRefKeysForMonth(modules, monthIdx) {
  const { FieldConfig } = modules;
  const fields = FieldConfig.buildFieldConfig();
  const systemKeys = getSystemSyncKeys(modules);
  return systemKeys.concat(['mi_' + monthIdx, 'mp_' + monthIdx]);
}

function resolvePlatformValue(platform, refKey, monthIdx) {
  if (!platform) return undefined;
  if (refKey.startsWith('mi_') || refKey.startsWith('mp_')) {
    const idx = parseInt(refKey.split('_')[1], 10);
    const arrKey = refKey.startsWith('mi_') ? 'monthly_invoice' : 'monthly_payment';
    if (platform[arrKey] && platform[arrKey][idx] != null) return platform[arrKey][idx];
    return platform[refKey];
  }
  return platform[refKey];
}

function buildRefEntryFromPlatform(platform, refKey, monthIdx, syncedAt) {
  const val = resolvePlatformValue(platform, refKey, monthIdx);
  if (val === undefined) {
    return { value: null, status: 'missing_field', syncedAt };
  }
  if (val === null || val === '') {
    return { value: null, status: 'missing_field', syncedAt };
  }
  return { value: val, status: 'ok', syncedAt };
}

function updateSystemRefs(merged, platform, refKeys, monthIdx, syncedAt, reportingYear, NewExistingRef) {
  if (!merged._system_ref) merged._system_ref = {};
  refKeys.forEach(refKey => {
    if (refKey === 'new_existing') return;
    merged._system_ref[refKey] = buildRefEntryFromPlatform(platform, refKey, monthIdx, syncedAt);
  });
  if (NewExistingRef) {
    NewExistingRef.updateExistingRef(merged, reportingYear, syncedAt);
  }
  return merged;
}

function applyPlatformDisplayForNewProject(p, platform, systemSyncKeys, monthIdx) {
  systemSyncKeys.forEach(key => {
    const val = platform[key];
    if (val !== undefined && val !== null) p[key] = val;
  });
  if (!p.monthly_invoice) p.monthly_invoice = Array(12).fill(0);
  if (!p.monthly_payment) p.monthly_payment = Array(12).fill(0);
  const miVal = resolvePlatformValue(platform, 'mi_' + monthIdx, monthIdx);
  const mpVal = resolvePlatformValue(platform, 'mp_' + monthIdx, monthIdx);
  if (miVal != null) {
    p.monthly_invoice[monthIdx] = miVal;
    p['mi_' + monthIdx] = miVal;
  }
  if (mpVal != null) {
    p.monthly_payment[monthIdx] = mpVal;
    p['mp_' + monthIdx] = mpVal;
  }
  return p;
}

/**
 * 合并平台数据：以 project_no 为键；仅更新 _system_ref，不 patch 已有项目的显示字段。
 */
function mergePlatformData(existingProjects, platformProjects, reportingMonth, modules) {
  const { FormulaEngine, NewExistingRef } = modules;
  const systemSyncKeys = getSystemSyncKeys(modules);
  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');
  const reportingYear = NewExistingRef
    ? NewExistingRef.reportingYearFromMonth(reportingMonth)
    : Number(String(reportingMonth || '2026-05').slice(0, 4));
  const refKeys = getRefKeysForMonth(modules, monthIdx);
  const existingMap = new Map(existingProjects.map(p => [p.project_no, p]));
  const platformMap = new Map(
    platformProjects.filter(p => p && p.project_no).map(p => [p.project_no, p])
  );
  const syncedAt = new Date().toISOString();

  let refsUpdated = 0;
  let refsMissing = 0;
  let added = 0;
  const result = [];

  for (const existing of existingProjects) {
    const platform = platformMap.get(existing.project_no);
    const merged = JSON.parse(JSON.stringify(existing));
    if (!merged._system_ref) merged._system_ref = {};
    if (!merged._system_override) merged._system_override = {};

    if (!platform) {
      refKeys.forEach(refKey => {
        if (refKey === 'new_existing' && NewExistingRef) {
          NewExistingRef.updateExistingRef(merged, reportingYear, syncedAt);
          return;
        }
        merged._system_ref[refKey] = {
          value: null,
          status: 'missing_project',
          syncedAt
        };
      });
      refsMissing++;
      result.push(FormulaEngine.compute(merged, monthIdx));
      continue;
    }

    updateSystemRefs(merged, platform, refKeys, monthIdx, syncedAt, reportingYear, NewExistingRef);
    refsUpdated++;
    result.push(FormulaEngine.compute(merged, monthIdx));
  }

  for (const platform of platformProjects) {
    if (!platform || !platform.project_no || existingMap.has(platform.project_no)) continue;
    let p = JSON.parse(JSON.stringify(platform));
    p = applyPlatformDisplayForNewProject(p, platform, systemSyncKeys, monthIdx);
    p._system_ref = {};
    p._system_override = {};
    if (NewExistingRef) {
      NewExistingRef.applyPlatformInsertMeta(p, reportingYear, syncedAt);
    }
    updateSystemRefs(p, platform, refKeys, monthIdx, syncedAt, reportingYear, NewExistingRef);
    p._added_this_month = true;
    p._changed_fields = p._changed_fields || [];
    delete p._field_change_log;
    p.id = p.project_no;
    result.push(FormulaEngine.compute(p, monthIdx));
    added++;
  }

  result.sort((a, b) => String(a.project_no).localeCompare(String(b.project_no), 'zh-CN'));
  return { projects: result, stats: { refsUpdated, refsMissing, added } };
}

/**
 * 报告年度切换时：全部项目 A 列引用 rollover 为「旧项目」
 */
function maybeRunNewExistingYearRollover(db, dbm, modules, reportingMonth) {
  const { FormulaEngine, NewExistingRef } = modules;
  if (!NewExistingRef) return { rolled: false };
  const reportingYear = NewExistingRef.reportingYearFromMonth(reportingMonth);
  const stored = dbm.getMeta(db, 'newExistingClassYear', null);
  if (stored == null) {
    dbm.setMeta(db, 'newExistingClassYear', reportingYear);
    return { rolled: false, reportingYear };
  }
  if (!NewExistingRef.needsYearRollover(stored, reportingYear)) {
    return { rolled: false, reportingYear };
  }

  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');
  const syncedAt = new Date().toISOString();
  const rows = db.prepare('SELECT project_no, payload FROM projects ORDER BY project_no ASC').all();
  const upsert = db.prepare('INSERT OR REPLACE INTO projects (project_no, payload) VALUES (?, ?)');
  const tx = db.transaction((list) => {
    for (const p of list) {
      upsert.run(p.project_no, JSON.stringify(p));
    }
  });
  const rolled = rows.map(r => {
    let p = JSON.parse(r.payload);
    p = NewExistingRef.applyYearEndRolloverProject(p, syncedAt);
    return FormulaEngine.compute(p, monthIdx);
  });
  tx(rolled);
  dbm.setMeta(db, 'newExistingClassYear', reportingYear);
  dbm.pushAudit(db, {
    id: Date.now() + '_rollover_' + Math.random().toString(36).slice(2, 6),
    timestamp: syncedAt,
    operation_type: 'new_existing_year_rollover',
    projectNo: '—',
    projectName: '全局',
    fieldName: 'A',
    fieldCN: '新/旧项目',
    oldVal: String(stored),
    newVal: String(reportingYear),
    userId: 'system',
    userName: '系统'
  });
  return { rolled: true, reportingYear, count: rolled.length };
}

function fetchPlatformSnapshot(db, modules, reportingMonth) {
  const apiUrl = process.env.PTRACK_PLATFORM_API_URL;
  if (apiUrl) {
    throw new Error('PTRACK_PLATFORM_API_URL 已配置但真实 API 尚未实现，请继续使用 stub');
  }
  return stub.fetchPlatformSnapshot(db, modules, reportingMonth);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} dbm
 * @param {{ FieldConfig: object, FormulaEngine: object }} modules
 * @param {{ trigger?: 'manual'|'scheduled', actor?: { id?: string, name?: string } }} [options]
 */
function runPlatformSync(db, dbm, modules, options = {}) {
  const trigger = options.trigger || 'manual';
  const actor = options.actor || null;
  const reportingMonth = dbm.getMeta(db, 'reportingMonth') || '2026-05';

  maybeRunNewExistingYearRollover(db, dbm, modules, reportingMonth);

  const projectRows = db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all();
  const existingProjects = projectRows.map(r => JSON.parse(r.payload));
  const platformProjects = fetchPlatformSnapshot(db, modules, reportingMonth);
  const { projects, stats } = mergePlatformData(
    existingProjects,
    platformProjects,
    reportingMonth,
    modules
  );

  const upsert = db.prepare('INSERT OR REPLACE INTO projects (project_no, payload) VALUES (?, ?)');
  const tx = db.transaction((list) => {
    for (const p of list) {
      upsert.run(p.project_no, JSON.stringify(p));
    }
  });
  tx(projects);

  const syncedAt = new Date().toISOString();
  const syncMeta = Object.assign({ trigger, at: syncedAt }, stats);
  if (actor) {
    syncMeta.actor = { id: actor.id, name: actor.name };
  }
  dbm.setMeta(db, 'systemDataSyncedAt', syncedAt);
  dbm.setMeta(db, 'systemDataSyncMeta', syncMeta);

  dbm.pushAudit(db, {
    id: Date.now() + '_sync_' + Math.random().toString(36).slice(2, 6),
    timestamp: syncedAt,
    operation_type: 'platform_sync',
    projectNo: '—',
    projectName: '全局',
    fieldName: 'platform_sync',
    fieldCN: '工程平台引用同步',
    oldVal: trigger,
    newVal: JSON.stringify(stats),
    userId: actor && actor.id ? actor.id : (trigger === 'scheduled' ? 'system' : 'system_admin'),
    userName: actor && actor.name ? actor.name : (trigger === 'scheduled' ? '定时任务' : '系统管理员')
  });

  return { syncedAt, stats, syncMeta };
}

module.exports = {
  runPlatformSync,
  mergePlatformData,
  fetchPlatformSnapshot,
  getSystemSyncKeys,
  getRefKeysForMonth,
  maybeRunNewExistingYearRollover
};
