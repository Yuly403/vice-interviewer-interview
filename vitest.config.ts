import { defineConfig } from "vitest/config";
import path from "path";

// Integration tests require a dedicated PostgreSQL database. globalSetup
// rejects any URL whose database name is not explicitly marked as a test DB.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl,
      ALLOW_MOCK_AUTH: "true",
    },
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "e2e", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "packages/domain/src/**/*.ts",
        "packages/contracts/src/**/*.ts",
        "apps/api/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
  resolve: {
    alias: {
      "@vice/contracts": path.resolve(__dirname, "packages/contracts/src"),
      "@vice/domain": path.resolve(__dirname, "packages/domain/src"),
      "@vice/database": path.resolve(__dirname, "packages/database/src"),
      "@vice/llm": path.resolve(__dirname, "packages/llm/src"),
      // API integration test deps (from apps/api/node_modules)
      "fastify": path.resolve(__dirname, "apps/api/node_modules/fastify"),
      "jsonwebtoken": path.resolve(__dirname, "apps/api/node_modules/jsonwebtoken"),
    },
  },
});
