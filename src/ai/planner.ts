/**
 * Planner for multi-step action execution
 * Decides what actions to take without executing them
 */

import { OpenRouterService, Message } from './openRouterService';
import { config } from '../config';

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
          content: `You are an action planner. Analyze the user's request and create a plan of actions to fulfill it.

Available tools:
${toolList}

IMPORTANT Detection Rules:
- Math expressions → use "calculate" tool
- Unit conversions → use "convert_units" tool
- Currency conversions → use "convert_currency" tool
- GitHub queries ("summarize repo", "explain repo") → use "github_repo" tool with action="readme"
- Time queries → use "get_time" tool
- Web searches ("search for", "find", "look up") → use "searxng_search" tool
- URLs/links pasted by user → use "fetch_url" tool
- Image generation → use "image" type
- Multiple requests → create multiple actions in order

Critical: For GitHub repo summaries, ALWAYS use action="readme" to fetch README first

Respond with ONLY a JSON object:

{
  "actions": [
    {
      "type": "tool",
      "toolName": "tool_name",
      "toolParams": {"param": "value"},
      "reasoning": "why this action"
    }
  ],
  "reasoning": "overall plan explanation"
}

For chat-only:
{
  "actions": [{"type": "chat"}],
  "reasoning": "general conversation"
}

For image generation:
{
  "actions": [{"type": "image", "imagePrompt": "user's exact words", "imageResolution": {"width": 512, "height": 512}}],
  "reasoning": "generate image"
}

Rules:
- ALWAYS prefer tools over chat for deterministic tasks
- Multiple actions can be chained (e.g., fetch data then generate image)
- Keep actions focused and sequential
- Use user's EXACT words for imagePrompt`,
        },
        ...conversationContext.slice(-3), // Include recent context
        {
          role: 'user',
          content: userMessage,
        },
      ];

      const response = await this.aiService.chatCompletion(
        planningPrompt,
        config.openRouter.models.router
      );

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('Planner failed to return valid JSON, defaulting to chat');
        return {
          actions: [{ type: 'chat' }],
          reasoning: 'Fallback to chat due to planning error',
        };
      }

      const plan = JSON.parse(jsonMatch[0]) as ActionPlan;

      // Validate plan
      if (!plan.actions || plan.actions.length === 0) {
        console.warn('Empty action plan, defaulting to chat');
        return {
          actions: [{ type: 'chat' }],
          reasoning: 'Empty plan fallback',
        };
      }

      console.log(`Planned ${plan.actions.length} action(s):`, plan.actions.map(a => a.type).join(' → '));

      return plan;
    } catch (error) {
      console.warn('Planner error, falling back to chat:', error);
      return {
        actions: [{ type: 'chat' }],
        reasoning: 'Error in planning, defaulting to chat',
      };
    }
  }

  /**
   * Retry wrapper for OpenRouter provider errors
   */
  async planActionsWithRetry(
    userMessage: string,
    conversationContext: Message[],
    personaId?: string
  ): Promise<ActionPlan> {
    try {
      return await this.planActions(userMessage, conversationContext, personaId);
    } catch (error) {
      console.warn('First planning attempt failed, retrying...', error);
      // Single retry
      try {
        return await this.planActions(userMessage, conversationContext, personaId);
      } catch (retryError) {
        console.error('Planning retry failed, using chat fallback');
        return {
          actions: [{ type: 'chat' }],
          reasoning: 'Planning failed after retry',
        };
      }
    }
  }
}
