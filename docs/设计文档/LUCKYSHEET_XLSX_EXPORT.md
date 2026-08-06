# Luckysheet 视图导出 Excel — 开发说明

> **最后更新：** 2026-07-13  
> **适用页面：** 项目追踪表（`ProjectEditor`）、继承其模板的填报管理详情（`ReportLineDetail` 的前端导出若改走客户端时）

---

## 1. 背景与问题

| 项 | 旧实现 | 问题 |
|---|---|---|
| 入口 | `XlsxImporter.exportToXlsx()` | 与 Luckysheet **无关** |
| 数据源 | `Store.projects` 全库 JSON | 与屏幕 `filteredProjects` 不一致 |
| 表结构 | 2 行表头 + 裸数据 | 缺少小计/合计/分区/合并 |
| 样式 | 无 | 背景色、对齐、加粗丢失 |
| 公式 | `FormulaEngine` 预计算值 | Excel 中无 `=P5-N5` 等公式 |
| 格式 | 无 | 千分位、日期格式丢失 |

**目标：** 导出文件与在线 Luckysheet **所见即所得**（结构 + 样式 + 数字格式 + Excel 公式）。

---

## 2. 架构（改后）

```
用户点击「导出 Excel」
    │
    ▼
ProjectEditor.handleExport()
    │
    ▼
exportCurrentLuckysheetView()          ← 首选：读 live Luckysheet file.data
    │                                      （含用户未保存但已编辑的格子）
    ├─ luckysheet.exitEditMode()
    ├─ lsGetActiveLuckysheetFile()
    └─ LuckysheetXlsxExport.exportSheetToXlsx({ data, merge, columnlen, colhidden, ... })
            │
            ▼
        xlsx-js-style (window.XLSX) → 下载 .xlsx

降级路径（Luckysheet 未挂载）：
exportBuiltLuckysheetView()
    ├─ buildLuckysheetCelldata()
    ├─ buildLuckysheetDataMatrix()
    └─ 同上 exportSheetToXlsx
```

**导入不受影响：** 仍用 `XlsxImporter.importFromFile()`；CDN 已换为 `xlsx-js-style`（API 兼容 `XLSX.read`）。

---

## 3. 涉及文件

| 文件 | 职责 |
|---|---|
| `js/luckysheet-xlsx-export.js` | **核心**：`lsCellToXlsx`、`exportSheetToXlsx`；Luckysheet 单元格 → SheetJS 单元格（`f`/`z`/`s`） |
| `js/views/ProjectEditor.js` | `exportCurrentLuckysheetView`、`exportBuiltLuckysheetView`、`buildExportFilename`；`handleExport` / `handleDownloadSnapshot` 改调新导出 |
| `index.html` | 引入 `xlsx-js-style@1.2.0` + `luckysheet-xlsx-export.js` |
| `js/xlsx-importer.js` | `exportToXlsx` **标记 deprecated**，仅保留纯数据导出（脚本/测试用） |
| `test/luckysheet-xlsx-export.test.js` | 单元格映射与列隐藏映射测试 |

**未改（有意为之）：**

| 文件 | 说明 |
|---|---|
| `js/views/ReportLineDetail.js` | 仍走服务端 `GET /api/report-lines/:id/export`（字段 JSON 导出）；若需 WYSIWYG，需另开任务对齐本方案 |
| `server/report-line-service.js#exportReportLine` | 服务端纯数据导出，无 Luckysheet 上下文 |

---

## 4. 关键 API

### 4.1 `LuckysheetXlsxExport.exportSheetToXlsx(options)`

| 参数 | 说明 |
|---|---|
| `data` | Luckysheet `file.data` 二维数组（或 `buildLuckysheetDataMatrix` 结果） |
| `merge` | `file.config.merge` |
| `columnlen` | `file.config.columnlen`（像素 → `!cols.wch`） |
| `colhidden` | 传 `{}` 即导出全部列；**忽略**页面「紧凑列」隐藏（保证可回导 83 列） |
| `rowStart` / `rowEnd` | 导出行范围（含小计 0、合计 1、分区 2、表头 3、数据 4+） |
| `colStart` / `colEnd` | 列范围（通常 `0 .. tableFields.length-1`） |
| `sheetName` | 工作表名（≤31 字符） |
| `filename` | 下载文件名 |

### 4.2 `lsCellToXlsx(lsCell)`

Luckysheet 单元格字段映射：

