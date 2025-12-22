/**
 * RouterService - Single Source of Truth for Model Selection
 * 
 * Implements hybrid routing logic:
 * 1. Heuristics for clear-cut cases (fast, deterministic)
 * 2. Router model for ambiguous cases (intelligent fallback)
 * 
 * Personas NEVER choose models - all routing happens here.
 */

import { OpenRouterService, Message } from './openRouterService';
import {
  ModelTier,
  RoutingFlags,
  RoutingDecision,
  getTierConfig,
  routingConfig,
} from '../config/routing';

export class RouterService {
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.aiService = aiService;
  }

  /**
   * Main routing method - determines which model tier to use
   */
  async route(
    userMessage: string,
    conversationHistory: Message[],
    estimatedPromptTokens?: number
  ): Promise<RoutingDecision> {
    // 1. Analyze message to extract routing flags
    const flags = this.analyzeMessage(userMessage, estimatedPromptTokens);

    // 2. Try heuristic routing first (fast, no LLM call)
    const heuristicDecision = this.routeByHeuristics(flags, userMessage);

    // 3. If heuristics are confident, use them
    const confidenceThreshold = routingConfig.confidenceThreshold;
    if (heuristicDecision.confidence >= confidenceThreshold) {
      console.log(`🎯 Routing: ${heuristicDecision.tier} (heuristic, ${(heuristicDecision.confidence * 100).toFixed(0)}% confidence)`);
      return heuristicDecision;
    }

    // 4. For ambiguous cases, use router model
    console.log(`🤔 Heuristics ambiguous (${(heuristicDecision.confidence * 100).toFixed(0)}%), using router model...`);
    try {
      const routerDecision = await this.routeByModel(userMessage, flags, conversationHistory);
      console.log(`🎯 Routing: ${routerDecision.tier} (router model, ${(routerDecision.confidence * 100).toFixed(0)}% confidence)`);
      return routerDecision;
    } catch (error) {
      console.warn('⚠️ Router model failed, falling back to heuristic decision:', error);
      return heuristicDecision;
    }
  }

  /**
   * Analyze user message to extract routing flags
   */
  private analyzeMessage(userMessage: string, estimatedTokens?: number): RoutingFlags {
    const lower = userMessage.toLowerCase();
    const words = lower.split(/\s+/).length;

    // Code detection patterns
    const codePatterns = [
      /```/,
      /function\s+\w+\s*\(/,
      /class\s+\w+/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /import\s+.*from/,
      /export\s+(default|const|class|function)/,
      /=>|async\s+function/,
      /<\w+>.*<\/\w+>/,
      /\brefactor\b/i,
      /\bcode\s+review\b/i,
      /\bdebug\b/i,
    ];

    // Greeting patterns
    const greetingPatterns = [
      /^(hi|hey|hello|yo|sup|wassup|heya|hiya)\b/i,
      /^(good\s+(morning|afternoon|evening|night))\b/i,
      /^(how\s+(are\s+you|you\s+doing|is\s+it\s+going))\b/i,
      /^(what'?s\s+up)\b/i,
    ];

    // Deep thinking indicators
    const thinkingPatterns = [
      /\bexplain\s+(in\s+detail|thoroughly|comprehensively)\b/i,
      /\banalyze\b/i,
      /\bcompare\s+and\s+contrast\b/i,
      /\bpros\s+and\s+cons\b/i,
      /\bwalk\s+me\s+through\b/i,
      /\bstep\s+by\s+step\b/i,
      /\bdeep\s+dive\b/i,
      /\bthink\s+(deeply|carefully|through)\b/i,
    ];

    // Tool/search indicators
    const toolPatterns = [
      /\bsearch\s+(for|the\s+web)\b/i,
      /\blook\s+up\b/i,
      /\bfind\s+(information|data|out)\b/i,
      /\bgithub\s+(repo|repository)\b/i,
      /\bfetch\s+url\b/i,
      /\bcalculate\b/i,
      /\bconvert\b/i,
      /what\s+(time|date)\b/i,
    ];

    const flags: RoutingFlags = {
      containsCode: codePatterns.some(p => p.test(userMessage)),
      isGreeting: greetingPatterns.some(p => p.test(lower)) && words <= 10,
      isShortQuery: words <= 15 && !codePatterns.some(p => p.test(userMessage)),
      needsTools: toolPatterns.some(p => p.test(lower)),
      needsSearch: /\b(search|find|look up|what is|who is|when did)\b/i.test(lower),
      explicitDepthRequest: thinkingPatterns.some(p => p.test(lower)),
      needsLongContext: (estimatedTokens && estimatedTokens > 8000) || userMessage.length > 2000,
    };

    return flags;
  }

  /**
   * Route using deterministic heuristics
   * Returns high confidence for clear-cut cases, low confidence for ambiguous ones
   */
  private routeByHeuristics(flags: RoutingFlags, userMessage: string): RoutingDecision {
    let tier: ModelTier;
    let reason: string;
    let confidence = 1.0;

    // Rule 1: Greetings and short simple messages → INSTANT (HIGH CONFIDENCE)
    if (flags.isGreeting) {
      tier = ModelTier.INSTANT;
      reason = 'Simple greeting or small talk';
      confidence = 0.95;
    }
    // Rule 2: Code present → CODING (HIGH CONFIDENCE)
    else if (flags.containsCode) {
      tier = ModelTier.CODING;
      reason = 'Code detected in message';
      confidence = 0.95;
    }
    // Rule 3: Explicit depth request → THINKING (HIGH CONFIDENCE)
    else if (flags.explicitDepthRequest) {
      tier = ModelTier.THINKING;
      reason = 'Explicit request for detailed analysis';
      confidence = 0.90;
    }
    // Rule 4: Needs tools or search → SMART (HIGH CONFIDENCE)
    else if (flags.needsTools || flags.needsSearch) {
      tier = ModelTier.SMART;
      reason = 'Requires tool usage or search';
      confidence = 0.85;
    }
    // Rule 5: Short query, no special requirements → INSTANT (MEDIUM CONFIDENCE)
    else if (flags.isShortQuery && !flags.needsLongContext) {
      tier = ModelTier.INSTANT;
      reason = 'Short query without complex requirements';
      confidence = 0.75;
    }
    // Rule 6: Long context → SMART (MEDIUM-LOW CONFIDENCE)
    else if (flags.needsLongContext) {
      tier = ModelTier.SMART;
      reason = 'Long context requires capable model';
      confidence = 0.70;
    }
    // Default: SMART (general purpose, LOW CONFIDENCE - trigger router model)
    else {
      tier = ModelTier.SMART;
      reason = 'General-purpose query (ambiguous, will use router model)';
      confidence = 0.60; // Below 80% threshold to trigger router model
    }

    const modelConfig = getTierConfig(tier);

    return {
      tier,
      modelId: modelConfig.modelId,
      modelConfig,
      routingMethod: 'heuristic',
      routingReason: reason,
      confidence,
      flags,
    };
  }

  /**
   * Route using a small router LLM (for ambiguous cases)
   * Uses Gemma 9B with optimized prompt for classification
   */
  private async routeByModel(
    userMessage: string,
    flags: RoutingFlags,
    conversationHistory: Message[]
  ): Promise<RoutingDecision> {
    const routerPrompt: Message[] = [
      {
        role: 'user',
        content: `You are a message classifier. Read the message and classify it into ONE tier.

TIERS:
• INSTANT: Simple greetings, small talk, short questions (under 15 words)
• SMART: Regular conversations, questions, tool requests, normal queries  
• THINKING: Complex analysis, detailed explanations, multi-step reasoning
• CODING: Code writing, debugging, refactoring, technical implementation

MESSAGE: "${userMessage.substring(0, 250)}"

CONTEXT:
- Has code: ${flags.containsCode ? 'yes' : 'no'}
- Needs tools: ${flags.needsTools ? 'yes' : 'no'}
- Complex request: ${flags.explicitDepthRequest ? 'yes' : 'no'}
- Short message: ${flags.isShortQuery ? 'yes' : 'no'}

Respond with ONLY ONE WORD - the tier name. No punctuation, no explanation.

Tier:`,
      },
    ];

    // Try primary router model first
    let response;
    let usedFallback = false;
    
    try {
      response = await this.aiService.chatCompletionWithMetadata(
        routerPrompt,
        routingConfig.routerModelId,
        {
          temperature: 0,
          max_tokens: 20,
        }
      );
    } catch (primaryError) {
      console.warn(`⚠️ Primary router (${routingConfig.routerModelId}) failed:`, 
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      );
      
      // Try fallback router
      try {
        console.log(`🔄 Trying fallback router: ${routingConfig.fallbackRouterModelId}`);
        response = await this.aiService.chatCompletionWithMetadata(
          routerPrompt,
          routingConfig.fallbackRouterModelId,
          {
            temperature: 0,
            max_tokens: 20,
          }
        );
        usedFallback = true;
        console.log('✅ Fallback router succeeded');
      } catch (fallbackError) {
        console.error('❌ Fallback router also failed:', 
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        );
        throw fallbackError; // Re-throw to use heuristic fallback
      }
    }

    try {
      const response = await this.aiService.chatCompletionWithMetadata(
        routerPrompt,
        routingConfig.routerModelId,
        {
          temperature: 0,
          max_tokens: 32,
        }
      );

      const tierText = response.content.trim().toUpperCase();
      
      // Parse tier with robust fallback
      let tier: ModelTier;
      if (tierText.includes('INSTANT')) {
        tier = ModelTier.INSTANT;
      } else if (tierText.includes('THINKING')) {
        tier = ModelTier.THINKING;
      } else if (tierText.includes('CODING')) {
        tier = ModelTier.CODING;
      } else if (tierText.includes('SMART')) {
        tier = ModelTier.SMART;
      } else {
        // Invalid or empty output → default to SMART (GUARDRAIL)
        console.warn(`⚠️ Router model returned invalid tier: "${tierText}", defaulting to SMART`);
        tier = ModelTier.SMART;
      }

      const modelConfig = getTierConfig(tier);

      return {
        tier,
        modelId: modelConfig.modelId,
        modelConfig,
        routingMethod: 'routerModel',
        routingReason: `Router model selected ${tier}${usedFallback ? ' (via fallback)' : ''}`,
        confidence: usedFallback ? 0.85 : 0.95,
        flags,
      };
    } catch (error) {
      console.error('Router model error:', error);
      throw error;
    }
  }

  /**
   * Retry with higher tier (used for guardrails)
   */
  getHigherTier(currentTier: ModelTier): ModelTier {
    switch (currentTier) {
      case ModelTier.INSTANT:
        return ModelTier.SMART;
      case ModelTier.SMART:
        return ModelTier.THINKING;
      case ModelTier.THINKING:
      case ModelTier.CODING:
        return ModelTier.THINKING; // Already at top
      default:
        return ModelTier.SMART;
    }
  }

  /**
   * Create a routing decision with a specific tier (for manual overrides)
   */
  createManualDecision(tier: ModelTier, reason: string): RoutingDecision {
    const modelConfig = getTierConfig(tier);
    
    return {
      tier,
      modelId: modelConfig.modelId,
      modelConfig,
      routingMethod: 'heuristic',
      routingReason: reason,
      confidence: 1.0,
      flags: {
        needsTools: false,
        needsSearch: false,
        containsCode: false,
        needsLongContext: false,
        explicitDepthRequest: false,
        isGreeting: false,
        isShortQuery: false,
      },
    };
  }
}
