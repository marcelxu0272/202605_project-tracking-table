# 📁 项目追踪表线上化 — 目录说明

> **项目目标：** 将项目执行追踪 Excel 表的填写、汇总、统计与展示线上化  
> **最后更新：** 2026-05-29

---

## 🚀 项目初始化

### 环境要求

| 依赖 | 说明 |
|---|---|
| **Node.js** | 18+（推荐 LTS）；运行 Express API 与 `better-sqlite3` |
| **npm** | 安装依赖、启动服务 |
| **Python 3** | 可选；仅 `npm run sync:fields` 手动同步字段字典时需要 |

### 首次启动（本地开发）

```bash
# 1. 进入项目根目录
cd <项目路径>

# 2. 安装依赖
npm install

# 3. 准备初始化 Excel（见下表，至少放置其一于根目录）
# 4. 启动服务（库为空时会自动导入）
npm start
```

浏览器打开 **http://127.0.0.1:3000/**（须通过本地服务访问，**勿**用 `file://` 直接打开 `index.html`）。

登录页选择角色卡片进入；开发调试建议先用 **系统管理员**。

### 初始化 Excel 优先级

服务启动时若 `data/ptrack.sqlite` 中**无项目**，会按顺序查找并导入：

| 优先级 | 路径 | 说明 |
|---|---|---|
| 1 | 环境变量 `PTRACK_INIT_XLSX` | 绝对路径，或相对项目根目录的路径 |
| 2 | `初始数据.xlsx` | **首选**初始化文件（根目录） |

首次导入成功后，服务端还会：写入 **I 版 baseline 快照**、注入演示用「新增项目」与 **R/S、完成额 vs 工时** 预警样例（见 `server/dev-reset-seed.js`、`server/alert-demo-seed.js`）。

### 字段字典（83 列）

仓库已包含 `config/fields/fields.json` 与 `fields-data.js`，**无需单独初始化**。前端经 `GET /api/bootstrap` 加载 `fieldDictionary`（见 **§ 字段字典模块**）。

若仅修改了 `fields.json` 且未走表头配置页保存，可执行：

```bash
npm run sync:fields
```

### 常用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PTRACK_PORT` | `3000` | HTTP 端口 |
| `PTRACK_INIT_XLSX` | — | 指定初始化 Excel 路径 |
| `PTRACK_PLATFORM_API_URL` | — | 平台同步真实 API（未实现时勿配置，使用 stub） |
| `PTRACK_TIMESHEET_DIR` | `docs/参考数据` | 工时 xlsx 导入目录 |
| `PTRACK_COST_DIR` | 同左 | 成本 xlsx 导入目录 |
| `PTRACK_SMTP_HOST` | — | SMTP 服务器地址（空则不启用邮件提醒） |
| `PTRACK_SMTP_PORT` | `587` | SMTP 端口 |
| `PTRACK_SMTP_SECURE` | `false` | SMTP 是否使用 TLS |
| `PTRACK_SMTP_USER` | — | SMTP 发件账号 |
| `PTRACK_SMTP_PASS` | — | SMTP 发件密码或应用专用密码 |
| `PTRACK_SMTP_FROM` | 取 `PTRACK_SMTP_USER` | 发件人显示名 + 地址 |

### 重置与重导数据

| 场景 | 操作 |
|---|---|
| **开发环境一键恢复** | 系统管理员登录 → 顶栏用户菜单 → **重置为初始状态（开发）**（`POST /api/admin/reset-dev`） |
| **仅从 Excel 重导项目** | **管理设置** → 「从初始 Excel 恢复」（`POST /api/admin/reseed`） |
| **清空库后重新导入** | 停止服务 → 删除 `data/ptrack.sqlite`（及 `.wal`/`.shm`）→ 放置 Excel → `npm start` |

重置/重导后建议 **硬刷新浏览器**（Ctrl+Shift+R）。修改字段字典后若服务端公式未生效，需 **重启 `npm start`**。

