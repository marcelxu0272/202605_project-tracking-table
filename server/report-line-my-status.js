'use strict';

/**
 * 填报管理列表「我的状态」按角色映射。
 * 返回 { code, label, type }，供列表 Tag 直接使用。
 */

function tag(code, label, type) {
  return { code: code, label: label, type: type };
}

function resolvePmMyStatus(pmStatusRow) {
  var status = pmStatusRow && pmStatusRow.status;
  if (status === 'submitted') return tag('pm_submitted', '已提交', 'success');
  if (status === 'closed') return tag('pm_closed', '已关闭', 'info');
  // open / rejected / 无记录 / received 等均视为待提交
  return tag('pm_pending', '待提交', 'warning');
}

function resolveSectorAdminMyStatus(lineStatus) {
  switch (lineStatus) {
    case 'reviewing_director':
    case 'reviewing_leader':
    case 'submitted':
      return tag('admin_submitted', '已提交审批', 'success');
    case 'completed':
      return tag('admin_completed', '已完成', 'success');
    case 'closed':
      return tag('admin_closed', '已关闭', 'info');
    case 'open':
    case 'returned':
    case 'rejected':
    default:
      return tag('admin_pending', '待提交审批', 'warning');
  }
}

function resolveDirectorMyStatus(lineStatus) {
  switch (lineStatus) {
    case 'reviewing_director':
      return tag('director_pending_review', '待我审批', 'warning');
    case 'reviewing_leader':
    case 'completed':
      return tag('director_reviewed', '已审批', 'success');
    case 'closed':
      return tag('director_closed', '已关闭', 'info');
    default:
      // open / returned / rejected / submitted
      return tag('director_waiting', '等待中', 'warning');
  }
}

function resolveLeaderMyStatus(lineStatus) {
  switch (lineStatus) {
    case 'reviewing_leader':
      return tag('leader_pending_review', '待我审批', 'warning');
    case 'completed':
      return tag('leader_reviewed', '已审批', 'success');
    case 'closed':
      return tag('leader_closed', '已关闭', 'info');
    default:
      // open / returned / rejected / submitted / reviewing_director
      return tag('leader_waiting', '等待中', 'warning');
  }
}

/**
 * @param {object|null} user
 * @param {object} line 至少含 status
 * @param {object|null} pmStatusRow PM 角色时传入本人 pm_status 行
 */
function resolveMyStatus(user, line, pmStatusRow) {
  var role = (user && user.role) || '';
  var lineStatus = (line && line.status) || '';

  if (role === 'pm') {
    return resolvePmMyStatus(pmStatusRow);
  }
  if (role === 'sector_admin') {
    return resolveSectorAdminMyStatus(lineStatus);
  }
  if (role === 'sector_director') {
    return resolveDirectorMyStatus(lineStatus);
  }
  if (role === 'group_leader') {
    return resolveLeaderMyStatus(lineStatus);
  }
  return tag('na', '—', 'info');
}

module.exports = {
  resolveMyStatus: resolveMyStatus,
  resolvePmMyStatus: resolvePmMyStatus,
  resolveSectorAdminMyStatus: resolveSectorAdminMyStatus,
  resolveDirectorMyStatus: resolveDirectorMyStatus,
  resolveLeaderMyStatus: resolveLeaderMyStatus
};
