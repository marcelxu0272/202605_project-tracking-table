# 📁 项目追踪表线上化 — 目录说明

> **项目目标：** 将金山中心（S520）项目执行跟踪 Excel 表的填写、汇总、统计与展示线上化  
> **最后更新：** 2026-05-19

---

## 📋 文件清单

| 文件 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `package.json` | 📦 Node 配置 | ~0.5KB | 依赖 `express`、`better-sqlite3`、`xlsx`；`npm start` 启动 API + 静态站点。 |
| `server/index.js` | 🖥 服务端入口 | ~8KB | Express：`/api/*` 读写 SQLite，托管项目根目录静态文件；含 `POST /api/pm-submissions/submit` 与 `receive` 端点。 |
| `server/db.js` | 🗃 SQLite 封装 | ~6KB | 库路径 `data/ptrack.sqlite`；projects / audit_log / snapshots / meta；含 `getPmSubmissions` / `setPmSubmissions`。 |
| `server/load-modules.js` | 🔧 模块加载 | ~1KB | 在 Node 中 vm 执行 `fields-data.js`、`formula-engine.js`、`field-config.js`。 |
| `server/xlsx-seed.js` | 📥 服务端解析 | ~3KB | xlsx → projects（与 `js/xlsx-importer.js` 对齐）。 |
| `初始数据.xlsx` | 📊 初始化数据 | 视文件 | 置于项目根目录；库为空时自动导入；管理页可「从初始 Excel 恢复」。 |
| `data/ptrack.sqlite` | 🗄 运行时库 | 自动生成 | SQLite 数据文件（`.gitignore`）；种子来源见上或 S520 源表。 |
| `字段字典.md` | 📄 核心文档 | ~15KB | **本项目的核心参考文档**。完整梳理了 Excel 源表的全部 83 个字段，按 11 个功能分区组织，包含字段名（中英文）、数据类型、枚举值/示例、说明。末尾附带数据特征统计和线上化建议。 |
| `线上化需求.md` | 📋 需求文档 | ~7KB | 线上化系统的需求记录。已包含角色定义、PM提交与板块接收（§2.11）、双轨填报、实时刷新+锁定期、动态时间窗、数据变更审计、审批流与版本快照、项目准入机制、动态年份与历史归档机制等核心逻辑。 |
| `技术栈与开发规范.md` | 🛠 技术规范 | ~4KB | 定义了项目的开发原则、技术栈清单、CDN 引入示例、项目结构建议及注意事项。包含 Luckysheet 在线表格组件的引入与权限控制说明。 |
| `产值报告线上化讨论_精修版.md` | 📝 会议记录 | ~4KB | 精修版会议记录，已清理无关内容、修正识别错误（CRM→CRB）、梳理对话逻辑。 |
| `产值报告线上化讨论_关键要点.md` | 📌 要点提取 | ~2KB | 从讨论中提炼的决策要点、业务规则、体验设计及待确认问题。供 Ethan 选择性采纳。 |
| `S520_金山中心_项目执行跟踪详细数据2026年05月.xlsx` | 📊 原始数据 | 822KB | Excel 源文件，Sheet = `S520`，约 1220 条项目记录，83 列。**无「初始数据.xlsx」时服务端可选作自动导入文件。** |
| `column_analysis.py` / `column_analysis.txt` | 🐍📝 分析产物 | ~20KB | 字段级数据分析脚本及输出结果，用于理解每个字段的数据特征（唯一值、样本等）。 |
| `excel_structure.txt` | 📝 结构导出 | ~5KB | Excel 表结构快照，记录了分区标题行、字段标题行及样本数据行内容。 |
| `index.html` | 🌐 应用入口 | ~3KB | 全 CDN 引入（Vue2/ElementUI/ECharts/SheetJS/Tailwind）。**通过 `npm start` 访问 http://127.0.0.1:3000/ 与 API 同域。** |
| `css/style.css` | 🎨 全局样式 | ~14KB | 品牌色变量、diff 高亮、填报期 badge、金额等宽字体、卡片/看板/时间轴等全局样式。 |
| `js/formatters.js` | 🔧 格式化工具 | ~4KB | 金额千分位（1,234,567.89）、等宽数字、百分比、日期等格式化函数。 |
| `js/formula-engine.js` | ⚙️ 公式引擎 | ~8KB | 83 字段中所有 auto_calc 字段的计算逻辑（O/Q/R/S/U/V/W/X/Z/AB~AF/AG~AL/AP/AQ），含汇总函数。 |
| `js/field-config.js` | 🔐 字段权限 | ~7KB | 基于 fields-data.js 扩展角色权限矩阵，定义各角色在不同锁定期的字段可写范围。 |
| `js/mock-data.js` | 📦 备用示例 | ~31KB | 20 条约示例数据；**不再默认引入**；仅供离线对照时手动加 `<script>`。 |
| `js/store.js` | 🗄️ 状态管理 | ~12KB | Vue.observable；**业务数据经 `/api` 同步至 SQLite**；含 `pmSubmissions`、`submitPmReporting`、`receivePmSubmission` 等 PM 提交流程方法。 |
| `js/xlsx-importer.js` | 📥 导入导出 | ~6KB | SheetJS 驱动的 xlsx 解析导入器，支持初始数据导入和填报数据导出。 |
| `js/import-merge.js` | 📥 导入合并 | ~2KB | 按 `project_no` 合并 Excel 导入：仅覆盖当前角色可编辑字段，供填报页「上传导入」使用。 |
| `js/router.js` | 🔀 路由配置 | ~2KB | Vue Router hash 模式，6 条路由 + 登录守卫 + admin 权限守卫。 |
| `js/app.js` | 🚀 应用初始化 | ~2KB | `Store.init()` 后再挂载 Vue；失败提示启动 Node 服务。 |
| `js/components/AppLayout.js` | 🖼️ 主布局 | ~7KB | 侧边栏（深色）+ 顶栏（用户/角色/审批状态）+ 内容区路由出口。 |
| `js/views/Login.js` | 🔑 登录页 | ~6KB | 6 个角色卡片登录，支持角色内用户切换，直接写入 Store。 |
| `js/views/Dashboard.js` | 📊 数据看板 | ~12KB | KPI 卡片（4项）+ 月度完成趋势（折线+柱图）+ WIP 账龄饼图 + 开票回款对比 + WIP 预警列表。 |
| `js/views/ProjectEditor.js` | 📝 填报表格 | ~22KB | Luckysheet 填报（默认）；工具栏含保存、上传导入（可编辑字段合并）、历史版本只读预览、导出与提交；侧栏折叠时表格区自适应宽度；PM 过滤与板块待接收面板。 |
| `js/views/Approval.js` | ✅ 审批流程 | ~13KB | 四节点时间轴（Draft→Approve1→Approve2→J版）+ 版本快照列表 + diff 对比弹窗。 |
| `js/views/AuditLog.js` | 📋 审计日志 | ~9KB | 变更历史表格，支持日期范围/操作人/项目/字段多维筛选，可导出 xlsx。 |
| `js/views/AdminSettings.js` | ⚙️ 管理设置 | ~17KB | 填报周期、锁定/解锁、Excel 导入、从初始 Excel 恢复 SQLite、用户列表。 |

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
