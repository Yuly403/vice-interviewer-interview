# 本地开发指南

本文覆盖环境准备、命令、环境变量与常见排障。项目定位与能力边界见 [project-status.md](project-status.md)。

## 1. 前置条件

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | >= 18 | `engines` 声明为 `>=18`；生产构建目标为 `node22`，建议直接用 Node 22 |
| pnpm | 与 `pnpm-lock.yaml` 的 `lockfileVersion: '9.0'` 匹配 | 用 `corepack enable` 让 Corepack 按锁文件版本接管 |
| PostgreSQL | 可选 | 仅集成测试与启动应用时需要；**必须是可随时删除的库** |

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 2. 命令一览

### 根目录

| 命令 | 作用 | 需要数据库 |
|---|---|---|
| `pnpm dev` | 并行启动 API 与 Web | 是 |
| `pnpm dev:api` / `pnpm dev:web` | 单独启动 API / Web | API 需要 |
| `pnpm build` | `prisma generate` 后递归构建所有包 | 否 |
| `pnpm start:prod` | 运行 `apps/api/dist/server.mjs` | 是 |
| `pnpm typecheck` | 所有包 `tsc --noEmit` | 否 |
| `pnpm check` | `typecheck` + `test` | 是（`test` 需 `_test` 库） |
| `pnpm test:unit` | **纯单元与适配边界测试，无数据库、无密钥** | 否 |
| `pnpm test` | 全量 vitest（含集成） | 是 |
| `pnpm test:domain` / `pnpm test:api` | 按目录跑 | `test:api` 需要 |
| `pnpm test:coverage` | 覆盖率（v8） | 是 |
| `pnpm db:seed` | 数据初始化（根脚本） | 是（见第 6 节缺口） |
| `pnpm test:e2e` | Playwright E2E | 是（见第 6 节缺口） |

### 各包

| 包 | 命令 |
|---|---|
| `@vice/api` | `dev`（tsx watch）、`build`（esbuild 打包为单文件 ESM）、`start`、`typecheck` |
| `@vice/web` | `dev`（Vite，端口 5173）、`build`（`tsc -b && vite build`）、`preview`、`typecheck` |
| `@vice/database` | `build`、`typecheck`、`db:migrate:dev`、`db:migrate:deploy`、`db:seed`、`db:seed-e2e`、`db:reset` |
| `@vice/contracts` / `@vice/domain` / `@vice/llm` | `build`、`typecheck` |

## 3. 环境变量

从 `.env.example` 复制为 `.env`。**所有值都是不可用占位值，必须本地替换。**

| 变量 | 默认/占位 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | |
| `HOST` / `PORT` | `127.0.0.1` / `3001` | API 监听地址与端口 |
| `CORS_ORIGIN` | `http://127.0.0.1:5173` | 逗号分隔；未设置时回退到 localhost:5173 |
| `FRONTEND_ORIGIN` | `http://127.0.0.1:5173` | |
| `DATABASE_URL` | 指向本地占位库 | **只能是可随时删除的本地空库** |
| `JWT_SECRET` | `replace_with_a_local_random_value` | |
| `JWT_EXPIRES_IN` | `24h` | |
| `SESSION_COOKIE_SECURE` | `false` | 本地 http 调试用 |
| `ALLOW_MOCK_AUTH` | `true` | 允许本地 mock 认证 |
| `TOKEN_ENCRYPTION_KEY` | 占位 | 用于加密存储的第三方 Token |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 占位 / 空 | **`DEEPSEEK_API_KEY` 留空即走规则兜底路径** |
| `LLM_TIMEOUT_SEC` | `25` | LLM 调用超时 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_REDIRECT_URI` | 空 / 本地回调 | 仓库不含真实凭据 |
| `FEISHU_LIVE_CAPTURE_ENABLED` | `false` | 开启后才启动实时字幕采集 |
| `LARK_CLI_PATH` | `/usr/local/bin/lark-cli` | 采集适配层依赖 |
| `WORKER_HEALTH_PORT` | `3002` | 独立 Worker 进程健康检查端口 |
| `WORKSPACE_ROOT` | `./demo-workspace` | 工作区同步根目录（已在 `.gitignore` 中） |

## 4. 启动应用

```bash
cp .env.example .env
# 编辑 .env，指向一个可随时删除的本地空 PostgreSQL 库
pnpm --filter @vice/database exec prisma generate
pnpm dev
```

- API：`http://127.0.0.1:3001`，健康检查 `GET /api/v1/health`、`/health/live`、`/health/ready`（`ready` 会真实查库，失败返回 503）。
- Web：`http://127.0.0.1:5173`。
- 后台 Worker：`apps/api/src/worker.ts` 是**独立进程入口**，健康检查在 `WORKER_HEALTH_PORT`，每 5 秒做一次 reconcile。

