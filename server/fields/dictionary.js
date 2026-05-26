'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FIELDS_DIR = path.join(ROOT, 'config', 'fields');
const FIELDS_JSON = path.join(FIELDS_DIR, 'fields.json');
const FIELDS_DATA_JS = path.join(FIELDS_DIR, 'fields-data.js');

function readFields() {
  const raw = fs.readFileSync(FIELDS_JSON, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('fields.json 必须为数组');
  }
  return data;
}

function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('fields 必须为非空数组');
  }
  const cols = new Set();
  fields.forEach(function (f, i) {
    if (!f || typeof f !== 'object') {
      throw new Error('第 ' + (i + 1) + ' 项无效');
    }
    if (!f.col || !f.name_cn) {
      throw new Error('字段缺少 col 或 name_cn（第 ' + (i + 1) + ' 项）');
    }
    const col = String(f.col).toUpperCase();
    if (cols.has(col)) {
      throw new Error('列号重复：' + col);
    }
    cols.add(col);
    if (!['system_sync', 'manual_input', 'auto_calc'].includes(f.source_type)) {
      throw new Error('列 ' + col + ' 的 source_type 无效');
    }
  });
}

function writeFields(fields) {
  validateFields(fields);
  const normalized = fields.map(function (f) {
    const copy = Object.assign({}, f);
    copy.col = String(copy.col).toUpperCase();
    copy.enum_values = Array.isArray(copy.enum_values) ? copy.enum_values : [];
    if (!copy.id) copy.id = Date.now();
    return copy;
  });
  const json = JSON.stringify(normalized, null, 2);
  fs.writeFileSync(FIELDS_JSON, json + '\n', 'utf8');
  fs.writeFileSync(
    FIELDS_DATA_JS,
    'window.FIELD_DICTIONARY = ' + json + ';\n',
    'utf8'
  );
  return { count: normalized.length, path: FIELDS_JSON };
}

module.exports = {
  readFields,
  writeFields,
  validateFields,
  FIELDS_DIR,
  FIELDS_JSON,
  FIELDS_DATA_JS
};
