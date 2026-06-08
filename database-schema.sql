-- ============================================================================
-- 项目追踪表线上化 — 数据库表结构设计 (SQLite)
-- 版本: v1.0 (2026-05-20)
-- 说明: 覆盖项目主表、月度填报记录、年度基线表、预收款核销、变更审计日志、
--       审批快照、角色权限、系统配置等
-- ============================================================================

-- ============================================================================
-- 1. 项目主表 (projects)
-- 存储项目核心信息，CRB 同步字段 + 手工填报字段 + 计算字段
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no      TEXT    NOT NULL UNIQUE,        -- F 项目号 (主键)

    -- CRB 同步字段 (system_sync，只读)
    sector_code     TEXT,                           -- D 执行单位编码 (SAS520等)
    pm_name         TEXT,                           -- E 项目经理
    project_name    TEXT,                           -- G 项目名称
    client_name     TEXT,                           -- H 客户名称
    enterprise_type TEXT,                           -- I 企业属性
    industry        TEXT,                           -- J 行业类别
    business_type   TEXT,                           -- K 业务类型
    start_date      TEXT,                           -- B 约定开始时间 (YYYY-MM-DD)
    end_date        TEXT,                           -- C 约定结束时间 (YYYY-MM-DD)

    -- 合同额 (system_sync / auto_calc)
    contract_amt_ex_tax     REAL,                   -- N 总合同额(未含税)
    contract_amt_inc_tax    REAL,                   -- P 总合同额(含税)
    tax_rate                REAL,                   -- Q 税率
    contract_signed         TEXT,                   -- L 合同是否签署 (已签署/未签署)

    -- 年度基线 (每年1月1日冻结)
    prev_year_end_amt       REAL,                   -- 截止上一年底(含税)
    prev_year_end_invoice   REAL,                   -- 截止上一年底累计开票
    prev_year_end_payment   REAL,                   -- 截止上一年底累计回款

    -- 始累数据 (system_sync / auto_calc)
    cumulative_complete_inc_tax   REAL,             -- T 始累完成合同额(含税)
    cumulative_complete_ex_tax    REAL,             -- U 始累完成合同额(未含税)
    cumulative_invoice            REAL,             -- V 始累开票额

    -- 当年数据 (auto_calc + manual_input)
    current_year_adj        REAL DEFAULT 0,         -- O 当年调整值 (=P - prev_year_end_amt)
    fx_adjustment           REAL DEFAULT 0,         -- TY 汇率差调整值 (新增, §2.16 #4)

    -- 项目实施进展 (manual_input)
    implementation_status   TEXT,                   -- M 项目实施进展 (进行中/已完成/暂缓/已终止)

    -- WIP 分析 (manual_input)
    wip_analysis_note       TEXT,                   -- TR WIP 分析说明
    wip_cause               TEXT,                   -- TS WIP 成因分类 (A/B/C/D)
    risk_level              TEXT,                   -- TT 风险等级
    risk_note               TEXT,                   -- TU 风险说明
    improvement_action      TEXT,                   -- TV 改进措施
    action_owner            TEXT,                   -- TW 措施责任人
    action_plan_date        TEXT,                   -- TX 计划完成时间 (YYYY-MM-DD)

    -- 预收款核销汇总 (auto_calc, 明细在 prepayment_writeoffs 表)
    prepayment_balance      REAL DEFAULT 0,         -- 当前未核销预收款余额

    -- 计算字段 (auto_calc, 由 FormulaEngine 实时计算)
    invoice_diff            REAL,                   -- R 开票差
    complete_diff           REAL,                   -- S 完成差
    yearly_complete_inc_tax REAL,                   -- W 年度完成额申报(含税)
    yearly_complete_ex_tax  REAL,                   -- X 年度完成额申报(未含税)
    yearly_invoice          REAL,                   -- Y 年度累计开票额(含税)
    yearly_payment          REAL,                   -- Z 年度累计回款额(含税)
    ar_amount_inc_tax       REAL,                   -- CF 应收账款(含税)
    wip_inc_tax             REAL,                   -- CG WIP(含税)
    wip_ex_tax              REAL,                   -- CH WIP(未含税)

    -- 元数据
    is_new_project          INTEGER DEFAULT 0,      -- A 新(1)/旧(0)项目
    reporting_month         TEXT    NOT NULL,       -- 当前报告月 (如 2026-05)
    _changed_fields         TEXT,                   -- JSON: 本月变更字段列号列表
    _field_change_log       TEXT,                   -- JSON: 字段级变更详情
    _field_notes            TEXT,                   -- JSON: 业务批注 (新增, §2.16 #7)
    _added_this_month       INTEGER DEFAULT 0,      -- 是否本月新增项目

    -- 审批相关
    approval_status         TEXT DEFAULT 'draft',   -- draft / approve1 / approve2 / final
    reporting_submitted     INTEGER DEFAULT 0,      -- 板块是否已提交审批

    created_at              TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at              TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_projects_sector    ON projects (sector_code);
CREATE INDEX IF NOT EXISTS idx_projects_pm         ON projects (pm_name);
CREATE INDEX IF NOT EXISTS idx_projects_month      ON projects (reporting_month);
CREATE INDEX IF NOT EXISTS idx_projects_approved   ON projects (approval_status);

-- ============================================================================
-- 2. 月度填报记录表 (monthly_records)
-- 存储逐月手工填报数据，支持历史追溯与月度清零重置
-- ============================================================================
CREATE TABLE IF NOT EXISTS monthly_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no      TEXT    NOT NULL,               -- 关联 projects.project_no
    report_month    TEXT    NOT NULL,               -- 月份 (YYYY-MM)

    -- 月度完成额 (AA–AG + 后续月份, manual_input)
    complete_amt_m1  REAL DEFAULT 0,                -- 1月完成额
    complete_amt_m2  REAL DEFAULT 0,                -- 2月完成额
    complete_amt_m3  REAL DEFAULT 0,                -- 3月完成额
    complete_amt_m4  REAL DEFAULT 0,                -- 4月完成额
    complete_amt_m5  REAL DEFAULT 0,                -- 5月完成额
    complete_amt_m6  REAL DEFAULT 0,                -- 6月完成额
    complete_amt_m7  REAL DEFAULT 0,                -- 7月完成额
    complete_amt_m8  REAL DEFAULT 0,                -- 8月完成额
    complete_amt_m9  REAL DEFAULT 0,                -- 9月完成额
    complete_amt_m10 REAL DEFAULT 0,                -- 10月完成额
    complete_amt_m11 REAL DEFAULT 0,                -- 11月完成额
    complete_amt_m12 REAL DEFAULT 0,                -- 12月完成额

    -- 月度开票额 (AH–AR, manual_input)
    invoice_amt_m1   REAL DEFAULT 0,
    invoice_amt_m2   REAL DEFAULT 0,
    invoice_amt_m3   REAL DEFAULT 0,
    invoice_amt_m4   REAL DEFAULT 0,
    invoice_amt_m5   REAL DEFAULT 0,
    invoice_amt_m6   REAL DEFAULT 0,
    invoice_amt_m7   REAL DEFAULT 0,
    invoice_amt_m8   REAL DEFAULT 0,
    invoice_amt_m9   REAL DEFAULT 0,
    invoice_amt_m10  REAL DEFAULT 0,
    invoice_amt_m11  REAL DEFAULT 0,
    invoice_amt_m12  REAL DEFAULT 0,

    -- 月度回款额 (AS–BG 部分, manual_input)
    payment_amt_m1   REAL DEFAULT 0,
    payment_amt_m2   REAL DEFAULT 0,
    payment_amt_m3   REAL DEFAULT 0,
    payment_amt_m4   REAL DEFAULT 0,
    payment_amt_m5   REAL DEFAULT 0,
    payment_amt_m6   REAL DEFAULT 0,
    payment_amt_m7   REAL DEFAULT 0,
    payment_amt_m8   REAL DEFAULT 0,
    payment_amt_m9   REAL DEFAULT 0,
    payment_amt_m10  REAL DEFAULT 0,
    payment_amt_m11  REAL DEFAULT 0,
    payment_amt_m12  REAL DEFAULT 0,

    -- 月度预收款 (AS–BG 部分, manual_input)
    prepayment_amt_m1 REAL DEFAULT 0,
    prepayment_amt_m2 REAL DEFAULT 0,
    prepayment_amt_m3 REAL DEFAULT 0,
    prepayment_amt_m4 REAL DEFAULT 0,
    prepayment_amt_m5 REAL DEFAULT 0,
    prepayment_amt_m6 REAL DEFAULT 0,
    prepayment_amt_m7 REAL DEFAULT 0,
    prepayment_amt_m8 REAL DEFAULT 0,
    prepayment_amt_m9 REAL DEFAULT 0,
    prepayment_amt_m10 REAL DEFAULT 0,
    prepayment_amt_m11 REAL DEFAULT 0,
    prepayment_amt_m12 REAL DEFAULT 0,

    -- 回款比例 (AS–BG 部分, auto_calc)
    payment_ratio_m1 REAL,
    payment_ratio_m2 REAL,
    payment_ratio_m3 REAL,
    payment_ratio_m4 REAL,
    payment_ratio_m5 REAL,
    payment_ratio_m6 REAL,
    payment_ratio_m7 REAL,
    payment_ratio_m8 REAL,
    payment_ratio_m9 REAL,
    payment_ratio_m10 REAL,
    payment_ratio_m11 REAL,
    payment_ratio_m12 REAL,

    -- 预测数据 (BH–CE, manual_input)
    forecast_invoice     REAL DEFAULT 0,            -- 预测开票额(剩余月份合计)
    forecast_invoice_date TEXT,                      -- AU 预测开票时间
    forecast_payment     REAL DEFAULT 0,            -- 预测回款额
    forecast_payment_ratio REAL,                     -- 预测回款比例

    -- 统计汇总
    total_complete       REAL DEFAULT 0,            -- 年度完成额合计
    total_invoice        REAL DEFAULT 0,            -- 年度开票额合计
    total_payment        REAL DEFAULT 0,            -- 年度回款额合计
    total_prepayment     REAL DEFAULT 0,            -- 年度预收款合计

    -- 元数据
    is_locked            INTEGER DEFAULT 0,         -- 是否已锁定 (25日后)
    locked_by            TEXT,                      -- 锁定操作人
    locked_at            TEXT,                      -- 锁定时间

    created_at           TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at           TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (project_no) REFERENCES projects(project_no),
    UNIQUE (project_no, report_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_project ON monthly_records (project_no);
CREATE INDEX IF NOT EXISTS idx_monthly_month   ON monthly_records (report_month);

-- ============================================================================
-- 3. 年度基线表 (project_yearly_baseline)
-- 记录每年冻结的基准数据，支持跨年翻转与历史追溯 (§3.6)
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_yearly_baseline (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no      TEXT    NOT NULL,
    baseline_year   INTEGER NOT NULL,               -- 基准年份 (如 2025)

    -- 冻结基准值 (跨年瞬间从 CRB 快照抓取)
    year_end_complete_amt   REAL,                   -- 截止该年底累计完成额(含税)
    year_end_invoice_amt    REAL,                   -- 截止该年底累计开票
    year_end_payment_amt    REAL,                   -- 截止该年底累计回款
    year_end_contract_amt   REAL,                   -- 截止该年底总合同额(含税)

    -- 当年调整值 (年初归零, 允许填报)
    year_adjustment         REAL DEFAULT 0,

    created_at              TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (project_no) REFERENCES projects(project_no),
    UNIQUE (project_no, baseline_year)
);

CREATE INDEX IF NOT EXISTS idx_baseline_project ON project_yearly_baseline (project_no);
CREATE INDEX IF NOT EXISTS idx_baseline_year    ON project_yearly_baseline (baseline_year);

-- ============================================================================
-- 4. 预收款核销流水表 (prepayment_writeoffs)
-- 记录预收款→开票核销操作，财务审核期专属 (§2.16 #3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS prepayment_writeoffs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no      TEXT    NOT NULL,
    writeoff_amt    REAL    NOT NULL,               -- 核销金额
    writeoff_date   TEXT    NOT NULL,               -- 核销日期 (YYYY-MM-DD)
    invoice_no      TEXT,                           -- 关联发票号
    writeoff_note   TEXT,                           -- 核销备注
    operator        TEXT    NOT NULL,               -- 核销操作人 (财务审核角色)
    report_month    TEXT    NOT NULL,               -- 所属报告月

    created_at      TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (project_no) REFERENCES projects(project_no)
);

CREATE INDEX IF NOT EXISTS idx_writeoff_project ON prepayment_writeoffs (project_no);
CREATE INDEX IF NOT EXISTS idx_writeoff_month   ON prepayment_writeoffs (report_month);

-- ============================================================================
-- 5. 变更审计日志表 (audit_log)
-- 全量记录数据增删改，满足财务与运营审计要求 (§2.5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no      TEXT    NOT NULL,
    field_name      TEXT    NOT NULL,               -- 字段英文名 (如 contract_amt_inc_tax)
    field_cn        TEXT    NOT NULL,               -- 字段中文名 (如 总合同额(含税))
    old_value       TEXT,                           -- 修改前值
    new_value       TEXT,                           -- 修改后值
    change_reason   TEXT,                           -- 修改原因 (可选)
    operator        TEXT    NOT NULL,               -- 操作人
    operation_type  TEXT    NOT NULL,               -- insert / update / delete / import / unlock_edit
    report_month    TEXT    NOT NULL,               -- 所属报告月
    created_at      TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (project_no) REFERENCES projects(project_no)
);

CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log (project_no);
CREATE INDEX IF NOT EXISTS idx_audit_month   ON audit_log (report_month);
CREATE INDEX IF NOT EXISTS idx_audit_operator ON audit_log (operator);
CREATE INDEX IF NOT EXISTS idx_audit_time    ON audit_log (created_at);

-- ============================================================================
-- 6. 审批快照表 (snapshots)
-- 存储各审批节点的数据快照，不可变 (§2.6)
-- ============================================================================
CREATE TABLE IF NOT EXISTS snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version         TEXT    NOT NULL UNIQUE,        -- 版本键 (如 Draft:S520, Approve1:S520, J版)
    snapshot_type   TEXT    NOT NULL,               -- Draft / Approve1 / Approve2 / J版 / Month:YYYY-MM / PM:姓名:月
    sector_code     TEXT,                           -- 所属板块 (NULL 表示全公司)
    report_month    TEXT    NOT NULL,               -- 报告月
    snapshot_data   TEXT    NOT NULL,               -- JSON: 快照项目数据
    operator        TEXT    NOT NULL,               -- 触发操作人
    created_at      TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_type   ON snapshots (snapshot_type);
CREATE INDEX IF NOT EXISTS idx_snapshots_sector ON snapshots (sector_code);
CREATE INDEX IF NOT EXISTS idx_snapshots_month  ON snapshots (report_month);

-- ============================================================================
-- 7. 项目预警记录表 (project_alerts)
-- 持久化存储项目预警，支持 active/resolved 状态流转
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_no        TEXT    NOT NULL,               -- 关联项目号
    project_name      TEXT    NOT NULL DEFAULT '',    -- 项目名称（冗余，展示用）
    sector_code       TEXT    NOT NULL DEFAULT '',    -- 板块代码
    sector_name       TEXT    NOT NULL DEFAULT '',    -- 板块名称
    alert_type        TEXT    NOT NULL,               -- 预警类型标识
    alert_label       TEXT    NOT NULL DEFAULT '',    -- 预警中文标签
    detail            TEXT    NOT NULL DEFAULT '',    -- 预警详情（数值描述）
    year              INTEGER NOT NULL,               -- 系统年份
    month_idx         INTEGER NOT NULL,               -- 报告月索引 0-11
    status            TEXT    NOT NULL DEFAULT 'active', -- active | resolved
    first_detected_at TEXT    NOT NULL DEFAULT '',    -- 首次检测时间 ISO 8601
    resolved_at       TEXT    NOT NULL DEFAULT '',    -- 消除时间
    last_seen_at      TEXT    NOT NULL DEFAULT '',    -- 最近活跃时间

    UNIQUE(project_no, alert_type, year, month_idx)
);

CREATE INDEX IF NOT EXISTS idx_alerts_status  ON project_alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON project_alerts(project_no);

-- ============================================================================
-- 8. 预警永久忽略记录表 (project_alert_dismissals)
-- 系统管理员手动消除预警后，该项目该类型预警在任何月份不再出现
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_alert_dismissals (
    project_no   TEXT NOT NULL,               -- 关联项目号
    alert_type   TEXT NOT NULL,               -- 预警类型标识
    dismissed_at TEXT NOT NULL,               -- 操作时间 ISO 8601
    dismissed_by TEXT NOT NULL DEFAULT '',     -- 操作人标识

    PRIMARY KEY (project_no, alert_type)
);

-- ============================================================================
-- 9. 报告线主表 (report_lines)
-- 存储按板块×周期创建的报告线，支持多级审批流程
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_lines (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_code       TEXT    NOT NULL,                -- 板块代码，如 'SAS520'
    period            TEXT    NOT NULL,                -- 周期，如 '2026-06'
    status            TEXT    NOT NULL DEFAULT 'open', -- open/reviewing_director/reviewing_leader/completed/rejected/closed
    approval_node     TEXT,                            -- 当前审批节点: director/leader/null
    baseline_version  TEXT,                            -- fork时的基线版本(J版key)
    created_at        TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at        TEXT DEFAULT (datetime('now', 'localtime')),

    UNIQUE(sector_code, period)                       -- 每板块每周期唯一
);

CREATE INDEX IF NOT EXISTS idx_rl_sector  ON report_lines (sector_code);
CREATE INDEX IF NOT EXISTS idx_rl_period  ON report_lines (period);
CREATE INDEX IF NOT EXISTS idx_rl_status  ON report_lines (status);

-- ============================================================================
-- 10. PM提交状态表 (report_line_pm_status)
-- 记录报告线内各PM的提交状态
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_line_pm_status (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    report_line_id  INTEGER NOT NULL,
    pm_name         TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'open',  -- open/submitted/closed
    submitted_at    TEXT,

    FOREIGN KEY (report_line_id) REFERENCES report_lines(id),
    UNIQUE(report_line_id, pm_name)
);

CREATE INDEX IF NOT EXISTS idx_rlpm_report_line ON report_line_pm_status (report_line_id);
CREATE INDEX IF NOT EXISTS idx_rlpm_status       ON report_line_pm_status (status);

-- ============================================================================
-- 11. 审批记录表 (report_line_approvals)
-- 记录报告线审批流程的每一步操作
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_line_approvals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    report_line_id  INTEGER NOT NULL,
    action          TEXT    NOT NULL,                -- submit/approve/reject/auto_skip/close_pm
    actor_role      TEXT    NOT NULL,
    actor_name      TEXT    NOT NULL,
    comment         TEXT,
    from_status     TEXT,
    to_status       TEXT,
    created_at      TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (report_line_id) REFERENCES report_lines(id)
);

CREATE INDEX IF NOT EXISTS idx_rla_report_line ON report_line_approvals (report_line_id);
CREATE INDEX IF NOT EXISTS idx_rla_action      ON report_line_approvals (action);

-- ============================================================================
-- 12. 报告线项目数据表 (report_line_data)
-- 存储报告线内各项目的字段数据与相对baseline的变更差异
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_line_data (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    report_line_id  INTEGER NOT NULL,
    project_no      TEXT    NOT NULL,
    field_data      TEXT,                            -- JSON: 项目字段数据
    change_diff     TEXT,                            -- JSON: 相对baseline的变更
    updated_by      TEXT,
    updated_at      TEXT DEFAULT (datetime('now', 'localtime')),

    FOREIGN KEY (report_line_id) REFERENCES report_lines(id),
    UNIQUE(report_line_id, project_no)
);

CREATE INDEX IF NOT EXISTS idx_rld_report_line ON report_line_data (report_line_id);
CREATE INDEX IF NOT EXISTS idx_rld_project     ON report_line_data (project_no);