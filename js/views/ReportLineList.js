/**
 * ReportLineList.js — 填报管理列表页
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
        // 手动发起填报弹窗
        forkDialogVisible: false,
        forkPreviewLoading: false,
        forkConfirming: false,
        forkPreview: null
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
        return false;
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
          completed:          { label: '已完成',         type: 'success' },
          closed:             { label: '已关闭',         type: 'info' }
        };
        return map[status] || { label: status, type: 'info' };
      },
      opLabel(op) {
        var map = {
          fill: '填报', approve: '审批', view: '查看',
          export: '导出', submit_approval: '提交审批', pm_submit: '提交'
        };
        return map[op] || op;
      },
      handleAction(action, row) {
        if (action === 'export') {
          window.open('/api/report-lines/' + row.id + '/export', '_blank');
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

      // ── 手动发起填报 ──────────────────────────────────────────
      async openForkDialog() {
        this.forkDialogVisible = true;
        this.forkPreview = null;
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
          var result = await Store.forkReportPeriod(this.forkPreview.period);
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

        <!-- ① 筛选区 -->
        <div class="list-filter-bar card" style="padding:12px 16px;margin-bottom:12px;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <el-select
              v-model="pendingFilters.status"
              placeholder="状态"
              size="small"
              style="width:160px;"
            >
              <el-option label="全部状态" value="all"></el-option>
              <el-option label="进行中" value="in_progress"></el-option>
              <el-option label="开放填报" value="open"></el-option>
              <el-option label="已提交" value="submitted"></el-option>
              <el-option label="板块领导审批中" value="reviewing_director"></el-option>
              <el-option label="群主审批中" value="reviewing_leader"></el-option>
              <el-option label="已退回" value="returned"></el-option>
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
          >手动发起填报</el-button>
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
            <el-table-column label="板块" prop="sector_code" width="150">
              <template slot-scope="{ row }">
                <span style="font-size:13px;">{{ sectorName(row.sector_code) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="周期" prop="period" width="110">
              <template slot-scope="{ row }">
                <span style="font-size:13px;">{{ formatPeriod(row.period) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="状态" width="160">
              <template slot-scope="{ row }">
                <el-tag :type="statusTag(row.status).type" size="small" style="font-size:12px;">
                  {{ statusTag(row.status).label }}
                </el-tag>
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

        <!-- ⑤ 手动发起填报弹窗 -->
        <el-dialog
          title="手动发起填报"
          :visible.sync="forkDialogVisible"
          width="860px"
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

            <!-- 审批人员核对表 -->
            <el-table
              :data="forkPreview.sectors"
              size="small"
              border
              stripe
              style="width:100%;"
              :header-cell-style="{background:'#f8fafc',fontWeight:'600',fontSize:'12px'}"
              max-height="380"
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
      </div>
    `
  };
})(window);
