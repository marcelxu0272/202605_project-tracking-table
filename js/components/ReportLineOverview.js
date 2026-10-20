(function (window) {
  'use strict';

  /**
   * 统一以「万」为单位，避免同排指标出现元/万混排而无法横向比较。
   * 只返回数字，单位由调用处按排版需要单独渲染。
   */
  function formatWan(val) {
    if (val === null || val === undefined || val === '') return '—';
    var n = Number(val);
    if (isNaN(n)) return '—';
    return (n / 10000).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatAmount(val) {
    var s = formatWan(val);
    return s === '—' ? s : s + ' 万';
  }

  function formatAmountFull(val) {
    if (window.Formatters && Formatters.formatAmount) return Formatters.formatAmount(val);
    var n = Number(val) || 0;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(val) {
    if (val == null) return '—';
    if (window.Formatters && Formatters.formatPercent) return Formatters.formatPercent(val, 1);
    return (Number(val || 0) * 100).toFixed(1) + '%';
  }

  function signClass(val) {
    var n = Number(val);
    if (!n || isNaN(n)) return '';
    return n < 0 ? 'is-neg' : '';
  }

  /** invert：存量类指标下降为好（绿），上升为差（红） */
  function deltaClass(val, invert) {
    if (val == null || val === '' || isNaN(Number(val))) return 'is-flat';
    var n = Number(val);
    if (Math.abs(n) < 0.005) return 'is-flat';
    var down = n < 0;
    if (invert) down = !down;
    return down ? 'is-down' : 'is-up';
  }

  window.ReportLineOverviewPanel = {
    name: 'ReportLineOverviewPanel',
    props: {
      projects: { type: Array, default: function () { return []; } },
      baselineProjects: { type: Array, default: function () { return []; } },
      monthIdx: { type: Number, default: 0 },
      reportLine: { type: Object, default: function () { return {}; } }
    },
    data: function () {
      return {
        chart: null,
        completionChart: null,
        attentionChart: null,
        liveAlerts: [],
        alertsLoaded: false,
        diffDrillVisible: false,
        attentionDrillVisible: false,
        drillPages: { diff: 1, attention: 1 },
        drillPageSize: 10,
        attentionFilter: '',
        diffDrillNos: null,
        syncTagTooltip: '审批阶段，当月尚未结束，仅代表截至同步时刻的累计发生额，不代表全月最终结果，不作为本次审批口径。'
      };
    },
    computed: {
      overview: function () {
        if (!window.ReportLineOverview || !window.ReportLineOverview.buildOverview) {
          return {
            monthLabel: '',
            kpis: [],
            monthlyTrend: { months: [], completion: [], invoice: [], payment: [], reportingMonthIdx: this.monthIdx },
            pmSummary: [],
            backlog: {},
            diffSummary: { topProjects: [] },
            attention: { items: [], counts: {}, total: 0 }
          };
        }
        return window.ReportLineOverview.buildOverview(
          this.projects,
          this.baselineProjects,
          this.monthIdx
        );
      },
      kpis: function () { return this.overview.kpis || []; },
      trend: function () { return this.overview.monthlyTrend || { months: [] }; },
      pmSummary: function () { return this.overview.pmSummary || []; },
      diffSummary: function () { return this.overview.diffSummary || { topProjects: [] }; },
      /** 接口就绪后用与预警抽屉相同的活跃预警；同一项目多条各占一行 */
      attention: function () {
        if (!this.alertsLoaded) {
          return this.overview.attention || { items: [], total: 0, counts: {} };
        }
        var byNo = {};
        (this.projects || []).forEach(function (p) {
          if (p && p.project_no) byNo[p.project_no] = p;
        });
        var items = [];
        (this.liveAlerts || []).forEach(function (a) {
          if (!a || a.status !== 'active') return;
          var project = byNo[a.projectNo];
          if (!project) return;
          items.push({
            projectNo: a.projectNo,
            projectName: a.projectName || project.project_name || '',
            pmName: project.pm_name || '',
            type: a.alertType,
            label: a.alertLabel
          });
        });
        var counts = {};
        items.forEach(function (item) {
          counts[item.type] = (counts[item.type] || 0) + 1;
        });
        return { items: items, total: items.length, counts: counts };
      },
      backlog: function () { return this.overview.backlog || {}; },
      /** 第四列上下叠放的两项存量（无全年预计） */
      stockKpis: function () {
        var b = this.backlog;
        return [
          {
            key: 'contractStock',
            label: '存量合同额',
            value: b.contractStock,
            delta: b.deltaContractStock,
            invertDelta: true
          },
          {
            key: 'invoiceStock',
            label: '存量开票额',
            value: b.invoiceStock,
            delta: b.deltaInvoiceStock,
            invertDelta: true
          }
        ];
      },
      monthLabel: function () { return this.overview.monthLabel || ''; },
      attentionGroups: function () {
        var groups = {};
        (this.attention.items || []).forEach(function (item) {
          if (!groups[item.label]) groups[item.label] = 0;
          groups[item.label] += 1;
        });
        return Object.keys(groups).map(function (label) {
          return { label: label, count: groups[label] };
        });
      },
      attentionFilterChips: function () {
        return [{ label: '全部', count: this.attention.total || 0, value: '' }].concat(
          this.attentionGroups.map(function (group) {
            return { label: group.label, count: group.count, value: group.label };
          })
        );
      },
      filteredAttentionItems: function () {
        var filter = this.attentionFilter;
        var items = this.attention.items || [];
        if (!filter) return items;
        return items.filter(function (item) { return item.label === filter; });
      },
      diffProjects: function () {
        return (this.diffSummary && this.diffSummary.topProjects) || [];
      },
      completionTreemap: function () {
        if (!window.ReportLineOverview || !window.ReportLineOverview.buildCompletionTreemap) {
          return { tiles: [], nearZeroCount: 0 };
        }
        return window.ReportLineOverview.buildCompletionTreemap(this.diffProjects);
      },
      completionChartEmptyKind: function () {
        if (!this.diffProjects.length) return 'none';
        if (!(this.completionTreemap.tiles || []).length) return 'all-zero';
        return '';
      },
      drillDiffProjects: function () {
        var rows = this.diffProjects || [];
        var nos = this.diffDrillNos;
        if (!nos) return rows;
        var allow = {};
        nos.forEach(function (no) { allow[no] = true; });
        return rows.filter(function (row) { return allow[row.projectNo]; });
      },
      alertTypeRank: function () {
        if (!window.ReportLineOverview || !window.ReportLineOverview.buildAlertTypeRank) {
          return [];
        }
        return window.ReportLineOverview.buildAlertTypeRank(this.attention.items || []);
      },
      isPm: function () {
        return !!(window.Store && Store.currentUser && Store.currentUser.role === 'pm');
      },
      pagedDiffProjects: function () {
        return this.slicePage(this.drillDiffProjects, this.drillPages.diff);
      },
      pagedAttentionItems: function () {
        return this.slicePage(this.filteredAttentionItems, this.drillPages.attention);
      }
    },
    watch: {
      trend: function () { this.$nextTick(this.renderTrendChart); },
      completionTreemap: function () { this.$nextTick(this.renderCompletionChart); },
      alertTypeRank: function () { this.$nextTick(this.renderAttentionChart); },
      projects: function () { this.fetchLiveAlerts(); },
      monthIdx: function () { this.fetchLiveAlerts(); }
    },
    mounted: function () {
      this.fetchLiveAlerts();
      this.renderTrendChart();
      this.renderCompletionChart();
      this.renderAttentionChart();
      var self = this;
      this._resizeHandler = function () {
        if (self.chart) self.chart.resize();
        if (self.completionChart) self.completionChart.resize();
        if (self.attentionChart) self.attentionChart.resize();
      };
      window.addEventListener('resize', this._resizeHandler);
    },
    beforeDestroy: function () {
      if (this.chart) {
        this.chart.dispose();
        this.chart = null;
      }
      if (this.completionChart) {
        this.completionChart.dispose();
        this.completionChart = null;
      }
      if (this.attentionChart) {
        this.attentionChart.dispose();
        this.attentionChart = null;
      }
      if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    },
    methods: {
      formatAmount: formatAmount,
      formatAmountFull: formatAmountFull,
      formatWan: formatWan,
      formatPct: formatPct,
      signClass: signClass,
      deltaClass: deltaClass,
      formatDelta: function (val) {
        if (val == null || val === '' || isNaN(Number(val))) return '—';
        var n = Number(val);
        if (Math.abs(n) < 0.005) return '持平';
        var abs = formatWan(Math.abs(n));
        if (abs === '—') return '—';
        return (n > 0 ? '+' : '−') + abs + ' 万';
      },
      fetchLiveAlerts: function () {
        var self = this;
        var year = (window.Store && Store.reportingMonth)
          ? parseInt(String(Store.reportingMonth).slice(0, 4), 10)
          : new Date().getFullYear();
        var monthIdx = this.monthIdx;
        if (monthIdx == null || isNaN(monthIdx)) return;
        fetch('/api/admin/alerts?year=' + year + '&monthIdx=' + monthIdx)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            self.liveAlerts = (d && d.alerts) || [];
            self.alertsLoaded = true;
          })
          .catch(function () {
            self.alertsLoaded = false;
          });
      },
      getKpiTagText: function (kpi) {
        if (!kpi) return '';
        return kpi.sourceType === 'manual' ? '本期填报申报值' : '本月金额 · 实时同步';
      },
      onOpenProject: function (row) {
        if (!row || !row.projectNo) return;
        this.diffDrillVisible = false;
        this.attentionDrillVisible = false;
        this.$emit('open-project', row.projectNo);
      },
      openDiffDrill: function () {
        this.diffDrillNos = null;
        this.$set(this.drillPages, 'diff', 1);
        this.diffDrillVisible = true;
      },
      openDiffGroup: function (projectNos) {
        this.diffDrillNos = (projectNos || []).slice();
        this.$set(this.drillPages, 'diff', 1);
        this.diffDrillVisible = true;
      },
      openAttentionDrill: function () {
        this.attentionFilter = '';
        this.$set(this.drillPages, 'attention', 1);
        this.attentionDrillVisible = true;
      },
      openAttentionType: function (label) {
        this.attentionFilter = label || '';
        this.$set(this.drillPages, 'attention', 1);
        this.attentionDrillVisible = true;
      },
      slicePage: function (list, page) {
        var rows = list || [];
        var size = this.drillPageSize || 10;
        var maxPage = Math.max(1, Math.ceil(rows.length / size) || 1);
        var p = Math.min(Math.max(1, Number(page) || 1), maxPage);
        var start = (p - 1) * size;
        return rows.slice(start, start + size);
      },
      handleDiffPageChange: function (page) {
        this.$set(this.drillPages, 'diff', page);
      },
      handleAttentionPageChange: function (page) {
        this.$set(this.drillPages, 'attention', page);
      },
      handleDrillSizeChange: function (size) {
        this.drillPageSize = size;
        this.drillPages = { diff: 1, attention: 1 };
      },
      setAttentionFilter: function (value) {
        this.attentionFilter = value || '';
        this.$set(this.drillPages, 'attention', 1);
      },
      truncateLabel: function (text, max) {
        var s = String(text || '');
        var limit = max || 12;
        if (s.length <= limit) return s;
        return s.slice(0, limit - 1) + '…';
      },
      chartTooltipBase: function () {
        return {
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderColor: '#e5e7eb',
          borderWidth: 1,
          padding: [8, 12],
          extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(15,23,42,0.10);',
          textStyle: { color: '#374151', fontSize: 12 }
        };
      },
      disposeChart: function (key) {
        if (this[key]) {
          this[key].dispose();
          this[key] = null;
        }
      },
      renderCompletionChart: function () {
        if (this.completionChartEmptyKind) {
          this.disposeChart('completionChart');
          return;
        }
        if (!this.$refs.completionChart || typeof echarts === 'undefined') return;
        var self = this;
        if (!this.completionChart) {
          this.completionChart = echarts.init(this.$refs.completionChart);
          this.completionChart.on('click', function (params) {
            var data = params && params.data;
            if (!data || data.name == null) return;
            if (data.kind === 'project') self.onOpenProject(data);
            else if (data.projectNos) self.openDiffGroup(data.projectNos);
          });
        }
        var BRAND_FILL = '#d7ebe9';
        var BRAND_TEXT = '#0c4f4a';
        var DANGER_FILL = '#f8d4d4';
        var DANGER_TEXT = '#9f2d2d';
        var tiles = (this.completionTreemap && this.completionTreemap.tiles) || [];
        var data = tiles.map(function (tile) {
          var negative = Number(tile.monthCompletion) < 0;
          return {
            name: tile.kind === 'project' ? (tile.projectNo || '—') : tile.label,
            value: Math.abs(Number(tile.monthCompletion) || 0),
            kind: tile.kind,
            monthCompletion: tile.monthCompletion,
            projectNo: tile.projectNo,
            projectName: tile.projectName,
            pmName: tile.pmName,
            count: tile.count,
            projectNos: tile.projectNos,
            itemStyle: { color: negative ? DANGER_FILL : BRAND_FILL },
            label: { color: negative ? DANGER_TEXT : BRAND_TEXT }
          };
        });
        this.completionChart.setOption({
          textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
          tooltip: Object.assign(this.chartTooltipBase(), {
            trigger: 'item',
            formatter: function (item) {
              var row = item && item.data;
              if (!row) return '';
              var amt = formatWan(row.monthCompletion);
              if (row.kind === 'project') {
                return [
                  '<div style="font-weight:600;margin-bottom:4px;">' + (row.projectName || '—') + '</div>',
                  '<div>项目号：' + (row.projectNo || '—') + '</div>',
                  '<div>项目经理：' + (row.pmName || '—') + '</div>',
                  '<div>本月完成合同额：' + amt + ' 万</div>'
                ].join('');
              }
              return [
                '<div style="font-weight:600;margin-bottom:4px;">' + (row.name || '') + '</div>',
                '<div>项目数：' + (row.count || 0) + '</div>',
                '<div>合计：' + amt + ' 万</div>'
              ].join('');
            }
          }),
          series: [{
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            width: '100%',
            height: '100%',
            left: 0,
            top: 0,
            label: {
              show: true,
              color: '#0c4f4a',
              fontSize: 12,
              formatter: function (info) {
                var row = info.data || {};
                return row.name || '';
              }
            },
            upperLabel: { show: false },
            itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
            data: data
          }]
        }, true);
        this.completionChart.resize();
      },
      renderAttentionChart: function () {
        if (!(this.attention.total > 0) || !this.alertTypeRank.length) {
          this.disposeChart('attentionChart');
          return;
        }
        if (!this.$refs.attentionChart || typeof echarts === 'undefined') return;
        if (!this.attentionChart) {
          this.attentionChart = echarts.init(this.$refs.attentionChart);
          var selfInit = this;
          this.attentionChart.on('click', function (params) {
            var label = params && params.data && params.data.label;
            if (label) selfInit.openAttentionType(label);
          });
        }
        var AMBER = '#d97706';
        var ranked = this.alertTypeRank.slice().reverse();
        var self = this;
        var labels = ranked.map(function (r) {
          return self.truncateLabel(r.label, 12);
        });
        var data = ranked.map(function (r) {
          return {
            value: r.count,
            label: r.label,
            itemStyle: { color: AMBER, borderRadius: [0, 4, 4, 0] }
          };
        });
        this.attentionChart.setOption({
          textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
          tooltip: Object.assign(this.chartTooltipBase(), {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function (items) {
              var item = (items && items[0]) || {};
              var full = item.data && item.data.label;
              var count = item.value;
              if (!full) return '';
              return full + '：' + count + ' 条';
            }
          }),
          grid: { top: 8, left: 4, right: 36, bottom: 4, containLabel: true },
          xAxis: {
            type: 'value',
            minInterval: 1,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#9ca3af', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(15,23,42,0.06)' } }
          },
          yAxis: {
            type: 'category',
            data: labels,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#6b7280', fontSize: 11 }
          },
          series: [{
            type: 'bar',
            data: data,
            barMaxWidth: 18,
            cursor: 'pointer',
            label: {
              show: true,
              position: 'right',
              color: '#92400e',
              fontSize: 11,
              formatter: '{c}'
            }
          }]
        }, true);
        this.attentionChart.resize();
      },
      renderTrendChart: function () {
        if (!this.$refs.trendChart || typeof echarts === 'undefined') return;
        if (!this.chart) this.chart = echarts.init(this.$refs.trendChart);
        var idx = this.trend.reportingMonthIdx == null ? this.monthIdx : this.trend.reportingMonthIdx;
        var months = this.trend.months || [];
        function toWanMonth(arr) {
          return (arr || []).map(function (v) { return v == null ? 0 : v / 10000; });
        }
        function toWanYtd(arr) {
          var sum = 0;
          return (arr || []).map(function (v) {
            sum += Number(v) || 0;
            return sum / 10000;
          });
        }
        var mC = toWanMonth(this.trend.completion);
        var mI = toWanMonth(this.trend.invoice);
        var mP = toWanMonth(this.trend.payment);
        var yC = toWanYtd(this.trend.completion);
        var yI = toWanYtd(this.trend.invoice);
        var yP = toWanYtd(this.trend.payment);
        var BRAND = '#007069';
        var INVOICE = '#4d8fa8';
        var PAYMENT = '#c08a2e';
        var axisLabel = { color: '#9ca3af', fontSize: 11 };
        function bar(name, color, data) {
          return {
            name: name,
            type: 'bar',
            yAxisIndex: 0,
            data: data,
            barMaxWidth: 14,
            itemStyle: { color: color, opacity: 0.78, borderRadius: [2, 2, 0, 0] }
          };
        }
        function line(name, color, data, opts) {
          return Object.assign({
            name: name,
            type: 'line',
            yAxisIndex: 1,
            data: data,
            smooth: 0.2,
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { width: 2.4, color: color },
            itemStyle: { color: color, borderColor: '#fff', borderWidth: 1.5 }
          }, opts || {});
        }
        var legend = [
          '完成合同额·当月', '完成开票额·当月', '完成回款额·当月',
          '完成合同额·累计', '完成开票额·累计', '完成回款额·累计'
        ];
        this.chart.setOption({
          color: [BRAND, INVOICE, PAYMENT, BRAND, INVOICE, PAYMENT],
          textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(255,255,255,0.98)',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            padding: [8, 12],
            extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(15,23,42,0.10);',
            textStyle: { color: '#374151', fontSize: 12 },
            valueFormatter: function (v) {
              return v == null ? '—' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万';
            }
          },
          legend: {
            data: legend,
            top: 0,
            right: 0,
            itemWidth: 12,
            itemHeight: 8,
            itemGap: 12,
            textStyle: { color: '#6b7280', fontSize: 11 }
          },
          grid: { top: 48, left: 8, right: 12, bottom: 0, containLabel: true },
          xAxis: {
            type: 'category',
            data: months,
            axisLine: { lineStyle: { color: '#e5e7eb' } },
            axisTick: { show: false },
            axisLabel: axisLabel
          },
          yAxis: [
            {
              type: 'value',
              name: '当月·万',
              nameTextStyle: { color: '#9ca3af', fontSize: 11 },
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: axisLabel,
              splitLine: { lineStyle: { color: 'rgba(15,23,42,0.06)' } }
            },
            {
              type: 'value',
              name: '累计·万',
              nameTextStyle: { color: '#9ca3af', fontSize: 11 },
              axisLine: { show: false },
              axisTick: { show: false },
              axisLabel: axisLabel,
              splitLine: { show: false }
            }
          ],
          series: [
            bar(legend[0], BRAND, mC),
            bar(legend[1], INVOICE, mI),
            bar(legend[2], PAYMENT, mP),
            line(legend[3], BRAND, yC, {
              markArea: idx < months.length - 1 ? {
                silent: true,
                itemStyle: { color: 'rgba(15,23,42,0.028)' },
                label: {
                  show: true, position: 'insideTop', color: '#9ca3af', fontSize: 11,
                  padding: [4, 0, 0, 0], formatter: '预测'
                },
                data: [[{ xAxis: months[idx] }, { xAxis: months[months.length - 1] }]]
              } : undefined
            }),
            line(legend[4], INVOICE, yI),
            line(legend[5], PAYMENT, yP)
          ]
        }, true);
      },
      pmSortValue: function (row, key) {
        if (!row) return 0;
        if (key === 'projectCount') return Number(row.projectCount) || 0;
        if (key === 'current.i') return Number(row.current && row.current.i) || 0;
        if (key === 'current.p') return Number(row.current && row.current.p) || 0;
        if (key === 'current.c') return Number(row.current && row.current.c) || 0;
        if (key === 'ytd.c') return Number(row.ytd && row.ytd.c) || 0;
        if (key === 'sharePctCurrent') return Number(row.sharePctCurrent) || 0;
        if (key === 'sharePctYtd') return Number(row.sharePctYtd) || 0;
        return 0;
      },
      pmSortMethod: function (key) {
        var self = this;
        return function (a, b) {
          return self.pmSortValue(a, key) - self.pmSortValue(b, key);
        };
      }
    },
    template: `
      <div class="rl-ov">
        <section class="rl-ov-surface">
          <div class="rl-ov-kpis">
            <article
              v-for="kpi in kpis"
              :key="kpi.key"
              class="rl-ov-kpi"
              :class="{ 'is-primary': kpi.sourceType === 'manual' }"
            >
              <header class="rl-ov-kpi-head">
                <h3>{{ kpi.label }}</h3>
                <el-tooltip
                  v-if="kpi.sourceType !== 'manual'"
                  effect="dark"
                  placement="top"
                  :content="syncTagTooltip"
                  popper-class="rl-ov-src-tip"
                >
                  <span class="rl-ov-src is-sync">
                    <i class="rl-ov-dot"></i>{{ getKpiTagText(kpi) }}
                  </span>
                </el-tooltip>
                <span v-else class="rl-ov-src is-manual">
                  <i class="rl-ov-dot"></i>{{ getKpiTagText(kpi) }}
                </span>
              </header>
              <div class="rl-ov-kpi-main">
                <p class="rl-ov-kpi-value" :class="signClass(kpi.values.current)">
                  <span class="num">{{ formatWan(kpi.values.current) }}</span><span class="unit">万</span>
                </p>
                <p v-if="kpi.key === 'completion'" class="rl-ov-delta" :class="deltaClass(kpi.values.deltaCurrent)">
                  较上一期 {{ formatDelta(kpi.values.deltaCurrent) }}
                </p>
              </div>
              <dl class="rl-ov-kpi-meta">
                <div><dt>本年累计</dt><dd :class="signClass(kpi.values.ytd)">{{ formatWan(kpi.values.ytd) }}<i>万</i></dd></div>
                <div><dt>未来预测</dt><dd :class="signClass(kpi.values.future)">{{ formatWan(kpi.values.future) }}<i>万</i></dd></div>
              </dl>
            </article>
            <article class="rl-ov-kpi is-stock-col">
              <div v-for="stock in stockKpis" :key="stock.key" class="rl-ov-stock-block">
                <header class="rl-ov-kpi-head">
                  <h3>{{ stock.label }}</h3>
                </header>
                <div class="rl-ov-kpi-main">
                  <p class="rl-ov-kpi-value" :class="signClass(stock.value)">
                    <span class="num">{{ formatWan(stock.value) }}</span><span class="unit">万</span>
                  </p>
                  <p class="rl-ov-delta" :class="deltaClass(stock.delta, stock.invertDelta)">
                    较上一期 {{ formatDelta(stock.delta) }}
                  </p>
                </div>
              </div>
            </article>
          </div>
        </section>

        <div class="rl-ov-split">
          <section class="rl-ov-sec rl-ov-sec-fixed">
            <header class="rl-ov-sec-head">
              <h2>本月完成合同额情况</h2>
              <div class="rl-ov-sec-meta">
                <span class="rl-ov-sec-note">单位：万元</span>
                <button type="button" class="rl-ov-more" @click="openDiffDrill">更多</button>
              </div>
            </header>
            <div class="rl-ov-legend" v-if="!completionChartEmptyKind">
              <span><i class="is-pos"></i>正值</span>
              <span><i class="is-neg"></i>负值</span>
            </div>
            <div class="rl-ov-sec-body">
              <div v-if="completionChartEmptyKind === 'none'" class="rl-ov-chart-empty">本次填报没有项目</div>
              <div v-else-if="completionChartEmptyKind === 'all-zero'" class="rl-ov-chart-empty">本月完成合同额均为 0</div>
              <div v-show="!completionChartEmptyKind" ref="completionChart" class="rl-ov-mini-chart"></div>
            </div>
          </section>

          <section class="rl-ov-sec rl-ov-sec-fixed">
            <header class="rl-ov-sec-head">
              <h2>项目预警一览</h2>
              <div class="rl-ov-sec-meta">
                <button type="button" class="rl-ov-more" @click="openAttentionDrill">更多</button>
              </div>
            </header>
            <div class="rl-ov-sec-body">
              <div v-if="!(attention.total > 0)" class="rl-ov-chart-empty">未发现异常</div>
              <div v-show="attention.total > 0" ref="attentionChart" class="rl-ov-mini-chart"></div>
            </div>
          </section>
        </div>

        <section class="rl-ov-sec">
          <header class="rl-ov-sec-head">
            <h2>月度走势</h2>
            <span class="rl-ov-sec-note">柱=各月，线=累计；右侧为预测月。单位：万元</span>
          </header>
          <div ref="trendChart" class="rl-ov-chart"></div>
        </section>

        <section v-if="!isPm" class="rl-ov-sec">
          <header class="rl-ov-sec-head">
            <h2>按项目经理汇总</h2>
            <span class="rl-ov-sec-note">点击表头排序 · 单位：万元</span>
          </header>
          <el-table :data="pmSummary" size="mini" max-height="320" empty-text="暂无项目" :default-sort="{ prop: 'ytd.c', order: 'descending' }">
            <el-table-column prop="pmName" label="项目经理" min-width="110"></el-table-column>
            <el-table-column prop="projectCount" label="项目数" width="88" align="right" header-align="right" sortable :sort-method="pmSortMethod('projectCount')"></el-table-column>
            <el-table-column prop="current.i" label="当月开票额" min-width="120" align="right" header-align="right" sortable :sort-method="pmSortMethod('current.i')">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.i)">{{ formatWan(scope.row.current.i) }}</span></template>
            </el-table-column>
            <el-table-column prop="current.p" label="当月回款额" min-width="120" align="right" header-align="right" sortable :sort-method="pmSortMethod('current.p')">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.p)">{{ formatWan(scope.row.current.p) }}</span></template>
            </el-table-column>
            <el-table-column prop="current.c" label="当月完成合同额" min-width="144" align="right" header-align="right" sortable :sort-method="pmSortMethod('current.c')">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.c)">{{ formatWan(scope.row.current.c) }}</span></template>
            </el-table-column>
            <el-table-column prop="ytd.c" label="本年累计完成合同额" min-width="168" align="right" header-align="right" sortable :sort-method="pmSortMethod('ytd.c')">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.ytd.c)">{{ formatWan(scope.row.ytd.c) }}</span></template>
            </el-table-column>
            <el-table-column label="完成合同额占比" align="center" header-align="center">
              <el-table-column prop="sharePctCurrent" label="当月" min-width="136" align="center" header-align="center" sortable :sort-method="pmSortMethod('sharePctCurrent')">
                <template slot-scope="scope">
                  <div class="rl-ov-share">
                    <span class="rl-ov-share-track"><i :style="{ width: Math.max(0, Math.min(1, scope.row.sharePctCurrent || 0)) * 100 + '%' }"></i></span>
                    <span class="rl-ov-num">{{ formatPct(scope.row.sharePctCurrent) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="sharePctYtd" label="本年累计" min-width="136" align="center" header-align="center" sortable :sort-method="pmSortMethod('sharePctYtd')">
                <template slot-scope="scope">
                  <div class="rl-ov-share">
                    <span class="rl-ov-share-track"><i :style="{ width: Math.max(0, Math.min(1, scope.row.sharePctYtd || 0)) * 100 + '%' }"></i></span>
                    <span class="rl-ov-num">{{ formatPct(scope.row.sharePctYtd) }}</span>
                  </div>
                </template>
              </el-table-column>
            </el-table-column>
          </el-table>
        </section>

        <el-dialog
          :title="'本月完成合同额情况（' + drillDiffProjects.length + '）'"
          custom-class="rl-ov-drill"
          :visible.sync="diffDrillVisible"
          width="1280px"
          top="6vh"
          append-to-body
          :close-on-click-modal="true"
        >
          <el-table :data="pagedDiffProjects" size="mini" empty-text="本次填报没有项目">
            <el-table-column prop="projectNo" label="项目号" min-width="112" fixed></el-table-column>
            <el-table-column prop="projectName" label="项目名称" min-width="180" show-overflow-tooltip></el-table-column>
            <el-table-column prop="pmName" label="项目经理" min-width="88"></el-table-column>
            <el-table-column label="本月完成合同额（万元）" min-width="176" align="right" header-align="right">
              <template slot-scope="scope">
                <span class="rl-ov-num" :class="signClass(scope.row.monthCompletion)">{{ formatWan(scope.row.monthCompletion) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="总合同额（万元）" min-width="140" align="right" header-align="right">
              <template slot-scope="scope">
                <span class="rl-ov-num" :class="signClass(scope.row.totalContract)">{{ formatWan(scope.row.totalContract) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="当月开票（万元）" min-width="140" align="right" header-align="right">
              <template slot-scope="scope">
                <span class="rl-ov-num" :class="signClass(scope.row.monthInvoice)">{{ formatWan(scope.row.monthInvoice) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="当月回款（万元）" min-width="140" align="right" header-align="right">
              <template slot-scope="scope">
                <span class="rl-ov-num" :class="signClass(scope.row.monthPayment)">{{ formatWan(scope.row.monthPayment) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="" width="72" fixed="right" align="right">
              <template slot-scope="scope">
                <el-button type="text" @click="onOpenProject(scope.row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="drillDiffProjects.length > 0" class="rl-ov-drill-pager">
            <el-pagination
              background
              :current-page="drillPages.diff"
              :page-sizes="[10, 20, 50]"
              :page-size="drillPageSize"
              :total="drillDiffProjects.length"
              layout="total, sizes, prev, pager, next"
              @current-change="handleDiffPageChange"
              @size-change="handleDrillSizeChange"
            ></el-pagination>
          </div>
        </el-dialog>

        <el-dialog
          :title="'项目预警一览（' + filteredAttentionItems.length + '）'"
          custom-class="rl-ov-drill"
          :visible.sync="attentionDrillVisible"
          width="1280px"
          top="6vh"
          append-to-body
          :close-on-click-modal="true"
        >
          <div class="rl-ov-chips" v-if="attention.total > 0">
            <button
              v-for="chip in attentionFilterChips"
              :key="chip.value || 'all'"
              type="button"
              class="rl-ov-chip"
              :class="{ 'is-active': attentionFilter === chip.value, 'is-all': !chip.value }"
              @click="setAttentionFilter(chip.value)"
            >
              {{ chip.label }}<b>{{ chip.count }}</b>
            </button>
          </div>
          <el-table :data="pagedAttentionItems" size="mini" empty-text="未发现异常">
            <el-table-column prop="projectNo" label="项目号" min-width="112"></el-table-column>
            <el-table-column prop="projectName" label="项目名称" min-width="180" show-overflow-tooltip></el-table-column>
            <el-table-column prop="pmName" label="项目经理" min-width="88"></el-table-column>
            <el-table-column label="异常类型" min-width="180">
              <template slot-scope="scope">
                <span class="rl-ov-flag">{{ scope.row.label }}</span>
              </template>
            </el-table-column>
            <el-table-column label="" width="72" fixed="right" align="right">
              <template slot-scope="scope">
                <el-button type="text" @click="onOpenProject(scope.row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="filteredAttentionItems.length > 0" class="rl-ov-drill-pager">
            <el-pagination
              background
              :current-page="drillPages.attention"
              :page-sizes="[10, 20, 50]"
              :page-size="drillPageSize"
              :total="filteredAttentionItems.length"
              layout="total, sizes, prev, pager, next"
              @current-change="handleAttentionPageChange"
              @size-change="handleDrillSizeChange"
            ></el-pagination>
          </div>
        </el-dialog>
      </div>
    `
  };
})(window);
