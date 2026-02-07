import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export async function POST(req: NextRequest) {
  if (!convexUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CONVEX_URL missing" },
      { status: 500 }
    );
  }

  const body = await req.json();
  const client = new ConvexHttpClient(convexUrl, {
    adminKey: process.env.CONVEX_ADMIN_KEY,
  });

  const result = await client.mutation("activity:log", {
    title: body.title ?? "Untitled",
    detail: body.detail,
    kind: body.kind,
    source: body.source,
  });

  return NextResponse.json({ ok: true, id: result });
}
