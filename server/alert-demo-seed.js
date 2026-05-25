'use strict';

/**
 * 为演示环境注入四类 Drawer/表格预警场景（见 docs/需求文档/线上化需求.md §2.12.11）
 */
const dbm = require('./db');

/** 各预警类型对应的演示项目号（初始数据约 20 条库内项目，避开 demoNew 固定 5 条） */
const ALERT_DEMO_PROJECTS = {
  invoice_stock_negative: 'B25001-0042',
  contract_stock_negative: 'B24264-0038',
  completion_no_hours: 'B25126-0003',
  hours_no_completion: 'B25340'
};

function ensureMonthlyArray(project, key) {
  var arr = Array(12).fill(0);
  if (Array.isArray(project[key])) {
    project[key].forEach(function (v, i) {
      if (i < 12) arr[i] = Number(v) || 0;
    });
  }
  project[key] = arr;
  return arr;
}

function findProject(projects, projectNo) {
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].project_no === projectNo) return projects[i];
  }
  return null;
}

/**
 * 在导入/重置后改写指定项目字段，并重算公式
 * @param {Array<object>} projects
 * @param {{ FormulaEngine: object }} modules
 * @param {string} reportingMonth
 */
function applyAlertDemoPatches(projects, modules, reportingMonth) {
  var FormulaEngine = modules.FormulaEngine;
  var monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');
  var list = (projects || []).slice();

  var invoiceP = findProject(list, ALERT_DEMO_PROJECTS.invoice_stock_negative);
  if (invoiceP) {
    var pInv = Number(invoiceP.total_contract) || 10000;
    invoiceP.prev_year_invoice = pInv + 8000;
  }

  var contractP = findProject(list, ALERT_DEMO_PROJECTS.contract_stock_negative);
  if (contractP) {
    var pCon = Number(contractP.total_contract) || 9720;
    var mcCon = ensureMonthlyArray(contractP, 'monthly_completion');
    contractP.prev_year_completion = pCon - 2000;
    for (var i = 0; i < 12; i++) mcCon[i] = 0;
    mcCon[monthIdx] = 5000;
  }

  var completionP = findProject(list, ALERT_DEMO_PROJECTS.completion_no_hours);
  if (completionP) {
    var pComp = Number(completionP.total_contract) || 16712;
    var mcComp = ensureMonthlyArray(completionP, 'monthly_completion');
    for (var j = 0; j < 12; j++) mcComp[j] = 0;
    // 报告月有完成额，但累计完成不超过合同额，避免误触 S 列预警
    mcComp[monthIdx] = Math.min(12000, Math.max(5000, Math.floor(pComp * 0.45)));
  }

  var hoursP = findProject(list, ALERT_DEMO_PROJECTS.hours_no_completion);
  if (hoursP) {
    var mcHours = ensureMonthlyArray(hoursP, 'monthly_completion');
    mcHours[monthIdx] = 0;
  }

  return list.map(function (p) {
    return FormulaEngine.compute(p, monthIdx);
  });
}

function buildHoursNoCompletionTimesheet(projectNo) {
  return [
    {
      work_date: '2026-04-22',
      profession: '建筑',
      engineer_sector: 'S520',
      engineer: '演示·李工',
      unit_no: '',
      unit_name: '方案设计',
      approved_hours: 12,
      approved_cost: 2400,
      rate: 200,
      remark: '预警演示：有工时无完成额'
    },
    {
      work_date: '2026-05-06',
      profession: '建筑',
      engineer_sector: 'S520',
      engineer: '演示·李工',
      unit_no: '',
      unit_name: '施工图',
      approved_hours: 18.5,
      approved_cost: 3700,
      rate: 200,
      remark: '预警演示：报告月有工时、无完成额'
    },
    {
      work_date: '2026-05-14',
      profession: '结构',
      engineer_sector: 'S520',
      engineer: '演示·王工',
      unit_no: '',
      unit_name: '结构配合',
      approved_hours: 8,
      approved_cost: 1760,
      rate: 220,
      remark: '预警演示'
    },
    {
      work_date: '2026-05-21',
      profession: '给排水',
      engineer_sector: 'S520',
      engineer: '演示·赵工',
      unit_no: '',
      unit_name: '机电配合',
      approved_hours: 6,
      approved_cost: 1200,
      rate: 200,
      remark: '预警演示'
    }
  ].map(function (r) {
    return Object.assign({ project_no: projectNo }, r);
  });
}

/**
 * 写入/覆盖演示用工时明细
 * - completion_no_hours：清空（报告月无工时）
 * - contract_stock_negative：注入少量 May 工时，避免同时命中「有完成额无工时」
 * - hours_no_completion：注入 May 已审工时、报告月完成额为 0
 */
function seedAlertDemoTimesheets(db) {
  var completionNo = ALERT_DEMO_PROJECTS.completion_no_hours;
  var contractNeg = ALERT_DEMO_PROJECTS.contract_stock_negative;
  var hoursNo = ALERT_DEMO_PROJECTS.hours_no_completion;

  dbm.replaceProjectTimesheet(db, completionNo, []);
  dbm.replaceProjectTimesheet(db, contractNeg, [
    {
      project_no: contractNeg,
      work_date: '2026-05-10',
      profession: '建筑',
      engineer_sector: 'S520',
      engineer: '演示·陈工',
      approved_hours: 4,
      approved_cost: 800,
      remark: '预警演示：存量合同额为负（有少量工时）'
    }
  ]);
  dbm.replaceProjectTimesheet(db, hoursNo, buildHoursNoCompletionTimesheet(hoursNo));

  return {
    cleared: completionNo,
    contractStockSeeded: contractNeg,
    seeded: hoursNo,
    mayHours: buildHoursNoCompletionTimesheet(hoursNo)
      .filter(function (r) { return String(r.work_date).slice(0, 7) === '2026-05'; })
      .reduce(function (s, r) { return s + (r.approved_hours || 0); }, 0)
  };
}

module.exports = {
  ALERT_DEMO_PROJECTS,
  applyAlertDemoPatches,
  seedAlertDemoTimesheets
};
