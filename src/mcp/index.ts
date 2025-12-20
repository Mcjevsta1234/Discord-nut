/**
 * MCP Tools Index
 * Exports all available MCP tools and provides a registration helper
 */

import { MCPClient } from './client';
import { GetTimeTool } from './tools/getTime';
import { SearxNGSearchTool } from './tools/searxngSearch';
import { FetchUrlTool } from './tools/fetchUrl';
import { MinecraftStatusTool } from './tools/minecraftStatus';
import { GitHubInfoTool } from './tools/githubInfo';
import { CalculatorTool } from './tools/calculator';
import { UnitConverterTool } from './tools/unitConverter';
import { CurrencyConverterTool } from './tools/currencyConverter';
import { InfoUtilsTool } from './tools/infoUtils';

/**
 * Register all default MCP tools with the client
 */
export function registerDefaultTools(mcpClient: MCPClient): void {
  const registry = mcpClient.getToolRegistry();

  // Register built-in tools
  registry.register(new GetTimeTool());
  registry.register(new SearxNGSearchTool()); // Deterministic web search
  registry.register(new FetchUrlTool()); // URL content fetcher
  registry.register(new MinecraftStatusTool());
  registry.register(new GitHubInfoTool());
  registry.register(new CalculatorTool());
  registry.register(new UnitConverterTool());
  registry.register(new CurrencyConverterTool());
  registry.register(new InfoUtilsTool());

  console.log(`Registered ${registry.count()} MCP tools`);
}

// Export MCP components
export { MCPClient } from './client';
export { ToolRegistry } from './toolRegistry';
export * from './types';

// Export individual tools for custom registration
export { GetTimeTool } from './tools/getTime';
export { SearxNGSearchTool } from './tools/searxngSearch';
export { FetchUrlTool } from './tools/fetchUrl';
export { MinecraftStatusTool } from './tools/minecraftStatus';
export { GitHubInfoTool } from './tools/githubInfo';
export { CalculatorTool } from './tools/calculator';
export { UnitConverterTool } from './tools/unitConverter';
export { CurrencyConverterTool } from './tools/currencyConverter';
export { InfoUtilsTool } from './tools/infoUtils';
