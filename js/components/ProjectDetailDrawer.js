/**
 * ProjectDetailDrawer.js — 点击项目号打开的填报 Drawer（P0/P1）
 */
(function (window) {
  'use strict';

  window.ProjectDetailDrawer = {
    name: 'ProjectDetailDrawer',
    props: {
      visible: { type: Boolean, default: false },
      project: { type: Object, default: null },
      canEdit: { type: Boolean, default: false },
      saving: { type: Boolean, default: false },
      monthIdx: { type: Number, default: 0 },
      fieldEditable: { type: Function, required: true },
      formatValue: { type: Function, required: true },
      stockWarningField: { type: Function, default: null }
    },
    data: function () {
      return {
        draft: {},
        primaryActive: [],
        readonlyActive: []
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
      showSave: function () {
        return this.canEdit;
      },
      drawerVisible: {
        get: function () { return this.visible; },
        set: function (v) {
          if (!v) this.$emit('close');
        }
      }
    },
    watch: {
      visible: function (v) {
        if (v) this.resetDraft();
      },
      project: function () {
        if (this.visible) this.resetDraft();
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
      isStockWarning: function (field) {
        if (!this.stockWarningField || !this.project) return false;
        return this.stockWarningField(this.project, field);
      },
      monthIndexForField: function (field) {
        return FieldConfig.getMonthlyMonthIndex(field.col);
      },
      isReportMonth: function (mi) {
        return mi === this.monthIdx;
      },
      handleClose: function () {
        this.$emit('close');
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
        <div slot="title" class="project-drawer-title">
          <span class="project-drawer-title-no">{{ projectTitle }}</span>
          <span v-if="projectSubtitle" class="project-drawer-title-name">{{ projectSubtitle }}</span>
        </div>

        <div v-if="project" class="project-drawer-body">
          <section class="project-drawer-section">
            <div class="project-drawer-section-label">项目基本信息</div>
            <el-descriptions :column="2" size="mini" border class="project-drawer-desc">
              <el-descriptions-item
                v-for="field in layout.summaryFields"
                :key="'sum-' + field.col"
                :label="field.name_cn"
              >
                <span :class="{ 'drawer-stock-warn': isStockWarning(field) }">
                  {{ formatReadonly(field) }}
                </span>
              </el-descriptions-item>
            </el-descriptions>
          </section>

          <section v-if="layout.editableSections.length" class="project-drawer-section">
            <div class="project-drawer-section-label">填报区</div>
            <el-collapse v-model="primaryActive" class="project-drawer-collapse">
              <el-collapse-item
                v-for="sec in layout.editableSections"
                :key="'ed-' + sec.name"
                :title="sec.name"
                :name="sec.name"
              >
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
                        size="mini"
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
                        :rows="2"
                        :value="draftVal(field)"
                        size="mini"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else-if="widgetType(field) === 'amount' || widgetType(field) === 'ratio'"
                        :value="draftVal(field)"
                        size="mini"
                        class="drawer-field-input drawer-field-input--num"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else-if="widgetType(field) === 'date'"
                        :value="draftVal(field)"
                        size="mini"
                        placeholder="YYYY-MM-DD"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                      <el-input
                        v-else
                        :value="draftVal(field)"
                        size="mini"
                        class="drawer-field-input"
                        @input="setDraftVal(field, $event)"
                      ></el-input>
                    </div>
                  </div>
                </div>

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
                        :class="{ 'is-report-month': isReportMonth(mi) }"
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

                <el-descriptions
                  v-if="sec.readonlyFields && sec.readonlyFields.length"
                  :column="2"
                  size="mini"
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

          <section v-if="layout.readonlySections.length" class="project-drawer-section">
            <div class="project-drawer-section-label">其他参考数据</div>
            <el-collapse v-model="readonlyActive" class="project-drawer-collapse">
              <el-collapse-item
                v-for="sec in layout.readonlySections"
                :key="'ro-' + sec.name"
                :title="sec.name"
                :name="sec.name"
              >
                <el-descriptions v-if="sec.fields.length" :column="2" size="mini" border class="project-drawer-desc">
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
                    <div class="drawer-month-strip drawer-month-strip--readonly">
                      <span
                        v-for="(ml, mi) in monthLabels"
                        :key="'rom-' + kind + mi"
                        class="drawer-month-ro-cell"
                        :class="{ 'is-report-month': isReportMonth(mi) }"
                      >
                        <span class="drawer-month-cell-hd">{{ ml }}</span>
                        <span v-if="fieldAtMonth(sec.monthly, kind, mi)">
                          {{ formatReadonly(fieldAtMonth(sec.monthly, kind, mi)) }}
                        </span>
                        <span v-else>—</span>
                      </span>
                    </div>
                  </div>
                </div>
              </el-collapse-item>
            </el-collapse>
          </section>

          <section class="project-drawer-section project-drawer-aux">
            <div class="project-drawer-section-label">辅助参考（待接入）</div>
            <div class="drawer-aux-grid">
              <div class="drawer-aux-placeholder">
                <div class="drawer-aux-placeholder-title">工时数据</div>
                <div class="drawer-aux-placeholder-text">中台工时接口就绪后，在此展示当月 / 累计工时，供产值填报参考。</div>
              </div>
              <div class="drawer-aux-placeholder">
                <div class="drawer-aux-placeholder-title">成本数据</div>
                <div class="drawer-aux-placeholder-text">成本法相关指标预留位；当前阶段仅展示占位说明。</div>
              </div>
            </div>
          </section>
        </div>

        <div class="project-drawer-footer">
          <el-button size="small" @click="handleClose">关闭</el-button>
          <el-button
            v-if="showSave"
            type="primary"
            size="small"
            :loading="saving"
            @click="handleSave"
          >保存</el-button>
        </div>
      </el-drawer>
    `
  };
})(window);
