/**
 * xlsx-importer.js — SheetJS 驱动的 Excel 导入/导出
 * 解析 初始数据.xlsx → projects 数组
 * 列顺序：A(0)=新旧项目 ... CE(82)=12月回款，共83列
 */
(function (window) {
  'use strict';

  /**
   * 从 File 对象读取 xlsx，返回 Promise<{ projects, skipped, errors }>
   */
  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) { reject(new Error('SheetJS 未加载')); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          resolve(_parseSheet(ws));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * @deprecated 填报页导出已改走 Luckysheet 视图导出（js/luckysheet-xlsx-export.js）。
   * 仅保留供脚本/测试使用的纯数据导出；不保留样式与公式。
   */
  function exportToXlsx(projects, reportingMonth, filename) {
    if (!window.XLSX) { alert('SheetJS 未加载'); return; }
    const fields = FieldConfig.buildFieldConfig();
    const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');

    // 构建表头
    const header1 = [''];   // section
    const header2 = ['序号']; // field name
    const sections = FieldConfig.getSections(fields);
    sections.forEach(sec => {
      sec.fields.forEach((f, i) => {
        if (i === 0) header1.push(sec.name);
        else header1.push('');
        header2.push(f.name_cn);
      });
    });

    // 构建数据行
    const rows = [header1, header2];
    const computed = FormulaEngine.computeAll(projects, monthIdx);
    computed.forEach((p, rowIdx) => {
      const fp = FieldConfig.arraysToFlat(p);
      const row = [rowIdx + 1];
      fields.forEach(f => {
        const key = FieldConfig.COL_TO_KEY[f.col];
        row.push(fp[key] !== undefined ? fp[key] : '');
      });
      rows.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, reportingMonth || '2026-05');
    XLSX.writeFile(wb, filename || ('项目执行跟踪_' + (reportingMonth || '2026-05') + '.xlsx'));
  }

  // ── 内部：解析 Sheet ────────────────────────────────────
  function _parseSheet(ws) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        row.push(cell ? _cellValue(cell) : null);
      }
      rows.push(row);
    }
    return _rowsToProjects(rows);
  }

  function _cellValue(cell) {
    if (cell.t === 'd') return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : cell.w;
    if (cell.t === 'n') return cell.v;
    return cell.v !== undefined ? cell.v : (cell.w || null);
  }

  /**
   * 找到数据头行（包含"项目号"或"Project No"的行）
   * 返回 { headerRowIdx, dataStartIdx }
   */
  function _findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!row) continue;
      const hasProjectNo = row.some(v =>
        v && (String(v).includes('项目号') || String(v).includes('Project No'))
      );
      if (hasProjectNo) return { headerRowIdx: i, dataStartIdx: i + 1 };
    }
    // 找不到头行，假设第2行是字段名，第3行起是数据
    return { headerRowIdx: 1, dataStartIdx: 2 };
  }

  function _rowsToProjects(rows) {
    const { headerRowIdx, dataStartIdx } = _findHeaderRow(rows);
    const fields = FieldConfig.buildFieldConfig();
    const colMap = FieldConfig.COL_TO_KEY;
    const projects = [];
    const skipped = [];
    const errors = [];

    // 建立列字母 → 列索引 的映射（基于 header 行）
    // 如果 excel 列顺序固定（A-CE），直接按位置映射
    const headerRow = rows[headerRowIdx] || [];

    for (let ri = dataStartIdx; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!row || row.every(v => v === null || v === '')) {
        skipped.push(ri + 1);
        continue;
      }
      try {
        const p = {};
        fields.forEach((f, colIdx) => {
          const key = colMap[f.col];
          if (!key) return;
          const val = row[colIdx] !== undefined ? row[colIdx] : null;
          if (key.startsWith('mc_') || key.startsWith('mi_') || key.startsWith('mp_')) {
            p[key] = _toNum(val);
          } else if (f.data_type === '金额' || f.data_type === '比率') {
            p[key] = _toNum(val);
          } else if (f.data_type === '日期') {
            p[key] = window.Formatters
              ? Formatters.normalizeDateValue(val)
              : (val != null && val !== '' ? String(val) : '');
          } else {
            p[key] = val !== null && val !== undefined ? String(val) : '';
          }
        });

        // 合并扁平数组
        const merged = FieldConfig.flatToArrays(p);

        // 提取 sign_year
        if (!merged.sign_year && merged.start_date) {
          merged.sign_year = parseInt(String(merged.start_date).slice(0, 4)) || 2026;
        }
        merged.crb_status = merged.signed === '已签署' ? '已确认' : '';
        if (!merged._added_this_month) merged._added_this_month = false;
        if (!merged._changed_fields) merged._changed_fields = [];

        // 必须有项目号
        if (!merged.project_no) {
          skipped.push(ri + 1);
          continue;
        }

        merged.id = merged.project_no;

        // 用公式引擎补算
        const computed = FormulaEngine.compute(
          merged,
          FormulaEngine.getMonthIdx(Store.reportingMonth || '2026-05')
        );
        projects.push(computed);
      } catch (e) {
        errors.push({ row: ri + 1, msg: e.message });
      }
    }
    return { projects, skipped, errors };
  }

  function _toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  window.XlsxImporter = { importFromFile, exportToXlsx };
})(window);
