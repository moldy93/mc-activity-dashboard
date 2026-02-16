import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

type RunRecord = {
  taskId: string;
  role: string;
  status: "queued" | "running" | "timed_out" | "dropped" | "completed";
  phase?: "Planning" | "Development" | "Review" | "Done";
  startedAt: number;
  lastRunAt: number;
  lastPolledAt?: number;
  nextPollAt: number;
  lastCheckedAt?: number;
  pollMode: "normal" | "recovery";
  attempts: number;
  sourceColumn: string;
  taskTitle: string;
  lastTransition?: string;
};

type RunnerState = {
  updatedAt: number;
  pollIntervalMs: number;
  timeoutMs: number;
  fallbackMs: number;
  lastLoopAt: number;
  missingBriefings: string[];
  runs: RunRecord[];
  log: Array<{ at: number; role: string; taskId: string; event: string; reason: string }>;
};

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";
const RUN_STATE_PATH = path.join(WORKSPACE_ROOT, "memory", "mc", "activity-runner-state.json");

export async function GET() {
  try {
    if (!fs.existsSync(RUN_STATE_PATH)) {
      return NextResponse.json({
        error: "runner state not initialized",
        updatedAt: 0,
        pollIntervalMs: Number(process.env.MC_ACTIVITY_RUN_INTERVAL_MS || 10_000),
        timeoutMs: Number(process.env.MC_ACTIVITY_RUN_TIMEOUT_MS || 300_000),
        fallbackMs: Number(process.env.MC_ACTIVITY_RUN_FALLBACK_MS || 300_000),
        lastLoopAt: 0,
        missingBriefings: [],
        runs: [],
        log: [],
      });
    }

    const raw = fs.readFileSync(RUN_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RunnerState>;

    const fallback: RunnerState = {
      updatedAt: Date.now(),
      pollIntervalMs: Number(process.env.MC_ACTIVITY_RUN_INTERVAL_MS || 10_000),
      timeoutMs: Number(process.env.MC_ACTIVITY_RUN_TIMEOUT_MS || 300_000),
      fallbackMs: Number(process.env.MC_ACTIVITY_RUN_FALLBACK_MS || 300_000),
      lastLoopAt: 0,
      missingBriefings: [],
      runs: [],
      log: [],
    };

    return NextResponse.json({
      ...fallback,
      ...parsed,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      log: Array.isArray(parsed.log) ? parsed.log : [],
      missingBriefings: Array.isArray(parsed.missingBriefings) ? parsed.missingBriefings : [],
    });
  } catch {
    return NextResponse.json({
      error: "failed to read runner state",
      updatedAt: 0,
      pollIntervalMs: Number(process.env.MC_ACTIVITY_RUN_INTERVAL_MS || 10_000),
      timeoutMs: Number(process.env.MC_ACTIVITY_RUN_TIMEOUT_MS || 300_000),
      fallbackMs: Number(process.env.MC_ACTIVITY_RUN_FALLBACK_MS || 300_000),
      lastLoopAt: 0,
      missingBriefings: [],
      runs: [],
      log: [],
    });
  }
}
