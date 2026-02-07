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
});
