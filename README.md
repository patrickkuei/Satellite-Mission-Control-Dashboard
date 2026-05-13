# orbit.ctrl

Satellite mission control dashboard — real-time tracking, telemetry simulation, AI agent integration via Claude API and MCP.

> Portfolio piece. See [`docs/`](./docs) for full spec.

## Quick start

```powershell
corepack enable          # one-time
pnpm install
pnpm dev                 # web on :5173, api on :3001
```

## Workspace

```
apps/
  web/          Vite + React + TS frontend
  api/          Fastify + TS backend (WebSocket + REST)
packages/
  types/        Shared TS types
  tools/        Tool registry (consumed by agent + MCP)
  mcp-server/   MCP stdio server
```

## Docs

- [`docs/PROJECT_BRIEF.md`](./docs/PROJECT_BRIEF.md) — goals + success metrics
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design
- [`docs/TECH_DECISIONS.md`](./docs/TECH_DECISIONS.md) — stack rationale
- [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — 6-week phases
- [`docs/UI_DESIGN_SPEC.md`](./docs/UI_DESIGN_SPEC.md) — design tokens + layout
- [`CLAUDE.md`](./CLAUDE.md) — conventions for AI-assisted development
