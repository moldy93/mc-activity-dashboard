import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type AgentWorkload = {
  role: string;
  tasks: Array<{ taskId: string; title: string; status?: string }>;
};

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";
const AGENTS_DIR = path.join(WORKSPACE_ROOT, "mission-control", "agents");
const TASKS_DIR = path.join(WORKSPACE_ROOT, "mission-control", "tasks");

function parseSingleLine(content: string, label: string) {
  // Markdown-bold form: **Label:** value
  const bold = new RegExp(`^(?:[-*]\\s*)?\\*\\*${label}:\\*\\*\\s*(.*)$`, "mi");
  const mb = content.match(bold);
  if (mb?.[1]) return mb[1].trim();

  // Plain form: Label: value
  const plain = new RegExp(`^(?:[-*]\\s*)?${label}:\\s*(.*)$`, "mi");
  const mp = content.match(plain);
  return mp?.[1]?.trim();
}

function normalizeRole(value: string) {
  const raw = value.toLowerCase().replace(/[^a-z/]/g, "");
  if (raw.includes("ui/ux") || raw.includes("uiux")) return "uiux";
  if (raw.includes("review")) return "reviewer";
  if (raw.includes("plan")) return "planner";
  if (raw.includes("dev")) return "dev";
  if (raw === "pm" || raw.includes("product") || raw.includes("clientinterface")) return "pm";
  return raw;
}

function isDoneStatus(status?: string) {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes("done") || s.includes("complete") || s.includes("closed");
}

function parseAssignees(value?: string) {
  if (!value) return [] as string[];
  return value
    .split(/,|\//)
    .map((v) => normalizeRole(v.trim()))
    .filter(Boolean);
}

function parseTaskFile(content: string, fileName: string) {
  const titleMatch = content.match(/^# Task:\s*(.*)$/m);
  const fullTitle = titleMatch?.[1]?.trim() || "";
  const taskIdMatch = fullTitle.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  const fileTaskIdMatch = fileName.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  const taskId = (taskIdMatch?.[0] || fileTaskIdMatch?.[0] || fullTitle).toLowerCase();
  const status = parseSingleLine(content, "Status");
  const assignees = parseAssignees(parseSingleLine(content, "Assignees"));
  return { taskId, title: fullTitle, status, assignees };
}

export async function GET() {
  try {
    const roleNames = fs.existsSync(AGENTS_DIR)
      ? fs
          .readdirSync(AGENTS_DIR)
          .filter((name) => name.endsWith(".md"))
          .map((name) => name.replace(/\.md$/, ""))
      : ["pm", "planner", "dev", "reviewer", "uiux"];

    const workloads = new Map<string, AgentWorkload>();
    for (const role of roleNames) {
      workloads.set(normalizeRole(role), { role: normalizeRole(role), tasks: [] });
    }

    if (fs.existsSync(TASKS_DIR)) {
      for (const file of fs.readdirSync(TASKS_DIR)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = path.join(TASKS_DIR, file);
        const content = fs.readFileSync(fullPath, "utf8");
        const task = parseTaskFile(content, file);
        if (!task.taskId || isDoneStatus(task.status)) continue;

        for (const assignee of task.assignees) {
          if (!workloads.has(assignee)) {
            workloads.set(assignee, { role: assignee, tasks: [] });
          }
          workloads.get(assignee)?.tasks.push({
            taskId: task.taskId,
            title: task.title,
            status: task.status,
          });
        }
      }
    }

    return NextResponse.json({
      source: "filesystem",
      workloads: Array.from(workloads.values()),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent workload", workloads: [] },
      { status: 500 }
    );
  }
}
