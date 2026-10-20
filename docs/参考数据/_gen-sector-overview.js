'use strict';

/**
 * 用真实跟踪表生成「板块概览」静态预览页。
 * 左侧侧栏切换板块，右侧布局与线上报告线概览一致。
 * 样式已内联，单文件可直接分享（仍需外网加载 ECharts CDN）。
 *
 *   node docs/参考数据/_gen-sector-overview.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { projectsFromXlsxBuffer } = require('../../server/xlsx-seed');
const { loadBrowserScripts } = require('../../server/load-modules');
const { SECTOR_NAMES, normalizeSectorCode, DEFAULT_SECTOR_REGISTRY } = require('../../server/sector-workflow');

const ROOT = path.join(__dirname, '..', '..');
const xlsxPath = path.join(__dirname, '项目跟踪表_2026-10_20261016_131821.xlsx');
const outPath = path.join(__dirname, '2026-10-板块概览预览.html');
/** 表名是 10 月，但 mc_9 全空；最近有发生额的是 9 月（index 8） */
const MONTH_IDX = 8;
const MONTH_LABEL = '9月';

const modules = loadBrowserScripts();
const overviewCtx = {
  module: { exports: {} },
  exports: {},
  console,
  FieldConfig: modules.FieldConfig,
  FormulaEngine: modules.FormulaEngine,
  StockValidation: modules.StockValidation,
  ProjectAlerts: modules.ProjectAlerts
};
overviewCtx.window = overviewCtx;
vm.createContext(overviewCtx);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js/report-line-overview.js'), 'utf8'),
  overviewCtx,
  { filename: 'report-line-overview.js' }
);
const Overview = overviewCtx.module.exports;

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function pack(projects) {
  const overview = Overview.buildOverview(projects, [], MONTH_IDX);
  /** 预览口径：较上一期 = 较前一个月（同批项目、上一月下标） */
  const prevOverview = MONTH_IDX > 0 ? Overview.buildOverview(projects, [], MONTH_IDX - 1) : null;
  const treemap = Overview.buildCompletionTreemap(overview.diffSummary.topProjects || []);
  const alerts = Overview.buildAlertTypeRank((overview.attention && overview.attention.items) || []);
  const byKey = {};
  (overview.kpis || []).forEach(function (k) { byKey[k.key] = k; });
  const prevByKey = {};
  if (prevOverview && prevOverview.kpis) {
    prevOverview.kpis.forEach(function (k) { prevByKey[k.key] = k; });
  }
  const backlog = overview.backlog || {};
  const prevBacklog = (prevOverview && prevOverview.backlog) || null;
  const trend = overview.monthlyTrend || {};
  function momDelta(curr, prev) {
    if (prevOverview == null) return null;
    return num(curr) - num(prev);
  }
  return {
    projectCount: projects.length,
    monthLabel: MONTH_LABEL,
    kpis: ['completion', 'invoice', 'payment'].map(function (key) {
      const k = byKey[key] || { label: key, sourceType: 'manual', values: {} };
      const prev = prevByKey[key];
      const values = {
        current: (k.values && k.values.current) || 0,
        ytd: (k.values && k.values.ytd) || 0,
        future: (k.values && k.values.future) || 0,
        deltaCurrent: null
      };
      if (key === 'completion') {
        values.deltaCurrent = momDelta(
          values.current,
          prev && prev.values ? prev.values.current : 0
        );
      }
      return {
        key: key,
        label: k.label,
        sourceType: k.sourceType,
        values: values
      };
    }),
    stockKpis: [
      {
        key: 'contractStock',
        label: '存量合同额',
        value: backlog.contractStock || 0,
        delta: momDelta(backlog.contractStock, prevBacklog && prevBacklog.contractStock),
        invertDelta: true
      },
      {
        key: 'invoiceStock',
        label: '存量开票额',
        value: backlog.invoiceStock || 0,
        delta: momDelta(backlog.invoiceStock, prevBacklog && prevBacklog.invoiceStock),
        invertDelta: true
      }
    ],
    tiles: (treemap.tiles || []).map(function (tile) {
      return {
        name: tile.kind === 'project' ? (tile.projectNo || '—') : tile.label,
        value: Math.abs(Number(tile.monthCompletion) || 0),
        kind: tile.kind,
        monthCompletion: tile.monthCompletion,
        projectNo: tile.projectNo || '',
        projectName: tile.projectName || '',
        pmName: tile.pmName || '',
        count: tile.count || 0
      };
    }),
    alerts: alerts,
    trend: {
      months: trend.months || [],
      completion: trend.completion || [],
      invoice: trend.invoice || [],
      payment: trend.payment || [],
      reportingMonthIdx: MONTH_IDX
    },
    pmSummary: (overview.pmSummary || []).map(function (row) {
      return {
        pmName: row.pmName || '',
        projectCount: row.projectCount || 0,
        current: {
          c: (row.current && row.current.c) || 0,
          i: (row.current && row.current.i) || 0,
          p: (row.current && row.current.p) || 0
        },
        ytd: { c: (row.ytd && row.ytd.c) || 0 },
        sharePctCurrent: row.sharePctCurrent || 0,
        sharePctYtd: row.sharePctYtd || 0
      };
    })
  };
}