### 初始化后验证

1. 登录 **系统管理员** → **项目追踪表**：Luckysheet 应显示 83 列表头与项目数据。
2. **表头配置**（`/#/fields`）：竖向字段列表可加载，修改表头名保存后填报页表头同步。
3. 控制台无 `field-config: 字段字典未加载`；若出现，确认 `npm start` 已重启且 `/api/fields` 可访问。

### npm scripts 速查

| 命令 | 说明 |
|---|---|
| `npm start` | 启动 API + 静态站点 |
| `npm test` | 运行 Node 原生测试（如锁定/解锁规则） |
| `npm run sync:fields` | `fields.json` → `fields-data.js` |
| `npm run export:init-xlsx` | 从当前库导出 `初始数据.xlsx` |
| `npm run patch:init-alerts` | 将预警演示字段写回 `初始数据.xlsx` |

---

## 📋 文件清单

### 应用与运行时

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `package.json` | 📦 Node 配置 | ~0.5KB | 依赖 `express`、`better-sqlite3`、`xlsx`；`npm start` 启动 API + 静态站点，`npm test` 运行测试。 |
| `index.html` | 🌐 应用入口 | ~3KB | CDN + 业务脚本；`npm start` → http://127.0.0.1:3000/ |
| `初始数据.xlsx` | 📊 初始化数据 | 视文件 | 置于项目根目录；库为空时自动导入；管理页可「从初始 Excel 恢复」。 |
| `data/ptrack.sqlite` | 🗄 运行时库 | 自动生成 | SQLite 数据文件（`.gitignore`）。 |
| `database-schema.sql` | 🗃 Schema SQL | ~8KB | 数据库表结构 DDL。 |
| `database-schema-design.md` | 📝 Schema 说明 | ~12KB | 表设计说明，关联 `config/fields/fields.json` 与需求文档。 |

### `config/fields/` 字段字典数据

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `config/fields/fields.json` | 📄 字段定义（源） | ~35KB | **83 字段**结构化定义；**权威数据源**，由字段字典页保存。 |
| `config/fields/fields-data.js` | 📄 字段运行时 | ~35KB | 由 `fields.json` 自动生成；浏览器与 Node `load-modules` 加载。 |
| `config/fields/sync-fields.py` | 🐍 同步脚本 | ~0.5KB | CLI：`npm run sync:fields` → json → js（与线上保存逻辑一致）。 |

### `server/` 后端

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `server/index.js` | 🖥 服务端入口 | ~9KB | Express：`/api/*` 读写 SQLite；I/D/J 快照、PM 提交、板块/J 版归档等。 |
| `server/db.js` | 🗃 SQLite 封装 | ~6KB | 库路径 `data/ptrack.sqlite`；bootstrap 含锁定状态、`baselineVersion` / `latestIVersion` / `latestJVersion`。 |
| `server/snapshot-service.js` | 📸 快照服务 | ~4KB | I/D/J 版本键生成与写入；baseline meta 更新。 |
| `server/load-modules.js` | 🔧 模块加载 | ~1KB | 在 Node 中 vm 执行 `fields-data.js`、`formula-engine.js`、`field-config.js`。 |
| `server/xlsx-seed.js` | 📥 服务端解析 | ~3KB | xlsx → projects（与 `js/xlsx-importer.js` 对齐）。 |
| `server/platform-sync.js` | 🔄 平台同步 | ~4KB | 从中台/CRB/财务合并 `system_sync` 字段；每日定时 + 管理员手动触发。 |
| `server/sector-workflow.js` | 🔀 板块流程 | ~4KB | 十二板块注册、流程状态（服务端）。 |
| `server/dev-reset-seed.js` | 🔧 开发重置 | ~3KB | 重置后写 I 版 baseline（排除 demo 新增项目号）；预警演示数据。 |
| `server/alert-demo-seed.js` | 🔧 预警演示 | ~3KB | 重导/重置后为 4 条项目注入 R/S、完成额 vs 工时预警场景及演示工时。 |
| `server/alert-service.js` | ⚠️ 预警聚合 | ~4KB | 全公司预警计算与 DB 持久化同步；`collectAllAlerts` 一次遍历所有项目。 |
| `server/patch-init-xlsx-alerts.js` | 🔧 初始化补丁 | ~2KB | `npm run patch:init-alerts` 将预警演示字段写回 `初始数据.xlsx`。 |
| `server/mailer.js` | 📧 SMTP 传输层 | ~3KB | nodemailer 封装；懒初始化 transporter；`isEmailEnabled` / `sendMail`。 |
| `server/email-reminder.js` | 📧 邮件提醒 | ~10KB | 填报提醒日 + 锁定倒计时邮件；板块数据聚合；模板生成；审计记录。 |
| `server/fields/dictionary.js` | 📄 字段字典 | ~2KB | 读写 `config/fields/fields.json` 并同步 `fields-data.js`。 |

