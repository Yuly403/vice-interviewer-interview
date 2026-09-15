# CODEBUDDY.md — 项目级智能体规则

> 本仓库的完整协作规则在 **[AGENTS.md](AGENTS.md)**，请先读取它。本文件只保留必须无条件遵守的硬规则，避免两份文件产生分歧。

## 硬规则

1. **事实纪律**：不把「设计存在」写成「已完成」。能力描述必须能指向可出示的代码、测试或运行记录。边界见 [docs/project-status.md](docs/project-status.md)。
2. **测试库保护**：`pnpm test` 以及数据库相关脚本（`pnpm db:seed`、`pnpm --filter @vice/database` 下的 `db:*`）只能指向库名以 `_test` 结尾的专用 PostgreSQL。不要绕过 `test/globalSetup.ts` 的保护。
3. **LLM 不写业务事实**：模型只返回受 Zod 限制的 JSON；写库由确定性代码在事务中完成。
4. **Evidence 是硬约束**：quote 必须是真实候选人 `TranscriptLine` 的子串，批准前再次校验。
5. **导入约定**：ESM，TS 源码内相对导入必须带 `.js` 后缀。
6. **新增无数据库测试**必须登记到 `vitest.unit.config.ts` 的 `include`。
7. **红线**：不引入真实凭据 / 内部域名 / 内部 IP / 真实候选人数据；不新增必然失败的 CI 步骤。

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm test:unit     # 无数据库、无密钥
pnpm typecheck
```
