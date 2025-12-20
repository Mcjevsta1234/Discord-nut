/**
 * SearxNG Search Tool
 * Deterministic web search using self-hosted SearxNG instance
 * No API keys required, returns structured JSON results
 */

import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';
import axios from 'axios';

interface SearxNGResult {
  title: string;
  url: string;
  content: string;
}

interface SearxNGResponse {
  results: SearxNGResult[];
  query: string;
}

export class SearxNGSearchTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'searxng_search',
    description: 'Search the web using SearxNG. Returns structured results with title, URL, and snippet. Use this for any web search request.',
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
        description: 'Maximum number of results to return (default 5)',
        required: false,
        default: 5,
      },
    ],
  };

  private readonly SEARXNG_ENDPOINT = 'http://agent.witchy.world:4564/search';

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      const query = params.query as string;
      const maxResults = params.max_results || 5;

      if (!query || query.trim().length === 0) {
        return {
          success: false,
          error: 'Search query cannot be empty',
        };
      }

      // Make request to SearxNG
      const response = await axios.get(this.SEARXNG_ENDPOINT, {
        params: {
          q: query,
          format: 'json',
        },
        timeout: 15000, // 15 second timeout
      });

      const data = response.data as SearxNGResponse;

      // Normalize results
      const results = (data.results || [])
        .slice(0, maxResults)
        .map((result) => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          snippet: result.content || '',
        }));

      if (results.length === 0) {
        return {
          success: true,
          data: {
            query,
            results: [],
          },
        };
      }

      // Return structured JSON only (no formatting)
      return {
        success: true,
        data: {
          query,
          results,
        },
      };
    } catch (error) {
      console.error('SearxNG search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SearxNG search failed',
      };
    }
  }
}
