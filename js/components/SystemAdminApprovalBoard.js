/**
 * SystemAdminApprovalBoard.js — 系统管理员审批页：十二板块并行流程
 */
(function (window) {
  'use strict';

  window.SystemAdminApprovalBoard = {
    name: 'SystemAdminApprovalBoard',
    data: function () {
      return {
        sectorSteps: SectorWorkflow.SECTOR_STEP_LABELS.slice()
      };
    },
    computed: {
      store: function () { return window.Store; },
      sectors: function () { return Store.listSectors(); },
      companyArchived: function () { return Store.isCompanyArchived(); },
      sectorCards: function () {
        var self = this;
        return this.sectors.map(function (code) {
          var flow = Store.getSectorFlow(code);
          return {
            code: code,
            displayLabel: SectorWorkflow.sectorDisplayLabel(code, Store),
            flow: flow,
            statusText: SectorWorkflow.sectorFlowStatusText(flow, self.companyArchived)
          };
        });
      }
    },
    methods: {
      sectorActiveIdx: function (flow) {
        return SectorWorkflow.sectorActiveFlowIdx(flow);
      },
      sectorStepClass: function (card, idx) {
        if (this.companyArchived && card.flow.approvalStatus === 'approve2') return 'done';
        if (card.flow.approvalStatus === 'approve2') return 'done';
        var active = this.sectorActiveIdx(card.flow);
        if (active < 0) return 'done';
        if (idx < active) return 'done';
        if (idx === active) return 'current';
        return 'pending';
      },
      sectorStepLabel: function (card, idx) {
        var s = this.sectorStepClass(card, idx);
        if (s === 'done') return '已完成';
        if (s === 'current') return '进行中';
        return '未完成';
      },
      flowTagType: function (flow) {
        if (this.companyArchived) return 'success';
        if (flow.approvalStatus === 'approve2') return 'success';
        if (flow.reportingSubmitted) return 'warning';
        return 'info';
      }
    },
    template: [
      '<motion-placeholder class="approval-layout sysadmin-approval-layout">',
      '<motion-placeholder class="sysadmin-approval-main">',
      '<motion-placeholder class="sysadmin-sector-grid">',
      '<motion-placeholder v-for="card in sectorCards" :key="card.code" class="sysadmin-sector-flow-card">',
      '<motion-placeholder class="sysadmin-sector-flow-head">',
      '<span class="sysadmin-sector-flow-title">{{ card.displayLabel }}</span>',
      '<el-tag size="mini" :type="flowTagType(card.flow)">{{ card.statusText }}</el-tag>',
      '</motion-placeholder>',
      '<motion-placeholder class="sysadmin-sector-steps">',
      '<motion-placeholder v-for="(step, idx) in sectorSteps" :key="card.code + \'-\' + idx" class="sysadmin-sector-step">',
      '<span class="sysadmin-sector-step-dot" :class="sectorStepClass(card, idx)">{{ idx + 1 }}</span>',
      '<motion-placeholder class="sysadmin-sector-step-body">',
      '<span class="sysadmin-sector-step-name">{{ step }}</span>',
      '<span class="sysadmin-sector-step-status" :class="\'is-\' + sectorStepClass(card, idx)">{{ sectorStepLabel(card, idx) }}</span>',
      '</motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>',
      '</motion-placeholder>'
    ].join('')
  };

  window.SystemAdminApprovalBoard.template = window.SystemAdminApprovalBoard.template
    .replace(/<motion-placeholder/g, '<div')
    .replace(/<\/motion-placeholder>/g, '</div>');
})(window);
