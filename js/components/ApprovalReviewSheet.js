/**
 * ApprovalReviewSheet.js — 板块总监 / 群主：本板块当月全部项目 + 筛选 + 可编辑列
 */
(function (window) {
  'use strict';

  window.ApprovalReviewSheet = {
    name: 'ApprovalReviewSheet',
    extends: window.ProjectEditorView,
    data() {
      return {
        viewMode: 'all',
        compactColumnsOnly: false,
        activeTab: 'luckysheet',
        showLegacyHtmlTable: false,
        showDiffHint: true,
        _pmBaselineCaptured: true
      };
    },
    computed: {
      reviewSector() {
        return (this.user && this.user.sector) || 'S520';
      },
      sectorFlow() {
        return Store.getSectorFlow(this.reviewSector);
      },
      reviewerEditActive() {
        const role = this.user.role;
        const sf = this.sectorFlow;
        if (role === 'sector_director') {
          return sf.reportingSubmitted && sf.approvalStatus === 'draft';
        }
        if (role === 'group_leader') {
          return sf.approvalStatus === 'approve1';
        }
        return false;
      },
      canEdit() {
        return false;
      },
      isPm() { return false; },
      isSectorAdmin() { return false; },
      canShowAlertsButton() { return true; },
      lsMountId() { return 'approval-luckysheet-mount'; },
      lsGridKey() { return 'ptrack_approval_review'; },
      scopedProjects() {
        const sector = this.reviewSector;
        return this.tableProjects.filter(function (p) {
          return (p.unit_code || 'S520') === sector;
        });
      },
      filteredProjects() {
        let p = this.scopedProjects;
        if (this.viewMode === 'changed_only') {
          return p.filter(function (x) {
            if (x._changed_fields && x._changed_fields.length) return true;
            return Object.keys(x._field_change_log || {}).length > 0;
          });
        }
        return p;
      },
      reviewProjectCount() { return this.filteredProjects.length; },
      changedProjectCount() {
        return this.scopedProjects.filter(function (p) {
          if (p._changed_fields && p._changed_fields.length) return true;
          return Object.keys(p._field_change_log || {}).length > 0;
        }).length;
      },
      reviewEmptyText() {
        if (this.scopedProjects.length === 0) return '本板块暂无项目数据';
        if (this.filteredProjects.length === 0) return '当前筛选条件下无项目';
        return '';
      },
      reviewHintText() {
        const base = '本板块 ' + this.scopedProjects.length + ' 条 · 当前显示 ' + this.reviewProjectCount + ' 条 · 只读';
        if (!this.reviewerEditActive) {
          return base + ' · 当前节点请通过「驳回」退回修改';
        }
        return base + ' · 当前可审阅；需改数请驳回';
      }
    },
    mounted() {
      this.initLuckysheet();
      var self = this;
      this._unwatchSidebar = this.$watch(
        function () { return Store.sidebarCollapsed; },
        function () { self.scheduleLuckysheetResize(); }
      );
      this.fetchAlertsBadgeCount();
    },
    beforeDestroy() {
      this.teardownLuckysheetResizeObserver();
      if (this._unwatchSidebar) {
        this._unwatchSidebar();
        this._unwatchSidebar = null;
      }
      this.destroyLuckysheet();
    },
    methods: {
      handleAlertOpenProject(projectNo) {
        this.alertsDrawerVisible = false;
        var list = this.filteredProjects;
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].project_no === projectNo) { idx = i; break; }
        }
        if (idx >= 0) {
          this.openProjectDrawer(projectNo, idx);
          return;
        }
        var all = this.scopedProjects;
        for (var j = 0; j < all.length; j++) {
          if (all[j].project_no === projectNo) {
            this.openProjectDrawer(projectNo, -1);
            return;
          }
        }
        this.$message.info('未在本板块表格中找到项目 ' + projectNo);
      }
    },
    template: [
      '<motion-placeholder class="approval-review-sheet">',
      '<motion-placeholder v-if="showDiffHint" class="editor-diff-hint">',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--editable"></span>可编辑列</span>',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--new"></span>新增项目</span>',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--changed"></span>有变化字段</span>',
      '<span style="flex:1;"></span>',
      '<span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>',
      '</motion-placeholder>',
      '<motion-placeholder v-if="reviewEmptyText" class="approval-review-sheet-empty empty-state">',
      '<i class="el-icon-document" style="font-size:32px;color:#94a3b8;"></i>',
      '<p style="margin-top:8px;font-size:13px;color:#64748b;">{{ reviewEmptyText }}</p>',
      '</motion-placeholder>',
      '<motion-placeholder v-else class="luckysheet-editor-wrap">',
      '<motion-placeholder class="sheet-toolbar">',
      '<el-radio-group v-model="viewMode" size="mini" class="view-toggle view-toggle--compact">',
      '<el-radio-button label="all">全部（{{ scopedProjects.length }}）</el-radio-button>',
      '<el-radio-button label="changed_only">有变化（{{ changedProjectCount }}）</el-radio-button>',
      '</el-radio-group>',
      '<el-divider direction="vertical" class="sheet-toolbar-divider"></el-divider>',
      '<el-checkbox v-model="compactColumnsOnly" class="sheet-toolbar-checkbox">仅显示项目信息与可编辑列</el-checkbox>',
      '<el-button v-if="canShowAlertsButton" size="mini" icon="el-icon-bell" style="margin-left:8px;" @click="handleOpenAlertsDrawer">项目预警（{{ alertsBadgeCount != null ? alertsBadgeCount : \'…\' }}）</el-button>',
      '<span class="approval-review-toolbar-hint">{{ reviewHintText }}</span>',
      '</motion-placeholder>',
      '<motion-placeholder :id="lsMountId"></motion-placeholder>',
      '</motion-placeholder>',
      '<project-detail-drawer',
      '  :visible="projectDrawerVisible"',
      '  :project="projectDrawerProject"',
      '  :can-edit="false"',
      '  :saving="projectDrawerSaving"',
      '  :month-idx="monthIdx"',
      '  :nav-index="projectDrawerNavIndex"',
      '  :nav-total="filteredProjects.length"',
      '  :field-editable="drawerFieldEditableProp"',
      '  :format-value="drawerFormatValueProp"',
      '  :stock-warning-field="drawerStockWarningProp"',
      '  :focus-target="projectDrawerFocusTarget"',
      '  @close="closeProjectDrawer"',
      '  @save="handleProjectDrawerSave"',
      '  @nav-prev="navigateProjectDrawer(-1)"',
      '  @nav-next="navigateProjectDrawer(1)"',
      '/>',
      '<alerts-drawer',
      '  :visible="alertsDrawerVisible"',
      '  :month-idx="monthIdx"',
      '  :can-dismiss="canDismissAlerts"',
      '  @close="alertsDrawerVisible = false"',
      '  @open-project="handleAlertOpenProject"',
      '/>',
      '</motion-placeholder>'
    ].join('')
  };

  window.ApprovalReviewSheet.template = window.ApprovalReviewSheet.template
    .replace(/<motion-placeholder/g, '<div')
    .replace(/<\/motion-placeholder>/g, '</div>');
})(window);
