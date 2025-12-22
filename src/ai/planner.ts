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
   * Saves tokens by generating plan deterministically
   */
  createSyntheticPlanForInstant(): ActionPlan {
    return {
      actions: [{ type: 'chat' }],
      reasoning: 'Conversational response', // Synthetic, not LLM-generated
      metadata: undefined, // No LLM call = no metadata
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

Detection rules:
- Math → "calculate"
- Unit conversion → "convert_units"
- Currency → "convert_currency"
- GitHub repo → "github_repo" with action="readme"
- Time → "get_time"
- Web search → "searxng_search"
- URLs → "fetch_url"
- Image request → "image" type
- General chat → "chat" type

SCHEMA (STRICT):
{
  "actions": [
    {"type": "tool", "toolName": "name", "toolParams": {}},
    {"type": "image", "imagePrompt": "exact user words", "imageResolution": {"width": 512, "height": 512}},
    {"type": "chat"}
  ],
  "reasoning": "short note"
}`,
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
