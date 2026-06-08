/**
 * Approval.js — 审批流程页
 * 板块总监 / 项目群群主：时间轴 + Luckysheet（本板块全部项目、筛选、只读；需修改请驳回）
 * 其他角色：时间轴 + 版本快照；系统管理员无版本差异对比与各板块进度卡片
 */
(function (window) {
  'use strict';

  const FLOW = [
    {
      key: 'draft',
      label: 'Draft',
      title: '提交填报',
      desc: '板块管理员汇总各 PM 填报后提交，系统生成 Draft 草稿版快照',
      role: ['sector_admin'],
      action: '提交填报',
      icon: '1'
    },
    {
      key: 'approve1',
      label: 'Approve1',
      title: '板块总监初审',
      desc: '板块总监审核通过；若板块管理员同时为总监，则此节点自动跳过',
      role: ['sector_director'],
      action: '初审通过',
      icon: '2'
    },
    {
      key: 'approve2',
      label: 'Approve2',
      title: '项目群群主复审',
      desc: '项目群群主审核确认后，本板块审批完成',
      role: ['group_leader'],
      action: '复审通过',
      icon: '3'
    },
    {
      key: 'final',
      label: 'J版',
      title: '管理员确认归档',
      desc: '全部板块 Approve2 后，系统管理员执行公司归档 -> 生成全局 J版 快照（含全部项目）',
      role: ['system_admin'],
      action: '归档确认',
      icon: '4'
    }
  ];

  const FLOW_IDX = { draft: 0, approve1: 1, approve2: 2, final: 3 };

  const APPROVAL_REVIEW_ROLES = ['sector_director', 'group_leader'];

  window.ApprovalView = {
    name: 'Approval',
    components: {
      ApprovalReviewSheet: window.ApprovalReviewSheet,
      SystemAdminApprovalBoard: window.SystemAdminApprovalBoard
    },
    data() {
      return {
        flow: FLOW,
        diffDialogVisible: false,
        diffLeftVersion: null,
        diffRightVersion: null,
        diffResults: [],
        approveLoading: false,
        rejectLoading: false
      };
    },
    computed: {
      store()          { return window.Store; },
      user()           { return Store.currentUser || {}; },
      isApprovalReviewer() {
        return APPROVAL_REVIEW_ROLES.indexOf(this.user.role) >= 0;
      },
      isSystemAdmin() { return this.user.role === 'system_admin'; },
      reviewSector() {
        const raw = this.user.sector || 'S520';
        return window.SectorWorkflow
          ? SectorWorkflow.normalizeSectorCode(raw)
          : raw;
      },
      sectorFlow() { return Store.getSectorFlow(this.reviewSector); },
      currentStatus() {
        if (this.isSystemAdmin) {
          return Store.isCompanyArchived() ? 'final' : 'pending_archive';
        }
        return this.sectorFlow.approvalStatus || 'draft';
      },
      sectorReportingSubmitted() { return !!this.sectorFlow.reportingSubmitted; },
      currentIdx() {
        if (this.isSystemAdmin) return Store.isCompanyArchived() ? 3 : 2;
        return FLOW_IDX[this.currentStatus] || 0;
      },
      snapshots()      { return Store.snapshots; },
      snapshotList()   {
        const self = this;
        return Object.keys(this.snapshots)
          .filter(function (k) {
            if (window.BaselineDiff && BaselineDiff.isModernSnapshotKey(k)) {
              return BaselineDiff.isSnapshotVisibleToUser(k, self.user, self.reviewSector);
            }
            return /^D:/.test(k) || k === 'J版' || /^Draft:/.test(k);
          })
          .map(function (k) { return self.snapshots[k]; })
          .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
      },
      canApprove() {
        const role = this.user.role;
        if (role === 'system_admin') {
          return true;
        }
        const sf = this.sectorFlow;
        if (role === 'sector_director') {
          return sf.approvalStatus === 'draft' && sf.reportingSubmitted;
        }
        if (role === 'group_leader') {
          return sf.approvalStatus === 'approve1';
        }
        return false;
      },
      canReject() {
        const role = this.user.role;
        const sf = this.sectorFlow;
        if (role === 'sector_director') {
          return sf.reportingSubmitted && sf.approvalStatus === 'draft';
        }
        if (role === 'group_leader') return sf.approvalStatus === 'approve1';
        return false;
      },
      nextActionLabel() {
        if (this.user.role === 'system_admin') return '归档确认';
        if (this.user.role === 'sector_director') return '初审通过';
        if (this.user.role === 'group_leader') return '复审通过';
        return '';
      },
      versionOptions() {
        const self = this;
        return this.snapshotList.map(function (snap) {
          const k = snap.version || '';
          const label = snap.label || k;
          return { label: label, value: k };
        });
      },
      activeFlowIdx() {
        if (this.isSystemAdmin) {
          if (Store.isCompanyArchived()) return -1;
          return 3;
        }
        const s = this.currentStatus;
        if (s === 'approve2') return -1;
        if (s === 'approve1') return 2;
        if (s === 'draft') return this.sectorReportingSubmitted ? 1 : 0;
        return 0;
      }
    },
    methods: {
      nodeStatus(idx) {
        if (this.isSystemAdmin && idx === 3 && Store.isCompanyArchived()) return 'done';
        if (!this.isSystemAdmin && this.currentStatus === 'approve2' && idx <= 2) return 'done';
        const active = this.activeFlowIdx;
        if (active < 0) return 'done';
        if (idx < active) return 'done';
        if (idx === active) return 'current';
        return 'pending';
      },
      nodeStatusLabel(idx) {
        const s = this.nodeStatus(idx);
        if (s === 'done') return '已完成';
        if (s === 'current') return '进行中';
        return '未完成';
      },
      nodeStatusTagType(idx) {
        const s = this.nodeStatus(idx);
        if (s === 'done') return 'success';
        if (s === 'current') return 'warning';
        return 'info';
      },
      formatTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      },
      handleApprove() {
        this.$confirm(
          `确认执行「${this.nextActionLabel}」？此操作将推进审批流程${this.user.role === 'system_admin' ? '并生成 J 版快照' : ''}。`,
          '审批确认', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
        ).then(() => {
          this.approveLoading = true;
          const p = this.user.role === 'system_admin'
            ? Store.archiveCompany()
            : Store.advanceSectorApproval(this.reviewSector);
          p.then(() => {
              this.$message.success('审批操作已完成');
            })
            .catch(e => { this.$message.error('操作失败：' + (e.message || e)); })
            .finally(() => { this.approveLoading = false; });
        }).catch(() => {});
      },
      handleReject() {
        this.$prompt('请填写驳回原因（可选）', '驳回至板块管理员', {
          confirmButtonText: '确认驳回',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入驳回原因，板块管理员可修改后重新提交…'
        }).then(({ value }) => {
          this.rejectLoading = true;
          Store.rejectSectorApproval(this.reviewSector, value)
            .then(() => {
              if (value) {
                return Store.addAuditLog({
                  projectNo: '—',
                  projectName: '全局审批',
                  fieldName: 'reject_reason',
                  fieldCN: '驳回原因',
                  oldVal: '',
                  newVal: value,
                  userId: this.user.role,
                  userName: this.user.name
                });
              }
            })
            .then(() => {
              this.$message.warning('已驳回，流程已退回板块管理员，可修改后重新提交审批');
            })
            .catch(e => { this.$message.error('操作失败：' + (e.message || e)); })
            .finally(() => { this.rejectLoading = false; });
        }).catch(() => {});
      },
      openDiffDialog() {
        const opts = this.versionOptions;
        if (opts.length < 1) {
          this.$message.info('暂无可对比的快照版本');
          return;
        }
        this.diffLeftVersion  = opts[Math.max(0, opts.length - 2)].value;
        this.diffRightVersion = opts[opts.length - 1].value;
        this.computeDiff();
        this.diffDialogVisible = true;
      },
      computeDiff() {
        if (!this.diffLeftVersion || !this.diffRightVersion) return;
        const left  = (this.snapshots[this.diffLeftVersion]  || {}).projects || [];
        const right = (this.snapshots[this.diffRightVersion] || {}).projects || [];
        const fields = FieldConfig.buildFieldConfig();
        this.diffResults = DiffUtils.diffProjectSets(left, right, fields.slice(0, 40));
      }
    },
    template: `
      <div :class="isApprovalReviewer ? 'approval-reviewer-page' : ''" style="height:100%;">
        <!-- 板块总监 / 项目群群主：流程进度 + 本板块 Luckysheet -->
        <template v-if="isApprovalReviewer">
          <div class="approval-layout approval-reviewer-layout">
            <div>
            <div class="approval-timeline-card">
              <div class="card-title" style="margin-bottom:12px;">流程进度</div>
              <div class="timeline-status-legend">
                <span class="timeline-legend-item"><span class="timeline-dot done timeline-dot--legend"></span>已完成</span>
                <span class="timeline-legend-item"><span class="timeline-dot current timeline-dot--legend"></span>进行中</span>
                <span class="timeline-legend-item"><span class="timeline-dot pending timeline-dot--legend"></span>未完成</span>
              </div>
              <div class="timeline-node" v-for="(node, idx) in flow" :key="node.key">
                <div class="timeline-dot" :class="nodeStatus(idx)">
                  <span v-if="nodeStatus(idx) === 'done'"><i class="el-icon-check"></i></span>
                  <span v-else-if="nodeStatus(idx) === 'current'"><i class="el-icon-more"></i></span>
                  <span v-else>{{ node.icon }}</span>
                </div>
                <div class="timeline-content">
                  <div class="timeline-title-row">
                    <span class="timeline-title" :class="{ 'is-current': nodeStatus(idx) === 'current' }">{{ node.title }}</span>
                    <el-tag size="mini" :type="nodeStatusTagType(idx)">{{ nodeStatusLabel(idx) }}</el-tag>
                  </div>
                  <div class="timeline-sub">{{ node.desc }}</div>
                </div>
              </div>
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-wrap:wrap;">
                <el-button
                  v-if="canApprove"
                  type="primary"
                  size="small"
                  style="background:#007069;border-color:#007069;"
                  :loading="approveLoading"
                  @click="handleApprove"
                >
                  <i class="el-icon-check"></i> {{ nextActionLabel }}
                </el-button>
                <el-button
                  v-if="canReject"
                  type="danger"
                  size="small"
                  plain
                  :loading="rejectLoading"
                  @click="handleReject"
                >
                  <i class="el-icon-close"></i> 驳回
                </el-button>
                <div v-if="!canApprove && !canReject" style="font-size:12px;color:#94a3b8;padding:4px 0;">
                  <template v-if="currentStatus === 'draft' && !sectorReportingSubmitted">
                    等待本板块管理员提交审批
                  </template>
                  <template v-else-if="currentStatus === 'approve2'">
                    本板块已完成审批
                  </template>
                  <template v-else>
                    当前无待您处理的审批节点
                  </template>
                </div>
              </div>
            </div>
            </div>
            <approval-review-sheet></approval-review-sheet>
          </div>
        </template>

        <!-- 系统管理员：十二板块并行审批 -->
        <template v-else-if="isSystemAdmin">
          <system-admin-approval-board></system-admin-approval-board>
        </template>

        <!-- 其他角色：原时间轴 + 快照列表 + 版本对比 -->
        <template v-else>
          <div class="approval-layout" style="align-items:start;">
            <div>
              <div class="approval-timeline-card">
                <div class="card-title" style="margin-bottom:12px;">流程进度</div>
                <div class="timeline-status-legend">
                  <span class="timeline-legend-item"><span class="timeline-dot done timeline-dot--legend"></span>已完成</span>
                  <span class="timeline-legend-item"><span class="timeline-dot current timeline-dot--legend"></span>进行中</span>
                  <span class="timeline-legend-item"><span class="timeline-dot pending timeline-dot--legend"></span>未完成</span>
                </div>
                <div class="timeline-node" v-for="(node, idx) in flow" :key="node.key">
                  <div class="timeline-dot" :class="nodeStatus(idx)">
                    <span v-if="nodeStatus(idx) === 'done'"><i class="el-icon-check"></i></span>
                    <span v-else-if="nodeStatus(idx) === 'current'"><i class="el-icon-more"></i></span>
                  <span v-else>{{ node.icon }}</span>
                  </div>
                  <div class="timeline-content">
                    <div class="timeline-title-row">
                      <span class="timeline-title" :class="{ 'is-current': nodeStatus(idx) === 'current' }">{{ node.title }}</span>
                      <el-tag size="mini" :type="nodeStatusTagType(idx)">{{ nodeStatusLabel(idx) }}</el-tag>
                    </div>
                    <div class="timeline-sub">{{ node.desc }}</div>
                    <div v-if="node.key === 'final' && (store.latestJVersion || snapshots['J版'])" style="margin-top:6px;">
                      <el-tag size="mini" type="success">
                        {{ (snapshots[store.latestJVersion] || snapshots['J版'] || {}).user }} · {{ formatTime((snapshots[store.latestJVersion] || snapshots['J版'] || {}).time) }}
                      </el-tag>
                    </div>
                  </div>
                </div>

                <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-wrap:wrap;">
                  <el-button
                    v-if="canApprove"
                    type="primary"
                    size="small"
                    style="background:#007069;border-color:#007069;"
                    :loading="approveLoading"
                    @click="handleApprove"
                  >
                    <i class="el-icon-check"></i> {{ nextActionLabel }}
                  </el-button>
                  <el-button
                    v-if="canReject && !isSystemAdmin"
                    type="danger"
                    size="small"
                    plain
                    :loading="rejectLoading"
                    @click="handleReject"
                  >
                    <i class="el-icon-close"></i> 驳回
                  </el-button>
                  <div v-if="!canApprove && !canReject" style="font-size:12px;color:#94a3b8;padding:6px 0;">
                    <template v-if="isSystemAdmin && Store.isCompanyArchived()">
                      已完成公司归档
                    </template>
                    <template v-else>
                      当前角色无审批权限
                    </template>
                  </div>
                </div>
              </div>

              <el-button
                v-if="snapshotList.length >= 2 && !isSystemAdmin"
                style="margin-top:12px;width:100%;"
                size="small"
                icon="el-icon-view"
                @click="openDiffDialog"
              >版本差异对比</el-button>
            </div>

            <div>
              <div class="card" style="padding:20px;">
                <div class="card-header">
                  <div class="card-title">版本快照记录</div>
                  <el-tag size="mini">{{ snapshotList.length }} 个版本</el-tag>
                </div>

                <div v-if="snapshotList.length === 0" class="empty-state">
                  <i class="el-icon-document"></i>
                  <div>暂无快照版本</div>
                  <div style="font-size:12px;margin-top:4px;color:#94a3b8;">提交填报后将自动生成快照</div>
                </div>

                <el-timeline v-else style="padding:0;margin:0;">
                  <el-timeline-item
                    v-for="snap in snapshotList"
                    :key="snap.version"
                    :timestamp="formatTime(snap.time)"
                    placement="top"
                    size="large"
                    :color="snap.version === 'J版' ? '#007069' : (snap.version.startsWith('Approve') ? '#10b981' : '#94a3b8')"
                  >
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <el-tag
                        size="small"
                        :type="snap.version === 'J版' ? 'success' : (snap.version === 'Draft' ? 'info' : 'warning')"
                      >{{ snap.version }}</el-tag>
                      <span style="font-size:13px;">{{ snap.user }}</span>
                      <span style="font-size:12px;color:#94a3b8;">{{ snap.projects ? snap.projects.length + ' 条项目' : '' }}</span>
                    </div>
                  </el-timeline-item>
                </el-timeline>
              </div>
            </div>
          </div>

          <el-dialog
            title="版本差异对比"
            :visible.sync="diffDialogVisible"
            width="80%"
            :before-close="() => diffDialogVisible = false"
          >
            <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;">
              <span style="font-size:13px;color:#64748b;">对比版本：</span>
              <el-select v-model="diffLeftVersion" size="small" style="width:150px;" @change="computeDiff">
                <el-option v-for="v in versionOptions" :key="v.value" :label="v.label" :value="v.value"></el-option>
              </el-select>
              <i class="el-icon-right" style="color:#94a3b8;"></i>
              <el-select v-model="diffRightVersion" size="small" style="width:150px;" @change="computeDiff">
                <el-option v-for="v in versionOptions" :key="v.value" :label="v.label" :value="v.value"></el-option>
              </el-select>
              <span style="font-size:12px;color:#94a3b8;margin-left:8px;">共 {{ diffResults.length }} 个项目有更新内容</span>
            </div>

            <div v-if="diffResults.length === 0" class="empty-state">
              <i class="el-icon-success" style="color:#10b981;"></i>
              <div>两个版本无差异</div>
            </div>

            <div v-else style="max-height:480px;overflow-y:auto;">
              <div v-for="row in diffResults" :key="row.projectNo" style="margin-bottom:16px;">
                <div style="font-size:13px;font-weight:600;color:#1e293b;padding:6px 0;border-bottom:1px solid #e2e8f0;margin-bottom:8px;">
                  {{ row.projectName }} <span style="color:#94a3b8;font-weight:400;font-size:12px;">{{ row.projectNo }}</span>
                </div>
                <el-table :data="row.diffs" size="mini" border style="width:100%;">
                  <el-table-column prop="field" label="字段" width="140"></el-table-column>
                  <el-table-column label="原值（左）">
                    <template slot-scope="{row:d}">
                      <span class="diff-remove amount">{{ d.leftVal }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="新值（右）">
                    <template slot-scope="{row:d}">
                      <span class="diff-change amount">{{ d.rightVal }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-dialog>
        </template>
      </div>
    `
  };
})(window);
