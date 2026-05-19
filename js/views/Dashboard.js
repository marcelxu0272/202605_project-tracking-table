/**
 * Dashboard.js — 数据看板
 * KPI卡片 + 月度完成趋势 + WIP账龄饼图 + 开票回款对比 + 预警列表
 */
(function (window) {
  'use strict';

  const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const fa = Formatters.formatAmount;
  const fs = Formatters.formatAmountShort;
  const fp = Formatters.formatPercent;

  window.DashboardView = {
    name: 'Dashboard',
    data() {
      return {
        chartTrend: null,
        chartWip:   null,
        chartInv:   null,
        summary:    null
      };
    },
    computed: {
      store() { return window.Store; },
      monthIdx() { return Store.getMonthIdx(); },
      currentMonthName() { return MONTHS[this.monthIdx]; }
    },
    mounted() {
      this.refresh();
    },
    activated() {
      this.refresh();
    },
    beforeDestroy() {
      if (this.chartTrend) { this.chartTrend.dispose(); this.chartTrend = null; }
      if (this.chartWip)   { this.chartWip.dispose();   this.chartWip = null; }
      if (this.chartInv)   { this.chartInv.dispose();   this.chartInv = null; }
    },
    methods: {
      refresh() {
        this.summary = Store.getSummary();
        this.$nextTick(() => {
          this.initCharts();
        });
      },
      initCharts() {
        this.initTrendChart();
        this.initWipChart();
        this.initInvChart();
      },
      initTrendChart() {
        const el = document.getElementById('chart-trend');
        if (!el || !window.echarts) return;
        if (this.chartTrend) this.chartTrend.dispose();
        const s = this.summary;
        const mi = this.monthIdx;
        const vals = s.monthlyTotals.map((v, i) => ({ value: v, isForecast: i > mi }));
        this.chartTrend = echarts.init(el);
        this.chartTrend.setOption({
          tooltip: {
            trigger: 'axis',
            formatter(params) {
              const v = params[0].value;
              return `${params[0].name}<br/>${params[0].seriesName}：${fa(v)}`;
            }
          },
          legend: { data: ['已完成（万元）', '预测（万元）'], right: 0, top: 0, itemWidth: 12 },
          grid: { left: 0, right: 0, bottom: 0, top: 36, containLabel: true },
          xAxis: { type: 'category', data: MONTHS, axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { color: '#64748b', fontSize: 11 } },
          yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 11, formatter: v => (v/10000).toFixed(0)+'万' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
          series: [
            {
              name: '已完成（万元）',
              type: 'bar',
              barMaxWidth: 36,
              data: s.monthlyTotals.map((v, i) => i <= mi ? v : 0),
              itemStyle: { color: '#007069', borderRadius: [3,3,0,0] },
              label: { show: false }
            },
            {
              name: '预测（万元）',
              type: 'bar',
              barMaxWidth: 36,
              data: s.monthlyTotals.map((v, i) => i > mi ? v : 0),
              itemStyle: { color: '#b3d9d6', borderRadius: [3,3,0,0] }
            },
            {
              name: '累计完成',
              type: 'line',
              smooth: true,
              symbol: 'none',
              data: s.monthlyTotals.reduce((acc, v, i) => {
                acc.push((acc[i-1] || 0) + v);
                return acc;
              }, []),
              yAxisIndex: 0,
              lineStyle: { color: '#f59e0b', width: 2 },
              itemStyle: { color: '#f59e0b' }
            }
          ]
        });
        window.addEventListener('resize', () => { if (this.chartTrend) this.chartTrend.resize(); });
      },
      initWipChart() {
        const el = document.getElementById('chart-wip');
        if (!el || !window.echarts) return;
        if (this.chartWip) this.chartWip.dispose();
        const s = this.summary;
        const ages = [
          { name: '<1个月',   value: s.wipByAge.lt1m   },
          { name: '1~3个月',  value: s.wipByAge.m1to3  },
          { name: '3~6个月',  value: s.wipByAge.m3to6  },
          { name: '6~12个月', value: s.wipByAge.m6to12 },
          { name: '1~2年',    value: s.wipByAge.y1to2  },
          { name: '2~3年',    value: s.wipByAge.y2to3  },
          { name: '>3年',     value: s.wipByAge.gt3y   }
        ].filter(a => a.value > 0);
        this.chartWip = echarts.init(el);
        this.chartWip.setOption({
          tooltip: {
            trigger: 'item',
            formatter: (p) => `${p.name}<br/>${fa(p.value)}<br/>${p.percent.toFixed(1)}%`
          },
          legend: { orient: 'vertical', right: 0, top: 'middle', itemWidth: 10, textStyle: { fontSize: 11, color: '#64748b' } },
          series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['38%', '50%'],
            data: ages,
            label: { show: false },
            emphasis: { label: { show: true, fontSize: 12, fontWeight: 600 } },
            itemStyle: { borderRadius: 4 },
            color: ['#007069','#b3d9d6','#f59e0b','#fb923c','#ef4444','#dc2626','#7f1d1d']
          }]
        });
        window.addEventListener('resize', () => { if (this.chartWip) this.chartWip.resize(); });
      },
      initInvChart() {
        const el = document.getElementById('chart-inv');
        if (!el || !window.echarts) return;
        if (this.chartInv) this.chartInv.dispose();
        const s = this.summary;
        const mi = this.monthIdx;
        this.chartInv = echarts.init(el);
        this.chartInv.setOption({
          tooltip: {
            trigger: 'axis',
            formatter(params) {
              return `${params[0].name}<br/>` +
                params.map(p => `${p.seriesName}：${fa(p.value)}`).join('<br/>');
            }
          },
          legend: { data: ['开票', '回款'], right: 0, top: 0, itemWidth: 12 },
          grid: { left: 0, right: 0, bottom: 0, top: 36, containLabel: true },
          xAxis: { type: 'category', data: MONTHS.slice(0, mi+1), axisLabel: { color: '#64748b', fontSize: 11 }, axisLine: { lineStyle: { color: '#e2e8f0' } } },
          yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 11, formatter: v => (v/10000).toFixed(0)+'万' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
          series: [
            {
              name: '开票',
              type: 'bar',
              barMaxWidth: 28,
              data: s.monthlyInvoice.slice(0, mi+1),
              itemStyle: { color: '#007069', borderRadius: [3,3,0,0] }
            },
            {
              name: '回款',
              type: 'bar',
              barMaxWidth: 28,
              data: s.monthlyPayment.slice(0, mi+1),
              itemStyle: { color: '#b3d9d6', borderRadius: [3,3,0,0] }
            }
          ]
        });
        window.addEventListener('resize', () => { if (this.chartInv) this.chartInv.resize(); });
      }
    },
    template: `
      <div>
        <!-- KPI 卡片 -->
        <div class="kpi-grid" v-if="summary">
          <div class="kpi-card">
            <div class="kpi-label">总合同额</div>
            <div class="kpi-value amount">
              <template v-if="summary.totalContract >= 1e8">
                {{ (summary.totalContract/1e8).toFixed(2) }} <span class="kpi-unit">亿元</span>
              </template>
              <template v-else>
                {{ (summary.totalContract/1e4).toFixed(2) }} <span class="kpi-unit">万元</span>
              </template>
            </div>
            <div class="kpi-sub">共 {{ summary.computed.length }} 个项目</div>
          </div>
          <div class="kpi-card warning">
            <div class="kpi-label">{{ currentMonthName }}完成额</div>
            <div class="kpi-value amount">{{ (summary.currentMonth/1e4).toFixed(2) }} <span class="kpi-unit">万元</span></div>
            <div class="kpi-sub">年累计 {{ (summary.ytdCompleted/1e4).toFixed(2) }} 万元</div>
          </div>
          <div class="kpi-card danger">
            <div class="kpi-label">WIP 总额（含税）</div>
            <div class="kpi-value amount">{{ (summary.totalWip/1e4).toFixed(2) }} <span class="kpi-unit">万元</span></div>
            <div class="kpi-sub">
              <span style="color:#ef4444;" v-if="summary.wipAlerts.length">{{ summary.wipAlerts.length }} 个项目 WIP 超50%</span>
              <span v-else style="color:#10b981;">无高风险预警</span>
            </div>
          </div>
          <div class="kpi-card info">
            <div class="kpi-label">始累开票完成率</div>
            <div class="kpi-value amount">
              {{ summary.totalContract > 0 ? ((summary.totalCumInvoice / summary.totalContract)*100).toFixed(1) : '—' }}
              <span class="kpi-unit">%</span>
            </div>
            <div class="kpi-sub">累计开票 {{ (summary.totalCumInvoice/1e4).toFixed(2) }} 万元</div>
          </div>
        </div>

        <!-- 图表区 -->
        <div class="charts-grid" v-if="summary">
          <!-- 月度完成趋势 -->
          <div class="chart-box">
            <div class="card-header">
              <div class="card-title">月度完成额趋势（万元）</div>
              <span style="font-size:11px;color:#94a3b8;">含预测</span>
            </div>
            <div id="chart-trend" class="chart-container" style="height:240px;"></div>
          </div>
          <!-- WIP 账龄分布 -->
          <div class="chart-box">
            <div class="card-header">
              <div class="card-title">WIP 账龄分布</div>
            </div>
            <div id="chart-wip" class="chart-container" style="height:240px;"></div>
          </div>
        </div>

        <!-- 开票回款 + 预警 并排 -->
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;" v-if="summary">
          <!-- 开票回款对比 -->
          <div class="chart-box">
            <div class="card-header">
              <div class="card-title">本年度开票 vs 回款（万元）</div>
            </div>
            <div id="chart-inv" class="chart-container" style="height:220px;"></div>
          </div>

          <!-- WIP 预警 -->
          <div class="card" style="padding:16px 20px;">
            <div class="card-header">
              <div class="card-title" style="color:#ef4444;">WIP 超50%预警</div>
              <el-tag size="mini" type="danger" v-if="summary.wipAlerts.length">{{ summary.wipAlerts.length }}项</el-tag>
              <el-tag size="mini" type="success" v-else>正常</el-tag>
            </div>
            <div class="wip-alert-list" v-if="summary.wipAlerts.length">
              <div
                v-for="item in summary.wipAlerts.slice(0,6)"
                :key="item.id"
                class="wip-alert-item"
                :class="item.ratio > 0.8 ? '' : 'warning'"
              >
                <div>
                  <div class="wip-alert-name">{{ item.name.slice(0,16) }}{{ item.name.length>16?'…':'' }}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">{{ item.id }}</div>
                </div>
                <div class="wip-alert-ratio">{{ (item.ratio*100).toFixed(0) }}%</div>
              </div>
            </div>
            <div class="empty-state" v-else style="padding:20px 0;">
              <i class="el-icon-success" style="font-size:28px;color:#10b981;"></i>
              <div style="font-size:12px;margin-top:6px;">暂无预警项目</div>
            </div>
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="!summary" style="text-align:center;padding:80px;color:#94a3b8;">
          <i class="el-icon-loading" style="font-size:32px;"></i>
          <div style="margin-top:12px;">加载中...</div>
        </div>
      </div>
    `
  };
})(window);
