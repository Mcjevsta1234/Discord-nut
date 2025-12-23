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
   * Single-call agentic coding with strict execution contract
   * NO persona, NO chat instructions - pure coding mode
   */
  async improveCode(
    userRequest: string,
    conversationContext: Message[],
    model: string
  ): Promise<CodeImprovement> {
    console.log('🧪 Single-call agentic coding (strict mode)...');

    // Extract ONLY the user's request - strip all persona/system prompts
    const userMessages = conversationContext.filter(m => m.role === 'user').slice(-2);
    const userRequestText = userMessages.map(m => m.content).join('\n') + '\n' + userRequest;

    // Dedicated coding execution prompt - NO PERSONALITY
    const codingPrompt: Message[] = [
      {
        role: 'system',
        content: `STRICT CODING MODE

You are a professional code generator. NO roleplay, NO emojis, NO conversational tone.

EXECUTION CONTRACT:
1. Generate COMPLETE, PRODUCTION-READY code
2. Single file output whenever possible
3. Internally: plan → code → review → improve before responding
4. Output full file contents - NO truncation, NO placeholders
5. Include ALL functionality - complete implementation

FILE FORMAT (REQUIRED):
// FILE: <filename>
[complete file contents]
// END FILE

RULES:
- HTML/CSS/JS: Single .html file, inline <style> in <head>, inline <script> before </body>
- Mobile-responsive: viewport meta, flexbox/grid, rem units, media queries
- Best practices: error handling, clear names, comments for complex logic
- NO explanations outside code comments
- If task requires multiple files, respond ONLY: "This project requires multiple files. Please use OpenHands."

QUALITY OVER BREVITY: Output the COMPLETE file.`,
      },
      {
        role: 'user',
        content: userRequestText,
      },
    ];

    const response = await this.aiService.chatCompletionWithMetadata(codingPrompt, model);
    
    // Check for multi-file response
    if (response.content.includes('This project requires multiple files')) {
      console.log('⚠️ Multi-file project detected');
      return {
        finalCode: '',
        explanation: 'This project requires multiple files. Please use OpenHands for complex multi-file projects.',
        metadata: response.metadata,
      };
    }

    const code = this.extractCode(response.content);
    const explanation = this.extractFileComment(response.content);

    console.log('✅ Strict coding execution complete');

    return {
      finalCode: code,
      explanation: explanation || 'Production-ready code generated.',
      metadata: response.metadata,
    };
  }



  /**
   * Extract code from response (handles FILE markers and code blocks)
   */
  private extractCode(response: string): string {
    // Try FILE markers first (strict format)
    const fileMatch = response.match(/\/\/\s*FILE:\s*(.+?)\n([\s\S]*?)\/\/\s*END FILE/);
    if (fileMatch) {
      const filename = fileMatch[1].trim();
      const content = fileMatch[2].trim();
      console.log(`📄 Extracted file: ${filename}`);
      return content;
    }

    // Fallback: Try to extract from code block
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

  /**
   * Extract filename from FILE marker for display
   */
  private extractFileComment(response: string): string {
    const fileMatch = response.match(/\/\/\s*FILE:\s*(.+?)\n/);
    if (fileMatch) {
      return `Generated file: ${fileMatch[1].trim()}`;
    }
    return '';
  }
}