### `css/` 样式

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `css/style.css` | 🎨 全局样式 | ~22KB | 品牌色、Luckysheet、Drawer、预警抽屉等。 |
| `css/field-dictionary.css` | 🎨 字段字典样式 | ~4KB | 字段字典页 `.field-manager-view` / `.fm-*`。 |
| `css/element-theme.css` | 🎨 Element 主题 | ~6KB | 覆盖 Element UI 默认蓝色，对齐 `docs/设计文档/DESIGN.md` 品牌色 `#007069`。 |

### `js/` 前端

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `js/app.js` | 🚀 应用初始化 | ~2KB | `Store.init()` 后挂载 Vue。 |
| `js/router.js` | 🔀 路由配置 | ~2KB | Hash 路由 + 登录/角色守卫；默认首页按角色跳转填报或审批。 |
| `js/store.js` | 🗄️ 状态管理 | ~12KB | Vue.observable + `/api`；板块流程、快照、锁定等。 |
| `js/formatters.js` | 🔧 格式化工具 | ~4KB | 金额、日期、百分比等。 |
| `js/formula-engine.js` | ⚙️ 公式引擎 | ~8KB | 83 字段 `auto_calc` 逻辑与汇总。 |
| `js/field-config.js` | 🔐 字段权限 | ~7KB | 角色 × 锁定期字段可写矩阵。 |
| `js/change-meta.js` | 📝 变更批注 | ~7KB | `_field_change_log`；`CHANGED_FIELD_STYLE` / `EDITABLE_FIELD_STYLE`。 |
| `js/stock-validation.js` | ⚠️ 存量校验 | ~3KB | R/S 列预警、完成额调增阻断提交。 |
| `js/project-alerts.js` | ⚠️ 项目预警 | ~3KB | Drawer 四类预警标签计算（存量 R/S、完成额 vs 工时）。 |
| `js/sector-workflow.js` | 🔀 板块流程 | ~4KB | 十二板块名称、快照键、前端流程展示。 |
| `js/diff-utils.js` | 🔍 Diff 工具 | ~2KB | 快照/版本字段级对比。 |
| `js/project-drawer-layout.js` | 📐 Drawer 布局 | ~5KB | 字段分区、控件类型、月度条带、批量 diff。 |
| `js/baseline-diff.js` | 🆕 baseline diff | ~2KB | 相对 `baselineVersion`（I/J）标记新增项目与字段差异。 |
| `js/import-merge.js` | 📥 导入合并 | ~2KB | 填报页按 `project_no` 合并可编辑字段。 |
| `js/xlsx-importer.js` | 📥 导入导出 | ~6KB | SheetJS xlsx 解析/导出。 |
| `js/mock-data.js` | 📦 备用示例 | ~31KB | 20 条示例；**不默认引入**。 |
| `js/components/AppLayout.js` | 🖼️ 主布局 | ~7KB | 侧栏 + 顶栏 + 路由出口；总监/群主精简导航。 |
| `js/components/ProjectDetailDrawer.js` | 📝 项目详情 Drawer | ~12KB | F 列打开；Header 标签/切换；填报折叠区；浅绿可编辑态；WIP 自动折叠；保存回写 Sheet。 |
| `js/components/ApprovalReviewSheet.js` | 📋 审批表格 | ~5KB | 总监/群主审批 Luckysheet；继承 `ProjectEditorView`。 |
| `js/components/SystemAdminSectorDock.js` | 📊 板块底栏 | ~4KB | 系统管理员十二板块进度底栏。 |
| `js/components/SystemAdminApprovalBoard.js` | 📋 板块审批板 | ~4KB | 系统管理员各板块审批状态卡片。 |
| `js/components/AlertsDrawer.js` | ⚠️ 预警抽屉 | ~6KB | 系统管理员全局预警面板；四维筛选、分页、活跃/已消除状态、点击跳转项目。 |
| `js/views/Login.js` | 🔑 登录页 | ~6KB | 6 角色卡片登录；登录后跳转填报或审批首页。 |
| `js/views/ProjectEditor.js` | 📝 项目追踪表 | ~28KB | Luckysheet；F 列 Drawer；保存/导入/筛选；变更批注。 |
| `js/views/Approval.js` | ✅ 审批流程 | ~15KB | 流程进度时间轴；总监/群主/其他角色差异化视图。 |
| `js/views/AuditLog.js` | 📋 审计日志 | ~9KB | 多维筛选 + 导出。 |
| `js/field-dictionary/FieldManager.js` | 📄 表头配置 | ~12KB | 竖向字段列表；仅 `name_cn` 可编辑（`system_admin`）。 |
| `js/views/AdminSettings.js` | ⚙️ 管理设置 | ~18KB | 周期、锁定、导入、板块管理员配置（平台用户下拉）。 |

