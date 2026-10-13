/**
 * Export projects that have numeric SystemOverride delta values.
 * Headers copied from docs/参考数据/初始数据.xlsx.
 * Cells: product-doc 调整值 (= display - system = -production_delta)
 * Identity columns filled for readability; other non-delta cells left blank.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'docs/参考数据/PTT_Project_20260729_1643.csv');
const HEADER_XLSX = path.join(ROOT, 'docs/参考数据/初始数据.xlsx');
const OUT_XLSX = path.join(ROOT, 'docs/参考数据/有Delta调整值_导出_20260729.xlsx');

/** Column index 0..82 → FieldData key (matches FieldConfig.COL_TO_KEY order A..CE; CF remark absent in init xlsx) */
const KEYS_83 = [
  'new_existing', 'start_date', 'end_date', 'unit_code', 'pm_name', 'project_no',
  'project_name', 'client_name', 'enterprise_type', 'industry', 'business_type',
  'signed', 'progress',
  'prev_year_contract', 'adj_value', 'total_contract', 'contract_excl_tax',
  'contract_minus_invoice', 'contract_minus_completed',
  'prev_year_completion', 'cum_completed', 'opening_backlog',
  'current_completed', 'ytd_completed', 'tax_rate', 'ytd_completed_excl_tax',
  'prev_year_invoice', 'ytd_invoice', 'cum_invoice',
  'prev_year_payment', 'ytd_payment', 'cum_payment',
  'wip_incl_tax', 'wip_excl_tax', 'ar_incl_advance', 'ar_for_collection',
  'opening_ar', 'wip_pending_invoice', 'wip_cause', 'cause_desc', 'high_risk_wip',
  'opening_wip', 'wip_3mo_plus', 'wip_3mo_adjusted',
  'factor_analysis', 'action_plan', 'forecast_invoice_date',
  'mc_0', 'mc_1', 'mc_2', 'mc_3', 'mc_4', 'mc_5',
  'mc_6', 'mc_7', 'mc_8', 'mc_9', 'mc_10', 'mc_11',
  'mi_0', 'mp_0', 'mi_1', 'mp_1', 'mi_2', 'mp_2',
  'mi_3', 'mp_3', 'mi_4', 'mp_4', 'mi_5', 'mp_5',
  'mi_6', 'mp_6', 'mi_7', 'mp_7', 'mi_8', 'mp_8',
  'mi_9', 'mp_9', 'mi_10', 'mp_10', 'mi_11', 'mp_11',
];

/** Always fill these so the row is identifiable (not 调整值) */
const IDENTITY_KEYS = new Set([
  'project_no', 'project_name', 'pm_name', 'unit_code', 'client_name',
  'new_existing',
]);

function parseCsv(t) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const n = t[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || (c === '\r' && n === '\n')) {
      if (c === '\r') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c === '\r') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function roundAmt(n) {
  if (!Number.isFinite(n)) return '';
  // keep up to 2 decimals like money, strip trailing zeros noise
  const r = Math.round(n * 100) / 100;
  return r;
}

function main() {
  const wbHeader = XLSX.readFile(HEADER_XLSX);
  const wsHeader = wbHeader.Sheets[wbHeader.SheetNames[0]];
  const headerRows = XLSX.utils.sheet_to_json(wsHeader, { header: 1, defval: '' });
  const header = headerRows[0];
  if (!header || header.length !== 83) {
    throw new Error('Expected 83-column header from 初始数据.xlsx, got ' + (header && header.length));
  }
  if (KEYS_83.length !== 83) {
    throw new Error('KEYS_83 length mismatch: ' + KEYS_83.length);
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const h = rows[0].map((x) => x.replace(/^\ufeff/, ''));
  const idx = {};
  h.forEach((name, i) => {
    idx[name] = i;
  });

  const outRows = [header];
  const deltaKeyCounts = {};
  let projectCount = 0;
  let deltaCellCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < h.length) continue;
    const soRaw = row[idx.SystemOverrideJson];
    if (!soRaw || soRaw === 'NULL') continue;

    let override;
    try {
      override = JSON.parse(soRaw);
    } catch (_) {
      continue;
    }

    const deltaEntries = Object.entries(override).filter(
      ([, meta]) => meta && meta.delta != null && meta.delta !== ''
    );
    if (!deltaEntries.length) continue;

    let fieldData = {};
    try {
      fieldData = JSON.parse(row[idx.FieldDataJson] || '{}');
    } catch (_) {}

    // 产品口径调整值 = -production_delta（因正式库 显示 = 系统 − delta）
    const adjByKey = {};
    for (const [key, meta] of deltaEntries) {
      const adj = -Number(meta.delta);
      adjByKey[key] = roundAmt(adj);
      deltaKeyCounts[key] = (deltaKeyCounts[key] || 0) + 1;
      deltaCellCount++;
    }

    const out = new Array(83).fill('');
    for (let c = 0; c < 83; c++) {
      const key = KEYS_83[c];
      if (Object.prototype.hasOwnProperty.call(adjByKey, key)) {
        out[c] = adjByKey[key];
      } else if (IDENTITY_KEYS.has(key) && fieldData[key] != null && fieldData[key] !== '') {
        out[c] = fieldData[key];
      }
    }
    outRows.push(out);
    projectCount++;
  }

  const ws = XLSX.utils.aoa_to_sheet(outRows);
  // preserve multi-line header row height hint via !rows optional — skip
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '有Delta调整值');
  XLSX.writeFile(wb, OUT_XLSX);

  const summary = {
    outPath: OUT_XLSX,
    projectCount,
    deltaCellCount,
    deltaKeyCounts,
    note: '调整值 = -SystemOverride.delta（正式库显示值=系统值-delta；产品口径显示值=系统值+调整值）',
    identityFilled: [...IDENTITY_KEYS],
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
