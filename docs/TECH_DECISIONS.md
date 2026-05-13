# Technology Decisions

Key technical choices locked in upfront to accelerate development. Each decision prioritizes:

1. **Time to demo** — Choose mature libraries over building from scratch
2. **Portfolio impact** — Modern stack shows familiarity with current best practices
3. **Production readiness** — TypeScript strict mode, testability, deployability

## Frontend Stack

### React 18 + TypeScript

**Why React:**

- Industry standard for space tech companies (SpaceX, Planet Labs use React-based stacks)
- Rich ecosystem for data visualization (Recharts, Victory)
- Concurrent rendering helps with real-time updates

**Why TypeScript:**

- Strict mode catches errors at compile time (critical for mission-critical UIs)
- Shared types between frontend/backend via monorepo
- Better IDE support for orbital mechanics math (autocomplete for vector operations)

**Alternatives considered:**

- Vue 3: Great DX but less common in space industry
- Svelte: Smaller bundle but smaller talent pool
- Plain JS: Not production-ready for complex state management

### Vite (Build Tool)

**Why Vite:**

- Fast HMR (instant feedback during development)
- Out-of-box TypeScript support
- Optimized production builds
- Better than CRA (deprecated), simpler than webpack

### globe.gl (3D Visualization)

**Why globe.gl:**

- Built on Three.js but handles camera, lighting, Earth texture out-of-box
- Saves ~2 days vs raw Three.js
- Specifically designed for orbital visualization
- Active maintenance, good docs

**Why not alternatives:**

- Raw Three.js: Too much boilerplate for Earth + orbit setup
- CesiumJS: Overkill for this use case (focused on GIS applications)
- Mapbox GL: 2D only, doesn't support orbital view

**Key features we use:**

```typescript
<Globe
  globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
  objectsData={satellites}
  objectLat={d => d.lat}
  objectLng={d => d.lon}
  objectAltitude={d => d.alt / 6371} // normalize to Earth radii
  pathsData={groundTracks}
  pathPoints={d => d.positions}
  hexBinPointsData={auroraBelt} // for space weather viz
/>
```

### State Management: TanStack Query + Zustand

**Why TanStack Query (formerly React Query):**

- Server state (satellite positions, telemetry) auto-refetches and caches
- Built-in loading/error states
- Prevents duplicate requests
- Industry standard for data-heavy apps

**Why Zustand:**

- UI state (selected satellite, filters, panel visibility) stays lightweight
- Simpler than Redux (less boilerplate)
- TypeScript-first design
- Only 1KB bundle size

**State split:**

```typescript
// Server state — TanStack Query
const { data: satellites } = useQuery({
  queryKey: ['satellites'],
  queryFn: () => fetch('/api/satellites').then((r) => r.json()),
});

// UI state — Zustand
const useUIStore = create<UIState>((set) => ({
  selectedSatellite: null,
  setSelectedSatellite: (id) => set({ selectedSatellite: id }),
  isAgentPanelOpen: true,
  toggleAgentPanel: () => set((state) => ({ isAgentPanelOpen: !state.isAgentPanelOpen })),
}));
```

### Recharts (Telemetry Charts)

**Why Recharts:**

- React-native (declarative API)
- Good performance for 100-point sparklines
- TypeScript support
- Easier than D3 for simple use cases

**Alternatives considered:**

- D3: More powerful but steeper learning curve
- Chart.js: Canvas-based, harder to integrate with React lifecycle
- Victory: Similar to Recharts but larger bundle

## Backend Stack

### Node.js + TypeScript + Fastify

**Why Node.js:**

- Share code with frontend (TypeScript types, utility functions)
- Good ecosystem for real-time (WebSocket, SSE)
- Familiar for frontend-heavy developers

**Why Fastify:**

- Faster than Express (2x throughput in benchmarks)
- Pluggable schema validation — we plug in Zod (see "Validation" below) instead of hand-written JSON Schema
- First-class TypeScript support
- WebSocket plugin (`@fastify/websocket`)
- CORS plugin (`@fastify/cors`)

**Example route — Zod-driven (`fastify-type-provider-zod`):**

```typescript
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PositionSchema } from '@orbit-ctrl/types';

fastify.withTypeProvider<ZodTypeProvider>().get(
  '/satellites/:id/position',
  {
    schema: {
      params: z.object({ id: z.coerce.number().int().positive() }),
      querystring: z.object({ time: z.string().datetime().optional() }),
      response: { 200: PositionSchema },
    },
  },
  async (req) => orbitService.getPosition(req.params.id, req.query.time),
);
```

