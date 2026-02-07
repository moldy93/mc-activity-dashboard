"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function ActivityFeed() {
  const activities = useQuery(api.activity.listRecent, { limit: 60 }) ?? [];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <SectionHeader
        title="Activity Feed"
        subtitle="Every action recorded. Ingest via /api/activity or Convex mutation."
      />
      <div className="space-y-3">
        {activities.length === 0 && (
          <p className="text-sm text-slate-400">No activity yet.</p>
        )}
        {activities.map((item) => (
          <div
            key={item._id}
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                {item.title}
              </h3>
              <span className="text-xs text-slate-500">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
            {item.detail && (
              <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">
                {item.detail}
              </p>
            )}
            <div className="mt-2 flex gap-2 text-xs text-slate-500">
              {item.kind && <span>Kind: {item.kind}</span>}
              {item.source && <span>Source: {item.source}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getWeekRange(anchor: Date) {
  const day = anchor.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function WeeklyCalendar() {
  const [anchor, setAnchor] = useState(new Date());
  const range = useMemo(() => getWeekRange(anchor), [anchor]);
  const tasks =
    useQuery(api.tasks.listWeek, {
      weekStart: range.monday.getTime(),
      weekEnd: range.sunday.getTime(),
    }) ?? [];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <SectionHeader
        title="Weekly Schedule"
        subtitle="Upcoming scheduled tasks (from Convex)."
      />
      <div className="flex items-center gap-2 mb-4">
        <button
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          onClick={() => {
            const prev = new Date(anchor);
            prev.setDate(anchor.getDate() - 7);
            setAnchor(prev);
          }}
        >
          Prev
        </button>
        <button
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          onClick={() => setAnchor(new Date())}
        >
          Today
        </button>
        <button
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          onClick={() => {
            const next = new Date(anchor);
            next.setDate(anchor.getDate() + 7);
            setAnchor(next);
          }}
        >
          Next
        </button>
        <span className="text-sm text-slate-400 ml-2">
          {range.monday.toLocaleDateString()} – {range.sunday.toLocaleDateString()}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {tasks.length === 0 && (
          <p className="text-sm text-slate-400">No tasks scheduled this week.</p>
        )}
        {tasks.map((task) => (
          <div
            key={task._id}
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                {task.title}
              </h3>
              <span className="text-xs text-slate-500">
                {new Date(task.nextRunAt).toLocaleString()}
              </span>
            </div>
            {task.description && (
              <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">
                {task.description}
              </p>
            )}
            <div className="mt-2 text-xs text-slate-500">
              {task.scheduleType.toUpperCase()}: {task.schedule}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState("");
  const results = useQuery(api.search.global, { term, limit: 10 });

  const renderSection = (
    label: string,
    items: { _id: string; title: string; path: string; content: string }[]
  ) => (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-200">{label}</h3>
      {items.length === 0 && (
        <p className="text-xs text-slate-500 mt-1">No matches.</p>
      )}
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div
            key={item._id}
            className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-slate-100 font-semibold">
                {item.title}
              </h4>
              <span className="text-xs text-slate-500">{item.path}</span>
            </div>
            <p className="text-xs text-slate-300 mt-2 line-clamp-3">
              {item.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <SectionHeader
        title="Global Search"
        subtitle="Search memories, documents, and task notes indexed from workspace."
      />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search anything..."
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
      />
      {!results && (
        <p className="text-xs text-slate-500 mt-2">Type to search.</p>
      )}
      {results && (
        <div className="mt-4">
          {renderSection("Memories", results.memories)}
          {renderSection("Documents", results.documents)}
          {renderSection("Task Notes", results.taskNotes)}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Mission Control
        </p>
        <h1 className="text-3xl font-bold text-white mt-2">
          Activity + Schedule + Search
        </h1>
        <p className="text-sm text-slate-400 mt-2 max-w-2xl">
          Central dashboard for every action, scheduled task, and searchable
          workspace knowledge.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ActivityFeed />
        <WeeklyCalendar />
      </div>

      <div className="mt-6">
        <GlobalSearch />
      </div>
    </main>
  );
}
