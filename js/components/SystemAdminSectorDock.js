/**
 * SystemAdminSectorDock.js — 填报页底部：各板块进度（样式对齐板块管理员「待接收 PM」）
 */
(function (window) {
  'use strict';

  window.SystemAdminSectorDock = {
    name: 'SystemAdminSectorDock',
    props: {
      tableProjects: { type: Array, default: function () { return []; } }
    },
    data: function () {
      return {
        dockExpanded: true,
        sectorChangeVisible: false,
        sectorChangeCode: '',
        sectorChangeResults: [],
        sectorChangeColLeft: '对比基准',
        sectorChangeColRight: '当前追踪表'
      };
    },
    computed: {
      sectors: function () { return Store.listSectors(); },
      companyArchived: function () { return Store.isCompanyArchived(); },
      allReady: function () { return Store.allSectorsReadyForArchive(); },
      sectorCount: function () { return this.sectorCards.length; },
      sectorChangeDialogTitle: function () {
        return SectorWorkflow.sectorDisplayLabel(this.sectorChangeCode, Store);
      },
      sectorCards: function () {
        var self = this;
        return this.sectors.map(function (code) {
          var flow = Store.getSectorFlow(code);
          return {
            code: code,
            displayLabel: SectorWorkflow.sectorDisplayLabel(code, Store),
            flow: flow,
            statusText: SectorWorkflow.sectorFlowStatusText(flow, self.companyArchived),
            approvalComplete: self.isSectorApprovalComplete(flow)
          };
        });
      },
      pendingApprovalCount: function () {
        return this.sectorCards.filter(function (c) { return !c.approvalComplete; }).length;
      }
    },
    methods: {
      toggleDock: function () {
        this.dockExpanded = !this.dockExpanded;
      },
      isSectorApprovalComplete: function (flow) {
        return !!(flow && flow.approvalStatus === 'approve2');
      },
      flowTagType: function (flow) {
        if (this.companyArchived) return 'success';
        if (flow.approvalStatus === 'approve2') return 'success';
        if (flow.reportingSubmitted) return 'warning';
        return 'info';
      },
      currentSectorProjects: function (code) {
        return SectorWorkflow.filterProjectsBySector(this.tableProjects, code);
      },
      manualInputFields: function () {
        return FieldConfig.buildFieldConfig().filter(function (f) {
          return f.source_type === 'manual_input';
        });
      },
      buildChangeResultsFromMetadata: function (projects) {
        var fields = FieldConfig.buildFieldConfig();
        var results = [];
        projects.forEach(function (p) {
          var log = p._field_change_log || {};
          var cols = {};
          (p._changed_fields || []).forEach(function (c) { cols[c] = true; });
          Object.keys(log).forEach(function (c) { cols[c] = true; });
          var colKeys = Object.keys(cols);
          if (!colKeys.length) return;
          var diffs = [];
          colKeys.forEach(function (col) {
            var f = fields.find(function (x) { return x.col === col; });
            if (window.ChangeMeta) {
              var entries = ChangeMeta.getFieldChangeEntries(p, f);
              if (entries.length) {
                entries.forEach(function (e) {
                  diffs.push({
                    field: f ? f.name_cn : col,
                    leftVal: e.oldVal != null && e.oldVal !== '' ? e.oldVal : '—',
                    rightVal: '【' + (e.roleLabel || '—') + '】' +
                      (e.oldVal != null && e.oldVal !== '' ? e.oldVal : '—') + ' → ' +
                      (e.newVal != null && e.newVal !== '' ? e.newVal : '—')
                  });
                });
                return;
              }
            }
            var flat = FieldConfig.arraysToFlat(p);
            var key = f && FieldConfig.COL_TO_KEY[f.col];
            var rv = key ? flat[key] : '';
            diffs.push({
              field: f ? f.name_cn : col,
              leftVal: '—',
              rightVal: f ? Formatters.formatByType(rv, f.data_type) : String(rv)
            });
          });
          if (diffs.length) {
            results.push({
              projectNo: p.project_no,
              projectName: p.project_name,
              diffs: diffs
            });
          }
        });
        return results;
      },
      openSectorChanges: function (code) {
        var flow = Store.getSectorFlow(code);
        if (!this.isSectorApprovalComplete(flow)) {
          this.$message.info('该板块尚未完成审批，暂不可查看变更');
          return;
        }
        var self = this;
        var draftKey = SectorWorkflow.sectorSnapshotKey('Draft', code);
        var compareFields = this.manualInputFields();
        var current = this.currentSectorProjects(code);
        var loading = this.$loading({
          lock: true,
          text: '加载变更…',
          background: 'rgba(0,0,0,0.15)'
        });

        function showResults(results, colLeft, colRight) {
          if (!results.length) {
            self.$message.info('该板块暂无可展示的手动填报变更');
            return;
          }
          self.sectorChangeCode = code;
          self.sectorChangeColLeft = colLeft;
          self.sectorChangeColRight = colRight;
          self.sectorChangeResults = results;
          self.sectorChangeVisible = true;
        }

        if (Store.snapshots[draftKey]) {
          Store.fetchSnapshot(draftKey)
            .then(function (snap) {
              if (!snap || !snap.projects) {
                showResults(self.buildChangeResultsFromMetadata(current), '—', '当前变更记录');
                return;
              }
              var results = DiffUtils.diffProjectSets(snap.projects, current, compareFields);
              if (results.length === 0) {
                showResults(self.buildChangeResultsFromMetadata(current), '—', '当前变更记录');
                return;
              }
              showResults(results, 'Draft 提交时', '当前追踪表');
            })
            .catch(function () {
              self.$message.error('加载快照失败');
            })
            .finally(function () { loading.close(); });
          return;
        }

        loading.close();
        showResults(
          this.buildChangeResultsFromMetadata(current),
          '—',
          '当前变更记录'
        );
      },
    },
    template: [
      '<motion-placeholder class="system-admin-sector-dock" :class="{ \'is-collapsed\': !dockExpanded }">',
      '<motion-placeholder class="system-admin-sector-dock-head">',
      '<span class="system-admin-sector-dock-title">',
      '<i class="el-icon-bell" style="margin-right:4px;"></i>各板块进度（{{ sectorCount }} 个）',
      '</span>',
      '<el-tag v-if="companyArchived" type="success" size="mini">公司已归档 J版</el-tag>',
      '<el-tag v-else-if="allReady" type="warning" size="mini">全部板块已完成审批</el-tag>',
      '<el-tag v-else type="info" size="mini">{{ pendingApprovalCount }} 个板块审批中</el-tag>',
      '<el-button type="text" size="mini" class="system-admin-sector-dock-toggle" @click="toggleDock">',
      '<i :class="dockExpanded ? \'el-icon-arrow-down\' : \'el-icon-arrow-up\'"></i>',
      '{{ dockExpanded ? \'收起\' : \'展开\' }}',
      '</el-button>',
      '</motion-placeholder>',
      '<motion-placeholder v-show="dockExpanded" class="system-admin-sector-dock-cards">',
      '<motion-placeholder v-for="card in sectorCards" :key="card.code" class="system-admin-sector-card">',
      '<motion-placeholder class="system-admin-sector-card-code">{{ card.displayLabel }}</motion-placeholder>',
      '<el-tag size="mini" :type="flowTagType(card.flow)">{{ card.statusText }}</el-tag>',
      '<motion-placeholder class="system-admin-sector-card-actions">',
      '<el-button size="mini" type="primary" plain :disabled="!card.approvalComplete" @click="openSectorChanges(card.code)">查看变更</el-button>',
      '</motion-placeholder></motion-placeholder>',
      '</motion-placeholder>',
      '<el-dialog :title="\'变更明细 — \' + sectorChangeDialogTitle" :visible.sync="sectorChangeVisible" width="80%" top="8vh" append-to-body>',
      '<div v-if="sectorChangeResults.length===0" style="text-align:center;padding:40px;color:#94a3b8;">暂无变更</div>',
      '<motion-placeholder v-else style="max-height:480px;overflow-y:auto;">',
      '<motion-placeholder v-for="row in sectorChangeResults" :key="row.projectNo" style="margin-bottom:16px;">',
      '<motion-placeholder style="font-weight:600;margin-bottom:4px;">{{ row.projectNo }} · {{ row.projectName }}</motion-placeholder>',
      '<el-table :data="row.diffs" size="mini" border>',
      '<el-table-column label="字段" prop="field" width="140"></el-table-column>',
      '<el-table-column :label="sectorChangeColLeft" prop="leftVal"></el-table-column>',
      '<el-table-column :label="sectorChangeColRight" prop="rightVal"></el-table-column>',
      '</el-table></motion-placeholder>',
      '</motion-placeholder>',
      '<span slot="footer"><el-button @click="sectorChangeVisible=false">关闭</el-button></span>',
      '</el-dialog>',
      '</motion-placeholder>'
    ].join('')
  };

  window.SystemAdminSectorDock.template = window.SystemAdminSectorDock.template
    .replace(/<motion-placeholder/g, '<div')
    .replace(/<\/motion-placeholder>/g, '</div>');
})(window);
