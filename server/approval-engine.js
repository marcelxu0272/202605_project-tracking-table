'use strict';

/**
 * approval-engine.js — 报告线审批状态机引擎
 *
 * 职责：
 * 1. 定义和校验状态转移规则
 * 2. 封装审批链计算（考虑自动跳过）
 * 3. 提供状态转移的合法性验证
 *
 * 依赖：db.js (getMeta, DEFAULT_USERS, DEFAULT_GROUP_REGISTRY)
 *       sector-workflow.js (normalizeSectorCode)
 */

const dbm = require('./db');
const sw = require('./sector-workflow');

// ---------------------------------------------------------------------------
// 状态转移定义
// ---------------------------------------------------------------------------

const STATUS_TRANSITIONS = {
  open: {
    submit_approval: 'reviewing_director',   // 板块管理员提交
  },
  reviewing_director: {
    approve: 'reviewing_leader',             // 板块领导通过
    reject: 'open',                          // 板块领导退回
  },
  reviewing_leader: {
    approve: 'completed',                    // 群主通过
    reject: 'open',                          // 群主退回
  },
  rejected: {
    submit_approval: 'reviewing_director',   // 重新提交
  },
  completed: {},                             // 终态，无后续转移
  closed: {},                                // 终态
};

// ---------------------------------------------------------------------------
// 操作权限定义
// ---------------------------------------------------------------------------

const ACTION_PERMISSIONS = {
  submit_approval: { roles: ['sector_admin'], requiredStatus: ['open', 'rejected'] },
  approve: {
    reviewing_director: { roles: ['sector_director'] },
    reviewing_leader: { roles: ['group_leader'] },
  },
  reject: {
    reviewing_director: { roles: ['sector_director'] },
    reviewing_leader: { roles: ['group_leader'] },
  },
};

// ---------------------------------------------------------------------------
// 状态标签与颜色
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  open: '开放填报',
  reviewing_director: '审批中(板块领导)',
  reviewing_leader: '审批中(群主)',
  completed: '已完成',
  rejected: '已退回',
  closed: '已关闭',
};

const STATUS_COLORS = {
  open: 'warning',
  reviewing_director: 'primary',
  reviewing_leader: 'primary',
  completed: 'success',
  rejected: 'danger',
  closed: 'info',
};

// ---------------------------------------------------------------------------
// 1. validateTransition — 验证状态转移合法性
// ---------------------------------------------------------------------------

/**
 * 验证从当前状态执行指定动作是否合法
 * @param {string} currentStatus - 当前状态
 * @param {string} action - 执行动作
 * @param {string} userRole - 用户角色
 * @returns {{ valid: boolean, targetStatus: string|null, error?: string }}
 */
function validateTransition(currentStatus, action, userRole) {
  // 检查当前状态是否存在
  if (!STATUS_TRANSITIONS.hasOwnProperty(currentStatus)) {
    return { valid: false, targetStatus: null, error: '未知状态: ' + currentStatus };
  }

  var transitions = STATUS_TRANSITIONS[currentStatus];

  // 检查当前状态是否允许该动作
  if (!transitions.hasOwnProperty(action)) {
    return { valid: false, targetStatus: null, error: '当前状态 ' + currentStatus + ' 不可执行动作 ' + action };
  }

  var targetStatus = transitions[action];

  // 检查用户角色权限
  var perm = ACTION_PERMISSIONS[action];
  if (!perm) {
    return { valid: false, targetStatus: null, error: '未定义权限的动作: ' + action };
  }

  // submit_approval：简单 roles + requiredStatus 检查
  if (perm.roles && perm.requiredStatus) {
    if (perm.roles.indexOf(userRole) === -1) {
      return { valid: false, targetStatus: null, error: '角色 ' + userRole + ' 无权执行 ' + action };
    }
    if (perm.requiredStatus.indexOf(currentStatus) === -1) {
      return { valid: false, targetStatus: null, error: '当前状态 ' + currentStatus + ' 不允许执行 ' + action };
    }
    return { valid: true, targetStatus: targetStatus };
  }

  // approve / reject：按当前状态查找允许的角色
  var statusPerm = perm[currentStatus];
  if (!statusPerm) {
    return { valid: false, targetStatus: null, error: '当前状态 ' + currentStatus + ' 不可执行动作 ' + action };
  }
  if (statusPerm.roles.indexOf(userRole) === -1) {
    return { valid: false, targetStatus: null, error: '角色 ' + userRole + ' 无权在 ' + currentStatus + ' 状态执行 ' + action };
  }

  return { valid: true, targetStatus: targetStatus };
}

// ---------------------------------------------------------------------------
// 2. computeApprovalChain — 计算审批链（考虑自动跳过）
// ---------------------------------------------------------------------------

/**
 * 计算指定板块、提交人的审批链，考虑自动跳过逻辑
 * @param {string} sectorCode - 板块代码
 * @param {string} submitterName - 提交人名称
 * @param {object} [db] - 可选数据库实例，不传则自动获取
 * @returns {{ skipDirector: boolean, skipLeader: boolean, targetStatus: string }}
 */
