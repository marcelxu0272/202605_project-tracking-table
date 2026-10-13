/** 方向键：跳过筛选/隐藏行；单击软焦点时仍可 ←→↑↓ 换格 */
(function (global) {
  var lastRowStep = 1;
  var moving = false;

  function sheet() {
    var list = luckysheet.getAllSheets && luckysheet.getAllSheets();
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status == 1 || list[i].status === '1') return list[i];
    }
    return list[0];
  }

  function hiddenRows() {
    var s = sheet();
    var map = Object.create(null);
    if (!s) return map;
    if (s.config && s.config.rowhidden) {
      Object.keys(s.config.rowhidden).forEach(function (r) {
        map[r] = 1;
      });
    }
    if (s.filter) {
      Object.keys(s.filter).forEach(function (k) {
        var rh = s.filter[k] && s.filter[k].rowhidden;
        if (!rh) return;
        Object.keys(rh).forEach(function (r) {
          map[r] = 1;
        });
      });
    }
    return map;
  }

  function hiddenCols() {
    var s = sheet();
    var map = Object.create(null);
    var cols = (s && s.config && s.config.colhidden) || {};
    Object.keys(cols).forEach(function (c) {
      map[c] = 1;
    });
    return map;
  }

  function maxRow() {
    var s = sheet();
    if (s && s.data) return s.data.length - 1;
    return (s && s.row) || 100;
  }

  function maxCol() {
    var s = sheet();
    if (s && s.data && s.data[0]) return s.data[0].length - 1;
    return (s && s.column) || 20;
  }

  function editing() {
    var box = document.getElementById('luckysheet-input-box');
    if (!box) return false;
    var top = parseInt(box.style.top || getComputedStyle(box).top || '0', 10);
    return !isNaN(top) && top >= 0 && box.style.display !== 'none';
  }

  function softFocus() {
    var a = document.activeElement;
    if (!a) return false;
    return (
      a.id === 'luckysheet-rich-text-editor' ||
      a.id === 'luckysheet-functionbox-cell' ||
      !!(a.closest && a.closest('#luckysheet-input-box'))
    );
  }

  function nextVisible(from, step, map, max) {
    var i = from + step;
    while (i >= 0 && i <= max) {
      if (!map[String(i)]) return i;
      i += step;
    }
    return from;
  }

  function focus() {
    var range = luckysheet.getRange && luckysheet.getRange();
    if (!range || !range.length) return null;
    var last = range[range.length - 1];
    var r = last.row_focus != null ? last.row_focus : last.row[0];
    var c = last.column_focus != null ? last.column_focus : last.column[0];
    return { r: Number(r), c: Number(c) };
  }

  function ensureVisible() {
    var selected = document.getElementById('luckysheet-cell-selected');
    var main = document.getElementById('luckysheet-cell-main');
    var barY = document.getElementById('luckysheet-scrollbar-y');
    var barX = document.getElementById('luckysheet-scrollbar-x');
    if (!selected || !main) return;
    var s = selected.getBoundingClientRect();
    var m = main.getBoundingClientRect();
    if (s.height < 1) return;
    var freeze =
      document.querySelector('.luckysheet-freezebar-horizontal') ||
      document.getElementById('luckysheet-freezebar-horizontal');
    var topLimit = m.top + (freeze ? freeze.getBoundingClientRect().bottom - m.top : 90) + 4;
    if (barY) {
      if (s.top < topLimit) barY.scrollTop -= topLimit - s.top;
      else if (s.bottom > m.bottom - 10) barY.scrollTop += s.bottom - (m.bottom - 10);
      if (barY.scrollTop < 0) barY.scrollTop = 0;
    }
    if (barX) {
      if (s.left < m.left + 4) barX.scrollLeft -= m.left + 4 - s.left;
      else if (s.right > m.right - 10) barX.scrollLeft += s.right - (m.right - 10);
      if (barX.scrollLeft < 0) barX.scrollLeft = 0;
    }
  }

  function moveTo(r, c) {
    moving = true;
    if (document.activeElement && softFocus()) {
      try {
        document.activeElement.blur();
      } catch (e) { /* ignore */ }
    }
    luckysheet.setRangeShow({ row: [r, r], column: [c, c] });
    try {
      luckysheet.selectHightlightShow && luckysheet.selectHightlightShow();
    } catch (e2) { /* ignore */ }
    setTimeout(function () {
      moving = false;
    }, 30);
    requestAnimationFrame(function () {
      requestAnimationFrame(ensureVisible);
    });
  }

  function dir(ev) {
    var k = ev.key;
    var c = ev.keyCode || ev.which;
    if (k === 'ArrowUp' || c === 38) return { axis: 'row', step: -1 };
    if (k === 'ArrowDown' || c === 40) return { axis: 'row', step: 1 };
    if (k === 'ArrowLeft' || c === 37) return { axis: 'col', step: -1 };
    if (k === 'ArrowRight' || c === 39) return { axis: 'col', step: 1 };
    if ((k === 'Enter' || c === 13) && !ev.shiftKey) return { axis: 'row', step: 1 };
    if ((k === 'Enter' || c === 13) && ev.shiftKey) return { axis: 'row', step: -1 };
    return null;
  }

  function onKeyDown(ev) {
    if (ev.__navSkip) return;
    if (!luckysheet || moving || editing() || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    var d = dir(ev);
    if (!d) return;

    var rows = hiddenRows();
    var hasHidden = Object.keys(rows).length > 0;
    var soft = softFocus();
    if (!hasHidden && !soft) return;

    var f = focus();
    if (!f) return;

    var nr = f.r;
    var nc = f.c;
    if (d.axis === 'row') {
      lastRowStep = d.step;
      if (hasHidden) {
        var from = rows[String(f.r)] ? nextVisible(f.r, d.step, rows, maxRow()) : f.r;
        if (rows[String(from)]) from = nextVisible(f.r, -d.step, rows, maxRow());
        nr = nextVisible(from, d.step, rows, maxRow());
      } else {
        nr = Math.max(0, Math.min(maxRow(), f.r + d.step));
      }
    } else {
      nc = nextVisible(f.c, d.step, hiddenCols(), maxCol());
    }

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    ev.__navSkip = true;
    if (nr !== f.r || nc !== f.c) moveTo(nr, nc);
  }

  function onKeyUp(ev) {
    var d = dir(ev);
    if (!d || d.axis !== 'row' || !Object.keys(hiddenRows()).length) return;
    setTimeout(function () {
      if (moving || editing()) return;
      var f = focus();
      var rows = hiddenRows();
      if (!f || !rows[String(f.r)]) return;
      var next = nextVisible(f.r, lastRowStep || 1, rows, maxRow());
      if (next === f.r) next = nextVisible(f.r, -(lastRowStep || 1), rows, maxRow());
      if (next !== f.r) moveTo(next, f.c);
    }, 0);
  }

  function install() {
    if (global.__LUCKYSHEET_NAV_SKIP_HIDDEN__) return;
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    global.__LUCKYSHEET_NAV_SKIP_HIDDEN__ = true;
  }

  global.NAV_SKIP_HIDDEN = { install: install };
  install();
})(window);
