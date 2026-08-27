/** Dedicated background worker entry point.
 *
 * The API remains responsive while this process owns capture/follow-up loops.
 * Work ownership is still protected by CaptureLease in PostgreSQL.
 */
import { createServer } from "node:http";
import { reconcileAll } from "./services/capture-worker.js";
import { resumeAllFollowupEngines } from "./services/followup-engine.js";

const port = Number.parseInt(process.env.WORKER_HEALTH_PORT ?? "3002", 10);
const liveCaptureEnabled = process.env.FEISHU_LIVE_CAPTURE_ENABLED === "true";
let ready = false;
let stopping = false;

async function reconcile(): Promise<void> {
  try {
    if (liveCaptureEnabled) await reconcileAll();
    await resumeAllFollowupEngines();
    ready = true;
  } catch (error) {
    ready = false;
    console.error("[worker] reconciliation failed:", (error as Error).message);
  }
}

const health = createServer((request, response) => {
  if (request.url === "/health/live") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"live"}');
    return;
  }
  if (request.url === "/health/ready") {
    response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: ready ? "ready" : "starting" }));
    return;
  }
  response.writeHead(404).end();
});

health.listen(port, "0.0.0.0", async () => {
  console.log(`[worker] health endpoint listening on ${port}`);
  await reconcile();
  const timer = setInterval(() => { void reconcile(); }, 5_000);
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    health.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
});
