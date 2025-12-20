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
  // Public-facing description for this action (derived, not from LLM)
  publicDescription?: string;
}

export interface ActionPlan {
  actions: PlannedAction[];
  reasoning: string;
  // Public-facing plan summary (human-readable, safe for display)
  publicPlan?: string[];
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

      const response = await this.aiService.planCompletion(planningPrompt);

      // Strict JSON parsing
      let plan: ActionPlan;
      try {
        // Try to extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
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

      // Generate public plan summary (deterministic, derived from actions)
      plan.publicPlan = this.generatePublicPlan(plan.actions, userMessage);

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
        publicPlan: ['Respond conversationally'],
      };
    }
  }

  /**
   * Generate public plan summary from actions
   * This is DERIVED from the plan, NOT from LLM reasoning
   * Safe for user display, no internal details exposed
   */
  private generatePublicPlan(actions: PlannedAction[], userMessage: string): string[] {
    const publicSteps: string[] = [];

    for (const action of actions) {
      if (action.type === 'tool' && action.toolName) {
        const step = this.toolToPublicStep(action.toolName, action.toolParams, userMessage);
        if (step) publicSteps.push(step);
      } else if (action.type === 'image') {
        const prompt = action.imagePrompt ? 
          action.imagePrompt.substring(0, 50) + (action.imagePrompt.length > 50 ? '...' : '') : 
          'requested image';
        publicSteps.push(`Generate an image: "${prompt}"`);
      } else if (action.type === 'chat') {
        publicSteps.push('Respond conversationally');
      }
    }

    return publicSteps.length > 0 ? publicSteps : ['Process your request'];
  }

  /**
   * Convert tool action to public-friendly step description
   */
  private toolToPublicStep(toolName: string, params: Record<string, any> = {}, userMessage: string): string | null {
    switch (toolName) {
      case 'github_repo':
        const repo = params.repo || 'repository';
        const action = params.action || 'access';
        const shortRepo = repo.length > 30 ? repo.substring(0, 30) + '...' : repo;
        
        if (action === 'summary') {
          return `Read and summarize GitHub repository: ${shortRepo}`;
        } else if (action === 'readme') {
          return `Read the README from ${shortRepo}`;
        } else if (action === 'file') {
          const path = params.path || 'file';
          return `Read file "${path}" from ${shortRepo}`;
        } else if (action === 'tree') {
          return `List files in ${shortRepo}`;
        } else if (action === 'commits') {
          return `Get recent commits from ${shortRepo}`;
        }
        return `Access GitHub repository: ${shortRepo}`;

      case 'searxng_search':
        const query = params.query || 'search';
        const shortQuery = query.length > 40 ? query.substring(0, 40) + '...' : query;
        return `Search the web for "${shortQuery}"`;

      case 'fetch_url':
        const url = params.url || 'URL';
        const shortUrl = url.length > 40 ? url.substring(0, 40) + '...' : url;
        return `Fetch content from ${shortUrl}`;

      case 'calculate':
        const expr = params.expression || 'calculation';
        return `Calculate: ${expr}`;

      case 'convert_units':
        const value = params.value || '';
        const from = params.fromUnit || '';
        const to = params.toUnit || '';
        return `Convert ${value} ${from} to ${to}`;

      case 'convert_currency':
        const amount = params.amount || '';
        const fromCur = params.from || '';
        const toCur = params.to || '';
        return `Convert ${amount} ${fromCur} to ${toCur}`;

      case 'get_time':
        const tz = params.timezone;
        return tz ? `Get current time in ${tz}` : 'Get current time';

      case 'minecraft_status':
        const server = params.server || 'server';
        return `Check Minecraft server status: ${server}`;

      default:
        return `Use ${toolName}`;
    }
  }
}
