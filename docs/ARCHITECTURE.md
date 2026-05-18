# System Architecture

## Overview

Four-layer architecture: External APIs → Core Services → Gateway → Frontend + MCP Server

The design prioritizes:

- **Separation of concerns**: Each service has one responsibility
- **Shared tool interface**: Both frontend agent and MCP server use the same tool registry
- **Shared wire contracts**: Every cross-layer payload (REST body, WS frame, MCP tool I/O) is a Zod schema in `packages/types`. One definition drives runtime validation + inferred TypeScript types — no drift between frontend and backend. See `TECH_DECISIONS.md` → "Validation Layer".
- **Real-time data flow**: WebSocket for telemetry streams, REST for agent queries
- **Horizontal scalability**: Stateless services behind gateway

## Architecture Diagram

```
External Data Sources
├── Celestrak (TLE catalog, updated daily)
└── NOAA SWPC (space weather: Kp index, solar wind, X-ray flux)
    ↓
Core Services (Node.js + TypeScript)
├── Orbit Service (satellite.js propagator, TLE cache)
├── Weather Service (NOAA poller + cache)
├── Telemetry Simulator (realistic synthetic streams)
└── Anomaly Engine (Z-score + rolling mean detection)
    ↓
Gateway
├── WebSocket (real-time push to frontend)
└── REST API (agent queries)
    ↓
Tool Registry (shared interface)
    ↓
├── Frontend (React + Vite)
│   ├── 3D Globe (Three.js via globe.gl)
│   ├── Telemetry Dashboard (Recharts)
│   └── Agent Chat Panel
│
└── MCP Server (stdio + SSE transport)
    ↓
    External AI Clients (Claude Desktop, Cursor)
```

## Layer Details

### Layer 1: External Data Sources

**Celestrak TLE API**

- Endpoint: `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json`
- Update frequency: Daily (TLE data changes slowly)
- Cache strategy: SQLite or JSON file, refresh every 24 hours
- Data format: JSON with NORAD catalog number, TLE line 1/2, epoch

**NOAA Space Weather Prediction Center**

- Endpoints:
  - 3-day Kp forecast: `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json`
  - Real-time solar wind: `https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json`
  - X-ray flux: `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`
- Update frequency: Every 15 minutes
- Cache strategy: In-memory with TTL
- Data format: JSON time series

### Layer 2: Core Services

**Orbit Service**

- Responsibilities:
  - Fetch and cache TLE data
  - Propagate satellite positions using `satellite.js`
  - Calculate ground tracks
  - Predict visual passes for given observer location
- Key functions:
  - `getSatellitePosition(noradId: number, timestamp: Date): Position`
  - `predictPasses(noradId: number, observerLat: number, observerLon: number, hours: number): Pass[]`
  - `getGroundTrack(noradId: number, duration: number): LatLon[]`

**Space Weather Service**

- Responsibilities:
  - Poll NOAA APIs on schedule
  - Cache current conditions
  - Provide historical lookback
- Key functions:
  - `getCurrentKpIndex(): number`
  - `getSolarWind(): SolarWindData`
  - `getXRayFlux(): XRayData`

**Telemetry Simulator**

- Responsibilities:
  - Generate realistic per-satellite telemetry streams
  - Eclipse-aware power/temperature simulation
  - Inject occasional anomaly events
- Parameters per satellite:
  - Bus voltage: 24-32V nominal, drops in eclipse
  - Internal temperature: -20°C to +50°C, thermal cycling with orbit
  - Attitude (pitch/roll/yaw): small random walk around zero
  - Noise: Gaussian with σ tuned per metric
- Anomaly injection:
  - Slow drift: temperature gradually increases over 20 minutes
  - Voltage spike: sudden drop then recovery
  - Frequency: ~2% of time per satellite
- Output: WebSocket stream at 1Hz per satellite

**Anomaly Detection Engine**

- Responsibilities:
  - Consume telemetry stream
  - Apply statistical detection
  - Emit alerts with severity levels
