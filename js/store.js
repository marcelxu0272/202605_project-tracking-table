/**
 * store.js — Vue.observable 全局状态 + SQLite（经 /api 与 Node 服务同步）
 * 登录信息仍用 localStorage；业务数据来自 better-sqlite3
 */
(function (window) {
  'use strict';

  const LS_KEY_USER = 'ptrack_user';

  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  const DEFAULT_CONFIG = {
    reminderDay:  19,
    lockDay:      25,
    unlockDay:    9,
    reportingMonth: '2026-05',
    systemYear: 2026
  };

  function calcLockStatus(config) {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const [ry, rm] = (config.reportingMonth || '2026-05').split('-').map(Number);
    const isCurrentMonth = (year === ry && month === rm);
    const isPrevMonthFirst3 = (
      (month === 1 ? year - 1 : year) === ry &&
      (month === 1 ? 12 : month - 1) === rm &&
      day <= 3
    );
    if (isPrevMonthFirst3) return 'finance_only';
    if (isCurrentMonth && day >= config.lockDay) return 'locked';
    return 'open';
  }

  async function apiFetch(path, { method = 'GET', body } = {}) {
    const base = window.PTRACK_API_BASE != null ? window.PTRACK_API_BASE : '';
    const url = base + '/api' + path;
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const r = await fetch(url, init);
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  const savedUser = lsGet(LS_KEY_USER, null);

  const Store = Vue.observable({
    currentUser: savedUser,
    projects: [],
    reportingMonth: DEFAULT_CONFIG.reportingMonth,
    periodConfig: Object.assign({}, DEFAULT_CONFIG),
    lockStatus: calcLockStatus(DEFAULT_CONFIG),
    approvalStatus: 'draft',
    /** 本月填报已提交审批（Draft 快照已生成），填报页只读直至驳回或管理员重置 */
    reportingSubmitted: false,
    snapshots: {},
    auditLog: [],
    sidebarCollapsed: false,
    editorViewMode: 'all',
    _hydrated: false
  });

  function applyBootstrap(d) {
    if (!d) return;
    Store.projects.splice(0, Store.projects.length, ...(d.projects || []));
    Store.auditLog.splice(0, Store.auditLog.length, ...(d.auditLog || []));
    Object.keys(Store.snapshots).forEach(k => Vue.delete(Store.snapshots, k));
    const snaps = d.snapshots || {};
    Object.keys(snaps).forEach(k => Vue.set(Store.snapshots, k, snaps[k]));
    Object.assign(Store.periodConfig, d.periodConfig || {});
    Store.reportingMonth = d.reportingMonth || Store.periodConfig.reportingMonth;
    Store.approvalStatus = d.approvalStatus || 'draft';
    Store.lockStatus = d.lockStatus || calcLockStatus(Store.periodConfig);
    Store.reportingSubmitted = d.reportingSubmitted === true
      || !!(d.snapshots && d.snapshots.Draft);
    Store._hydrated = true;
  }

  Store.init = async function () {
    const d = await apiFetch('/bootstrap');
    applyBootstrap(d);
  };

  Store.reseedFromInit = async function () {
    await apiFetch('/admin/reseed', { method: 'POST' });
    await Store.init();
  };

  Store.login = function (user) {
    Store.currentUser = user;
    lsSet(LS_KEY_USER, user);
  };

  Store.logout = function () {
    Store.currentUser = null;
    localStorage.removeItem(LS_KEY_USER);
  };

  Store.replaceProjects = async function (newProjects) {
    await apiFetch('/projects', { method: 'POST', body: { projects: newProjects } });
    Store.projects.splice(0, Store.projects.length, ...newProjects);
  };

  Store.updateProject = async function (updatedProject) {
    await apiFetch('/projects/' + encodeURIComponent(updatedProject.project_no), {
      method: 'PUT',
      body: updatedProject
    });
    const idx = Store.projects.findIndex(p => p.project_no === updatedProject.project_no);
    if (idx >= 0) {
      Vue.set(Store.projects, idx, Object.assign({}, Store.projects[idx], updatedProject));
    } else {
      Store.projects.push(updatedProject);
    }
  };

  Store.addAuditLog = async function (entry) {
    const record = await apiFetch('/audit', { method: 'POST', body: entry });
    Store.auditLog.unshift(record);
    if (Store.auditLog.length > 500) Store.auditLog.splice(500);
  };

  Store.createSnapshot = async function (versionName) {
    const user = Store.currentUser || { name: '系统', role: 'system_admin' };
    const snap = {
      version: versionName,
      time: new Date().toISOString(),
      user: user.name,
      role: user.role,
      projects: JSON.parse(JSON.stringify(Store.projects))
    };
    await apiFetch('/snapshots/' + encodeURIComponent(versionName), { method: 'PUT', body: snap });
    Vue.set(Store.snapshots, versionName, snap);
  };

  Store.advanceApproval = async function () {
    const flow = ['draft', 'approve1', 'approve2', 'final'];
    const idx = flow.indexOf(Store.approvalStatus);
    if (idx >= flow.length - 1) return;
    const next = flow[idx + 1];
    const versionMap = {
      approve1: 'Approve1',
      approve2: 'Approve2',
      final:    'J版'
    };
    Store.approvalStatus = next;
    await apiFetch('/meta', { method: 'PATCH', body: { approvalStatus: next } });
    if (versionMap[next]) await Store.createSnapshot(versionMap[next]);
    await Store.addAuditLog({
      projectNo: '—',
      projectName: '全局',
      fieldName: 'approvalStatus',
      fieldCN: '审批状态',
      oldVal: flow[idx],
      newVal: next,
      userId: Store.currentUser && Store.currentUser.role,
      userName: Store.currentUser && Store.currentUser.name
    });
  };

  Store.rejectApproval = async function () {
    const prev = Store.approvalStatus;
    Store.approvalStatus = 'draft';
    Store.reportingSubmitted = false;
    await apiFetch('/meta', {
      method: 'PATCH',
      body: { approvalStatus: 'draft', reportingSubmitted: false }
    });
    await Store.addAuditLog({
      projectNo: '—',
      projectName: '全局',
      fieldName: 'approvalStatus',
      fieldCN: '审批状态',
      oldVal: prev,
      newVal: 'draft（已驳回）',
      userId: Store.currentUser && Store.currentUser.role,
      userName: Store.currentUser && Store.currentUser.name
    });
  };

  Store.submitForApproval = async function () {
    await Store.createSnapshot('Draft');
    Store.approvalStatus = 'draft';
    Store.reportingSubmitted = true;
    await apiFetch('/meta', {
      method: 'PATCH',
      body: { approvalStatus: 'draft', reportingSubmitted: true }
    });
    await Store.addAuditLog({
      projectNo: '—',
      projectName: '全局',
      fieldName: 'submit',
      fieldCN: '提交审批',
      oldVal: '',
      newVal: '已提交，生成Draft快照',
      userId: Store.currentUser && Store.currentUser.role,
      userName: Store.currentUser && Store.currentUser.name
    });
  };

  Store.setLockStatus = async function (status) {
    Store.lockStatus = status;
    await apiFetch('/meta', { method: 'PATCH', body: { lockStatus: status } });
  };

  Store.savePeriodConfig = async function (cfg) {
    Object.assign(Store.periodConfig, cfg);
    Store.reportingMonth = Store.periodConfig.reportingMonth;
    await apiFetch('/meta', {
      method: 'PATCH',
      body: {
        periodConfig: Store.periodConfig,
        reportingMonth: Store.reportingMonth
      }
    });
  };

  Store.getMonthIdx = function () {
    return FormulaEngine.getMonthIdx(Store.reportingMonth);
  };

  Store.getSummary = function () {
    return FormulaEngine.summarize(Store.projects, Store.getMonthIdx());
  };

  window.Store = Store;
})(window);
