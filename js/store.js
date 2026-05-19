/**
 * store.js — Vue.observable 全局状态 + SQLite（经 /api 与 Node 服务同步）
 * 登录信息仍用 localStorage；业务数据来自 better-sqlite3
 */
(function (window) {
  'use strict';

  const LS_KEY_USER = 'ptrack_user';
  const LS_KEY_SIDEBAR = 'ptrack_sidebar_collapsed';

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
    const text = await r.text();
    if (!r.ok) {
      let msg = text || r.statusText;
      if (msg && /^\s*</.test(msg)) {
        const m = msg.match(/<pre>([^<]+)<\/pre>/i);
        msg = m ? m[1] : 'HTTP ' + r.status;
        if (r.status === 404 && path.indexOf('/admin/') === 0) {
          msg += '（接口不存在，请重启 npm start 后再试）';
        }
      } else {
        try {
          const j = JSON.parse(msg);
          if (j && j.error) msg = j.error;
        } catch (e) { /* keep raw */ }
      }
      throw new Error(msg);
    }
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
    /** 本月板块已正式提交审批（Draft 快照已生成），填报页只读直至驳回或管理员重置 */
    reportingSubmitted: false,
    /** PM 提交状态 { '2026-05': { '何孝刚': { status, submittedAt, snapshotVersion, projectNos } } } */
    pmSubmissions: {},
    snapshots: {},
    /** 与本月对比的「上月归档」快照版本键，如 Month:2026-04 */
    priorMonthSnapshotVersion: null,
    auditLog: [],
    sidebarCollapsed: !!lsGet(LS_KEY_SIDEBAR, false),
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
    Store.pmSubmissions = d.pmSubmissions || {};
    Store.priorMonthSnapshotVersion = d.priorMonthSnapshotVersion || null;
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

  /** 生成上一报告月对比快照（演示新增项目高亮） */
  Store.seedPriorMonthSnapshot = async function (removeCount) {
    const user = Store.currentUser || { name: '系统', role: 'system_admin' };
    const body = {
      removeCount: removeCount != null ? removeCount : 5,
      userName: user.name,
      role: user.role
    };
    const d = await apiFetch('/admin/seed-prior-month-snapshot', { method: 'POST', body });
    if (d && d.state) applyBootstrap(d.state);
    else await Store.init();
    return d;
  };

  /** 开发测试：流程、配置与项目数据恢复为初始默认 */
  Store.resetDevEnvironment = async function () {
    const d = await apiFetch('/admin/reset-dev', { method: 'POST' });
    if (d && d.state) applyBootstrap(d.state);
    else await Store.init();
    return d;
  };

  Store.login = function (user) {
    Store.currentUser = user;
    lsSet(LS_KEY_USER, user);
  };

  Store.logout = function () {
    Store.currentUser = null;
    localStorage.removeItem(LS_KEY_USER);
  };

  Store.toggleSidebar = function () {
    Store.sidebarCollapsed = !Store.sidebarCollapsed;
    lsSet(LS_KEY_SIDEBAR, Store.sidebarCollapsed);
  };

  Store.setSidebarCollapsed = function (collapsed) {
    Store.sidebarCollapsed = !!collapsed;
    lsSet(LS_KEY_SIDEBAR, Store.sidebarCollapsed);
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

  /** 板块管理员：同步 PM 提交状态与 PM 快照（进入填报页时调用） */
  Store.syncPmWorkflow = async function () {
    const d = await apiFetch('/bootstrap');
    if (!d) return;
    Store.pmSubmissions = d.pmSubmissions || {};
    const snaps = d.snapshots || {};
    Object.keys(snaps).forEach(function (k) {
      if (k.indexOf('PM:') === 0) Vue.set(Store.snapshots, k, snaps[k]);
    });
  };

  /** 按版本名获取快照（先读内存，缺失时从服务端拉取） */
  Store.fetchSnapshot = async function (versionName) {
    if (!versionName) return null;
    if (Store.snapshots[versionName]) return Store.snapshots[versionName];
    try {
      const snap = await apiFetch('/snapshots/' + encodeURIComponent(versionName));
      if (snap) Vue.set(Store.snapshots, versionName, snap);
      return snap;
    } catch (e) {
      return null;
    }
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
      newVal: 'draft（已驳回至板块管理员）',
      userId: Store.currentUser && Store.currentUser.role,
      userName: Store.currentUser && Store.currentUser.name
    });
  };

  /** 获取当前报告月某 PM 的提交记录 */
  Store.getPmSubmission = function (pmName) {
    const month = Store.reportingMonth;
    return (Store.pmSubmissions[month] || {})[pmName] || null;
  };

  /** 该 PM 是否处于「已提交待接收」锁定状态 */
  Store.isPmLocked = function (pmName) {
    const sub = Store.getPmSubmission(pmName);
    return !!(sub && sub.status === 'submitted');
  };

  /** 该 PM 是否可提交（板块未正式提交 且 自身不处于锁定中） */
  Store.canPmSubmit = function (pmName) {
    if (Store.reportingSubmitted) return false;
    return !Store.isPmLocked(pmName);
  };

  /** PM 进入填报前确保有基准快照（本轮编辑起点，用于提交后 diff） */
  Store.ensurePmBaseline = async function (pmName, projectsSnapshot) {
    const user = Store.currentUser || {};
    const name = pmName || user.pmName || user.name;
    if (!name) return null;
    const sub = Store.getPmSubmission(name);
    if (sub && sub.baselineSnapshotVersion) return sub.baselineSnapshotVersion;
    if (!Store.canPmSubmit(name)) return null;

    const body = {
      pmName: name,
      reportingMonth: Store.reportingMonth,
      userName: user.name
    };
    if (projectsSnapshot && projectsSnapshot.length) {
      body.projects = projectsSnapshot;
    }

    const result = await apiFetch('/pm-submissions/ensure-baseline', {
      method: 'POST',
      body
    });
    if (!Store.pmSubmissions[Store.reportingMonth]) {
      Vue.set(Store.pmSubmissions, Store.reportingMonth, {});
    }
    const prev = Store.pmSubmissions[Store.reportingMonth][name] || {};
    Vue.set(Store.pmSubmissions[Store.reportingMonth], name, Object.assign({}, prev, {
      baselineSnapshotVersion: result.baselineSnapshotVersion
    }));
    if (result.snapshot && result.baselineSnapshotVersion) {
      Vue.set(Store.snapshots, result.baselineSnapshotVersion, result.snapshot);
    }
    return result.baselineSnapshotVersion;
  };

  /** 将当前 Store 中该 PM 名下项目全部写入 SQLite（提交前兜底同步） */
  Store.syncPmProjectsToServer = async function (pmName, monthIdx) {
    if (!pmName) return;
    const idx = monthIdx != null ? monthIdx : Store.getMonthIdx();
    const list = FormulaEngine.computeAll(
      Store.projects.filter(function (p) { return p.pm_name === pmName; }),
      idx
    );
    for (let i = 0; i < list.length; i++) {
      await Store.updateProject(list[i]);
    }
  };

  /** PM 提交：生成个人子集快照，写 pmSubmissions */
  Store.submitPmReporting = async function () {
    const user = Store.currentUser || {};
    const pmName = user.pmName || user.name;
    if (!pmName) throw new Error('无法获取 PM 姓名');
    if (!Store.canPmSubmit(pmName)) throw new Error('当前状态不允许提交');

    const result = await apiFetch('/pm-submissions/submit', {
      method: 'POST',
      body: { pmName, reportingMonth: Store.reportingMonth, userName: user.name }
    });

    // 更新本地 pmSubmissions 状态
    if (!Store.pmSubmissions[Store.reportingMonth]) {
      Vue.set(Store.pmSubmissions, Store.reportingMonth, {});
    }
    const prev = Store.pmSubmissions[Store.reportingMonth][pmName] || {};
    Vue.set(Store.pmSubmissions[Store.reportingMonth], pmName, {
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      snapshotVersion: result.snapshotVersion,
      baselineSnapshotVersion: result.baselineSnapshotVersion || prev.baselineSnapshotVersion,
      submissionBaselineSnapshotVersion: result.submissionBaselineSnapshotVersion
        || result.baselineSnapshotVersion
        || prev.baselineSnapshotVersion,
      projectCount: result.projectCount
    });

    if (result.snapshot && result.snapshotVersion) {
      Vue.set(Store.snapshots, result.snapshotVersion, result.snapshot);
    }

    return result;
  };

  /** 板块管理员确认接收某 PM 提交，解除其锁定 */
  Store.receivePmSubmission = async function (pmName) {
    const user = Store.currentUser || {};
    const result = await apiFetch('/pm-submissions/receive', {
      method: 'POST',
      body: { pmName, reportingMonth: Store.reportingMonth, userName: user.name }
    });
    const month = Store.reportingMonth;
    if (Store.pmSubmissions[month] && Store.pmSubmissions[month][pmName]) {
      const entry = Store.pmSubmissions[month][pmName];
      entry.status = 'received';
      entry.receivedAt = new Date().toISOString();
      if (result && result.baselineSnapshotVersion) {
        entry.baselineSnapshotVersion = result.baselineSnapshotVersion;
        if (result.baselineSnapshot) {
          Vue.set(Store.snapshots, result.baselineSnapshotVersion, result.baselineSnapshot);
        }
      }
    }
  };

  /** 板块管理员/系统管理员：正式提交审批，生成全局 Draft 快照 */
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
