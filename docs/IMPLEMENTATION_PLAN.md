# Implementation Plan

6-week roadmap (3 hours/day part-time) or 3-4 weeks full-time. Each phase ends with a demoable milestone.

## Phase 0: Foundation (Days 1-2)

**Goal:** Monorepo scaffolding with TypeScript strict mode, shared types, and basic dev workflow.

### Tasks

1. **Initialize monorepo**

   ```bash
   mkdir orbit-ctrl && cd orbit-ctrl
   pnpm init
   mkdir -p apps/{web,api} packages/{types,tools,mcp-server}
   ```

2. **Configure workspace**
   - Create `pnpm-workspace.yaml`:
     ```yaml
     packages:
       - 'apps/*'
       - 'packages/*'
     ```
   - Root `package.json` with scripts:
     ```json
     {
       "scripts": {
         "dev": "pnpm --parallel --filter './apps/*' dev",
         "build": "pnpm --filter './packages/*' build && pnpm --filter './apps/*' build",
         "test": "pnpm --recursive test"
       }
     }
     ```

3. **Setup TypeScript**
   - Root `tsconfig.json` with strict settings:
     ```json
     {
       "compilerOptions": {
         "strict": true,
         "esModuleInterop": true,
         "skipLibCheck": true,
         "moduleResolution": "bundler"
       }
     }
     ```
   - Extend in each package

4. **Create shared contracts package (schema-first, Zod)**
   - Install `zod@^3.23.8` in `packages/types` and in `apps/api`. Install `fastify-type-provider-zod@^2` in `apps/api`.
   - One file per domain under `packages/types/src/`: `satellite.ts`, `position.ts`, `telemetry.ts`, `anomaly.ts`, `pass.ts`, `observer.ts`, `weather.ts`, `ws.ts`, `health.ts`. Barrel-export from `index.ts`.
   - **Schema-first** — every export starts as a Zod schema; the TS type is derived via `z.infer`:

     ```typescript
     // packages/types/src/satellite.ts
     import { z } from 'zod';

     export const TLESchema = z
       .object({
         line1: z.string().length(69),
         line2: z.string().length(69),
         epoch: z.string().datetime(),
       })
       .strict();
     export type TLE = z.infer<typeof TLESchema>;

     export const SatelliteSchema = z
       .object({
         noradId: z.number().int().positive(),
         name: z.string().min(1),
         tle: TLESchema,
       })
       .strict();
     export type Satellite = z.infer<typeof SatelliteSchema>;
     ```

   - **Wire shape, not in-memory shape.** All timestamps are `z.string().datetime()` (ISO 8601). Conversion to `Date` is a consumer concern, never inside the schema.
   - Wire the Zod type provider into Fastify once in `apps/api/src/server.ts`:

     ```typescript
     import {
       serializerCompiler,
       validatorCompiler,
       type ZodTypeProvider,
     } from 'fastify-type-provider-zod';
     const server = Fastify({
       logger: {
         /* ... */
       },
     }).withTypeProvider<ZodTypeProvider>();
     server.setValidatorCompiler(validatorCompiler);
     server.setSerializerCompiler(serializerCompiler);
     ```

   - Routes register schemas directly — no hand-written JSON Schema in route files. See `CLAUDE.md` → "Validation" for the full ruleset.

5. **Setup Vite for frontend**
   - `apps/web`: Vite + React + TypeScript template
   - Install: react, react-dom, typescript, vite
   - Basic `App.tsx` with "Hello orbit.ctrl"

6. **Setup Fastify for backend**
   - `apps/api`: Node + TypeScript + Fastify
   - Install: fastify, @fastify/websocket, @fastify/cors
   - Basic server listening on :3001

7. **Add ESLint + Prettier**
   - Shared config in root
   - Pre-commit hooks with husky + lint-staged

### Deliverable

- [x] `pnpm dev` starts both frontend (localhost:5173) and backend (localhost:3001)
- [x] TypeScript compiles without errors
- [x] Shared types imported correctly across packages
- [x] Git repo initialized with proper .gitignore
- [x] `packages/types` is schema-first (Zod): one file per domain, TS types via `z.infer`, wire-shape timestamps
- [x] `apps/api` wires `fastify-type-provider-zod` at the composition root; `/health` validates against the shared `HealthReportSchema`

**Time:** 6-8 hours

---

## Phase 1: Globe + TLE Data (Week 1)

**Goal:** 3D globe displaying 5-10 satellites in real-time orbital motion.

### Tasks

1. **TLE Service (backend)**
   - Create `packages/tools/src/tle-service.ts`
   - Fetch from Celestrak:
     ```typescript
     const response = await fetch(
       'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
     );
     const satellites = await response.json();
     ```
   - Parse into `Satellite` type
   - Cache to `data/tle-cache.json` (refresh every 24h)
   - Use `satellite.js` for orbit propagation:

     ```typescript
     import * as satellite from 'satellite.js';

     function getSatellitePosition(sat: Satellite, time: Date): Position {
       const satrec = satellite.twoline2satrec(sat.tle.line1, sat.tle.line2);
       const positionAndVelocity = satellite.propagate(satrec, time);
       const gmst = satellite.gstime(time);
       const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

       return {
         lat: satellite.degreesLat(positionGd.latitude),
         lon: satellite.degreesLong(positionGd.longitude),
         alt: positionGd.height,
         velocity: // calculate from velocity vector
         timestamp: time
       };
     }
     ```

