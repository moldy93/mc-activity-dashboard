import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspace";

const ALLOWED_LOGS: Record<string, string> = {
  "pm-status.md": "pm-status.md",
  "pm-status.log": "pm-status.log",
  "pm-status-5m.log": "pm-status-5m.log",
};

function tailLines(content: string, limit: number) {
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(lines.length - limit, 0));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file") || "pm-status.md";
  const limit = Number(searchParams.get("limit") || "60");

  const relativePath = ALLOWED_LOGS[file];
  if (!relativePath) {
    return NextResponse.json({ error: "Invalid log file" }, { status: 400 });
  }

  const filePath = path.join(WORKSPACE_ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Log file not found" }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = tailLines(content, Math.min(Math.max(limit, 10), 300));

  return NextResponse.json({ file, lines });
}
