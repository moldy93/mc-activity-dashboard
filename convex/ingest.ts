import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const upsertDocument = mutation({
  args: {
    type: v.union(v.literal("document"), v.literal("memory"), v.literal("taskNote")),
    title: v.string(),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const table =
      args.type === "memory"
        ? "memories"
        : args.type === "taskNote"
        ? "taskNotes"
        : "documents";

    const existing = await ctx.db
      .query(table)
      .filter((q) => q.eq(q.field("path"), args.path))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        content: args.content,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert(table, {
      title: args.title,
      path: args.path,
      content: args.content,
      updatedAt: args.updatedAt,
    });
  },
});
