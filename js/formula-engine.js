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

    // ── 栏位 A: 新旧项目 ─────────────────────────────────
    const signYear = r.sign_year || (r.start_date ? parseInt(r.start_date.slice(0, 4)) : SYSTEM_YEAR);
    r.new_existing = (signYear >= SYSTEM_YEAR) ? '新项目' : '旧项目';

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

  /**
   * 汇总看板数据
   */
  function summarize(projects, monthIdx) {
    const computed = computeAll(projects, monthIdx);

    const totalContract   = computed.reduce((s, p) => s + (p.total_contract || 0), 0);
    const currentMonth    = computed.reduce((s, p) => s + (p.current_completed || 0), 0);
    const ytdCompleted    = computed.reduce((s, p) => s + (p.ytd_completed || 0), 0);
    const totalWip        = computed.reduce((s, p) => s + Math.max(p.wip_incl_tax || 0, 0), 0);
    const totalCumInvoice = computed.reduce((s, p) => s + (p.cum_invoice || 0), 0);
    const invoiceRate     = totalContract > 0 ? totalCumInvoice / totalContract : 0;

    // 月度完成趋势 (1-12月)
    const monthlyTotals = Array(12).fill(0).map((_, i) =>
      computed.reduce((s, p) => s + ((p.monthly_completion || [])[i] || 0), 0)
    );

    // 月度开票/回款趋势
    const monthlyInvoice = Array(12).fill(0).map((_, i) =>
      computed.reduce((s, p) => s + ((p.monthly_invoice || [])[i] || 0), 0)
    );
    const monthlyPayment = Array(12).fill(0).map((_, i) =>
      computed.reduce((s, p) => s + ((p.monthly_payment || [])[i] || 0), 0)
    );

    // WIP 账龄分布（按项目 WIP 金额与账龄分类简化分配）
    const wipByAge = { lt1m: 0, m1to3: 0, m3to6: 0, m6to12: 0, y1to2: 0, y2to3: 0, gt3y: 0 };
    computed.forEach(p => {
      const wip = p.wip_incl_tax || 0;
      if (wip <= 0) return;
      // 简化：根据项目 WIP 形成原因和开始时间粗略分配
      const cause = p.wip_cause || '';
      if (cause.startsWith('A')) wipByAge.lt1m += wip * 0.6;
      else if (cause.startsWith('B')) wipByAge.m1to3 += wip * 0.7;
      else if (cause.startsWith('C')) wipByAge.m3to6 += wip;
      else wipByAge.m6to12 += wip;
    });

    // WIP 预警（WIP > 合同额 50%）
    const wipAlerts = computed
      .filter(p => p.wip_incl_tax > 0 && p.total_contract > 0 &&
                   p.wip_incl_tax / p.total_contract > 0.5)
      .map(p => ({
        id: p.project_no,
        name: p.project_name,
        wip: p.wip_incl_tax,
        contract: p.total_contract,
        ratio: p.wip_incl_tax / p.total_contract
      }))
      .sort((a, b) => b.ratio - a.ratio);

    return {
      totalContract, currentMonth, ytdCompleted,
      totalWip, totalCumInvoice, invoiceRate,
      monthlyTotals, monthlyInvoice, monthlyPayment,
      wipByAge, wipAlerts, computed
    };
  }

  window.FormulaEngine = { compute, computeAll, getMonthIdx, summarize };
})(window);