const projects = projectsFromXlsxBuffer(fs.readFileSync(xlsxPath), modules, '2026-10');
const groups = {};
projects.forEach(function (project) {
  const code = normalizeSectorCode(project.unit_code);
  if (!groups[code]) groups[code] = [];
  groups[code].push(project);
});

const order = DEFAULT_SECTOR_REGISTRY.slice();
Object.keys(groups).forEach(function (code) {
  if (order.indexOf(code) < 0) order.push(code);
});

const sectors = [{ code: 'ALL', name: '全部板块' }].concat(
  order.filter(function (code) { return groups[code] && groups[code].length; })
    .map(function (code) { return { code: code, name: SECTOR_NAMES[code] || code }; })
);

const data = sectors.map(function (sector) {
  const list = sector.code === 'ALL' ? projects : groups[sector.code];
  return Object.assign({ code: sector.code, name: sector.name }, pack(list));
});

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>2026年9月板块概览预览</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    /* ── 自包含样式（摘自 css/style.css 必要片段 + 预览壳）── */
    :root {
      --color-brand: #007069;
      --color-brand-light: rgba(0, 112, 105, 0.1);
      --color-brand-tint-3: rgba(0, 112, 105, 0.03);
      --color-warning: #f59e0b;
      --color-danger: #ef4444;
      --color-bg: #f8faff;
      --color-text: #374151;
      --color-text-secondary: #6b7280;
      --color-text-muted: #9ca3af;
      --color-heading: #233845;
      --color-border: #e5e7eb;
      --color-sidebar-dark: #233845;
      --sidebar-width: 220px;
      --header-height: 56px;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      font-family: "Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB",
                   "Microsoft YaHei", "微软雅黑", Arial, sans-serif;
      background: var(--color-bg);
      color: var(--color-text);
      font-size: 14px;
      line-height: 1.5;
    }
    .app-layout {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .app-sidebar {
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      background: var(--color-sidebar-dark);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 100;
    }
    .sidebar-logo {
      height: var(--header-height);
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    .sidebar-logo-text {
      color: #fff;
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.5px;
    }
    .sidebar-nav {
      flex: 1;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 8px 0;
    }
    .sidebar-nav-plain {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .sidebar-nav-plain button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 42px;
      padding: 0 16px;
      border: 0;
      background: transparent;
      color: rgba(255,255,255,0.65);
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }
    .sidebar-nav-plain button:hover,
    .sidebar-nav-plain button.is-active {
      background: rgba(0,112,105,0.2);
      color: #fff;
    }
    .sidebar-nav-plain button b {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-weight: 600;
      font-size: 12px;
      opacity: 0.85;
    }

    .preview-note {
      margin: 0;
      padding: 8px 20px;
      background: #fff8ef;
      border-bottom: 1px solid #fde3c0;
      color: #92400e;
      font-size: 12px;
      line-height: 1.5;
    }
    .preview-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--color-bg);
    }
    .preview-head {
      flex: none;
      height: var(--header-height);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 20px;
      background: #fff;
      border-bottom: 1px solid var(--color-border);
    }
    .preview-head h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--color-heading);
    }
    .preview-head .meta {
      font-size: 12px;
      color: var(--color-text-muted);
    }
    .preview-body {
      flex: 1;
      overflow: auto;
      padding: 16px 20px 24px;
    }

    /* 报告线概览 */
    .rl-ov {
      --ov-hair: #eceff3;
      --ov-num: "SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-bottom: 12px;
    }
    .rl-ov .rl-ov-num,
    .rl-ov dd {
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum";
    }
    .rl-ov .is-neg { color: var(--color-danger); }
    .rl-ov-surface {
      background: #fff;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
      overflow: hidden;
    }
    .rl-ov-kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      background: var(--ov-hair);
      align-items: stretch;
    }
    .rl-ov-kpi {
      padding: 14px 16px 16px;
      background: #fff;
      min-width: 0;
    }
    .rl-ov-kpi.is-stock-col {
      display: grid;
      grid-template-rows: 1fr 1fr;
      padding: 14px 16px 16px;
      min-height: 100%;
    }
    .rl-ov-stock-block {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      min-height: 0;
      padding: 0;
    }
    .rl-ov-stock-block + .rl-ov-stock-block {
      border-top: 1px solid var(--ov-hair);
      padding-top: 10px;
    }
    .rl-ov-kpi.is-stock-col .rl-ov-kpi-value .num { font-size: 22px; }
    .rl-ov-kpi.is-stock-col .rl-ov-kpi-main { margin-top: 6px; }
    .rl-ov-kpi-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .rl-ov-kpi-head h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--color-heading);
    }
    .rl-ov-src {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 18px;
      white-space: nowrap;
      color: var(--color-brand);
      background: var(--color-brand-light);
    }
    .rl-ov-src.is-sync { cursor: help; }
    .rl-ov-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      flex: none;
    }
    .rl-ov-kpi-main {
      margin: 10px 0 0;
      display: flex;
      align-items: baseline;
      gap: 10px;
      min-width: 0;
    }
    .rl-ov-kpi-value {
      margin: 0;
      display: flex;
      align-items: baseline;
      gap: 4px;
      color: var(--color-heading);
    }
    .rl-ov-kpi-value .num {
      font-family: var(--ov-num);
      font-size: 28px;
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.012em;
    }
    .rl-ov-kpi-value .unit {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-muted);
    }
    .rl-ov-kpi.is-primary .rl-ov-kpi-value { color: var(--color-brand); }
    .rl-ov-kpi-value.is-neg,
    .rl-ov-kpi.is-primary .rl-ov-kpi-value.is-neg { color: var(--color-danger); }
    .rl-ov-kpi-caption {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--color-text-muted);
    }
    .rl-ov-delta {
      margin: 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-text-muted);
      white-space: nowrap;
    }
    .rl-ov-delta.is-up { color: var(--color-brand); }
    .rl-ov-delta.is-down { color: var(--color-danger); }
    .rl-ov-delta.is-flat { color: var(--color-text-muted); }
    .rl-ov-kpi-meta {
      margin: 14px 0 0;
      padding-top: 12px;
      border-top: 1px solid var(--ov-hair);
      display: grid;
      gap: 6px;
    }
    .rl-ov-kpi-meta > div {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
    }
    .rl-ov-kpi-meta dt { color: var(--color-text-muted); }
    .rl-ov-kpi-meta dd {
      margin: 0;
      font-family: var(--ov-num);
      color: var(--color-text);
    }
    .rl-ov-kpi-meta dd i {
      margin-left: 3px;
      font-style: normal;
      font-size: 11px;
      color: var(--color-text-muted);
    }
    .rl-ov-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: stretch;
    }
    .rl-ov-sec-fixed {
      display: flex;
      flex-direction: column;
      height: 380px;
    }
    .rl-ov-sec-fixed .rl-ov-sec-head { flex: none; }
    .rl-ov-sec-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .rl-ov-mini-chart {
      flex: 1;
      width: 100%;
      min-height: 0;
    }
    .rl-ov-chart-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      font-size: 13px;
      min-height: 80px;
    }
    .rl-ov-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: -4px 0 8px;
      font-size: 12px;
      color: var(--color-text-secondary);
    }
    .rl-ov-legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .rl-ov-legend i {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex: none;
    }
    .rl-ov-legend i.is-pos { background: #d7ebe9; box-shadow: inset 0 0 0 1px rgba(12, 79, 74, 0.28); }
    .rl-ov-legend i.is-neg { background: #f8d4d4; box-shadow: inset 0 0 0 1px rgba(159, 45, 45, 0.28); }
    .rl-ov-sec {
      background: #fff;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
      padding: 14px 16px 16px;
      min-width: 0;
    }
    .rl-ov-sec-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--ov-hair);
    }
    .rl-ov-sec-head h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-heading);
    }
    .rl-ov-sec-note {
      font-size: 12px;
      color: var(--color-text-muted);
      white-space: nowrap;
    }
    .rl-ov-sec-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: none;
    }
    .rl-ov-more {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--color-brand);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      pointer-events: none;
      opacity: 0.45;
    }
    .rl-ov-share {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .rl-ov-share-track {
      width: 56px;
      flex: none;
      height: 4px;
      border-radius: 999px;
      background: var(--color-brand-light);
      overflow: hidden;
    }
    .rl-ov-share-track i {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--color-brand);
    }
    .rl-ov-chart {
      width: 100%;
      height: 300px;
    }

    /* PM 汇总表 + 排序 */
    .rl-ov-pm-wrap { max-height: 320px; overflow: auto; }
    .rl-ov-pm-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .rl-ov-pm-table th,
    .rl-ov-pm-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--ov-hair);
      vertical-align: middle;
    }
    .rl-ov-pm-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #fafbfc;
      color: var(--color-text-secondary);
      font-weight: 500;
      white-space: nowrap;
    }
    .rl-ov-pm-table .is-right { text-align: right; }
    .rl-ov-pm-table .is-center { text-align: center; }
    .rl-ov-pm-table th.is-sortable {
      cursor: pointer;
      user-select: none;
    }
    .rl-ov-pm-table th.is-sortable:hover { color: var(--color-brand); }
    .rl-ov-pm-table th.is-sortable .sort-ind {
      display: inline-block;
      margin-left: 4px;
      font-size: 10px;
      color: var(--color-text-muted);
      vertical-align: middle;
    }
    .rl-ov-pm-table th.is-sortable.is-asc .sort-ind,
    .rl-ov-pm-table th.is-sortable.is-desc .sort-ind {
      color: var(--color-brand);
      font-weight: 700;
    }
    .rl-ov-pm-table th.is-sortable .sort-ind::before { content: "↕"; }
    .rl-ov-pm-table th.is-sortable.is-asc .sort-ind::before { content: "↑"; }
    .rl-ov-pm-table th.is-sortable.is-desc .sort-ind::before { content: "↓"; }

    @media (max-width: 960px) {
      .rl-ov-kpis { grid-template-columns: 1fr 1fr; }
      .rl-ov-kpi.is-stock-col { grid-column: 1 / -1; }
    }
    @media (max-width: 1180px) {
      .rl-ov-split { grid-template-columns: 1fr; }
      .rl-ov-sec-fixed { height: 380px; }
    }
  </style>
