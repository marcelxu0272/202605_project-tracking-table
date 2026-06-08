'use strict';

const dbm = require('./db');
const sw = require('./sector-workflow');
const snapSvc = require('./snapshot-service');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowLocal() {
  return new Date().toISOString();
}

/** 从 projects 表中解析出 payload（JSON） */
function loadProjectsFromDb(db) {
  return db.prepare('SELECT payload FROM projects ORDER BY project_no ASC').all()
    .map(function (r) { return JSON.parse(r.payload); });
}

/** 按板块代码过滤项目，同时收集该板块下所有不重复 PM 名称 */
function sectorProjectsAndPms(projects, sectorCode) {
  const code = sw.normalizeSectorCode(sectorCode);
  const pms = new Set();
  const matched = [];
  (projects || []).forEach(function (p) {
    const pSector = sw.projectSector(p);
    if (pSector !== code) return;
    matched.push(p);
    if (p.pm_name) pms.add(p.pm_name);
  });
  return { projects: matched, pmNames: Array.from(pms).sort() };
}

/** 抛出带 status + message 的错误 */
function fail(status, message) {
  var err = new Error(message);
  err.status = status;
  throw err;
}

// ---------------------------------------------------------------------------
// 1. forkPeriod — 为各板块创建新周期报告线
// ---------------------------------------------------------------------------

/**
 * 解析某板块的审批链路人员
 * @returns {{ sectorAdmin, sectorReviewer, groupReviewer }}
 *   每项: { name, userId, source: 'configured'|'platform_default'|'missing' }
 */
function resolveApprovalStaffForSector(db, sectorCode) {
  var code = sw.normalizeSectorCode(sectorCode);
  var sectorAdmins = dbm.getMeta(db, 'sectorAdmins', {}) || {};
  var sectorReviewers = dbm.getMeta(db, 'sectorReviewers', {}) || {};
  var groupReviewers = dbm.getMeta(db, 'groupReviewers', {}) || {};
  var groupRegistry = dbm.getMeta(db, 'groupRegistry', dbm.DEFAULT_GROUP_REGISTRY) || {};
  var users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS) || [];

  // 板块管理员
  var adminCfg = sectorAdmins[code] || {};
  var sectorAdmin;
  if (adminCfg.adminName || adminCfg.adminUserId) {
    sectorAdmin = { name: adminCfg.adminName || '', userId: adminCfg.adminUserId || '', source: 'configured' };
  } else {
    // 平台默认：users 中同板块 sector_admin
    var platformAdmin = users.find(function (u) {
      return u.role === 'sector_admin' && sw.normalizeSectorCode(u.sector || u.sectorCode || '') === code;
    });
    sectorAdmin = platformAdmin
      ? { name: platformAdmin.name || '', userId: platformAdmin.id || '', source: 'platform_default' }
      : { name: '', userId: '', source: 'missing' };
  }

  // 板块审批
  var reviewerCfg = sectorReviewers[code] || {};
  var sectorReviewer;
  if (reviewerCfg.reviewerName || reviewerCfg.reviewerUserId) {
    sectorReviewer = { name: reviewerCfg.reviewerName || '', userId: reviewerCfg.reviewerUserId || '', source: 'configured' };
  } else {
    var platformReviewer = users.find(function (u) {
      return u.role === 'sector_director' && sw.normalizeSectorCode(u.sector || u.sectorCode || '') === code;
    });
    sectorReviewer = platformReviewer
      ? { name: platformReviewer.name || '', userId: platformReviewer.id || '', source: 'platform_default' }
      : { name: '', userId: '', source: 'missing' };
  }

  // 项目群审批：反查 groupRegistry 找所属群
  var groupCode = null;
  Object.keys(groupRegistry).forEach(function (gCode) {
    var g = groupRegistry[gCode] || {};
    if ((g.sectors || []).indexOf(code) >= 0) groupCode = gCode;
  });
  var groupReviewer;
  if (groupCode) {
    var grCfg = groupReviewers[groupCode] || {};
    if (grCfg.reviewerName || grCfg.reviewerUserId) {
      groupReviewer = { name: grCfg.reviewerName || '', userId: grCfg.reviewerUserId || '', source: 'configured', groupCode: groupCode };
    } else {
      var platformLeader = users.find(function (u) { return u.role === 'group_leader'; });
      groupReviewer = platformLeader
        ? { name: platformLeader.name || '', userId: platformLeader.id || '', source: 'platform_default', groupCode: groupCode }
        : { name: '', userId: '', source: 'missing', groupCode: groupCode };
    }
  } else {
    groupReviewer = { name: '', userId: '', source: 'missing', groupCode: null };
  }

  return { sectorAdmin: sectorAdmin, sectorReviewer: sectorReviewer, groupReviewer: groupReviewer };
}