> 注意：`pnpm dev` 只启动 API 与 Web，**不会**自动拉起 Worker。需要实时采集/追问循环时单独运行 Worker 入口。

## 5. 测试策略

仓库有两套 vitest 配置，这是刻意设计：

| 配置 | 命令 | 是否需要数据库 | 用途 |
|---|---|---|---|
| `vitest.unit.config.ts` | `pnpm test:unit` | **否** | 领域逻辑、契约、Prompt 安全、LLM 传输防护、SSE/飞书适配边界 |
| `vitest.config.ts` | `pnpm test` | 是 | 含数据库 API 集成用例 |

集成测试的数据库保护（`test/globalSetup.ts`）：

1. 未提供 `TEST_DATABASE_URL` → 直接抛错；
2. 库名不以 `_test` 结尾 → 拒绝执行；
3. 通过后用 `prisma migrate reset --force` 重置测试库。

这是防止误连已有数据库的保护，**不要绕过**。临时跳过可用 `VITEST_SKIP_DB=true`（仅在你确认不需要库时）。

新增不依赖数据库的测试文件时，必须把它登记到 `vitest.unit.config.ts` 的 `include`，否则 `pnpm test:unit` 不会执行它。

## 6. 已知缺口与排障

以下问题在脱敏版中**确实存在**，遇到时不要误判为环境问题（详见 [project-status.md](project-status.md)）：

| 现象 | 原因 | 处理 |
|---|---|---|
| `pnpm db:seed` 报找不到 `src/seed.ts` | `packages/database/src/seed.ts` 未包含在脱敏版中 | 用 `demo-data/` 的样例手工导入，或自行补 seed |
| `pnpm --filter @vice/database db:reset` 失败 | 依赖 `seed.ts`，且 `prisma/migrations/` 不存在 | 同上 |
| `pnpm test:e2e` 无法运行 | 无 `playwright.config.*`、无 `e2e/`、`db:seed-e2e` 缺失 | 需要时自行补齐 |
| `prisma migrate dev/deploy` 无迁移 | 仓库不含 `prisma/migrations/` | 本地用 `prisma db push` 建结构，或自行生成迁移 |
| `pnpm typecheck` 在 `@vice/database` 失败 | 未生成 Prisma Client | 先跑 `pnpm --filter @vice/database exec prisma generate` |
| `pnpm test:unit` 找不到 `fastify` / `jsonwebtoken` | 未完整安装依赖 | 重新 `pnpm install --frozen-lockfile`（两个包从 `apps/api/node_modules` 解析） |
| LLM 相关行为异常但无报错 | `DEEPSEEK_API_KEY` 为空，走的是规则兜底 | 这是预期行为；需要真实调用再填 Key |

## 7. 依赖与构建要点

- **ESM**：所有包 `"type": "module"`。TS 源码中的相对导入必须带 `.js` 后缀（如 `./state-machine.js`），由 `moduleResolution: "bundler"` 与 esbuild 的 `resolveExtensions: [".ts", ".js"]` 共同支持。
- **API 生产构建**：`apps/api/build.mjs` 用 esbuild 把 `src/server.ts` 与 `src/worker.ts` 打成单文件 ESM 到 `dist/`，原生模块（`jsonwebtoken`、`@prisma/client`）与 Fastify 生态保持 external，因此生产环境仍需安装依赖。
- **Prisma**：`pnpm-workspace.yaml` 的 `allowBuilds` 已放行 `@prisma/client`、`@prisma/engines`、`prisma`、`esbuild` 的安装脚本，否则 postinstall 会被跳过。
- **TypeScript 严格度**：`strict` + `noUnusedLocals` + `noUnusedParameters`。未使用的变量或参数会让 `typecheck` 直接失败。
