# 📁 项目追踪表线上化 — 目录说明

> **项目目标：** 将金山中心（S520）项目执行跟踪 Excel 表的填写、汇总、统计与展示线上化  
> **最后更新：** 2026-05-20

---

## 📋 文件清单

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `package.json` | 📦 Node 配置 | ~0.5KB | 依赖 `express`、`better-sqlite3`、`xlsx`；`npm start` 启动 API + 静态站点；`npm run seed:prior-month` 生成上月对比快照。 |
| `server/index.js` | 🖥 服务端入口 | ~9KB | Express：`/api/*` 读写 SQLite，托管静态文件；PM 提交/接收；`POST /api/admin/seed-prior-month-snapshot` 生成上月归档快照。 |
| `server/db.js` | 🗃 SQLite 封装 | ~6KB | 库路径 `data/ptrack.sqlite`；projects / audit_log / snapshots / meta；bootstrap 含 `priorMonthSnapshotVersion`。 |
| `server/load-modules.js` | 🔧 模块加载 | ~1KB | 在 Node 中 vm 执行 `fields-data.js`、`formula-engine.js`、`field-config.js`。 |
| `server/xlsx-seed.js` | 📥 服务端解析 | ~3KB | xlsx → projects（与 `js/xlsx-importer.js` 对齐）。 |
| `server/prior-month-snapshot.js` | 📅 上月快照 | ~3KB | 从当前库剔除部分项目生成 `Month:YYYY-MM` 快照，供「新增项目」对比。 |
| `server/platform-sync.js` | 🔄 平台同步 | ~4KB | 从中台/CRB/财务合并 `system_sync` 字段；每日定时 + 管理员手动触发；写 `systemDataSyncedAt`。 |
| `server/platform-sync-stub.js` | 🔧 同步 stub | ~2KB | 开发期平台快照（优先读 xlsx，否则克隆库微调）；待 `PTRACK_PLATFORM_API_URL` 替换。 |
| `server/seed-prior-month-snapshot.js` | 🔧 CLI | ~1KB | `npm run seed:prior-month [剔除条数]`，默认剔除 48 条。 |
| `初始数据.xlsx` | 📊 初始化数据 | 视文件 | 置于项目根目录；库为空时自动导入；管理页可「从初始 Excel 恢复」。 |
| `data/ptrack.sqlite` | 🗄 运行时库 | 自动生成 | SQLite 数据文件（`.gitignore`）；种子来源见上或 S520 源表。 |
| `字段字典.md` | 📄 核心文档 | ~15KB | **本项目的核心参考文档**。完整梳理了 Excel 源表的全部 83 个字段，按 11 个功能分区组织，包含字段名（中英文）、数据类型、枚举值/示例、说明。末尾附带数据特征统计和线上化建议。 |
| `线上化需求.md` | 📋 需求文档 | ~14KB | 需求记录：角色、PM 提交、审批决策界面、流程进度、变更批注、上月快照等。 |
| `技术栈与开发规范.md` | 🛠 技术规范 | ~4KB | 开发原则、技术栈清单、CDN 引入、Luckysheet 权限说明。 |
| `产值报告线上化讨论_精修版.md` | 📝 会议记录 | ~4KB | 精修版会议记录。 |
| `产值报告线上化讨论_关键要点.md` | 📌 要点提取 | ~2KB | 决策要点与业务规则。 |
| `S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx` | 📊 原始数据 | 822KB | Excel 源文件，Sheet = `S520`，约 1220 条。**无「初始数据.xlsx」时可选作自动导入。** |
| `column_analysis.py` / `column_analysis.txt` | 🐍📝 分析产物 | ~20KB | 字段级数据分析。 |
| `excel_structure.txt` | 📝 结构导出 | ~5KB | 表结构快照。 |
| `index.html` | 🌐 应用入口 | ~3KB | CDN + 业务脚本；`npm start` → http://127.0.0.1:3000/ |
| `css/style.css` | 🎨 全局样式 | ~15KB | 品牌色、变更字段色（`--color-changed-field-*`）、图例、侧栏、工具栏。 |
| `js/formatters.js` | 🔧 格式化工具 | ~4KB | 金额、日期、百分比等。 |
| `js/formula-engine.js` | ⚙️ 公式引擎 | ~8KB | 83 字段 `auto_calc` 逻辑与汇总。 |
| `js/field-config.js` | 🔐 字段权限 | ~7KB | 角色 × 锁定期字段可写矩阵。 |
| `js/change-meta.js` | 📝 变更批注 | ~7KB | `_field_change_log` 按列追加数组；批注 `【角色】旧→新` 多行；`CHANGED_FIELD_STYLE` / `EDITABLE_FIELD_STYLE`。 |
| `js/project-month-diff.js` | 🆕 新增项目 | ~1KB | 对比 `Month:YYYY-MM` 快照，设置 `_added_this_month`。 |
| `js/import-merge.js` | 📥 导入合并 | ~2KB | 填报页按 `project_no` 合并可编辑字段。 |
| `js/mock-data.js` | 📦 备用示例 | ~31KB | 20 条示例；**不默认引入**。 |
| `js/store.js` | 🗄️ 状态管理 | ~12KB | Vue.observable + `/api`；`seedPriorMonthSnapshot` 等。 |
| `js/xlsx-importer.js` | 📥 导入导出 | ~6KB | SheetJS xlsx 解析/导出。 |
| `js/router.js` | 🔀 路由配置 | ~2KB | Hash 路由 + 登录/管理员守卫。 |
| `js/app.js` | 🚀 应用初始化 | ~2KB | `Store.init()` 后挂载 Vue。 |
| `js/components/AppLayout.js` | 🖼️ 主布局 | ~7KB | 侧栏（底部折叠/展开）+ 顶栏 + 路由出口；板块总监/群主仅看板+审批导航。 |
| `js/components/ApprovalReviewSheet.js` | 📋 审批表格 | ~5KB | 总监/群主审批页：本板块当月全部项目 + 全部/新增/有变更筛选；待办节点内可编辑列；无 Luckysheet 工具栏。 |
| `js/views/Login.js` | 🔑 登录页 | ~6KB | 6 角色卡片登录。 |
| `js/views/Dashboard.js` | 📊 数据看板 | ~12KB | KPI + 图表 + WIP 预警。 |
| `js/views/ProjectEditor.js` | 📝 填报表格 | ~22KB | Luckysheet 默认；保存/导入/历史版本；变更批注；新增项目高亮。 |
| `js/views/Approval.js` | ✅ 审批流程 | ~15KB | 流程进度时间轴（三态）；总监/群主只读 Luckysheet；其他角色快照+Diff。 |
| `js/views/AuditLog.js` | 📋 审计日志 | ~9KB | 多维筛选 + 导出。 |
| `js/views/AdminSettings.js` | ⚙️ 管理设置 | ~18KB | 周期、锁定、导入、**生成上月对比快照**、用户列表。 |

