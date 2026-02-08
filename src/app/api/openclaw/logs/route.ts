export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function GET(request: Request) {
  const scriptPath = path.join(process.cwd(), "scripts", "openclawLogs.mjs");
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  const result = await new Promise<{ lines: string[]; cursor?: number }>((resolve, reject) => {
    const args = [scriptPath];
    if (cursor) args.push(cursor);
    const child = spawn("node", args, {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        try {
          const payload = JSON.parse(stdout.trim() || "{}") as { lines?: string[] };
          const lines = payload.lines || [];
          const nextCursor = typeof payload.cursor === "number" ? payload.cursor : undefined;
          resolve({ lines, cursor: nextCursor });
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(stderr.trim() || "openclaw logs failed"));
      }
    });
  });

  return NextResponse.json(result);
}
