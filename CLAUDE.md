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
- **AI host:** in-house orchestrator behind a normalized `LLMProvider` interface. **Primary provider: Google Gemini** (`@google/genai`, free tier for demo). Anthropic (`@anthropic-ai/sdk`, latest Sonnet 4.x `claude-sonnet-4-6`) is a second adapter, swappable at config time. **No LangChain** — direct SDKs only; portfolio goal is protocol-level fluency.
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport. Project is an MCP **server** (exposes tools to Claude Desktop / Cursor) and the in-process agent is an MCP **host** (consumes the same tool registry via a `ToolBroker`).
- **Data:** Celestrak (TLE, JSON-file cache, 24h), NOAA SWPC (in-memory, 15-min poll)
- **Deploy:** Vercel (web), Fly.io (api — needs WS)

## Conventions

- Shared types in `packages/types`. Tool registry in `packages/tools` — frontend agent and MCP server both consume it; add a tool once, never duplicate.
- WebSocket for telemetry/alerts, REST for queries. Don't poll telemetry.
- Design tokens via CSS variables, not CSS-in-JS. Three font families with assigned roles (Playfair serif / Inter sans / JetBrains Mono).
- Accent color is amber `#ff6b35`. Reserve red for alerts only.
- No auth, no aggressive rate limiting — this is a demo. Production hardening is explicit non-goal.

## Backend architecture (apps/api)

Strict 5-layer separation. Each layer has one responsibility; layers only call **downward**. Never skip layers (e.g., a route handler must not touch a repository directly).

```
src/
├── routes/         # Router      — Fastify plugin per resource. URL → controller binding + schema only.
├── controllers/    # Controller  — HTTP adapter. Parse req, validate, call service, format reply. No business logic.
├── services/       # Service     — Business logic. Orchestrates clients + repositories. HTTP-agnostic (testable in isolation).
├── clients/        # Client      — Outbound HTTP/SDK wrappers (Celestrak, NOAA, Gemini, Anthropic). Pure I/O, no caching, no transformation logic. LLM clients implement the shared `LLMProvider` interface — provider-specific request/response shapes are normalized here and never leak past this layer.
├── repositories/   # Repository  — Persistence: TLE JSON cache, in-memory weather cache, telemetry history. Hides storage details.
└── server.ts       # Composition root — wires plugins + registers route modules.
```

**Allowed dependency direction:** route → controller → service → (client | repository). Services may depend on multiple clients/repos; controllers must depend on exactly one service. Cross-layer types live in `packages/types`.

**Naming:** `<resource>.route.ts`, `<resource>.controller.ts`, `<resource>.service.ts`, `<source>.client.ts`, `<resource>.repository.ts` — one file per logical resource.

**Testing:** services and repositories are unit-tested directly (no Fastify). Controllers get integration tests via `server.inject(...)`.

## Frontend architecture (apps/web)

**Hook-driven.** Components are thin presentational consumers; all state, effects, data fetching, and side effects live in custom hooks under `src/hooks/`.

```
src/
├── hooks/          # All stateful logic — useSatellites, useTelemetryStream, useAgentChat, ...
├── components/     # Presentational React components. Receive data + callbacks via props.
├── api/            # Thin fetch wrappers (one function per endpoint). Hooks call these via TanStack Query.
├── stores/         # Zustand stores for cross-cutting UI state (selected satellite, panel toggles).
├── styles/         # globals.css + design tokens. Per-component styles co-located as `*.module.css`.
└── App.tsx         # Layout composition only.
```

**Hook rules:**

- Prefix `use*`. Named export, one hook per file (`useTelemetryStream.ts`).
- Server state → TanStack Query inside the hook (`useQuery` / `useMutation`).
- UI state → Zustand store, exposed via a hook (`useSelectedSatellite()`).
- WebSocket subscriptions live in hooks (`useTelemetryStream` opens, manages reconnect, returns latest sample).
- Components must not call `fetch`, open WebSockets, or hold non-trivial state directly. If a component grows a `useEffect`, the logic moves into a hook.

**Component rules:**

