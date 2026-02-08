import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const ADMIN_KEY = process.env.CONVEX_ADMIN_KEY;

if (!CONVEX_URL || !ADMIN_KEY) {
  throw new Error("CONVEX_URL and CONVEX_ADMIN_KEY are required");
}

const client = new ConvexHttpClient(CONVEX_URL, { adminKey: ADMIN_KEY });

const date = new Date().toLocaleDateString("en-CA", {
  timeZone: "Europe/Berlin",
});

const counts = await client.query("mc:getCounts", {});
await client.mutation("mc:upsertCountsDaily", {
  date,
  counts,
  updatedAt: Date.now(),
});

console.log(`Snapshot saved for ${date}`);
