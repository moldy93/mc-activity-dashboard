import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsertAgent = mutation({
  args: {
    role: v.string(),
    mission: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    statusCadence: v.optional(v.string()),
    outputStandard: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcAgents")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("mcAgents", args);
  },
});

export const upsertTask = mutation({
  args: {
    taskId: v.string(),
    title: v.string(),
    owner: v.optional(v.string()),
    assignees: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    createdAt: v.optional(v.string()),
    context: v.optional(v.string()),
    goal: v.optional(v.string()),
    scope: v.optional(v.string()),
    plan: v.optional(v.string()),
    acceptanceCriteria: v.optional(v.array(v.string())),
    risks: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    filePath: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("mcTasks", args);
  },
});

export const cleanupTasksByFile = mutation({
  args: {
    filePath: v.string(),
    keepTaskId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcTasks")
      .withIndex("by_filePath", (q) => q.eq("filePath", args.filePath))
      .collect();
    for (const doc of existing) {
      if (doc.taskId !== args.keepTaskId) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});

export const upsertStatus = mutation({
  args: {
    taskId: v.string(),
    done: v.optional(v.string()),
    inProgress: v.optional(v.string()),
    next: v.optional(v.string()),
    eta: v.optional(v.string()),
    needFromYou: v.optional(v.string()),
    risks: v.optional(v.string()),
    filePath: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcStatus")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("mcStatus", args);
  },
});

export const cleanupStatusByFile = mutation({
  args: {
    filePath: v.string(),
    keepTaskIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcStatus")
      .withIndex("by_filePath", (q) => q.eq("filePath", args.filePath))
      .collect();
    for (const doc of existing) {
      if (!args.keepTaskIds.includes(doc.taskId)) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});

export const upsertBoardColumn = mutation({
  args: {
    column: v.string(),
    items: v.array(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcBoardColumns")
      .withIndex("by_column", (q) => q.eq("column", args.column))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("mcBoardColumns", args);
  },
});

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("mcAgents").collect();
    const tasks = await ctx.db.query("mcTasks").collect();
    const status = await ctx.db.query("mcStatus").collect();
    const board = await ctx.db.query("mcBoardColumns").collect();
    return { agents, tasks, status, board };
  },
});

export const getCounts = query({
  args: {},
  handler: async (ctx) => {
    const [
      documents,
      memories,
      taskNotes,
      activities,
      scheduledTasks,
      mcAgents,
      mcTasks,
      mcStatus,
      mcBoardColumns,
    ] = await Promise.all([
      ctx.db.query("documents").collect(),
      ctx.db.query("memories").collect(),
      ctx.db.query("taskNotes").collect(),
      ctx.db.query("activities").collect(),
      ctx.db.query("scheduledTasks").collect(),
      ctx.db.query("mcAgents").collect(),
      ctx.db.query("mcTasks").collect(),
      ctx.db.query("mcStatus").collect(),
      ctx.db.query("mcBoardColumns").collect(),
    ]);

    return {
      documents: documents.length,
      memories: memories.length,
      taskNotes: taskNotes.length,
      activities: activities.length,
      scheduledTasks: scheduledTasks.length,
      mcAgents: mcAgents.length,
      mcTasks: mcTasks.length,
      mcStatus: mcStatus.length,
      mcBoardColumns: mcBoardColumns.length,
    };
  },
});

export const upsertCountsDaily = mutation({
  args: {
    date: v.string(),
    counts: v.object({
      documents: v.number(),
      memories: v.number(),
      taskNotes: v.number(),
      activities: v.number(),
      scheduledTasks: v.number(),
      mcAgents: v.number(),
      mcTasks: v.number(),
      mcStatus: v.number(),
      mcBoardColumns: v.number(),
    }),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcCountsDaily")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("mcCountsDaily", args);
  },
});
