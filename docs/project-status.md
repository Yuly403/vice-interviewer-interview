# 项目状态

本文如实记录「已实现 / 已测试 / 未验证 / 缺失」四类状态，用于避免把「设计存在」表述为「已完成」。
产品定位见 [product.md](product.md)，限制说明见 [limitations.md](limitations.md)。

## 1. 状态口径

| 标记 | 含义 |
|---|---|
| **已验证** | 有可复现的执行结果（命令 + 输出），且已在本仓库中实际跑过 |
| **代码存在** | 源码在仓库中，逻辑完整，但缺少端到端运行证据 |
| **设计存在** | 数据结构或接口已定义，链路未打通或未验证 |
| **缺失** | 引用了但文件不存在，或功能未纳入脱敏版 |

## 2. 本次核验记录

核验环境：

- WorkBuddy：Windows，Node 22.22.2，pnpm 9.15.9，2026-09-14；
- Codex 复验：Ubuntu WSL2，Node 22.22.1，pnpm 9.15.9，2026-09-15。

| 检查项 | 结果 | 说明 |
|---|---|---|
| `pnpm install --frozen-lockfile` | **通过** | 解析 240 个包，锁文件一致 |
| 单元测试（`vitest.unit.config.ts` 口径） | **通过：16 个文件 / 246 个用例** | 与 README 声明的数字一致 |
| 测试文件静态统计 | **23 个文件 / 305 个 `it`/`test` 声明** | 与 README 声明一致 |
| `prisma generate` | **通过** | 生成 Prisma Client v5.22.0 |
| `pnpm typecheck` | **通过：6 个包全部通过** | 必须在 `prisma generate` 之后执行 |
| `pnpm build` | **通过（Ubuntu WSL2）** | Web：106 个模块完成转换并生成产物；API：生成 `dist/server.mjs` 与 `dist/worker.mjs` |
| 集成测试（`pnpm test`） | **未执行** | 未配置库名以 `_test` 结尾的专用 PostgreSQL；**该结论已在 2026-09-17 被推翻，见下文** |

### 2026-09-17 WorkBuddy 复验（协作基础基线 `d5b73e6`）

核验环境：Windows，Node 22.22.2，pnpm 9.15.9。

| 检查项 | 结果 | 说明 |
|---|---|---|
| `pnpm install --frozen-lockfile` | **通过** | 输出 `Lockfile is up to date, resolution step is skipped`；`node_modules` 已存在，未重新解析包，故本节不重复 240 这个数字 |
| 单元测试（`vitest.unit.config.ts` 口径） | **通过：16 个文件 / 246 个用例** | 与 README、本文档声明一致 |
| 测试文件静态统计复核 | **305 个 `it`/`test` 声明** | 按行首模式计得 306 处，其中 1 处是 `test/plan-generation.test.ts` 的 `it.each(`，按声明口径为 305 |
| `prisma generate` | **通过** | 生成 Prisma Client v5.22.0 |
| `pnpm typecheck` | **通过：6 个包全部通过** | 在 `prisma generate` 之后执行 |
| `pnpm build` | **通过（Windows）** | Web：106 个模块完成转换；API：生成 `dist/server.mjs` 与 `dist/worker.mjs` |
| 文档站内链接可达性 | **通过：15 个 Markdown、31 条站内链接、0 断链** | 本次新增的检查方式，不是仓库既有命令 |
| 集成测试（`pnpm test`） | **未执行（仅限 Windows 侧）** | Windows 侧没有可直连、库名以 `_test` 结尾的专用 PostgreSQL，也没有可用凭据；同一分支已在 WSL2 侧执行通过，见下一小节 |

本次同时确认一个仓库卫生问题：`pnpm build` 会在 `apps/web/` 下残留 Vite 临时文件 `vite.config.ts.timestamp-*.mjs`，使 `git status` 变脏。已补 `.gitignore` 规则（第 6 行），并在同一规则下复核 `git status` 恢复干净。

