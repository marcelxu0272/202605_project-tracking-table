/**
 * ProjectCostAux.js — Drawer 辅助区：成本中心（成本项×月）
 */
(function (window) {
  'use strict';

  var MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  function formatAmount(val) {
    if (val === null || val === undefined || val === '') return '—';
    var n = Number(val);
    if (isNaN(n) || Math.abs(n) < 1e-9) return '—';
    if (window.Formatters) return Formatters.formatAmount(n);
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCostMonthLabel(costMonth) {
    if (!costMonth || costMonth.length < 7) return costMonth || '—';
    var parts = costMonth.split('-');
    if (parts.length < 2) return costMonth;
    return parts[0] + '年' + String(parseInt(parts[1], 10)).padStart(2, '0') + '月';
  }

  window.ProjectCostAux = {
    name: 'ProjectCostAux',
    props: {
      projectNo: { type: String, default: '' },
      year: { type: Number, default: 2026 }
    },
    data: function () {
      return {
        loading: false,
        loadError: '',
        stats: null,
        detailVisible: false,
        detailFilter: null
      };
    },
    computed: {
      monthLabels: function () {
        return MONTH_LABELS;
      },
      matrixRows: function () {
        if (!this.stats || !this.stats.rows) return [];
        return this.stats.rows;
      },
      subtitle: function () {
        if (this.loading) return '加载中…';
        if (this.loadError) return this.loadError;
        if (!this.stats || this.stats.empty) {
          return this.year + ' 年暂无成本数据';
        }
        return this.year + ' 年 · 成本中心 · 共 ' + (this.stats.detailCount || 0) + ' 条明细 · 金额单位：元';
      },
      filteredDetails: function () {
        if (!this.stats || !this.stats.details) return [];
        var list = this.stats.details.slice();
        var f = this.detailFilter;
        if (!f) return list;
        if (f.category != null) {
          list = list.filter(function (d) { return d.category === f.category; });
        }
        if (f.monthIdx != null && f.monthIdx >= 0) {
          list = list.filter(function (d) {
            if (!d.costMonth || d.costMonth.length < 7) return false;
            return parseInt(d.costMonth.slice(5, 7), 10) - 1 === f.monthIdx;
          });
        }
        return list;
      },
      detailFilterLabel: function () {
        var f = this.detailFilter;
        if (!f) return '';
        var parts = [];
        if (f.category != null) parts.push(f.category);
        if (f.monthIdx != null && f.monthIdx >= 0) parts.push(MONTH_LABELS[f.monthIdx]);
        return parts.join(' · ');
      },
      hasCostData: function () {
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
        fetch(base + '/api/projects/' + encodeURIComponent(this.projectNo) + '/cost-center?year=' + this.year)
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
          .catch(function () {
            self.loadError = '成本数据加载失败';
            self.stats = null;
            self.loading = false;
          });
      },
      cellValue: function (row, mi) {
        if (!row || !row.months || !row.months[mi]) return '—';
        return formatAmount(row.months[mi].amount);
      },
      totalValue: function (row) {
        if (!row) return '—';
        return formatAmount(row.totalAmount);
      },
      cellHasValue: function (row, mi) {
        if (!row || !row.months || !row.months[mi]) return false;
        return Math.abs(row.months[mi].amount || 0) >= 1e-9;
      },
      rowClassName: function (obj) {
        var row = obj.row;
        return row && row.isTotal ? 'drawer-cost-row--total' : '';
      },
      openDetail: function (filter) {
        this.detailFilter = filter || null;
        this.detailVisible = true;
      },
      openDetailFromCell: function (row, mi) {
        if (!this.cellHasValue(row, mi)) return;
        var filter = { monthIdx: mi };
        if (!row.isTotal) filter.category = row.key;
        this.openDetail(filter);
      },
      clearDetailFilter: function () {
        this.detailFilter = null;
      },
      formatDetailMonth: function (costMonth) {
        return formatCostMonthLabel(costMonth);
      },
      formatDetailAmount: function (val) {
        return formatAmount(val);
      }
    },
    template: `
      <div class="drawer-cost-aux">
        <div v-if="loading" class="drawer-cost-empty">
          <i class="el-icon-loading"></i> 加载成本数据…
        </div>
        <div v-else-if="loadError" class="drawer-cost-empty">{{ loadError }}</div>
        <div v-else-if="!hasCostData" class="drawer-cost-empty">
          本年度暂无成本记录
        </div>
        <template v-else>
          <div class="drawer-cost-toolbar">
            <button
              type="button"
              class="drawer-timesheet-detail-link"
              @click="openDetail(null)"
            >
              <i class="el-icon-tickets" aria-hidden="true"></i>
              <span>查看明细</span>
            </button>
          </div>

          <div class="drawer-cost-subtitle">{{ subtitle }}</div>

          <div class="drawer-cost-table-wrap">
            <el-table
              :data="matrixRows"
              size="mini"
              border
              max-height="260"
              class="drawer-cost-table drawer-timesheet-table drawer-timesheet-table--cost"
              :row-class-name="rowClassName"
              :header-cell-style="{ background: '#f8fafc', fontWeight: '600', fontSize: '11px', padding: '4px 0' }"
              :cell-style="{ padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap' }"
            >
              <el-table-column
                label="成本项"
                prop="key"
                fixed
                min-width="108"
                show-overflow-tooltip
              >
                <template slot-scope="{ row }">
                  <span :class="{ 'drawer-cost-item--total': row.isTotal }">{{ row.key }}</span>
                </template>
              </el-table-column>
              <el-table-column
                v-for="(ml, mi) in monthLabels"
                :key="'cm-' + mi"
                :label="ml"
                :min-width="84"
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
              <el-table-column
                label="合计"
                :min-width="100"
                align="right"
                fixed="right"
                class-name="drawer-ts-col-total"
              >
                <template slot-scope="{ row }">
                  <span class="drawer-ts-cell drawer-ts-cell--total">{{ totalValue(row) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <el-dialog
            :visible.sync="detailVisible"
            :title="'成本明细 · ' + projectNo"
            width="720px"
            append-to-body
            custom-class="drawer-cost-detail-dialog"
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
              <el-table-column label="月份" prop="costMonth" width="120" sortable>
                <template slot-scope="{ row }">{{ formatDetailMonth(row.costMonth) }}</template>
              </el-table-column>
              <el-table-column label="成本项" prop="category" min-width="140" show-overflow-tooltip sortable></el-table-column>
              <el-table-column label="金额" width="120" align="right" sortable :sort-method="(a,b)=>a.amount-b.amount">
                <template slot-scope="{ row }">{{ formatDetailAmount(row.amount) }}</template>
              </el-table-column>
            </el-table>
          </el-dialog>
        </template>
      </div>
    `
  };
})(window);
