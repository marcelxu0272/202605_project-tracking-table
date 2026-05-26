const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = require('../server/db');
const sw = require('../server/sector-workflow');

function memoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (project_no TEXT PRIMARY KEY, payload TEXT NOT NULL);
  `);
  return sqlite;
}

test('resetWorkflowCycleAfterArchive clears workflow state but keeps lockStatus', () => {
  const sqlite = memoryDb();
  db.ensureDefaultMeta(sqlite);
  db.setMeta(sqlite, 'lockStatus', 'locked');
  db.setMeta(sqlite, 'approvalStatus', 'approve2');
  db.setMeta(sqlite, 'reportingSubmitted', true);
  db.setMeta(sqlite, 'pmSubmissions', {
    '2026-05': { '张三': { status: 'submitted', snapshotVersion: 'D:20260520:SAS520:01' } }
  });
  db.setMeta(sqlite, 'companyFlow', { archiveStatus: 'final', archivedAt: '2026-05-25T10:00:00Z' });
  db.setMeta(sqlite, 'sectorLatestDVersion', { SAS520: 'D:20260520:SAS520:01' });
  db.setMeta(sqlite, 'sectorFlows', {
    SAS520: { approvalStatus: 'approve2', reportingSubmitted: true, lastDVersion: 'D:20260520:SAS520:01' }
  });

  db.resetWorkflowCycleAfterArchive(sqlite);

  assert.equal(db.getMeta(sqlite, 'lockStatus'), 'locked');
  assert.equal(db.getMeta(sqlite, 'approvalStatus'), 'draft');
  assert.equal(db.getMeta(sqlite, 'reportingSubmitted'), false);
  assert.deepEqual(db.getPmSubmissions(sqlite), {});
  assert.deepEqual(db.getMeta(sqlite, 'companyFlow'), { archiveStatus: 'pending', archivedAt: null });
  assert.deepEqual(db.getMeta(sqlite, 'sectorLatestDVersion'), {});

  const flow = db.getMeta(sqlite, 'sectorFlows').SAS520;
  assert.equal(flow.approvalStatus, sw.defaultSectorFlowEntry().approvalStatus);
  assert.equal(flow.reportingSubmitted, sw.defaultSectorFlowEntry().reportingSubmitted);
});

test('clearProjectChangeTracking removes current-cycle change metadata from projects', () => {
  const sqlite = memoryDb();
  db.upsertProject(sqlite, {
    project_no: 'P-001',
    project_name: '测试项目',
    _changed_fields: ['AZ'],
    _field_change_log: { AZ: [{ oldVal: 0, newVal: 100, roleLabel: 'PM' }] },
    _added_this_month: true,
    _added_since_baseline: true
  });

  db.clearProjectChangeTracking(sqlite);

  const row = sqlite.prepare('SELECT payload FROM projects WHERE project_no = ?').get('P-001');
  const project = JSON.parse(row.payload);
  assert.deepEqual(project._changed_fields, []);
  assert.equal(project._field_change_log, undefined);
  assert.equal(project._added_this_month, false);
  assert.equal(project._added_since_baseline, false);
});
