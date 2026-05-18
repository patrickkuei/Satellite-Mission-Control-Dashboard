# orbit.ctrl — Satellite Mission Control Dashboard

Real-time satellite tracking with an AI agent you can talk to.

🌍 **[Live Demo](https://patrickkuei.github.io/Satellite-Mission-Control-Dashboard/)**

> API runs on Render free tier — first load after idle may take ~30 s.

---

## What it does

- 3D globe with 50 LEO satellites in live orbital motion — click to select, see ground track and upcoming passes
- 10 Hz telemetry stream with voltage, temperature, and attitude sparklines; Z-score anomaly detection with alert log
- **AI agent** — ask questions in natural language: _"which satellites overhead have active anomalies?"_ Streams answers in real time with visible tool calls across Gemini → Groq → Anthropic fallback chain
- **MCP server** — exposes the same 6 tools to Claude Desktop / Cursor via stdio so external AI clients can query the system too
- Space weather overlay (Kp index + auroral oval)

## Stack

React · TypeScript · Vite · Three.js · Recharts · Zustand · TanStack Query · Fastify · WebSocket · Gemini · Groq · Anthropic · MCP SDK

## Quick Start

```bash
corepack enable
pnpm install
cp .env.example .env   # add at least one LLM API key
pnpm dev               # web → :5173  ·  api → :3001
```

## MCP Server

```bash
pnpm --filter @orbit-ctrl/mcp-server build
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "orbit-ctrl": {
      "command": "node",
      "args": ["<absolute-path>/packages/mcp-server/dist/index.js"],
      "env": { "API_BASE_URL": "http://localhost:3001" }
    }
  }
}
```

See [`packages/mcp-server/README.md`](./packages/mcp-server/README.md) for details.
