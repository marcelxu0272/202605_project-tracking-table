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
    '应收账款及WIP': 'el-icon-money'
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
      navTotal: { type: Number, default: 0 }
    },
    data: function () {
      return {
        draft: {},
        primaryActive: [],
        readonlyActive: [],
        timesheetStats: null,
        timesheetLoading: false,
        timesheetLoadFailed: false
      };
    },
    computed: {
      layout: function () {
        if (!this.project || !window.ProjectDrawerLayout) {
          return { summaryFields: [], editableSections: [], readonlySections: [] };
        }
        var self = this;
        return ProjectDrawerLayout.buildDrawerLayout(
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
      headerTagFields: function () {
        return this.headerSummaryFields.filter(function (f) {
          return f.col === 'A' || f.col === 'I' || f.col === 'J' || f.col === 'K';
        });
      },
      headerClientField: function () {
        var list = this.headerSummaryFields;
        for (var i = 0; i < list.length; i++) {
          if (list[i].col === 'H') return list[i];
        }
        return null;
      },
      headerDateRange: function () {
        var start = null;
        var end = null;
        var list = this.headerSummaryFields;
        for (var i = 0; i < list.length; i++) {
          if (list[i].col === 'B') start = list[i];
          if (list[i].col === 'C') end = list[i];
        }
        var s = start ? this.formatReadonly(start) : '';
        var e = end ? this.formatReadonly(end) : '';
        if (s === '—') s = '';
        if (e === '—') e = '';
        if (!s && !e) return '';
        if (s && e) return s + ' ~ ' + e;
        return s || e;
      },
      headerMetaItems: function () {
        var self = this;
        var order = ['E', 'D'];
        return order.map(function (col) {
          var list = self.headerSummaryFields;
          for (var i = 0; i < list.length; i++) {
            if (list[i].col === col) return list[i];
          }
          return null;
        }).filter(Boolean);
      },
      showSave: function () {
        return this.canEdit;
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
      }
    },
    watch: {
      visible: function (v) {
        if (v) {
          this.resetDraft();
          this.fetchTimesheetStats();
        } else {
          this.timesheetStats = null;
          this.timesheetLoading = false;
          this.timesheetLoadFailed = false;
        }
      },
      project: function () {
        if (this.visible) {
          this.resetDraft();
          this.fetchTimesheetStats();
        }
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
        var names = this.layout.editableSections.map(function (s) { return s.name; });
        if (this.isWipExclTaxZero()) {
          names = names.filter(function (n) { return n !== 'WIP分析与措施'; });
        }
        this.primaryActive = names.slice();
        this.readonlyActive = [];
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
        this.$emit('save', Object.assign({}, this.draft));
      },
      monthlyRowLabel: function (kind) {
        if (kind === 'completion') return '月度完成';
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
    template: `
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
                  <p><span class="drawer-tip-swatch"></span>浅绿色底色表示当前角色<strong>可编辑</strong>的字段。</p>
                  <p>若项目<strong>未产生 WIP</strong>（WIP 不含税为 0），「WIP分析与措施」分区将<strong>自动折叠</strong>，无需填写 WIP 成因、说明、措施等内容</p>
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
                    :class="{ 'drawer-field-row--full': widgetType(field) === 'longtext' }"
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
                        v-else-if="widgetType(field) === 'amount' || widgetType(field) === 'ratio'"
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
                          <el-input
                            v-if="fieldEditable(fieldAtMonth(sec.monthly, kind, mi))"
                            :value="draftVal(fieldAtMonth(sec.monthly, kind, mi))"
                            size="mini"
                            class="drawer-month-input"
                            @input="setDraftVal(fieldAtMonth(sec.monthly, kind, mi), $event)"
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
            <div class="project-drawer-section-label">其他参考数据</div>
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
          <section class="project-drawer-section project-drawer-aux">
            <div class="project-drawer-section-label">辅助数据</div>
            <div class="drawer-aux-rows">
              <div class="drawer-aux-panel drawer-aux-panel--timesheet">
                <div class="drawer-aux-panel-title">工时数据</div>
                <project-timesheet-aux
                  v-if="projectTitle"
                  :project-no="projectTitle"
                  :year="systemYear"
                ></project-timesheet-aux>
              </div>
              <div class="drawer-aux-panel drawer-aux-panel--cost">
                <div class="drawer-aux-panel-title">成本数据</div>
                <project-cost-aux
                  v-if="projectTitle"
                  :project-no="projectTitle"
                  :year="systemYear"
                ></project-cost-aux>
              </div>
            </div>
          </section>
        </div>

        <div class="project-drawer-footer">
          <el-button @click="handleClose">关闭</el-button>
          <el-button
            v-if="showSave"
            type="primary"
            :loading="saving"
            @click="handleSave"
          >保存</el-button>
        </div>
      </el-drawer>
    `
  };
})(window);
