/**
 * Vitest global setup. Database-backed tests use a dedicated PostgreSQL
 * database and exercise the same reviewed migration chain as deployment.
 */
import { execSync } from "child_process";
import path from "path";

export function setup() {
  if (process.env.VITEST_SKIP_DB === "true") {
    console.log("[globalSetup] database initialization skipped by VITEST_SKIP_DB");
    return;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for database-backed tests. Use a dedicated PostgreSQL database whose name ends with _test.");
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").split("?")[0];
  if (!databaseName.endsWith("_test")) {
    throw new Error("Refusing to reset a database not explicitly named *_test.");
  }

  const prismaDir = path.resolve(__dirname, "..", "packages", "database");
  execSync("npx prisma migrate reset --force --skip-generate", {
    cwd: prismaDir,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  console.log("[globalSetup] Test database reset through reviewed migrations");
}

export function teardown() {
  // Retain the isolated test database for inspection after failed runs.
}