2. **REST endpoint for positions**
   - `apps/api/src/routes/satellites.ts`:

     ```typescript
     fastify.get('/satellites', async () => {
       return tleService.getSatellites();
     });

     fastify.get('/satellites/:id/position', async (req) => {
       const time = req.query.time ? new Date(req.query.time) : new Date();
       return orbitService.getPosition(req.params.id, time);
     });
     ```

3. **Globe visualization (frontend)**
   - Install `globe.gl` and `three`
   - Create `components/Globe.tsx`:

     ```typescript
     import Globe from 'react-globe.gl';

     export function GlobeView({ satellites }: { satellites: SatellitePosition[] }) {
       return (
         <Globe
           globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
           objectsData={satellites}
           objectLat={d => d.lat}
           objectLng={d => d.lon}
           objectAltitude={d => d.alt / 6371} // normalize to Earth radii
           objectLabel={d => d.name}
         />
       );
     }
     ```

4. **Real-time updates**
   - Frontend: fetch positions every 1s
     ```typescript
     useEffect(() => {
       const interval = setInterval(async () => {
         const positions = await Promise.all(
           satellites.map((s) => fetch(`/api/satellites/${s.id}/position`).then((r) => r.json())),
         );
         setSatellitePositions(positions);
       }, 1000);
       return () => clearInterval(interval);
     }, [satellites]);
     ```

5. **Ground tracks**
   - Calculate future positions for next 90 minutes
   - Draw as lines on globe:
     ```typescript
     <Globe
       pathsData={groundTracks}
       pathPoints={d => d.positions}
       pathPointLat={p => p.lat}
       pathPointLng={p => p.lon}
       pathColor={() => 'rgba(255, 107, 53, 0.4)'}
       pathStroke={2}
     />
     ```

### Deliverable

- [x] 3D Earth globe with realistic texture
- [x] ISS + a curated set of LEO satellites (Tianhe / Starlinks, padded from Celestrak) moving in correct orbits
- [x] Ground track for the selected satellite shown as an amber path
- [x] Click satellite to see name + altitude + velocity (right rail + hover label)
- [x] Backend logs TLE fetch/cache hits via Fastify's pino logger

**Time:** 12-16 hours

---

## Phase 2: Space Weather + Pass Prediction (Week 2)

**Goal:** Integrate space weather overlays and predict satellite passes for user location.

### Tasks

1. **Space Weather Service (backend)**
   - `packages/tools/src/weather-service.ts`
   - Fetch from NOAA SWPC:
     ```typescript
     async function getCurrentKpIndex(): Promise<number> {
       const res = await fetch(
         'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
       );
       const data = await res.json();
       return parseFloat(data[data.length - 1][1]); // latest Kp
     }
     ```
   - Poll every 15 minutes, cache in-memory
   - Endpoints:
     ```typescript
     fastify.get('/space-weather', async () => ({
       kpIndex: await weatherService.getCurrentKpIndex(),
       solarWind: await weatherService.getSolarWind(),
       xrayFlux: await weatherService.getXRayFlux(),
       summary: weatherService.getSummary(), // "quiet" / "active" / "storm"
     }));
     ```

2. **Pass prediction (backend)**
   - Add to orbit service:

     ```typescript
     function predictPasses(
       satellite: Satellite,
       observerLat: number,
       observerLon: number,
       hours: number,
     ): Pass[] {
       const passes: Pass[] = [];
       const now = new Date();
       const end = new Date(now.getTime() + hours * 3600 * 1000);

       for (let t = now; t < end; t = new Date(t.getTime() + 60 * 1000)) {
         const pos = getPosition(satellite, t);
         const { elevation, azimuth } = calculateTopocentric(pos, observerLat, observerLon);

         if (elevation > 0) {
           // Track this pass
         }
       }

       return passes;
     }
     ```

   - Endpoint:
     ```typescript
     fastify.get('/satellites/:id/passes', async (req) => {
       return orbitService.predictPasses(
         req.params.id,
         parseFloat(req.query.lat),
         parseFloat(req.query.lon),
         parseInt(req.query.hours),
       );
     });
     ```

3. **Space weather overlay (frontend)**
   - Add Kp index display in header
   - Visualize on globe:

     ```typescript
     const kpIndex = useSpaceWeather();
     const auroraBeltColor = kpIndex > 5 ? 'red' : kpIndex > 3 ? 'yellow' : 'green';

     <Globe
       hexBinPointsData={kpIndex > 3 ? auroral_zone_points : []}
       hexBinColor={() => auroraBeltColor}
     />
     ```

