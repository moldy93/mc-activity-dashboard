import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";

const BOARD_PATH = path.join(WORKSPACE_ROOT, "mission-control", "board.md");
const TASKS_DIRS = [
  path.join(WORKSPACE_ROOT, "mission-control", "tasks"),
  path.join(WORKSPACE_ROOT, "mission-control", "primitives", "tasks"),
];
const AGENTS_DIR = path.join(WORKSPACE_ROOT, "mission-control", "agents");
const BRIEFINGS_DIR = path.join(WORKSPACE_ROOT, "memory", "mc");

const ROLE_FILES: Record<string, string> = {
  planner: path.join(AGENTS_DIR, "planner.md"),
  dev: path.join(AGENTS_DIR, "dev.md"),
  pm: path.join(AGENTS_DIR, "pm.md"),
  reviewer: path.join(AGENTS_DIR, "reviewer.md"),
  uiux: path.join(AGENTS_DIR, "uiux.md"),
};

const ROLE_DEFAULTS: Record<string, string> = {
  planner: `# Role: Planner\n\n## Mission\nTurn requests into clear and testable plans.\n\n## Responsibilities\n- Clarify scope and dependencies\n- Create measurable acceptance criteria\n- Keep tasks aligned with the current request\n\n## Output Standard\nClear plan, risks, and next step definition.\n`,
  dev: `# Role: Developer\n\n## Mission\nImplement the active plan with safe, minimal changes.\n\n## Responsibilities\n- Deliver working code changes\n- Keep context and acceptance criteria in sync\n- Avoid unnecessary drift from plan\n\n## Output Standard\nWorking implementation + tests + concise handoff notes.\n`,
  pm: `# Role: PM (Client Interface)\n\n## Mission\nCoordinate planning, development, review, and final closure.\n\n## Responsibilities\n- Track active task state\n- Keep decision log and ETA current\n- Request missing input explicitly\n\n## Status Cadence\n- Update with: Done / In Progress / Next / ETA / Questions\n\n## Output Standard\nConcise, actionable updates for Mario.\n`,
  reviewer: `# Role: Reviewer\n\n## Mission\nKeep quality and risk under control.\n\n## Responsibilities\n- Validate against scope and acceptance criteria\n- Check for regressions and test gaps\n- Flag risks and required fixes\n\n## Output Standard\nClear, concise PASS / requested changes.\n`,
  uiux: `# Role: UI/UX\n\n## Mission\nProtect clarity and usability of user-facing workflows.\n\n## Responsibilities\n- Validate user flows and interaction quality\n- Suggest measurable UX improvements\n- Ensure output is usable and coherent\n\n## Output Standard\nActionable UX feedback with rationale.\n`,
};

const POLL_INTERVAL_MS = Number(process.env.MC_ACTIVITY_RUN_INTERVAL_MS || 10_000);
const STATUS_POLL_FALLBACK_MS = Number(process.env.MC_ACTIVITY_RUN_FALLBACK_MS || 300_000);
const RUN_TIMEOUT_MS = Number(process.env.MC_ACTIVITY_RUN_TIMEOUT_MS || 300_000);

const RUN_STATE_PATH = path.join(
  WORKSPACE_ROOT,
  "memory",
  "mc",
  "activity-runner-state.json"
);

type Role = "planner" | "dev" | "pm" | "reviewer" | "uiux";

type RunStatus = "queued" | "running" | "timed_out" | "dropped" | "completed";

type PollMode = "normal" | "recovery";

type BoardTask = {
  taskId: string;
  label: string;
};

type RunRecord = {
  taskId: string;
  role: Role;
  status: RunStatus;
  startedAt: number;
  lastRunAt: number;
  lastPolledAt?: number;
  nextPollAt: number;
  lastCheckedAt?: number;
  pollMode: PollMode;
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
  runs: Array<RunRecord>;
  log: Array<{ at: number; role: string; taskId: string; event: string; reason: string }>;
};

type ParsedTaskMeta = {
  taskId: string;
  title: string;
  assignees: Role[];
};

