/**
 * change-meta.js — 单元格变更元数据（批注 / 审计联动）
 */
(function (window) {
  'use strict';

  /** 与 style.css :root 中 --color-changed-field-* 保持一致 */
  var CHANGED_FIELD_STYLE = {
    bg: '#fff7ed',
    text: '#b45309',
    border: '#f59e0b'
  };

  function formatChangeTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('zh-CN') + ' ' +
      d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function recordFieldChangeLog(project, field, oldVal, newVal, user) {
    if (!project || !field) return;
    if (!project._field_change_log) project._field_change_log = {};
    project._field_change_log[field.col] = {
      fieldCN: field.name_cn,
      oldVal: Formatters.formatByType(oldVal, field.data_type),
      newVal: Formatters.formatByType(newVal, field.data_type),
      userName: (user && user.name) || '—',
      userId: (user && user.role) || '—',
      at: new Date().toISOString()
    };
  }

  function resolveFieldChangeMeta(project, field, auditLog) {
    if (!project || !field) return null;
    const log = project._field_change_log || {};
    if (log[field.col]) return log[field.col];
    const list = auditLog || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.projectNo === project.project_no && e.fieldName === field.col) {
        return {
          fieldCN: e.fieldCN || field.name_cn,
          oldVal: e.oldVal,
          newVal: e.newVal,
          userName: e.userName,
          userId: e.userId,
          at: e.timestamp
        };
      }
    }
    return null;
  }

  function formatChangeComment(meta, field) {
    if (!meta) return '';
    const name = meta.fieldCN || (field && field.name_cn) || '字段';
    return [
      '【' + name + '】',
      '修改前值：' + (meta.oldVal != null && meta.oldVal !== '' ? meta.oldVal : '—'),
      '修改后值：' + (meta.newVal != null && meta.newVal !== '' ? meta.newVal : '—'),
      '修改人：' + (meta.userName || '—'),
      '修改时间：' + formatChangeTime(meta.at)
    ].join('\n');
  }

  function buildLuckysheetCommentPs(text) {
    const lines = (text || '').split('\n').length;
    return {
      left: 92,
      top: 10,
      width: 220,
      height: Math.max(88, lines * 18 + 12),
      value: text,
      isshow: false
    };
  }

  /** 合并变更列标记与批注日志（多来源取并集，避免二次保存丢历史） */
  function mergeChangeTracking() {
    const logs = [];
    const colSet = {};
    for (let i = 0; i < arguments.length; i++) {
      const src = arguments[i];
      if (!src) continue;
      logs.push(src._field_change_log || {});
      (src._changed_fields || []).forEach(function (col) {
        colSet[col] = true;
      });
    }
    const mergedLog = Object.assign.apply(null, [{}].concat(logs));
    Object.keys(mergedLog).forEach(function (col) {
      colSet[col] = true;
    });
    return {
      _field_change_log: mergedLog,
      _changed_fields: Object.keys(colSet)
    };
  }

  function attachChangeTracking(computed, metaSource) {
    if (!computed) return computed;
    const merged = mergeChangeTracking(computed, metaSource);
    const out = Object.assign({}, computed);
    out._field_change_log = merged._field_change_log;
    out._changed_fields = merged._changed_fields;
    return out;
  }

  function hasFieldChangeMarkup(project, field) {
    if (!project || !field) return false;
    const log = project._field_change_log || {};
    if (log[field.col]) return true;
    const cols = project._changed_fields;
    if (!cols || !cols.length) return false;
    if (cols.indexOf(field.col) >= 0) return true;
    if (cols.indexOf(field.col.toLowerCase()) >= 0) return true;
    if (cols.indexOf('mc_' + (field.colIdx - 47)) >= 0) return true;
    return false;
  }

  function applyLuckysheetChangedStyle(cell, project, field) {
    if (!cell || !hasFieldChangeMarkup(project, field)) return cell;
    cell.fc = CHANGED_FIELD_STYLE.text;
    cell.bg = CHANGED_FIELD_STYLE.bg;
    cell.bd = {
      borderType: 'border-left',
      style: '1',
      color: CHANGED_FIELD_STYLE.border
    };
    return cell;
  }

  window.ChangeMeta = {
    CHANGED_FIELD_STYLE: CHANGED_FIELD_STYLE,
    recordFieldChangeLog,
    resolveFieldChangeMeta,
    formatChangeComment,
    formatChangeTime,
    buildLuckysheetCommentPs,
    mergeChangeTracking,
    attachChangeTracking,
    hasFieldChangeMarkup,
    applyLuckysheetChangedStyle
  };
})(window);