| Luckysheet | Excel (xlsx-js-style) |
|---|---|
| `f` (`=SUM(...)`) | `f`（去掉前导 `=`） |
| `ct.fa` | `z`（数字/日期格式） |
| `v` + `ct.t` | `t` + `v` |
| `bg` / `fc` | `s.fill` / `s.font.color`（`#RRGGBB` → `FFRRGGBB`） |
| `bl` / `un` / `it` | `s.font.bold` / `underline` / `italic` |
| `ht` / `vt` | `s.alignment.horizontal` / `vertical` |
| `mc`（从属合并格） | 跳过，不写入 |

---

## 5. 如何扩展 / 修改

### 5.1 新增 Luckysheet 列样式

在 `ProjectEditor.makeLuckysheetCell` / `makeLuckysheetFormulaCell` 等处设置 `bg`、`fc`、`ct` 等；**导出自动跟随**，一般无需改 `luckysheet-xlsx-export.js`。

若新增 Luckysheet 专有样式键（如边框 `bd`），在 `lsCellToXlsx` 中补充映射到 `s.border`。

### 5.2 新增公式列

在 `ProjectEditor.buildLuckysheetFieldFormula` 增加 `case`；`makeLuckysheetDataCell` 已对 `auto_calc` 写 `f` 字段，导出会保留公式。

### 5.3 调整导出行范围

修改 `exportCurrentLuckysheetView` 中的 `rowStart` / `rowEnd`（当前：`lay.subtotal` .. `max(lay.header, lay.dataEnd)`）。

### 5.4 报告线前端 WYSIWYG 导出

1. 在 `ReportLineDetail` 覆盖 `handleExport`，调用 `this.exportCurrentLuckysheetView(...)`（与主表相同）。
2. 或保留服务端导出但重写 `exportReportLine` 使用本模块（需在 Node 侧安装 `xlsx-js-style` 并传入等价的 `data` 矩阵）。

### 5.5 文件名规则

`buildExportFilename()`：`查看数据_{报告月}_{YYYYMMDD_HHMMSS}.xlsx`  
快照下载：`项目执行跟踪_{快照label}.xlsx`

---

## 6. 已知限制

| 限制 | 说明 |
|---|---|
| Luckysheet **行筛选** | 筛选仅隐藏显示，`file.data` 仍含被筛掉行；导出含全部数据行（与 `filteredProjects` 一致，但不含 LS 内置行筛选） |
| 批注 `ps` | 当前不写入 Excel 批注 |
| 条件格式 | Luckysheet 条件格式未导出 |
| 冻结窗格 | 不写入 `!freeze`（打开 Excel 后默认 A1） |
| 服务端报告线导出 | 仍为纯字段表，样式/公式与在线表不一致 |

---

## 7. 验收清单

- [ ] 导出含 **小计 / 合计 / 分区合并 / 字段表头 / 数据行** 完整结构
- [ ] 金额列 **千分位**（`#,##0.00`），日期列 **yyyy-MM-dd**
- [ ] `auto_calc` 列含 **Excel 公式**（如 `O5=P5-N5`），小计行为 `SUBTOTAL`，合计行为 `SUM`
- [ ] 背景色、表头配色、斑马纹、变更高亮等与线上一致
- [ ] 「仅显示项目信息与可编辑列」时，导出仍含 **全部 83 列**（与紧凑列显示无关，便于 Excel 回导）
- [ ] 视图筛选（新增/变更/预警）后导出项目数与表格一致
- [ ] J 版快照「下载此版本」与快照视图一致
- [ ] **导入**仍可从导出文件按项目号合并（数据列可读）

---

## 8. 本地验证

```bash
npm test   # 含 test/luckysheet-xlsx-export.test.js
npm start
# 系统管理员登录 → 项目追踪表 → 导出 Excel → 用 Excel 打开核对公式/格式
```

---

## 9. 完整代码变更

以下为本功能涉及的**全部代码**（新增文件为全文；修改文件为 diff 对照 + 改后完整片段）。

### 9.1 `index.html` — CDN 与脚本加载顺序

**变更前：**

```html
  <!-- SheetJS (xlsx 导入/导出) -->
  <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
  ...
  <script src="./js/store.js"></script>
  <script src="./js/xlsx-importer.js"></script>
```

**变更后：**

```html
  <!-- SheetJS + 样式写入（xlsx-js-style，兼容 XLSX.read/write；导出保留背景色/公式/数字格式） -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js"></script>
  ...
  <script src="./js/store.js"></script>
  <script src="./js/luckysheet-xlsx-export.js"></script>
  <script src="./js/xlsx-importer.js"></script>
```

要点：`luckysheet-xlsx-export.js` 必须在 `xlsx-importer.js` **之前**加载；`window.XLSX` 由 `xlsx-js-style` 提供。

---

### 9.2 `js/luckysheet-xlsx-export.js` — **新增**（全文）