No hand-written JSON Schema lives in route files. One schema → request validation + response serialization + inferred TS types for `req.params` / `req.query`.

### WebSocket (not SSE)

**Why WebSocket:**

- Bidirectional (future feature: agent controls UI, e.g., "zoom to ISS")
- Lower latency than SSE for high-frequency updates
- Native browser support

**Why not SSE:**

- Unidirectional only (server → client)
- Falls back to HTTP streaming in some browsers (less efficient)

**Implementation:**

```typescript
fastify.register(websocket);

fastify.get('/telemetry', { websocket: true }, (socket) => {
  const interval = setInterval(() => {
    const data = getTelemetryForActiveSatellites();
    socket.send(JSON.stringify({ type: 'telemetry', data }));
  }, 1000);

  socket.on('close', () => clearInterval(interval));
});
```

### satellite.js (Orbital Mechanics)

**Why satellite.js:**

- Pure JavaScript implementation of SGP4 propagation
- Battle-tested (used by Celestrak, N2YO, etc.)
- No native dependencies (easy deployment)

**Why not alternatives:**

- Skyfield (Python): Would require Python service, adds complexity
- Orekit (Java): JVM overhead, not worth for this scale
- Custom implementation: Too error-prone for orbital mechanics

**Usage:**

```typescript
import * as satellite from 'satellite.js';

const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
const positionAndVelocity = satellite.propagate(satrec, new Date());
const gmst = satellite.gstime(new Date());
const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

const position = {
  lat: satellite.degreesLat(positionGd.latitude),
  lon: satellite.degreesLong(positionGd.longitude),
  alt: positionGd.height,
};
```

## Data Sources

### Celestrak (TLE Data)

**Why Celestrak:**

- Free, public TLE data
- JSON API (easy parsing)
- Reliable uptime
- Data quality verified by NORAD

**Endpoint:**

```
https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json
```

