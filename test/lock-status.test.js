const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');

function withMockedDate(iso, fn) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(iso);
      return new RealDate(...args);
    }
    static now() {
      return new RealDate(iso).getTime();
    }
  }
  MockDate.UTC = RealDate.UTC;
  MockDate.parse = RealDate.parse;
  global.Date = MockDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

test('monthly lock stays locked after unlock day when automatic unlock is disabled', () => {
  withMockedDate('2026-06-09T09:00:00+08:00', () => {
    assert.equal(db._calcLockStatus({
      reportingMonth: '2026-05',
      lockDay: 25,
      unlockDay: 9,
      autoUnlockEnabled: false
    }), 'locked');
  });
});

test('monthly lock opens after unlock day when automatic unlock is enabled', () => {
  withMockedDate('2026-06-09T09:00:00+08:00', () => {
    assert.equal(db._calcLockStatus({
      reportingMonth: '2026-05',
      lockDay: 25,
      unlockDay: 9,
      autoUnlockEnabled: true
    }), 'open');
  });
});
