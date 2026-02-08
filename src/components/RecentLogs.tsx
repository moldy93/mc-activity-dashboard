"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LOG_POLL_MS = 4000;
const LOG_MAX_LINES = 400;

const formatLogTime = (value?: string) => {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour12: false,
  });
};

const levelColor = (level: string) => {
  const key = level.toLowerCase();
  if (key.includes("error") || key.includes("fatal")) return "text-rose-300";
  if (key.includes("warn")) return "text-amber-200";
  if (key.includes("debug") || key.includes("trace")) return "text-violet-200";
  if (key.includes("info")) return "text-emerald-200";
  return "text-slate-300";
};

type LogEntry = {
  raw: string;
  time?: string;
  level: string;
  subsystem?: string;
  message: string;
};

type LogPart = { text: string; className: string };

const parseLogLine = (line: string): LogEntry => {
  const trimmed = line.trim();
  if (!trimmed) {
    return { raw: line, level: "info", message: "" };
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const time = parsed.time || parsed.ts || parsed.timestamp || parsed._meta?.date;
      const level = (
        parsed.level ||
        parsed.sev ||
        parsed.severity ||
        parsed._meta?.logLevelName ||
        "info"
      ).toString();
      const rawMsg =
        parsed.msg ||
        parsed.message ||
        parsed.event ||
        parsed.data ||
        parsed["2"] ||
        parsed["1"] ||
        parsed["0"] ||
        "";

      let message = "";
      if (typeof rawMsg === "string") {
        message = rawMsg;
      } else if (rawMsg && typeof rawMsg === "object") {
        message = JSON.stringify(rawMsg);
      }

      let subsystem = parsed.subsystem || parsed.source || parsed._meta?.name || parsed["0"];
      if (typeof subsystem === "string" && subsystem.startsWith("{")) {
        try {
          const parsedSub = JSON.parse(subsystem);
          subsystem = parsedSub.subsystem || parsedSub.source || subsystem;
        } catch {
          // ignore
        }
      }

      return {
        raw: line,
        time: time ? formatLogTime(time) : "",
        level,
        subsystem: subsystem ? String(subsystem) : undefined,
        message: message || "(no message)",
      };
    } catch {
      // fallthrough
    }
  }

  const bracketMatch = trimmed.match(/^(\w+)\s+\[([^\]]+)\]\s+(\w+)\s*(.*)$/);
  if (bracketMatch) {
    const [, firstLevel, time, level, msg] = bracketMatch;
    return {
      raw: line,
      time: formatLogTime(time),
      level: level || firstLevel,
      message: msg || trimmed,
    };
  }

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}[^\s]*)\s+(\w+)\s+(.*)$/);
  if (match) {
    const [, time, level, msg] = match;
    return {
      raw: line,
      time: formatLogTime(time),
      level,
      message: msg,
    };
  }

  return { raw: line, level: "info", message: trimmed };
};

const formatLogParts = (entry: LogEntry): LogPart[] => {
  const parts: LogPart[] = [];
  if (entry.time) parts.push({ text: entry.time, className: "text-sky-200" });
  parts.push({
    text: entry.level.toUpperCase().padEnd(5, " "),
    className: levelColor(entry.level),
  });
  if (entry.subsystem) {
    parts.push({ text: entry.subsystem.padEnd(12, " "), className: "text-purple-200" });
  }
  parts.push({ text: entry.message, className: "text-slate-100" });
  return parts;
};

const unique = (items: string[]) => Array.from(new Set(items)).sort();

export default function RecentLogs({
  title = "Recent Logs",
  subtitle = "OpenClaw gateway log tail.",
}: {
  title?: string;
  subtitle?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sinceRef = useRef<number | null>(null);
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [subsystemFilter, setSubsystemFilter] = useState("");

  useEffect(() => {
    let active = true;

    const fetchLogs = async () => {
      try {
        const query = sinceRef.current ? `?sinceMs=${sinceRef.current}` : "";
        const res = await fetch(`/api/openclaw/logs${query}`);
        if (!res.ok) throw new Error("Log fetch failed");
        const data = await res.json();
        if (!active) return;

        if (data.lastTimeMs) {
          sinceRef.current = data.lastTimeMs + 1;
        }
        const nextLines = data.lines || [];
        if (nextLines.length > 0) {
          setLines((prev) => [...prev, ...nextLines].slice(-LOG_MAX_LINES));
        }
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Log fetch failed");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, LOG_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const entries = useMemo(() => lines.map(parseLogLine), [lines]);
  const availableLevels = useMemo(
    () => unique(entries.map((entry) => entry.level.toUpperCase())),
    [entries]
  );
  const availableSubsystems = useMemo(
    () => unique(entries.map((entry) => entry.subsystem).filter(Boolean) as string[]),
    [entries]
  );

  const activeLevels = levelFilter.length ? levelFilter : availableLevels;
  const filteredEntries = useMemo(() => {
    const subsystemQuery = subsystemFilter.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesLevel = activeLevels.includes(entry.level.toUpperCase());
      const matchesSubsystem = subsystemQuery
        ? (entry.subsystem || "").toLowerCase().includes(subsystemQuery)
        : true;
      return matchesLevel && matchesSubsystem;
    });
  }, [entries, activeLevels, subsystemFilter]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [filteredEntries]);

  const toggleLevel = (level: string) => {
    setLevelFilter((prev) =>
      prev.includes(level) ? prev.filter((item) => item !== level) : [...prev, level]
    );
  };

  return (
    <div id="logs" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        {availableLevels.map((level) => (
          <button
            key={level}
            className={`rounded-full border px-3 py-1 ${
              levelFilter.length === 0 || levelFilter.includes(level)
                ? "border-slate-500 bg-slate-800 text-slate-100"
                : "border-slate-700 bg-slate-900 text-slate-400"
            }`}
            onClick={() => toggleLevel(level)}
          >
            {level}
          </button>
        ))}
        <input
          value={subsystemFilter}
          onChange={(event) => setSubsystemFilter(event.target.value)}
          placeholder={
            availableSubsystems.length
              ? `Subsystem (e.g. ${availableSubsystems[0]})`
              : "Subsystem filter"
          }
          className="ml-auto min-w-[180px] rounded-md border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
        />
      </div>

      <div
        ref={containerRef}
        className="mt-3 max-h-64 overflow-y-auto overflow-x-auto rounded-md border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200"
      >
        {loading && <div className="text-slate-500">Loading logs…</div>}
        {!loading && error && (
          <div className="text-rose-300">{error}</div>
        )}
        {!loading && !error && filteredEntries.length === 0 && (
          <div className="text-slate-500">No log output.</div>
        )}
        {filteredEntries.map((entry, idx) => {
          const parts = formatLogParts(entry);
          return (
            <div key={`${idx}-${entry.raw}`} className="whitespace-pre">
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
