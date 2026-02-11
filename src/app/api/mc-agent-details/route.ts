import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";
const MC_MEMORY_DIR = path.join(WORKSPACE_ROOT, "memory", "mc");

type AgentDetail = {
  role: string;
  currentTask: string[];
  status: string[];
  nextSteps: string[];
  blockers: string[];
  mrLinks: string[];
  branches: string[];
  updatedAt?: number;
};

function parseSection(content: string, heading: string) {
  const regex = new RegExp(`## ${heading}([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = content.match(regex);
  if (!match) return [] as string[];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*]\s*/, ""));
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseAgentWorking(role: string, filePath: string): AgentDetail {
  const content = fs.readFileSync(filePath, "utf8");
  const currentTask = parseSection(content, "Current Task");
  const status = parseSection(content, "Status");
  const nextSteps = parseSection(content, "Next Steps").map((s) => s.replace(/^\d+\)\s*/, ""));
  const blockers = parseSection(content, "Blockers").map((s) => s.replace(/^\d+\)\s*/, ""));

  const mrLinks = uniq((content.match(/https?:\/\/gitlab\.com\/[^\s)]+\/merge_requests\/\d+/g) || []));

  const branchMatches = [
    ...(content.match(/branch\s+`([^`]+)`/gi) || []).map((m) => m.replace(/branch\s+`|`/gi, "").trim()),
    ...(content.match(/\bfork\/[A-Za-z0-9._\/-]+/g) || []),
  ];

  const stat = fs.statSync(filePath);

  return {
    role,
    currentTask,
    status,
    nextSteps,
    blockers,
    mrLinks,
    branches: uniq(branchMatches),
    updatedAt: stat.mtimeMs,
  };
}

export async function GET() {
  try {
    const roles = fs.existsSync(MC_MEMORY_DIR)
      ? fs.readdirSync(MC_MEMORY_DIR).filter((entry) => fs.existsSync(path.join(MC_MEMORY_DIR, entry, "WORKING.md")))
      : [];

    const details = roles.map((role) => {
      const filePath = path.join(MC_MEMORY_DIR, role, "WORKING.md");
      return parseAgentWorking(role.toLowerCase(), filePath);
    });

    return NextResponse.json({ source: "filesystem", details });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent details", details: [] },
      { status: 500 }
    );
  }
}
