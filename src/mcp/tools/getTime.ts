/**
 * Get Time Tool
 * A simple read-only tool that returns the current date and time
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class GetTimeTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'get_time',
    description: 'Get the current date and time in ISO 8601 format or a custom format',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Optional format: "iso", "locale", or "unix". Default is "iso"',
        required: false,
        default: 'iso',
      },
      {
        name: 'timezone',
        type: 'string',
        description: 'Optional timezone (e.g., "America/New_York", "UTC"). Default is local timezone',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const format = params.format || 'iso';
      const timezone = params.timezone;
      const now = new Date();

      let timeString: string;
      let additionalInfo: any = {};

      switch (format) {
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
          timeString = Math.floor(now.getTime() / 1000).toString();
          additionalInfo.unit = 'seconds';
          break;
        default:
          return {
            success: false,
            error: `Invalid format: ${format}. Use "iso", "locale", or "unix"`,
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
