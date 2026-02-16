import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ConvexHttpClient } from "convex/browser";

function readEnvVar(file: string, key: string): string | undefined {
  try {
    const envPath = path.join(process.cwd(), file);
    if (!fs.existsSync(envPath)) return undefined;
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const currentKey = trimmed.slice(0, idx);
      if (currentKey === key) {
        return trimmed.slice(idx + 1);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const CONVEX_URL =
  process.env.CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  readEnvVar(".env.local", "NEXT_PUBLIC_CONVEX_URL") ||
  readEnvVar(".env.local", "CONVEX_URL") ||
  readEnvVar(".env", "NEXT_PUBLIC_CONVEX_URL") ||
  readEnvVar(".env", "CONVEX_URL");
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".DS_Store",
  ".openclaw",
]);

const MAX_BYTES = 200_000;

const INDEX_STATE_PATH = path.join(WORKSPACE_ROOT, "memory", "indexer-state.json");
const CRON_SNAPSHOT_PATH = path.join(WORKSPACE_ROOT, "memory", "cron-jobs.json");

function loadIndexState() {
  try {
    const raw = fs.readFileSync(INDEX_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
  } catch {
    // ignore
  }
  return {} as Record<string, number>;
}

function saveIndexState(state: Record<string, number>) {
  const dir = path.dirname(INDEX_STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_STATE_PATH, JSON.stringify(state, null, 2));
}

function loadCronSnapshot() {
  try {
    if (!fs.existsSync(CRON_SNAPSHOT_PATH)) return [] as Array<Record<string, unknown>>;
    const raw = fs.readFileSync(CRON_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

function walk(dir: string, files: string[] = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function classify(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.includes("memory")) return "memory" as const;
  if (lower.includes("mission-control") || lower.includes("tasks"))
    return "taskNote" as const;
  return "document" as const;
}

function parseListBlock(content: string, heading: string) {
  const regex = new RegExp(`## ${heading}([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match) return [] as string[];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseFrontMatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null as Record<string, unknown> | null, body: content };

  const raw = match[1];
  try {
    const parsed = yaml.load(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body: match[2] };
    }
  } catch {
    // fallthrough to markdown-only parsing
  }
  return { frontmatter: null as Record<string, unknown> | null, body: match[2] };
}

function parseSingleLine(content: string, label: string) {
  const regex = new RegExp(`^[-*]?\\s*${label}:\\s*(.*)$`, "mi");
  const match = content.match(regex);
  if (!match) return undefined;
  return typeof match[1] === "string" ? match[1].trim() : undefined;
}

function parseTaskFile(content: string) {
  const { frontmatter, body } = parseFrontMatter(content);

  if (frontmatter && String(frontmatter.primitive || "").toLowerCase() === "task") {
    const taskId =
      (typeof frontmatter.taskId === "string" && frontmatter.taskId) ||
      (typeof frontmatter.projectId === "string" && frontmatter.projectId) ||
      extractProjectId(typeof frontmatter.title === "string" ? frontmatter.title : undefined) ||
      "unknown";
    const title =
      typeof frontmatter.title === "string"
        ? frontmatter.title
        : "";

    const normalizeList = (value: unknown) => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry).trim()).filter(Boolean);
      }
      if (typeof value === "string") {
        return value
          .split(/,|\//)
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      return undefined;
    };

    return {
      taskId,
      title,
      owner: typeof frontmatter.owner === "string" ? frontmatter.owner : parseSingleLine(body, "Owner"),
      assignees: normalizeList(frontmatter.assignees),
      status: typeof frontmatter.status === "string" ? frontmatter.status : parseSingleLine(body, "Status"),
      createdAt: typeof frontmatter.created === "string" ? frontmatter.created : parseSingleLine(body, "Created"),
      context: typeof frontmatter.context === "string"
        ? frontmatter.context
        : parseListBlock(body, "Context").join("\n") || undefined,
      goal: typeof frontmatter.goal === "string"
        ? frontmatter.goal
        : parseListBlock(body, "Goal (messbar)").join("\n") || undefined,
      scope: typeof frontmatter.scope === "string"
        ? frontmatter.scope
        : parseListBlock(body, "Scope").join("\n") || undefined,
      plan: typeof frontmatter.plan === "string"
        ? frontmatter.plan
        : parseListBlock(body, "Plan").join("\n") || undefined,
      acceptanceCriteria: Array.isArray(frontmatter.acceptanceCriteria)
        ? frontmatter.acceptanceCriteria.map((entry: unknown) => String(entry).trim()).filter(Boolean)
        : parseListBlock(body, "Acceptance Criteria"),
      risks: typeof frontmatter.risks === "string"
        ? frontmatter.risks
        : parseListBlock(body, "Risks / Open Questions").join("\n") || undefined,
      links: normalizeList(frontmatter.links) || parseListBlock(body, "Links / Files"),
    };
  }

  const titleMatch = body.match(/^# Task:\s*(.*)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : "";
  const projectId = extractProjectId(titleLine);
  const title = projectId
    ? titleLine.replace(projectId, "").replace(/^[-–—]+/, "").trim()
    : titleLine;

  return {
    taskId: projectId || titleLine || "unknown",
    title: title || titleLine || projectId || "",
    owner: parseSingleLine(body, "Owner"),
    assignees: parseSingleLine(body, "Assignees")
      ?.split(/,|\//)
      .map((s) => s.trim())
      .filter(Boolean),
    status: parseSingleLine(body, "Status"),
    createdAt: parseSingleLine(body, "Created"),
    context: parseListBlock(body, "Context").join("\n") || undefined,
    goal: parseListBlock(body, "Goal (messbar)").join("\n") || undefined,
    scope: parseListBlock(body, "Scope").join("\n") || undefined,
    plan: parseListBlock(body, "Plan").join("\n") || undefined,
    acceptanceCriteria: parseListBlock(body, "Acceptance Criteria"),
    risks: parseListBlock(body, "Risks / Open Questions").join("\n") || undefined,
    links: parseListBlock(body, "Links / Files"),
  };
}


function extractProjectId(value?: string) {
  if (!value) return undefined;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
}


function normalizeTaskTitle(taskId: string, title: string) {
  if (!taskId) return title;
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`^${escaped}\\s*—\\s*`), "").replace(/^—\\s*/, "");
}

function statusToColumn(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (!normalized.trim()) return "Inbox" as const;
  if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("closed")) return "Done" as const;
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("qc") || normalized.includes("approve")) return "Review" as const;
  if (normalized.includes("develop") || normalized.includes("implement") || normalized.includes("wip") || normalized.includes("active") || normalized.includes("progress") || normalized.includes("blocked") || normalized.includes("build")) {
    return "Development" as const;
  }
  if (normalized.includes("plan") || normalized.includes("todo") || normalized.includes("inbox") || normalized.includes("ready") || normalized.includes("backlog")) return "Planning" as const;
  return "Inbox" as const;
}

function parseStatusSection(section: string, fallbackId: string) {
  return {
    taskId: extractProjectId(fallbackId) || fallbackId || "unknown",
    done: parseSingleLine(section, "Done"),
    inProgress: parseSingleLine(section, "In Progress"),
    next: parseSingleLine(section, "Next"),
    eta: parseSingleLine(section, "ETA"),
    needFromYou: parseSingleLine(section, "Need from you"),
    risks: parseSingleLine(section, "Risks/Blocker") || parseSingleLine(section, "Risiko"),
  };
}

function parseStatusFile(content: string, filePath?: string) {
  const projectIdFromPath = extractProjectId(filePath);
  if (!projectIdFromPath) return [];

  const sections = content.split(/\n##\s+/).map((block, index) => {
    if (index === 0) return null;
    const [headerLine, ...rest] = block.split("\n");
    const sectionBody = rest.join("\n");
    return { header: headerLine.trim(), body: sectionBody };
  }).filter(Boolean) as { header: string; body: string }[];

  if (sections.length > 0) {
    return sections
      .map((section) => {
        const projectId = extractProjectId(section.header);
        if (!projectId) return null;
        if (projectId !== projectIdFromPath) return null;
        const parsed = parseStatusSection(section.body, projectId);
        const hasAnyField = Boolean(
          parsed.done ||
            parsed.inProgress ||
            parsed.next ||
            parsed.eta ||
            parsed.needFromYou ||
            parsed.risks
        );
        return hasAnyField ? parsed : null;
      })
      .filter(Boolean) as ReturnType<typeof parseStatusSection>[];
  }

  return [parseStatusSection(content, projectIdFromPath)];
}

function parseAgentFile(content: string) {
  const titleMatch = content.match(/^# Role:\s*(.*)$/m);
  const role = titleMatch ? titleMatch[1].trim() : "unknown";
  const mission = parseListBlock(content, "Mission").join("\n") || undefined;
  const responsibilities = parseListBlock(content, "Responsibilities");
  const statusCadence = parseListBlock(content, "Status Cadence").join("\n") || undefined;
  const outputStandard = parseListBlock(content, "Output Standard").join("\n") || undefined;
  return { role, mission, responsibilities, statusCadence, outputStandard };
}

function renderBoardMarkdown(columns: { column: string; items: string[] }[]) {
  const order = ["Inbox", "Planning", "Development", "Review", "Done"];
  const byColumn = new Map(columns.map((col) => [col.column, col.items]));
  return ["# Mission Control Board", "", ...order.flatMap((column) => {
    const items = byColumn.get(column) || [];
    const lines = [`## ${column}`];
    if (items.length === 0) {
      lines.push("- ");
    } else {
      lines.push(...items.map((item) => `- ${item}`));
    }
    return [...lines, ""];
  })].join("\n");
}

function parseBoardFile(content: string) {
  const columns = ["Inbox", "Planning", "Development", "Review", "Done"];
  return columns.map((column) => ({
    column,
    items: parseListBlock(content, column),
  }));
}

export async function runIndexWorkspace() {
  if (!CONVEX_URL) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required");
  }
  const client = new ConvexHttpClient(CONVEX_URL);

  const files = walk(WORKSPACE_ROOT).filter((f) => {
    return [".md", ".txt", ".log"].some((ext) => f.endsWith(ext));
  });

  let hasChanges = false;

  const indexState = loadIndexState();
  const nextIndexState: Record<string, number> = { ...indexState };

  const taskTitleById = new Map<string, string>();
  let boardFromFile = false;
  let boardFilePath: string | null = null;
  let boardColumnsFromFile: { column: string; items: string[] }[] | null = null;
  const statusEntries: Array<{
    taskId: string;
    done?: string;
    inProgress?: string;
    next?: string;
    eta?: string;
    needFromYou?: string;
    risks?: string;
    updatedAt: number;
    filePath: string;
  }> = [];

  for (const filePath of files) {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_BYTES) continue;
    const relPath = filePath.replace(WORKSPACE_ROOT, "");
    if (indexState[relPath] && indexState[relPath] === stats.mtimeMs) {
      continue;
    }
    hasChanges = true;
    nextIndexState[relPath] = stats.mtimeMs;
    const content = fs.readFileSync(filePath, "utf8");
    const title = path.basename(filePath);
    const type = classify(filePath);

    await client.mutation("ingest:upsertDocument", {
      type,
      title,
      path: relPath,
      content,
      updatedAt: stats.mtimeMs,
    });

    if (filePath.includes("mission-control")) {
      if (filePath.includes(`${path.sep}agents${path.sep}`)) {
        const parsed = parseAgentFile(content);
        await client.mutation("mc:upsertAgent", {
          ...parsed,
          updatedAt: stats.mtimeMs,
        });
      } else if (
        filePath.includes(`${path.sep}tasks${path.sep}`) ||
        filePath.includes(`${path.sep}primitives${path.sep}tasks${path.sep}`)
      ) {
        const parsed = parseTaskFile(content);
        const projectIdFromPath = extractProjectId(relPath);
        const taskId = projectIdFromPath || parsed.taskId;
        const title = normalizeTaskTitle(taskId, parsed.title);
        taskTitleById.set(taskId, title);
        await client.mutation("mc:cleanupTasksByFile", {
          filePath: relPath,
          keepTaskId: taskId,
        });
        await client.mutation("mc:upsertTask", {
          ...parsed,
          taskId,
          title,
          filePath: relPath,
          updatedAt: stats.mtimeMs,
        });

        const statusText = String(parsed.status || "").trim();
        if (statusText) {
          statusEntries.push({
            taskId,
            inProgress: statusText,
            updatedAt: stats.mtimeMs,
            filePath: relPath,
          });
        }
      } else if (filePath.includes(`${path.sep}status${path.sep}`)) {
        const parsed = parseStatusFile(content, relPath);
        const keepTaskIds = parsed.map((status) => status.taskId);
        await client.mutation("mc:cleanupStatusByFile", {
          filePath: relPath,
          keepTaskIds,
        });
        for (const status of parsed) {
          const projectId = extractProjectId(status.taskId);
          if (projectId) {
            statusEntries.push({
              taskId: status.taskId,
              done: status.done,
              inProgress: status.inProgress,
              next: status.next,
              eta: status.eta,
              needFromYou: status.needFromYou,
              risks: status.risks,
              updatedAt: stats.mtimeMs,
              filePath: relPath,
            });
          }
        }
      } else if (filePath.endsWith(`${path.sep}board.md`)) {
        const columns = parseBoardFile(content);
        boardFromFile = true;
        boardFilePath = relPath;
        boardColumnsFromFile = columns;
      }
    }
  }

  if (statusEntries.length > 0) {
    const latestByTask = new Map<string, typeof statusEntries[number]>();
    for (const entry of statusEntries) {
      const existing = latestByTask.get(entry.taskId);
      if (!existing) {
        latestByTask.set(entry.taskId, entry);
        continue;
      }
      if (entry.updatedAt > existing.updatedAt) {
        latestByTask.set(entry.taskId, entry);
        continue;
      }
      if (entry.updatedAt === existing.updatedAt) {
        const entryHasProgress = Boolean(entry.inProgress || entry.done);
        const existingHasProgress = Boolean(existing.inProgress || existing.done);
        if (entryHasProgress && !existingHasProgress) {
          latestByTask.set(entry.taskId, entry);
          continue;
        }
        if (entryHasProgress && existingHasProgress) {
          const entryStatus = (entry.inProgress || entry.done || "").toLowerCase();
          const existingStatus = (existing.inProgress || existing.done || "").toLowerCase();
          const entryIsDone = statusToColumn(entryStatus) === "Done";
          const existingIsDone = statusToColumn(existingStatus) === "Done";
          if (entryIsDone && !existingIsDone) {
            latestByTask.set(entry.taskId, entry);
          }
        }
      }
    }

    for (const entry of latestByTask.values()) {
      await client.mutation("mc:upsertStatus", {
        taskId: entry.taskId,
        done: entry.done,
        inProgress: entry.inProgress,
        next: entry.next,
        eta: entry.eta,
        needFromYou: entry.needFromYou,
        risks: entry.risks,
        filePath: entry.filePath,
        updatedAt: entry.updatedAt,
      });
    }

    if (boardFromFile && boardFilePath && boardColumnsFromFile) {
      const existing = new Set(
        boardColumnsFromFile.flatMap((col) => col.items.map((item) => item.trim()))
      );
      const planning = boardColumnsFromFile.find((col) => col.column === "Planning");
      const target = planning || boardColumnsFromFile.find((col) => col.column === "Inbox");
      const appended: string[] = [];
      for (const [taskId] of latestByTask.entries()) {
        const title = taskTitleById.get(taskId);
        const label = title ? `${taskId} — ${title}` : taskId;
        if (!existing.has(label)) {
          appended.push(label);
        }
      }
      if (appended.length > 0 && target) {
        target.items = [...target.items.filter(Boolean), ...appended];
        const fullPath = path.join(WORKSPACE_ROOT, boardFilePath);
        fs.writeFileSync(fullPath, renderBoardMarkdown(boardColumnsFromFile));
        const updatedStats = fs.statSync(fullPath);
        nextIndexState[boardFilePath] = updatedStats.mtimeMs;
      }

      const boardUpdatedAt = Date.now();
      for (const column of boardColumnsFromFile) {
        await client.mutation("mc:upsertBoardColumn", {
          ...column,
          updatedAt: boardUpdatedAt,
        });
      }
    }

    if (!boardFromFile) {
      const columns = {
        Inbox: new Set<string>(),
        Planning: new Set<string>(),
        Development: new Set<string>(),
        Review: new Set<string>(),
        Done: new Set<string>(),
      };

      for (const [taskId, entry] of latestByTask.entries()) {
        const title = taskTitleById.get(taskId);
        const label = title ? `${taskId} — ${title}` : taskId;
        const column = statusToColumn(entry.inProgress || entry.done || "");
        columns[column].add(label);
      }

      const updatedAt = Date.now();
      for (const [column, items] of Object.entries(columns)) {
        await client.mutation("mc:upsertBoardColumn", {
          column,
          items: Array.from(items),
          updatedAt,
        });
      }
    }
  }

  if (!hasChanges) {
    console.log(`No workspace changes in ${WORKSPACE_ROOT}; skipping ingestion.`);
    return;
  }

  const cronJobs = loadCronSnapshot();
  for (const job of cronJobs) {
    const title = job.name || job.id || "cron-job";
    const scheduleType = job.schedule?.kind || "cron";
    const schedule =
      scheduleType === "cron"
        ? job.schedule?.expr || ""
        : scheduleType === "every"
        ? String(job.schedule?.everyMs ?? "")
        : String(job.schedule?.atMs ?? "");
    const nextRunAt =
      job.state?.nextRunAtMs ||
      job.schedule?.atMs ||
      job.schedule?.anchorMs ||
      Date.now();
    await client.mutation("tasks:upsert", {
      title,
      description: job.payload?.text || job.payload?.message || undefined,
      scheduleType,
      schedule,
      nextRunAt,
    });
  }

  saveIndexState(nextIndexState);

  try {
    await client.mutation("activity:log", {
      title: "Workspace indexed",
      detail: `Indexed ${files.length} files from ${WORKSPACE_ROOT}`,
      kind: "ingest",
      source: "indexer",
    });
  } catch (err) {
    console.error("Failed to log activity", err);
  }

  console.log(`Indexed ${files.length} files from ${WORKSPACE_ROOT}`);
}

async function main() {
  await runIndexWorkspace();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
