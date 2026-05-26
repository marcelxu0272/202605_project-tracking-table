const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = require('../server/db');
const sw = require('../server/sector-workflow');

function memoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
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
  assert.deepEqual(flow, sw.defaultSectorFlowEntry());
});
