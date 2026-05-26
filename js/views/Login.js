/**
 * Login.js — 原型演示登录页；上线后由平台统一鉴权并带入角色权限
 */
(function (window) {
  'use strict';

  const ROLES = [
    {
      id: 'system_admin',
      name: '系统管理员',
      icon: 'el-icon-s-tools',
      desc: '全字段编辑 · 锁定/解锁 · 系统配置',
      color: '#007069'
    },
    {
      id: 'executive_viewer',
      name: '经营管理（只读）',
      icon: 'el-icon-view',
      desc: '按公司/板块/群查看汇总 · 无审批',
      color: '#3b82f6'
    },
    {
      id: 'sector_admin',
      name: '板块管理员',
      icon: 'el-icon-s-management',
      desc: '板块数据汇总 · 异常处理',
      color: '#8b5cf6'
    },
    {
      id: 'pm',
      name: '项目经理',
      icon: 'el-icon-s-custom',
      desc: '本项目产值/进度/WIP填报',
      color: '#f59e0b'
    },
    {
      id: 'sector_director',
      name: '板块总监',
      icon: 'el-icon-s-opportunity',
      desc: '查看数据 · 初审审批',
      color: '#10b981'
    },
    {
      id: 'group_leader',
      name: '项目群群主',
      icon: 'el-icon-s-flag',
      desc: '跨板块审核 · 终审确认',
      color: '#ef4444'
    }
  ];

  window.LoginView = {
    name: 'Login',
    data() {
      return {
        roles: ROLES,
        selectedRole: null,
        selectedUserId: null,
        step: 1
      };
    },
    computed: {
      roleUsers() {
        if (!this.selectedRole) return [];
        const all = (Store.users && Store.users.length) ? Store.users : [];
        const active = all.filter(function (u) {
          return u.role === this.selectedRole.id && u.status !== 'inactive';
        }.bind(this));
        if (active.length) return active;
        return this.fallbackUsersForRole(this.selectedRole.id);
      },
      selectedUserRecord() {
        const self = this;
        return this.roleUsers.find(function (u) {
          return (u.id || u.name) === self.selectedUserId;
        }) || null;
      }
    },
    methods: {
      fallbackUsersForRole(roleId) {
        const map = {
          system_admin: [{ id: 'demo_admin', name: '管理员 Admin', role: 'system_admin', status: 'active' }],
          executive_viewer: [
            { id: 'demo_ev_c', name: '财务总监 张颖', role: 'executive_viewer', dataScope: 'company', status: 'active' },
            { id: 'demo_ev_s', name: '板块领导 李强', role: 'executive_viewer', dataScope: 'sector', sectorCode: 'SAS520', status: 'active' },
            { id: 'demo_ev_g', name: '群领导 孙总', role: 'executive_viewer', dataScope: 'group', groupCode: 'GRP_JS', status: 'active' }
          ],
          sector_admin: [{ id: 'demo_sa', name: '运营总监 周明', role: 'sector_admin', sector: 'S520', status: 'active' }],
          pm: [
            { id: 'demo_pm1', name: '何孝刚', role: 'pm', sector: 'S520', status: 'active' },
            { id: 'demo_pm2', name: '宋建生', role: 'pm', sector: 'S520', status: 'active' }
          ],
          sector_director: [{ id: 'demo_sd', name: '板块总监 陈磊', role: 'sector_director', sector: 'S520', status: 'active' }],
          group_leader: [{ id: 'demo_gl', name: '项目群主 王总', role: 'group_leader', status: 'active' }]
        };
        return map[roleId] || [];
      },
      userOptionLabel(u) {
        if (u.role === 'executive_viewer' && window.DataScope) {
          const scope = DataScope.getScopeLabel(u, Store.groupRegistry, Store.sectorNames);
          return u.name + (scope ? ' · ' + scope : '');
        }
        return u.name;
      },
      selectRole(role) {
        this.selectedRole = role;
        const users = this.roleUsers;
        this.selectedUserId = users.length ? (users[0].id || users[0].name) : null;
        this.step = 2;
      },
      confirmLogin() {
        if (!this.selectedRole || !this.selectedUserRecord) return;
        const rec = this.selectedUserRecord;
        const user = Object.assign({
          name: rec.name,
          role: rec.role,
          sector: rec.sector || 'S520'
        }, rec);
        if (rec.role === 'pm') user.pmName = rec.name;
        Store.login(user);
        const home = window.AppHomePath ? AppHomePath(rec.role) : '/editor';
        this.$router.push(home);
      },
      backToRoles() {
        this.step = 1;
        this.selectedRole = null;
        this.selectedUserId = null;
      }
    },
    template: `
      <div class="login-page">
        <div style="margin-bottom:8px;">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(0,112,105,0.8);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;color:#fff;font-weight:700;">
            P
          </div>
        </div>
        <div class="login-title">项目执行跟踪平台</div>
        <div class="login-subtitle">Project Execution Tracking System · S520 金山中心</div>

        <transition name="el-fade-in" v-if="step === 1">
          <div>
            <div style="color:rgba(255,255,255,0.45);font-size:13px;text-align:center;margin-bottom:24px;line-height:1.7;">
              原型演示：请选择身份进入系统<br>
              上线后将由平台统一登录与全局权限自动识别，无需在本系统切换角色
            </div>
            <div class="role-grid">
              <div
                v-for="role in roles"
                :key="role.id"
                class="role-card"
                @click="selectRole(role)"
              >
                <div class="role-icon" :style="{background: role.color}">
                  <i :class="role.icon"></i>
                </div>
                <div class="role-name">{{ role.name }}</div>
                <div class="role-desc">{{ role.desc }}</div>
              </div>
            </div>
          </div>
        </transition>

        <transition name="el-fade-in" v-if="step === 2 && selectedRole">
          <div style="width:320px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:28px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
              <div class="role-icon" :style="{background: selectedRole.color, width:'36px', height:'36px', borderRadius:'10px'}">
                <i :class="selectedRole.icon" style="font-size:16px;"></i>
              </div>
              <div>
                <div style="color:#fff;font-size:15px;font-weight:600;">{{ selectedRole.name }}</div>
                <div style="color:rgba(255,255,255,0.4);font-size:12px;">{{ selectedRole.desc }}</div>
              </div>
            </div>

            <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:10px;">选择用户</div>
            <el-select
              v-model="selectedUserId"
              placeholder="请选择用户"
              style="width:100%;margin-bottom:16px;"
              popper-class="login-select-dropdown"
            >
              <el-option
                v-for="u in roleUsers"
                :key="u.id || u.name"
                :label="userOptionLabel(u)"
                :value="u.id || u.name"
              ></el-option>
            </el-select>

            <el-button
              type="primary"
              style="width:100%;background:#007069;border-color:#007069;font-size:14px;height:40px;"
              :disabled="!selectedUserRecord"
              @click="confirmLogin"
            >
              进入系统
            </el-button>

            <div
              style="text-align:center;margin-top:14px;color:rgba(255,255,255,0.35);font-size:12px;cursor:pointer;"
              @click="backToRoles"
            >
              ← 返回选择其他角色
            </div>
          </div>
        </transition>

        <div style="position:fixed;bottom:20px;color:rgba(255,255,255,0.2);font-size:11px;">
          项目执行跟踪平台 v1.0 · 内部使用
        </div>
      </div>
    `
  };
})(window);
