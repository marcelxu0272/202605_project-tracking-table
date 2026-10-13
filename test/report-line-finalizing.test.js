'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dbm = require('../server/db');
const reportLineService = require('../server/report-line-service');

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (project_no TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE snapshots (version TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE report_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector_code TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      approval_node TEXT,
      baseline_version TEXT,
      distributed_columns TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(sector_code, period)
    );
    CREATE TABLE report_line_pm_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      pm_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      submitted_at TEXT,
      UNIQUE(report_line_id, pm_name)
    );
    CREATE TABLE report_line_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      comment TEXT,
      from_status TEXT,
      to_status TEXT,
      snapshot_version TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE report_line_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_line_id INTEGER NOT NULL,
      project_no TEXT NOT NULL,
      field_data TEXT,
      change_diff TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(report_line_id, project_no)
    );
  `);
  return db;
}

function seedLine(db, overrides) {
  const opts = Object.assign({
    sector_code: 'SAS520',
    period: '2026-06',
    status: 'open',
    approval_node: null,
    baseline_version: 'J:20260501:ALL:01'
  }, overrides || {});
  const info = db.prepare(
    'INSERT INTO report_lines (sector_code, period, status, approval_node, baseline_version) VALUES (?, ?, ?, ?, ?)'
  ).run(opts.sector_code, opts.period, opts.status, opts.approval_node, opts.baseline_version);
  const lineId = Number(info.lastInsertRowid);
  db.prepare(
    'INSERT INTO report_line_pm_status (report_line_id, pm_name, status) VALUES (?, ?, ?)'
  ).run(lineId, '张三', 'open');
  db.prepare(
    'INSERT INTO report_line_data (report_line_id, project_no, field_data) VALUES (?, ?, ?)'
  ).run(lineId, 'P-001', JSON.stringify({
    project_no: 'P-001',
    project_name: '报告线旧名',
    unit_code: 'SAS520',
    pm_name: '张三',
    total_contract: 100
  }));
  return lineId;
}

describe('report-line finalizing lifecycle', () => {
  let db;

  beforeEach(() => {
    db = memoryDb();
    dbm.ensureDefaultMeta(db);
    dbm.setMeta(db, 'reportingMonth', '2026-06');
    dbm.setMeta(db, 'users', [
      { id: 'u1', name: '群主甲', role: 'group_leader', groupCode: 'GRP_JS' },
      { id: 'u2', name: '总监乙', role: 'sector_director', sector: 'SAS520' }
    ]);
    dbm.upsertProject(db, {
      project_no: 'P-001',
      project_name: '主表新名',
      unit_code: 'SAS520',
      pm_name: '张三',
      total_contract: 200
    });
  });

  afterEach(() => {
    db.close();
  });

  it('autoCompletePeriod moves lines to finalizing and syncs from main', () => {
    const lineId = seedLine(db, { status: 'open' });
    const result = reportLineService.autoCompletePeriod('2026-06', { db: db, actorName: '系统' });
    assert.equal(result.count, 1);
    assert.equal(result.completed[0].to_status, 'finalizing');

    const line = db.prepare('SELECT status FROM report_lines WHERE id = ?').get(lineId);
    assert.equal(line.status, 'finalizing');

    const row = db.prepare(
      'SELECT field_data FROM report_line_data WHERE report_line_id = ? AND project_no = ?'
    ).get(lineId, 'P-001');
    const data = JSON.parse(row.field_data);
    assert.equal(data.project_name, '主表新名');
    assert.equal(data.total_contract, 200);

    const pm = db.prepare(
      'SELECT status FROM report_line_pm_status WHERE report_line_id = ?'
    ).get(lineId);
    assert.equal(pm.status, 'closed');
  });

  it('leader approve enters finalizing not completed', () => {
    const lineId = seedLine(db, { status: 'reviewing_leader', approval_node: 'leader' });
    const result = reportLineService.reviewApproval(
      lineId, 'approve', 'group_leader', '群主甲', '通过', { db: db }
    );
    assert.equal(result.status, 'finalizing');
    const line = db.prepare('SELECT status FROM report_lines WHERE id = ?').get(lineId);
    assert.equal(line.status, 'finalizing');
  });

  it('saveData rejects finalizing lines', () => {
    const lineId = seedLine(db, { status: 'finalizing' });
    assert.throws(
      () => reportLineService.saveData(lineId, 'P-001', { total_contract: 999 }, '管理员', { db: db }),
      (err) => err && err.status === 403
    );
  });

  it('main upsert syncs into finalizing report line but not completed', () => {
    const finalizingId = seedLine(db, { status: 'finalizing', sector_code: 'SAS520' });
    const completedId = seedLine(db, {
      status: 'completed',
      sector_code: 'SAS560',
      period: '2026-05'
    });
    // 已完成线：改写为同项目号，确保同步逻辑按 status 过滤而非仅按板块
    db.prepare(
      'UPDATE report_line_data SET field_data = ? WHERE report_line_id = ? AND project_no = ?'
    ).run(JSON.stringify({
      project_no: 'P-001',
      project_name: '已完成旧名',
      unit_code: 'SAS520',
      total_contract: 100
    }), completedId, 'P-001');
    db.prepare('UPDATE report_lines SET period = ? WHERE id = ?').run('2026-06', completedId);

    const updated = {
      project_no: 'P-001',
      project_name: '保存后新名',
      unit_code: 'SAS520',
      pm_name: '张三',
      total_contract: 333
    };
    dbm.upsertProject(db, updated);
    const sync = reportLineService.syncProjectToFinalizingReportLines(db, updated);
    assert.equal(sync.synced, 1);

    const fRow = db.prepare(
      'SELECT field_data FROM report_line_data WHERE report_line_id = ? AND project_no = ?'
    ).get(finalizingId, 'P-001');
    assert.equal(JSON.parse(fRow.field_data).project_name, '保存后新名');
    assert.equal(JSON.parse(fRow.field_data).total_contract, 333);

    const cRow = db.prepare(
      'SELECT field_data FROM report_line_data WHERE report_line_id = ? AND project_no = ?'
    ).get(completedId, 'P-001');
    assert.equal(JSON.parse(cRow.field_data).project_name, '已完成旧名');
  });

  it('completeFinalizingReportLines seals to completed and stops further sync', () => {
    const lineId = seedLine(db, { status: 'finalizing' });
    const sealed = reportLineService.completeFinalizingReportLines(db, '2026-06', {
      actorName: '系统管理员'
    });
    assert.equal(sealed.count, 1);
    const line = db.prepare('SELECT status FROM report_lines WHERE id = ?').get(lineId);
    assert.equal(line.status, 'completed');

    const approval = db.prepare(
      'SELECT action, to_status FROM report_line_approvals WHERE report_line_id = ? ORDER BY id DESC LIMIT 1'
    ).get(lineId);
    assert.equal(approval.action, 'archive_complete');
    assert.equal(approval.to_status, 'completed');

    dbm.upsertProject(db, {
      project_no: 'P-001',
      project_name: '归档后再改',
      unit_code: 'SAS520',
      total_contract: 999
    });
    const sync = reportLineService.syncProjectToFinalizingReportLines(db, {
      project_no: 'P-001',
      project_name: '归档后再改',
      unit_code: 'SAS520',
      total_contract: 999
    });
    assert.equal(sync.synced, 0);
    const row = db.prepare(
      'SELECT field_data FROM report_line_data WHERE report_line_id = ? AND project_no = ?'
    ).get(lineId, 'P-001');
    assert.equal(JSON.parse(row.field_data).project_name, '报告线旧名');
  });
});
