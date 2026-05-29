const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../server/load-modules');
const { mergeInitialImportWithPlatform } = require('../server/platform-sync');

const modules = loadBrowserScripts();

const REPORTING_MONTH = '2026-05';

/** 构建最小项目对象（模拟 projectsFromXlsxBuffer 输出） */
function makeProject(overrides) {
  const mi = (overrides && overrides.mi_4 != null) ? overrides.mi_4 : 10000;
  const mp = (overrides && overrides.mp_4 != null) ? overrides.mp_4 : 8000;
  const monthlyInvoice = Array(12).fill(0);
  const monthlyPayment = Array(12).fill(0);
  monthlyInvoice[4] = mi;
  monthlyPayment[4] = mp;
  const base = {
    project_no: 'TEST-001',
    id: 'TEST-001',
    new_existing: '旧项目',
    unit_code: 'S520',
    pm_name: '张三',
    project_name: '测试项目',
    client_name: '客户A',
    prev_year_contract: 1000000,
    adj_value: 50000,
    prev_year_completion: 800000,
    monthly_invoice: monthlyInvoice,
    monthly_payment: monthlyPayment,
    mi_4: mi,
    mp_4: mp,
    _system_ref: {},
    _system_override: {},
    _changed_fields: [],
    _added_this_month: false
  };
  return Object.assign(base, overrides);
}

// ────────────────────────────────────────────────────
// 1. 全部匹配且值一致（stub 场景）
// ────────────────────────────────────────────────────
test('all matched with identical values — refs ok, no override, no unmatched', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' }),
    makeProject({ project_no: 'P002', pm_name: '李四' })
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' }),
    makeProject({ project_no: 'P002', pm_name: '李四' })
  ];

  const { projects, stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  assert.equal(stats.total, 2);
  assert.equal(stats.matched, 2);
  assert.equal(stats.overrides, 0);
  assert.equal(stats.unmatched, 0);

  for (const p of projects) {
    assert.equal(p._platform_unmatched, undefined);
    assert.deepEqual(p._system_override, {});
    // unit_code 是 system_sync，应有 ref 且 status='ok'
    assert.ok(p._system_ref.unit_code);
    assert.equal(p._system_ref.unit_code.status, 'ok');
    assert.equal(p._system_ref.unit_code.value, p.unit_code);
  }
});

// ────────────────────────────────────────────────────
// 2. 部分项目未匹配
// ────────────────────────────────────────────────────
test('unmatched projects — _platform_unmatched and status not_on_platform', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' }),
    makeProject({ project_no: 'P999', pm_name: '王五' })  // 平台无此项目
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' })
  ];

  const { projects, stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  assert.equal(stats.total, 2);
  assert.equal(stats.matched, 1);
  assert.equal(stats.unmatched, 1);

  const unmatched = projects.find(p => p.project_no === 'P999');
  assert.ok(unmatched);
  assert.equal(unmatched._platform_unmatched, true);
  // display 值保持 Excel 值
  assert.equal(unmatched.pm_name, '王五');
  // ref status 全部为 not_on_platform
  assert.ok(unmatched._system_ref.unit_code);
  assert.equal(unmatched._system_ref.unit_code.status, 'not_on_platform');
  assert.equal(unmatched._system_ref.unit_code.value, null);
  // 不应有 override
  assert.deepEqual(unmatched._system_override, {});
});

// ────────────────────────────────────────────────────
// 3. 匹配但有值差异
// ────────────────────────────────────────────────────
test('matched with value differences — override marked with platform ref value', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三', unit_code: 'S520' })
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001', pm_name: '李四', unit_code: 'S530' })
  ];

  const { projects, stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  assert.equal(stats.matched, 1);
  assert.equal(stats.overrides, 1);

  const p = projects[0];
  // display 值 = Excel 值
  assert.equal(p.pm_name, '张三');
  assert.equal(p.unit_code, 'S520');
  // ref 保存平台值
  assert.equal(p._system_ref.pm_name.value, '李四');
  assert.equal(p._system_ref.pm_name.status, 'ok');
  assert.equal(p._system_ref.unit_code.value, 'S530');
  // override 已标记
  assert.ok(p._system_override.pm_name);
  assert.equal(p._system_override.pm_name.userId, 'system');
  assert.equal(p._system_override.pm_name.userName, '初始化导入');
  assert.ok(p._system_override.unit_code);
});

// ────────────────────────────────────────────────────
// 4. 平台独有项目不插入
// ────────────────────────────────────────────────────
test('platform-only projects are excluded', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001' })
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001' }),
    makeProject({ project_no: 'P-EXTRA' }) // 平台独有
  ];

  const { projects, stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  assert.equal(projects.length, 1);
  assert.equal(projects[0].project_no, 'P001');
  assert.equal(stats.total, 1);
});

// ────────────────────────────────────────────────────
// 5. NewExistingRef 不被 merge 覆盖
// ────────────────────────────────────────────────────
test('new_existing ref is preserved from seedImportRefs, not overwritten by merge', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', new_existing: '新项目' })
  ];
  // 手动模拟 seedImportRefs 已设置的 new_existing ref
  excelProjects[0]._system_ref.new_existing = {
    value: '新项目',
    status: 'ok',
    syncedAt: '2026-05-29T00:00:00.000Z'
  };

  const platformProjects = [
    makeProject({ project_no: 'P001', new_existing: '旧项目' }) // 平台说旧项目
  ];

  const { projects } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  const p = projects[0];
  // new_existing 的 ref 不应被 merge 覆盖为平台值
  // 它由 seedImportRefs 设置，merge 应跳过
  assert.ok(p._system_ref.new_existing);
  // merge 不应改写 new_existing 的 ref（函数内部已排除该键）
  assert.equal(p._system_ref.new_existing.value, '新项目');
});

// ────────────────────────────────────────────────────
// 6. 混合场景 — stats 计数正确
// ────────────────────────────────────────────────────
test('mixed scenario — stats counts are correct', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' }),              // 匹配一致
    makeProject({ project_no: 'P002', pm_name: '李四' }),              // 匹配一致
    makeProject({ project_no: 'P003', pm_name: '王五', unit_code: 'S520' }), // 匹配有差异
    makeProject({ project_no: 'P999', pm_name: '赵六' })               // 未匹配
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001', pm_name: '张三' }),
    makeProject({ project_no: 'P002', pm_name: '李四' }),
    makeProject({ project_no: 'P003', pm_name: '王五', unit_code: 'S999' }), // 差异
    makeProject({ project_no: 'P-EXTRA' })                             // 平台独有
  ];

  const { projects, stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  assert.equal(stats.total, 4);
  assert.equal(stats.matched, 3);
  assert.equal(stats.overrides, 1);
  assert.equal(stats.unmatched, 1);
  assert.equal(projects.length, 4);
});

// ────────────────────────────────────────────────────
// 7. 空值比较等价
// ────────────────────────────────────────────────────
test('null and empty string are treated as equal', () => {
  const excelProjects = [
    makeProject({ project_no: 'P001', client_name: '' })
  ];
  const platformProjects = [
    makeProject({ project_no: 'P001', client_name: null })
  ];

  const { stats } = mergeInitialImportWithPlatform(
    excelProjects, platformProjects, REPORTING_MONTH, modules
  );

  // 空字符串与 null 视为一致，不应产生 override
  assert.equal(stats.overrides, 0);
});