</head>
<body>
  <div class="app-layout">
    <aside class="app-sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-text">板块概览</div>
      </div>
      <nav class="sidebar-nav">
        <ul class="sidebar-nav-plain" id="sectorNav"></ul>
      </nav>
    </aside>
    <div class="preview-main">
      <p class="preview-note">数据来自项目跟踪表_2026-10_20261016_131821.xlsx。表中 10 月完成合同额整列为空，本页按最近有发生额的 <b>9 月</b> 作为当月；10–12 月在走势中仍作预测。「较上一期」按较前一个月（8 月）计算。工时类预警未接入，仅存量四类。本页样式已内联，可直接用浏览器打开分享（图表需联网加载 ECharts）。PM 汇总表头可点击排序。</p>
      <header class="preview-head">
        <h1 id="sectorTitle">—</h1>
        <span class="meta" id="sectorMeta"></span>
      </header>
      <div class="preview-body">
        <div class="rl-ov" id="overviewRoot"></div>
      </div>
    </div>
  </div>
  <script>
    const DATA = ${JSON.stringify(data)};
    const MONTH_IDX = ${MONTH_IDX};
    const POS_FILL = '#d7ebe9';
    const POS_TEXT = '#0c4f4a';
    const NEG_FILL = '#f8d4d4';
    const NEG_TEXT = '#9f2d2d';
    const AMBER = '#d97706';
    const BRAND = '#007069';
    const INVOICE = '#4d8fa8';
    const PAYMENT = '#c08a2e';

    function wan(v) {
      const n = Number(v);
      if (!isFinite(n)) return '—';
      return (n / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function pct(v) {
      if (v == null || !isFinite(Number(v))) return '—';
      return (Number(v) * 100).toFixed(1) + '%';
    }
    function signClass(v) {
      const n = Number(v);
      return n < 0 ? 'is-neg' : '';
    }
    /** invert：存量类指标下降为好（绿），上升为差（红） */
    function deltaClass(v, invert) {
      if (v == null || v === '' || isNaN(Number(v))) return 'is-flat';
      const n = Number(v);
      if (Math.abs(n) < 0.005) return 'is-flat';
      let down = n < 0;
      if (invert) down = !down;
      return down ? 'is-down' : 'is-up';
    }
    function formatDelta(v) {
      if (v == null || v === '' || isNaN(Number(v))) return '—';
      const n = Number(v);
      if (Math.abs(n) < 0.005) return '持平';
      const abs = wan(Math.abs(n));
      if (abs === '—') return '—';
      return (n > 0 ? '+' : '−') + abs + ' 万';
    }
    function shareBar(v) {
      const w = Math.max(0, Math.min(1, Number(v) || 0)) * 100;
      return '<div class="rl-ov-share">'
        + '<span class="rl-ov-share-track"><i style="width:' + w + '%"></i></span>'
        + '<span class="rl-ov-num">' + pct(v) + '</span></div>';
    }
    function tipBase() {
      return {
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: [8, 12],
        extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(15,23,42,0.10);',
        textStyle: { color: '#374151', fontSize: 12 }
      };
    }

    let activeCode = DATA[0].code;
    let charts = [];
    /** 默认与线上一致：按本年累计完成合同额降序 */
    let pmSort = { key: 'ytd.c', dir: 'desc' };

    function disposeCharts() {
      charts.forEach(function (c) { try { c.dispose(); } catch (e) {} });
      charts = [];
    }

    function byCode(code) {
      return DATA.find(function (s) { return s.code === code; }) || DATA[0];
    }

    function pmSortValue(row, key) {
      if (key === 'projectCount') return Number(row.projectCount) || 0;
      if (key === 'current.i') return Number(row.current && row.current.i) || 0;
      if (key === 'current.p') return Number(row.current && row.current.p) || 0;
      if (key === 'current.c') return Number(row.current && row.current.c) || 0;
      if (key === 'ytd.c') return Number(row.ytd && row.ytd.c) || 0;
      if (key === 'sharePctCurrent') return Number(row.sharePctCurrent) || 0;
      if (key === 'sharePctYtd') return Number(row.sharePctYtd) || 0;
      return 0;
    }

    function sortedPmRows(rows) {
      const list = (rows || []).slice();
      const key = pmSort.key;
      const dir = pmSort.dir === 'asc' ? 1 : -1;
      list.sort(function (a, b) {
        const av = pmSortValue(a, key);
        const bv = pmSortValue(b, key);
        if (av === bv) {
          return String(a.pmName || '').localeCompare(String(b.pmName || ''), 'zh-CN');
        }
        return av < bv ? -dir : dir;
      });
      return list;
    }

    function sortClass(key) {
      if (pmSort.key !== key) return '';
      return pmSort.dir === 'asc' ? ' is-asc' : ' is-desc';
    }

    function bindPmSort(wrap) {
      if (!wrap) return;
      wrap.querySelectorAll('th.is-sortable').forEach(function (th) {
        th.addEventListener('click', function () {
          const key = th.getAttribute('data-sort');
          if (!key) return;
          if (pmSort.key === key) {
            pmSort.dir = pmSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            pmSort.key = key;
            pmSort.dir = 'desc';
          }
          const sector = byCode(activeCode);
          wrap.outerHTML = renderPmTable(sector.pmSummary);
          bindPmSort(document.querySelector('.rl-ov-pm-wrap'));
        });
      });
    }

    function renderNav() {
      const nav = document.getElementById('sectorNav');
      nav.innerHTML = DATA.map(function (s) {
        return '<li><button type="button" data-code="' + s.code + '"'
          + (s.code === activeCode ? ' class="is-active"' : '')
          + '><span>' + s.name + '</span><b>' + s.projectCount + '</b></button></li>';
      }).join('');
      nav.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeCode = btn.getAttribute('data-code');
          renderNav();
          renderSector();
        });
      });
    }

    function renderSector() {
      const sector = byCode(activeCode);
      document.getElementById('sectorTitle').textContent = sector.name;
      document.getElementById('sectorMeta').textContent =
        sector.code + ' · ' + sector.projectCount + ' 个项目 · 当月 ' + sector.monthLabel;
      disposeCharts();

      const root = document.getElementById('overviewRoot');
      const emptyTree = !sector.tiles.length;
      const emptyAlert = !sector.alerts.length;

      const stockHtml = '<article class="rl-ov-kpi is-stock-col">'
        + (sector.stockKpis || []).map(function (m) {
          return '<div class="rl-ov-stock-block">'
            + '<header class="rl-ov-kpi-head"><h3>' + m.label + '</h3></header>'
            + '<div class="rl-ov-kpi-main"><p class="rl-ov-kpi-value ' + signClass(m.value) + '">'
            + '<span class="num">' + wan(m.value) + '</span><span class="unit">万</span></p>'
            + '<p class="rl-ov-delta ' + deltaClass(m.delta, m.invertDelta) + '">较上一期 ' + formatDelta(m.delta) + '</p>'
            + '</div></div>';
        }).join('')
        + '</article>';

      root.innerHTML =
        '<section class="rl-ov-surface"><div class="rl-ov-kpis">' +
        sector.kpis.map(function (kpi) {
          return '<article class="rl-ov-kpi' + (kpi.sourceType === 'manual' ? ' is-primary' : '') + '">'
            + '<header class="rl-ov-kpi-head"><h3>' + kpi.label + '</h3>'
            + (kpi.sourceType === 'manual'
              ? '<span class="rl-ov-src is-manual"><i class="rl-ov-dot"></i>本期填报申报值</span>'
              : '<span class="rl-ov-src is-sync" title="审批阶段，当月尚未结束，仅代表截至同步时刻的累计发生额，不代表全月最终结果，不作为本次审批口径。"><i class="rl-ov-dot"></i>本月金额 · 实时同步</span>')
            + '</header>'
            + '<div class="rl-ov-kpi-main"><p class="rl-ov-kpi-value ' + signClass(kpi.values.current) + '">'
            + '<span class="num">' + wan(kpi.values.current) + '</span><span class="unit">万</span></p>'
            + (kpi.key === 'completion'
              ? '<p class="rl-ov-delta ' + deltaClass(kpi.values.deltaCurrent) + '">较上一期 ' + formatDelta(kpi.values.deltaCurrent) + '</p>'
              : '')
            + '</div>'
            + '<dl class="rl-ov-kpi-meta">'
            + '<div><dt>本年累计</dt><dd class="' + signClass(kpi.values.ytd) + '">' + wan(kpi.values.ytd) + '<i>万</i></dd></div>'
            + '<div><dt>未来预测</dt><dd class="' + signClass(kpi.values.future) + '">' + wan(kpi.values.future) + '<i>万</i></dd></div>'
            + '</dl></article>';
        }).join('') +
        stockHtml +
        '</div></section>' +
        '<div class="rl-ov-split">' +
          '<section class="rl-ov-sec rl-ov-sec-fixed">' +
            '<header class="rl-ov-sec-head"><h2>本月完成合同额情况</h2>'
            + '<div class="rl-ov-sec-meta"><span class="rl-ov-sec-note">单位：万元</span>'
            + '<button type="button" class="rl-ov-more">更多</button></div></header>'
            + (emptyTree ? '' : '<div class="rl-ov-legend"><span><i class="is-pos"></i>正值</span><span><i class="is-neg"></i>负值</span></div>')
            + '<div class="rl-ov-sec-body">'
            + (emptyTree
              ? '<div class="rl-ov-chart-empty">本月完成合同额均为 0</div>'
              : '<div id="treeChart" class="rl-ov-mini-chart"></div>')
            + '</div></section>' +
          '<section class="rl-ov-sec rl-ov-sec-fixed">' +
            '<header class="rl-ov-sec-head"><h2>项目预警一览</h2>'
            + '<div class="rl-ov-sec-meta"><button type="button" class="rl-ov-more">更多</button></div></header>'
            + '<div class="rl-ov-sec-body">'
            + (emptyAlert
              ? '<div class="rl-ov-chart-empty">未发现异常</div>'
              : '<div id="alertChart" class="rl-ov-mini-chart"></div>')
            + '</div></section>' +
        '</div>' +
        '<section class="rl-ov-sec">' +
          '<header class="rl-ov-sec-head"><h2>月度走势</h2>'
          + '<span class="rl-ov-sec-note">柱=各月，线=累计；右侧为预测月。单位：万元</span></header>'
          + '<div id="trendChart" class="rl-ov-chart"></div></section>' +
        '<section class="rl-ov-sec">' +
          '<header class="rl-ov-sec-head"><h2>按项目经理汇总</h2>'
          + '<span class="rl-ov-sec-note">点击表头排序 · 单位：万元</span></header>'
          + renderPmTable(sector.pmSummary) +
        '</section>';

      bindPmSort(root.querySelector('.rl-ov-pm-wrap'));

      requestAnimationFrame(function () {
        if (!emptyTree) charts.push(renderTree(sector));
        if (!emptyAlert) charts.push(renderAlerts(sector));
        charts.push(renderTrend(sector));
      });
    }

    function renderPmTable(rows) {
      if (!rows || !rows.length) {
        return '<div class="rl-ov-chart-empty">暂无项目</div>';
      }
      function th(label, key, align, rowspan) {
        return '<th class="' + align + ' is-sortable' + sortClass(key) + '" data-sort="' + key + '"'
          + (rowspan ? ' rowspan="' + rowspan + '"' : '') + '>'
          + label + '<span class="sort-ind" aria-hidden="true"></span></th>';
      }
      const sorted = sortedPmRows(rows);
      return '<div class="rl-ov-pm-wrap"><table class="rl-ov-pm-table">'
        + '<thead><tr>'
        + '<th rowspan="2">项目经理</th>'
        + th('项目数', 'projectCount', 'is-right', 2)
        + th('当月开票额', 'current.i', 'is-right', 2)
        + th('当月回款额', 'current.p', 'is-right', 2)
        + th('当月完成合同额', 'current.c', 'is-right', 2)
        + th('本年累计完成合同额', 'ytd.c', 'is-right', 2)
        + '<th class="is-center" colspan="2">完成合同额占比</th>'
        + '</tr><tr>'
        + th('当月', 'sharePctCurrent', 'is-center', 0)
        + th('本年累计', 'sharePctYtd', 'is-center', 0)
        + '</tr></thead><tbody>'
        + sorted.map(function (row) {
          return '<tr>'
            + '<td>' + (row.pmName || '—') + '</td>'
            + '<td class="is-right">' + row.projectCount + '</td>'
            + '<td class="is-right"><span class="rl-ov-num ' + signClass(row.current.i) + '">' + wan(row.current.i) + '</span></td>'
            + '<td class="is-right"><span class="rl-ov-num ' + signClass(row.current.p) + '">' + wan(row.current.p) + '</span></td>'
            + '<td class="is-right"><span class="rl-ov-num ' + signClass(row.current.c) + '">' + wan(row.current.c) + '</span></td>'
            + '<td class="is-right"><span class="rl-ov-num ' + signClass(row.ytd.c) + '">' + wan(row.ytd.c) + '</span></td>'
            + '<td class="is-center">' + shareBar(row.sharePctCurrent) + '</td>'
            + '<td class="is-center">' + shareBar(row.sharePctYtd) + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody></table></div>';
    }

    function renderTree(sector) {
      const el = document.getElementById('treeChart');
      const chart = echarts.init(el);
      chart.setOption({
        textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
        tooltip: Object.assign(tipBase(), {
          trigger: 'item',
          formatter: function (item) {
            const row = item.data || {};
            const amt = wan(row.monthCompletion);
            if (row.kind === 'project') {
              return '<div style="font-weight:600;margin-bottom:4px;">' + (row.projectName || '—') + '</div>'
                + '<div>项目号：' + (row.projectNo || row.name) + '</div>'
                + '<div>项目经理：' + (row.pmName || '—') + '</div>'
                + '<div>本月完成合同额：' + amt + ' 万</div>';
            }
            return '<div style="font-weight:600;margin-bottom:4px;">' + (row.name || '') + '</div>'
              + '<div>项目数：' + (row.count || 0) + '</div>'
              + '<div>合计：' + amt + ' 万</div>';
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
            formatter: function (info) { return (info.data && info.data.name) || ''; }
          },
          upperLabel: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
          data: sector.tiles.map(function (tile) {
            const negative = Number(tile.monthCompletion) < 0;
            return Object.assign({}, tile, {
              itemStyle: { color: negative ? NEG_FILL : POS_FILL },
              label: { color: negative ? NEG_TEXT : POS_TEXT }
            });
          })
        }]
      });
      return chart;
    }

    function renderAlerts(sector) {
      const el = document.getElementById('alertChart');
      const ranked = sector.alerts.slice().reverse();
      const chart = echarts.init(el);
      chart.setOption({
        textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
        tooltip: Object.assign(tipBase(), {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: function (items) {
            const item = (items && items[0]) || {};
            const full = item.data && item.data.label;
            if (!full) return '';
            return full + '：' + item.value + ' 条';
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
          data: ranked.map(function (r) { return r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label; }),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#6b7280', fontSize: 11 }
        },
        series: [{
          type: 'bar',
          data: ranked.map(function (r) {
            return { value: r.count, label: r.label, itemStyle: { color: AMBER, borderRadius: [0, 4, 4, 0] } };
          }),
          barMaxWidth: 18,
          label: { show: true, position: 'right', color: '#92400e', fontSize: 11, formatter: '{c}' }
        }]
      });
      return chart;
    }

    function renderTrend(sector) {
      const el = document.getElementById('trendChart');
      const chart = echarts.init(el);
      const idx = sector.trend.reportingMonthIdx == null ? MONTH_IDX : sector.trend.reportingMonthIdx;
      const months = sector.trend.months || [];
      function toWanMonth(arr) {
        return (arr || []).map(function (v) { return v == null ? 0 : v / 10000; });
      }
      function toWanYtd(arr) {
        const src = arr || [];
        let sum = 0;
        return src.map(function (v) {
          sum += Number(v) || 0;
          return sum / 10000;
        });
      }
      function fmtWan(v) {
        if (v == null || !isFinite(Number(v))) return '—';
        return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万';
      }
      const mC = toWanMonth(sector.trend.completion);
      const mI = toWanMonth(sector.trend.invoice);
      const mP = toWanMonth(sector.trend.payment);
      const yC = toWanYtd(sector.trend.completion);
      const yI = toWanYtd(sector.trend.invoice);
      const yP = toWanYtd(sector.trend.payment);
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
      const legend = [
        '完成合同额·当月', '完成开票额·当月', '完成回款额·当月',
        '完成合同额·累计', '完成开票额·累计', '完成回款额·累计'
      ];
      chart.setOption({
        color: [BRAND, INVOICE, PAYMENT, BRAND, INVOICE, PAYMENT],
        textStyle: { fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", Arial, sans-serif' },
        tooltip: Object.assign(tipBase(), {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          formatter: function (items) {
            if (!items || !items.length) return '';
            const title = items[0].axisValueLabel || items[0].name || '';
            const lines = ['<div style="font-weight:600;margin-bottom:4px;">' + title + '</div>'];
            items.forEach(function (it) {
              lines.push(
                '<div style="display:flex;justify-content:space-between;gap:18px;">'
                + '<span>' + it.marker + it.seriesName + '</span>'
                + '<span style="font-variant-numeric:tabular-nums;">' + fmtWan(it.value) + '</span></div>'
              );
            });
            return lines.join('');
          }
        }),
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
          axisLabel: { color: '#9ca3af', fontSize: 11 }
        },
        yAxis: [
          {
            type: 'value',
            name: '当月·万',
            nameTextStyle: { color: '#9ca3af', fontSize: 11 },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#9ca3af', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(15,23,42,0.06)' } }
          },
          {
            type: 'value',
            name: '累计·万',
            nameTextStyle: { color: '#9ca3af', fontSize: 11 },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#9ca3af', fontSize: 11 },
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
      });
      return chart;
    }

    window.addEventListener('resize', function () {
      charts.forEach(function (c) { c.resize(); });
    });

    renderNav();
    renderSector();
  </script>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('projects', projects.length);
console.log(data.map(function (s) {
  return s.name + ':' + s.projectCount + '/tiles' + s.tiles.length + '/alerts' + s.alerts.length;
}).join(' | '));
console.log('wrote', outPath);
