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

  function deltaClass(val) {
    if (val == null || val === '' || isNaN(Number(val))) return 'is-flat';
    var n = Number(val);
    if (Math.abs(n) < 0.005) return 'is-flat';
    return n < 0 ? 'is-down' : 'is-up';
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
        liveAlerts: [],
        alertsLoaded: false,
        diffDrillVisible: false,
        attentionDrillVisible: false,
        previewLimit: 5,
        drillPages: { diff: 1, attention: 1 },
        drillPageSize: 10,
        attentionFilter: ''
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
      secondaryMetrics: function () {
        var b = this.backlog;
        return [
          { key: 'contractStock', label: '存量合同额', value: b.contractStock, delta: b.deltaContractStock },
          { key: 'invoiceStock', label: '存量开票额', value: b.invoiceStock, delta: b.deltaInvoiceStock },
          { key: 'fullYear', label: '全年预计完成合同额', value: b.fullYearForecastCompletion, delta: b.deltaFullYearForecastCompletion }
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
      previewDiffProjects: function () {
        return this.diffProjects.slice(0, this.previewLimit);
      },
      previewAttentionItems: function () {
        return this.filteredAttentionItems.slice(0, this.previewLimit);
      },
      isPm: function () {
        return !!(window.Store && Store.currentUser && Store.currentUser.role === 'pm');
      },
      pagedDiffProjects: function () {
        return this.slicePage(this.diffProjects, this.drillPages.diff);
      },
      pagedAttentionItems: function () {
        return this.slicePage(this.filteredAttentionItems, this.drillPages.attention);
      }
    },
    watch: {
      trend: function () { this.$nextTick(this.renderTrendChart); },
      projects: function () { this.fetchLiveAlerts(); },
      monthIdx: function () { this.fetchLiveAlerts(); }
    },
    mounted: function () {
      this.fetchLiveAlerts();
      this.renderTrendChart();
      var self = this;
      this._resizeHandler = function () {
        if (self.chart) self.chart.resize();
      };
      window.addEventListener('resize', this._resizeHandler);
    },
    beforeDestroy: function () {
      if (this.chart) {
        this.chart.dispose();
        this.chart = null;
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
        return kpi.sourceType === 'manual' ? '本期填报申报值' : '平台实时同步';
      },
      onOpenProject: function (row) {
        if (!row || !row.projectNo) return;
        this.diffDrillVisible = false;
        this.attentionDrillVisible = false;
        this.$emit('open-project', row.projectNo);
      },
      openDiffDrill: function () {
        this.$set(this.drillPages, 'diff', 1);
        this.diffDrillVisible = true;
      },
      openAttentionDrill: function () {
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
      renderTrendChart: function () {
        if (!this.$refs.trendChart || typeof echarts === 'undefined') return;
        if (!this.chart) this.chart = echarts.init(this.$refs.trendChart);
        var idx = this.trend.reportingMonthIdx == null ? this.monthIdx : this.trend.reportingMonthIdx;
        var months = this.trend.months || [];
        var completion = this.trend.completion || [];
        var invoice = this.trend.invoice || [];
        var payment = this.trend.payment || [];
        var split = function (arr) {
          return {
            solid: arr.map(function (v, i) { return i <= idx ? v : null; }),
            dash: arr.map(function (v, i) { return i >= idx ? v : null; })
          };
        };
        var c = split(completion);
        var i = split(invoice);
        var p = split(payment);
        var wan = function (v) { return v == null ? null : v / 10000; };
        var toWan = function (o) {
          return { solid: o.solid.map(wan), dash: o.dash.map(wan) };
        };
        c = toWan(c); i = toWan(i); p = toWan(p);

        // 品牌色系：申报口径（完成合同额）为主色并带面积填充，平台同步的两项退为辅助色
        var BRAND = '#007069';
        var INVOICE = '#4d8fa8';
        var PAYMENT = '#c08a2e';
        var axisLabel = { color: '#9ca3af', fontSize: 11 };
        var line = function (name, color, data, opts) {
          return Object.assign({
            name: name,
            type: 'line',
            smooth: 0.28,
            data: data,
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { width: 2, color: color },
            itemStyle: { color: color, borderColor: '#fff', borderWidth: 1.5 }
          }, opts || {});
        };
        var ghost = function (name, color, data) {
          return line(name, color, data, {
            lineStyle: { width: 2, type: 'dashed', color: color, opacity: 0.75 },
            showSymbol: false,
            tooltip: { show: false }
          });
        };

        this.chart.setOption({
          color: [BRAND, INVOICE, PAYMENT],
          textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
          tooltip: {
            trigger: 'axis',
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
            data: ['完成合同额', '完成开票额', '完成回款额'],
            top: 0,
            right: 0,
            itemWidth: 14,
            itemHeight: 3,
            itemGap: 18,
            icon: 'roundRect',
            textStyle: { color: '#6b7280', fontSize: 12 }
          },
          grid: { top: 34, left: 4, right: 8, bottom: 0, containLabel: true },
          xAxis: {
            type: 'category',
            data: months,
            boundaryGap: false,
            axisLine: { lineStyle: { color: '#e5e7eb' } },
            axisTick: { show: false },
            axisLabel: axisLabel
          },
          yAxis: {
            type: 'value',
            name: '万',
            nameTextStyle: { color: '#9ca3af', fontSize: 11, padding: [0, 0, 0, -18] },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: axisLabel,
            splitLine: { lineStyle: { color: 'rgba(15,23,42,0.06)' } }
          },
          series: [
            line('完成合同额', BRAND, c.solid, {
              lineStyle: { width: 2.6, color: BRAND },
              areaStyle: {
                color: {
                  type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(0,112,105,0.16)' },
                    { offset: 1, color: 'rgba(0,112,105,0)' }
                  ]
                }
              },
              markArea: idx < months.length - 1 ? {
                silent: true,
                itemStyle: { color: 'rgba(15,23,42,0.028)' },
                label: {
                  show: true, position: 'insideTop', color: '#9ca3af', fontSize: 11, padding: [4, 0, 0, 0], formatter: '预测'
                },
                data: [[{ xAxis: months[idx] }, { xAxis: months[months.length - 1] }]]
              } : undefined
            }),
            ghost('完成合同额', BRAND, c.dash),
            line('完成开票额', INVOICE, i.solid),
            ghost('完成开票额', INVOICE, i.dash),
            line('完成回款额', PAYMENT, p.solid),
            ghost('完成回款额', PAYMENT, p.dash)
          ]
        }, true);
      }
    },
    template: `
      <div class="rl-ov">
        <section class="rl-ov-surface">
          <div class="rl-ov-kpis">
            <article v-for="kpi in kpis" :key="kpi.key" class="rl-ov-kpi" :class="{ 'is-primary': kpi.sourceType === 'manual' }">
              <header class="rl-ov-kpi-head">
                <h3>{{ kpi.label }}</h3>
                <span class="rl-ov-src" :class="kpi.sourceType === 'manual' ? 'is-manual' : 'is-sync'">
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
              <p class="rl-ov-kpi-caption">当月（{{ monthLabel }}）</p>
              <dl class="rl-ov-kpi-meta">
                <div><dt>本年累计</dt><dd :class="signClass(kpi.values.ytd)">{{ formatWan(kpi.values.ytd) }}<i>万</i></dd></div>
                <div><dt>未来预测</dt><dd :class="signClass(kpi.values.future)">{{ formatWan(kpi.values.future) }}<i>万</i></dd></div>
                <div><dt>项目始累</dt><dd :class="signClass(kpi.values.cumulative)">{{ formatWan(kpi.values.cumulative) }}<i>万</i></dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section class="rl-ov-surface">
          <dl class="rl-ov-strip">
            <div v-for="metric in secondaryMetrics" :key="metric.key">
              <dt>{{ metric.label }}</dt>
              <dd>
                <span class="rl-ov-strip-amt" :class="signClass(metric.value)">{{ formatWan(metric.value) }}<i>万</i></span>
                <span class="rl-ov-delta" :class="deltaClass(metric.delta)">较上一期 {{ formatDelta(metric.delta) }}</span>
              </dd>
            </div>
          </dl>
        </section>

        <div class="rl-ov-split">
          <section class="rl-ov-sec rl-ov-sec-fixed">
            <header class="rl-ov-sec-head">
              <h2>本月完成合同额情况</h2>
              <div class="rl-ov-sec-meta">
                <button type="button" class="rl-ov-more" @click="openDiffDrill">更多</button>
              </div>
            </header>
            <div class="rl-ov-sec-body">
              <el-table :data="previewDiffProjects" size="mini" height="100%" empty-text="本次填报没有项目">
                <el-table-column prop="projectNo" label="项目号" min-width="108"></el-table-column>
                <el-table-column prop="projectName" label="项目名称" min-width="140" show-overflow-tooltip></el-table-column>
                <el-table-column prop="pmName" label="项目经理" min-width="84"></el-table-column>
                <el-table-column label="本月完成合同额（万元）" min-width="168" align="right" header-align="right">
                  <template slot-scope="scope">
                    <span class="rl-ov-num" :class="signClass(scope.row.monthCompletion)">{{ formatWan(scope.row.monthCompletion) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="" width="64" fixed="right" align="right">
                  <template slot-scope="scope">
                    <el-button type="text" @click="onOpenProject(scope.row)">查看</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </section>

          <section class="rl-ov-sec rl-ov-sec-fixed">
            <header class="rl-ov-sec-head">
              <h2>项目预警一览</h2>
              <div class="rl-ov-sec-meta">
                <button type="button" class="rl-ov-more" @click="openAttentionDrill">更多</button>
              </div>
            </header>
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
            <div class="rl-ov-sec-body">
              <el-table :data="previewAttentionItems" size="mini" height="100%" empty-text="未发现异常">
                <el-table-column prop="projectNo" label="项目号" min-width="108"></el-table-column>
                <el-table-column prop="projectName" label="项目名称" min-width="140" show-overflow-tooltip></el-table-column>
                <el-table-column prop="pmName" label="项目经理" min-width="84"></el-table-column>
                <el-table-column label="异常类型" min-width="160">
                  <template slot-scope="scope">
                    <span class="rl-ov-flag">{{ scope.row.label }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="" width="64" fixed="right" align="right">
                  <template slot-scope="scope">
                    <el-button type="text" @click="onOpenProject(scope.row)">查看</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </section>
        </div>

        <section class="rl-ov-sec">
          <header class="rl-ov-sec-head">
            <h2>月度走势</h2>
            <span class="rl-ov-sec-note">实线为已发生，虚线为预测。单位：万元</span>
          </header>
          <div ref="trendChart" class="rl-ov-chart"></div>
        </section>

        <section v-if="!isPm" class="rl-ov-sec">
          <header class="rl-ov-sec-head">
            <h2>按项目经理汇总</h2>
            <span class="rl-ov-sec-note">单位：万元</span>
          </header>
          <el-table :data="pmSummary" size="mini" max-height="320" empty-text="暂无项目">
            <el-table-column prop="pmName" label="项目经理" min-width="110"></el-table-column>
            <el-table-column prop="projectCount" label="项目数" width="80" align="right" header-align="right"></el-table-column>
            <el-table-column label="当月开票额" min-width="112" align="right" header-align="right">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.i)">{{ formatWan(scope.row.current.i) }}</span></template>
            </el-table-column>
            <el-table-column label="当月回款额" min-width="112" align="right" header-align="right">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.p)">{{ formatWan(scope.row.current.p) }}</span></template>
            </el-table-column>
            <el-table-column label="当月完成合同额" min-width="136" align="right" header-align="right">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.current.c)">{{ formatWan(scope.row.current.c) }}</span></template>
            </el-table-column>
            <el-table-column label="本年累计完成合同额" min-width="148" align="right" header-align="right">
              <template slot-scope="scope"><span class="rl-ov-num" :class="signClass(scope.row.ytd.c)">{{ formatWan(scope.row.ytd.c) }}</span></template>
            </el-table-column>
            <el-table-column label="完成合同额占比" align="center" header-align="center">
              <el-table-column label="当月" min-width="136" align="center" header-align="center">
                <template slot-scope="scope">
                  <div class="rl-ov-share">
                    <span class="rl-ov-share-track"><i :style="{ width: Math.max(0, Math.min(1, scope.row.sharePctCurrent || 0)) * 100 + '%' }"></i></span>
                    <span class="rl-ov-num">{{ formatPct(scope.row.sharePctCurrent) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="本年累计" min-width="136" align="center" header-align="center">
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
          :title="'本月完成合同额情况（' + diffProjects.length + '）'"
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
          <div v-if="diffProjects.length > 0" class="rl-ov-drill-pager">
            <el-pagination
              background
              :current-page="drillPages.diff"
              :page-sizes="[10, 20, 50]"
              :page-size="drillPageSize"
              :total="diffProjects.length"
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
