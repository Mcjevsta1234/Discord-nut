/**
 * MCP Tools Index
 * Exports all available MCP tools and provides a registration helper
 */

import { MCPClient } from './client';
import { GetTimeTool } from './tools/getTime';
import { WebSearchTool } from './tools/webSearch';

/**
 * Register all default MCP tools with the client
 */
export function registerDefaultTools(mcpClient: MCPClient): void {
  const registry = mcpClient.getToolRegistry();

  // Register built-in tools
  registry.register(new GetTimeTool());
  registry.register(new WebSearchTool());

  console.log(`Registered ${registry.count()} MCP tools`);
}

// Export MCP components
export { MCPClient } from './client';
export { ToolRegistry } from './toolRegistry';
export * from './types';

// Export individual tools for custom registration
export { GetTimeTool } from './tools/getTime';
export { WebSearchTool } from './tools/webSearch';
