# Luckysheet 迁移 Univer 评估

> 评估日期：2026-07-27  
> 评估对象：当前项目 `C:\Work\1_Projects\202605_项目追踪表线上化`  
> 参考实现：`C:\Users\xuys\Documents\WXWork\1688856224374768\Cache\File\2026-07\reporting-system - 副本`  
> 许可与产品能力依据：同目录《Univer官方能力与许可调研.md》

## 1. 结论

**建议迁移，第一阶段采用“Univer 开源版 + 现有 Express/SQLite 业务后端 + 自研 SheetJS 导入导出”，暂不采购 Univer Pro。**

免费开源版可以满足当前项目的核心需求，包括 83 列表格、公式、样式、合并、冻结、隐藏列、筛选、下拉校验、单元格保护、批注展示和复制粘贴。当前项目不要求多人同时编辑同一工作簿，因此 Pro 的实时协同和编辑历史不是迁移前置条件。

不能直接免费替代的是官方 XLSX 导入导出。未授权 Pro 的导出上限为 10,000 单元格，83 列时约 121 行即会越界，不能用于生产。应保留现有 SheetJS 路线，把 `Luckysheet file.data → XLSX` 改为 `Univer snapshot/Facade → XLSX`。

这不是替换几个 CDN 文件，而是一次中等规模的表格适配层重写。初步估算：

| 阶段 | 预计投入 |
|---|---:|
| 可行性 PoC | 5–8 人日 |
| 主填报页完整迁移 | 12–18 人日 |
| 报告线、审批只读页、导入导出 | 8–12 人日 |
| 性能、兼容与回归 | 5–8 人日 |
| **合计** | **30–46 人日** |

以上不包含 Vue 2 → Vue 3 全站升级；若同步升级前端框架，应单独立项。

## 2. 当前项目的替换影响面

Luckysheet 耦合主要集中在以下位置：

| 文件 | 当前职责 | 迁移处理 |
|---|---|---|
| `js/views/ProjectEditor.js` | 表格构造、公式、样式、冻结、筛选、权限、事件、保存、Drawer 联动 | 核心重写；业务规则保留，表格 API 改为 Univer Facade/事件 |
| `js/views/ReportLineDetail.js` | 继承主表，覆盖数据源、隐藏列、保存与提交前刷盘 | 改为复用统一 `UniverSheetAdapter` |
| `js/components/ApprovalReviewSheet.js` | 审批只读表 | 复用同一适配器，只切换权限模式 |
| `js/luckysheet-xlsx-export.js` | 当前视图 WYSIWYG 导出 | 重写为 Univer snapshot/Facade → SheetJS |
| `js/change-meta.js` | 变更高亮与 Luckysheet 批注结构 | 保留业务文本生成，替换批注和样式写入 |
| `js/field-config.js` | 列映射、权限、列宽和单元格格式 | 保留字段/权限逻辑，增加 Univer 映射 |
| `css/style.css` | Luckysheet 容器、工具条、过滤器和画布适配 | 删除 DOM 定向补丁，增加 Univer 容器和浮层适配 |
| `index.html` / `package.json` | Luckysheet CDN、jQuery 依赖、无构建加载 | 移除 Luckysheet；引入并锁定 Univer OSS 包 |

`ProjectEditor.js` 当前约 3,180 行，包含约 274 处 Luckysheet 引用；`ReportLineDetail.js`、审批表、导出器和样式中另有一批直接引用。建议先抽象适配层，再迁移调用，避免把 Univer 逻辑继续堆入主页面。

## 3. 功能映射

