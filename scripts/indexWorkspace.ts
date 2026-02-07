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
  }

  console.log(`Indexed ${files.length} files from ${WORKSPACE_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
