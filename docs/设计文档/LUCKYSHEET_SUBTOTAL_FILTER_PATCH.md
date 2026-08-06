# Luckysheet 筛选补丁 — 开发说明

> **最后更新：** 2026-08-05  
> **适用页面：** 查看数据（`ProjectEditor`）、填报与审批详情（`ReportLineDetail`）、审批表格（`ApprovalReviewSheet`，继承同一套 `initLuckysheet`）  
> **参考原型：** 企业微信缓存目录 `luckysheet公式`（`SUBTOTAL` 演示 + 方向键跳过隐藏行）

---

## 1. 背景与问题

本项目 Luckysheet 表头结构为：

| 行 | 用途 | 公式 |
|---|---|---|
| 0 | 小计 Subtotal | `=SUBTOTAL(9, 数据区)` |
| 1 | 合计 Total | `=SUM(数据区)` |
| 2 | 大类 / 分区 | — |
| 3 | 字段标题（筛选按钮） | — |
| 4+ | 项目数据 | `auto_calc` 等 |

默认筛选仅覆盖「字段标题 + 数据行」，小计/合计在筛选区外。业务上期望：

1. **列头筛选后，小计随当前可见行重算**；合计仍为全表口径（`SUM` 不变）。
2. **筛选后用方向键 / Enter 移动光标时，跳过已隐藏行**，不落到看不见的格子上。

### 原生 Luckysheet 的缺口

| 问题 | 原因 |
|---|---|
| 小计筛选后不更新 | 官方 `SUBTOTAL` 实现未排除 `sheet.filter[*].rowhidden`；筛选确认后也不主动 `refreshFormula` |
| ↑↓ 进入隐藏行 | 键盘导航按连续行号移动，不识别筛选隐藏行 |

公式写法本身正确（小计已是 `SUBTOTAL(9,…)`），缺的是**运行时补丁**。

---

## 2. 方案概览

```
Luckysheet CDN 加载
    │
    ▼
luckysheet-subtotal-patch.js     → 改写 luckysheet_function.SUBTOTAL
luckysheet-nav-skip-hidden.js    → 捕获 keydown，跳过隐藏行列
    │
    ▼
ProjectEditor.initLuckysheet()
    ├─ create 前：SUBTOTAL_PATCH.install() / NAV_SKIP_HIDDEN.install()
    ├─ forceCalculation: true
    └─ hook
         ├─ workbookCreateAfter → install + refresh + 默认筛选
         └─ updated            → SUBTOTAL_PATCH.onUpdated(op)
```

**业务公式不变：** 小计继续 `SUBTOTAL(9,…)`，合计继续 `SUM(…)`。补丁只修引擎行为与键盘导航。

---

## 3. 涉及文件

| 文件 | 职责 |
|---|---|
| `js/luckysheet-subtotal-patch.js` | 修补 `SUBTOTAL`；筛选菜单点击后调度重算；暴露 `SUBTOTAL_PATCH` |
| `js/luckysheet-nav-skip-hidden.js` | 方向键 / Enter 跳过隐藏行（及隐藏列）；暴露 `NAV_SKIP_HIDDEN`；脚本加载即 `install()` |
| `index.html` | Luckysheet UMD 之后引入上述两脚本 |
| `js/views/ProjectEditor.js` | `initLuckysheet` 接入 install / refresh / `updated`；`forceCalculation: true` |
| `docs/需求文档/需求文档_产品版.md` | 用户可见行为：筛选后小计重算、键盘跳过隐藏行 |
| `docs/需求文档/需求文档_开发版.md` | 实现路径、hook、文件清单 |

**未改（有意为之）：**

| 文件 | 说明 |
|---|---|
| `makeLuckysheetTotalRowAmountCell` | 小计/合计公式字符串已正确，无需改写 |
| `js/formula-engine.js` | 服务端 / 业务层汇总口径不变；仅 Luckysheet 展示层补丁 |
| `ApprovalReviewSheet` / `ReportLineDetail` | 继承 `ProjectEditor.initLuckysheet`，自动生效 |

---

## 4. 补丁 API

### 4.1 `window.SUBTOTAL_PATCH`

| 方法 | 说明 |
|---|---|
| `install()` | 改写 `luckysheet_function.SUBTOTAL.f`（幂等，带 `__patchedForFilter`） |
| `refresh()` | 调用 `luckysheet.refreshFormula()` |
| `onUpdated(op)` | 当 `op.t` / `op.type` 为 `f` / `fsc` / `fsr` / `shr` / `hideRc` / `showRc` 时，防抖 80ms 后 `refresh()` |

**隐藏行判定：**

- 函数号 `1–11`：仅排除 `sheet.filter[*].rowhidden`（对齐 Excel：`SUBTOTAL(9)` 忽略筛选隐藏，但不忽略手动隐藏行）
- 函数号 `101–111`：额外排除 `sheet.config.rowhidden`

