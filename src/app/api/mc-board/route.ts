import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

type BoardColumn = {
  column: "Inbox" | "Planning" | "Development" | "Review" | "Done";
  items: string[];
};

type TaskEntry = {
  taskId: string;
  title: string;
  status?: string;
  priority: number;
};

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";
const LEGACY_TASK_DIRS = [
  path.join(WORKSPACE_ROOT, "mission-control", "tasks"),
  path.join(WORKSPACE_ROOT, "mission-control", "primitives", "tasks"),
];
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, "projects");
const COLUMNS: BoardColumn["column"][] = ["Inbox", "Planning", "Development", "Review", "Done"];

function extractProjectId(value?: string) {
  if (!value) return undefined;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : undefined;
}

function statusToColumn(status?: string): BoardColumn["column"] {
  const s = String(status || "").toLowerCase();
  if (!s.trim()) return "Inbox";
  if (s.includes("done") || s.includes("complete") || s.includes("closed")) return "Done";
  if (s.includes("review") || s.includes("qa") || s.includes("qc") || s.includes("approve")) return "Review";
  if (s.includes("develop") || s.includes("implement") || s.includes("wip") || s.includes("active") || s.includes("progress") || s.includes("blocked") || s.includes("build")) return "Development";
  if (s.includes("inbox")) return "Inbox";
  if (s.includes("plan") || s.includes("todo") || s.includes("ready") || s.includes("backlog")) return "Planning";
  return "Inbox";
}

function parseTask(content: string, fileName: string) {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n?/);
  let taskId = "";
  let title = "";
  let status = "";

  try {
    // 1) Markdown frontmatter
    if (fm) {
      const parsed = yaml.load(fm[1]) as Record<string, unknown>;
      taskId =
        (typeof parsed?.taskId === "string" && parsed.taskId.toLowerCase()) ||
        (typeof parsed?.projectId === "string" && parsed.projectId.toLowerCase()) ||
        "";
      title = typeof parsed?.title === "string" ? parsed.title : "";
      status = typeof parsed?.status === "string" ? parsed.status : "";
    } else {
      // 2) Plain YAML file (e.g. projects/*/Briefing.yml)
      const parsed = yaml.load(content) as Record<string, unknown>;
      taskId =
        (typeof parsed?.taskId === "string" && parsed.taskId.toLowerCase()) ||
        (typeof parsed?.projectId === "string" && parsed.projectId.toLowerCase()) ||
        "";
      title = typeof parsed?.title === "string" ? parsed.title : "";
      status = typeof parsed?.status === "string" ? parsed.status : "";
    }
  } catch {
    // fallback below
  }

  if (!taskId) taskId = extractProjectId(fileName) || extractProjectId(content) || "";
  if (!title) {
    const m = content.match(/^#\s*Task:\s*(.*)$/mi);
    title = m?.[1]?.trim() || fileName;
  }

  return { taskId, title, status };
}

function upsertEntry(map: Map<string, TaskEntry>, next: TaskEntry) {
  const prev = map.get(next.taskId);
  if (!prev || next.priority >= prev.priority) {
    map.set(next.taskId, next);
  }
}

export async function GET() {
  try {
    const byColumn = new Map<BoardColumn["column"], string[]>();
    for (const c of COLUMNS) byColumn.set(c, []);

    const taskMap = new Map<string, TaskEntry>();

    for (const tasksDir of LEGACY_TASK_DIRS) {
      if (!fs.existsSync(tasksDir)) continue;
      for (const file of fs.readdirSync(tasksDir)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = path.join(tasksDir, file);
        const content = fs.readFileSync(fullPath, "utf8");
        const { taskId, title, status } = parseTask(content, file);
        if (!taskId) continue;
        upsertEntry(taskMap, { taskId, title, status, priority: 1 });
      }
    }

    if (fs.existsSync(PROJECTS_DIR)) {
      for (const dir of fs.readdirSync(PROJECTS_DIR)) {
        const briefing = path.join(PROJECTS_DIR, dir, "Briefing.yml");
        if (!fs.existsSync(briefing)) continue;
        const content = fs.readFileSync(briefing, "utf8");
        const { taskId, title, status } = parseTask(content, path.basename(briefing));
        if (!taskId) continue;
        upsertEntry(taskMap, { taskId, title, status, priority: 2 });
      }
    }

    for (const task of taskMap.values()) {
      const cleanTitle = String(task.title || task.taskId)
        .replace(new RegExp(`^${task.taskId}\\s*[—-]\\s*`, "i"), "")
        .trim();
      const label = `${task.taskId} — ${cleanTitle || task.taskId}`;
      const column = statusToColumn(task.status);
      byColumn.get(column)!.push(label);
    }

    const board = COLUMNS.map((column) => ({
      column,
      items: Array.from(new Set((byColumn.get(column) || []).filter(Boolean))).sort(),
    }));

    return NextResponse.json({
      source: "yaml-status",
      board,
      updatedAt: Date.now(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load board", board: [] },
      { status: 500 }
    );
  }
}
