/**
 * AuditLog.js — 数据变更审计日志
 * 变更历史表格 + 多维度筛选
 */
(function (window) {
  'use strict';

  window.AuditLogView = {
    name: 'AuditLog',
    data() {
      return {
        filterDateRange: null,
        filterUser: '',
        filterProject: '',
        filterField: '',
        currentPage: 1,
        pageSize: 50
      };
    },
    computed: {
      store() { return window.Store; },
      allLogs() { return Store.auditLog; },
      filteredLogs() {
        return this.allLogs.filter(log => {
          if (this.filterUser && !log.userName.includes(this.filterUser)) return false;
          if (this.filterProject && !((log.projectNo || '').includes(this.filterProject) || (log.projectName || '').includes(this.filterProject))) return false;
          if (this.filterField && !(log.fieldCN || '').includes(this.filterField)) return false;
          if (this.filterDateRange && this.filterDateRange.length === 2) {
            const t = new Date(log.timestamp);
            if (t < this.filterDateRange[0] || t > this.filterDateRange[1]) return false;
          }
          return true;
        });
      },
      pagedLogs() {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredLogs.slice(start, start + this.pageSize);
      },
      userOptions() {
        const users = [...new Set(this.allLogs.map(l => l.userName).filter(Boolean))];
        return users;
      },
      projectOptions() {
        const projects = [...new Set(this.allLogs.map(l => l.projectNo).filter(Boolean))];
        return projects;
      }
    },
    methods: {
      formatTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN');
      },
      clearFilters() {
        this.filterDateRange = null;
        this.filterUser = '';
        this.filterProject = '';
        this.filterField = '';
        this.currentPage = 1;
      },
      handleExportLog() {
        if (!window.XLSX) { this.$message.error('SheetJS 未加载'); return; }
        const data = [
          ['操作时间','操作人','角色','项目号','项目名称','字段','原值','新值'],
          ...this.filteredLogs.map(l => [
            this.formatTime(l.timestamp),
            l.userName || '',
            l.userId || '',
            l.projectNo || '',
            l.projectName || '',
            l.fieldCN || l.fieldName || '',
            l.oldVal || '',
            l.newVal || ''
          ])
        ];
        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '审计日志');
        XLSX.writeFile(wb, `审计日志_${new Date().toISOString().slice(0,10)}.xlsx`);
        this.$message.success('导出成功');
      },
      rowClassName({ row }) {
        if (!row.oldVal && row.newVal) return 'audit-row-add';
        if (row.fieldName === 'approvalStatus') return 'audit-row-system';
        return '';
      }
    },
    template: `
      <div>
        <!-- 筛选栏 -->
        <div class="card" style="padding:16px 20px;margin-bottom:16px;">
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
            <el-date-picker
              v-model="filterDateRange"
              type="daterange"
              size="small"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              style="width:260px;"
            ></el-date-picker>

            <el-select
              v-model="filterUser"
              size="small"
              placeholder="操作人"
              clearable
              style="width:150px;"
            >
              <el-option
                v-for="u in userOptions"
                :key="u" :label="u" :value="u"
              ></el-option>
            </el-select>

            <el-input
              v-model="filterProject"
              size="small"
              placeholder="项目号/名称"
              clearable
              style="width:200px;"
              prefix-icon="el-icon-search"
            ></el-input>

            <el-input
              v-model="filterField"
              size="small"
              placeholder="字段名"
              clearable
              style="width:140px;"
            ></el-input>

            <el-button size="small" @click="clearFilters">
              <i class="el-icon-refresh"></i> 重置
            </el-button>

            <div style="flex:1;"></div>

            <span style="font-size:12px;color:#94a3b8;">
              共 {{ filteredLogs.length }} 条记录
            </span>

            <el-button size="small" icon="el-icon-download" @click="handleExportLog">
              导出日志
            </el-button>
          </div>
        </div>

        <!-- 日志表格 -->
        <div class="card" style="padding:0;">
          <el-table
            :data="pagedLogs"
            :row-class-name="rowClassName"
            border
            size="small"
            style="width:100%;"
            :header-cell-style="{background:'#f8fafc',fontWeight:'600',fontSize:'12px'}"
          >
            <el-table-column label="操作时间" width="160" fixed>
              <template slot-scope="{row}">
                <span style="font-size:12px;color:#64748b;font-variant-numeric:tabular-nums;">
                  {{ formatTime(row.timestamp) }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="操作人" width="120">
              <template slot-scope="{row}">
                <div style="font-size:12px;font-weight:500;">{{ row.userName || '—' }}</div>
                <div style="font-size:11px;color:#94a3b8;">{{ row.userId || '' }}</div>
              </template>
            </el-table-column>

            <el-table-column label="项目号" width="160">
              <template slot-scope="{row}">
                <span style="font-size:12px;font-family:monospace;">{{ row.projectNo || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="项目名称" min-width="180">
              <template slot-scope="{row}">
                <span style="font-size:12px;">{{ row.projectName || '—' }}</span>
              </template>
            </el-table-column>

            <el-table-column label="修改字段" width="130">
              <template slot-scope="{row}">
                <el-tag size="mini" type="info">{{ row.fieldCN || row.fieldName || '—' }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column label="原值" min-width="130">
              <template slot-scope="{row}">
                <span
                  class="diff-remove amount"
                  style="padding:2px 6px;border-radius:3px;font-size:12px;"
                  v-if="row.oldVal"
                >{{ row.oldVal }}</span>
                <span v-else style="color:#94a3b8;font-size:12px;">—</span>
              </template>
            </el-table-column>

            <el-table-column label="新值" min-width="130">
              <template slot-scope="{row}">
                <span
                  class="diff-change amount"
                  style="padding:2px 6px;border-radius:3px;font-size:12px;"
                  v-if="row.newVal"
                >{{ row.newVal }}</span>
                <span v-else style="color:#94a3b8;font-size:12px;">—</span>
              </template>
            </el-table-column>
          </el-table>

          <!-- 分页 -->
          <div style="padding:12px 16px;display:flex;justify-content:flex-end;border-top:1px solid #e2e8f0;">
            <el-pagination
              :current-page.sync="currentPage"
              :page-size="pageSize"
              :total="filteredLogs.length"
              layout="total, prev, pager, next"
              small
            ></el-pagination>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="allLogs.length === 0" class="empty-state card" style="margin-top:16px;">
          <i class="el-icon-document-checked"></i>
          <div>暂无操作日志</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
            在项目追踪表中进行数据修改后，操作记录将自动显示于此
          </div>
        </div>
      </div>
    `
  };
})(window);
