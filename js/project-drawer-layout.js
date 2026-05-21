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
    collectDrawerChanges: collectDrawerChanges,
    MONTH_LABELS: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  };
})(window);
