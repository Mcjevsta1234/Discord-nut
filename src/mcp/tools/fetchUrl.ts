/**
 * URL Fetch Tool
 * Fetches and extracts readable content from URLs
 * Strips scripts/styles and returns clean text
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios from 'axios';

export class FetchUrlTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'fetch_url',
    description: 'Fetch content from a URL. Returns readable text with scripts and styles removed. Use when user pastes a link or when deep reading is needed.',
    parameters: [
      {
        name: 'url',
        type: 'string',
        description: 'The URL to fetch',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const url = params.url as string;

      if (!url || !this.isValidUrl(url)) {
        return {
          success: false,
          error: 'Invalid URL provided',
        };
      }

      // Fetch the URL
      const response = await axios.get(url, {
        timeout: 15000, // 15 second timeout
        maxContentLength: 5 * 1024 * 1024, // 5MB max
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Discord-nut-bot/1.0)',
        },
      });

      const contentType = response.headers['content-type'] || 'text/html';
      let content = '';

      // Handle different content types
      if (contentType.includes('text/html')) {
        content = this.extractTextFromHtml(response.data);
      } else if (contentType.includes('text/')) {
        content = response.data;
      } else if (contentType.includes('application/json')) {
        content = JSON.stringify(response.data, null, 2);
      } else {
        return {
          success: false,
          error: `Unsupported content type: ${contentType}`,
        };
      }

      // Truncate if too long
      const MAX_LENGTH = 4000;
      if (content.length > MAX_LENGTH) {
        content = content.substring(0, MAX_LENGTH) + '\n\n...(truncated)';
      }

      return {
        success: true,
        data: {
          url,
          content,
          contentType,
        },
      };
    } catch (error) {
      console.error('Fetch URL error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch URL',
      };
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private extractTextFromHtml(html: string): string {
    // Simple HTML text extraction (best effort)
    let text = html;

    // Remove script tags and content
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove style tags and content
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Split into lines and remove empty ones
    const lines = text
      .split(/\.\s+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 20); // Filter out short fragments

    return lines.join('. ');
  }
}
