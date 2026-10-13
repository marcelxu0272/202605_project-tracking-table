/**
 * project-drawer-layout.js — 项目详情 Drawer 字段分区与控件类型
 */
(function (window) {
  'use strict';

  var LONG_TEXT_COLS = new Set(['AN', 'AS', 'AT', 'TR', 'TQ', 'TW']);
  var LONG_TEXT_NAME_RE = /说明|备注|分析|措施|计划/;

  var EDITABLE_SECTION_ORDER = {
    '合同签署与进展': 1,
    'WIP分析与措施': 2,
    '完成额统计与预测': 3,
    '开票与回款统计预测': 4,
    '年度完成额申报': 5
  };

  var MC_SET = new Set(['AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG']);
  var MI_SET = new Set(['BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV', 'BX', 'BZ', 'CB', 'CD']);
  var MP_SET = new Set(['BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU', 'BW', 'BY', 'CA', 'CC', 'CE']);
  var MONTH_MATRIX_KINDS = ['completion', 'invoice', 'payment'];
  var BASELINE_METRIC_COLS = ['AL', 'AJ'];
  /** 抽屉左侧指标精简展示名（不改字段字典全局 name_cn） */
  var BASELINE_METRIC_LABELS = {
    AL: 'WIP',
    AJ: '应收账款'
  };
  /** 左侧「WIP与应收账款」下方展示的项目实施进展字段 */
  var LEFT_PROGRESS_COLS = ['M'];
  /** 左侧进度卡已展示，延伸数据不再重复（延伸 Tab 已移除，仍保留去重集合供布局复用） */
  var RATE_CARD_METRIC_COLS = ['P', 'U', 'AC', 'AF'];
  var DRAWER_TAB_CONFIG = {
    forecast: ['年度完成额申报', '完成额统计与预测', '开票与回款统计预测'],
    wip: ['WIP分析与措施']
  };

  function isMonthlyCol(col) {
    return MC_SET.has(col) || MI_SET.has(col) || MP_SET.has(col);
  }

  function monthlyKind(col) {
    if (MC_SET.has(col)) return 'completion';
    if (MI_SET.has(col)) return 'invoice';
    if (MP_SET.has(col)) return 'payment';
    return null;
  }

  function isLongTextField(field) {
    if (!field || field.data_type !== '文本') return false;
    if (LONG_TEXT_COLS.has(field.col)) return true;
    return LONG_TEXT_NAME_RE.test(field.name_cn || '');
  }

  function getFieldWidgetType(field, canEditFn) {
    if (!field) return 'readonly';
    var editable = canEditFn && canEditFn(field);
    if (!editable) return 'readonly';
    if (field.enum_values && field.enum_values.length) return 'enum';
    if (isLongTextField(field)) return 'longtext';
    if (field.data_type === '金额') return 'amount';
    if (field.data_type === '比率') return 'ratio';
    if (field.data_type === '日期') return 'date';
    return 'text';
  }

  function groupMonthlyFields(fields) {
    var out = { completion: [], invoice: [], payment: [] };
    fields.forEach(function (f) {
      var k = monthlyKind(f.col);
      if (k) out[k].push(f);
    });
    return out;
  }

  function sectionSortKey(name) {
    return EDITABLE_SECTION_ORDER[name] != null ? EDITABLE_SECTION_ORDER[name] : 99;
  }

  /**
   * @param {Array} tableFields
   * @param {Function} canEditFn (field) => boolean
   */
  function buildDrawerLayout(tableFields, canEditFn) {
    var summaryFields = [];
    var editableSections = [];
    var readonlySections = [];
    var sections = FieldConfig.getSections(tableFields);

    sections.forEach(function (sec) {
      if (!sec.fields || !sec.fields.length) return;

      if (sec.name === '项目基本信息') {
        summaryFields = sec.fields.slice();
        return;
      }

      var edFields = [];
      var roFields = [];
      sec.fields.forEach(function (f) {
        if (canEditFn && canEditFn(f)) edFields.push(f);
        else roFields.push(f);
      });

      if (edFields.length) {
        var edRegular = edFields.filter(function (f) { return !isMonthlyCol(f.col); });
        var roRegular = roFields.filter(function (f) { return !isMonthlyCol(f.col); });
        var allMonthly = groupMonthlyFields(sec.fields.filter(function (f) { return isMonthlyCol(f.col); }));
        editableSections.push({
          name: sec.name,
          fields: edRegular,
          readonlyFields: roRegular,
          monthly: (allMonthly.completion.length || allMonthly.invoice.length || allMonthly.payment.length)
            ? allMonthly : null
        });
      }

      if (roFields.length && !edFields.length) {
        var roRegular = roFields.filter(function (f) { return !isMonthlyCol(f.col); });
        var roMonthly = groupMonthlyFields(roFields.filter(function (f) { return isMonthlyCol(f.col); }));
        readonlySections.push({
          name: sec.name,
          fields: roRegular,
          monthly: (roMonthly.completion.length || roMonthly.invoice.length || roMonthly.payment.length)
            ? roMonthly : null
        });
      }
    });

    editableSections.sort(function (a, b) {
      return sectionSortKey(a.name) - sectionSortKey(b.name);
    });

    return {
      summaryFields: summaryFields,
      editableSections: editableSections,
      readonlySections: readonlySections.filter(function (s) {
        return (s.fields && s.fields.length)
          || (s.monthly && (s.monthly.completion.length || s.monthly.invoice.length || s.monthly.payment.length));
      })
    };
  }

  function fieldsBySection(tableFields) {
    var out = {};
    FieldConfig.getSections(tableFields).forEach(function (section) {
      out[section.name] = section.fields || [];
    });
    return out;
  }

  function buildTabSection(name, fields, canEditFn) {
    var regular = fields.filter(function (field) { return !isMonthlyCol(field.col); });
    var monthly = groupMonthlyFields(fields.filter(function (field) { return isMonthlyCol(field.col); }));
    return {
      name: name,
      fields: regular,
      monthly: (monthly.completion.length || monthly.invoice.length || monthly.payment.length) ? monthly : null,
      hasEditable: regular.some(function (field) { return canEditFn && canEditFn(field); })
    };
  }

  function buildTabLayout(tableFields, canEditFn) {
    var base = buildDrawerLayout(tableFields, canEditFn);
    var sections = fieldsBySection(tableFields);
    var usedLeftCols = new Set(
      BASELINE_METRIC_COLS.concat(RATE_CARD_METRIC_COLS).concat(LEFT_PROGRESS_COLS)
    );
    var baselineFields = BASELINE_METRIC_COLS.map(function (col) {
      for (var i = 0; i < tableFields.length; i++) {
        if (tableFields[i].col !== col) continue;
        var field = tableFields[i];
        var label = BASELINE_METRIC_LABELS[col];
        return label ? Object.assign({}, field, { name_cn: label }) : field;
      }
      return null;
    }).filter(Boolean);
    var progressFields = LEFT_PROGRESS_COLS.map(function (col) {
      for (var i = 0; i < tableFields.length; i++) {
        if (tableFields[i].col === col) return tableFields[i];
      }
      return null;
    }).filter(Boolean);
    var tabs = {};

    Object.keys(DRAWER_TAB_CONFIG).forEach(function (tabName) {
      tabs[tabName] = DRAWER_TAB_CONFIG[tabName].map(function (sectionName) {
        var fields = (sections[sectionName] || []).filter(function (field) {
          return !usedLeftCols.has(field.col);
        });
        return buildTabSection(sectionName, fields, canEditFn);
      }).filter(function (section) {
        return section.fields.length || section.monthly;
      });
    });

    return {
      summaryFields: base.summaryFields,
      baselineFields: baselineFields,
      progressFields: progressFields,
      editableSections: base.editableSections,
      readonlySections: base.readonlySections,
      tabs: tabs
    };
  }

  function toNumber(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
  }

  function futureTotal(flat, prefix, monthIdx) {
    var total = 0;
    for (var i = Math.max(0, monthIdx + 1); i < 12; i++) {
      total += toNumber(flat[prefix + i]);
    }
    return total;
  }

  function throughMonthTotal(flat, prefix, monthIdx) {
    var total = 0;
    for (var i = 0; i <= Math.min(11, Math.max(0, monthIdx)); i++) {
      total += toNumber(flat[prefix + i]);
    }
    return total;
  }

  function elapsedMonths(startDate, systemYear, monthIdx) {
    if (!startDate) return null;
    var start = new Date(startDate);
    if (isNaN(start.getTime())) return null;
    var report = new Date(Number(systemYear), Number(monthIdx) + 1, 0);
    var months = (report.getFullYear() - start.getFullYear()) * 12 + report.getMonth() - start.getMonth() + 1;
    return Math.max(0, months);
  }

  function computeDrawerMetrics(flat, monthIdx, systemYear) {
    flat = flat || {};
    var totalContract = toNumber(flat.total_contract);
    var prevCompletion = toNumber(flat.prev_year_completion);
    var prevInvoice = toNumber(flat.prev_year_invoice);
    var prevPayment = toNumber(flat.prev_year_payment);
    var ytdCompletion = throughMonthTotal(flat, 'mc_', monthIdx);
    var ytdInvoice = throughMonthTotal(flat, 'mi_', monthIdx);
    var ytdPayment = throughMonthTotal(flat, 'mp_', monthIdx);
    var forecastCompletion = futureTotal(flat, 'mc_', monthIdx);
    var forecastInvoice = futureTotal(flat, 'mi_', monthIdx);
    var forecastPayment = futureTotal(flat, 'mp_', monthIdx);
    var completed = prevCompletion + ytdCompletion;
    var invoiced = prevInvoice + ytdInvoice;
    var paid = prevPayment + ytdPayment;
    function rateOf(amount) {
      return totalContract > 0 ? amount / totalContract * 100 : 0;
    }
    return {
      completionRate: rateOf(completed),
      invoiceRate: rateOf(invoiced),
      paymentRate: rateOf(paid),
      completed: completed,
      invoiced: invoiced,
      paid: paid,
      totalContract: totalContract,
      remainingContract: toNumber(flat.contract_minus_completed),
      elapsedMonths: elapsedMonths(flat.start_date, systemYear, monthIdx),
      progressCards: [
        {
          key: 'completion',
          title: '合同完成率',
          rate: rateOf(completed),
          amountLabel: '始累完成合同额',
          amount: completed
        },
        {
          key: 'invoice',
          title: '开票进度',
          rate: rateOf(invoiced),
          amountLabel: '始累开票',
          amount: invoiced
        },
        {
          key: 'payment',
          title: '回款进度',
          rate: rateOf(paid),
          amountLabel: '始累回款',
          amount: paid
        }
      ],
      kpis: [
        {
          key: 'completion',
          label: '完成合同额',
          prevYear: prevCompletion,
          actual: ytdCompletion,
          forecast: forecastCompletion,
          remaining: totalContract - prevCompletion - ytdCompletion - forecastCompletion
        },
        {
          key: 'invoice',
          label: '完成开票额',
          prevYear: prevInvoice,
          actual: ytdInvoice,
          forecast: forecastInvoice,
          remaining: totalContract - prevInvoice - ytdInvoice - forecastInvoice
        },
        {
          key: 'payment',
          label: '完成回款额',
          prevYear: prevPayment,
          actual: ytdPayment,
          forecast: forecastPayment,
          remaining: totalContract - prevPayment - ytdPayment - forecastPayment
        }
      ]
    };
  }

  function collectDrawerChanges(originalFlat, draftFlat, tableFields, canEditFn) {
    var changes = [];
    tableFields.forEach(function (field) {
      if (!canEditFn || !canEditFn(field)) return;
      var key = FieldConfig.COL_TO_KEY[field.col];
      if (!key) return;
      var oldVal = originalFlat[key];
      var newVal = draftFlat[key];
      if (oldVal === newVal) return;
      if (String(oldVal) === String(newVal)) return;
      changes.push({ field: field, key: key, oldVal: oldVal, newVal: newVal });
    });
    return changes;
  }

  window.ProjectDrawerLayout = {
    isMonthlyCol: isMonthlyCol,
    monthlyKind: monthlyKind,
    isLongTextField: isLongTextField,
    getFieldWidgetType: getFieldWidgetType,
    groupMonthlyFields: groupMonthlyFields,
    buildDrawerLayout: buildDrawerLayout,
    buildTabLayout: buildTabLayout,
    computeDrawerMetrics: computeDrawerMetrics,
    DRAWER_TAB_CONFIG: DRAWER_TAB_CONFIG,
    BASELINE_METRIC_COLS: BASELINE_METRIC_COLS,
    BASELINE_METRIC_LABELS: BASELINE_METRIC_LABELS,
    LEFT_PROGRESS_COLS: LEFT_PROGRESS_COLS,
    RATE_CARD_METRIC_COLS: RATE_CARD_METRIC_COLS,
    MONTH_MATRIX_KINDS: MONTH_MATRIX_KINDS,
    collectDrawerChanges: collectDrawerChanges,
    MONTH_LABELS: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  };
})(window);
