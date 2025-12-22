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
   * Allowed route values for strict validation
   */
  private static readonly VALID_ROUTES = ['chat', 'tool', 'image', 'coding'] as const;
  private static readonly ROUTE_TO_TIER: Record<string, ModelTier> = {
    'chat': ModelTier.SMART,
    'tool': ModelTier.SMART,
    'image': ModelTier.INSTANT,
    'coding': ModelTier.CODING,
  };
  private static readonly MIN_CONFIDENCE = 0.3;

  /**
   * Validate router response JSON against strict contract
   * Returns parsed result or null if invalid
   */
  private validateRouterResponse(content: string, modelName: string): {
    route: string;
    confidence: number;
    reason: string;
  } | null {
    // Check for empty content
    if (!content || content.trim().length === 0) {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: 0`);
      return null;
    }

    // Try to parse JSON
    let parsed: unknown;
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | no JSON object found`);
        return null;
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | JSON parse failed`);
      return null;
    }

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | not an object`);
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.route !== 'string') {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | missing or invalid 'route' field`);
      return null;
    }

    if (typeof obj.confidence !== 'number') {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | missing or invalid 'confidence' field`);
      return null;
    }

    if (typeof obj.reason !== 'string') {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | missing or invalid 'reason' field`);
      return null;
    }

    // Validate route is one of allowed values
    const routeLower = obj.route.toLowerCase();
    if (!RouterService.VALID_ROUTES.includes(routeLower as typeof RouterService.VALID_ROUTES[number])) {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | invalid route value: "${obj.route}"`);
      return null;
    }

    // Validate confidence is in range and meets minimum threshold
    if (obj.confidence < 0 || obj.confidence > 1) {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | confidence out of range: ${obj.confidence}`);
      return null;
    }

    if (obj.confidence < RouterService.MIN_CONFIDENCE) {
      console.warn(`⚠️ LLM router invalid output | model: ${modelName} | raw content length: ${content.length} | confidence below threshold: ${obj.confidence} < ${RouterService.MIN_CONFIDENCE}`);
      return null;
    }

    return {
      route: routeLower,
      confidence: obj.confidence,
      reason: obj.reason,
    };
  }

  /**
   * Route using a small router LLM (for ambiguous cases)
   * Enforces strict JSON output contract with fail-safe fallback to heuristics
   */
  private async routeByModel(
    userMessage: string,
    flags: RoutingFlags,
    conversationHistory: Message[]
  ): Promise<RoutingDecision> {
    // Strict JSON-only prompt
    const routerPrompt: Message[] = [
      {
        role: 'user',
        content: `You are a message classifier. Classify the message into a route category.

ROUTES:
• chat: Regular conversations, questions, general queries
• tool: Requests requiring tools, search, calculations, lookups
• image: Simple greetings, small talk, image-related requests
• coding: Code writing, debugging, refactoring, technical implementation

MESSAGE: "${userMessage.substring(0, 250)}"

CONTEXT:
- Has code: ${flags.containsCode ? 'yes' : 'no'}
- Needs tools: ${flags.needsTools ? 'yes' : 'no'}
- Complex request: ${flags.explicitDepthRequest ? 'yes' : 'no'}
- Short message: ${flags.isShortQuery ? 'yes' : 'no'}

You MUST respond with ONLY a JSON object in this EXACT format, no other text:
{"route": "chat" | "tool" | "image" | "coding", "confidence": <number 0-1>, "reason": "<brief explanation>"}`,
      },
    ];

    // Get heuristic decision first - this becomes fallback if router fails
    const heuristicFallback = this.routeByHeuristics(flags, userMessage);

    // Try primary router model
    let response;
    let usedModel = routingConfig.routerModelId;
    
    try {
      response = await this.aiService.chatCompletionWithMetadata(
        routerPrompt,
        routingConfig.routerModelId,
        {
          temperature: 0,
          max_tokens: 100,
        }
      );
    } catch (primaryError) {
      console.warn(`⚠️ Primary router API call failed (${routingConfig.routerModelId}):`, 
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      );
      
      // Try fallback router model
      try {
        console.log(`🔄 Trying fallback router: ${routingConfig.fallbackRouterModelId}`);
        response = await this.aiService.chatCompletionWithMetadata(
          routerPrompt,
          routingConfig.fallbackRouterModelId,
          {
            temperature: 0,
            max_tokens: 100,
          }
        );
        usedModel = routingConfig.fallbackRouterModelId;
        console.log('✅ Fallback router API call succeeded');
      } catch (fallbackError) {
        console.warn(`⚠️ Fallback router API call also failed (${routingConfig.fallbackRouterModelId}):`, 
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        );
        // Both API calls failed - return heuristic decision (no throw)
        console.log('🎯 Using heuristic routing as authoritative decision');
        return heuristicFallback;
      }
    }

    // Validate the router response using strict contract
    const validatedResult = this.validateRouterResponse(response.content, usedModel);
    
    if (!validatedResult) {
      // Router output invalid - fall back to heuristics (no throw, no continue with empty data)
      console.log('🎯 Using heuristic routing as authoritative decision (router output invalid)');
      return heuristicFallback;
    }

    // Router succeeded with valid output
    const tier = RouterService.ROUTE_TO_TIER[validatedResult.route] || ModelTier.SMART;
    const modelConfig = getTierConfig(tier);

    return {
      tier,
      modelId: modelConfig.modelId,
      modelConfig,
      routingMethod: 'routerModel',
      routingReason: `Router: ${validatedResult.reason} (route: ${validatedResult.route})`,
      confidence: validatedResult.confidence,
      flags,
    };
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
