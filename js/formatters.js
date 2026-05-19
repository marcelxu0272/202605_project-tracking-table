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

  /**
   * 格式化日期 (Date | string) → YYYY-MM-DD
   */
  function formatDate(val) {
    if (!val) return '—';
    if (val instanceof Date) {
      return val.toISOString().slice(0, 10);
    }
    const s = String(val).trim();
    if (!s) return '—';
    // 处理 Excel 日期序列号
    if (/^\d{5}$/.test(s)) {
      const d = new Date((parseInt(s) - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    return s.slice(0, 10);
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
    formatBool,
    formatTaxRate,
    formatByType,
    parseAmount
  };
})(window);
