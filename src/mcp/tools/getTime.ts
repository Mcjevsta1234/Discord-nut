/**
 * Get Time Tool
 * A simple read-only tool that returns the current date and time
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class GetTimeTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'get_time',
    description: 'Get the current date and time. Returns Discord absolute timestamp by default for user-facing messages.',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Optional format: "discord" (default, returns <t:UNIX:f> absolute), "iso", "locale", or "unix"',
        required: false,
        default: 'discord',
      },
      {
        name: 'timezone',
        type: 'string',
        description: 'Optional timezone (e.g., "America/New_York", "UTC"). Only applies to "locale" format',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const format = params.format || 'discord';
      const timezone = params.timezone;
      const now = new Date();
      const unixTimestamp = Math.floor(now.getTime() / 1000);

      let timeString: string;
      let additionalInfo: any = {};

      switch (format) {
        case 'discord':
          // Return Discord absolute timestamp format for chat-friendly display
          timeString = `<t:${unixTimestamp}:f>`;
          additionalInfo.note = 'Discord absolute timestamp (full date and time)';
          break;
        case 'iso':
          timeString = now.toISOString();
          break;
        case 'locale':
          if (timezone) {
            timeString = now.toLocaleString('en-US', { timeZone: timezone });
            additionalInfo.timezone = timezone;
          } else {
            timeString = now.toLocaleString();
          }
          break;
        case 'unix':
          timeString = unixTimestamp.toString();
          additionalInfo.unit = 'seconds';
          break;
        default:
          return {
            success: false,
            error: `Invalid format: ${format}. Use "discord", "iso", "locale", or "unix"`,
          };
      }

      return {
        success: true,
        data: {
          time: timeString,
          format,
          ...additionalInfo,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting time',
      };
    }
  }
}
