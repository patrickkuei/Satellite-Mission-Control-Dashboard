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
  queryFn: () => fetch('/api/satellites').then(r => r.json())
});

// UI state — Zustand
const useUIStore = create<UIState>(set => ({
  selectedSatellite: null,
  setSelectedSatellite: (id) => set({ selectedSatellite: id }),
  isAgentPanelOpen: true,
  toggleAgentPanel: () => set(state => ({ isAgentPanelOpen: !state.isAgentPanelOpen }))
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
- Built-in schema validation
- First-class TypeScript support
- WebSocket plugin (`@fastify/websocket`)
- CORS plugin (`@fastify/cors`)

**Example route with schema:**
```typescript
fastify.get('/satellites/:id/position', {
  schema: {
    params: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id']
    },
    querystring: {
      type: 'object',
      properties: { time: { type: 'string', format: 'date-time' } }
    }
  }
}, async (req, reply) => {
  const position = await orbitService.getPosition(req.params.id, req.query.time);
  return position;
});
```

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
  alt: positionGd.height
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

## AI Layer

### Claude API (Anthropic)

**Why Claude:**
- Best-in-class tool calling (critical for multi-hop queries)
- Function calling stability (low refusal rate)
- Streaming support (visible reasoning steps)
- Familiar to you (experience advantage in portfolio context)

**Model choice:** `claude-sonnet-4-20250514`
- Good balance of speed and capability
- Tool calling optimized
- Lower cost than Opus (important for demo)

**Why not alternatives:**
- GPT-4: Good but function calling less reliable in edge cases
- Gemini: Worth testing but less mature tooling ecosystem
- Open-source (Llama, Mixtral): Need local GPU, harder deployment

**Tool calling setup:**
```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2000,
  messages: [{ role: 'user', content: userQuery }],
  tools: toolRegistry.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  })),
  stream: true
});
```

### MCP Server (Model Context Protocol)

**Why MCP:**
- Emerging standard for AI tool integration
- Shows forward-thinking tech awareness
- Direct differentiation (few portfolio projects have MCP integration)
- Official SDK from Anthropic (`@modelcontextprotocol/sdk`)

**Transport:** stdio + SSE
- stdio for Claude Desktop (local process)
- SSE for web-based AI clients (future)

**Implementation:**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'orbit-ctrl', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/list', async () => ({
  tools: toolRegistry.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}));

server.setRequestHandler('tools/call', async (request) => {
  const tool = toolRegistry.find(t => t.name === request.params.name);
  return { content: [{ type: 'text', text: JSON.stringify(await tool.execute(request.params.arguments)) }] };
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
