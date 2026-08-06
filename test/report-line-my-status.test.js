'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMyStatus,
  resolvePmMyStatus,
  resolveSectorAdminMyStatus,
  resolveDirectorMyStatus,
  resolveLeaderMyStatus
} = require('../server/report-line-my-status');

test('PM：open/rejected/无记录 → 待提交；submitted → 已提交；closed → 已关闭', () => {
  assert.equal(resolvePmMyStatus(null).label, '待提交');
  assert.equal(resolvePmMyStatus({ status: 'open' }).label, '待提交');
  assert.equal(resolvePmMyStatus({ status: 'rejected' }).label, '待提交');
  assert.equal(resolvePmMyStatus({ status: 'submitted' }).label, '已提交');
  assert.equal(resolvePmMyStatus({ status: 'closed' }).label, '已关闭');
  assert.equal(resolvePmMyStatus({ status: 'submitted' }).type, 'success');
});

test('板块管理员：待提交审批 / 已提交审批 / 核对归档中 / 已完成 / 已关闭', () => {
  assert.equal(resolveSectorAdminMyStatus('open').label, '待提交审批');
  assert.equal(resolveSectorAdminMyStatus('returned').label, '待提交审批');
  assert.equal(resolveSectorAdminMyStatus('rejected').label, '待提交审批');
  assert.equal(resolveSectorAdminMyStatus('reviewing_director').label, '已提交审批');
  assert.equal(resolveSectorAdminMyStatus('reviewing_leader').label, '已提交审批');
  assert.equal(resolveSectorAdminMyStatus('submitted').label, '已提交审批');
  assert.equal(resolveSectorAdminMyStatus('finalizing').label, '核对归档中');
  assert.equal(resolveSectorAdminMyStatus('finalizing').type, 'warning');
  assert.equal(resolveSectorAdminMyStatus('completed').label, '已完成');
  assert.equal(resolveSectorAdminMyStatus('closed').label, '已关闭');
});

test('板块总监四态：等待中 / 待我审批 / 已审批 / 已关闭', () => {
  assert.equal(resolveDirectorMyStatus('open').label, '等待中');
  assert.equal(resolveDirectorMyStatus('submitted').label, '等待中');
  assert.equal(resolveDirectorMyStatus('returned').label, '等待中');
  assert.equal(resolveDirectorMyStatus('reviewing_director').label, '待我审批');
  assert.equal(resolveDirectorMyStatus('reviewing_leader').label, '已审批');
  assert.equal(resolveDirectorMyStatus('finalizing').label, '已审批');
  assert.equal(resolveDirectorMyStatus('completed').label, '已审批');
  assert.equal(resolveDirectorMyStatus('closed').label, '已关闭');
});

test('项目群群主四态：等待中 / 待我审批 / 已审批 / 已关闭', () => {
  assert.equal(resolveLeaderMyStatus('open').label, '等待中');
  assert.equal(resolveLeaderMyStatus('reviewing_director').label, '等待中');
  assert.equal(resolveLeaderMyStatus('reviewing_leader').label, '待我审批');
  assert.equal(resolveLeaderMyStatus('finalizing').label, '已审批');
  assert.equal(resolveLeaderMyStatus('completed').label, '已审批');
  assert.equal(resolveLeaderMyStatus('closed').label, '已关闭');
});

test('resolveMyStatus 按角色分发；系统管理员固定 —', () => {
  var lineOpen = { status: 'open' };
  assert.equal(
    resolveMyStatus({ role: 'pm' }, lineOpen, { status: 'submitted' }).label,
    '已提交'
  );
  assert.equal(
    resolveMyStatus({ role: 'sector_admin' }, { status: 'reviewing_director' }, null).label,
    '已提交审批'
  );
  assert.equal(
    resolveMyStatus({ role: 'sector_director' }, { status: 'reviewing_director' }, null).label,
    '待我审批'
  );
  assert.equal(
    resolveMyStatus({ role: 'group_leader' }, { status: 'reviewing_leader' }, null).label,
    '待我审批'
  );
  assert.equal(
    resolveMyStatus({ role: 'system_admin' }, lineOpen, null).label,
    '—'
  );
  assert.equal(resolveMyStatus(null, lineOpen, null).label, '—');
});