```javascript
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
```

---

### 9.3 `js/views/ProjectEditor.js` — 导出相关 methods

**变更前（`handleExport` / `handleDownloadSnapshot`）：**

```javascript
      handleExport() {
        this.exportLoading = true;
        setTimeout(() => {
          try {
            XlsxImporter.exportToXlsx(Store.projects, Store.reportingMonth);
            this.$message.success('导出成功');
          } catch (e) {
            this.$message.error('导出失败：' + e.message);
          }
          this.exportLoading = false;
        }, 300);
      },
      handleDownloadSnapshot() {
        if (!this.isViewingSnapshot || !this.snapshotProjects) return;
        this.downloadSnapshotLoading = true;
        setTimeout(() => {
          try {
            const snap = Store.snapshots[this.viewingVersion];
            const reportingMonth = (snap && snap.reportingMonth) || Store.reportingMonth;
            const label = (snap && snap.label) || this.viewingVersion;
            const filename = '项目执行跟踪_' + label + '.xlsx';
            XlsxImporter.exportToXlsx(this.snapshotProjects, reportingMonth, filename);
            this.$message.success('导出成功');
          } catch (e) {
            this.$message.error('导出失败：' + e.message);
          }
          this.downloadSnapshotLoading = false;
        }, 300);
      },
```

**变更后（新增 3 个 method + 改写 2 个入口，约第 1252–1355 行）：**

```javascript
      buildExportFilename(suffix) {
        var month = Store.reportingMonth || '2026-05';
        if (suffix) return '项目执行跟踪_' + suffix + '.xlsx';
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var stamp = now.getFullYear()
          + pad(now.getMonth() + 1)
          + pad(now.getDate()) + '_'
          + pad(now.getHours())
          + pad(now.getMinutes())
          + pad(now.getSeconds());
        return '查看数据_' + month + '_' + stamp + '.xlsx';
      },

      /** 从当前 Luckysheet 视图导出（与屏幕所见一致：结构/样式/公式/格式） */
      exportCurrentLuckysheetView(filename) {
        if (!window.LuckysheetXlsxExport) {
          throw new Error('LuckysheetXlsxExport 未加载');
        }
        if (typeof luckysheet !== 'undefined' && luckysheet && typeof luckysheet.exitEditMode === 'function') {
          try { luckysheet.exitEditMode(); } catch (e) { /* ignore */ }
        }

        var file = this.lsGetActiveLuckysheetFile();
        var lay = this.lsLayout();
        var colEnd = Math.max(0, this.tableFields.length - 1);
        var rowEnd = Math.max(lay.header, lay.dataEnd);

        if (!file || !file.data) {
          return this.exportBuiltLuckysheetView(filename);
        }

        var config = file.config || {};
        LuckysheetXlsxExport.exportSheetToXlsx({
          data: file.data,
          merge: config.merge || {},
          columnlen: config.columnlen || {},
          colhidden: {},
          rowStart: lay.subtotal,
          rowEnd: rowEnd,
          colStart: 0,
          colEnd: colEnd,
          sheetName: (file.name || Store.reportingMonth || '项目执行跟踪').slice(0, 31),
          filename: filename || this.buildExportFilename()
        });
      },

      /** Luckysheet 未挂载时，按 celldata 重建矩阵后导出（快照/降级路径） */
      exportBuiltLuckysheetView(filename) {
        if (!window.LuckysheetXlsxExport) {
          throw new Error('LuckysheetXlsxExport 未加载');
        }
        var lay = this.lsLayout();
        var cols = Math.max(1, this.tableFields.length);
        var rows = Math.max(48, lay.dataStart + Math.max(this.filteredProjects.length, 1) + 4);
        var celldata = this.buildLuckysheetCelldata();
        var merge = this.buildLuckysheetMerge();
        var dataMatrix = this.buildLuckysheetDataMatrix(celldata, rows, cols, merge);
        this.appendLuckysheetMergeCelldata(celldata, dataMatrix, merge);

        LuckysheetXlsxExport.exportSheetToXlsx({
          data: dataMatrix,
          merge: merge,
          columnlen: this.buildLuckysheetColumnlen(),
          colhidden: {},
          rowStart: lay.subtotal,
          rowEnd: Math.max(lay.header, lay.dataEnd),
          colStart: 0,
          colEnd: cols - 1,
          sheetName: (Store.reportingMonth || '项目执行跟踪').slice(0, 31),
          filename: filename || this.buildExportFilename()
        });
      },

      handleExport() {
        var self = this;
        this.exportLoading = true;
        setTimeout(function () {
          try {
            self.exportCurrentLuckysheetView();
            self.$message.success('导出成功');
          } catch (e) {
            self.$message.error('导出失败：' + (e.message || e));
          }
          self.exportLoading = false;
        }, 100);
      },
      handleDownloadSnapshot() {
        if (!this.isViewingSnapshot || !this.snapshotProjects) return;
        var self = this;
        this.downloadSnapshotLoading = true;
        setTimeout(function () {
          try {
            var snap = Store.snapshots[self.viewingVersion];
            var label = (snap && snap.label) || self.viewingVersion;
            var filename = '项目执行跟踪_' + label + '.xlsx';
            self.exportCurrentLuckysheetView(filename);
            self.$message.success('导出成功');
          } catch (e) {
            self.$message.error('导出失败：' + (e.message || e));
          }
          self.downloadSnapshotLoading = false;
        }, 100);
      },
```

