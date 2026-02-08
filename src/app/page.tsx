"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
});
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "short",
});

const relativeDate = (ms?: number) => {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
      {label}
    </span>
  );
}

function ActivityFeed() {
  const activities = useQuery(api.activity.listRecent, { limit: 60 }) ?? [];
  return (
    <div id="activity" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Activity Feed"
          subtitle="Every action recorded. Ingest via /api/activity or Convex mutation."
        />
        <Pill label={`${activities.length} events`} />
      </div>
      <div className="space-y-3">
        {activities.length === 0 && (
          <p className="text-sm text-slate-400">No activity yet.</p>
        )}
        {activities.map((item) => (
          <div
            key={item._id}
            className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
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
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
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
  const [anchor, setAnchor] = useState<Date | null>(null);
  useEffect(() => {
    setAnchor(new Date());
  }, []);

  const range = useMemo(() => (anchor ? getWeekRange(anchor) : null), [anchor]);
  const tasks =
    useQuery(
      api.tasks.listWeek,
      range
        ? {
            weekStart: range.monday.getTime(),
            weekEnd: range.sunday.getTime(),
          }
        : "skip"
    ) ?? [];

  return (
    <div id="schedule" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Weekly Schedule"
          subtitle="Upcoming scheduled tasks (from Convex)."
        />
        <Pill label={`${tasks.length} tasks`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
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
        <span className="text-sm text-slate-400 ml-2" suppressHydrationWarning>
          {range
            ? `${dateFormatter.format(range.monday)} – ${dateFormatter.format(
                range.sunday
              )}`
            : "Loading…"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {tasks.length === 0 && (
          <p className="text-sm text-slate-400">No tasks scheduled this week.</p>
        )}
        {tasks.map((task) => (
          <div
            key={task._id}
            className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                {task.title}
              </h3>
              <span className="text-xs text-slate-500">
                {dateTimeFormatter.format(new Date(task.nextRunAt))}
              </span>
            </div>
            {task.description && (
              <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">
                {task.description}
              </p>
            )}
            <div className="mt-3 text-xs text-slate-500">
              {task.scheduleType.toUpperCase()}: {task.schedule}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionControlOverview() {
  const data = useQuery(api.mc.getOverview);
  if (!data) {
    return (
      <div id="mission-control" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <SectionHeader title="Mission Control" subtitle="Agents, pipeline, and PM insights." />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  const statusByTask = new Map(data.status.map((s) => [s.taskId, s]));
  const taskById = new Map(data.tasks.map((t) => [t.taskId, t]));

  return (
    <div id="mission-control" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <SectionHeader title="Mission Control" subtitle="Agents, pipeline, and PM insights." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Agents</h3>
          <div className="mt-2 space-y-2">
            {data.agents.map((agent) => (
              <div key={agent._id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-100 font-semibold">{agent.role}</span>
                  <span className="text-xs text-slate-500">{relativeDate(agent.updatedAt)}</span>
                </div>
                {agent.mission && (
                  <p className="text-xs text-slate-300 mt-2 line-clamp-2">{agent.mission}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-200">Pipeline</h3>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.board.map((col) => (
              <div key={col._id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-slate-400">{col.column}</span>
                  <span className="text-xs text-slate-500">{col.items.length}</span>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {col.items.length === 0 && <li className="text-slate-500">—</li>}
                  {col.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-200">PM Insights</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.status.map((status) => {
            const task = taskById.get(status.taskId);
            return (
              <div key={status._id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-100 font-semibold">
                    {task?.title || status.taskId}
                  </span>
                  <span className="text-xs text-slate-500">{relativeDate(status.updatedAt)}</span>
                </div>
                {status.inProgress && (
                  <p className="text-xs text-slate-300 mt-2">
                    <span className="text-slate-400">In Progress:</span> {status.inProgress}
                  </p>
                )}
                {status.next && (
                  <p className="text-xs text-slate-300 mt-1">
                    <span className="text-slate-400">Next:</span> {status.next}
                  </p>
                )}
                {status.needFromYou && (
                  <p className="text-xs text-amber-300 mt-1">
                    <span className="text-amber-200">Need from you:</span> {status.needFromYou}
                  </p>
                )}
                {status.risks && (
                  <p className="text-xs text-rose-300 mt-1">
                    <span className="text-rose-200">Risks:</span> {status.risks}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatLogLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return [{ text: line, className: "text-slate-400" }];

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const time = parsed.time || parsed.ts || parsed.timestamp;
      const level = (parsed.level || parsed.sev || parsed.severity || "info").toString();
      const msg = parsed.msg || parsed.message || parsed.event || parsed.data || "";
      return [
        time ? { text: `[${time}]`, className: "text-sky-200" } : null,
        { text: level.toUpperCase().padEnd(5, " "), className: levelColor(level) },
        { text: msg.toString(), className: "text-slate-100" },
      ].filter(Boolean) as { text: string; className: string }[];
    } catch {
      // fallthrough
    }
  }

  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}[^\s]*)\s+(\w+)\s+(.*)$/
  );
  if (match) {
    const [, time, level, msg] = match;
    return [
      { text: `[${time}]`, className: "text-sky-200" },
      { text: level.toUpperCase().padEnd(5, " "), className: levelColor(level) },
      { text: msg, className: "text-slate-100" },
    ];
  }

  return [{ text: line, className: "text-slate-100" }];
}

function levelColor(level: string) {
  const key = level.toLowerCase();
  if (key.includes("error") || key.includes("fatal")) return "text-rose-300";
  if (key.includes("warn")) return "text-amber-200";
  if (key.includes("debug") || key.includes("trace")) return "text-violet-200";
  if (key.includes("info")) return "text-emerald-200";
  return "text-slate-300";
}

function RecentLogs() {
  const [lines, setLines] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/openclaw/logs`);
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          setLines(data.lines || []);
        }
      } catch {
        // ignore
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [lines]);

  return (
    <div id="logs" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <SectionHeader title="Recent Logs" subtitle="OpenClaw gateway log tail." />
      <div
        ref={containerRef}
        className="mt-3 max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200"
      >
        {lines.length === 0 && <div className="text-slate-500">No log output.</div>}
        {lines.map((line, idx) => {
          const parts = formatLogLine(line);
          return (
            <div key={`${idx}-${line}`} className="whitespace-pre-wrap">
              {parts.map((part, partIdx) => (
                <span key={partIdx} className={part.className}>
                  {partIdx > 0 ? " " : ""}
                  {part.text}
                </span>
              ))}
            </div>
          );
        })}
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
    <div id="search" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
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
    <main className="min-h-screen px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Mission Control
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mt-2">
              Activity + Schedule + Search
            </h1>
            <p className="text-sm text-slate-400 mt-2 max-w-2xl">
              Central dashboard for every action, scheduled task, and searchable
              workspace knowledge.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="#activity"
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Activity
            </a>
            <a
              href="#schedule"
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Schedule
            </a>
            <a
              href="#mission-control"
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Mission Control
            </a>
            <a
              href="#logs"
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Logs
            </a>
            <a
              href="#search"
              className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Search
            </a>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ActivityFeed />
        <WeeklyCalendar />
      </div>

      <div className="mt-6">
        <MissionControlOverview />
      </div>

      <div className="mt-6">
        <GlobalSearch />
      </div>

      <div className="mt-6">
        <RecentLogs />
      </div>
    </main>
  );
}
