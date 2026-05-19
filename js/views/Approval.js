/**
 * Approval.js — 审批流程页
 * 审批时间轴 + 快照版本列表 + 差异对比弹窗
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

  window.ApprovalView = {
    name: 'Approval',
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
      currentStatus()  { return Store.approvalStatus; },
      currentIdx()     { return FLOW_IDX[this.currentStatus] || 0; },
      snapshots()      { return Store.snapshots; },
      snapshotList()   {
        return Object.values(this.snapshots)
          .sort((a, b) => new Date(b.time) - new Date(a.time));
      },
      canApprove() {
        const node = FLOW[this.currentIdx + 1];
        if (!node) return false;
        return node.role.includes(this.user.role) || this.user.role === 'system_admin';
      },
      canReject() {
        const node = FLOW[this.currentIdx];
        if (!node || this.currentStatus === 'draft') return false;
        return node.role.includes(this.user.role) || this.user.role === 'system_admin';
      },
      nextActionLabel() {
        const next = FLOW[this.currentIdx + 1];
        return next ? next.action : '';
      },
      versionOptions() {
        return Object.keys(this.snapshots).map(k => ({ label: k, value: k }));
      }
    },
    methods: {
      nodeStatus(idx) {
        if (idx < this.currentIdx) return 'done';
        if (idx === this.currentIdx) return 'current';
        return 'pending';
      },
      formatTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      },
      handleApprove() {
        this.$confirm(
          `确认执行"${this.nextActionLabel}"操作？此操作将推进审批流到下一节点并生成版本快照。`,
          '审批确认', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
        ).then(() => {
          this.approveLoading = true;
          Store.advanceApproval()
            .then(() => {
              this.$message.success('审批操作已完成，版本快照已生成');
            })
            .catch(e => { this.$message.error('操作失败：' + (e.message || e)); })
            .finally(() => { this.approveLoading = false; });
        }).catch(() => {});
      },
      handleReject() {
        this.$prompt('请填写驳回原因（可选）', '驳回确认', {
          confirmButtonText: '确认驳回', cancelButtonText: '取消',
          inputPlaceholder: '请输入驳回原因...'
        }).then(({ value }) => {
          this.rejectLoading = true;
          Store.rejectApproval()
            .then(() => {
              if (value) {
                return Store.addAuditLog({
                  projectNo: '—', projectName: '全局审批',
                  fieldName: 'reject_reason', fieldCN: '驳回原因',
                  oldVal: '', newVal: value,
                  userId: this.user.role, userName: this.user.name
                });
              }
            })
            .then(() => {
              this.$message.warning('已驳回，流程退回至 Draft 状态');
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

        // 以右边版本为基准遍历
        right.forEach(rp => {
          const lp = left.find(p => p.project_no === rp.project_no);
          const rowDiffs = [];
          if (!lp) {
            rowDiffs.push({ type: 'add', field: '项目', leftVal: '—', rightVal: rp.project_name });
          } else {
            const lFlat = FieldConfig.arraysToFlat(lp);
            const rFlat = FieldConfig.arraysToFlat(rp);
            fields.slice(0, 40).forEach(f => {  // 只对比前40个字段避免过多
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
      <div>
        <div class="approval-layout" style="align-items:start;">
          <!-- 左侧：审批时间轴 -->
          <div>
            <div class="approval-timeline-card">
              <div class="card-title" style="margin-bottom:16px;">审批流程</div>

              <div class="timeline-node" v-for="(node, idx) in flow" :key="node.key">
                <div class="timeline-dot" :class="nodeStatus(idx)">
                  <span v-if="nodeStatus(idx) === 'done'"><i class="el-icon-check"></i></span>
                  <span v-else>{{ node.icon }}</span>
                </div>
                <div class="timeline-content">
                  <div class="timeline-title" :style="nodeStatus(idx) === 'current' ? 'color:#f59e0b' : ''">
                    {{ node.title }}
                  </div>
                  <div class="timeline-sub">{{ node.desc }}</div>
                  <!-- 快照信息 -->
                  <div v-if="snapshots[node.label]" style="margin-top:6px;">
                    <el-tag size="mini" type="success">
                      {{ snapshots[node.label].user }} · {{ formatTime(snapshots[node.label].time) }}
                    </el-tag>
                  </div>
                </div>
              </div>

              <!-- 操作按钮 -->
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

            <!-- 版本对比按钮 -->
            <el-button
              v-if="snapshotList.length >= 2"
              style="margin-top:12px;width:100%;"
              size="small"
              icon="el-icon-view"
              @click="openDiffDialog"
            >版本差异对比</el-button>
          </div>

          <!-- 右侧：快照列表 -->
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

        <!-- 版本差异对比弹窗 -->
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
      </div>
    `
  };
})(window);
