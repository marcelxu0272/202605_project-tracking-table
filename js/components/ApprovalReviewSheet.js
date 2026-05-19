/**
 * ApprovalReviewSheet.js
 */
(function (window) {
  'use strict';

  window.ApprovalReviewSheet = {
    name: 'ApprovalReviewSheet',
    extends: window.ProjectEditorView,
    data() {
      return {
        viewMode: 'all',
        activeTab: 'luckysheet',
        showLegacyHtmlTable: false,
        showDiffHint: true,
        _pmBaselineCaptured: true
      };
    },
    computed: {
      canEdit() { return false; },
      isPm() { return false; },
      isSectorAdmin() { return false; },
      lsMountId() { return 'approval-luckysheet-mount'; },
      lsShowToolbar() { return false; },
      lsGridKey() { return 'ptrack_approval_review'; },
      reviewProjectCount() { return this.filteredProjects.length; },
      scopedProjects() {
        const sector = this.user.sector || 'S520';
        return this.tableProjects.filter(function (p) {
          return (p.unit_code || 'S520') === sector;
        });
      },
      filteredProjects() {
        return this.scopedProjects.filter(function (p) {
          if (p._added_this_month) return true;
          return p._changed_fields && p._changed_fields.length > 0;
        });
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
      '<div class="approval-review-sheet">',
      '  <div v-if="showDiffHint" class="editor-diff-hint">',
      '    <span class="editor-legend-item">',
      '      <span class="editor-legend-swatch editor-legend-swatch--new"></span>',
      '      <span>\u672c\u6708\u65b0\u589e\u9879\u76ee</span>',
      '    </span>',
      '    <span class="editor-legend-item">',
      '      <span class="editor-legend-swatch editor-legend-swatch--changed" aria-hidden="true">Aa</span>',
      '      <span>\u672c\u6708\u6709\u53d8\u66f4\u5b57\u6bb5</span>',
      '    </span>',
      '    <span style="font-size:12px;color:#64748b;margin-left:8px;">',
      '      \u5171 {{ reviewProjectCount }} \u6761\uff08\u4ec5\u5c55\u793a\u65b0\u589e\u6216\u6709\u53d8\u66f4\u7684\u9879\u76ee\uff0c\u53ea\u8bfb\uff09',
      '    </span>',
      '    <span style="flex:1;"></span>',
      '    <span style="cursor:pointer;" @click="showDiffHint=false"><i class="el-icon-close"></i></span>',
      '  </div>',
      '  <div v-if="reviewProjectCount === 0" class="approval-review-sheet-empty empty-state">',
      '    <i class="el-icon-document" style="font-size:32px;color:#94a3b8;"></i>',
      '    <div style="margin-top:8px;font-size:13px;color:#64748b;">\u6682\u65e0\u65b0\u589e\u6216\u53d8\u66f4\u9879\u76ee</div>',
      '  </div>',
      '  <div v-else class="luckysheet-editor-wrap">',
      '    <div :id="lsMountId"></div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };
})(window);
