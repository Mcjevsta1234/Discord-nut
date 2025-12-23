/**
 * Planner for multi-step action execution
 * Decides what actions to take without executing them
 */

import { OpenRouterService, Message } from './openRouterService';
import { LLMResponseMetadata } from './llmMetadata';
import { PromptNormalizer } from './promptNormalizer';

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
    console.log('🔍 INSTANT synthetic planner checking:', normalized);

    // Time queries - ALWAYS use tool, never respond without it
    if (/(what.?s? the time|what time|current time|time is it|tell.?me.?the.?time|show.?me.?the.?time|time zone|timezone|utc)/.test(normalized)) {
      console.log('✅ TIME QUERY DETECTED - using get_time tool');
      return {
        actions: [{ type: 'tool', toolName: 'get_time', toolParams: {} }],
        reasoning: 'Time query detected - must use tool',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Math detection
    const mathPattern = /\d+\s*[\+\-\*\/]\s*\d+/;
    if (mathPattern.test(userMessage) || /(calculate|math|sum|multiply|divide|what's|what is)\s+\d+/.test(normalized)) {
      console.log('✅ MATH DETECTED - using calculate tool');
      return {
        actions: [{ type: 'tool', toolName: 'calculate', toolParams: { expression: userMessage } }],
        reasoning: 'Math calculation detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Currency conversion
    if (/(£|€|¥|\$|usd|eur|gbp|jpy|cad|aud|convert|exchange)\s+\d+/.test(normalized) || /\d+\s*(£|€|¥|\$)/.test(userMessage)) {
      const amountMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*([£€¥\$]|usd|eur|gbp|jpy|cad|aud)/i);
      if (amountMatch) {
        console.log('✅ CURRENCY CONVERSION DETECTED');
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
      console.log('✅ UNIT CONVERSION DETECTED');
      return {
        actions: [{ type: 'tool', toolName: 'convert_units', toolParams: { query: userMessage } }],
        reasoning: 'Unit conversion detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Minecraft server status - ALWAYS use tool for server queries
    // Enhanced pattern to catch: "status of witchyworlds", "check witchyworlds", "how is [server]"
    if (/(minecraft|\\bmc\\b|server status|servers? (up|down|online|offline)|are the servers|how are the servers|network status|server ips?|what's the ip|minecraft servers|witchyworlds|witchy|status of|check.*server|how is.*server)/.test(normalized)) {
      console.log('✅ MINECRAFT STATUS DETECTED - using minecraft_status tool');
      return {
        actions: [{ type: 'tool', toolName: 'minecraft_status', toolParams: {} }],
        reasoning: 'Minecraft server status query detected - must use tool',
        metadata: undefined,
        isFallback: false,
      };
    }

    // URL fetching
    if (/(https?:\/\/|www\.)/.test(userMessage)) {
      const urlMatch = userMessage.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/);
      if (urlMatch) {
        console.log('✅ URL DETECTED - using fetch_url tool');
        return {
          actions: [{ type: 'tool', toolName: 'fetch_url', toolParams: { url: urlMatch[0] } }],
          reasoning: 'URL detected',
          metadata: undefined,
          isFallback: false,
        };
      }
    }

    // Image generation detection - ALWAYS use for image requests
    if (/(generate|create|draw|make|show me|give me).*(image|picture|pic|photo|art|drawing|illustration|visual)|image of|picture of|draw me|paint|sketch|render|visuali[sz]e/i.test(userMessage)) {
      console.log('✅ IMAGE REQUEST DETECTED - using image generation');
      
      // Normalize prompt: remove "hey emma generate an image of" -> clean description
      const normalizedPrompt = PromptNormalizer.normalizeForImage(userMessage);
      console.log(`📝 Prompt normalized: "${normalizedPrompt.original.substring(0, 50)}..." -> "${normalizedPrompt.normalized.substring(0, 50)}..."`);
      
      return {
        actions: [{
          type: 'image',
          imagePrompt: normalizedPrompt.normalized,
          imageResolution: { width: 512, height: 512 },
        }],
        reasoning: 'Image generation request detected',
        metadata: undefined,
        isFallback: false,
      };
    }

    // Default to chat for everything else
    console.log('❌ No tool pattern matched - using chat');
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
        content: `Task planner. JSON only.

Tools:
${toolList}

Rules:
- Math/calc → calculate
- Units (6ft to cm) → convert_units
- Currency ($→€) → convert_currency
- Time (what time) → get_time (REQUIRED)
- Web search → searxng_search
- URLs → fetch_url
- GitHub → github_repo {"action":"readme"}
- Minecraft servers → minecraft_status (REQUIRED)
- Images (generate/create) → image type
- Chat → fallback

Format:
{"actions":[{"type":"tool","toolName":"name","toolParams":{}}],"reasoning":"why"}

Image:
{"actions":[{"type":"image","imagePrompt":"desc","imageResolution":{"width":512,"height":512}}],"reasoning":"why"}

Chat:
{"actions":[{"type":"chat"}],"reasoning":"why"}`,
      },
      ...conversationContext.slice(-2),
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

    // Normalize image prompts from LLM planner
    const normalizedActions = filteredActions.map((action: PlannedAction) => {
      if (action.type === 'image' && action.imagePrompt) {
        const normalized = PromptNormalizer.normalizeForImage(action.imagePrompt);
        if (normalized.wasNormalized) {
          console.log(`📝 Image prompt normalized from planner: "${normalized.original.substring(0, 40)}..." -> "${normalized.normalized.substring(0, 40)}..."`);
        }
        return {
          ...action,
          imagePrompt: normalized.normalized,
        };
      }
      return action;
    });

    return {
      actions: normalizedActions,
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
