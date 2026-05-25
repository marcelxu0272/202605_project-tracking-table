# 📁 项目追踪表线上化 — 目录说明

> **项目目标：** 将金山中心（S520）项目执行跟踪 Excel 表的填写、汇总、统计与展示线上化  
> **最后更新：** 2026-05-21

---

## 📋 文件清单

### 应用与运行时

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `package.json` | 📦 Node 配置 | ~0.5KB | 依赖 `express`、`better-sqlite3`、`xlsx`；`npm start` 启动 API + 静态站点；`npm run seed:prior-month` 生成上月对比快照。 |
| `index.html` | 🌐 应用入口 | ~3KB | CDN + 业务脚本；`npm start` → http://127.0.0.1:3000/ |
| `fields.json` | 📄 字段定义 | ~35KB | **83 字段结构化定义**（分区、类型、枚举、来源）；与 `fields-data.js` 同步，为字段管理与线上一致性之源。 |
| `fields-data.js` | 📄 字段运行时 | ~35KB | 由 `fields.json` 生成的 JS 模块；供前后端 `FieldConfig` / 公式引擎加载。 |
| `field-manager.html` | 🔧 字段管理页 | ~15KB | 可视化维护 `fields.json`（独立页面）。 |
| `初始数据.xlsx` | 📊 初始化数据 | 视文件 | 置于项目根目录；库为空时自动导入；管理页可「从初始 Excel 恢复」。 |
| `S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx` | 📊 原始数据 | 822KB | Excel 源文件，Sheet = `S520`，约 1220 条。**无「初始数据.xlsx」时可选作自动导入。** |
| `data/ptrack.sqlite` | 🗄 运行时库 | 自动生成 | SQLite 数据文件（`.gitignore`）。 |
| `database-schema.sql` | 🗃 Schema SQL | ~8KB | 数据库表结构 DDL。 |
| `database-schema-design.md` | 📝 Schema 说明 | ~12KB | 表设计说明，关联 `fields.json` 与需求文档。 |

### `server/` 后端

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `server/index.js` | 🖥 服务端入口 | ~9KB | Express：`/api/*` 读写 SQLite，托管静态文件；PM 提交/接收；板块/J 版归档等。 |
| `server/db.js` | 🗃 SQLite 封装 | ~6KB | 库路径 `data/ptrack.sqlite`；projects / audit_log / snapshots / meta；bootstrap 含 `priorMonthSnapshotVersion`。 |
| `server/load-modules.js` | 🔧 模块加载 | ~1KB | 在 Node 中 vm 执行 `fields-data.js`、`formula-engine.js`、`field-config.js`。 |
| `server/xlsx-seed.js` | 📥 服务端解析 | ~3KB | xlsx → projects（与 `js/xlsx-importer.js` 对齐）。 |
| `server/prior-month-snapshot.js` | 📅 上月快照 | ~3KB | 从当前库剔除部分项目生成 `Month:YYYY-MM` 快照，供「新增项目」对比。 |
| `server/seed-prior-month-snapshot.js` | 🔧 CLI | ~1KB | `npm run seed:prior-month [剔除条数]`，默认剔除 48 条。 |
| `server/platform-sync.js` | 🔄 平台同步 | ~4KB | 从中台/CRB/财务合并 `system_sync` 字段；每日定时 + 管理员手动触发。 |
| `server/platform-sync-stub.js` | 🔧 同步 stub | ~2KB | 开发期平台快照；待 `PTRACK_PLATFORM_API_URL` 替换。 |
| `server/sector-workflow.js` | 🔀 板块流程 | ~4KB | 十二板块注册、快照键、流程状态（服务端）。 |
| `server/dev-reset-seed.js` | 🔧 开发重置 | ~3KB | 重置为初始状态并重建上月对比快照；调用 `alert-demo-seed` 注入预警演示数据。 |
| `server/alert-demo-seed.js` | 🔧 预警演示 | ~3KB | 重导/重置后为 4 条项目注入 R/S、完成额 vs 工时预警场景及演示工时。 |
| `server/patch-init-xlsx-alerts.js` | 🔧 初始化补丁 | ~2KB | `npm run patch:init-alerts` 将预警演示字段写回 `初始数据.xlsx`。 |

### `css/` 样式

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `css/style.css` | 🎨 全局样式 | ~17KB | 品牌色 CSS 变量、变更字段色、侧栏、Luckysheet、**项目详情 Drawer** 样式。 |
| `css/element-theme.css` | 🎨 Element 主题 | ~6KB | 覆盖 Element UI 默认蓝色，对齐 `docs/设计文档/DESIGN.md` 品牌色 `#007069`。 |