function computeApprovalChain(sectorCode, submitterName, db) {
  if (!db) db = dbm.getDb();

  var normSector = sw.normalizeSectorCode(sectorCode);
  var users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS) || [];

  // 查找提交人
  var submitter = users.find(function (u) { return u.name === submitterName; });

  var skipDirector = false;
  var skipLeader = false;

  if (submitter) {
    // 判断提交人是否兼任该板块的总监 → 跳过 director 节点
    var isDirector = submitter.role === 'sector_director'
      || (Array.isArray(submitter.roles) && submitter.roles.indexOf('sector_director') !== -1);
    var sameSector = sw.normalizeSectorCode(submitter.sector || submitter.sectorCode) === normSector;
    if (isDirector && sameSector) {
      skipDirector = true;
    }

    // 判断提交人是否兼任群主 → 跳过 leader 节点
    var isGroupLeader = submitter.role === 'group_leader'
      || (Array.isArray(submitter.roles) && submitter.roles.indexOf('group_leader') !== -1);
    if (isGroupLeader) {
      skipLeader = true;
    }
  }

  // 计算提交后的目标状态
  var targetStatus;
  if (skipDirector && skipLeader) {
    targetStatus = 'completed';
  } else if (skipDirector) {
    targetStatus = 'reviewing_leader';
  } else {
    targetStatus = 'reviewing_director';
  }

  return {
    skipDirector: skipDirector,
    skipLeader: skipLeader,
    targetStatus: targetStatus,
  };
}

// ---------------------------------------------------------------------------
// 3. getNextStatus — 获取下一状态（考虑跳过逻辑）
// ---------------------------------------------------------------------------

/**
 * 根据当前状态、动作和审批链计算实际的目标状态
 * @param {string} currentStatus - 当前状态
 * @param {string} action - 执行动作
 * @param {object} approvalChain - computeApprovalChain 的返回值
 * @returns {string} 实际目标状态
 */
function getNextStatus(currentStatus, action, approvalChain) {
  // 基础转移
  var transitions = STATUS_TRANSITIONS[currentStatus];
  if (!transitions || !transitions.hasOwnProperty(action)) {
    return currentStatus; // 无法转移，保持当前状态
  }

  var baseTarget = transitions[action];

  // 退回动作不受跳过逻辑影响
  if (action === 'reject') {
    return baseTarget;
  }

  // submit_approval：应用审批链的跳过逻辑
  if (action === 'submit_approval' && approvalChain) {
    return approvalChain.targetStatus;
  }

  // approve：在 reviewing_director 状态下，考虑跳过 leader
  if (action === 'approve' && currentStatus === 'reviewing_director' && approvalChain) {
    // 此时审批人（总监）可能兼任群主 → 需要判断是否跳过 leader
    // approvalChain 中 skipLeader 由 computeApprovalChain 在 submit 时计算
    // 但在 approve 阶段，审批人可能不同于提交人，需要重新评估
    // 这里约定：调用方应在 approve 时传入反映当前审批人身份的 approvalChain
    if (approvalChain.skipLeader) {
      return 'completed';
    }
  }

  return baseTarget;
}

// ---------------------------------------------------------------------------
// 4. canUserAct — 用户可执行的操作列表
// ---------------------------------------------------------------------------

/**
 * 判断指定用户可以对报告线执行哪些操作
 * @param {object} reportLine - 报告线对象，至少包含 { status, sector_code }
 * @param {string} userRole - 用户角色
 * @param {string} userName - 用户名称
 * @returns {string[]} 可执行的动作列表
 */
function canUserAct(reportLine, userRole, userName) {
  var status = reportLine.status;
  var actions = [];

  // 系统管理员可查看但不可审批，视业务需要可扩展
  if (userRole === 'system_admin') {
    return actions;
  }

  // 检查每个可能的动作
  var allActions = ['submit_approval', 'approve', 'reject'];

  allActions.forEach(function (action) {
    var result = validateTransition(status, action, userRole);
    if (!result.valid) return;

    // submit_approval 的额外校验：板块管理员只能提交自己板块的报告线
    if (action === 'submit_approval' && userRole === 'sector_admin') {
      if (reportLine.sector_code) {
        var db = dbm.getDb();
        var users = dbm.getMeta(db, 'users', dbm.DEFAULT_USERS) || [];
        var user = users.find(function (u) { return u.name === userName; });
        if (user) {
          var userSector = sw.normalizeSectorCode(user.sector || user.sectorCode);
          var lineSector = sw.normalizeSectorCode(reportLine.sector_code);
          if (userSector !== lineSector) return;
        }
      }
    }

    // approve / reject 的额外校验：
    // - sector_director 只能在 reviewing_director 状态操作
    // - group_leader 只能在 reviewing_leader 状态操作
    if (action === 'approve' || action === 'reject') {
      if (userRole === 'sector_director' && status !== 'reviewing_director') return;
      if (userRole === 'group_leader' && status !== 'reviewing_leader') return;
    }

    actions.push(action);
  });

  return actions;
}

// ---------------------------------------------------------------------------
// 5. getStatusLabel — 状态中文标签
// ---------------------------------------------------------------------------

/**
 * 获取状态的中文标签
 * @param {string} status - 状态值
 * @returns {string} 中文标签
 */
function getStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

// ---------------------------------------------------------------------------
// 6. getStatusColor — 状态颜色
// ---------------------------------------------------------------------------

/**
 * 获取状态的 Element UI 颜色标识
 * @param {string} status - 状态值
 * @returns {string} 颜色标识 (warning / primary / success / danger / info)
 */
function getStatusColor(status) {
  return STATUS_COLORS[status] || 'info';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  STATUS_TRANSITIONS: STATUS_TRANSITIONS,
  ACTION_PERMISSIONS: ACTION_PERMISSIONS,
  STATUS_LABELS: STATUS_LABELS,
  STATUS_COLORS: STATUS_COLORS,
  validateTransition: validateTransition,
  computeApprovalChain: computeApprovalChain,
  getNextStatus: getNextStatus,
  canUserAct: canUserAct,
  getStatusLabel: getStatusLabel,
  getStatusColor: getStatusColor,
};