**Update frequency:** Daily (TLEs don't change rapidly)

**Alternatives considered:**

- Space-Track.org: Requires account, auth complexity
- N2YO: Rate-limited, not designed for bulk access

### NOAA SWPC (Space Weather)

**Why NOAA:**

- Official US government data
- Free JSON APIs
- Real-time updates
- No auth required

**Endpoints:**

- Kp index: `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json`
- Solar wind: `https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json`
- X-ray flux: `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`

**Update frequency:** Every 15 minutes

## Validation Layer

### Zod (schema-first contracts)

**Why Zod:**

- Single definition gives runtime validation + inferred TS types. Eliminates the constant TS-interface / JSON-Schema drift that ruins typed Node APIs.
- `fastify-type-provider-zod` plugs Zod directly into Fastify's validator + serializer hooks — no Ajv compilation step in our code, no parallel JSON Schema definitions.
- Frontend can validate inbound WebSocket frames against the same schema the backend used to emit them. Real wire-level safety, not just typed `fetch` wrappers.
- Output is JSON-Schema-compatible (via `zod-to-json-schema`), so when Phase 5's MCP server needs each tool's `inputSchema`, it's a one-liner from the same Zod schema.

**Why not alternatives:**

- **TypeBox** — gives JSON Schema natively (good for Fastify), but ergonomics are worse and frontend-side validation is awkward. Zod's developer experience is the bigger lever here than raw perf.
- **Valibot** — smaller bundle, but Fastify/MCP ecosystem support is thinner. Not worth the integration cost for a portfolio demo.
- **Hand-written JSON Schema + `ajv`** — what Fastify uses by default. Doubles the source of truth: schema + matching TS interface. Exactly the drift we're paying Zod to prevent.
- **Yup / io-ts** — Yup is React-form-centric and doesn't infer well; io-ts is fpts-flavored and adds a learning tax with no wins over Zod for this project.

**Pinned to Zod 3.x.** `fastify-type-provider-zod@2.x` (Fastify 4 compatible) requires Zod 3. When/if we upgrade Fastify to 5, both move together.

**Rules of engagement** — see `CLAUDE.md` → "Validation" for the full ruleset. Headlines:

1. **Wire shape, not in-memory shape.** Timestamps are `z.string().datetime()`. Conversion to `Date` happens at the consumer.
2. **One file per domain** under `packages/types/src/`.
3. **`.strict()` by default** on object schemas.
4. **JSDoc on the schema**, not the inferred type.
5. **Backend routes use the Zod type provider** — no inline JSON Schema.
6. **Frontend validates inbound WS frames** with `WSMessageSchema.parse(...)`.

## AI Layer

### Direct SDKs behind a normalized `LLMProvider` interface

**No framework (no LangChain).** The agent loop, prompt construction, and tool dispatch are written directly against vendor SDKs. The orchestrator never sees provider-specific types — each adapter normalizes its native stream into a common event shape.

**Why direct SDKs over LangChain:**

- **Portfolio signal.** Implementing the Anthropic tool-use protocol and the MCP spec directly demonstrates protocol-level fluency. "Wired up LangChain" demonstrates framework familiarity — the rarer signal wins for a space-industry role.
- **MCP value is irrelevant here.** LangChain's MCP adapter helps an agent _consume_ external MCP servers. This project _produces_ an MCP server (`packages/mcp-server`) and its in-process agent reads `packages/tools` directly. LangChain's MCP layer solves a problem the project doesn't have.
- **Scale doesn't justify the abstraction.** One system prompt + a tool registry + streaming = ~50 lines of native loop. `ChatPromptTemplate`, LangGraph, memory adapters etc. are unused weight.
- **Provider-swap is the only LangChain win we want — and a 100-line interface gets us that without the dep tree.**

**Where LangChain _would_ pay off (and why we're not there):** multi-chain RAG over mission logs, multi-agent orchestration, side-by-side A/B between three or more providers. If the project grows into any of those, re-evaluate. Until then it's overhead.

### Primary provider: Google Gemini

**Why Gemini first:**

- Free tier (`gemini-2.5-flash` and similar) makes the live demo cost-free — critical because the deployed Vercel/Fly.io demo will be hit by recruiters with no per-request budget.
- Native function calling + streaming match the host's needs.
- Demonstrates multi-provider competence (Anthropic is the obvious choice from the portfolio author; Gemini is the deliberate one).

**SDK:** `@google/genai` (the current GA SDK; the older `@google/generative-ai` package is deprecated).

**Model:** `gemini-2.5-flash` for the demo. Swap to `gemini-2.5-pro` via env var if a recruiter session needs deeper reasoning.

### Second provider: Anthropic Claude

**Why kept as a swappable adapter:**

- Validates the `LLMProvider` abstraction (one adapter is not an abstraction).
- Tool-use protocol fluency is the headline portfolio claim; the Anthropic adapter is where that claim lives.
- Higher-quality multi-hop reasoning when the demo audience warrants the cost.

**SDK:** `@anthropic-ai/sdk`. **Model:** latest Sonnet 4.x — currently `claude-sonnet-4-6` (the Anthropic SDK docs reference an older snapshot; do not downgrade).

### `LLMProvider` interface

```typescript
type LLMEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' };

interface NormalizedTool {
  name: string;
  description: string;
  inputSchema: JSONSchema; // MCP-shaped (lowest common denominator)
}

interface LLMProvider {
  chat(req: {
    system: string;
    messages: NormalizedMessage[];
    tools: NormalizedTool[];
  }): AsyncIterable<LLMEvent>;
}
```

**Adapter responsibilities:**

- Translate `NormalizedTool[]` into the provider's native tool/function declaration shape.
- Stream the provider's native response and emit normalized `LLMEvent`s.
- Apply transport-level retry (see below). Never let provider-specific error shapes escape.

**Gemini-specific translation gotcha:** Gemini's `parameters` schema is a restricted subset of JSON Schema. The adapter owns a `toGeminiSchema()` normalizer that strips `additionalProperties`, `$ref`, `oneOf`, and any other unsupported feature, with one unit test per stripped feature. This is where most multi-provider setups quietly break.

### Retry strategy — three failure classes

Different classes need different responses. Conflating them either burns API budget (retrying hallucinations) or freezes the agent (treating 503s as logic errors).

**1. Transport errors (429, 5xx, socket reset, timeout)**

- Where: adapter, around the SDK call.
- How: exponential backoff with jitter, capped at 3 retries (`1s → 2s → 4s` + ≤250ms jitter). Respect `Retry-After` headers.
- Don't rely on built-in SDK retry — coverage across streaming is uneven.

**2. Malformed tool calls (model invented a tool, args fail JSON Schema validation)**

- Where: orchestrator, between receiving `tool_call` event and dispatching to `ToolBroker`.
- How: validate `args` against the tool's `inputSchema` with Ajv. On failure, do not retry the API call — append a `tool_result` with `is_error: true` and the validation error text to the conversation. The model self-corrects on the next turn.
- Cap at 3 self-corrections per logical step before bailing, to prevent a hallucinating model from burning tokens forever.

**3. Tool execution errors (MCP server threw, downstream API failed)**

- Where: `ToolBroker`.
- How: surface the error message as a `tool_result` with `is_error: true`. Let the model decide whether to retry, pick a different tool, or report to the user. Do not auto-retry — the model has more context about whether retry is sensible than the broker does.

**Summary:** transport = code retries; semantic = model retries via conversation.

### MCP Server (Model Context Protocol)

**Why MCP:**

- Emerging standard for AI tool integration
- Shows forward-thinking tech awareness
- Direct differentiation (few portfolio projects have MCP integration)
- Official SDK from Anthropic (`@modelcontextprotocol/sdk`)

**Two MCP roles in this project — do not confuse:**

- **MCP server** (`packages/mcp-server`): exposes `packages/tools` over stdio so Claude Desktop / Cursor can call them.
- **MCP host** (the in-process agent in `apps/api`): consumes the same `packages/tools` registry directly via a `ToolBroker`. It does not speak MCP over a transport — it imports the registry. Tool definitions are MCP-shaped because that's the lowest common denominator across providers, not because the host uses MCP transport internally.

**Transport:** stdio + SSE

- stdio for Claude Desktop (local process)
- SSE for web-based AI clients (future)

**Implementation:**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'orbit-ctrl', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler('tools/list', async () => ({
  tools: toolRegistry.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler('tools/call', async (request) => {
  const tool = toolRegistry.find((t) => t.name === request.params.name);
  return {
    content: [{ type: 'text', text: JSON.stringify(await tool.execute(request.params.arguments)) }],
  };
});
```

## Monorepo Structure

### pnpm Workspaces

**Why pnpm:**

- Faster than npm/yarn (content-addressable storage)
- Better monorepo support
- Stricter dependency resolution (prevents phantom dependencies)
- Used by Vue, Nuxt, SvelteKit (modern projects)

**Why not alternatives:**

- npm workspaces: Works but slower
- Yarn workspaces: Between npm and pnpm, no strong advantage
- Turborepo/Nx: Overkill for this size, adds complexity

**Workspace structure:**

```
orbit-ctrl/
├── apps/
│   ├── web/          # Frontend (Vite + React)
│   └── api/          # Backend (Fastify)
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── tools/        # Tool registry + implementations
│   └── mcp-server/   # MCP server package
└── pnpm-workspace.yaml
```

**Benefits:**

- Shared types: `import type { Satellite } from '@orbit-ctrl/types'`
- Tool reuse: Both agent and MCP server use `@orbit-ctrl/tools`
- Single `pnpm install` installs everything
- Parallel builds: `pnpm --parallel build`

## Testing Strategy

### Jest (Unit + Integration)

**Why Jest:**

- Industry standard
- Built-in coverage reports
- TypeScript support via ts-jest
- Snapshot testing (useful for UI components)

**Coverage target:** 80%+

**AI-assisted approach:**

- Use Claude/Cursor to generate initial test suites
- Focus manual effort on edge cases
- Example prompt: "Generate Jest tests for orbitService.predictPasses with edge cases: satellite below horizon, high latitude, crossing date line"

**Test structure:**

```typescript
describe('OrbitService', () => {
  describe('getPosition', () => {
    it('returns ISS position matching known coordinates', async () => {
      const position = await orbitService.getPosition(25544, new Date('2026-05-12T14:31:09Z'));
      expect(position.lat).toBeCloseTo(35.68, 1); // within 0.1 degrees
      expect(position.alt).toBeGreaterThan(400); // ISS altitude > 400km
    });
  });
});
```

## Deployment

### Frontend: Vercel

**Why Vercel:**

- Zero-config deployment for Vite/React
- Auto-preview deployments for PRs
- Edge network (low latency globally)
- Free tier sufficient for portfolio

**Alternatives considered:**

- Netlify: Similar to Vercel, no strong preference
- GitHub Pages: Static only, no SSR
- AWS S3 + CloudFront: More setup overhead

### Backend: Fly.io

**Why Fly.io:**

- WebSocket support (critical, Vercel doesn't support WS)
- Close to edge locations (low latency)
- Simple deployment (`fly deploy`)
- Free tier includes 3 small VMs

**Alternatives considered:**

- Railway: Good but less mature than Fly.io
- Heroku: Free tier removed
- AWS ECS: Too complex for demo project
- Vercel (backend): No WebSocket support

**Deployment:**

```bash
cd apps/api
fly launch
fly deploy
```

## Caching Strategy

### TLE Data: JSON File

**Why not database:**

- TLE data updates once per day (low write frequency)
- ~100 satellites = ~50KB JSON (fits in memory)
- Database is over-engineering

**Implementation:**

```typescript
const TLE_CACHE_PATH = './data/tle-cache.json';
const TLE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function refreshTLECache() {
  const cacheAge = Date.now() - fs.statSync(TLE_CACHE_PATH).mtimeMs;
  if (cacheAge < TLE_CACHE_TTL) return; // Cache still fresh

  const response = await fetch('https://celestrak.org/...');
  const satellites = await response.json();
  fs.writeFileSync(TLE_CACHE_PATH, JSON.stringify(satellites));
}
```

### Space Weather: In-Memory

**Why in-memory:**

- Updates every 15 minutes (moderate write frequency)
- Small data size (<10KB)
- Server restarts acceptable (fetch on startup)

**Implementation:**

```typescript
let spaceWeatherCache: SpaceWeather | null = null;
let lastFetch = 0;

async function getSpaceWeather(): Promise<SpaceWeather> {
  if (Date.now() - lastFetch < 15 * 60 * 1000 && spaceWeatherCache) {
    return spaceWeatherCache;
  }

  spaceWeatherCache = await fetchFromNOAA();
  lastFetch = Date.now();
  return spaceWeatherCache;
}
```

### Orbital Positions: Optional Redis

**For production scale (100+ satellites):**

- Calculate positions for next 24 hours, cache in Redis
- Key: `orbit:${satelliteId}:${timestamp}`
- TTL: 1 hour (recalculate when TLE updates)

**For demo (10 satellites):**

- Calculate on-demand (satellite.js is fast, <1ms per satellite)
- No cache needed

## Design System

### Tokens + CSS Variables

**Why CSS variables:**

- Light/dark mode support
- Consistent spacing, colors, typography
- Easy theme switching

**Core tokens:**

```css
:root {
  /* Colors */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #6b6b6b;
  --color-accent: #ff6b35; /* Amber/orange */
  --color-success: #4ade80;
  --color-warning: #fbbf24;
  --color-danger: #ef4444;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-serif: 'Playfair Display', Georgia, serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-primary: #0a0a0a;
    --color-bg-secondary: #1a1a1a;
    --color-text-primary: #e8e6e0;
    --color-text-secondary: #888880;
  }
}
```

### Typography Hierarchy

**Editorial-influenced approach:**

- Brand mark: `font-family: var(--font-serif); font-style: italic;` → "orbit.ctrl"
- Section headers: `font-family: var(--font-serif);` → "Live orbital view"
- Data labels: `font-family: var(--font-sans);` → "Bus voltage"
- Numeric data: `font-family: var(--font-mono);` → "28.14 V"
- Body text: `font-family: var(--font-sans);` → Everything else

**Rationale:**

- Serif accents = editorial aesthetic (differentiator from generic dashboards)
- Mono for data = readability + technical credibility
- Sans for UI = clean, modern baseline

## Key Principles

1. **TypeScript Strict Mode Everywhere**
   - No `any` types
   - Shared types between frontend/backend prevent API drift
   - Compile errors > runtime errors

2. **Monorepo for Code Sharing**
   - Tool definitions used by agent + MCP server
   - Types shared across all packages
   - Single source of truth

3. **Real-time First**
   - WebSocket for telemetry (not polling)
   - Streaming agent responses (not batch)
   - Incremental UI updates (React concurrent mode)

4. **Production Mindset**
   - Error boundaries, loading states
   - Graceful degradation (WebSocket disconnects)
   - Rate limiting, CORS
   - CI/CD ready (GitHub Actions)

5. **Demo-Optimized**
   - Free tier deployments (Vercel, Fly.io)
   - No auth barriers (easy to share URL)
   - Fast first load (<3s)
   - Mobile responsive (at least tablet)

## Non-Goals (Explicitly Out of Scope)

To keep timeline realistic:

- ❌ User accounts / persistence
- ❌ Historical data (show past orbital positions)
- ❌ Satellite control (send commands)
- ❌ Mobile app (React Native)
- ❌ Multi-language support
- ❌ Accessibility beyond basics (WCAG AA)

These can be Phase 2 after initial launch.
