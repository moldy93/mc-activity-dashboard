# Mission Control Activity Dashboard

A Mission Control dashboard with:
- **Activity Feed** (records every action)
- **Weekly Calendar** (future scheduled tasks)
- **Global Search** (memories, docs, tasks from workspace)

Tech: **Next.js + Convex**, Dockerized with **docker compose**.

## Quick start

```bash
cp .env.example .env
# set NEXT_PUBLIC_CONVEX_URL + CONVEX_ADMIN_KEY

npm install
npx convex dev
npm run dev
```

Docker:
```bash
docker compose up --build
```
Access: `http://localhost:3001`

## Convex
- `convex/activity.ts` — log + list
- `convex/tasks.ts` — weekly schedule
- `convex/search.ts` — global search
- `convex/ingest.ts` — ingest docs/memories/tasks

## Index workspace
```bash
CONVEX_URL=<your convex url> CONVEX_ADMIN_KEY=<key> \
  npm run index:workspace
```

This indexes `.md/.txt/.log` files from `WORKSPACE_ROOT` (default: `/Users/m/.openclaw/workspace`).

## Activity ingestion
POST to `/api/activity`:
```bash
curl -X POST http://localhost:3000/api/activity \
  -H "Content-Type: application/json" \
  -d '{"title":"Task completed","detail":"Notes...","kind":"task","source":"openclaw"}'
```

## Notes
- Convex auth is required to run `convex dev`.
- The UI assumes Convex is running and `NEXT_PUBLIC_CONVEX_URL` is set.


## Activity runner

`mc-activity-dashboard/scripts/mcActivityRunner.ts` watches `mission-control/board.md` and writes orchestration state to:
`memory/mc/activity-runner-state.json`.

Defaults: interval 10s, timeout 300s, dropped/recover fallback 300s.

Overrides:
- `MC_ACTIVITY_RUN_INTERVAL_MS` (default `10000`)
- `MC_ACTIVITY_RUN_TIMEOUT_MS` (default `300000`)
- `MC_ACTIVITY_RUN_FALLBACK_MS` (default `300000`)

Run it manually with:

```bash
npm run run:mc-runner
```

In docker-compose the dedicated `mc-runner` service runs it continuously.


## Privacy / data placement

- Role files for `planner/dev/pm/reviewer/uiux` are treated as **generic templates** and can live in the repository/dashboard package.
- Any potentially personal/project-specific context (especially `WORKING.md` briefings and run state) must stay outside public repo scope, e.g. under user workspace: `memory/mc/<role>/WORKING.md`.
- The runner does **not** write `WORKING.md`; it only checks their presence and reports missing files, so private context is not published by this flow.