---

## 📁 文件分类

### 核心资产（保留）
- `字段字典.md` — 线上化需求的基础文档
- `线上化需求.md` — 需求持续记录文档
- `S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx` — 原始数据源
- `初始数据.xlsx` — 平台首选初始化 Excel（根目录）

### 后端与数据（运行时）
- `package.json`、`server/` — Node + SQLite API（`PTRACK_PORT`、`PTRACK_INIT_XLSX` 可配置）
- `data/ptrack.sqlite` — 本地数据库
- **上月对比快照：** 版本键 `Month:2026-04`（报告月 `2026-05` 时）；管理页或 `npm run seed:prior-month` 生成

### 会议记录与要点（保留）
- `产值报告线上化讨论_精修版.md` — 精修后的完整会议记录
- `产值报告线上化讨论_关键要点.md` — 提炼的决策要点与业务规则

### 技术规范（保留）
- `技术栈与开发规范.md` — 开发原则、技术栈清单、项目结构建议

### 分析产物（可保留参考）
- `column_analysis.py` / `column_analysis.txt` — 字段级数据分析
- `excel_structure.txt` — 表结构快照

---

## 🔄 更新规则

**当此目录下的文件发生变化时（新增、修改、删除），需要同步更新本文件：**
1. 更新文件清单表格（新增/删除/更新大小和说明）
2. 如有新类型文件，补充到对应分类
3. 更新「最后更新」日期
