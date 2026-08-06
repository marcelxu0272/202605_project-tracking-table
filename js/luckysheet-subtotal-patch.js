/** 修补 Luckysheet SUBTOTAL：忽略筛选/隐藏行，并在筛选后重算 */
(function (global) {
  function parseA1(a1) {
    var m = String(a1).match(/^\$?([A-Za-z]+)\$?(\d+)$/);
    if (!m) return null;
    var col = 0;
    var letters = m[1].toUpperCase();
    for (var i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
    return { r: parseInt(m[2], 10) - 1, c: col - 1 };
  }

  function currentSheet() {
    var sheets = luckysheet.getAllSheets && luckysheet.getAllSheets();
    if (!sheets || !sheets.length) return null;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].status == 1 || sheets[i].status === '1') return sheets[i];
    }
    return sheets[0];
  }

  function hiddenMap(fnNum) {
    var sheet = currentSheet();
    var map = Object.create(null);
    if (!sheet) return map;
    if (sheet.filter) {
      Object.keys(sheet.filter).forEach(function (k) {
        var rh = sheet.filter[k] && sheet.filter[k].rowhidden;
        if (!rh) return;
        Object.keys(rh).forEach(function (r) {
          map[r] = 1;
        });
      });
    }
    if (fnNum >= 100 && sheet.config && sheet.config.rowhidden) {
      Object.keys(sheet.config.rowhidden).forEach(function (r) {
        map[r] = 1;
      });
    }
    return map;
  }

  function filterArg(arg, map) {
    if (!arg || !arg.data || !arg.startCell) return arg;
    var start = parseA1(arg.startCell);
    if (!start) return arg;
    var data = [];
    for (var i = 0; i < arg.data.length; i++) {
      if (!map[String(start.r + i)]) data.push(arg.data[i]);
    }
    return {
      sheetName: arg.sheetName,
      startCell: arg.startCell,
      rowl: data.length,
      coll: arg.coll,
      data: data
    };
  }

  var FN = {
    1: 'AVERAGE',
    101: 'AVERAGE',
    2: 'COUNT',
    102: 'COUNT',
    3: 'COUNTA',
    103: 'COUNTA',
    4: 'MAX',
    104: 'MAX',
    5: 'MIN',
    105: 'MIN',
    6: 'PRODUCT',
    106: 'PRODUCT',
    7: 'STDEVA',
    107: 'STDEVA',
    8: 'STDEVP',
    108: 'STDEVP',
    9: 'SUM',
    109: 'SUM',
    10: 'VAR_S',
    110: 'VAR_S',
    11: 'VAR_P',
    111: 'VAR_P'
  };

  function install() {
    var meta = global.luckysheet_function && luckysheet_function.SUBTOTAL;
    if (!meta || meta.__patchedForFilter) return !!meta;
    meta.f = function () {
      var n = parseInt(arguments[0], 10);
      if (isNaN(n) || !FN[n]) return '#VALUE!';
      var map = hiddenMap(n);
      var args = [];
      for (var i = 1; i < arguments.length; i++) args.push(filterArg(arguments[i], map));
      var fn = luckysheet_function[FN[n]];
      return fn && fn.f ? fn.f.apply(fn, args) : '#NAME?';
    };
    meta.__patchedForFilter = true;
    return true;
  }

  var timer = null;
  function refresh() {
    try {
      luckysheet.refreshFormula && luckysheet.refreshFormula();
    } catch (e) { /* ignore */ }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  }

  document.addEventListener(
    'click',
    function (ev) {
      var menu = ev.target && ev.target.closest && ev.target.closest('.luckysheet-filter-menu');
      if (!menu) return;
      var text = (ev.target.textContent || '').replace(/\s+/g, '');
      if (/确认|确定|清除筛选/.test(text)) schedule();
    },
    true
  );

  global.SUBTOTAL_PATCH = {
    install: install,
    refresh: refresh,
    onUpdated: function (op) {
      var t = op && (op.t || op.type);
      if (t === 'f' || t === 'fsc' || t === 'fsr' || t === 'shr' || t === 'hideRc' || t === 'showRc') {
        schedule();
      }
    }
  };
})(window);
