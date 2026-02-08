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
      ctx.db
        .query("memories")
        .withSearchIndex("search_memories", (q) => q.search("content", args.term))
        .take(limit),
      ctx.db
        .query("documents")
        .withSearchIndex("search_documents", (q) => q.search("content", args.term))
        .take(limit),
      ctx.db
        .query("taskNotes")
        .withSearchIndex("search_taskNotes", (q) => q.search("content", args.term))
        .take(limit),
    ]);

    return { memories, documents, taskNotes };
  },
});