/**
 * 发起前预览：列出所有板块的审批人员和将创建/已存在状态
 */
function getForkPreview() {
  var db = dbm.getDb();
  var reportingMonth = dbm.getMeta(db, 'reportingMonth') || dbm.DEFAULT_PERIOD_CONFIG.reportingMonth;
  var latestJVersion = dbm.getMeta(db, 'latestJVersion', null);
  var sectorNames = sw.getSectorNames(dbm.getMeta, db);

  // 检查 baseline 可用性
  var baselineAvailable = false;
  if (latestJVersion) {
    var snapRow = db.prepare('SELECT version FROM snapshots WHERE version = ?').get(latestJVersion);
    baselineAvailable = !!snapRow;
  }

  var registry = dbm.getMeta(db, 'sectorRegistry', null);
  var sectors = (Array.isArray(registry) && registry.length)
    ? registry.filter(function (c) { return !String(c).startsWith('_'); })
    : sw.DEFAULT_SECTOR_REGISTRY.slice();

  // 从当前 projects 表统计各板块项目和 PM 数（预览用）
  var allProjects = loadProjectsFromDb(db);

  var willCreate = 0;
  var alreadyExists = 0;
  var missingStaff = 0;

  var sectorRows = sectors.map(function (code) {
    var normalCode = sw.normalizeSectorCode(code);
    var ref = sectorProjectsAndPms(allProjects, normalCode);
    var existingRow = db.prepare(
      'SELECT id FROM report_lines WHERE sector_code = ? AND period = ?'
    ).get(normalCode, reportingMonth);
    var staff = resolveApprovalStaffForSector(db, normalCode);

    if (existingRow) {
      alreadyExists++;
    } else {
      willCreate++;
    }
    if (staff.sectorAdmin.source === 'missing' ||
        staff.sectorReviewer.source === 'missing' ||
        staff.groupReviewer.source === 'missing') {
      missingStaff++;
    }

    return {
      sector_code: normalCode,
      sector_name: sectorNames[normalCode] || normalCode,
      project_count: ref.projects.length,
      pm_count: ref.pmNames.length,
      existing_report_line_id: existingRow ? existingRow.id : null,
      staff: staff
    };
  });

  return {
    period: reportingMonth,
    baselineVersion: latestJVersion || null,
    baselineAvailable: baselineAvailable,
    sectors: sectorRows,
    summary: {
      will_create: willCreate,
      already_exists: alreadyExists,
      missing_staff: missingStaff
    }
  };
}