4. **User location + pass list (frontend)**
   - Get user location (geolocation API or manual input)
   - Display upcoming passes:

     ```typescript
     const [location, setLocation] = useState({ lat: 35.68, lon: 139.69 }); // Tokyo default
     const passes = usePasses(selectedSatellite, location, 2); // next 2 hours

     return (
       <div>
         <h3>Upcoming passes over your location</h3>
         {passes.map(p => (
           <div key={p.startTime}>
             {formatTime(p.startTime)} — max elevation {p.maxElevation}°
           </div>
         ))}
       </div>
     );
     ```

5. **Selected satellite detail panel**
   - Right rail showing:
     - Name + NORAD ID
     - Current altitude + velocity
     - Next pass time + max elevation
     - Orbital period

### Deliverable

- [x] Space weather status displayed in header (Kp index + summary)
- [x] Globe shows auroral zones when geomagnetic storm active
- [x] User location marked on globe
- [x] Clicking satellite shows detail panel with next pass time
- [x] "Passes in next 2 hours" list populated correctly

**Time:** 10-14 hours

---

## Phase 3: Telemetry Simulation + Anomaly Detection (Week 3)

**Goal:** Realistic telemetry streams with anomaly detection and alert UI.

> **Layering note:** `packages/tools` holds tool-registry entries only (consumed by the agent in Phase 4 and the MCP server in Phase 5). Runtime simulation and detection are backend services and live in `apps/api/src/services/` per the 5-layer rule in `CLAUDE.md`. Phase 4 will wrap these services with thin tool-registry adapters.

### Tasks

1. **Telemetry Simulator (backend)**
   - `apps/api/src/services/telemetry.service.ts`:

     ```typescript
     class TelemetrySimulator {
       generateTelemetry(satellite: Satellite, time: Date): Telemetry {
         const position = orbitService.getPosition(satellite, time);
         const inEclipse = this.isInEclipse(position, time);

         // Bus voltage: 24-32V nominal, drops in eclipse
         const voltage = inEclipse ? 24 + Math.random() * 4 : 28 + Math.random() * 4;

         // Temperature: thermal cycling with orbit
         const orbitalPhase = this.getOrbitalPhase(satellite, time);
         const baseTempC = -20 + 40 * Math.sin(orbitalPhase);
         const temperature = baseTempC + (Math.random() - 0.5) * 5;

         // Attitude: small random walk
         const attitude = {
           pitch: (Math.random() - 0.5) * 0.2,
           roll: (Math.random() - 0.5) * 0.2,
           yaw: (Math.random() - 0.5) * 0.2,
         };

         // Occasionally inject anomaly
         if (Math.random() < 0.02) {
           return this.injectAnomaly({ voltage, temperature, attitude }, time);
         }

         return { satelliteId: satellite.noradId, voltage, temperature, attitude, timestamp: time };
       }

       private injectAnomaly(telemetry: Telemetry, time: Date): Telemetry {
         // Slow temperature drift
         const anomalyType = Math.random();
         if (anomalyType < 0.5) {
           telemetry.temperature += 15; // sudden increase
         } else {
           telemetry.voltage -= 5; // voltage drop
         }
         return telemetry;
       }
     }
     ```

2. **WebSocket telemetry stream**
   - `apps/api/src/websocket.ts`:

     ```typescript
     fastify.register(websocket);

     fastify.get('/telemetry', { websocket: true }, (socket) => {
       const interval = setInterval(() => {
         const telemetry = satellites.map((s) =>
           telemetrySimulator.generateTelemetry(s, new Date()),
         );
         socket.send(JSON.stringify({ type: 'telemetry', data: telemetry }));
       }, 1000);

       socket.on('close', () => clearInterval(interval));
     });
     ```

3. **Anomaly Detection Engine (backend)**
   - `apps/api/src/services/anomaly.service.ts`:

     ```typescript
     class AnomalyEngine {
       private history: Map<number, Telemetry[]> = new Map();

       detectAnomalies(telemetry: Telemetry): Anomaly[] {
         const satelliteHistory = this.history.get(telemetry.satelliteId) || [];
         satelliteHistory.push(telemetry);

         // Keep last 60 samples (1 minute at 1Hz)
         if (satelliteHistory.length > 60) satelliteHistory.shift();
         this.history.set(telemetry.satelliteId, satelliteHistory);

         if (satelliteHistory.length < 10) return []; // need history

         const anomalies: Anomaly[] = [];

         // Check temperature
         const temps = satelliteHistory.map((t) => t.temperature);
         const tempMean = temps.reduce((a, b) => a + b) / temps.length;
         const tempStd = Math.sqrt(
           temps.reduce((a, b) => a + Math.pow(b - tempMean, 2), 0) / temps.length,
         );
         const tempZScore = (telemetry.temperature - tempMean) / tempStd;

         if (Math.abs(tempZScore) > 3) {
           anomalies.push({
             id: crypto.randomUUID(),
             satelliteId: telemetry.satelliteId,
             metric: 'temperature',
             severity: 'alert',
             zscore: tempZScore,
             timestamp: telemetry.timestamp,
             description: `Temperature ${tempZScore > 0 ? 'spike' : 'drop'} detected`,
           });
         } else if (Math.abs(tempZScore) > 2) {
           anomalies.push({
             id: crypto.randomUUID(),
             satelliteId: telemetry.satelliteId,
             metric: 'temperature',
             severity: 'warn',
             zscore: tempZScore,
             timestamp: telemetry.timestamp,
             description: 'Temperature drift detected',
           });
         }

         // Similar checks for voltage and attitude...

         return anomalies;
       }
     }
     ```

