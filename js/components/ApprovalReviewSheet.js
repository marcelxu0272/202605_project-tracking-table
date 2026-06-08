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
        if (this.viewMode === 'new_only') {
          return p.filter(function (x) { return x._added_this_month; });
        }
        if (this.viewMode === 'changed_only') {
          return p.filter(function (x) {
            if (x._changed_fields && x._changed_fields.length) return true;
            return Object.keys(x._field_change_log || {}).length > 0;
          });
        }
        return p;
      },
      reviewProjectCount() { return this.filteredProjects.length; },
      newProjectCount() {
        return this.scopedProjects.filter(function (p) { return p._added_this_month; }).length;
      },
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
        if (this.reviewerEditActive) {
          return base + ' · 需修改数据请「驳回」，由板块管理员编辑后重新提交';
        }
        return base;
      }
    },
    watch: {
      viewMode: function () {
        const self = this;
        this.buildTableData();
        this.$nextTick(function () { self.refreshLuckysheet(); });
      },
      compactColumnsOnly: function () {
        const self = this;
        this.$nextTick(function () { self.refreshLuckysheet(); });
      }
    },
    mounted() {
      const self = this;
      this.tableFields = FieldConfig.buildFieldConfig();
      this.buildTableData();
      this.$nextTick(function () {
        self.initLuckysheet();
        self.setupLuckysheetResizeObserver();
        setTimeout(function () { self.resizeLuckysheetLayout(); }, 200);
        setTimeout(function () { self.resizeLuckysheetLayout(); }, 600);
      });
      this._unwatchSidebar = this.$watch(
        function () { return Store.sidebarCollapsed; },
        function () { self.resizeLuckysheetLayout(); }
      );
    },
    activated() {
      const self = this;
      this.buildTableData();
      this.$nextTick(function () {
        self.refreshLuckysheet();
        setTimeout(function () { self.resizeLuckysheetLayout(); }, 300);
      });
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
    template: [
      '<motion-placeholder class="approval-review-sheet">',
      '<motion-placeholder v-if="showDiffHint" class="editor-diff-hint">',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--editable"></span>可编辑列</span>',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--new"></span>新增项目</span>',
      '<span class="editor-legend-item"><span class="editor-legend-swatch editor-legend-swatch--changed"></span>有更新内容字段</span>',
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
      '<el-radio-button label="new_only">新增（{{ newProjectCount }}）</el-radio-button>',
      '<el-radio-button label="changed_only">有更新内容（{{ changedProjectCount }}）</el-radio-button>',
      '</el-radio-group>',
      '<el-divider direction="vertical" class="sheet-toolbar-divider"></el-divider>',
      '<el-checkbox v-model="compactColumnsOnly" class="sheet-toolbar-checkbox">仅显示项目信息与可编辑列</el-checkbox>',
      '<span class="approval-review-toolbar-hint">{{ reviewHintText }}</span>',
      '</motion-placeholder>',
      '<motion-placeholder :id="lsMountId"></motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>'
    ].join('')
  };

  window.ApprovalReviewSheet.template = window.ApprovalReviewSheet.template
    .replace(/<motion-placeholder/g, '<div')
    .replace(/<\/motion-placeholder>/g, '</div>');
})(window);