function forkPeriod(period, options) {
  options = options || {};
  var db = dbm.getDb();
  var registry = dbm.getMeta(db, 'sectorRegistry', null);
  var sectors = Array.isArray(registry) && registry.length
    ? registry.slice()
    : sw.DEFAULT_SECTOR_REGISTRY.slice();

  var latestJVersion = dbm.getMeta(db, 'latestJVersion', null);

  // 必须有 J 版 baseline
  if (!latestJVersion) {
    fail(400, '尚无 J 版快照，请先完成归档再发起填报');
  }
  var snapRow = db.prepare('SELECT payload FROM snapshots WHERE version = ?').get(latestJVersion);
  if (!snapRow) {
    fail(400, 'J 版快照（' + latestJVersion + '）数据不存在，请联系管理员');
  }
  var snapProjects;
  try {
    var snapPayload = JSON.parse(snapRow.payload);
    snapProjects = snapPayload.projects || [];
  } catch (e) {
    fail(500, 'J 版快照解析失败：' + e.message);
  }

  var insertLine = db.prepare(
    'INSERT INTO report_lines (sector_code, period, status, baseline_version) VALUES (?, ?, ?, ?)'
  );
  var insertPmStatus = db.prepare(
    'INSERT INTO report_line_pm_status (report_line_id, pm_name, status) VALUES (?, ?, ?)'
  );
  var insertData = db.prepare(
    'INSERT INTO report_line_data (report_line_id, project_no, field_data) VALUES (?, ?, ?)'
  );

  var created = [];
  var skipped = [];

  var tx = db.transaction(function () {
    sectors.forEach(function (sectorCode) {
      if (String(sectorCode).startsWith('_')) return;
      var normalCode = sw.normalizeSectorCode(sectorCode);
      var existing = db.prepare(
        'SELECT id FROM report_lines WHERE sector_code = ? AND period = ?'
      ).get(normalCode, period);
      if (existing) {
        skipped.push({ sector_code: normalCode, id: existing.id });
        return;
      }

      var info = insertLine.run(normalCode, period, 'open', latestJVersion);
      var lineId = Number(info.lastInsertRowid);

      // 从 J 版快照中取该板块项目数据（作为 baseline 一致的初始数据）
      var snapRef = sectorProjectsAndPms(snapProjects, normalCode);
      snapRef.pmNames.forEach(function (pmName) {
        insertPmStatus.run(lineId, pmName, 'open');
      });
      snapRef.projects.forEach(function (p) {
        insertData.run(lineId, p.project_no, JSON.stringify(p));
      });

      created.push({
        id: lineId,
        sector_code: normalCode,
        period: period,
        projects_count: snapRef.projects.length,
        pm_count: snapRef.pmNames.length
      });
    });
  });
  tx();

  // 写审计日志
  var userName = (options.userName) || '系统管理员';
  dbm.pushAudit(db, {
    id: Date.now() + '_fork_' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    operation_type: 'report_line_fork',
    projectNo: '—',
    projectName: '填报管理',
    fieldName: 'report_line_fork',
    fieldCN: '手动发起填报',
    oldVal: '—',
    newVal: '周期 ' + period + '，baseline ' + latestJVersion
      + '，新建 ' + created.length + ' 条，跳过 ' + skipped.length + ' 条',
    userId: 'system_admin',
    userName: userName
  });

  return { created: created, skipped: skipped, baselineVersion: latestJVersion, period: period };
}

// ---------------------------------------------------------------------------
// 2. getReportLines — 按权限过滤查询列表
// ---------------------------------------------------------------------------

function getReportLines(user, filters) {
  var db = dbm.getDb();
  filters = filters || {};

  var sql = 'SELECT rl.*, '
    + '(SELECT COUNT(*) FROM report_line_data rld WHERE rld.report_line_id = rl.id) AS projects_count '
    + 'FROM report_lines rl WHERE 1=1';
  var params = [];

  // 权限过滤
  if (user) {
    var role = user.role;
    if (role === 'pm' || role === 'sector_admin' || role === 'sector_director') {
      sql += ' AND rl.sector_code = ?';
      params.push(sw.normalizeSectorCode(user.sector || user.sectorCode));
    } else if (role === 'group_leader') {
      // 从 groupRegistry 获取该群主所辖板块
      var groupRegistry = dbm.getMeta(db, 'groupRegistry', dbm.DEFAULT_GROUP_REGISTRY);
      var groupCode = user.groupCode || user.group;
      var group = groupRegistry[groupCode] || groupRegistry['GRP_JS'];
      var leaderSectors = (group && group.sectors) || [];
      if (leaderSectors.length) {
        var placeholders = leaderSectors.map(function () { return '?'; }).join(',');
        sql += ' AND rl.sector_code IN (' + placeholders + ')';
        leaderSectors.forEach(function (s) { params.push(sw.normalizeSectorCode(s)); });
      } else {
        // 无板块则返回空
        sql += ' AND 1=0';
      }
    }
    // system_admin / executive_viewer: 无过滤
  }

  // 附加过滤条件
  if (filters.status) {
    sql += ' AND rl.status = ?';
    params.push(filters.status);
  }
  if (filters.sector) {
    sql += ' AND rl.sector_code = ?';
    params.push(sw.normalizeSectorCode(filters.sector));
  }
  if (filters.period) {
    sql += ' AND rl.period = ?';
    params.push(filters.period);
  }

  sql += ' ORDER BY rl.created_at DESC';

  var stmt = db.prepare(sql);
  var rows = params.length ? stmt.all.apply(stmt, params) : stmt.all();

  return rows.map(function (r) {
    return {
      id: r.id,
      sector_code: r.sector_code,
      period: r.period,
      status: r.status,
      approval_node: r.approval_node,
      baseline_version: r.baseline_version,
      updated_at: r.updated_at,
      projects_count: r.projects_count
    };
  });
}

