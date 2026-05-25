# 数据库表结构设计说明

> **关联文档：** [database-schema.sql](./database-schema.sql) | [线上化需求.md](./线上化需求.md) | [字段字典](../fields.json)
> **版本：** v1.0 (2026-05-20)
> **数据库：** SQLite 3 (ptrack.sqlite)

---

## 一、表结构总览

| # | 表名 | 用途 | 核心关联 |
|---|---|---|---|
| 1 | `projects` | 项目主表 | 中心表，关联所有其他表 |
| 2 | `monthly_records` | 月度填报记录 | `project_no + report_month` 唯一 |
| 3 | `project_yearly_baseline` | 年度基线表 | 跨年翻转基准，历史追溯 |
| 4 | `prepayment_writeoffs` | 预收款核销流水 | 财务审核期操作记录 |
| 5 | `audit_log` | 变更审计日志 | 全量增删改追踪 |
| 6 | `snapshots` | 审批快照表 | 不可变版本快照 |
| 7 | `pm_submissions` | PM 提交记录 | 项目经理提交/板块接收状态 |
| 8 | `users` | 用户与角色表 | 登录认证与权限 |
| 9 | `system_config` | 系统配置表 | 周期配置、板块注册等 |

---

## 二、核心设计决策

### 2.1 为什么月度数据单独成表？

**需求背景 (§2.4)：** 每月填报时，当月实际值清零重置，历史月只读保留。

**方案对比：**

| 方案 | 优点 | 缺点 |
|---|---|---|
| 月度字段直接挂在 `projects` 表 | 查询简单 | 每月重置需清空 24+ 字段；历史数据丢失 |
| **独立 `monthly_records` 表** ✅ | 历史完整保留；按月隔离；重置只需 INSERT 新行 | 查询需 JOIN |

**结论：** 采用独立表。每月开启填报时，为每个项目 INSERT 一条新 `monthly_records` 记录（当月值 = 0，历史月自动关联上月记录或继承预测值）。

### 2.2 年度基线表的设计逻辑

**需求背景 (§3.6)：** 每年 1 月 1 日系统自动翻转，冻结上年底数据为新年基准。

**设计要点：**
- `baseline_year` 标识基准所属年份（2025、2026...）
- 跨年时自动 INSERT 新行，抓取当年 `始累完成/开票/回款` 写入
- `projects.prev_year_end_amt` 等字段始终指向**最新一行**基线数据
- 历史行永不删除，支持审计回溯

### 2.3 预收款核销流水表

