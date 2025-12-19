/**
 * Info Utilities Tool
 * Various utility functions: UUID generation, random numbers, percentages, base64, hashing
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import { randomBytes, createHash } from 'crypto';

export class InfoUtilsTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'info_utils',
    description: 'Utility functions: generate UUID, random number, calculate percentage, encode/decode base64, hash text (sha256).',
    parameters: [
      {
        name: 'operation',
        type: 'string',
        description: 'Operation: "uuid", "random", "percentage", "base64_encode", "base64_decode", "hash"',
        required: true,
      },
      {
        name: 'input',
        type: 'string',
        description: 'Input value (for base64, hash, or percentage calculation)',
        required: false,
      },
      {
        name: 'min',
        type: 'number',
        description: 'Minimum value for random number generation',
        required: false,
      },
      {
        name: 'max',
        type: 'number',
        description: 'Maximum value for random number generation',
        required: false,
      },
      {
        name: 'part',
        type: 'number',
        description: 'Part value for percentage calculation',
        required: false,
      },
      {
        name: 'whole',
        type: 'number',
        description: 'Whole value for percentage calculation',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const operation = params.operation as string;

      switch (operation) {
        case 'uuid':
          return this.generateUUID();
        
        case 'random':
          return this.generateRandom(params.min, params.max);
        
        case 'percentage':
          return this.calculatePercentage(params.part, params.whole);
        
        case 'base64_encode':
          return this.base64Encode(params.input);
        
        case 'base64_decode':
          return this.base64Decode(params.input);
        
        case 'hash':
          return this.hashText(params.input);
        
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}. Use: uuid, random, percentage, base64_encode, base64_decode, hash`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error executing utility operation',
      };
    }
  }

  private generateUUID(): MCPToolResult {
    // Generate UUIDv4
    const bytes = randomBytes(16);
    
    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    
    const hex = bytes.toString('hex');
    const uuid = [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32),
    ].join('-');

    return {
      success: true,
      data: `\`${uuid}\``,
    };
  }

  private generateRandom(min?: number, max?: number): MCPToolResult {
    const minVal = min ?? 0;
    const maxVal = max ?? 100;

    if (minVal >= maxVal) {
      return {
        success: false,
        error: 'Minimum must be less than maximum',
      };
    }

    const random = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;

    return {
      success: true,
      data: `Random number (${minVal}-${maxVal}): **${random}**`,
    };
  }

  private calculatePercentage(part?: number, whole?: number): MCPToolResult {
    if (part === undefined || whole === undefined) {
      return {
        success: false,
        error: 'Both "part" and "whole" parameters are required for percentage calculation',
      };
    }

    if (whole === 0) {
      return {
        success: false,
        error: 'Cannot calculate percentage with zero as whole',
      };
    }

    const percentage = (part / whole) * 100;
    const formatted = percentage.toFixed(2).replace(/\.?0+$/, '');

    return {
      success: true,
      data: `**${part}** is **${formatted}%** of **${whole}**`,
    };
  }

  private base64Encode(input?: string): MCPToolResult {
    if (!input) {
      return {
        success: false,
        error: 'Input text is required for base64 encoding',
      };
    }

    const encoded = Buffer.from(input, 'utf-8').toString('base64');

    return {
      success: true,
      data: `\`${encoded}\``,
    };
  }

  private base64Decode(input?: string): MCPToolResult {
    if (!input) {
      return {
        success: false,
        error: 'Input text is required for base64 decoding',
      };
    }

    try {
      const decoded = Buffer.from(input, 'base64').toString('utf-8');

      return {
        success: true,
        data: `\`${decoded}\``,
      };
    } catch {
      return {
        success: false,
        error: 'Invalid base64 string',
      };
    }
  }

  private hashText(input?: string): MCPToolResult {
    if (!input) {
      return {
        success: false,
        error: 'Input text is required for hashing',
      };
    }

    const hash = createHash('sha256').update(input).digest('hex');

    return {
      success: true,
      data: `SHA256: \`${hash}\``,
    };
  }
}