- Co-locate `Component.tsx` + `Component.module.css`. CSS Modules only (no inline styles, no CSS-in-JS).
- Props interface lives at top of file with full JSDoc.
- Default export the component; named-export the props interface.

## Code principles

Concrete rules that shape day-to-day decisions. Skipped vague platitudes ("write clean code") — the specifics are enforced by TS strict + ESLint + the architecture rules above.

**Single source of truth.** Every domain fact has exactly one home:

- Types → `packages/types`
- Tool definitions → `packages/tools` (consumed by both agent and MCP)
- Design tokens → `apps/web/src/styles/globals.css`
- API version + service name → `apps/api/src/server.ts`

If you find yourself copying a value, stop and extract it. If you find yourself wanting to change "the same thing" in two places, the abstraction is missing.

**DRY, but with the rule of three.** Extract on the _third_ duplication, not the second. Two similar functions are almost always fine; three is a signal that the shape is real. Premature abstraction is harder to undo than duplication — when in doubt, duplicate and wait. Exception: anything in `packages/types` or the tool registry is shared by definition; don't duplicate those even once.

**Backend for Frontend.** `apps/api` is a BFF, not a public API. Its only consumers are `apps/web` and `packages/mcp-server` (which lives in the same repo). This means:

- No versioned routes (`/v1/...`), no deprecation cycles, no public-facing OpenAPI contract.
- Optimize endpoint shape for the frontend — return exactly what the UI needs, even if that means joining data server-side.
- No public auth/quota system. If a future external consumer appears, build a _separate_ public API in front of it — don't widen this one.

**Design for deletion.** Every module should be easy to rip out:

- Prefer small, single-purpose files over large multi-purpose ones.
- No hidden coupling — if module A depends on module B, the import statement says so.
- Don't write code "in case we need it later." Add it when the need is real.
- Feature flags and dead-code branches are forbidden — delete the old path when you ship the new one.
- A 50-line file you delete in 10 seconds beats a 500-line file with a `// TODO: remove if unused` comment.

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
- **Lint:** ESLint + Prettier + `eslint-plugin-sonarjs`, shared root config, husky + lint-staged pre-commit.
- **Cognitive complexity ≤ 15** per function (SonarSource's calibrated default, enforced by `sonarjs/cognitive-complexity`). If a function trips this threshold, **refactor — don't suppress**. The most common fix is extracting nested conditionals into named helper functions; this also tends to make the code easier for the next AI session to reason about. Bumping the threshold is forbidden without an explicit user decision.

## Git hooks (husky)

Three hooks are wired up automatically by `pnpm install` (via the `prepare` script):

- **`pre-commit`** → `lint-staged` runs `eslint --fix` + `prettier --write` on staged `.ts/.tsx` files (other types just get prettier). Fast — only touches what you changed.
- **`commit-msg`** → `commitlint` enforces [Conventional Commits](https://www.conventionalcommits.org/). Format: `type(scope): subject` where type is one of `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`. Header capped at 80 chars.
- **`pre-push`** → `pnpm -r --if-present typecheck`. Slower but a broken `tsc` cannot reach the remote.

**Never use `--no-verify`** to bypass these. If a hook fails, fix the underlying issue. If a hook is genuinely wrong, change the config and commit the change — the user should see what was relaxed.

Commit message examples:

```
feat(api): add /satellites endpoint with TLE caching
fix(web): reconnect WebSocket after 5s on dropped frames
chore(deps): bump satellite.js to 5.0.1
refactor(tools): extract anomaly Z-score into helper
```

- **Before claiming a task done:** run `pnpm test` for touched packages, `pnpm lint`, and `pnpm -r build` if types are involved. For UI changes, also start the dev server and verify in browser — type-check passing is not feature-correctness.

## Out of scope (push back if asked)

User accounts, historical playback, satellite control, mobile app, multi-language, full WCAG AA. Phase 2+ only.

## Environment

Windows + PowerShell 5.1. Use `$env:VAR`, `;` for chaining (no `&&`), backtick for line continuation. `pnpm` and `node` are available; the Bash tool also works for POSIX commands when needed.