**需求背景 (§2.16 #3)：** 财务需管理"未开票已收款→开票后核销"的全流程。

**设计要点：**
- 每条核销记录对应一次具体操作（金额、日期、发票号、操作人）
- `projects.prepayment_balance` 为计算字段，实时 = `SUM(预收款) - SUM(核销金额)`
- 核销操作仅在财务审核期（1-3 日）可执行

### 2.4 变更审计的双层设计

**需求背景 (§2.5)：** 既要字段级批注展示，又要全局审计日志。

| 层 | 存储位置 | 用途 |
|---|---|---|
| **单元格级** | `projects._field_change_log` (JSON) | Luckysheet 批注展示、高亮渲染 |
| **全局级** | `audit_log` 表 | 审计查询、导出、按人/时间/项目筛选 |

**写入时机：**
- 单元格编辑 → 同时写入 `_field_change_log` 和 `audit_log`
- Excel 导入 → 逐字段写入 `audit_log`（`operation_type = 'import'`）
- 管理员解锁修改 → `operation_type = 'unlock_edit'`

### 2.5 快照表的 JSON 存储

**需求背景 (§2.6)：** 每次审批状态变更生成不可变快照。

**为什么用 JSON 而不是关联表：**
- 快照是**时间点的全量数据切片**，查询时一次性读取
- 不需要按快照内字段做条件查询
- 减少表数量和 JOIN 复杂度
- SQLite 对 JSON 支持良好（`json_extract`、`json_each`）

**版本键格式：**

| 类型 | 格式 | 示例 |
|---|---|---|
| 导入 I 版 | `I:YYYYMMDD:ALL:NN` | `I:20260501:ALL:01` |
| 板块 D 版 | `D:YYYYMMDD:SASxxx:NN` | `D:20260520:SAS550:01` |
| 公司 J 版 | `J:YYYYMMDD:ALL:NN` | `J:20260525:ALL:02` |

**meta：** `baselineVersion`、`latestIVersion`、`latestJVersion`

**遗留键（只读历史）：** `Draft:*`、`J版`、`Month:*`、`PM:*`

---

## 三、字段映射关系

### 3.1 projects 表 vs 字段字典

| projects 字段 | 字段字典列 | 数据源 | 说明 |
|---|---|---|---|
| `project_no` | F | system_sync | 主键 |
| `sector_code` | D | system_sync | 执行单位编码 |
| `pm_name` | E | system_sync | 项目经理 |
| `contract_amt_inc_tax` | P | auto_calc | 总合同额(含税) (=N+O) |
| `contract_amt_ex_tax` | N | system_sync | 总合同额(未含税) |
| `tax_rate` | Q | system_sync | 税率 |
| `prev_year_end_amt` | — | 年度基线 | 截止上一年底(含税) |
| `current_year_adj` | O | system_sync | 当年调整值（CRB 当年 CRB3+CRB5 完成额之和） |
| `fx_adjustment` | TY | manual_input | 汇率差调整值 (新增) |
| `implementation_status` | M | manual_input | 项目实施进展 |
| `wip_analysis_note` | TR | manual_input | WIP 分析说明 |
| `wip_cause` | TS | manual_input | WIP 成因分类 |
| `risk_level` | TT | manual_input | 风险等级 |
| `risk_note` | TU | manual_input | 风险说明 |
| `improvement_action` | TV | manual_input | 改进措施 |
| `action_owner` | TW | manual_input | 措施责任人 |
| `action_plan_date` | TX | manual_input | 计划完成时间 |
| `prepayment_balance` | — | auto_calc | 预收款余额 |
| `is_new_project` | A | auto_calc | 新(1)/旧(0)项目 |
| `contract_signed` | L | auto_calc | 合同是否签署 |

### 3.2 monthly_records 表 vs 字段字典

| monthly_records 字段 | 字段字典列 | 说明 |
|---|---|---|
| `complete_amt_m1` – `m12` | AA–AM | 月度完成额 1-12月 |
| `invoice_amt_m1` – `m12` | AH–AS | 月度开票额 1-12月 |
| `payment_amt_m1` – `m12` | AT–BE | 月度回款额 1-12月 |
| `prepayment_amt_m1` – `m12` | — | 月度预收款 1-12月 |
| `payment_ratio_m1` – `m12` | — | 回款比例 (auto_calc) |
| `forecast_invoice` | BH–CE 部分 | 预测开票额 |
| `forecast_invoice_date` | AU | 预测开票时间 |
| `forecast_payment` | BH–CE 部分 | 预测回款额 |

---

## 四、关键业务逻辑的数据库支撑

### 4.1 月度数据初始化 (§2.4)

```sql
-- 每月开启填报时，为每个项目创建新月度记录
INSERT INTO monthly_records (project_no, report_month, complete_amt_m1, ...)
SELECT 
    p.project_no,
    '2026-06',                                    -- 新报告月
    CASE WHEN month_index = 6 THEN 0 ELSE m.complete_amt_m1 END,  -- 当月清零
    ...
FROM projects p
LEFT JOIN monthly_records m ON p.project_no = m.project_no 
    AND m.report_month = '2026-05';              -- 上月记录
```

### 4.2 跨年翻转 (§3.6)

```sql
-- 每年 1 月 1 日执行
INSERT INTO project_yearly_baseline (project_no, baseline_year, 
    year_end_complete_amt, year_end_invoice_amt, year_end_payment_amt)
SELECT 
    project_no,
    strftime('%Y', 'now') - 1,                   -- 上一年份
    cumulative_complete_inc_tax,
    cumulative_invoice,
    cumulative_payment
FROM projects;

-- 更新 projects 的 prev_year_end 指针
UPDATE projects 
SET prev_year_end_amt = (
    SELECT year_end_complete_amt FROM project_yearly_baseline 
    WHERE project_no = projects.project_no 
    AND baseline_year = strftime('%Y', 'now') - 1
);
```

### 4.3 预收款核销 (§2.16 #3)

```sql
-- 核销操作
INSERT INTO prepayment_writeoffs (project_no, writeoff_amt, writeoff_date, invoice_no, operator, report_month)
VALUES ('P-2026-001', 50000, '2026-05-02', 'INV-2026-0123', '财务张三', '2026-05');

-- 更新预收款余额
UPDATE projects 
SET prepayment_balance = (
    SELECT COALESCE(SUM(prepayment_amt_m1 + ... + prepayment_amt_m12), 0) 
           - COALESCE((SELECT SUM(writeoff_amt) FROM prepayment_writeoffs 
                       WHERE project_no = 'P-2026-001'), 0)
    FROM monthly_records WHERE project_no = 'P-2026-001'
)
WHERE project_no = 'P-2026-001';
```

---

## 五、索引策略

| 表 | 索引字段 | 目的 |
|---|---|---|
| `projects` | `sector_code` | 按板块筛选 |
| `projects` | `pm_name` | PM 本人项目过滤 |
| `projects` | `reporting_month` | 报告月查询 |
| `monthly_records` | `(project_no, report_month)` | 联合唯一 + 快速查找 |
| `audit_log` | `(project_no, created_at)` | 按项目+时间查审计 |
| `audit_log` | `operator` | 按操作人查审计 |
| `snapshots` | `version` | 版本键唯一 + 快速查找 |
| `prepayment_writeoffs` | `(project_no, report_month)` | 按项目+月查核销 |

---

## 六、与现有实现的衔接

### 6.1 当前 SQLite 库 (`data/ptrack.sqlite`)

现有实现中 `projects` 表使用 `payload` 字段（JSON）存储完整项目数据。迁移策略：

| 阶段 | 方案 |
|---|---|
| **当前 (v0)** | `projects.payload` JSON 存储全部字段 |
| **过渡 (v1)** | 新增结构化列，`payload` 保留作为兼容 |
| **最终 (v2)** | 完全移除 `payload`，全部使用结构化列 + 关联表 |

### 6.2 Meta 表

现有 `meta` 表（存储 `approvalStatus`、`sectorFlows`、`periodConfig`、`pmSubmissions`）保持不变，后续可逐步迁移至独立表。

---

## 七、待优化项

| # | 项 | 说明 | 优先级 |
|---|---|---|---|
| 1 | **软删除** | 项目删除改为 `is_deleted` 标记，保留审计追溯 | 中 |
| 2 | **乐观锁** | `projects.updated_at` + `version` 字段，防止并发覆盖 | 中 |
| 3 | **数据分区** | 跨年数据量大时，考虑按 `report_month` 分表 | 低 |
| 4 | **全文搜索** | 项目名称/客户名全文搜索，SQLite FTS5 | 低 |
