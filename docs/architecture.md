# 架构与代码索引

## 聚合模型

产品文档中的 Session 是一场面试的事实与状态容器。代码使用 `Interview` 聚合实现，而非单独的 `Session` 类：

```text
Interview
├── JobSnapshot / CandidateSnapshot / ScreeningSummary / PreviousRoundSummary
├── InterviewPlan
│   ├── Topic
│   └── Criteria
├── Participant
├── TranscriptLine
├── LiveSuggestion
├── ReviewDraft
│   ├── ReviewConclusion
│   └── EvidenceRef
├── Approval
├── CaptureLease
└── AuditEvent / OutboxEvent / WorkspaceSync
```

数据库模型见 `packages/database/prisma/schema.prisma`；业务状态机和证据规则见 `packages/domain/src`；跨层 DTO 和 Zod Schema 见 `packages/contracts/src`。

## 数据调用链

### 会前

1. `packages/contracts/src/schemas.ts` 的 `InterviewPackageSchema` 校验外部导入。
2. `apps/api/src/routes/interviews.ts` 幂等创建聚合事实。
3. `apps/api/src/routes/plans.ts` 读取 JD、简历和待核实点。
4. `packages/llm/src/prompts.ts` 将不可信材料放入分隔块并转义。
5. `packages/llm/src/prompts.ts` 中与 Prompt 同版本维护的 `PlanGenOutputSchema` 严格校验模型 JSON。
6. 校验后的 Topic / Criteria 在数据库事务中写入；失败则使用规则模板。

### 会中

1. `apps/api/src/services/capture-worker.ts` 获取会议增量事件，维护租约和游标。
2. `capture-worker.ts` 生成内容哈希并按平台句子 ID 更新或创建记录，`packages/database/prisma/schema.prisma` 的唯一键负责最后一道重复写入约束。
3. `apps/api/src/services/followup-engine.ts` 按 tick、最小新增行和批量上限构建增量 Context。
4. `FollowupGenOutputSchema` 校验结构化建议，近期观察哈希用于去重。
5. 建议写入数据库并设置 `generation`、`expiresAt`。
6. `apps/api/src/routes/sse.ts` 提供进程内 SSE；前端 `Workbench.tsx`、`RightPanel.tsx` 过滤过期结果。

实际代码是 SSE，不是 WebSocket。

### 会后

1. `apps/api/src/routes/reviews.ts` 读取计划和逐字稿。
2. `ReviewGenOutputSchema` 校验模型草稿。
3. 模型 quote 逐条回查真实、未删除且角色为候选人的 TranscriptLine。
4. 无法回绑证据的结论被丢弃；必要时生成规则草稿。
5. 人工使用 `ReviewPatchSchema` 编辑。
6. 批准前 `packages/domain/src/validation.ts` 再次执行 Evidence 硬校验。

## Structured Patch 的准确含义

LLM 没有数据库写权限，也不返回可直接执行的 SQL 或任意业务命令。三个环节分别返回受 Zod 限制的 JSON：

- `PlanGenOutputSchema`
- `FollowupGenOutputSchema`
- `ReviewGenOutputSchema`

解析失败、字段越界、未知枚举或缺少必要字段时，输出不会写入业务事实。`ReviewPatchSchema` 是人工编辑接口的 Patch；不要把四者误说成一个实际存在的通用 Patch 类。

## Evidence 硬约束

`validateEvidenceRefs` 依次确认：

1. `sourceId` 对应真实 TranscriptLine；
2. 该行没有被软删除；
3. Evidence quote 规范化后是原行文本的真实子串；
4. 用于结论的证据来自候选人，而非面试官或系统；
5. 结论至少有一条逐字稿证据。

Prompt 中“请引用原文”是软约束；上述程序校验才是硬约束。

## 失败与降级

- **会前**：未配置 LLM、调用异常或结构解析失败时，使用规则模板，并记录生成模式和原因。
- **会中**：LLM 失败时批次重新入队并指数退避；字幕采集和事实落库继续运行。
- **会后**：LLM 失败或证据无法匹配时生成规则草稿；草稿仍需人工编辑和批准。
