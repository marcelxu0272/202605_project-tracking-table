/**
 * ReportLineList.js — 填报与审批列表页
 * 按 LIST_FORM.md 规范：筛选区 + 操作区 + 数据表格 + 分页
 */
(function (window) {
  'use strict';

  window.ReportLineListView = {
    name: 'ReportLineList',
    data() {
      return {
        loading: false,
        // 筛选草稿（下拉选择后不立即触发查询）
        pendingFilters: { status: 'all', sector: '', period: '' },
        // 已生效筛选（点击「搜索」后应用）
        activeFilters:  { status: 'all', sector: '', period: '' },
        // 分页
        currentPage: 1,
        pageSize: 10,
        // 发起填报弹窗
        forkDialogVisible: false,
        forkPreviewLoading: false,
        forkConfirming: false,
        forkPreview: null,
        // 分发列配置
        forkDistMode: 'all',      // 'all' | 'custom'
        forkSelectedCols: [],     // 自定义模式下选中的列字母
        // 分发列选择子弹窗
        colPickerVisible: false,
        colPickerDistMode: 'all', // 子弹窗内临时状态
        colPickerSelectedCols: [], // 子弹窗内临时选中列
        // 流转轨迹弹窗
        traceDialogVisible: false,
        traceLoading: false,
        traceLine: null,        // 当前查看的报告线列表行 row
        traceApprovals: []      // 审批/提交记录列表
      };
    },
    computed: {
      user() { return Store.currentUser; },
      reportLines() { return Store.reportLines; },
      sectorOptions() {
        var codes = Store.sectorRegistry || [];
        var names = Store.sectorNames || {};
        return codes.map(function (c) {
          return { value: c, label: names[c] || c };
        });
      },
      periodOptions() {
        var opts = [];
        var now = new Date();
        for (var i = 0; i < 8; i++) {
          var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          var val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          var label = d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
          opts.push({ value: val, label: label });
        }
        return opts;
      },
      sortedReportLines() {
        var list = [].concat(this.reportLines);
        var self = this;
        list.sort(function (a, b) {
          // 先按周期倒序（最新在前），再按状态优先级
          if (a.period !== b.period) return b.period > a.period ? 1 : -1;
          var pa = self._sortPriority(a);
          var pb = self._sortPriority(b);
          if (pa !== pb) return pa - pb;
          var ta = a.updatedAt || a.createdAt || '';
          var tb = b.updatedAt || b.createdAt || '';
          return tb > ta ? 1 : tb < ta ? -1 : 0;
        });
        return list;
      },
      filteredLines() {
        var af = this.activeFilters;
        return this.sortedReportLines.filter(function (row) {
          if (af.sector && row.sector_code !== af.sector) return false;
          if (af.period && row.period !== af.period) return false;
          if (af.status && af.status !== 'all') {
            if (af.status === 'in_progress') {
              var inProg = ['open', 'submitted', 'reviewing_director', 'reviewing_leader', 'returned'];
              if (inProg.indexOf(row.status) < 0) return false;
            } else {
              if (row.status !== af.status) return false;
            }
          }
          return true;
        });
      },
      totalCount() {
        return this.filteredLines.length;
      },
      pagedLines() {
        var start = (this.currentPage - 1) * this.pageSize;
        return this.filteredLines.slice(start, start + this.pageSize);
      },
      forkConfirmDisabled() {
        if (!this.forkPreview) return true;
        if (!this.forkPreview.baselineAvailable) return true;
        if ((this.forkPreview.summary || {}).will_create === 0) return true;
        if (this.forkDistMode === 'custom' && this.forkSelectedCols.length === 0) return true;
        return false;
      },
      forkColumnGroups() {
        if (!window.FieldConfig) return [];
        var fields = FieldConfig.buildFieldConfig();
        var sectionOrder = [];
        var sectionMap = {};
        fields.forEach(function (f) {
          if (!sectionMap[f.section]) {
            sectionOrder.push(f.section);
            sectionMap[f.section] = { name: f.section, fields: [] };
          }
          sectionMap[f.section].fields.push(f);
        });
        return sectionOrder.map(function (n) { return sectionMap[n]; });
      },
      reportingMonthLabel() {
        var month = Store.reportingMonth || (Store.periodConfig && Store.periodConfig.reportingMonth) || '';
        var parts = String(month).split('-');
        if (parts.length >= 2) {
          return parts[0] + '年' + parseInt(parts[1], 10) + '月';
        }
        return month || '—';
      },
      deadlineDay() {
        var cfg = Store.periodConfig || {};
        var day = Number(cfg.deadlineDay != null ? cfg.deadlineDay : cfg.lockDay);
        if (!day || isNaN(day)) day = 25;
        return Math.min(28, Math.max(1, day));
      },
      /** 当月填报截止提醒：仅展示报告月与截止日（几号） */
      deadlineReminder() {
        var monthLabel = this.reportingMonthLabel;
        var day = this.deadlineDay;
        if (!monthLabel || monthLabel === '—') {
          return { visible: false, text: '' };
        }
        return {
          visible: true,
          text: '填报截止日为每月 ' + day + ' 日。'
        };
      },
      forkSelectedCount() {
        if (this.forkDistMode === 'all') {
          return this.totalFieldCount;
        }
        return this.forkSelectedCols.length;
      },
      colPickerCount() {
        if (this.colPickerDistMode === 'all') {
          return this.totalFieldCount;
        }
        return this.colPickerSelectedCols.length;
      },
      totalFieldCount() {
        if (window.FieldConfig) {
          return FieldConfig.buildFieldConfig().length;
        }
        return 83;
      }
    },
    created() {
      this.loadData();
    },
    methods: {
      async loadData() {
        this.loading = true;
        try {
          await Store.fetchReportLines();
        } finally {
          this.loading = false;
        }
      },
      handleSearch() {
        this.activeFilters = Object.assign({}, this.pendingFilters);
        this.currentPage = 1;
      },
      handleReset() {
        this.pendingFilters = { status: 'all', sector: '', period: '' };
        this.activeFilters  = { status: 'all', sector: '', period: '' };
        this.currentPage = 1;
      },
      handlePageChange(page) {
        this.currentPage = page;
      },
      handleSizeChange(size) {
        this.pageSize = size;
        this.currentPage = 1;
      },
      getOperations(row) {
        return Store.getVisibleOperations(row);
      },
      statusTag(status) {
        var map = {
          open:               { label: '开放填报',       type: 'warning' },
          submitted:          { label: '已提交',         type: '' },
          reviewing_director: { label: '板块领导审批中', type: '' },
          reviewing_leader:   { label: '群主审批中',     type: '' },
          returned:           { label: '已退回',         type: 'danger' },
          finalizing:         { label: '核对归档中',     type: 'warning' },
          completed:          { label: '已完成',         type: 'success' },
          closed:             { label: '已关闭',         type: 'info' }
        };
        return map[status] || { label: status, type: 'info' };
      },
      /** 优先用服务端 my_status；缺省时按角色兜底映射 */
      myStatusTag(row) {
        if (row && row.my_status && row.my_status.label) {
          return {
            label: row.my_status.label,
            type: row.my_status.type != null ? row.my_status.type : 'info'
          };
        }
        var role = (Store.currentUser || {}).role;
        var status = row && row.status;
        if (role === 'pm') {
          return { label: '待提交', type: 'warning' };
        }
        if (role === 'sector_admin') {
          if (status === 'reviewing_director' || status === 'reviewing_leader' || status === 'submitted') {
            return { label: '已提交审批', type: 'success' };
          }
          if (status === 'finalizing') return { label: '核对归档中', type: 'warning' };
          if (status === 'completed') return { label: '已完成', type: 'success' };
          if (status === 'closed') return { label: '已关闭', type: 'info' };
          return { label: '待提交审批', type: 'warning' };
        }
        if (role === 'sector_director') {
          if (status === 'reviewing_director') return { label: '待我审批', type: 'warning' };
          if (status === 'reviewing_leader' || status === 'finalizing' || status === 'completed') {
            return { label: '已审批', type: 'success' };
          }
          if (status === 'closed') return { label: '已关闭', type: 'info' };
          return { label: '等待中', type: 'warning' };
        }
        if (role === 'group_leader') {
          if (status === 'reviewing_leader') return { label: '待我审批', type: 'warning' };
          if (status === 'finalizing' || status === 'completed') return { label: '已审批', type: 'success' };
          if (status === 'closed') return { label: '已关闭', type: 'info' };
          return { label: '等待中', type: 'warning' };
        }
        return { label: '—', type: 'info' };
      },
      opLabel(op) {
        var map = {
          fill: '填报', approve: '审批', view: '查看',
          export: '导出', submit_approval: '提交审批', pm_submit: '提交',
          trace: '流转轨迹'
        };
        return map[op] || op;
      },
      handleAction(action, row) {
        if (action === 'export') {
          var u = Store.currentUser || {};
          var qs = [];
          if (u.role) qs.push('role=' + encodeURIComponent(u.role));
          if (u.pmName || u.name) qs.push('pmName=' + encodeURIComponent(u.pmName || u.name));
          if (u.sector || u.sectorCode) qs.push('sectorCode=' + encodeURIComponent(u.sector || u.sectorCode));
          var query = qs.length ? '?' + qs.join('&') : '';
          window.open('/api/report-lines/' + row.id + '/export' + query, '_blank');
          return;
        }
        if (action === 'trace') {
          this.openTraceDialog(row);
          return;
        }
        this.$router.push({ path: '/report-lines/' + row.id, query: { mode: action } });
      },
      formatPeriod(period) {
        if (!period) return '—';
        var parts = String(period).split('-');
        if (parts.length >= 2) {
          return parts[0] + '年' + parseInt(parts[1], 10) + '月';
        }
        return period;
      },
      sectorName(code) {
        return (Store.sectorNames || {})[code] || code || '—';
      },
      _sortPriority(row) {
        var status = row.status;
        var ops = Store.getVisibleOperations(row);
        var needsAction = ops.some(function (op) {
          return op === 'fill' || op === 'approve' || op === 'submit_approval' || op === 'pm_submit';
        });
        if (needsAction) return 0;
        if (['open', 'submitted', 'reviewing_director', 'reviewing_leader', 'returned'].indexOf(status) >= 0) return 1;
        return 2;
      },

      // ── 发起填报 ──────────────────────────────────────────
      async openForkDialog() {
        this.forkDialogVisible = true;
        this.forkPreview = null;
        this.forkDistMode = 'all';
        // 初始化：默认选中全部列
        if (window.FieldConfig) {
          this.forkSelectedCols = FieldConfig.buildFieldConfig().map(function (f) { return f.col; });
        } else {
          this.forkSelectedCols = [];
        }
        this.forkPreviewLoading = true;
        try {
          var preview = await Store.fetchForkPreview();
          this.forkPreview = preview || null;
        } catch (e) {
          this.$message.error('加载预览失败：' + (e.message || String(e)));
        } finally {
          this.forkPreviewLoading = false;
        }
      },
      async confirmFork() {
        if (!this.forkPreview || !this.forkPreview.period) return;
        this.forkConfirming = true;
        try {
          var distributedCols = this.forkDistMode === 'custom' ? this.forkSelectedCols.slice() : null;
          var result = await Store.forkReportPeriod(this.forkPreview.period, distributedCols);
          var created = (result.created || []).length;
          var skipped = (result.skipped || []).length;
          var msg = '发起成功：新建 ' + created + ' 条';
          if (skipped > 0) msg += '，跳过已存在 ' + skipped + ' 条';
          this.$message.success(msg);
          this.forkDialogVisible = false;
        } catch (e) {
          this.$message.error('发起失败：' + (e.message || String(e)));
        } finally {
          this.forkConfirming = false;
        }
      },
      isMandatoryForkCol(col) {
        return ['E', 'F', 'G'].indexOf(col) >= 0;
      },
      // 子弹窗内的 toggle（操作临时状态）
      toggleColPicker(col) {
        if (this.isMandatoryForkCol(col)) return;
        var idx = this.colPickerSelectedCols.indexOf(col);
        if (idx >= 0) {
          this.colPickerSelectedCols.splice(idx, 1);
        } else {
          this.colPickerSelectedCols.push(col);
        }
      },
      selectAllColPicker() {
        if (!window.FieldConfig) return;
        this.colPickerSelectedCols = FieldConfig.buildFieldConfig().map(function (f) { return f.col; });
      },
      clearColPicker() {
        this.colPickerSelectedCols = ['E', 'F', 'G'];
      },
      openColPicker() {
        // 将当前确认值复制到临时状态
        this.colPickerDistMode = this.forkDistMode;
        this.colPickerSelectedCols = this.forkSelectedCols.slice();
        this.colPickerVisible = true;
      },
      confirmColPicker() {
        // 将临时状态写回
        this.forkDistMode = this.colPickerDistMode;
        this.forkSelectedCols = this.colPickerSelectedCols.slice();
        this.colPickerVisible = false;
      },
      cancelColPicker() {
        this.colPickerVisible = false;
      },
      // 兼容旧代码：保留但不再直接调用
      toggleForkCol(col) {
        if (this.isMandatoryForkCol(col)) return;
        var idx = this.forkSelectedCols.indexOf(col);
        if (idx >= 0) { this.forkSelectedCols.splice(idx, 1); }
        else { this.forkSelectedCols.push(col); }
      },
      selectAllForkCols() {
        if (!window.FieldConfig) return;
        this.forkSelectedCols = FieldConfig.buildFieldConfig().map(function (f) { return f.col; });
      },
      clearForkCols() {
        this.forkSelectedCols = ['E', 'F', 'G'];
      },
      // ── 流转轨迹 ──────────────────────────────────────────────
      async openTraceDialog(row) {
        this.traceLine = row;
        this.traceApprovals = [];
        this.traceDialogVisible = true;
        this.traceLoading = true;
        try {
          var approvals = await Store.fetchReportLineApprovals(row.id);
          this.traceApprovals = approvals || [];
        } catch (e) {
          this.$message.error('加载流转记录失败：' + (e.message || String(e)));
        } finally {
          this.traceLoading = false;
        }
      },

      traceTimelineItems() {
        var items = [];

        // 后续审批/提交记录
        (this.traceApprovals || []).forEach(function (a) {
          if (a.actor_role === 'pm' || a.actor_role === 'system_admin') return;

          var icon = 'el-icon-document';
          var color = '#94a3b8';
          if (a.action === 'submit') { icon = 'el-icon-upload2'; color = '#3b82f6'; }
          else if (a.action === 'approve') { icon = 'el-icon-circle-check'; color = '#10b981'; }
          else if (a.action === 'reject') { icon = 'el-icon-circle-close'; color = '#ef4444'; }
          else if (a.action === 'auto_skip') { icon = 'el-icon-d-arrow-right'; color = '#f59e0b'; }
          else if (a.action === 'auto_complete') { icon = 'el-icon-finished'; color = '#8b5cf6'; }
          else if (a.action === 'close_pm') { icon = 'el-icon-lock'; color = '#94a3b8'; }
          items.push({
            approvalId: a.id,
            action: a.action,
            icon: icon,
            color: color,
            actorRole: a.actor_role,
            actorName: a.actor_name,
            fromStatus: a.from_status,
            toStatus: a.to_status,
            snapshotVersion: a.snapshot_version || null,
            canExportSnapshot: a.action === 'submit' && a.actor_role === 'sector_admin',
            comment: a.comment || '',
            time: a.created_at
          });
        });

        return items;
      },

      traceActionLabel(action) {
        var map = {
          fork: '发起填报',
          submit: '提交',
          approve: '审批通过',
          reject: '退回',
          auto_skip: '自动跳过节点',
          auto_complete: '逾期自动完结',
          close_pm: '关闭 PM 填报'
        };
        return map[action] || action;
      },

      traceRoleLabel(role) {
        var map = {
          system_admin: '系统管理员',
          sector_admin: '板块管理员',
          pm: '项目经理',
          sector_director: '板块总监',
          group_leader: '项目群群主'
        };
        return map[role] || role || '—';
      },

      traceStatusLabel(status) {
        var map = {
          open: '开放填报',
          submitted: '已提交',
          reviewing_director: '板块领导审批中',
          reviewing_leader: '群主审批中',
          returned: '已退回',
          rejected: '已退回',
          finalizing: '核对归档中',
          completed: '已完成',
          closed: '已关闭'
        };
        return status ? (map[status] || status) : null;
      },

      exportApprovalSnapshot(approvalId) {
        if (!this.traceLine) return;
        window.open('/api/report-lines/' + this.traceLine.id + '/approvals/' + approvalId + '/export', '_blank');
      },

      formatTraceTime(ts) {
        if (!ts) return '—';
        try {
          var d = new Date(ts);
          return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0') + ' '
            + String(d.getHours()).padStart(2, '0') + ':'
            + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return ts; }
      },

      staffSourceTag(source) {
        if (source === 'configured')      return { label: '已配置', type: 'success' };
        if (source === 'platform_default') return { label: '平台默认', type: '' };
        return { label: '未配置', type: 'danger' };
      },
      forkRowStatusTag(sector) {
        if (sector.existing_report_line_id) return { label: '已存在', type: 'info' };
        return { label: '将创建', type: 'warning' };
      }
    },
    template: `
      <div class="report-line-list">

        <!-- ① 当月填报截止提醒 -->
        <div
          v-if="deadlineReminder.visible"
          class="rl-deadline-banner"
          role="status"
        >
          <i class="el-icon-time rl-deadline-banner__icon"></i>
          <div class="rl-deadline-banner__body">
            <span class="rl-deadline-banner__text">{{ deadlineReminder.text }}</span>
          </div>
        </div>

        <!-- ② 筛选区 -->
        <div class="list-filter-bar card" style="padding:12px 16px;margin-bottom:12px;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <el-select
              v-model="pendingFilters.status"
              placeholder="报告线状态"
              size="small"
              style="width:160px;"
            >
              <el-option label="全部报告线状态" value="all"></el-option>
              <el-option label="进行中" value="in_progress"></el-option>
              <el-option label="开放填报" value="open"></el-option>
              <el-option label="已提交" value="submitted"></el-option>
              <el-option label="板块领导审批中" value="reviewing_director"></el-option>
              <el-option label="群主审批中" value="reviewing_leader"></el-option>
              <el-option label="已退回" value="returned"></el-option>
              <el-option label="核对归档中" value="finalizing"></el-option>
              <el-option label="已完成" value="completed"></el-option>
              <el-option label="已关闭" value="closed"></el-option>
            </el-select>

            <el-select
              v-model="pendingFilters.sector"
              placeholder="全部板块"
              size="small"
              clearable
              style="width:150px;"
            >
              <el-option
                v-for="s in sectorOptions"
                :key="s.value"
                :label="s.label"
                :value="s.value"
              ></el-option>
            </el-select>

            <el-select
              v-model="pendingFilters.period"
              placeholder="全部周期"
              size="small"
              clearable
              style="width:130px;"
            >
              <el-option
                v-for="p in periodOptions"
                :key="p.value"
                :label="p.label"
                :value="p.value"
              ></el-option>
            </el-select>

            <el-button type="primary" size="small" icon="el-icon-search"
              style="background:#007069;border-color:#007069;"
              @click="handleSearch">搜索</el-button>
            <el-button size="small" icon="el-icon-refresh-left" @click="handleReset">重置</el-button>
          </div>
        </div>

        <!-- ② 操作区（右对齐） -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:13px;color:#64748b;">
            共 <strong>{{ totalCount }}</strong> 条
          </span>
          <el-button
            v-if="user && user.role === 'system_admin'"
            type="primary"
            size="small"
            icon="el-icon-plus"
            style="background:#007069;border-color:#007069;"
            @click="openForkDialog"
          >发起填报</el-button>
        </div>

        <!-- ③ 数据表格 -->
        <div class="card" style="padding:0;overflow:hidden;">
          <el-table
            :data="pagedLines"
            v-loading="loading"
            stripe
            size="small"
            style="width:100%;"
            :header-cell-style="{background:'#f8fafc',fontWeight:'600',fontSize:'13px',color:'#374151',padding:'10px 0'}"
          >
            <el-table-column label="我的状态" width="120">
              <template slot-scope="{ row }">
                <el-tag :type="myStatusTag(row).type" size="small" style="font-size:12px;">
                  {{ myStatusTag(row).label }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column label="报告线状态" width="160">
              <template slot-scope="{ row }">
                <el-tag :type="statusTag(row.status).type" size="small" style="font-size:12px;">
                  {{ statusTag(row.status).label }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column label="周期" prop="period" width="110">
              <template slot-scope="{ row }">
                <span style="font-size:13px;">{{ formatPeriod(row.period) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="板块" prop="sector_code" width="150">
              <template slot-scope="{ row }">
                <span style="font-size:13px;">{{ sectorName(row.sector_code) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" min-width="200">
              <template slot-scope="{ row }">
                <template v-if="getOperations(row).length > 0">
                  <span v-for="(op, idx) in getOperations(row)" :key="op">
                    <el-button type="text" size="small"
                      style="font-size:13px;padding:0;"
                      @click="handleAction(op, row)">{{ opLabel(op) }}</el-button>
                    <span v-if="idx < getOperations(row).length - 1"
                      style="color:#cbd5e1;margin:0 4px;">|</span>
                  </span>
                </template>
                <span v-else style="font-size:12px;color:#94a3b8;">—</span>
              </template>
            </el-table-column>
          </el-table>

          <!-- 空状态 -->
          <div v-if="!loading && filteredLines.length === 0"
            style="text-align:center;padding:48px 0;color:#94a3b8;">
            <i class="el-icon-document" style="font-size:32px;display:block;margin-bottom:8px;"></i>
            <div style="font-size:13px;">暂无匹配的填报记录</div>
          </div>
        </div>

        <!-- ④ 分页区 -->
        <div v-if="totalCount > 0"
          style="display:flex;justify-content:flex-end;margin-top:16px;">
          <el-pagination
            background
            :current-page="currentPage"
            :page-sizes="[10, 20, 50]"
            :page-size="pageSize"
            :total="totalCount"
            layout="total, sizes, prev, pager, next"
            @current-change="handlePageChange"
            @size-change="handleSizeChange"
          ></el-pagination>
        </div>

        <!-- ⑤ 发起填报弹窗 -->
        <el-dialog
          title="发起填报"
          :visible.sync="forkDialogVisible"
          width="1100px"
          :close-on-click-modal="false"
          class="fork-dialog"
        >
          <div v-if="forkPreviewLoading" style="text-align:center;padding:40px 0;">
            <i class="el-icon-loading" style="font-size:28px;color:#007069;"></i>
            <div style="margin-top:8px;color:#64748b;font-size:13px;">加载预览中…</div>
          </div>

          <template v-else-if="forkPreview">
            <!-- 周期信息（只读） -->
            <div style="display:flex;gap:32px;margin-bottom:16px;padding:12px 16px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
              <div>
                <span class="fork-meta-label">报告月：</span>
                <span class="fork-meta-value">{{ formatPeriod(forkPreview.period) }}</span>
              </div>
              <div>
                <span class="fork-meta-label">Baseline：</span>
                <span v-if="forkPreview.baselineAvailable" class="fork-meta-value" style="font-family:monospace;font-size:12px;">
                  {{ forkPreview.baselineVersion }}
                </span>
                <el-tag v-else type="danger" size="mini">无 J 版快照，请先归档</el-tag>
              </div>
              <div v-if="forkPreview.summary" style="margin-left:auto;display:flex;gap:16px;align-items:center;">
                <span style="font-size:12px;color:#64748b;">
                  将创建 <strong style="color:#007069;">{{ forkPreview.summary.will_create }}</strong> 条
                </span>
                <span v-if="forkPreview.summary.already_exists > 0" style="font-size:12px;color:#94a3b8;">
                  已存在 {{ forkPreview.summary.already_exists }} 条（跳过）
                </span>
                <el-tag v-if="forkPreview.summary.missing_staff > 0" type="warning" size="mini">
                  {{ forkPreview.summary.missing_staff }} 个板块人员未配置
                </el-tag>
              </div>
            </div>

            <!-- 无 baseline 警告 -->
            <el-alert
              v-if="!forkPreview.baselineAvailable"
              title="当前无 J 版快照，无法发起填报。请先在系统管理员工作台完成月度归档（生成 J 版）。"
              type="error"
              :closable="false"
              show-icon
              style="margin-bottom:16px;"
            ></el-alert>

            <!-- 分发列配置（摘要行） -->
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 16px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
              <span style="font-size:13px;font-weight:600;color:#374151;">分发列：</span>
              <span style="font-size:13px;color:#374151;">
                <template v-if="forkDistMode === 'all'">
                  全部列（<span style="color:#007069;font-weight:600;">{{ forkSelectedCount }}</span> 列）
                </template>
                <template v-else>
                  自定义（已选 <span style="color:#007069;font-weight:600;">{{ forkSelectedCount }}</span> 列）
                </template>
              </span>
              <span style="font-size:12px;color:#94a3b8;">未选列在填报界面隐藏，后台保留全量数据</span>
              <el-button
                size="mini"
                icon="el-icon-setting"
                style="margin-left:auto;"
                @click="openColPicker"
              >配置分发列</el-button>
            </div>

            <!-- 审批人员核对表 -->
            <el-table
              :data="forkPreview.sectors"
              size="small"
              border
              stripe
              style="width:100%;"
              :header-cell-style="{background:'#f8fafc',fontWeight:'600',fontSize:'12px'}"
              max-height="260"
            >
              <el-table-column label="板块" width="120">
                <template slot-scope="{ row }">
                  <span style="font-size:12px;">{{ row.sector_name }}</span>
                </template>
              </el-table-column>
              <el-table-column label="板块管理员" min-width="140">
                <template slot-scope="{ row }">
                  <div class="fork-staff-cell">
                    <span style="font-size:12px;">{{ row.staff.sectorAdmin.name || '—' }}</span>
                    <el-tag :type="staffSourceTag(row.staff.sectorAdmin.source).type" size="mini" style="margin-left:6px;">
                      {{ staffSourceTag(row.staff.sectorAdmin.source).label }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="板块审批" min-width="140">
                <template slot-scope="{ row }">
                  <div class="fork-staff-cell">
                    <span style="font-size:12px;">{{ row.staff.sectorReviewer.name || '—' }}</span>
                    <el-tag :type="staffSourceTag(row.staff.sectorReviewer.source).type" size="mini" style="margin-left:6px;">
                      {{ staffSourceTag(row.staff.sectorReviewer.source).label }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="项目群审批" min-width="140">
                <template slot-scope="{ row }">
                  <div class="fork-staff-cell">
                    <span style="font-size:12px;">{{ row.staff.groupReviewer.name || '—' }}</span>
                    <el-tag :type="staffSourceTag(row.staff.groupReviewer.source).type" size="mini" style="margin-left:6px;">
                      {{ staffSourceTag(row.staff.groupReviewer.source).label }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="项目数" width="72" align="center">
                <template slot-scope="{ row }">
                  <span style="font-size:12px;color:#64748b;">{{ row.project_count }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template slot-scope="{ row }">
                  <el-tag :type="forkRowStatusTag(row).type" size="mini">
                    {{ forkRowStatusTag(row).label }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </template>

          <div slot="footer" style="display:flex;justify-content:flex-end;gap:10px;align-items:center;">
            <span v-if="forkPreview && forkPreview.summary && forkPreview.summary.will_create === 0 && forkPreview.baselineAvailable"
              style="font-size:12px;color:#94a3b8;margin-right:auto;">
              当前周期所有板块已存在报告线，无需再次发起
            </span>
            <el-button size="small" @click="forkDialogVisible = false">取消</el-button>
            <el-button
              type="primary"
              size="small"
              :disabled="forkConfirmDisabled"
              :loading="forkConfirming"
              style="background:#007069;border-color:#007069;"
              @click="confirmFork"
            >确认发起</el-button>
          </div>
        </el-dialog>

        <!-- ⑥ 分发列选择子弹窗 -->
        <el-dialog
          title="配置分发列"
          :visible.sync="colPickerVisible"
          width="820px"
          :close-on-click-modal="false"
          append-to-body
          class="fork-dialog"
        >
          <div style="margin-bottom:14px;display:flex;align-items:center;gap:12px;">
            <el-radio-group v-model="colPickerDistMode" size="small">
              <el-radio-button label="all">全部列（{{ totalFieldCount }} 列）</el-radio-button>
              <el-radio-button label="custom">自定义（已选 {{ colPickerCount }} 列）</el-radio-button>
            </el-radio-group>
            <template v-if="colPickerDistMode === 'custom'">
              <el-button size="mini" @click="selectAllColPicker">全选</el-button>
              <el-button size="mini" @click="clearColPicker">仅识别列</el-button>
              <span style="font-size:12px;color:#94a3b8;margin-left:4px;">
                <i class="el-icon-lock" style="color:#007069;"></i>
                E / F / G 强制显示
              </span>
            </template>
          </div>

          <div v-if="colPickerDistMode === 'custom'" style="max-height:400px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px;padding:10px 14px;background:#fafafa;">
            <div v-for="group in forkColumnGroups" :key="group.name" style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.5px;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #e2e8f0;">
                {{ group.name }}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:5px;">
                <span
                  v-for="f in group.fields"
                  :key="f.col"
                  @click="toggleColPicker(f.col)"
                  :title="f.col + ': ' + f.name_cn + (f.source_type === 'system_sync' ? '（平台同步）' : f.source_type === 'auto_calc' ? '（自动计算）' : '（手工填报）')"
                  :style="{
                    display:'inline-flex', alignItems:'center', gap:'3px',
                    padding:'3px 8px', borderRadius:'4px', fontSize:'12px',
                    border: '1px solid',
                    cursor: isMandatoryForkCol(f.col) ? 'not-allowed' : 'pointer',
                    borderColor: isMandatoryForkCol(f.col) ? '#007069'
                      : colPickerSelectedCols.indexOf(f.col) >= 0 ? '#007069' : '#d1d5db',
                    background: isMandatoryForkCol(f.col) ? '#007069'
                      : colPickerSelectedCols.indexOf(f.col) >= 0 ? '#e6f4f3' : '#fff',
                    color: isMandatoryForkCol(f.col) ? '#fff'
                      : colPickerSelectedCols.indexOf(f.col) >= 0 ? '#007069' : '#9ca3af',
                    userSelect:'none', transition:'all .15s'
                  }"
                >
                  <i v-if="isMandatoryForkCol(f.col)" class="el-icon-lock" style="font-size:10px;"></i>
                  <span style="font-family:monospace;font-size:10px;opacity:0.65;">{{ f.col }}</span>
                  {{ f.name_cn }}
                </span>
              </div>
            </div>
          </div>
          <div v-else style="padding:24px 0;text-align:center;color:#64748b;font-size:13px;">
            分发全部字段列，填报界面与查看数据页完全一致。
          </div>

          <div slot="footer" style="display:flex;justify-content:flex-end;gap:10px;">
            <el-button size="small" @click="cancelColPicker">取消</el-button>
            <el-button
              type="primary" size="small"
              style="background:#007069;border-color:#007069;"
              @click="confirmColPicker"
            >确定</el-button>
          </div>
        </el-dialog>

        <!-- ⑦ 流转轨迹弹窗 -->
        <el-dialog
          title="流转轨迹"
          :visible.sync="traceDialogVisible"
          width="540px"
          :close-on-click-modal="true"
          append-to-body
        >


          <!-- 加载中 -->
          <div v-if="traceLoading" style="text-align:center;padding:40px 0;">
            <i class="el-icon-loading" style="font-size:28px;color:#007069;"></i>
            <div style="margin-top:8px;color:#64748b;font-size:13px;">加载轨迹中…</div>
          </div>

          <!-- 空状态 -->
          <div v-else-if="!traceLoading && traceTimelineItems().length === 0"
            style="text-align:center;padding:40px 0;color:#94a3b8;">
            <i class="el-icon-document" style="font-size:32px;display:block;margin-bottom:10px;"></i>
            <div style="font-size:13px;">暂无流转记录</div>
            <div style="font-size:12px;margin-top:4px;">报告线尚未发生提交或审批动作</div>
          </div>

          <!-- 时间线 -->
          <el-timeline v-else style="padding:0 4px;margin:0;">
            <el-timeline-item
              v-for="(item, idx) in traceTimelineItems()"
              :key="idx"
              :timestamp="formatTraceTime(item.time)"
              placement="top"
              :color="item.color"
              :size="idx === 0 ? 'large' : 'normal'"
            >
              <div style="padding:2px 0;">
                <!-- 标题行：人名 + 动作 + 快照导出按钮 -->
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                  <span style="font-size:13px;font-weight:600;color:#1e293b;">
                    {{ item.actorName ? item.actorName + ' ' : '' }}{{ traceActionLabel(item.action) }}
                  </span>
                  <el-button
                    v-if="item.canExportSnapshot"
                    type="text" size="mini"
                    icon="el-icon-download"
                    style="color:#007069;padding:0;"
                    @click="exportApprovalSnapshot(item.approvalId)"
                  >导出提交快照</el-button>
                </div>
                <!-- 备注 / fork 摘要 -->
                <div v-if="item.comment"
                  style="font-size:12px;color:#94a3b8;word-break:break-all;">
                  {{ item.comment }}
                </div>
              </div>
            </el-timeline-item>
          </el-timeline>

          <div slot="footer">
            <el-button size="small" @click="traceDialogVisible = false">关闭</el-button>
          </div>
        </el-dialog>

      </div>
    `
  };
})(window);