function readJson(filePath: string) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function loadBoard() {
  if (!fs.existsSync(BOARD_PATH)) return [] as { column: string; items: BoardTask[] }[];
  const content = fs.readFileSync(BOARD_PATH, "utf8");
  const sections = ["Inbox", "Planning", "Development", "Review", "Done"];
  const out = [] as { column: string; items: BoardTask[] }[];

  const parseList = (text: string, heading: string) => {
    const regex = new RegExp(`## ${heading}([\\s\\S]*?)(?=\\n## |$)`);
    const match = text.match(regex);
    if (!match) return [] as BoardTask[];
    const lines = match[1]
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    return lines
      .map((line) => {
        const m = line.match(/^([a-z0-9]+-\d{3}(?:-\d{2})?)\s+—\s+(.+)$/i);
        if (!m) return { taskId: line.toLowerCase(), label: line } as BoardTask;
        return { taskId: m[1].toLowerCase(), label: line };
      })
      .filter((entry) => entry.taskId);
  };

  for (const section of sections) {
    out.push({ column: section, items: parseList(content, section) });
  }

  return out;
}

function extractProjectId(value?: string) {
  if (!value) return undefined;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
}

function parseYamlTaskAssignees(taskContent: string): string[] {
  const match = taskContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return [];
  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return [];
    const assignees = parsed.assignees;
    if (!Array.isArray(assignees)) return [];
    return assignees
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => ["planner", "dev", "pm", "reviewer", "uiux"].includes(entry)) as Role[];
  } catch {
    return [];
  }
}

function parseTasks() {
  const map = new Map<string, ParsedTaskMeta>();

  for (const tasksDir of TASKS_DIRS) {
    if (!fs.existsSync(tasksDir)) continue;

    for (const file of fs.readdirSync(tasksDir)) {
      if (!file.endsWith(".md")) continue;
      const full = path.join(tasksDir, file);
      const content = fs.readFileSync(full, "utf8");

      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!frontMatterMatch) continue;
      let title = "";
      let taskId = "";
      let assignees: Role[] = [];
      try {
        const parsed = yaml.load(frontMatterMatch[1]) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") continue;
        taskId =
          (typeof parsed.taskId === "string" && parsed.taskId.toLowerCase()) ||
          extractProjectId(file) ||
          "";
        title = typeof parsed.title === "string" ? parsed.title : "";
        const frontAssignees = Array.isArray(parsed.assignees)
          ? parsed.assignees
              .map((entry) => String(entry || "").trim().toLowerCase())
              .filter((entry) => ["planner", "dev", "pm", "reviewer", "uiux"].includes(entry))
          : [];
        assignees = frontAssignees as Role[];
      } catch {
        taskId = extractProjectId(file) || "";
      }

      if (!assignees.length) {
        assignees = parseYamlTaskAssignees(content) as Role[];
      }
      const m = title.match(/^test-\d{3}/i);
      const id = taskId || extractProjectId(content) || extractProjectId(file);
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, {
          taskId: id,
          title: title || m?.[0] || file,
          assignees,
        });
      }
    }
  }

  return map;
}

function ensureAgentFilesAndBriefings() {
  const missingBriefings: string[] = [];

  for (const [role, rolePath] of Object.entries(ROLE_FILES)) {
    if (!fs.existsSync(rolePath)) {
      fs.mkdirSync(path.dirname(rolePath), { recursive: true });
      fs.writeFileSync(rolePath, ROLE_DEFAULTS[role]);
      console.log(`created missing role file: ${rolePath}`);
    }
  }

  for (const role of Object.keys(ROLE_FILES) as Role[]) {
    const brief = path.join(BRIEFINGS_DIR, role, "WORKING.md");
    if (!fs.existsSync(brief)) {
      missingBriefings.push(role);
    }
  }

  return missingBriefings;
}

