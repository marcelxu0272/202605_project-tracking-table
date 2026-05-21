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

  function isFinanceReviewReminder(config) {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const [ry, rm] = (config.reportingMonth || '2026-05').split('-').map(Number);
    return (
      (month === 1 ? year - 1 : year) === ry &&
      (month === 1 ? 12 : month - 1) === rm &&
      day <= 3
    );
  }

  function calcLockStatus(config) {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const [ry, rm] = (config.reportingMonth || '2026-05').split('-').map(Number);
    const isCurrentMonth = (year === ry && month === rm);
    if (isCurrentMonth && day >= config.lockDay) return 'locked';
    return 'open';
  }

  function normalizeLockStatus(status, config) {
    if (status === 'finance_only') return 'open';
    if (status === 'open' || status === 'locked') return status;
    return calcLockStatus(config || DEFAULT_CONFIG);
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
    financeReviewReminder: isFinanceReviewReminder(DEFAULT_CONFIG),
    approvalStatus: 'draft',
    /** 公司归档段：pending | final（见 companyFlow） */
    reportingSubmitted: false,
    sectorFlows: {},
    sectorRegistry: [],
    sectorNames: {},
    companyFlow: { archiveStatus: 'pending', archivedAt: null },
    /** PM 提交状态 { '2026-05': { '何孝刚': { status, submittedAt, snapshotVersion, projectNos } } } */
    pmSubmissions: {},
    snapshots: {},
    /** 与本月对比的「上月归档」快照版本键，如 Month:2026-04 */
    priorMonthSnapshotVersion: null,
    systemDataSyncedAt: null,
    systemDataSyncMeta: null,
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
    Store.lockStatus = normalizeLockStatus(d.lockStatus, Store.periodConfig);
    Store.financeReviewReminder = d.financeReviewReminder === true
      || isFinanceReviewReminder(Store.periodConfig);
    Store.sectorFlows = d.sectorFlows || {};
    Store.sectorRegistry = d.sectorRegistry || [];
    Store.sectorNames = d.sectorNames || {};
    Store.companyFlow = d.companyFlow || { archiveStatus: 'pending', archivedAt: null };
    Store.reportingSubmitted = d.reportingSubmitted === true;
    Store.pmSubmissions = d.pmSubmissions || {};
    Store.sectorFlows = d.sectorFlows || {};
    Store.sectorRegistry = d.sectorRegistry || [];
    Store.sectorNames = d.sectorNames || Store.sectorNames || {};
    Store.companyFlow = d.companyFlow || { archiveStatus: 'pending', archivedAt: null };
    Store.priorMonthSnapshotVersion = d.priorMonthSnapshotVersion || null;
    Store.systemDataSyncedAt = d.systemDataSyncedAt || null;
    Store.systemDataSyncMeta = d.systemDataSyncMeta || null;
    Store._hydrated = true;
  }

  function applyStateFromApi(d) {
    if (!d) return;
    if (d.state) applyBootstrap(d.state);
    else applyBootstrap(d);
  }

  Store.getSectorFlow = function (code) {
    return SectorWorkflow.getSectorFlow(Store.sectorFlows, code || 'SAS520');
  };

  Store.listSectors = function () {
    return SectorWorkflow.listSectors(Store);
  };

  Store.isSectorReportingSubmitted = function (code) {
    return !!Store.getSectorFlow(code).reportingSubmitted;
  };

  Store.resolvePmSector = function (pmName) {
    const hit = Store.projects.find(function (p) { return p.pm_name === pmName; });
    return SectorWorkflow.projectSector(hit);
  };

  Store.allSectorsReadyForArchive = function () {
    return SectorWorkflow.allSectorsReadyForArchive(Store.sectorFlows, Store.listSectors());
  };

  Store.isCompanyArchived = function () {
    return Store.companyFlow && Store.companyFlow.archiveStatus === 'final';
  };

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

  Store.createSnapshot = async function (versionName, projectsOverride, extra) {
    const user = Store.currentUser || { name: '系统', role: 'system_admin' };
    const projects = projectsOverride != null
      ? projectsOverride
      : JSON.parse(JSON.stringify(Store.projects));
    const snap = Object.assign({
      version: versionName,
      time: new Date().toISOString(),
      user: user.name,
      role: user.role,
      projects: projects
    }, extra || {});
    await apiFetch('/snapshots/' + encodeURIComponent(versionName), { method: 'PUT', body: snap });
    Vue.set(Store.snapshots, versionName, snap);
    return snap;
  };

  /** 板块管理员：同步 PM 提交状态与 PM 快照（进入填报页时调用） */
  Store.syncPmWorkflow = async function () {
    const d = await apiFetch('/bootstrap');
    if (!d) return;
    Store.pmSubmissions = d.pmSubmissions || {};
    Store.sectorFlows = d.sectorFlows || Store.sectorFlows;
    Store.sectorRegistry = d.sectorRegistry || Store.sectorRegistry;
    Store.companyFlow = d.companyFlow || Store.companyFlow;
    Store.approvalStatus = d.approvalStatus || Store.approvalStatus;
    Store.reportingSubmitted = d.reportingSubmitted === true;
    const snaps = d.snapshots || {};
    Object.keys(snaps).forEach(function (k) {
      if (k.indexOf('PM:') === 0 || k.indexOf(':') > 0 || k === 'J版') {
        Vue.set(Store.snapshots, k, snaps[k]);
      }
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

  /** 板块总监/群主：推进本板块审批 */
  Store.advanceSectorApproval = async function (sectorCode) {
    const user = Store.currentUser || {};
    const code = sectorCode || user.sector || 'S520';
    const d = await apiFetch('/sectors/' + encodeURIComponent(code) + '/advance-approval', {
      method: 'POST',
      body: { userName: user.name, role: user.role }
    });
    applyStateFromApi(d);
    return d;
  };

  Store.rejectSectorApproval = async function (sectorCode, reason) {
    const user = Store.currentUser || {};
    const code = sectorCode || user.sector || 'S520';
    const d = await apiFetch('/sectors/' + encodeURIComponent(code) + '/reject-approval', {
      method: 'POST',
      body: { userName: user.name, role: user.role, reason: reason || '' }
    });
    applyStateFromApi(d);
    return d;
  };

  /** 系统管理员：全公司归档（J版） */
  Store.archiveCompany = async function () {
    const user = Store.currentUser || {};
    const d = await apiFetch('/company/archive', {
      method: 'POST',
      body: { userName: user.name, role: user.role }
    });
    applyStateFromApi(d);
    return d;
  };

  /** 兼容旧调用：按角色路由 */
  Store.advanceApproval = async function (sectorCode) {
    const user = Store.currentUser || {};
    if (user.role === 'system_admin') {
      return Store.archiveCompany();
    }
    return Store.advanceSectorApproval(sectorCode || user.sector);
  };

  Store.rejectApproval = async function (sectorCode) {
    return Store.rejectSectorApproval(sectorCode);
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
    const sector = Store.resolvePmSector(pmName);
    if (Store.isSectorReportingSubmitted(sector)) return false;
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

  /** 板块管理员：提交本板块审批，生成 Draft:{sector} */
  Store.submitForApproval = async function () {
    const user = Store.currentUser || {};
    const code = user.sector || 'S520';
    const d = await apiFetch('/sectors/' + encodeURIComponent(code) + '/submit-approval', {
      method: 'POST',
      body: { userName: user.name, role: user.role }
    });
    applyStateFromApi(d);
    return d;
  };

  Store.setLockStatus = async function (status) {
    const normalized = normalizeLockStatus(status, Store.periodConfig);
    Store.lockStatus = normalized;
    Store.financeReviewReminder = isFinanceReviewReminder(Store.periodConfig);
    await apiFetch('/meta', { method: 'PATCH', body: { lockStatus: normalized } });
  };

  Store.refreshFinanceReviewReminder = function () {
    Store.financeReviewReminder = isFinanceReviewReminder(Store.periodConfig);
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

  Store.syncPlatformData = async function () {
    const user = Store.currentUser || {};
    const d = await apiFetch('/admin/sync-platform-data', {
      method: 'POST',
      body: {
        user: {
          id: user.id,
          name: user.name,
          role: user.role
        }
      }
    });
    if (d && d.state) applyBootstrap(d.state);
    else if (d && d.systemDataSyncedAt) {
      Store.systemDataSyncedAt = d.systemDataSyncedAt;
      Store.systemDataSyncMeta = d.syncMeta || null;
    }
    return d;
  };

  Store.getMonthIdx = function () {
    return FormulaEngine.getMonthIdx(Store.reportingMonth);
  };

  Store.getSummary = function () {
    return FormulaEngine.summarize(Store.projects, Store.getMonthIdx());
  };

  window.Store = Store;
})(window);
