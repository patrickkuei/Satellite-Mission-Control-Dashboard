# orbit.ctrl — Claude Code Guide

Satellite mission control dashboard. Portfolio piece targeting space-industry roles.

## Source-of-truth docs

Read before non-trivial decisions. These are the spec — surface conflicts, don't silently override.

- `docs/PROJECT_BRIEF.md` — Goals, audience, success metrics
- `docs/ARCHITECTURE.md` — 4-layer system design, tool registry, data flow
- `docs/TECH_DECISIONS.md` — Stack choices + rationale (locked)
- `docs/IMPLEMENTATION_PLAN.md` — Phase-by-phase roadmap (Phase 0–6)
- `docs/UI_DESIGN_SPEC.md` — Visual tokens, layout, components

## Status

Pre-code: docs only. Next is Phase 0 (monorepo scaffolding).

## Planned structure

```
orbit-ctrl/
├── apps/{web,api}/       # Vite+React frontend, Fastify backend
└── packages/{types,tools,mcp-server}/
```

## Locked tech (don't substitute without asking)

- **pnpm workspaces**, TypeScript strict everywhere, no `any`
- **Frontend:** React 18 + Vite + globe.gl + TanStack Query + Zustand + Recharts + CSS Modules
- **Backend:** Fastify + `@fastify/websocket` + `satellite.js`
- **AI:** `@anthropic-ai/sdk` — use latest Sonnet 4.x (`claude-sonnet-4-6`); docs reference an older snapshot
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport
- **Data:** Celestrak (TLE, JSON-file cache, 24h), NOAA SWPC (in-memory, 15-min poll)
- **Deploy:** Vercel (web), Fly.io (api — needs WS)

## Conventions

- Shared types in `packages/types`. Tool registry in `packages/tools` — frontend agent and MCP server both consume it; add a tool once, never duplicate.
- WebSocket for telemetry/alerts, REST for queries. Don't poll telemetry.
- Design tokens via CSS variables, not CSS-in-JS. Three font families with assigned roles (Playfair serif / Inter sans / JetBrains Mono).
- Accent color is amber `#ff6b35`. Reserve red for alerts only.
- No auth, no aggressive rate limiting — this is a demo. Production hardening is explicit non-goal.

## Documentation (JSDoc + examples)

**This project overrides Claude Code's default "minimal comments" stance.** AI-driven development benefits from rich inline docs — every cold-started session reads them as context.

Required JSDoc on:

- All exported functions, classes, types, and constants
- Every tool registry entry (`description` is read at runtime by the agent — write it for an LLM, not a human)
- All Fastify route handlers (summarize request/response in JSDoc, not just schema)
- React component props interfaces

JSDoc must include:

- One-line summary (what + why, not just what)
- `@param` for each argument with units where applicable (`@param altKm - altitude in kilometers`)
- `@returns` with shape description
- `@example` block for non-trivial APIs — at least one realistic call with expected output
- `@throws` for documented error paths

Inline comments: explain WHY for non-obvious logic (orbital math, anomaly thresholds, eclipse calculations especially). Don't narrate trivially obvious code, but err on the side of more context for math-heavy or domain-specific sections.

## Logging

- Backend: use Fastify's built-in `pino` logger (`request.log.info(...)`), not `console.log`. Pino is structured JSON, queryable in Fly.io logs.
- Frontend: `console.warn`/`console.error` for genuine problems only. Strip stray `console.log` before commit — ESLint `no-console` (allow `warn`/`error`) enforces this.

## Testing & linting

- **Test runner:** Jest + ts-jest, target 80% coverage. Co-locate `*.test.ts` with source.
- **Lint:** ESLint + Prettier, shared root config, husky + lint-staged pre-commit.
- **Before claiming a task done:** run `pnpm test` for touched packages, `pnpm lint`, and `pnpm -r build` if types are involved. For UI changes, also start the dev server and verify in browser — type-check passing is not feature-correctness.

## Out of scope (push back if asked)

User accounts, historical playback, satellite control, mobile app, multi-language, full WCAG AA. Phase 2+ only.

## Environment

Windows + PowerShell 5.1. Use `$env:VAR`, `;` for chaining (no `&&`), backtick for line continuation. `pnpm` and `node` are available; the Bash tool also works for POSIX commands when needed.
