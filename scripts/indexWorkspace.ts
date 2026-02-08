import fs from "fs";
import path from "path";
import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
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
  const regex = new RegExp(`## ${heading}([\s\S]*?)(\n## |$)`, "m");
  const match = content.match(regex);
  if (!match) return [] as string[];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseSingleLine(content: string, label: string) {
  const regex = new RegExp(`^[-*]?\s*${label}:\s*(.*)$`, "mi");
  const match = content.match(regex);
  if (!match) return undefined;
  return typeof match[1] === "string" ? match[1].trim() : undefined;
}

function parseTaskFile(content: string) {
  const titleMatch = content.match(/^# Task:\s*(.*)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : "";
  const projectId = extractProjectId(titleLine);
  const title = projectId
    ? titleLine.replace(projectId, "").replace(/^[-–—]+/, "").trim()
    : titleLine;

  return {
    taskId: projectId || titleLine || "unknown",
    title: title || titleLine || projectId || "",
    owner: parseSingleLine(content, "Owner"),
    assignees: parseSingleLine(content, "Assignees")
      ?.split(/,|\//)
      .map((s) => s.trim())
      .filter(Boolean),
    status: parseSingleLine(content, "Status"),
    createdAt: parseSingleLine(content, "Created"),
    context: parseListBlock(content, "Context").join("\n") || undefined,
    goal: parseListBlock(content, "Goal \(messbar\)").join("\n") || undefined,
    scope: parseListBlock(content, "Scope").join("\n") || undefined,
    plan: parseListBlock(content, "Plan").join("\n") || undefined,
    acceptanceCriteria: parseListBlock(content, "Acceptance Criteria"),
    risks: parseListBlock(content, "Risks / Open Questions").join("\n") || undefined,
    links: parseListBlock(content, "Links / Files"),
  };
}

function extractProjectId(value?: string) {
  if (!value) return undefined;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
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

function parseStatusFile(content: string) {
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

  const header = content.match(/^\[STATUS\]\s*(.*)$/m);
  const titleMatch = content.match(/^#\s*Status:\s*(.*)$/m);
  const headerValue = header ? header[1].trim() : undefined;
  const titleValue = titleMatch ? titleMatch[1].trim() : undefined;
  const taskId = extractProjectId(headerValue) || extractProjectId(titleValue) || headerValue || titleValue || "unknown";
  return [parseStatusSection(content, taskId)];
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

function parseBoardFile(content: string) {
  const columns = ["Inbox", "Planning", "Development", "Review", "Done"];
  return columns.map((column) => ({
    column,
    items: parseListBlock(content, column),
  }));
}

async function main() {
  if (!CONVEX_URL) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required");
  }
  const client = new ConvexHttpClient(CONVEX_URL, {
    adminKey: process.env.CONVEX_ADMIN_KEY,
  });

  const files = walk(WORKSPACE_ROOT).filter((f) => {
    return [".md", ".txt", ".log"].some((ext) => f.endsWith(ext));
  });

  const taskTitleById = new Map<string, string>();
  const statusEntries: Array<{ taskId: string; inProgress?: string; updatedAt: number; filePath: string } > = [];

  for (const filePath of files) {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_BYTES) continue;
    const content = fs.readFileSync(filePath, "utf8");
    const title = path.basename(filePath);
    const type = classify(filePath);

    await client.mutation("ingest:upsertDocument", {
      type,
      title,
      path: filePath.replace(WORKSPACE_ROOT, ""),
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
      } else if (filePath.includes(`${path.sep}tasks${path.sep}`)) {
        const parsed = parseTaskFile(content);
        const relPath = filePath.replace(WORKSPACE_ROOT, "");
        taskTitleById.set(parsed.taskId, parsed.title);
        await client.mutation("mc:cleanupTasksByFile", {
          filePath: relPath,
          keepTaskId: parsed.taskId,
        });
        await client.mutation("mc:upsertTask", {
          ...parsed,
          filePath: relPath,
          updatedAt: stats.mtimeMs,
        });
      } else if (filePath.includes(`${path.sep}status${path.sep}`)) {
        const parsed = parseStatusFile(content);
        const relPath = filePath.replace(WORKSPACE_ROOT, "");
        const keepTaskIds = parsed.map((status) => status.taskId);
        await client.mutation("mc:cleanupStatusByFile", {
          filePath: relPath,
          keepTaskIds,
        });
        for (const status of parsed) {
          statusEntries.push({
            taskId: status.taskId,
            inProgress: status.inProgress,
            updatedAt: stats.mtimeMs,
            filePath: relPath,
          });
        }
      } else if (filePath.endsWith(`${path.sep}board.md`)) {
        const columns = parseBoardFile(content);
        for (const column of columns) {
          await client.mutation("mc:upsertBoardColumn", {
            ...column,
            updatedAt: stats.mtimeMs,
          });
        }
      }
    }
  }

  if (statusEntries.length > 0) {
    const latestByTask = new Map<string, { inProgress?: string; updatedAt: number; filePath: string }>();
    for (const entry of statusEntries) {
      const existing = latestByTask.get(entry.taskId);
      if (!existing || entry.updatedAt >= existing.updatedAt) {
        latestByTask.set(entry.taskId, entry);
      }
    }

    for (const [taskId, entry] of latestByTask.entries()) {
      await client.mutation("mc:upsertStatus", {
        taskId,
        inProgress: entry.inProgress,
        filePath: entry.filePath,
        updatedAt: entry.updatedAt,
      });
    }

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
      const statusText = (entry.inProgress || "").toLowerCase();
      if (statusText.includes("done") || statusText.includes("complete")) {
        columns.Done.add(label);
      } else if (statusText.includes("review")) {
        columns.Review.add(label);
      } else if (statusText.includes("develop") || statusText.includes("implement")) {
        columns.Development.add(label);
      } else if (statusText.includes("plan")) {
        columns.Planning.add(label);
      } else {
        columns.Inbox.add(label);
      }
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

  console.log(`Indexed ${files.length} files from ${WORKSPACE_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
