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
Access: `http://192.168.3.116:3001`

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
