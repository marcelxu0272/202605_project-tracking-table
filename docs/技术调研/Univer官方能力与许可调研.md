# Univer 官方能力与许可调研

> 调研日期：2026-07-27  
> 资料范围：仅 Univer 官方文档、Univer 官方 GitHub 仓库及其许可证。  
> 调研目的：判断 Univer 免费/开源版本能否承接项目当前 Luckysheet 的核心能力，并明确 Pro、商业许可和自建能力边界。  
> 注意：本文是技术与产品能力判断，不构成法律意见或采购报价；正式采购价格应以 Univer 当期书面报价和商业许可协议为准。

## 1. 结论摘要

### 1.1 核心结论

**免费开源版可以覆盖当前项目绝大部分表格编辑与交互能力，但不能“零改造、纯免费”完整替代现有方案。**

免费开源版可覆盖：

- 单元格值、公式、常用样式、数字格式；
- 合并单元格、冻结行列、隐藏/显示行列；
- 筛选、排序、复制粘贴；
- 数据验证、条件格式；
- 工作簿/工作表/区域级只读与保护；
- 单元格评论/回复的前端能力；
- 浏览器端快照读写、Facade API、事件和命令扩展；
- Vue 2 宿主集成，以及无构建的 UMD/CDN 集成。

不能由官方免费开源版直接、完整覆盖的关键项：

1. **官方 XLSX 导入/导出是 Univer Pro，并要求 Univer Server。** 未授权模式仅供评估：带水印，导入文件不超过 1 MB，导出不超过 10,000 个单元格。对于 83 列项目追踪表，约 121 条数据行就会超过 10,000 个单元格，因此未授权 Pro 不适合作为生产导出方案。
2. **实时多人协同和编辑历史属于 Pro/商业能力，并依赖 Univer Server。** 未授权协同最多同时 5 个协作文档、每文档 3 名协作者，且有水印。
3. **开源权限模块提供权限点、保护规则和 UI，不提供项目所需的组织、角色、规则持久化。** 官方明确要求接入方自行实现权限规则存储和组织结构集成；本项目仍需由现有 Express/SQLite、角色和锁定周期逻辑作为权威权限来源。
4. **开源评论提供评论、回复、解决、删除和事件，但协同场景的远程评论数据源属于 `@univerjs-pro/thread-comment-datasource`。** 非协同使用时，应继续由本项目后端自行持久化批注/变更说明，不能只依赖编辑器内存状态。
5. **官方公开的高性能数据主要是 Univer Pro 报告，不能直接当作开源版性能承诺。** 开源版采用 Canvas、支持 Web Worker 公式计算，具备良好技术基础，但仍需用本项目真实的 83 列、实际项目行数、样式/公式/批注密度进行压测。

### 1.2 对当前项目的推荐判断

| 方案 | 能否上线 | 判断 |
|---|---:|---|
| 开源 Univer + 保留现有 Express/SQLite + 自建数据/权限/批注持久化 + 继续使用现有 SheetJS 导入导出适配层 | **可以，推荐先做 PoC** | 不采购 Pro 也能满足当前“单人/分角色填报、服务端保存、审批、导入导出”的主要路径，但 XLSX 适配工作量较大，必须验证格式保真 |
| 开源 Univer + 未授权 Univer Pro 导入导出 | **不适合生产** | 1 MB 导入、10,000 单元格导出、水印限制过严 |
| Univer Pro + 自建 Univer Server | **能力最完整** | 适合需要高保真 XLSX、实时多人协同、编辑历史、官方服务端转换与大规模性能能力的目标形态；需商业许可、服务器组件和运维投入 |
| 仅开源 Univer，不保留/重做现有后端适配 | **不能满足** | 权限、组织角色、锁定期、审批、审计、持久化和 XLSX 都不是开源编辑器自动提供的完整业务方案 |

如果当前正式需求仍是“按角色分时填报、提交审批、SQLite 保存”，而**不要求同一工作簿多人实时共同编辑**，则免费开源版在许可证边界内总体可行。最大的迁移风险不是基础编辑，而是：

