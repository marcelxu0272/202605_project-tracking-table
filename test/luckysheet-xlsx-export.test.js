'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  lsCellToXlsx,
  buildVisibleColMap,
  isMergeSlaveCell
} = require('../js/luckysheet-xlsx-export.js');

describe('luckysheet-xlsx-export', function () {
  it('lsCellToXlsx maps amount formula cell with format and style', function () {
    const out = lsCellToXlsx({
      f: '=P5-N5',
      v: 1234.5,
      m: '1234.5',
      ct: { fa: '#,##0.00', t: 'n' },
      bg: '#f8fafc',
      ht: '2',
      bl: 1
    });
    assert.equal(out.f, 'P5-N5');
    assert.equal(out.t, 'n');
    assert.equal(out.v, 1234.5);
    assert.equal(out.z, '#,##0.00');
    assert.equal(out.s.fill.fgColor.rgb, 'FFF8FAFC');
    assert.equal(out.s.font.bold, true);
    assert.equal(out.s.alignment.horizontal, 'right');
  });

  it('lsCellToXlsx maps date serial', function () {
    const out = lsCellToXlsx({
      v: 45474,
      m: '2024-07-01',
      ct: { fa: 'yyyy-MM-dd', t: 'd' }
    });
    assert.equal(out.t, 'n');
    assert.equal(out.v, 45474);
    assert.equal(out.z, 'yyyy-MM-dd');
  });

  it('lsCellToXlsx skips merge slave placeholder', function () {
    assert.equal(isMergeSlaveCell({ mc: { r: 2, c: 0 } }), true);
    assert.equal(lsCellToXlsx({ mc: { r: 2, c: 0 } }), null);
  });

  it('buildVisibleColMap skips hidden columns (Luckysheet colhidden value 0)', function () {
    const map = buildVisibleColMap(0, 4, { 1: 0, 3: 0 });
    assert.deepEqual(map.map, { 0: 0, 2: 1, 4: 2 });
    assert.equal(map.count, 3);
  });
});
