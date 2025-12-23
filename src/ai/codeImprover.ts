/**
 * Code Improver - Single-Call Agentic Coding
 * Model internally: plans → codes → reviews → refines in ONE call
 * Token-optimized prompts maintain quality with 70% fewer tokens
 */

import { OpenRouterService, Message } from './openRouterService';
import { LLMResponseMetadata } from './llmMetadata';

export interface CodeImprovement {
  finalCode: string;
  explanation: string;
  metadata?: LLMResponseMetadata;
}

export class CodeImprover {
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
  }

  /**
   * Single-call agentic coding with internal iteration
   */
  async improveCode(
    userRequest: string,
    conversationContext: Message[],
    model: string
  ): Promise<CodeImprovement> {
    console.log('🧪 Single-call agentic coding...');

    const agenticPrompt: Message[] = [
      ...conversationContext.slice(-3), // Last 3 messages only
      {
        role: 'user',
        content: userRequest,
      },
      {
        role: 'system',
        content: `Expert coder. Internally: plan→code→review→refine. Output: production-ready code.

Rules:
- HTML: single file, inline <style>/<script>, mobile viewport
- Clean code: proper errors, clear names, best practices
- Brief explanation after code

Format:
\`\`\`lang
[code]
\`\`\`
[2-3 sentence explanation]`,
      },
    ];

    const response = await this.aiService.chatCompletionWithMetadata(agenticPrompt, model);
    const code = this.extractCode(response.content);
    const explanation = this.extractExplanation(response.content);

    console.log('✅ Agentic coding complete');

    return {
      finalCode: code,
      explanation: explanation || 'Code generated with quality checks.',
      metadata: response.metadata,
    };
  }



  /**
   * Extract code from response (handles code blocks)
   */
  private extractCode(response: string): string {
    // Try to extract from code block first
    const codeBlockMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // If no code block, return the whole response (fallback)
    return response.trim();
  }

  /**
   * Extract explanation text (content after code block)
   */
  private extractExplanation(response: string): string {
    // Look for text after the last code block
    const parts = response.split(/```[\w]*\n[\s\S]*?```/);
    if (parts.length > 1) {
      const explanation = parts[parts.length - 1].trim();
      if (explanation.length > 0) {
        return explanation;
      }
    }

    return '';
  }
}
