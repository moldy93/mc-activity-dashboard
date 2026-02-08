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
  const regex = new RegExp(`^${label}:\s*(.*)$`, "mi");
  const match = content.match(regex);
  return match ? match[1].trim() : undefined;
}

function parseTaskFile(content: string) {
  const titleMatch = content.match(/^# Task:\s*(.*)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : "";
  const [taskId, ...restTitle] = titleLine.split("—").map((s) => s.trim());
  const title = restTitle.length ? restTitle.join(" — ") : taskId;

  return {
    taskId: taskId || titleLine || "unknown",
    title,
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
  const match = value.match(/[a-z]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
}

function parseStatusFile(content: string) {
  const header = content.match(/^\[STATUS\]\s*(.*)$/m);
  const titleMatch = content.match(/^#\s*Status:\s*(.*)$/m);
  const headerValue = header ? header[1].trim() : undefined;
  const titleValue = titleMatch ? titleMatch[1].trim() : undefined;
  const taskId = extractProjectId(headerValue) || extractProjectId(titleValue) || headerValue || titleValue || "unknown";
  return {
    taskId,
    done: parseSingleLine(content, "Done"),
    inProgress: parseSingleLine(content, "In Progress"),
    next: parseSingleLine(content, "Next"),
    eta: parseSingleLine(content, "ETA"),
    needFromYou: parseSingleLine(content, "Need from you"),
    risks: parseSingleLine(content, "Risks/Blocker"),
  };
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
        await client.mutation("mc:upsertTask", {
          ...parsed,
          filePath: filePath.replace(WORKSPACE_ROOT, ""),
          updatedAt: stats.mtimeMs,
        });
      } else if (filePath.includes(`${path.sep}status${path.sep}`)) {
        const parsed = parseStatusFile(content);
        await client.mutation("mc:upsertStatus", {
          ...parsed,
          filePath: filePath.replace(WORKSPACE_ROOT, ""),
          updatedAt: stats.mtimeMs,
        });
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

  console.log(`Indexed ${files.length} files from ${WORKSPACE_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
