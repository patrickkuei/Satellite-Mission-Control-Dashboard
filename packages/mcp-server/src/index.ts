#!/usr/bin/env node
/**
 * @orbit-ctrl/mcp-server — Phase 0 stub.
 *
 * Full MCP server lands in Phase 5 (see docs/IMPLEMENTATION_PLAN.md). For now
 * this file exists so the workspace resolves and the build pipeline is wired up.
 *
 * @packageDocumentation
 */

import { toolDefinitions } from '@orbit-ctrl/tools';

/**
 * Entry point. Prints the registered tools and exits. Replaced in Phase 5
 * with a full `@modelcontextprotocol/sdk` stdio server.
 */
function main(): void {
  console.warn(
    `[orbit-ctrl-mcp] Phase 0 stub. ${toolDefinitions.length} tools registered. ` +
      `Full implementation lands in Phase 5.`,
  );
}

main();
