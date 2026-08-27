/**
 * Production build: bundle API server + workspace packages into a single ESM file.
 * npm dependencies stay external — installed via pnpm install --prod in Docker.
 */
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const opts = {
  entryPoints: ["src/server.ts", "src/worker.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  external: [
    // Native modules — must stay external
    "jsonwebtoken",
    "@prisma/client",
    ".prisma/client",
    // Fastify ecosystem — keep external to avoid bundling issues
    "fastify",
    "fastify-plugin",
    "@fastify/*",
    // General deps
    "zod",
    // Node builtins
    "node:*",
  ],
  sourcemap: true,
  minify: false,
  keepNames: true,
  treeShaking: true,
  logLevel: "info",
  // Resolve .js extensions in TS imports
  resolveExtensions: [".ts", ".js"],
  // Banner with CWD setup so the bundled file can run from anywhere
  banner: {
    js: `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);`,
  },
};

if (isWatch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("👀 Watching for changes...");
} else {
  await esbuild.build(opts);
  console.log("✅ API production build complete → dist/server.mjs");
}
