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
        var self = this;
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
          return self.attachReportLineChangeMeta(data, p.change_diff, {
            updated_by: p.updated_by,
            updated_at: p.updated_at
          });
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
        if (role === 'pm') {
          return s === 'open' && (this.currentPmReportLineStatus === 'open' || this.currentPmReportLineStatus === 'rejected');
        }
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

      // ── 覆盖父类：报告线数据容器是板块级，但展示范围仍按当前角色过滤 ──
      scopedProjects: function () {
        var list = this.tableProjects || [];
        if (window.DataScope) {
          return DataScope.filterProjects(this.user, list, Store.groupRegistry);
        }
        if (this.isPm) {
          var pm = this.pmName;
          return list.filter(function (p) { return p.pm_name === pm; });
        }
        return list;
      },

      // ── 分发列：将 distributed_columns 列字母数组转为 colIdx Set ──
      distributedColumnSet: function () {
        var dc = this.reportLine.distributed_columns;
        if (!dc || !dc.length) return null; // null = 显示全部列
        var set = new Set();
        dc.forEach(function (col) {
          var idx = FieldConfig.colToIdx(col);
          if (idx >= 0) set.add(idx);
        });
        return set;
      },

      // ── 覆盖父类：隐藏主追踪表专属按钮 ──
      canShowAlertsButton:         function () { return false; },
      canShowRefreshButton:         function () { return false; },
      canShowClearCompletionButton: function () { return false; },
      canImport: function () {
        var role = (Store.currentUser || {}).role;
        return this.canEdit && ['pm', 'sector_admin', 'system_admin'].indexOf(role) >= 0;
      },
      canShowArchiveButton:         function () { return false; },
      showReportLineHint:           function () { return false; },
      isViewingSnapshot:            function () { return false; },
      editorSnapshotOptions:        function () { return []; },
      isSystemAdmin:                function () { return false; }, // 隐藏版本快照下拉

      currentPmReportLineStatus: function () {
        var user = Store.currentUser || {};
        var pmName = user.pmName || user.name;
        var rows = this.reportLine.pmStatuses || [];
        var hit = rows.find(function (row) { return row && row.pm_name === pmName; });
        return hit ? hit.status : null;
      },

      // ── 报告线操作按钮可见性 ──
      rlCanSubmit: function () {
        var role = (Store.currentUser || {}).role;
        var s = this.rlStatus;
        if (role === 'pm') return s === 'open';
        if (role === 'sector_admin') return s === 'open' || s === 'returned' || s === 'rejected';
        return false;
      },

      rlSubmitDisabled: function () {
        var role = (Store.currentUser || {}).role;
        if (role !== 'pm') return false;
        return this.currentPmReportLineStatus !== 'open' && this.currentPmReportLineStatus !== 'rejected';
      },

      rlSubmitLabel: function () {
        var role = (Store.currentUser || {}).role;
        if (role !== 'pm') return '提交审批';
        var status = this.currentPmReportLineStatus;
        if (status === 'submitted') return '已提交';
        if (status === 'closed') return '已关闭';
        return '提交填报';
      },

      rlCanApprove: function () {
        var role = (Store.currentUser || {}).role;
        if (role === 'sector_director') return this.rlStatus === 'reviewing_director';
        if (role === 'group_leader') return this.rlStatus === 'reviewing_leader';
        return false;
      },

      rlCanReject: function () { return this.rlCanApprove; },

      rlSubmitting: function () { return this._rlSubmitting; },

      // ── 覆盖父类：报告线体系下 PM 提交状态来自 reportLine.pmStatuses，需展示全部 PM ──
      submittedPmSubmissions: function () {
        if (!this.isSectorAdmin) return [];
        var pmProjectCounts = {};
        (this.tableProjects || []).forEach(function (p) {
          if (!p.pm_name) return;
          pmProjectCounts[p.pm_name] = (pmProjectCounts[p.pm_name] || 0) + 1;
        });
        return (this.reportLine.pmStatuses || [])
          .filter(function (row) { return !!row; })
          .map(function (row) {
            return {
              pmName: row.pm_name,
              status: row.status,
              submittedAt: row.submitted_at,
              projectCount: pmProjectCounts[row.pm_name] || 0
            };
          })
          .sort(function (a, b) {
            var priority = { submitted: 0, received: 0, rejected: 1, open: 2, closed: 3 };
            var pa = priority[a.status] == null ? 9 : priority[a.status];
            var pb = priority[b.status] == null ? 9 : priority[b.status];
            if (pa !== pb) return pa - pb;
            return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
          });
      },

      pmSubmissionDockTitle: function () {
        var list = this.submittedPmSubmissions || [];
        var done = list.filter(function (x) {
          return x.status === 'submitted' || x.status === 'received';
        }).length;
        return '项目经理提交情况（已提交 ' + done + ' / 共 ' + list.length + ' 人）';
      },

      pmSubmissionDockHint: function () {
        return 'PM 提交后自动进入板块汇总；';
      }
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

      // ── 覆盖父类：按分发列配置叠加列隐藏 ──
      buildLuckysheetColhidden: function () {
        // 先取父类的紧凑列隐藏结果（报告线场景下一般为空对象）
        var hidden = window.ProjectEditorView.methods.buildLuckysheetColhidden.call(this);
        var dcSet = this.distributedColumnSet;
        if (!dcSet) return hidden; // null → 无分发列限制，显示全部
        var fields = this.tableFields || [];
        fields.forEach(function (field, c) {
          if (!dcSet.has(c)) hidden[String(c)] = 0;
        });
        return hidden;
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

      // ── 覆盖父类：板块管理员查看 PM 更新内容时使用报告线数据 + 报告线 baseline ──
      showPmDiff: function (pmName) {
        var self = this;
        var baselineVersion = this.reportLine.baseline_version;
        var loading = this.$loading({ lock: true, text: '加载对比…', background: 'rgba(0,0,0,0.15)' });
        Store.fetchSnapshot(baselineVersion)
          .then(function (snap) {
            self.renderPmDiff(pmName, snap);
          })
          .catch(function () {
            self.$message.error('加载对比失败');
          })
          .finally(function () { loading.close(); });
      },

      renderPmDiff: function (pmName, baselineSnap) {
        var fields = FieldConfig.buildFieldConfig();
        var compareFields = fields.filter(function (f) {
          return f.source_type === 'manual_input';
        });
        var baselineProjects = (baselineSnap && baselineSnap.projects) || [];
        var currentProjects = FormulaEngine.computeAll(
          (this.tableProjects || []).filter(function (p) { return p.pm_name === pmName; }),
          this.monthIdx
        );

        var results = this.diffProjectSets(baselineProjects, currentProjects, compareFields);
        this.pmDiffColLeft = baselineSnap ? '报告线基准' : '—';
        this.pmDiffColRight = '当前报告线';

        if (results.length === 0) {
          this.$message.info(pmName + ' 暂无更新内容。');
          return;
        }
        this.pmDiffName = pmName;
        this.pmDiffResults = results;
        this.pmDiffVisible = true;
      },

      formatPmSubmissionMeta: function (sub) {
        var statusMap = {
          open: '未提交',
          submitted: '已提交',
          received: '已接收',
          rejected: '已退回',
          closed: '已关闭'
        };
        var label = statusMap[sub.status] || sub.status || '—';
        var time = sub.submittedAt
          ? new Date(sub.submittedAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
          : '—';
        return (sub.projectCount || 0) + ' 个项目 · ' + label + ' · ' + time;
      },

      applyReportLineWipAutoClear: function (previousProject, nextProject) {
        if (!window.WipValidation) {
          return { project: nextProject, changes: [] };
        }
        var before = FormulaEngine.compute(Object.assign({}, previousProject), this.monthIdx);
        var after = FormulaEngine.compute(Object.assign({}, nextProject), this.monthIdx);
        var clear = WipValidation.clearWhenPendingInvoiceWipBecomesZero(before, after);
        if (!clear.changed) {
          return { project: nextProject, changes: [] };
        }
        var out = Object.assign({}, nextProject, clear.project);
        var changes = [];
        var self = this;
        ['AM', 'AN', 'AO'].forEach(function (col) {
          var key = FieldConfig.COL_TO_KEY[col];
          var field = (self.tableFields || []).find(function (f) { return f.col === col; });
          if (!key || !field) return;
          var oldVal = after[key];
          if (oldVal == null || String(oldVal).trim() === '') return;
          changes.push({ field: field, key: key, oldVal: oldVal, newVal: '' });
        });
        return { project: out, changes: changes };
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
              var previousFd = Object.assign({}, fd);
              fd[key] = newVal;
              this.syncMonthlyFieldValue(fd, key, newVal);
              var wipResult = this.applyReportLineWipAutoClear(previousFd, fd);
              fd = wipResult.project;
              if (window.ChangeMeta) {
                ChangeMeta.recordFieldChangeLog(fd, field, oldVal, newVal, self.user);
                wipResult.changes.forEach(function (item) {
                  ChangeMeta.recordFieldChangeLog(fd, item.field, item.oldVal, item.newVal, self.user);
                });
                if (!fd._changed_fields) fd._changed_fields = [];
                if (fd._changed_fields.indexOf(field.col) < 0) {
                  fd._changed_fields.push(field.col);
                }
                wipResult.changes.forEach(function (item) {
                  if (fd._changed_fields.indexOf(item.field.col) < 0) {
                    fd._changed_fields.push(item.field.col);
                  }
                });
              }
              rl.projects[i].field_data = fd;
              break;
            }
          }
        }
        self.buildTableData();

        return this._trackCellSave((async function () {
          var storeProj = self.getStoreProject(projectNo) || project;
          var changed = self.buildReportLineSavePayload(storeProj, {});
          changed[key] = newVal;
          if (window.WipValidation) {
            ['AM', 'AN', 'AO'].forEach(function (col) {
              var clearKey = FieldConfig.COL_TO_KEY[col];
              if (storeProj && clearKey && storeProj[clearKey] === '') {
                changed[clearKey] = '';
              }
            });
          }
          await Store.saveReportLineData(rlId, projectNo, changed);

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
        })().catch(async function (e) {
          self.$message.error('保存失败：' + (e.message || e));
          await self.loadDetail();
          throw e;
        }));
      },

      // ── 覆盖 Drawer 保存：写报告线 API，并同步当前报告线表格数据源 ──
      handleProjectDrawerSave: async function (draftFlat) {
        if (!this.projectDrawerProject || !this.canEdit) return;
        var project = this.projectDrawerProject;
        var projectNo = project.project_no;
        var storeProj = Object.assign({}, this.getStoreProject(projectNo) || project);
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

        this.projectDrawerSaving = true;
        try {
          await this._trackCellSave((async function () {
            var flat = FieldConfig.arraysToFlat(storeProj);
            var changed = {};
            changes.forEach(function (item) {
              flat[item.key] = item.newVal;
              changed[item.key] = item.newVal;
            });

            var updated = FormulaEngine.compute(FieldConfig.flatToArrays(flat), self.monthIdx);
            var wipResult = self.applyReportLineWipAutoClear(storeProj, updated);
            updated = wipResult.project;
            wipResult.changes.forEach(function (item) {
              changed[item.key] = item.newVal;
              changes.push(item);
            });
            var tracking = window.ChangeMeta
              ? ChangeMeta.mergeChangeTracking(storeProj)
              : { _field_change_log: {}, _changed_fields: [] };
            updated._field_change_log = tracking._field_change_log;
            updated._changed_fields = tracking._changed_fields.slice();

            changes.forEach(function (item) {
              self.syncMonthlyFieldValue(updated, item.key, item.newVal);
              if (window.ChangeMeta) {
                ChangeMeta.recordFieldChangeLog(updated, item.field, item.oldVal, item.newVal, self.user);
              }
              if (updated._changed_fields.indexOf(item.field.col) < 0) {
                updated._changed_fields.push(item.field.col);
              }
            });

            await Store.saveReportLineData(
              self.reportLine.id,
              projectNo,
              self.buildReportLineSavePayload(updated, changed)
            );

            var rl = Store.currentReportLine;
            if (rl && rl.projects) {
              for (var pi = 0; pi < rl.projects.length; pi++) {
                if (rl.projects[pi].project_no !== projectNo) continue;
                var fd = Object.assign(
                  {},
                  rl.projects[pi].field_data || {},
                  changed
                );
                changes.forEach(function (item) {
                  self.syncMonthlyFieldValue(fd, item.key, item.newVal);
                });
                fd._field_change_log = updated._field_change_log;
                fd._changed_fields = updated._changed_fields;
                if (window.Vue && Vue.set) {
                  Vue.set(rl.projects[pi], 'field_data', fd);
                } else {
                  rl.projects[pi].field_data = fd;
                }
                break;
              }
            }

            self.buildTableData();
            var fresh = FormulaEngine.compute(
              Object.assign({}, self.getStoreProject(projectNo) || updated),
              self.monthIdx
            );
            var rowIdx = self.filteredProjects.findIndex(function (p) {
              return p.project_no === projectNo;
            });
            self.projectDrawerRowIndex = rowIdx;
            self.projectDrawerProject = fresh;

            if (self.activeTab === 'luckysheet' && rowIdx >= 0) {
              self.syncLuckysheetProjectRowValues(rowIdx, fresh);
              self.recalcLuckysheetFormulas();
              setTimeout(function () {
                self.syncLuckysheetProjectRowDecor(rowIdx, fresh);
              }, 320);
            }
            self.$message.success('已保存');
          })().catch(async function (e) {
            self.$message.error('保存失败：' + (e.message || e));
            await self.loadDetail();
            throw e;
          }));
        } finally {
          this.projectDrawerSaving = false;
        }
      },

      /** 将服务端 change_diff 转为 Luckysheet 批注所需的 _field_change_log（仅作回退，不用当前查看者角色） */
      changeDiffToChangeMeta: function (changeDiff, meta) {
        var log = {};
        var changedCols = [];
        if (!changeDiff || !changeDiff.length) {
          return { _field_change_log: log, _changed_fields: changedCols };
        }
        var fields = (this.tableFields && this.tableFields.length)
          ? this.tableFields
          : FieldConfig.buildFieldConfig();
        var keyToField = {};
        fields.forEach(function (f) {
          var k = FieldConfig.COL_TO_KEY[f.col];
          if (k) keyToField[k] = f;
        });
        // change_diff 是相对 baseline 的历史填报差异，默认按 PM 展示，避免板块管理员查看时误标为本人
        var roleLabel = window.ChangeMeta
          ? ChangeMeta.roleLabel({ role: 'pm' })
          : 'PM';
        var userName = (meta && meta.updated_by) || '—';
        var userId = 'pm';
        var at = (meta && meta.updated_at) || new Date().toISOString();
        changeDiff.forEach(function (d) {
          if (!d || !d.field_key) return;
          var field = keyToField[d.field_key];
          if (!field) return;
          var entry = {
            oldVal: Formatters.formatByType(d.old_value, field.data_type),
            newVal: Formatters.formatByType(d.new_value, field.data_type),
            roleLabel: roleLabel,
            userName: userName,
            userId: userId,
            at: at
          };
          if (!log[field.col]) log[field.col] = [];
          log[field.col].push(entry);
          if (changedCols.indexOf(field.col) < 0) changedCols.push(field.col);
        });
        return { _field_change_log: log, _changed_fields: changedCols };
      },

      attachReportLineChangeMeta: function (project, changeDiff, meta) {
        if (!project) return project;
        var out = Object.assign({}, project);
        if (!window.ChangeMeta) return out;

        var existingLog = (out._field_change_log && typeof out._field_change_log === 'object')
          ? out._field_change_log
          : {};
        var fromDiff = this.changeDiffToChangeMeta(changeDiff, meta);

        // 已有持久化批注的列不再从 change_diff 重复合成，避免 PM 提交后板块管理员看到双份批注
        var filteredLog = {};
        var filteredCols = [];
        Object.keys(fromDiff._field_change_log || {}).forEach(function (col) {
          var existing = existingLog[col];
          if (existing && Array.isArray(existing) && existing.length) return;
          filteredLog[col] = fromDiff._field_change_log[col];
          filteredCols.push(col);
        });

        var merged = ChangeMeta.mergeChangeTracking(out, {
          _field_change_log: filteredLog,
          _changed_fields: filteredCols
        });
        out._field_change_log = merged._field_change_log;
        out._changed_fields = merged._changed_fields;
        return out;
      },

      buildReportLineSavePayload: function (project, partialChanges) {
        var payload = Object.assign({}, partialChanges || {});
        if (window.ChangeMeta && project) {
          payload._field_change_log = project._field_change_log || {};
          payload._changed_fields = (project._changed_fields || []).slice();
        }
        return payload;
      },

      syncMonthlyFieldValue: function (project, key, value) {
        var m = String(key || '').match(/^(mc|mi|mp)_(\d+)$/);
        if (!m) return;
        var idx = Number(m[2]);
        if (idx < 0 || idx > 11) return;
        var map = {
          mc: 'monthly_completion',
          mi: 'monthly_invoice',
          mp: 'monthly_payment'
        };
        var arrayKey = map[m[1]];
        if (!Array.isArray(project[arrayKey])) {
          project[arrayKey] = Array(12).fill(0);
        } else {
          project[arrayKey] = project[arrayKey].slice();
        }
        project[arrayKey][idx] = value;
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

      /** 报告线导入：复用导入合并规则，但保存到 report_line_data 而不是主项目表 */
      onImportFileChange: function (e) {
        var file = e.target && e.target.files && e.target.files[0];
        if (!file) return;
        var self = this;
        var rlId = this.reportLine.id;
        var visibleNoSet = new Set((this.scopedProjects || []).map(function (p) { return p.project_no; }));
        var distributedSet = this.distributedColumnSet;

        function sanitizeByDistributedColumns(projects) {
          if (!distributedSet) return projects;
          var allowedKeys = new Set(['project_no']);
          (self.tableFields || []).forEach(function (field, idx) {
            if (!field || !distributedSet.has(idx)) return;
            var key = FieldConfig.COL_TO_KEY[field.col];
            if (key) allowedKeys.add(key);
          });
          return (projects || []).map(function (p) {
            var flat = FieldConfig.arraysToFlat(p);
            var clean = { project_no: flat.project_no || p.project_no };
            allowedKeys.forEach(function (key) {
              if (flat[key] !== undefined) clean[key] = flat[key];
            });
            return clean;
          });
        }

        this.importLoading = true;
        XlsxImporter.importFromFile(file)
          .then(function (result) {
            var imported = sanitizeByDistributedColumns(result.projects || []);
            if (imported.length === 0) {
              self.$message.error('未识别到有效数据，请检查文件格式');
              return null;
            }
            var merged = ImportMerge.mergeImportedProjects(
              imported,
              self.tableProjects || [],
              {
                role: (self.user || {}).role,
                user: self.user,
                lockStatus: self.lockStatus,
                monthIdx: self.monthIdx,
                scopeFilter: function (p) { return visibleNoSet.has(p.project_no); }
              }
            );
            if (merged.updates.length === 0) {
              self.$message.warning(
                '没有可合并的更新（跳过 ' + merged.skipped.length + ' 条）'
              );
              return null;
            }
            return self.$confirm(
              '将按项目号更新当前报告线内 ' + merged.updates.length + ' 条项目的可编辑字段' +
              (merged.skipped.length ? '，跳过 ' + merged.skipped.length + ' 条' : '') +
              '。确认导入？',
              '上传导入确认',
              { confirmButtonText: '确认导入', cancelButtonText: '取消', type: 'warning' }
            ).then(function () {
              var chain = Promise.resolve();
              merged.updates.forEach(function (p) {
                chain = chain.then(function () {
                  return Store.saveReportLineData(rlId, p.project_no, p);
                });
              });
              return chain.then(function () {
                return self.loadDetail();
              }).then(function () {
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

      /** 将 Luckysheet 当前数据批量写入报告线 */
      _flushRlLuckysheet: async function () {
        if (this.activeTab !== 'luckysheet' || typeof luckysheet === 'undefined') return;
        try {
          if (luckysheet.exitEditMode) luckysheet.exitEditMode();
        } catch (e) { /* ignore */ }
        await new Promise(function (resolve) { setTimeout(resolve, 120); });
        await this._waitCellSaves();

        var file = this.lsGetActiveLuckysheetFile ? this.lsGetActiveLuckysheetFile() : null;
        if (!file && luckysheet.getluckysheetfile) {
          var files = luckysheet.getluckysheetfile();
          file = files && files[0];
        }
        if (!file || !file.data) return;
        var sheetData = file.data;
        var lay = this.lsLayout();
        var rlId = this.reportLine.id;
        for (var i = 0; i < this.filteredProjects.length; i++) {
          var r = lay.dataStart + i;
          var row = sheetData[r];
          if (!row) continue;
          var project = this.filteredProjects[i];
          if (!project) continue;
          var storeProj = Object.assign({}, this.getStoreProject(project.project_no) || project);
          var originalStoreProj = Object.assign({}, storeProj);
          var changed = {};
          var hasChange = false;
          var dcSet = this.distributedColumnSet;
          for (var c = 0; c < this.tableFields.length; c++) {
            var fld = this.tableFields[c];
            if (!fld || !this.canEditField(fld)) continue;
            if (fld.source_type === 'auto_calc') continue;
            // 跳过未分发列（隐藏列），避免意外覆盖原始数据
            if (dcSet && !dcSet.has(c)) continue;
            var cell = row[c];
            var nv = this.coerceFieldValue(this.extractLuckysheetInput(cell), fld);
            var k = FieldConfig.COL_TO_KEY[fld.col];
            var flat = FieldConfig.arraysToFlat(storeProj);
            var ov = flat[k];
            if (nv === ov || String(nv) === String(ov)) continue;
            changed[k] = nv;
            this.syncMonthlyFieldValue(storeProj, k, nv);
            hasChange = true;
            if (window.ChangeMeta) {
              ChangeMeta.recordFieldChangeLog(storeProj, fld, ov, nv, this.user);
            }
          }
          if (hasChange) {
            var wipResult = this.applyReportLineWipAutoClear(originalStoreProj, storeProj);
            storeProj = wipResult.project;
            wipResult.changes.forEach(function (item) {
              changed[item.key] = item.newVal;
              if (window.ChangeMeta) {
                ChangeMeta.recordFieldChangeLog(storeProj, item.field, item.oldVal, item.newVal, this.user);
              }
              storeProj._changed_fields = storeProj._changed_fields || [];
              if (storeProj._changed_fields.indexOf(item.field.col) < 0) {
                storeProj._changed_fields.push(item.field.col);
              }
            }, this);
            await Store.saveReportLineData(
              rlId,
              project.project_no,
              this.buildReportLineSavePayload(storeProj, changed)
            );
            var rl = Store.currentReportLine;
            if (rl && rl.projects) {
              for (var pi = 0; pi < rl.projects.length; pi++) {
                if (rl.projects[pi].project_no !== project.project_no) continue;
                var fd = Object.assign({}, rl.projects[pi].field_data || {}, changed);
                fd._field_change_log = storeProj._field_change_log;
                fd._changed_fields = storeProj._changed_fields;
                rl.projects[pi].field_data = fd;
                break;
              }
            }
          }
        }
        await this._waitCellSaves();
      },

      // ── 报告线提交 ──
      handleRlSubmit: async function () {
        var role = (Store.currentUser || {}).role;
        var rlId = this.reportLine.id;
        if (this.rlSubmitDisabled) return;
        this._rlSubmitting = true;
        try {
          if (this.canEdit) {
            await this._flushRlLuckysheet();
            await this.loadDetail();
          }
          if (!this.assertStockBeforeSubmit()) {
            throw new Error('stock_validation');
          }
          if (role === 'pm') {
            await Store.pmSubmitReportLine(rlId);
            this.$message.success('提交成功');
          } else {
            await Store.submitReportLineApproval(rlId);
            this.$message.success('已提交审批');
          }
          await this.loadDetail();
        } catch (e) {
          if (!e || e.message !== 'stock_validation') {
            this.$message.error('操作失败：' + (e.message || e));
          }
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
          var u = Store.currentUser || {};
          var qs = [];
          if (u.role) qs.push('role=' + encodeURIComponent(u.role));
          if (u.pmName || u.name) qs.push('pmName=' + encodeURIComponent(u.pmName || u.name));
          if (u.sector || u.sectorCode) qs.push('sectorCode=' + encodeURIComponent(u.sector || u.sectorCode));
          var query = qs.length ? '?' + qs.join('&') : '';
          window.open('/api/report-lines/' + this.reportLine.id + '/export' + query, '_blank');
        }
      }
    }
  };
})(window);
