/**
 * luckysheet-xlsx-export.js — 将 Luckysheet 工作表数据导出为 Excel（保留公式、格式、合并、样式）
 * 依赖：xlsx-js-style（window.XLSX，需支持 cell.s 样式写入）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LuckysheetXlsxExport = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hexToArgb(hex) {
    if (!hex) return null;
    var h = String(hex).replace('#', '').trim();
    if (h.length === 3) {
      h = h.split('').map(function (ch) { return ch + ch; }).join('');
    }
    if (h.length !== 6) return null;
    return 'FF' + h.toUpperCase();
  }

  function luckysheetAlign(ht, vt) {
    var hMap = { '0': 'left', '1': 'center', '2': 'right' };
    var vMap = { '0': 'top', '1': 'middle', '2': 'bottom' };
    var align = {};
    if (ht != null && hMap[String(ht)]) align.horizontal = hMap[String(ht)];
    if (vt != null && vMap[String(vt)]) align.vertical = vMap[String(vt)];
    return Object.keys(align).length ? align : null;
  }

  function isMergeSlaveCell(lsCell) {
    if (!lsCell || typeof lsCell !== 'object') return false;
    if (!lsCell.mc) return false;
    return lsCell.v == null && lsCell.v !== 0 && !lsCell.f && (lsCell.m == null || lsCell.m === '');
  }

  /**
   * Luckysheet 单元格 → SheetJS 单元格（含 z/f/s）
   * @param {object|null} lsCell
   * @returns {object|null}
   */
  function lsCellToXlsx(lsCell) {
    if (!lsCell || typeof lsCell !== 'object') return null;
    if (isMergeSlaveCell(lsCell)) return null;

    var out = {};
    var ct = lsCell.ct || {};

    if (lsCell.f) {
      var f = String(lsCell.f);
      out.f = f.charAt(0) === '=' ? f.slice(1) : f;
    }

    if (ct.fa) out.z = ct.fa;

    if (lsCell.v != null && lsCell.v !== '') {
      if (ct.t === 'n' || typeof lsCell.v === 'number') {
        out.t = 'n';
        out.v = Number(lsCell.v);
      } else if (ct.t === 'd') {
        out.t = 'n';
        out.v = Number(lsCell.v);
      } else if (ct.t === 'b') {
        out.t = 'b';
        out.v = !!lsCell.v;
      } else {
        out.t = 's';
        out.v = lsCell.m != null && lsCell.m !== '' ? String(lsCell.m) : String(lsCell.v);
      }
    } else if (lsCell.m != null && lsCell.m !== '') {
      out.t = 's';
      out.v = String(lsCell.m);
    } else if (!out.f) {
      return null;
    }

    var style = {};
    var bg = hexToArgb(lsCell.bg);
    if (bg) {
      style.fill = { patternType: 'solid', fgColor: { rgb: bg } };
    }
    var fc = hexToArgb(lsCell.fc);
    if (fc) {
      style.font = style.font || {};
      style.font.color = { rgb: fc };
    }
    if (lsCell.bl) {
      style.font = style.font || {};
      style.font.bold = true;
    }
    if (lsCell.it) {
      style.font = style.font || {};
      style.font.italic = true;
    }
    if (lsCell.un) {
      style.font = style.font || {};
      style.font.underline = true;
    }
    var alignment = luckysheetAlign(lsCell.ht, lsCell.vt);
    if (alignment) style.alignment = alignment;
    if (Object.keys(style).length) out.s = style;

    return out;
  }

  function isColHidden(colhidden, c) {
    if (!colhidden) return false;
    return Object.prototype.hasOwnProperty.call(colhidden, String(c))
      || Object.prototype.hasOwnProperty.call(colhidden, c);
  }

  function buildVisibleColMap(colStart, colEnd, colhidden) {
    var map = {};
    var exportIdx = 0;
    for (var c = colStart; c <= colEnd; c++) {
      if (isColHidden(colhidden, c)) continue;
      map[c] = exportIdx;
      exportIdx++;
    }
    return { map: map, count: exportIdx };
  }

  function remapMerge(merge, rowStart, colMap, colhidden) {
    var merges = [];
    if (!merge) return merges;
    Object.keys(merge).forEach(function (key) {
      var m = merge[key];
      if (!m || m.r == null || m.c == null) return;
      if (m.c < 0) return;
      if (isColHidden(colhidden, m.c)) return;
      if (colMap.map[m.c] == null) return;
      var rs = m.rs || 1;
      var cs = m.cs || 1;
      var endC = m.c + cs - 1;
      for (var c = m.c; c <= endC; c++) {
        if (isColHidden(colhidden, c)) return;
      }
      if (colMap.map[endC] == null) return;
      merges.push({
        s: { r: m.r - rowStart, c: colMap.map[m.c] },
        e: { r: m.r - rowStart + rs - 1, c: colMap.map[endC] }
      });
    });
    return merges;
  }

  /**
   * 从 Luckysheet file.data 二维矩阵导出 xlsx
   * @param {object} options
   * @param {Array<Array>} options.data — file.data
   * @param {object} [options.merge]
   * @param {object} [options.columnlen]
   * @param {object} [options.colhidden]
   * @param {number} options.rowStart — 含
   * @param {number} options.rowEnd — 含
   * @param {number} [options.colStart=0]
   * @param {number} options.colEnd — 含
   * @param {string} [options.sheetName]
   * @param {string} options.filename
   */
  function exportSheetToXlsx(options) {
    var XLSX = (typeof window !== 'undefined' && window.XLSX) ? window.XLSX : null;
    if (!XLSX) throw new Error('SheetJS 未加载');

    var data = options.data || [];
    var rowStart = options.rowStart != null ? options.rowStart : 0;
    var rowEnd = options.rowEnd != null ? options.rowEnd : rowStart;
    var colStart = options.colStart != null ? options.colStart : 0;
    var colEnd = options.colEnd != null ? options.colEnd : colStart;
    var colhidden = options.colhidden || {};
    var colMap = buildVisibleColMap(colStart, colEnd, colhidden);

    var ws = {};
    var minR = Infinity;
    var minC = Infinity;
    var maxR = 0;
    var maxC = 0;

    for (var r = rowStart; r <= rowEnd; r++) {
      var row = data[r];
      if (!row) continue;
      for (var c = colStart; c <= colEnd; c++) {
        if (isColHidden(colhidden, c)) continue;
        var exportC = colMap.map[c];
        if (exportC == null) continue;
        var exportR = r - rowStart;
        var xCell = lsCellToXlsx(row[c]);
        if (!xCell) continue;
        var addr = XLSX.utils.encode_cell({ r: exportR, c: exportC });
        ws[addr] = xCell;
        if (exportR < minR) minR = exportR;
        if (exportC < minC) minC = exportC;
        if (exportR > maxR) maxR = exportR;
        if (exportC > maxC) maxC = exportC;
      }
    }

    if (!isFinite(minR)) {
      minR = 0;
      minC = 0;
      maxR = 0;
      maxC = Math.max(0, colMap.count - 1);
    }

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });

    var merges = remapMerge(options.merge, rowStart, colMap, colhidden);
    if (merges.length) ws['!merges'] = merges;

    var cols = [];
    var columnlen = options.columnlen || {};
    for (var ci = colStart; ci <= colEnd; ci++) {
      if (isColHidden(colhidden, ci)) continue;
      var px = columnlen[ci];
      cols.push({ wch: px ? Math.max(6, Math.round(px / 7)) : 12 });
    }
    if (cols.length) ws['!cols'] = cols;

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, options.sheetName || 'Sheet1');
    XLSX.writeFile(wb, options.filename, { cellStyles: true });
  }

  return {
    lsCellToXlsx: lsCellToXlsx,
    exportSheetToXlsx: exportSheetToXlsx,
    buildVisibleColMap: buildVisibleColMap,
    isMergeSlaveCell: isMergeSlaveCell,
    isColHidden: isColHidden
  };
});
