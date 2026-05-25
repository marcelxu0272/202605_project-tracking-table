/**
 * system-ref-meta.js — 工程平台引用列：显示值 / _system_ref / _system_override
 */
(function (window) {
  'use strict';

  const OVERRIDE_BG = '#e8f4fd';

  function ensureMeta(project) {
    if (!project._system_ref) project._system_ref = {};
    if (!project._system_override) project._system_override = {};
    return project;
  }

  function getRefKey(field, monthIdx) {
    if (!field || !window.FieldConfig) return null;
    if (field.source_type === 'system_sync') {
      return FieldConfig.COL_TO_KEY[field.col] || null;
    }
    if (monthIdx == null || monthIdx < 0 || monthIdx > 11) return null;
    const miCol = FieldConfig.MI_COLS[monthIdx];
    const mpCol = FieldConfig.MP_COLS[monthIdx];
    if (field.col === miCol) return 'mi_' + monthIdx;
    if (field.col === mpCol) return 'mp_' + monthIdx;
    return null;
  }

  function isSystemRefField(field, monthIdx) {
    return getRefKey(field, monthIdx) != null;
  }

  function getRefFields(fields, monthIdx) {
    return (fields || []).filter(function (f) { return isSystemRefField(f, monthIdx); });
  }

  function getRefKeys(fields, monthIdx) {
    return getRefFields(fields, monthIdx)
      .map(function (f) { return getRefKey(f, monthIdx); })
      .filter(Boolean);
  }

  function isOverridden(project, refKey) {
    return !!(project && project._system_override && project._system_override[refKey]);
  }

  function isOverriddenField(project, field, monthIdx) {
    const key = getRefKey(field, monthIdx);
    return key ? isOverridden(project, key) : false;
  }

  function isEmptyDisplayValue(field, val) {
    return val === null || val === undefined || val === '';
  }

  function getRefEntry(project, refKey) {
    if (!project || !project._system_ref) return null;
    return project._system_ref[refKey] || null;
  }

  function getRefValue(project, refKey) {
    const entry = getRefEntry(project, refKey);
    return entry ? entry.value : null;
  }

  function formatRefComment(project, field, monthIdx) {
    const refKey = getRefKey(field, monthIdx);
    if (!refKey) return '';
    const entry = getRefEntry(project, refKey);
    if (!entry) return '工程平台引用：尚未同步';
    if (entry.status === 'missing_project') return '工程平台引用：无此项目号';
    if (entry.status === 'unavailable') return '工程平台引用：暂不可用';
    if (entry.status === 'missing_field' || entry.value == null || entry.value === '') {
      return '工程平台引用：该字段无引用值';
    }
    const formatted = window.Formatters
      ? Formatters.formatByType(entry.value, field.data_type)
      : String(entry.value);
    let text = '工程平台引用：' + formatted;
    if (isOverridden(project, refKey)) text += '\n（管理员已覆盖显示值）';
    if (entry.syncedAt) {
      text += '\n同步：' + String(entry.syncedAt).slice(0, 16).replace('T', ' ');
    }
    return text;
  }

  function buildLuckysheetCommentPs(text) {
    if (window.ChangeMeta && ChangeMeta.buildLuckysheetCommentPs) {
      return ChangeMeta.buildLuckysheetCommentPs(text);
    }
    return { left: 92, top: 10, width: 220, height: 80, value: text, isshow: false };
  }

  function applyOverride(project, field, newVal, user, monthIdx) {
    let p = ensureMeta(Object.assign({}, project));
    const refKey = getRefKey(field, monthIdx);
    if (!refKey) return p;
    const flatKey = FieldConfig.COL_TO_KEY[field.col] || refKey;
    p[flatKey] = newVal;
    p = FieldConfig.flatToArrays(p);
    p._system_override[refKey] = {
      at: new Date().toISOString(),
      userId: (user && user.role) || '',
      userName: (user && user.name) || ''
    };
    return p;
  }

  function restoreFromRef(project, field, monthIdx) {
    let p = ensureMeta(Object.assign({}, project));
    const refKey = getRefKey(field, monthIdx);
    if (!refKey) return p;
    const refVal = getRefValue(p, refKey);
    const flatKey = FieldConfig.COL_TO_KEY[field.col] || refKey;
    if (refVal == null || refVal === '') {
      p[flatKey] = (field.data_type === '金额' || field.data_type === '比率') ? 0 : '';
    } else {
      p[flatKey] = refVal;
    }
    p = FieldConfig.flatToArrays(p);
    delete p._system_override[refKey];
    return p;
  }

  function clearRefMeta(project) {
    const p = Object.assign({}, project);
    p._system_ref = {};
    p._system_override = {};
    return p;
  }

  function buildRefEntry(value, status, syncedAt) {
    return {
      value: value != null && value !== '' ? value : null,
      status: status || 'ok',
      syncedAt: syncedAt || new Date().toISOString()
    };
  }

  function resolvePlatformRefValue(platform, refKey, monthIdx) {
    if (!platform) return null;
    if (refKey.startsWith('mi_') || refKey.startsWith('mp_')) {
      const idx = parseInt(refKey.split('_')[1], 10);
      const arrKey = refKey.startsWith('mi_') ? 'monthly_invoice' : 'monthly_payment';
      if (platform[arrKey] && platform[arrKey][idx] != null) return platform[arrKey][idx];
      return platform[refKey];
    }
    return platform[refKey];
  }

  window.SystemRefMeta = {
    OVERRIDE_BG,
    ensureMeta,
    getRefKey,
    isSystemRefField,
    getRefFields,
    getRefKeys,
    isOverridden,
    isOverriddenField,
    isEmptyDisplayValue,
    getRefEntry,
    getRefValue,
    formatRefComment,
    buildLuckysheetCommentPs,
    applyOverride,
    restoreFromRef,
    clearRefMeta,
    buildRefEntry,
    resolvePlatformRefValue
  };
})(window);
