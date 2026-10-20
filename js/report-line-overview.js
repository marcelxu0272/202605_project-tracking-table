(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReportLineOverview = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  var EPS = 0.005;

  function toNumber(value) {
    if (value == null || value === '') return 0;
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function sumBy(list, getter) {
    var total = 0;
    (list || []).forEach(function (item) { total += toNumber(getter(item)); });
    return total;
  }

  function throughMonthTotal(flat, prefix, monthIdx) {
    var total = 0;
    var end = Math.min(11, Math.max(0, monthIdx));
    for (var i = 0; i <= end; i++) total += toNumber(flat[prefix + i]);
    return total;
  }

  function futureTotal(flat, prefix, monthIdx) {
    var total = 0;
    var start = Math.max(0, monthIdx + 1);
    for (var i = start; i < 12; i++) total += toNumber(flat[prefix + i]);
    return total;
  }

  function toFlat(project) {
    if (!project) return {};
    if (typeof FieldConfig !== 'undefined' && FieldConfig.arraysToFlat) {
      return FieldConfig.arraysToFlat(project);
    }
    return Object.assign({}, project);
  }

  function toComputed(project, monthIdx) {
    if (!project) return {};
    if (typeof FormulaEngine !== 'undefined' && FormulaEngine.compute) {
      return FormulaEngine.compute(Object.assign({}, project), monthIdx);
    }
    return Object.assign({}, project);
  }

  function buildKpi(flatProjects, monthIdx) {
    function aggregate(kind) {
      var prefix = kind === 'completion' ? 'mc_' : (kind === 'invoice' ? 'mi_' : 'mp_');
      var prevKey = kind === 'completion' ? 'prev_year_completion' : (kind === 'invoice' ? 'prev_year_invoice' : 'prev_year_payment');
      var current = sumBy(flatProjects, function (flat) { return flat[prefix + monthIdx]; });
      var ytd = sumBy(flatProjects, function (flat) { return throughMonthTotal(flat, prefix, monthIdx); });
      var future = sumBy(flatProjects, function (flat) { return futureTotal(flat, prefix, monthIdx); });
      var prevYear = sumBy(flatProjects, function (flat) { return flat[prevKey]; });
      return {
        current: current,
        ytd: ytd,
        future: future,
        prevYear: prevYear,
        cumulative: prevYear + ytd
      };
    }
    return [
      { key: 'completion', label: '完成合同额', sourceType: 'manual', values: aggregate('completion') },
      { key: 'invoice', label: '完成开票额', sourceType: 'system_ref', values: aggregate('invoice') },
      { key: 'payment', label: '完成回款额', sourceType: 'system_ref', values: aggregate('payment') }
    ];
  }

  function buildMonthlyTrend(flatProjects) {
    var completion = [];
    var invoice = [];
    var payment = [];
    for (var i = 0; i < 12; i++) {
      completion.push(sumBy(flatProjects, function (flat) { return flat['mc_' + i]; }));
      invoice.push(sumBy(flatProjects, function (flat) { return flat['mi_' + i]; }));
      payment.push(sumBy(flatProjects, function (flat) { return flat['mp_' + i]; }));
    }
    return {
      months: MONTH_LABELS.slice(),
      completion: completion,
      invoice: invoice,
      payment: payment
    };
  }

  function buildPmSummary(projects, monthIdx) {
    var groups = {};
    (projects || []).forEach(function (project) {
      var pmName = project.pm_name || '未分配';
      var flat = toFlat(project);
      var entry = groups[pmName];
      if (!entry) {
        entry = groups[pmName] = {
          pmName: pmName,
          projectCount: 0,
          current: { c: 0, i: 0, p: 0 },
          ytd: { c: 0, i: 0, p: 0 },
          future: { c: 0, i: 0, p: 0 }
        };
      }
      entry.projectCount += 1;
      entry.current.c += toNumber(flat['mc_' + monthIdx]);
      entry.current.i += toNumber(flat['mi_' + monthIdx]);
      entry.current.p += toNumber(flat['mp_' + monthIdx]);
      entry.ytd.c += throughMonthTotal(flat, 'mc_', monthIdx);
      entry.ytd.i += throughMonthTotal(flat, 'mi_', monthIdx);
      entry.ytd.p += throughMonthTotal(flat, 'mp_', monthIdx);
      entry.future.c += futureTotal(flat, 'mc_', monthIdx);
      entry.future.i += futureTotal(flat, 'mi_', monthIdx);
      entry.future.p += futureTotal(flat, 'mp_', monthIdx);
    });
    var allCurrentCompletion = sumBy(Object.keys(groups), function (name) { return groups[name].current.c; });
    var allYtdCompletion = sumBy(Object.keys(groups), function (name) { return groups[name].ytd.c; });
    return Object.keys(groups).map(function (name) {
      var row = groups[name];
      row.sharePctCurrent = allCurrentCompletion > EPS ? row.current.c / allCurrentCompletion : 0;
      row.sharePctYtd = allYtdCompletion > EPS ? row.ytd.c / allYtdCompletion : 0;
      return row;
    }).sort(function (a, b) {
      return b.ytd.c - a.ytd.c;
    });
  }

  function buildBacklog(computedProjects, flatProjects, monthIdx) {
    var totalContract = sumBy(flatProjects, function (flat) { return flat.total_contract; });
    var contractStock = sumBy(computedProjects, function (p) { return p.contract_minus_completed; });
    var invoiceStock = sumBy(computedProjects, function (p) { return p.contract_minus_invoice; });
    var ytdCompletion = sumBy(flatProjects, function (flat) { return throughMonthTotal(flat, 'mc_', monthIdx); });
    var forecastCompletion = sumBy(flatProjects, function (flat) { return futureTotal(flat, 'mc_', monthIdx); });
    return {
      totalContract: totalContract,
      contractStock: contractStock,
      invoiceStock: invoiceStock,
      fullYearForecastCompletion: ytdCompletion + forecastCompletion
    };
  }

  function attachPeriodDeltas(kpis, backlog, baselineProjects, monthIdx) {
    var completion = (kpis || []).find(function (item) { return item.key === 'completion'; });
    if (completion) completion.values.deltaCurrent = null;
    backlog.deltaContractStock = null;
    backlog.deltaInvoiceStock = null;
    backlog.deltaFullYearForecastCompletion = null;
    if (!baselineProjects || !baselineProjects.length) return;
    var baseComputed = baselineProjects.map(function (p) { return toComputed(p, monthIdx); });
    var baseFlat = baseComputed.map(toFlat);
    var baseKpis = buildKpi(baseFlat, monthIdx);
    var baseBacklog = buildBacklog(baseComputed, baseFlat, monthIdx);
    var baseCompletion = baseKpis.find(function (item) { return item.key === 'completion'; });
    if (completion && baseCompletion) {
      completion.values.deltaCurrent = toNumber(completion.values.current) - toNumber(baseCompletion.values.current);
    }
    backlog.deltaContractStock = toNumber(backlog.contractStock) - toNumber(baseBacklog.contractStock);
    backlog.deltaInvoiceStock = toNumber(backlog.invoiceStock) - toNumber(baseBacklog.invoiceStock);
    backlog.deltaFullYearForecastCompletion = toNumber(backlog.fullYearForecastCompletion) - toNumber(baseBacklog.fullYearForecastCompletion);
  }

  function projectChangedFieldCount(project) {
    var log = project && project._field_change_log;
    if (!log || typeof log !== 'object') return 0;
    return Object.keys(log).length;
  }

  function projectChangeDiffCount(project) {
    var changes = project && project._changed_fields;
    if (Array.isArray(changes)) return changes.length;
    return 0;
  }

  function buildDiffSummary(currentProjects, baselineProjects, monthIdx, topN) {
    var currentComputed = (currentProjects || []).map(function (p) { return toComputed(p, monthIdx); });
    var baselineComputed = (baselineProjects || []).map(function (p) { return toComputed(p, monthIdx); });
    var currentByNo = {};
    var baselineByNo = {};
    currentComputed.forEach(function (p) { currentByNo[p.project_no] = p; });
    baselineComputed.forEach(function (p) { baselineByNo[p.project_no] = p; });

    var allNos = {};
    Object.keys(currentByNo).forEach(function (no) { allNos[no] = true; });
    Object.keys(baselineByNo).forEach(function (no) { allNos[no] = true; });

    var changedProjects = 0;
    var newProjects = 0;
    var topProjects = [];
    var deltaContract = 0;
    var deltaYtdCompletion = 0;
    var deltaFullYearForecast = 0;

    Object.keys(allNos).forEach(function (projectNo) {
      var curr = currentByNo[projectNo] || {};
      var base = baselineByNo[projectNo] || {};
      var currFlat = toFlat(curr);
      var baseFlat = toFlat(base);
      var dc = toNumber(currFlat.total_contract) - toNumber(baseFlat.total_contract);
      var dytd = throughMonthTotal(currFlat, 'mc_', monthIdx) - throughMonthTotal(baseFlat, 'mc_', monthIdx);
      var dfull = (throughMonthTotal(currFlat, 'mc_', monthIdx) + futureTotal(currFlat, 'mc_', monthIdx))
        - (throughMonthTotal(baseFlat, 'mc_', monthIdx) + futureTotal(baseFlat, 'mc_', monthIdx));

      if (Math.abs(dc) > EPS || Math.abs(dytd) > EPS || Math.abs(dfull) > EPS) changedProjects += 1;
      if (!baselineByNo[projectNo] && currentByNo[projectNo]) newProjects += 1;

      deltaContract += dc;
      deltaYtdCompletion += dytd;
      deltaFullYearForecast += dfull;

      if (currentByNo[projectNo]) {
        topProjects.push({
          projectNo: projectNo,
          projectName: curr.project_name || base.project_name || '',
          pmName: curr.pm_name || base.pm_name || '',
          monthCompletion: toNumber(currFlat['mc_' + monthIdx]),
          monthInvoice: toNumber(currFlat['mi_' + monthIdx]),
          monthPayment: toNumber(currFlat['mp_' + monthIdx]),
          totalContract: toNumber(currFlat.total_contract),
          deltaYtdCompletion: dytd,
          deltaContract: dc,
          changedFieldCount: Math.max(projectChangedFieldCount(curr), projectChangeDiffCount(curr))
        });
      }
    });

    topProjects.sort(function (a, b) {
      return (b.monthCompletion || 0) - (a.monthCompletion || 0);
    });

    function pct(delta, base) {
      if (Math.abs(base) < EPS) return null;
      return delta / base;
    }

    var baselineContractTotal = sumBy(baselineComputed, function (p) { return toFlat(p).total_contract; });
    var baselineYtdTotal = sumBy(baselineComputed, function (p) { return throughMonthTotal(toFlat(p), 'mc_', monthIdx); });
    var baselineFullYear = sumBy(baselineComputed, function (p) {
      var flat = toFlat(p);
      return throughMonthTotal(flat, 'mc_', monthIdx) + futureTotal(flat, 'mc_', monthIdx);
    });

    return {
      changedProjects: changedProjects,
      newProjects: newProjects,
      deltaContract: deltaContract,
      deltaYtdCompletion: deltaYtdCompletion,
      deltaFullYearForecast: deltaFullYearForecast,
      deltaContractPct: pct(deltaContract, baselineContractTotal),
      deltaYtdCompletionPct: pct(deltaYtdCompletion, baselineYtdTotal),
      deltaFullYearForecastPct: pct(deltaFullYearForecast, baselineFullYear),
      topProjects: topProjects
    };
  }

  function pushAttention(list, project, type, label) {
    list.push({
      projectNo: project.project_no || '',
      projectName: project.project_name || '',
      pmName: project.pm_name || '',
      type: type,
      label: label
    });
  }

  /**
   * 与预警抽屉同一套六类预警：同一项目多条预警各占一行，不去重到项目。
   * 工时类预警需 timesheetReady；概览页会再用接口结果覆盖。
   */
  function buildAttention(projects, monthIdx, timesheetByProject) {
    var list = [];
    var tsMap = timesheetByProject || {};
    (projects || []).forEach(function (project) {
      if (!project) return;
      var pno = project.project_no || '';
      var tsStats = tsMap[pno] || null;
      if (typeof ProjectAlerts !== 'undefined' && ProjectAlerts.getProjectAlerts) {
        var alerts = ProjectAlerts.getProjectAlerts(project, monthIdx, tsStats, {
          timesheetReady: !!tsStats
        }) || [];
        alerts.forEach(function (a) {
          pushAttention(list, project, a.id, a.label);
        });
        return;
      }
      if (typeof StockValidation === 'undefined') return;
      if (StockValidation.hasInvoiceExceedsContract && StockValidation.hasInvoiceExceedsContract(project, monthIdx)) {
        pushAttention(list, project, 'invoice_exceeds_contract', '累计开票超总合同额');
      }
      if (StockValidation.hasPaymentExceedsContract && StockValidation.hasPaymentExceedsContract(project, monthIdx)) {
        pushAttention(list, project, 'payment_exceeds_contract', '累计回款超总合同额');
      }
      if (StockValidation.hasPaymentExceedsInvoice && StockValidation.hasPaymentExceedsInvoice(project, monthIdx)) {
        pushAttention(list, project, 'payment_exceeds_invoice', '累计回款超累计开票');
      }
      if (StockValidation.hasContractStockViolation && StockValidation.hasContractStockViolation(project, monthIdx)) {
        pushAttention(list, project, 'contract_stock_negative', '存量合同额为负');
      }
    });

    var counts = {};
    list.forEach(function (item) {
      counts[item.type] = (counts[item.type] || 0) + 1;
    });
    return { items: list, counts: counts, total: list.length };
  }

  /** 绝对值小于 50 元时，四舍五入到万元两位为 0.00，不进排名图 */
  var COMPLETION_NEAR_ZERO = 50;

  var ALERT_TYPE_ORDER = [
    '累计开票超总合同额',
    '累计回款超总合同额',
    '累计回款超累计开票',
    '存量合同额为负',
    '有完成额无工时',
    '有工时无完成额'
  ];

  /**
   * 本月完成合同额横向条形图数据：过滤近零后按金额从高到低，最多 limit 条。
   * @param {Array<{projectNo, projectName, pmName, monthCompletion}>} projects
   * @param {number} [limit=8]
   */
  function buildCompletionRank(projects, limit) {
    var max = Math.max(1, Number(limit) || 8);
    return (projects || [])
      .filter(function (p) {
        return Math.abs(toNumber(p && p.monthCompletion)) >= COMPLETION_NEAR_ZERO;
      })
      .slice()
      .sort(function (a, b) {
        return toNumber(b.monthCompletion) - toNumber(a.monthCompletion);
      })
      .slice(0, max)
      .map(function (p) {
        return {
          projectNo: p.projectNo || '',
          projectName: p.projectName || '',
          pmName: p.pmName || '',
          monthCompletion: toNumber(p.monthCompletion)
        };
      });
  }

  var TREEMAP_NAMED_CAP = 12;
  var TREEMAP_FALLBACK_CAP = 8;
  var TREEMAP_MIN_RATIO = 0.15;

  function completionSnapshot(p) {
    return {
      projectNo: p.projectNo || '',
      projectName: p.projectName || '',
      pmName: p.pmName || '',
      monthCompletion: toNumber(p.monthCompletion)
    };
  }

  /**
   * 本月完成合同额树状图：大项目单独成块，长尾合并为一块「其他项目」。
   * 面积用绝对值；「其他项目」颜色看净额正负。近零项目（绝对值不足 50 元）不占块。
   * @param {Array<{projectNo, projectName, pmName, monthCompletion}>} projects
   */
  function buildCompletionTreemap(projects) {
    var list = projects || [];
    var significant = [];
    var nearZeroCount = 0;
    list.forEach(function (p) {
      if (!p) return;
      if (Math.abs(toNumber(p.monthCompletion)) >= COMPLETION_NEAR_ZERO) significant.push(p);
      else nearZeroCount += 1;
    });
    significant.sort(function (a, b) {
      return Math.abs(toNumber(b.monthCompletion)) - Math.abs(toNumber(a.monthCompletion));
    });

    var named = [];
    if (significant.length) {
      var maxAbs = Math.abs(toNumber(significant[0].monthCompletion));
      var floor = maxAbs * TREEMAP_MIN_RATIO;
      significant.forEach(function (p) {
        if (named.length >= TREEMAP_NAMED_CAP) return;
        if (Math.abs(toNumber(p.monthCompletion)) >= floor) named.push(p);
      });
      if (!named.length) named = significant.slice(0, TREEMAP_FALLBACK_CAP);
    }

    var namedNos = {};
    named.forEach(function (p) { namedNos[p.projectNo || ''] = true; });
    var rest = [];
    significant.forEach(function (p) {
      if (namedNos[p.projectNo || '']) return;
      rest.push(p);
    });

    var tiles = named.map(function (p) {
      var snap = completionSnapshot(p);
      snap.kind = 'project';
      return snap;
    });

    if (rest.length) {
      var sum = 0;
      var nos = [];
      rest.forEach(function (p) {
        sum += toNumber(p.monthCompletion);
        nos.push(p.projectNo || '');
      });
      if (Math.abs(sum) >= COMPLETION_NEAR_ZERO) {
        tiles.push({
          kind: 'other',
          label: '其他项目',
          monthCompletion: sum,
          count: rest.length,
          projectNos: nos
        });
      }
    }

    return { tiles: tiles, nearZeroCount: nearZeroCount };
  }

  /**
   * 预警类型横向条形图数据：只含条数 > 0 的类型，按条数降序，相同时按六类固定顺序。
   * @param {Array<{type?, label}>} items
   */
  function buildAlertTypeRank(items) {
    var counts = {};
    (items || []).forEach(function (item) {
      if (!item || !item.label) return;
      counts[item.label] = (counts[item.label] || 0) + 1;
    });
    var orderIndex = {};
    ALERT_TYPE_ORDER.forEach(function (label, idx) { orderIndex[label] = idx; });
    return Object.keys(counts)
      .filter(function (label) { return counts[label] > 0; })
      .sort(function (a, b) {
        var dc = counts[b] - counts[a];
        if (dc !== 0) return dc;
        var ia = orderIndex.hasOwnProperty(a) ? orderIndex[a] : 999;
        var ib = orderIndex.hasOwnProperty(b) ? orderIndex[b] : 999;
        return ia - ib;
      })
      .map(function (label) {
        return { label: label, count: counts[label] };
      });
  }

  function buildOverview(projects, baselineProjects, monthIdx, options) {
    options = options || {};
    var currentProjects = projects || [];
    var baseline = baselineProjects || [];
    var normalizedMonthIdx = Math.min(11, Math.max(0, Number(monthIdx) || 0));
    var computedProjects = currentProjects.map(function (p) { return toComputed(p, normalizedMonthIdx); });
    var flatProjects = computedProjects.map(toFlat);
    var kpis = buildKpi(flatProjects, normalizedMonthIdx);
    var backlog = buildBacklog(computedProjects, flatProjects, normalizedMonthIdx);
    attachPeriodDeltas(kpis, backlog, baseline, normalizedMonthIdx);
    return {
      monthIdx: normalizedMonthIdx,
      monthLabel: MONTH_LABELS[normalizedMonthIdx],
      kpis: kpis,
      monthlyTrend: Object.assign(buildMonthlyTrend(flatProjects), { reportingMonthIdx: normalizedMonthIdx }),
      pmSummary: buildPmSummary(computedProjects, normalizedMonthIdx),
      backlog: backlog,
      diffSummary: buildDiffSummary(computedProjects, baseline, normalizedMonthIdx, options.topN || 10),
      attention: buildAttention(computedProjects, normalizedMonthIdx)
    };
  }

  return {
    MONTH_LABELS: MONTH_LABELS,
    ALERT_TYPE_ORDER: ALERT_TYPE_ORDER,
    throughMonthTotal: throughMonthTotal,
    futureTotal: futureTotal,
    buildCompletionRank: buildCompletionRank,
    buildCompletionTreemap: buildCompletionTreemap,
    buildAlertTypeRank: buildAlertTypeRank,
    buildOverview: buildOverview
  };
});
