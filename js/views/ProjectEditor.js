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
      cellClass(project, field) {
        const cls = [];
        if (!this.canEditField(field)) cls.push('readonly-cell');
        if (project._added_this_month) cls.push('new-project-cell');
        if (project._changed_fields && project._changed_fields.includes(field.col.toLowerCase()) ||
            (project._changed_fields && project._changed_fields.includes('mc_' + (field.colIdx - 47)))) {
          cls.push('changed-cell');
        }
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

      canEditLuckysheetCell(r, c) {
        if (r === 0 || c === 0) return false;
        const projs = this.filteredProjects;
        if (r < 1 || r - 1 >= projs.length) return false;
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
        if (readonly) return '#f8fafc';
        if (project._added_this_month) return '#e6f2f1';
        if (project._changed_fields && project._changed_fields.indexOf(field.col) >= 0) return '#fff7ed';
        if (field.source_type !== 'manual_input') return '#f8fafc';
        return '#ffffff';
      },

      buildLuckysheetCelldata() {
        const celldata = [];
        const fields = this.tableFields;
        const projs = this.filteredProjects;
        const push = function (r, c, v) {
          celldata.push({ r: r, c: c, v: v });
        };

        push(0, 0, {
          v: '#', m: '#', ct: { fa: 'General', t: 'g' }, bg: '#0f2027', fc: '#ffffff', bl: 1, ht: 0
        });
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j];
          var hl = f.name_cn + '\n(' + f.col + ')';
          push(0, j + 1, {
            v: hl, m: hl, ct: { fa: 'General', t: 'g' }, bg: '#f1f5f9', bl: 1,
            tb: '2', ht: '1', vt: '0'
          });
        }

        for (var i = 0; i < projs.length; i++) {
          var p = projs[i];
          push(i + 1, 0, {
            v: i + 1, m: String(i + 1), ct: { fa: 'General', t: 'g' },
            bg: '#f1f5f9', ht: '0'
          });
          for (var k = 0; k < fields.length; k++) {
            var fld = fields[k];
            var ro = !this.canEditField(fld) || !this.canEdit;
            var bg = this.luckysheetCellBg(p, fld, ro);
            var val = this.getCellValue(p, fld);
            push(i + 1, k + 1, this.makeLuckysheetCell(val, fld, ro, bg));
          }
        }
        return celldata;
      },

      buildLuckysheetColumnlen() {
        var columnlen = { 0: 44 };
        for (var j = 0; j < this.tableFields.length; j++) {
          var f = this.tableFields[j];
          columnlen[j + 1] = Math.min(220, Math.max(72, f.colWidth || 90));
        }
        return columnlen;
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

        var rows = Math.max(48, this.filteredProjects.length + 20);
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
            config: {
              columnlen: this.buildLuckysheetColumnlen(),
              customWidth: 1,
              rowlen: { 0: 40 }
            }
          }],
          hook: {
            workbookCreateAfter: function () {
              try { luckysheet.setBothFrozen(false); } catch (e2) { /* ignore */ }
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
              if (r === 0 || c === 0) return false;
              return self.canEditLuckysheetCell(r, c);
            },
            cellUpdated: function (r, c, oldValue, newValue, isRefresh) {
              if (self._lsLoading || isRefresh) return;
              if (r === 0 || c === 0) return;
              var projs = self.filteredProjects;
              if (r - 1 < 0 || r - 1 >= projs.length) return;
              var field = self.tableFields[c - 1];
              if (!field || !self.canEditLuckysheetCell(r, c)) return;
              var project = projs[r - 1];
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
                    color: (project._changed_fields||[]).includes(field.col) ? '#b45309' : 'inherit'
                  }"
                >
                  <!-- 变更标记条 -->
                  <span
                    v-if="(project._changed_fields||[]).includes(field.col)"
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