| 原需求 | Univer 开源版 | 迁移判断 |
|---|---:|---|
| 83 列字段字典、4 行复合表头 | ✅ | 用 `IWorkbookData.cellData`、`styles`、`mergeData` 生成 |
| 冻结前 4 行、前 6 列 | ✅ | 用 worksheet `freeze` 或 Facade API |
| 列宽、行高、数字/日期/百分比格式 | ✅ | 改为 Univer style registry 和 number format |
| 紧凑模式隐藏列、报告线分发列 | ✅ | 用 hide/show columns；导出范围需单独决定 |
| 表头筛选、排序 | ✅ | 使用开源 filter/sort preset |
| 基础公式、SUM、SUBTOTAL、行内算术 | ✅ | 开源公式引擎足够；建议保留服务端/业务层复算 |
| 角色 × 锁定期 × 字段可写 | ✅ + 自建 | Univer 做前端保护，现有后端继续做最终鉴权 |
| 金额、日期、枚举下拉 | ✅ | 使用 data validation preset；复杂业务校验继续使用现有模块 |
| 变更高亮、预警色、可编辑底色 | ✅ | 使用 styleId/条件样式，避免逐格重复样式对象 |
| 变更批注、平台未匹配提示 | ✅ + 自建 | 业务变更日志仍存 SQLite，映射到 note/comment UI |
| F 列点击打开项目 Drawer | ✅ | 用 `CellClicked` / `CellPointerUp` 等事件 |
| 编辑后保存、提交前刷盘 | ✅ | 使用编辑结束、命令执行和 snapshot/Facade 读取 |
| 多格复制粘贴 | ✅ | 需补充受保护区域、公式列和批量保存测试 |
| 当前视图 XLSX 导出 | ⚠️ 自研 | 官方能力属于 Pro；需重写现有转换器 |
| Excel 合并导入 | ✅ 自研 | 继续用 SheetJS 和 `project_no` 合并，不依赖 Pro |
| I/D/J 快照、审批、审计 | ✅ 现有业务 | 不迁入 Univer Server，继续由当前后端负责 |
| 多人实时协同、编辑历史 | ❌ OSS 不含 | 当前非必需；未来有明确需求再评估 Pro |

## 4. 测试副本可复用的内容

测试副本已经证明以下路线可行：

- Vue 页面中创建、销毁和重建 Univer workbook；
- 服务端生成 `cellData`、`styles`、`mergeData`、`freeze`、行列尺寸；
- 使用 `BeforeSheetEditStart`、`SheetEditEnded`、`CommandExecuted` 等事件处理编辑；
- 按行维护可编辑列，拦截公式列和只读区域的编辑/粘贴；
- 使用 `sheets-note` 展示变更批注；
- 表头筛选、项目号点击 Drawer、Drawer 保存后局部回写；
- 首屏缓存、服务端预计算公式、按行刷新计算结果。

但它不能直接复制进当前项目：

1. 测试副本是 Vue 3 + Vite + Element Plus，当前项目是 Vue 2 + 全局脚本 + Element UI。
2. 测试副本的数据表、API、审批状态与当前项目不同。
3. `SheetView.vue` 仍超过 2,000 行，不能照搬其组织方式。
4. 批注只读通过 `MutationObserver` 修改 Univer 内部 DOM，升级兼容性较弱。
5. 部分命令通过字符串 ID 拦截，必须用锁定版本验证。
6. 它未接入当前项目需要的枚举数据验证 preset。
7. 它没有完成当前项目所需的 WYSIWYG Univer snapshot 导出。
8. 它使用 `pageSize: 99999` 全量加载，自己的检查报告已把大数据性能列为风险。

因此，参考副本最适合作为 API 用法和问题清单，不适合作为整块代码移植来源。

## 5. 推荐技术方案

### 5.1 不同时做 Vue 3 全站改造

Univer 官方支持 Vue 2 和 UMD/CDN，但生产上更建议引入构建步骤并锁定所有 `@univerjs/*` 包的精确版本。推荐两种实现：

1. **优先方案：** 保持现有 Vue 2 页面，引入 Vite/Webpack 仅打包 Univer 适配模块。
2. **PoC 快速方案：** 使用固定版本 UMD/preset；验证通过后再切到本地构建产物。

不建议长期使用多个 CDN 全局包拼装生产版本，也不建议在迁移表格组件时同时重写全站为 Vue 3。

### 5.2 新增统一适配层

