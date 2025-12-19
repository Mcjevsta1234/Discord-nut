export interface McpToolResult {
  success: boolean;
  content: string;
  data?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<McpToolResult>;
}
