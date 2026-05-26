/**
 * AdminSettings.js — 管理员设置
 * 时间节点配置 + 锁定控制 + 板块管理员配置 + 初始数据导入
 */
(function (window) {
  'use strict';

  window.AdminSettingsView = {
    name: 'AdminSettings',
    data() {
      return {
        periodForm: null,
        lockLoading: false,
        importLoading: false,
        importResult: null,
        importFile: null,
        sectorAdmins: {},
        userSaving: false,
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
      auditCount()    { return Store.auditLog.length; },
      sectorOptions() {
        return (Store.sectorRegistry || []).map(function (code) {
          return { value: code, label: (Store.sectorNames && Store.sectorNames[code]) || code };
        });
      },
      sectorAdminRows() {
        const config = this.sectorAdmins || {};
        return this.sectorOptions.map(function (o) {
          const cfg = config[o.value] || {};
          return {
            code: o.value,
            label: o.label,
            adminName: cfg.adminName || '',
            adminUserId: cfg.adminUserId || '',
            skipDirectorApproval: cfg.skipDirectorApproval === true
          };
        });
      }
    },
    created() {
      this.periodForm = Object.assign({}, Store.periodConfig);
      this.syncUsersFromStore();
    },
    watch: {
      'store.sectorRegistry': function () { this.syncUsersFromStore(); },
      'store.sectorAdmins': function () { this.syncUsersFromStore(); }
    },
    methods: {
      syncUsersFromStore() {
        this.sectorAdmins = JSON.parse(JSON.stringify(Store.sectorAdmins || {}));
      },
      updateSectorAdmin(code, patch) {
        const current = Object.assign({}, this.sectorAdmins[code] || {});
        Vue.set(this.sectorAdmins, code, Object.assign(current, patch || {}));
      },
      persistUsersConfig() {
        if (!this.isAdmin) return;
        this.userSaving = true;
        Store.saveUsersConfig({
          sectorAdmins: this.sectorAdmins,
          user: this.user
        }).then(function () {
          this.$message.success('板块管理员配置已保存');
        }.bind(this)).catch(function (e) {
          this.$message.error('保存失败：' + (e.message || e));
        }.bind(this)).finally(function () {
          this.userSaving = false;
        }.bind(this));
      },
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
        this.$confirm('将从服务器项目根目录的「初始数据.xlsx」（或 S520 源表）重新导入，覆盖当前项目并清空审计日志；保留历史 I/D/J 快照，但对比基准将切换为新导入 I 版。确认？', '从初始 Excel 恢复', {
          confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'danger'
        }).then(() => {
          Store.reseedFromInit()
            .then(() => {
              this.periodForm = Object.assign({}, Store.periodConfig);
              const bv = Store.baselineVersion || '';
              this.$message.success('已从初始 Excel 恢复' + (bv ? '；baseline：' + bv : ''));
            })
            .catch(e => { this.$message.error('恢复失败：' + (e.message || e)); });
        }).catch(() => {});
      }
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
                  <span style="font-size:11px;color:#94a3b8;margin-left:8px;">次月第 N 日，开启自动解锁后生效</span>
                </el-form-item>
                <el-form-item label="自动解锁">
                  <el-switch
                    v-model="periodForm.autoUnlockEnabled"
                    active-text="开启"
                    inactive-text="关闭"
                  ></el-switch>
                  <div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.6;">
                    默认关闭。关闭时次月到达解禁日也不会自动开放，需系统管理员完成开放准备后手动「解除锁定」。
                  </div>
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
                <div style="font-size:11px;color:#94a3b8;margin-top:8px;line-height:1.6;">
                  恢复后会写入新的 <code>I:YYYYMMDD:ALL:NN</code> 导入快照并设为对比基准（保留历史 J/D 快照）。
                </div>
              </div>
            </div>

            <!-- 板块管理员配置 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-user" style="color:#007069;margin-right:6px;"></i>系统用户</div>
                <el-button size="mini" type="primary" plain :disabled="!isAdmin" :loading="userSaving" @click="persistUsersConfig">保存配置</el-button>
              </div>
              <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:12px;">
                上线后，项目经理、经营管理、板块总监、项目群群主等角色由平台全局权限自动带入；本系统只维护各项目执行板块的板块管理员。
                若某板块管理员同时具备该板块总监权限，则该板块提交审批后默认跳过总监初审，直接进入群主复审。
              </div>
              <el-table :data="sectorAdminRows" size="mini" border style="width:100%;">
                <el-table-column label="板块" prop="label" min-width="140"></el-table-column>
                <el-table-column label="板块管理员" min-width="160">
                  <template slot-scope="{row}">
                    <el-input
                      size="mini"
                      :disabled="!isAdmin"
                      :value="row.adminName"
                      placeholder="输入平台用户姓名"
                      @input="updateSectorAdmin(row.code, { adminName: $event })"
                    ></el-input>
                  </template>
                </el-table-column>
                <el-table-column label="平台用户ID（可选）" min-width="150">
                  <template slot-scope="{row}">
                    <el-input
                      size="mini"
                      :disabled="!isAdmin"
                      :value="row.adminUserId"
                      placeholder="上线后可由平台用户ID填充"
                      @input="updateSectorAdmin(row.code, { adminUserId: $event })"
                    ></el-input>
                  </template>
                </el-table-column>
                <el-table-column label="跳过总监初审" width="130">
                  <template slot-scope="{row}">
                    <el-switch
                      :disabled="!isAdmin"
                      :value="row.skipDirectorApproval"
                      @change="updateSectorAdmin(row.code, { skipDirectorApproval: $event })"
                    ></el-switch>
                  </template>
                </el-table-column>
              </el-table>
              <div style="font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.6;">
                项目群、经营管理范围、总监/群主等权限不在本系统维护，沿用平台原有组织与权限配置。
              </div>
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
