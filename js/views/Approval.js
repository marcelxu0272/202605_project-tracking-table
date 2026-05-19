/**
 * Approval.js — 审批流程页
 * 板块总监 / 项目群群主：时间轴 + 只读 Luckysheet（新增与变更项目）
 * 其他角色：时间轴 + 版本快照 + 差异对比
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
      desc: '板块总监审核通过，生成 Approve1 版快照',
      role: ['sector_director'],
      action: '初审通过',
      icon: '2'
    },
    {
      key: 'approve2',
      label: 'Approve2',
      title: '项目群群主复审',
      desc: '项目群群主审核确认，生成 Approve2 版快照',
      role: ['group_leader'],
      action: '复审通过',
      icon: '3'
    },
    {
      key: 'final',
      label: 'J版',
      title: '管理员确认归档',
      desc: '系统管理员最终核对确认，生成 J 版（正式归档版）快照',
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
      ApprovalReviewSheet: window.ApprovalReviewSheet
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
      currentStatus()  { return Store.approvalStatus; },
      currentIdx()     { return FLOW_IDX[this.currentStatus] || 0; },
      snapshots()      { return Store.snapshots; },
      snapshotList()   {
        return Object.values(this.snapshots)
          .sort((a, b) => new Date(b.time) - new Date(a.time));
      },
      canApprove() {
        const next = FLOW[this.currentIdx + 1];
        if (!next) return false;
        if (this.currentStatus === 'draft' && !Store.reportingSubmitted) return false;
        return next.role.includes(this.user.role) || this.user.role === 'system_admin';
      },
      canReject() {
        return this.canApprove;
      },
      nextActionLabel() {
        const next = FLOW[this.currentIdx + 1];
        return next ? next.action : '';
      },
      versionOptions() {
        return Object.keys(this.snapshots).map(k => ({ label: k, value: k }));
      },
      /** 当前进行中的流程节点下标（approvalStatus 表示上一节点已完成） */
      activeFlowIdx() {
        const s = this.currentStatus;
        if (s === 'final') return -1;
        if (s === 'draft') return Store.reportingSubmitted ? 1 : 0;
        if (s === 'approve1') return 2;
        if (s === 'approve2') return 3;
        return 0;
      }
    },
    methods: {
      nodeStatus(idx) {
        if (this.currentStatus === 'final') return 'done';
        const active = this.activeFlowIdx;
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
          `确认执行「${this.nextActionLabel}」？此操作将推进审批流程并生成版本快照。`,
          '审批确认', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
        ).then(() => {
          this.approveLoading = true;
          Store.advanceApproval()
            .then(() => {
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
          Store.rejectApproval()
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
        const keys = Object.keys(this.snapshots);
        if (keys.length < 1) {
          this.$message.info('暂无可对比的快照版本');
          return;
        }
        this.diffLeftVersion  = keys[Math.max(0, keys.length - 2)];
        this.diffRightVersion = keys[keys.length - 1];
        this.computeDiff();
        this.diffDialogVisible = true;
      },
      computeDiff() {
        if (!this.diffLeftVersion || !this.diffRightVersion) return;
        const left  = (this.snapshots[this.diffLeftVersion]  || {}).projects || [];
        const right = (this.snapshots[this.diffRightVersion] || {}).projects || [];
        const fields = FieldConfig.buildFieldConfig();
        const results = [];

        right.forEach(rp => {
          const lp = left.find(p => p.project_no === rp.project_no);
          const rowDiffs = [];
          if (!lp) {
            rowDiffs.push({ type: 'add', field: '项目', leftVal: '—', rightVal: rp.project_name });
          } else {
            const lFlat = FieldConfig.arraysToFlat(lp);
            const rFlat = FieldConfig.arraysToFlat(rp);
            fields.slice(0, 40).forEach(f => {
              const key = FieldConfig.COL_TO_KEY[f.col];
              const lv = lFlat[key];
              const rv = rFlat[key];
              if (String(lv) !== String(rv)) {
                rowDiffs.push({
                  type: 'change',
                  field: f.name_cn,
                  leftVal:  Formatters.formatByType(lv, f.data_type),
                  rightVal: Formatters.formatByType(rv, f.data_type)
                });
              }
            });
          }
          if (rowDiffs.length > 0) {
            results.push({ projectNo: rp.project_no, projectName: rp.project_name, diffs: rowDiffs });
          }
        });
        this.diffResults = results;
      }
    },
    template: `
      <div :class="isApprovalReviewer ? 'approval-reviewer-page' : ''" style="height:100%;">
        <!-- 板块总监 / 项目群群主：精简审批 + 只读 Luckysheet -->
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
                  <template v-if="currentStatus === 'draft' && !store.reportingSubmitted">
                    等待板块管理员提交审批
                  </template>
                  <template v-else-if="currentStatus === 'final'">
                    审批已归档
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
                    <div v-if="snapshots[node.label]" style="margin-top:6px;">
                      <el-tag size="mini" type="success">
                        {{ snapshots[node.label].user }} · {{ formatTime(snapshots[node.label].time) }}
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
                    v-if="canReject"
                    type="danger"
                    size="small"
                    plain
                    :loading="rejectLoading"
                    @click="handleReject"
                  >
                    <i class="el-icon-close"></i> 驳回
                  </el-button>
                  <div v-if="!canApprove && !canReject" style="font-size:12px;color:#94a3b8;padding:6px 0;">
                    当前角色无审批权限
                  </div>
                </div>
              </div>

              <el-button
                v-if="snapshotList.length >= 2"
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
              <span style="font-size:12px;color:#94a3b8;margin-left:8px;">共 {{ diffResults.length }} 个项目有变更</span>
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
