# orbit.ctrl MCP Server

MCP server exposing satellite tracking, space weather, and telemetry tools to external AI clients (Claude Desktop, Cursor, etc.).

The server connects to a running `apps/api` instance over HTTP and forwards requests. All business logic stays in the API; the MCP server is a thin transport adapter.

## Prerequisites

- `apps/api` running locally (`pnpm dev` from repo root, or `pnpm --filter ./apps/api dev`)
- Node.js 18+

## Build

```bash
pnpm --filter @orbit-ctrl/mcp-server build
```

## Claude Desktop configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "orbit-ctrl": {
      "command": "node",
      "args": ["C:/path/to/orbit-ctrl/packages/mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

Replace `C:/path/to/orbit-ctrl` with the absolute path to your clone. Restart Claude Desktop after saving.

## Environment variables

| Variable       | Default                 | Description                    |
| -------------- | ----------------------- | ------------------------------ |
| `API_BASE_URL` | `http://localhost:3001` | Base URL of the orbit.ctrl API |

## Available tools

| Tool                      | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `get_satellite_position`  | Current or historical position (lat/lon/alt/velocity) of a tracked satellite  |
| `predict_passes`          | Predict when a satellite will be visible from a ground location               |
| `get_space_weather`       | Current Kp index, solar wind, X-ray flux, and storm summary                   |
| `get_satellite_telemetry` | Latest simulated telemetry (voltage, temperature, attitude) for one satellite |
| `get_anomalies`           | Recent anomaly detections from the health monitor                             |
| `find_satellites_above`   | All tracked satellites currently above the horizon at a location              |

## Example queries (in Claude Desktop)

- "Using orbit-ctrl, what satellites are above Tokyo right now?"
- "Check if there are any anomalies in the last 10 minutes"
- "What's the current space weather and is it affecting ISS?"
- "When is the next ISS pass over London?"