**依赖的既有方法（未改，导出复用）：**

| 方法 | 作用 |
|---|---|
| `lsGetActiveLuckysheetFile()` | 取当前 Luckysheet `file`（含 `data` / `config`） |
| `lsLayout()` | 行号：小计 0、合计 1、分区 2、表头 3、数据 4+ |
| `buildLuckysheetCelldata()` | 构建 celldata（含公式、样式） |
| `buildLuckysheetDataMatrix()` | celldata → 二维 `data` 矩阵 |
| `buildLuckysheetMerge()` | 分区行合并配置 |
| `buildLuckysheetColumnlen()` | 列宽（像素） |

> **导出列范围：** 始终传 `colhidden: {}`，不受 `compactColumnsOnly` 影响。

---

### 9.4 `js/xlsx-importer.js` — `exportToXlsx` 标记废弃

仅增加 `@deprecated` 注释，**函数体未删**（供脚本/测试纯数据导出）：

```javascript
  /**
   * @deprecated 填报页导出已改走 Luckysheet 视图导出（js/luckysheet-xlsx-export.js）。
   * 仅保留供脚本/测试使用的纯数据导出；不保留样式与公式。
   */
  function exportToXlsx(projects, reportingMonth, filename) {
    if (!window.XLSX) { alert('SheetJS 未加载'); return; }
    const fields = FieldConfig.buildFieldConfig();
    const monthIdx = FormulaEngine.getMonthIdx(reportingMonth || '2026-05');

    // 构建表头
    const header1 = [''];
    const header2 = ['序号'];
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

  window.XlsxImporter = { importFromFile, exportToXlsx };
```

`importFromFile` **无变更**。

---

### 9.5 `test/luckysheet-xlsx-export.test.js` — **新增**（全文）

```javascript
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
```

---

### 9.6 需求文档同步（摘录）

**`docs/需求文档/需求文档_开发版.md` §3.5.2** 核心条目：

```markdown
#### 3.5.2 导出 Excel

- **实现：** `ProjectEditor.exportCurrentLuckysheetView()` → `LuckysheetXlsxExport.exportSheetToXlsx()`
- **导出范围：** 当前 Luckysheet 视图（`filteredProjects` + 视图筛选）；**列始终为全部 83 列**（忽略紧凑列）
- **导出内容：** Excel 公式、数字/日期格式、单元格背景/字体/对齐、合并单元格
- **依赖：** `xlsx-js-style@1.2.0`；开发说明见 `docs/设计文档/LUCKYSHEET_XLSX_EXPORT.md`
```

**`docs/需求文档/需求文档_产品版.md` §3.5.2** 核心条目：

```markdown
- **导出范围：** 当前 Luckysheet 视图（受角色权限、视图筛选、紧凑列隐藏影响）
- **导出格式：** 含小计/合计/分区/表头/数据行，保留千分位、日期格式、Excel 公式、单元格背景色
- **文件名：** `查看数据_{报告月}_{YYYYMMDD_HHMMSS}.xlsx`
```

---

### 9.7 变更文件一览

| 文件 | 操作 |
|---|---|
| `js/luckysheet-xlsx-export.js` | **新增** |
| `test/luckysheet-xlsx-export.test.js` | **新增** |
| `docs/设计文档/LUCKYSHEET_XLSX_EXPORT.md` | **新增 / 本文档** |
| `index.html` | 修改 CDN + 脚本顺序 |
| `js/views/ProjectEditor.js` | 修改导出入口，新增 3 个 method |
| `js/xlsx-importer.js` | 注释标记 `exportToXlsx` deprecated |
| `docs/需求文档/需求文档_开发版.md` | 同步 §3.5.2 |
| `docs/需求文档/需求文档_产品版.md` | 同步 §3.5.2 |
| `AGENTS.md` | 文件清单补充 |
