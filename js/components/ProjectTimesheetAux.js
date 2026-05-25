/**
 * ProjectTimesheetAux.js — Drawer 辅助区：工时统计（专业×月 / 板块×月）
 */
(function (window) {
  'use strict';

  var MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  function formatHours(val) {
    if (val === null || val === undefined || val === '') return '—';
    var n = Number(val);
    if (isNaN(n) || Math.abs(n) < 1e-9) return '—';
    return n.toFixed(1);
  }

  function formatCost(val) {
    if (!window.Formatters) return String(val);
    return Formatters.formatAmount(val);
  }

  window.ProjectTimesheetAux = {
    name: 'ProjectTimesheetAux',
    props: {
      projectNo: { type: String, default: '' },
      year: { type: Number, default: 2026 }
    },
    data: function () {
      return {
        loading: false,
        loadError: '',
        stats: null,
        dimensionTab: 'profession',
        metric: 'hours',
        detailVisible: false,
        detailFilter: null
      };
    },
    computed: {
      monthLabels: function () {
        return MONTH_LABELS;
      },
      currentMatrix: function () {
        if (!this.stats) return { rows: [] };
        return this.dimensionTab === 'sector'
          ? (this.stats.bySector || { rows: [] })
          : (this.stats.byProfession || { rows: [] });
      },
      dimensionLabel: function () {
        return this.dimensionTab === 'sector' ? '工程师管理归属' : '专业';
      },
      metricLabel: function () {
        return this.metric === 'cost' ? '已审工时成本' : '已审工时';
      },
      metricUnitLabel: function () {
        return this.metric === 'cost' ? '金额单位：元' : '工时单位：小时';
      },
      monthColumnWidth: function () {
        return this.metric === 'cost' ? 84 : 52;
      },
      totalColumnWidth: function () {
        return this.metric === 'cost' ? 100 : 64;
      },
      tableMetricClass: function () {
        return this.metric === 'cost'
          ? 'drawer-timesheet-table--cost'
          : 'drawer-timesheet-table--hours';
      },
      subtitle: function () {
        if (this.loading) return '加载中…';
        if (this.loadError) return this.loadError;
        if (!this.stats || this.stats.empty) {
          return this.year + ' 年暂无工时数据';
        }
        return this.year + ' 年 · ' + this.metricLabel + ' · 共 ' + (this.stats.detailCount || 0) + ' 条明细 · ' + this.metricUnitLabel;
      },
      filteredDetails: function () {
        if (!this.stats || !this.stats.details) return [];
        var list = this.stats.details.slice();
        var f = this.detailFilter;
        if (!f) return list;
        if (f.dimensionKey != null) {
          var dim = f.dimension != null ? f.dimension : this.dimensionTab;
          var field = dim === 'sector' ? 'engineerSector' : 'profession';
          list = list.filter(function (d) {
            return (d[field] || '（未分类）') === f.dimensionKey;
          });
        }
        if (f.monthIdx != null && f.monthIdx >= 0) {
          list = list.filter(function (d) {
            if (!d.date || d.date.length < 7) return false;
            return parseInt(d.date.slice(5, 7), 10) - 1 === f.monthIdx;
          });
        }
        return list;
      },
      detailFilterLabel: function () {
        var f = this.detailFilter;
        if (!f) return '';
        var parts = [];
        if (f.dimensionKey != null) parts.push(f.dimensionKey);
        if (f.monthIdx != null && f.monthIdx >= 0) parts.push(MONTH_LABELS[f.monthIdx]);
        return parts.join(' · ');
      },
      hasTimesheetData: function () {
        return !!(this.stats && !this.stats.empty);
      }
    },
    watch: {
      projectNo: {
        immediate: true,
        handler: function (v) {
          if (v) this.fetchStats();
          else this.stats = null;
        }
      },
      year: function () {
        if (this.projectNo) this.fetchStats();
      }
    },
    methods: {
      fetchStats: function () {
        var self = this;
        if (!this.projectNo) return;
        this.loading = true;
        this.loadError = '';
        var base = window.PTRACK_API_BASE != null ? window.PTRACK_API_BASE : '';
        fetch(base + '/api/projects/' + encodeURIComponent(this.projectNo) + '/timesheet?year=' + this.year)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) {
            self.stats = data;
            self.loading = false;
            if (!data || data.empty) {
              self.detailVisible = false;
              self.detailFilter = null;
            }
          })
          .catch(function (e) {
            self.loadError = '工时数据加载失败';
            self.stats = null;
            self.loading = false;
          });
      },
      cellValue: function (row, mi) {
        if (!row || !row.months || !row.months[mi]) return '—';
        var cell = row.months[mi];
        if (this.metric === 'cost') return formatCost(cell.cost);
        return formatHours(cell.hours);
      },
      totalValue: function (row) {
        if (!row) return '—';
        if (this.metric === 'cost') return formatCost(row.totalCost);
        return formatHours(row.totalHours);
      },
      cellHasValue: function (row, mi) {
        if (row && row.isTotal) return false;
        if (!row || !row.months || !row.months[mi]) return false;
        var cell = row.months[mi];
        if (this.metric === 'cost') return Math.abs(cell.cost || 0) >= 1e-9;
        return Math.abs(cell.hours || 0) >= 1e-9;
      },
      rowClassName: function (obj) {
        return obj.row && obj.row.isTotal ? 'drawer-ts-row--total' : '';
      },
      openDetail: function (filter) {
        this.detailFilter = filter || null;
        this.detailVisible = true;
      },
      openDetailFromCell: function (row, mi) {
        if (!this.cellHasValue(row, mi)) return;
        this.openDetail({
          dimensionKey: row.key,
          monthIdx: mi,
          dimension: this.dimensionTab
        });
      },
      clearDetailFilter: function () {
        this.detailFilter = null;
      },
      formatDetailHours: function (val) {
        return formatHours(val);
      },
      formatDetailCost: function (val) {
        return formatCost(val);
      },
      formatDetailDate: function (val) {
        if (!window.Formatters) return val || '—';
        return Formatters.formatDate(val);
      }
    },
    template: `
      <div class="drawer-timesheet-aux">
        <div v-if="loading" class="drawer-timesheet-empty">
          <i class="el-icon-loading"></i> 加载工时数据…
        </div>
        <div v-else-if="loadError" class="drawer-timesheet-empty">{{ loadError }}</div>
        <div v-else-if="!hasTimesheetData" class="drawer-timesheet-empty">
          本年度暂无已审工时记录
        </div>
        <template v-else>
          <div class="drawer-timesheet-tabs-row">
            <el-tabs v-model="dimensionTab" class="drawer-timesheet-tabs">
              <el-tab-pane label="专业×月" name="profession"></el-tab-pane>
              <el-tab-pane label="板块×月" name="sector"></el-tab-pane>
            </el-tabs>
          </div>

          <div class="drawer-timesheet-metric-row">
            <el-radio-group v-model="metric" size="mini">
              <el-radio-button label="hours">工时</el-radio-button>
              <el-radio-button label="cost">工时成本</el-radio-button>
            </el-radio-group>
            <button
              type="button"
              class="drawer-timesheet-detail-link"
              @click="openDetail(null)"
            >
              <i class="el-icon-tickets" aria-hidden="true"></i>
              <span>查看明细</span>
            </button>
          </div>

          <div class="drawer-timesheet-subtitle">{{ subtitle }}</div>

          <div class="drawer-timesheet-table-wrap">
            <el-table
              :data="currentMatrix.rows"
              size="mini"
              border
              max-height="280"
              :class="['drawer-timesheet-table', tableMetricClass]"
              :row-class-name="rowClassName"
              :header-cell-style="{ background: '#f8fafc', fontWeight: '600', fontSize: '11px', padding: '4px 0' }"
              :cell-style="{ padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap' }"
            >
              <el-table-column
                :label="dimensionLabel"
                prop="key"
                fixed
                min-width="140"
                show-overflow-tooltip
              >
                <template slot-scope="{ row }">
                  <span :class="{ 'drawer-ts-item--total': row.isTotal }">{{ row.key }}</span>
                </template>
              </el-table-column>
              <el-table-column
                v-for="(ml, mi) in monthLabels"
                :key="'m-' + mi"
                :label="ml"
                :min-width="monthColumnWidth"
                align="right"
                class-name="drawer-ts-col-month"
              >
                <template slot-scope="{ row }">
                  <span
                    class="drawer-ts-cell"
                    :class="{ 'drawer-ts-cell--clickable': cellHasValue(row, mi) }"
                    @click="openDetailFromCell(row, mi)"
                  >{{ cellValue(row, mi) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="合计" :min-width="totalColumnWidth" align="right" fixed="right" class-name="drawer-ts-col-total">
                <template slot-scope="{ row }">
                  <span class="drawer-ts-cell drawer-ts-cell--total">{{ totalValue(row) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <el-dialog
            :visible.sync="detailVisible"
            :title="'工时明细 · ' + projectNo"
            width="1200px"
            append-to-body
            custom-class="drawer-timesheet-detail-dialog"
          >
            <div v-if="detailFilterLabel" class="drawer-ts-detail-filter">
              <el-tag size="small" closable @close="clearDetailFilter">{{ detailFilterLabel }}</el-tag>
              <span class="drawer-ts-detail-count">共 {{ filteredDetails.length }} 条</span>
            </div>
            <el-table
              :data="filteredDetails"
              size="small"
              border
              max-height="420"
              :header-cell-style="{ background: '#f8fafc', fontWeight: '600', fontSize: '12px' }"
            >
              <el-table-column label="日期" prop="date" width="108" sortable>
                <template slot-scope="{ row }">{{ formatDetailDate(row.date) }}</template>
              </el-table-column>
              <el-table-column label="工程师" prop="engineer" min-width="120" show-overflow-tooltip sortable></el-table-column>
              <el-table-column label="工程师管理归属" prop="engineerSector" width="160" show-overflow-tooltip sortable></el-table-column>
              <el-table-column label="专业" prop="profession" min-width="130" show-overflow-tooltip sortable></el-table-column>
              <el-table-column label="单元" prop="unitName" min-width="120" show-overflow-tooltip></el-table-column>
              <el-table-column label="已审工时" width="100" align="right" sortable :sort-method="(a,b)=>a.approvedHours-b.approvedHours">
                <template slot-scope="{ row }">{{ formatDetailHours(row.approvedHours) }}</template>
              </el-table-column>
              <el-table-column label="已审工时成本" width="140" align="right" sortable :sort-method="(a,b)=>a.approvedCost-b.approvedCost">
                <template slot-scope="{ row }">{{ formatDetailCost(row.approvedCost) }}</template>
              </el-table-column>
              <el-table-column label="备注" prop="remark" min-width="100" show-overflow-tooltip></el-table-column>
            </el-table>
          </el-dialog>
        </template>
      </div>
    `
  };
})(window);
