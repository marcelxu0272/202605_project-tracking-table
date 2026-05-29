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
    autoUnlockEnabled: false,
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
    const nowMonthIndex = year * 12 + month;
    const reportingMonthIndex = ry * 12 + rm;
    if (nowMonthIndex === reportingMonthIndex) {
      return day >= config.lockDay ? 'locked' : 'open';
    }
    if (nowMonthIndex === reportingMonthIndex + 1) {
      return config.autoUnlockEnabled === true && day >= config.unlockDay ? 'open' : 'locked';
    }
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
    /** PM 提交状态 { '2026-05': { '何孝刚': { status, submittedAt, projectNos, projectCount } } } */
    pmSubmissions: {},
    snapshots: {},
    baselineVersion: null,
    latestIVersion: null,
    latestJVersion: null,
    systemDataSyncedAt: null,
    systemDataSyncMeta: null,
    users: [],
    groupRegistry: {},
    sectorAdmins: {},
    /** 83 字段字典（与项目追踪表同源，bootstrap 加载） */
    fieldDictionary: [],
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
    Store.baselineVersion = d.baselineVersion || null;
    Store.latestIVersion = d.latestIVersion || null;
    Store.latestJVersion = d.latestJVersion || null;
    Store.systemDataSyncedAt = d.systemDataSyncedAt || null;
    Store.systemDataSyncMeta = d.systemDataSyncMeta || null;
    Store.users = d.users || [];
    Store.groupRegistry = d.groupRegistry || {};
    Store.sectorAdmins = d.sectorAdmins || {};
    if (d.fieldDictionary && d.fieldDictionary.length) {
      Store.applyFieldDictionary(d.fieldDictionary);
    }
    if (Store.currentUser && Store.currentUser.role !== 'system_admin') {
      Store.auditLog.splice(0, Store.auditLog.length);
    }
    Store._hydrated = true;
  }

  /** 更新全局字段字典（项目追踪表与表头配置页共用） */
  Store.applyFieldDictionary = function (fields) {
    const copy = JSON.parse(JSON.stringify(fields || []));
    Store.fieldDictionary.splice(0, Store.fieldDictionary.length, ...copy);
    window.FIELD_DICTIONARY = copy;
  };

  /** 静态资源根路径（与 Express 静态托管一致） */
  function staticBase() {
    return window.PTRACK_API_BASE != null ? window.PTRACK_API_BASE : '';
  }

  /**
   * 确保字段字典已加载（bootstrap → API → 静态 fields.json / fields-data.js）
   * 兼容未重启的旧版服务端（无 fieldDictionary / 无 /api/fields）
   */
  Store.ensureFieldDictionary = async function () {
    if (Store.fieldDictionary.length) return Store.fieldDictionary;

    const apiPaths = ['/fields', '/admin/fields'];
    for (let i = 0; i < apiPaths.length; i++) {
      try {
        const fd = await apiFetch(apiPaths[i]);
        if (fd && fd.fields && fd.fields.length) {
          Store.applyFieldDictionary(fd.fields);
          return Store.fieldDictionary;
        }
      } catch (e) { /* try next */ }
    }

    const base = staticBase();
    try {
      const r = await fetch(base + '/config/fields/fields.json');
      if (r.ok) {
        const fields = await r.json();
        if (Array.isArray(fields) && fields.length) {
          Store.applyFieldDictionary(fields);
          return Store.fieldDictionary;
        }
      }
    } catch (e) { /* fallback below */ }

    await new Promise(function (resolve, reject) {
      if (window.FIELD_DICTIONARY && window.FIELD_DICTIONARY.length) {
        Store.applyFieldDictionary(window.FIELD_DICTIONARY);
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = base + '/config/fields/fields-data.js';
      s.onload = function () {
        if (window.FIELD_DICTIONARY && window.FIELD_DICTIONARY.length) {
          Store.applyFieldDictionary(window.FIELD_DICTIONARY);
          resolve();
        } else {
          reject(new Error('fields-data.js 未导出 FIELD_DICTIONARY'));
        }
      };
      s.onerror = function () {
        reject(new Error('无法加载 config/fields/fields-data.js'));
      };
      document.head.appendChild(s);
    });

    return Store.fieldDictionary;
  };

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
    await Store.ensureFieldDictionary();
    if (!Store.fieldDictionary.length) {
      throw new Error('字段字典加载失败，请重启 npm start 并确认 config/fields/fields.json 存在');
    }
  };

  Store.reseedFromInit = async function () {
    await apiFetch('/admin/reseed', { method: 'POST' });
    await Store.init();
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
    if (user.role !== 'system_admin') {
      Store.auditLog.splice(0, Store.auditLog.length);
    }
  };

  Store.saveUsersConfig = async function (payload) {
    const d = await apiFetch('/admin/users', { method: 'PATCH', body: payload });
    if (d && d.state) applyBootstrap(d.state);
    else await Store.init();
    return d;
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

  /** 板块管理员：同步 PM 提交状态与最新项目数据（进入填报页时调用） */
  Store.syncPmWorkflow = async function () {
    const d = await apiFetch('/bootstrap');
    if (!d) return;
    applyBootstrap(d);
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
    if (d && d.version && d.snapshot) {
      Vue.set(Store.snapshots, d.version, d.snapshot);
    }
    if (d && d.state && d.state.latestJVersion) {
      Store.latestJVersion = d.state.latestJVersion;
      Store.baselineVersion = d.state.baselineVersion;
    } else if (d && d.version) {
      Store.latestJVersion = d.version;
      Store.baselineVersion = d.version;
    }
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

  /** 该 PM 本月是否已提交（提交后锁定，不可再改） */
  Store.isPmLocked = function (pmName) {
    const sub = Store.getPmSubmission(pmName);
    return !!(sub && (sub.status === 'submitted' || sub.status === 'received'));
  };

  /** 该 PM 是否可提交（板块未正式提交 且 自身不处于锁定中） */
  Store.canPmSubmit = function (pmName) {
    const sector = Store.resolvePmSector(pmName);
    if (Store.isSectorReportingSubmitted(sector)) return false;
    return !Store.isPmLocked(pmName);
  };

  /** PM 提交：仅写 pmSubmissions 状态，不生成快照 */
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
      projectCount: result.projectCount
    });

    return result;
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

  /** @deprecated 已取消确认接收 */
  Store.receivePmSubmission = async function () {
    throw new Error('已废弃：PM 提交后无需板块确认接收');
  };

  /** 板块管理员：提交本板块审批，生成 D 版快照 */
  Store.submitForApproval = async function () {
    const user = Store.currentUser || {};
    const code = user.sector || 'S520';
    const d = await apiFetch('/sectors/' + encodeURIComponent(code) + '/submit-approval', {
      method: 'POST',
      body: { userName: user.name, role: user.role }
    });
    applyStateFromApi(d);
    if (d && d.version && d.snapshot) {
      Vue.set(Store.snapshots, d.version, d.snapshot);
    }
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
    const d = await apiFetch('/meta', {
      method: 'PATCH',
      body: {
        periodConfig: Store.periodConfig,
        reportingMonth: Store.reportingMonth
      }
    });
    applyBootstrap(d);
  };

  Store.syncPlatformData = async function () {
    return Store.refreshEditorData();
  };

  /** 系统/板块管理员：刷新工程平台引用 + 重载库内项目与 PM 提交状态 */
  Store.refreshEditorData = async function () {
    const user = Store.currentUser || {};
    const d = await apiFetch('/editor/refresh-data', {
      method: 'POST',
      body: {
        user: {
          id: user.id || user.role,
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

  Store.fetchFieldDictionary = async function () {
    if (Store.fieldDictionary.length) {
      return { fields: JSON.parse(JSON.stringify(Store.fieldDictionary)), count: Store.fieldDictionary.length };
    }
    return apiFetch('/fields');
  };

  Store.saveFieldDictionary = async function (fields, user) {
    const d = await apiFetch('/admin/fields', {
      method: 'PUT',
      body: { fields: fields, user: user || Store.currentUser }
    });
    const fresh = (d && d.fields) ? d.fields : (await apiFetch('/fields')).fields;
    if (fresh && fresh.length) Store.applyFieldDictionary(fresh);
    return d;
  };

  window.Store = Store;
})(window);
