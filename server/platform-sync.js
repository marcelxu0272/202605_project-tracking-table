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

/**
 * 合并平台数据：以 project_no 为键；只 patch system_sync + 报告月当月开票/回款；不删行。
 */
function mergePlatformData(existingProjects, platformProjects, reportingMonth, modules) {
  const { FormulaEngine } = modules;
  const systemSyncKeys = getSystemSyncKeys(modules);
  const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');
  const existingMap = new Map(existingProjects.map(p => [p.project_no, p]));
  const platformMap = new Map(
    platformProjects.filter(p => p && p.project_no).map(p => [p.project_no, p])
  );

  let updated = 0;
  let added = 0;
  let skipped = 0;
  const result = [];

  for (const existing of existingProjects) {
    const platform = platformMap.get(existing.project_no);
    if (!platform) {
      result.push(existing);
      skipped++;
      continue;
    }

    const merged = JSON.parse(JSON.stringify(existing));
    systemSyncKeys.forEach(key => {
      if (platform[key] !== undefined && platform[key] !== null) {
        merged[key] = platform[key];
      }
    });

    if (!merged.monthly_invoice) merged.monthly_invoice = Array(12).fill(0);
    if (!merged.monthly_payment) merged.monthly_payment = Array(12).fill(0);

    if (platform.monthly_invoice && platform.monthly_invoice[monthIdx] != null) {
      merged.monthly_invoice[monthIdx] = platform.monthly_invoice[monthIdx];
      merged['mi_' + monthIdx] = platform.monthly_invoice[monthIdx];
    } else if (platform['mi_' + monthIdx] != null) {
      merged.monthly_invoice[monthIdx] = platform['mi_' + monthIdx];
      merged['mi_' + monthIdx] = platform['mi_' + monthIdx];
    }

    if (platform.monthly_payment && platform.monthly_payment[monthIdx] != null) {
      merged.monthly_payment[monthIdx] = platform.monthly_payment[monthIdx];
      merged['mp_' + monthIdx] = platform.monthly_payment[monthIdx];
    } else if (platform['mp_' + monthIdx] != null) {
      merged.monthly_payment[monthIdx] = platform['mp_' + monthIdx];
      merged['mp_' + monthIdx] = platform['mp_' + monthIdx];
    }

    result.push(FormulaEngine.compute(merged, monthIdx));
    updated++;
  }

  for (const platform of platformProjects) {
    if (!platform || !platform.project_no || existingMap.has(platform.project_no)) continue;
    const p = JSON.parse(JSON.stringify(platform));
    p._added_this_month = true;
    p._changed_fields = p._changed_fields || [];
    delete p._field_change_log;
    p.id = p.project_no;
    result.push(FormulaEngine.compute(p, monthIdx));
    added++;
  }

  result.sort((a, b) => String(a.project_no).localeCompare(String(b.project_no), 'zh-CN'));
  return { projects: result, stats: { updated, added, skipped } };
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
    fieldCN: '平台数据同步',
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
  getSystemSyncKeys
};
