import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    scheduleType: v.union(v.literal("cron"), v.literal("at"), v.literal("every")),
    schedule: v.string(),
    nextRunAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scheduledTasks")
      .filter((q) => q.eq(q.field("title"), args.title))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
      });
      return existing._id;
    }
    return await ctx.db.insert("scheduledTasks", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const listWeek = query({
  args: {
    weekStart: v.number(),
    weekEnd: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduledTasks")
      .withIndex("by_nextRunAt")
      .filter((q) => q.gte(q.field("nextRunAt"), args.weekStart))
      .filter((q) => q.lte(q.field("nextRunAt"), args.weekEnd))
      .order("asc")
      .collect();
  },
});