// ---------------------------------------------------------------------------
// 3. getReportLineDetail — 获取详情
// ---------------------------------------------------------------------------

function getReportLineDetail(id) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  var dataRows = db.prepare(
    'SELECT * FROM report_line_data WHERE report_line_id = ? ORDER BY project_no ASC'
  ).all(id);

  var pmRows = db.prepare(
    'SELECT * FROM report_line_pm_status WHERE report_line_id = ? ORDER BY pm_name ASC'
  ).all(id);

  var approvalRows = db.prepare(
    'SELECT * FROM report_line_approvals WHERE report_line_id = ? ORDER BY created_at ASC'
  ).all(id);

  var projects = dataRows.map(function (r) {
    var fd = null;
    try { fd = JSON.parse(r.field_data); } catch (e) { /* ignore */ }
    var cd = null;
    try { cd = JSON.parse(r.change_diff); } catch (e) { /* ignore */ }
    return {
      id: r.id,
      project_no: r.project_no,
      field_data: fd,
      change_diff: cd,
      updated_by: r.updated_by,
      updated_at: r.updated_at
    };
  });

  var pmStatuses = pmRows.map(function (r) {
    return {
      id: r.id,
      pm_name: r.pm_name,
      status: r.status,
      submitted_at: r.submitted_at
    };
  });

  var approvals = approvalRows.map(function (r) {
    return {
      id: r.id,
      action: r.action,
      actor_role: r.actor_role,
      actor_name: r.actor_name,
      comment: r.comment,
      from_status: r.from_status,
      to_status: r.to_status,
      created_at: r.created_at
    };
  });

  return {
    id: line.id,
    sector_code: line.sector_code,
    period: line.period,
    status: line.status,
    approval_node: line.approval_node,
    baseline_version: line.baseline_version,
    created_at: line.created_at,
    updated_at: line.updated_at,
    projects: projects,
    pmStatuses: pmStatuses,
    approvals: approvals
  };
}

// ---------------------------------------------------------------------------
// 4. saveData — 保存填报数据
// ---------------------------------------------------------------------------

function saveData(id, projectNo, fieldData, userName) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  // 计算 change_diff：对比 baseline 中该项目的字段数据
  var changeDiff = computeChangeDiff(db, line, projectNo, fieldData);

  var fieldDataJson = JSON.stringify(fieldData);
  var changeDiffJson = changeDiff ? JSON.stringify(changeDiff) : null;

  db.prepare(
    'INSERT INTO report_line_data (report_line_id, project_no, field_data, change_diff, updated_by, updated_at) '
    + 'VALUES (?, ?, ?, ?, ?, datetime(\'now\',\'localtime\')) '
    + 'ON CONFLICT(report_line_id, project_no) DO UPDATE SET '
    + 'field_data = excluded.field_data, '
    + 'change_diff = excluded.change_diff, '
    + 'updated_by = excluded.updated_by, '
    + 'updated_at = excluded.updated_at'
  ).run(id, projectNo, fieldDataJson, changeDiffJson, userName);

  // 更新 report_lines.updated_at
  db.prepare(
    'UPDATE report_lines SET updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
  ).run(id);

  return { project_no: projectNo, change_diff: changeDiff };
}

/**
 * 对比 baseline 中该项目的字段数据，返回差异列表
 * @returns {Array<{field_key: string, old_value: *, new_value: *}>|null}
 */
