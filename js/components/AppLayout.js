/**
 * AppLayout.js — 主布局：侧边栏 + 顶栏 + 内容区
 */
(function (window) {
  'use strict';

  const ROLE_LABELS = {
    system_admin:     '系统管理员',
    finance:          '财务审核',
    sector_admin:     '板块管理员',
    pm:               '项目经理',
    sector_director:  '板块总监',
    group_leader:     '项目群群主'
  };

  const NAV_ITEMS = [
    { path: '/dashboard', icon: 'el-icon-s-home',        label: '数据看板'  },
    { path: '/editor',    icon: 'el-icon-s-grid',        label: '填报表格'  },
    { path: '/approval',  icon: 'el-icon-s-check',       label: '审批流程'  },
    { path: '/audit',     icon: 'el-icon-document',      label: '审计日志'  },
    { path: '/admin',     icon: 'el-icon-setting',       label: '管理设置', adminOnly: true }
  ];

  const LOCK_INFO = {
    open:         { text: '填报中',     type: 'open',         tip: '填报窗口已开放，可正常填报' },
    finance_only: { text: '财务专属期', type: 'finance-only', tip: '每月1-3日财务审核专属期' },
    locked:       { text: '已锁定',     type: 'locked',       tip: '数据已冻结，仅管理员可修改' }
  };

  window.AppLayoutComponent = {
    name: 'AppLayout',
    computed: {
      store()     { return window.Store; },
      user()      { return Store.currentUser || {}; },
      roleName()  { return ROLE_LABELS[this.user.role] || this.user.role || '—'; },
      navItems()  {
        return NAV_ITEMS.filter(item =>
          !item.adminOnly || this.user.role === 'system_admin'
        );
      },
      lockInfo()  { return LOCK_INFO[Store.lockStatus] || LOCK_INFO.open; },
      activePath(){ return this.$route ? this.$route.path : '/dashboard'; },
      pageTitle() {
        const item = NAV_ITEMS.find(n => this.activePath === n.path);
        return item ? item.label : '项目执行跟踪平台';
      },
      approvalBadge() {
        const map = {
          draft:    { text: '草稿',   color: '#94a3b8' },
          approve1: { text: '初审中', color: '#f59e0b' },
          approve2: { text: '复审中', color: '#3b82f6' },
          final:    { text: '已归档', color: '#10b981' }
        };
        return map[Store.approvalStatus] || map.draft;
      },
      reportingMonth() { return Store.reportingMonth; }
    },
    methods: {
      goTo(path) { if (this.$route.path !== path) this.$router.push(path); },
      handleLogout() {
        this.$confirm('确认退出当前账号？', '提示', {
          confirmButtonText: '退出', cancelButtonText: '取消', type: 'warning'
        }).then(() => {
          Store.logout();
          this.$router.push('/login');
        }).catch(() => {});
      }
    },
    template: `
      <div class="app-layout">
        <!-- 侧边栏 -->
        <div class="app-sidebar">
          <div class="sidebar-logo">
            <div class="sidebar-logo-text">
              项目执行<br><span>跟踪平台</span>
            </div>
          </div>
          <div class="sidebar-nav">
            <el-menu :default-active="activePath" background-color="transparent" text-color="rgba(255,255,255,0.65)">
              <el-menu-item
                v-for="item in navItems"
                :key="item.path"
                :index="item.path"
                @click="goTo(item.path)"
              >
                <i :class="item.icon"></i>
                <span>{{ item.label }}</span>
              </el-menu-item>
            </el-menu>
          </div>
          <div class="sidebar-footer">
            <div style="color:rgba(255,255,255,0.35);font-size:11px;margin-bottom:6px;">
              报告月份：{{ reportingMonth }}
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span
                class="period-banner"
                :class="lockInfo.type"
                style="font-size:11px;padding:3px 8px;"
                :title="lockInfo.tip"
              >
                <span class="period-dot"></span>
                {{ lockInfo.text }}
              </span>
            </div>
          </div>
        </div>

        <!-- 主内容区 -->
        <div class="app-main">
          <!-- 顶栏 -->
          <div class="app-header">
            <div class="app-header-title">{{ pageTitle }}</div>

            <!-- 审批状态 -->
            <el-tag
              size="small"
              :style="{background: approvalBadge.color + '22', color: approvalBadge.color, border: '1px solid ' + approvalBadge.color + '66'}"
            >
              审批：{{ approvalBadge.text }}
            </el-tag>

            <!-- 分隔 -->
            <div style="width:1px;height:20px;background:#e2e8f0;margin:0 4px;"></div>

            <!-- 用户信息 -->
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
                <el-dropdown-item @click.native="handleLogout">
                  <i class="el-icon-right" style="color:#ef4444;"></i>
                  <span style="color:#ef4444;">退出登录</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </div>

          <!-- 路由视图 -->
          <div class="app-content" :class="{'no-padding': activePath === '/editor'}">
            <router-view></router-view>
          </div>
        </div>
      </div>
    `
  };
})(window);
