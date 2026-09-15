# AGENTS.md — 智能体协作入口

本文件是本仓库的智能体协作入口，适用于 WorkBuddy / CodeBuddy / Claude Code / Codex / Cursor 等读取 `AGENTS.md` 的工具。
人类贡献者请先读 [README.md](README.md)。

## 1. 先建立正确预期

- 本仓库是「第二面试官」的**脱敏技术验证版**，用于代码审阅和本地技术验证，**不是生产部署包**。
- `demo-data/` 全部是人工虚构（synthetic）数据；`.env.example` 只包含不可用占位值。
- **事实纪律（本仓库最重要的一条）**：不要把「设计存在」写成「已完成」。任何能力描述必须能指向可出示的代码、测试或运行记录。边界见 [docs/project-status.md](docs/project-status.md)、[docs/limitations.md](docs/limitations.md) 和 [docs/sanitization-report.md](docs/sanitization-report.md)。

## 2. 30 秒上手

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test:unit        # 纯单元测试：不需要数据库、不需要 LLM Key
pnpm typecheck        # 各包 tsc --noEmit
```

集成测试与数据库脚本**必须**指向一个可随时删除、库名以 `_test` 结尾的专用 PostgreSQL：

```bash
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/vice_interviewer_test pnpm test
```

`test/globalSetup.ts` 会拒绝未提供或库名不符合规则的连接，这是防止误操作已有数据库的保护，不要绕过。

完整命令与排障见 [docs/development.md](docs/development.md)。

## 3. 目录索引

| 路径 | 职责 | 备注 |
|---|---|---|
| `apps/api` | Fastify 5 HTTP API + 后台 Worker | 路由前缀 `/api/v1`；`src/worker.ts` 是独立进程入口 |
| `apps/web` | React 18 + Vite 5 前端 | 路由：`/login`、`/auth/callback`、`/`（面试列表）、`/interview/:id`（工作台） |
| `packages/contracts` | 跨层 Zod Schema 与枚举 | 所有外部输入的第一道校验 |
| `packages/domain` | 纯函数领域层：状态机、证据校验、同步冲突、归档 | 不依赖 Fastify / React，可单测 |
| `packages/database` | Prisma 5.22 schema 与客户端 | schema 在 `prisma/schema.prisma` |
| `packages/llm` | LLM 客户端、Prompt 模板与输出 Schema | 三个环节的 `*GenOutputSchema` 与 Prompt 同版本维护 |
| `test/` | vitest 测试 | `test/domain`、`test/api`、`test/web` 及跨层测试 |
| `demo-data/` | 虚构输入样例 | JD、简历、Interview Package、逐字稿 JSONL |
| `docs/` | 产品、架构、状态与协作文档 | 见下方文档地图 |

文档地图：

- 产品与角色 → [docs/product.md](docs/product.md)
- 代码索引与调用链 → [docs/architecture.md](docs/architecture.md)
- 本地开发与环境 → [docs/development.md](docs/development.md)
- 已实现 / 未实现 / 缺口 → [docs/project-status.md](docs/project-status.md)
- 协作、分支、提交、评审 → [docs/agent-collaboration.md](docs/agent-collaboration.md)
- 效果评测设计（未执行） → [docs/eval-design.md](docs/eval-design.md)

## 4. 架构不变量（改代码前必须知道）

1. **LLM 不写业务事实。** 模型只返回受 Zod 限制的 JSON；写库由确定性代码在事务中完成。三个环节分别是 `PlanGenOutputSchema`、`FollowupGenOutputSchema`、`ReviewGenOutputSchema`，人工编辑面评另有 `ReviewPatchSchema`——**不存在**一个通用的 `Patch` 类，不要这样描述代码。
2. **Evidence 是硬约束。** `validateEvidenceRefs` 逐条确认：行存在、未软删除、quote 是原行文本子串、证据来自候选人、结论至少一条逐字稿证据。Prompt 里的「请引用原文」只是软约束。批准前会再次校验。
3. **逐字稿是事实底座。** 字幕采集、去重、游标、租约、重试必须能在 LLM 完全失败时继续工作。
4. **失败必须降级，不能中断主流程。** 会前/会后 LLM 失败 → 规则兜底；会中 LLM 失败 → 批次重新入队并指数退避。
5. **实时通道是 SSE，不是 WebSocket。** 订阅者与事件总线在进程内内存中；API 与 Worker 分进程时推送可能丢失，这是已知限制，不要在文档里说成可靠跨进程推送。
6. **状态转换集中在 `packages/domain`。** 面试状态机与面评状态机各有自己的转换函数，不要在路由里手写状态赋值。

## 5. 代码规范

- ESM（各包 `"type": "module"`）。**TS 源码内的相对导入必须带 `.js` 后缀**（如 `./state-machine.js`），因为 `moduleResolution: "bundler"` + esbuild `resolveExtensions` 按此约定解析。
- TypeScript 严格模式，且开启 `noUnusedLocals` / `noUnusedParameters`——未使用的变量会直接让 `typecheck` 失败。
- 跨层 DTO 一律走 `@vice/contracts` 的 Zod Schema，不要在新地方手写 `interface` 充当契约。
- 领域逻辑放 `packages/domain`，保持纯函数、无 IO、可单测；路由只做「校验 + 编排 + 响应」。
- 时间、随机数等非确定性来源不要在领域层直接调用，便于测试。
- 不要修改 `.env.example` 中占位值的「不可用」语义（例如把它改成看似可用的地址）。

## 6. 测试约定

- 领域逻辑变更 → 在 `test/domain/` 补测试。
- API 行为变更 → 在 `test/api/` 补测试（需要 `_test` 专用库）。
- **不依赖数据库的新测试文件，必须登记到 `vitest.unit.config.ts` 的 `include` 列表**，否则 `pnpm test:unit` 不会跑到它。
- 不要为了让测试通过而放宽 `test/globalSetup.ts` 的数据库名保护。

## 7. 提交与 PR

分支命名、提交信息、PR 检查清单和证据要求见 [docs/agent-collaboration.md](docs/agent-collaboration.md)。
要点：小步提交、PR 里写清「已验证 / 未验证」、不把未执行的事情写成已完成。

## 8. 已知缺口（改这些之前先看）

| 缺口 | 影响 |
|---|---|
| `packages/database/src/seed.ts`、`seed-e2e.ts` 不存在 | `pnpm db:seed`、`db:seed-e2e`、`db:reset` 会直接失败 |
| 无 `prisma/migrations/` | `db:migrate:*` 无迁移可执行 |
| 无 `playwright.config.*`、无 `e2e/` | `pnpm test:e2e` 无法运行 |
| 进程内 SSE 事件总线 | API/Worker 分进程时实时推送可能丢失 |
| 会前 `sourceRefs` 无逐条原文硬绑定 | 会前内容仍需面试官人工核对 |
| 无 Golden Dataset 与效果指标 | 不能声称产品效果已验证 |

细节与建议处理方式见 [docs/project-status.md](docs/project-status.md)。

## 9. 红线

- **不要**引入真实凭据、内部域名、内部 IP、真实候选人/员工数据或生产数据库连接。
- **不要**新增必然失败的 CI 步骤；新增 CI 检查前先确认它在无密钥、无数据库的环境下可运行。
- **不要**为了让虚构数据看起来更真实而改动 `demo-data/` 的语义。
- **不要**删除或弱化 `docs/sanitization-report.md` 中的未验证项结论。
- **不要**在未取得授权的情况下扩大本仓库的对外披露范围；权利边界问题必须由人类 Owner 决定。
