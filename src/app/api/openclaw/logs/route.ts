export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function GET(request: Request) {
  const scriptPath = path.join(process.cwd(), "scripts", "openclawLogs.mjs");
  const url = new URL(request.url);
  const sinceMs = url.searchParams.get("sinceMs");

  const result = await new Promise<{ lines: string[]; lastTimeMs?: number }>((resolve, reject) => {
    const args = [scriptPath];
    if (sinceMs) args.push(sinceMs);
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
          let lastTimeMs: number | undefined;
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              const time = parsed.time || parsed.ts || parsed.timestamp || parsed._meta?.date;
              const ms = time ? Date.parse(time) : NaN;
              if (!Number.isNaN(ms)) {
                lastTimeMs = lastTimeMs ? Math.max(lastTimeMs, ms) : ms;
              }
            } catch {
              // ignore
            }
          }
          resolve({ lines, lastTimeMs });
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
