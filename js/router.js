/**
 * router.js — Vue Router 路由配置 + 导航守卫
 */
(function (window) {
  'use strict';

  const routes = [
    // 登录页（不需要认证）
    {
      path: '/login',
      component: window.LoginView,
      meta: { public: true }
    },
    // 主布局（含侧边栏+顶栏）
    {
      path: '/',
      component: window.AppLayoutComponent,
      meta: { requiresAuth: true },
      children: [
        { path: '',        redirect: '/dashboard' },
        {
          path: 'dashboard',
          component: window.DashboardView,
          meta: { requiresAuth: true, title: '数据看板' }
        },
        {
          path: 'editor',
          component: window.ProjectEditorView,
          meta: { requiresAuth: true, title: '填报表格' }
        },
        {
          path: 'approval',
          component: window.ApprovalView,
          meta: { requiresAuth: true, title: '审批流程' }
        },
        {
          path: 'audit',
          component: window.AuditLogView,
          meta: { requiresAuth: true, title: '审计日志' }
        },
        {
          path: 'admin',
          component: window.AdminSettingsView,
          meta: { requiresAuth: true, title: '管理设置' }
        }
      ]
    },
    // 兜底重定向
    { path: '*', redirect: '/dashboard' }
  ];

  const router = new VueRouter({
    mode: 'hash',
    routes,
    scrollBehavior() { return { x: 0, y: 0 }; }
  });

  // ── 导航守卫 ────────────────────────────────────────────
  router.beforeEach((to, from, next) => {
    // 公开页面直接放行
    if (to.meta.public) { next(); return; }

    // 需要认证但未登录
    if (to.meta.requiresAuth && !Store.currentUser) {
      next('/login');
      return;
    }

    // admin 路由仅系统管理员可访问
    if (to.path === '/admin' && Store.currentUser && Store.currentUser.role !== 'system_admin') {
      if (window.ELEMENT && ELEMENT.Message) ELEMENT.Message.warning('权限不足，已重定向至数据看板');
      next('/dashboard');
      return;
    }

    // 项目经理仅允许访问看板和填报
    const pmRestrictedPaths = ['/approval', '/audit', '/admin'];
    if (Store.currentUser && Store.currentUser.role === 'pm' && pmRestrictedPaths.includes(to.path)) {
      next('/dashboard');
      return;
    }

    // 板块总监 / 项目群群主：仅数据看板与审批流程
    const approvalOnlyRoles = ['sector_director', 'group_leader'];
    const approvalOnlyRestricted = ['/editor', '/audit', '/admin'];
    if (
      Store.currentUser &&
      approvalOnlyRoles.includes(Store.currentUser.role) &&
      approvalOnlyRestricted.includes(to.path)
    ) {
      next('/dashboard');
      return;
    }

    next();
  });

  window.AppRouter = router;
})(window);
