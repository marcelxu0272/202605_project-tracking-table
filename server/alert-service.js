/**
 * alert-service.js — 项目预警聚合服务
 * 批量计算全部项目预警，与 DB 持久化记录同步（active / resolved 状态流转）
 */
'use strict';

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
  S520:   '金山中心'
};

function resolveSectorName(code) {
  if (!code) return '';
  const c = String(code).trim().toUpperCase();
  if (SECTOR_NAMES[c]) return SECTOR_NAMES[c];
  // 兼容 S520 → SAS520
  if (/^S\d+$/.test(c)) {
    const full = 'SAS' + c.slice(1);
    if (SECTOR_NAMES[full]) return SECTOR_NAMES[full];
  }
  return '';
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * 生成预警详情的可读文本
 */
function formatAlertDetail(alertType, project, monthIdx, tsStats) {
  const M = monthIdx + 1;
  const FieldConfig = global._modules && global._modules.FieldConfig;
  const flat = (FieldConfig && FieldConfig.arraysToFlat)
    ? FieldConfig.arraysToFlat(project)
    : project;

  if (alertType === 'invoice_stock_negative') {
    const val = Number(flat.contract_minus_invoice) || 0;
    return 'R列(存量开票额) = ' + val.toFixed(2) + '万';
  }
  if (alertType === 'contract_stock_negative') {
    const val = Number(flat.contract_minus_completed) || 0;
    return 'S列(存量合同额) = ' + val.toFixed(2) + '万';
  }
  if (alertType === 'completion_no_hours' || alertType === 'hours_no_completion') {
    const mcVal = Number(flat['mc_' + monthIdx]) || 0;
    let hours = 0;
    if (tsStats && !tsStats.empty && tsStats.byProfession && tsStats.byProfession.rows) {
      const totalRow = tsStats.byProfession.rows.find(r => r.isTotal);
      if (totalRow && totalRow.months && totalRow.months[monthIdx]) {
        hours = Number(totalRow.months[monthIdx].hours) || 0;
      }
    }
    if (alertType === 'completion_no_hours') {
      return M + '月完成额 = ' + mcVal.toFixed(2) + '万，' + M + '月工时 = ' + hours.toFixed(1) + 'h';
    }
    return M + '月工时 = ' + hours.toFixed(1) + 'h，' + M + '月完成额 = ' + mcVal.toFixed(2) + '万';
  }
  return '';
}

/**
 * @param {object} db - better-sqlite3 instance
 * @param {object} modules - loadBrowserScripts() result (FormulaEngine, FieldConfig, StockValidation, ProjectAlerts)
 * @param {object} dbm - require('./db')
 * @param {object} timesheetStatsMod - require('./timesheet-stats')
 * @param {number} monthIdx - 0-11
 * @param {number} year
 * @returns {{ alerts: Array, summary: object, computedAt: string }}
 */
function collectAllAlerts(db, modules, dbm, timesheetStatsMod, monthIdx, year) {
  // Expose modules globally for formatAlertDetail helper
  global._modules = modules;

  // 1. Load and compute all projects
  const allProjects = db.prepare('SELECT payload FROM projects').all()
    .map(r => JSON.parse(r.payload));

  const computed = allProjects.map(p => {
    try {
      return modules.FormulaEngine.compute(Object.assign({}, p), monthIdx);
    } catch (e) {
      return p;
    }
  });

  // 2. Build timesheet stats map (one bulk query)
  let tsStatsMap = {};
  try {
    const allEntries = dbm.getAllTimesheetEntriesForYear(db, year);
    const byProject = {};
    for (const entry of allEntries) {
      const pno = entry.projectNo;
      if (!byProject[pno]) byProject[pno] = [];
      byProject[pno].push(entry);
    }
    for (const pno of Object.keys(byProject)) {
      tsStatsMap[pno] = timesheetStatsMod.buildTimesheetStats(byProject[pno], year);
    }
  } catch (e) {
    // Timesheet data may not exist; continue without it
  }

  // 3. Compute current active alerts
  const activeMap = new Map(); // key: "projectNo__alertType" → alert object

  // 3b. Load permanent dismissals and filter from active set
  const dismissals = dbm.getDismissals(db);
  const dismissedSet = new Set();
  for (const d of dismissals) {
    dismissedSet.add(d.projectNo + '__' + d.alertType);
  }

  for (const project of computed) {
    const pno = project.project_no || project.projectNo || '';
    if (!pno) continue;

    const sectorCode = project.unit_code || project.sector_code || project.sectorCode || '';
    const sectorName = resolveSectorName(sectorCode) || project.sector_name || '';
    const projectName = project.project_name || project.projectName || '';
    const tsStats = tsStatsMap[pno] || null;

    // R/S alerts via StockValidation
    if (modules.StockValidation) {
      if (modules.StockValidation.hasInvoiceStockWarning(project, monthIdx)) {
        const key = pno + '__invoice_stock_negative';
        activeMap.set(key, {
          projectNo: pno,
          projectName,
          sectorCode,
          sectorName,
          alertType: 'invoice_stock_negative',
          alertLabel: '存量开票额为负',
          detail: formatAlertDetail('invoice_stock_negative', project, monthIdx, tsStats)
        });
      }
      if (modules.StockValidation.hasContractStockViolation(project, monthIdx)) {
        const key = pno + '__contract_stock_negative';
        activeMap.set(key, {
          projectNo: pno,
          projectName,
          sectorCode,
          sectorName,
          alertType: 'contract_stock_negative',
          alertLabel: '存量合同额为负',
          detail: formatAlertDetail('contract_stock_negative', project, monthIdx, tsStats)
        });
      }
    }

    // Timesheet alerts via ProjectAlerts
    if (modules.ProjectAlerts && tsStats) {
      const alerts = modules.ProjectAlerts.getProjectAlerts(project, monthIdx, tsStats, { timesheetReady: true });
      for (const a of alerts) {
        // Only add timesheet-type alerts here (R/S already handled above)
        if (a.id === 'completion_no_hours' || a.id === 'hours_no_completion') {
          const key = pno + '__' + a.id;
          activeMap.set(key, {
            projectNo: pno,
            projectName,
            sectorCode,
            sectorName,
            alertType: a.id,
            alertLabel: a.label,
            detail: formatAlertDetail(a.id, project, monthIdx, tsStats)
          });
        }
      }
    }
  }

  // 3c. Remove permanently dismissed alerts from active set
  for (const key of dismissedSet) {
    activeMap.delete(key);
  }

  // 4. Sync with DB (transaction)
  const existing = dbm.getAlertsByScope(db, year, monthIdx);
  const existingMap = new Map();
  for (const rec of existing) {
    existingMap.set(rec.projectNo + '__' + rec.alertType, rec);
  }

  const now = nowISO();

  const syncTx = db.transaction(() => {
    // Upsert active alerts
    for (const [key, alert] of activeMap) {
      const prev = existingMap.get(key);
      if (prev) {
        // Update existing record
        const isResolved = prev.status === 'resolved';
        dbm.upsertAlert(db, {
          projectNo: alert.projectNo,
          projectName: alert.projectName,
          sectorCode: alert.sectorCode,
          sectorName: alert.sectorName,
          alertType: alert.alertType,
          alertLabel: alert.alertLabel,
          detail: alert.detail,
          year,
          monthIdx,
          status: 'active',
          firstDetectedAt: isResolved ? now : prev.firstDetectedAt,
          resolvedAt: isResolved ? '' : prev.resolvedAt,
          lastSeenAt: now
        });
      } else {
        // New alert
        dbm.upsertAlert(db, {
          projectNo: alert.projectNo,
          projectName: alert.projectName,
          sectorCode: alert.sectorCode,
          sectorName: alert.sectorName,
          alertType: alert.alertType,
          alertLabel: alert.alertLabel,
          detail: alert.detail,
          year,
          monthIdx,
          status: 'active',
          firstDetectedAt: now,
          resolvedAt: '',
          lastSeenAt: now
        });
      }
    }

    // Mark resolved: active in DB but not in current active set
    for (const [key, rec] of existingMap) {
      if (rec.status === 'active' && !activeMap.has(key)) {
        dbm.upsertAlert(db, {
          projectNo: rec.projectNo,
          projectName: rec.projectName,
          sectorCode: rec.sectorCode,
          sectorName: rec.sectorName,
          alertType: rec.alertType,
          alertLabel: rec.alertLabel,
          detail: rec.detail,
          year,
          monthIdx,
          status: 'resolved',
          firstDetectedAt: rec.firstDetectedAt,
          resolvedAt: now,
          lastSeenAt: rec.lastSeenAt
        });
      }
    }
  });

  syncTx();

  // 5. Return full list
  const finalAlerts = dbm.getAlertsByScope(db, year, monthIdx);

  const byType = {};
  const projectSet = new Set();
  let activeCount = 0;
  let resolvedCount = 0;
  let dismissedCount = 0;

  for (const a of finalAlerts) {
    if (a.status === 'active') {
      activeCount++;
      byType[a.alertType] = (byType[a.alertType] || 0) + 1;
    } else if (a.status === 'dismissed') {
      dismissedCount++;
    } else {
      resolvedCount++;
    }
    projectSet.add(a.projectNo);
  }

  delete global._modules;

  return {
    alerts: finalAlerts,
    summary: {
      total: finalAlerts.length,
      activeCount,
      resolvedCount,
      dismissedCount,
      byType,
      projectCount: projectSet.size
    },
    computedAt: now
  };
}

/**
 * 永久忽略指定预警（手动消除）
 * @param {object} db - better-sqlite3 instance
 * @param {object} dbm - require('./db')
 * @param {number} alertId - project_alerts.id
 * @param {string} dismissedBy - 操作人标识
 * @returns {{ projectNo, alertType, dismissedAt }}
 */
function dismissAlertById(db, dbm, alertId, dismissedBy) {
  const alert = dbm.getAlertById(db, alertId);
  if (!alert) throw new Error('预警记录不存在：id=' + alertId);

  const dismissal = dbm.dismissAlert(db, alert.projectNo, alert.alertType, dismissedBy);

  // 更新当前行状态为 dismissed
  dbm.upsertAlert(db, {
    projectNo: alert.projectNo,
    projectName: alert.projectName,
    sectorCode: alert.sectorCode,
    sectorName: alert.sectorName,
    alertType: alert.alertType,
    alertLabel: alert.alertLabel,
    detail: alert.detail,
    year: alert.year,
    monthIdx: alert.monthIdx,
    status: 'dismissed',
    firstDetectedAt: alert.firstDetectedAt,
    resolvedAt: alert.resolvedAt,
    lastSeenAt: alert.lastSeenAt
  });

  return dismissal;
}

module.exports = { collectAllAlerts, dismissAlertById };
