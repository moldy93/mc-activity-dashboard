export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { execFile } from "child_process";

export async function GET() {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "openclaw",
        ["logs", "--json", "--limit", "200", "--max-bytes", "200000", "--timeout", "10000"],
        { env: process.env, timeout: 15000, maxBuffer: 1024 * 1024 },
        (error, out, err) => {
          if (error) {
            reject(new Error(err?.toString() || error.message));
            return;
          }
          resolve(out?.toString() || "");
        }
      );
    });

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-200);

    return NextResponse.json({ lines });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "openclaw logs failed" },
      { status: 500 }
    );
  }
}
