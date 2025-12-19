import { config } from '../config';
import { Message, OpenRouterService } from './openRouterService';

export type RouteType = 'CHAT' | 'TOOL';

export interface RouteDecision {
  route: RouteType;
  toolName?: string;
  reason?: string;
}

export class RouterService {
  private aiService: OpenRouterService;
  private availableTools: Set<string>;

  constructor(aiService: OpenRouterService, toolNames: string[]) {
    this.aiService = aiService;
    this.availableTools = new Set(toolNames);
  }

  async decideRoute(message: string): Promise<RouteDecision> {
    const routingPrompt: Message[] = [
      {
        role: 'system',
        content: [
          'You are a router deciding how to handle a Discord message.',
          'Routes:',
          '- CHAT: respond directly with the chat assistant.',
          '- TOOL: call an MCP tool first, then summarize results for the user.',
          'Tools: web_search (use for lookups or recent info), get_time (when asked for current time).',
          'Return ONLY minified JSON: {"route":"CHAT"|"TOOL","toolName"?:string,"reason":string}.',
          'Default to CHAT when unsure or when no tool fits.',
        ].join(' '),
      },
      {
        role: 'user',
        content: message,
      },
    ];

    try {
      const raw = await this.aiService.chatCompletion(
        routingPrompt,
        config.openRouter.models.router
      );
      return this.parseDecision(raw);
    } catch (error) {
      console.error('Routing failed, defaulting to CHAT:', error);
      return { route: 'CHAT', reason: 'Routing error' };
    }
  }

  private parseDecision(raw: string): RouteDecision {
    const cleaned = raw
      .trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '');

    try {
      const parsed = JSON.parse(cleaned);
      const route = String(parsed.route || '').toUpperCase() as RouteType;
      const toolName = parsed.toolName ? String(parsed.toolName) : undefined;
      const reason = parsed.reason ? String(parsed.reason) : undefined;

      if (route === 'TOOL' && toolName && this.availableTools.has(toolName)) {
        return { route: 'TOOL', toolName, reason };
      }

      return { route: 'CHAT', reason };
    } catch {
      return { route: 'CHAT', reason: 'Invalid routing response' };
    }
  }
}
