/**
 * ProjectEditor.js — 填报表格：Luckysheet（默认）+ 经典 HTML 表格双模式
 * 权限控制 + diff高亮 + 视图筛选 + 公式联动
 */
(function (window) {
  'use strict';

  const SECTION_COLORS = {
    '项目基本信息':     '#e8f4f3',
    '合同签署与进展':   '#e8f0fa',
    '合同额':           '#fef3e2',
    '开票差与完成差':   '#fce8e8',
    '始累完成合同额':   '#e8f4e8',
    '年度完成额申报':   '#fff8e1',
    '开票回款情况':     '#ede8fa',
    '财务数据（WIP/应收）': '#fce8e8',
    '应收账款及WIP':    '#fef9e2',
    'WIP分析与措施':    '#fde8f4',
    '完成额统计与预测': '#e8f4f3',
    '开票与回款统计预测': '#e8f0fa'
  };

  /** Luckysheet 大类行各分区背景色（按分区名单独配置，未列出的用默认色） */
  const LS_SECTION_ROW_BG_DEFAULT = '#1e3a5f';
  const LS_SECTION_ROW_BG = {
    '项目基本信息': '#26878c',
    '合同签署与进展':   '#c2d600',
    '合同额':           '#c2d600',
    '开票差与完成差':   '#00b050',
    '始累完成合同额':   '#2dbdb6',
    '年度完成额申报':   '#5f2167',
    '开票回款情况':     '#00848a',
    '财务数据（WIP/应收）': '#ffc000',
    '应收账款及WIP':    '#243945',
    'WIP分析与措施':    '#24394b',
    '完成额统计与预测': '#5f2167',
    '开票与回款统计预测': '#00848a'
  };

  /**
   * Luckysheet 行布局（0-based）
   * 0 大类 | 1 字段标题 | 2 小计 | 3 合计 | 4+ 项目数据
   * 注意：Luckysheet 列 A=索引0，我们在 0 列放「#」，字段 A 在索引 1（界面列 B），公式/引用须用索引而非 Excel 列字母 P/O
   */
  const LS_ROW_SECTION = 0;
  const LS_ROW_HEADER = 1;
  const LS_ROW_SUBTOTAL = 2;
  const LS_ROW_SUM = 3;
  const LS_ROW_DATA_START = 4;
  const LS_FROZEN_ROW = LS_ROW_SUM;
  const LS_FROZEN_COL = 6; // 冻结至 F 列（项目号）含左侧 #、A–E
  const LS_NARROW_COLS = { E: 72, F: 88, G: 110 };

  window.ProjectEditorView = {
    name: 'ProjectEditor',
    data() {
      return {
        luckysheetReady: false,
        viewMode: 'all',       // 'all' | 'new_only' | 'changed_only'
        submitLoading: false,
        exportLoading: false,
        showDiffHint: true,
        tableFields: [],
        tableProjects: [],
        activeTab: 'luckysheet', // 'luckysheet' | 'table'
        _lsLoading: false,
        _lsRefreshTimer: null
      };
    },
    mounted() {
      this.tableFields = FieldConfig.buildFieldConfig();
      this.buildTableData();
      if (this.activeTab === 'luckysheet') {
        this.$nextTick(function () { this.initLuckysheet(); }.bind(this));
      }
    },
    activated() {
      this.buildTableData();
      if (this.activeTab === 'luckysheet') {
        this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
      }
    },
    beforeDestroy() {
      if (this._lsRefreshTimer) {
        clearTimeout(this._lsRefreshTimer);
        this._lsRefreshTimer = null;
      }
      this.destroyLuckysheet();
    },
    watch: {
      viewMode: function () {
        this.buildTableData();
        if (this.activeTab === 'luckysheet') {
          this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
        }
      },
      activeTab: function (val) {
        if (val === 'luckysheet') {
          this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
        } else {
          this.destroyLuckysheet();
        }
      }
    },
    methods: {
      buildTableData() {
        this.tableProjects = FormulaEngine.computeAll(
          Store.projects, this.monthIdx
        );
      },
      canEditField(field) {
        return FieldConfig.canEdit(field, this.user.role, this.lockStatus);
      },
      isFieldChanged(project, field) {
        const cols = project._changed_fields;
        if (!cols || !cols.length) return false;
        if (cols.indexOf(field.col) >= 0) return true;
        if (cols.indexOf(field.col.toLowerCase()) >= 0) return true;
        if (cols.indexOf('mc_' + (field.colIdx - 47)) >= 0) return true;
        return false;
      },

      cellClass(project, field) {
        const cls = [];
        if (!this.canEditField(field)) cls.push('readonly-cell');
        if (project._added_this_month) cls.push('new-project-cell');
        if (this.isFieldChanged(project, field)) cls.push('changed-cell');
        return cls.join(' ');
      },
      getCellValue(project, field) {
        const flat = FieldConfig.arraysToFlat(project);
        const key = FieldConfig.COL_TO_KEY[field.col];
        return flat[key];
      },
      formatCellValue(val, field) {
        if (field.data_type === '金额') return Formatters.formatAmount(val);
        if (field.data_type === '比率') return Formatters.formatTaxRate(val);
        if (field.data_type === '日期') return Formatters.formatDate(val);
        if (field.data_type === '布尔') return Formatters.formatBool(val);
        return (val === null || val === undefined || val === '') ? '—' : String(val);
      },
      async handleCellEdit(project, field, newVal, opts) {
        if (!this.canEditField(field)) return;
        const key = FieldConfig.COL_TO_KEY[field.col];
        const flat = FieldConfig.arraysToFlat(project);
        const oldVal = flat[key];
        if (oldVal === newVal) return;

        // 写入变更
        flat[key] = newVal;
        const updated = FieldConfig.flatToArrays(flat);
        const recomputed = FormulaEngine.compute(updated, this.monthIdx);

        // 更新 _changed_fields
        if (!recomputed._changed_fields) recomputed._changed_fields = [];
        if (!recomputed._changed_fields.includes(field.col)) {
          recomputed._changed_fields.push(field.col);
        }

        try {
          await Store.updateProject(recomputed);
          await Store.addAuditLog({
            projectNo:   project.project_no,
            projectName: project.project_name,
            fieldName:   field.col,
            fieldCN:     field.name_cn,
            oldVal:      Formatters.formatByType(oldVal, field.data_type),
            newVal:      Formatters.formatByType(newVal, field.data_type),
            userId:      this.user.role,
            userName:    this.user.name
          });
          this.buildTableData();
          if ((!opts || !opts.fromLuckysheet) && this.activeTab === 'luckysheet') {
            this.scheduleRefreshLuckysheet();
          }
        } catch (e) {
          this.$message.error('保存失败：' + (e.message || e));
        }
      },
      handleSubmit() {
        this.$confirm(
          '提交后将生成填报快照（Draft版），进入审批流程，当前数据将被锁定。确认提交？',
          '提交审批', { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning' }
        ).then(() => {
          this.submitLoading = true;
          Store.submitForApproval()
            .then(() => {
              this.$message.success('已提交审批，Draft快照已生成');
              this.$router.push('/approval');
            })
            .catch(e => { this.$message.error('提交失败：' + (e.message || e)); })
            .finally(() => { this.submitLoading = false; });
        }).catch(() => {});
      },
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
      getRowClass(project) {
        if (project._added_this_month) return 'row-new-project';
        if (project._changed_fields && project._changed_fields.length > 0) return 'row-changed';
        return '';
      },
      // 分区背景色
      sectionBg(field) {
        return SECTION_COLORS[field.section] || '#fff';
      },

      lsSectionRowBg(sectionName) {
        return LS_SECTION_ROW_BG[sectionName] || LS_SECTION_ROW_BG_DEFAULT;
      },

      lsLayout() {
        const n = this.filteredProjects.length;
        return {
          section: LS_ROW_SECTION,
          header: LS_ROW_HEADER,
          subtotal: LS_ROW_SUBTOTAL,
          sum: LS_ROW_SUM,
          dataStart: LS_ROW_DATA_START,
          dataEnd: n > 0 ? LS_ROW_DATA_START + n - 1 : LS_ROW_DATA_START - 1
        };
      },

      lsFieldColIndex(fieldColLetter) {
        for (var i = 0; i < this.tableFields.length; i++) {
          if (this.tableFields[i].col === fieldColLetter) return i + 1;
        }
        return -1;
      },

      sumProjectsField(projs, fld) {
        const key = FieldConfig.COL_TO_KEY[fld.col];
        if (!key) return 0;
        var s = 0;
        for (var i = 0; i < projs.length; i++) {
          const flat = FieldConfig.arraysToFlat(projs[i]);
          s += Number(flat[key]) || 0;
        }
        return s;
      },

      canEditLuckysheetCell(r, c) {
        if (c === 0) return false;
        const lay = this.lsLayout();
        if (r === lay.section || r === lay.header) return false;
        if (r === lay.subtotal || r === lay.sum) return false;
        if (r < lay.dataStart || r > lay.dataEnd) return false;
        const field = this.tableFields[c - 1];
        if (!field) return false;
        return this.canEditField(field) && this.canEdit;
      },

      extractLuckysheetInput(newValue) {
        if (newValue == null) return '';
        if (typeof newValue === 'number' || typeof newValue === 'boolean') return newValue;
        if (typeof newValue === 'string') return newValue;
        if (typeof newValue === 'object') {
          if (Object.prototype.hasOwnProperty.call(newValue, 'v') && newValue.v != null && newValue.v !== '') {
            return newValue.v;
          }
          if (Object.prototype.hasOwnProperty.call(newValue, 'm') && newValue.m != null && newValue.m !== '') {
            return newValue.m;
          }
        }
        return '';
      },

      coerceFieldValue(raw, field) {
        if (field.data_type === '金额' || field.data_type === '比率') {
          const n = Number(String(raw).replace(/,/g, ''));
          return isNaN(n) ? 0 : n;
        }
        if (raw == null) return '';
        return String(raw);
      },

      makeLuckysheetCell(val, field, readonly, bgTint) {
        const cell = { ct: { fa: 'General', t: 'g' } };
        if (field.data_type === '金额') {
          const n = Number(val) || 0;
          cell.v = n;
          cell.m = String(n);
          cell.ct = { fa: '#,##0.00', t: 'n' };
        } else if (field.data_type === '比率') {
          const n = Number(val) || 0;
          cell.v = n;
          cell.m = String(n);
          cell.ct = { fa: '0.00%', t: 'n' };
        } else {
          cell.v = val != null && val !== '' ? val : '';
          cell.m = cell.v !== '' ? String(cell.v) : '';
        }
        if (readonly) {
          cell.bg = bgTint || '#f8fafc';
        } else if (bgTint) {
          cell.bg = bgTint;
        }
        return cell;
      },

      luckysheetCellBg(project, field, readonly) {
        if (this.isFieldChanged(project, field)) return '#fff7ed';
        if (project._added_this_month) {
          return readonly ? 'rgba(0,112,105,0.07)' : 'rgba(0,112,105,0.05)';
        }
        if (readonly || field.source_type !== 'manual_input') return '#f8fafc';
        return '#ffffff';
      },

      /** 与 HTML 表一致：变更列橙字 + 左边框色条（Luckysheet 用 bd） */
      applyLuckysheetHighlight(cell, project, field) {
        if (!this.isFieldChanged(project, field)) return cell;
        cell.fc = '#b45309';
        cell.bd = {
          borderType: 'border-left',
          style: '1',
          color: '#f59e0b'
        };
        return cell;
      },

      makeLuckysheetDataCell(project, field) {
        const ro = !this.canEditField(field) || !this.canEdit;
        const val = this.getCellValue(project, field);
        const bg = this.luckysheetCellBg(project, field, ro);
        const cell = this.makeLuckysheetCell(val, field, ro, bg);
        return this.applyLuckysheetHighlight(cell, project, field);
      },

      buildLuckysheetMerge() {
        const merge = {};
        const sections = FieldConfig.getSections(this.tableFields);
        const fields = this.tableFields;
        sections.forEach(function (sec) {
          if (!sec.fields.length) return;
          const first = sec.fields[0];
          const last = sec.fields[sec.fields.length - 1];
          const c0 = fields.indexOf(first) + 1;
          const cs = fields.indexOf(last) - fields.indexOf(first) + 1;
          if (c0 < 1 || cs < 1) return;
          merge[LS_ROW_SECTION + '_' + c0] = {
            r: LS_ROW_SECTION, c: c0, rs: 1, cs: cs
          };
        });
        return merge;
      },

      buildLuckysheetTotalRowCells(r, label) {
        const cells = [];
        const projs = this.filteredProjects;
        const labelC = this.lsFieldColIndex('G');
        const labelCol = labelC >= 0 ? labelC : 1;
        const rowBase = { bg: '#e2e8f0', bl: 1 };

        cells.push({
          r: r, c: 0,
          v: Object.assign({ v: '', m: '', ct: { fa: 'General', t: 'g' }, ht: '0' }, rowBase)
        });
        for (var j = 0; j < this.tableFields.length; j++) {
          var fld = this.tableFields[j];
          var c = j + 1;
          var base = Object.assign({
            ht: fld.data_type === '金额' || fld.data_type === '比率' ? '2' : '0'
          }, rowBase);
          if (c === labelCol) {
            cells.push({
              r: r, c: c,
              v: Object.assign({ v: label, m: label, ct: { fa: 'General', t: 'g' } }, base)
            });
            continue;
          }
          if (fld.data_type === '金额') {
            var total = this.sumProjectsField(projs, fld);
            var cell = this.makeLuckysheetCell(total, fld, true, '#e2e8f0');
            Object.assign(cell, base);
            cells.push({ r: r, c: c, v: cell });
          } else {
            cells.push({
              r: r, c: c,
              v: Object.assign({ v: '', m: '', ct: { fa: 'General', t: 'g' } }, base)
            });
          }
        }
        return cells;
      },

      buildLuckysheetCelldata() {
        const celldata = [];
        const fields = this.tableFields;
        const projs = this.filteredProjects;
        const lay = this.lsLayout();
        const push = function (r, c, v) {
          celldata.push({ r: r, c: c, v: v });
        };

        // 行0：大类（分区名，合并单元格由 config.merge 定义）
        push(LS_ROW_SECTION, 0, {
          v: '分区', m: '分区', ct: { fa: 'General', t: 'g' },
          bg: '#0f2027', fc: '#ffffff', bl: 1, ht: '0'
        });
        const self = this;
        const sections = FieldConfig.getSections(fields);
        sections.forEach(function (sec) {
          if (!sec.fields.length) return;
          const c0 = fields.indexOf(sec.fields[0]) + 1;
          const secBg = self.lsSectionRowBg(sec.name);
          push(LS_ROW_SECTION, c0, {
            v: sec.name, m: sec.name, ct: { fa: 'General', t: 'g' },
            bg: secBg, fc: '#ffffff', bl: 1, ht: '0', tb: '2'
          });
        });

        // 行1：字段标题
        push(LS_ROW_HEADER, 0, {
          v: '#', m: '#', ct: { fa: 'General', t: 'g' }, bg: '#0f2027', fc: '#ffffff', bl: 1, ht: 0
        });
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j];
          var hl = f.name_cn + '\n(' + f.col + ')';
          push(LS_ROW_HEADER, j + 1, {
            v: hl, m: hl, ct: { fa: 'General', t: 'g' }, bg: '#8f96a0', fc: '#ffffff', bl: 1,
            tb: '2', ht: '1', vt: '0'
          });
        }

        // 小计 / 合计（紧挨标题行下方，在数据行之上）
        this.buildLuckysheetTotalRowCells(lay.subtotal, '小计 Subtotal').forEach(function (item) {
          push(item.r, item.c, item.v);
        });
        this.buildLuckysheetTotalRowCells(lay.sum, '合计 Sum').forEach(function (item) {
          push(item.r, item.c, item.v);
        });

        // 数据行
        for (var i = 0; i < projs.length; i++) {
          var p = projs[i];
          var row = lay.dataStart + i;
          push(row, 0, {
            v: i + 1, m: String(i + 1), ct: { fa: 'General', t: 'g' },
            bg: p._added_this_month ? 'rgba(0,112,105,0.07)' : '#f1f5f9',
            ht: '0'
          });
          for (var k = 0; k < fields.length; k++) {
            var fld = fields[k];
            push(row, k + 1, this.makeLuckysheetDataCell(p, fld));
          }
        }

        return celldata;
      },

      buildLuckysheetColumnlen() {
        var columnlen = { 0: 44 };
        for (var j = 0; j < this.tableFields.length; j++) {
          var f = this.tableFields[j];
          var narrow = LS_NARROW_COLS[f.col];
          columnlen[j + 1] = narrow != null
            ? narrow
            : Math.min(220, Math.max(72, f.colWidth || 90));
        }
        return columnlen;
      },

      buildLuckysheetRowlen() {
        return {
          0: 28,
          1: 40,
          2: 26,
          3: 26
        };
      },

      /**
       * Luckysheet 数据验证：下拉列表（与 Excel 数据有效性类似）
       * 文档：https://dream-num.github.io/LuckysheetDocs/zh/guide/sheet.html#dataverification
       * 注意：value1 仅支持英文逗号分隔；若某选项文本内含英文逗号则该格不下发校验。
       */
      buildLuckysheetDataVerification() {
        var dv = {};
        var fields = this.tableFields;
        var projs = this.filteredProjects;
        for (var i = 0; i < projs.length; i++) {
          var p = projs[i];
          for (var k = 0; k < fields.length; k++) {
            var fld = fields[k];
            if (!fld.enum_values || !fld.enum_values.length) continue;
            var ro = !this.canEditField(fld) || !this.canEdit;
            if (ro) continue;
            var hasCommaInOption = false;
            for (var e = 0; e < fld.enum_values.length; e++) {
              if (String(fld.enum_values[e]).indexOf(',') >= 0) {
                hasCommaInOption = true;
                break;
              }
            }
            if (hasCommaInOption) continue;
            var lay = this.lsLayout();
            var r = lay.dataStart + i;
            var c = k + 1;
            var value1 = fld.enum_values.map(function (ev) { return String(ev).trim(); }).join(',');
            dv[String(r) + '_' + String(c)] = {
              type: 'dropdown',
              type2: false,
              value1: value1,
              value2: '',
              prohibitInput: true,
              hintShow: false,
              hintText: '',
              remote: false,
              checked: false
            };
          }
        }
        return dv;
      },

      destroyLuckysheet() {
        try {
          if (typeof luckysheet !== 'undefined' && luckysheet && typeof luckysheet.destroy === 'function') {
            luckysheet.destroy();
          }
        } catch (e) { /* ignore */ }
      },

      initLuckysheet() {
        var self = this;
        if (typeof luckysheet === 'undefined' || !luckysheet || typeof luckysheet.create !== 'function') {
          this.$message.warning('Luckysheet 未正确加载，请检查网络或 CDN');
          return;
        }
        if (document.getElementById('luckysheet-mount') == null) return;

        this.destroyLuckysheet();
        this._lsLoading = true;

        var lay = this.lsLayout();
        var rows = Math.max(48, lay.dataEnd + 12);
        var cols = Math.max(64, this.tableFields.length + 4);
        var celldata = this.buildLuckysheetCelldata();

        luckysheet.create({
          container: 'luckysheet-mount',
          showinfobar: false,
          showsheetbar: false,
          showstatisticBar: false,
          showtoolbar: true,
          enableAddRow: false,
          enableAddBackTop: false,
          row: rows,
          column: cols,
          data: [{
            name: '项目执行跟踪',
            index: 'ptrack_sheet',
            status: 1,
            order: 0,
            celldata: celldata,
            dataVerification: this.buildLuckysheetDataVerification(),
            frozen: {
              type: 'rangeBoth',
              range: { row_focus: LS_FROZEN_ROW, column_focus: LS_FROZEN_COL }
            },
            config: {
              columnlen: this.buildLuckysheetColumnlen(),
              merge: this.buildLuckysheetMerge(),
              customWidth: 1,
              rowlen: this.buildLuckysheetRowlen()
            }
          }],
          hook: {
            workbookCreateAfter: function () {
              self._lsLoading = false;
            },
            cellEditBefore: function (range) {
              if (self._lsLoading) return false;
              if (!range || !range.length) return true;
              var item = range[0];
              var r = item.row_focus != null ? item.row_focus : item.row[0];
              var c = item.column_focus != null ? item.column_focus : item.column[0];
              return self.canEditLuckysheetCell(r, c);
            },
            cellUpdateBefore: function (r, c, value, isRefresh) {
              if (self._lsLoading) return false;
              return self.canEditLuckysheetCell(r, c);
            },
            cellUpdated: function (r, c, oldValue, newValue, isRefresh) {
              if (self._lsLoading || isRefresh) return;
              var projs = self.filteredProjects;
              var layout = self.lsLayout();
              if (r < layout.dataStart || r > layout.dataEnd) return;
              var field = self.tableFields[c - 1];
              if (!field || !self.canEditLuckysheetCell(r, c)) return;
              var project = projs[r - layout.dataStart];
              var newVal = self.coerceFieldValue(self.extractLuckysheetInput(newValue), field);
              var oldFlat = FieldConfig.arraysToFlat(project);
              var key = FieldConfig.COL_TO_KEY[field.col];
              var oldVal = oldFlat[key];
              if (newVal === oldVal) return;
              if (String(newVal) === String(oldVal)) return;
              self.handleCellEdit(project, field, newVal, { fromLuckysheet: true })
                .then(function () { self.scheduleRefreshLuckysheet(); })
                .catch(function () { self.scheduleRefreshLuckysheet(); });
            }
          }
        });
      },

      refreshLuckysheet() {
        if (this.activeTab !== 'luckysheet') return;
        this.initLuckysheet();
      },

      scheduleRefreshLuckysheet() {
        var self = this;
        if (this.activeTab !== 'luckysheet') return;
        if (this._lsRefreshTimer) clearTimeout(this._lsRefreshTimer);
        this._lsRefreshTimer = setTimeout(function () {
          self._lsRefreshTimer = null;
          self.refreshLuckysheet();
        }, 80);
      }
    },
    template: `
      <div style="display:flex;flex-direction:column;height:100%;">
        <!-- 工具栏 -->
        <div class="editor-toolbar">
          <!-- 填报期状态 -->
          <span class="period-banner" :class="lockBannerClass" style="flex-shrink:0;">
            <span class="period-dot"></span>
            {{ lockBannerText }}
          </span>

          <div style="flex:1;"></div>

          <!-- 视图切换 -->
          <el-radio-group v-model="viewMode" size="small" class="view-toggle">
            <el-radio-button label="all">全部（{{ store.projects.length }}）</el-radio-button>
            <el-radio-button label="new_only">
              新增项目（{{ store.projects.filter(p=>p._added_this_month).length }}）
            </el-radio-button>
            <el-radio-button label="changed_only">
              有变更（{{ store.projects.filter(p=>p._changed_fields&&p._changed_fields.length).length }}）
            </el-radio-button>
          </el-radio-group>

          <el-divider direction="vertical"></el-divider>

          <!-- 操作按钮 -->
          <el-button
            size="small"
            icon="el-icon-download"
            :loading="exportLoading"
            @click="handleExport"
          >导出 Excel</el-button>

          <el-button
            v-if="canSubmit"
            size="small"
            type="primary"
            icon="el-icon-s-promotion"
            style="background:#007069;border-color:#007069;"
            :loading="submitLoading"
            @click="handleSubmit"
          >提交审批</el-button>
        </div>

        <!-- 图例说明 -->
        <div v-if="showDiffHint" style="padding:6px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:16px;font-size:12px;color:#92400e;flex-shrink:0;">
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(0,112,105,0.15);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>本月新增项目</span>
          <span><span style="display:inline-block;width:4px;height:12px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>本月有变更字段</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>系统只读字段</span>
          <span style="flex:1;"></span>
          <span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>
        </div>

        <!-- 填报主体：Luckysheet（默认）+ 经典 HTML 表格 -->
        <div class="luckysheet-editor-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column;">
          <div style="flex-shrink:0;padding:6px 12px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;">
            <span style="font-size:12px;color:#64748b;">填报视图：</span>
            <el-radio-group v-model="activeTab" size="mini">
              <el-radio-button label="luckysheet">Luckysheet（类 Excel）</el-radio-button>
              <el-radio-button label="table">经典 HTML 表格</el-radio-button>
            </el-radio-group>
          </div>
          <div v-show="activeTab === 'luckysheet'" id="luckysheet-mount" style="flex:1;min-height:360px;width:100%;"></div>
          <div v-show="activeTab === 'table'" style="flex:1;overflow:auto;position:relative;min-height:200px;">
          <table class="editor-table" style="border-collapse:collapse;min-width:max-content;font-size:12px;">
            <!-- 分区标题行 -->
            <thead>
              <tr>
                <th
                  style="position:sticky;left:0;z-index:20;background:#0f2027;color:#fff;padding:6px 10px;white-space:nowrap;border:1px solid #334155;min-width:50px;"
                >序号</th>
                <template v-for="sec in tableSections">
                  <th
                    :colspan="sec.fields.length"
                    :key="'sec-'+sec.name"
                    :style="{
                      background: '#1e3a5f',
                      color: '#fff',
                      padding: '6px 10px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      border: '1px solid #334155',
                      fontSize: '12px',
                      fontWeight: '600'
                    }"
                  >{{ sec.name }}</th>
                </template>
              </tr>
              <!-- 字段名行 -->
              <tr>
                <th style="position:sticky;left:0;z-index:20;background:#f1f5f9;padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap;color:#1e293b;">#</th>
                <th
                  v-for="field in tableFields"
                  :key="'fh-'+field.col"
                  :style="{
                    background: field.source_type === 'manual_input' ? '#fff' : '#f1f5f9',
                    padding: '5px 8px',
                    border: '1px solid #e2e8f0',
                    whiteSpace: 'nowrap',
                    minWidth: field.colWidth + 'px',
                    color: field.source_type === 'manual_input' ? '#007069' : '#475569',
                    fontWeight: '600',
                    fontSize: '11px',
                    textAlign: 'center'
                  }"
                >
                  <div>{{ field.name_cn }}</div>
                  <div style="font-size:10px;color:#94a3b8;font-weight:400;">{{ field.col }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(project, ri) in filteredProjects"
                :key="project.project_no"
                :class="getRowClass(project)"
                :style="project._added_this_month ? {background:'rgba(0,112,105,0.07)'} : {}"
              >
                <td style="position:sticky;left:0;z-index:10;background:#f8fafc;padding:4px 8px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:11px;">{{ ri+1 }}</td>
                <td
                  v-for="field in tableFields"
                  :key="'c-'+field.col"
                  :class="cellClass(project, field)"
                  :style="{
                    padding: '4px 8px',
                    border: '1px solid #e2e8f0',
                    background: field.source_type !== 'manual_input' ? '#f8fafc' : (project._added_this_month ? 'rgba(0,112,105,0.05)' : '#fff'),
                    textAlign: field.data_type === '金额' || field.data_type === '比率' ? 'right' : 'left',
                    minWidth: field.colWidth + 'px',
                    position: 'relative',
                    whiteSpace: field.data_type === '文本' ? 'normal' : 'nowrap',
                    maxWidth: field.data_type === '文本' ? '200px' : 'none',
                    overflow: field.data_type === '文本' ? 'hidden' : 'visible',
                    textOverflow: field.data_type === '文本' ? 'ellipsis' : 'clip',
                    fontVariantNumeric: field.data_type === '金额' ? 'tabular-nums' : 'normal',
                    color: isFieldChanged(project, field) ? '#b45309' : 'inherit'
                  }"
                >
                  <!-- 变更标记条 -->
                  <span
                    v-if="isFieldChanged(project, field)"
                    style="position:absolute;top:0;left:0;width:3px;height:100%;background:#f59e0b;"
                  ></span>
                  <!-- 可编辑字段 + 枚举下拉 -->
                  <template v-if="canEditField(field) && canEdit">
                    <el-select
                      v-if="field.enum_values && field.enum_values.length"
                      :value="getCellValue(project, field)"
                      size="mini"
                      style="width:100%;"
                      @change="v => handleCellEdit(project, field, v)"
                    >
                      <el-option v-for="ev in field.enum_values" :key="ev" :label="ev" :value="ev"></el-option>
                    </el-select>
                    <el-input-number
                      v-else-if="field.data_type === '金额'"
                      :value="getCellValue(project, field)"
                      size="mini"
                      :precision="2"
                      :controls="false"
                      style="width:100%;"
                      @change="v => handleCellEdit(project, field, v || 0)"
                    ></el-input-number>
                    <el-input
                      v-else
                      :value="getCellValue(project, field)"
                      size="mini"
                      @change="v => handleCellEdit(project, field, v)"
                    ></el-input>
                  </template>
                  <!-- 只读展示 -->
                  <template v-else>
                    <span :class="field.data_type === '金额' ? 'amount' : ''">
                      {{ formatCellValue(getCellValue(project, field), field) }}
                    </span>
                  </template>
                </td>
              </tr>
              <tr v-if="filteredProjects.length === 0">
                <td :colspan="tableFields.length + 1" style="text-align:center;padding:40px;color:#94a3b8;border:1px solid #e2e8f0;">
                  <i class="el-icon-document" style="font-size:24px;"></i>
                  <div style="margin-top:8px;font-size:13px;">暂无符合条件的项目</div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <!-- 底部状态栏 -->
        <div style="padding:6px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;font-size:11px;color:#64748b;flex-shrink:0;">
          <span>共 {{ filteredProjects.length }} 条记录</span>
          <span>报告月份：{{ store.reportingMonth }}</span>
          <span>当前角色：{{ user.name || '—' }}</span>
          <span v-if="lockStatus !== 'open'" style="color:#ef4444;font-weight:500;">
            <i class="el-icon-lock"></i> 编辑受限
          </span>
        </div>
      </div>
    `,
    // 计算分区列表（用于表头分组）
    computed: {
      store()   { return window.Store; },
      user()    { return Store.currentUser || {}; },
      lockStatus() { return Store.lockStatus; },
      monthIdx()   { return Store.getMonthIdx(); },
      canSubmit() {
        const r = this.user.role;
        return (r === 'pm' || r === 'sector_admin') && this.lockStatus === 'open';
      },
      canEdit() { return this.lockStatus !== 'locked' || this.user.role === 'system_admin'; },
      filteredProjects() {
        const p = this.tableProjects;
        if (this.viewMode === 'new_only')     return p.filter(x => x._added_this_month);
        if (this.viewMode === 'changed_only') return p.filter(x => x._changed_fields && x._changed_fields.length > 0);
        return p;
      },
      lockBannerClass() {
        return { open:'open', finance_only:'finance-only', locked:'locked' }[this.lockStatus] || 'open';
      },
      lockBannerText() {
        return {
          open:         '填报窗口开放中 — 可正常填报',
          finance_only: '财务专属期（1-3日）— 仅财务审核可编辑开票/回款',
          locked:       '数据已锁定（每月25日）— 仅管理员可临时解锁编辑'
        }[this.lockStatus] || '';
      },
      tableSections() {
        return FieldConfig.getSections(this.tableFields);
      }
    }
  };
})(window);