function computeChangeDiff(db, line, projectNo, newFieldData) {
  if (!line.baseline_version) return null;

  var snapRow = db.prepare('SELECT payload FROM snapshots WHERE version = ?').get(line.baseline_version);
  if (!snapRow) return null;

  var snap;
  try { snap = JSON.parse(snapRow.payload); } catch (e) { return null; }

  var baselineProject = (snap.projects || []).find(function (p) { return p.project_no === projectNo; });
  if (!baselineProject) {
    // baseline 中没有该项目 → 整条为新增
    return Object.keys(newFieldData || {}).map(function (key) {
      return { field_key: key, old_value: null, new_value: newFieldData[key] };
    });
  }

  var diffs = [];
  var newKeys = Object.keys(newFieldData || {});
  newKeys.forEach(function (key) {
    var oldVal = baselineProject[key];
    var newVal = newFieldData[key];
    // 忽略内部元数据字段
    if (key.charAt(0) === '_') return;
    // 比较值
    if (!valuesEqual(oldVal, newVal)) {
      diffs.push({ field_key: key, old_value: oldVal, new_value: newVal });
    }
  });

  return diffs.length ? diffs : null;
}

function valuesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
  return String(a) === String(b);
}

/**
 * 检查指定用户名是否拥有指定角色（可选拆分板块检查）
 * @param {string} userName
 * @param {string} role - 如 'group_leader', 'sector_director'
 * @param {string|null} sectorCode - 若非 null 则同时检查板块归属
 * @returns {boolean}
 */
