/**
 * MCP (Model Context Protocol) Type Definitions
 * Defines interfaces for MCP tools and their execution
 */

export interface MCPToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: any;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: MCPToolParameter[];
}

export interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    timestamp?: string;
    executionTime?: number;
    [key: string]: any;
  };
}

export interface MCPTool {
  // Tool metadata
  definition: MCPToolDefinition;
  
  // Tool execution
  execute(params: Record<string, any>): Promise<MCPToolResult>;
}
