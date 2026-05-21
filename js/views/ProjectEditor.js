/**
 * ProjectEditor.js — 填报表格（Luckysheet 默认；经典 HTML 表格代码保留，UI 已隐藏）
 * 权限控制 + diff高亮 + 视图筛选 + 公式联动
 */
(function (window) {
  'use strict';

  const SECTION_COLORS = {
    '项目基本信息':     '#e8f4f3',
    '合同签署与进展':   '#e8f0fa',
    '合同额':           '#fef3e2',
    '开票差与完成差':   '#fce8e8',
    '存量指标':         '#fce8e8',
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
    '存量指标':         '#00b050',
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
   * 0 小计 | 1 合计 | 2 大类 | 3 字段标题 | 4+ 项目数据
   * 小计/合计置于大分类之上，默认筛选仅覆盖「字段标题 + 数据」行
   * 列：字段字典列号 = Luckysheet 列字母（A→索引0，E→索引4）；无额外「#」列
   */
  const LS_ROW_SUBTOTAL = 0;  // 小计行（Subtotal，用 SUBTOTAL 函数）
  const LS_ROW_SUM = 1;       // 合计行（Total，用 SUM 函数）
  const LS_ROW_SECTION = 2;
  const LS_ROW_HEADER = 3;
  const LS_ROW_DATA_START = 4;
  const LS_FROZEN_ROW = LS_ROW_HEADER;
  const LS_FROZEN_COL = 5; // 冻结至 F 列（项目号），左侧 A–E 固定
  /** 键为字段字典列字母，与 Luckysheet 表头一致 */
  const LS_NARROW_COLS = { D: 60, E: 72, F: 88, G: 110 };
  const LS_SYSTEM_YEAR = 2026;
  /** 月度完成 AV–BG；月度开票 BH,BJ,…；月度回款 BI,BK,… */
  const LS_MC_COLS = ['AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG'];
  const LS_MI_COLS = ['BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV', 'BX', 'BZ', 'CB', 'CD'];
  const LS_MP_COLS = ['BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU', 'BW', 'BY', 'CA', 'CC', 'CE'];
  const LS_ZEBRA_ODD = '#e8eaec';
  const LS_ZEBRA_EVEN = '#ffffff';

  window.ProjectEditorView = {
    name: 'ProjectEditor',
    components: (function () {
      var c = {};
      if (window.SystemAdminSectorDock) c.SystemAdminSectorDock = window.SystemAdminSectorDock;
      if (window.ProjectDetailDrawer) c.ProjectDetailDrawer = window.ProjectDetailDrawer;
      return c;
    })(),
    data() {
      return {
        luckysheetReady: false,
        viewMode: 'all',       // 'all' | 'new_only' | 'changed_only' | 'warning_only'
        compactColumnsOnly: false,
        submitLoading: false,
        saveLoading: false,
        archiveLoading: false,
        importLoading: false,
        exportLoading: false,
        syncLoading: false,
        showDiffHint: true,
        viewingVersion: '__current__',
        snapshotLoading: false,
        snapshotProjects: null,
        _lsResizeObserver: null,
        _lsResizeTimer: null,
        tableFields: [],
        tableProjects: [],
        activeTab: 'luckysheet', // 'luckysheet' | 'table'（仅 showLegacyHtmlTable 为 true 时可切 table）
        /** 经典 HTML 表格：代码保留，默认不展示；改 true 可恢复双模式调试 */
        showLegacyHtmlTable: false,
        _lsLoading: false,
        _lsRefreshTimer: null,
        _lsFilterScrollHandler: null,
        // 板块管理员 PM diff 面板
        pmDiffVisible: false,
        pmDiffName: '',
        pmDiffResults: [],
        pmDiffColLeft: '填报基准',
        pmDiffColRight: '提交值',
        _pmBaselineCaptured: false,
        _pmBaselinePromise: null,
        _cellSaveChain: null,
        projectDrawerVisible: false,
        projectDrawerProject: null,
        projectDrawerRowIndex: null,
        projectDrawerSaving: false,
        _lsProjectNoMouseUp: null,
      };
    },
    mounted() {
      const self = this;
      this.tableFields = FieldConfig.buildFieldConfig();
      this.buildTableData();
      this.whenPmBaselineReady(function () {
        if (self.activeTab === 'luckysheet') {
          self.$nextTick(function () { self.initLuckysheet(); }.bind(self));
        }
      });
      this.$nextTick(function () { this.setupLuckysheetResizeObserver(); }.bind(this));
      this._unwatchSidebar = this.$watch(
        function () { return Store.sidebarCollapsed; },
        function () { this.resizeLuckysheetLayout(); }.bind(this)
      );
    },
    activated() {
      const self = this;
      const afterData = function () {
        if (self.viewingVersion !== '__current__') {
          self.handleViewingVersionChange(self.viewingVersion);
        } else {
          self.buildTableData();
        }
        self.whenPmBaselineReady(function () {
          if (self.activeTab === 'luckysheet') {
            self.$nextTick(function () { self.refreshLuckysheet(); }.bind(self));
          }
        });
      };
      if (Store.currentUser && Store.currentUser.role === 'sector_admin') {
        Store.syncPmWorkflow().then(afterData).catch(afterData);
      } else if (Store.currentUser && Store.currentUser.role === 'system_admin') {
        Store.init().then(afterData).catch(afterData);
      } else {
        afterData();
      }
    },
    beforeDestroy() {
      if (this._lsRefreshTimer) {
        clearTimeout(this._lsRefreshTimer);
        this._lsRefreshTimer = null;
      }
      if (this._lsResizeTimer) {
        clearTimeout(this._lsResizeTimer);
        this._lsResizeTimer = null;
      }
      this.teardownLuckysheetResizeObserver();
      if (this._unwatchSidebar) {
        this._unwatchSidebar();
        this._unwatchSidebar = null;
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
      compactColumnsOnly: function () {
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
      },
      viewingVersion: function (val) {
        this.handleViewingVersionChange(val);
      },
    },
    methods: {
      buildTableData() {
        const source = (this.isViewingSnapshot && this.snapshotProjects)
          ? this.snapshotProjects
          : Store.projects;
        const self = this;
        this.tableProjects = FormulaEngine.computeAll(source, this.monthIdx).map(function (p) {
          if (self.isViewingSnapshot || !window.ChangeMeta) return p;
          const sp = Store.projects.find(function (x) { return x.project_no === p.project_no; });
          return ChangeMeta.attachChangeTracking(p, sp);
        });
        if (!this.isViewingSnapshot && window.ProjectMonthDiff) {
          const priorSnap = ProjectMonthDiff.resolvePriorSnapshot(
            Store.snapshots,
            Store.reportingMonth,
            Store.priorMonthSnapshotVersion
          );
          if (priorSnap && priorSnap.projects) {
            this.tableProjects = ProjectMonthDiff.applyAddedThisMonthFlags(
              this.tableProjects,
              priorSnap.projects
            );
          }
        }
        if (!this.isViewingSnapshot) {
          this.capturePmBaselineFromTable();
        }
      },

      getStoreProject(projectNo) {
        return Store.projects.find(function (p) { return p.project_no === projectNo; });
      },

      capturePmBaselineFromTable() {
        const user = Store.currentUser || {};
        if (user.role !== 'pm') return;
        const pmName = user.pmName || user.name;
        if (!pmName || !Store.canPmSubmit(pmName)) return;
        const sub = Store.getPmSubmission(pmName) || {};
        if (sub.status === 'submitted') return;
        if (this._pmBaselineCaptured) return;
        if (sub.baselineSnapshotVersion && sub.status !== 'received') {
          this._pmBaselineCaptured = true;
          return;
        }
        const scoped = this.tableProjects.filter(function (p) {
          return p.pm_name === pmName;
        });
        const clone = JSON.parse(JSON.stringify(scoped));
        this._pmBaselineCaptured = true;
        this._pmBaselinePromise = Store.ensurePmBaseline(pmName, clone);
      },

      whenPmBaselineReady(cb) {
        const user = Store.currentUser || {};
        if (user.role !== 'pm' || !this._pmBaselinePromise) {
          cb();
          return;
        }
        this._pmBaselinePromise.then(function () { cb(); }).catch(function () { cb(); });
      },
      canEditField(field) {
        return FieldConfig.canEdit(field, this.user.role, this.lockStatus, this.monthIdx);
      },

      /** 当前角色/锁定期下该列是否可填报（用于表头配色） */
      isEditableColumnHeader(field) {
        return this.canEditField(field) && this.canEdit;
      },

      /** Luckysheet 工作表保护：lo=1 锁定，lo=0 可编辑（需 config.authority.sheet=1） */
      lsApplyCellLock(cell, locked) {
        cell.lo = locked ? 1 : 0;
        return cell;
      },

      /** 金额列：Luckysheet 数字类型 + 右对齐 */
      applyLuckysheetAmountColumnStyle(cell, field) {
        if (!cell || !field || field.data_type !== '金额') return cell;
        cell.ht = field.luckysheetHt || '2';
        cell.ct = field.luckysheetCt || { fa: '#,##0.00', t: 'n' };
        if (cell.v != null && cell.v !== '') {
          const n = Number(String(cell.v).replace(/,/g, ''));
          if (!isNaN(n)) cell.v = n;
        }
        return cell;
      },

      isLuckysheetAmountInputValid(raw) {
        if (raw == null || raw === '') return true;
        const s = String(raw).trim().replace(/,/g, '');
        if (s === '' || s === '-' || s === '.') return false;
        return !isNaN(Number(s));
      },

      buildLuckysheetAuthority() {
        return {
          sheet: 1,
          hintText: '该单元格不可编辑（只读列、历史/当月开票回款或当前无权限）',
          selectLockedCells: 1,
          selectunLockedCells: 1,
          formatCells: 0,
          formatColumns: 0,
          formatRows: 0,
          insertColumns: 0,
          insertRows: 0,
          insertHyperlinks: 0,
          deleteColumns: 0,
          deleteRows: 0,
          sort: 0,
          filter: 1,
          usePivotTablereports: 0,
          editObjects: 0,
          editScenarios: 0
        };
      },

      /** 紧凑列视图：项目基本信息 + 当前角色可编辑列 */
      shouldShowCompactColumn(field) {
        if (!this.compactColumnsOnly) return true;
        return field.section === '项目基本信息' || this.canEditField(field);
      },

      buildLuckysheetColhidden() {
        if (!this.compactColumnsOnly) return {};
        const hidden = {};
        this.tableFields.forEach(function (field, c) {
          if (!this.shouldShowCompactColumn(field)) hidden[String(c)] = 0;
        }, this);
        return hidden;
      },

      buildLuckysheetCellRightClickConfig() {
        return {
          copy: false,
          copyAs: false,
          paste: false,
          insertRow: false,
          insertColumn: false,
          deleteRow: false,
          deleteColumn: false,
          deleteCell: false,
          hideRow: false,
          hideColumn: false,
          rowHeight: false,
          columnWidth: false,
          clear: false,
          matrix: false,
          sort: false,
          filter: true,
          chart: false,
          image: false,
          link: false,
          data: false,
          cellFormat: false
        };
      },

      buildLuckysheetRowHeaderRightClickConfig() {
        return {
          insertRow: false,
          deleteRow: false,
          hideRow: false,
          rowHeight: false
        };
      },

      buildLuckysheetColumnHeaderRightClickConfig() {
        return {
          insertColumn: false,
          deleteColumn: false,
          hideColumn: false,
          columnWidth: false
        };
      },
      isFieldChanged(project, field) {
        const cols = project._changed_fields;
        if (!cols || !cols.length) return false;
        if (cols.indexOf(field.col) >= 0) return true;
        if (cols.indexOf(field.col.toLowerCase()) >= 0) return true;
        if (cols.indexOf('mc_' + (field.colIdx - 47)) >= 0) return true;
        return false;
      },

      isEditableDataCell(project, field) {
        if (!this.canEditField(field) || !this.canEdit) return false;
        if (window.ChangeMeta && ChangeMeta.hasFieldChangeMarkup(project, field)) return false;
        if (this.isFieldChanged(project, field)) return false;
        return true;
      },

      cellClass(project, field) {
        const cls = [];
        if (!this.canEditField(field)) cls.push('readonly-cell');
        if (FieldConfig.isPastReportingMonthField(field, this.monthIdx)) {
          cls.push('month-locked-cell');
        }
        if (window.StockValidation && StockValidation.isStockWarningCell(project, field, this.monthIdx)) {
          cls.push('field-stock-warning');
        }
        if (project._added_this_month) cls.push('new-project-cell');
        if (window.ChangeMeta
          ? ChangeMeta.hasFieldChangeMarkup(project, field)
          : this.isFieldChanged(project, field)) {
          cls.push('field-changed');
        } else if (this.isEditableDataCell(project, field)) {
          cls.push('field-editable');
        }
        return cls.join(' ');
      },

      cellTdStyle(project, field) {
        const base = {
          padding: '4px 8px',
          border: '1px solid #e2e8f0',
          textAlign: field.data_type === '金额' || field.data_type === '比率' ? 'right' : 'left',
          minWidth: field.colWidth + 'px',
          position: 'relative',
          whiteSpace: field.data_type === '文本' ? 'normal' : 'nowrap',
          maxWidth: field.data_type === '文本' ? '200px' : 'none',
          overflow: field.data_type === '文本' ? 'hidden' : 'visible',
          textOverflow: field.data_type === '文本' ? 'ellipsis' : 'clip',
          fontVariantNumeric: field.data_type === '金额' ? 'tabular-nums' : 'normal'
        };
        if (window.StockValidation && StockValidation.isStockWarningCell(project, field, this.monthIdx)) {
          base.background = StockValidation.STOCK_WARNING_STYLE.bg;
          base.color = StockValidation.STOCK_WARNING_STYLE.fc;
          return base;
        }
        if (this.isEditableDataCell(project, field)) {
          return base;
        }
        if (field.source_type !== 'manual_input') {
          base.background = '#f8fafc';
        }
        return base;
      },

      cellChangeTitle(project, field) {
        if (!window.ChangeMeta || !ChangeMeta.hasFieldChangeMarkup(project, field)) return '';
        return ChangeMeta.formatChangeComment(project, field, Store.auditLog);
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
      _trackCellSave(work) {
        const run = Promise.resolve(this._cellSaveChain).then(function () { return work; });
        this._cellSaveChain = run.catch(function () {});
        return run;
      },

      _waitCellSaves() {
        return Promise.resolve(this._cellSaveChain).catch(function () {});
      },

      /** 结束编辑态，把 Luckysheet 里未触发 cellUpdated 的格子写入库 */
      async flushLuckysheetToStore() {
        if (this.isViewingSnapshot) return;
        if (this.activeTab !== 'luckysheet' || typeof luckysheet === 'undefined') return;
        try {
          if (luckysheet.exitEditMode) luckysheet.exitEditMode();
        } catch (e) { /* ignore */ }
        await new Promise(function (r) { setTimeout(r, 120); });
        await this._waitCellSaves();

        const file = this.lsGetActiveLuckysheetFile();
        if (!file || !file.data) return;
        const layout = this.lsLayout();
        const data = file.data;
        const n = this.filteredProjects.length;
        for (let i = 0; i < n; i++) {
          const r = layout.dataStart + i;
          const row = data[r];
          if (!row) continue;
          const project = this.filteredProjects[i];
          if (!project) continue;
          const storeProject = this.getStoreProject(project.project_no) || project;
          for (let c = 0; c < this.tableFields.length; c++) {
            const field = this.tableFields[c];
            if (!field || !this.canEditField(field) || !this.canEdit) continue;
            if (field.source_type === 'auto_calc' || field.source_type === 'system_sync') continue;
            const cell = row[c];
            const newVal = this.coerceFieldValue(this.extractLuckysheetInput(cell), field);
            const key = FieldConfig.COL_TO_KEY[field.col];
            const oldFlat = FieldConfig.arraysToFlat(storeProject);
            const oldVal = oldFlat[key];
            if (newVal === oldVal || String(newVal) === String(oldVal)) continue;
            await this.handleCellEdit(project, field, newVal, {
              fromLuckysheet: true,
              lsRow: r,
              lsCol: c
            });
          }
        }
        await this._waitCellSaves();
        this.syncAllLuckysheetChangeDecor();
      },

      async persistLuckysheetBeforeSubmit() {
        return this.flushLuckysheetToStore();
      },

      async handleSave() {
        if (!this.canEdit) return;
        this.saveLoading = true;
        try {
          await this.flushLuckysheetToStore();
          this.buildTableData();
          this.syncAllLuckysheetChangeDecor();
          this.$message.success('已保存（未提交的编辑已写入数据库）');
        } catch (e) {
          this.$message.error('保存失败：' + (e.message || e));
        } finally {
          this.saveLoading = false;
        }
      },

      handleSubmitArchive() {
        if (!this.canShowArchiveButton) return;
        if (Store.isCompanyArchived()) {
          this.$message.info('已完成公司归档');
          return;
        }
        const self = this;
        this.$confirm(
          '确认全公司归档？将生成 J版 快照（含全部项目）。',
          '提交归档',
          { confirmButtonText: '确认归档', cancelButtonText: '取消', type: 'warning' }
        ).then(function () {
          self.archiveLoading = true;
          return Store.archiveCompany();
        }).then(function () {
          self.$message.success('已生成 J版 全公司归档快照');
        }).catch(function (e) {
          if (e !== 'cancel' && e !== 'close') {
            self.$message.error('归档失败：' + (e && e.message ? e.message : e));
          }
        }).finally(function () {
          self.archiveLoading = false;
        });
      },

      onImportFileChange(e) {
        const file = e.target && e.target.files && e.target.files[0];
        if (!file) return;
        const self = this;
        this.importLoading = true;
        XlsxImporter.importFromFile(file)
          .then(function (result) {
            const imported = result.projects || [];
            if (imported.length === 0) {
              self.$message.error('未识别到有效数据，请检查文件格式');
              return;
            }
            const scopeFilter = self.isPm
              ? function (p) { return p.pm_name === self.pmName; }
              : function () { return true; };
            const merged = ImportMerge.mergeImportedProjects(
              imported,
              Store.projects,
              {
                role: self.user.role,
                user: self.user,
                lockStatus: self.lockStatus,
                monthIdx: self.monthIdx,
                scopeFilter: scopeFilter
              }
            );
            if (merged.updates.length === 0) {
              self.$message.warning(
                '没有可合并的更新（跳过 ' + merged.skipped.length + ' 条）'
              );
              return;
            }
            return self.$confirm(
              '将按项目号更新 ' + merged.updates.length + ' 条项目的可编辑字段' +
              (merged.skipped.length ? '，跳过 ' + merged.skipped.length + ' 条' : '') +
              '。确认导入？',
              '上传导入确认',
              { confirmButtonText: '确认导入', cancelButtonText: '取消', type: 'warning' }
            ).then(function () {
              var chain = Promise.resolve();
              merged.updates.forEach(function (p) {
                chain = chain.then(function () { return Store.updateProject(p); });
              });
              return chain.then(function () {
                return Store.addAuditLog({
                  projectNo: '—',
                  projectName: 'Excel导入',
                  fieldName: 'import',
                  fieldCN: '填报页导入',
                  oldVal: '—',
                  newVal: merged.updates.length + ' 条',
                  userId: self.user.role,
                  userName: self.user.name
                });
              }).then(function () {
                self.buildTableData();
                self.$nextTick(function () { self.refreshLuckysheet(); });
                self.$message.success('成功导入并更新 ' + merged.updates.length + ' 条项目');
              });
            });
          })
          .catch(function (err) {
            if (err === 'cancel' || err === 'close') return;
            self.$message.error('导入失败：' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            self.importLoading = false;
            if (e.target) e.target.value = '';
          });
      },

      async handleViewingVersionChange(val) {
        if (val === '__current__') {
          this.snapshotProjects = null;
          this.buildTableData();
          this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
          return;
        }
        this.snapshotLoading = true;
        try {
          const snap = await Store.fetchSnapshot(val);
          if (!snap || !snap.projects) {
            this.$message.warning('快照不存在或已过期');
            this.viewingVersion = '__current__';
            return;
          }
          this.snapshotProjects = snap.projects;
          this.buildTableData();
          this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
        } catch (e) {
          this.$message.error('加载版本失败：' + (e.message || e));
          this.viewingVersion = '__current__';
        } finally {
          this.snapshotLoading = false;
        }
      },

      formatSnapshotTime(iso, withSeconds) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const opts = { hour: '2-digit', minute: '2-digit' };
        if (withSeconds) opts.second = '2-digit';
        return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', opts);
      },

      resolveSnapshotTime(versionKey, snap) {
        if (snap && snap.time) return snap.time;
        const parts = String(versionKey || '').split(':');
        const last = parts[parts.length - 1];
        if (/^\d{10,}$/.test(last)) return new Date(Number(last)).toISOString();
        return null;
      },

      formatSnapshotOptionLabel(versionKey, snap) {
        const ORDER_LABELS = {
          Draft: '草稿',
          Approve1: '初审',
          Approve2: '复审',
          'J版': 'J版'
        };
        const iso = this.resolveSnapshotTime(versionKey, snap);
        const timeStr = iso ? this.formatSnapshotTime(iso, true) : '时间未知';
        if (ORDER_LABELS[versionKey]) {
          return ORDER_LABELS[versionKey] + ' · ' + timeStr;
        }
        const monthM = /^Month:(\d{4})-(\d{2})$/.exec(versionKey);
        if (monthM) {
          return monthM[1] + '年' + parseInt(monthM[2], 10) + '月归档 · ' + timeStr;
        }
        if (snap && snap.label) {
          return snap.label + ' · ' + timeStr;
        }
        return timeStr;
      },

      setupLuckysheetResizeObserver() {
        var self = this;
        this.teardownLuckysheetResizeObserver();
        var el = document.getElementById(this.lsMountId);
        if (!el || typeof ResizeObserver === 'undefined') return;
        this._lsResizeObserver = new ResizeObserver(function () {
          self.resizeLuckysheetLayout();
        });
        this._lsResizeObserver.observe(el);
      },

      teardownLuckysheetResizeObserver() {
        if (this._lsResizeObserver) {
          this._lsResizeObserver.disconnect();
          this._lsResizeObserver = null;
        }
      },

      resizeLuckysheetLayout() {
        if (this._lsLoading) return;
        var self = this;
        if (this._lsResizeTimer) clearTimeout(this._lsResizeTimer);
        this._lsResizeTimer = setTimeout(function () {
          self._lsResizeTimer = null;
          try {
            window.dispatchEvent(new Event('resize'));
            if (typeof luckysheet !== 'undefined' && luckysheet) {
              if (typeof luckysheet.refresh === 'function') {
                luckysheet.refresh();
              } else if (typeof luckysheet.jfrefreshgrid === 'function') {
                luckysheet.jfrefreshgrid();
              }
            }
          } catch (err) { /* ignore */ }
        }, 260);
      },

      async preparePmSubmit() {
        await this.flushLuckysheetToStore();
        await Store.syncPmProjectsToServer(this.pmName, this.monthIdx);
      },

      applyPmSubmitSnapshotToStore(result) {
        if (!result || !result.snapshot || !result.snapshot.projects) return;
        result.snapshot.projects.forEach(function (sp) {
          const idx = Store.projects.findIndex(function (p) { return p.project_no === sp.project_no; });
          if (idx >= 0) Vue.set(Store.projects, idx, sp);
        });
        this.buildTableData();
      },

      async _applyFieldChangesToProject(storeProject, changes, user) {
        if (!changes || !changes.length) return storeProject;
        const self = this;
        const flat = FieldConfig.arraysToFlat(storeProject);
        changes.forEach(function (ch) {
          flat[ch.key] = ch.newVal;
        });
        const updated = FieldConfig.flatToArrays(flat);
        const tracking = window.ChangeMeta
          ? ChangeMeta.mergeChangeTracking(storeProject)
          : { _field_change_log: {}, _changed_fields: [] };
        const changeLog = tracking._field_change_log;
        changes.forEach(function (ch) {
          if (window.ChangeMeta) {
            ChangeMeta.recordFieldChangeLog(
              { _field_change_log: changeLog }, ch.field, ch.oldVal, ch.newVal, user
            );
          }
        });
        if (window.ChangeMeta) {
          Object.keys(changeLog).forEach(function (col) {
            changeLog[col] = ChangeMeta.dedupeChangeLogList(changeLog[col]);
          });
        }
        const recomputed = FormulaEngine.compute(updated, self.monthIdx);
        recomputed._field_change_log = changeLog;
        recomputed._changed_fields = tracking._changed_fields.slice();
        changes.forEach(function (ch) {
          if (recomputed._changed_fields.indexOf(ch.field.col) < 0) {
            recomputed._changed_fields.push(ch.field.col);
          }
        });
        Object.keys(changeLog).forEach(function (col) {
          if (recomputed._changed_fields.indexOf(col) < 0) {
            recomputed._changed_fields.push(col);
          }
        });

        await Store.updateProject(recomputed);
        for (let i = 0; i < changes.length; i++) {
          const ch = changes[i];
          await Store.addAuditLog({
            projectNo:   storeProject.project_no,
            projectName: storeProject.project_name,
            fieldName:   ch.field.col,
            fieldCN:     ch.field.name_cn,
            oldVal:      Formatters.formatByType(ch.oldVal, ch.field.data_type),
            newVal:      Formatters.formatByType(ch.newVal, ch.field.data_type),
            userId:      user.role,
            userName:    user.name
          });
        }
        self.buildTableData();
        return recomputed;
      },

      async handleCellEdit(project, field, newVal, opts) {
        if (!this.canEditField(field)) return;
        const key = FieldConfig.COL_TO_KEY[field.col];
        const flat = FieldConfig.arraysToFlat(project);
        const oldVal = flat[key];
        if (oldVal === newVal) return;
        if (String(oldVal) === String(newVal)) return;

        if (window.StockValidation && StockValidation.isCompletionField(field)) {
          const storeProj = this.getStoreProject(project.project_no) || project;
          const check = StockValidation.validateCompletionEdit(
            storeProj, field, newVal, this.monthIdx
          );
          if (!check.ok) {
            this.$message.warning(check.message);
            if (opts && opts.fromLuckysheet) this.scheduleRefreshLuckysheet();
            return Promise.reject(new Error(check.message));
          }
        }

        const self = this;
        return this._trackCellSave((async function () {
          const storeProj = self.getStoreProject(project.project_no) || project;
          const recomputed = await self._applyFieldChangesToProject(storeProj, [{
            field: field,
            key: key,
            oldVal: oldVal,
            newVal: newVal
          }], self.user);
          if (opts && opts.fromLuckysheet && self.activeTab === 'luckysheet') {
            const fresh = self.getStoreProject(project.project_no) || recomputed;
            if (opts.lsRow != null) {
              const rowIdx = opts.lsRow - self.lsLayout().dataStart;
              self.syncLuckysheetProjectRowValues(rowIdx, fresh);
              self.recalcLuckysheetFormulas();
              setTimeout(function () {
                self.syncLuckysheetProjectRowDecor(rowIdx, fresh);
              }, 320);
            }
          } else if ((!opts || !opts.fromLuckysheet) && self.activeTab === 'luckysheet') {
            self.scheduleRefreshLuckysheet();
          }
        })().catch(function (e) {
          self.$message.error('保存失败：' + (e.message || e));
          throw e;
        }));
      },

      openProjectDrawer(projectNo, dataRowIndex) {
        var list = this.filteredProjects;
        var project = dataRowIndex >= 0 ? list[dataRowIndex] : null;
        if (!project || project.project_no !== projectNo) {
          project = list.find(function (p) { return p.project_no === projectNo; });
          dataRowIndex = project ? list.indexOf(project) : -1;
        }
        if (!project) return;
        var storeProj = this.getStoreProject(project.project_no) || project;
        var computed = FormulaEngine.compute(Object.assign({}, storeProj), this.monthIdx);
        this.projectDrawerProject = computed;
        this.projectDrawerRowIndex = dataRowIndex;
        this.projectDrawerVisible = true;
      },

      closeProjectDrawer() {
        this.projectDrawerVisible = false;
        this.projectDrawerProject = null;
        this.projectDrawerRowIndex = null;
      },

      async handleProjectDrawerSave(draftFlat) {
        if (!this.projectDrawerProject || !this.canEdit) return;
        var project = this.projectDrawerProject;
        var storeProj = this.getStoreProject(project.project_no) || project;
        var originalFlat = FieldConfig.arraysToFlat(storeProj);
        var coerced = Object.assign({}, draftFlat);
        var self = this;

        this.tableFields.forEach(function (field) {
          if (!self.canEditField(field)) return;
          var key = FieldConfig.COL_TO_KEY[field.col];
          if (key != null && coerced[key] !== undefined) {
            coerced[key] = self.coerceFieldValue(coerced[key], field);
          }
        });

        if (!window.ProjectDrawerLayout) {
          this.$message.error('Drawer 布局模块未加载');
          return;
        }

        var changes = ProjectDrawerLayout.collectDrawerChanges(
          originalFlat, coerced, this.tableFields, this.canEditField.bind(this)
        );
        if (!changes.length) {
          this.$message.info('无变更');
          return;
        }

        for (var i = 0; i < changes.length; i++) {
          var ch = changes[i];
          if (window.StockValidation && StockValidation.isCompletionField(ch.field)) {
            var check = StockValidation.validateCompletionEdit(
              storeProj, ch.field, ch.newVal, this.monthIdx
            );
            if (!check.ok) {
              this.$message.warning(check.message);
              return;
            }
          }
        }

        this.projectDrawerSaving = true;
        try {
          await this._trackCellSave((async function () {
            var recomputed = await self._applyFieldChangesToProject(storeProj, changes, self.user);
            var fresh = self.getStoreProject(project.project_no) || recomputed;
            var rowIdx = self.projectDrawerRowIndex;
            if (self.activeTab === 'luckysheet' && rowIdx != null && rowIdx >= 0) {
              self.syncLuckysheetProjectRowValues(rowIdx, fresh);
              self.recalcLuckysheetFormulas();
              setTimeout(function () {
                self.syncLuckysheetProjectRowDecor(rowIdx, fresh);
              }, 320);
            }
            self.projectDrawerProject = fresh;
            self.$message.success('已保存');
          })());
        } catch (e) {
          this.$message.error('保存失败：' + (e.message || e));
        } finally {
          this.projectDrawerSaving = false;
        }
      },

      drawerStockWarningField(project, field) {
        if (!window.StockValidation) return false;
        return StockValidation.isStockWarningCell(project, field, this.monthIdx);
      },

      handleSubmit() {
        if (this.isPm) {
          // PM 提交：生成个人子集快照，锁定自己
          this.$confirm(
            '提交后本月填报将被锁定，等待板块管理员接收确认。接收后可再次修改并重新提交。确认提交？',
            '提交填报', { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning' }
          ).then(() => {
            const self = this;
            this.submitLoading = true;
            this.preparePmSubmit()
              .then(function () {
                if (!self.assertStockBeforeSubmit()) {
                  throw new Error('stock_validation');
                }
                return Store.submitPmReporting();
              })
              .then(function (result) {
                self.applyPmSubmitSnapshotToStore(result);
                self.$message.success('已提交，等待板块管理员接收');
                if (self.activeTab === 'luckysheet') {
                  self.$nextTick(function () { self.refreshLuckysheet(); });
                }
              })
              .catch(function (e) {
                if (e && e.message !== 'stock_validation') {
                  self.$message.error('提交失败：' + (e.message || e));
                }
              })
              .finally(function () { self.submitLoading = false; });
          }).catch(() => {});
        } else {
          // 板块管理员：正式提交审批，生成全局 Draft
          this.$confirm(
            '提交后将生成板块填报快照（Draft版），进入审批流程，当前数据将被锁定。确认提交？',
            '提交审批', { confirmButtonText: '确认提交', cancelButtonText: '取消', type: 'warning' }
          ).then(() => {
            this.submitLoading = true;
            this.persistLuckysheetBeforeSubmit()
              .then(() => {
                if (!this.assertStockBeforeSubmit()) {
                  throw new Error('stock_validation');
                }
                return Store.submitForApproval();
              })
              .then(() => {
                this.$message.success('已提交审批，Draft快照已生成');
                if (this.activeTab === 'luckysheet') {
                  this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
                }
                this.$router.push('/approval');
              })
              .catch(e => {
                if (e && e.message !== 'stock_validation') {
                  this.$message.error('提交失败：' + (e.message || e));
                }
              })
              .finally(() => { this.submitLoading = false; });
          }).catch(() => {});
        }
      },

      fieldValuesDiffer(leftVal, rightVal, dataType) {
        if (dataType === '金额' || dataType === '比率') {
          return Math.abs((Number(leftVal) || 0) - (Number(rightVal) || 0)) > 1e-6;
        }
        return String(leftVal == null ? '' : leftVal) !== String(rightVal == null ? '' : rightVal);
      },

      diffProjectSets(leftProjects, rightProjects, compareFields) {
        return DiffUtils.diffProjectSets(leftProjects, rightProjects, compareFields);
      },
      onCompanyArchived() {
        this.viewingVersion = 'J版';
        this.handleViewingVersionChange('J版');
      },

      // 板块管理员：查看某 PM 本轮填报变更
      showPmDiff(pmName, snapshotVersion) {
        if (!snapshotVersion) {
          this.$message.info('无关联快照版本');
          return;
        }
        const self = this;
        const month = Store.reportingMonth;
        const sub = (Store.pmSubmissions[month] || {})[pmName] || {};
        const baselineVersion = sub.submissionBaselineSnapshotVersion || sub.baselineSnapshotVersion;
        const loading = this.$loading({ lock: true, text: '加载快照…', background: 'rgba(0,0,0,0.15)' });
        Promise.all([
          Store.fetchSnapshot(snapshotVersion),
          baselineVersion ? Store.fetchSnapshot(baselineVersion) : Promise.resolve(null)
        ])
          .then(function (arr) {
            const submitSnap = arr[0];
            const baselineSnap = arr[1];
            if (!submitSnap) {
              self.$message.info('提交快照不可用，请刷新页面后重试');
              return;
            }
            self.renderPmDiff(pmName, submitSnap, baselineSnap);
          })
          .catch(function () {
            self.$message.error('加载快照失败');
          })
          .finally(function () { loading.close(); });
      },

      renderPmDiff(pmName, submitSnap, baselineSnap) {
        const fields = FieldConfig.buildFieldConfig();
        const compareFields = fields.filter(function (f) {
          return f.source_type === 'manual_input';
        });
        const submitProjects = submitSnap.projects || [];
        const currentProjects = FormulaEngine.computeAll(
          Store.projects.filter(function (p) { return p.pm_name === pmName; }),
          this.monthIdx
        );

        let results = [];
        if (baselineSnap && (baselineSnap.projects || []).length) {
          results = this.diffProjectSets(baselineSnap.projects, submitProjects, compareFields);
          this.pmDiffColLeft = '填报基准';
          this.pmDiffColRight = '提交值';
        }

        if (results.length === 0) {
          results = this.diffProjectSets(submitProjects, currentProjects, compareFields);
          this.pmDiffColLeft = '提交快照';
          this.pmDiffColRight = '当前追踪表';
        }

        if (results.length === 0) {
          submitProjects.forEach(function (sp) {
            const cols = sp._changed_fields || [];
            if (!cols.length) return;
            const rFlat = FieldConfig.arraysToFlat(sp);
            const rowDiffs = cols.map(function (col) {
              const f = fields.find(function (x) { return x.col === col; });
              const key = f && FieldConfig.COL_TO_KEY[f.col];
              const rv = key ? rFlat[key] : '';
              return {
                field: f ? f.name_cn : col,
                leftVal: '—',
                rightVal: f ? Formatters.formatByType(rv, f.data_type) : String(rv)
              };
            });
            results.push({
              projectNo: sp.project_no,
              projectName: sp.project_name,
              diffs: rowDiffs
            });
          });
          this.pmDiffColLeft = '—';
          this.pmDiffColRight = '提交时变更列';
        }

        if (results.length === 0) {
          this.$message.info(
            pmName + ' 未检测到可编辑字段差异。若您看到与管理员表不一致，请确认是否修改了自动计算列或他人项目。'
          );
          return;
        }
        this.pmDiffName = pmName;
        this.pmDiffResults = results;
        this.pmDiffVisible = true;
      },

      // 板块管理员：确认接收 PM 提交
      handleReceivePm(pmName) {
        this.$confirm(
          '确认接收 ' + pmName + ' 的提交？接收后该 PM 将解除锁定，可继续编辑并重新提交。',
          '确认接收', { confirmButtonText: '确认接收', cancelButtonText: '取消', type: 'info' }
        ).then(() => {
          Store.receivePmSubmission(pmName)
            .then(() => {
              this.$message.success('已接收 ' + pmName + ' 的提交，该 PM 已解锁');
            })
            .catch(e => { this.$message.error('接收失败：' + (e.message || e)); });
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
      handleSyncPlatformData() {
        const self = this;
        this.$confirm(
          '将从中台拉取 CRB / 财务系统数据并合并到当前跟踪表。仅更新系统同步字段与报告月当月开票/回款实际值，不会覆盖手工填报与预测列。是否继续？',
          '更新系统数据',
          { confirmButtonText: '立即更新', cancelButtonText: '取消', type: 'info' }
        ).then(function () {
          self.syncLoading = true;
          return Store.syncPlatformData();
        }).then(function (res) {
          self.buildTableData();
          self.$nextTick(function () { self.refreshLuckysheet(); });
          const stats = res && res.stats ? res.stats : {};
          self.$message.success(
            '系统数据已更新（更新 ' + (stats.updated || 0) + ' 条，新增 ' + (stats.added || 0) + ' 条）'
          );
        }).catch(function (err) {
          if (err !== 'cancel' && err !== 'close') {
            self.$message.error('更新失败：' + (err.message || err));
          }
        }).finally(function () {
          self.syncLoading = false;
        });
      },
      getRowClass(project) {
        if (project._added_this_month) return 'row-new-project';
        if (project._changed_fields && project._changed_fields.length > 0) return 'row-changed';
        if (window.StockValidation && StockValidation.hasStockWarning(project, this.monthIdx)) {
          return 'row-stock-warning';
        }
        return '';
      },

      applyLuckysheetStockWarning(cell, project, field) {
        if (!window.StockValidation) return cell;
        if (!StockValidation.isStockWarningCell(project, field, this.monthIdx)) return cell;
        cell.bg = StockValidation.STOCK_WARNING_STYLE.bg;
        cell.fc = StockValidation.STOCK_WARNING_STYLE.fc;
        return cell;
      },

      validateStockBeforeSubmit() {
        const list = this.scopedProjects.map(function (p) {
          return FormulaEngine.compute(
            this.getStoreProject(p.project_no) || p,
            this.monthIdx
          );
        }.bind(this));
        if (!window.StockValidation) return { ok: true, violations: [] };
        return StockValidation.validateProjectsForSubmit(list, this.monthIdx);
      },

      assertStockBeforeSubmit() {
        const check = this.validateStockBeforeSubmit();
        if (!check.ok) {
          this.$message.error(check.message);
          return false;
        }
        return true;
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
          if (this.tableFields[i].col === fieldColLetter) return i;
        }
        return -1;
      },

      /** Luckysheet A1 引用（列字母与字段字典一致） */
      lsRef(fieldCol, row0) {
        return fieldCol + (row0 + 1);
      },

      lsZebraBg(dataRowIndex) {
        if (dataRowIndex == null) return LS_ZEBRA_EVEN;
        return dataRowIndex % 2 === 0 ? LS_ZEBRA_EVEN : LS_ZEBRA_ODD;
      },

      /**
       * auto_calc 列 → Luckysheet 公式（与 fields-data calc_logic / formula-engine 对齐）
       * @returns {string|null} 以 = 开头的公式，无法表达时返回 null（回退为预计算值）
       */
      buildLuckysheetFieldFormula(fieldCol, row0) {
        const R = function (fc) { return this.lsRef(fc, row0); }.bind(this);
        const m = this.monthIdx;
        const mc = LS_MC_COLS;
        const mi = LS_MI_COLS;
        const mp = LS_MP_COLS;

        const sumListed = function (cols, endIdx) {
          const slice = cols.slice(0, endIdx + 1);
          if (!slice.length) return '0';
          if (slice.length === 1) return R(slice[0]);
          return 'SUM(' + slice.map(function (c) { return R(c); }).join(',') + ')';
        };

        const sumMcRange = function () {
          if (m <= 0) return R(mc[0]);
          return 'SUM(' + R(mc[0]) + ':' + R(mc[m]) + ')';
        };

        const last3McSum = function () {
          const start = Math.max(0, m - 2);
          const slice = mc.slice(start, m + 1);
          if (slice.length === 1) return R(slice[0]);
          return 'SUM(' + slice.map(function (c) { return R(c); }).join(',') + ')';
        };

        switch (fieldCol) {
          case 'O': return '=' + R('P') + '-' + R('N');
          case 'Q': return '=' + R('P') + '/(1+' + R('Y') + ')';
          case 'R': return '=' + R('P') + '-' + R('AC');
          case 'S': return '=' + R('P') + '-' + R('U');
          case 'U': return '=' + R('T') + '+' + R('X');
          case 'V': return '=' + R('N') + '-' + R('T');
          case 'W': return '=' + R(mc[m]);
          case 'X': return '=' + sumMcRange();
          case 'Z': return '=' + R('X') + '/(1+' + R('Y') + ')';
          case 'AB': return '=' + sumListed(mi, m);
          case 'AC': return '=' + R('AA') + '+' + R('AB');
          case 'AE': return '=' + sumListed(mp, m);
          case 'AF': return '=' + R('AD') + '+' + R('AE');
          case 'AG': return '=' + R('U') + '-' + R('AC');
          case 'AH': return '=' + R('AG') + '/(1+' + R('Y') + ')';
          case 'AI': return '=' + R('AC') + '-' + R('AF');
          case 'AJ': return '=MAX(' + R('AI') + ',0)';
          case 'AK': return '=MAX(' + R('AA') + '-' + R('AD') + ',0)';
          case 'AL': return '=MAX(' + R('AG') + ',0)';
          case 'AP': return '=MAX(' + R('T') + '-' + R('AA') + ',0)';
          case 'AQ': return '=MAX(' + R('AG') + '-' + last3McSum() + ',0)';
          case 'A':
            return '=IF(YEAR(' + R('B') + ')>=' + LS_SYSTEM_YEAR + ',"新项目","旧项目")';
          default:
            return null;
        }
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

      /** 为合计格提供初始 v/m（公式重算前显示），与 FormulaEngine 汇总一致 */
      lsSeedProjectForAmount(fld, amount) {
        const key = FieldConfig.COL_TO_KEY[fld.col];
        const o = {};
        if (key) o[key] = amount;
        return o;
      },

      /**
       * 小计/合计行金额公式（与 Excel 一致）
       * @param {'subtotal'|'sum'} rowKind — 小计用 SUBTOTAL(9,…)，合计用 SUM(…)
       */
      makeLuckysheetTotalRowAmountCell(fld, projs, rowStyle, rowKind) {
        const lay = this.lsLayout();
        var cell;
        if (lay.dataEnd >= lay.dataStart) {
          var range = this.lsRef(fld.col, lay.dataStart) + ':' + this.lsRef(fld.col, lay.dataEnd);
          var formula = rowKind === 'subtotal'
            ? '=SUBTOTAL(9,' + range + ')'
            : '=SUM(' + range + ')';
          var seed = this.sumProjectsField(projs, fld);
          cell = this.makeLuckysheetFormulaCell(
            formula, fld, this.lsSeedProjectForAmount(fld, seed), '#e2e8f0'
          );
        } else {
          cell = this.makeLuckysheetCell(0, fld, true, '#e2e8f0');
        }
        return Object.assign(cell, rowStyle);
      },

      /**
       * Luckysheet 公式链：先数据行公式，再小计 SUBTOTAL / 合计 SUM（官方要求否则公式不生效）
       * https://dream-num.github.io/LuckysheetDocs/zh/guide/sheet.html#calcchain
       */
      /** 清除 Luckysheet gridKey 本地缓存，避免旧表结构与 merge 配置触发 mergeCalculation 报错 */
      clearLuckysheetLocalCache(gridKey) {
        try {
          if (!gridKey || !window.localStorage) return;
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(gridKey) >= 0) keys.push(k);
          }
          keys.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* ignore */ }
      },

      /** 为合并区域从属格写入 mc，供 mergeCalculation 读取 */
      applyLuckysheetMergeMc(data, merge) {
        if (!data || !merge) return;
        Object.keys(merge).forEach(function (key) {
          const m = merge[key];
          if (!m || m.r == null || m.c == null) return;
          const r0 = m.r;
          const c0 = m.c;
          const rs = m.rs || 1;
          const cs = m.cs || 1;
          for (let dr = 0; dr < rs; dr++) {
            for (let dc = 0; dc < cs; dc++) {
              const r = r0 + dr;
              const c = c0 + dc;
              if (r < 0 || r >= data.length || c < 0) continue;
              if (!data[r]) data[r] = [];
              if (dr === 0 && dc === 0) {
                if (!data[r][c]) data[r][c] = {};
                continue;
              }
              data[r][c] = { mc: { r: r0, c: c0 } };
            }
          }
        });
      },

      /** celldata → 二维 data，避免 Luckysheet mergeCalculation 访问 data[r][c] 为 undefined */
      buildLuckysheetDataMatrix(celldata, rowCount, colCount, merge) {
        const data = [];
        for (let r = 0; r < rowCount; r++) {
          const row = [];
          for (let c = 0; c < colCount; c++) {
            row.push(null);
          }
          data.push(row);
        }
        (celldata || []).forEach(function (item) {
          if (item.r >= 0 && item.r < rowCount && item.c >= 0 && item.c < colCount) {
            data[item.r][item.c] = item.v;
          }
        });
        this.applyLuckysheetMergeMc(data, merge);
        return data;
      },

      buildLuckysheetCalcChain(celldata, sheetIndex, lay) {
        if (!celldata || !celldata.length) return [];
        const dataEntries = [];
        const totalEntries = [];
        const sheetIdx = sheetIndex != null ? sheetIndex : 0;

        celldata.forEach(function (item) {
          const v = item.v;
          if (!v || !v.f) return;
          const entry = {
            r: item.r,
            c: item.c,
            index: sheetIdx,
            func: [true, v.v != null && v.v !== '' ? v.v : 0, v.f],
            color: 'w',
            parent: null,
            chidren: {},
            times: 0
          };
          if (item.r === lay.subtotal || item.r === lay.sum) {
            totalEntries.push(entry);
          } else if (item.r >= lay.dataStart && item.r <= lay.dataEnd) {
            dataEntries.push(entry);
          }
        });

        dataEntries.sort(function (a, b) {
          return a.r - b.r || a.c - b.c;
        });
        totalEntries.sort(function (a, b) {
          return a.r - b.r || a.c - b.c;
        });
        return dataEntries.concat(totalEntries);
      },

      recalcLuckysheetFormulas() {
        var self = this;
        var run = function () {
          try {
            if (typeof luckysheet === 'undefined') return;
            if (typeof luckysheet.refreshFormula === 'function') {
              luckysheet.refreshFormula();
            } else if (typeof luckysheet.jfrefreshgrid === 'function') {
              luckysheet.jfrefreshgrid();
            }
          } catch (e) { /* ignore */ }
        };
        setTimeout(run, 80);
        setTimeout(run, 280);
      },

      canEditLuckysheetCell(r, c) {
        const lay = this.lsLayout();
        if (r === lay.section || r === lay.header) return false;
        if (r === lay.subtotal || r === lay.sum) return false;
        if (r < lay.dataStart || r > lay.dataEnd) return false;
        const field = this.tableFields[c];
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
        if (field.data_type === '日期') {
          return Formatters.normalizeDateValue(raw);
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
        } else if (field.data_type === '日期') {
          const iso = Formatters.normalizeDateValue(val);
          if (!iso) {
            cell.v = '';
            cell.m = '';
          } else {
            const serial = Formatters.dateToExcelSerial(iso);
            cell.v = serial != null ? serial : iso;
            cell.m = iso;
            cell.ct = { fa: 'yyyy-MM-dd', t: 'd' };
          }
        } else {
          cell.v = val != null && val !== '' ? val : '';
          cell.m = cell.v !== '' ? String(cell.v) : '';
        }
        if (field.data_type === '金额') {
          this.applyLuckysheetAmountColumnStyle(cell, field);
        }
        if (readonly) {
          cell.bg = bgTint || '#f8fafc';
        } else if (bgTint) {
          cell.bg = bgTint;
        }
        return this.lsApplyCellLock(cell, readonly);
      },

      luckysheetCellBg(project, field, readonly, dataRowIndex) {
        if (window.StockValidation && StockValidation.isStockWarningCell(project, field, this.monthIdx)) {
          return StockValidation.STOCK_WARNING_STYLE.bg;
        }
        if (window.ChangeMeta && ChangeMeta.hasFieldChangeMarkup(project, field)) {
          return ChangeMeta.CHANGED_FIELD_STYLE.bg;
        }
        if (this.isFieldChanged(project, field) && window.ChangeMeta) {
          return ChangeMeta.CHANGED_FIELD_STYLE.bg;
        }
        if (this.isFieldChanged(project, field)) return '#fff7ed';
        if (!readonly && this.canEditField(field) && this.canEdit) {
          return (window.ChangeMeta && ChangeMeta.EDITABLE_FIELD_STYLE)
            ? ChangeMeta.EDITABLE_FIELD_STYLE.bg
            : '#fefce8';
        }
        if (project._added_this_month) {
          return (window.ProjectMonthDiff && ProjectMonthDiff.NEW_PROJECT_BG) || '#d9e7d8';
        }
        if (readonly || field.source_type !== 'manual_input') {
          return this.lsZebraBg(dataRowIndex);
        }
        return dataRowIndex != null && dataRowIndex % 2 === 1 ? LS_ZEBRA_ODD : LS_ZEBRA_EVEN;
      },

      makeLuckysheetFormulaCell(formula, field, project, bg) {
        const f = formula.charAt(0) === '=' ? formula : '=' + formula;
        const cell = { f: f, ct: { fa: 'General', t: 'g' } };
        const val = this.getCellValue(project, field);
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
        cell.bg = bg || '#f8fafc';
        if (field.data_type === '金额') {
          this.applyLuckysheetAmountColumnStyle(cell, field);
        } else if (field.data_type === '比率') {
          cell.ht = '2';
        } else {
          cell.ht = '0';
        }
        this.applyLuckysheetStockWarning(cell, project, field);
        return this.lsApplyCellLock(cell, true);
      },

      /** 本月有变更：浅橙底 + 橙字 + 左边框（与图例 / HTML .field-changed 一致） */
      applyLuckysheetHighlight(cell, project, field) {
        if (window.ChangeMeta) {
          return ChangeMeta.applyLuckysheetChangedStyle(cell, project, field);
        }
        if (!this.isFieldChanged(project, field)) return cell;
        cell.fc = '#b45309';
        cell.bg = '#fff7ed';

        return cell;
      },

      applyLuckysheetChangeComment(cell, project, field) {
        if (!window.ChangeMeta || !ChangeMeta.hasFieldChangeMarkup(project, field)) return cell;
        const text = ChangeMeta.formatChangeComment(project, field, Store.auditLog);
        if (text) cell.ps = ChangeMeta.buildLuckysheetCommentPs(text);
        return cell;
      },

      /** 就地更新 Luckysheet 该行单元格值（不整表 refresh） */
      syncLuckysheetProjectRowValues(dataRowIndex, project) {
        if (!project || dataRowIndex < 0) return;
        const file = this.lsGetActiveLuckysheetFile();
        if (!file || !file.data) return;
        const layout = this.lsLayout();
        const r = layout.dataStart + dataRowIndex;
        const row = file.data[r];
        if (!row) return;
        for (let c = 0; c < this.tableFields.length; c++) {
          const field = this.tableFields[c];
          if (!field) continue;
          row[c] = this.makeLuckysheetDataCell(project, field, r, dataRowIndex);
        }
        try {
          if (typeof luckysheet.jfrefreshgrid === 'function') luckysheet.jfrefreshgrid();
        } catch (e) { /* ignore */ }
      },

      /** 按项目变更记录，同步该行所有批注与高亮（公式重算后防丢失） */
      syncLuckysheetProjectRowDecor(dataRowIndex, project) {
        if (!project || dataRowIndex < 0) return;
        const file = this.lsGetActiveLuckysheetFile();
        if (!file || !file.data) return;
        const layout = this.lsLayout();
        const r = layout.dataStart + dataRowIndex;
        const row = file.data[r];
        if (!row) return;
        for (let c = 0; c < this.tableFields.length; c++) {
          const field = this.tableFields[c];
          if (!field) continue;
          const cell = row[c];
          if (!cell) continue;
          this.applyLuckysheetStockWarning(cell, project, field);
          if (window.ChangeMeta && ChangeMeta.hasFieldChangeMarkup(project, field)) {
            this.applyLuckysheetHighlight(cell, project, field);
            this.applyLuckysheetChangeComment(cell, project, field);
          }
          if (field.data_type === '金额') {
            this.applyLuckysheetAmountColumnStyle(cell, field);
          }
        }
      },

      syncAllLuckysheetChangeDecor() {
        if (this.activeTab !== 'luckysheet' || typeof luckysheet === 'undefined') return;
        const self = this;
        const n = this.filteredProjects.length;
        for (let i = 0; i < n; i++) {
          const p = self.getStoreProject(self.filteredProjects[i].project_no)
            || self.filteredProjects[i];
          self.syncLuckysheetProjectRowDecor(i, p);
        }
        try {
          if (typeof luckysheet.jfrefreshgrid === 'function') luckysheet.jfrefreshgrid();
        } catch (e) { /* ignore */ }
      },

      /** 编辑后不整表刷新时，就地更新高亮与批注 */
      applyLuckysheetCellChangeDecor(r, c, project, field) {
        const rowIdx = r - this.lsLayout().dataStart;
        this.syncLuckysheetProjectRowDecor(rowIdx, project);
      },

      makeLuckysheetDataCell(project, field, row0, dataRowIndex) {
        const ro = !this.canEditField(field) || !this.canEdit;
        const bg = this.luckysheetCellBg(project, field, ro, dataRowIndex);
        if (field.source_type === 'auto_calc' && row0 != null) {
          const formula = this.buildLuckysheetFieldFormula(field.col, row0);
          if (formula) {
            return this.applyLuckysheetChangeComment(
              this.applyLuckysheetStockWarning(
                this.applyLuckysheetHighlight(
                  this.makeLuckysheetFormulaCell(formula, field, project, bg),
                  project,
                  field
                ),
                project,
                field
              ),
              project,
              field
            );
          }
        }
        const val = this.getCellValue(project, field);
        const cell = this.makeLuckysheetCell(val, field, ro, bg);
        var out = this.applyLuckysheetChangeComment(
          this.applyLuckysheetStockWarning(
            this.applyLuckysheetHighlight(cell, project, field),
            project,
            field
          ),
          project,
          field
        );
        if (field.col === 'F' && dataRowIndex != null) {
          out.fc = '#007069';
          out.un = 1;
        }
        return out;
      },

      buildLuckysheetMerge() {
        const merge = {};
        const sections = FieldConfig.getSections(this.tableFields);
        const fields = this.tableFields;
        const self = this;
        sections.forEach(function (sec) {
          if (!sec.fields.length) return;
          var visibleIdx = [];
          sec.fields.forEach(function (fld) {
            var idx = fields.indexOf(fld);
            if (idx >= 0 && self.shouldShowCompactColumn(fld)) visibleIdx.push(idx);
          });
          if (!visibleIdx.length) return;
          var c0 = visibleIdx[0];
          var cLast = visibleIdx[visibleIdx.length - 1];
          var cs = cLast - c0 + 1;
          if (c0 < 0 || cs < 1) return;
          merge[LS_ROW_SECTION + '_' + c0] = {
            r: LS_ROW_SECTION, c: c0, rs: 1, cs: cs
          };
        });
        return merge;
      },

      buildLuckysheetTotalRowCells(r, label, rowKind) {
        const cells = [];
        const projs = this.filteredProjects;
        const labelC = this.lsFieldColIndex('G');
        const labelCol = labelC >= 0 ? labelC : 6;
        const kind = rowKind === 'sum' ? 'sum' : 'subtotal';
        const rowBase = { bg: '#e2e8f0', bl: 1 };

        for (var j = 0; j < this.tableFields.length; j++) {
          var fld = this.tableFields[j];
          var c = j;
          var base = Object.assign({
            ht: fld.data_type === '金额' || fld.data_type === '比率' ? '2' : '0'
          }, rowBase);
          if (c === labelCol) {
            cells.push({
              r: r, c: c,
              v: this.lsApplyCellLock(
                Object.assign({ v: label, m: label, ct: { fa: 'General', t: 'g' } }, base),
                true
              )
            });
            continue;
          }
          if (fld.data_type === '金额') {
            cells.push({
              r: r, c: c,
              v: this.makeLuckysheetTotalRowAmountCell(fld, projs, base, kind)
            });
          } else {
            cells.push({
              r: r, c: c,
              v: this.lsApplyCellLock(
                Object.assign({ v: '', m: '', ct: { fa: 'General', t: 'g' } }, base),
                true
              )
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
        const self = this;
        const lockCell = function (cell) {
          return self.lsApplyCellLock(cell, true);
        };

        // 行0–1：小计 / 合计（置于大分类之上，不参与筛选）
        this.buildLuckysheetTotalRowCells(lay.subtotal, '小计 Subtotal', 'subtotal').forEach(function (item) {
          push(item.r, item.c, item.v);
        });
        this.buildLuckysheetTotalRowCells(lay.sum, '合计 Total', 'sum').forEach(function (item) {
          push(item.r, item.c, item.v);
        });

        // 行2：大类（分区名，合并单元格由 config.merge 定义）
        const sections = FieldConfig.getSections(fields);
        sections.forEach(function (sec) {
          if (!sec.fields.length) return;
          var c0 = -1;
          for (var si = 0; si < sec.fields.length; si++) {
            if (self.shouldShowCompactColumn(sec.fields[si])) {
              c0 = fields.indexOf(sec.fields[si]);
              break;
            }
          }
          if (c0 < 0) return;
          const secBg = self.lsSectionRowBg(sec.name);
          push(LS_ROW_SECTION, c0, lockCell({
            v: sec.name, m: sec.name, ct: { fa: 'General', t: 'g' },
            bg: secBg, fc: '#ffffff', bl: 1, ht: '0', tb: '2'
          }));
        });

        // 行3：字段标题
        for (var j = 0; j < fields.length; j++) {
          var f = fields[j];
          var hl = f.name_cn;
          var hdrEdit = self.isEditableColumnHeader(f);
          push(LS_ROW_HEADER, j, lockCell({
            v: hl, m: hl, ct: { fa: 'General', t: 'g' },
            bg: hdrEdit ? '#78716a' : '#8f96a0',
            fc: hdrEdit ? '#fef08a' : '#ffffff',
            bl: 1,
            tb: '2', ht: f.data_type === '金额' ? '2' : '1', vt: '0'
          }));
        }

        // 数据行
        for (var i = 0; i < projs.length; i++) {
          var p = projs[i];
          var row = lay.dataStart + i;
          for (var k = 0; k < fields.length; k++) {
            var fld = fields[k];
            push(row, k, this.makeLuckysheetDataCell(p, fld, row, i));
          }
        }

        return celldata;
      },

      buildLuckysheetColumnlen() {
        var columnlen = {};
        for (var j = 0; j < this.tableFields.length; j++) {
          var f = this.tableFields[j];
          var narrow = LS_NARROW_COLS[f.col];
          columnlen[j] = narrow != null
            ? narrow
            : Math.min(220, Math.max(72, f.colWidth || 90));
        }
        return columnlen;
      },

      buildLuckysheetCustomWidth() {
        var customWidth = {};
        var columnlen = this.buildLuckysheetColumnlen();
        for (var k in columnlen) {
          if (Object.prototype.hasOwnProperty.call(columnlen, k)) customWidth[k] = 1;
        }
        return customWidth;
      },

      buildLuckysheetRowlen() {
        return {
          0: 26,
          1: 26,
          2: 28,
          3: 40
        };
      },

      /** 默认筛选：字段标题行 + 全部项目数据行（不含小计/合计/大分类） */
      buildLuckysheetFilterSelect() {
        const lay = this.lsLayout();
        const lastCol = Math.max(0, this.tableFields.length - 1);
        const filterEndRow = lay.dataEnd >= lay.dataStart ? lay.dataEnd : LS_ROW_HEADER;
        return {
          row: [LS_ROW_HEADER, filterEndRow],
          column: [0, lastCol]
        };
      },

      lsRowHeaderWidth() {
        return 46;
      },

      lsColLeftPx(file, colIndex) {
        let left = this.lsRowHeaderWidth();
        const columnlen = (file.config && file.config.columnlen) || {};
        const defaultW = file.defaultColWidth || 73;
        for (let c = 0; c < colIndex; c++) {
          left += columnlen[c] != null ? columnlen[c] : defaultW;
        }
        return left;
      },

      lsColWidth(file, colIndex) {
        const columnlen = (file.config && file.config.columnlen) || {};
        return columnlen[colIndex] != null ? columnlen[colIndex] : (file.defaultColWidth || 73);
      },

      /** 冻结区右边界（首列可滚动列左缘，像素） */
      lsFreezeRightPx(file) {
        return this.lsColLeftPx(file, LS_FROZEN_COL + 1);
      },

      lsGetActiveLuckysheetFile() {
        if (typeof luckysheet === 'undefined' || !luckysheet || typeof luckysheet.getLuckysheetfile !== 'function') {
          return null;
        }
        const files = luckysheet.getLuckysheetfile() || [];
        for (let i = 0; i < files.length; i++) {
          if (files[i].status === 1) return files[i];
        }
        return files[0] || null;
      },

      lsShowFilterOption($e) {
        $e.css('display', 'block');
      },

      lsHideFilterOption($e) {
        $e.css('display', 'none');
      },

      /** 筛选按钮在 scrollLeft=0 时的基准 left（相对 #luckysheet-cell-main 内容区） */
      lsEnsureFilterBaseLeft($e, file, colIndex) {
        let base = $e.data('lsFilterLeftBase');
        if (base != null) return base;
        const parsed = parseFloat($e.css('left'));
        base = !isNaN(parsed) && parsed > 0
          ? parsed
          : (this.lsColLeftPx(file, colIndex) + this.lsColWidth(file, colIndex) - 22);
        $e.data('lsFilterLeftBase', base);
        return base;
      },

      lsResolveFilterColIndex($e, i, c1) {
        let colIndex = $e.data('cindex');
        if (colIndex == null || colIndex === '') colIndex = c1 + i;
        return Number(colIndex);
      },

      /**
       * 横向滚动：冻结列筛选按钮补偿 scrollLeft 保持固定；可滚动列隐藏滚入冻结区下方的按钮
       */
      syncLuckysheetFilterWithFreeze() {
        const $ = window.jQuery;
        if (!$) return;
        const file = this.lsGetActiveLuckysheetFile();
        if (!file || !file.filter_select) return;
        const cellMain = document.querySelector('#' + this.lsMountId + ' #luckysheet-cell-main');
        if (!cellMain) return;
        const $opts = $('#luckysheet-filter-options-sheet' + file.index + ' .luckysheet-filter-options');
        if (!$opts.length) return;

        const scrollLeft = cellMain.scrollLeft;
        const c1 = file.filter_select.column[0];
        const freezeRight = this.lsFreezeRightPx(file);
        const hideBefore = scrollLeft + freezeRight;

        $opts.each(function (i, el) {
          const $e = $(el);
          const colIndex = this.lsResolveFilterColIndex($e, i, c1);
          const baseLeft = this.lsEnsureFilterBaseLeft($e, file, colIndex);

          if (colIndex <= LS_FROZEN_COL) {
            this.lsShowFilterOption($e);
            $e.css('left', scrollLeft > 2 ? baseLeft + scrollLeft : baseLeft);
            return;
          }

          if (scrollLeft <= 2) {
            $e.css('left', baseLeft);
            this.lsShowFilterOption($e);
            return;
          }

          const colLeft = this.lsColLeftPx(file, colIndex);
          if (colLeft < hideBefore) {
            this.lsHideFilterOption($e);
          } else {
            this.lsShowFilterOption($e);
            $e.css('left', baseLeft);
          }
        }.bind(this));
      },

      bindLuckysheetFilterFreezeSync() {
        this.unbindLuckysheetFilterFreezeSync();
        const $ = window.jQuery;
        if (!$) return;
        const cellMain = $('#' + this.lsMountId).find('#luckysheet-cell-main');
        if (!cellMain.length) return;
        const self = this;
        const handler = function () { self.syncLuckysheetFilterWithFreeze(); };
        this._lsFilterScrollHandler = handler;
        cellMain.on('scroll.lsFilterFreeze', handler);
      },

      unbindLuckysheetFilterFreezeSync() {
        const $ = window.jQuery;
        if ($) {
          $('#' + this.lsMountId).find('#luckysheet-cell-main').off('scroll.lsFilterFreeze');
        }
        this._lsFilterScrollHandler = null;
      },

      applyLuckysheetDefaultFilter() {
        const self = this;
        setTimeout(function () {
          try {
            if (typeof luckysheet === 'undefined' || !luckysheet) return;
            const fs = self.buildLuckysheetFilterSelect();
            if (typeof luckysheet.setRangeFilter === 'function') {
              luckysheet.setRangeFilter('open', { range: fs });
            }
            self.bindLuckysheetFilterFreezeSync();
            setTimeout(function () {
              const file = self.lsGetActiveLuckysheetFile();
              if (!file) return;
              const c1 = file.filter_select.column[0];
              $('#luckysheet-filter-options-sheet' + file.index + ' .luckysheet-filter-options')
                .each(function (i, el) {
                  const $e = $(el);
                  const colIndex = self.lsResolveFilterColIndex($e, i, c1);
                  self.lsEnsureFilterBaseLeft($e, file, colIndex);
                  self.lsShowFilterOption($e);
                });
              self.syncLuckysheetFilterWithFreeze();
            }, 60);
          } catch (e) { /* ignore */ }
        }, 120);
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
            var ro = !this.canEditField(fld) || !this.canEdit;
            if (fld.data_type === '金额') {
              var layAmt = this.lsLayout();
              var rAmt = layAmt.dataStart + i;
              var cAmt = k;
              if (!ro) {
                dv[String(rAmt) + '_' + String(cAmt)] = {
                  type: 'number',
                  type2: false,
                  value1: '',
                  value2: '',
                  prohibitInput: true,
                  hintShow: true,
                  hintText: '仅限数字',
                  remote: false,
                  checked: false
                };
              }
              continue;
            }
            if (!fld.enum_values || !fld.enum_values.length) continue;
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
            var c = k;
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
        this.unbindLuckysheetFilterFreezeSync();
        this.unbindProjectNoClickHandler();
        try {
          if (typeof luckysheet !== 'undefined' && luckysheet && typeof luckysheet.destroy === 'function') {
            luckysheet.destroy();
          }
        } catch (e) { /* ignore */ }
      },

      unbindProjectNoClickHandler() {
        if (!this._lsProjectNoMouseUp) return;
        var el = document.querySelector('#' + this.lsMountId + ' #luckysheet-cell-main');
        if (el) el.removeEventListener('mouseup', this._lsProjectNoMouseUp);
        this._lsProjectNoMouseUp = null;
      },

      bindProjectNoClickHandler() {
        var self = this;
        this.unbindProjectNoClickHandler();
        var el = document.querySelector('#' + this.lsMountId + ' #luckysheet-cell-main');
        if (!el) return;
        var fColIdx = this.lsFieldColIndex('F');
        if (fColIdx < 0) return;
        this._lsProjectNoMouseUp = function () {
          if (self._lsLoading) return;
          if (typeof luckysheet === 'undefined' || !luckysheet) return;
          var sel = null;
          try {
            if (typeof luckysheet.getRange === 'function') {
              var rg = luckysheet.getRange();
              if (rg && rg.length) sel = rg[0];
            }
            if (!sel && typeof luckysheet.getluckysheetfile === 'function') {
              var files = luckysheet.getluckysheetfile();
              if (files && files.length && files[0].luckysheet_select_save && files[0].luckysheet_select_save.length) {
                sel = files[0].luckysheet_select_save[0];
              }
            }
          } catch (e) { /* ignore */ }
          if (!sel) return;
          var r = sel.row_focus != null ? sel.row_focus : (sel.row ? sel.row[0] : null);
          var c = sel.column_focus != null ? sel.column_focus : (sel.column ? sel.column[0] : null);
          if (r == null || c == null) return;
          var layout = self.lsLayout();
          if (r < layout.dataStart || r > layout.dataEnd) return;
          if (c !== fColIdx) return;
          var rowIdx = r - layout.dataStart;
          var project = self.filteredProjects[rowIdx];
          if (!project) return;
          self.openProjectDrawer(project.project_no, rowIdx);
        };
        el.addEventListener('mouseup', this._lsProjectNoMouseUp);
      },

      initLuckysheet() {
        var self = this;
        if (typeof luckysheet === 'undefined' || !luckysheet || typeof luckysheet.create !== 'function') {
          this.$message.warning('Luckysheet 未正确加载，请检查网络或 CDN');
          return;
        }
        if (document.getElementById(this.lsMountId) == null) return;

        this.clearLuckysheetLocalCache(this.lsGridKey);
        this.destroyLuckysheet();
        this._lsLoading = true;

        var lay = this.lsLayout();
        var rows = Math.max(48, lay.dataStart + Math.max(this.filteredProjects.length, 1) + 12);
        var cols = Math.max(64, this.tableFields.length + 4);
        var celldata = this.buildLuckysheetCelldata();
        var sheetIndex = 0;
        var merge = this.buildLuckysheetMerge();
        var dataMatrix = this.buildLuckysheetDataMatrix(celldata, rows, cols, merge);
        var calcChain = this.buildLuckysheetCalcChain(celldata, sheetIndex, lay);

        luckysheet.create({
          container: this.lsMountId,
          lang: 'zh',
          showinfobar: false,
          showsheetbar: false,
          showstatisticBar: true,
          showstatisticBarConfig: {
            count: false,
            view: false,
            zoom: true
          },
          showtoolbar: false,
          sheetFormulaBar: false,
          cellRightClickConfig: this.buildLuckysheetCellRightClickConfig(),
          rowHeaderRightClickConfig: this.buildLuckysheetRowHeaderRightClickConfig(),
          columnHeaderRightClickConfig: this.buildLuckysheetColumnHeaderRightClickConfig(),
          enableAddRow: false,
          enableAddBackTop: false,
          row: rows,
          column: cols,
          gridKey: this.lsGridKey,
          data: [{
            name: '项目执行跟踪',
            index: sheetIndex,
            status: 1,
            order: 0,
            celldata: celldata,
            data: dataMatrix,
            calcChain: calcChain,
            luckysheet_select_save: [{
              row: [LS_FROZEN_ROW, LS_FROZEN_ROW],
              column: [LS_FROZEN_COL, LS_FROZEN_COL]
            }],
            dataVerification: this.buildLuckysheetDataVerification(),
            filter_select: this.buildLuckysheetFilterSelect(),
            filter: null,
            frozen: {
              type: 'rangeBoth',
              range: { row_focus: LS_FROZEN_ROW, column_focus: LS_FROZEN_COL }
            },
            config: {
              columnlen: this.buildLuckysheetColumnlen(),
              colhidden: this.buildLuckysheetColhidden(),
              merge: merge,
              customWidth: this.buildLuckysheetCustomWidth(),
              rowlen: this.buildLuckysheetRowlen(),
              authority: this.buildLuckysheetAuthority()
            }
          }],
          hook: {
            workbookCreateAfter: function () {
              self._lsLoading = false;
              self.recalcLuckysheetFormulas();
              self.applyLuckysheetDefaultFilter();
              self.bindProjectNoClickHandler();
            },
            cellEditBefore: function (range) {
              if (self._lsLoading) return false;
              if (!range || !range.length) return true;
              var item = range[0];
              var r = item.row_focus != null ? item.row_focus : item.row[0];
              var c = item.column_focus != null ? item.column_focus : item.column[0];
              var fColIdx = self.lsFieldColIndex('F');
              if (c === fColIdx) return false;
              return self.canEditLuckysheetCell(r, c);
            },
            cellUpdateBefore: function (r, c, value, isRefresh) {
              if (self._lsLoading) return false;
              if (!self.canEditLuckysheetCell(r, c)) return false;
              var fld = self.tableFields[c];
              if (fld && fld.data_type === '金额' && value != null && value !== '') {
                if (!self.isLuckysheetAmountInputValid(self.extractLuckysheetInput(value))) {
                  return false;
                }
              }
              if (window.StockValidation && fld && StockValidation.isCompletionField(fld)) {
                var projs = self.filteredProjects;
                var layout = self.lsLayout();
                if (r >= layout.dataStart && r <= layout.dataEnd) {
                  var project = projs[r - layout.dataStart];
                  if (project) {
                    var newVal = self.coerceFieldValue(self.extractLuckysheetInput(value), fld);
                    var storeProject = self.getStoreProject(project.project_no) || project;
                    var check = StockValidation.validateCompletionEdit(
                      storeProject, fld, newVal, self.monthIdx
                    );
                    if (!check.ok) {
                      self.$message.warning(check.message);
                      return false;
                    }
                  }
                }
              }
              return true;
            },
            cellUpdated: function (r, c, oldValue, newValue, isRefresh) {
              if (self._lsLoading || isRefresh) return;
              var projs = self.filteredProjects;
              var layout = self.lsLayout();
              if (r < layout.dataStart || r > layout.dataEnd) return;
              var field = self.tableFields[c];
              if (!field || !self.canEditLuckysheetCell(r, c)) return;
              var project = projs[r - layout.dataStart];
              var newVal = self.coerceFieldValue(self.extractLuckysheetInput(newValue), field);
              var storeProject = self.getStoreProject(project.project_no) || project;
              var oldFlat = FieldConfig.arraysToFlat(storeProject);
              var key = FieldConfig.COL_TO_KEY[field.col];
              var oldVal = oldFlat[key];
              if (newVal === oldVal) return;
              if (String(newVal) === String(oldVal)) return;
              self.handleCellEdit(project, field, newVal, {
                fromLuckysheet: true,
                lsRow: r,
                lsCol: c
              })
                .then(function () {
                  self.buildTableData();
                })
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
          <el-select
            v-model="viewingVersion"
            size="small"
            class="editor-version-select"
            placeholder="版本"
            :loading="snapshotLoading"
            :disabled="snapshotLoading"
          >
            <el-option label="当前填报" value="__current__"></el-option>
            <el-option
              v-for="opt in editorSnapshotOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            ></el-option>
          </el-select>
          <span
            v-if="isViewingSnapshot && snapshotViewMeta"
            class="editor-snapshot-badge"
          >
            当前正在查看快照 · {{ snapshotViewMeta.label }}
          </span>
          <span v-else-if="!isSystemAdmin" class="period-banner" :class="lockBannerClass">
            <span class="period-dot"></span>
            {{ lockBannerText }}
          </span>
          <span v-else class="period-banner open">
            <span class="period-dot"></span>
            系统管理员 — 可编辑全部项目数据
          </span>

          <div class="editor-toolbar-spacer"></div>

          <div class="editor-toolbar-group">
            <el-button
              v-if="isSystemAdmin && !isViewingSnapshot"
              size="small"
              icon="el-icon-refresh"
              :loading="syncLoading"
              @click="handleSyncPlatformData"
            >更新系统数据</el-button>
            <el-button
              size="small"
              icon="el-icon-download"
              :loading="exportLoading"
              @click="handleExport"
            >导出 Excel</el-button>
            <template v-if="canImport">
              <input
                ref="importFileInput"
                type="file"
                accept=".xlsx,.xls"
                style="display:none;"
                @change="onImportFileChange"
              >
              <el-button
                size="small"
                icon="el-icon-upload2"
                :loading="importLoading"
                @click="$refs.importFileInput.click()"
              >上传导入</el-button>
            </template>
          </div>

          <template v-if="canEdit || canShowSubmitButton || canShowArchiveButton">
            <el-divider direction="vertical"></el-divider>
            <div class="editor-toolbar-group">
              <el-button
                v-if="canEdit"
                size="small"
                icon="el-icon-folder-checked"
                :loading="saveLoading"
                @click="handleSave"
              >保存</el-button>
              <el-button
                v-if="canShowArchiveButton"
                size="small"
                type="warning"
                icon="el-icon-s-check"
                :loading="archiveLoading"
                :disabled="!canSubmitArchive"
                @click="handleSubmitArchive"
              >提交归档</el-button>
              <el-button
                v-if="canShowSubmitButton"
                size="small"
                type="primary"
                icon="el-icon-s-promotion"
                class="editor-submit-btn"
                :loading="submitLoading"
                :disabled="!canSubmit"
                @click="handleSubmit"
              >{{ submitButtonLabel }}</el-button>
            </div>
          </template>
        </div>

        <!-- 图例说明 -->
        <div v-if="showDiffHint" class="editor-diff-hint">
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--new"></span>本月新增项目
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--editable"></span>可编辑列
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--changed" aria-hidden="true">Aa</span>本月有变更字段
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--warning"></span>存量预警（R/S 为负）
          </span>


          <span style="flex:1;"></span>
          <span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>
        </div>

        <!-- 填报主体：默认 Luckysheet；经典 HTML 表格见 showLegacyHtmlTable -->
        <div class="luckysheet-editor-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column;">
          <div v-if="activeTab === 'luckysheet'" class="sheet-toolbar">
            <el-radio-group v-model="viewMode" size="mini" class="view-toggle view-toggle--compact">
              <el-radio-button label="all">全部（{{ scopedProjects.length }}）</el-radio-button>
              <el-radio-button label="new_only">新增（{{ newProjectCount }}）</el-radio-button>
              <el-radio-button label="changed_only">有变更（{{ changedProjectCount }}）</el-radio-button>
              <el-radio-button label="warning_only">预警（{{ warningProjectCount }}）</el-radio-button>
            </el-radio-group>
            <el-divider direction="vertical" class="sheet-toolbar-divider"></el-divider>
            <el-checkbox v-model="compactColumnsOnly" class="sheet-toolbar-checkbox">
              仅显示项目信息与可编辑列
            </el-checkbox>
          </div>
          <div :id="lsMountId" style="flex:1;min-height:360px;width:100%;"></div>
          <div v-show="showLegacyHtmlTable && activeTab === 'table'" style="flex:1;overflow:auto;position:relative;min-height:200px;">
          <table class="editor-table" style="border-collapse:collapse;min-width:max-content;font-size:12px;">
            <!-- 分区标题行 -->
            <thead>
              <tr>
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
                <th
                  v-for="field in tableFields"
                  :key="'fh-'+field.col"
                  :class="{ 'editor-th-editable': isEditableColumnHeader(field) }"
                  :style="{
                    background: isEditableColumnHeader(field) ? '#fef9c3' : '#f1f5f9',
                    padding: '5px 8px',
                    border: isEditableColumnHeader(field) ? '1px solid #fde68a' : '1px solid #e2e8f0',
                    whiteSpace: 'nowrap',
                    minWidth: field.colWidth + 'px',
                    color: isEditableColumnHeader(field) ? '#92400e' : '#475569',
                    fontWeight: '600',
                    fontSize: '11px',
                    textAlign: 'center'
                  }"
                >
                  {{ field.name_cn }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(project, ri) in filteredProjects"
                :key="project.project_no"
                :class="getRowClass(project)"
              >
                <td
                  v-for="field in tableFields"
                  :key="'c-'+field.col"
                  :class="cellClass(project, field)"
                  :title="cellChangeTitle(project, field)"
                  :style="cellTdStyle(project, field)"
                >
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
                <td :colspan="tableFields.length" style="text-align:center;padding:40px;color:#94a3b8;border:1px solid #e2e8f0;">
                  <i class="el-icon-document" style="font-size:24px;"></i>
                  <div style="margin-top:8px;font-size:13px;">暂无符合条件的项目</div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <system-admin-sector-dock
          v-if="isSystemAdmin"
          :table-projects="tableProjects"
          @archived="onCompanyArchived"
        ></system-admin-sector-dock>

        <!-- 板块管理员：待接收 PM 提交面板 -->
        <div v-if="isSectorAdmin && pendingPmSubmissions.length > 0"
          style="padding:10px 16px;background:#fffbeb;border-top:2px solid #f59e0b;flex-shrink:0;">
          <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:8px;">
            <i class="el-icon-bell" style="margin-right:4px;"></i>
            待接收 PM 提交（{{ pendingPmSubmissions.length }} 人）
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <div
              v-for="sub in pendingPmSubmissions"
              :key="sub.pmName"
              style="background:#fff;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:10px;font-size:12px;"
            >
              <div>
                <div style="font-weight:600;color:#1e293b;">{{ sub.pmName }}</div>
                <div style="color:#94a3b8;font-size:11px;">
                  {{ sub.projectCount || 0 }} 个项目 · {{ sub.submittedAt ? new Date(sub.submittedAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—' }}
                </div>
              </div>
              <el-button size="mini" @click="showPmDiff(sub.pmName, sub.snapshotVersion)">查看变更</el-button>
              <el-button size="mini" type="success" @click="handleReceivePm(sub.pmName)">确认接收</el-button>
            </div>
          </div>
        </div>

        <!-- 底部状态栏 -->
        <div style="padding:6px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;color:#64748b;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span>共 {{ filteredProjects.length }} 条记录</span>
            <span>报告月份：{{ store.reportingMonth }}</span>
            <span>当前角色：{{ user.name || '—' }}</span>
            <span v-if="isPm && pmLocked" style="color:#f59e0b;font-weight:500;">
              <i class="el-icon-lock"></i> 已提交，待板块接收
            </span>
            <span v-else-if="!isSystemAdmin && reportingSubmitted" style="color:#ef4444;font-weight:500;">
              <i class="el-icon-lock"></i> 板块已提交审批，填报数据已锁定
            </span>
            <span v-else-if="!isSystemAdmin && lockStatus !== 'open'" style="color:#ef4444;font-weight:500;">
              <i class="el-icon-lock"></i> 编辑受限
            </span>
          </div>
          <span style="color:#94a3b8;white-space:nowrap;">
            系统数据{{ systemDataSyncedAtLabel ? ('更新于 ' + systemDataSyncedAtLabel) : '尚未同步' }}
          </span>
        </div>

        <!-- PM diff 对比弹窗（板块管理员用） -->
        <el-dialog
          :title="'变更对比 — ' + pmDiffName"
          :visible.sync="pmDiffVisible"
          width="760px"
          top="8vh"
        >
          <div v-if="pmDiffResults.length === 0" style="text-align:center;padding:40px;color:#94a3b8;">
            暂无变更数据
          </div>
          <div v-for="row in pmDiffResults" :key="row.projectNo" style="margin-bottom:16px;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:6px;padding:4px 8px;background:#f1f5f9;border-radius:4px;">
              {{ row.projectNo }} · {{ row.projectName }}
            </div>
            <el-table :data="row.diffs" size="mini" border style="width:100%;">
              <el-table-column label="字段" prop="field" width="140"></el-table-column>
              <el-table-column :label="pmDiffColLeft" prop="leftVal">
                <template slot-scope="{row: d}">
                  <span style="color:#64748b;">{{ d.leftVal || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="pmDiffColRight" prop="rightVal">
                <template slot-scope="{row: d}">
                  <span style="color:#007069;font-weight:500;">{{ d.rightVal || '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <span slot="footer">
            <el-button @click="pmDiffVisible = false">关闭</el-button>
          </span>
        </el-dialog>

        <project-detail-drawer
          :visible="projectDrawerVisible"
          :project="projectDrawerProject"
          :can-edit="canEdit"
          :saving="projectDrawerSaving"
          :month-idx="monthIdx"
          :field-editable="drawerFieldEditableProp"
          :format-value="drawerFormatValueProp"
          :stock-warning-field="drawerStockWarningProp"
          @close="closeProjectDrawer"
          @save="handleProjectDrawerSave"
        />
      </div>
    `,
    // 计算分区列表（用于表头分组）
    computed: {
      store()   { return window.Store; },
      user()    { return Store.currentUser || {}; },
      lockStatus() { return Store.lockStatus; },
      reportingSubmitted() {
        if (this.isSectorAdmin) {
          return Store.isSectorReportingSubmitted(this.user.sector || 'S520');
        }
        return !!Store.reportingSubmitted;
      },
      isSystemAdmin() { return this.user.role === 'system_admin'; },
      monthIdx()   { return Store.getMonthIdx(); },
      isPm()    { return this.user.role === 'pm'; },
      isSectorAdmin() { return this.user.role === 'sector_admin'; },
      lsMountId() { return 'luckysheet-mount'; },
      lsGridKey() { return 'ptrack_editor_v2'; },
      newProjectCount() {
        return this.scopedProjects.filter(function (p) { return p._added_this_month; }).length;
      },
      changedProjectCount() {
        return this.scopedProjects.filter(function (p) {
          return p._changed_fields && p._changed_fields.length;
        }).length;
      },

      // PM 专属：当前 PM 是否处于「已提交待接收」锁定
      pmName()  { return this.user.pmName || this.user.name || ''; },
      pmLocked() {
        if (!this.isPm) return false;
        return Store.isPmLocked(this.pmName);
      },
      // PM 是否可以提交
      canPmSubmitNow() {
        if (!this.isPm) return false;
        if (this.reportingSubmitted) return false;
        if (this.lockStatus !== 'open') return false;
        if (this.hasStockViolationsInScope) return false;
        return !this.pmLocked;
      },

      // 板块管理员：本月待接收的 PM 提交列表
      pendingPmSubmissions() {
        if (!this.isSectorAdmin) return [];
        const month = Store.reportingMonth;
        const subs = Store.pmSubmissions[month] || {};
        return Object.entries(subs)
          .filter(([, v]) => v.status === 'submitted')
          .map(([pmName, v]) => ({ pmName, ...v }));
      },

      // 通用：提交按钮是否显示（PM 和板块管理员；查看快照时隐藏）
      canShowSubmitButton() {
        if (this.isViewingSnapshot) return false;
        return this.isPm || this.isSectorAdmin;
      },
      canShowArchiveButton() {
        return this.isSystemAdmin && !this.isViewingSnapshot;
      },
      canSubmitArchive() {
        return !Store.isCompanyArchived();
      },
      // 板块管理员提交审批是否可用
      canSubmit() {
        if (this.isViewingSnapshot) return false;
        if (this.isPm) return this.canPmSubmitNow;
        if (this.isSystemAdmin) return false;
        return this.isSectorAdmin
          && this.lockStatus === 'open'
          && !this.reportingSubmitted
          && !this.hasStockViolationsInScope;
      },
      submitButtonLabel() {
        if (this.isPm) {
          if (this.hasStockViolationsInScope) return '存量合同额为负，请调减完成额';
          if (this.pmLocked) return '已提交，待板块接收';
          if (this.reportingSubmitted) return '板块已提交审批';
          return '提交';
        }
        if (this.hasStockViolationsInScope) return '存量合同额为负，请调减完成额';
        return this.reportingSubmitted ? '已提交审批' : '提交审批';
      },
      isViewingSnapshot() {
        return this.viewingVersion !== '__current__';
      },
      canImport() {
        const role = this.user.role;
        if (role === 'sector_director' || role === 'group_leader') return false;
        if (!this.canEdit) return false;
        return ['system_admin', 'sector_admin', 'pm'].indexOf(role) >= 0;
      },
      editorSnapshotOptions() {
        const self = this;
        const ORDER = ['Draft', 'Approve1', 'Approve2', 'J版'];
        const snaps = Store.snapshots || {};
        const keys = Object.keys(snaps);
        const pm = this.pmName;
        let filtered = keys;
        if (this.isPm) {
          filtered = keys.filter(function (k) {
            if (ORDER.indexOf(k) >= 0) return true;
            return k.indexOf('PM:' + pm + ':') === 0;
          });
        }
        const ordered = [];
        ORDER.forEach(function (v) {
          if (filtered.indexOf(v) >= 0) {
            ordered.push({
              value: v,
              label: self.formatSnapshotOptionLabel(v, snaps[v])
            });
          }
        });
        filtered
          .filter(function (k) { return ORDER.indexOf(k) < 0; })
          .sort(function (a, b) {
            return new Date(self.resolveSnapshotTime(b, snaps[b]) || 0) -
              new Date(self.resolveSnapshotTime(a, snaps[a]) || 0);
          })
          .forEach(function (k) {
            ordered.push({
              value: k,
              label: self.formatSnapshotOptionLabel(k, snaps[k])
            });
          });
        return ordered;
      },
      snapshotViewMeta() {
        if (!this.isViewingSnapshot) return null;
        const snap = Store.snapshots[this.viewingVersion];
        return {
          label: this.formatSnapshotOptionLabel(this.viewingVersion, snap)
        };
      },
      isFinance() { return this.user.role === 'finance'; },
      canEdit() {
        if (this.isViewingSnapshot) return false;
        const role = this.user.role;
        if (role === 'finance') return false;
        if (role === 'system_admin') return true;
        // PM：个人锁定或板块正式提交后均不可编辑
        if (this.isPm) {
          if (this.pmLocked) return false;
          if (this.reportingSubmitted) return false;
        } else {
          if (this.reportingSubmitted) return false;
        }
        return this.lockStatus !== 'locked';
      },
      // 按角色过滤后的项目（PM 只看自己的）
      scopedProjects() {
        let list = this.tableProjects;
        if (this.isPm) {
          const pm = this.pmName;
          list = list.filter(p => p.pm_name === pm);
        } else if (this.isSectorAdmin) {
          const sector = this.user.sector || 'S520';
          list = list.filter(p => (p.unit_code || 'S520') === sector);
        }
        return list;
      },
      filteredProjects() {
        let p = this.scopedProjects;
        if (this.viewMode === 'new_only')     return p.filter(x => x._added_this_month);
        if (this.viewMode === 'changed_only') return p.filter(x => x._changed_fields && x._changed_fields.length > 0);
        if (this.viewMode === 'warning_only' && window.StockValidation) {
          const monthIdx = this.monthIdx;
          return p.filter(function (x) { return StockValidation.hasStockWarning(x, monthIdx); });
        }
        return p;
      },
      warningProjectCount() {
        if (!window.StockValidation) return 0;
        return StockValidation.countWarnings(this.scopedProjects, this.monthIdx);
      },
      hasStockViolationsInScope() {
        if (!window.StockValidation) return false;
        return StockValidation.countContractViolations(this.scopedProjects, this.monthIdx) > 0;
      },
      lockBannerClass() {
        if (this.isSystemAdmin) return 'open';
        if (this.isFinance && Store.financeReviewReminder) return 'finance-only';
        if (this.isFinance) return 'open';
        if (this.isPm && this.pmLocked) return 'locked';
        if (this.reportingSubmitted) return 'locked';
        if (Store.financeReviewReminder) return 'finance-only';
        return { open: 'open', locked: 'locked' }[this.lockStatus] || 'open';
      },
      lockBannerText() {
        if (this.isSystemAdmin) return '系统管理员 — 可编辑全部项目数据';
        if (this.isFinance) {
          if (Store.financeReviewReminder) {
            return '财务核查提醒期（每月1-3日）— 请核对开票/回款等数据，表格为只读查看';
          }
          return '财务审核 — 全公司数据只读查看（无期限限制）';
        }
        if (this.isPm && this.pmLocked) {
          return '您已提交本月填报，等待板块管理员接收后可再次编辑';
        }
        if (this.reportingSubmitted) {
          if (this.isPm) return '板块已正式提交审批，本月填报已锁定';
          return '本月填报已提交审批 — 数据已锁定，待审批或驳回后可再编辑';
        }
        if (Store.financeReviewReminder) {
          return '财务核查提醒期（1-3日）— 请财务完成上月数据核对，其他角色填报照常开放';
        }
        if (this.lockStatus === 'locked') {
          return '数据已锁定（每月25日）— 仅管理员可临时解锁编辑';
        }
        return '填报窗口开放中 — 可正常填报';
      },
      tableSections() {
        return FieldConfig.getSections(this.tableFields);
      },
      systemDataSyncedAtLabel() {
        const raw = Store.systemDataSyncedAt;
        if (!raw) return '';
        const d = new Date(raw);
        if (isNaN(d.getTime())) return '';
        const pad = function (n) { return n < 10 ? '0' + n : String(n); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      },
      drawerFieldEditableProp() {
        var self = this;
        return function (field) { return self.canEditField(field); };
      },
      drawerFormatValueProp() {
        var self = this;
        return function (val, field) { return self.formatCellValue(val, field); };
      },
      drawerStockWarningProp() {
        var self = this;
        return function (project, field) { return self.drawerStockWarningField(project, field); };
      }
    }
  };
})(window);