- Luckysheet 数据结构与 Univer `IWorkbookData`/Facade API 的全面替换；
- 当前自研 XLSX 导出的样式、公式、合并、隐藏列、列宽等保真迁移；
- 角色×锁定期×字段可写矩阵与 Univer 保护规则的映射；
- 变更批注、事件监听、保存时机和快照序列化的重写。

## 2. 许可与产品边界

### 2.1 开源版

Univer 官方 GitHub 仓库明确：

- 仓库中的开源核心与第一方 OSS 插件使用 **Apache License 2.0**；
- 开源能力包括核心 SDK、插件系统、渲染引擎、公式引擎、Facade API、主题、多语言、框架适配；
- Sheets 开源能力包括核心编辑、公式、数字格式、筛选/排序、数据验证、条件格式、批注/评论、表格、超链接、绘图、查找替换；
- OSS 包可以独立使用，Pro 是可选的商业扩展层。

Apache-2.0 一般允许在遵守许可证和通知等条件下进行商业使用和修改；正式交付仍应保留许可证/NOTICE 并由法务按实际分发方式确认。

来源：

- [Univer 官方 GitHub README：Open Source and Pro、License](https://github.com/dream-num/univer)（获取：2026-07-27）
- [Univer 官方 Apache-2.0 LICENSE](https://github.com/dream-num/univer/blob/dev/LICENSE)（获取：2026-07-27）

### 2.2 Univer Pro / 商业版

官方将以下 Sheets 能力列为 Pro/商业扩展：

- 实时协同、编辑历史；
- 官方导入导出、打印；
- 图表、透视表、迷你图；
- 高级公式引擎；
- Shapes、Outline、数据连接器；
- 服务端计算及 Pro Server 组件。

Pro 使用 Univer Commercial License。官方文档说明：无许可证可以评估，但有水印、文件大小、协同配额等限制；生产环境建议购买许可证。官方公开文档没有给出可据此锁定的固定价格，本次不臆测报价。

来源：

- [Univer Pro Overview](https://docs.univer.ai/guides/pro)（获取：2026-07-27）
- [Univer License](https://docs.univer.ai/guides/pro/license)（获取：2026-07-27）
- [官方 GitHub README：Open Source and Pro 能力表](https://github.com/dream-num/univer#-open-source-and-pro)（获取：2026-07-27）

### 2.3 未授权 Pro 的明确限制

| Pro 能力 | 未授权限制 |
|---|---|
| 打印 | 水印；每次不超过 3 页 |
| 协同编辑 | 水印；同时最多 5 个协作文档；每文档最多 3 名协作者 |
| 导入导出 | 水印；导入文件不超过 1 MB；导出不超过 10,000 个单元格 |

来源：[Upgrade to Pro：Unlicensed Limitations](https://docs.univer.ai/guides/docs/getting-started/pro)（获取：2026-07-27）

## 3. 能力逐项评估

标记说明：

- **OSS**：官方开源包提供；
- **OSS + 自建**：编辑器能力免费，但业务持久化/组织/权限等须本项目实现；
- **Pro**：官方 Pro 包或服务端商业能力；
- **替代实现**：可绕开 Pro，但不是官方开源版原生等价能力。

| 原 Luckysheet 需求 | Univer 官方能力 | 版本边界 | 对当前项目的判断 |
|---|---|---|---|
| 单元格值与公式 | 开源公式引擎；官方当前列出 528 个函数；支持自定义函数、计算事件和循环迭代配置 | OSS | 满足常用计算。迁移前需对当前实际公式逐一做兼容清单，尤其 Excel 特殊函数、动态数组、公式缓存值 |
| 样式与数字格式 | 开源核心包含格式、数字格式、条件格式；Facade/快照可操作数据 | OSS | 原则上满足。需验证现有表头、边框、字体、填充、对齐、换行、列宽/行高的映射 |
| 合并单元格 | 核心菜单含合并；Facade 示例使用 `FRange.merge()` / `breakApart()` | OSS | 满足 |
| 冻结行列 | `IWorksheetData.freeze` 和 `FWorksheet.setFreeze`、`setFrozenRows/Columns` | OSS | 满足 |
| 隐藏列/行 | `hideColumn(s)`、`showColumns` 等 Facade API；核心 UI 也有隐藏/显示菜单 | OSS | 满足；可用于继续隐藏不导出列，但导出侧要单独处理 |
| 整表只读 | 工作簿权限提供 viewer/read-only；工作表提供 `readOnly` 模式 | OSS + 自建 | UI 阻断可满足，服务端仍必须做权限校验 |
| 字段/单元格级可写 | 区域保护规则支持编辑、查看、删除保护和管理协作者；工作表权限点覆盖编辑、插入、排序、筛选等 | OSS + 自建 | 可映射当前“角色×锁定期×字段”矩阵；需要自行生成/更新保护区，并避免 83 列×大量行产生过多细碎规则 |
| 用户与组织权限 | 官方明确：权限列表、用户信息、权限规则持久化和组织结构需要接入方自行实现 | OSS + 自建 | 继续使用当前角色、板块管理员和后端鉴权，不把 Univer 前端保护当安全边界 |
| 数据验证 | 支持数字、整数、文本长度、日期、复选框、单/多选下拉、自定义公式；可 STOP/WARNING/INFO | OSS | 能覆盖下拉和输入约束；当前 WIP/存量/预测总额等跨字段业务校验仍建议保留现有业务模块 |
| 评论/批注 | 评论、回复、更新、删除、解决、查询和事件；Server Optional | OSS + 自建；协同数据源为 Pro | 能承载普通单元格评论。当前 `_field_change_log` 不能直接假设等价，应确定继续作为业务元数据还是转换为 Univer 评论 |
| 筛选 | 独立开源 Filter 插件，支持条件筛选及 Facade API | OSS | 满足 |
| 排序 | 独立开源 Sort 插件，支持工作表/区域、单列/多列排序及前后事件 | OSS | 满足；要继续限制排序对业务主键、保存顺序的影响 |
| 复制粘贴 | 支持外部应用↔Univer、Univer 内部复制粘贴；选择性粘贴值/格式/列宽/公式等 | OSS | 满足；Clipboard API 要求 HTTPS 安全上下文，Firefox 主要依赖快捷键粘贴 |
| XLSX 导入 | 官方 `.xlsx` 转 Univer 的 import API 由 Pro/Univer Server 提供 | Pro；或替代实现 | 免费生产必须保留/重写 SheetJS→`IWorkbookData`/Facade 适配；官方也允许开发者自行把文件解析为 Univer 数据结构，但不提供免费高保真转换 |
| XLSX 导出 | 官方 `.xlsx` export API 由 Pro/Univer Server 提供 | Pro；或替代实现 | 当前 `luckysheet-xlsx-export.js` 不能复用数据结构，需重写为 Univer snapshot→SheetJS；这是免费方案最大工作项 |
| 浏览器端保存 | `FWorkbook.save()`/快照可取得工作簿数据 | OSS + 自建 | 可继续 POST 到现有 API；必须通过 Facade/命令修改数据，不能直接改 snapshot 期待 UI 自动更新 |
| 实时多人协同 | 协同插件依赖 Univer Server，文档按 `unitId` 保存并实时同步 | Pro/商业 | 当前若无实时协同需求可不引入；若正式要求多人同时编辑，应采购并部署 Pro Server |
| 编辑历史 | 官方列为 Pro | Pro/商业 | 当前 I/D/J 快照与审计仍由本项目实现；不能把它等同于 Pro 的细粒度编辑历史 |
| 大数据与性能 | 开源使用 Canvas、公式可放到 Web Worker；官方 Pro 有百万级性能报告 | OSS 基础；Pro 有增强和公开测试 | 对 83 列表通常有潜力优于 Luckysheet，但官方 Pro 数据不能外推为 OSS 承诺；必须实测真实数据 |
| Vue 2 集成 | 官方提供 Vue 2 集成示例：`mounted` 初始化，销毁钩子 dispose；Webpack 4 可能要补 alias | OSS | 满足当前 Vue 2 架构，但 Univer UI 内部基于 React，需增加 React/ReactDOM 运行时；与 Element UI 的层级、快捷键、焦点需验证 |
| 无构建/CDN | 官方提供 UMD，全局 namespace，可通过 jsDelivr/unpkg 脚本引入 | OSS（Pro 包另受商业边界） | 可以快速 PoC，但插件多时依赖和加载顺序复杂；官方对 plugin-mode UMD 明确称繁琐且不推荐 |

## 4. 关键能力的官方依据

### 4.1 公式

开源公式引擎是 Univer 核心能力。官方公式页当前列出 **528 个函数**，涵盖数学、逻辑、文本、日期等，并支持自定义公式。官方同时提醒：大量公式可能占用主线程，建议用 Web Worker 执行计算。

这对本项目的意义：

- 当前 `formula-engine.js` 中由业务代码计算的字段可以继续在业务层计算，不必全部改写为表格公式；
- 如果把大量自动计算搬进单元格公式，应启用 Worker；
- “与 Excel 一致”是官方目标描述，不代表所有 Excel 函数、隐式交叉、动态数组和边缘语义完全等价，必须用实际公式回归。

来源：

- [Formula](https://docs.univer.ai/guides/sheets/features/core/formula)（获取：2026-07-27）
- [Web Workers](https://docs.univer.ai/guides/sheets/features/core/worker)（获取：2026-07-27）

### 4.2 基础结构、冻结、隐藏、合并与样式

官方核心功能列表包含合并、冻结、隐藏/显示行列、行高列宽、保护区域等菜单能力；冻结和行列操作均有 Facade API。官方协同 API 示例也展示了 `FRange.merge()`、`breakApart()`、值和数字格式的链式操作。

来源：

- [Core Features](https://docs.univer.ai/guides/sheets/features/core)（获取：2026-07-27）
- [Freeze](https://docs.univer.ai/guides/sheets/features/core/freeze)（获取：2026-07-27）
- [Row & Column](https://docs.univer.ai/guides/sheets/features/core/row-col)（获取：2026-07-27）
- [Collaboration 页面中的 Facade 示例](https://docs.univer.ai/guides/sheets/features/collaboration)（获取：2026-07-27）
- [Conditional Formatting](https://docs.univer.ai/guides/sheets/features/conditional-formatting)（获取：2026-07-27）

### 4.3 权限、只读与单元格/区域保护

官方权限体系包含工作簿、工作表和区域三个层级。可配置：

- 工作簿：编辑、查看、打印、导出、分享、复制、评论等；
- 工作表：编辑、插删行列、排序、筛选、选择保护单元格等；
- 区域：编辑、查看、删除保护、管理协作者；
- 预设模式：工作簿 viewer/editor/commenter，工作表 editable/readOnly/filterOnly。

但官方明确说明权限模块只是可扩展基础能力，不提供开箱即用的持久化和组织结构，需要集成方自行通过 API 和自定义插件实现。

因此，对本项目的正确架构是：

1. 服务端角色、板块、周期锁定和字段权限仍是最终安全边界；
2. Univer 保护规则用于前端交互提示和阻断；
3. 保存 API 再按当前角色和字段白名单过滤/校验，防止绕过浏览器保护；
4. 权限规则应按连续列区间合并，避免为每个单元格创建规则。

来源：[Permission Control](https://docs.univer.ai/guides/sheets/features/core/permission)（获取：2026-07-27）

### 4.4 数据验证

开源数据验证插件支持：

- Number、Integer、Text length、Date；
- Checkbox；
- Dropdown list 单选/多选；
- Custom formula；
- STOP、WARNING、INFO 三类错误处理；
- 规则增删改查、错误查询和事件。

这足以承载一般的必填、枚举和输入范围提示。当前项目存在多字段、多月份、角色和提交阶段相关的复杂业务规则，应继续保留在 `wip-validation.js`、`stock-validation.js` 等业务层，不能仅靠单元格数据验证代替。

来源：[Data Validation](https://docs.univer.ai/guides/sheets/features/data-validation)（获取：2026-07-27）

### 4.5 评论/批注

开源评论插件支持评论、回复、更新、删除、解决和相关事件。官方标记 Server Optional；但与协同功能一起使用时，远程评论数据源包为 `@univerjs-pro/thread-comment-datasource`。

对本项目的影响：

- 若评论只存在于工作簿 snapshot，可以随本项目保存接口持久化；
- 若要跨版本查询、审计、按用户通知或在多人协同中实时同步，应继续自建数据库模型，或采用 Pro 数据源；
- 当前“字段变更批注”同时承担变更原因、旧值/新值和周期追踪，语义比普通评论更结构化，建议继续作为业务元数据，必要时在 Univer UI 中做映射展示。

来源：[Comments](https://docs.univer.ai/guides/sheets/features/comments)（获取：2026-07-27）

### 4.6 筛选、排序与复制粘贴

开源版提供独立 Filter 和 Sort 插件及 Facade API。复制粘贴支持：

- 外部应用到 Univer；
- Univer 到外部应用；
- Univer Sheets 之间；
- 仅值、仅格式、仅列宽、仅公式等选择性粘贴。

限制是浏览器 Clipboard API 需要 HTTPS 等安全上下文；Firefox 下主要支持键盘快捷键粘贴。

来源：

- [Filter](https://docs.univer.ai/guides/sheets/features/filter)（获取：2026-07-27）
- [Sorting](https://docs.univer.ai/guides/sheets/features/sort)（获取：2026-07-27）
- [Copy and Paste](https://docs.univer.ai/guides/sheets/features/core/clipboard)（获取：2026-07-27）

### 4.7 XLSX 导入导出

官方 XLSX 导入导出属于 Univer Pro：

- 依赖 Univer Server；
- 可按协作文档 `unitId` 导入/导出；
- 也可按 snapshot 做非协同转换，但转换仍通过服务端能力；
- 客户端使用 `@univerjs-pro/exchange-client`。

官方解释选择服务端转换是为了企业级性能和效果。官方也指出，开发者可以使用开源解析库把文件解析为符合 Univer 数据接口的结构。因此免费路线不是“完全不能导入导出”，而是：

- **没有官方免费、高保真的 XLSX 转换器；**
- 需要本项目自己维护 SheetJS ↔ Univer snapshot 的转换；
- 格式兼容、公式、合并、图片、条件格式、批注、隐藏列和列宽等均由项目承担回归责任。

对于当前项目，建议免费 PoC 先做两条路径：

1. 导入：继续使用 SheetJS 读取 83 列数据，按 `project_no` 和字段字典合并，不追求完整还原任意 Excel；
2. 导出：从 Univer snapshot/Facade 读取值、公式、样式、合并、列宽、隐藏列，再生成 XLSX；重点覆盖现有 `luckysheet-xlsx-export.js` 的验收用例。

来源：

- [Import & Export](https://docs.univer.ai/guides/sheets/features/import-export)（获取：2026-07-27）
- [Import & Export Service](https://docs.univer.ai/guides/pro/import-export)（获取：2026-07-27）
- [Upgrade to Pro：未授权限制](https://docs.univer.ai/guides/docs/getting-started/pro)（获取：2026-07-27）

### 4.8 性能与大数据

开源能力的官方依据：

- Canvas 渲染；
- 面向 large surfaces；
- 工作表 API 示例可设置 100,000 行；
- 公式可通过 Web Worker 减少主线程阻塞。

官方 Pro 性能报告给出的参考数据包括：

- 100k、200k、1m、6m 单元格滚动约 50–60 FPS；
- 20,000 个随机范围公式约 1.32 秒，20,000 个 VLOOKUP 约 4.73 秒；
- 1M 单元格 XLSX 导入约 2.39 秒、导出约 5.1 秒；
- 4C8G 服务器上 200 并发用户协同延迟约 1.3 秒。

但该页面标题和正文明确是 **Univer Pro Performance Report**，结果依赖硬件、数据集与配置。因此以上数字只能作为产品上限参考，不能作为免费开源版或当前浏览器/服务器的 SLA。

建议项目 PoC 至少测试：

- 83 列 × 当前 P50/P95/最大项目数；
- 83 列 × 1,000 / 5,000 / 10,000 行；
- 现有公式、样式、合并、隐藏列、批注密度；
- 首屏时间、滚动 FPS、编辑延迟、保存快照大小、内存峰值；
- 是否启用 Worker 对首屏与计算耗时的影响。

来源：

- [Univer 官方 GitHub README：Canvas 与 large surfaces](https://github.com/dream-num/univer)（获取：2026-07-27）
- [Univer Sheets API](https://docs.univer.ai/guides/sheets/features/core/sheets-api)（获取：2026-07-27）
- [Web Workers](https://docs.univer.ai/guides/sheets/features/core/worker)（获取：2026-07-27）
- [Univer Pro Performance Report](https://docs.univer.ai/guides/pro/performance-report)（获取：2026-07-27）

### 4.9 实时协同与服务端

官方协同编辑是 Pro，依赖 Univer Server；协作文档在服务端存储并以 `unitId` 标识。生产部署涉及：

- collaboration-server；
- collaboration-helper；
- universer；
- 数据库、Redis、对象存储等；
- Docker Compose 或 Kubernetes 部署与商业许可证配置。

当前本项目已有 Express/SQLite、版本快照和角色审批。如果短期没有“同一工作簿多人同时编辑、实时光标、操作合并”的硬需求，不建议在 Luckysheet→Univer 第一阶段同时引入 Univer Server，否则会把编辑器替换升级成数据与部署架构迁移。

来源：

- [Collaboration](https://docs.univer.ai/guides/sheets/features/collaboration)（获取：2026-07-27）
- [Quick Start: Deploy the Server](https://docs.univer.ai/guides/pro/server)（获取：2026-07-27）
- [Production Deployment](https://docs.univer.ai/guides/pro/deploy)（获取：2026-07-27）

## 5. Vue 2 与无构建 CDN 适配

### 5.1 Vue 2

官方有明确的 Vue 2 集成章节：

- 在 `mounted` 初始化 Univer；
- 在销毁钩子调用 `dispose()`；
- Univer 实例不要被 Vue 响应式代理；
- Vue CLI 3/4（Webpack 4）可能需要手工 alias 到实际包路径；
- 使用 presets 时可能需要手工安装 `react`、`react-dom`。

Univer 的视图层使用 React，但官方明确说明不影响在 Vue/Angular 中嵌入。对当前 Vue 2 + 全局组件架构而言，可把 Univer 当作一个受 Vue 生命周期管理的编辑器实例。

需要验证的集成点：

- 当前 `ProjectEditorView` 和 `ApprovalReviewSheet` 的继承/复用方式；
- Element UI Drawer、Dialog、Dropdown 与 Univer 浮层的 `z-index`；
- 当前全局快捷键、右键菜单和 Univer 的冲突；
- 路由切换后实例、事件、ResizeObserver 和 Worker 是否完整释放；
- Vue 2 组件销毁钩子应使用 `beforeDestroy`，官方示例正文写“beforeDestroy”，示例代码出现 `beforeUnmount`，实施时应按 Vue 2 生命周期采用 `beforeDestroy`。

来源：

- [Vue Integration](https://docs.univer.ai/guides/sheets/getting-started/integrations/vue)（获取：2026-07-27）
- [Installation & Basic Usage](https://docs.univer.ai/guides/sheets/getting-started/installation)（获取：2026-07-27）

### 5.2 无构建/CDN

官方提供 UMD 构建，可直接用 `<script>` 和 `<link>` 从 jsDelivr/unpkg 引入，也可下载后由自有静态服务器分发。Presets 和插件按全局 namespace 暴露。

但官方也明确：

- plugin mode 的 UMD 需要手工处理每个插件及依赖、加载顺序，很繁琐，不推荐；
- UMD 示例还需要 React、ReactDOM、RxJS，部分功能还会带 ECharts；
- 从 Univer 0.6.0 起为 React 19 做适配，UMD 用户可能需要额外兼容，官方建议迁移到 module script 和现代构建系统；
- 所有 `@univerjs/*` 包应保持相同版本，Pro 包也应版本对齐。

因此：

- **PoC**：可用固定版本的 UMD + presets，改动小；
- **生产迁移**：更建议为前端引入 Vite/Webpack 5 构建，锁定精确版本并按需打包；若坚持无构建，至少把固定版本资源下载到项目内，不使用 `latest`。

来源：

- [Import Univer via CDN](https://docs.univer.ai/guides/sheets/getting-started/installation/cdn)（获取：2026-07-27）
- [Univer 官方 GitHub README：版本对齐与构建工具建议](https://github.com/dream-num/univer)（获取：2026-07-27）

## 6. 免费方案需要自行承担的实现

若不采购 Pro，建议保留现有业务架构并新增以下适配层：

1. **Univer 生命周期封装**
   - 创建、销毁、resize；
   - 保存/加载 snapshot；
   - 事件订阅统一释放；
   - Worker 生命周期。
2. **字段字典→工作簿生成器**
   - 83 列表头、宽度、格式、隐藏列；
   - 首行/关键列冻结；
   - 数据类型与数字格式；
   - 样式和合并区。
3. **权限适配器**
   - 把 `FieldConfig.canEdit` 结果合并为连续区域保护；
   - 映射未锁定、锁定、审批只读、管理员等模式；
   - 后端保存 API 保持字段级校验。
4. **变更与业务事件适配**
   - 替换 Luckysheet `cellUpdated`、点击/双击、选择和渲染 hook；
   - 继续维护 `_field_change_log`；
   - F 列打开 Drawer、保存回写、批量 diff、基线高亮。
5. **XLSX 适配器**
   - SheetJS→Univer；
   - Univer→SheetJS；
   - 覆盖公式、样式、合并、列宽、隐藏列、数字格式；
   - 保留当前导入合并业务规则。
6. **测试与性能基线**
   - 把现有 Luckysheet 导出和业务校验用例抽象成编辑器无关测试；
   - 增加 snapshot round-trip 与大数据压测。

## 7. 建议的采购决策门槛

满足下列任一条件，应认真评估 Univer Pro，而不是继续扩大自研范围：

- 必须高保真导入任意业务 XLSX，而不仅是固定 83 列模板；
- 必须高保真导出复杂样式、图片、条件格式、图表、批注等；
- 同一项目表需要多人实时编辑、光标显示、冲突合并；
- 需要可回放的细粒度编辑历史，而不仅是当前 I/D/J 业务快照；
- 需要官方服务端计算、百万级文档性能支持和商业 SLA；
- 自研 XLSX 适配、协同和权限持久化的三年总成本高于商业许可与运维成本。

如果这些条件均不成立，优先做 **“开源 Univer + 现有后端 + SheetJS 定制导入导出”** 的两周级技术 PoC，再基于真实缺口询价。

## 8. PoC 验收清单

### 8.1 必须通过

- 83 列表头、列宽、冻结、隐藏列、合并和样式正确；
- 所有当前公式/自动计算结果一致；
- 六类角色及锁定期的可编辑字段一致；
- 单元格编辑、批量粘贴、撤销/重做、筛选、排序可用；
- 数据验证和现有提交阻断规则可用；
- F 列项目详情 Drawer 能打开、编辑、回写；
- 变更字段样式和 `_field_change_log` 正确；
- 导入按 `project_no` 合并且只覆盖允许字段；
- 导出的值、公式、样式、合并、列宽、隐藏列与当前验收口径一致；
- 保存、重载、提交、审批、I/D/J 快照无数据丢失。

### 8.2 性能门槛建议

- 当前生产最大数据集首次可交互时间可接受；
- 连续滚动、筛选、排序和粘贴无明显长时间主线程阻塞；
- 1000 行以上的保存 snapshot 大小和 API 时间可接受；
- 重复进入/退出页面无明显内存增长；
- 开启 Worker 后公式结果与主线程模式一致。

## 9. 最终判断

**免费开源 Univer 足以作为 Luckysheet 的编辑器内核替代，但不能作为现有整套业务能力的免费一键替代。**

对本项目最务实的路径是：

1. 第一阶段只替换前端表格内核，保留 Express/SQLite、业务权限、审批、快照和审计；
2. 使用开源 Univer 承担编辑、公式、样式、冻结、隐藏、保护、验证、筛选、排序、评论 UI；
3. 自建权限/批注持久化和 SheetJS 导入导出适配；
4. 不在第一阶段引入实时协同；
5. PoC 后若 XLSX 保真或协同成为主要成本，再评估 Univer Pro 商业许可和 Server 部署。

所以，对“免费版能否满足原先需求”的准确回答是：

- **如果原先需求不含实时多人协同，且接受继续维护自有 XLSX 转换层：基本能满足；**
- **如果要求官方高保真 XLSX、实时协同、编辑历史或服务端增强性能：免费版不能完整满足，需要 Pro/商业能力。**

## 10. 官方资料索引

所有链接获取日期均为 2026-07-27。

1. [Univer 官方 GitHub 仓库](https://github.com/dream-num/univer)
2. [Apache-2.0 LICENSE](https://github.com/dream-num/univer/blob/dev/LICENSE)
3. [Univer Sheets Overview](https://docs.univer.ai/guides/sheets)
4. [Installation & Basic Usage](https://docs.univer.ai/guides/sheets/getting-started/installation)
5. [Import Univer via CDN](https://docs.univer.ai/guides/sheets/getting-started/installation/cdn)
6. [Vue Integration](https://docs.univer.ai/guides/sheets/getting-started/integrations/vue)
7. [Univer Sheets API](https://docs.univer.ai/guides/sheets/features/core/sheets-api)
8. [Core Features](https://docs.univer.ai/guides/sheets/features/core)
9. [Formula](https://docs.univer.ai/guides/sheets/features/core/formula)
10. [Web Workers](https://docs.univer.ai/guides/sheets/features/core/worker)
11. [Freeze](https://docs.univer.ai/guides/sheets/features/core/freeze)
12. [Row & Column](https://docs.univer.ai/guides/sheets/features/core/row-col)
13. [Permission Control](https://docs.univer.ai/guides/sheets/features/core/permission)
14. [Data Validation](https://docs.univer.ai/guides/sheets/features/data-validation)
15. [Comments](https://docs.univer.ai/guides/sheets/features/comments)
16. [Filter](https://docs.univer.ai/guides/sheets/features/filter)
17. [Sorting](https://docs.univer.ai/guides/sheets/features/sort)
18. [Copy and Paste](https://docs.univer.ai/guides/sheets/features/core/clipboard)
19. [Conditional Formatting](https://docs.univer.ai/guides/sheets/features/conditional-formatting)
20. [Import & Export](https://docs.univer.ai/guides/sheets/features/import-export)
21. [Collaboration](https://docs.univer.ai/guides/sheets/features/collaboration)
22. [Univer Pro Overview](https://docs.univer.ai/guides/pro)
23. [Univer Pro License](https://docs.univer.ai/guides/pro/license)
24. [Upgrade to Pro / Unlicensed Limitations](https://docs.univer.ai/guides/docs/getting-started/pro)
25. [Univer Server Quick Start](https://docs.univer.ai/guides/pro/server)
26. [Production Deployment](https://docs.univer.ai/guides/pro/deploy)
27. [Import & Export Service](https://docs.univer.ai/guides/pro/import-export)
28. [Univer Pro Performance Report](https://docs.univer.ai/guides/pro/performance-report)
