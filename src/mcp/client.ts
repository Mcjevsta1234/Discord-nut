import { getTool } from './tools';
import { McpToolResult } from './types';

export class McpClient {
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    const tool = getTool(toolName);
    if (!tool) {
      return {
        success: false,
        content: `Unknown tool: ${toolName}`,
      };
    }

    return tool.execute(args);
  }
}