4. **WebSocket alert stream**
   - Add to websocket handler:
     ```typescript
     fastify.get('/alerts', { websocket: true }, (socket) => {
       anomalyEngine.on('anomaly', (anomaly: Anomaly) => {
         socket.send(JSON.stringify({ type: 'alert', data: anomaly }));
       });
     });
     ```

5. **Telemetry dashboard (frontend)**
   - Create `components/TelemetryStrip.tsx`:
     ```typescript
     export function TelemetryStrip({ telemetry }: { telemetry: Telemetry }) {
       return (
         <div className="telemetry-strip">
           <MetricCard
             label="Bus voltage"
             value={telemetry.voltage.toFixed(2)}
             unit="V"
             sparkline={voltageHistory}
             status={telemetry.voltage < 26 ? 'warn' : 'nominal'}
           />
           <MetricCard
             label="Internal temp"
             value={telemetry.temperature.toFixed(1)}
             unit="°C"
             sparkline={tempHistory}
             status={Math.abs(telemetry.temperature) > 40 ? 'warn' : 'nominal'}
           />
           <MetricCard
             label="Attitude yaw"
             value={telemetry.attitude.yaw.toFixed(2)}
             unit="°"
             sparkline={yawHistory}
           />
         </div>
       );
     }
     ```
   - Sparklines with Recharts:
     ```typescript
     <LineChart width={100} height={40} data={sparkline}>
       <Line type="monotone" dataKey="value" stroke="#3B6D11" strokeWidth={1} dot={false} />
     </LineChart>
     ```

6. **Alert log (frontend)**
   - Subscribe to WebSocket `/alerts`
   - Display in bottom panel:

     ```typescript
     const [alerts, setAlerts] = useState<Anomaly[]>([]);

     useEffect(() => {
       const ws = new WebSocket('ws://localhost:3001/alerts');
       ws.onmessage = (event) => {
         const { type, data } = JSON.parse(event.data);
         if (type === 'alert') {
           setAlerts(prev => [data, ...prev].slice(0, 10)); // keep latest 10
         }
       };
     }, []);

     return (
       <div className="alert-log">
         {alerts.map(a => (
           <div key={a.id} className={`alert alert-${a.severity}`}>
             <Icon name="alert-triangle" />
             <span>{formatTime(a.timestamp)}</span>
             <span>{satelliteName(a.satelliteId)} — {a.description}</span>
             <span className="zscore">Z = {a.zscore.toFixed(1)}</span>
           </div>
         ))}
       </div>
     );
     ```

### Deliverable

- [x] Real-time telemetry streaming from backend to frontend at 1Hz
- [x] Telemetry strip showing voltage, temperature, attitude with sparklines
- [x] Telemetry values change realistically (eclipse cycles, thermal variations)
- [x] Anomalies detected automatically (Z-score threshold)
- [x] Alerts appear in bottom log with severity color-coding
- [x] Visual confirmation: latched faults (5-sample lifetime) trip the 3-sample Z-score debounce, producing voltage / temperature / attitude alerts in the log

**Time:** 14-18 hours

---

## Phase 4: AI Agent Layer (Week 4)

**Goal:** Natural language query interface with multi-hop reasoning and visible tool calls, built on a provider-agnostic `LLMProvider` abstraction. Ship with **Gemini** as the primary adapter (free tier — keeps the live demo cost-free) and **Anthropic** as a second adapter that validates the abstraction.

**Architectural reminder (see `TECH_DECISIONS.md` → AI Layer):** no LangChain. Direct vendor SDKs behind a normalized `LLMProvider` interface. The orchestrator never sees provider-specific types. Three retry classes: transport (code retries with backoff), malformed tool calls (model self-corrects via `tool_result` with `is_error: true`), tool errors (same — model decides).

### Tasks