- Algorithms:
  - Rolling mean (window: 60 samples = 1 minute)
  - Z-score threshold: warn at 2σ, alert at 3σ
  - Consecutive sample requirement: 3+ anomalous readings to trigger
- Output: Alert objects with `{ satellite, metric, timestamp, severity, zscore }`

### Layer 3: Gateway

**WebSocket Server (Fastify + ws)**

- Endpoints:
  - `ws://api.orbit-ctrl.local/telemetry` — streams all active satellite telemetry
  - `ws://api.orbit-ctrl.local/alerts` — streams anomaly alerts
- Message format: JSON with `{ type, timestamp, data }`
- Reconnection: Client handles with exponential backoff

**REST API (Fastify)**

- Routes:
  - `GET /satellites` — list tracked satellites
  - `GET /satellites/:id/position?time=ISO8601` — position at specific time
  - `GET /satellites/:id/passes?lat=N&lon=N&hours=N` — predict passes
  - `GET /space-weather` — current conditions
  - `POST /agent/chat` — send message to AI agent, get streaming response
- Authentication: None for demo (add API keys in production)
- CORS: Allow all origins for demo (required: GHP origin → SnapDeploy API)

### Layer 3.5: AI Host (in `apps/api`)

The agent that answers `POST /agent/chat` is a **host** in MCP parlance — it owns the conversation loop, calls an LLM, and dispatches tool calls. It sits between the gateway and the tool registry.

```
       ┌──────────────────────────────┐
       │   Agent loop (orchestrator)  │   provider-agnostic
       └──────────────┬───────────────┘
        LLMEvent      │     normalized
        stream        │     tool calls
       ┌──────────────┴───────────────┐
       │  LLMProvider │  ToolBroker   │
       │  (Gemini /   │  (in-process  │
       │   Anthropic) │   registry    │
       │              │   dispatch)   │
       └──────────────┴───────────────┘
```

**Components:**

- **Orchestrator** — runs the conversation loop: send messages → consume `LLMEvent`s → on `tool_call`, validate args, call `ToolBroker`, append `tool_result` → loop until `stop`. Knows nothing about Gemini/Anthropic specifics.
- **`LLMProvider` adapters** — one per vendor SDK. Translate the tool registry to native shapes, stream native responses, emit normalized `LLMEvent`s. Owns transport-level retry (exponential backoff with jitter, ≤3 attempts). Live in `apps/api/src/clients/` (`gemini.client.ts`, `anthropic.client.ts`).
- **`ToolBroker`** — reads `packages/tools` directly; same registry the MCP server exposes. Returns errors as `tool_result` with `is_error: true` rather than throwing, so the model can self-correct.

**Failure handling:** transport errors retry in code; semantic errors (bad args, tool exceptions) feed back into the conversation as error tool results, capped at 3 self-corrections per step. Full rationale in `TECH_DECISIONS.md` → AI Layer → Retry strategy.

**Provider selection:** primary is **Gemini** (`gemini-2.5-flash`, free tier — keeps the public demo cost-free). Anthropic Claude (`claude-sonnet-4-6`) is a second adapter selectable via env var.

### Layer 4: Tool Registry

Shared schema used by both the AI host (in-process) and the MCP server (over stdio).