function _userHasRoleAndSector(userName, role, sectorCode) {
  var db = dbm.getDb();
  var users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS) || [];
  var user = users.find(function (u) { return u.name === userName; });
  if (!user) return false;
  var hasRole = user.role === role
    || (Array.isArray(user.roles) && user.roles.indexOf(role) !== -1);
  if (!hasRole) return false;
  if (sectorCode) {
    return sw.normalizeSectorCode(user.sector || user.sectorCode) === sw.normalizeSectorCode(sectorCode);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 5. pmSubmit — PM提交
// ---------------------------------------------------------------------------

function pmSubmit(id, pmName) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  if (line.status !== 'open' && line.status !== 'rejected') {
    fail(400, '当前报告线状态为 ' + line.status + '，PM 无法提交（仅 open/rejected 可提交）');
  }

  // 更新 pm_status
  var pmRow = db.prepare(
    'SELECT * FROM report_line_pm_status WHERE report_line_id = ? AND pm_name = ?'
  ).get(id, pmName);
  if (!pmRow) {
    fail(404, 'PM「' + pmName + '」不在该报告线中');
  }
  if (pmRow.status !== 'open' && pmRow.status !== 'rejected') {
    fail(400, 'PM 当前状态为 ' + pmRow.status + '，无法提交');
  }

  var now = nowLocal();
  var fromPmStatus = pmRow.status;

  db.prepare(
    'UPDATE report_line_pm_status SET status = ?, submitted_at = ? WHERE id = ?'
  ).run('submitted', now, pmRow.id);

  // 写入审批记录
  db.prepare(
    'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'submit', 'pm', pmName, 'PM提交填报', fromPmStatus, 'submitted');

  // 更新 report_lines.updated_at
  db.prepare(
    'UPDATE report_lines SET updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
  ).run(id);

  return { pm_name: pmName, status: 'submitted', submitted_at: now };
}

// ---------------------------------------------------------------------------
// 6. submitApproval — 板块管理员提交审批
// ---------------------------------------------------------------------------

function submitApproval(id, sectorAdminName) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  if (line.status !== 'open') {
    fail(400, '当前报告线状态为 ' + line.status + '，仅 open 状态可提交审批');
  }

  var fromStatus = line.status;
  var toStatus = 'reviewing_director';
  var approvalNode = 'director';

  // 检查是否需要跳过 director 节点
  var skipDirector = shouldSkipNode(line.sector_code, sectorAdminName);
  if (skipDirector) {
    toStatus = 'reviewing_leader';
    approvalNode = 'leader';
  }

  var tx = db.transaction(function () {
    // 自动关闭未提交PM
    db.prepare(
      'UPDATE report_line_pm_status SET status = ? '
      + 'WHERE report_line_id = ? AND status = ?'
    ).run('closed', id, 'open');

    // 更新报告线状态
    db.prepare(
      'UPDATE report_lines SET status = ?, approval_node = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ).run(toStatus, approvalNode, id);

    // 写入审批记录
    db.prepare(
      'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'submit', 'sector_admin', sectorAdminName,
      skipDirector ? '板块管理员提交审批（自动跳过总监节点）' : '板块管理员提交审批',
      fromStatus, toStatus);

    if (skipDirector) {
      // 记录跳过动作
      db.prepare(
        'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'auto_skip', 'sector_director', sectorAdminName,
        '提交人兼任总监，自动跳过总监审批', 'reviewing_director', 'reviewing_leader');
    }
  });
  tx();

  return { id: id, status: toStatus, approval_node: approvalNode, skip_director: skipDirector };
}

// ---------------------------------------------------------------------------
// 7. reviewApproval — 审批
// ---------------------------------------------------------------------------

function reviewApproval(id, action, reviewerRole, reviewerName, comment) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  var fromStatus = line.status;
  var toStatus;
  var approvalNode = line.approval_node;

  if (action === 'approve') {
    if (fromStatus === 'reviewing_director') {
      toStatus = 'reviewing_leader';
      approvalNode = 'leader';
      // 检查当前审批人(总监)是否同时兼任群主 → 跳过 leader 节点
      var reviewerIsLeader = _userHasRoleAndSector(reviewerName, 'group_leader', null);
      if (reviewerIsLeader) {
        toStatus = 'completed';
        approvalNode = null;
      }
    } else if (fromStatus === 'reviewing_leader') {
      toStatus = 'completed';
      approvalNode = null;
    } else {
      fail(400, '当前状态 ' + fromStatus + ' 不可执行审批通过操作');
    }
  } else if (action === 'reject') {
    if (fromStatus === 'reviewing_director' || fromStatus === 'reviewing_leader') {
      toStatus = 'open';
      approvalNode = null;
    } else {
      fail(400, '当前状态 ' + fromStatus + ' 不可执行退回操作');
    }
  } else {
    fail(400, '无效的审批动作: ' + action);
  }

  var tx = db.transaction(function () {
    // 更新报告线状态
    db.prepare(
      'UPDATE report_lines SET status = ?, approval_node = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ).run(toStatus, approvalNode, id);

    // 写入审批记录
    db.prepare(
      'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, action, reviewerRole, reviewerName, comment || '', fromStatus, toStatus);

    // 退回时重置所有 PM 状态为 open
    if (action === 'reject') {
      db.prepare(
        'UPDATE report_line_pm_status SET status = ?, submitted_at = NULL '
        + 'WHERE report_line_id = ? AND status IN (?, ?)'
      ).run('open', id, 'submitted', 'closed');
    }

    // approve 时如果总监兼任群主，跳过了 leader，追加 auto_skip 记录
    if (action === 'approve' && fromStatus === 'reviewing_director'
        && toStatus === 'completed') {
      db.prepare(
        'INSERT INTO report_line_approvals (report_line_id, action, actor_role, actor_name, comment, from_status, to_status) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'auto_skip', 'group_leader', reviewerName,
        '审批人兼任群主，自动跳过群主审批', 'reviewing_leader', 'completed');
    }
  });
  tx();

  return { id: id, status: toStatus, approval_node: approvalNode };
}

// ---------------------------------------------------------------------------
// 8. shouldSkipNode — 审批自动跳过
// ---------------------------------------------------------------------------

function shouldSkipNode(sectorCode, submitterName) {
  var db = dbm.getDb();
  var users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS) || [];

  // 检查 submitter 是否同时是 director → 跳过 director 节点
  var normSector = sw.normalizeSectorCode(sectorCode);

  var submitter = users.find(function (u) {
    return u.name === submitterName;
  });

  if (!submitter) return false;

  // 板块管理员兼任总监 → 跳过 director
  var isDirector = submitter.role === 'sector_director'
    || (Array.isArray(submitter.roles) && submitter.roles.indexOf('sector_director') !== -1);
  var sameSector = sw.normalizeSectorCode(submitter.sector || submitter.sectorCode) === normSector;
  if (isDirector && sameSector) return true;

  // 提交人兼任群主 → 跳过 leader
  var isGroupLeader = submitter.role === 'group_leader'
    || (Array.isArray(submitter.roles) && submitter.roles.indexOf('group_leader') !== -1);
  if (isGroupLeader) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 9. getDiff — 计算字段级 diff
// ---------------------------------------------------------------------------

function getDiff(id) {
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  if (!line.baseline_version) {
    return [];
  }

  // 获取 baseline 数据
  var snapRow = db.prepare('SELECT payload FROM snapshots WHERE version = ?').get(line.baseline_version);
  if (!snapRow) return [];

  var snap;
  try { snap = JSON.parse(snapRow.payload); } catch (e) { return []; }

  var baselineProjects = snap.projects || [];
  var baselineMap = {};
  baselineProjects.forEach(function (p) {
    baselineMap[p.project_no] = p;
  });

  // 获取当前报告线数据
  var dataRows = db.prepare(
    'SELECT * FROM report_line_data WHERE report_line_id = ? ORDER BY project_no ASC'
  ).all(id);

  var diffs = [];

  dataRows.forEach(function (r) {
    var newFieldData = null;
    try { newFieldData = JSON.parse(r.field_data); } catch (e) { return; }

    var baselineProject = baselineMap[r.project_no];

    if (!baselineProject) {
      // baseline 中没有该项目 → 全部字段视为新增
      Object.keys(newFieldData || {}).forEach(function (key) {
        if (key.charAt(0) === '_') return;
        diffs.push({
          project_no: r.project_no,
          field_key: key,
          old_value: null,
          new_value: newFieldData[key]
        });
      });
      return;
    }

    // 逐字段对比
    Object.keys(newFieldData || {}).forEach(function (key) {
      if (key.charAt(0) === '_') return;
      var oldVal = baselineProject[key];
      var newVal = newFieldData[key];
      if (!valuesEqual(oldVal, newVal)) {
        diffs.push({
          project_no: r.project_no,
          field_key: key,
          old_value: oldVal,
          new_value: newVal
        });
      }
    });
  });

  // 检查 baseline 中存在但报告线数据中不存在的项目（被删除的项目）
  var dataProjectNos = new Set(dataRows.map(function (r) { return r.project_no; }));
  baselineProjects.forEach(function (p) {
    if (!dataProjectNos.has(p.project_no)) {
      Object.keys(p).forEach(function (key) {
        if (key.charAt(0) === '_') return;
        diffs.push({
          project_no: p.project_no,
          field_key: key,
          old_value: p[key],
          new_value: null
        });
      });
    }
  });

  return diffs;
}

// ---------------------------------------------------------------------------
// 10. exportReportLine — 导出 Excel
// ---------------------------------------------------------------------------

function exportReportLine(id, options) {
  options = options || {};
  var db = dbm.getDb();

  var line = db.prepare('SELECT * FROM report_lines WHERE id = ?').get(id);
  if (!line) fail(404, '报告线不存在 (id=' + id + ')');

  var dataRows = db.prepare(
    'SELECT * FROM report_line_data WHERE report_line_id = ? ORDER BY project_no ASC'
  ).all(id);

  var projects = dataRows.map(function (r) {
    try { return JSON.parse(r.field_data); } catch (e) { return { project_no: r.project_no }; }
  });

  if (options.role === 'pm') {
    var pmName = options.pmName || '';
    projects = projects.filter(function (p) { return p.pm_name === pmName; });
  }

  if (!projects.length) {
    fail(400, '报告线无项目数据可导出');
  }

  // 构建导出数据：以项目对象的所有 key 为列
  var allKeys = [];
  var keySet = new Set();
  projects.forEach(function (p) {
    Object.keys(p).forEach(function (k) {
      if (!keySet.has(k)) {
        keySet.add(k);
        allKeys.push(k);
      }
    });
  });

  var header = allKeys.slice();
  var rows = [header];
  projects.forEach(function (p) {
    var row = allKeys.map(function (k) {
      var v = p[k];
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    rows.push(row);
  });

  var sheetName = line.sector_code + '_' + line.period;
  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // 返回 buffer
  var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return {
    buffer: buf,
    filename: '报告线_' + line.sector_code + '_' + line.period + '.xlsx',
    projectCount: projects.length
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  forkPeriod: forkPeriod,
  getForkPreview: getForkPreview,
  resolveApprovalStaffForSector: resolveApprovalStaffForSector,
  getReportLines: getReportLines,
  getReportLineDetail: getReportLineDetail,
  saveData: saveData,
  pmSubmit: pmSubmit,
  submitApproval: submitApproval,
  reviewApproval: reviewApproval,
  shouldSkipNode: shouldSkipNode,
  getDiff: getDiff,
  exportReportLine: exportReportLine
};
