/**
 * AppLayout.js — 主布局：侧边栏 + 顶栏 + 内容区
 */
(function (window) {
  'use strict';

  const ROLE_LABELS = {
    system_admin:     '系统管理员',
    executive_viewer: '经营管理（只读）',
    sector_admin:     '板块管理员',
    pm:               '项目经理',
    sector_director:  '板块总监',
    group_leader:     '项目群群主'
  };

  const APPROVAL_ONLY_ROLES = ['sector_director', 'group_leader'];

  const NAV_ITEMS = [
    { path: '/editor',    icon: 'el-icon-s-grid',        label: '项目追踪表', hideForRoles: APPROVAL_ONLY_ROLES },
    { path: '/approval',  icon: 'el-icon-s-check',       label: '审批流程', hideForRoles: ['pm', 'executive_viewer'] },
    { path: '/audit',     icon: 'el-icon-document',      label: '审计日志', auditOnly: true },
    { path: '/fields',    icon: 'el-icon-s-grid',        label: '表头配置', adminOnly: true },
    { path: '/admin',     icon: 'el-icon-setting',       label: '管理设置', adminOnly: true }
  ];

  const LOCK_INFO = {
    open:   { text: '填报中', type: 'open',   tip: '填报窗口已开放，可正常填报' },
    locked: { text: '已锁定', type: 'locked', tip: '数据已冻结，仅管理员可修改' }
  };

  window.AppLayoutComponent = {
    name: 'AppLayout',
    data() {
      return { resetDevLoading: false };
    },
    computed: {
      store()     { return window.Store; },
      user()      { return Store.currentUser || {}; },
      roleName()  {
        const base = ROLE_LABELS[this.user.role] || this.user.role || '—';
        if (this.user.role === 'executive_viewer' && window.DataScope) {
          const scope = DataScope.getScopeLabel(this.user, Store.groupRegistry, Store.sectorNames);
          return scope ? base + ' · ' + scope : base;
        }
        return base;
      },
      navItems()  {
        const role = this.user.role;
        return NAV_ITEMS.filter(item => {
          if (item.adminOnly && role !== 'system_admin') return false;
          if (item.auditOnly && role !== 'system_admin') return false;
          if (item.hideForRoles && item.hideForRoles.includes(role)) return false;
          return true;
        });
      },
      approvalOnlyNav() {
        return APPROVAL_ONLY_ROLES.indexOf(this.user.role) >= 0;
      },
      lockInfo()  { return LOCK_INFO[Store.lockStatus] || LOCK_INFO.open; },
      periodBannerInfo() {
        if (Store.financeReviewReminder) {
          if (this.user.role === 'executive_viewer') {
            return {
              text: '核查提醒',
              type: 'finance-only',
              tip: '每月1-3日请核对开票/回款等数据（只读查看）'
            };
          }
          return {
            text: '财务核查期',
            type: 'finance-only',
            tip: '每月1-3日为财务核查提醒，填报窗口仍开放'
          };
        }
        return this.lockInfo;
      },
      activePath() {
        if (this.$route && this.$route.path) return this.$route.path;
        return window.AppHomePath ? AppHomePath(this.user.role) : '/editor';
      },
      pageTitle() {
        const item = NAV_ITEMS.find(n => this.activePath === n.path);
        return item ? item.label : '项目执行跟踪平台';
      },
      reportingMonth() { return Store.reportingMonth; },
      sidebarCollapsed() { return Store.sidebarCollapsed; }
    },
    methods: {
      goTo(path) { if (this.$route.path !== path) this.$router.push(path); },
      toggleSidebar() { Store.toggleSidebar(); },
      handleLogout() {
        this.$confirm('确认退出当前账号？', '提示', {
          confirmButtonText: '退出', cancelButtonText: '取消', type: 'warning'
        }).then(() => {
          Store.logout();
          this.$router.push('/login');
        }).catch(() => {});
      },
      handleResetDev() {
        this.$confirm(
          '将执行以下操作且不可撤销：\n\n' +
          '· 从「初始数据.xlsx」重新导入全部项目\n' +
          '· 审批状态恢复为「草稿」，清除已提交标记\n' +
          '· 清空审计日志与全部版本快照，写入新 I 版导入快照\n' +
          '· 填报周期配置恢复默认值（报告月 2026-05）\n' +
          '· 固定 5 条「新增项目」演示（相对 I 版 baseline 高亮）\n' +
          '· 锁定状态恢复为按日期自动计算\n\n' +
          '仅用于开发测试，确认继续？',
          '重置为初始状态',
          {
            confirmButtonText: '确认重置',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => {
          this.resetDevLoading = true;
          return Store.resetDevEnvironment();
        }).then((r) => {
          let msg = '已恢复初始状态' + (r && r.count ? '（' + r.count + ' 条项目）' : '');
          if (r && r.devSeed && r.devSeed.demoNewProjectNos) {
            msg += '；导入快照 ' + ((r.importSnapshot && r.importSnapshot.version) || (r.devSeed.importSnapshot && r.devSeed.importSnapshot.version) || 'I版');
            msg += '，新增演示 ' + r.devSeed.demoNewProjectNos.length + ' 条';
          }
          this.$message.success(msg);
          window.location.reload();
        }).catch((e) => {
          if (e === 'cancel' || e === 'close') return;
          this.$message.error('重置失败：' + (e && e.message ? e.message : e));
        }).finally(() => {
          this.resetDevLoading = false;
        });
      }
    },
    template: `
      <div class="app-layout">
        <aside class="app-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
          <div class="sidebar-logo">
            <div v-if="!sidebarCollapsed" class="sidebar-logo-text">
              金山中心<br><span>项目执行跟踪</span>
            </div>
            <div v-else class="sidebar-logo-mark" title="金山中心 · 项目执行跟踪">金</div>
          </div>
          <div class="sidebar-nav">
            <el-menu
              :default-active="activePath"
              :collapse="sidebarCollapsed"
              :collapse-transition="false"
              background-color="transparent"
              text-color="rgba(255,255,255,0.65)"
            >
              <el-menu-item
                v-for="item in navItems"
                :key="item.path"
                :index="item.path"
                @click="goTo(item.path)"
              >
                <i :class="item.icon"></i>
                <span slot="title">{{ item.label }}</span>
              </el-menu-item>
            </el-menu>
          </div>
          <div class="sidebar-footer">
            <template v-if="!sidebarCollapsed">
              <div class="sidebar-footer-status">
                <div class="sidebar-footer-month">填报月份：{{ reportingMonth }}</div>
                <span
                  class="period-banner sidebar-footer-period"
                  :class="periodBannerInfo.type"
                  :title="periodBannerInfo.tip"
                >
                  <span class="period-dot"></span>
                  {{ periodBannerInfo.text }}
                </span>
              </div>
              <button
                type="button"
                class="sidebar-collapse-btn sidebar-footer-toggle"
                title="收起菜单"
                @click="toggleSidebar"
              >
                <i class="el-icon-s-fold"></i>
                <span>收起菜单</span>
              </button>
            </template>
            <button
              v-else
              type="button"
              class="sidebar-collapse-btn sidebar-footer-toggle is-expand-only"
              title="展开菜单"
              @click="toggleSidebar"
            >
              <i class="el-icon-s-unfold"></i>
            </button>
          </div>
        </aside>

        <div class="app-main">
          <div class="app-header">

            <div class="app-header-title">{{ pageTitle }}</div>

            <el-dropdown trigger="click">
              <div style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 8px;border-radius:6px;" class="hover:bg-gray-100">
                <div style="width:28px;height:28px;border-radius:50%;background:#007069;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">
                  {{ (user.name || '?')[0] }}
                </div>
                <div style="line-height:1.3;">
                  <div style="font-size:13px;font-weight:600;color:#1e293b;">{{ user.name || '未登录' }}</div>
                  <div style="font-size:11px;color:#64748b;">{{ roleName }}</div>
                </div>
                <i class="el-icon-arrow-down" style="font-size:11px;color:#94a3b8;"></i>
              </div>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item disabled>
                  <span style="font-size:12px;color:#64748b;">当前角色：{{ roleName }}</span>
                </el-dropdown-item>
                <el-dropdown-item divided @click.native="$router.push('/login')">
                  <i class="el-icon-switch-button"></i> 切换角色
                </el-dropdown-item>
                <el-dropdown-item :disabled="resetDevLoading" @click.native="handleResetDev">
                  <i class="el-icon-refresh-left" style="color:#f59e0b;"></i>
                  <span style="color:#b45309;">重置为初始状态（开发）</span>
                </el-dropdown-item>
                <el-dropdown-item @click.native="handleLogout">
                  <i class="el-icon-right" style="color:#ef4444;"></i>
                  <span style="color:#ef4444;">退出登录</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </div>

          <div class="app-content" :class="{'no-padding': activePath === '/editor' || (activePath === '/approval' && approvalOnlyNav)}">
            <router-view></router-view>
          </div>
        </div>
      </div>
    `
  };
})(window);
