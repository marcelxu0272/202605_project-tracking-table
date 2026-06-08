'use strict';

/**
 * 报告线模拟数据种子：为 report_lines 及关联表插入演示数据
 * - 2026-05（上月）：12 个板块全部已完结（completed/closed）
 * - 2026-06（当月）：6 个板块各状态演示
 * 表为空时自动插入；force 时可清除后重建
 */
const dbm = require('./db');
const sw = require('./sector-workflow');

const SEED_PERIOD_CURRENT = '2026-06';
const SEED_PERIOD_PRIOR   = '2026-05';

// ─────────────────────────────────────────────────────────────
// 上月（2026-05）种子：12 个板块全部已完结
// ─────────────────────────────────────────────────────────────
const MAY_SEED_CONFIGS = [
  { sector_code: 'SAS520', sector_name: '金山中心',     status: 'completed', projects: [
    { no: 'J5-001', name: '金山中心A项目', contract: 8500000, rate: 0.75, monthly: 420000, cumulative: 6375000, pm: '何孝刚' },
    { no: 'J5-002', name: '金山中心B项目', contract: 3200000, rate: 0.62, monthly: 155000, cumulative: 1984000, pm: '宋建生' }
  ], pms: [{ name: '何孝刚', status: 'submitted' }, { name: '宋建生', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '运营总监 周明', comment: '板块管理员提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '板块总监 陈磊', comment: '总监审批通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '项目群主 王总', comment: '群主审批通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS530', sector_name: '银川中心',     status: 'completed', projects: [
    { no: 'Y5-001', name: '银川5月项目', contract: 6800000, rate: 0.72, monthly: 380000, cumulative: 4896000, pm: '赵立军' }
  ], pms: [{ name: '赵立军', status: 'submitted' }, { name: '马海燕', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '银川板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '银川板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '项目群主 王总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS550', sector_name: '惠湛中心',     status: 'completed', projects: [
    { no: 'HZ5-001', name: '惠湛5月工程', contract: 12500000, rate: 0.58, monthly: 720000, cumulative: 7250000, pm: '陈建华' }
  ], pms: [{ name: '陈建华', status: 'submitted' }, { name: '林美玲', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '惠湛板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '惠湛板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '项目群主 王总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS560', sector_name: '沈阳中心',     status: 'closed',     projects: [
    { no: 'SY5-001', name: '沈阳5月项目', contract: 15600000, rate: 0.42, monthly: 680000, cumulative: 6552000, pm: '王建国' }
  ], pms: [{ name: '王建国', status: 'closed' }], approvals: [] },
  { sector_code: 'SAS670', sector_name: '供应链板块',   status: 'completed', projects: [
    { no: 'GY5-001', name: '供应链5月项目', contract: 4300000, rate: 0.45, monthly: 195000, cumulative: 1935000, pm: '张伟' }
  ], pms: [{ name: '张伟', status: 'submitted' }, { name: '李明', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '供应链板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '供应链板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS170', sector_name: 'PMC板块',       status: 'closed',     projects: [
    { no: 'PMC5-001', name: 'PMC5月咨询', contract: 1800000, rate: 0.95, monthly: 90000, cumulative: 1710000, pm: '周强' }
  ], pms: [{ name: '周强', status: 'closed' }], approvals: [] },
  { sector_code: 'SAS610', sector_name: '咨询板块',       status: 'completed', projects: [
    { no: 'ZX5-001', name: '咨询5月项目', contract: 3500000, rate: 0.68, monthly: 185000, cumulative: 2380000, pm: '刘芳' }
  ], pms: [{ name: '刘芳', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '咨询板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '咨询板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS680', sector_name: '数字技术板块',   status: 'completed', projects: [
    { no: 'DT5-001', name: '数字技术5月项目', contract: 5200000, rate: 0.52, monthly: 270000, cumulative: 2704000, pm: '陈飞' }
  ], pms: [{ name: '陈飞', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '数字技术板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '数字技术板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS650', sector_name: '新材料板块',     status: 'completed', projects: [
    { no: 'XC5-001', name: '新材料5月项目', contract: 2800000, rate: 0.63, monthly: 145000, cumulative: 1764000, pm: '周磊' }
  ], pms: [{ name: '周磊', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '新材料板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '新材料板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS710', sector_name: '生命科学板块',   status: 'completed', projects: [
    { no: 'SM5-001', name: '生命科学5月项目', contract: 6100000, rate: 0.44, monthly: 310000, cumulative: 2684000, pm: '吴静' }
  ], pms: [{ name: '吴静', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '生命科学板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '生命科学板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS690', sector_name: 'COII板块',       status: 'completed', projects: [
    { no: 'CO5-001', name: 'COII5月项目', contract: 4700000, rate: 0.57, monthly: 235000, cumulative: 2679000, pm: '赵勇' }
  ], pms: [{ name: '赵勇', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: 'COII板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: 'COII板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]},
  { sector_code: 'SAS720', sector_name: '模块化板块',     status: 'completed', projects: [
    { no: 'MK5-001', name: '模块化5月项目', contract: 3900000, rate: 0.49, monthly: 195000, cumulative: 1911000, pm: '徐明' }
  ], pms: [{ name: '徐明', status: 'submitted' }],
  approvals: [
    { action: 'submit', actor_role: 'sector_admin', actor_name: '模块化板块管理员', comment: '提交审批', from_status: 'open', to_status: 'reviewing_director' },
    { action: 'approve', actor_role: 'sector_director', actor_name: '模块化板块总监', comment: '通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
    { action: 'approve', actor_role: 'group_leader', actor_name: '总部群主 刘总', comment: '通过', from_status: 'reviewing_leader', to_status: 'completed' }
  ]}
];

// ─────────────────────────────────────────────────────────────
// 当月（2026-06）种子：6 个板块各状态演示
// ─────────────────────────────────────────────────────────────
const JUNE_SEED_CONFIGS = [
  {
    sector_code: 'SAS520',
    sector_name: '金山中心',
    status: 'open',
    approval_node: null,
    useDbProjects: true,
    pms: [
      { name: '何孝刚', status: 'open' },
      { name: '宋建生', status: 'open' }
    ],
    approvals: [],
    projects: []
  },
  {
    sector_code: 'SAS530',
    sector_name: '银川中心',
    status: 'completed',
    approval_node: null,
    pms: [
      { name: '赵立军', status: 'submitted' },
      { name: '马海燕', status: 'submitted' },
      { name: '杨志明', status: 'submitted' }
    ],
    approvals: [
      { action: 'submit', actor_role: 'sector_admin', actor_name: '银川板块管理员', comment: '板块管理员提交审批', from_status: 'open', to_status: 'reviewing_director' },
      { action: 'approve', actor_role: 'sector_director', actor_name: '银川板块总监', comment: '总监审批通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' },
      { action: 'approve', actor_role: 'group_leader', actor_name: '项目群主 王总', comment: '群主审批通过', from_status: 'reviewing_leader', to_status: 'completed' }
    ],
    projects: [
      { no: 'Y2025-001', name: '银川新能源项目', contract: 6800000, rate: 0.62, monthly: 350000, cumulative: 4216000 },
      { no: 'Y2025-002', name: '银川道路改造工程', contract: 2300000, rate: 0.78, monthly: 165000, cumulative: 1794000 },
      { no: 'Y2025-003', name: '银川供水管网建设', contract: 4100000, rate: 0.35, monthly: 210000, cumulative: 1435000 }
    ]
  },
  {
    sector_code: 'SAS550',
    sector_name: '惠湛中心',
    status: 'reviewing_leader',
    approval_node: 'leader',
    pms: [
      { name: '陈建华', status: 'submitted' },
      { name: '林美玲', status: 'closed' },
      { name: '黄志远', status: 'submitted' }
    ],
    approvals: [
      { action: 'submit', actor_role: 'sector_admin', actor_name: '惠湛板块管理员', comment: '板块管理员提交审批', from_status: 'open', to_status: 'reviewing_director' },
      { action: 'approve', actor_role: 'sector_director', actor_name: '惠湛板块总监', comment: '总监审批通过', from_status: 'reviewing_director', to_status: 'reviewing_leader' }
    ],
    projects: [
      { no: 'HZ2025-001', name: '惠湛港口扩建工程', contract: 12500000, rate: 0.52, monthly: 680000, cumulative: 6500000 },
      { no: 'HZ2025-002', name: '惠湛污水处理厂', contract: 4700000, rate: 0.41, monthly: 230000, cumulative: 1927000 },
      { no: 'HZ2025-003', name: '湛江桥梁加固项目', contract: 3200000, rate: 0.68, monthly: 195000, cumulative: 2176000 },
      { no: 'HZ2025-004', name: '惠州产业园二期', contract: 7800000, rate: 0.29, monthly: 380000, cumulative: 2262000 },
      { no: 'HZ2025-005', name: '惠州市政道路项目', contract: 2100000, rate: 0.55, monthly: 125000, cumulative: 1155000 }
    ]
  },
  {
    sector_code: 'SAS560',
    sector_name: '沈阳中心',
    status: 'reviewing_director',
    approval_node: 'director',
    pms: [
      { name: '王建国', status: 'submitted' },
      { name: '刘晓峰', status: 'closed' }
    ],
    approvals: [
      { action: 'submit', actor_role: 'sector_admin', actor_name: '沈阳板块管理员', comment: '板块管理员提交审批', from_status: 'open', to_status: 'reviewing_director' }
    ],
    projects: [
      { no: 'SY2025-001', name: '沈阳地铁延伸线', contract: 15600000, rate: 0.38, monthly: 820000, cumulative: 5928000 },
      { no: 'SY2025-002', name: '沈阳老旧小区改造', contract: 2900000, rate: 0.71, monthly: 175000, cumulative: 2059000 },
      { no: 'SY2025-003', name: '沈阳工业厂房建设', contract: 5400000, rate: 0.25, monthly: 290000, cumulative: 1350000 },
      { no: 'SY2025-004', name: '沈阳供热管网改造', contract: 3800000, rate: 0.48, monthly: 210000, cumulative: 1824000 }
    ]
  },
  {
    sector_code: 'SAS670',
    sector_name: '供应链板块',
    status: 'open',
    approval_node: null,
    pms: [
      { name: '张伟', status: 'open' },
      { name: '李明', status: 'open' },
      { name: '孙丽', status: 'open' }
    ],
    approvals: [],
    projects: [
      { no: 'GY2025-001', name: '供应链数字化平台', contract: 4300000, rate: 0.33, monthly: 185000, cumulative: 1419000 },
      { no: 'GY2025-002', name: '智能仓储建设项目', contract: 2600000, rate: 0.56, monthly: 145000, cumulative: 1456000 },
      { no: 'GY2025-003', name: '物流配送中心工程', contract: 7100000, rate: 0.18, monthly: 320000, cumulative: 1278000 }
    ]
  },
  {
    sector_code: 'SAS170',
    sector_name: 'PMC板块',
    status: 'closed',
    approval_node: null,
    pms: [
      { name: '周强', status: 'closed' },
      { name: '吴敏', status: 'closed' }
    ],
    approvals: [],
    projects: [
      { no: 'PMC2025-001', name: 'PMC咨询一期项目', contract: 1800000, rate: 0.92, monthly: 95000, cumulative: 1656000 },
      { no: 'PMC2025-002', name: '项目管理服务合同', contract: 3500000, rate: 0.65, monthly: 210000, cumulative: 2275000 },
      { no: 'PMC2025-003', name: '工程监理服务项目', contract: 2200000, rate: 0.78, monthly: 130000, cumulative: 1716000 }
    ]
  }
];

// 保留旧名称以向后兼容
const SEED_PERIOD = SEED_PERIOD_CURRENT;
const SEED_CONFIGS = JUNE_SEED_CONFIGS;

/**
 * 构造项目 field_data JSON
 */
function buildFieldData(proj, sectorCode, sectorName) {
  return {
    project_no: proj.no,
    project_name: proj.name,
    contract_amount: proj.contract,
    completion_rate: proj.rate,
    monthly_output: proj.monthly,
    cumulative_output: proj.cumulative,
    sector_code: sectorCode || '',
    pm_name: proj.pm || '',
    unit_code: sectorCode || '',
    unit_name: sectorName || ''
  };
}

/** 从 projects 表加载指定板块的真实项目（用于演示账号所在板块） */
function loadSectorProjectsFromDb(db, sectorCode) {
  var rows = db.prepare('SELECT project_no, payload FROM projects ORDER BY project_no ASC').all();
  var matched = [];
  rows.forEach(function (r) {
    var p;
    try { p = JSON.parse(r.payload); } catch (e) { return; }
    if (sw.projectSector(p) !== sw.normalizeSectorCode(sectorCode)) return;
    matched.push(p);
  });
  return matched;
}

/**
 * 生成审批记录的 created_at 时间戳（模拟时间先后顺序）
 */
function generateApprovalTimestamps(count, baseDate) {
  var timestamps = [];
  var base = new Date(baseDate || '2026-06-05T09:00:00');
  for (var i = 0; i < count; i++) {
    var d = new Date(base.getTime() + i * 86400000);
    timestamps.push(d.toISOString());
  }
  return timestamps;
}

/**
 * 插入单个周期的报告线数据
 */
function seedPeriod(db, period, configs, baseDate, submittedAt) {
  var latestJVersion = dbm.getMeta(db, 'latestJVersion', null);

  var insertLine = db.prepare(
    'INSERT INTO report_lines (sector_code, period, status, approval_node, baseline_version) VALUES (?, ?, ?, ?, ?)'
  );
  var insertPmStatus = db.prepare(
    'INSERT INTO report_line_pm_status (report_line_id, pm_name, status, submitted_at) VALUES (?, ?, ?, ?)'
  );
  var insertApproval = db.prepare(
    'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  var insertData = db.prepare(
    'INSERT INTO report_line_data (report_line_id, project_no, field_data, updated_by) VALUES (?, ?, ?, ?)'
  );

  var created = [];

  var tx = db.transaction(function () {
    configs.forEach(function (cfg) {
      var info = insertLine.run(
        cfg.sector_code,
        period,
        cfg.status,
        cfg.approval_node || null,
        latestJVersion
      );
      var lineId = Number(info.lastInsertRowid);

      cfg.pms.forEach(function (pm) {
        var pmSubmittedAt = null;
        if (pm.status === 'submitted') {
          pmSubmittedAt = submittedAt || '2026-06-05T10:30:00.000Z';
        }
        insertPmStatus.run(lineId, pm.name, pm.status, pmSubmittedAt);
      });

      var timestamps = generateApprovalTimestamps(cfg.approvals.length, baseDate || '2026-06-05T09:00:00');
      cfg.approvals.forEach(function (approval, idx) {
        insertApproval.run(
          lineId,
          approval.action,
          approval.actor_role,
          approval.actor_name,
          approval.comment,
          approval.from_status,
          approval.to_status,
          timestamps[idx]
        );
      });

      var projectRows = cfg.useDbProjects
        ? loadSectorProjectsFromDb(db, cfg.sector_code)
        : (cfg.projects || []);

      projectRows.forEach(function (proj) {
        var fieldData;
        var projectNo;
        var updatedBy = cfg.pms.length > 0 ? cfg.pms[0].name : '系统';
        if (cfg.useDbProjects) {
          fieldData = Object.assign({}, proj);
          projectNo = proj.project_no;
          if (proj.pm_name) updatedBy = proj.pm_name;
        } else {
          fieldData = buildFieldData(proj, cfg.sector_code, cfg.sector_name);
          projectNo = proj.no;
          if (proj.pm) {
            fieldData.pm_name = proj.pm;
            updatedBy = proj.pm;
          } else if (cfg.pms.length > 0) {
            fieldData.pm_name = cfg.pms[0].name;
          }
        }
        insertData.run(lineId, projectNo, JSON.stringify(fieldData), updatedBy);
      });

      created.push({
        id: lineId,
        sector_code: cfg.sector_code,
        sector_name: cfg.sector_name,
        status: cfg.status,
        pm_count: cfg.pms.length,
        project_count: projectRows.length,
        approval_count: cfg.approvals.length
      });
    });
  });

  tx();
  return created;
}

/**
 * 插入报告线模拟数据（2026-05 + 2026-06）
 * @param {import('better-sqlite3').Database} db
 * @param {{ force?: boolean }} [options]
 * @returns {{ seeded: boolean, count?: number }}
 */
function seedReportLines(db, options) {
  options = options || {};
  var count = db.prepare('SELECT COUNT(*) AS c FROM report_lines').get().c;
  if (count > 0 && !options.force) {
    return { seeded: false, count: count };
  }
  if (count > 0 && options.force) {
    clearReportLineSeed(db);
  }

  try {
    // 插入上月（2026-05）已完结数据
    var mayCreated = seedPeriod(db, SEED_PERIOD_PRIOR, MAY_SEED_CONFIGS,
      '2026-05-20T09:00:00', '2026-05-20T10:30:00.000Z');
    console.log('[ptrack] 报告线种子（2026-05）已插入: ' + mayCreated.length + ' 条');

    // 插入当月（2026-06）各状态演示数据
    var juneCreated = seedPeriod(db, SEED_PERIOD_CURRENT, JUNE_SEED_CONFIGS,
      '2026-06-05T09:00:00', '2026-06-05T10:30:00.000Z');
    console.log('[ptrack] 报告线种子（2026-06）已插入: ' + juneCreated.length + ' 条');
    juneCreated.forEach(function (c) {
      console.log('  - ' + c.sector_code + ' (' + c.sector_name + '): status=' + c.status +
        ', PMs=' + c.pm_count + ', projects=' + c.project_count + ', approvals=' + c.approval_count);
    });

    var total = mayCreated.length + juneCreated.length;
    return { seeded: true, count: total, details: { may: mayCreated, june: juneCreated } };
  } catch (e) {
    console.warn('[ptrack] 报告线种子数据插入失败:', e.message);
    return { seeded: false, error: e.message };
  }
}

/**
 * 清除报告线种子数据（用于重置后重新插入）
 */
function clearReportLineSeed(db) {
  db.prepare('DELETE FROM report_line_data').run();
  db.prepare('DELETE FROM report_line_approvals').run();
  db.prepare('DELETE FROM report_line_pm_status').run();
  db.prepare('DELETE FROM report_lines').run();
}

module.exports = {
  seedReportLines: seedReportLines,
  clearReportLineSeed: clearReportLineSeed,
  SEED_PERIOD: SEED_PERIOD,
  SEED_PERIOD_CURRENT: SEED_PERIOD_CURRENT,
  SEED_PERIOD_PRIOR: SEED_PERIOD_PRIOR,
  SEED_CONFIGS: SEED_CONFIGS,
  JUNE_SEED_CONFIGS: JUNE_SEED_CONFIGS,
  MAY_SEED_CONFIGS: MAY_SEED_CONFIGS
};
