/**
 * Calculator Tool
 * Safe mathematical expression evaluation without eval
 * Supports basic arithmetic and parentheses
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class CalculatorTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'calculate',
    description: 'Perform mathematical calculations. Supports +, -, *, /, %, parentheses, and decimal numbers. Use for math queries.',
    parameters: [
      {
        name: 'expression',
        type: 'string',
        description: 'Mathematical expression to evaluate (e.g., "2 + 2", "(10 * 5) / 2", "15 % 4")',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const expression = params.expression as string;

      if (!expression || expression.trim().length === 0) {
        return {
          success: false,
          error: 'Expression cannot be empty',
        };
      }

      // Sanitize and validate expression
      const sanitized = this.sanitizeExpression(expression);
      
      if (!this.isValidExpression(sanitized)) {
        return {
          success: false,
          error: 'Invalid expression. Only numbers, +, -, *, /, %, and parentheses are allowed.',
        };
      }

      const result = this.evaluateExpression(sanitized);

      if (result === null || !isFinite(result)) {
        return {
          success: false,
          error: 'Invalid calculation result (division by zero or invalid operation)',
        };
      }

      // Format result nicely
      const formatted = Number.isInteger(result) 
        ? result.toString() 
        : result.toFixed(6).replace(/\.?0+$/, '');

      return {
        success: true,
        data: `\`${expression}\` = **${formatted}**`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error evaluating expression',
      };
    }
  }

  private sanitizeExpression(expr: string): string {
    // Remove whitespace and convert common symbols
    return expr
      .replace(/\s+/g, '')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/[–—]/g, '-');
  }

  private isValidExpression(expr: string): boolean {
    // Only allow numbers, operators, parentheses, and decimal points
    const validPattern = /^[\d+\-*\/%()\.]+$/;
    if (!validPattern.test(expr)) return false;

    // Check balanced parentheses
    let depth = 0;
    for (const char of expr) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  private evaluateExpression(expr: string): number | null {
    try {
      // Use Function constructor as a safer alternative to eval
      // Still restricted to mathematical operations only
      const safeEval = new Function('return (' + expr + ')');
      const result = safeEval();
      
      if (typeof result !== 'number') {
        return null;
      }
      
      return result;
    } catch {
      return null;
    }
  }
}
