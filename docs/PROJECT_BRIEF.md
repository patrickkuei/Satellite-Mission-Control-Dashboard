# orbit.ctrl — Satellite Mission Control Dashboard

## Project Overview

A production-grade satellite mission control dashboard showcasing full-stack engineering, AI agent integration, and real-time data visualization. Built as a portfolio piece targeting space industry positions.

## What We're Building

An interactive web application that:
- Tracks 100+ satellites in real-time with 3D orbital visualization
- Simulates mission-critical telemetry with anomaly detection
- Provides natural language query interface via AI agent
- Exposes functionality through MCP (Model Context Protocol) server for external AI clients
- Demonstrates reliability-focused engineering suitable for space tech companies

## Core Value Proposition

This isn't just another satellite tracker. It demonstrates:

1. **System Architecture** — Multi-layer design with clear separation: data sources → core services → gateway → frontend + MCP server
2. **Real-time Performance** — WebSocket streaming, efficient rendering of dynamic orbital data
3. **AI Agent Integration** — Multi-hop reasoning with tool calling, visible decision steps
4. **Production Quality** — TypeScript strict mode, monorepo structure, CI/CD ready
5. **Forward-thinking Tech** — MCP server integration shows familiarity with emerging AI tooling standards

## Target Audience

Space industry hiring managers and engineers at:
- ispace (lunar exploration, Tokyo-based)
- Axelspace (microsatellites, Tokyo-based)
- Astroscale (orbital debris removal, Tokyo-based)
- SpaceX, Planet Labs, Maxar (ground systems teams)
- ALE (artificial meteor showers, Tokyo-based)

These companies need engineers who can build ground software, mission operations tools, and satellite data platforms — exactly what this project demonstrates.

## Technical Highlights

- **Frontend**: React + TypeScript + Three.js (globe.gl wrapper) + Vite
- **Backend**: Node.js + TypeScript + Fastify + WebSocket
- **Data Sources**: Celestrak (TLE), NOAA Space Weather Prediction Center
- **AI Layer**: Claude API with tool calling, visible reasoning steps
- **MCP Server**: External AI client integration (Claude Desktop, Cursor)
- **Testing**: Jest with 80%+ coverage via AI-assisted test generation
- **Deployment**: Vercel (frontend) + Fly.io (backend with WebSocket support)

## Success Metrics

Portfolio piece is successful when:
1. Live URL is demoable in interviews without setup
2. README clearly explains technical decisions
3. Demo video (90 seconds) shows all three "wow moments":
   - Real-time orbital tracking with 3D globe
   - AI agent answering complex multi-hop queries with visible reasoning
   - MCP server allowing Claude Desktop to query the system
4. Code is production-quality: strict TypeScript, error boundaries, loading states
5. Case study blog post articulates design decisions

## Timeline

6 weeks part-time (3 hours/day) or 3-4 weeks full-time.

See IMPLEMENTATION_PLAN.md for detailed phase breakdown.