**Tool Definitions (JSON Schema)**

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (params: any) => Promise<any>;
}
```

**Available Tools:**

1. `get_satellite_position`
   - Input: `{ name: string, time?: ISO8601 }`
   - Output: `{ lat, lon, alt, velocity }`

2. `predict_passes`
   - Input: `{ satellite: string, lat: number, lon: number, hours: number }`
   - Output: `Pass[]` with `{ startTime, maxElevation, duration }`

3. `get_space_weather`
   - Input: `{}`
   - Output: `{ kpIndex, solarWind, xrayFlux, summary }`

4. `get_satellite_telemetry`
   - Input: `{ satellite: string, window?: number }` (window in seconds)
   - Output: `{ voltage, temperature, attitude, timestamp }`

5. `get_anomalies`
   - Input: `{ satellite?: string, severity?: 'warn' | 'alert' }`
   - Output: `Anomaly[]`

6. `find_satellites_above`
   - Input: `{ lat: number, lon: number, minElevation: number, when?: ISO8601 }`
   - Output: `Satellite[]` currently above horizon

### Layer 5A: Frontend

**Technology:**

- React 18 + TypeScript + Vite
- State: TanStack Query (server state) + Zustand (UI state)
- 3D: globe.gl (Three.js wrapper)
- Charts: Recharts
- Styling: CSS modules + design tokens

**Component Hierarchy:**

```
App
├── Header (status, clock)
├── MainGrid
│   ├── Globe (Three.js canvas)
│   ├── SatelliteList (virtualized)
│   ├── SelectedSatelliteDetail
│   └── AgentChatPanel
├── TelemetryStrip (4 metric cards with sparklines)
└── AlertLog (recent anomalies)
```

**Data Flow:**

- WebSocket connection opens on mount
- Telemetry updates stored in Zustand
- Anomalies trigger toast notifications + log updates
- Agent queries call REST endpoint, stream response

### Layer 5B: MCP Server

**Technology:**

- `@modelcontextprotocol/sdk` (official SDK)
- Transport: stdio (for Claude Desktop) + SSE (for web clients)
- Same tool registry as frontend agent

**Capabilities:**

- Exposes all 6 tools to external AI clients
- Handles concurrent requests
- Logs usage for debugging

**Demo Flow:**

1. User configures Claude Desktop with MCP server path
2. User asks Claude: "Any satellites over Tokyo with anomalies in next 2 hours?"
3. Claude calls `predict_passes` and `get_anomalies` via MCP
4. Response appears in Claude Desktop chat

## Data Flow Examples

### Example 1: User Opens Dashboard

1. Frontend connects WebSocket to `/telemetry`
2. Backend starts streaming 3 active satellites (ISS, HST, Starlink)
3. Orbit Service calculates positions every 1s
4. Telemetry Simulator generates voltage/temp/attitude
5. Frontend receives updates, updates globe + charts in real-time

### Example 2: User Asks Agent Query

User: "Which satellites overhead in next 2h have active anomalies?"

1. Frontend sends POST `/agent/chat` with message
2. Agent parses intent, decides to call tools
3. Calls `predict_passes(lat: 35.68, lon: 139.69, hours: 2)`
   - Returns 8 satellites with elevation >10°
4. Calls `get_anomalies(severity: 'warn')`
   - Returns 1 match (HST temperature drift)
5. Agent synthesizes: "HST passes at 15:47 UTC, temp anomaly active"
6. Response streams back to frontend

### Example 3: External AI Client via MCP

Claude Desktop user: "Show me the current space weather"

1. Claude Desktop calls MCP server `get_space_weather` tool
2. MCP server forwards to Weather Service
3. Returns `{ kpIndex: 3.1, solarWind: {...}, summary: "quiet conditions" }`
4. Claude Desktop formats response naturally

## Performance Considerations

**Orbital Calculations**

- Pre-calculate positions for next 24 hours, cache
- Only recalculate on TLE update
- For 100 satellites × 1440 minutes = 144k positions, cache in Redis

**WebSocket Scaling**

- Use Socket.IO with Redis adapter for multi-instance
- Room-based subscriptions (user only gets satellites they're viewing)
- Backpressure: drop frames if client can't keep up

**Frontend Rendering**

- Three.js: use GPU instancing for >100 satellites
- React: virtualize satellite list (react-window)
- Charts: downsample telemetry to 100 points max

## Security Notes

For demo/portfolio purposes:

- No authentication required
- CORS allows all origins
- Rate limiting: 100 req/min per IP

For production:

- Add API key authentication
- JWT tokens for MCP server
- Strict CORS policy
- Rate limit: 10 req/min per API key
