/**
 * change-meta.js — 单元格变更元数据（批注 / 审计联动）
 * _field_change_log[col] 为变更记录数组，同一流程内多角色多次修改均保留
 */
(function (window) {
  'use strict';

  var CHANGED_FIELD_STYLE = {
    bg: '#fff7ed',
    text: '#b45309',
    border: '#f59e0b'
  };

  var EDITABLE_FIELD_STYLE = {
    bg: '#fefce8'
  };

  var ROLE_LABELS = {
    pm: 'PM',
    sector_admin: '板块管理员',
    sector_director: '板块总监',
    group_leader: '群主',
    finance: '财务',
    system_admin: '系统管理员'
  };

  function roleLabel(user) {
    if (!user) return '—';
    if (user.roleLabel) return user.roleLabel;
    return ROLE_LABELS[user.role] || user.name || user.role || '—';
  }

  function roleLabelFromUserId(userId) {
    return ROLE_LABELS[userId] || userId || '—';
  }

  function normalizeLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
      oldVal: entry.oldVal,
      newVal: entry.newVal,
      roleLabel: entry.roleLabel || roleLabelFromUserId(entry.userId) || entry.userName || '—',
      userName: entry.userName,
      userId: entry.userId,
      at: entry.at
    };
  }

  function changeLogEntryKey(entry) {
    if (!entry) return '';
    return [
      entry.roleLabel || entry.userId || '',
      entry.oldVal != null ? String(entry.oldVal) : '',
      entry.newVal != null ? String(entry.newVal) : ''
    ].join('\x1e');
  }

  function isSameChangeEntry(a, b) {
    if (!a || !b) return false;
    return changeLogEntryKey(a) === changeLogEntryKey(b);
  }

  function dedupeChangeLogList(list) {
    if (!list || !list.length) return [];
    const out = [];
    const seen = {};
    list.forEach(function (raw) {
      const n = normalizeLogEntry(raw);
      if (!n) return;
      const key = changeLogEntryKey(n);
      if (seen[key]) return;
      seen[key] = true;
      out.push(n);
    });
    return out;
  }

  function getFieldChangeEntries(project, field, auditLog) {
    if (!project || !field) return [];
    const out = [];
    const log = project._field_change_log || {};
    const raw = log[field.col];
    if (Array.isArray(raw)) {
      raw.forEach(function (e) {
        const n = normalizeLogEntry(e);
        if (n) out.push(n);
      });
    } else if (raw && typeof raw === 'object' && (raw.oldVal !== undefined || raw.newVal !== undefined)) {
      const n = normalizeLogEntry(raw);
      if (n) out.push(n);
    }
    return dedupeChangeLogList(out);
  }

  function recordFieldChangeLog(project, field, oldVal, newVal, user) {
    if (!project || !field) return;
    if (!project._field_change_log) project._field_change_log = {};
    const col = field.col;
    let list = project._field_change_log[col];
    if (!list) {
      list = [];
    } else if (!Array.isArray(list)) {
      list = [normalizeLogEntry(list)].filter(Boolean);
    } else {
      list = dedupeChangeLogList(list);
    }
    const entry = {
      oldVal: Formatters.formatByType(oldVal, field.data_type),
      newVal: Formatters.formatByType(newVal, field.data_type),
      roleLabel: roleLabel(user),
      userName: (user && user.name) || '—',
      userId: (user && user.role) || '—',
      at: new Date().toISOString()
    };
    if (list.length && isSameChangeEntry(list[list.length - 1], entry)) return;
    list.push(entry);
    project._field_change_log[col] = list;
  }

  function resolveFieldChangeMeta(project, field, auditLog) {
    const entries = getFieldChangeEntries(project, field, auditLog);
    if (entries.length) return entries[entries.length - 1];
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
          roleLabel: roleLabelFromUserId(e.userId),
          at: e.timestamp
        };
      }
    }
    return null;
  }

  function formatChangeComment(project, field, auditLog) {
    const entries = getFieldChangeEntries(project, field, auditLog);
    if (!entries.length) return '';
    return entries.map(function (e) {
      const label = e.roleLabel || '—';
      const ov = e.oldVal != null && e.oldVal !== '' ? e.oldVal : '—';
      const nv = e.newVal != null && e.newVal !== '' ? e.newVal : '—';
      return '【' + label + '】' + ov + ' → ' + nv;
    }).join('\n');
  }

  function buildLuckysheetCommentPs(text) {
    const lines = Math.max(1, (text || '').split('\n').length);
    return {
      left: 92,
      top: 10,
      width: 240,
      height: Math.max(44, lines * 20 + 12),
      value: text,
      isshow: false
    };
  }

  function mergeColChangeLogs() {
    const merged = {};
    const colSet = {};
    for (let i = 0; i < arguments.length; i++) {
      const src = arguments[i];
      if (!src) continue;
      const log = src._field_change_log || {};
      Object.keys(log).forEach(function (col) {
        if (!merged[col]) merged[col] = { list: [], seen: {} };
        const bucket = merged[col];
        const v = log[col];
        function appendUnique(raw) {
          const n = normalizeLogEntry(raw);
          if (!n) return;
          const key = changeLogEntryKey(n);
          if (bucket.seen[key]) return;
          bucket.seen[key] = true;
          bucket.list.push(n);
        }
        if (Array.isArray(v)) {
          v.forEach(appendUnique);
        } else if (v && typeof v === 'object') {
          appendUnique(v);
        }
        colSet[col] = true;
      });
      (src._changed_fields || []).forEach(function (col) {
        colSet[col] = true;
      });
    }
    const logOut = {};
    Object.keys(merged).forEach(function (col) {
      logOut[col] = merged[col].list;
    });
    return {
      _field_change_log: logOut,
      _changed_fields: Object.keys(colSet)
    };
  }

  function mergeChangeTracking() {
    return mergeColChangeLogs.apply(null, arguments);
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
    if (getFieldChangeEntries(project, field).length > 0) return true;
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
    EDITABLE_FIELD_STYLE: EDITABLE_FIELD_STYLE,
    ROLE_LABELS: ROLE_LABELS,
    roleLabel: roleLabel,
    changeLogEntryKey: changeLogEntryKey,
    isSameChangeEntry: isSameChangeEntry,
    dedupeChangeLogList: dedupeChangeLogList,
    getFieldChangeEntries: getFieldChangeEntries,
    recordFieldChangeLog: recordFieldChangeLog,
    resolveFieldChangeMeta: resolveFieldChangeMeta,
    formatChangeComment: formatChangeComment,
    buildLuckysheetCommentPs: buildLuckysheetCommentPs,
    mergeChangeTracking: mergeChangeTracking,
    attachChangeTracking: attachChangeTracking,
    hasFieldChangeMarkup: hasFieldChangeMarkup,
    applyLuckysheetChangedStyle: applyLuckysheetChangedStyle
  };
})(window);
