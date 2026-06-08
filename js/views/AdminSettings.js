/**
 * AdminSettings.js — 管理员设置
 * 时间节点配置 + 锁定控制 + 审批人员配置 + 初始数据导入
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
        sectorReviewers: {},
        groupReviewers: {},
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
      projectCount()  { return Store.projects.length; },
      auditCount()    { return Store.auditLog.length; },
      sectorOptions() {
        return (Store.sectorRegistry || []).map(function (code) {
          return { value: code, label: (Store.sectorNames && Store.sectorNames[code]) || code };
        });
      },
      platformUserOptions() {
        const seen = {};
        return (Store.users || []).filter(function (u) {
          return u && u.status !== 'disabled' && (u.id || u.name);
        }).map(function (u) {
          const id = u.id || u.name;
          if (seen[id]) return null;
          seen[id] = true;
          return {
            value: id,
            label: u.name || id,
            role: u.role || (Array.isArray(u.roles) ? u.roles.join(',') : ''),
            sector: u.sector || u.sectorCode || ''
          };
        }).filter(Boolean);
      },
      approvalStaffRows() {
        const adminCfg = this.sectorAdmins || {};
        const reviewerCfg = this.sectorReviewers || {};
        const groupCfg = this.groupReviewers || {};
        const registry = Store.groupRegistry || {};
        const self = this;
        return this.sectorOptions.map(function (o) {
          const sectorCode = o.value;
          const admin = adminCfg[sectorCode] || {};
          const reviewer = reviewerCfg[sectorCode] || {};
          const groupCode = self.resolveGroupCodeForSector(sectorCode);
          const group = groupCode ? (registry[groupCode] || {}) : null;
          const groupReviewer = groupCode ? (groupCfg[groupCode] || {}) : {};
          return {
            code: sectorCode,
            label: o.label,
            groupCode: groupCode,
            groupLabel: group ? (group.name || groupCode) : '',
            adminUserId: admin.adminUserId || '',
            sectorReviewerUserId: reviewer.reviewerUserId || '',
            groupReviewerUserId: groupReviewer.reviewerUserId || ''
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
      'store.sectorAdmins': function () { this.syncUsersFromStore(); },
      'store.sectorReviewers': function () { this.syncUsersFromStore(); },
      'store.groupReviewers': function () { this.syncUsersFromStore(); },
      'store.groupRegistry': function () { this.syncUsersFromStore(); }
    },
    methods: {
      syncUsersFromStore() {
        this.sectorAdmins = JSON.parse(JSON.stringify(Store.sectorAdmins || {}));
        this.sectorReviewers = JSON.parse(JSON.stringify(Store.sectorReviewers || {}));
        this.groupReviewers = JSON.parse(JSON.stringify(Store.groupReviewers || {}));
      },
      resolveGroupCodeForSector(sectorCode) {
        const registry = Store.groupRegistry || {};
        const code = String(sectorCode || '');
        const keys = Object.keys(registry);
        for (let i = 0; i < keys.length; i++) {
          const groupCode = keys[i];
          const sectors = (registry[groupCode] && registry[groupCode].sectors) || [];
          if (sectors.indexOf(code) >= 0) return groupCode;
        }
        return null;
      },
      updateSectorAdmin(code, patch) {
        const current = Object.assign({}, this.sectorAdmins[code] || {});
        Vue.set(this.sectorAdmins, code, Object.assign(current, patch || {}));
      },
      selectSectorAdmin(code, userId) {
        const hit = (Store.users || []).find(function (u) {
          return String(u.id || u.name || '') === String(userId || '');
        });
        this.updateSectorAdmin(code, {
          adminUserId: userId || '',
          adminName: hit ? (hit.name || '') : ''
        });
      },
      updateSectorReviewer(code, patch) {
        const current = Object.assign({}, this.sectorReviewers[code] || {});
        Vue.set(this.sectorReviewers, code, Object.assign(current, patch || {}));
      },
      selectSectorReviewer(code, userId) {
        const hit = (Store.users || []).find(function (u) {
          return String(u.id || u.name || '') === String(userId || '');
        });
        this.updateSectorReviewer(code, {
          reviewerUserId: userId || '',
          reviewerName: hit ? (hit.name || '') : ''
        });
      },
      updateGroupReviewer(code, patch) {
        const current = Object.assign({}, this.groupReviewers[code] || {});
        Vue.set(this.groupReviewers, code, Object.assign(current, patch || {}));
      },
      selectGroupReviewer(code, userId) {
        const hit = (Store.users || []).find(function (u) {
          return String(u.id || u.name || '') === String(userId || '');
        });
        this.updateGroupReviewer(code, {
          reviewerUserId: userId || '',
          reviewerName: hit ? (hit.name || '') : ''
        });
      },
      buildSectorAdminPayload() {
        const payload = {};
        Object.keys(this.sectorAdmins || {}).forEach(function (code) {
          const cfg = this.sectorAdmins[code] || {};
          payload[code] = {
            adminName: cfg.adminName || '',
            adminUserId: cfg.adminUserId || ''
          };
        }, this);
        return payload;
      },
      buildSectorReviewerPayload() {
        const payload = {};
        Object.keys(this.sectorReviewers || {}).forEach(function (code) {
          const cfg = this.sectorReviewers[code] || {};
          payload[code] = {
            reviewerName: cfg.reviewerName || '',
            reviewerUserId: cfg.reviewerUserId || ''
          };
        }, this);
        return payload;
      },
      buildGroupReviewerPayload() {
        const payload = {};
        Object.keys(this.groupReviewers || {}).forEach(function (code) {
          const cfg = this.groupReviewers[code] || {};
          payload[code] = {
            reviewerName: cfg.reviewerName || '',
            reviewerUserId: cfg.reviewerUserId || ''
          };
        }, this);
        return payload;
      },
      persistUsersConfig() {
        if (!this.isAdmin) return;
        this.userSaving = true;
        Store.saveUsersConfig({
          sectorAdmins: this.buildSectorAdminPayload(),
          sectorReviewers: this.buildSectorReviewerPayload(),
          groupReviewers: this.buildGroupReviewerPayload(),
          user: this.user
        }).then(function () {
          this.$message.success('审批人员配置已保存');
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
      handleLock() {},
      handleUnlock() {},
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
                <el-form-item>
                  <el-button type="primary" size="small" style="background:#007069;border-color:#007069;" :disabled="!isAdmin" @click="savePeriodConfig">
                    保存配置
                  </el-button>
                </el-form-item>
              </el-form>
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

            <!-- 审批人员配置 -->
            <div class="card">
              <div class="card-header">
                <div class="card-title"><i class="el-icon-user" style="color:#007069;margin-right:6px;"></i>审批人员配置</div>
                <el-button size="mini" type="primary" plain :disabled="!isAdmin" :loading="userSaving" @click="persistUsersConfig">保存配置</el-button>
              </div>
              <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:12px;">
                项目经理等填报角色由平台全局权限自动带入。本系统按板块维护审批链路三类负责人。
                板块审批、项目群审批未单独配置时默认取自平台组织关系，也可指定其他管理人员承接审批职责。
              </div>
              <el-table :data="approvalStaffRows" size="mini" border style="width:100%;">
                <el-table-column label="板块" prop="label" min-width="110" fixed></el-table-column>
                <el-table-column label="板块管理员" min-width="180">
                  <template slot-scope="{row}">
                    <el-select
                      size="mini"
                      filterable
                      clearable
                      style="width:100%;"
                      :disabled="!isAdmin"
                      :value="row.adminUserId"
                      placeholder="请选择平台用户"
                      @change="selectSectorAdmin(row.code, $event)"
                    >
                      <el-option
                        v-for="u in platformUserOptions"
                        :key="'sa-' + row.code + '-' + u.value"
                        :label="u.label"
                        :value="u.value"
                      >
                        <span>{{ u.label }}</span>
                        <span style="float:right;color:#94a3b8;font-size:12px;">{{ u.role }} {{ u.sector }}</span>
                      </el-option>
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="板块审批" min-width="180">
                  <template slot-scope="{row}">
                    <el-select
                      size="mini"
                      filterable
                      clearable
                      style="width:100%;"
                      :disabled="!isAdmin"
                      :value="row.sectorReviewerUserId"
                      placeholder="默认取自平台组织关系"
                      @change="selectSectorReviewer(row.code, $event)"
                    >
                      <el-option
                        v-for="u in platformUserOptions"
                        :key="'sr-' + row.code + '-' + u.value"
                        :label="u.label"
                        :value="u.value"
                      >
                        <span>{{ u.label }}</span>
                        <span style="float:right;color:#94a3b8;font-size:12px;">{{ u.role }} {{ u.sector }}</span>
                      </el-option>
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="项目群审批" min-width="180">
                  <template slot-scope="{row}">
                    <el-select
                      v-if="row.groupCode"
                      size="mini"
                      filterable
                      clearable
                      style="width:100%;"
                      :disabled="!isAdmin"
                      :value="row.groupReviewerUserId"
                      :placeholder="row.groupLabel ? ('默认取自 ' + row.groupLabel) : '默认取自平台组织关系'"
                      @change="selectGroupReviewer(row.groupCode, $event)"
                    >
                      <el-option
                        v-for="u in platformUserOptions"
                        :key="'gr-' + row.groupCode + '-' + u.value"
                        :label="u.label"
                        :value="u.value"
                      >
                        <span>{{ u.label }}</span>
                        <span style="float:right;color:#94a3b8;font-size:12px;">{{ u.role }} {{ u.sector }}</span>
                      </el-option>
                    </el-select>
                    <span v-else style="font-size:12px;color:#cbd5e1;">—</span>
                  </template>
                </el-table-column>
              </el-table>
              <div style="font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.6;">
                同一项目群下辖多个板块时，项目群审批列共享同一配置。清空选择表示沿用平台组织关系中的默认审批人。
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
