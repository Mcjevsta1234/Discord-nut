/**
 * MCP Client
 * Handles tool execution and provides abstraction layer for MCP operations
 */

import { MCPTool, MCPToolResult, MCPToolParameter } from './types';
import { ToolRegistry } from './toolRegistry';

export class MCPClient {
  private toolRegistry: ToolRegistry;

  constructor() {
    this.toolRegistry = new ToolRegistry();
  }

  /**
   * Get the tool registry for registering custom tools
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Execute a tool by name with given parameters
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>
  ): Promise<MCPToolResult> {
    try {
      const tool = this.toolRegistry.getTool(toolName);
      
      if (!tool) {
        return {
          success: false,
          error: `Tool '${toolName}' not found. Available tools: ${this.toolRegistry.listTools().join(', ')}`,
        };
      }

      // Validate required parameters
      const missing = tool.definition.parameters
        .filter((p: MCPToolParameter) => p.required && !(p.name in params))
        .map((p: MCPToolParameter) => p.name);

      if (missing.length > 0) {
        return {
          success: false,
          error: `Missing required parameters: ${missing.join(', ')}`,
        };
      }

      // Execute the tool
      const startTime = Date.now();
      const result = await tool.execute(params);
      const executionTime = Date.now() - startTime;

      // Add execution metadata
      return {
        ...result,
        metadata: {
          ...result.metadata,
          executionTime,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get list of all available tools with their definitions
   */
  getAvailableTools(): Array<{ name: string; description: string }> {
    return this.toolRegistry.listTools().map((name: string) => {
      const tool = this.toolRegistry.getTool(name);
      return {
        name,
        description: tool?.definition.description || '',
      };
    });
  }

  /**
   * Get detailed definition for a specific tool
   */
  getToolDefinition(toolName: string) {
    const tool = this.toolRegistry.getTool(toolName);
    return tool?.definition;
  }
}