function mapRoleForTask(taskId: string, taskMeta: ParsedTaskMeta | undefined, column: string) {
  const assignees = taskMeta?.assignees || [];
  const roles = new Set<Role>();

  for (const role of assignees) roles.add(role);

  if (roles.size > 0) return Array.from(roles);

  if (column === "Planning") return ["planner", "pm"];
  if (column === "Development") return ["dev"];
  if (column === "Review") return ["reviewer", "uiux"];
  if (column === "Done" || column === "Inbox") return [];

  return ["pm"];
}

function normalizeStatus(previous: RunStatus, now: number, run: RunRecord) {
  const started = now - run.startedAt;
  const timedOut = started > RUN_TIMEOUT_MS;

  if (run.status === "completed") return run;

  if (timedOut && run.status !== "timed_out" && run.status !== "dropped") {
    return {
      ...run,
      status: "timed_out",
      pollMode: "recovery",
      lastTransition: "timeout",
      nextPollAt: now + STATUS_POLL_FALLBACK_MS,
    } as RunRecord;
  }

  if ((run.status === "timed_out" || run.status === "dropped") && timedOut) {
    return {
      ...run,
      pollMode: "recovery",
      nextPollAt: Math.max(run.nextPollAt, now + STATUS_POLL_FALLBACK_MS),
    } as RunRecord;
  }

  if ((run.status === "running" || run.status === "queued") && !timedOut) {
    return {
      ...run,
      status: "running",
      pollMode: "normal",
      nextPollAt: now + POLL_INTERVAL_MS,
    } as RunRecord;
  }

  return run;
}

function mergeLogEntry(log: RunnerState["log"], event: RunRecord, kind: string) {
  log.push({
    at: Date.now(),
    role: event.role,
    taskId: event.taskId,
    event: kind,
    reason: `${event.sourceColumn}: ${event.lastTransition || "ok"}`,
  });
  if (log.length > 500) {
    log.splice(0, log.length - 500);
  }
}

function parseRunState(): RunnerState {
  const defaults: RunnerState = {
    updatedAt: Date.now(),
    pollIntervalMs: POLL_INTERVAL_MS,
    timeoutMs: RUN_TIMEOUT_MS,
    fallbackMs: STATUS_POLL_FALLBACK_MS,
    lastLoopAt: 0,
    missingBriefings: [],
    runs: [],
    log: [],
  };

  const raw = readJson(RUN_STATE_PATH);
  if (!raw || typeof raw !== "object") return defaults;
  const state = raw as Partial<RunnerState>;
  return {
    ...defaults,
    ...state,
    runs: Array.isArray(state.runs) ? state.runs : [],
    log: Array.isArray(state.log) ? state.log : [],
    missingBriefings: Array.isArray(state.missingBriefings) ? state.missingBriefings : [],
  };
}