建议拆为：

```text
js/univer/
├── univer-runtime.js          创建、销毁、resize、事件释放
├── univer-workbook-builder.js 字段字典/项目数据 → IWorkbookData
├── univer-permission.js       角色、锁定期、字段权限 → 保护规则/编辑拦截
├── univer-events.js           编辑、粘贴、点击、滚动、命令事件
├── univer-decoration.js       变更、预警、批注、可编辑样式
├── univer-formula.js          表格公式与业务公式回写
└── univer-xlsx-export.js      snapshot/Facade → SheetJS
```

页面只调用 `mount`、`reload`、`flush`、`updateRow`、`setReadOnly`、`exportXlsx`、`dispose` 等稳定接口。报告线和审批页共享该接口，不再继承具体表格引擎实现。

### 5.3 公式采用“双保险”

当前公式仅使用基础算术、`SUM` 和 `SUBTOTAL`，开源公式引擎可以覆盖。但为保证数据库、Drawer、导出和表格显示一致，建议：

- `formula-engine.js` 继续作为业务权威计算；
- Univer 公式主要用于表内即时反馈；
- 保存后用服务端返回的重算值局部刷新该行；
- 大数据时允许像测试副本一样下发预计算值，减少全表公式计算；
- PoC 分别测试启用公式、Web Worker 和服务端预计算三种模式。

### 5.4 权限不交给前端组件兜底

Univer 的保护规则用于交互层，最终权限仍由当前后端控制：

- 前端按连续列区间合并保护规则，避免每格创建规则；
- 编辑开始前拦截，粘贴/填充/清空等命令再次拦截；
- 保存 API 继续执行字段白名单、角色、板块、周期和状态校验；
- 提交前从 Facade/snapshot 刷盘，不依赖单一编辑事件；
- 保护规则、隐藏列和筛选状态不能作为安全边界。

### 5.5 导入导出保留自研

免费路线的关键是新增 Univer 与 SheetJS 的双向适配：

- 导入仍解析 Excel 并按 `project_no` 合并允许编辑字段；
- 导出读取值、公式、样式、数字格式、合并、列宽、行高；
- 当前填报页仍导出全部 83 列，不受紧凑视图隐藏影响；
- 报告线导出继续按分发列过滤；
- 用当前 `test/luckysheet-xlsx-export.test.js` 的验收语义重建引擎无关测试；
- 增加“导出 → Excel/WPS 打开 → 再导入”的 round-trip 用例。

## 6. 实施顺序

1. 冻结 Univer 精确版本，建立 83 列真实数据 PoC。
2. 抽取 `SheetAdapter`，保留 Luckysheet/Univer 双实现和功能开关。
3. 完成表头、数据、样式、合并、冻结、隐藏列和基础公式。
4. 完成权限、编辑、粘贴、保存、提交前刷盘和业务校验。
5. 完成批注、变更高亮、预警、F 列 Drawer 和局部回写。
6. 完成筛选、排序、紧凑列和报告线分发列。
7. 完成 Univer → XLSX 导出及现有 Excel 合并导入。
8. 迁移报告线详情和审批只读页。
9. 以生产数据量做性能、内存、浏览器和导出回归。
10. 灰度切换默认引擎；稳定后删除 Luckysheet 依赖和兼容代码。

## 7. PoC 的停止/采购门槛

以下任一项成立时，应重新评估 Univer Pro，而不是继续扩大自研：

- 必须导入任意复杂 XLSX，而非固定 83 列模板；
- WYSIWYG 导出需要覆盖图片、图表、复杂条件格式或任意 Excel 特性；
- 同一工作簿必须多人实时编辑并处理冲突；
- 需要可回放的细粒度编辑历史；
- 真实生产数据下 OSS 性能达不到验收门槛，且 Pro 能给出明确方案和 SLA；
- 自研导入导出与协同的长期维护成本高于商业许可。

当前需求下，上述条件尚未成立，因此先做开源版 PoC 是成本和风险最平衡的路径。
