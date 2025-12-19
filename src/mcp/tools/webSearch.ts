/**
 * Web Search Tool
 * Performs web searches using DuckDuckGo HTML (no API key required)
 * Returns a limited number of results with title, URL, and snippet
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios from 'axios';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo and return the top results (no API key required)',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'The search query',
        required: true,
      },
      {
        name: 'max_results',
        type: 'number',
        description: 'Maximum number of results to return (1-10, default 5)',
        required: false,
        default: 5,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const query = params.query as string;
      const maxResults = Math.min(Math.max(params.max_results || 5, 1), 10);

      if (!query || query.trim().length === 0) {
        return {
          success: false,
          error: 'Search query cannot be empty',
        };
      }

      // Use DuckDuckGo HTML version (no API key needed)
      const searchUrl = 'https://html.duckduckgo.com/html/';
      const response = await axios.post(
        searchUrl,
        `q=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (compatible; Discord-nut-bot/1.0)',
          },
          timeout: 10000, // 10 second timeout
        }
      );

      const html = response.data;
      const results = this.parseResults(html, maxResults);

      if (results.length === 0) {
        return {
          success: true,
          data: {
            query,
            results: [],
            message: 'No results found',
          },
        };
      }

      return {
        success: true,
        data: {
          query,
          count: results.length,
          results,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during web search',
      };
    }
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    try {
      // Parse DuckDuckGo HTML results
      // Look for result divs with class "result"
      const resultRegex = /<div class="result[^"]*">(.*?)<\/div>[\s\S]*?(?=<div class="result|<div id="links_wrapper")/g;
      const matches = html.matchAll(resultRegex);

      for (const match of matches) {
        if (results.length >= maxResults) break;

        const resultHtml = match[1];

        // Extract title and URL from link
        const linkMatch = resultHtml.match(
          /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/
        );
        
        // Extract snippet
        const snippetMatch = resultHtml.match(
          /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/
        );

        if (linkMatch) {
          const url = this.decodeUrl(linkMatch[1]);
          const title = this.stripHtml(linkMatch[2]);
          const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]) : '';

          if (url && title) {
            results.push({
              title,
              url,
              snippet,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error parsing search results:', error);
    }

    return results;
  }

  private decodeUrl(encodedUrl: string): string {
    try {
      // DuckDuckGo URLs are often in the form: //duckduckgo.com/l/?uddg=...&rut=...
      // We need to extract the actual URL from the uddg parameter
      if (encodedUrl.includes('uddg=')) {
        const match = encodedUrl.match(/uddg=([^&]*)/);
        if (match) {
          return decodeURIComponent(match[1]);
        }
      }
      return encodedUrl.startsWith('//') ? 'https:' + encodedUrl : encodedUrl;
    } catch {
      return encodedUrl;
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim();
  }
}
