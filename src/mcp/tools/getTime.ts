/**
 * Get Time Tool
 * Returns Discord-formatted timestamps for chat display
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class GetTimeTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'get_time',
    description: 'Get current time as a Discord timestamp. Returns <t:UNIX:s> format by default.',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Discord timestamp format: "s" (short time, default), "f" (full date+time), "R" (relative). Or "unix" for raw seconds.',
        required: false,
        default: 's',
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const format = params.format || 's';
      const now = new Date();
      const unixTimestamp = Math.floor(now.getTime() / 1000);

      let result: string;

      // Generate Discord timestamp or raw unix
      switch (format) {
        case 's': // Short time (e.g., "12:00 PM")
        case 'f': // Full date and time
        case 'R': // Relative (e.g., "2 hours ago")
        case 't': // Short time
        case 'T': // Long time
        case 'D': // Short date
        case 'F': // Long date
          result = `<t:${unixTimestamp}:${format}>`;
          break;
        case 'unix':
          result = unixTimestamp.toString();
          break;
        default:
          return {
            success: false,
            error: `Invalid format: ${format}. Use Discord formats (s/f/R/t/T/D/F) or "unix"`,
          };
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting time',
      };
    }
  }
}
