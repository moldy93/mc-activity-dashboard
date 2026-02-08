export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function GET() {
  const scriptPath = path.join(process.cwd(), "scripts", "openclawLogs.mjs");

  const result = await new Promise<{ lines: string[] }>((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
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
          resolve({ lines: payload.lines || [] });
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
