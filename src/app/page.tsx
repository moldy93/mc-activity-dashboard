"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import RecentLogs from "../components/RecentLogs";
import { marked } from "marked";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
});
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "short",
});

const resetDateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
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

const formatResetCountdown = (resetAt?: number) => {
  if (!resetAt) return null;
  const diffMs = Math.max(0, resetAt - Date.now());
  const totalMinutes = Math.ceil(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  if (days > 0) return `${days} days, ${hh}:${mm}`;
  return `${hh}:${mm}`;
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

const extractProjectId = (value?: string) => {
  if (!value) return null;
  const match = value.match(/[a-z0-9]+-\d{3}(?:-\d{2})?/i);
  return match ? match[0].toLowerCase() : null;
};

const normalizeRoleKey = (value?: string) => {
  const raw = String(value || "").toLowerCase().replace(/[^a-z/]/g, "");
  if (raw.includes("ui/ux") || raw.includes("uiux")) return "uiux";
  if (raw.includes("review")) return "reviewer";
  if (raw.includes("plan")) return "planner";
  if (raw === "dev" || raw.includes("developer")) return "dev";
  if (raw === "pm" || raw.includes("clientinterface") || raw.includes("product")) return "pm";
  return raw;
};

function ProjectBadge({ value }: { value?: string }) {
  const projectId = extractProjectId(value);
  if (!projectId) return null;
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
      {projectId}
    </span>
  );
}

function ActivityFeed() {
  const activities = useQuery(api.activity.listRecent, { limit: 60 }) ?? [];
  const visible = activities.slice(0, 10);
  return (
    <div id="activity" className="py-4">
      <div className="mt-4">
        {activities.length === 0 && (
          <p className="text-sm text-slate-400">No activity yet.</p>
        )}
        {activities.length > 0 && (
          <div className="border-y border-slate-800">
            <table className="w-full table-fixed text-left text-xs text-slate-300">
              <thead className="bg-slate-950/70 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-28 px-3 py-2">Time</th>
                  <th className="px-3 py-2">Entry</th>
                  <th className="w-24 px-3 py-2">Kind</th>
                  <th className="w-28 px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visible.map((item) => (
                  <tr key={item._id} className="bg-slate-950/40">
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate text-slate-100">
                          {item.title}
                        </span>
                        <ProjectBadge value={item.title} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {item.kind || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {item.source || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
  const [anchor, setAnchor] = useState<Date>(new Date());

  const range = useMemo(() => getWeekRange(anchor), [anchor]);
  const tasks =
    useQuery(api.tasks.listWeek, {
      weekStart: range.monday.getTime(),
      weekEnd: range.sunday.getTime(),
    }) ?? [];

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(range.monday);
      day.setDate(range.monday.getDate() + index);
      return day;
    });
  }, [range]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    tasks.forEach((task) => {
      const key = new Date(task.nextRunAt).toDateString();
      const list = map.get(key) || [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [tasks]);

  const weekdayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

  return (
    <div id="schedule" className="py-4 h-full flex flex-col">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 flex-1">
        {days.map((day) => {
          const key = day.toDateString();
          const entries = tasksByDay.get(key) || [];
          return (
            <div key={key} className="flex flex-col gap-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {weekdayFormatter.format(day)} {dateFormatter.format(day)}
              </div>
              {entries.length === 0 && (
                <div className="text-xs text-slate-600">—</div>
              )}
              {entries.map((task) => (
                <div
                  key={task._id}
                  className="rounded-md border border-slate-800 bg-slate-950/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">
                      {task.title}
                    </span>
                    <ProjectBadge value={task.title} />
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {dateTimeFormatter.format(new Date(task.nextRunAt))}
                  </div>
                  {task.description && (
                    <div className="relative group mt-1">
                      <span className="text-[10px] text-slate-500">Details</span>
                      <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 rounded-md border border-slate-700 bg-slate-900/95 p-3 text-[11px] text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        <div
                          className="prose prose-invert prose-xs max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: marked.parse(task.description || ""),
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 mt-auto">
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
      </div>
    </div>
  );
}

type MarkdownBoardColumn = {
  column: "Inbox" | "Planning" | "Development" | "Review" | "Done";
  items: string[];
};

function MissionControlOverview() {
  const data = useQuery(api.mc.getOverview);
  const dailyCounts = useQuery(api.mc.listCountsDaily) ?? [];
  const [boardColumns, setBoardColumns] = useState<MarkdownBoardColumn[]>([]);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [agentWorkload, setAgentWorkload] = useState<Record<string, Array<{ taskId: string; title: string; status?: string }>>>({});
  const [agentDetails, setAgentDetails] = useState<
    Record<
      string,
      {
        currentTask: string[];
        status: string[];
        nextSteps: string[];
        blockers: string[];
        mrLinks: string[];
        branches: string[];
        updatedAt?: number;
      }
    >
  >({});

  useEffect(() => {
    let mounted = true;

    const loadBoard = async () => {
      try {
        const res = await fetch("/api/mc-board", { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to load board");
        }
        if (mounted) {
          setBoardColumns(Array.isArray(payload.board) ? payload.board : []);
          setBoardError(null);
        }
      } catch (error) {
        if (mounted) {
          setBoardError(error instanceof Error ? error.message : "Failed to load board");
        }
      }
    };

    const loadWorkload = async () => {
      try {
        const res = await fetch("/api/mc-agents-workload", { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) return;
        if (mounted && Array.isArray(payload.workloads)) {
          const map: Record<string, Array<{ taskId: string; title: string; status?: string }>> = {};
          for (const entry of payload.workloads) {
            map[String(entry.role || "").toLowerCase()] = Array.isArray(entry.tasks) ? entry.tasks : [];
          }
          setAgentWorkload(map);
        }
      } catch {
        // keep UI usable even when workload endpoint fails
      }
    };

    const loadAgentDetails = async () => {
      try {
        const res = await fetch("/api/mc-agent-details", { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) return;
        if (mounted && Array.isArray(payload.details)) {
          const map: Record<string, { currentTask: string[]; status: string[]; nextSteps: string[]; blockers: string[]; mrLinks: string[]; branches: string[]; updatedAt?: number }> = {};
          for (const entry of payload.details) {
            map[String(entry.role || "").toLowerCase()] = {
              currentTask: Array.isArray(entry.currentTask) ? entry.currentTask : [],
              status: Array.isArray(entry.status) ? entry.status : [],
              nextSteps: Array.isArray(entry.nextSteps) ? entry.nextSteps : [],
              blockers: Array.isArray(entry.blockers) ? entry.blockers : [],
              mrLinks: Array.isArray(entry.mrLinks) ? entry.mrLinks : [],
              branches: Array.isArray(entry.branches) ? entry.branches : [],
              updatedAt: entry.updatedAt,
            };
          }
          setAgentDetails(map);
        }
      } catch {
        // keep UI usable even when details endpoint fails
      }
    };

    loadBoard();
    loadWorkload();
    loadAgentDetails();
    const interval = setInterval(() => {
      loadBoard();
      loadWorkload();
      loadAgentDetails();
    }, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const activeRolesByTask = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const roleLabel = (key: string) => {
      if (key === "dev") return "Developer";
      if (key === "pm") return "PM";
      if (key === "planner") return "Planner";
      if (key === "reviewer") return "Reviewer";
      if (key === "uiux") return "UI/UX";
      return key;
    };

    const isPassiveNext = (line: string) => {
      const s = line.toLowerCase();
      return s.includes("await new task") || s.includes("await new assignment") || s.includes("await new work");
    };

    const isRoleActive = (roleKey: string) => {
      const details = agentDetails[roleKey];
      if (!details) return true;
      const hasRealCurrentTask = details.currentTask.some((t) => {
        const s = String(t || "").toLowerCase();
        return s && !s.includes("none") && !s.includes("(none)");
      });
      const hasActionableNext = details.nextSteps.some((n) => n && !isPassiveNext(n));
      const hasBlocker = details.blockers.length > 0;
      return hasRealCurrentTask || hasActionableNext || hasBlocker;
    };

    Object.entries(agentWorkload).forEach(([roleKey, tasks]) => {
      if (!isRoleActive(roleKey)) return;
      tasks.forEach((task) => {
        const id = String(task.taskId || "").toLowerCase();
        if (!id) return;
        if (!map.has(id)) map.set(id, new Set());
        map.get(id)!.add(roleLabel(roleKey));
      });
    });

    return map;
  }, [agentWorkload, agentDetails]);

  if (!data) {
    return (
      <div id="mission-control" className="py-4">
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {boardColumns.map((col) => (
            <div key={col.column} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-slate-400">{col.column}</span>
                <span className="text-xs text-slate-500">{col.items.length}</span>
              </div>
              <ul className="mt-2 space-y-2 text-xs text-slate-300">
                {col.items.length === 0 && <li className="text-slate-600">—</li>}
                {col.items.map((item) => (
                  <li key={item} className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
                    <div className="flex items-center gap-2">
                      <ProjectBadge value={item} />
                    </div>
                    <div className="mt-1 text-xs text-slate-200">{item.replace(/^\S+\s+—\s+/, "")}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {boardError && <p className="mt-4 text-sm text-rose-300">Board load error: {boardError}</p>}
      </div>
    );
  }

  const statusByTask = new Map(data.status.map((s) => [s.taskId, s]));
  const taskById = new Map(data.tasks.map((t) => [t.taskId, t]));

  const latestSnapshot = dailyCounts[dailyCounts.length - 1];
  const trendWindow = dailyCounts.slice(-30);
  const lastUpdated = latestSnapshot ? new Date(latestSnapshot.updatedAt) : null;
  const formatTime = (date: Date) =>
    date.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  const renderSparkline = (values: number[]) => {
    if (values.length < 2) return null;
    const width = 80;
    const height = 24;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    });
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-20 text-slate-400">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={points.join(" ")}
        />
      </svg>
    );
  };

  const typeCards = latestSnapshot
    ? (
        [
          { key: "documents", label: "Documents", desc: "Docs & notes" },
          { key: "memories", label: "Memories", desc: "Memory logs" },
          { key: "taskNotes", label: "Task Notes", desc: "Mission docs" },
          { key: "activities", label: "Activities", desc: "Event feed" },
          { key: "scheduledTasks", label: "Scheduled", desc: "Cron tasks" },
          { key: "mcAgents", label: "Agents", desc: "Roles" },
          { key: "mcTasks", label: "Tasks", desc: "Mission tasks" },
          { key: "mcStatus", label: "Status", desc: "Progress" },
          { key: "mcBoardColumns", label: "Board", desc: "Pipeline cols" },
        ] as const
      ).map((item) => {
        const values = trendWindow.map((entry) => entry.counts[item.key]);
        return {
          ...item,
          value: latestSnapshot.counts[item.key],
          sparkline: renderSparkline(values),
          trendLabel: trendWindow.length > 1 ? "Last 30 days" : "No trend yet",
        };
      })
    : [];

  return (
    <div id="mission-control" className="py-4">

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mt-2">
            <div className="grid grid-cols-1 gap-3">
              {data.agents.map((agent) => {
                const roleKey = normalizeRoleKey(agent.role);
                const tasks = agentWorkload[roleKey] || [];
                const details = agentDetails[roleKey];
                const isTimestampMeta = (line: string) => /^\(\d{4}-\d{2}-\d{2}[^)]*\)$/.test(String(line || "").trim());
                const filteredStatus = (details?.status || []).filter((line) => !isTimestampMeta(line));
                const filteredNextSteps = (details?.nextSteps || []).filter((line) => {
                  const s = String(line || "").toLowerCase();
                  return !(s.includes("await new task") || s.includes("await new assignment") || s.includes("await new work"));
                });
                return (
                  <div key={agent._id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm text-slate-100 font-semibold"
                        title={agent.mission || "No role description"}
                      >
                        {agent.role}
                      </span>
                      <span className="text-xs text-slate-500">{relativeDate(details?.updatedAt || agent.updatedAt)}</span>
                    </div>

                    <div className="mt-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Current tasks</p>
                      {tasks.length === 0 ? (
                        <p className="mt-1 text-xs text-slate-600">—</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {tasks.map((task) => (
                            <li key={`${task.taskId}-${task.title}`} className="text-xs text-slate-200">
                              <span className="text-slate-400">{task.taskId}</span>
                              <span className="text-slate-500"> — </span>
                              {task.title.replace(/^\S+\s+—\s+/, "")}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {details && (
                      <div className="mt-3 space-y-2 text-xs">
                        {filteredStatus.length > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-slate-500">Now</p>
                            <ul className="mt-1 space-y-1 text-slate-300">
                              {filteredStatus.slice(0, 2).map((line, idx) => (
                                <li key={idx}>• {line}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {filteredNextSteps.length > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-slate-500">Next</p>
                            <ul className="mt-1 space-y-1 text-slate-300">
                              {filteredNextSteps.slice(0, 2).map((line, idx) => (
                                <li key={idx}>• {line}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {details.blockers.length > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-rose-300">Blockers</p>
                            <ul className="mt-1 space-y-1 text-rose-200">
                              {details.blockers.slice(0, 2).map((line, idx) => (
                                <li key={idx}>• {line}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {(details.branches.length > 0 || details.mrLinks.length > 0) && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {details.branches.slice(0, 2).map((b) => (
                              <span key={b} className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">{b}</span>
                            ))}
                            {details.mrLinks.slice(0, 2).map((url) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300 hover:underline">
                                MR
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {boardColumns.map((col) => (
              <div key={col.column} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">{col.column}</span>
                  <span className="text-xs text-slate-500">{col.items.length}</span>
                </div>
                <ul className="mt-2 space-y-2 text-xs text-slate-300">
                  {col.items.length === 0 && <li className="text-slate-600">—</li>}
                  {col.items.map((item) => {
                    const taskId = extractProjectId(item) || "";
                    const activeRoles = taskId ? Array.from(activeRolesByTask.get(taskId) || []) : [];
                    return (
                      <li key={item} className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
                        <div className="flex items-center gap-2">
                          <ProjectBadge value={item} />
                        </div>
                        <div className="mt-1 text-xs text-slate-200">{item.replace(/^\S+\s+—\s+/, "")}</div>
                        {activeRoles.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {activeRoles.map((role) => (
                              <span key={`${item}-${role}`} className="rounded border border-sky-800 bg-sky-950/40 px-2 py-0.5 text-[10px] text-sky-300">
                                {role}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-200">PM Insights</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.status
            .filter((status) => {
              const task = taskById.get(status.taskId);
              if (!task) return false;
              const progress = (status.inProgress || "").toLowerCase();
              return !progress.includes("done") && !progress.includes("complete");
            })
            .map((status) => {
              const task = taskById.get(status.taskId);
              return (
                <div key={status._id} className="border-b border-slate-800 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-100 font-semibold">
                        {task?.title || status.taskId}
                      </span>
                      <ProjectBadge value={task?.title || status.taskId} />
                    </div>
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


type UsageWindow = { label: string; usedPercent: number; resetAt?: number };

function UsageBar({ label, percent, resetAt }: { label: string; percent?: number; resetAt?: number }) {
  const clamped = Math.max(0, Math.min(100, Number(percent || 0)));
  const remaining = 100 - clamped;
  const resetIn = formatResetCountdown(resetAt);
  const resetAtLabel = resetAt ? resetDateTimeFormatter.format(new Date(resetAt)) : null;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-[10px] text-slate-400">
      <span>{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-sky-500" style={{ width: `${clamped}%` }} />
      </div>
      <span>{remaining}% left</span>
      {resetIn ? (
        <span className="text-slate-500" title={resetAtLabel ? `Resets at: ${resetAtLabel} (Europe/Berlin)` : undefined}>
          (resets in {resetIn} hours)
        </span>
      ) : null}
    </div>
  );
}

function CodexUsageFooter() {
  const [windows, setWindows] = useState<UsageWindow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch("/api/openclaw/usage", { cache: "no-store" });
        const payload = await res.json();
        if (!mounted) return;
        if (!res.ok) {
          setLoadError(String(payload?.error || "Usage unavailable"));
          return;
        }
        const next = Array.isArray(payload?.provider?.windows) ? payload.provider.windows : [];
        setWindows(next);
        setLoadError(null);
      } catch {
        if (mounted) setLoadError("Usage unavailable");
      }
    };

    load();
    const interval = setInterval(load, 300000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const fiveHour = windows.find((w) => /^5h$/i.test(String(w.label || "")));
  const day = windows.find((w) => /^day$/i.test(String(w.label || "")));
  const weekly = windows.find((w) => /week|7d/i.test(String(w.label || "")));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-slate-500">Codex usage</span>
        {fiveHour && <UsageBar label="5h" percent={fiveHour.usedPercent} resetAt={fiveHour.resetAt} />}
        {day && <UsageBar label="Week" percent={day.usedPercent} resetAt={day.resetAt} />}
        {weekly && <UsageBar label="Week" percent={weekly.usedPercent} resetAt={weekly.resetAt} />}
        {!fiveHour && !day && !weekly && (
          <span className="text-[11px] text-slate-500">
            {loadError ? `currently unavailable (${loadError})` : "loading..."}
          </span>
        )}
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState("");
  const trimmed = term.trim();
  const results = useQuery(
    api.search.global,
    trimmed ? { term: trimmed, limit: 10 } : "skip"
  );

  const renderSection = (
    label: string,
    items: { _id: string; title: string; path: string; content: string }[]
  ) => (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-200">{label}</h3>
      {items.length === 0 && (
        <p className="text-xs text-slate-500 mt-1">No matches.</p>
      )}
      <div className="mt-2">
        {items.map((item) => (
          <div key={item._id} className="border-b border-slate-800 py-3">
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
    <div id="search" className="py-4">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search anything..."
        className="w-full border-b border-slate-800 bg-transparent px-0 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
      />
      {trimmed && results && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur"
            onClick={() => setTerm("")}
          />
          <div className="absolute inset-0 flex items-start justify-center px-4 py-12">
            <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-slate-800 bg-slate-950/90">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Search results
                </div>
                <button
                  className="text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setTerm("")}
                >
                  Close
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
                {renderSection("Memories", results.memories)}
                {renderSection("Documents", results.documents)}
                {renderSection("Task Notes", results.taskNotes)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <main className="min-h-screen px-6 py-8 pb-24">
      <GlobalSearch />

      <div className="pt-6">
        <MissionControlOverview />
      </div>

      <div className="pt-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="h-full">
            <WeeklyCalendar />
          </div>
          <div className="h-full">
            <RecentLogs />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 px-6 py-2 backdrop-blur">
        <CodexUsageFooter />
      </div>
    </main>
    </>
  );
}
