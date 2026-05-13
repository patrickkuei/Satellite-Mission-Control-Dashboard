/**
 * `@orbit-ctrl/types` — single source of truth for cross-layer contracts.
 *
 * Every shared shape is defined here as a **Zod schema first**, with its
 * TypeScript type derived via `z.infer<typeof FooSchema>`. Schemas describe
 * the **wire shape**: all timestamps are ISO 8601 strings, all units follow
 * SI / standard astronomical conventions (km, km/s, degrees).
 *
 * Why schema-first: one definition gives us runtime validation (frontend WS
 * parsing, backend route validation, MCP tool I/O) and compile-time types
 * with no chance of drift between them.
 *
 * @packageDocumentation
 */
export * from './satellite.js';
export * from './position.js';
export * from './telemetry.js';
export * from './anomaly.js';
export * from './pass.js';
export * from './observer.js';
export * from './weather.js';
export * from './ws.js';
export * from './health.js';
