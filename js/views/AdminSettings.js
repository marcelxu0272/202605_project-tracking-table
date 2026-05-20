/**
 * AdminSettings.js — 管理员设置
 * 时间节点配置 + 锁定控制 + 用户管理 + 初始数据导入
 */
(function (window) {
  'use strict';

  const DEMO_USERS = [
    { name: '管理员 Admin',   role: 'system_admin',    sector: '—',   status: '在线' },
    { name: '财务总监 张颖',   role: 'finance',         sector: '财务部', status: '在线' },
    { name: '运营总监 周明',   role: 'sector_admin',    sector: 'S520', status: '在线' },
    { name: '何孝刚',         role: 'pm',              sector: 'S520', status: '在线' },
    { name: '宋建生',         role: 'pm',              sector: 'S520', status: '在线' },
    { name: '板块总监 陈磊',   role: 'sector_director', sector: 'S52X', status: '在线' },
    { name: '项目群主 王总',   role: 'group_leader',    sector: '—',   status: '在线' }
  ];

  const ROLE_LABELS = {
    system_admin: '系统管理员', finance: '财务审核', sector_admin: '板块管理员',
    pm: '项目经理', sector_director: '板块总监', group_leader: '项目群群主'
  };

  window.AdminSettingsView = {
    name: 'AdminSettings',
    data() {
      return {
        periodForm: null,
        lockLoading: false,
        importLoading: false,
        importResult: null,
        importFile: null,
        priorMonthSeedLoading: false,
        users: DEMO_USERS,
        activeSection: 'period',
        resetConfirmVisible: false
      };
    },
    computed: {
      store()         { return window.Store; },
      user()          { return Store.currentUser || {}; },
      isAdmin()       { return this.user.role === 'system_admin'; },
      lockStatus()    { return Store.lockStatus; },
      lockLabel()     { return { open: '填报中', locked: '已锁定' }[this.lockStatus] || '—'; },
      lockTagType()   { return { open: 'success', locked: 'danger' }[this.lockStatus] || 'info'; },
      projectCount()  { return Store.projects.length; },
      auditCount()    { return Store.auditLog.length; }
    },
    created() {
      this.periodForm = Object.assign({}, Store.periodConfig);
    },
    methods: {
      savePeriodConfig() {
        if (!this.isAdmin) { this.$message.error('仅管理员可修改配置'); return; }
        this.$confirm('保存后将立即生效，确认？', '保存配置', {
          confirmButtonText: '确认保存', cancelButtonText: '取消', type: 'info'
        }).then(() => {
          const prev = JSON.stringify(Object.assign({}, Store.periodConfig));
          Store.savePeriodConfig(this.periodForm)
            .then(() => {
              this.$message.success('配置已保存');
              return Store.addAuditLog({
                projectNo: '—', projectName: '系统配置',
                fieldName: 'periodConfig', fieldCN: '填报周期配置',
                oldVal: prev,
                newVal: JSON.stringify(this.periodForm),
                userId: this.user.role, userName: this.user.name
              });
            })
            .catch(e => { this.$message.error('保存失败：' + (e.message || e)); });
        }).catch(() => {});
      },
      handleLock() {
        if (!this.isAdmin) { this.$message.error('仅管理员可操作'); return; }
        this.$confirm('立即锁定数据？除管理员外所有人将无法编辑。', '锁定确认', {
          confirmButtonText: '确认锁定', cancelButtonText: '取消', type: 'warning'
        }).then(() => {
          this.lockLoading = true;
          Store.setLockStatus('locked')
            .then(() => Store.addAuditLog({
              projectNo: '—', projectName: '系统操作',
              fieldName: 'lockStatus', fieldCN: '锁定状态',
              oldVal: 'open', newVal: 'locked',
              userId: this.user.role, userName: this.user.name
            }))
            .then(() => { this.$message.success('数据已手动锁定'); })
            .catch(e => { this.$message.error('操作失败：' + (e.message || e)); })
            .finally(() => { this.lockLoading = false; });
        }).catch(() => {});
      },
      handleUnlock() {
        if (!this.isAdmin) { this.$message.error('仅管理员可操作'); return; }
        this.$confirm('解锁后填报人员可重新编辑，确认？', '解锁确认', {
          confirmButtonText: '确认解锁', cancelButtonText: '取消', type: 'info'
        }).then(() => {
          this.lockLoading = true;
          Store.setLockStatus('open')
            .then(() => Store.addAuditLog({
              projectNo: '—', projectName: '系统操作',
              fieldName: 'lockStatus', fieldCN: '锁定状态',
              oldVal: 'locked', newVal: 'open',
              userId: this.user.role, userName: this.user.name
            }))
            .then(() => { this.$message.success('数据已解锁，填报窗口重新开放'); })
            .catch(e => { this.$message.error('操作失败：' + (e.message || e)); })
            .finally(() => { this.lockLoading = false; });
        }).catch(() => {});
      },
      onFileChange(e) {
        this.importFile = e.target.files[0];
        this.importResult = null;
      },
      handleImport() {
        if (!this.importFile) { this.$message.warning('请先选择文件'); return; }
        if (!this.isAdmin && this.user.role !== 'sector_admin') {
          this.$message.error('仅管理员或板块管理员可导入数据'); return;
        }
        this.$confirm(
          `即将导入"${this.importFile.name}"，这将覆盖当前所有项目数据（现有 ${this.projectCount} 条）。确认继续？`,
          '数据导入确认',
          { confirmButtonText: '确认导入', cancelButtonText: '取消', type: 'warning' }
        ).then(() => {
          this.importLoading = true;
          XlsxImporter.importFromFile(this.importFile)
            .then(({ projects, skipped, errors }) => {
              if (projects.length === 0) {
                this.$message.error('未识别到有效数据，请检查文件格式');
                this.importLoading = false;
                return;
              }
              const prevCount = this.projectCount;
              return Store.replaceProjects(projects)
                .then(() => Store.addAuditLog({
                  projectNo: '—', projectName: '数据导入',
                  fieldName: 'import', fieldCN: '批量导入',
                  oldVal: prevCount + ' 条',
                  newVal: projects.length + ' 条',
                  userId: this.user.role, userName: this.user.name
                }))
                .then(() => {
                  this.importResult = { success: projects.length, skipped: skipped.length, errors: errors.length, file: this.importFile.name };
                  this.$message.success('成功导入 ' + projects.length + ' 条项目数据');
                });
            })
            .catch(err => {
              this.$message.error('导入失败：' + err.message);
            })
            .finally(() => { this.importLoading = false; });
        }).catch(() => {});
      },
      handleReseedFromXlsx() {
        this.$confirm('将从服务器项目根目录的「初始数据.xlsx」（或 S520 源表）重新导入，覆盖当前项目并清空审计日志与快照，确认？', '从初始 Excel 恢复', {
          confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'danger'
        }).then(() => {
          Store.reseedFromInit()
            .then(() => {
              this.periodForm = Object.assign({}, Store.periodConfig);
              this.$message.success('已从初始 Excel 恢复数据库');
            })
            .catch(e => { this.$message.error('恢复失败：' + (e.message || e)); });
        }).catch(() => {});
      },
      handleSeedPriorMonthSnapshot() {
        const self = this;
        this.$confirm(
          '将基于当前库项目生成「上一报告月」归档快照（默认剔除 5 条项目）。' +
          '填报页将把不在该快照中的项目标为「本月新增」。确认？',
          '生成上月对比快照',
          { confirmButtonText: '确认生成', cancelButtonText: '取消', type: 'info' }
        ).then(function () {
          self.priorMonthSeedLoading = true;
          Store.seedPriorMonthSnapshot(5)
            .then(function (d) {
              const msg = d
                ? '已生成 ' + (d.version || '') + '：上月 ' + d.projectCount + ' 条，' +
                  '本月新增标记约 ' + d.removedCount + ' 条'
                : '已生成上月对比快照';
              self.$message.success(msg);
            })
            .catch(function (e) {
              self.$message.error('生成失败：' + (e.message || e));
            })
            .finally(function () { self.priorMonthSeedLoading = false; });
        }).catch(function () {});
      },
      roleLabel(role) { return ROLE_LABELS[role] || role; }
    },
    template: `
      <div>
        <!-- 权限提示 -->
        <el-alert
          v-if="!isAdmin"
          title="仅系统管理员可修改设置"
          type="warning"
          description="当前账号非系统管理员角色，部分操作受限。请切换至管理员账号后操作。"
          show-icon
          style="margin-bottom:16px;"
        ></el-alert>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <!-- 左列 -->
          <div style="display:flex;flex-direction:column;gap:16px;">

            <!-- 填报期配置 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-time" style="color:#007069;margin-right:6px;"></i>填报周期配置</div>
              </div>
              <el-form v-if="periodForm" :model="periodForm" label-width="120px" size="small">
                <el-form-item label="报告月份">
                  <el-input v-model="periodForm.reportingMonth" placeholder="YYYY-MM" style="width:160px;">
                  </el-input>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">例：2026-05</span>
                </el-form-item>
                <el-form-item label="填报提醒日">
                  <el-input-number v-model="periodForm.reminderDay" :min="1" :max="28" style="width:100px;"></el-input-number>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">每月第 N 日系统发送提醒</span>
                </el-form-item>
                <el-form-item label="月度锁定日">
                  <el-input-number v-model="periodForm.lockDay" :min="1" :max="31" style="width:100px;"></el-input-number>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">每月第 N 日填报窗口关闭</span>
                </el-form-item>
                <el-form-item label="次月解禁日">
                  <el-input-number v-model="periodForm.unlockDay" :min="1" :max="15" style="width:100px;"></el-input-number>
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">次月第 N 日恢复可编辑</span>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" size="small" style="background:#007069;border-color:#007069;" :disabled="!isAdmin" @click="savePeriodConfig">
                    保存配置
                  </el-button>
                </el-form-item>
              </el-form>
            </div>

            <!-- 锁定控制 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-lock" style="color:#007069;margin-right:6px;"></i>数据锁定控制</div>
              </div>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <span style="font-size:13px;color:#64748b;">当前状态：</span>
                <el-tag :type="lockTagType" size="medium">{{ lockLabel }}</el-tag>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <el-button
                  size="small"
                  type="danger"
                  icon="el-icon-lock"
                  :loading="lockLoading"
                  :disabled="!isAdmin || lockStatus === 'locked'"
                  @click="handleLock"
                >立即锁定</el-button>
                <el-button
                  size="small"
                  type="success"
                  icon="el-icon-unlock"
                  :loading="lockLoading"
                  :disabled="!isAdmin || lockStatus === 'open'"
                  @click="handleUnlock"
                >解除锁定</el-button>
              </div>
              <div v-if="store.financeReviewReminder" style="margin-top:10px;font-size:12px;color:#b45309;line-height:1.6;">
                当前处于<strong>财务核查提醒期</strong>（报告月次月 1–3 日）：提醒财务核对开票/回款等数据；填报窗口仍按「填报中/已锁定」规则开放，财务角色始终只读。
              </div>
              <div style="margin-top:12px;font-size:12px;color:#94a3b8;line-height:1.8;">
                锁定后除管理员外所有人无法编辑，操作全程留痕。
              </div>
            </div>
          </div>

          <!-- 右列 -->
          <div style="display:flex;flex-direction:column;gap:16px;">
            <!-- 初始数据导入 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-upload2" style="color:#007069;margin-right:6px;"></i>初始数据导入</div>
              </div>
              <div style="font-size:12px;color:#64748b;margin-bottom:12px;line-height:1.7;">
                上传 <code style="background:#f1f5f9;padding:2px 5px;border-radius:3px;">初始数据.xlsx</code>，
                系统将自动解析83列字段并导入。<br>
                文件列顺序需与字段字典保持一致（A列=新旧项目 … CE列=12月回款）。
              </div>

              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  style="font-size:12px;flex:1;min-width:0;"
                  @change="onFileChange"
                >
                <el-button
                  type="primary"
                  size="small"
                  style="background:#007069;border-color:#007069;"
                  :loading="importLoading"
                  :disabled="!importFile"
                  @click="handleImport"
                >导入</el-button>
              </div>

              <!-- 导入结果 -->
              <el-alert
                v-if="importResult"
                :title="'导入完成：成功 ' + importResult.success + ' 条'"
                type="success"
                :description="'来源：' + importResult.file + ' | 跳过：' + importResult.skipped + ' 行 | 错误：' + importResult.errors + ' 行'"
                show-icon
                closable
                @close="importResult=null"
              ></el-alert>

              <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">
                <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">当前数据：{{ projectCount }} 条项目</div>
                <el-button size="mini" type="warning" plain icon="el-icon-refresh-left" @click="handleReseedFromXlsx">
                  从初始 Excel 恢复
                </el-button>
                <el-button
                  size="mini"
                  type="primary"
                  plain
                  icon="el-icon-document-copy"
                  :loading="priorMonthSeedLoading"
                  :disabled="!isAdmin || projectCount === 0"
                  style="margin-left:8px;"
                  @click="handleSeedPriorMonthSnapshot"
                >生成上月对比快照</el-button>
                <div style="font-size:11px;color:#94a3b8;margin-top:8px;line-height:1.6;">
                  报告月为 2026-05 时生成 <code>Month:2026-04</code>，用于填报页「新增项目」高亮演示。
                </div>
              </div>
            </div>

            <!-- 用户列表 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-user" style="color:#007069;margin-right:6px;"></i>系统用户</div>
                <el-tag size="mini">{{ users.length }} 人</el-tag>
              </div>
              <el-table :data="users" size="mini" border style="width:100%;">
                <el-table-column label="姓名" prop="name" min-width="110"></el-table-column>
                <el-table-column label="角色" width="100">
                  <template slot-scope="{row}">
                    <span style="font-size:11px;">{{ roleLabel(row.role) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="板块" prop="sector" width="70"></el-table-column>
                <el-table-column label="状态" width="60">
                  <template slot-scope="{row}">
                    <el-tag :type="row.status==='在线'?'success':'info'" size="mini">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </div>

        <!-- 系统信息 -->
        <div class="card" style="margin-top:16px;">
          <div class="card-title" style="margin-bottom:12px;"><i class="el-icon-info" style="color:#007069;margin-right:6px;"></i>系统信息</div>
          <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px;color:#64748b;">
            <span>项目数据：{{ projectCount }} 条</span>
            <span>审计日志：{{ auditCount }} 条</span>
            <span>版本快照：{{ Object.keys(store.snapshots).length }} 个</span>
            <span>报告月份：{{ store.reportingMonth }}</span>
            <span>数据存储：SQLite（<code style="background:#f1f5f9;padding:2px 5px;border-radius:3px">data/ptrack.sqlite</code>），通过 <code style="background:#f1f5f9;padding:2px 5px;border-radius:3px">npm start</code> 启动服务</span>
          </div>
        </div>
      </div>
    `
  };
})(window);
