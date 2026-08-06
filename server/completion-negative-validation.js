'use strict';

const EPS = 0.005;

function monthIdxFromPeriod(period) {
  var text = String(period || '');
  var parts = text.split('-');
  if (parts.length < 2) return 0;
  var month = Number(parts[1]);
  if (!month || month < 1 || month > 12) return 0;
  return month - 1;
}

function normalizeNumber(value) {
  if (value == null || value === '') return 0;
  var n = Number(value);
  return isNaN(n) ? 0 : n;
}

function normalizeMode(options) {
  if (typeof options === 'string') return options === 'submit' ? 'submit' : 'save';
  var mode = options && options.mode;
  return mode === 'submit' ? 'submit' : 'save';
}

/**
 * @param {object} project
 * @param {number} monthIdx
 * @param {string|{mode?: string}} [options] - 'save' | 'submit'（默认 save）
 *   save: 仅禁未来月完成额为负（允许当前月负值无备注，便于单元格先落库再引导填备注）
 *   submit: 未来月禁负 + 当前月负值备注必填
 */
function validateProjectCompletionRules(project, monthIdx, options) {
  var p = project || {};
  var mode = normalizeMode(options);
  for (var i = monthIdx + 1; i < 12; i++) {
    if (normalizeNumber(p['mc_' + i]) < -EPS) {
      return {
        ok: false,
        code: 'future_completion_negative',
        message: '未来月份完成合同额（预测）不能小于 0。'
      };
    }
  }
  if (mode === 'submit' && normalizeNumber(p['mc_' + monthIdx]) < -EPS) {
    var remark = String(p.completion_remark || '').trim();
    if (!remark) {
      return {
        ok: false,
        code: 'current_completion_negative_missing_remark',
        message: '当前月份完成合同额为负时，备注不能为空。'
      };
    }
  }
  return { ok: true };
}

function validateProjectsCompletionRules(projects, monthIdx, options) {
  var list = projects || [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var check = validateProjectCompletionRules(item, monthIdx, options);
    if (!check.ok) {
      return Object.assign(check, {
        project_no: item.project_no,
        project_name: item.project_name
      });
    }
  }
  return { ok: true };
}

module.exports = {
  monthIdxFromPeriod,
  validateProjectCompletionRules,
  validateProjectsCompletionRules
};