**筛选菜单：** 捕获 `.luckysheet-filter-menu` 内点击，文案匹配「确认 / 确定 / 清除筛选」时调度重算。

### 4.2 `window.NAV_SKIP_HIDDEN`

| 方法 | 说明 |
|---|---|
| `install()` | 在 `window` / `document` 上挂 `keydown`（捕获阶段）与 `keyup`；全局只装一次（`__LUCKYSHEET_NAV_SKIP_HIDDEN__`） |

**行为要点：**

- 编辑中（`#luckysheet-input-box` 可见）不拦截
- 有隐藏行，或焦点在软编辑框时，接管 ↑↓←→ / Enter / Shift+Enter
- 行：跳过 `filter.rowhidden` ∪ `config.rowhidden`
- 列：跳过 `config.colhidden`（紧凑列隐藏）
- `keyup` 兜底：若原生仍落在隐藏行，再跳到最近可见行
- 移动后 `ensureVisible`，避免选中格落在冻结区外不可见区域

---

## 5. `ProjectEditor` 接入点

```javascript
// initLuckysheet 内，luckysheet.create 之前
SUBTOTAL_PATCH.install();
NAV_SKIP_HIDDEN.install();

luckysheet.create({
  forceCalculation: true,
  hook: {
    workbookCreateAfter: function () {
      SUBTOTAL_PATCH.install();
      SUBTOTAL_PATCH.refresh();
      NAV_SKIP_HIDDEN.install();
      // …原有 recalc / 默认筛选 / F 列点击等
    },
    updated: function (op) {
      SUBTOTAL_PATCH.onUpdated(op);
    }
    // …原有 cellEditBefore / cellUpdateBefore / cellUpdated
  }
});
```

脚本加载顺序（`index.html`）：

1. Luckysheet `plugin.js` + `luckysheet.umd.js`
2. `luckysheet-subtotal-patch.js`
3. `luckysheet-nav-skip-hidden.js`
4. 其余业务脚本

---

## 6. 验收清单

- [ ] 打开查看数据 / 报告线详情 / 审批表格，第 0 行小计与第 1 行合计初始值正常
- [ ] 列头筛选只勾选部分值并**确认** → 小计变为可见行之和，合计不变
- [ ] **清除筛选** → 小计恢复为全数据区口径（与合计一致，若数据区无额外手工隐藏）
- [ ] 筛选后按 ↑↓ 移动 → 光标只落在可见数据行（及未隐藏的表头区行），不进入隐藏行
- [ ] 筛选后按 Enter / Shift+Enter → 同样跳过隐藏行
- [ ] 单元格编辑中按方向键 → 仍为输入框内移动，不被补丁抢走
- [ ] 硬刷新（Ctrl+Shift+R）后行为仍正确（确认脚本已加载）

---

## 7. 边界与注意

| 项 | 说明 |
|---|---|
| 合计行 | 故意用 `SUM`，筛选后**不**变；与 Excel「筛选看小计、全表看合计」一致 |
| 导出 | WYSIWYG 导出走 `luckysheet-xlsx-export.js`；导出的仍是公式字符串，Excel 打开后由 Excel 引擎计算（Excel 原生 `SUBTOTAL` 本就支持筛选） |
| 手动隐藏行 | `SUBTOTAL(9)` 不排除 `config.rowhidden`；若业务要用忽略手动隐藏的口径，应改用 `SUBTOTAL(109,…)` |
| 多 sheet | 补丁按当前 `status==1` 的 sheet 取 filter；本系统通常单 sheet |
| 销毁重建 | `destroy` + `create` 后 hook 会再次 install；`SUBTOTAL` 改写与导航监听均为幂等 |
| CDN 版本 | 针对 `luckysheet@2.1.13`；升级大版本需回归 `luckysheet_function.SUBTOTAL` 参数形态与 `updated` 操作码 |

---

## 8. 与需求文档的对应

| 文档 | 章节 |
|---|---|
| 产品版 | §3.3.2 行布局、§3.3.6 筛选与小计、§3.4.4 键盘导航 |
| 开发版 | §3.3.2、§3.3.6 公式链 / SUBTOTAL 补丁、§3.4 默认筛选后导航 |

---

## 9. 变更摘要（2026-08-05）

| 类型 | 内容 |
|---|---|
| 新增 | `js/luckysheet-subtotal-patch.js`、`js/luckysheet-nav-skip-hidden.js` |
| 修改 | `index.html` 引入补丁；`ProjectEditor.initLuckysheet` 接入 hook + `forceCalculation` |
| 文档 | 产品版 / 开发版需求同步；本文档；`AGENTS.md` 文件清单 |
