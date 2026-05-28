const test = require('node:test');
const assert = require('node:assert/strict');
const sw = require('../server/sector-workflow');

test('director approval skip is derived from selected sector admin platform user', () => {
  const users = [
    { id: 'u_sa', name: '运营总监 周明', role: 'sector_admin', sector: 'S520' },
    { id: 'u_sd', name: '板块总监 陈磊', role: 'sector_director', sector: 'S520' }
  ];

  assert.equal(sw.shouldSkipDirectorApproval({ adminUserId: 'u_sd' }, users, 'SAS520'), true);
  assert.equal(sw.shouldSkipDirectorApproval({ adminUserId: 'u_sa' }, users, 'SAS520'), false);
});

test('director approval skip supports platform users with multiple roles', () => {
  const users = [
    { id: 'u_both', name: '兼任用户', roles: ['sector_admin', 'sector_director'], sector: 'S520' }
  ];

  assert.equal(sw.shouldSkipDirectorApproval({ adminName: '兼任用户' }, users, 'SAS520'), true);
  assert.equal(sw.shouldSkipDirectorApproval({ adminName: '兼任用户' }, users, 'SAS560'), false);
});
