/**
 * ReportLineDetail.js — 填报管理详情/填报页
 *
 * extends ProjectEditorView，完整复用其 Luckysheet 界面（模板、工具栏、冻结列、分区、
 * 字段权限着色等），仅覆盖数据源与操作方法：
 *   - 数据: Store.currentReportLine（/api/report-lines/:id）
 *   - 保存/提交/审批: 走独立 report-line API
 *
 * 父组件模板中已预留：
 *   - rlContextBar      → 工具栏上方的报告线上下文条
 *   - canShowEditorSaveGroup → 控制保存/操作按钮组显示
 *   - rlCanSubmit / rlCanApprove / rlCanReject → 报告线操作按钮
 *   - handleRlSubmit / handleRlApprove / handleRlReject → 报告线操作方法
 */
(function (window) {
  'use strict';

  var STATUS_MAP = {
    open:               { label: '开放填报',       type: 'warning' },
    submitted:          { label: '已提交',         type: '' },
    reviewing_director: { label: '板块领导审批中', type: '' },
    reviewing_leader:   { label: '群主审批中',     type: '' },
    returned:           { label: '已退回',         type: 'danger' },
    rejected:           { label: '已退回',         type: 'danger' },
    completed:          { label: '已完成',         type: 'success' },
    closed:             { label: '已关闭',         type: 'info' }
  };

  window.ReportLineDetailView = {
    name: 'ReportLineDetail',
    extends: window.ProjectEditorView,

    data: function () {
      return {
        rlLoading: false,
        _rlSubmitting: false
      };
    },

    computed: {
      // ── 报告线基础数据 ──
      reportLine: function () { return Store.currentReportLine || {}; },

      rlProjects: function () {
        var rl = this.reportLine;
        return (rl.projects || []).map(function (p) {
          // field_data 由服务端已解析为对象，直接用；兼容极少数仍为字符串的情况
          var data;
          if (p.field_data && typeof p.field_data === 'object') {
            data = Object.assign({}, p.field_data);
          } else {
            data = {};
            try { data = JSON.parse(p.field_data || '{}'); } catch (e) { /**/ }
          }
          data.project_no = p.project_no;
          if (!data.project_name && p.project_name) data.project_name = p.project_name;
          return data;
        });
      },

      rlStatus: function () { return this.reportLine.status || ''; },

      rlMode: function () {
        return (this.$route && this.$route.query && this.$route.query.mode) || 'view';
      },

      // ── 覆盖父类：工具栏上方的报告线上下文条 ──
      rlContextBar: function () {
        var rl = this.reportLine;
        if (!rl.id) return null;
        var period = rl.period || '';
        var parts = String(period).split('-');
        var periodLabel = parts.length >= 2 ? parts[0] + '年' + parseInt(parts[1], 10) + '月' : period;
        var statusInfo = STATUS_MAP[this.rlStatus] || { label: this.rlStatus, type: 'info' };
        return {
          sectorName: (Store.sectorNames || {})[rl.sector_code] || rl.sector_code || '',
          periodLabel: periodLabel,
          statusLabel: statusInfo.label,
          statusType: statusInfo.type
        };
      },

      // ── 覆盖父类：控制保存/操作按钮组 ──
      canShowEditorSaveGroup: function () {
        return this.canEdit || this.rlCanSubmit || this.rlCanApprove || this.rlCanReject;
      },

      // ── 覆盖父类：canEdit ──
      canEdit: function () {
        if (this.rlMode === 'view') return false;
        var s = this.rlStatus;
        var role = (Store.currentUser || {}).role;
        if (role === 'pm') return s === 'open';
        if (role === 'sector_admin' || role === 'system_admin') {
          return s === 'open' || s === 'returned' || s === 'rejected';
        }
        return false;
      },

      // ── 覆盖父类：报告线无全局锁定 ──
      lockStatus: function () { return 'open'; },

      // ── 覆盖父类：Luckysheet gridKey 独立，避免缓存冲突 ──
      lsGridKey: function () { return 'ptrack_report_line_v1'; },

      // ── 覆盖父类：monthIdx 从报告线 period 计算 ──
      monthIdx: function () {
        var period = this.reportLine.period || '';
        return period ? FormulaEngine.getMonthIdx(period) : Store.getMonthIdx();
      },

      // ── 覆盖父类：scopedProjects 直接用 tableProjects（不再按板块二次过滤） ──
      scopedProjects: function () { return this.tableProjects; },

      // ── 覆盖父类：隐藏主追踪表专属按钮 ──
      canShowAlertsButton:         function () { return false; },
      canShowRefreshButton:         function () { return false; },
      canShowClearCompletionButton: function () { return false; },
      canImport:                    function () { return false; },
      canShowArchiveButton:         function () { return false; },
      showReportLineHint:           function () { return false; },
      isViewingSnapshot:            function () { return false; },
      editorSnapshotOptions:        function () { return []; },
      isSystemAdmin:                function () { return false; }, // 隐藏版本快照下拉

      // ── 报告线操作按钮可见性 ──
      rlCanSubmit: function () {
        var role = (Store.currentUser || {}).role;
        var s = this.rlStatus;
        if (role === 'pm') return s === 'open';
        if (role === 'sector_admin') return s === 'open' || s === 'returned' || s === 'rejected';
        return false;
      },

      rlCanApprove: function () {
        var role = (Store.currentUser || {}).role;
        if (role === 'sector_director') return this.rlStatus === 'reviewing_director';
        if (role === 'group_leader') return this.rlStatus === 'reviewing_leader';
        return false;
      },

      rlCanReject: function () { return this.rlCanApprove; },

      rlSubmitting: function () { return this._rlSubmitting; }
    },

    watch: {
      '$route.params.id': function () { this.loadDetail(); }
    },

    mounted: function () {
      // 父类 mounted 已自动运行（注册 fieldDictionary watch + syncEditorFromFieldDictionary）
      // 报告线数据未加载时 buildTableData 返回空；loadDetail 后重新同步
      this.loadDetail();
    },

    methods: {
      /** 加载报告线详情，成功后重建 Luckysheet */
      loadDetail: function () {
        var self = this;
        var id = this.$route && this.$route.params && this.$route.params.id;
        if (!id) return Promise.resolve();
        this.rlLoading = true;
        return Store.fetchReportLineDetail(id)
          .then(function () {
            self.syncEditorFromFieldDictionary(!self.luckysheetReady);
          })
          .catch(function (e) {
            console.error('[ReportLineDetail] loadDetail 失败:', e);
          })
          .finally(function () { self.rlLoading = false; });
      },

      // ── 覆盖 buildTableData：从报告线项目构建 ──
      buildTableData: function () {
        this.tableProjects = FormulaEngine.computeAll(this.rlProjects, this.monthIdx);
      },

      // ── 覆盖 getStoreProject：从报告线项目列表查找 ──
      getStoreProject: function (projectNo) {
        var projs = this.rlProjects;
        for (var i = 0; i < projs.length; i++) {
          if (projs[i].project_no === projectNo) return projs[i];
        }
        return null;
      },

      // ── 覆盖 handleCellEdit：写报告线 API，不写主项目表 ──
      handleCellEdit: async function (project, field, newVal, opts) {
        if (!this.canEditField(field)) return;
        var key = FieldConfig.COL_TO_KEY[field.col];
        if (!key) return;
        var flat = FieldConfig.arraysToFlat(project);
        var oldVal = flat[key];
        if (oldVal === newVal || String(oldVal) === String(newVal)) return;

        var self = this;
        var rlId = this.reportLine.id;
        var projectNo = project.project_no;

        // 乐观更新本地 field_data
        var rl = Store.currentReportLine;
        if (rl && rl.projects) {
          for (var i = 0; i < rl.projects.length; i++) {
            if (rl.projects[i].project_no === projectNo) {
              var fd;
              if (rl.projects[i].field_data && typeof rl.projects[i].field_data === 'object') {
                fd = Object.assign({}, rl.projects[i].field_data);
              } else {
                fd = {};
                try { fd = JSON.parse(rl.projects[i].field_data || '{}'); } catch (e) { /**/ }
              }
              fd[key] = newVal;
              rl.projects[i].field_data = fd;
              break;
            }
          }
        }
        self.buildTableData();

        // 持久化
        var changed = {};
        changed[key] = newVal;
        try {
          await Store.saveReportLineData(rlId, projectNo, changed);
        } catch (e) {
          self.$message.error('保存失败：' + (e.message || e));
          await self.loadDetail();
          return;
        }

        // 刷新 Luckysheet 行
        if (opts && opts.fromLuckysheet && self.activeTab === 'luckysheet' && opts.lsRow != null) {
          var rowIdx = opts.lsRow - self.lsLayout().dataStart;
          var updated = self.getStoreProject(projectNo);
          if (updated) {
            var recomputed = FormulaEngine.compute(Object.assign({}, updated), self.monthIdx);
            self.syncLuckysheetProjectRowValues(rowIdx, recomputed);
            self.recalcLuckysheetFormulas();
            setTimeout(function () { self.syncLuckysheetProjectRowDecor(rowIdx, recomputed); }, 320);
          }
        } else if ((!opts || !opts.fromLuckysheet) && self.activeTab === 'luckysheet') {
          self.scheduleRefreshLuckysheet();
        }
      },

      // ── 覆盖 handleSave：刷新后重载数据 ──
      handleSave: async function () {
        if (!this.canEdit) return;
        this.saveLoading = true;
        try {
          await this._flushRlLuckysheet();
          await this.loadDetail();
          this.$message.success('保存成功');
        } catch (e) {
          this.$message.error('保存失败：' + (e.message || e));
        } finally {
          this.saveLoading = false;
        }
      },

      /** 将 Luckysheet 当前数据批量写入报告线 */
      _flushRlLuckysheet: async function () {
        if (typeof luckysheet === 'undefined') return;
        var file = luckysheet.getluckysheetfile && luckysheet.getluckysheetfile();
        if (!file || !file[0] || !file[0].data) return;
        var sheetData = file[0].data;
        var lay = this.lsLayout();
        var rlId = this.reportLine.id;
        for (var i = 0; i < this.filteredProjects.length; i++) {
          var r = lay.dataStart + i;
          var row = sheetData[r];
          if (!row) continue;
          var project = this.filteredProjects[i];
          if (!project) continue;
          var changed = {};
          var hasChange = false;
          for (var c = 0; c < this.tableFields.length; c++) {
            var fld = this.tableFields[c];
            if (!fld || !this.canEditField(fld)) continue;
            if (fld.source_type === 'auto_calc') continue;
            var cell = row[c];
            var nv = this.coerceFieldValue(this.extractLuckysheetInput(cell), fld);
            var k = FieldConfig.COL_TO_KEY[fld.col];
            var ov = (project[k] != null) ? project[k] : null;
            if (nv === ov || String(nv) === String(ov)) continue;
            changed[k] = nv;
            hasChange = true;
          }
          if (hasChange) {
            await Store.saveReportLineData(rlId, project.project_no, changed);
          }
        }
      },

      // ── 报告线提交 ──
      handleRlSubmit: async function () {
        var role = (Store.currentUser || {}).role;
        var rlId = this.reportLine.id;
        this._rlSubmitting = true;
        try {
          if (this.canEdit) await this._flushRlLuckysheet();
          if (role === 'pm') {
            await Store.pmSubmitReportLine(rlId);
            this.$message.success('提交成功');
          } else {
            await Store.submitReportLineApproval(rlId);
            this.$message.success('已提交审批');
          }
          await this.loadDetail();
        } catch (e) {
          this.$message.error('操作失败：' + (e.message || e));
        } finally {
          this._rlSubmitting = false;
        }
      },

      // ── 审批通过 ──
      handleRlApprove: async function () {
        try {
          await Store.reviewReportLine(this.reportLine.id, 'approve', '');
          this.$message.success('审批通过');
          await this.loadDetail();
        } catch (e) {
          this.$message.error('审批失败：' + (e.message || e));
        }
      },

      // ── 退回 ──
      handleRlReject: async function () {
        var self = this;
        try {
          var result = await this.$prompt('请输入退回原因', '确认退回', {
            confirmButtonText: '确定', cancelButtonText: '取消',
            inputPlaceholder: '请说明退回原因'
          });
          var comment = (result && result.value) || '';
          await Store.reviewReportLine(self.reportLine.id, 'reject', comment);
          self.$message.warning('已退回');
          await self.loadDetail();
        } catch (e) {
          if (e === 'cancel' || (e && String(e).indexOf('cancel') >= 0)) return;
          self.$message.error('退回失败：' + (e.message || e));
        }
      },

      // ── 导出：走报告线 export 接口 ──
      handleExport: function () {
        if (this.reportLine && this.reportLine.id) {
          window.open('/api/report-lines/' + this.reportLine.id + '/export', '_blank');
        }
      }
    }
  };
})(window);
