# 第二面试官：脱敏面试技术验证版

这是一个从真实项目代码中抽取的、只包含虚构数据和占位配置的技术验证仓库。它展示 AI 如何辅助面试官准备问题、在面试中提示追问、在面试后形成可追溯的面评草稿。它不是生产部署包，也不包含真实候选人数据、账号、凭据或公司基础设施配置。脱敏检查结果见 [docs/sanitization-report.md](docs/sanitization-report.md)。

## 1. 业务问题

面试官通常要在多个系统间查找 JD、简历、筛选意见和历史面评；面试中难以同时记录原话、检查覆盖度和组织追问；面试后又要从逐字稿中还原证据。结果是准备不一致、关键问题漏问、面评缺少原文依据，并且大量时间消耗在资料整理上。

## 2. 产品目标

系统不替代面试官作招聘决定，而是把面试材料、过程事实、AI 建议和人工结论放进同一条可审计链路。目标是缩短准备与整理时间，同时让每个重要结论尽可能回到候选人的真实原话。

## 3. 完整技术调用链

```text
JD / Resume / 历史面评
        │
        ▼
Interview Package 导入与确定性校验
        │
        ▼
Session（代码中由 Interview 聚合及其关系共同承载）
        │
        ├── 会前：LLM 或规则兜底 → Topics / Criteria / Opening Questions
        │                         └→ Zod 校验 → 事务写入
        │
        ├── 会中：会议字幕 → TranscriptLine 去重/持久化
        │                    └→ 增量 Context → LLM Follow-up
        │                                      └→ 结构校验 → SSE 推送
        │
        └── 会后：逐字稿 → LLM Review Draft
                           └→ quote + lineId 回绑真实 TranscriptLine
                              └→ Evidence 硬校验 → 人工编辑与批准
```

代码入口索引见 [docs/architecture.md](docs/architecture.md)。

## 4. 核心数据对象

- **Session**：产品概念上的“一场面试事实与状态容器”。当前代码没有名为 `Session` 的单一类，实际由 Prisma `Interview` 记录及其 Topic、Criteria、TranscriptLine、Suggestion、Review、Evidence、Approval 等关系组成。
- **Topic**：本场面试要覆盖的问题主题，包含状态、排序和材料来源引用。
- **Criteria**：评价口径与证据要求，帮助不同面试官按相近标准判断。
- **TranscriptLine**：逐字稿最小事实单元，保存角色、说话人、文本、时间、来源和稳定标识。
- **Structured Patch**：本文对三个 LLM 环节“只返回严格结构化对象”的统称；代码没有一个万能 `Patch` 类，而是分别使用 `PlanGenOutputSchema`、`FollowupGenOutputSchema`、`ReviewGenOutputSchema`。人工编辑面评另有 `ReviewPatchSchema`。
- **Evidence**：结论引用的原文证据，核心字段为 `lineId`、`quote` 和来源类型。程序会验证行存在、未删除、角色正确且 quote 真的是该行文本的子串。

## 5. 为什么这样设计

LLM 擅长理解材料、发现缺口和组织草稿，但不适合成为业务事实的唯一写入者。因此系统把“生成建议”和“确认事实”分开：模型只提供候选结构；Zod、数据库事务、状态机、幂等键、证据校验和人工批准负责把关。逐字稿作为事实底座，AI 结果可以失败、过期或被忽略，主流程仍可继续。

## 6. LLM 在哪三个环节使用

1. **会前计划**：根据 JD、简历和待核实点生成 Topic、Criteria 和开场问题。
2. **会中追问**：基于新增逐字稿和当前覆盖状态生成缺口、澄清或追问建议。
3. **会后面评**：根据候选人原话形成分维度草稿、优势、风险和待确认问题。

LLM 配置为空时，会前和会后进入规则兜底；会中不阻断字幕采集。

## 7. 哪些环节由确定性程序负责

- 导入包 Schema 校验、长度限制和安全外部 ID 校验；
- 面试状态转换、重复请求幂等、计划确认锁和数据库事务；
- TranscriptLine 去重、游标、租约、重试和持久化；
- Prompt 中不可信材料的分隔、转义和截断；
- LLM JSON 解析与 Zod 严格校验；
- Evidence 行号、角色、删除状态和 quote 子串验证；
- Suggestion 有效期、代次、前端过期过滤和人工反馈；
- Review 的人工编辑、批准和可审计导出。

## 8. 如何防幻觉

Prompt 会要求引用证据，但这只是软约束。硬约束在程序层：会后 LLM 给出的 quote 必须映射到真实候选人 `TranscriptLine`；无法匹配的结论不会进入草稿；批准前再次逐条验证 Evidence。没有证据时，系统保留“待核实”或规则草稿，不把推断伪装成事实。结构化输出还必须通过严格 Schema，未知字段和非法枚举会被拒绝。

