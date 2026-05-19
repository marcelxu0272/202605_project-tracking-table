#!/usr/bin/env node
'use strict';

const { loadBrowserScripts } = require('./load-modules');
const dbm = require('./db');
const { seedPriorMonthSnapshot } = require('./prior-month-snapshot');

const modules = loadBrowserScripts();
const db = dbm.openDb();
const removeCount = Number(process.argv[2]) || 5;

try {
  const result = seedPriorMonthSnapshot(db, modules, { removeCount });
  console.log('[ptrack] 已生成上月对比快照:', result.version);
  console.log('  上月项目数:', result.projectCount, '| 当前库:', result.currentCount);
  console.log('  视为本月新增（已从上月快照剔除）:', result.removedCount, '条');
  if (result.removedSample.length) {
    console.log('  示例项目号:', result.removedSample.join(', '));
  }
} catch (e) {
  console.error('[ptrack] 失败:', e.message);
  process.exit(1);
} finally {
  db.close();
}
