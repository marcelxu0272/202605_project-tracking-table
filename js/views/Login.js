/**
 * Login.js — 角色卡片选择登录页
 */
(function (window) {
  'use strict';

  const ROLES = [
    {
      id: 'system_admin',
      name: '系统管理员',
      icon: 'el-icon-s-tools',
      users: ['管理员 Admin', '系统运维'],
      desc: '全字段编辑 · 锁定/解锁 · 用户管理',
      color: '#007069'
    },
    {
      id: 'finance',
      name: '财务审核',
      icon: 'el-icon-s-finance',
      users: ['财务总监 张颖', '财务专员 李华'],
      desc: '每月1-3日 · 开票/回款校验',
      color: '#3b82f6'
    },
    {
      id: 'sector_admin',
      name: '板块管理员',
      icon: 'el-icon-s-management',
      users: ['运营总监 周明', '板块经理 赵敏'],
      desc: '板块数据汇总 · 异常处理',
      color: '#8b5cf6'
    },
    {
      id: 'pm',
      name: '项目经理',
      icon: 'el-icon-s-custom',
      users: ['何孝刚', '宋建生'],
      desc: '本项目产值/进度/WIP填报',
      color: '#f59e0b'
    },
    {
      id: 'sector_director',
      name: '板块总监',
      icon: 'el-icon-s-opportunity',
      users: ['板块总监 陈磊', '业务总监 刘艳'],
      desc: '查看数据 · 初审审批',
      color: '#10b981'
    },
    {
      id: 'group_leader',
      name: '项目群群主',
      icon: 'el-icon-s-flag',
      users: ['项目群主 王总', '执行总监 孙总'],
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
        selectedUser: null,
        step: 1  // 1=选角色, 2=选人员
      };
    },
    methods: {
      selectRole(role) {
        this.selectedRole = role;
        this.selectedUser = role.users[0];
        this.step = 2;
      },
      confirmLogin() {
        if (!this.selectedRole || !this.selectedUser) return;
        const user = {
          name: this.selectedUser,
          role: this.selectedRole.id,
          sector: 'S520'
        };
        // 项目经理：name 即 pmName（与数据库 pm_name 字段一致）
        if (this.selectedRole.id === 'pm') {
          user.pmName = this.selectedUser;
        }
        Store.login(user);
        this.$router.push('/dashboard');
      },
      backToRoles() {
        this.step = 1;
        this.selectedRole = null;
      }
    },
    template: `
      <div class="login-page">
        <!-- Logo -->
        <div style="margin-bottom:8px;">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(0,112,105,0.8);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;color:#fff;font-weight:700;">
            P
          </div>
        </div>
        <div class="login-title">项目执行跟踪平台</div>
        <div class="login-subtitle">Project Execution Tracking System · S520 金山中心</div>

        <!-- 步骤1：选角色 -->
        <transition name="el-fade-in" v-if="step === 1">
          <div>
            <div style="color:rgba(255,255,255,0.45);font-size:13px;text-align:center;margin-bottom:24px;">
              请选择您的角色身份进入系统
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

        <!-- 步骤2：选人员 -->
        <transition name="el-fade-in" v-if="step === 2">
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
              v-model="selectedUser"
              placeholder="请选择用户"
              style="width:100%;margin-bottom:16px;"
              popper-class="login-select-dropdown"
            >
              <el-option
                v-for="u in selectedRole.users"
                :key="u"
                :label="u"
                :value="u"
              ></el-option>
            </el-select>

            <el-button
              type="primary"
              style="width:100%;background:#007069;border-color:#007069;font-size:14px;height:40px;"
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

        <!-- 底部版权 -->
        <div style="position:fixed;bottom:20px;color:rgba(255,255,255,0.2);font-size:11px;">
          项目执行跟踪平台 v1.0 · 内部使用
        </div>
      </div>
    `
  };
})(window);
