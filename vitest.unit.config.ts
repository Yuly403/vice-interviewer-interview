import { defineConfig } from "vitest/config";
import path from "path";

// Pure unit and adapter-boundary tests. This entry intentionally has no
// database global setup, so reviewers can validate the core constraints
// without supplying a PostgreSQL instance.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "test/domain/**/*.test.ts",
      "test/web/**/*.test.ts",
      "test/demo-data.test.ts",
      "test/llm-*.test.ts",
      "test/plan-generation.test.ts",
      "test/ledger-mapper.test.ts",
      "test/interview-archive.test.ts",
      "test/feishu-server.test.ts",
      "test/feishu-oauth.test.ts",
      "test/sse.test.ts",
    ],
    exclude: ["node_modules", "dist", "e2e", "**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@vice/contracts": path.resolve(__dirname, "packages/contracts/src"),
      "@vice/domain": path.resolve(__dirname, "packages/domain/src"),
      "@vice/database": path.resolve(__dirname, "packages/database/src"),
      "@vice/llm": path.resolve(__dirname, "packages/llm/src"),
      "fastify": path.resolve(__dirname, "apps/api/node_modules/fastify"),
      "jsonwebtoken": path.resolve(__dirname, "apps/api/node_modules/jsonwebtoken"),
    },
  },
});
