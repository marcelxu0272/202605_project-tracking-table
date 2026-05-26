/**
 * FieldManager.js — Luckysheet 表头配置（系统管理员）
 * 竖向字段列表；当前仅表头中文名称可编辑，其余只读展示。
 */
(function (window) {
  'use strict';

  var TYPE_CONFIG = {
    system_sync:  { label: '系统同步', icon: '📥', cls: 'fm-badge-sync' },
    manual_input: { label: '手工填报', icon: '✏️', cls: 'fm-badge-manual' },
    auto_calc:    { label: '自动计算', icon: '🧮', cls: 'fm-badge-calc' }
  };

  var SECTION_COLORS = [
    '#007069', '#6366f1', '#8b5cf6', '#06b6d4',
    '#10b981', '#f59e0b', '#ef4444', '#ec4899',
    '#14b8a6', '#f97316', '#84cc16', '#a855f7'
  ];

  function snapshotNames(fields) {
    return JSON.stringify((fields || []).map(function (f) {
      return { col: f.col, name_cn: f.name_cn || '' };
    }));
  }

  window.FieldManagerView = {
    name: 'FieldManager',
    data: function () {
      return {
        fields: [],
        loading: false,
        saving: false,
        searchQuery: '',
        activeFilters: [],
        collapsedSections: [],
        detailVisible: false,
        detailField: null,
        _nameSnapshot: null,
        isDirty: false,
        typeConfig: TYPE_CONFIG
      };
    },
    computed: {
      store: function () { return window.Store; },
      user: function () { return Store.currentUser || {}; },
      dirty: function () { return this.isDirty; },
      typeStats: function () {
        var counts = { system_sync: 0, manual_input: 0, auto_calc: 0 };
        this.fields.forEach(function (f) {
          if (counts[f.source_type] != null) counts[f.source_type]++;
        });
        return counts;
      },
      sectionColorMap: function () {
        var map = {};
        var secs = [];
        this.fields.forEach(function (f) {
          var s = f.section || '未分类';
          if (secs.indexOf(s) < 0) secs.push(s);
        });
        secs.forEach(function (s, i) {
          map[s] = SECTION_COLORS[i % SECTION_COLORS.length];
        });
        return map;
      },
      filteredFields: function () {
        var q = (this.searchQuery || '').toLowerCase().trim();
        var filters = this.activeFilters;
        return this.fields.filter(function (f) {
          var matchSearch = !q ||
            String(f.col).toLowerCase().indexOf(q) >= 0 ||
            (f.name_cn || '').indexOf(q) >= 0 ||
            (f.name_en || '').toLowerCase().indexOf(q) >= 0 ||
            (f.section || '').indexOf(q) >= 0 ||
            (f.description || '').indexOf(q) >= 0;
          var matchFilter = !filters.length || filters.indexOf(f.source_type) >= 0;
          return matchSearch && matchFilter;
        });
      },
      groupedSections: function () {
        var order = [];
        var map = {};
        this.filteredFields.forEach(function (f) {
          var sec = f.section || '未分类';
          if (!map[sec]) {
            map[sec] = [];
            order.push(sec);
          }
          map[sec].push(f);
        });
        return order.map(function (sec) {
          return { name: sec, fields: map[sec], range: (map[sec][0] && map[sec][0].section_range) || '' };
        });
      }
    },
    created: function () {
      this.loadFields();
    },
    watch: {
      fields: {
        deep: true,
        handler: function () {
          this.syncDirtyFlag();
        }
      }
    },
    methods: {
      syncDirtyFlag: function () {
        if (this._nameSnapshot == null) return;
        this.isDirty = snapshotNames(this.fields) !== this._nameSnapshot;
      },
      loadFields: function () {
        var self = this;
        this.loading = true;
        Store.fetchFieldDictionary()
          .then(function (d) {
            self.fields = (d && d.fields)
              ? JSON.parse(JSON.stringify(d.fields))
              : JSON.parse(JSON.stringify(Store.fieldDictionary || []));
            self._nameSnapshot = snapshotNames(self.fields);
            self.isDirty = false;
          })
          .catch(function (e) {
            self.$message.error('加载表头配置失败：' + (e.message || e));
          })
          .finally(function () {
            self.loading = false;
          });
      },
      toggleFilter: function (key) {
        var idx = this.activeFilters.indexOf(key);
        if (idx >= 0) this.activeFilters.splice(idx, 1);
        else this.activeFilters.push(key);
      },
      isFilterActive: function (key) {
        return this.activeFilters.indexOf(key) >= 0;
      },
      toggleSection: function (sec) {
        var idx = this.collapsedSections.indexOf(sec);
        if (idx >= 0) this.collapsedSections.splice(idx, 1);
        else this.collapsedSections.push(sec);
      },
      isSectionCollapsed: function (sec) {
        return this.collapsedSections.indexOf(sec) >= 0;
      },
      expandAllSections: function () {
        this.collapsedSections = [];
      },
      collapseAllSections: function () {
        var self = this;
        this.collapsedSections = this.groupedSections.map(function (g) { return g.name; });
      },
      renderFormulaHtml: function (text) {
        if (!text) return '';
        var self = this;
        return String(text).replace(/\b([A-Z]{1,2})\b/g, function (match) {
          var f = self.fields.find(function (x) { return x.col === match; });
          var name = f ? f.name_cn : '?';
          return '<span class="fm-formula-tag" title="' + name + '">' + match +
            '<span class="fm-formula-tag-name">' + name + '</span></span>';
        });
      },
      showDetail: function (field) {
        this.detailField = field;
        this.detailVisible = true;
      },
      persistHeaders: function () {
        var self = this;
        var empty = this.fields.find(function (f) { return !(f.name_cn || '').trim(); });
        if (empty) {
          this.$message.warning('列 ' + empty.col + ' 的表头名称不能为空');
          return;
        }
        this.$confirm(
          '将更新表头名称并同步至项目追踪表 Luckysheet，是否保存？',
          '保存表头配置',
          { confirmButtonText: '保存', cancelButtonText: '取消', type: 'warning' }
        ).then(function () {
          self.saving = true;
          return Store.saveFieldDictionary(self.fields, self.user);
        }).then(function () {
          self._nameSnapshot = snapshotNames(self.fields);
          self.isDirty = false;
          self.$message.success('表头已保存，项目追踪表将自动同步');
        }).catch(function (e) {
          if (e === 'cancel' || e === 'close') return;
          self.$message.error('保存失败：' + (e.message || e));
        }).finally(function () {
          self.saving = false;
        });
      },
      reloadFromStore: function () {
        var self = this;
        if (!this.dirty) {
          this.loadFields();
          return;
        }
        this.$confirm('未保存的表头修改将丢失，确定重新加载？', '重新加载', { type: 'warning' })
          .then(function () { self.loadFields(); })
          .catch(function () {});
      },
      goEditor: function () {
        this.$router.push('/editor');
      }
    },
    template: `
      <div class="field-manager-view" v-loading="loading">
        <div class="fm-sticky-shell">
          <div v-if="dirty" class="fm-dirty-banner" role="status">
            <i class="el-icon-warning fm-dirty-icon"></i>
            <span class="fm-dirty-text">有未保存的表头修改</span>

          </div>
          <div class="fm-page-head">
            <div>
              <h2 class="fm-page-title">Luckysheet 表头配置</h2>
              <p class="fm-page-desc">
                与项目追踪表共用字段字典（服务端同步）。当前仅<strong>表头中文名称</strong>可编辑；
                列宽、冻结、公式等待定。
              </p>
            </div>
            <div class="fm-toolbar-actions">
              <el-button size="small" icon="el-icon-s-grid" @click="goEditor">查看项目追踪表</el-button>
              <el-button size="small" icon="el-icon-refresh" @click="reloadFromStore">重新加载</el-button>
              <el-button
                size="small"
                type="primary"
                icon="el-icon-check"
                :loading="saving"
                :disabled="!dirty"
                @click="persistHeaders"
              >保存表头</el-button>
            </div>
          </div>
        </div>

        <div class="fm-page-body">
        <div class="fm-toolbar">
          <el-input
            v-model="searchQuery"
            size="small"
            prefix-icon="el-icon-search"
            placeholder="搜索列号、表头名、说明…"
            clearable
            class="fm-search"
          ></el-input>
        </div>

        <div class="fm-stats">
          <div class="fm-stat-card fm-stat-total">
            <span class="fm-stat-label">字段总数</span>
            <span class="fm-stat-value">{{ fields.length }}</span>
          </div>
          <div v-for="(cfg, key) in typeConfig" :key="key" class="fm-stat-card">
            <span class="fm-stat-label">{{ cfg.icon }} {{ cfg.label }}</span>
            <span class="fm-stat-value">{{ typeStats[key] || 0 }}</span>
          </div>
        </div>

        <div class="fm-filter-bar">
          <span class="fm-filter-label">来源筛选</span>
          <button
            v-for="(cfg, key) in typeConfig"
            :key="'f-' + key"
            type="button"
            class="fm-filter-chip"
            :class="{ 'is-active': isFilterActive(key) }"
            @click="toggleFilter(key)"
          >{{ cfg.icon }} {{ cfg.label }}</button>
          <div class="fm-filter-spacer"></div>
          <el-button type="text" size="mini" @click="expandAllSections">展开全部</el-button>
          <el-button type="text" size="mini" @click="collapseAllSections">折叠全部</el-button>
          <span class="fm-result-count">
            {{ filteredFields.length === fields.length ? ('共 ' + fields.length + ' 个字段') : (filteredFields.length + ' / ' + fields.length) }}
          </span>
        </div>

        <div class="fm-table-wrap">
          <table class="fm-table">
            <thead>
              <tr>
                <th width="56">列号</th>
                <th min-width="180">表头名称 <span class="fm-th-hint">（可编辑）</span></th>
                <th>英文名称</th>
                <th width="120">来源类型</th>
                <th>数据类型</th>
                <th>计算逻辑</th>
                <th>说明</th>
                <th width="72">详情</th>
              </tr>
            </thead>
            <tbody v-if="groupedSections.length">
              <template v-for="group in groupedSections">
                <tr :key="'sec-' + group.name" class="fm-section-row" @click="toggleSection(group.name)">
                  <td colspan="8">
                    <span class="fm-section-bar" :style="{ background: sectionColorMap[group.name] }"></span>
                    <strong>{{ group.name }}</strong>
                    <span v-if="group.range" class="fm-section-range">{{ group.range }}</span>
                    <span class="fm-section-count">{{ group.fields.length }} 个字段</span>
                    <i class="el-icon-arrow-down fm-section-chevron" :class="{ 'is-collapsed': isSectionCollapsed(group.name) }"></i>
                  </td>
                </tr>
                <tr
                  v-for="field in group.fields"
                  v-show="!isSectionCollapsed(group.name)"
                  :key="field.id || field.col"
                  class="fm-data-row"
                >
                  <td><span class="fm-col-badge">{{ field.col }}</span></td>
                  <td class="fm-name-cell">
                    <el-input
                      v-model="field.name_cn"
                      size="mini"
                      placeholder="表头中文名"
                      class="fm-name-input"
                      @input="syncDirtyFlag"
                    ></el-input>
                  </td>
                  <td class="fm-muted">{{ field.name_en || '—' }}</td>
                  <td>
                    <span class="fm-badge" :class="typeConfig[field.source_type].cls">
                      {{ typeConfig[field.source_type].icon }} {{ typeConfig[field.source_type].label }}
                    </span>
                  </td>
                  <td><span class="fm-dtype">{{ field.data_type }}</span></td>
                  <td class="fm-formula-cell">
                    <span v-if="field.calc_logic" v-html="renderFormulaHtml(field.calc_logic)"></span>
                    <span v-else class="fm-muted">—</span>
                  </td>
                  <td class="fm-desc" :title="field.description">{{ field.description || '—' }}</td>
                  <td>
                    <el-button type="text" size="mini" @click="showDetail(field)">查看</el-button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-if="!groupedSections.length && !loading" class="fm-empty">
            <div class="fm-empty-icon">🔍</div>
            <p>没有匹配的字段</p>
          </div>
        </div>

        <div class="fm-pending-note">
          <span class="fm-pending-label">待定</span>
          列宽与隐藏 · 冻结窗格 · 数据验证 · 公式编辑 · 新增/删除列
        </div>
        </div>

        <el-drawer title="字段详情" :visible.sync="detailVisible" size="360px" append-to-body>
          <div v-if="detailField" class="fm-detail">
            <div class="fm-detail-head">
              <div class="fm-detail-col" :style="{ background: sectionColorMap[detailField.section] }">{{ detailField.col }}</div>
              <div>
                <div class="fm-detail-title">{{ detailField.name_cn }}</div>
                <div class="fm-muted">{{ detailField.name_en || '—' }}</div>
              </div>
            </div>
            <div class="fm-detail-grid">
              <div><span class="fm-detail-label">来源</span>
                <span class="fm-badge" :class="typeConfig[detailField.source_type].cls">
                  {{ typeConfig[detailField.source_type].label }}
                </span>
              </div>
              <div><span class="fm-detail-label">类型</span>{{ detailField.data_type }}</div>
              <div><span class="fm-detail-label">分区</span>{{ detailField.section }}</div>
              <div><span class="fm-detail-label">列范围</span>{{ detailField.section_range || '—' }}</div>
            </div>
            <div v-if="detailField.calc_logic" class="fm-detail-block">
              <div class="fm-detail-label">计算逻辑</div>
              <div v-html="renderFormulaHtml(detailField.calc_logic)"></div>
            </div>
            <div v-if="detailField.enum_values && detailField.enum_values.length" class="fm-detail-block">
              <div class="fm-detail-label">枚举值</div>
              <el-tag v-for="v in detailField.enum_values" :key="v" size="mini" style="margin:2px">{{ v }}</el-tag>
            </div>
            <div class="fm-detail-block">
              <div class="fm-detail-label">说明</div>
              <p>{{ detailField.description || '暂无说明' }}</p>
            </div>
          </div>
        </el-drawer>
      </div>
    `
  };
})(window);