### 2026-09-17 WorkBuddy 集成测试复验（Ubuntu WSL2 + 一次性 PostgreSQL）

核验环境：Ubuntu WSL2，Node 22.22.1，pnpm 9.15.9，PostgreSQL 18.6。

为避免误连任何已有数据库，本次在 WSL 内用 `initdb` 新建了**独立、可随时删除**的实例（只监听 `127.0.0.1:55432`，trust 认证）并建库 `vice_interviewer_test`；系统自带的 5432 实例全程未被连接或修改。`test/globalSetup.ts` 的库名 `_test` 保护未被绕过。

| 检查项 | 结果 | 说明 |
|---|---|---|
| 生成初始迁移 | **通过** | `prisma migrate dev --name init` 生成 `packages/database/prisma/migrations/20260917084821_init/migration.sql`（404 行）与 `migration_lock.toml`（`provider = "postgresql"`） |
| 完整测试（`vitest.config.ts` 口径） | **通过：23 个文件 / 315 个用例** | 含 `test/api/` 7 个文件 69 个用例；`globalSetup` 打印 `Test database reset through reviewed migrations` |
| 空库幂等复跑 | **通过：23 个文件 / 315 个用例** | 销毁实例重新 `initdb`，由 `prisma migrate reset` 从零应用同一条迁移链后重跑，结果与上一次一致 |
| Windows 侧 `pnpm test:unit` | 不适用 | `_test` 库在 WSL 内且端口未转发到 Windows；`test:unit` 不依赖数据库，已在 Windows 侧单独通过 |

结论：迁移链在**空库**上可被 `prisma migrate reset` 正确应用，`test/api` 集成用例由「无法运行」变为**已实际执行并通过**（明细见第 3 节）。

> 冲突提示：本分支新增 `prisma/migrations/`，与两份**时点记录**中的表述存在冲突——[sanitization-report.md](sanitization-report.md)（2026-08-26）写「数据库 migration、seed 与生产运维脚本」已排除，[limitations.md](limitations.md) 第 6 节写「仓库故意排除了生产 migration」。按仓库红线，本次**未修改这两份文件**。新增的迁移完全由仓库中**已经公开**的 `schema.prisma` 生成，不含生产连接、凭据或真实数据；是否随分支合并由人类 Owner 决定，未合并前 `main` 的状态不变。

### 重要：typecheck 必须晚于 prisma generate

这一点本次已双向验证，属于**必须遵守的执行顺序要求**，不是代码缺陷：

- **未生成 Prisma Client 时**：`pnpm typecheck` 在 `@vice/api` 报出 25 处 `TS7006: Parameter 'x' implicitly has an 'any' type`（分布在 `routes/reviews.ts`、`routes/transcripts.ts`、`services/capture-worker.ts`、`services/followup-engine.ts`、`services/post-meeting.ts`）。
- **根因**：未生成时 `@prisma/client` 提供的是存根类型，内容为 `export declare const PrismaClient: any`（`node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/default.d.ts`）。Prisma 模型类型退化为 `any` 后，所有遍历查询结果的回调参数都变成隐式 `any`。
- **生成之后**：`pnpm typecheck` 6 个包全部通过，上述 25 处错误全部消失。

因此 `.github/workflows/ci.yml` 已把 `prisma generate` 放在 `typecheck` 之前。本地开发同理：**`pnpm install` 之后、`pnpm typecheck` 之前必须先生成一次**。`@prisma/client` 的 postinstall 在 monorepo 中找不到 schema（会打印 `We could not find your Prisma schema in the default locations`），不会自动生成。

## 3. 已验证

`pnpm test:unit` 的 246 个用例按主题归类如下，每一项都能回到具体文件：