1. **Tool Registry (backend)**
   - `packages/tools/src/tool-registry.ts`:

     ```typescript
     interface Tool {
       name: string;
       description: string;
       inputSchema: {
         type: 'object';
         properties: Record<string, any>;
         required: string[];
       };
       execute: (params: any) => Promise<any>;
     }

     export const toolRegistry: Tool[] = [
       {
         name: 'get_satellite_position',
         description: 'Get current or historical position of a satellite',
         inputSchema: {
           type: 'object',
           properties: {
             name: { type: 'string', description: 'Satellite name (e.g., "ISS", "Hubble")' },
             time: { type: 'string', description: 'ISO8601 timestamp (optional, defaults to now)' },
           },
           required: ['name'],
         },
         execute: async ({ name, time }) => {
           const satellite = await tleService.getSatelliteByName(name);
           return orbitService.getPosition(satellite, time ? new Date(time) : new Date());
         },
       },
       {
         name: 'predict_passes',
         description: 'Predict when a satellite will be visible from a location',
         inputSchema: {
           type: 'object',
           properties: {
             satellite: { type: 'string' },
             lat: { type: 'number' },
             lon: { type: 'number' },
             hours: { type: 'number', description: 'How many hours to look ahead' },
           },
           required: ['satellite', 'lat', 'lon', 'hours'],
         },
         execute: async ({ satellite, lat, lon, hours }) => {
           const sat = await tleService.getSatelliteByName(satellite);
           return orbitService.predictPasses(sat, lat, lon, hours);
         },
       },
       // ... other tools: get_space_weather, get_satellite_telemetry, get_anomalies, find_satellites_above
     ];
     ```

2. **`LLMProvider` interface + Gemini adapter (backend)**

   Define the abstraction first; build adapters against it.
   - `apps/api/src/clients/llm-provider.ts` — interface only:

     ```typescript
     export type LLMEvent =
       | { type: 'text'; delta: string }
       | { type: 'tool_call'; id: string; name: string; args: unknown }
       | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' };

     export interface NormalizedTool {
       name: string;
       description: string;
       inputSchema: object; // MCP-shaped JSON Schema
     }

     export interface NormalizedMessage {
       role: 'user' | 'assistant' | 'tool';
       content: string;
       toolCallId?: string; // for role: 'tool'
       isError?: boolean;
     }

     export interface LLMProvider {
       readonly name: string;
       chat(req: {
         system: string;
         messages: NormalizedMessage[];
         tools: NormalizedTool[];
       }): AsyncIterable<LLMEvent>;
     }
     ```

   - `apps/api/src/clients/gemini.client.ts` — install `@google/genai`. Implement `LLMProvider`:
     - Translate `NormalizedTool[]` → Gemini `FunctionDeclaration[]` via `toGeminiSchema()` (strip `additionalProperties`, `$ref`, `oneOf` — Gemini's schema subset doesn't support them; one unit test per stripped feature).
     - Translate `NormalizedMessage[]` → Gemini `Content[]` (note: Gemini uses `user`/`model` roles, and tool results are `functionResponse` parts).
     - Stream via `models.generateContentStream(...)` and emit `LLMEvent`s.
     - Wrap the SDK call in `withBackoff(fn, 3)` — exponential backoff + jitter on 429/5xx/network errors only.

   - `apps/api/src/clients/anthropic.client.ts` — install `@anthropic-ai/sdk`. Implement `LLMProvider`:
     - Model: `claude-sonnet-4-6` (latest Sonnet 4.x).
     - `NormalizedTool` → Anthropic tool shape is nearly 1:1 (`inputSchema` → `input_schema`).
     - Stream events: `content_block_delta` text → `text` event; `content_block_start` with `tool_use` → buffer; `content_block_stop` for tool_use → `tool_call` event.
     - Same `withBackoff` wrapper.

   - `apps/api/src/clients/backoff.ts`:
     ```typescript
     export async function withBackoff<T>(fn: () => Promise<T>, max = 3): Promise<T> {
       for (let i = 0; i < max; i++) {
         try {
           return await fn();
         } catch (e) {
           if (!isTransient(e) || i === max - 1) throw e;
           const delay = Math.min(1000 * 2 ** i, 8000) + Math.random() * 250;
           await new Promise((r) => setTimeout(r, delay));
         }
       }
       throw new Error('unreachable');
     }
     ```

