export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { execFile } from "child_process";

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type UsageProvider = {
  provider: string;
  displayName?: string;
  plan?: string;
  windows?: UsageWindow[];
};

export async function GET() {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "openclaw",
        ["status", "--usage", "--json"],
        { env: process.env, timeout: 15000, maxBuffer: 1024 * 1024 },
        (error, out, err) => {
          if (error) {
            reject(new Error(err?.toString() || error.message));
            return;
          }
          resolve(out?.toString() || "{}");
        }
      );
    });

    const payload = JSON.parse(stdout || "{}") as {
      usage?: { updatedAt?: number; providers?: UsageProvider[] };
    };

    const codexProvider = (payload.usage?.providers || []).find((p) =>
      String(p.provider || "").toLowerCase().includes("codex")
    ) || (payload.usage?.providers || [])[0];

    return NextResponse.json({
      updatedAt: payload.usage?.updatedAt,
      provider: codexProvider || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage fetch failed" },
      { status: 500 }
    );
  }
}
