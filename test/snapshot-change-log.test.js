const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const db = require('../server/db');
const snapshots = require('../server/snapshot-service');

function memoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE snapshots (version TEXT PRIMARY KEY, payload TEXT NOT NULL);
  `);
  db.ensureDefaultMeta(sqlite);
  db.setMeta(sqlite, 'reportingMonth', '2026-05');
  return sqlite;
}

function changedProject() {
  return {
    project_no: 'P-001',
    project_name: '测试项目',
    unit_code: 'S520',
    _changed_fields: ['AZ'],
    _field_change_log: {
      AZ: [
        { oldVal: 0, newVal: 100, roleLabel: 'PM', userName: '项目经理', at: '2026-05-20T08:00:00Z' },
        { oldVal: 100, newVal: 120, roleLabel: '板块管理员', userName: '板块管理员', at: '2026-05-21T08:00:00Z' }
      ]
    }
  };
}

test('D and J snapshots preserve accumulated field change logs', () => {
  const sqlite = memoryDb();
  const project = changedProject();

  const draft = snapshots.createDraftSnapshot(sqlite, 'SAS520', [project], { name: '板块管理员', role: 'sector_admin' }).snap;
  const final = snapshots.createFinalSnapshot(sqlite, [project], { name: '系统管理员', role: 'system_admin' }).snap;

  assert.deepEqual(draft.projects[0]._field_change_log.AZ, project._field_change_log.AZ);
  assert.deepEqual(final.projects[0]._field_change_log.AZ, project._field_change_log.AZ);
  assert.deepEqual(draft.projects[0]._changed_fields, ['AZ']);
  assert.deepEqual(final.projects[0]._changed_fields, ['AZ']);
});

test('I snapshots still clear transient field change logs', () => {
  const sqlite = memoryDb();
  const project = changedProject();

  const imported = snapshots.createImportSnapshot(sqlite, [project], {
    userName: '系统',
    role: 'system_admin',
    sourceFile: 'test.xlsx'
  }).snap;

  assert.equal(imported.projects[0]._field_change_log, undefined);
  assert.deepEqual(imported.projects[0]._changed_fields, []);
});
