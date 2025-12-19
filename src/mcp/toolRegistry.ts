/**
 * Tool Registry
 * Manages registration and retrieval of MCP tools
 */

import { MCPTool } from './types';

export class ToolRegistry {
  private tools: Map<string, MCPTool>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool
   */
  register(tool: MCPTool): void {
    if (this.tools.has(tool.definition.name)) {
      console.warn(
        `Tool '${tool.definition.name}' is already registered. Overwriting.`
      );
    }
    this.tools.set(tool.definition.name, tool);
    console.log(`Registered MCP tool: ${tool.definition.name}`);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tool names
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get count of registered tools
   */
  count(): number {
    return this.tools.size;
  }
}
