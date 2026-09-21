/**
 * ReportLineOverviewPage.js — 报告线概览页（独立路由 /report-lines/:id）
 *
 * 与明细页（/report-lines/:id/sheet）是两个页面，不共用外壳：
 *   - 概览页：常规文档流页面，可整页滚动，有页面边距，无 Luckysheet 相关工具栏
 *   - 明细页：Luckysheet 全屏表格，自带图例、预警、导出、版本选择
 *
 * extends ReportLineDetailView 只为复用数据源、权限判定与审批方法；
 * activeTab 恒为 'overview'，父类中所有 Luckysheet 分支均不会进入。
 */
(function (window) {
  'use strict';

  window.ReportLineOverviewPageView = {
    name: 'ReportLineOverviewPage',
    extends: window.ReportLineDetailView,

    data: function () {
      return { activeTab: 'overview' };
    },

    computed: {
      /** 明细页路径，保留 mode 以便权限判定一致 */
      sheetRoute: function () {
        var id = this.$route && this.$route.params && this.$route.params.id;
        return {
          path: '/report-lines/' + id + '/sheet',
          query: Object.assign({}, (this.$route && this.$route.query) || {})
        };
      },
      /** 可填报时把明细入口提为主操作 */
      sheetEntryLabel: function () {
        return this.canEdit ? '去填报' : '明细表';
      }
    },

    watch: {
      '$route.params.id': function () { this.loadDetail(); }
    },

    methods: {
      goSheet: function () { this.$router.push(this.sheetRoute); },

      goList: function () { this.$router.push('/report-lines'); },

      /** 概览里点「查看」直接在本页开 Drawer，不跳明细 */
      handleOverviewOpenProject: function (projectNo) {
        if (!projectNo) return;
        var list = this.filteredProjects || [];
        var idx = list.findIndex(function (item) { return item.project_no === projectNo; });
        this.openProjectDrawer(projectNo, idx);
      }
    },

    template: `
      <div class="rl-page" v-loading="rlLoading">
        <header class="rl-page-head">
          <div class="rl-page-crumb">
            <button type="button" class="rl-page-back" @click="goList">
              <i class="el-icon-arrow-left"></i>填报与审批
            </button>
            <span class="rl-page-crumb-sep">/</span>
            <template v-if="rlContextBar">
              <h1>{{ rlContextBar.sectorName }}</h1>
              <span class="rl-page-period">{{ rlContextBar.periodLabel }}</span>
              <el-tag :type="rlContextBar.statusType" size="small">{{ rlContextBar.statusLabel }}</el-tag>
            </template>
          </div>
          <div class="rl-page-actions">
            <el-button v-if="rlCanReject" size="small" plain icon="el-icon-refresh-left" @click="handleRlReject">退回</el-button>
            <el-button v-if="rlCanApprove" size="small" type="success" icon="el-icon-circle-check" @click="handleRlApprove">审批通过</el-button>
            <el-button
              size="small"
              :type="canEdit ? 'primary' : ''"
              icon="el-icon-s-grid"
              @click="goSheet"
            >{{ sheetEntryLabel }}</el-button>
          </div>
        </header>

        <report-line-overview
          :projects="overviewProjects"
          :baseline-projects="overviewBaselineProjects"
          :month-idx="monthIdx"
          :report-line="overviewReportLine"
          @open-project="handleOverviewOpenProject"
        />

        <project-detail-drawer
          :visible="projectDrawerVisible"
          :project="projectDrawerProject"
          :can-edit="false"
          :saving="projectDrawerSaving"
          :month-idx="monthIdx"
          :nav-index="projectDrawerNavIndex"
          :nav-total="filteredProjects.length"
          :field-editable="drawerFieldEditableProp"
          :format-value="drawerFormatValueProp"
          :stock-warning-field="drawerStockWarningProp"
          :focus-target="projectDrawerFocusTarget"
          @close="closeProjectDrawer"
          @nav-prev="navigateProjectDrawer(-1)"
          @nav-next="navigateProjectDrawer(1)"
        />
      </div>
    `
  };
})(window);
