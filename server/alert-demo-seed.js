'use strict';

/**
 * 为演示环境注入四类 Drawer/表格预警场景（见 docs/需求文档/线上化需求.md §2.12.11）
 */
const dbm = require('./db');

/** 各预警类型对应的演示项目号（初始数据约 20 条库内项目，避开 demoNew 固定 5 条） */
const ALERT_DEMO_PROJECTS = {
  invoice_exceeds_contract: 'B25001-0042',
  payment_exceeds_contract: 'B25126-0003',
  payment_exceeds_invoice: 'B25340',
  contract_stock_negative: 'B24264-0038',
  completion_no_hours: 'B25126-0003',
  hours_no_completion: 'B25340',
  /** 金山中心 · 宋建生：同一项目同时命中多条预警（R + S + 有完成额无工时） */
  multi_alert: 'B24264-0039'
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

  var invoiceP = findProject(list, ALERT_DEMO_PROJECTS.invoice_exceeds_contract);
  if (invoiceP) {
    var pInv = Number(invoiceP.total_contract) || 10000;
    invoiceP.prev_year_invoice = pInv + 8000;
  }

  var paymentContractP = findProject(list, ALERT_DEMO_PROJECTS.payment_exceeds_contract);
  if (paymentContractP) {
    var pPayCon = Number(paymentContractP.total_contract) || 16712;
    paymentContractP.prev_year_payment = pPayCon + 5000;
    paymentContractP.prev_year_invoice = Math.max(0, pPayCon - 2000);
  }

  var paymentInvoiceP = findProject(list, ALERT_DEMO_PROJECTS.payment_exceeds_invoice);
  if (paymentInvoiceP) {
    var pPayInv = Number(paymentInvoiceP.total_contract) || 10000;
    paymentInvoiceP.prev_year_invoice = 6000;
    paymentInvoiceP.prev_year_payment = 9000;
    if (pPayInv < 10000) {
      paymentInvoiceP.prev_year_contract = 8000;
      paymentInvoiceP.adj_value = 2000;
    }
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

  // 同一项目多预警：累计开票超总合同额 + 存量合同额为负 + 有完成额无工时
  var multiP = findProject(list, ALERT_DEMO_PROJECTS.multi_alert);
  if (multiP) {
    var pMulti = Number(multiP.total_contract) || 9720;
    multiP.prev_year_invoice = pMulti + 6000;
    multiP.prev_year_completion = 0;
    var mcMulti = ensureMonthlyArray(multiP, 'monthly_completion');
    for (var k = 0; k < 12; k++) mcMulti[k] = 0;
    mcMulti[monthIdx] = pMulti + 3000;
  }

  return list.map(function (p) {
    return FormulaEngine.compute(p, monthIdx);
  });
}

function buildHoursNoCompletionTimesheet(projectNo, year, monthIdx) {
  year = year || 2026;
  monthIdx = monthIdx == null ? 4 : monthIdx;
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var ym = year + '-' + pad(monthIdx + 1);
  var prevYm = monthIdx === 0
    ? (year - 1) + '-12'
    : year + '-' + pad(monthIdx);
  return [
    {
      work_date: prevYm + '-22',
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
      work_date: ym + '-06',
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
      work_date: ym + '-14',
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
      work_date: ym + '-21',
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
 * - contract_stock_negative：注入少量报告月工时，避免同时命中「有完成额无工时」
 * - hours_no_completion：注入报告月已审工时、报告月完成额为 0
 * - multi_alert：仅注入非报告月工时，使工时统计对象存在但报告月工时为 0 →「有完成额无工时」
 */
function seedAlertDemoTimesheets(db, options) {
  options = options || {};
  var reportingMonth = options.reportingMonth
    || dbm.getMeta(db, 'reportingMonth')
    || '2026-05';
  var year = parseInt(String(reportingMonth).slice(0, 4), 10) || 2026;
  var monthIdx = Math.max(0, Math.min(11, (parseInt(String(reportingMonth).slice(5, 7), 10) || 5) - 1));
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var reportMonthDate = year + '-' + pad(monthIdx + 1) + '-10';
  // 非报告月：优先用 1 月；若报告月就是 1 月则用 2 月
  var offMonthIdx = monthIdx === 0 ? 1 : 0;
  var offMonthDate = year + '-' + pad(offMonthIdx + 1) + '-15';

  var completionNo = ALERT_DEMO_PROJECTS.completion_no_hours;
  var contractNeg = ALERT_DEMO_PROJECTS.contract_stock_negative;
  var hoursNo = ALERT_DEMO_PROJECTS.hours_no_completion;
  var multiNo = ALERT_DEMO_PROJECTS.multi_alert;

  dbm.replaceProjectTimesheet(db, completionNo, []);
  dbm.replaceProjectTimesheet(db, contractNeg, [
    {
      project_no: contractNeg,
      work_date: reportMonthDate,
      profession: '建筑',
      engineer_sector: 'S520',
      engineer: '演示·陈工',
      approved_hours: 4,
      approved_cost: 800,
      remark: '预警演示：存量合同额为负（有少量工时）'
    }
  ]);
  dbm.replaceProjectTimesheet(db, hoursNo, buildHoursNoCompletionTimesheet(hoursNo, year, monthIdx));
  // 非报告月有工时、报告月无工时 → 可算出「有完成额无工时」；避免空工时导致 tsStats 缺失
  dbm.replaceProjectTimesheet(db, multiNo, [
    {
      project_no: multiNo,
      work_date: offMonthDate,
      profession: '仪表',
      engineer_sector: 'S520',
      engineer: '演示·宋建生项目',
      approved_hours: 2,
      approved_cost: 400,
      remark: '预警演示：多预警同项目（非报告月工时）'
    }
  ]);

  return {
    cleared: completionNo,
    contractStockSeeded: contractNeg,
    seeded: hoursNo,
    multiAlert: multiNo,
    reportingMonth: reportingMonth,
    mayHours: buildHoursNoCompletionTimesheet(hoursNo, year, monthIdx)
      .filter(function (r) {
        return String(r.work_date).slice(0, 7) === (year + '-' + pad(monthIdx + 1));
      })
      .reduce(function (s, r) { return s + (r.approved_hours || 0); }, 0)
  };
}

module.exports = {
  ALERT_DEMO_PROJECTS,
  applyAlertDemoPatches,
  seedAlertDemoTimesheets
};
