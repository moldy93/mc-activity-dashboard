import { runIndexWorkspace } from "./indexWorkspace";

const WATCH_INTERVAL_MS = Number(process.env.MC_WORKSPACE_WATCH_INTERVAL_MS || process.env.MC_ACTIVITY_RUN_INTERVAL_MS || 5000);
const MIN_INTERVAL_MS = 1000;
const intervalMs = Number.isFinite(WATCH_INTERVAL_MS) && WATCH_INTERVAL_MS >= MIN_INTERVAL_MS ? WATCH_INTERVAL_MS : 5000;

let inFlight = false;
let stopped = false;

async function tick() {
  if (inFlight || stopped) return;
  inFlight = true;
  try {
    await runIndexWorkspace();
  } catch (error) {
    console.error("[mc-index-watch] indexer error", error);
  } finally {
    inFlight = false;
  }
}

(async () => {
  await tick();
  const timer = setInterval(tick, intervalMs);

  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.exit(0);
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]; 
  signals.forEach((signal) => process.on(signal, shutdown));
})();
