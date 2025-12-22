/**
 * Minecraft Server Status Tool
 * Checks Java Minecraft server status using mcstatus.io API (no API key required)
 * Returns Discord-friendly status information
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios from 'axios';

interface MinecraftServerStatus {
  online: boolean;
  host: string;
  port: number;
  players?: {
    online: number;
    max: number;
  };
  version?: string;
  motd?: {
    clean?: string;
  };
}

export class MinecraftStatusTool implements MCPTool {
  private readonly DEFAULT_SERVERS = [
    'atm10.witchyworlds.top',
    'sb4.witchyworlds.top',
    'tts10.witchyworlds.top',
    'valley.witchyworlds.top',
  ];

  definition: MCPToolDefinition = {
    name: 'minecraft_status',
    description: 'Check Minecraft server status with IPs, player counts, and online status. If no server specified, checks WitchyWorlds network (atm10, sb4, tts10, valley). Use for: "server status", "server ips", "mc network", "servers online", "how are servers".',
    parameters: [
      {
        name: 'server',
        type: 'string',
        description: 'Optional server hostname or IP to check. If not provided, checks all default WitchyWorlds servers.',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const serverParam = params.server as string | undefined;
      const serversToCheck = serverParam ? [serverParam] : this.DEFAULT_SERVERS;

      const results = await Promise.allSettled(
        serversToCheck.map((server) => this.checkServer(server))
      );

      // Format results for Discord display
      const statusLines: string[] = [];

      for (let i = 0; i < serversToCheck.length; i++) {
        const server = serversToCheck[i];
        const result = results[i];

        if (result.status === 'fulfilled' && result.value) {
          const status = result.value;
          if (status.online) {
            const playerInfo = status.players
              ? ` - ${status.players.online}/${status.players.max} players`
              : '';
            statusLines.push(`✅ \`${server}\` - Online${playerInfo}`);
          } else {
            statusLines.push(`❌ \`${server}\` - Offline`);
          }
        } else {
          statusLines.push(`❌ \`${server}\` - Unreachable or error`);
        }
      }

      const summary = serverParam
        ? `**Server Status: ${serverParam}**`
        : `**WitchyWorlds Network Status**`;

      return {
        success: true,
        data: `${summary}\n\n${statusLines.join('\n')}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error checking server status',
      };
    }
  }

  private async checkServer(hostname: string): Promise<MinecraftServerStatus | null> {
    try {
      // Use mcstatus.io public API - no authentication required
      const response = await axios.get(
        `https://api.mcstatus.io/v2/status/java/${hostname}`,
        {
          timeout: 10000, // 10 second timeout
          headers: {
            'User-Agent': 'Discord-nut-bot/1.0',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error checking Minecraft server ${hostname}:`, error);
      return null;
    }
  }
}
