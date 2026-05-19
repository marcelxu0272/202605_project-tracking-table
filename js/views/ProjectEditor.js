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
    data() {
      return {
        luckysheetReady: false,
        viewMode: 'all',       // 'all' | 'new_only' | 'changed_only'
        submitLoading: false,
        exportLoading: false,
        showDiffHint: true,
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
        _cellSaveChain: null
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
    },
    activated() {
      const self = this;
      const afterData = function () {
        self.buildTableData();
        self.whenPmBaselineReady(function () {
          if (self.activeTab === 'luckysheet') {
            self.$nextTick(function () { self.refreshLuckysheet(); }.bind(self));
          }
        });
      };
      if (Store.currentUser && Store.currentUser.role === 'sector_admin') {
        Store.syncPmWorkflow().then(afterData).catch(afterData);
      } else {
        afterData();
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
        this.capturePmBaselineFromTable();
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

      buildLuckysheetAuthority() {
        return {
          sheet: 1,
          hintText: '该单元格不可编辑（只读列、历史月份或当前无权限）',
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
        if (FieldConfig.isPastReportingMonthField(field, this.monthIdx)) {
          cls.push('month-locked-cell');
        }
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
      _trackCellSave(work) {
        const run = Promise.resolve(this._cellSaveChain).then(function () { return work; });
        this._cellSaveChain = run.catch(function () {});
        return run;
      },

      _waitCellSaves() {
        return Promise.resolve(this._cellSaveChain).catch(function () {});
      },

      /** 提交前：结束编辑态，把 Luckysheet 里未触发 cellUpdated 的格子写入库 */
      async persistLuckysheetBeforeSubmit() {
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
          for (let c = 0; c < this.tableFields.length; c++) {
            const field = this.tableFields[c];
            if (!field || !this.canEditField(field) || !this.canEdit) continue;
            if (field.source_type === 'auto_calc' || field.source_type === 'system_sync') continue;
            const cell = row[c];
            const newVal = this.coerceFieldValue(this.extractLuckysheetInput(cell), field);
            const key = FieldConfig.COL_TO_KEY[field.col];
            const oldFlat = FieldConfig.arraysToFlat(project);
            const oldVal = oldFlat[key];
            if (newVal === oldVal || String(newVal) === String(oldVal)) continue;
            await this.handleCellEdit(project, field, newVal, { fromLuckysheet: true });
          }
        }
        await this._waitCellSaves();
      },

      async preparePmSubmit() {
        await this.persistLuckysheetBeforeSubmit();
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

      async handleCellEdit(project, field, newVal, opts) {
        if (!this.canEditField(field)) return;
        const key = FieldConfig.COL_TO_KEY[field.col];
        const flat = FieldConfig.arraysToFlat(project);
        const oldVal = flat[key];
        if (oldVal === newVal) return;
        if (String(oldVal) === String(newVal)) return;

        const self = this;
        return this._trackCellSave((async function () {
          flat[key] = newVal;
          const updated = FieldConfig.flatToArrays(flat);
          const recomputed = FormulaEngine.compute(updated, self.monthIdx);

          if (!recomputed._changed_fields) recomputed._changed_fields = [];
          if (!recomputed._changed_fields.includes(field.col)) {
            recomputed._changed_fields.push(field.col);
          }

          await Store.updateProject(recomputed);
          await Store.addAuditLog({
            projectNo:   project.project_no,
            projectName: project.project_name,
            fieldName:   field.col,
            fieldCN:     field.name_cn,
            oldVal:      Formatters.formatByType(oldVal, field.data_type),
            newVal:      Formatters.formatByType(newVal, field.data_type),
            userId:      self.user.role,
            userName:    self.user.name
          });
          self.buildTableData();
          if ((!opts || !opts.fromLuckysheet) && self.activeTab === 'luckysheet') {
            self.scheduleRefreshLuckysheet();
          }
        })().catch(function (e) {
          self.$message.error('保存失败：' + (e.message || e));
          throw e;
        }));
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
              .then(function () { return Store.submitPmReporting(); })
              .then(function (result) {
                self.applyPmSubmitSnapshotToStore(result);
                self.$message.success('已提交，等待板块管理员接收');
                if (self.activeTab === 'luckysheet') {
                  self.$nextTick(function () { self.refreshLuckysheet(); });
                }
              })
              .catch(function (e) {
                self.$message.error('提交失败：' + (e.message || e));
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
            Store.submitForApproval()
              .then(() => {
                this.$message.success('已提交审批，Draft快照已生成');
                if (this.activeTab === 'luckysheet') {
                  this.$nextTick(function () { this.refreshLuckysheet(); }.bind(this));
                }
                this.$router.push('/approval');
              })
              .catch(e => { this.$message.error('提交失败：' + (e.message || e)); })
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
        const results = [];
        const rightList = rightProjects || [];
        const leftList = leftProjects || [];
        rightList.forEach(function (rp) {
          const lp = leftList.find(function (p) { return p.project_no === rp.project_no; });
          const rowDiffs = [];
          if (!lp) {
            rowDiffs.push({ field: '项目', leftVal: '—', rightVal: rp.project_name || '—' });
          } else {
            const lFlat = FieldConfig.arraysToFlat(lp);
            const rFlat = FieldConfig.arraysToFlat(rp);
            compareFields.forEach(function (f) {
              const key = FieldConfig.COL_TO_KEY[f.col];
              if (!key) return;
              const lv = lFlat[key];
              const rv = rFlat[key];
              if (this.fieldValuesDiffer(lv, rv, f.data_type)) {
                rowDiffs.push({
                  field: f.name_cn,
                  leftVal: Formatters.formatByType(lv, f.data_type),
                  rightVal: Formatters.formatByType(rv, f.data_type)
                });
              }
            }.bind(this));
          }
          if (rowDiffs.length > 0) {
            results.push({
              projectNo: rp.project_no,
              projectName: rp.project_name,
              diffs: rowDiffs
            });
          }
        }.bind(this));
        return results;
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
      buildLuckysheetCalcChain(celldata, sheetIndex, lay) {
        const dataEntries = [];
        const totalEntries = [];
        const sheetIdx = sheetIndex != null ? sheetIndex : 'ptrack_sheet';

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
        if (readonly) {
          cell.bg = bgTint || '#f8fafc';
        } else if (bgTint) {
          cell.bg = bgTint;
        }
        return this.lsApplyCellLock(cell, readonly);
      },

      luckysheetCellBg(project, field, readonly, dataRowIndex) {
        if (this.isFieldChanged(project, field)) return '#fff7ed';
        if (project._added_this_month) {
          return readonly ? 'rgba(0,112,105,0.07)' : 'rgba(0,112,105,0.05)';
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
        cell.ht = field.data_type === '金额' || field.data_type === '比率' ? '2' : '0';
        return this.lsApplyCellLock(cell, true);
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

      makeLuckysheetDataCell(project, field, row0, dataRowIndex) {
        const ro = !this.canEditField(field) || !this.canEdit;
        const bg = this.luckysheetCellBg(project, field, ro, dataRowIndex);
        if (field.source_type === 'auto_calc' && row0 != null) {
          const formula = this.buildLuckysheetFieldFormula(field.col, row0);
          if (formula) {
            return this.applyLuckysheetHighlight(
              this.makeLuckysheetFormulaCell(formula, field, project, bg),
              project,
              field
            );
          }
        }
        const val = this.getCellValue(project, field);
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
          const c0 = fields.indexOf(first);
          const cs = fields.indexOf(last) - fields.indexOf(first) + 1;
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
          const c0 = fields.indexOf(sec.fields[0]);
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
            tb: '2', ht: '1', vt: '0'
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
        const cellMain = document.querySelector('#luckysheet-mount #luckysheet-cell-main');
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
        const cellMain = $('#luckysheet-mount').find('#luckysheet-cell-main');
        if (!cellMain.length) return;
        const self = this;
        const handler = function () { self.syncLuckysheetFilterWithFreeze(); };
        this._lsFilterScrollHandler = handler;
        cellMain.on('scroll.lsFilterFreeze', handler);
      },

      unbindLuckysheetFilterFreezeSync() {
        const $ = window.jQuery;
        if ($) {
          $('#luckysheet-mount').find('#luckysheet-cell-main').off('scroll.lsFilterFreeze');
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
        var sheetIndex = 'ptrack_sheet';
        var calcChain = this.buildLuckysheetCalcChain(celldata, sheetIndex, lay);

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
            index: sheetIndex,
            status: 1,
            order: 0,
            celldata: celldata,
            calcChain: calcChain,
            dataVerification: this.buildLuckysheetDataVerification(),
            filter_select: this.buildLuckysheetFilterSelect(),
            filter: null,
            frozen: {
              type: 'rangeBoth',
              range: { row_focus: LS_FROZEN_ROW, column_focus: LS_FROZEN_COL }
            },
            config: {
              columnlen: this.buildLuckysheetColumnlen(),
              merge: this.buildLuckysheetMerge(),
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
              var field = self.tableFields[c];
              if (!field || !self.canEditLuckysheetCell(r, c)) return;
              var project = projs[r - layout.dataStart];
              var newVal = self.coerceFieldValue(self.extractLuckysheetInput(newValue), field);
              var oldFlat = FieldConfig.arraysToFlat(project);
              var key = FieldConfig.COL_TO_KEY[field.col];
              var oldVal = oldFlat[key];
              if (newVal === oldVal) return;
              if (String(newVal) === String(oldVal)) return;
              self.handleCellEdit(project, field, newVal, { fromLuckysheet: true })
                .then(function () {
                  self.buildTableData();
                  self.recalcLuckysheetFormulas();
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
          <!-- 填报期状态 -->
          <span class="period-banner" :class="lockBannerClass" style="flex-shrink:0;">
            <span class="period-dot"></span>
            {{ lockBannerText }}
          </span>

          <div style="flex:1;"></div>

          <!-- 视图切换 -->
          <el-radio-group v-model="viewMode" size="small" class="view-toggle">
            <el-radio-button label="all">全部（{{ scopedProjects.length }}）</el-radio-button>
            <el-radio-button label="new_only">
              新增项目（{{ scopedProjects.filter(p=>p._added_this_month).length }}）
            </el-radio-button>
            <el-radio-button label="changed_only">
              有变更（{{ scopedProjects.filter(p=>p._changed_fields&&p._changed_fields.length).length }}）
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
            v-if="canShowSubmitButton"
            size="small"
            type="primary"
            icon="el-icon-s-promotion"
            style="background:#007069;border-color:#007069;"
            :loading="submitLoading"
            :disabled="!canSubmit"
            @click="handleSubmit"
          >{{ submitButtonLabel }}</el-button>
        </div>

        <!-- 图例说明 -->
        <div v-if="showDiffHint" style="padding:6px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:16px;font-size:12px;color:#92400e;flex-shrink:0;">
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(0,112,105,0.15);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>本月新增项目</span>
          <span><span style="display:inline-block;width:4px;height:12px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>本月有变更字段</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>系统只读字段</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:#fef9c3;border:1px solid #fde68a;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>可编辑列（表头黄字）</span>
          <span style="flex:1;"></span>
          <span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>
        </div>

        <!-- 填报主体：默认 Luckysheet；经典 HTML 表格见 showLegacyHtmlTable -->
        <div class="luckysheet-editor-wrap" style="flex:1;min-height:0;display:flex;flex-direction:column;">
          <div id="luckysheet-mount" style="flex:1;min-height:360px;width:100%;"></div>
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
                :style="project._added_this_month ? {background:'rgba(0,112,105,0.07)'} : {}"
              >
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
                <td :colspan="tableFields.length" style="text-align:center;padding:40px;color:#94a3b8;border:1px solid #e2e8f0;">
                  <i class="el-icon-document" style="font-size:24px;"></i>
                  <div style="margin-top:8px;font-size:13px;">暂无符合条件的项目</div>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

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
        <div style="padding:6px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;font-size:11px;color:#64748b;flex-shrink:0;">
          <span>共 {{ filteredProjects.length }} 条记录</span>
          <span>报告月份：{{ store.reportingMonth }}</span>
          <span>当前角色：{{ user.name || '—' }}</span>
          <span v-if="isPm && pmLocked" style="color:#f59e0b;font-weight:500;">
            <i class="el-icon-lock"></i> 已提交，待板块接收
          </span>
          <span v-else-if="reportingSubmitted" style="color:#ef4444;font-weight:500;">
            <i class="el-icon-lock"></i> 板块已提交审批，填报数据已锁定
          </span>
          <span v-else-if="lockStatus !== 'open'" style="color:#ef4444;font-weight:500;">
            <i class="el-icon-lock"></i> 编辑受限
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
      </div>
    `,
    // 计算分区列表（用于表头分组）
    computed: {
      store()   { return window.Store; },
      user()    { return Store.currentUser || {}; },
      lockStatus() { return Store.lockStatus; },
      reportingSubmitted() { return !!Store.reportingSubmitted; },
      monthIdx()   { return Store.getMonthIdx(); },
      isPm()    { return this.user.role === 'pm'; },
      isSectorAdmin() { return this.user.role === 'sector_admin'; },

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

      // 通用：提交按钮是否显示（PM 和板块管理员）
      canShowSubmitButton() {
        return this.isPm || this.isSectorAdmin;
      },
      // 板块管理员提交审批是否可用
      canSubmit() {
        if (this.isPm) return this.canPmSubmitNow;
        return this.isSectorAdmin
          && this.lockStatus === 'open'
          && !this.reportingSubmitted;
      },
      submitButtonLabel() {
        if (this.isPm) {
          if (this.pmLocked) return '已提交，待板块接收';
          if (this.reportingSubmitted) return '板块已提交审批';
          return '提交';
        }
        return this.reportingSubmitted ? '已提交审批' : '提交审批';
      },
      canEdit() {
        const role = this.user.role;
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
        const p = this.scopedProjects;
        if (this.viewMode === 'new_only')     return p.filter(x => x._added_this_month);
        if (this.viewMode === 'changed_only') return p.filter(x => x._changed_fields && x._changed_fields.length > 0);
        return p;
      },
      lockBannerClass() {
        if (this.isPm && this.pmLocked) return 'locked';
        if (this.reportingSubmitted) return 'locked';
        return { open:'open', finance_only:'finance-only', locked:'locked' }[this.lockStatus] || 'open';
      },
      lockBannerText() {
        if (this.isPm && this.pmLocked) {
          return '您已提交本月填报，等待板块管理员接收后可再次编辑';
        }
        if (this.reportingSubmitted) {
          if (this.isPm) return '板块已正式提交审批，本月填报已锁定';
          return '本月填报已提交审批 — 数据已锁定，待审批或驳回后可再编辑';
        }
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