3. **Agent orchestrator + ToolBroker (backend)**

   Provider-agnostic. Knows about `LLMProvider`, `ToolBroker`, and conversation state — nothing else.
   - `apps/api/src/services/tool-broker.ts`:

     ```typescript
     import Ajv from 'ajv';
     import { toolRegistry } from '@orbit-ctrl/tools';

     const ajv = new Ajv();

     export class ToolBroker {
       async call(name: string, args: unknown): Promise<{ content: string; isError: boolean }> {
         const tool = toolRegistry.find((t) => t.name === name);
         if (!tool) return { content: `Unknown tool: ${name}`, isError: true };

         const validate = ajv.compile(tool.inputSchema);
         if (!validate(args)) {
           return { content: `Invalid args: ${ajv.errorsText(validate.errors)}`, isError: true };
         }

         try {
           const result = await tool.execute(args);
           return { content: JSON.stringify(result), isError: false };
         } catch (e) {
           return { content: `Tool error: ${(e as Error).message}`, isError: true };
         }
       }
     }
     ```

   - `apps/api/src/services/agent.service.ts`:

     ```typescript
     export class AgentService {
       constructor(
         private llm: LLMProvider,
         private broker: ToolBroker,
         private maxSelfCorrections = 3,
       ) {}

       async *chat(userMessage: string): AsyncIterable<string> {
         const messages: NormalizedMessage[] = [{ role: 'user', content: userMessage }];
         const tools = toolRegistry.map((t) => ({
           name: t.name,
           description: t.description,
           inputSchema: t.inputSchema,
         }));
         let consecutiveErrors = 0;

         while (true) {
           const pendingCalls: { id: string; name: string; args: unknown }[] = [];
           let assistantText = '';
           let stopReason: LLMEvent['type'] | string = '';

           for await (const evt of this.llm.chat({ system: SYSTEM_PROMPT, messages, tools })) {
             if (evt.type === 'text') {
               assistantText += evt.delta;
               yield evt.delta;
             } else if (evt.type === 'tool_call') {
               yield `\n→ Calling ${evt.name}...\n`;
               pendingCalls.push(evt);
             } else if (evt.type === 'stop') stopReason = evt.reason;
           }

           if (assistantText) messages.push({ role: 'assistant', content: assistantText });
           if (pendingCalls.length === 0) break; // end_turn

           let sawError = false;
           for (const call of pendingCalls) {
             const { content, isError } = await this.broker.call(call.name, call.args);
             messages.push({ role: 'tool', content, toolCallId: call.id, isError });
             if (isError) sawError = true;
           }

           if (sawError) {
             if (++consecutiveErrors >= this.maxSelfCorrections) {
               yield `\n[Aborting: ${this.maxSelfCorrections} consecutive tool errors]\n`;
               break;
             }
           } else {
             consecutiveErrors = 0;
           }
         }
       }
     }
     ```

   **Provider selection** at composition root (`apps/api/src/server.ts`):

   ```typescript
   const provider: LLMProvider =
     process.env.LLM_PROVIDER === 'anthropic'
       ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
       : new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! });
   ```

   Default is Gemini. The `.env.example` should ship with `LLM_PROVIDER=gemini` and a comment showing the Anthropic alternative.

4. **Agent endpoint (backend)**
   - `apps/api/src/routes/agent.ts`:

     ```typescript
     fastify.post('/agent/chat', async (req, reply) => {
       const { message } = req.body;

       reply.raw.writeHead(200, {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-cache',
         Connection: 'keep-alive',
       });

       for await (const chunk of agentService.chat(message)) {
         reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
       }

       reply.raw.end();
     });
     ```

5. **Agent Chat UI (frontend)**
   - `components/AgentChatPanel.tsx`:

     ```typescript
     export function AgentChatPanel() {
       const [messages, setMessages] = useState<Message[]>([]);
       const [input, setInput] = useState('');
       const [streaming, setStreaming] = useState(false);

       const sendMessage = async () => {
         const userMessage = { role: 'user', content: input };
         setMessages(prev => [...prev, userMessage]);
         setInput('');
         setStreaming(true);

         const response = await fetch('/api/agent/chat', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ message: input })
         });

         const reader = response.body.getReader();
         const decoder = new TextDecoder();
         let assistantMessage = { role: 'assistant', content: '' };
         setMessages(prev => [...prev, assistantMessage]);

         while (true) {
           const { done, value } = await reader.read();
           if (done) break;

           const text = decoder.decode(value);
           const lines = text.split('\n\n');

           for (const line of lines) {
             if (line.startsWith('data: ')) {
               const { chunk } = JSON.parse(line.slice(6));
               assistantMessage.content += chunk;
               setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }]);
             }
           }
         }

         setStreaming(false);
       };

       return (
         <div className="agent-chat">
           <div className="messages">
             {messages.map((m, i) => (
               <div key={i} className={`message message-${m.role}`}>
                 <ReactMarkdown>{m.content}</ReactMarkdown>
               </div>
             ))}
           </div>
           <input
             value={input}
             onChange={e => setInput(e.target.value)}
             onKeyDown={e => e.key === 'Enter' && sendMessage()}
             placeholder="Ask about satellites, space weather, anomalies..."
             disabled={streaming}
           />
         </div>
       );
     }
     ```

6. **Multi-hop query examples**
   Test these queries to verify tool chaining:
   - "Which satellites over Tokyo in next 2 hours have active anomalies?"
     - Should call `predict_passes` → `get_anomalies` → synthesize
   - "What's the current space weather and how might it affect satellites?"
     - Should call `get_space_weather` → explain implications
   - "Show me ISS position and predict its next pass over San Francisco"
     - Should call `get_satellite_position` → `predict_passes`

### Deliverable

- [x] `LLMProvider` interface + Gemini adapter (primary) + Anthropic adapter (secondary), selected via `LLM_PROVIDER` env var.
- [x] `ToolBroker` with Ajv schema validation; tool errors surface as `tool_result` with `isError: true` rather than throwing.
- [x] Agent orchestrator with conversation loop, tool dispatch, and a 3-strike cap on consecutive tool errors.
- [x] Transport-level retry (`withBackoff`) inside each adapter (unit tests pending).
- [x] `toGeminiSchema()` normalizer (unit tests pending).
- [x] Agent chat panel in right sidebar; response streams in real-time; tool calls visible as chips above each assistant message.
- [ ] Multi-hop test cases pass on **both** providers — requires API keys, manual verification.
- [x] Graceful degradation: missing API key disables the agent layer at startup with a warning; `/agent/chat` returns 503 with a setup hint. Transient upstream errors are retried by `withBackoff`.

