# 产品说明

本文描述「第二面试官」的产品定位、角色、核心流程与人工确认点。技术实现见 [architecture.md](architecture.md)；当前完成度见 [project-status.md](project-status.md)。

## 1. 业务问题

面试官在真实工作流中同时面对三件事：

1. **会前**：JD、简历、筛选意见、历史面评分散在多个系统，准备质量依赖个人习惯，标准不一致。
2. **会中**：既要听、又要记原话、还要检查覆盖度并组织追问，注意力被切成几份。
3. **会后**：要从逐字稿里还原证据写面评，耗时且容易凭印象下结论。

结果是准备不一致、关键问题漏问、面评缺少原文依据，大量时间消耗在资料整理上。

## 2. 产品目标与非目标

**目标**：把面试材料、过程事实、AI 建议和人工结论放进同一条可审计链路，缩短准备与整理时间，并让每个重要结论尽可能回到候选人的真实原话。

**非目标**：

- 不替代面试官作招聘决定。系统产出的是候选结构与草稿，不是结论。
- 不做候选人自动筛选、不做自动淘汰。
- 不是可直接上线的部署包；仓库不含生产配置、密钥与运维脚本。

## 3. 角色

角色枚举定义在 `packages/contracts/src/enums.ts` 的 `UserRole`：

| 角色 | 关注点 |
|---|---|
| `interviewer` 面试官 | 本场面试的计划、实时提示、面评草稿与批准 |
| `hiring_manager` 用人经理 | 面评结论、轮次决策、台账状态 |
| `recruiter` 招聘 | 面试安排、材料导入、台账同步 |
| `admin` 管理员 | 账号与访问边界 |

当前脱敏版从标准 Interview Package 导入开始，不包含真实 ATS 的账号映射、候选人授权与自动同步实现（见 [limitations.md](limitations.md) 第 5 节）。

## 4. 核心流程

### 会前：从材料到可确认的计划

```
JD / 简历 / 筛选意见 / 历史面评
  → Interview Package 导入（严格 Schema 校验 + 幂等）
  → 生成 Topic / Criteria / 开场问题（LLM，失败则规则兜底）
  → Zod 严格校验 → 事务写入
  → 面试官人工核对与编辑 → 确认（plan/confirm）
```

产出：一张覆盖「要问什么、按什么口径判断、证据要求是什么」的计划。计划确认是进入面试的前置锁。

### 会中：从字幕到可用的追问提示

```
会议字幕（增量）
  → TranscriptLine 去重 / 游标 / 租约 / 持久化
  → 按 tick 与最小新增行数构建增量 Context
  → LLM 生成追问建议（结构化输出 + 校验）
  → 有效期 + 代次 + 近期观察哈希去重
  → SSE 推送到工作台右侧
```

面试官看到的是**建议**，是否采纳完全由人决定；系统在证据不足或不该发言时保持沉默。

建议类型（`SuggestionKind`）：`missing_evidence`、`clarify_scope`、`clarify_metric`、`followup_question`、`topic_uncovered`、`time_check`。

### 会后：从逐字稿到可追溯的面评

```
逐字稿
  → LLM 生成面评草稿（结构化输出）
  → 逐条 quote + lineId 回绑真实候选人 TranscriptLine
  → 无法回绑证据的结论被丢弃
  → 人工编辑（ReviewPatchSchema）
  → 批准前 Evidence 硬校验 → 批准
  → 同步到工作区 / 台账（含冲突检测）
```

面评内容被显式区分为四类（`ContentType`）：`fact` 事实、`inference` 推断、`open_question` 待确认问题、`human_decision` 人工决定。**推断不会被伪装成事实**——这是产品可信度的基础。

## 5. 人工确认点

系统刻意把「生成建议」和「确认事实」分开，共三处硬性人工闸门：

| 确认点 | 位置 | 作用 |
|---|---|---|
| 计划确认 | `POST /interviews/:id/plan/confirm` | 锁定本场要覆盖的 Topic / Criteria，之后会中提示以此为基准 |
| 面评批准 | `POST /interviews/:id/review/approve` | 批准前再次逐条校验 Evidence；批准后进入同步流程 |
| 同步冲突处理 | `POST /interviews/:id/review/sync-conflicts/resolve` | 工作区回写冲突需人工选择处理方式 |

人工决定只有三种取值（`HumanDecision`）：`pass`、`hold`、`reject`。

## 6. 状态与生命周期

### 面试主状态

`InterviewStatus` 共 20 个取值，覆盖从 `created` 到 `closed` 的完整生命周期，含异常分支：

```
created → package_imported → plan_generating → plan_draft → ready
  → binding → bound → capturing → live → ending → ended
  → transcript_finalizing → review_generating → review_draft
  → review_approved → synced → closed
```

异常/旁路状态：`capture_failed`、`attention_required`、`cancelled`。

### 面评子状态机

面评有独立子状态机（`ReviewStatus`，10 个取值），与主状态的 `review_*` / `synced` 建立映射：

```
not_started → generating → draft_ready → editing → approval_pending → approved → sync_pending → synced
                  ↓                                                                    ↓
           validation_failed                                                    sync_conflict
```

状态转换集中在 `packages/domain`，不在路由中手写赋值。

### 台账状态

`LedgerStatus` 由「面试状态 + 面评结论 + 人工决定」映射得出，用于面试台账展示：

`not_set`、`in_progress`、`evaluation_pending`、`next_round`、`offer_evaluation`、`pending_confirm`、`rejected`。

其中 `pending_confirm` 专门表示「AI 建议淘汰、等待人工确认」——系统不自行产出淘汰结论。

## 7. 前端界面

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | `LoginPage` | 登录（本地可开启 mock auth） |
| `/auth/callback` | `AuthCallback` | 飞书 OAuth 回调 |
| `/` | `InterviewList` | 面试列表、新建、导入 |
| `/interview/:id` | `Workbench` | 工作台：左侧计划与材料、中间逐字稿/计划/面评、右侧实时建议与同步面板 |

工作台在会中显示采集状态条（`CaptureStatusBar`），并在右侧过滤已过期建议。

## 8. 验收口径（重要）

必须区分两类「验证」，不要把后者说成前者：

- **工程验证（已执行）**：`pnpm test:unit`，16 个测试文件 / 246 个 test case，覆盖 Schema、状态机、Evidence 规则、Prompt 隔离、结构化输出、限流、降级、SSE 与飞书适配边界；本分支补齐 `prisma/migrations/` 后，又在一个一次性 `_test` PostgreSQL 上执行了全量 `pnpm test`，23 个测试文件 / 315 个 test case 通过（含 `test/api/` 的 7 个集成文件 69 个用例）。这两者回答的都是「约束是否生效」，不是产品效果。
- **产品效果验证（未执行）**：Golden Dataset、历史时点回放、Suggestion Precision / Coverage / Redundancy / Evidence Accuracy / Latency / Silence Quality 等指标。方案见 [eval-design.md](eval-design.md)，**尚未测量**。

因此本仓库**不能**声称「AI 建议有效」或「招聘判断准确」，只能声称相关工程约束已实现并有测试覆盖。
