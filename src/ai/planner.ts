/**
 * Planner for multi-step action execution
 * Decides what actions to take without executing them
 */

import { OpenRouterService, Message } from './openRouterService';
import { config } from '../config';
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
}

export class Planner {
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
  }

  async planActions(
    userMessage: string,
    conversationContext: Message[],
    personaId?: string
  ): Promise<ActionPlan> {
    try {
      const availableTools = this.aiService.getAvailableMCPTools();
      const toolList = availableTools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join('\n');

      const planningPrompt: Message[] = [
        {
          role: 'system',
          content: `OUTPUT JSON ONLY. No prose, no markdown, no explanation.

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

SCHEMA (REQUIRED):
{
  "actions": [
    {"type": "tool", "toolName": "name", "toolParams": {}},
    {"type": "image", "imagePrompt": "exact user words", "imageResolution": {"width": 512, "height": 512}},
    {"type": "chat"}
  ]
}

RULES:
1. Output ONLY valid JSON
2. Any output that is not valid JSON is INVALID
3. Prefer tools over chat for deterministic tasks
4. Use exact user words for imagePrompt
5. For GitHub summaries use action="readme"

Example outputs:
{"actions":[{"type":"tool","toolName":"calculate","toolParams":{"expression":"5+5"}}]}
{"actions":[{"type":"tool","toolName":"searxng_search","toolParams":{"query":"minecraft mods"}}]}
{"actions":[{"type":"chat"}]}`,
        },
        ...conversationContext.slice(-2), // Minimal context
        {
          role: 'user',
          content: userMessage,
        },
      ];

      const response = await this.aiService.planCompletionWithMetadata(planningPrompt);

      // Strict JSON parsing
      let plan: ActionPlan;
      try {
        // Try to extract JSON from response
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate structure
        if (!parsed.actions || !Array.isArray(parsed.actions)) {
          throw new Error('Invalid plan structure: missing actions array');
        }

        plan = {
          actions: parsed.actions,
          reasoning: parsed.reasoning || 'Planned actions',
          metadata: response.metadata,
        };

      } catch (parseError) {
        console.warn('Planner JSON parse failed:', parseError);
        console.warn('Raw response:', response);
        throw parseError; // Propagate to trigger retry
      }

      // Validate plan
      if (plan.actions.length === 0) {
        console.warn('Empty action plan, defaulting to chat');
        return {
          actions: [{ type: 'chat' }],
          reasoning: 'Empty plan fallback',
        };
      }

      console.log(`✓ Planned ${plan.actions.length} action(s):`, plan.actions.map(a => a.type + (a.toolName ? `:${a.toolName}` : '')).join(' → '));

      return plan;
    } catch (error) {
      console.error('Planner error:', error);
      throw error; // Throw to trigger retry
    }
  }

  /**
   * Retry wrapper with strict validation
   */
  async planActionsWithRetry(
    userMessage: string,
    conversationContext: Message[],
    personaId?: string
  ): Promise<ActionPlan> {
    // First attempt
    try {
      return await this.planActions(userMessage, conversationContext, personaId);
    } catch (error) {
      console.warn('⚠ Planner attempt 1 failed, retrying...', error instanceof Error ? error.message : error);
    }

    // Second attempt (retry)
    try {
      return await this.planActions(userMessage, conversationContext, personaId);
    } catch (retryError) {
      console.error('✗ Planner attempt 2 failed, using safe fallback');
      console.error('Error:', retryError instanceof Error ? retryError.message : retryError);
      
      // Safe fallback - do NOT hallucinate
      return {
        actions: [{ type: 'chat' }],
        reasoning: 'Planning failed after retry - using chat fallback',
      };
    }
  }
}