需要注意：会前 `sourceRefs` 数据结构和编辑校验已经存在，但当前 LLM 生成路由没有像会后 Evidence 那样完成逐条原文硬绑定。因此它仍是待补强项，不能表述为已经达到同等级别的证据约束。

## 9. 如何做实时分析与节流

会议采集 Worker 按游标增量获取字幕，使用稳定键去重，并用数据库租约避免多个 Worker 同时处理同一场面试。追问引擎按固定 tick 运行，满足最小新增行数后才分析；每次限制批量、保留增量上下文、对近期观察做哈希去重，失败时指数退避。建议带 `generation` 和 `expiresAt`，前端只显示未过期结果，并通过 SSE 接收新增事件。

当前 `publishEvent` 是进程内内存总线，而 API 与 Worker 可独立运行。若事件由 Worker 产生、SSE 连接位于 API 进程，实时推送可能丢失。生产化需要 Redis Pub/Sub、PostgreSQL LISTEN/NOTIFY 或 Outbox relay 等跨进程通道。详见 [docs/limitations.md](docs/limitations.md)。

## 10. 如何运行 Demo

最低风险的验证方式是先运行纯单元测试；它不需要数据库、真实会议或真实 LLM 凭据。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test:unit
```

完整集成测试要求显式提供数据库名以 `_test` 结尾的专用 PostgreSQL：`TEST_DATABASE_URL=... pnpm test`。测试保护会拒绝未提供、非 PostgreSQL或数据库名不符合规则的连接，防止误操作已有数据库。

若要启动应用，请复制 `.env.example` 为 `.env`，连接一个**可随时删除的本地空 PostgreSQL 数据库**，生成 Prisma Client 后启动 API 和 Web。不要指向任何已有或生产数据库。

```bash
pnpm --filter @vice/database exec prisma generate
pnpm dev
```

仓库不包含生产 migration、部署脚本和真实飞书凭据。可使用 [demo-data/fake_interview_package.json](demo-data/fake_interview_package.json)、虚构 JD、简历和逐字稿理解或测试输入格式。未配置 LLM Key 时可观察规则兜底路径。

## 11. 已有测试

提交版保留了 Unit Test、Schema Test、Prompt 安全与 LLM 传输防护测试，覆盖状态机、导入校验、Evidence、结构化输出、Prompt Injection 隔离、XML 转义、超时/错误分类、限流、计划回退、SSE 和飞书适配边界等。`pnpm test:unit` 运行不连接数据库的单元及适配边界集合：16 个测试文件、246 个 test case 已通过，其中包含使用 synthetic 请求上下文的 SSE/OAuth 边界测试。仓库共保留 23 个测试文件、静态统计 305 个 `it/test` 声明；其余数据库 API 集成用例没有在本脱敏流程中执行，因为未配置专用 `_test` PostgreSQL。

这些是**工程测试**，证明代码约束按预期工作；它们不是对真实面试效果的准确率证明。当前仓库不存在一个仍以“26 项”为唯一口径的独立测试套件；历史所称“26 项 LLM 测试”是 Prompt、Schema、Injection、Failure Classification 等工程防护用例的旧统计，不能包装成 26 场真实面试或招聘决策准确率。推荐的产品效果评测见 [docs/eval-design.md](docs/eval-design.md)，其中所有未执行项目均明确标记为建议方案。

## 12. 当前真实完成状态

已由代码证明的部分包括：材料导入与 Session 聚合、会前结构化计划和规则回退、逐字稿模型与去重、会议采集适配边界、会中增量追问引擎、SSE 接口、会后带原文绑定的面评草稿、人工编辑/批准，以及相关工程测试。

本仓库不能证明生产环境已经稳定运行，也不能证明真实飞书会议从创建到字幕、追问、面评的完整 E2E 已验收。它应被描述为“功能实现与工程验证版，仍有集成和效果评测待完成”。

## 13. 当前已知风险 / 未验证项

- Worker 与 API 的进程内事件总线无法可靠跨进程推送；
- 真实飞书实时字幕权限、事件时序与长会议稳定性未由本仓库证明；
- 会前 `sourceRefs` 尚未达到会后 Evidence 的同等级硬绑定；
- 产品效果指标和 Golden Dataset 尚未真实执行；
- 上游 ATS/招聘系统自动同步不在本提交版范围；
- 凭据轮换、监控告警、备份恢复和生产容量未随脱敏版交付；
- 源码的对外披露权和公司知识产权归属必须由提交者人工确认。

## 14. 我的角色

- 负责产品/业务设计：定义面试前、中、后的工作流、人工确认点和验收标准；
- 参与架构决策：选择 Session 聚合、结构化输出、Evidence 硬约束、实时节流和失败降级方案；
- 使用 AI Coding 辅助实现：由 AI 协助生成、修改和审查部分代码，不表述为全部手写；
- 负责联调、测试与验收：组织工程测试、问题复现、部署联调和产品验收，并对尚未完成的 E2E 与效果评测如实标注。
