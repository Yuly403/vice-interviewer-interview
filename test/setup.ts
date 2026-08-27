/**
 * Vitest setup file — runs before test files are loaded.
 *
 * MUST set DATABASE_URL before @prisma/client is imported by any module,
 * otherwise Prisma's engine selection (DataProxyEngine vs LibraryEngine)
 * will be permanently wrong for the lifetime of this vitest worker.
 */
if (process.env.VITEST_SKIP_DB === "true") {
  // Pure unit tests can opt out of database initialization explicitly.
} else if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for database-backed tests.");
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