- **核心业务约束的单元级验证**：面试状态机、面评子状态机、Evidence 校验、去重键、Topic 覆盖度、同步冲突检测与动作建议，均有测试覆盖并通过。`test/domain/` 5 个文件共 119 个用例：`state-machine` 22、`review-state-machine` 23、`sync-conflict-detector` 20、`sync-action-advisor` 27、`validation` 27。
- **归档与台账**：归档导出（`test/interview-archive.test.ts` 33 个用例）与台账映射（`test/ledger-mapper.test.ts` 24 个用例）通过。这两个主题的测试文件位于 `test/` 根目录，**不在 `test/domain/` 下**，因此不计入上一条的 119。
- **契约与 Prompt 安全**：Interview Package 严格校验、结构化输出解析、Prompt 不可信材料隔离与转义、LLM 失败分类、限流，共 33 个用例通过。构成为 `test/llm-*.test.ts` 25 个（`llm-prompts` 18、`llm-client-guardrails` 4、`llm-rate-limit` 3）与 `test/plan-generation.test.ts` 8 个。
- **适配边界**：飞书 OAuth（18 个用例）、飞书服务（2 个）、SSE 路由（10 个，含过期 token 拒绝）通过。
- **Demo 数据有效性**：`test/demo-data.test.ts` 校验 `demo-data/` 通过真实 Zod Schema（2 个用例）。
- **前端表单单元**：`test/web/new-interview.test.ts` 5 个用例通过。
- **生产构建**：Ubuntu WSL2 中执行 `pnpm build` 通过；Web 完成 106 个模块转换并生成静态产物，API 生成 `dist/server.mjs` 和 `dist/worker.mjs`。Windows 侧复验同样通过，见第 2 节。

以下是集成口径（`pnpm test`，需要 `_test` PostgreSQL），已在第 2 节记录的 WSL2 环境中实际执行：

- **API 集成链路**：`test/api/` 7 个文件 69 个用例全部通过——逐字稿导入与幂等（`transcripts.test.ts` 11）、计划生命周期（`plans-lifecycle.test.ts` 6）、面评全流程（`review-full-flow.test.ts` 8）、同步流程（`sync-flow.test.ts` 6）、错误处理（`error-handling.test.ts` 20）、面试主流程（`interviews.test.ts` 10）、鉴权（`auth.test.ts` 8）。

以上单元口径合计 119 + 57 + 33 + 30 + 2 + 5 = 246，与 `pnpm test:unit` 的 16 个文件 / 246 个用例一致；加上 `test/api/` 的 69 个集成用例，`pnpm test` 全量为 **23 个文件 / 315 个用例**，已实际通过。

## 4. 代码存在，但缺少端到端证据

- **（已解决，保留历史记录）API 集成链路**：在基线 `d5b73e6` 及更早，`test/api/` 下 7 个文件覆盖导入幂等、计划生命周期、面评全流程、同步流程、错误处理与鉴权，但**未执行**（需要专用 PostgreSQL），因此「接口在真实数据库上按预期工作」在当时**未经验证**。本分支补齐 `prisma/migrations/` 后已实际执行并通过，结论见第 2 节与第 3 节。此条不再作为未验证项，保留是为了说明状态变化的时间点。
- **前端界面**：`apps/web` 页面与组件齐全，其 `tsc --noEmit` 已随 `pnpm typecheck` 通过；但没有端到端或视觉回归测试，也没有截图证据，界面行为**未经验证**。
- **实时字幕采集**：`capture-worker.ts` 的租约、游标、重试逻辑存在，但依赖真实飞书权限，脱敏版无法运行。
- **生产运行行为**：生产构建已经在 Ubuntu WSL2 通过，但尚未以生产配置启动产物并执行 HTTP、浏览器或进程级冒烟测试。因此“可以生成生产产物”已验证，“生产部署可用”仍未验证。

## 5. 设计存在，未验证

