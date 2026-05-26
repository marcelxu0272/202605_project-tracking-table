#!/usr/bin/env node
'use strict';

/**
 * Cursor hook：业务代码变更后提醒同步需求文档（产品版 + 开发版）。
 * 用法：postToolUse | stop（见 .cursor/hooks.json）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FLAG_FILE = path.join(__dirname, '.pending-req-doc-sync');
const PRODUCT_DOC = path.join(ROOT, 'docs', '需求文档', '需求文档_产品版.md');
const DEV_DOC = path.join(ROOT, 'docs', '需求文档', '需求文档_开发版.md');

const CODE_RE = /(^|\/)(js|server|css|config)\/|(^|\/)index\.html$|(^|\/)package\.json$|config\/fields\/fields\.(json|js)$/;

function readStdin() {
  return new Promise(function (resolve) {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) { buf += chunk; });
    process.stdin.on('end', function () { resolve(buf); });
  });
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/');
}

function extractPaths(payload) {
  const paths = [];
  const push = function (p) {
    if (p && typeof p === 'string') paths.push(norm(p));
  };

  push(payload.file_path);
  push(payload.path);
  push(payload.file);

  const input = payload.tool_input || payload.arguments || payload.input || {};
  push(input.path);
  push(input.file_path);
  push(input.target_notebook);

  if (Array.isArray(payload.files)) {
    payload.files.forEach(push);
  }

  return paths;
}

function isCodePath(p) {
  const rel = norm(p).replace(/^[a-z]:/i, '');
  if (!rel || rel.includes('docs/需求文档/')) return false;
  if (rel.endsWith('AGENTS.md')) return false;
  if (rel.includes('.cursor/hooks/')) return false;
  return CODE_RE.test(rel);
}

function isCodeEdit(payload) {
  const paths = extractPaths(payload);
  return paths.some(isCodePath);
}

function writeFlag(paths) {
  const data = {
    touchedAt: new Date().toISOString(),
    files: paths.filter(isCodePath).slice(0, 8)
  };
  fs.writeFileSync(FLAG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function docsSyncedAfter(touchedAt) {
  const t = new Date(touchedAt).getTime();
  if (isNaN(t)) return false;
  try {
    const pm = fs.statSync(PRODUCT_DOC).mtimeMs;
    const dm = fs.statSync(DEV_DOC).mtimeMs;
    return pm > t && dm > t;
  } catch (e) {
    return false;
  }
}

function reminderText() {
  return [
    '【需求文档同步】本次会话涉及功能代码变更。',
    '若属于功能新增或优化，请完成实现后同步更新：',
    '- docs/需求文档/需求文档_产品版.md（业务流程、规则、交互）',
    '- docs/需求文档/需求文档_开发版.md（实现细节、路径、API、§ 编号）',
    '并更新两文档顶部「最后更新」日期；纯重构/样式微调可简要说明或跳过。'
  ].join('\n');
}

async function handlePostToolUse(payload) {
  if (!isCodeEdit(payload)) {
    process.stdout.write('{}');
    return;
  }
  writeFlag(extractPaths(payload));
  process.stdout.write(JSON.stringify({ additional_context: reminderText() }));
}

async function handleStop() {
  if (!fs.existsSync(FLAG_FILE)) {
    process.stdout.write('{}');
    return;
  }
  let flag;
  try {
    flag = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
  } catch (e) {
    fs.unlinkSync(FLAG_FILE);
    process.stdout.write('{}');
    return;
  }

  if (docsSyncedAfter(flag.touchedAt)) {
    fs.unlinkSync(FLAG_FILE);
    process.stdout.write('{}');
    return;
  }

  fs.unlinkSync(FLAG_FILE);
  process.stdout.write(JSON.stringify({
    followup_message: reminderText()
  }));
}

async function main() {
  const mode = process.argv[2] || 'postToolUse';
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch (e) { /* empty stdin */ }

  if (mode === 'stop') {
    await handleStop();
  } else {
    await handlePostToolUse(payload);
  }
}

main().catch(function () {
  process.stdout.write('{}');
  process.exit(0);
});
