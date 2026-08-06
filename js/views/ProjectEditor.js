/**
 * ProjectEditor.js — 查看数据页（Luckysheet 默认；经典 HTML 表格代码保留，UI 已隐藏）
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
      if (window.ProjectDetailDrawer) c.ProjectDetailDrawer = window.ProjectDetailDrawer;
      if (window.AlertsDrawer) c.AlertsDrawer = window.AlertsDrawer;
      return c;
    })(),
    data() {
      return {
        luckysheetReady: false,
        viewMode: 'all',       // 'all' | 'changed_only'
        compactColumnsOnly: false,
        submitLoading: false,
        saveLoading: false,
        archiveLoading: false,
        importLoading: false,
        exportLoading: false,
        clearCompletionLoading: false,
        showDiffHint: true,
        viewingVersion: '__current__',
        snapshotLoading: false,
        snapshotProjects: null,
        downloadSnapshotLoading: false,
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
        // 板块管理员 PM 底栏
        pmDockExpanded: true,
        pmDiffVisible: false,
        pmDiffName: '',
        pmDiffResults: [],
        pmDiffColLeft: '填报基准',
        pmDiffColRight: '当前追踪表',
        _cellSaveChain: null,
        projectDrawerVisible: false,
        projectDrawerProject: null,
        projectDrawerRowIndex: null,
        projectDrawerFocusTarget: null,
        projectDrawerSaving: false,
        alertsDrawerVisible: false,
        alertsBadgeCount: null,
        _lsProjectNoMouseUp: null,
      };
    },
    mounted() {
      const self = this;
      this._unwatchFields = this.$watch(
        function () { return Store.fieldDictionary; },
        function () {
          if (!Store.fieldDictionary.length) return;
          self.syncEditorFromFieldDictionary(!self.luckysheetReady);
        },
        { deep: true }
      );
      this.syncEditorFromFieldDictionary(true);
      this._unwatchSidebar = this.$watch(
        function () { return Store.sidebarCollapsed; },
        function () { this.resizeLuckysheetLayout(); }.bind(this)
      );
      this.fetchAlertsBadgeCount();
    },
    activated() {
      const self = this;
      // 安全重置：非 system_admin 不可切换版本
      if (!this.isSystemAdmin) {
        this.viewingVersion = '__current__';
        this.snapshotProjects = null;
      }
      const afterData = function () {
        if (self.viewingVersion !== '__current__') {
          self.handleViewingVersionChange(self.viewingVersion);
        } else {
          self.buildTableData();
        }
        if (self.activeTab === 'luckysheet') {
          self.$nextTick(function () { self.refreshLuckysheet(); });
        }
      };
      if (Store.currentUser && Store.currentUser.role === 'sector_admin') {
        Store.syncPmWorkflow().then(afterData).catch(afterData);
      } else if (Store.currentUser && Store.currentUser.role === 'system_admin') {
        Store.init().then(afterData).catch(afterData);
      } else {
        afterData();
      }
      this.fetchAlertsBadgeCount();
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
      if (this._unwatchFields) {
        this._unwatchFields();
        this._unwatchFields = null;
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
      monthIdx: function () {
        this.fetchAlertsBadgeCount();
      },
      alertsDrawerVisible: function (v) {
        if (!v) this.fetchAlertsBadgeCount();
      }
    },
    methods: {
      // ── 报告线钩子方法（默认空实现，ReportLineDetailView 覆盖） ──
      handleRlSubmit()  {},
      handleRlApprove() {},
      handleRlReject()  {},
      fetchAlertsBadgeCount: function () {
        if (!this.canShowAlertsButton) {
          this.alertsBadgeCount = null;
          return;
        }
        var self = this;
        var year = Store.reportingMonth
          ? parseInt(String(Store.reportingMonth).slice(0, 4), 10)
          : new Date().getFullYear();
        var monthIdx = this.monthIdx;
        if (monthIdx == null || isNaN(monthIdx)) return;
        fetch('/api/admin/alerts?year=' + year + '&monthIdx=' + monthIdx)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var summary = d && d.summary;
            // 按钮展示活跃预警数（当前需关注的总数）
            self.alertsBadgeCount = summary && summary.activeCount != null
              ? Number(summary.activeCount) || 0
              : 0;
          })
          .catch(function () {
            /* 角标失败时保留上次数字，不打断主流程 */
          });
      },
      formatPmSubmissionMeta(sub) {
        var time = sub && sub.submittedAt
          ? new Date(sub.submittedAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
          : '—';
        return (sub.projectCount || 0) + ' 个项目 · ' + time;
      },
      // ────────────────────────────────────────────────────

      /** 字段字典就绪后重建表格 / Luckysheet（避免空表头） */
      syncEditorFromFieldDictionary: function (initLuckysheet) {
        if (!Store.fieldDictionary.length) return;
        this.tableFields = FieldConfig.buildFieldConfig();
        this.buildTableData();
        if (this.activeTab !== 'luckysheet') return;
        var self = this;
        this.$nextTick(function () {
          if (initLuckysheet || !self.luckysheetReady) {
            self.initLuckysheet();
          } else {
            self.refreshLuckysheet();
          }
          self.setupLuckysheetResizeObserver();
        });
      },
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
        if (!this.isViewingSnapshot && window.BaselineDiff) {
          const baselineSnap = BaselineDiff.resolveBaselineSnapshot(
            Store.snapshots,
            Store.baselineVersion
          );
          if (baselineSnap && baselineSnap.projects) {
            this.tableProjects = BaselineDiff.applyAddedSinceBaselineFlags(
              this.tableProjects,
              baselineSnap.projects
            );
            const baselineMap = {};
            baselineSnap.projects.forEach(function (bp) {
              if (bp && bp.project_no) baselineMap[bp.project_no] = bp;
            });
            const compareFields = FieldConfig.buildFieldConfig();
            this.tableProjects = this.tableProjects.map(function (p) {
              return BaselineDiff.mergeBaselineChangedFields(
                p,
                baselineMap[p.project_no],
                compareFields
              );
            });
          }
        }
      },
      getStoreProject(projectNo) {
        return Store.projects.find(function (p) { return p.project_no === projectNo; });
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
          copy: true,
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
          filter: false,
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
            if (field.source_type === 'auto_calc') continue;
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
        const self = this;
        const period = Store.reportingMonth
          || (Store.periodConfig && Store.periodConfig.reportingMonth)
          || '';

        self.archiveLoading = true;
        Promise.resolve()
          .then(function () {
            return self.flushLuckysheetToStore();
          })
          .then(function () {
            return Store.queryReportLines({ status: 'finalizing', period: period });
          })
          .then(function (lines) {
            self.archiveLoading = false;
            const count = Array.isArray(lines) ? lines.length : 0;
            const msg = count > 0
              ? ('确认提交公司归档？将生成新的 J 版快照，并将 ' + period
                + ' 周期处于「核对归档中」的报告线同步完成归档（变为已完成，之后不再与主表同步）。')
              : '确认提交公司归档？将生成新的 J 版快照（含全部项目），并更新内容对比基准。';
            return self.$confirm(msg, '提交归档', {
              confirmButtonText: '确认归档',
              cancelButtonText: '取消',
              type: 'warning'
            });
          })
          .then(function () {
            self.archiveLoading = true;
            return Store.archiveCompany();
          })
          .then(function (d) {
            const ver = (d && d.version) || Store.latestJVersion;
            const sealed = d && d.finalizedReportLines && d.finalizedReportLines.count
              ? ('；已封账报告线 ' + d.finalizedReportLines.count + ' 条')
              : '';
            self.$message.success('已生成 J 版快照' + (ver ? '：' + ver : '') + sealed);
            if (ver) {
              self.viewingVersion = ver;
              self.handleViewingVersionChange(ver);
            }
          })
          .catch(function (e) {
            if (e === 'cancel' || e === 'close') return;
            self.$message.error('归档失败：' + (e && e.message ? e.message : e));
          })
          .finally(function () {
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
        const iso = this.resolveSnapshotTime(versionKey, snap);
        const timeStr = iso ? this.formatSnapshotTime(iso, true) : '时间未知';
        if (snap && snap.label) {
          return snap.label + ' · ' + timeStr;
        }
        if (window.BaselineDiff && BaselineDiff.parseSnapshotKey(versionKey)) {
          const parsed = BaselineDiff.parseSnapshotKey(versionKey);
          const stageLabel = { I: '导入', D: 'D版', J: 'J版' }[parsed.stage] || parsed.stage;
          return stageLabel + ' · ' + timeStr;
        }
        const legacyLabels = { 'J版': 'J版', Draft: '草稿', Approve1: '初审', Approve2: '复审' };
        if (legacyLabels[versionKey]) {
          return legacyLabels[versionKey] + ' · ' + timeStr;
        }
        return versionKey + ' · ' + timeStr;
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

      async _applyFieldChangesToProject(storeProject, changes, user) {
        if (!changes || !changes.length) return storeProject;
        const self = this;
        const flat = FieldConfig.arraysToFlat(storeProject);
        changes.forEach(function (ch) {
          flat[ch.key] = ch.newVal;
        });
        const updated = FieldConfig.flatToArrays(flat);
        let recomputed = FormulaEngine.compute(updated, self.monthIdx);
        const allChanges = changes.slice();
        if (window.WipValidation) {
          const wipClear = WipValidation.clearWhenPendingInvoiceWipBecomesZero(storeProject, recomputed);
          if (wipClear.changed) {
            ['AM', 'AN', 'AO'].forEach(function (col) {
              const key = FieldConfig.COL_TO_KEY[col];
              const field = self.tableFields.find(function (f) { return f.col === col; });
              if (!key || !field) return;
              const oldVal = recomputed[key];
              if (oldVal == null || String(oldVal).trim() === '') return;
              allChanges.push({ field: field, key: key, oldVal: oldVal, newVal: '' });
            });
            recomputed = wipClear.project;
          }
        }
        const tracking = window.ChangeMeta
          ? ChangeMeta.mergeChangeTracking(storeProject)
          : { _field_change_log: {}, _changed_fields: [] };
        const changeLog = tracking._field_change_log;
        allChanges.forEach(function (ch) {
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
        recomputed._field_change_log = changeLog;
        recomputed._changed_fields = tracking._changed_fields.slice();
        allChanges.forEach(function (ch) {
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
        for (let i = 0; i < allChanges.length; i++) {
          const ch = allChanges[i];
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

      async _applySystemRefChangesToProject(storeProject, field, newVal, user, opts) {
        const self = this;
        const key = FieldConfig.COL_TO_KEY[field.col];
        const flat = FieldConfig.arraysToFlat(storeProject);
        const oldVal = flat[key];
        let updated = SystemRefMeta.applyOverride(storeProject, field, newVal, user, self.monthIdx);
        updated = FormulaEngine.compute(updated, self.monthIdx);
        updated = this.applySystemRefContractHedge(updated, field);
        var wipAutoClearChanges = [];
        if (window.WipValidation) {
          var wipClear = WipValidation.clearWhenPendingInvoiceWipBecomesZero(storeProject, updated);
          if (wipClear.changed) {
            ['AM', 'AN', 'AO'].forEach(function (col) {
              var clearKey = FieldConfig.COL_TO_KEY[col];
              var clearField = self.tableFields.find(function (f) { return f.col === col; });
              if (!clearKey || !clearField) return;
              var clearOldVal = updated[clearKey];
              if (clearOldVal == null || String(clearOldVal).trim() === '') return;
              wipAutoClearChanges.push({
                field: clearField,
                key: clearKey,
                oldVal: clearOldVal,
                newVal: ''
              });
            });
            updated = wipClear.project;
            if (window.ChangeMeta && wipAutoClearChanges.length) {
              wipAutoClearChanges.forEach(function (ch) {
                ChangeMeta.recordFieldChangeLog(updated, ch.field, ch.oldVal, ch.newVal, user);
              });
              updated._changed_fields = updated._changed_fields || [];
              wipAutoClearChanges.forEach(function (ch) {
                if (updated._changed_fields.indexOf(ch.field.col) < 0) {
                  updated._changed_fields.push(ch.field.col);
                }
              });
            }
          }
        }
        await Store.updateProject(updated);
        await Store.addAuditLog({
          projectNo: storeProject.project_no,
          projectName: storeProject.project_name,
          fieldName: field.col,
          fieldCN: field.name_cn,
          operation_type: 'system_ref_override',
          oldVal: Formatters.formatByType(oldVal, field.data_type),
          newVal: Formatters.formatByType(newVal, field.data_type),
          userId: user.role,
          userName: user.name
        });
        for (var i = 0; i < wipAutoClearChanges.length; i++) {
          var ch = wipAutoClearChanges[i];
          await Store.addAuditLog({
            projectNo: storeProject.project_no,
            projectName: storeProject.project_name,
            fieldName: ch.field.col,
            fieldCN: ch.field.name_cn,
            operation_type: 'wip_auto_clear',
            oldVal: Formatters.formatByType(ch.oldVal, ch.field.data_type),
            newVal: '',
            userId: user.role,
            userName: user.name
          });
        }
        self.buildTableData();
        if (
          SystemRefMeta.isEmptyDisplayValue(field, newVal) &&
          SystemRefMeta.isOverriddenField(updated, field, self.monthIdx)
        ) {
          return self.promptRestoreSystemRef(updated, field, opts);
        }
        return updated;
      },

      applySystemRefContractHedge(project, sourceField) {
        if (!project || !sourceField || !window.StockValidation || sourceField.col !== 'O') return project;
        var result = StockValidation.applyOpenPeriodStockHedge(project, this.monthIdx, this.lockStatus);
        if (!result.changed) return project;
        var completionCol = FieldConfig.MC_COLS[this.monthIdx];
        var completionField = FieldConfig.buildFieldConfig().find(function (f) {
          return f.col === completionCol;
        });
        if (!completionField) return result.project;
        var oldVal = FieldConfig.arraysToFlat(project)['mc_' + this.monthIdx];
        var next = result.project;
        var newVal = FieldConfig.arraysToFlat(next)['mc_' + this.monthIdx];
        if (window.ChangeMeta) {
          ChangeMeta.recordFieldChangeLog(next, completionField, oldVal, newVal, {
            roleLabel: '系统自动对冲',
            name: '系统自动对冲',
            role: 'system'
          });
        }
        next._changed_fields = next._changed_fields || [];
        if (next._changed_fields.indexOf(completionField.col) < 0) {
          next._changed_fields.push(completionField.col);
        }
        return next;
      },

      promptRestoreSystemRef(project, field, opts) {
        const self = this;
        return this.$confirm('是否恢复工程平台引用值？', '恢复系统引用', {
          confirmButtonText: '恢复',
          cancelButtonText: '保持空值',
          type: 'info'
        }).then(function () {
          const restored = SystemRefMeta.restoreFromRef(project, field, self.monthIdx);
          return self.applySystemRefContractHedge(
            FormulaEngine.compute(restored, self.monthIdx),
            field
          );
        }).then(function (recomputed) {
          return Store.updateProject(recomputed).then(function () {
            self.buildTableData();
            if (opts && opts.fromLuckysheet && self.activeTab === 'luckysheet' && opts.lsRow != null) {
              const rowIdx = opts.lsRow - self.lsLayout().dataStart;
              self.syncLuckysheetProjectRowValues(rowIdx, recomputed);
              self.syncLuckysheetProjectRowDecor(rowIdx, recomputed);
            }
            return recomputed;
          });
        }).catch(function (e) {
          if (e === 'cancel' || e === 'close') return project;
          throw e;
        });
      },

      async handleSystemRefCellEdit(project, field, newVal, opts) {
        const self = this;
        return this._trackCellSave((async function () {
          const storeProj = self.getStoreProject(project.project_no) || project;
          const recomputed = await self._applySystemRefChangesToProject(
            storeProj, field, newVal, self.user, opts
          );
          if (opts && opts.fromLuckysheet && self.activeTab === 'luckysheet' && opts.lsRow != null) {
            const fresh = self.getStoreProject(project.project_no) || recomputed;
            const rowIdx = opts.lsRow - self.lsLayout().dataStart;
            self.syncLuckysheetProjectRowValues(rowIdx, fresh);
            self.recalcLuckysheetFormulas();
            setTimeout(function () {
              self.syncLuckysheetProjectRowDecor(rowIdx, fresh);
            }, 320);
          }
        })().catch(function (e) {
          if (e === 'cancel' || e === 'close') return;
          self.$message.error('保存失败：' + (e.message || e));
          throw e;
        }));
      },

      async handleCellEdit(project, field, newVal, opts) {
        if (window.SystemRefMeta && SystemRefMeta.isSystemRefField(field, this.monthIdx)) {
          return this.handleSystemRefCellEdit(project, field, newVal, opts);
        }
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
        var shouldGuide = window.StockValidation
          && StockValidation.shouldGuideNegativeRemark(oldVal, newVal, field, this.monthIdx);

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
          if (shouldGuide) {
            var guideRowIdx = (opts && opts.lsRow != null)
              ? (opts.lsRow - self.lsLayout().dataStart)
              : -1;
            self.triggerNegativeCompletionRemarkGuide(project.project_no, guideRowIdx);
          }
        })().catch(function (e) {
          self.$message.error('保存失败：' + (e.message || e));
          throw e;
        }));
      },

      openProjectDrawer(projectNo, dataRowIndex, options) {
        options = options || {};
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
        this.projectDrawerFocusTarget = options.focusTarget || null;
        this.projectDrawerVisible = true;
      },

      closeProjectDrawer() {
        this.projectDrawerVisible = false;
        this.projectDrawerProject = null;
        this.projectDrawerRowIndex = null;
        this.projectDrawerFocusTarget = null;
      },
      isCurrentMonthCompletionField(field) {
        if (!field || !window.FieldConfig) return false;
        return field.col === FieldConfig.MC_COLS[this.monthIdx];
      },
      triggerNegativeCompletionRemarkGuide(projectNo, dataRowIndex) {
        if (!projectNo) return;
        this.openProjectDrawer(projectNo, dataRowIndex, {
          focusTarget: { col: 'CF' }
        });
      },

      navigateProjectDrawer(delta) {
        var list = this.filteredProjects;
        if (!list.length || !this.projectDrawerVisible) return;
        var idx = this.projectDrawerRowIndex;
        if (idx == null || idx < 0) {
          if (!this.projectDrawerProject) return;
          idx = list.findIndex(function (p) {
            return p.project_no === this.projectDrawerProject.project_no;
          }.bind(this));
        }
        var nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= list.length) return;
        var project = list[nextIdx];
        this.openProjectDrawer(project.project_no, nextIdx);
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
          this.$message.info('无更新内容');
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
        if (window.StockValidation) {
          var previewFlat = Object.assign({}, originalFlat);
          changes.forEach(function (item) {
            previewFlat[item.key] = item.newVal;
          });
          var remarkCheck = StockValidation.validateNegativeCompletionRemark(
            FieldConfig.flatToArrays(previewFlat),
            this.monthIdx
          );
          if (!remarkCheck.ok) {
            this.$message.warning(remarkCheck.message);
            this.projectDrawerFocusTarget = { col: 'CF' };
            return;
          }
        }

        this.projectDrawerSaving = true;
        try {
          await this._trackCellSave((async function () {
            var refChanges = [];
            var normalChanges = [];
            changes.forEach(function (ch) {
              if (window.SystemRefMeta && SystemRefMeta.isSystemRefField(ch.field, self.monthIdx)) {
                refChanges.push(ch);
              } else {
                normalChanges.push(ch);
              }
            });
            var latest = storeProj;
            for (var ri = 0; ri < refChanges.length; ri++) {
              var rch = refChanges[ri];
              latest = await self._applySystemRefChangesToProject(
                latest, rch.field, rch.newVal, self.user, {}
              );
            }
            if (normalChanges.length) {
              latest = await self._applyFieldChangesToProject(latest, normalChanges, self.user);
            }
            var fresh = self.getStoreProject(project.project_no) || latest;
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
            '提交后本月填报将被锁定，且每月仅可提交一次。如有问题需由板块管理员在板块汇总表中修正。确认提交？',
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
              .then(function () {
                self.$message.success('已提交，数据已同步至板块汇总；如有问题请联系板块管理员');
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
            const self = this;
            this.submitLoading = true;
            this.persistLuckysheetBeforeSubmit()
              .then(function () {
                if (!self.assertStockBeforeSubmit()) {
                  throw new Error('stock_validation');
                }
                return Store.submitForApproval();
              })
              .then(function () {
                self.$message.success('已提交审批，D 版快照已生成');
                if (self.activeTab === 'luckysheet') {
                  self.$nextTick(function () { self.refreshLuckysheet(); });
                }
                self.$router.push('/approval');
              })
              .catch(function (e) {
                if (e && e.message !== 'stock_validation') {
                  self.$message.error('提交失败：' + (e.message || e));
                }
              })
              .finally(function () { self.submitLoading = false; });
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
        const ver = Store.latestJVersion || 'J版';
        this.viewingVersion = ver;
        this.handleViewingVersionChange(ver);
      },

      togglePmDock() {
        this.pmDockExpanded = !this.pmDockExpanded;
      },

      showPmDiff(pmName) {
        const self = this;
        const baselineSnap = window.BaselineDiff
          ? BaselineDiff.resolveBaselineSnapshot(Store.snapshots, Store.baselineVersion)
          : null;
        const loading = this.$loading({ lock: true, text: '加载对比…', background: 'rgba(0,0,0,0.15)' });
        Promise.resolve(baselineSnap)
          .then(function (snap) {
            self.renderPmDiff(pmName, snap);
          })
          .catch(function () {
            self.$message.error('加载对比失败');
          })
          .finally(function () { loading.close(); });
      },

      renderPmDiff(pmName, baselineSnap) {
        const fields = FieldConfig.buildFieldConfig();
        const compareFields = fields.filter(function (f) {
          return f.source_type === 'manual_input';
        });
        const baselineProjects = (baselineSnap && baselineSnap.projects) || [];
        const currentProjects = FormulaEngine.computeAll(
          Store.projects.filter(function (p) { return p.pm_name === pmName; }),
          this.monthIdx
        );

        const results = this.diffProjectSets(baselineProjects, currentProjects, compareFields);
        this.pmDiffColLeft = baselineSnap ? '对比基准' : '—';
        this.pmDiffColRight = '当前追踪表';

        if (results.length === 0) {
          this.$message.info(
            pmName + ' 相对当前对比基准未检测到可编辑字段差异。'
          );
          return;
        }
        this.pmDiffName = pmName;
        this.pmDiffResults = results;
        this.pmDiffVisible = true;
      },
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
      handleOpenAlertsDrawer() {
        this.alertsDrawerVisible = true;
      },
      handleAlertOpenProject(projectNo) {
        this.alertsDrawerVisible = false;
        var list = this.filteredProjects;
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].project_no === projectNo) { idx = i; break; }
        }
        if (idx >= 0) {
          this.openProjectDrawer(projectNo, idx);
        } else {
          var all = Store.projects;
          for (var j = 0; j < all.length; j++) {
            if (all[j].project_no === projectNo) {
              this.openProjectDrawer(projectNo, -1);
              break;
            }
          }
        }
      },

      currentMonthCompletionField() {
        const col = FieldConfig.MC_COLS[this.monthIdx];
        if (!col) return null;
        return this.tableFields.find(function (field) { return field.col === col; }) || null;
      },

      async handleClearCurrentMonthCompletion() {
        if (!this.canClearCurrentMonthCompletion) return;
        const field = this.currentMonthCompletionField();
        if (!field) return;
        const self = this;
        const buildCandidates = function () {
          return self.scopedProjects.map(function (p) { return self.getStoreProject(p.project_no) || p; }).filter(function (p) {
            const flat = FieldConfig.arraysToFlat(p);
            const key = FieldConfig.COL_TO_KEY[field.col];
            const val = Number(flat[key] || 0);
            return Math.abs(val) > 1e-6;
          });
        };
        const candidates = buildCandidates();
        if (!candidates.length) {
          this.$message.info('当前可编辑范围内，当月完成额已为 0');
          return;
        }
        this.$confirm(
          '将把当前可编辑范围内 ' + candidates.length + ' 个项目的「' + field.name_cn + '」清零。该批量操作会合并为一条审计记录，是否继续？',
          '清零当月完成额确认',
          { confirmButtonText: '确认清零', cancelButtonText: '取消', type: 'warning' }
        ).then(function () {
          self.clearCompletionLoading = true;
          return self.flushLuckysheetToStore()
            .then(function () {
              var chain = Promise.resolve();
              var changedCount = 0;
              var oldTotal = 0;
              const key = FieldConfig.COL_TO_KEY[field.col];
              buildCandidates().forEach(function (project) {
                chain = chain.then(function () {
                  const fresh = self.getStoreProject(project.project_no) || project;
                  const flat = FieldConfig.arraysToFlat(fresh);
                  const oldVal = Number(flat[key] || 0);
                  if (Math.abs(oldVal) <= 1e-6) return null;
                  oldTotal += oldVal;
                  changedCount += 1;
                  flat[key] = 0;
                  const updated = FieldConfig.flatToArrays(flat);
                  const recomputed = FormulaEngine.compute(updated, self.monthIdx);
                  recomputed._field_change_log = fresh._field_change_log || {};
                  recomputed._changed_fields = (fresh._changed_fields || []).slice();
                  if (recomputed._changed_fields.indexOf(field.col) < 0) {
                    recomputed._changed_fields.push(field.col);
                  }
                  return Store.updateProject(recomputed);
                });
              });
              return chain.then(function () {
                if (!changedCount) return null;
                return Store.addAuditLog({
                  projectNo: '—',
                  projectName: '批量清零当月完成额',
                  fieldName: 'clear_current_month_completion',
                  fieldCN: field.name_cn,
                  oldVal: changedCount + ' 个项目，合计 ' + Formatters.formatAmount(oldTotal),
                  newVal: '0',
                  userId: self.user.role,
                  userName: self.user.name
                });
              });
            });
        }).then(function () {
          self.buildTableData();
          self.$nextTick(function () { self.refreshLuckysheet(); });
          self.$message.success('已清零当前范围内的当月完成额');
        }).catch(function (e) {
          if (e !== 'cancel' && e !== 'close') {
            self.$message.error('清零失败：' + (e.message || e));
          }
        }).finally(function () {
          self.clearCompletionLoading = false;
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
        const scope = this.scopedProjects.map(function (p) {
          return this.getStoreProject(p.project_no) || p;
        }.bind(this));
        const list = scope.map(function (p) {
          return FormulaEngine.compute(p, this.monthIdx);
        }.bind(this));
        if (!window.StockValidation) return { ok: true, violations: [] };
        return StockValidation.validateProjectsForSubmit(list, this.monthIdx, this.lockStatus);
      },

      validateWipBeforeSubmit() {
        const scope = this.scopedProjects.map(function (p) {
          return this.getStoreProject(p.project_no) || p;
        }.bind(this));
        const list = scope.map(function (p) {
          return FormulaEngine.compute(p, this.monthIdx);
        }.bind(this));
        if (!window.WipValidation) return { ok: true, violations: [] };
        return WipValidation.validateProjectsForSubmit(list);
      },

      assertStockBeforeSubmit() {
        const check = this.validateStockBeforeSubmit();
        if (!check.ok) {
          this.$message.error(check.message);
          return false;
        }
        const wipCheck = this.validateWipBeforeSubmit();
        if (!wipCheck.ok) {
          this.$message.error(wipCheck.message);
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
          var seed = this.sumProjectsField(projs, fld);
          var range = this.lsRef(fld.col, lay.dataStart) + ':' + this.lsRef(fld.col, lay.dataEnd);
          var formula = rowKind === 'subtotal'
            ? '=SUBTOTAL(9,' + range + ')'
            : '=SUM(' + range + ')';
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
      applyLuckysheetMergeMc(data, merge, colCount) {
        if (!data || !merge) return;
        var cols = colCount != null ? colCount : 0;
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
              if (cols > 0 && c >= cols) continue;
              if (!data[r]) {
                data[r] = cols > 0 ? Array(cols).fill(null) : [];
              } else if (cols > 0 && data[r].length < cols) {
                while (data[r].length < cols) data[r].push(null);
              }
              if (dr === 0 && dc === 0) {
                if (data[r][c] == null) data[r][c] = {};
                continue;
              }
              data[r][c] = { mc: { r: r0, c: c0 } };
            }
          }
        });
      },

      /** 将 merge 从属格同步进 celldata，避免 Luckysheet 仅用稀疏 celldata 初始化时 mergeCalculation 读 undefined */
      appendLuckysheetMergeCelldata(celldata, data, merge) {
        if (!celldata || !data || !merge) return celldata;
        var seen = {};
        celldata.forEach(function (item) {
          seen[item.r + '_' + item.c] = true;
        });
        Object.keys(merge).forEach(function (key) {
          const m = merge[key];
          if (!m || m.r == null || m.c == null) return;
          const r0 = m.r;
          const c0 = m.c;
          const rs = m.rs || 1;
          const cs = m.cs || 1;
          for (let dr = 0; dr < rs; dr++) {
            for (let dc = 0; dc < cs; dc++) {
              if (dr === 0 && dc === 0) continue;
              const r = r0 + dr;
              const c = c0 + dc;
              const sk = r + '_' + c;
              if (seen[sk]) continue;
              if (!data[r] || data[r][c] == null) continue;
              celldata.push({ r: r, c: c, v: data[r][c] });
              seen[sk] = true;
            }
          }
        });
        return celldata;
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
        this.applyLuckysheetMergeMc(data, merge, colCount);
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
        if (this.isFieldChanged(project, field)) return '#ffedd5';
        if (
          field.col === 'F' &&
          window.SystemRefMeta &&
          SystemRefMeta.isUnmatchedProject(project)
        ) {
          return SystemRefMeta.UNMATCHED_BG;
        }
        if (
          window.SystemRefMeta &&
          SystemRefMeta.isOverriddenField(project, field, this.monthIdx)
        ) {
          return SystemRefMeta.OVERRIDE_BG;
        }
        if (!readonly && this.canEditField(field) && this.canEdit) {
          return (window.ChangeMeta && ChangeMeta.EDITABLE_FIELD_STYLE)
            ? ChangeMeta.EDITABLE_FIELD_STYLE.bg
            : '#fefce8';
        }
        if (project._added_this_month) {
          return (window.BaselineDiff && BaselineDiff.NEW_PROJECT_BG) || '#d9e7d8';
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

      /** 本月有更新内容：浅橙底 + 橙字 + 左边框（与图例 / HTML .field-changed 一致） */
      applyLuckysheetHighlight(cell, project, field) {
        if (window.ChangeMeta) {
          return ChangeMeta.applyLuckysheetChangedStyle(cell, project, field);
        }
        if (!this.isFieldChanged(project, field)) return cell;
        cell.fc = '#9a3412';
        cell.bg = '#ffedd5';

        return cell;
      },

      applyLuckysheetSystemRefDecor(cell, project, field) {
        if (!window.SystemRefMeta) return cell;
        // 未匹配项目 F 列：浅琥珀色 + 批注
        if (field.col === 'F' && SystemRefMeta.isUnmatchedProject(project)) {
          const text = '该项目号未在工程平台注册\n数据来源：初始化导入表';
          cell.ps = SystemRefMeta.buildLuckysheetCommentPs(text);
          cell.bg = SystemRefMeta.UNMATCHED_BG;
          return cell;
        }
        if (!SystemRefMeta.isOverriddenField(project, field, this.monthIdx)) return cell;
        const text = SystemRefMeta.formatRefComment(project, field, this.monthIdx);
        if (text) cell.ps = SystemRefMeta.buildLuckysheetCommentPs(text);
        cell.bg = SystemRefMeta.OVERRIDE_BG;
        return cell;
      },

      applyLuckysheetChangeComment(cell, project, field) {
        if (!window.ChangeMeta || !ChangeMeta.hasFieldChangeMarkup(project, field)) return cell;
        const text = ChangeMeta.formatChangeComment(project, field, Store.auditLog);
        if (text) cell.ps = ChangeMeta.buildLuckysheetCommentPs(text);
        return cell;
      },

      countNumberFormatDecimals(format) {
        if (!format || typeof format !== 'string') return null;
        var dot = format.indexOf('.');
        if (dot < 0) return 0;
        var tail = format.slice(dot + 1);
        var match = tail.match(/[0#]+/);
        return match ? match[0].length : 0;
      },

      countDisplayDecimals(value) {
        if (value == null || value === '') return null;
        var s = String(value).replace(/,/g, '').trim();
        var match = s.match(/^-?\d+\.(\d+)/);
        return match ? match[1].length : null;
      },

      formatNumberWithDecimals(value, decimals) {
        var n = Number(value);
        if (isNaN(n) || decimals == null) return value != null ? String(value) : '';
        return n.toLocaleString('zh-CN', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        });
      },

      preserveLuckysheetNumberFormat(nextCell, oldCell, field) {
        if (!nextCell || !oldCell || !field) return nextCell;
        if (field.data_type !== '金额' && field.data_type !== '比率') return nextCell;
        if (oldCell.ct) nextCell.ct = Object.assign({}, oldCell.ct);
        if (oldCell.ht != null) nextCell.ht = oldCell.ht;

        var decimals = this.countDisplayDecimals(oldCell.m);
        if (decimals == null && oldCell.ct) {
          decimals = this.countNumberFormatDecimals(oldCell.ct.fa);
        }
        if (decimals != null && nextCell.v != null && nextCell.v !== '') {
          nextCell.m = this.formatNumberWithDecimals(nextCell.v, decimals);
        }
        return nextCell;
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
          const oldCell = row[c];
          const nextCell = this.makeLuckysheetDataCell(project, field, r, dataRowIndex);
          row[c] = this.preserveLuckysheetNumberFormat(nextCell, oldCell, field);
        }
        try {
          if (typeof luckysheet.jfrefreshgrid === 'function') luckysheet.jfrefreshgrid();
        } catch (e) { /* ignore */ }
      },

      /** 按项目更新内容记录，同步该行所有批注与高亮（公式重算后防丢失） */
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
          if (window.SystemRefMeta && SystemRefMeta.isOverriddenField(project, field, this.monthIdx)) {
            this.applyLuckysheetSystemRefDecor(cell, project, field);
          } else if (window.ChangeMeta && ChangeMeta.hasFieldChangeMarkup(project, field)) {
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
        var out = this.applyLuckysheetSystemRefDecor(
          this.applyLuckysheetChangeComment(
            this.applyLuckysheetStockWarning(
              this.applyLuckysheetHighlight(cell, project, field),
              project,
              field
            ),
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

      buildLuckysheetTotalRowCells(r, label, rowKind, projs) {
        const cells = [];
        projs = projs || this.filteredProjects;
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
        const totalProjs = this.filteredProjects;
        this.buildLuckysheetTotalRowCells(lay.subtotal, '小计 Subtotal', 'subtotal', totalProjs).forEach(function (item) {
          push(item.r, item.c, item.v);
        });
        this.buildLuckysheetTotalRowCells(lay.sum, '合计 Total', 'sum', totalProjs).forEach(function (item) {
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
        if (!file || !file.filter_select || !file.filter_select.column) return;
        const cellMain = document.querySelector('#' + this.lsMountId + ' #luckysheet-cell-main');
        if (!cellMain) return;
        const $opts = $('#luckysheet-filter-options-sheet' + file.index + ' .luckysheet-filter-options');
        if (!$opts.length) return;

        const scrollLeft = cellMain.scrollLeft;
        const c1 = file.filter_select.column[0];
        if (c1 == null) return;
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
              if (!file || !file.filter_select || !file.filter_select.column) return;
              const c1 = file.filter_select.column[0];
              if (c1 == null) return;
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
              // 金额校验由 cellUpdateBefore + coerceFieldValue 处理，不下发 dataVerification，
              // 避免左上角红色角标与「仅限数字」提示。
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

        if (window.SUBTOTAL_PATCH && typeof SUBTOTAL_PATCH.install === 'function') {
          SUBTOTAL_PATCH.install();
        }
        if (window.NAV_SKIP_HIDDEN && typeof NAV_SKIP_HIDDEN.install === 'function') {
          NAV_SKIP_HIDDEN.install();
        }

        var lay = this.lsLayout();
        var rows = Math.max(48, lay.dataStart + Math.max(this.filteredProjects.length, 1) + 12);
        var cols = Math.max(64, this.tableFields.length + 4);
        var celldata = this.buildLuckysheetCelldata();
        var sheetIndex = 0;
        var merge = this.buildLuckysheetMerge();
        var dataMatrix = this.buildLuckysheetDataMatrix(celldata, rows, cols, merge);
        this.appendLuckysheetMergeCelldata(celldata, dataMatrix, merge);
        var calcChain = this.buildLuckysheetCalcChain(celldata, sheetIndex, lay);

        luckysheet.create({
          container: this.lsMountId,
          lang: 'zh',
          showinfobar: false,
          showsheetbar: false,
          forceCalculation: true,
          showstatisticBar: true,
          showstatisticBarConfig: {
            count: false,
            view: false,
            zoom: true
          },
          showtoolbar: false,
          sheetFormulaBar: true,
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
              if (window.SUBTOTAL_PATCH) {
                if (typeof SUBTOTAL_PATCH.install === 'function') SUBTOTAL_PATCH.install();
                if (typeof SUBTOTAL_PATCH.refresh === 'function') SUBTOTAL_PATCH.refresh();
              }
              if (window.NAV_SKIP_HIDDEN && typeof NAV_SKIP_HIDDEN.install === 'function') {
                NAV_SKIP_HIDDEN.install();
              }
              self.recalcLuckysheetFormulas();
              self.applyLuckysheetDefaultFilter();
              self.bindProjectNoClickHandler();
            },
            updated: function (op) {
              if (window.SUBTOTAL_PATCH && typeof SUBTOTAL_PATCH.onUpdated === 'function') {
                SUBTOTAL_PATCH.onUpdated(op);
              }
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
        <!-- 只读提示条 -->
        <div v-if="showReportLineHint" class="report-line-hint" style="background:#e6f7ff;border:1px solid #91d5ff;padding:10px 16px;border-radius:4px;display:flex;align-items:center;justify-content:space-between;">
          <span style="color:#1890ff;"><i class="el-icon-info" style="margin-right:6px;"></i>当前页面仅供查看，如需填报请至&ldquo;填报与审批&rdquo;</span>
          <a href="/#/report-lines" style="color:#007069;text-decoration:none;font-weight:500;">前往填报与审批 &rarr;</a>
        </div>
        <!-- 工具栏 -->
        <div class="editor-toolbar">
          <template v-if="rlContextBar">
            <el-button size="mini" icon="el-icon-arrow-left" plain @click="$router.push('/report-lines')">填报与审批</el-button>
            <span style="color:#94a3b8;">|</span>
            <span style="font-weight:600;color:#1e293b;">{{ rlContextBar.sectorName }}</span>
            <span style="color:#64748b;">{{ rlContextBar.periodLabel }}</span>
            <el-tag :type="rlContextBar.statusType" size="small">{{ rlContextBar.statusLabel }}</el-tag>
          </template>
          <el-select
            v-if="isSystemAdmin"
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
          <el-button
            v-if="isViewingJSnapshot"
            size="mini"
            icon="el-icon-download"
            :loading="downloadSnapshotLoading"
            @click="handleDownloadSnapshot"
            style="margin-left:8px;"
          >下载此版本</el-button>

          <div class="editor-toolbar-spacer"></div>

          <div class="editor-toolbar-group">
            <el-button
              v-if="canShowAlertsButton"
              size="small"
              icon="el-icon-bell"
              @click="handleOpenAlertsDrawer"
            >项目预警（{{ alertsBadgeCount != null ? alertsBadgeCount : '…' }}）</el-button>
            <el-button
              size="small"
              icon="el-icon-download"
              :loading="exportLoading"
              @click="handleExport"
            >导出 Excel</el-button>
            <el-button
              v-if="canShowClearCompletionButton"
              size="small"
              icon="el-icon-delete"
              :loading="clearCompletionLoading"
              :disabled="!canClearCurrentMonthCompletion"
              @click="handleClearCurrentMonthCompletion"
            >清零当月完成额</el-button>
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

          <template v-if="canShowEditorSaveGroup">
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
                :title="!canSubmitArchive ? '仅在锁定期可提交归档' : ''"
                @click="handleSubmitArchive"
              >提交归档</el-button>
              <!-- 报告线提交/审批/退回按钮（仅报告线详情页覆盖相关 computed 后显示） -->
              <el-button
                v-if="rlCanSubmit"
                size="small"
                type="success"
                icon="el-icon-check"
                :loading="rlSubmitting"
                :disabled="rlSubmitDisabled"
                @click="handleRlSubmit"
              >{{ rlSubmitLabel }}</el-button>
              <el-button
                v-if="rlCanApprove"
                size="small"
                type="success"
                icon="el-icon-circle-check"
                @click="handleRlApprove"
              >审批通过</el-button>
              <el-button
                v-if="rlCanReject"
                size="small"
                type="danger"
                plain
                icon="el-icon-circle-close"
                @click="handleRlReject"
              >退回</el-button>
            </div>
          </template>
        </div>

        <!-- 图例说明 -->
        <div v-if="showDiffHint" class="editor-diff-hint">
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--editable"></span>可编辑列
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--new"></span>新增项目
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--changed"></span>有变化字段
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--system-ref"></span>系统引用已覆盖
          </span>
          <span class="editor-legend-item">
            <span class="editor-legend-swatch editor-legend-swatch--warning"></span>预警
          </span>


          <span style="flex:1;"></span>
          <span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>
        </div>

        <!-- 填报主体：默认 Luckysheet；经典 HTML 表格见 showLegacyHtmlTable -->
        <div class="luckysheet-editor-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column;">
          <div v-if="activeTab === 'luckysheet'" class="sheet-toolbar">
            <el-radio-group v-model="viewMode" size="mini" class="view-toggle view-toggle--compact">
              <el-radio-button label="all">全部（{{ scopedProjects.length }}）</el-radio-button>
              <el-radio-button label="changed_only">有变化（{{ changedProjectCount }}）</el-radio-button>
            </el-radio-group>
            <el-divider direction="vertical" class="sheet-toolbar-divider"></el-divider>
            <el-checkbox v-model="compactColumnsOnly" class="sheet-toolbar-checkbox">
              仅显示项目信息与可编辑列
            </el-checkbox>
          </div>
          <div :id="lsMountId" style="flex:1;min-height:360px;width:100%;"></div>
          <div v-if="showLegacyHtmlTable && activeTab === 'table'" style="flex:1;overflow:auto;position:relative;min-height:200px;">
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

        <!-- 板块管理员：本月已提交 PM（自动进入汇总，可查看更新内容） -->
        <div
          v-if="isSectorAdmin && submittedPmSubmissions.length > 0"
          class="sector-admin-pm-dock"
          :class="{ 'is-collapsed': !pmDockExpanded }"
        >
          <div class="sector-admin-pm-dock-head">
            <span class="sector-admin-pm-dock-title">
              <i class="el-icon-user" style="margin-right:4px;"></i>
              {{ pmSubmissionDockTitle }}
            </span>
            <span class="sector-admin-pm-dock-hint">{{ pmSubmissionDockHint }}</span>
            <el-button type="text" size="mini" class="sector-admin-pm-dock-toggle" @click="togglePmDock">
              <i :class="pmDockExpanded ? 'el-icon-arrow-down' : 'el-icon-arrow-up'"></i>
              {{ pmDockExpanded ? '收起' : '展开' }}
            </el-button>
          </div>
          <div v-show="pmDockExpanded" class="sector-admin-pm-dock-cards">
            <div
              v-for="sub in submittedPmSubmissions"
              :key="sub.pmName"
              class="sector-admin-pm-card"
              :class="{ 'is-submitted': sub.status === 'submitted' || sub.status === 'received' }"
            >
              <div>
                <div class="sector-admin-pm-card-name">{{ sub.pmName }}</div>
                <div class="sector-admin-pm-card-meta">
                  {{ formatPmSubmissionMeta(sub) }}
                </div>
              </div>
              <el-button size="mini" @click="showPmDiff(sub.pmName)">查看更新内容</el-button>
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
              <i class="el-icon-warning-outline"></i> 已提交本月填报（如需修正请联系板块管理员）
            </span>
            <span v-else-if="!isSystemAdmin && reportingSubmitted" style="color:#f59e0b;font-weight:500;">
              <i class="el-icon-warning-outline"></i> 板块已提交审批，待审批处理
            </span>
          </div>
          <span style="color:#94a3b8;white-space:nowrap;">
            系统数据{{ systemDataSyncedAtLabel ? ('更新于 ' + systemDataSyncedAtLabel) : '尚未同步' }}
          </span>
        </div>

        <!-- PM 更新内容弹窗（板块管理员用） -->
        <el-dialog
          :title="'更新内容 — ' + pmDiffName"
          :visible.sync="pmDiffVisible"
          width="760px"
          top="8vh"
        >
          <div v-if="pmDiffResults.length === 0" style="text-align:center;padding:40px;color:#94a3b8;">
            暂无更新内容
          </div>
          <div v-for="row in pmDiffResults" :key="row.projectNo" style="margin-bottom:16px;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:6px;padding:4px 8px;background:#f1f5f9;border-radius:4px;">
              {{ row.projectNo }} · {{ row.projectName }}
            </div>
            <el-table :data="row.diffs" size="mini" border style="width:100%;">
              <el-table-column label="字段" prop="field" width="140"></el-table-column>
              <el-table-column label="更新后" prop="rightVal">
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
          :nav-index="projectDrawerNavIndex"
          :nav-total="filteredProjects.length"
          :field-editable="drawerFieldEditableProp"
          :format-value="drawerFormatValueProp"
          :stock-warning-field="drawerStockWarningProp"
          :focus-target="projectDrawerFocusTarget"
          @close="closeProjectDrawer"
          @save="handleProjectDrawerSave"
          @nav-prev="navigateProjectDrawer(-1)"
          @nav-next="navigateProjectDrawer(1)"
        />

        <alerts-drawer
          :visible="alertsDrawerVisible"
          :month-idx="monthIdx"
          :can-dismiss="canDismissAlerts"
          @close="alertsDrawerVisible = false"
          @open-project="handleAlertOpenProject"
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
      // ── 报告线钩子（默认值，ReportLineDetailView 覆盖） ──
      /** 当非 null 时在工具栏上方显示报告线上下文条 */
      rlContextBar() { return null; },
      /** 控制保存/归档/报告线操作按钮分组的显示条件 */
      canShowEditorSaveGroup() {
        return this.user.role === 'system_admin' && (this.canEdit || this.canShowArchiveButton);
      },
      /** 报告线提交按钮（PM → pmSubmit；sector_admin → submitApproval） */
      rlCanSubmit()  { return false; },
      /** 报告线提交按钮禁用态 */
      rlSubmitDisabled() { return false; },
      /** 报告线提交按钮文案 */
      rlSubmitLabel() { return this.user.role === 'pm' ? '提交填报' : '提交审批'; },
      /** 报告线审批通过按钮 */
      rlCanApprove() { return false; },
      /** 报告线退回按钮 */
      rlCanReject()  { return false; },
      /** 报告线提交中状态 */
      rlSubmitting() { return false; },
      // ────────────────────────────────────────────────────
      newProjectCount() {
        return this.scopedProjects.filter(function (p) { return p._added_this_month; }).length;
      },
      changedProjectCount() {
        return this.scopedProjects.filter(function (p) {
          return p._changed_fields && p._changed_fields.length;
        }).length;
      },

      // PM 专属：本月是否已提交锁定
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
        return !this.pmLocked;
      },

      // 板块管理员：本板块本月已提交 PM 列表
      submittedPmSubmissions() {
        if (!this.isSectorAdmin) return [];
        const month = Store.reportingMonth;
        const subs = Store.pmSubmissions[month] || {};
        const sectorPmNames = {};
        this.scopedProjects.forEach(function (p) {
          if (p.pm_name) sectorPmNames[p.pm_name] = true;
        });
        return Object.entries(subs)
          .filter(function (entry) {
            const pmName = entry[0];
            const v = entry[1];
            if (!sectorPmNames[pmName]) return false;
            if (!v) return false;
            return v.status === 'submitted' || v.status === 'received';
          })
          .map(function (entry) {
            return Object.assign({ pmName: entry[0] }, entry[1]);
          })
          .sort(function (a, b) {
            return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
          });
      },
      pmSubmissionDockTitle() {
        return '本月已提交 PM（' + this.submittedPmSubmissions.length + ' 人）';
      },
      pmSubmissionDockHint() {
        return '提交后已自动进入板块汇总；';
      },
      canShowAlertsButton() {
        return !this.isViewingSnapshot;
      },
      /** 忽略/撤回仅系统管理员（用 user.role，避免子视图覆盖 isSystemAdmin） */
      canDismissAlerts() {
        return this.user.role === 'system_admin';
      },
      canShowClearCompletionButton() {
        if (this.isViewingSnapshot) return false;
        return this.isSystemAdmin;
      },
      canClearCurrentMonthCompletion() {
        if (!this.canShowClearCompletionButton) return false;
        if (!this.canEdit) return false;
        const field = this.currentMonthCompletionField();
        return !!(field && this.canEditField(field));
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
        return this.isSystemAdmin && !this.isViewingSnapshot && this.lockStatus === 'locked';
      },
      // 板块管理员提交审批是否可用
      canSubmit() {
        if (this.isViewingSnapshot) return false;
        if (this.isPm) return this.canPmSubmitNow;
        if (this.isSystemAdmin) return false;
        return this.isSectorAdmin
          && this.lockStatus === 'open'
          && !this.reportingSubmitted;
      },
      submitButtonLabel() {
        if (this.isPm) {
          if (this.pmLocked) return '已提交';
          if (this.reportingSubmitted) return '板块已提交审批';
          return '提交';
        }
        return this.reportingSubmitted ? '已提交审批' : '提交审批';
      },
      isViewingSnapshot() {
        return this.viewingVersion !== '__current__';
      },
      isViewingJSnapshot() {
        if (!this.isViewingSnapshot) return false;
        const v = this.viewingVersion;
        if (v === 'J版') return true;
        if (window.BaselineDiff) {
          const parsed = BaselineDiff.parseSnapshotKey(v);
          return parsed && parsed.stage === 'J';
        }
        return false;
      },
      canImport() {
        const role = this.user.role;
        if (role === 'sector_director' || role === 'group_leader') return false;
        if (!this.canEdit) return false;
        return ['system_admin', 'sector_admin', 'pm'].indexOf(role) >= 0;
      },
      editorSnapshotOptions() {
        const self = this;
        const snaps = Store.snapshots || {};
        const baseline = Store.baselineVersion;
        const keys = Object.keys(snaps).filter(function (k) {
          if (/^Month:/.test(k) || /^PM:/.test(k)) return false;
          if (window.BaselineDiff && BaselineDiff.isModernSnapshotKey(k)) {
            const parsed = BaselineDiff.parseSnapshotKey(k);
            return parsed && parsed.stage === 'J';
          }
          return k === 'J版';
        });
        return keys
          .sort(function (a, b) {
            return new Date(self.resolveSnapshotTime(b, snaps[b]) || 0) -
              new Date(self.resolveSnapshotTime(a, snaps[a]) || 0);
          })
          .map(function (k) {
            let label = self.formatSnapshotOptionLabel(k, snaps[k]);
            if (baseline && k === baseline) {
              label += ' · 更新基准';
            }
            return { value: k, label: label };
          });
      },
      snapshotViewMeta() {
        if (!this.isViewingSnapshot) return null;
        const snap = Store.snapshots[this.viewingVersion];
        return {
          label: this.formatSnapshotOptionLabel(this.viewingVersion, snap)
        };
      },
      isExecutiveViewer() {
        return window.DataScope && DataScope.isExecutiveViewer(this.user);
      },
      canEdit() {
        // 新增: 非系统管理员强制只读（填报已迁移至「填报与审批」）
        const role = (this.user || {}).role;
        if (role !== 'system_admin') return false;
        // ── 以下仅 system_admin ──
        if (this.isViewingSnapshot) return false;
        return true;
      },
      showReportLineHint() {
        const role = (this.user || {}).role;
        // PM 和 板块管理员 始终显示提示（因为他们原来是在这里编辑的）
        return role === 'pm' || role === 'sector_admin';
      },
      // 按角色过滤后的项目（PM 只看自己的）
      scopedProjects() {
        let list = this.tableProjects;
        if (window.DataScope) {
          return DataScope.filterProjects(this.user, list, Store.groupRegistry);
        }
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
        if (this.viewMode === 'changed_only') {
          return p.filter(x => x._changed_fields && x._changed_fields.length > 0);
        }
        return p;
      },
      projectDrawerNavIndex() {
        if (this.projectDrawerRowIndex != null && this.projectDrawerRowIndex >= 0) {
          return this.projectDrawerRowIndex;
        }
        if (!this.projectDrawerProject) return -1;
        return this.filteredProjects.findIndex(function (p) {
          return p.project_no === this.projectDrawerProject.project_no;
        }.bind(this));
      },
      hasStockViolationsInScope() {
        if (!window.StockValidation) return false;
        return StockValidation.countContractViolations(this.scopedProjects, this.monthIdx) > 0;
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
