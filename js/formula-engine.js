/**
 * formula-engine.js — 项目字段公式计算引擎
 * 接受 project 对象 + 当前报告月份索引，返回补算后的完整 project 对象
 *
 * 报告月份约定：reportingMonthIdx = 0..11 (0=1月, 4=5月...)
 */
(function (window) {
  'use strict';

  /** 当前系统报告年份 */
  const SYSTEM_YEAR = 2026;

  /**
   * 计算单个项目所有派生字段
   * @param {Object} p  - 原始项目数据（含手工填报 + 系统同步字段）
   * @param {number} monthIdx - 报告月份索引 0~11
   * @returns {Object} 包含所有计算字段的新对象
   */
  function compute(p, monthIdx) {
    const r = Object.assign({}, p);

    // ── 辅助 ─────────────────────────────────────────────
    const mc = r.monthly_completion  || Array(12).fill(0);  // AV-BG
    const mi = r.monthly_invoice     || Array(12).fill(0);  // BH,BJ,...
    const mp = r.monthly_payment     || Array(12).fill(0);  // BI,BK,...
    const Y  = r.tax_rate            || 0.09;                // 税率
    const N  = r.prev_year_contract  || 0;                   // N
    const P  = r.total_contract      || 0;                   // P
    const T  = r.prev_year_completion|| 0;                   // T
    const AA = r.prev_year_invoice   || 0;                   // AA
    const AD = r.prev_year_payment   || 0;                   // AD

    // ── 栏位 L: 合同签署状态 ─────────────────────────────
    r.signed = (r.crb_status === '已确认' || r.signed === '已签署') ? '已签署' : '未签署';

    // ── 合同额区 (O, Q) ──────────────────────────────────
    r.adj_value         = P - N;                            // O = P - N
    r.contract_excl_tax = P / (1 + Y);                     // Q = P/(1+Y)

    // ── 年度完成区 (W, X, Z) ─────────────────────────────
    // X = SUM(1月..报告当月)
    r.ytd_completed     = mc.slice(0, monthIdx + 1).reduce((a, b) => a + (b || 0), 0); // X
    r.current_completed = mc[monthIdx] || 0;                // W
    r.ytd_completed_excl_tax = r.ytd_completed / (1 + Y);  // Z

    // ── 始累完成 (U, V) ──────────────────────────────────
    r.cum_completed  = T + r.ytd_completed;                 // U = T + X
    r.opening_backlog = N - T;                              // V = N - T

    // ── 开票回款区 (AB, AC, AE, AF) ──────────────────────
    r.ytd_invoice   = mi.slice(0, monthIdx + 1).reduce((a, b) => a + (b || 0), 0); // AB
    r.cum_invoice   = AA + r.ytd_invoice;                   // AC = AA + AB
    r.ytd_payment   = mp.slice(0, monthIdx + 1).reduce((a, b) => a + (b || 0), 0); // AE
    r.cum_payment   = AD + r.ytd_payment;                   // AF = AD + AE

    // ── 合同差值 (R, S) ──────────────────────────────────
    r.contract_minus_invoice   = P - r.cum_invoice;         // R = P - AC
    r.contract_minus_completed = P - r.cum_completed;       // S = P - U

    // ── 财务 WIP / 应收 (AG, AH, AI) ─────────────────────
    r.wip_incl_tax      = r.cum_completed - r.cum_invoice;  // AG = U - AC
    r.wip_excl_tax      = r.wip_incl_tax / (1 + Y);        // AH = AG/(1+Y)
    r.ar_incl_advance   = r.cum_invoice - r.cum_payment;    // AI = AC - AF

    // ── 催收/催开票 (AJ, AK, AL) ────────────────────────
    r.ar_for_collection   = Math.max(r.ar_incl_advance, 0); // AJ = MAX(AI,0)
    r.opening_ar          = Math.max(AA - AD, 0);           // AK = MAX(AA-AD,0)
    r.wip_pending_invoice = Math.max(r.wip_incl_tax, 0);    // AL = MAX(AG,0)

    // ── WIP 分析 (AP, AQ) ────────────────────────────────
    r.opening_wip = Math.max(T - AA, 0);                    // AP = MAX(T-AA,0)

    // AQ: 3个月以上WIP 简化计算
    // 逻辑：WIP 余额 - 近3个月（含当月）产值之和，取正数
    const last3 = mc.slice(Math.max(0, monthIdx - 2), monthIdx + 1)
                    .reduce((a, b) => a + (b || 0), 0);
    r.wip_3mo_plus = Math.max(r.wip_incl_tax - last3, 0);  // AQ

    return r;
  }

  /**
   * 批量计算所有项目
   */
  function computeAll(projects, monthIdx) {
    return projects.map(p => compute(p, monthIdx));
  }

  /**
   * 获取报告月份索引（0-indexed）
   * @param {string} reportingMonth  'YYYY-MM'
   * @returns {number}
   */
  function getMonthIdx(reportingMonth) {
    if (!reportingMonth) return new Date().getMonth();
    const parts = reportingMonth.split('-');
    return parseInt(parts[1]) - 1;
  }

  window.FormulaEngine = { compute, computeAll, getMonthIdx };
})(window);
