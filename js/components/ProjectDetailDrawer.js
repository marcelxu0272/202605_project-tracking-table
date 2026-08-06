/**
 * ProjectDetailDrawer.js — 点击项目号打开的填报 Drawer（P0/P1）
 */
(function (window) {
  'use strict';

  var SECTION_ICONS = {
    '合同签署与进展': 'el-icon-document',
    'WIP分析与措施': 'el-icon-warning-outline',
    '完成额统计与预测': 'el-icon-s-data',
    '开票与回款统计预测': 'el-icon-coin',
    '年度完成额申报': 'el-icon-edit-outline',
    '合同额': 'el-icon-tickets',
    '存量指标': 'el-icon-s-marketing',
    '始累完成合同额': 'el-icon-s-flag',
    '开票回款情况': 'el-icon-wallet',
    '财务数据（WIP/应收）': 'el-icon-bank-card',
    '应收账款及WIP': 'el-icon-money',
    '工时数据': 'el-icon-time',
    '成本数据': 'el-icon-data-analysis'
  };

  window.ProjectDetailDrawer = {
    name: 'ProjectDetailDrawer',
    components: (function () {
      var c = {};
      if (window.ProjectTimesheetAux) c.ProjectTimesheetAux = window.ProjectTimesheetAux;
      if (window.ProjectCostAux) c.ProjectCostAux = window.ProjectCostAux;
      return c;
    })(),
    props: {
      visible: { type: Boolean, default: false },
      project: { type: Object, default: null },
      canEdit: { type: Boolean, default: false },
      saving: { type: Boolean, default: false },
      monthIdx: { type: Number, default: 0 },
      fieldEditable: { type: Function, required: true },
      formatValue: { type: Function, required: true },
      stockWarningField: { type: Function, default: null },
      navIndex: { type: Number, default: -1 },
      navTotal: { type: Number, default: 0 },
      focusTarget: { type: Object, default: null }
    },
    data: function () {
      return {
        draft: {},
        primaryActive: [],
        readonlyActive: [],
        auxActive: ['工时数据', '成本数据'],
        timesheetStats: null,
        timesheetLoading: false,
        timesheetLoadFailed: false,
        completionAuxVisible: false,
        completionAuxBlurTimer: null,
        numFocusKey: null,
        monthInputFocusOldVal: null,
        activeTab: 'forecast',
        remarkGuideActive: false
      };
    },
    computed: {
      layout: function () {
        if (!this.project || !window.ProjectDrawerLayout) {
          return { summaryFields: [], baselineFields: [], progressFields: [], editableSections: [], readonlySections: [], tabs: { forecast: [], wip: [] } };
        }
        var self = this;
        return ProjectDrawerLayout.buildTabLayout(
          FieldConfig.buildFieldConfig(),
          function (f) { return self.fieldEditable(f); }
        );
      },
      monthLabels: function () {
        return ProjectDrawerLayout.MONTH_LABELS;
      },
      projectTitle: function () {
        if (!this.project) return '';
        return this.project.project_no || '';
      },
      projectSubtitle: function () {
        if (!this.project) return '';
        return this.project.project_name || '';
      },
      headerSummaryFields: function () {
        return (this.layout.summaryFields || []).filter(function (f) {
          return f.col !== 'F' && f.col !== 'G';
        });
      },
      /** 左侧「项目基准」字段行：项目号/名称 + 客户/PM/执行单位/业务类型 */
      baselineIdentityFields: function () {
        var summary = this.layout.summaryFields || [];
        var order = ['F', 'G', 'H', 'E', 'D', 'K'];
        return order.map(function (col) {
          for (var i = 0; i < summary.length; i++) {
            if (summary[i].col === col) return summary[i];
          }
          return null;
        }).filter(Boolean);
      },
      headerStartField: function () {
        var list = this.layout.summaryFields || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].col === 'B') return list[i];
        }
        return null;
      },
      headerEndField: function () {
        var list = this.layout.summaryFields || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].col === 'C') return list[i];
        }
        return null;
      },
      headerDateRange: function () {
        var s = this.headerStartField ? this.formatReadonly(this.headerStartField) : '';
        var e = this.headerEndField ? this.formatReadonly(this.headerEndField) : '';
        if (s === '—') s = '';
        if (e === '—') e = '';
        if (!s && !e) return '';
        if (s && e) return s + ' ~ ' + e;
        return s || e;
      },
      showSave: function () {
        // 右下角始终展示「保存」；不可编辑时按钮 disabled
        return true;
      },
      saveDisabled: function () {
        return !this.canEdit || !!this.saving;
      },
      hasNavPrev: function () {
        return this.navIndex > 0;
      },
      hasNavNext: function () {
        return this.navIndex >= 0 && this.navIndex < this.navTotal - 1;
      },
      navPositionLabel: function () {
        if (this.navIndex < 0 || !this.navTotal) return '';
        return (this.navIndex + 1) + ' / ' + this.navTotal;
      },
      drawerVisible: {
        get: function () { return this.visible; },
        set: function (v) {
          if (!v) this.$emit('close');
        }
      },
      systemYear: function () {
        var store = window.Store;
        if (store && store.periodConfig && store.periodConfig.systemYear) {
          return Number(store.periodConfig.systemYear);
        }
        if (store && store.reportingMonth) {
          return Number(String(store.reportingMonth).slice(0, 4)) || new Date().getFullYear();
        }
        return new Date().getFullYear();
      },
      projectAlerts: function () {
        if (!this.project || !window.ProjectAlerts) return [];
        return ProjectAlerts.getProjectAlerts(
          this.project,
          this.monthIdx,
          this.timesheetStats,
          { timesheetReady: !this.timesheetLoading && !this.timesheetLoadFailed }
        );
      },
      hasProjectAlerts: function () {
        return this.projectAlerts.length > 0;
      },
      completionFillAux: function () {
        if (!this.project || !window.ProjectAlerts) return null;
        return ProjectAlerts.getCompletionFillAux(
          this.project,
          this.monthIdx,
          this.timesheetStats,
          this.draft
        );
      },
      completionAuxLoading: function () {
        return this.timesheetLoading;
      },
      draftFlat: function () {
        return this.draft || {};
      },
      drawerMetrics: function () {
        return ProjectDrawerLayout.computeDrawerMetrics(this.draftFlat, this.monthIdx, this.systemYear);
      },
      forecastSections: function () {
        return this.layout.tabs.forecast || [];
      },
      wipSections: function () {
        return this.layout.tabs.wip || [];
      },
      formTabs: function () {
        return [
          { name: 'wip', label: 'WIP 分析', sections: this.wipSections }
        ];
      },
      progressFields: function () {
        return this.layout.progressFields || [];
      },
      forecastMonthly: function () {
        var merged = { completion: [], invoice: [], payment: [] };
        this.forecastSections.forEach(function (section) {
          if (!section.monthly) return;
          ['completion', 'invoice', 'payment'].forEach(function (kind) {
            merged[kind] = merged[kind].concat(section.monthly[kind] || []);
          });
        });
        return merged;
      },
      monthMatrixRows: function () {
        var self = this;
        return this.monthLabels.map(function (label, monthIndex) {
          return {
            label: label,
            monthIndex: monthIndex,
            completion: self.fieldAtMonth(self.forecastMonthly, 'completion', monthIndex),
            invoice: self.fieldAtMonth(self.forecastMonthly, 'invoice', monthIndex),
            payment: self.fieldAtMonth(self.forecastMonthly, 'payment', monthIndex)
          };
        });
      },
      remarkField: function () {
        var tabs = this.layout && this.layout.tabs ? this.layout.tabs : {};
        var sections = []
          .concat(tabs.forecast || [])
          .concat(tabs.wip || []);
        for (var i = 0; i < sections.length; i++) {
          var fields = sections[i].fields || [];
          for (var j = 0; j < fields.length; j++) {
            if (fields[j] && fields[j].col === 'CF') return fields[j];
          }
        }
        return null;
      }
    },
    watch: {
      visible: function (v) {
        if (v) {
          this.resetDraft();
          this.fetchTimesheetStats();
          this.$nextTick(function () {
            this.applyFocusTarget();
          }.bind(this));
        } else {
          this.timesheetStats = null;
          this.timesheetLoading = false;
          this.timesheetLoadFailed = false;
          this.completionAuxVisible = false;
          if (this.completionAuxBlurTimer) {
            clearTimeout(this.completionAuxBlurTimer);
            this.completionAuxBlurTimer = null;
          }
          this.numFocusKey = null;
          this.remarkGuideActive = false;
        }
      },
      project: function () {
        if (this.visible) {
          this.resetDraft();
          this.fetchTimesheetStats();
        }
      },
      focusTarget: function () {
        if (!this.visible) return;
        this.$nextTick(function () {
          this.applyFocusTarget();
        }.bind(this));
      },
      systemYear: function () {
        if (this.visible && this.projectTitle) this.fetchTimesheetStats();
      }
    },
    methods: {
      resetDraft: function () {
        if (!this.project) {
          this.draft = {};
          return;
        }
        this.draft = Object.assign({}, FieldConfig.arraysToFlat(this.project));
        this.activeTab = 'forecast';
        this.expandAllCollapseSections();
        this.numFocusKey = null;
        this.remarkGuideActive = false;
      },
      /** 各折叠分区一律默认展开（含 WIP，不再因 WIP=0 自动收起） */
      expandAllCollapseSections: function () {
        var layout = this.layout || {};
        var primary = (layout.editableSections || []).map(function (s) { return s.name; });
        var readonly = (layout.readonlySections || []).map(function (s) { return s.name; });
        this.primaryActive = primary;
        this.readonlyActive = readonly;
        this.auxActive = ['工时数据', '成本数据'];
      },
      numInputKey: function (field) {
        if (!field) return '';
        var k = this.draftKey(field);
        return k != null ? k : ('col-' + field.col);
      },
      isNumInputFocused: function (field) {
        return this.numFocusKey === this.numInputKey(field);
      },
      formatNumInputDisplay: function (field) {
        if (!field) return '';
        var val = this.draftVal(field);
        if (this.isNumInputFocused(field)) {
          if (val === '' || val == null) return '';
          return String(val);
        }
        if (val === '' || val == null) return '';
        if (window.Formatters) {
          var formatted = Formatters.formatAmount(val);
          return formatted === '—' ? '' : formatted;
        }
        return String(val);
      },
      onNumInputFocus: function (field) {
        this.numFocusKey = this.numInputKey(field);
      },
      onNumInputInput: function (field, val) {
        this.setDraftVal(field, val);
      },
      onNumInputBlur: function (field) {
        if (!field) {
          this.numFocusKey = null;
          return;
        }
        var k = this.draftKey(field);
        if (k == null) {
          this.numFocusKey = null;
          return;
        }
        var raw = this.draft[k];
        if (raw === '' || raw == null) {
          this.numFocusKey = null;
          return;
        }
        var parsed = window.Formatters
          ? Formatters.parseAmount(raw)
          : Number(String(raw).replace(/,/g, ''));
        if (isNaN(parsed)) parsed = 0;
        this.$set(this.draft, k, parsed);
        this.numFocusKey = null;
      },
      onMonthNumInputFocus: function (field, showAux) {
        this.onNumInputFocus(field);
        var key = this.draftKey(field);
        this.monthInputFocusOldVal = key != null ? this.draft[key] : null;
        if (showAux) this.showCompletionAux();
      },
      onMonthNumInputBlur: function (field, hideAux) {
        this.onNumInputBlur(field);
        if (hideAux) this.hideCompletionAuxSoon();
        this.tryGuideRemarkForNegativeCurrentCompletion(field);
        this.monthInputFocusOldVal = null;
      },
      applyFocusTarget: function () {
        if (!this.focusTarget || !this.focusTarget.col) return;
        if (this.focusTarget.col !== 'CF') return;
        this.focusRemarkInput(true);
      },
      focusRemarkInput: function (guided) {
        var self = this;
        this.activeTab = 'forecast';
        this.$nextTick(function () {
          var el = self.$refs.remarkInput;
          if (Array.isArray(el)) el = el[0];
          if (el && typeof el.focus === 'function') el.focus();
          if (guided) {
            self.remarkGuideActive = true;
            self.$message.warning('当前月份完成合同额为负，请填写备注说明。');
          }
        });
      },
      tryGuideRemarkForNegativeCurrentCompletion: function (field) {
        if (!field || !window.StockValidation || !this.remarkField) return;
        var key = this.draftKey(field);
        if (key == null) return;
        var oldVal = this.monthInputFocusOldVal;
        var newVal = this.draft[key];
        if (!StockValidation.shouldGuideNegativeRemark(oldVal, newVal, field, this.monthIdx)) {
          return;
        }
        this.focusRemarkInput(true);
      },
      draftKey: function (field) {
        return FieldConfig.COL_TO_KEY[field.col];
      },
      draftVal: function (field) {
        var k = this.draftKey(field);
        return k != null ? this.draft[k] : '';
      },
      setDraftVal: function (field, val) {
        var k = this.draftKey(field);
        if (k == null) return;
        this.$set(this.draft, k, val);
      },
      widgetType: function (field) {
        var self = this;
        return ProjectDrawerLayout.getFieldWidgetType(field, function (f) {
          return self.fieldEditable(f);
        });
      },
      isLongText: function (field) {
        return ProjectDrawerLayout.isLongTextField(field);
      },
      formatField: function (field) {
        return this.formatValue(this.draftVal(field), field);
      },
      formatReadonly: function (field) {
        if (!this.project) return '—';
        var flat = FieldConfig.arraysToFlat(this.project);
        var k = FieldConfig.COL_TO_KEY[field.col];
        return this.formatValue(flat[k], field) || '—';
      },
      formatHeaderMetaValue: function (field) {
        if (field.col === 'D' && this.project && window.SectorWorkflow) {
          var label = SectorWorkflow.sectorDisplayLabel(this.project.unit_code, window.Store);
          if (label) return label;
        }
        return this.formatReadonly(field);
      },
      isStockWarning: function (field) {
        if (!this.stockWarningField || !this.project) return false;
        return this.stockWarningField(this.project, field);
      },
      monthIndexForField: function (field) {
        return FieldConfig.getMonthlyMonthIndex(field.col);
      },
      isMonthCellEditable: function (monthly, kind, mi) {
        var field = this.fieldAtMonth(monthly, kind, mi);
        return !!(field && this.fieldEditable(field));
      },
      handleClose: function () {
        this.$emit('close');
      },
      handleNavPrev: function () {
        if (this.hasNavPrev) this.$emit('nav-prev');
      },
      handleNavNext: function () {
        if (this.hasNavNext) this.$emit('nav-next');
      },
      handleSave: function () {
        if (!this.canEdit || this.saving) return;
        this.$emit('save', Object.assign({}, this.draft));
      },
      monthlyRowLabel: function (kind) {
        if (kind === 'completion') return '完成合同额';
        if (kind === 'invoice') return '月度开票';
        return '月度回款';
      },
      monthlyKinds: function (monthly) {
        if (!monthly) return [];
        var kinds = [];
        if (monthly.completion && monthly.completion.length) kinds.push('completion');
        if (monthly.invoice && monthly.invoice.length) kinds.push('invoice');
        if (monthly.payment && monthly.payment.length) kinds.push('payment');
        return kinds;
      },
      fieldsForMonthKind: function (monthly, kind) {
        if (!monthly || !monthly[kind]) return [];
        return monthly[kind].slice().sort(function (a, b) {
          return FieldConfig.getMonthlyMonthIndex(a.col) - FieldConfig.getMonthlyMonthIndex(b.col);
        });
      },
      fieldAtMonth: function (monthly, kind, mi) {
        var list = this.fieldsForMonthKind(monthly, kind);
        for (var i = 0; i < list.length; i++) {
          if (FieldConfig.getMonthlyMonthIndex(list[i].col) === mi) return list[i];
        }
        return null;
      },
      headerTagClass: function (field) {
        if (field.col !== 'A') return '';
        var v = this.formatReadonly(field);
        if (v === '新项目') return 'drawer-header-tag--new';
        if (v === '旧项目') return 'drawer-header-tag--old';
        return '';
      },
      sectionIcon: function (name) {
        return SECTION_ICONS[name] || 'el-icon-folder';
      },
      isWipExclTaxZero: function () {
        if (!this.project) return false;
        var flat = FieldConfig.arraysToFlat(this.project);
        var v = flat.wip_excl_tax;
        if (v == null || v === '') return true;
        var n = Number(v);
        return !isNaN(n) && Math.abs(n) < 1e-9;
      },
      showNoWipHint: function (sectionName) {
        return sectionName === 'WIP分析与措施' && this.isWipExclTaxZero();
      },
      sectionUsesEditableBg: function (sectionName) {
        return sectionName === '合同签署与进展' || sectionName === 'WIP分析与措施';
      },
      isEditableField: function (field) {
        return this.fieldEditable(field);
      },
      isSystemRefOverridden: function (field) {
        if (!window.SystemRefMeta || !this.project) return false;
        return SystemRefMeta.isOverriddenField(this.project, field, this.monthIdx);
      },
      systemRefTooltip: function (field) {
        if (!window.SystemRefMeta || !this.project) return '';
        return SystemRefMeta.formatRefComment(this.project, field, this.monthIdx);
      },
      isReportMonthCompletionCell: function (monthly, kind, mi) {
        return kind === 'completion' && mi === this.monthIdx && this.isMonthCellEditable(monthly, kind, mi);
      },
      formatAuxAmount: function (val) {
        if (window.Formatters) return Formatters.formatAmount(val);
        var n = Number(val) || 0;
        return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      },
      formatAuxHours: function (val) {
        var n = Number(val) || 0;
        if (Math.abs(n) < 1e-9) return '—';
        return n.toFixed(1) + ' h';
      },
      formatCompactAmount: function (val) {
        var n = Number(val);
        if (!isFinite(n)) return '—';
        if (Math.abs(n) >= 10000) {
          return (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 万';
        }
        return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
      },
      formatBaselineAmount: function (val) {
        if (window.Formatters) {
          var formatted = Formatters.formatAmount(val);
          return formatted === '—' ? '—' : formatted;
        }
        var n = Number(val);
        if (!isFinite(n)) return '—';
        return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
      },
      progressRateLabel: function (rate) {
        var n = Number(rate);
        if (!isFinite(n)) return '—';
        return n.toFixed(1) + '%';
      },
      matrixCellClass: function (monthIndex, kind, field) {
        if (monthIndex < this.monthIdx) return 'is-historical';
        // 开票/回款报告月：与历史月同款只读样式（系统取值，无特殊底色/角标）
        if (monthIndex === this.monthIdx && (kind === 'invoice' || kind === 'payment')) {
          return 'is-historical';
        }
        if (monthIndex === this.monthIdx) return 'is-current';
        if (this.isMatrixCellEditable(monthIndex, kind, field)) return 'is-forecast';
        return 'is-readonly';
      },
      /**
       * 月度矩阵可编辑判定：开票/回款报告月始终只读（系统取值），
       * 即使 system_admin 在主表有覆盖权限，抽屉矩阵也不改为输入框。
       */
      isMatrixCellEditable: function (monthIndex, kind, field) {
        if (!field) return false;
        if ((kind === 'invoice' || kind === 'payment') && monthIndex === this.monthIdx) return false;
        return !!this.fieldEditable(field);
      },
      /** 可编辑格角标：报告月完成合同额「当月」，未来月「预测」；开票/回款当月只读不标 */
      matrixCellBadge: function (monthIndex, kind, field) {
        if (!this.isMatrixCellEditable(monthIndex, kind, field)) return '';
        if (kind === 'completion' && monthIndex === this.monthIdx) return '当月';
        if (monthIndex > this.monthIdx) return '预测';
        return '';
      },
      isCurrentCompletionField: function (row, kind) {
        return kind === 'completion'
          && row.monthIndex === this.monthIdx
          && row[kind]
          && this.isMatrixCellEditable(row.monthIndex, kind, row[kind]);
      },
      showCompletionAux: function () {
        if (this.completionAuxBlurTimer) {
          clearTimeout(this.completionAuxBlurTimer);
          this.completionAuxBlurTimer = null;
        }
        this.completionAuxVisible = true;
      },
      hideCompletionAuxSoon: function () {
        var self = this;
        if (this.completionAuxBlurTimer) clearTimeout(this.completionAuxBlurTimer);
        this.completionAuxBlurTimer = setTimeout(function () {
          self.completionAuxVisible = false;
          self.completionAuxBlurTimer = null;
        }, 160);
      },
      fetchTimesheetStats: function () {
        var self = this;
        if (!this.projectTitle) {
          this.timesheetStats = null;
          this.timesheetLoading = false;
          this.timesheetLoadFailed = false;
          return;
        }
        this.timesheetLoading = true;
        this.timesheetLoadFailed = false;
        var base = window.PTRACK_API_BASE != null ? window.PTRACK_API_BASE : '';
        fetch(base + '/api/projects/' + encodeURIComponent(this.projectTitle) + '/timesheet?year=' + this.systemYear)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) {
            self.timesheetStats = data;
            self.timesheetLoading = false;
          })
          .catch(function () {
            self.timesheetStats = null;
            self.timesheetLoadFailed = true;
            self.timesheetLoading = false;
          });
      }
    },
    legacyTemplate: `
      <el-drawer
        :visible.sync="drawerVisible"
        :append-to-body="true"
        :size="'1200px'"
        :wrapper-closable="true"
        :destroy-on-close="false"
        custom-class="project-drawer"
        @close="handleClose"
      >
        <div slot="title" class="project-drawer-header">
          <div class="project-drawer-header-top">
            <div class="project-drawer-title-block">
              <div class="project-drawer-title">
                <span class="project-drawer-title-no">{{ projectTitle }}</span>
                <span v-if="projectSubtitle" class="project-drawer-title-name">{{ projectSubtitle }}</span>
                <div v-if="headerMetaItems.length" class="project-drawer-header-meta">
                  <span
                    v-for="(field, idx) in headerMetaItems"
                    :key="'hmeta-' + field.col"
                    class="drawer-header-meta-item"
                  >
                    <span v-if="idx > 0" class="drawer-header-meta-sep">·</span>
                    <span class="drawer-header-meta-label">{{ field.name_cn }}</span>
                    <span class="drawer-header-meta-value">{{ formatHeaderMetaValue(field) }}</span>
                  </span>
                </div>
              </div>
            </div>
            <div v-if="navTotal > 1" class="project-drawer-nav">
              <button
                type="button"
                class="drawer-nav-btn"
                :disabled="!hasNavPrev"
                aria-label="上一个项目"
                @click.stop="handleNavPrev"
              >
                <i class="el-icon-arrow-left"></i>
              </button>
              <span v-if="navPositionLabel" class="project-drawer-nav-pos">{{ navPositionLabel }}</span>
              <button
                type="button"
                class="drawer-nav-btn"
                :disabled="!hasNavNext"
                aria-label="下一个项目"
                @click.stop="handleNavNext"
              >
                <i class="el-icon-arrow-right"></i>
              </button>
            </div>
          </div>

          <div v-if="headerClientField" class="drawer-header-highlight">
            <span class="drawer-header-highlight-icon"><i class="el-icon-office-building"></i></span>
            <div class="drawer-header-highlight-body">
              <span class="drawer-header-highlight-label">{{ headerClientField.name_cn }}</span>
              <span class="drawer-header-highlight-value">{{ formatReadonly(headerClientField) }}</span>
            </div>
          </div>

          <div v-if="headerTagFields.length || headerDateRange" class="project-drawer-header-tags">
            <span
              v-for="field in headerTagFields"
              :key="'htag-' + field.col"
              class="drawer-header-tag"
              :class="headerTagClass(field)"
            >{{ formatReadonly(field) }}</span>
            <span v-if="headerDateRange" class="drawer-header-tag drawer-header-tag--date">
              <i class="el-icon-date"></i>{{ headerDateRange }}
            </span>
          </div>


        </div>

        <div v-if="project" class="project-drawer-body">

          <!-- 项目预警 -->
          <section v-if="hasProjectAlerts" class="project-drawer-section project-drawer-alerts">
            <div class="project-drawer-section-label">项目预警</div>
            <div class="drawer-alert-tags">
              <span
                v-for="alert in projectAlerts"
                :key="alert.id"
                class="drawer-alert-tag"
              >
                <i class="el-icon-warning"></i>{{ alert.label }}
              </span>
            </div>
          </section>

          <!-- 填报区 -->
          <section v-if="layout.editableSections.length" class="project-drawer-section">
            <div class="project-drawer-section-heading">
              <div class="project-drawer-section-label">跟踪信息填报</div>
              <el-tooltip placement="top-start" effect="light" popper-class="project-drawer-fill-tip">
                <div slot="content" class="project-drawer-fill-tip-content">
                  <p><span class="drawer-tip-swatch"></span>浅黄色底色表示当前角色<strong>可编辑</strong>的字段（与 Luckysheet 表格一致）。</p>
                  <p>若项目<strong>未产生 WIP</strong>（WIP 不含税为 0），「WIP分析与措施」分区仍<strong>默认展开</strong>，标题旁会提示「本项目未产生WIP」，无需填写时可忽略</p>
                </div>
                <i class="el-icon-question project-drawer-section-tip" aria-label="填报说明"></i>
              </el-tooltip>
            </div>
            <el-collapse v-model="primaryActive" class="project-drawer-collapse">
              <el-collapse-item
                v-for="sec in layout.editableSections"
                :key="'ed-' + sec.name"
                :name="sec.name"
                :class="{ 'drawer-section--editable-bg': sectionUsesEditableBg(sec.name) }"
              >
                <template slot="title">
                  <div class="drawer-collapse-title">
                    <i class="drawer-collapse-title__icon" :class="sectionIcon(sec.name)"></i>
                    <span class="drawer-collapse-title__text">{{ sec.name }}</span>
                    <span v-if="showNoWipHint(sec.name)" class="drawer-section-hint-tag">本项目未产生WIP</span>
                  </div>
                </template>
                <!-- 普通可编辑字段 -->
                <div v-if="sec.fields.length" class="drawer-field-grid">
                  <div
                    v-for="field in sec.fields"
                    :key="'f-' + field.col"
                    class="drawer-field-row"
                    :class="{
                      'drawer-field-row--full': widgetType(field) === 'longtext',
                      'drawer-field-row--editable': isEditableField(field),
                      'drawer-field-row--system-ref-override': isSystemRefOverridden(field)
                    }"
                    :title="isSystemRefOverridden(field) ? systemRefTooltip(field) : ''"
                  >
                    <label class="drawer-field-label">{{ field.name_cn }}</label>
                    <div class="drawer-field-control">
                      <el-select
                        v-if="widgetType(field) === 'enum'"
                        :value="draftVal(field)"
                        size="small"
                        filterable
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      >
                        <el-option
                          v-for="opt in field.enum_values"
                          :key="opt"
                          :label="opt"
                          :value="opt"
                        ></el-option>
                      </el-select>
                      <el-input
                        v-else-if="widgetType(field) === 'longtext'"
                        type="textarea"
                        :rows="3"
                        :value="draftVal(field)"
                        size="small"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else-if="widgetType(field) === 'amount'"
                        :value="formatNumInputDisplay(field)"
                        size="small"
                        class="drawer-field-input drawer-field-input--num"
                        @focus="onNumInputFocus(field)"
                        @blur="onNumInputBlur(field)"
                        @input="onNumInputInput(field, $event)"
                      ></el-input>
                      <el-input
                        v-else-if="widgetType(field) === 'ratio'"
                        :value="draftVal(field)"
                        size="small"
                        class="drawer-field-input drawer-field-input--num"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else-if="widgetType(field) === 'date'"
                        :value="draftVal(field)"
                        size="small"
                        placeholder="YYYY-MM-DD"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else
                        :value="draftVal(field)"
                        size="small"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                    </div>
                  </div>
                </div>

                <!-- 月度条带 -->
                <div v-if="sec.monthly" class="drawer-month-block">
                  <div
                    v-for="kind in monthlyKinds(sec.monthly)"
                    :key="kind"
                    class="drawer-month-row"
                  >
                    <div class="drawer-month-row-label">{{ monthlyRowLabel(kind) }}</div>
                    <div class="drawer-month-strip">
                      <div
                        v-for="(ml, mi) in monthLabels"
                        :key="kind + '-' + mi"
                        class="drawer-month-cell"
                        :class="{ 'is-editable-month': isMonthCellEditable(sec.monthly, kind, mi) }"
                      >
                        <div class="drawer-month-cell-hd">{{ ml }}</div>
                        <template v-if="fieldAtMonth(sec.monthly, kind, mi)">
                          <el-popover
                            v-if="isReportMonthCompletionCell(sec.monthly, kind, mi)"
                            placement="top"
                            trigger="manual"
                            v-model="completionAuxVisible"
                            popper-class="drawer-completion-aux-popover"
                          >
                            <div class="drawer-completion-aux">
                              <div class="drawer-completion-aux-title">填报参考</div>
                              <dl v-if="completionFillAux" class="drawer-completion-aux-list">
                                <div class="drawer-completion-aux-item">
                                  <dt>总合同额</dt>
                                  <dd>{{ formatAuxAmount(completionFillAux.totalContract) }}</dd>
                                </div>
                                <div class="drawer-completion-aux-item">
                                  <dt>截止上月始累完成合同额</dt>
                                  <dd>{{ formatAuxAmount(completionFillAux.cumCompletedBeforeMonth) }}</dd>
                                </div>
                                <div class="drawer-completion-aux-item">
                                  <dt>当月上报工时</dt>
                                  <dd>
                                    <span v-if="completionAuxLoading">加载中…</span>
                                    <span v-else>{{ formatAuxHours(completionFillAux.monthHours) }}</span>
                                  </dd>
                                </div>
                                <div class="drawer-completion-aux-item">
                                  <dt>当月工时成本</dt>
                                  <dd>
                                    <span v-if="completionAuxLoading">加载中…</span>
                                    <span v-else>{{ formatAuxAmount(completionFillAux.monthLaborCost) }}</span>
                                  </dd>
                                </div>
                              </dl>
                            </div>
                            <el-input
                              slot="reference"
                              :value="formatNumInputDisplay(fieldAtMonth(sec.monthly, kind, mi))"
                              size="mini"
                              class="drawer-month-input"
                              @focus="onMonthNumInputFocus(fieldAtMonth(sec.monthly, kind, mi), true)"
                              @blur="onMonthNumInputBlur(fieldAtMonth(sec.monthly, kind, mi), true)"
                              @input="onNumInputInput(fieldAtMonth(sec.monthly, kind, mi), $event)"
                            ></el-input>
                          </el-popover>
                          <el-input
                            v-else-if="fieldEditable(fieldAtMonth(sec.monthly, kind, mi))"
                            :value="formatNumInputDisplay(fieldAtMonth(sec.monthly, kind, mi))"
                            size="mini"
                            class="drawer-month-input"
                            @focus="onNumInputFocus(fieldAtMonth(sec.monthly, kind, mi))"
                            @blur="onNumInputBlur(fieldAtMonth(sec.monthly, kind, mi))"
                            @input="onNumInputInput(fieldAtMonth(sec.monthly, kind, mi), $event)"
                          ></el-input>
                          <span v-else class="drawer-month-ro">
                            {{ formatReadonly(fieldAtMonth(sec.monthly, kind, mi)) }}
                          </span>
                        </template>
                        <span v-else class="drawer-month-empty">—</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 同 section 的只读公式字段 -->
                <el-descriptions
                  v-if="sec.readonlyFields && sec.readonlyFields.length"
                  :column="2"
                  size="small"
                  border
                  class="project-drawer-desc drawer-section-readonly-inline"
                >
                  <el-descriptions-item
                    v-for="field in sec.readonlyFields"
                    :key="'edro-' + field.col"
                    :label="field.name_cn"
                  >
                    <span :class="{ 'drawer-stock-warn': isStockWarning(field) }">
                      {{ formatReadonly(field) }}
                    </span>
                  </el-descriptions-item>
                </el-descriptions>
              </el-collapse-item>
            </el-collapse>
          </section>

          <!-- 只读参考区 -->
          <section v-if="layout.readonlySections.length" class="project-drawer-section">
            <div class="project-drawer-section-label">其他跟踪数据</div>
            <el-collapse v-model="readonlyActive" class="project-drawer-collapse">
              <el-collapse-item
                v-for="sec in layout.readonlySections"
                :key="'ro-' + sec.name"
                :name="sec.name"
              >
                <template slot="title">
                  <div class="drawer-collapse-title">
                    <i class="drawer-collapse-title__icon" :class="sectionIcon(sec.name)"></i>
                    <span class="drawer-collapse-title__text">{{ sec.name }}</span>
                  </div>
                </template>
                <el-descriptions v-if="sec.fields.length" :column="4" size="small" border class="project-drawer-desc">
                  <el-descriptions-item
                    v-for="field in sec.fields"
                    :key="'rof-' + field.col"
                    :label="field.name_cn"
                  >
                    <span :class="{ 'drawer-stock-warn': isStockWarning(field) }">
                      {{ formatReadonly(field) }}
                    </span>
                  </el-descriptions-item>
                </el-descriptions>
                <div v-if="sec.monthly" class="drawer-month-block drawer-month-block--readonly">
                  <div
                    v-for="kind in monthlyKinds(sec.monthly)"
                    :key="'ro-' + kind"
                    class="drawer-month-row drawer-month-row--readonly"
                  >
                    <div class="drawer-month-row-label">{{ monthlyRowLabel(kind) }}</div>
                    <div class="drawer-month-strip">
                      <div
                        v-for="(ml, mi) in monthLabels"
                        :key="'rom-' + kind + mi"
                        class="drawer-month-cell drawer-month-ro-cell"
                      >
                        <div class="drawer-month-cell-hd">{{ ml }}</div>
                        <span v-if="fieldAtMonth(sec.monthly, kind, mi)" class="drawer-month-ro">
                          {{ formatReadonly(fieldAtMonth(sec.monthly, kind, mi)) }}
                        </span>
                        <span v-else class="drawer-month-empty">—</span>
                      </div>
                    </div>
                  </div>
                </div>
              </el-collapse-item>
            </el-collapse>
          </section>

          <!-- 辅助区 -->
          <section class="project-drawer-section">
            <div class="project-drawer-section-label">项目工时与成本</div>
            <el-collapse v-model="auxActive" class="project-drawer-collapse">
              <el-collapse-item name="工时数据">
                <template slot="title">
                  <div class="drawer-collapse-title">
                    <i class="drawer-collapse-title__icon" :class="sectionIcon('工时数据')"></i>
                    <span class="drawer-collapse-title__text">工时数据</span>
                  </div>
                </template>
                <project-timesheet-aux
                  v-if="projectTitle"
                  :project-no="projectTitle"
                  :year="systemYear"
                ></project-timesheet-aux>
              </el-collapse-item>
              <el-collapse-item name="成本数据">
                <template slot="title">
                  <div class="drawer-collapse-title">
                    <i class="drawer-collapse-title__icon" :class="sectionIcon('成本数据')"></i>
                    <span class="drawer-collapse-title__text">成本数据</span>
                  </div>
                </template>
                <project-cost-aux
                  v-if="projectTitle"
                  :project-no="projectTitle"
                  :year="systemYear"
                ></project-cost-aux>
              </el-collapse-item>
            </el-collapse>
          </section>
        </div>

        <div class="project-drawer-footer">
          <el-button @click="handleClose">关闭</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="saveDisabled"
            :title="canEdit ? '' : '当前为只读，无法保存'"
            @click="handleSave"
          >保存</el-button>
        </div>
      </el-drawer>
    `,
    template: `
      <el-drawer
        :visible.sync="drawerVisible"
        :append-to-body="true"
        :size="'1280px'"
        :wrapper-closable="true"
        :destroy-on-close="false"
        custom-class="project-drawer project-drawer--split"
        @close="handleClose"
      >
        <div slot="title" class="project-drawer-header project-drawer-header--compact">
          <div class="project-drawer-header-top">
            <div class="project-drawer-title-block">
              <div class="project-drawer-title project-drawer-title--inline">
                <span class="project-drawer-title-no">{{ projectTitle }}</span>
                <span v-if="projectSubtitle" class="project-drawer-title-name">{{ projectSubtitle }}</span>
              </div>
            </div>
            <div v-if="navTotal > 1" class="project-drawer-nav">
              <button type="button" class="drawer-nav-btn" :disabled="!hasNavPrev" aria-label="上一个项目" @click.stop="handleNavPrev">
                <i class="el-icon-arrow-left"></i>
              </button>
              <span v-if="navPositionLabel" class="project-drawer-nav-pos">{{ navPositionLabel }}</span>
              <button type="button" class="drawer-nav-btn" :disabled="!hasNavNext" aria-label="下一个项目" @click.stop="handleNavNext">
                <i class="el-icon-arrow-right"></i>
              </button>
            </div>
          </div>
        </div>

        <div v-if="project" class="project-drawer-workspace">
          <section v-if="hasProjectAlerts" class="project-drawer-alerts project-drawer-alerts--bar">
            <span class="project-drawer-alerts-title">项目预警</span>
            <div class="drawer-alert-tags">
              <span v-for="alert in projectAlerts" :key="alert.id" class="drawer-alert-tag">
                <i class="el-icon-warning"></i>{{ alert.label }}
              </span>
            </div>
          </section>

          <div class="project-drawer-split">
            <aside class="drawer-baseline-panel">
              <section class="drawer-baseline-card drawer-baseline-card--identity">
                <div class="drawer-baseline-card-title">项目基准</div>
                <dl class="drawer-baseline-meta">
                  <div
                    v-for="field in baselineIdentityFields"
                    :key="'base-meta-' + field.col"
                    class="drawer-baseline-meta-row"
                    :class="{
                      'drawer-baseline-meta-row--title': field.col === 'F' || field.col === 'G'
                    }"
                  >
                    <dt>{{ field.name_cn }}</dt>
                    <dd>{{ formatHeaderMetaValue(field) }}</dd>
                  </div>
                  <div v-if="headerDateRange" class="drawer-baseline-meta-row">
                    <dt>项目周期</dt>
                    <dd>{{ headerDateRange }}</dd>
                  </div>
                </dl>
              </section>

              <section
                v-for="card in drawerMetrics.progressCards"
                :key="'rate-' + card.key"
                class="drawer-baseline-rate-card"
              >
                <div class="drawer-baseline-rate-main">
                  <strong>{{ progressRateLabel(card.rate) }}</strong>
                </div>
                <div class="drawer-baseline-rate-detail">
                  <div class="drawer-baseline-rate-title">{{ card.title }}</div>
                  <div class="drawer-baseline-rate-metric">
                    <span class="drawer-baseline-rate-metric-label">{{ card.amountLabel }}</span>
                    <span class="drawer-baseline-rate-metric-value">{{ formatBaselineAmount(card.amount) }}</span>
                  </div>
                  <div class="drawer-baseline-rate-metric">
                    <span class="drawer-baseline-rate-metric-label">总合同额</span>
                    <span class="drawer-baseline-rate-metric-value">{{ formatBaselineAmount(drawerMetrics.totalContract) }}</span>
                  </div>
                </div>
              </section>

              <section class="drawer-baseline-card">
                <div class="drawer-baseline-card-title">WIP与应收账款</div>
                <dl class="drawer-baseline-metrics">
                  <div v-for="field in layout.baselineFields" :key="'base-field-' + field.col">
                    <dt>{{ field.name_cn }}</dt>
                    <dd :class="{ 'drawer-stock-warn': isStockWarning(field) }">{{ formatReadonly(field) }}</dd>
                  </div>
                </dl>
              </section>

              <section v-if="progressFields.length" class="drawer-baseline-card drawer-baseline-card--progress">
                <div class="drawer-baseline-card-title">项目实施进展</div>
                <div class="drawer-baseline-progress-list">
                  <div
                    v-for="field in progressFields"
                    :key="'progress-' + field.col"
                    class="drawer-baseline-progress-row"
                    :class="{ 'is-editable': isEditableField(field) }"
                  >
                    <div class="drawer-baseline-progress-control">
                      <el-select
                        v-if="isEditableField(field) && widgetType(field) === 'enum'"
                        :value="draftVal(field)"
                        size="small"
                        filterable
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      >
                        <el-option
                          v-for="opt in field.enum_values"
                          :key="opt"
                          :label="opt"
                          :value="opt"
                        ></el-option>
                      </el-select>
                      <el-input
                        v-else-if="isEditableField(field)"
                        :value="draftVal(field)"
                        size="small"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <span v-else class="drawer-baseline-progress-readonly">{{ formatReadonly(field) }}</span>
                    </div>
                  </div>
                </div>
              </section>
            </aside>

            <main class="drawer-detail-panel">
              <el-tabs v-model="activeTab" class="drawer-detail-tabs">
                <el-tab-pane label="经营预测" name="forecast">
                  <div class="drawer-tab-panel drawer-tab-panel--forecast">
                    <div class="drawer-forecast-kpi-row">
                      <article v-for="kpi in drawerMetrics.kpis" :key="kpi.key" class="drawer-forecast-kpi">
                        <span class="drawer-forecast-kpi-name">{{ kpi.label }}</span>
                        <div class="drawer-forecast-kpi-prev">
                          <span>截止上年</span>
                          <strong>{{ formatBaselineAmount(kpi.prevYear) }}</strong>
                        </div>
                        <div class="drawer-forecast-kpi-main">
                          <span>当年累计</span>
                          <strong>{{ formatBaselineAmount(kpi.actual) }}</strong>
                        </div>
                        <div class="drawer-forecast-kpi-future">
                          <span>预测</span>
                          <strong>{{ formatBaselineAmount(kpi.forecast) }}</strong>
                        </div>
                        <div class="drawer-forecast-kpi-remain">
                          <span>剩余</span>
                          <strong>{{ formatBaselineAmount(kpi.remaining) }}</strong>
                        </div>
                      </article>
                    </div>

                    <div class="drawer-month-matrix-wrap">
                      <div class="drawer-month-matrix-title">
                        <div>
                          <strong>月度填报</strong>
                          <span>历史锁定 · 当前月完成合同额 · 未来预测</span>
                        </div>
                        <el-tooltip placement="top" effect="light" popper-class="project-drawer-fill-tip">
                          <div slot="content" class="project-drawer-fill-tip-content">
                            <p>报告月「完成合同额」可填，标记为「当月」；未来月份为「预测」。</p>
                            <p>报告月「开票」「回款」取系统实际值，样式与历史月一致，不可填写。</p>
                          </div>
                          <i class="el-icon-question project-drawer-section-tip" aria-label="填报说明"></i>
                        </el-tooltip>
                      </div>
                      <div class="drawer-month-matrix-scroll">
                      <table class="drawer-month-matrix">
                        <thead>
                          <tr><th>月</th><th>完成合同额</th><th>完成开票额</th><th>完成回款额</th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="row in monthMatrixRows" :key="'matrix-' + row.monthIndex" :class="{ 'is-report-row': row.monthIndex === monthIdx }">
                            <th>{{ row.label }}</th>
                            <td
                              v-for="kind in ['completion', 'invoice', 'payment']"
                              :key="kind"
                              :class="matrixCellClass(row.monthIndex, kind, row[kind])"
                            >
                              <template v-if="row[kind]">
                                <el-popover
                                  v-if="isCurrentCompletionField(row, kind)"
                                  placement="top"
                                  trigger="manual"
                                  v-model="completionAuxVisible"
                                  popper-class="drawer-completion-aux-popover"
                                >
                                  <div class="drawer-completion-aux">
                                    <div class="drawer-completion-aux-title">填报参考</div>
                                    <dl v-if="completionFillAux" class="drawer-completion-aux-list">
                                      <div class="drawer-completion-aux-item"><dt>总合同额</dt><dd>{{ formatAuxAmount(completionFillAux.totalContract) }}</dd></div>
                                      <div class="drawer-completion-aux-item"><dt>截止上月始累完成合同额</dt><dd>{{ formatAuxAmount(completionFillAux.cumCompletedBeforeMonth) }}</dd></div>
                                      <div class="drawer-completion-aux-item"><dt>当月上报工时</dt><dd>{{ completionAuxLoading ? '加载中…' : formatAuxHours(completionFillAux.monthHours) }}</dd></div>
                                      <div class="drawer-completion-aux-item"><dt>当月工时成本</dt><dd>{{ completionAuxLoading ? '加载中…' : formatAuxAmount(completionFillAux.monthLaborCost) }}</dd></div>
                                    </dl>
                                  </div>
                                  <div slot="reference" class="drawer-month-cell-stack">
                                    <span class="drawer-month-badge is-current">当月</span>
                                    <el-input
                                      :value="formatNumInputDisplay(row[kind])"
                                      size="mini"
                                      class="drawer-month-input"
                                    :data-drawer-field-col="row[kind].col"
                                      @focus="onMonthNumInputFocus(row[kind], true)"
                                      @blur="onMonthNumInputBlur(row[kind], true)"
                                      @input="onNumInputInput(row[kind], $event)"
                                    ></el-input>
                                  </div>
                                </el-popover>
                                <div
                                  v-else-if="isMatrixCellEditable(row.monthIndex, kind, row[kind])"
                                  class="drawer-month-cell-stack"
                                >
                                  <span
                                    v-if="matrixCellBadge(row.monthIndex, kind, row[kind])"
                                    class="drawer-month-badge is-forecast"
                                  >{{ matrixCellBadge(row.monthIndex, kind, row[kind]) }}</span>
                                  <el-input
                                    :value="formatNumInputDisplay(row[kind])"
                                    size="mini"
                                    class="drawer-month-input"
                                    :data-drawer-field-col="row[kind].col"
                                    @focus="onNumInputFocus(row[kind])"
                                    @blur="onNumInputBlur(row[kind])"
                                    @input="onNumInputInput(row[kind], $event)"
                                  ></el-input>
                                </div>
                                <div v-else class="drawer-month-cell-stack drawer-month-cell-stack--ro">
                                  <span class="drawer-month-ro">{{ formatReadonly(row[kind]) }}</span>
                                </div>
                              </template>
                              <span v-else class="drawer-month-empty">—</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      </div>
                      <div class="drawer-month-legend">
                        <span><i class="is-historical"></i>历史锁定</span>
                        <span><i class="is-current"></i>当前月·完成合同额</span>
                        <span><i class="is-forecast"></i>未来预测</span>
                      </div>

                    </div>
                    <div v-if="remarkField" class="drawer-remark-box" :class="{ 'is-guided': remarkGuideActive }">
                      <label class="drawer-remark-box__label">{{ remarkField.name_cn }}</label>
                      <el-input
                        ref="remarkInput"
                        type="textarea"
                        :rows="2"
                        :value="draftVal(remarkField)"
                        class="drawer-remark-box__input"
                        placeholder="当前月份完成合同额为负时，请填写备注说明。"
                        @focus="remarkGuideActive = false"
                        @input="setDraftVal(remarkField, $event)"
                      ></el-input>
                    </div>
                  </div>
                </el-tab-pane>

                <el-tab-pane v-for="tab in formTabs" :key="tab.name" :label="tab.label" :name="tab.name">
                  <div class="drawer-tab-panel">
                    <div v-if="tab.name === 'wip' && isWipExclTaxZero()" class="drawer-tab-hint">
                      <i class="el-icon-info"></i>本项目未产生 WIP，以下字段无需填写；如有特殊情况仍可录入。
                    </div>
                    <section v-for="section in tab.sections" :key="'tab-' + tab.name + section.name" class="drawer-tab-section">
                      <div class="drawer-tab-section-title">
                        <i :class="sectionIcon(section.name)"></i><span>{{ section.name }}</span>
                      </div>
                      <div class="drawer-field-grid">
                        <div
                          v-for="field in section.fields"
                          :key="'tab-field-' + field.col"
                          class="drawer-field-row"
                          :class="{
                            'drawer-field-row--full': widgetType(field) === 'longtext',
                            'drawer-field-row--editable': isEditableField(field),
                            'drawer-field-row--system-ref-override': isSystemRefOverridden(field)
                          }"
                          :title="isSystemRefOverridden(field) ? systemRefTooltip(field) : ''"
                        >
                          <label class="drawer-field-label">{{ field.name_cn }}</label>
                          <div class="drawer-field-control">
                            <div v-if="widgetType(field) === 'readonly'" class="drawer-field-readonly">{{ formatReadonly(field) }}</div>
                            <el-select v-else-if="widgetType(field) === 'enum'" :value="draftVal(field)" size="small" filterable class="drawer-field-input" @input="setDraftVal(field, $event)">
                              <el-option v-for="opt in field.enum_values" :key="opt" :label="opt" :value="opt"></el-option>
                            </el-select>
                            <el-input v-else-if="widgetType(field) === 'longtext'" type="textarea" :rows="3" :value="draftVal(field)" size="small" class="drawer-field-input" @input="setDraftVal(field, $event)"></el-input>
                            <el-input v-else-if="widgetType(field) === 'amount'" :value="formatNumInputDisplay(field)" size="small" class="drawer-field-input drawer-field-input--num" @focus="onNumInputFocus(field)" @blur="onNumInputBlur(field)" @input="onNumInputInput(field, $event)"></el-input>
                            <el-input v-else :value="draftVal(field)" size="small" class="drawer-field-input" @input="setDraftVal(field, $event)"></el-input>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </el-tab-pane>

                <el-tab-pane label="工时与成本" name="timesheet_cost">
                  <div class="drawer-tab-panel">
                    <section class="drawer-tab-section">
                      <div class="drawer-tab-section-title">
                        <i class="el-icon-time"></i><span>工时数据</span>
                      </div>
                      <project-timesheet-aux
                        v-if="projectTitle"
                        :project-no="projectTitle"
                        :year="systemYear"
                      ></project-timesheet-aux>
                    </section>
                    <section class="drawer-tab-section">
                      <div class="drawer-tab-section-title">
                        <i class="el-icon-data-analysis"></i><span>成本数据</span>
                      </div>
                      <project-cost-aux
                        v-if="projectTitle"
                        :project-no="projectTitle"
                        :year="systemYear"
                      ></project-cost-aux>
                    </section>
                  </div>
                </el-tab-pane>
              </el-tabs>
            </main>
          </div>
        </div>

        <div class="project-drawer-footer">
          <el-button @click="handleClose">关闭</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="saveDisabled"
            :title="canEdit ? '' : '当前为只读，无法保存'"
            @click="handleSave"
          >保存</el-button>
        </div>
      </el-drawer>
    `
  };
})(window);
