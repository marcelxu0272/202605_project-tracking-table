'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dbm = require('../server/db');
const alertService = require('../server/alert-service');

describe('alert dismiss / undismiss / delete-on-clear', () => {
  let db;

  before(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE project_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_no TEXT NOT NULL,
        project_name TEXT NOT NULL DEFAULT '',
        sector_code TEXT NOT NULL DEFAULT '',
        sector_name TEXT NOT NULL DEFAULT '',
        alert_type TEXT NOT NULL,
        alert_label TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL,
        month_idx INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        first_detected_at TEXT NOT NULL DEFAULT '',
        resolved_at TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT NOT NULL DEFAULT '',
        UNIQUE(project_no, alert_type, year, month_idx)
      );
      CREATE TABLE project_alert_dismissals (
        project_no TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        dismissed_at TEXT NOT NULL,
        dismissed_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (project_no, alert_type)
      );
    `);
  });

  after(() => {
    db.close();
  });

  it('undismiss removes dismissal and restores active status', () => {
    dbm.upsertAlert(db, {
      projectNo: 'P-MULTI',
      projectName: '测试项目',
      sectorCode: 'S520',
      sectorName: '金山中心',
      alertType: 'invoice_stock_negative',
      alertLabel: '存量开票额为负',
      detail: 'R=-1',
      year: 2026,
      monthIdx: 7,
      status: 'active',
      firstDetectedAt: '2026-07-01T00:00:00.000Z',
      resolvedAt: '',
      lastSeenAt: '2026-07-01T00:00:00.000Z'
    });

    const rows = dbm.getAlertsByScope(db, 2026, 7);
    const row = rows.find(a => a.projectNo === 'P-MULTI');
    assert.ok(row);
    const id = row.id;

    const dismissal = alertService.dismissAlertById(db, dbm, id, 'system_admin');
    assert.equal(dismissal.projectNo, 'P-MULTI');
    assert.equal(dbm.getDismissals(db).length, 1);
    assert.equal(dbm.getAlertById(db, id).status, 'dismissed');

    const undone = alertService.undismissAlertById(db, dbm, id);
    assert.equal(undone.removed, true);
    assert.equal(dbm.getDismissals(db).length, 0);
    assert.equal(dbm.getAlertById(db, id).status, 'active');
  });

  it('undismiss rejects non-dismissed alerts', () => {
    dbm.upsertAlert(db, {
      projectNo: 'P-ACTIVE',
      projectName: '活跃项目',
      sectorCode: 'S520',
      sectorName: '金山中心',
      alertType: 'contract_stock_negative',
      alertLabel: '存量合同额为负',
      detail: 'S=-1',
      year: 2026,
      monthIdx: 7,
      status: 'active',
      firstDetectedAt: '2026-07-01T00:00:00.000Z',
      resolvedAt: '',
      lastSeenAt: '2026-07-01T00:00:00.000Z'
    });
    const row = dbm.getAlertsByScope(db, 2026, 7).find(a => a.projectNo === 'P-ACTIVE');
    assert.throws(() => alertService.undismissAlertById(db, dbm, row.id), /仅已忽略/);
  });

  it('deleteAlert removes cleared active alert instead of resolving', () => {
    dbm.upsertAlert(db, {
      projectNo: 'P-CLEAR',
      projectName: '待清除',
      sectorCode: 'S520',
      sectorName: '金山中心',
      alertType: 'hours_no_completion',
      alertLabel: '有工时无完成额',
      detail: 'demo',
      year: 2026,
      monthIdx: 7,
      status: 'active',
      firstDetectedAt: '2026-07-01T00:00:00.000Z',
      resolvedAt: '',
      lastSeenAt: '2026-07-01T00:00:00.000Z'
    });
    dbm.deleteAlert(db, 'P-CLEAR', 'hours_no_completion', 2026, 7);
    const left = dbm.getAlertsByScope(db, 2026, 7).filter(a => a.projectNo === 'P-CLEAR');
    assert.equal(left.length, 0);
  });

  it('deleteResolvedAlerts purges historical resolved rows', () => {
    dbm.upsertAlert(db, {
      projectNo: 'P-OLD',
      projectName: '历史已消除',
      sectorCode: 'S520',
      sectorName: '金山中心',
      alertType: 'completion_no_hours',
      alertLabel: '有完成额无工时',
      detail: 'old',
      year: 2026,
      monthIdx: 7,
      status: 'resolved',
      firstDetectedAt: '2026-06-01T00:00:00.000Z',
      resolvedAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-06-01T00:00:00.000Z'
    });
    dbm.deleteResolvedAlerts(db, 2026, 7);
    const left = dbm.getAlertsByScope(db, 2026, 7).filter(a => a.projectNo === 'P-OLD');
    assert.equal(left.length, 0);
  });
});
