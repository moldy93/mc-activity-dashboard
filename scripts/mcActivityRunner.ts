import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";

const TASKS_DIRS = [
  path.join(WORKSPACE_ROOT, "mission-control", "tasks"),
  path.join(WORKSPACE_ROOT, "mission-control", "primitives", "tasks"),
];
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, "projects");
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
const PHASE_ADVANCE_MS = Number(process.env.MC_ACTIVITY_PHASE_ADVANCE_MS || 10_000);
const DEV_FEEDBACK_TIMEOUT_MS = Number(process.env.MC_ACTIVITY_DEV_FEEDBACK_TIMEOUT_MS || 3_600_000);
const REVIEW_FEEDBACK_TIMEOUT_MS = Number(process.env.MC_ACTIVITY_REVIEW_FEEDBACK_TIMEOUT_MS || DEV_FEEDBACK_TIMEOUT_MS);

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

type TaskPhase = "Planning" | "Development" | "Review" | "Done";

type RunRecord = {
  taskId: string;
  role: Role;
  status: RunStatus;
  phase: TaskPhase;
  startedAt: number;
  lastRunAt: number;
  lastPolledAt?: number;
  nextPollAt: number;
  lastCheckedAt?: number;
  phaseEnteredAt?: number;
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
  status?: string;
  filePath: string;
  updatedAt: number;
};

function parseSingleLine(content: string, label: string) {
  const regex = new RegExp(`^[-*]?\s*${label}:\s*(.*)$`, "mi");
  const match = content.match(regex);
  if (!match) return undefined;
  return typeof match[1] === "string" ? match[1].trim() : undefined;
}

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

function loadBoard(taskMetaMap?: Map<string, ParsedTaskMeta>) {
  const byColumn = new Map<string, BoardTask[]>();
  for (const column of ["Inbox", "Planning", "Development", "Review", "Done"]) {
    byColumn.set(column, []);
  }

  const tasks = taskMetaMap || parseTasks();
  for (const meta of tasks.values()) {
    const phase = taskColumnToPhase(meta.status, "Planning");
    const column =
      phase === "Development" ? "Development" :
      phase === "Review" ? "Review" :
      phase === "Done" ? "Done" :
      "Planning";
    const label = `${meta.taskId} — ${meta.title || meta.taskId}`;
    byColumn.get(column)!.push({ taskId: meta.taskId, label });
  }

  return ["Inbox", "Planning", "Development", "Review", "Done"].map((column) => ({
    column,
    items: byColumn.get(column) || [],
  }));
}

function extractProjectId(value?: string) {
  if (!value) return undefined;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
}

function projectStatePathFromTaskFile(filePath: string) {
  if (!filePath.endsWith("Briefing.yml")) return undefined;
  return path.join(path.dirname(filePath), "state.json");
}

function ensureProjectStateFile(filePath: string, meta: { taskId: string; title: string; status?: string; assignees: Role[] }) {
  const statePath = projectStatePathFromTaskFile(filePath);
  if (!statePath) return;

  const now = Date.now();
  const existing = readJson(statePath) as Record<string, unknown> | undefined;
  const rolePings = {
    planner: 0,
    dev: 0,
    reviewer: 0,
    uiux: 0,
    pm: 0,
    ...((existing?.rolePings as Record<string, number> | undefined) || {}),
  };

  const next = {
    taskId: meta.taskId,
    title: meta.title,
    status: meta.status || "Inbox",
    assignees: meta.assignees,
    createdAt: (existing?.createdAt as number | undefined) || now,
    updatedAt: now,
    lastTransitionAt: (existing?.lastTransitionAt as number | undefined) || now,
    rolePings,
    history: Array.isArray(existing?.history) ? existing?.history : [],
  };

  writeJson(statePath, next);
}

