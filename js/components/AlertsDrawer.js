/**
 * AlertsDrawer.js — 项目预警总览抽屉
 * 全角色可查看；忽略/撤回仅系统管理员（canDismiss）
 */
(function (window) {
  'use strict';

  window.AlertsDrawer = {
    name: 'AlertsDrawer',
    props: {
      visible:  { type: Boolean, default: false },
      monthIdx: { type: Number, required: true },
      /** 仅系统管理员可忽略/撤回 */
      canDismiss: { type: Boolean, default: false }
    },
    data: function () {
      return {
        loading: false,
        allAlerts: [],
        summary: null,
        searchQuery: '',
        typeFilter: '',
        sectorFilter: '',
        statusFilter: '',
        currentPage: 1,
        pageSize: 20,
        alertTypeOptions: [
          { value: 'invoice_stock_negative',  label: '存量开票额为负' },
          { value: 'contract_stock_negative', label: '存量合同额为负' },
          { value: 'completion_no_hours',     label: '有完成额无工时' },
          { value: 'hours_no_completion',     label: '有工时无完成额' }
        ],
        statusOptions: [
          { value: '',          label: '全部' },
          { value: 'active',    label: '活跃' },
          { value: 'dismissed', label: '已忽略' }
        ]
      };
    },
    computed: {
      drawerVisible: {
        get: function () { return this.visible; },
        set: function (v) { if (!v) this.$emit('close'); }
      },
      sectorOptions: function () {
        var seen = {};
        var result = [];
        for (var i = 0; i < this.allAlerts.length; i++) {
          var a = this.allAlerts[i];
          var code = a.sectorCode || '';
          if (code && !seen[code]) {
            seen[code] = true;
            result.push({ value: code, label: code + (a.sectorName ? ' ' + a.sectorName : '') });
          }
        }
        result.sort(function (a, b) { return a.label.localeCompare(b.label, 'zh-CN'); });
        return result;
      },
      filteredAlerts: function () {
        var q = (this.searchQuery || '').trim().toLowerCase();
        var tf = this.typeFilter;
        var sf = this.sectorFilter;
        var st = this.statusFilter;
        return this.allAlerts.filter(function (a) {
          if (tf && a.alertType !== tf) return false;
          if (sf && a.sectorCode !== sf) return false;
          if (st && a.status !== st) return false;
          if (q) {
            var hay = (a.projectNo + ' ' + a.projectName + ' ' + a.alertLabel + ' ' + a.detail).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });
      },
      totalFiltered: function () { return this.filteredAlerts.length; },
      pagedAlerts: function () {
        var start = (this.currentPage - 1) * this.pageSize;
        return this.filteredAlerts.slice(start, start + this.pageSize);
      },
      activeStatByType: function () {
        return (this.summary && this.summary.byType) ? this.summary.byType : {};
      }
    },
    watch: {
      visible: function (v) {
        if (v) {
          this.fetchAlerts();
        } else {
          this.allAlerts = [];
          this.summary = null;
        }
      }
    },
    methods: {
      fetchAlerts: function () {
        var self = this;
        self.loading = true;
        var year = (window.Store && Store.reportingMonth)
          ? parseInt(String(Store.reportingMonth).slice(0, 4), 10)
          : new Date().getFullYear();
        var url = '/api/admin/alerts?year=' + year + '&monthIdx=' + self.monthIdx;
        fetch(url)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            self.allAlerts = d.alerts || [];
            self.summary = d.summary || null;
          })
          .catch(function (e) {
            self.$message.error('加载预警数据失败：' + (e.message || e));
          })
          .finally(function () { self.loading = false; });
      },
      handleResetFilters: function () {
        this.searchQuery = '';
        this.typeFilter = '';
        this.sectorFilter = '';
        this.statusFilter = '';
        this.currentPage = 1;
      },
      handleSearch: function () { this.currentPage = 1; },
      handleFilterChange: function () { this.currentPage = 1; },
      handleCardClick: function (alert) {
        if (alert.status !== 'active') return;
        this.$emit('open-project', alert.projectNo);
      },
      handleDismiss: function (alert, event) {
        if (!this.canDismiss) return;
        if (event) event.stopPropagation();
        var self = this;
        this.$confirm(
          '确定要忽略此预警吗？忽略后，该项目的此类预警将不再出现在活跃列表中（跨月生效）。可在「已忽略」筛选中撤回。',
          '忽略预警',
          { confirmButtonText: '确认忽略', cancelButtonText: '取消', type: 'warning' }
        ).then(function () {
          return fetch('/api/admin/alerts/' + alert.id + '/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dismissedBy: (window.Store && Store.currentUser && Store.currentUser.role) || 'system_admin',
              role: (window.Store && Store.currentUser && Store.currentUser.role) || ''
            })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) throw new Error(d.error || '操作失败');
            self.$message.success('已忽略，可在「已忽略」中撤回');
            self.fetchAlerts();
          });
        }).catch(function (e) {
          if (e !== 'cancel' && e !== 'close') {
            self.$message.error('操作失败：' + (e.message || e));
          }
        });
      },
      handleUndismiss: function (alert, event) {
        if (!this.canDismiss) return;
        if (event) event.stopPropagation();
        var self = this;
        this.$confirm(
          '确定撤回忽略吗？若预警条件仍满足，将重新出现在活跃列表中；若条件已不满足，该记录将直接移除。',
          '撤回忽略',
          { confirmButtonText: '确认撤回', cancelButtonText: '取消', type: 'info' }
        ).then(function () {
          return fetch('/api/admin/alerts/' + alert.id + '/undismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              undoneBy: (window.Store && Store.currentUser && Store.currentUser.role) || 'system_admin',
              role: (window.Store && Store.currentUser && Store.currentUser.role) || ''
            })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) throw new Error(d.error || '操作失败');
            self.$message.success('已撤回忽略');
            self.statusFilter = '';
            self.fetchAlerts();
          });
        }).catch(function (e) {
          if (e !== 'cancel' && e !== 'close') {
            self.$message.error('操作失败：' + (e.message || e));
          }
        });
      },
      alertTypeTagClass: function (alertType) {
        if (alertType === 'invoice_stock_negative' || alertType === 'contract_stock_negative') {
          return 'alerts-card-type-tag alerts-card-type-tag--danger';
        }
        return 'alerts-card-type-tag alerts-card-type-tag--warning';
      },
      alertIcon: function (alertType) {
        return (alertType === 'invoice_stock_negative' || alertType === 'contract_stock_negative')
          ? 'el-icon-warning' : 'el-icon-time';
      },
      isDangerType: function (alertType) {
        return alertType === 'invoice_stock_negative' || alertType === 'contract_stock_negative';
      },
      handleClose: function () { this.$emit('close'); }
    },
    template: [
      '<el-drawer',
      '  :visible.sync="drawerVisible"',
      '  size="800px"',
      '  :append-to-body="true"',
      '  custom-class="alerts-drawer"',
      '  direction="rtl">',
      '  <div slot="title" class="alerts-drawer-header">',
      '    <h3>项目预警总览</h3>',
      '    <div class="alerts-drawer-summary-bar" v-if="summary">',
      '      <span>共 {{ summary.total }} 条预警（活跃 {{ summary.activeCount }} 条），涉及 {{ summary.projectCount }} 个项目</span>',
      '    </div>',
      '  </div>',
      '  <div class="alerts-drawer-body">',
      '    <div class="alerts-drawer-toolbar">',
      '      <el-input v-model="searchQuery" placeholder="搜索项目号 / 名称 / 预警类型" prefix-icon="el-icon-search" clearable size="small" style="width:220px" @input="handleSearch"></el-input>',
      '      <el-select v-model="typeFilter" placeholder="预警类型" clearable size="small" style="width:150px" @change="handleFilterChange">',
      '        <el-option v-for="opt in alertTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value"></el-option>',
      '      </el-select>',
      '      <el-select v-model="sectorFilter" placeholder="项目板块" clearable filterable size="small" style="width:160px" @change="handleFilterChange">',
      '        <el-option v-for="opt in sectorOptions" :key="opt.value" :label="opt.label" :value="opt.value"></el-option>',
      '      </el-select>',
      '      <el-select v-model="statusFilter" placeholder="状态" size="small" style="width:100px" @change="handleFilterChange">',
      '        <el-option v-for="opt in statusOptions" :key="opt.label" :label="opt.label" :value="opt.value"></el-option>',
      '      </el-select>',
      '      <el-button size="small" @click="handleResetFilters">重置</el-button>',
      '    </div>',
      '    <div class="alerts-drawer-stat-bar" v-if="summary">',
      '      <span class="alerts-stat-chip" v-for="opt in alertTypeOptions" :key="opt.value">',
      '        <i :class="isDangerType(opt.value) ? \'el-icon-warning\' : \'el-icon-time\'" style="margin-right:4px"></i>{{ opt.label }}: {{ activeStatByType[opt.value] || 0 }}',
      '      </span>',
      '    </div>',
      '    <div class="alerts-drawer-list" v-loading="loading">',
      '      <div v-for="alert in pagedAlerts" :key="alert.id" class="alerts-card" :class="{ \'is-dismissed\': alert.status === \'dismissed\' }" @click="handleCardClick(alert)">',
      '        <div class="alerts-card-header">',
      '          <span :class="alertTypeTagClass(alert.alertType)"><i :class="alertIcon(alert.alertType)" style="margin-right:4px"></i>{{ alert.alertLabel }}</span>',
      '          <span class="alerts-card-sector">{{ alert.sectorCode }} {{ alert.sectorName }}</span>',
      '        </div>',
      '        <div class="alerts-card-body">',
      '          <div class="alerts-card-project"><strong>{{ alert.projectNo }}</strong><span style="margin-left:8px">{{ alert.projectName }}</span></div>',
      '          <div class="alerts-card-detail">{{ alert.detail }}</div>',
      '        </div>',
      '        <div class="alerts-card-footer">',
      '          <span class="alerts-card-actions" v-if="alert.status === \'active\' && canDismiss">',
      '            <el-button size="mini" type="info" plain @click.stop="handleDismiss(alert, $event)">忽略</el-button>',
      '          </span>',
      '          <span class="alerts-card-actions" v-else-if="alert.status === \'dismissed\'">',
      '            <span class="alerts-card-action alerts-card-action--dismissed">已忽略</span>',
      '            <el-button v-if="canDismiss" size="mini" type="primary" plain @click.stop="handleUndismiss(alert, $event)">撤回</el-button>',
      '          </span>',
      '        </div>',
      '      </div>',
      '      <div class="alerts-drawer-empty" v-if="!loading && pagedAlerts.length === 0">',
      '        <i class="el-icon-warning-outline" style="font-size:40px;color:#d1d5db;display:block;margin-bottom:12px"></i>',
      '        <span v-if="allAlerts.length === 0">暂无预警记录</span>',
      '        <span v-else>无匹配结果，请调整筛选条件</span>',
      '      </div>',
      '    </div>',
      '    <div class="alerts-drawer-pagination" v-if="totalFiltered > pageSize">',
      '      <el-pagination layout="total, prev, pager, next" :total="totalFiltered" :page-size="pageSize" :current-page.sync="currentPage" small></el-pagination>',
      '    </div>',
      '  </div>',
      '  <div class="alerts-drawer-footer">',
      '    <el-button @click="handleClose">关闭</el-button>',
      '  </div>',
      '</el-drawer>'
    ].join('\n')
  };
})(window);
