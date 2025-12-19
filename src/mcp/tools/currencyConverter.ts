/**
 * Currency Converter Tool
 * Converts between currencies using cached exchange rates
 * No API keys required - uses static/cached rates
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class CurrencyConverterTool implements MCPTool {
  // Static exchange rates (base: USD) - updated periodically
  private readonly rates: { [currency: string]: number } = {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 149.50,
    AUD: 1.52,
    CAD: 1.36,
    CHF: 0.88,
    CNY: 7.24,
    INR: 83.12,
    MXN: 17.08,
    BRL: 4.97,
    ZAR: 18.35,
    KRW: 1310.50,
    SGD: 1.34,
    NZD: 1.63,
    HKD: 7.81,
    SEK: 10.35,
    NOK: 10.68,
    DKK: 6.87,
    PLN: 3.98,
    THB: 34.85,
    IDR: 15650.00,
    HUF: 355.20,
    CZK: 22.48,
    ILS: 3.64,
    PHP: 55.75,
    AED: 3.67,
    CLP: 970.50,
    SAR: 3.75,
    MYR: 4.46,
    RON: 4.57,
  };

  definition: MCPToolDefinition = {
    name: 'convert_currency',
    description: 'Convert between currencies using cached exchange rates. Supports USD, EUR, GBP, JPY, AUD, CAD, CHF, CNY, INR, and 20+ more.',
    parameters: [
      {
        name: 'amount',
        type: 'number',
        description: 'Amount to convert',
        required: true,
      },
      {
        name: 'from_currency',
        type: 'string',
        description: 'Source currency code (e.g., "USD", "EUR", "GBP")',
        required: true,
      },
      {
        name: 'to_currency',
        type: 'string',
        description: 'Target currency code (e.g., "USD", "EUR", "GBP")',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const amount = Number(params.amount);
      const fromCurrency = String(params.from_currency).toUpperCase();
      const toCurrency = String(params.to_currency).toUpperCase();

      if (isNaN(amount) || amount < 0) {
        return {
          success: false,
          error: 'Invalid amount',
        };
      }

      if (!this.rates[fromCurrency]) {
        return {
          success: false,
          error: `Unsupported currency: ${fromCurrency}. Supported: ${Object.keys(this.rates).join(', ')}`,
        };
      }

      if (!this.rates[toCurrency]) {
        return {
          success: false,
          error: `Unsupported currency: ${toCurrency}. Supported: ${Object.keys(this.rates).join(', ')}`,
        };
      }

      // Convert: amount -> USD -> target currency
      const amountInUSD = amount / this.rates[fromCurrency];
      const result = amountInUSD * this.rates[toCurrency];

      // Format with appropriate decimal places
      const formatted = this.formatCurrency(result, toCurrency);

      return {
        success: true,
        data: `${this.formatCurrency(amount, fromCurrency)} ${fromCurrency} = **${formatted} ${toCurrency}**`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error converting currency',
      };
    }
  }

  private formatCurrency(amount: number, currency: string): string {
    // Use appropriate decimal places based on currency
    const smallCurrencies = ['JPY', 'KRW', 'IDR', 'CLP']; // No decimal places
    
    if (smallCurrencies.includes(currency)) {
      return Math.round(amount).toLocaleString();
    }

    return amount.toFixed(2);
  }
}
