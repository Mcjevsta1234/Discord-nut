/**
 * Unit Converter Tool
 * Converts between common units for length, weight, temperature, and storage
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

interface ConversionRate {
  [key: string]: number;
}

export class UnitConverterTool implements MCPTool {
  private readonly conversions: { [category: string]: ConversionRate } = {
    // Base unit: meters
    length: {
      m: 1,
      km: 0.001,
      cm: 100,
      mm: 1000,
      mi: 0.000621371,
      ft: 3.28084,
      in: 39.3701,
      yd: 1.09361,
    },
    // Base unit: kilograms
    weight: {
      kg: 1,
      g: 1000,
      mg: 1000000,
      lb: 2.20462,
      oz: 35.274,
      ton: 0.001,
    },
    // Temperature handled separately
    temperature: {
      C: 1,
      F: 1,
      K: 1,
    },
    // Base unit: bytes
    storage: {
      B: 1,
      KB: 1 / 1024,
      MB: 1 / (1024 * 1024),
      GB: 1 / (1024 * 1024 * 1024),
      TB: 1 / (1024 * 1024 * 1024 * 1024),
    },
  };

  definition: MCPToolDefinition = {
    name: 'convert_units',
    description: 'Convert between units. Supports length (m/km/mi/ft/in), weight (kg/lb/oz), temperature (C/F/K), storage (B/KB/MB/GB/TB).',
    parameters: [
      {
        name: 'value',
        type: 'number',
        description: 'Numeric value to convert',
        required: true,
      },
      {
        name: 'from_unit',
        type: 'string',
        description: 'Source unit (e.g., "km", "lb", "C", "MB")',
        required: true,
      },
      {
        name: 'to_unit',
        type: 'string',
        description: 'Target unit (e.g., "mi", "kg", "F", "GB")',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const value = Number(params.value);
      const fromUnit = String(params.from_unit);
      const toUnit = String(params.to_unit);

      if (isNaN(value)) {
        return {
          success: false,
          error: 'Invalid numeric value',
        };
      }

      // Find category for units
      const category = this.findCategory(fromUnit, toUnit);

      if (!category) {
        return {
          success: false,
          error: `Unsupported unit conversion: ${fromUnit} to ${toUnit}`,
        };
      }

      let result: number;

      if (category === 'temperature') {
        result = this.convertTemperature(value, fromUnit, toUnit);
      } else {
        result = this.convertUnit(value, fromUnit, toUnit, category);
      }

      // Format result
      const formatted = Number.isInteger(result)
        ? result.toString()
        : result.toFixed(4).replace(/\.?0+$/, '');

      return {
        success: true,
        data: `**${value} ${fromUnit}** = **${formatted} ${toUnit}**`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error converting units',
      };
    }
  }

  private findCategory(fromUnit: string, toUnit: string): string | null {
    for (const [category, units] of Object.entries(this.conversions)) {
      if (units[fromUnit] !== undefined && units[toUnit] !== undefined) {
        return category;
      }
    }
    return null;
  }

  private convertUnit(value: number, from: string, to: string, category: string): number {
    const rates = this.conversions[category];
    
    // Convert to base unit, then to target unit
    const baseValue = value / rates[from];
    return baseValue * rates[to];
  }

  private convertTemperature(value: number, from: string, to: string): number {
    // Convert to Celsius first
    let celsius: number;
    
    switch (from) {
      case 'C':
        celsius = value;
        break;
      case 'F':
        celsius = (value - 32) * 5 / 9;
        break;
      case 'K':
        celsius = value - 273.15;
        break;
      default:
        throw new Error(`Unknown temperature unit: ${from}`);
    }

    // Convert from Celsius to target
    switch (to) {
      case 'C':
        return celsius;
      case 'F':
        return celsius * 9 / 5 + 32;
      case 'K':
        return celsius + 273.15;
      default:
        throw new Error(`Unknown temperature unit: ${to}`);
    }
  }
}
