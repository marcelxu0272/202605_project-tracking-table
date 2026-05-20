/**
 * field-config.js — 基于 fields-data.js 扩展角色权限矩阵
 *
 * 角色列表：system_admin | finance | sector_admin | pm | sector_director | group_leader
 * 来源类型：system_sync | auto_calc | manual_input
 *
 * 权限规则：
 *  - system_sync / auto_calc：所有人只读
 *  - manual_input：
 *      月度完成（AV–BG）：报告月当月及之后可写（含系统管理员）
 *      月度开票/回款（BH–CE）：仅报告月**之后**可写（当月为财务系统实际值，只读）
 *      其他手工列：按角色 + lockStatus；system_admin 在 locked 期仍可写
 *      finance：始终只读
 */
(function (window) {
  'use strict';

  // 开票/回款相关列（财务关注，只读）
  const FINANCE_EDITABLE_COLS = [
    'BH','BJ','BL','BN','BP','BR','BT','BV','BX','BZ','CB','CD',  // 月度开票
    'BI','BK','BM','BO','BQ','BS','BU','BW','BY','CA','CC','CE'   // 月度回款
  ];

  // 项目经理仅能编辑自己项目（由视图层按 pm_name 过滤，此处仅定义字段级权限）
  const PM_EDITABLE_COLS = new Set([
    'M',                                                           // 实施进展
    'AM','AN','AO','AR','AS','AT','AU',                           // WIP 分析
    'AV','AW','AX','AY','AZ','BA','BB','BC','BD','BE','BF','BG', // 月度完成
    'BH','BI','BJ','BK','BL','BM','BN','BO','BP','BQ',
    'BR','BS','BT','BU','BV','BW','BX','BY','BZ',
    'CA','CB','CC','CD','CE'                                       // 月度开票+回款
  ]);

  const SECTOR_ADMIN_EDITABLE_COLS = new Set([...PM_EDITABLE_COLS]);
  const FINANCE_EDITABLE_SET = new Set(FINANCE_EDITABLE_COLS);

  const MC_COLS = ['AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG'];
  const MI_COLS = ['BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV', 'BX', 'BZ', 'CB', 'CD'];
  const MP_COLS = ['BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU', 'BW', 'BY', 'CA', 'CC', 'CE'];

  /**
   * 月度完成/开票/回款列 → 0-based 月份索引（0=1月 … 11=12月），非月度列返回 -1
   */
  function getMonthlyMonthIndex(col) {
    var i = MC_COLS.indexOf(col);
    if (i >= 0) return i;
    i = MI_COLS.indexOf(col);
    if (i >= 0) return i;
    i = MP_COLS.indexOf(col);
    if (i >= 0) return i;
    return -1;
  }

  /**
   * 月度列是否落在当前角色/报告月允许编辑的时间窗内（所有角色含 system_admin 均适用）
   * - 完成额：报告月当月及之后（m >= reportingMonthIdx）
   * - 开票/回款：仅报告月之后（m > reportingMonthIdx），当月为系统同步实际值
   */
  function isMonthlyFieldEditable(field, reportingMonthIdx) {
    if (reportingMonthIdx == null || reportingMonthIdx < 0) return true;
    var col = field.col;
    var m = getMonthlyMonthIndex(col);
    if (m < 0) return true;
    if (MC_COLS.indexOf(col) >= 0) return m >= reportingMonthIdx;
    if (MI_COLS.indexOf(col) >= 0 || MP_COLS.indexOf(col) >= 0) return m > reportingMonthIdx;
    return true;
  }

  /**
   * 报告月之前的月度列只读；开票/回款在报告月当月亦只读（与 isMonthlyFieldEditable 一致，供样式用）
   * @param {number} reportingMonthIdx 0–11，与 FormulaEngine / Store.getMonthIdx 一致
   */
  function isPastReportingMonthField(field, reportingMonthIdx) {
    if (getMonthlyMonthIndex(field.col) < 0) return false;
    return !isMonthlyFieldEditable(field, reportingMonthIdx);
  }

  /**
   * 判断某字段在当前角色和锁定状态下是否可编辑
   * @param {Object} field  - field config 对象（含 source_type, col）
   * @param {string} role   - 当前用户角色
   * @param {string} lockStatus - 'open' | 'locked'（历史 finance_only 在 Store 层归一为 open）
   * @param {number} [reportingMonthIdx] 报告月份 0–11
   * @returns {boolean}
   */
  function canEdit(field, role, lockStatus, reportingMonthIdx) {
    // 系统同步/自动计算 — 永远只读
    if (field.source_type === 'system_sync' || field.source_type === 'auto_calc') {
      return false;
    }
    if (role === 'finance') return false;
    // 月度完成/开票/回款的时间窗（含 system_admin）
    if (!isMonthlyFieldEditable(field, reportingMonthIdx)) {
      return false;
    }
    if (role === 'system_admin') return true;
    if (lockStatus === 'locked') return false;
    if (role === 'sector_director' || role === 'group_leader') {
      return SECTOR_ADMIN_EDITABLE_COLS.has(field.col);
    }
    if (lockStatus === 'open') {
      if (role === 'pm') return PM_EDITABLE_COLS.has(field.col);
      if (role === 'sector_admin') return SECTOR_ADMIN_EDITABLE_COLS.has(field.col);
    }
    return false;
  }

  /**
   * 构建增强后的字段配置列表（含权限信息 + 列索引）
   */
  function buildFieldConfig() {
    if (!window.FIELD_DICTIONARY) {
      console.error('field-config: FIELD_DICTIONARY 未加载');
      return [];
    }
    return window.FIELD_DICTIONARY.map((f, idx) => {
      const isManual = f.source_type === 'manual_input';
      const isAmount = f.data_type === '金额';
      return Object.assign({}, f, {
        colIdx: idx,            // 0-based 列索引 (A=0, B=1...)
        isEditable: isManual,   // 基础可编辑标记（不考虑锁定期）
        isAmount,
        luckysheetCt: isAmount
          ? { fa: '#,##0.00', t: 'n' }
          : (f.data_type === '比率' ? { fa: '0%', t: 'n' } : { fa: '@', t: 's' }),
        luckysheetHt: isAmount ? '2' : (f.data_type === '比率' ? '2' : '0'),
        colWidth: isAmount ? 110 :
                  (f.data_type === '文本' || f.name_cn.length > 6 ? 160 : 90)
      });
    });
  }

  /**
   * 将列字母转为 0-based 索引
   */
  function colToIdx(col) {
    let idx = 0;
    for (let i = 0; i < col.length; i++) {
      idx = idx * 26 + (col.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  /**
   * 将 0-based 索引转为列字母
   */
  function idxToCol(idx) {
    let s = '';
    let n = idx + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** 按 section 分组 */
  function getSections(fields) {
    const map = {};
    fields.forEach(f => {
      if (!map[f.section]) {
        map[f.section] = { name: f.section, fields: [], startCol: f.colIdx, endCol: f.colIdx };
      }
      map[f.section].fields.push(f);
      map[f.section].endCol = Math.max(map[f.section].endCol, f.colIdx);
    });
    return Object.values(map);
  }

  /** 项目字段key映射（col字母 → JS字段名）*/
  const COL_TO_KEY = {
    A: 'new_existing', B: 'start_date', C: 'end_date', D: 'unit_code',
    E: 'pm_name', F: 'project_no', G: 'project_name', H: 'client_name',
    I: 'enterprise_type', J: 'industry', K: 'business_type',
    L: 'signed', M: 'progress',
    N: 'prev_year_contract', O: 'adj_value', P: 'total_contract', Q: 'contract_excl_tax',
    R: 'contract_minus_invoice', S: 'contract_minus_completed',
    T: 'prev_year_completion', U: 'cum_completed', V: 'opening_backlog',
    W: 'current_completed', X: 'ytd_completed', Y: 'tax_rate', Z: 'ytd_completed_excl_tax',
    AA: 'prev_year_invoice', AB: 'ytd_invoice', AC: 'cum_invoice',
    AD: 'prev_year_payment', AE: 'ytd_payment', AF: 'cum_payment',
    AG: 'wip_incl_tax', AH: 'wip_excl_tax', AI: 'ar_incl_advance',
    AJ: 'ar_for_collection', AK: 'opening_ar', AL: 'wip_pending_invoice',
    AM: 'wip_cause', AN: 'cause_desc', AO: 'high_risk_wip',
    AP: 'opening_wip', AQ: 'wip_3mo_plus', AR: 'wip_3mo_adjusted',
    AS: 'factor_analysis', AT: 'action_plan', AU: 'forecast_invoice_date',
    AV: 'mc_0', AW: 'mc_1', AX: 'mc_2', AY: 'mc_3', AZ: 'mc_4',
    BA: 'mc_5', BB: 'mc_6', BC: 'mc_7', BD: 'mc_8', BE: 'mc_9', BF: 'mc_10', BG: 'mc_11',
    BH: 'mi_0', BI: 'mp_0', BJ: 'mi_1', BK: 'mp_1', BL: 'mi_2', BM: 'mp_2',
    BN: 'mi_3', BO: 'mp_3', BP: 'mi_4', BQ: 'mp_4', BR: 'mi_5', BS: 'mp_5',
    BT: 'mi_6', BU: 'mp_6', BV: 'mi_7', BW: 'mp_7', BX: 'mi_8', BY: 'mp_8',
    BZ: 'mi_9', CA: 'mp_9', CB: 'mi_10', CC: 'mp_10', CD: 'mi_11', CE: 'mp_11'
  };

  /**
   * 将扁平的 mc_0..mc_11 / mi_0..mp_11 键合并为 monthly_completion / monthly_invoice / monthly_payment 数组
   */
  function flatToArrays(flatProject) {
    const p = Object.assign({}, flatProject);
    p.monthly_completion = Array(12).fill(0).map((_, i) => p['mc_' + i] || 0);
    p.monthly_invoice    = Array(12).fill(0).map((_, i) => p['mi_' + i] || 0);
    p.monthly_payment    = Array(12).fill(0).map((_, i) => p['mp_' + i] || 0);
    return p;
  }

  /**
   * 将 monthly_completion/invoice/payment 数组展开为 mc_0..mc_11 等扁平键
   */
  function arraysToFlat(project) {
    const p = Object.assign({}, project);
    (p.monthly_completion || []).forEach((v, i) => { p['mc_' + i] = v; });
    (p.monthly_invoice    || []).forEach((v, i) => { p['mi_' + i] = v; });
    (p.monthly_payment    || []).forEach((v, i) => { p['mp_' + i] = v; });
    return p;
  }

  window.FieldConfig = {
    canEdit,
    buildFieldConfig,
    colToIdx,
    idxToCol,
    getSections,
    COL_TO_KEY,
    flatToArrays,
    arraysToFlat,
    FINANCE_EDITABLE_SET,
    MC_COLS,
    MI_COLS,
    MP_COLS,
    getMonthlyMonthIndex,
    isMonthlyFieldEditable,
    isPastReportingMonthField
  };
})(window);
