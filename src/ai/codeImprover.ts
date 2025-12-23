/**
 * Code Improver - Mini Agentic Coding Flow
 * Generates, reviews, and improves code through multi-step LLM reasoning
 * WITHOUT tools, execution, or tests - pure reasoning-based improvement
 */

import { OpenRouterService, Message } from './openRouterService';
import { LLMResponseMetadata } from './llmMetadata';

export interface CodeImprovement {
  finalCode: string;
  explanation: string;
  metadata?: {
    draftMetadata?: LLMResponseMetadata;
    reviewMetadata?: LLMResponseMetadata;
    improveMetadata?: LLMResponseMetadata;
  };
}

export class CodeImprover {
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
  }

  /**
   * Execute mini agentic coding flow: draft → review → improve
   * Returns only the final improved code
   */
  async improveCode(
    userRequest: string,
    conversationContext: Message[],
    model: string
  ): Promise<CodeImprovement> {
    console.log('🧪 Starting mini agentic coding flow...');

    // Step 1: Generate initial code draft
    console.log('📝 Step 1/3: Generating initial code draft...');
    const draftResult = await this.generateDraft(userRequest, conversationContext, model);

    // Step 2: Self-review the draft
    console.log('🔍 Step 2/3: Reviewing code for issues...');
    const reviewResult = await this.reviewCode(draftResult.code, userRequest, model);

    // Step 3: Improve based on review
    console.log('✨ Step 3/3: Improving code based on review...');
    const improvedResult = await this.improveBasedOnReview(
      draftResult.code,
      reviewResult.review,
      userRequest,
      model
    );

    console.log('✅ Mini agentic flow complete');

    return {
      finalCode: improvedResult.code,
      explanation: improvedResult.explanation,
      metadata: {
        draftMetadata: draftResult.metadata,
        reviewMetadata: reviewResult.metadata,
        improveMetadata: improvedResult.metadata,
      },
    };
  }

  /**
   * Step 1: Generate initial code draft
   */
  private async generateDraft(
    userRequest: string,
    conversationContext: Message[],
    model: string
  ): Promise<{ code: string; metadata?: LLMResponseMetadata }> {
    const draftPrompt: Message[] = [
      ...conversationContext,
      {
        role: 'user',
        content: userRequest,
      },
      {
        role: 'system',
        content: `Generate code for the user's request. Focus on:
- Correct implementation of requirements
- Clean, readable code structure
- Proper error handling
- Clear variable/function names

When generating HTML/CSS/JS, create a single HTML file with inline <style> and <script> tags.
Include viewport meta tag and make it mobile-responsive.

Respond with code inside a code block with the appropriate language marker.`,
      },
    ];

    const response = await this.aiService.chatCompletionWithMetadata(draftPrompt, model);
    const code = this.extractCode(response.content);

    return { code, metadata: response.metadata };
  }

  /**
   * Step 2: Review the generated code
   */
  private async reviewCode(
    code: string,
    userRequest: string,
    model: string
  ): Promise<{ review: string; metadata?: LLMResponseMetadata }> {
    const reviewPrompt: Message[] = [
      {
        role: 'system',
        content: `You are a code reviewer. Analyze the following code and identify:
1. Logic errors or bugs
2. Poor structure or organization
3. Missing error handling
4. Readability issues
5. Best practice violations
6. Security concerns
7. Potential improvements

Be specific and actionable. List issues clearly.`,
      },
      {
        role: 'user',
        content: `Original request: ${userRequest}

Code to review:
\`\`\`
${code}
\`\`\`

Provide a detailed review identifying specific issues and improvements.`,
      },
    ];

    const response = await this.aiService.chatCompletionWithMetadata(reviewPrompt, model);

    return { review: response.content, metadata: response.metadata };
  }

  /**
   * Step 3: Improve code based on review
   */
  private async improveBasedOnReview(
    originalCode: string,
    review: string,
    userRequest: string,
    model: string
  ): Promise<{ code: string; explanation: string; metadata?: LLMResponseMetadata }> {
    const improvePrompt: Message[] = [
      {
        role: 'system',
        content: `You are refactoring code based on a review. Your task:
1. Fix all identified issues
2. Improve code structure and readability
3. Add better error handling
4. Apply best practices
5. Maintain or improve functionality

Respond with:
1. The improved code in a code block
2. A brief explanation of key improvements (2-3 sentences)

Format:
\`\`\`language
[improved code]
\`\`\`

[brief explanation]`,
      },
      {
        role: 'user',
        content: `Original request: ${userRequest}

Current code:
\`\`\`
${originalCode}
\`\`\`

Review findings:
${review}

Produce improved code that addresses the review issues.`,
      },
    ];

    const response = await this.aiService.chatCompletionWithMetadata(improvePrompt, model);
    
    const improved = this.extractCode(response.content);
    const explanation = this.extractExplanation(response.content);

    return {
      code: improved,
      explanation: explanation || 'Code improved based on review feedback.',
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