function appendProjectStateTransition(filePath: string, nextStatus: string, reason: string) {
  const statePath = projectStatePathFromTaskFile(filePath);
  if (!statePath) return;

  const now = Date.now();
  const existing = (readJson(statePath) as Record<string, unknown> | undefined) || {};
  const history = Array.isArray(existing.history) ? existing.history as Array<Record<string, unknown>> : [];
  history.push({ at: now, status: nextStatus, reason });

  const rolePings = {
    planner: 0,
    dev: 0,
    reviewer: 0,
    uiux: 0,
    pm: 0,
    ...((existing.rolePings as Record<string, number> | undefined) || {}),
  };

  writeJson(statePath, {
    ...existing,
    status: nextStatus,
    updatedAt: now,
    lastTransitionAt: now,
    rolePings,
    history,
  });
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

  const upsert = (entry: ParsedTaskMeta, priority: number) => {
    const prev = map.get(entry.taskId) as (ParsedTaskMeta & { __priority?: number }) | undefined;
    const prevPriority = prev?.__priority ?? -1;
    if (!prev || priority >= prevPriority) {
      (entry as ParsedTaskMeta & { __priority?: number }).__priority = priority;
      map.set(entry.taskId, entry);
    }
  };

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
      let status: string | undefined;
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
        if (typeof parsed.status === "string") {
          status = parsed.status;
        }
      } catch {
        taskId = extractProjectId(file) || "";
      }

      if (!assignees.length) {
        assignees = parseYamlTaskAssignees(content) as Role[];
      }
      if (status === undefined) {
        status = parseSingleLine(content, "Status");
      }
      const m = title.match(/^test-\d{3}/i);
      const id = taskId || extractProjectId(content) || extractProjectId(file);
      if (!id) continue;
      upsert({
        taskId: id,
        title: title || m?.[0] || file,
        assignees,
        status,
        filePath: full,
        updatedAt: fs.statSync(full).mtimeMs,
      }, 1);
    }
  }

  if (fs.existsSync(PROJECTS_DIR)) {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const briefing = path.join(PROJECTS_DIR, dir, "Briefing.yml");
      if (!fs.existsSync(briefing)) continue;
      const raw = fs.readFileSync(briefing, "utf8");
      try {
        const parsed = yaml.load(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") continue;
        const taskId =
          (typeof parsed.taskId === "string" && parsed.taskId.toLowerCase()) ||
          (typeof parsed.projectId === "string" && parsed.projectId.toLowerCase()) ||
          "";
        if (!taskId) continue;
        const title = typeof parsed.title === "string" ? parsed.title : taskId;
        const assignees = Array.isArray(parsed.assignees)
          ? parsed.assignees
              .map((entry) => String(entry || "").trim().toLowerCase())
              .filter((entry) => ["planner", "dev", "pm", "reviewer", "uiux"].includes(entry)) as Role[]
          : [];
        const status = typeof parsed.status === "string" ? parsed.status : undefined;
        ensureProjectStateFile(briefing, { taskId, title, status, assignees });
        upsert({
          taskId,
          title,
          assignees,
          status,
          filePath: briefing,
          updatedAt: fs.statSync(briefing).mtimeMs,
        }, 2);
      } catch {
        continue;
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


const PHASE_ORDER: TaskPhase[] = ["Planning", "Development", "Review", "Done"];

function normalizeTaskPhase(value?: string): TaskPhase {
  if (!value) return "Planning";
  if (value === "Done") return "Done";
  if (value === "Development") return "Development";
  if (value === "Review") return "Review";
  return "Planning";
}

function phaseFromColumn(column: string): TaskPhase {
  if (column === "Development") return "Development";
  if (column === "Review") return "Review";
  if (column === "Done") return "Done";
  return "Planning";
}

function isDevFeedbackPendingStatus(taskStatus?: string) {
  if (!taskStatus) return false;
  const s = taskStatus.toLowerCase();
  return s.includes("plan") && s.includes("feedback") && (s.includes("dev") || s.includes("develop"));
}


function isReviewFeedbackPendingStatus(taskStatus?: string) {
  if (!taskStatus) return false;
  const s = taskStatus.toLowerCase();
  return s.includes("develop") && s.includes("review") && s.includes("feedback");
}

function writeTaskStatus(filePath: string, nextStatus: string) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");

  // Markdown frontmatter file
  const fm = content.match(new RegExp("^---\\n([\\s\\S]*?)\\n---\\n?"));
  if (fm) {
    const lines = fm[1].split("\n");
    let replaced = false;
    const nextLines = lines.map((line) => {
      if (/^\s*status\s*:/i.test(line)) {
        replaced = true;
        return `status: ${nextStatus}`;
      }
      return line;
    });
    if (!replaced) nextLines.push(`status: ${nextStatus}`);

    const nextFrontmatter = `---\n${nextLines.join("\n")}\n---\n`;
    const updated = content.replace(new RegExp("^---\\n[\\s\\S]*?\\n---\\n?"), nextFrontmatter);
    if (updated !== content) {
      fs.writeFileSync(filePath, updated);
      appendProjectStateTransition(filePath, nextStatus, "writeTaskStatus");
      return true;
    }
    return false;
  }

  // Plain YAML file (projects/*/Briefing.yml)
  const lines = content.split("\n");
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (/^\s*status\s*:/i.test(line)) {
      replaced = true;
      return `status: ${nextStatus}`;
    }
    return line;
  });
  if (!replaced) nextLines.push(`status: ${nextStatus}`);

  const updated = `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    appendProjectStateTransition(filePath, nextStatus, "writeTaskStatus");
    return true;
  }
  return false;
}

function autoPromotePendingFeedback(taskMeta: Map<string, ParsedTaskMeta>, now: number) {
  for (const meta of taskMeta.values()) {
    if (isDevFeedbackPendingStatus(meta.status) && now - meta.updatedAt >= DEV_FEEDBACK_TIMEOUT_MS) {
      if (writeTaskStatus(meta.filePath, "Development")) {
        meta.status = "Development";
        meta.updatedAt = Date.now();
      }
      continue;
    }
    if (isReviewFeedbackPendingStatus(meta.status) && now - meta.updatedAt >= REVIEW_FEEDBACK_TIMEOUT_MS) {
      if (writeTaskStatus(meta.filePath, "Review")) {
        meta.status = "Review";
        meta.updatedAt = Date.now();
      }
    }
  }
}


function appendDeveloperUpdate(filePath: string, taskId: string) {
  if (!fs.existsSync(filePath)) return false;
  if (!filePath.endsWith(".md")) return false;
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("### Developer Update")) return false;
  const stamp = new Date().toISOString();
  const block = `

### Developer Update

- Auto-pass (${stamp})
- Task ${taskId} processed by Developer role.
- Handoff prepared for review feedback.
`;
  fs.writeFileSync(filePath, `${content.trimEnd()}${block}
`);
  return true;
}

function runAutoDeveloperPass(
  taskMeta: Map<string, ParsedTaskMeta>,
  desired: Map<string, Set<Role>>,
  desiredTaskPhase: Map<string, TaskPhase>,
) {
  for (const [taskId, roles] of desired.entries()) {
    if (!taskId.startsWith("test-")) continue;
    if (!roles.has("dev")) continue;
    const phase = desiredTaskPhase.get(taskId);
    if (phase !== "Development") continue;

    const meta = taskMeta.get(taskId);
    if (!meta) continue;

    const status = String(meta.status || "");
    if (isReviewFeedbackPendingStatus(status) || status.toLowerCase().includes("review") || status.toLowerCase().includes("done")) {
      continue;
    }

    const touched = appendDeveloperUpdate(meta.filePath, taskId);
    const moved = writeTaskStatus(meta.filePath, "Development, Review Feedback");
    if (touched || moved) {
      meta.status = "Development, Review Feedback";
      meta.updatedAt = Date.now();
    }
  }
}

function taskColumnToPhase(taskStatus?: string, boardColumn?: string) {
  if (taskStatus) {
    const s = taskStatus.toLowerCase();
    if (isDevFeedbackPendingStatus(taskStatus)) return "Planning" as TaskPhase;
    if (isReviewFeedbackPendingStatus(taskStatus)) return "Development" as TaskPhase;
    if (s.includes("done") || s.includes("complete") || s.includes("closed")) return "Done" as TaskPhase;
    if (s.includes("review") || s.includes("qa") || s.includes("approve")) return "Review" as TaskPhase;
    if (s.includes("develop") || s.includes("implement") || s.includes("wip") || s.includes("active") || s.includes("progress") || s.includes("blocked") || s.includes("build")) return "Development" as TaskPhase;
    if (s.includes("plan") || s.includes("todo") || s.includes("ready") || s.includes("backlog") || s.includes("inbox")) return "Planning" as TaskPhase;
  }
  return boardColumn ? phaseFromColumn(boardColumn) : "Planning" as TaskPhase;
}

function nextPhase(phase: TaskPhase): TaskPhase {
  const idx = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)] as TaskPhase;
}

function shouldAdvancePhase(phase: TaskPhase, enteredAt: number, now: number) {
  return phase !== "Done" && now - enteredAt >= PHASE_ADVANCE_MS;
}

function mapRoleForTask(
  taskMeta: ParsedTaskMeta | undefined,
  phase: TaskPhase,
  devFeedbackPending = false,
  reviewFeedbackPending = false,
) {
  const assignees = taskMeta?.assignees || [];

  const phaseRoles: Role[] =
    phase === "Planning"
      ? devFeedbackPending
        ? ["planner", "pm", "dev"]
        : ["planner", "pm"]
      : phase === "Development"
      ? reviewFeedbackPending
        ? ["reviewer", "uiux"]
        : ["dev"]
      : phase === "Review"
      ? ["reviewer", "uiux"]
      : [];

  const filtered = phaseRoles.filter((role) => assignees.includes(role));
  if (filtered.length > 0) return filtered;

  if (phase === "Done") return [];
  return phaseRoles.length > 0 ? phaseRoles : [];
}

function resolveTaskPhase(
  taskId: string,
  phaseState: Map<string, { phase: TaskPhase; enteredAt: number }> ,
  inferred: TaskPhase,
  now: number,
  devFeedbackPending = false,
  reviewFeedbackPending = false,
) {
  const existing = phaseState.get(taskId);

  if (devFeedbackPending) {
    if (!existing) return "Planning";
    if (existing.phase === "Planning" && now - existing.enteredAt >= DEV_FEEDBACK_TIMEOUT_MS) {
      return "Development";
    }
    if (existing.phase === "Development") return "Development";
    return "Planning";
  }


  if (reviewFeedbackPending) {
    if (!existing) return "Development";
    if (existing.phase === "Development" && now - existing.enteredAt >= REVIEW_FEEDBACK_TIMEOUT_MS) {
      return "Review";
    }
    if (existing.phase === "Review") return "Review";
    return "Development";
  }

  if (!existing) return inferred;

  // YAML status is source of truth: when inferred phase differs, reset to inferred.
  if (existing.phase !== inferred) {
    return inferred;
  }

  if (shouldAdvancePhase(existing.phase, existing.enteredAt, now)) {
    return nextPhase(existing.phase);
  }
  return existing.phase;
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
  const taskMeta = parseTasks();
  autoPromotePendingFeedback(taskMeta, now);
  const board = loadBoard(taskMeta);
  const phaseState = new Map<string, { phase: TaskPhase; enteredAt: number }>();

  for (const run of state.runs) {
    if (!run.phase) run.phase = "Planning";
    const enteredAt = run.phaseEnteredAt || run.startedAt;
    const current = phaseState.get(run.taskId);
    if (!current || enteredAt >= current.enteredAt) {
      phaseState.set(run.taskId, { phase: normalizeTaskPhase(run.phase), enteredAt });
    }
  }

  const desired = new Map<string, Set<Role>>();
  const desiredTaskPhase = new Map<string, TaskPhase>();

  for (const { column, items } of board) {
    for (const item of items) {
      const id = extractProjectId(item.taskId) || item.taskId.toLowerCase();
      if (!id) continue;
      const meta = taskMeta.get(id);
      const inferredFromStatus = taskColumnToPhase(meta?.status, column);
      const devFeedbackPending = isDevFeedbackPendingStatus(meta?.status);
      const reviewFeedbackPending = isReviewFeedbackPendingStatus(meta?.status);
      const currentPhase = resolveTaskPhase(
        id,
        phaseState,
        inferredFromStatus,
        now,
        devFeedbackPending,
        reviewFeedbackPending,
      );
      const roles = mapRoleForTask(
        meta,
        currentPhase,
        devFeedbackPending && currentPhase === "Planning",
        reviewFeedbackPending && currentPhase === "Development",
      );
      desiredTaskPhase.set(id, currentPhase);
      for (const role of roles) {
        if (!desired.has(id)) desired.set(id, new Set<Role>());
        desired.get(id)!.add(role as Role);
      }
    }
  }

  runAutoDeveloperPass(taskMeta, desired, desiredTaskPhase);

  const desiredRunKeys = new Set<string>();
  const updates: Array<RunRecord> = [];

  for (const [taskId, roles] of desired.entries()) {
    const meta = taskMeta.get(taskId);
    const taskTitle = meta?.title || taskId;
        const boardCol = board.find((entry) => entry.items.some((item) => item.taskId === taskId || item.taskId.startsWith(taskId)));
    const sourceColumn = desiredTaskPhase.get(taskId) || phaseFromColumn(boardCol?.column || "Planning");

    for (const role of roles) {
      const key = `${role}:${taskId}`;
      desiredRunKeys.add(key);

      const existing = nextRunsMap.get(key);
      if (!existing) {
        const targetPhase = desiredTaskPhase.get(taskId) || taskColumnToPhase(undefined, sourceColumn);
        const created: RunRecord = {
          taskId,
          role,
          status: "queued",
          phase: targetPhase,
          startedAt: now,
          lastRunAt: now,
          lastPolledAt: now,
          phaseEnteredAt: now,
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
        const targetPhase = desiredTaskPhase.get(taskId) || taskColumnToPhase(undefined, sourceColumn);
        const phaseChanged = existing.phase !== targetPhase;
        const shouldReactivate = existing.status === "completed" || existing.status === "dropped";
        const changed = {
          ...existing,
          sourceColumn,
          phase: targetPhase,
          phaseEnteredAt: phaseChanged ? now : (existing.phaseEnteredAt || now),
          lastTransition: shouldReactivate
            ? "reactivated"
            : phaseChanged
            ? "phase-advance"
            : existing.lastTransition,
          taskTitle,
          lastRunAt: now,
          status: shouldReactivate ? ("queued" as RunStatus) : existing.status,
          startedAt: shouldReactivate ? now : existing.startedAt,
          nextPollAt: shouldReactivate ? now : existing.nextPollAt,
          pollMode: shouldReactivate ? ("normal" as const) : existing.pollMode,
        };
        if (phaseChanged || shouldReactivate) {
          mergeLogEntry(state.log, changed, shouldReactivate ? "created" : "phase");
        }
        updates.push(changed);
      }
    }
  }

  for (const existing of state.runs) {
    if (!desiredRunKeys.has(`${existing.role}:${existing.taskId}`)) {
      const targetPhase = desiredTaskPhase.get(existing.taskId);
      if (existing.status !== "completed" && targetPhase && existing.phase !== targetPhase) {
        const completed = {
          ...existing,
          status: "completed" as RunStatus,
          lastTransition: "phase-complete",
          sourceColumn: targetPhase,
        };
        updates.push(completed);
        mergeLogEntry(state.log, completed, "phase");
      } else if (existing.status !== "completed") {
        const dropped = {
          ...existing,
          status: "dropped" as RunStatus,
          phase: existing.phase || "Planning",
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
  if (Number.isNaN(DEV_FEEDBACK_TIMEOUT_MS) || DEV_FEEDBACK_TIMEOUT_MS <= 0) {
    throw new Error("MC_ACTIVITY_DEV_FEEDBACK_TIMEOUT_MS must be a positive integer");
  }
  if (Number.isNaN(REVIEW_FEEDBACK_TIMEOUT_MS) || REVIEW_FEEDBACK_TIMEOUT_MS <= 0) {
    throw new Error("MC_ACTIVITY_REVIEW_FEEDBACK_TIMEOUT_MS must be a positive integer");
  }

  const statePathDir = path.dirname(RUN_STATE_PATH);
  if (!fs.existsSync(statePathDir)) fs.mkdirSync(statePathDir, { recursive: true });

  console.log("mc-activity runner started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    fallbackIntervalMs: STATUS_POLL_FALLBACK_MS,
    timeoutMs: RUN_TIMEOUT_MS,
    devFeedbackTimeoutMs: DEV_FEEDBACK_TIMEOUT_MS,
    reviewFeedbackTimeoutMs: REVIEW_FEEDBACK_TIMEOUT_MS,
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