**Time:** 18-24 hours (up from 14-18 due to dual-adapter + abstraction layer)

---

## Phase 5: MCP Server (Week 5)

**Goal:** MCP server exposing same tools to external AI clients (Claude Desktop, Cursor).

### Tasks

1. **MCP Server package**
   - `packages/mcp-server/package.json`:
     ```json
     {
       "name": "@orbit-ctrl/mcp-server",
       "type": "module",
       "main": "dist/index.js",
       "bin": {
         "orbit-ctrl-mcp": "./dist/index.js"
       },
       "dependencies": {
         "@modelcontextprotocol/sdk": "latest",
         "@orbit-ctrl/types": "workspace:*",
         "@orbit-ctrl/tools": "workspace:*"
       }
     }
     ```

2. **MCP server implementation**
   - `packages/mcp-server/src/index.ts`:

     ```typescript
     #!/usr/bin/env node
     import { Server } from '@modelcontextprotocol/sdk/server/index.js';
     import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
     import { toolRegistry } from '@orbit-ctrl/tools';

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
       if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);

       const result = await tool.execute(request.params.arguments);
       return {
         content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
       };
     });

     const transport = new StdioServerTransport();
     await server.connect(transport);
     ```

3. **Build and publish**
   - Add build script to `packages/mcp-server/package.json`:
     ```json
     {
       "scripts": {
         "build": "tsc",
         "prepublishOnly": "pnpm build"
       }
     }
     ```
   - Build: `pnpm --filter @orbit-ctrl/mcp-server build`
   - Link globally: `pnpm --filter @orbit-ctrl/mcp-server link --global`

4. **Claude Desktop configuration**
   - Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
     ```json
     {
       "mcpServers": {
         "orbit-ctrl": {
           "command": "orbit-ctrl-mcp",
           "env": {
             "API_BASE_URL": "http://localhost:3001"
           }
         }
       }
     }
     ```

5. **Testing**
   - Restart Claude Desktop
   - Verify MCP server appears in settings
   - Test queries:
     - "Using orbit-ctrl, what satellites are above Tokyo right now?"
     - "Check if there are any anomalies in the system"
     - "What's the current space weather?"

6. **Documentation**
   - `packages/mcp-server/README.md`:

     ````markdown
     # orbit.ctrl MCP Server

     MCP server exposing satellite tracking and space weather tools.

     ## Installation

     ```bash
     pnpm install -g @orbit-ctrl/mcp-server
     ```
     ````

     ## Configuration

     Add to Claude Desktop config:

     ```json
     {
       "mcpServers": {
         "orbit-ctrl": {
           "command": "orbit-ctrl-mcp"
         }
       }
     }
     ```

     ## Available Tools
     - `get_satellite_position` — Current or historical satellite position
     - `predict_passes` — Predict visible passes from a location
     - `get_space_weather` — Current space weather conditions
     - `get_satellite_telemetry` — Real-time telemetry for a satellite
     - `get_anomalies` — Active anomalies in the system
     - `find_satellites_above` — Satellites currently above a location

     ```

     ```

7. **Demo video**
   - Record 90-second screen capture:
     1. Show dashboard running with live telemetry
     2. Switch to Claude Desktop
     3. Ask: "What satellites are overhead with anomalies?"
     4. Show Claude using MCP tools to query the system
     5. Return to dashboard, confirm data matches
   - Upload to YouTube (unlisted)
   - Add link to main README

### Deliverable

- [ ] MCP server package built and globally linkable
- [ ] Claude Desktop can connect to server successfully
- [ ] External queries via Claude Desktop return correct data
- [ ] Demo video uploaded and linked in README
- [ ] README documentation explains setup for users

**Time:** 10-14 hours

---

## Phase 6: Polish + Ship (Week 6)

**Goal:** Production-ready deployment with case study documentation.

### Tasks

1. **Performance optimization**
   - Frontend:
     - Virtualize satellite list with `react-window`
     - Use Three.js GPU instancing for >100 satellites
     - Debounce telemetry chart updates to 10Hz instead of 1Hz
   - Backend:
     - Redis cache for orbital positions (1-minute TTL)
     - Rate limiting: 100 req/min per IP

2. **Loading states + error boundaries**
   - Add `<Suspense>` boundaries around:
     - Globe component (show spinner while Three.js loads)
     - Telemetry dashboard (show skeleton)
     - Agent chat (show "thinking..." indicator)
   - Error boundaries:
     - Catch WebSocket disconnection, show "reconnecting..." message
     - Catch API errors, show toast notification