### `js/` 前端

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `js/app.js` | 🚀 应用初始化 | ~2KB | `Store.init()` 后挂载 Vue。 |
| `js/router.js` | 🔀 路由配置 | ~2KB | Hash 路由 + 登录/管理员守卫。 |
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
| `js/project-month-diff.js` | 🆕 新增项目 | ~1KB | 对比 `Month:YYYY-MM` 快照，设置 `_added_this_month`。 |
| `js/import-merge.js` | 📥 导入合并 | ~2KB | 填报页按 `project_no` 合并可编辑字段。 |
| `js/xlsx-importer.js` | 📥 导入导出 | ~6KB | SheetJS xlsx 解析/导出。 |
| `js/mock-data.js` | 📦 备用示例 | ~31KB | 20 条示例；**不默认引入**。 |
| `js/components/AppLayout.js` | 🖼️ 主布局 | ~7KB | 侧栏 + 顶栏 + 路由出口；总监/群主精简导航。 |
| `js/components/ProjectDetailDrawer.js` | 📝 项目详情 Drawer | ~12KB | F 列打开；Header 标签/切换；填报折叠区；浅绿可编辑态；WIP 自动折叠；保存回写 Sheet。 |
| `js/components/ApprovalReviewSheet.js` | 📋 审批表格 | ~5KB | 总监/群主审批 Luckysheet；继承 `ProjectEditorView`。 |
| `js/components/SystemAdminSectorDock.js` | 📊 板块底栏 | ~4KB | 系统管理员十二板块进度底栏。 |
| `js/components/SystemAdminApprovalBoard.js` | 📋 板块审批板 | ~4KB | 系统管理员各板块审批状态卡片。 |
| `js/views/Login.js` | 🔑 登录页 | ~6KB | 6 角色卡片登录。 |
| `js/views/Dashboard.js` | 📊 数据看板 | ~12KB | KPI + 图表 + WIP 预警。 |
| `js/views/ProjectEditor.js` | 📝 填报表格 | ~28KB | Luckysheet；F 列 Drawer；保存/导入/筛选；变更批注。 |
| `js/views/Approval.js` | ✅ 审批流程 | ~15KB | 流程进度时间轴；总监/群主/其他角色差异化视图。 |
| `js/views/AuditLog.js` | 📋 审计日志 | ~9KB | 多维筛选 + 导出。 |
| `js/views/AdminSettings.js` | ⚙️ 管理设置 | ~18KB | 周期、锁定、导入、上月快照、用户列表。 |

### `docs/` 文档（已整理）

| 路径 | 类型 | 说明 |
|---|---|---|
| **需求文档/** | 📋 | 产品与业务需求、规范、待办 |
| `docs/需求文档/线上化需求.md` | 📋 主需求 | **持续维护的核心需求文档**：角色、PM 提交、Drawer、审批、变更批注、上月快照、权限矩阵等。 |
| `docs/需求文档/技术栈与开发规范.md` | 🛠 技术规范 | 开发原则、技术栈清单、CDN、Luckysheet 权限说明。 |
| `docs/需求文档/待确认项.md` | ❓ 待办 | Ethan 待拍板业务决策；已确认项迁入 `线上化需求.md`。 |
| `docs/需求文档/字段字典_备份.md` | 📄 字段备份 | 原 Markdown 版 83 字段字典归档；**运行时以 `fields.json` 为准**。 |
| `docs/需求文档/项目追踪表线上化方案.pptx` | 📊 方案 | 项目方案演示文稿。 |
| **设计文档/** | 🎨 | UI/UX 与页面设计规范 |
| `docs/设计文档/DESIGN.md` | 🎨 设计系统 | Wood 工程平台视觉语言、品牌色 `#007069`、组件与布局原则。 |
| `docs/设计文档/LIST_FORM.md` | 📋 列表表单规范 | 筛选、表格、分页、表单弹窗交互标准。 |
| `docs/设计文档/DASHBOARD.md` | 📊 看板规范 | Dashboard 数字格式、单位、图表与交互注意事项。 |
| **会议记录/** | 📝 | 业务讨论原始记录 |
| `docs/会议记录/产值报告线上化讨论_精修版.md` | 📝 会议记录 | 产值报告线上化讨论精修全文。 |

### 其他根目录文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `column_analysis.py` | 🐍 分析脚本 | 字段级数据分析（可选运行）。 |
| `sync-fields.py` / `check_formulas.py` | 🐍 维护脚本 | 字段同步、公式校验辅助脚本。 |
| `backup/` | 📦 归档 | 历史文档备份（如旧版会议记录）。 |

---

## 📁 文件分类

### 核心资产（保留）
- `docs/需求文档/线上化需求.md` — 需求持续记录（**主文档**）
- `fields.json` / `fields-data.js` — 83 字段定义与运行时
- `docs/设计文档/DESIGN.md` — UI 设计系统
- `S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx` — 原始数据源
- `初始数据.xlsx` — 平台首选初始化 Excel（根目录）

### 后端与数据（运行时）
- `package.json`、`server/` — Node + SQLite API（`PTRACK_PORT`、`PTRACK_INIT_XLSX` 可配置）
- `data/ptrack.sqlite` — 本地数据库
- **上月对比快照：** 版本键 `Month:2026-04`（报告月 `2026-05` 时）；管理页或 `npm run seed:prior-month` 生成

### 文档目录（`docs/`）

```
docs/
├── 需求文档/          线上化需求、技术规范、待确认项、字段字典备份、方案 pptx
├── 设计文档/          DESIGN（设计系统）、LIST_FORM、DASHBOARD
└── 会议记录/          产值报告线上化讨论精修版
```

### 分析产物与脚本（可保留参考）
- `column_analysis.py` — 字段级数据分析
- `database-schema.sql` / `database-schema-design.md` — 库表设计

---

## 🔄 更新规则

**当此目录下的文件发生变化时（新增、修改、删除），需要同步更新本文件：**
1. 更新文件清单表格（新增/删除/更新大小和说明）
2. 如有新类型文件，补充到对应分类与 `docs/` 子目录说明
3. 更新「最后更新」日期
