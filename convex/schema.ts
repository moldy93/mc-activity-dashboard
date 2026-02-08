import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  activities: defineTable({
    title: v.string(),
    detail: v.optional(v.string()),
    kind: v.optional(v.string()),
    source: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  scheduledTasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    scheduleType: v.union(v.literal("cron"), v.literal("at"), v.literal("every")),
    schedule: v.string(),
    nextRunAt: v.number(),
    createdAt: v.number(),
  }).index("by_nextRunAt", ["nextRunAt"]),

  documents: defineTable({
    title: v.string(),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  }).searchIndex("search_documents", {
    searchField: "content",
    filterFields: ["path"],
  }),

  memories: defineTable({
    title: v.string(),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  }).searchIndex("search_memories", {
    searchField: "content",
    filterFields: ["path"],
  }),

  taskNotes: defineTable({
    title: v.string(),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  }).searchIndex("search_taskNotes", {
    searchField: "content",
    filterFields: ["path"],
  }),

  mcAgents: defineTable({
    role: v.string(),
    mission: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    statusCadence: v.optional(v.string()),
    outputStandard: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_role", ["role"]),

  mcTasks: defineTable({
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
  })
    .index("by_taskId", ["taskId"])
    .index("by_filePath", ["filePath"]),

  mcStatus: defineTable({
    taskId: v.string(),
    done: v.optional(v.string()),
    inProgress: v.optional(v.string()),
    next: v.optional(v.string()),
    eta: v.optional(v.string()),
    needFromYou: v.optional(v.string()),
    risks: v.optional(v.string()),
    filePath: v.string(),
    updatedAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_filePath", ["filePath"]),

  mcBoardColumns: defineTable({
    column: v.string(),
    items: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_column", ["column"]),
});
