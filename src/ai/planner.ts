/**
 * Planner for multi-step action execution
 * Decides what actions to take without executing them
 */

import { OpenRouterService, Message } from './openRouterService';
import { LLMResponseMetadata } from './llmMetadata';

export interface PlannedAction {
  type: 'tool' | 'image' | 'chat';
  toolName?: string;
  toolParams?: Record<string, any>;
  imagePrompt?: string;
  imageResolution?: { width: number; height: number };
  reasoning?: string;
}

export interface ActionPlan {
  actions: PlannedAction[];
  reasoning: string;
  metadata?: LLMResponseMetadata;
  isFallback?: boolean;
}

export class Planner {
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
  }

  /**
   * Create synthetic plan for INSTANT tier (no LLM call)
   * Uses heuristic-based tool detection to avoid token cost
   * Falls back to chat for unknown patterns
   */
  createSyntheticPlanForInstant(userMessage?: string): ActionPlan {
    // If no message provided, just return chat
    if (!userMessage) {
      return {
        actions: [{ type: 'chat' }],
        reasoning: 'Conversational response',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Heuristic-based tool detection (no LLM cost)
    const normalized = userMessage.toLowerCase();

    // Math detection
    const mathPattern = /\d+\s*[\+\-\*\/]\s*\d+/;
    if (mathPattern.test(userMessage) || /(calculate|math|sum|multiply|divide|what's|what is)\s+\d+/.test(normalized)) {
      return {
        actions: [{ type: 'tool', toolName: 'calculate', toolParams: { expression: userMessage } }],
        reasoning: 'Math calculation detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Currency conversion
    if (/(£|€|¥|\$|usd|eur|gbp|jpy|cad|aud|convert|exchange)\s+\d+/.test(normalized) || /\d+\s*(£|€|¥|\$)/.test(userMessage)) {
      // Extract currency and amount if possible
      const amountMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*([£€¥\$]|usd|eur|gbp|jpy|cad|aud)/i);
      const targetMatch = userMessage.match(/(?:to|in|as)\s+([£€¥\$]|usd|eur|gbp|jpy|cad|aud)/i);
      
      if (amountMatch) {
        return {
          actions: [{ type: 'tool', toolName: 'convert_currency', toolParams: { query: userMessage } }],
          reasoning: 'Currency conversion detected',
          metadata: undefined,
          isFallback: false,
        };
      }
    }

    // Unit conversion
    if (/(ft|meters?|km|miles?|cm|inches?|kg|lbs?|pounds?|celsius|fahrenheit|kelvin|convert|conversion)\s+(?:to|in)/.test(normalized)) {
      return {
        actions: [{ type: 'tool', toolName: 'convert_units', toolParams: { query: userMessage } }],
        reasoning: 'Unit conversion detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Time queries
    if (/(what time|current time|what's the time|time zone|timezone|utc offset)/.test(normalized)) {
      return {
        actions: [{ type: 'tool', toolName: 'get_time', toolParams: {} }],
        reasoning: 'Time query detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Minecraft server status
    if (/(minecraft|server status|server up|server down|are the servers|how are the servers)/.test(normalized)) {
      return {
        actions: [{ type: 'tool', toolName: 'minecraft_status', toolParams: {} }],
        reasoning: 'Minecraft server status query detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // URL fetching
    if (/(https?:\/\/|www\.)/.test(userMessage)) {
      const urlMatch = userMessage.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/);
      if (urlMatch) {
        return {
          actions: [{ type: 'tool', toolName: 'fetch_url', toolParams: { url: urlMatch[0] } }],
          reasoning: 'URL detected',
          metadata: undefined,
          isFallback: false,
        };
      }
    }

    // Default to chat for everything else
    return {
      actions: [{ type: 'chat' }],
      reasoning: 'Conversational response',
      metadata: undefined,
      isFallback: false,
    };
  }

  async planActions(
    userMessage: string,
    conversationContext: Message[],
    personaId?: string
  ): Promise<ActionPlan> {
    const availableTools = this.aiService.getAvailableMCPTools();
    const toolList = availableTools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    const planningPrompt: Message[] = [
      {
        role: 'system',
        content: `You are a deterministic planner. Respond with **ONLY** valid JSON that matches the schema. No markdown, no prose, no code fences, no explanations.

ALLOWED ACTION TYPES: "tool", "image", "chat" (nothing else)
IF UNSURE: return {"actions":[{"type":"chat"}],"reasoning":"Planner fallback"}

Available tools:
${toolList}

Detection rules - USE TOOLS AGGRESSIVELY:
- Math expressions (e.g., "14*3+9", "what's 5+5") → use "calculate" tool
- Unit conversions (e.g., "6ft to cm", "convert 50kg to pounds") → use "convert_units" tool
- Currency conversions (e.g., "£25 in USD", "$100 to EUR") → use "convert_currency" tool
- GitHub queries (e.g., "summarize owner/repo", "what does this repo do") → use "github_repo" tool with action="readme"
- Time queries (e.g., "what time is it", "current time") → use "get_time" tool
- Web searches ("search for", "find", "look up") → use "searxng_search" tool
- URLs/links in message → use "fetch_url" tool
- Minecraft server status/network queries (e.g., "server status", "are servers up", "how are the servers") → use "minecraft_status" tool
- Image requests (e.g., "draw", "generate image", "create a picture") → use "image" type
- General conversation that doesn't fit any tool → use "chat" type

Critical notes:
- GitHub repo summaries require action="readme" parameter
- For minecraft_status: don't specify server param if asking about default servers
- PREFER using tools for deterministic queries - only use chat if truly conversational

Respond with ONLY a JSON object in this format:

For regular chat:
{
  "actions": [
    {"type": "chat"}
  ],
  "reasoning": "brief explanation"
}

For tool usage:
{
  "actions": [
    {"type": "tool", "toolName": "tool_name", "toolParams": {"param": "value"}}
  ],
  "reasoning": "brief explanation"
}

For image generation (ONLY when user explicitly or clearly requests visual/image creation):
{
  "actions": [
    {"type": "image", "imagePrompt": "user's exact prompt", "imageResolution": {"width": 512, "height": 512}}
  ],
  "reasoning": "brief explanation"
}

Routing rules:
- ALWAYS prefer tools over chat for deterministic tasks (math, conversions, repo info, server status, time)
- Use "image" type ONLY when user explicitly asks for image generation, pictures, drawings, or visual content
- If unclear whether they want an image, use "chat" and ask for clarification
- Default to "chat" only for general conversation that doesn't fit any tool
- For imagePrompt: Use the user's EXACT words/prompt without modification`,
      },
      ...conversationContext.slice(-2), // Minimal context
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const response = await this.aiService.planCompletionWithMetadata(planningPrompt);

    const plan = this.parsePlannerResponse(response.content, response.metadata);

    console.log(
      `✓ Planned ${plan.actions.length} action(s):`,
      plan.actions.map((a) => a.type + (a.toolName ? `:${a.toolName}` : '')).join(' → ')
    );

    return plan;
  }

  /**
   * Single-attempt wrapper with strict validation and safe fallback
   */
  async planActionsWithRetry(
    userMessage: string,
    conversationContext: Message[],
    personaId?: string
  ): Promise<ActionPlan> {
    try {
      return await this.planActions(userMessage, conversationContext, personaId);
    } catch (error) {
      console.error('Planner failed, using direct chat fallback:', error);
      return {
        actions: [{ type: 'chat' }],
        reasoning: 'Planner output was invalid JSON - using direct chat',
        metadata: undefined,
        isFallback: true,
      };
    }
  }

  /**
   * Parse and validate planner output as strict JSON
   */
  private parsePlannerResponse(content: string, metadata?: LLMResponseMetadata): ActionPlan {
    const sanitized = this.extractJsonPayload(content);

    const parsed = JSON.parse(sanitized);
    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      throw new Error('Invalid plan structure: missing actions array');
    }

    const allowedTypes = new Set<ActionPlan['actions'][number]['type']>(['tool', 'image', 'chat']);
    const filteredActions = parsed.actions.filter((action: PlannedAction) => allowedTypes.has(action.type));

    if (filteredActions.length === 0) {
      return {
        actions: [{ type: 'chat' }],
        reasoning: 'Planner returned no valid actions - using chat',
        metadata,
        isFallback: true,
      };
    }

    return {
      actions: filteredActions,
      reasoning: parsed.reasoning || 'Planned actions',
      metadata,
      isFallback: false,
    };
  }

  /**
   * Accept only pure JSON payloads (optional fenced JSON is allowed)
   */
  private extractJsonPayload(raw: string): string {
    if (!raw) {
      throw new Error('Empty planner response');
    }

    const trimmed = raw.trim();

    // Allow minimal fenced JSON, otherwise require bare JSON
    const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

    if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
      throw new Error('Planner response was not pure JSON');
    }

    return candidate;
  }
}