| 项 | 现状 |
|---|---|
| 会前 `sourceRefs` 原文硬绑定 | 数据结构与编辑校验存在，生成链路未建立与会后同等级的逐条硬绑定 |
| 跨进程实时推送 | 事件总线在进程内内存；API 与 Worker 分进程时可能丢事件 |
| 台账自动同步 | 映射函数与冲突检测已实现并有单测，但没有真实上游系统的联调记录 |
| 效果评测 | 指标与流程设计见 [eval-design.md](eval-design.md)，**从未执行** |

## 6. 缺失文件与悬空脚本（实测）

以下脚本引用的文件在仓库中**不存在**，执行会直接失败。这不是环境问题：

| 脚本 | 引用 | 状态 |
|---|---|---|
| `pnpm db:seed`（根脚本） | `packages/database/src/seed.ts` | 文件缺失 |
| `pnpm --filter @vice/database db:seed-e2e` | `packages/database/src/seed-e2e.ts` | 文件缺失 |
| `pnpm --filter @vice/database db:reset` | 依赖 `seed.ts` + `prisma/migrations/` | `seed.ts` 仍缺失；`prisma/migrations/` **本分支已补齐** |
| `pnpm test:e2e` | `playwright.config.*`、`e2e/` | 均缺失 |
| `prisma migrate dev/deploy/reset` | `packages/database/prisma/migrations/` | **本分支已补齐**（`20260917084821_init`），在空库上实际执行通过 |

补充说明：

- `packages/database/prisma/schema.prisma` 中**没有 `enum` 定义**（`grep -c "^enum "` 结果为 0），状态值以字符串存储，约束由 `packages/contracts` 的枚举常量与 Zod Schema 承担。
- `test/globalSetup.ts` 用 `prisma migrate reset --force --skip-generate` 重置测试库。在基线 `d5b73e6` 及更早，仓库没有 `packages/database/prisma/migrations/`，该命令没有可执行的迁移链，因此**当时所有 `test/api` 集成用例都无法运行**。本分支补上迁移后，`globalSetup` 已能正常工作（打印 `Test database reset through reviewed migrations`）。不要为了让测试跑起来而绕过 `globalSetup.ts` 的库名 `_test` 保护。

## 7. 未纳入脱敏版

- 生产环境的 migration 与运维脚本、部署脚本、Docker/网关配置、日志、备份与监控；本分支新增的 `prisma/migrations/` 只是由仓库内已公开的 `schema.prisma` 生成的开发/测试迁移链，不含生产连接、凭据或真实数据；
- 真实飞书凭据与真实会议产物；
- 真实 ATS 的账号映射、候选人授权与自动同步；
- 真实候选人、员工、面试官数据（`demo-data/` 全部为虚构）。

## 8. 建议的处理优先级

1. ~~**修复 `test/api` 的可运行性**~~ → **本分支已完成**：已补齐 `prisma/migrations/20260917084821_init`，7 个集成测试文件在空库上实际执行通过（23 个文件 / 315 个用例）。剩余待办是**让 CI 也跑到集成测试**——当前 `.github/workflows/ci.yml` 只覆盖安装 + `prisma generate` + `typecheck` + 单元测试 + 生产构建，要覆盖 `pnpm test` 需要在 CI 里提供 `_test` PostgreSQL 服务容器。
2. **补齐或移除悬空脚本**：`db:seed`、`db:seed-e2e`、`test:e2e`。要么补文件，要么在 `package.json` 中移除，避免误导贡献者。
3. **补 CI**：本次已提供安装 + `prisma generate` + `typecheck` + 单元测试 + 生产构建的工作流，让「typecheck 必须先 generate」和可构建性要求自动生效。
4. **会前 `sourceRefs` 硬绑定**：补齐后可与会后 Evidence 达到同一证据等级。
5. **跨进程事件通道**：引入 Outbox relay 或 Redis Pub/Sub，才能支撑多进程部署。
6. **效果评测**：按 [eval-design.md](eval-design.md) 建立 Golden Dataset 并做历史时点回放；在此之前不要对外声称产品效果。