3. **Deployment**
   - Frontend (Vercel):

     ```bash
     cd apps/web
     vercel --prod
     ```

     - Set env vars: `VITE_API_URL=https://api.orbit-ctrl.fly.dev`

   - Backend (Fly.io):

     ```bash
     cd apps/api
     fly launch
     fly deploy
     ```

     - Configure:

       ```toml
       # fly.toml
       [env]
         PORT = "8080"

       [[services]]
         internal_port = 8080
         protocol = "tcp"

         [[services.ports]]
           handlers = ["http"]
           port = 80

         [[services.ports]]
           handlers = ["tls", "http"]
           port = 443
       ```

4. **README documentation**
   - Update root `README.md`:

     ````markdown
     # orbit.ctrl — Satellite Mission Control Dashboard

     Real-time satellite tracking with AI-powered natural language queries.

     🌍 [Live Demo](https://orbit-ctrl.vercel.app) | 📺 [Demo Video](https://youtube.com/...)

     ## Features

     - 3D globe with 100+ satellites in real-time orbital motion
     - Telemetry simulation with anomaly detection
     - AI agent for natural language queries ("which satellites over Tokyo have anomalies?")
     - MCP server for external AI client integration
     - Space weather integration

     ## Architecture

     See [ARCHITECTURE.md](./ARCHITECTURE.md)

     ## Tech Stack

     - Frontend: React + TypeScript + Three.js + Vite
     - Backend: Node.js + TypeScript + Fastify + WebSocket
     - AI: Provider-agnostic `LLMProvider` abstraction over Gemini (primary, free tier) + Anthropic Claude (secondary). Direct SDKs, no LangChain.
     - MCP: @modelcontextprotocol/sdk
     - Data: Celestrak (TLE) + NOAA SWPC (space weather)

     ## Quick Start

     ```bash
     pnpm install
     pnpm dev
     ```
     ````

     Open http://localhost:5173

     ## MCP Server

     See [packages/mcp-server/README.md](./packages/mcp-server/README.md)

     ## Screenshots

     [Insert screenshots]

     ## Case Study

     [Link to blog post]

     ```

     ```

5. **Case study blog post**
   - Write on Medium/Dev.to (800-1200 words)
   - Structure:
     - **Problem**: Breaking into space industry requires demonstrating systems thinking
     - **Solution**: Build a mission control dashboard that shows real-world engineering
     - **Architecture**: Explain 4-layer design with diagram
     - **Technical decisions**: Why globe.gl, why WebSocket, why MCP
     - **Challenges**: Orbital mechanics, realistic telemetry simulation, multi-hop agent queries
     - **Results**: Live demo, MCP integration, production deployment
   - Include:
     - 3-4 screenshots from dashboard
     - Embed demo video
     - Link to GitHub repo
     - Link to live site

6. **Screenshots**
   - Capture:
     - Full dashboard view (1440x900)
     - Globe with multiple satellites and ground tracks
     - Telemetry strip showing live data
     - Agent chat showing multi-hop query
     - Claude Desktop using MCP server
   - Optimize to <500KB each (use TinyPNG)
   - Add to `docs/images/`

7. **Final testing checklist**
   - [ ] TLE data refreshes correctly after 24 hours
   - [ ] WebSocket reconnects automatically on disconnect
   - [ ] All 6 tools callable via MCP server
   - [ ] Agent handles malformed queries gracefully
   - [ ] Mobile responsive (at least tablet)
   - [ ] No console errors
   - [ ] Lighthouse score >90

### Deliverable

- [ ] Live URL: https://orbit-ctrl.vercel.app
- [ ] GitHub repo: public, with comprehensive README
- [ ] Demo video: 90 seconds, uploaded to YouTube
- [ ] Case study: published on Medium/Dev.to
- [ ] All screenshots captured and optimized
- [ ] MCP server documented and testable

**Time:** 12-16 hours

---

## Total Timeline

- Phase 0: 6-8 hours
- Phase 1: 12-16 hours
- Phase 2: 10-14 hours
- Phase 3: 14-18 hours
- Phase 4: 18-24 hours
- Phase 5: 10-14 hours
- Phase 6: 12-16 hours

**Total: 82-110 hours** (~3-4 weeks full-time or 6-7 weeks part-time)

## Risk Mitigation

**Risk: Orbital calculations are incorrect**

- Mitigation: Compare against known satellite positions from N2YO API
- Test case: ISS position should match within 50km of published data

**Risk: WebSocket performance degrades with many satellites**

- Mitigation: Implement room-based subscriptions, only stream satellites user is viewing
- Fallback: Reduce update frequency to 2s instead of 1s

**Risk: AI agent fails on edge cases**

- Mitigation: Add comprehensive tool testing, mock API responses
- Fallback: Provide example queries in UI, disable freeform input

**Risk: Deployment complexity**

- Mitigation: Use platforms with zero-config (Vercel, Fly.io)
- Fallback: Deploy frontend only, mock backend responses

## Post-Launch

After initial 6 weeks:

- Add more satellites (currently ~10, expand to 100+)
- Implement user accounts (save favorite satellites)
- Add historical playback (see orbital positions from past)
- Integrate amateur radio frequencies (contact satellites)
- Mobile app (React Native, share code with web)
