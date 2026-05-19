/**
 * formatters.js — 全局格式化工具
 * 金额：千分位 + 等宽数字 + 两位小数
 */
(function (window) {
  'use strict';

  /**
   * 格式化金额：千分位分隔，保留两位小数，等宽数字
   * @param {number|string|null} val
   * @returns {string}  例：1,234,567.89  |  0.00
   */
  function formatAmount(val) {
    if (val === null || val === undefined || val === '') return '—';
    const n = Number(val);
    if (isNaN(n)) return String(val);
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * 格式化金额（万元单位，两位小数）
   */
  function formatAmountWan(val) {
    if (val === null || val === undefined || val === '') return '—';
    const n = Number(val) / 10000;
    if (isNaN(n)) return String(val);
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + '万';
  }

  /**
   * 格式化百分比（0.09 → 9.00%）
   */
  function formatPercent(val, digits) {
    if (val === null || val === undefined || val === '') return '—';
    const n = Number(val) * 100;
    if (isNaN(n)) return String(val);
    const d = digits !== undefined ? digits : 2;
    return n.toFixed(d) + '%';
  }

  /** Excel 序列日 → UTC 毫秒（1900 日期系统，与 SheetJS/Luckysheet 一致） */
  const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

  function excelSerialToIso(serial) {
    const n = Number(serial);
    if (isNaN(n) || n < 1) return '';
    const ms = EXCEL_EPOCH_UTC_MS + Math.round(n) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  function looksLikeExcelSerial(val) {
    const n = typeof val === 'number' ? val : Number(String(val).trim());
    return !isNaN(n) && n >= 20000 && n < 120000;
  }

  /**
   * 入库/展示前统一为 YYYY-MM-DD（兼容 Excel 序列号、Date、文本）
   */
  function normalizeDateValue(val) {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (typeof val === 'number' && looksLikeExcelSerial(val)) {
      return excelSerialToIso(val);
    }
    const s = String(val).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (looksLikeExcelSerial(s)) return excelSerialToIso(parseFloat(s));
    return s.slice(0, 10);
  }

  /** ISO 日期 → Luckysheet 使用的 Excel 序列日 */
  function dateToExcelSerial(isoStr) {
    const iso = normalizeDateValue(isoStr);
    if (!iso) return null;
    const ms = Date.parse(iso + 'T00:00:00Z');
    if (isNaN(ms)) return null;
    return Math.round((ms - EXCEL_EPOCH_UTC_MS) / 86400000);
  }

  /**
   * 格式化日期 (Date | string) → YYYY-MM-DD
   */
  function formatDate(val) {
    if (!val && val !== 0) return '—';
    const iso = normalizeDateValue(val);
    return iso || '—';
  }

  /**
   * 格式化枚举布尔值
   */
  function formatBool(val) {
    if (val === true || val === '是' || val === 1) return '是';
    if (val === false || val === '否' || val === 0) return '否';
    return val || '—';
  }

  /**
   * 格式化税率（0.09 → 9%）
   */
  function formatTaxRate(val) {
    if (val === null || val === undefined || val === '') return '—';
    const n = Number(val) * 100;
    if (isNaN(n)) return String(val);
    return Math.round(n) + '%';
  }

  /**
   * 根据字段数据类型格式化值
   */
  function formatByType(val, dataType) {
    switch (dataType) {
      case '金额': return formatAmount(val);
      case '比率': return formatTaxRate(val);
      case '日期': return formatDate(val);
      case '布尔': return formatBool(val);
      default: return (val === null || val === undefined || val === '') ? '—' : String(val);
    }
  }

  /**
   * 解析金额字符串（含千分位）回数字
   */
  function parseAmount(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    return Number(String(str).replace(/,/g, '')) || 0;
  }

  /**
   * 将数字缩写为万/亿单位（用于 KPI 卡展示）
   */
  function formatAmountShort(val) {
    const n = Number(val);
    if (isNaN(n)) return '—';
    if (Math.abs(n) >= 1e8) {
      return (n / 1e8).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 亿';
    }
    if (Math.abs(n) >= 1e4) {
      return (n / 1e4).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万';
    }
    return formatAmount(val);
  }

  window.Formatters = {
    formatAmount,
    formatAmountWan,
    formatAmountShort,
    formatPercent,
    formatDate,
    normalizeDateValue,
    dateToExcelSerial,
    excelSerialToIso,
    formatBool,
    formatTaxRate,
    formatByType,
    parseAmount
  };
})(window);
