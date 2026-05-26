/**
 * router.js — Vue Router 路由配置 + 导航守卫
 */
(function (window) {
  'use strict';

  function homePathForRole(role) {
    if (role === 'sector_director' || role === 'group_leader') return '/approval';
    return '/editor';
  }

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
        {
          path: '',
          redirect: function () {
            const u = Store.currentUser;
            if (!u) return '/login';
            return homePathForRole(u.role);
          }
        },
        {
          path: 'editor',
          component: window.ProjectEditorView,
          meta: { requiresAuth: true, title: '项目追踪表' }
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
          path: 'fields',
          component: window.FieldManagerView,
          meta: { requiresAuth: true, title: '表头配置' }
        },
        {
          path: 'admin',
          component: window.AdminSettingsView,
          meta: { requiresAuth: true, title: '管理设置' }
        }
      ]
    },
    // 兜底重定向
    {
      path: '*',
      redirect: function () {
        const u = Store.currentUser;
        if (!u) return '/login';
        return homePathForRole(u.role);
      }
    }
  ];

  const router = new VueRouter({
    mode: 'hash',
    routes,
    scrollBehavior() { return { x: 0, y: 0 }; }
  });

  function denyAccess(next, role) {
    if (window.ELEMENT && ELEMENT.Message) {
      ELEMENT.Message.warning('权限不足，已返回首页');
    }
    next(homePathForRole(role));
  }

  // ── 导航守卫 ────────────────────────────────────────────
  router.beforeEach((to, from, next) => {
    // 公开页面直接放行
    if (to.meta.public) { next(); return; }

    // 需要认证但未登录
    if (to.meta.requiresAuth && !Store.currentUser) {
      next('/login');
      return;
    }

    const role = Store.currentUser && Store.currentUser.role;

    // admin / 字段字典 路由仅系统管理员可访问
    if ((to.path === '/admin' || to.path === '/fields') && role !== 'system_admin') {
      denyAccess(next, role);
      return;
    }

    // 审计日志仅系统管理员
    if (to.path === '/audit' && role !== 'system_admin') {
      denyAccess(next, role);
      return;
    }

    // 项目经理仅允许访问填报
    const pmRestrictedPaths = ['/approval', '/audit', '/admin', '/fields'];
    if (role === 'pm' && pmRestrictedPaths.includes(to.path)) {
      denyAccess(next, role);
      return;
    }

    // 经营管理（只读）：填报，无审批/审计/管理
    const execRestrictedPaths = ['/approval', '/audit', '/admin', '/fields'];
    if (role === 'executive_viewer' && execRestrictedPaths.includes(to.path)) {
      denyAccess(next, role);
      return;
    }

    // 板块总监 / 项目群群主：仅审批流程
    const approvalOnlyRoles = ['sector_director', 'group_leader'];
    const approvalOnlyRestricted = ['/editor', '/audit', '/admin', '/fields'];
    if (approvalOnlyRoles.includes(role) && approvalOnlyRestricted.includes(to.path)) {
      denyAccess(next, role);
      return;
    }

    next();
  });

  window.AppRouter = router;
  window.AppHomePath = homePathForRole;
})(window);