### `test/` 测试

| 文件 | 类型 | 说明 |
|---|---|---|
| `test/lock-status.test.js` | ✅ Node 测试 | 覆盖月度锁定与可选自动解锁规则（默认关闭，开启后按解禁日开放）。 |
| `test/archive-workflow-reset.test.js` | ✅ Node 测试 | 覆盖 J 版归档后流程态归零、当前周期变更元数据清理。 |
| `test/snapshot-change-log.test.js` | ✅ Node 测试 | 覆盖 D/J 快照保留变更记录、I 版快照清理临时变更标记。 |
| `test/sector-admin-skip-director.test.js` | ✅ Node 测试 | 覆盖板块管理员兼任总监时由平台用户权限自动跳过总监初审。 |
| `test/email-reminder.test.js` | ✅ Node 测试 | 覆盖邮件提醒场景判断、收件人解析、防重逻辑、板块数据聚合。 |
| `test/initial-import-merge.test.js` | ✅ Node 测试 | 覆盖初始化导入平台合并：全匹配/未匹配/值差异/平台独有不插入/NewExistingRef 保留/混合场景/空值等价。 |

### `docs/` 文档（已整理）

| 路径 | 类型 | 说明 |
|---|---|---|
| **需求文档/** | 📋 | 产品与业务需求、规范、待办 |
| `docs/需求文档/需求文档_开发版.md` | 📋 开发需求 | **面向开发团队的完整技术需求文档**（1618 行）：代码路径、API、实现细节、角色权限、审批流程等。 |
| `docs/需求文档/需求文档_产品版.md` | 📋 产品需求 | **面向产品经理的纯业务需求文档**（1276 行）：业务流程、规则、交互设计，不含开发细节。 |
| `docs/需求文档/技术栈与开发规范.md` | 🛠 技术规范 | 开发原则、技术栈清单、CDN、Luckysheet 权限说明。 |
| `docs/需求文档/待确认项.md` | ❓ 待办 | Ethan 待拍板业务决策；已确认项迁入 `需求文档_开发版.md`。 |
| `docs/需求文档/字段字典_备份.md` | 📄 字段备份 | 原 Markdown 版 83 字段字典归档；**运行时以 `config/fields/fields.json` 为准**。 |
| `docs/需求文档/项目追踪表线上化方案.pptx` | 📊 方案 | 项目方案演示文稿。 |
| `docs/需求文档/预警抽屉功能需求文档.md` | ⚠️ 预警需求 | 系统管理员预警抽屉独立需求文档：预警类型、交互设计、持久化、手动永久忽略、API、边界条件。 |
| **设计文档/** | 🎨 | UI/UX 与页面设计规范 |
| `docs/设计文档/DESIGN.md` | 🎨 设计系统 | Wood 工程平台视觉语言、品牌色 `#007069`、组件与布局原则。 |
| `docs/设计文档/LIST_FORM.md` | 📋 列表表单规范 | 筛选、表格、分页、表单弹窗交互标准。 |
| `docs/设计文档/DASHBOARD.md` | 📊 看板规范（归档） | 原数据看板设计参考；**当前版本已移除看板页**，运营看板另立项目。 |
| `docs/设计文档/EMAIL_REMINDER.md` | 📧 邮件提醒设计 | 邮件提醒功能设计文档：SMTP 集成、定时任务、邮件模板、审计集成、配置扩展。 |
| **会议记录/** | 📝 | 业务讨论原始记录 |
| `docs/会议记录/产值报告线上化讨论_精修版.md` | 📝 会议记录 | 产值报告线上化讨论精修全文。 |

### 其他根目录文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `backup/column_analysis.py` | 🐍 分析脚本 | 字段级数据分析（可选运行）。 |
| `backup/check_formulas.py` | 🐍 维护脚本 | 公式与字段字典一致性校验（可选）。 |
| `backup/` | 📦 归档 | 历史文档备份。 |

---

## 📐 字段字典 / 表头配置模块（83 字段）

> **入口：** 系统管理员 → 侧栏 **表头配置** → `http://127.0.0.1:3000/#/fields`  
> **权限：** 仅 `system_admin`（路由守卫 + 侧栏 `adminOnly`）

### 文件一览

```
字段字典
├── config/fields/                 ← 数据与 CLI（收拢目录）
│   ├── fields.json                ← 权威源（JSON，Git 可跟踪）
│   ├── fields-data.js             ← 运行时镜像（Node / CLI）
│   └── sync-fields.py             ← 本地 CLI 同步 json → js（`npm run sync:fields`）
│
├── js/field-dictionary/
│   └── FieldManager.js            ← 表头配置 UI（竖向列表，仅 name_cn 可编辑）
│
├── css/field-dictionary.css       ← `.fm-*`、顶栏冻结与未保存提示条
│
├── 前端消费方
│   ├── js/store.js                ← `ensureFieldDictionary`、`applyFieldDictionary`
│   ├── js/field-config.js         ← COL↔key、角色可写矩阵
│   ├── js/formula-engine.js       ← auto_calc 派生字段
│   ├── js/views/ProjectEditor.js  ← Luckysheet 表头；字典变更后自动刷新
│   └── index.html                 ← 不静态引入 fields-data.js，由 bootstrap 加载
│
├── server/fields/
│   └── dictionary.js              ← readFields / writeFields / validate
│   server/index.js                ← bootstrap 含字典；GET /api/fields；PUT /api/admin/fields
│   server/load-modules.js         ← Node 侧 vm 加载 fields-data + formula-engine
│
└── 文档
    ├── docs/需求文档/需求文档_开发版.md
    └── database-schema-design.md
```

### 数据流

```
[bootstrap /api/fields] ──► Store.fieldDictionary ──► FieldConfig / ProjectEditor 表头

[FieldManager 保存] ──PUT /api/admin/fields──► server/fields/dictionary.js
                                                      │
                                                      ├─► config/fields/fields.json
                                                      └─► config/fields/fields-data.js
```

**保存后：** 填报页 Luckysheet 表头**自动**同步；Node 进程内已缓存模块需 **重启 `npm start`** 后服务端公式/权限才完全生效。

### 消费方（读 fields-data 的模块）

| 模块 | 路径 | 用途 |
|---|---|---|
| FieldConfig | `js/field-config.js` | 列映射、canEdit、Luckysheet 列宽 |
| FormulaEngine | `js/formula-engine.js` | N/O/P 等 auto_calc |
| ProjectEditor | `js/views/ProjectEditor.js` | 表头、导入列序 |
| platform-sync | `server/platform-sync.js` | system_sync 引用键列表 |
| xlsx-seed | `server/xlsx-seed.js` | Excel 列 → project 字段 |

---

## 📁 文件分类

### 核心资产（保留）
- `docs/需求文档/需求文档_开发版.md` — 面向开发的完整技术需求文档（1618 行）
- `docs/需求文档/需求文档_产品版.md` — 面向产品经理的纯业务需求文档（1276 行）
- `config/fields/fields.json` + `fields-data.js` — 83 字段定义与运行时（见上文 **字段字典模块**）
- `docs/设计文档/DESIGN.md` — UI 设计系统
- `初始数据.xlsx` — 平台首选初始化 Excel（根目录）

### 后端与数据（运行时）
- `package.json`、`server/` — Node + SQLite API（`PTRACK_PORT`、`PTRACK_INIT_XLSX` 可配置）
- `data/ptrack.sqlite` — 本地数据库
- **baseline 快照：** `meta.baselineVersion` 指向 I 或 J 版；reseed 保留历史 J，baseline 切到新 I

### 文档目录（`docs/`）

```
docs/
├── 需求文档/          需求文档（开发版/产品版）、技术规范、待确认项、字段字典备份、方案 pptx
├── 设计文档/          DESIGN（设计系统）、LIST_FORM、DASHBOARD
└── 会议记录/          产值报告线上化讨论精修版
```

### 分析产物与脚本（可保留参考）
- `column_analysis.py` — 字段级数据分析
- `database-schema.sql` / `database-schema-design.md` — 库表设计
- `config/fields/sync-fields.py` / `check_formulas.py` — 字段字典 CLI 维护（见 **字段字典模块**）

---

## 🔄 更新规则

### AGENTS.md（本文件）

**当仓库结构或文件清单发生变化时（新增、修改、删除），需要同步更新本文件：**
1. 更新文件清单表格（新增/删除/更新大小和说明）
2. 如有新类型文件，补充到对应分类与 `docs/` 子目录说明
3. 更新「最后更新」日期

### 需求文档（功能新增 / 优化时必做）

凡提出**功能上的新增或优化**，且对**业务代码**有变更（`js/`、`server/`、`css/`、`config/`、`index.html` 等），**任务完成前**须同步更新以下两份主需求文档：

| 文档 | 路径 | 更新侧重 |
|---|---|---|
| **产品版** | `docs/需求文档/需求文档_产品版.md` | 业务流程、业务规则、角色权限、页面交互、用户可见行为；**不写**代码路径与 API |
| **开发版** | `docs/需求文档/需求文档_开发版.md` | 实现状态、文件路径、API、数据结构、与产品版对应的 § 编号及技术细节 |

**同步 checklist：**
1. 产品版：用户故事 / 流程 / 交互 / 规则是否准确、可验收
2. 开发版：实现文件、接口、配置项、边界条件是否与代码一致
3. 两文档顶部 **「最后更新」** 日期改为当天
4. 若仅内部重构、无行为变化，开发版可一行说明，产品版可不改

**可不更新需求文档的情况：** 纯文案/样式微调、依赖升级、注释、测试脚本、与本系统功能无关的文档整理。

**自动化提醒：** 项目已配置 Cursor Hook（`.cursor/hooks.json`）——编辑业务代码后 Agent 会收到同步提醒；会话结束前若两文档未随代码一起更新，会追加 follow-up。详见 `.cursor/hooks/remind-requirements-docs.js`。

---
---

---
