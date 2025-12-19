import axios from 'axios';
import { McpTool, McpToolResult } from './types';

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const registry = new Map<string, McpTool>();

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(input: string): string {
  return decodeEntities(stripHtml(input)).replace(/\s+/g, ' ').trim();
}

function decodeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://duckduckgo.com');
    const encoded = url.searchParams.get('uddg');
    return encoded ? decodeURIComponent(encoded) : rawUrl;
  } catch {
    return rawUrl;
  }
}

async function webSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const response = await axios.get('https://duckduckgo.com/html/', {
    params: { q: query, kl: 'us-en', kp: '-2' },
    headers: { 'User-Agent': 'Discord-Nut-MCP/1.0' },
  });

  const html = String(response.data);
  const results: WebSearchResult[] = [];

  const pattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < limit) {
    const href = decodeDuckDuckGoUrl(match[1]);
    const title = cleanText(match[2]);
    const snippet = cleanText(match[3]);

    results.push({
      title,
      url: href,
      snippet,
    });
  }

  return results;
}

const getTimeTool: McpTool = {
  name: 'get_time',
  description: 'Return the current UTC time as an ISO string.',
  async execute(): Promise<McpToolResult> {
    const now = new Date().toISOString();
    return {
      success: true,
      content: now,
      data: { iso: now },
    };
  },
};

const webSearchTool: McpTool = {
  name: 'web_search',
  description: 'Search DuckDuckGo for the given query (top 5 results).',
  async execute(args: Record<string, unknown>): Promise<McpToolResult> {
    const query = String(args.query ?? '').trim();
    const limitInput = Number(args.limit ?? 5);
    const limit = Math.min(5, Math.max(1, Number.isFinite(limitInput) ? limitInput : 5));

    if (!query) {
      return {
        success: false,
        content: 'A non-empty "query" value is required.',
      };
    }

    try {
      const results = await webSearch(query, limit);
      return {
        success: true,
        content: JSON.stringify(results, null, 2),
        data: results,
      };
    } catch (error) {
      return {
        success: false,
        content: `Web search failed: ${(error as Error).message}`,
      };
    }
  },
};

function registerTool(tool: McpTool): void {
  registry.set(tool.name, tool);
}

registerTool(getTimeTool);
registerTool(webSearchTool);

export function getTool(name: string): McpTool | undefined {
  return registry.get(name);
}

export function listTools(): McpTool[] {
  return Array.from(registry.values());
}
