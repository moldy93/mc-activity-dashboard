import { query } from "./_generated/server";
import { v } from "convex/values";

export const global = query({
  args: {
    term: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    if (!args.term.trim()) return { memories: [], documents: [], taskNotes: [] };

    const [memories, documents, taskNotes] = await Promise.all([
      ctx.db.search("memories", "search_memories", args.term).take(limit),
      ctx.db.search("documents", "search_documents", args.term).take(limit),
      ctx.db.search("taskNotes", "search_taskNotes", args.term).take(limit),
    ]);

    return { memories, documents, taskNotes };
  },
});