function validateRoles(state: RunnerState) {
  const now = Date.now();
  const nextRunsMap = new Map(state.runs.map((run) => [`${run.role}:${run.taskId}`, run]));
  const board = loadBoard();
  const taskMeta = parseTasks();

  const desired = new Map<string, Set<Role>>();

  for (const { column, items } of board) {
    for (const item of items) {
      const id = extractProjectId(item.taskId) || item.taskId.toLowerCase();
      if (!id) continue;
      const meta = taskMeta.get(id);
      const roles = mapRoleForTask(id, meta, column);
      for (const role of roles) {
        if (!desired.has(id)) desired.set(id, new Set<Role>());
        desired.get(id)!.add(role as Role);
      }
    }
  }

  const desiredRunKeys = new Set<string>();
  const updates: Array<RunRecord> = [];

  for (const [taskId, roles] of desired.entries()) {
    const meta = taskMeta.get(taskId);
    const taskTitle = meta?.title || taskId;
        const boardCol = board.find((entry) => entry.items.some((item) => item.taskId === taskId || item.taskId.startsWith(taskId)));
    const sourceColumn = boardCol?.column || "Unknown";

    for (const role of roles) {
      const key = `${role}:${taskId}`;
      desiredRunKeys.add(key);

      const existing = nextRunsMap.get(key);
      if (!existing) {
        const created: RunRecord = {
          taskId,
          role,
          status: "queued",
          startedAt: now,
          lastRunAt: now,
          lastPolledAt: now,
          nextPollAt: now,
          pollMode: "normal" as const,
          attempts: 1,
          sourceColumn,
          taskTitle,
          lastTransition: "created",
        };
        updates.push(created);
        mergeLogEntry(state.log, created, "created");
      } else {
        const changed = {
          ...existing,
          sourceColumn,
          taskTitle,
          lastRunAt: now,
        };
        updates.push(changed);
      }
    }
  }

  for (const existing of state.runs) {
    if (!desiredRunKeys.has(`${existing.role}:${existing.taskId}`)) {
      if (existing.status !== "completed") {
        const dropped = {
          ...existing,
          status: "dropped" as RunStatus,
          pollMode: "recovery" as const,
          lastTransition: "missing-on-board",
          nextPollAt: now + STATUS_POLL_FALLBACK_MS,
        };
        updates.push(dropped);
        mergeLogEntry(state.log, dropped, "dropped");
      } else {
        updates.push(existing);
      }
    }
  }

  const dedupeMap = new Map<string, RunRecord>();
  for (const run of updates) {
    dedupeMap.set(`${run.role}:${run.taskId}`, run);
  }

  const finalRuns = Array.from(dedupeMap.values()).map((run) => {
    if (run.status === "completed") return run;
    const nowFor = Date.now();
    if (run.nextPollAt > nowFor) return run;
    const normalized = normalizeStatus(run.status, nowFor, run);
    if (normalized.status !== run.status) {
      if (normalized.status === "timed_out" || normalized.status === "dropped") {
        mergeLogEntry(state.log, normalized, "status" );
      }
      if (normalized.status === "running") {
        mergeLogEntry(state.log, normalized, "heartbeat");
      }
    }

    return {
      ...normalized,
      attempts: normalized.attempts + 1,
      lastPolledAt: nowFor,
      lastCheckedAt: nowFor,
    };
  });

  return {
    ...state,
    runs: finalRuns,
    missingBriefings: ensureAgentFilesAndBriefings(),
    lastLoopAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function printStateSummary(state: RunnerState) {
  const active = state.runs.filter((run) => run.status === "running" || run.status === "queued").length;
  const total = state.runs.length;
  const timedOut = state.runs.filter((run) => run.status === "timed_out" || run.status === "dropped").length;
  console.log(
    `[mc-runner] runs=${total} active=${active} timed_out_or_dropped=${timedOut} interval=${POLL_INTERVAL_MS}ms fallback=${STATUS_POLL_FALLBACK_MS}ms timeout=${RUN_TIMEOUT_MS}ms`
  );
  if (state.missingBriefings.length > 0) {
    console.log(`[mc-runner] user action required: missing briefing files for ${state.missingBriefings.join(", ")}`);
  }
}

function main() {
  if (Number.isNaN(POLL_INTERVAL_MS) || POLL_INTERVAL_MS <= 0) {
    throw new Error("MC_ACTIVITY_RUN_INTERVAL_MS must be a positive integer");
  }
  if (Number.isNaN(STATUS_POLL_FALLBACK_MS) || STATUS_POLL_FALLBACK_MS <= 0) {
    throw new Error("MC_ACTIVITY_RUN_FALLBACK_MS must be a positive integer");
  }
  if (Number.isNaN(RUN_TIMEOUT_MS) || RUN_TIMEOUT_MS <= 0) {
    throw new Error("MC_ACTIVITY_RUN_TIMEOUT_MS must be a positive integer");
  }

  const statePathDir = path.dirname(RUN_STATE_PATH);
  if (!fs.existsSync(statePathDir)) fs.mkdirSync(statePathDir, { recursive: true });

  console.log("mc-activity runner started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    fallbackIntervalMs: STATUS_POLL_FALLBACK_MS,
    timeoutMs: RUN_TIMEOUT_MS,
    boardPath: BOARD_PATH,
  });

  let state = parseRunState();

  const loop = () => {
    state = validateRoles(state);
    writeJson(RUN_STATE_PATH, state);
    printStateSummary(state);
  };

  loop();
  setInterval(loop, POLL_INTERVAL_MS);
}

main();
