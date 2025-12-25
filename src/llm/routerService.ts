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
      console.log(`\n✅ FINAL DECISION: Using heuristic result`);
      console.log(`   🎯 Tier: ${heuristicDecision.tier}`);
      console.log(`   📊 Confidence: ${(heuristicDecision.confidence * 100).toFixed(0)}% (>= ${(confidenceThreshold * 100).toFixed(0)}% threshold)`);
      console.log(`   🤖 Model: ${heuristicDecision.modelId}`);
      console.log(`🔍 ROUTING ANALYSIS END\n`);
      return heuristicDecision;
    }

    // 4. For ambiguous cases, use router model
    console.log(`\n⚠️  Confidence too low (${(heuristicDecision.confidence * 100).toFixed(0)}% < ${(confidenceThreshold * 100).toFixed(0)}%), calling router LLM...`);
    try {
      const routerDecision = await this.routeByModel(userMessage, flags, conversationHistory);
      console.log(`\n✅ FINAL DECISION: Using router LLM result`);
      console.log(`   🎯 Tier: ${routerDecision.tier}`);
      console.log(`   📊 Confidence: ${(routerDecision.confidence * 100).toFixed(0)}%`);
      console.log(`   🤖 Model: ${routerDecision.modelId}`);
      console.log(`🔍 ROUTING ANALYSIS END\n`);
      return routerDecision;
    } catch (error) {
      console.warn('\n⚠️ Router model failed, falling back to heuristic decision:', error);
      console.log(`🔍 ROUTING ANALYSIS END\n`);
      return heuristicDecision;
    }
  }

  /**
   * Analyze user message to extract routing flags
   */
  private analyzeMessage(userMessage: string, estimatedTokens?: number): RoutingFlags {
    const lower = userMessage.toLowerCase();
    const words = lower.split(/\s+/).length;
    
    console.log(`\n🔍 ROUTING ANALYSIS START`);
    console.log(`📝 Message: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
    console.log(`📏 Length: ${userMessage.length} chars, ${words} words`);

    // Code detection patterns - includes both existing code AND coding requests
    const codePatterns = [
      // Existing code patterns
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
      // Coding request patterns - very explicit
      /\bcode\s+me\b/i,
      /\b(write|create|build|make|develop|generate)\s+(me\s+)?(a\s+)?(website|web\s*app|site|app|application|program|script|function|component|page)/i,
      /\b(code|program|script|develop)\s+.*(in\s+(python|javascript|typescript|java|html|css|react|node))/i,
      /\b(html|css|javascript|python|react|vue|angular|node\.?js)\s+(website|app|code|program|site)/i,
      /\b(react|vue|angular)\s+(ui|interface|component)/i,
      /\bwith\s+(react|vue|angular|html|css|javascript)/i,
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
      /\bthink\b/i,
      /\bthinking\b/i,
      /\bexplain\s+(in\s+detail|thoroughly|comprehensively)\b/i,
      /\banalyze\b/i,
      /\bcompare\s+and\s+contrast\b/i,
      /\bpros\s+and\s+cons\b/i,
      /\bwalk\s+me\s+through\b/i,
      /\bstep\s+by\s+step\b/i,
      /\bdeep\s+dive\b/i,
      /\bthink\s+(deeply|carefully|through)\b/i,
      /\breason(ing)?\s+(about|through)\b/i,
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

    const containsCode = codePatterns.some(p => p.test(userMessage)) || this.hasCodingIntent(userMessage);
    const isGreeting = greetingPatterns.some(p => p.test(lower)) && words <= 10;
    const needsTools = toolPatterns.some(p => p.test(lower));
    const needsSearch = /\b(search|find|look up|what is|who is|when did)\b/i.test(lower);
    const explicitDepthRequest = thinkingPatterns.some(p => p.test(lower));
    const needsLongContext = (estimatedTokens && estimatedTokens > 8000) || userMessage.length > 2000;
    
    const flags: RoutingFlags = {
      containsCode,
      isGreeting,
      isShortQuery: words <= 15 && !containsCode,
      needsTools,
      needsSearch,
      explicitDepthRequest,
      needsLongContext,
    };
    
    console.log(`🚩 Flags detected:`);
    console.log(`   • containsCode: ${containsCode}`);
    console.log(`   • isGreeting: ${isGreeting}`);
    console.log(`   • isShortQuery: ${flags.isShortQuery}`);
    console.log(`   • needsTools: ${needsTools}`);
    console.log(`   • needsSearch: ${needsSearch}`);
    console.log(`   • explicitDepthRequest: ${explicitDepthRequest}`);
    console.log(`   • needsLongContext: ${needsLongContext}`);

    return flags;
  }

  /**
   * Detect explicit coding intent even when no code block is present
   */
  private hasCodingIntent(userMessage: string): boolean {
    const normalized = userMessage.toLowerCase();

    const intentPatterns = [
      // Flexible patterns that allow words between verb and target
      /(build|create|make|code|write|develop|design)\s+.{0,50}(website|web\s*app|web\s*site|app|application|program|script|bot|discord\s*bot|api|backend|frontend|ui|landing\s*page|homepage|portfolio|dashboard)/,
      /(scaffold|generate|spin\s*up|draft|setup|set\s*up)\s+.{0,30}(react|next\.?js|vue|angular|node|express|fastapi|flask|django|discord)/,
      /(help|assist|guide)\s+me\s+(code|build|develop|create)/,
      /(turn|convert|translate).{0,20}(spec|design|mockup).{0,20}(code|app|website)/,
      // Direct requests
      /^(code|program|develop)\s+(me\s+)?(a\s+)?/,
      // HTML/CSS/JS specific
      /(html|css|javascript|typescript|react|vue)\s+(website|page|app|site)/,
    ];

    return intentPatterns.some((pattern) => pattern.test(normalized));
  }

  /**
   * Route using deterministic heuristics
   * Returns high confidence for clear-cut cases, low confidence for ambiguous ones
   */
  private routeByHeuristics(flags: RoutingFlags, userMessage: string): RoutingDecision {
    let tier: ModelTier;
    let reason: string;
    let confidence = 1.0;

    console.log(`\n🤖 HEURISTIC ROUTING:`);

    // Rule 1: Greetings ONLY → INSTANT (HIGH CONFIDENCE)
    if (flags.isGreeting) {
      tier = ModelTier.INSTANT;
      reason = 'Simple greeting or small talk';
      confidence = 0.95;
      console.log(`   ✅ Rule 1 matched: Greeting detected`);
    }
    // Rule 2: Code present → CODING (HIGH CONFIDENCE)
    else if (flags.containsCode) {
      tier = ModelTier.CODING;
      reason = 'Code detected in message';
      confidence = 0.95;
      console.log(`   ✅ Rule 2 matched: Code/coding request detected`);
    }
    // Rule 3: Explicit depth request or "think/thinking" keyword → THINKING (HIGH CONFIDENCE)
    else if (flags.explicitDepthRequest) {
      tier = ModelTier.THINKING;
      reason = 'Explicit request for detailed analysis or deep thinking';
      confidence = 0.90;
      console.log(`   ✅ Rule 3 matched: Depth/thinking request detected`);
    }
    // Rule 4: Needs tools or search → SMART (HIGH CONFIDENCE)
    else if (flags.needsTools || flags.needsSearch) {
      tier = ModelTier.SMART;
      reason = 'Requires tool usage or search';
      confidence = 0.85;
      console.log(`   ✅ Rule 4 matched: Tools/search needed`);
    }
    // Rule 5: Long context → SMART (HIGH CONFIDENCE)
    else if (flags.needsLongContext) {
      tier = ModelTier.SMART;
      reason = 'Long context requires capable model';
      confidence = 0.80;
      console.log(`   ✅ Rule 5 matched: Long context`);
    }
    // Default: SMART (general purpose, HIGH CONFIDENCE - SMART is the new default)
    else {
      tier = ModelTier.SMART;
      reason = 'General-purpose query (SMART tier default)';
      confidence = 0.85; // High confidence - SMART is now the standard choice
      console.log(`   ✅ Default: Using SMART tier for general queries`);
    }

    const modelConfig = getTierConfig(tier);
    
    console.log(`   📊 Heuristic decision: ${tier} (${(confidence * 100).toFixed(0)}% confidence)`);
    console.log(`   📝 Reason: ${reason}`);
    console.log(`   🎯 Model: ${modelConfig.modelId}`);

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
      console.warn(`   ⚠️ Validation fail: Empty content`);
      return null;
    }

    // Try to parse JSON
    let parsed: unknown;
    try {
      // Extract JSON from response (handle potential markdown code blocks or extra text)
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn(`   ⚠️ Validation fail: No JSON object found in output`);
        console.warn(`   Raw output sample: "${content.substring(0, 100)}..."`);
        return null;
      }
      const jsonStr = jsonMatch[0];
      console.log(`   📋 Extracted JSON: ${jsonStr}`);
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      console.warn(`   ⚠️ Validation fail: JSON parse error`);
      console.warn(`   Error: ${err instanceof Error ? err.message : String(err)}`);
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
      console.warn(`   ⚠️ Validation fail: Missing or invalid 'route' field (got ${typeof obj.route})`);
      return null;
    }

    if (typeof obj.confidence !== 'number') {
      console.warn(`   ⚠️ Validation fail: Missing or invalid 'confidence' field (got ${typeof obj.confidence})`);
      return null;
    }

    if (typeof obj.reason !== 'string') {
      console.warn(`   ⚠️ Validation fail: Missing or invalid 'reason' field (got ${typeof obj.reason})`);
      return null;
    }

    // Validate route is one of allowed values
    const routeLower = obj.route.toLowerCase();
    if (!RouterService.VALID_ROUTES.includes(routeLower as typeof RouterService.VALID_ROUTES[number])) {
      console.warn(`   ⚠️ Validation fail: Invalid route "${obj.route}" (valid: ${RouterService.VALID_ROUTES.join(', ')})`);
      return null;
    }

    // Validate confidence is in range and meets minimum threshold
    if (obj.confidence < 0 || obj.confidence > 1) {
      console.warn(`   ⚠️ Validation fail: Confidence ${obj.confidence} out of range [0-1]`);
      return null;
    }

    if (obj.confidence < RouterService.MIN_CONFIDENCE) {
      console.warn(`   ⚠️ Validation fail: Confidence ${obj.confidence} below minimum ${RouterService.MIN_CONFIDENCE}`);
      return null;
    }
    
    console.log(`   ✅ All validation checks passed`);

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
    // Ultra-strict JSON-only prompt with multiple examples
    const routerPrompt: Message[] = [
      {
        role: 'system',
        content: `You must output EXACTLY one of these routes: chat, tool, image, coding. Output ONLY JSON.`,
      },
      {
        role: 'user',
        content: `Classify: "help me debug this code"
Routes: chat, tool, image, coding
Output:`,
      },
      {
        role: 'assistant',
        content: `{"route":"coding","confidence":0.9,"reason":"code"}`,
      },
      {
        role: 'user',
        content: `Classify: "what time is it"
Routes: chat, tool, image, coding
Output:`,
      },
      {
        role: 'assistant',
        content: `{"route":"tool","confidence":0.9,"reason":"needs time tool"}`,
      },
      {
        role: 'user',
        content: `Classify: "${userMessage.substring(0, 150)}"
Routes: chat, tool, image, coding
Output:`,
      },
    ];
    
    console.log(`\n🤖 Router LLM Input:`);
    console.log(`   Message: "${userMessage.substring(0, 80)}${userMessage.length > 80 ? '...' : ''}"}`);
    console.log(`   Flags: code=${flags.containsCode}, tools=${flags.needsTools}, complex=${flags.explicitDepthRequest}`);
    console.log(`   Valid routes: coding, tool, image, chat`);

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
          max_tokens: 150, // Increased for JSON response
        }
      );
      console.log(`   \u2705 Router API call succeeded`);
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

    // Log raw router response
    console.log(`\n📥 Router LLM Response:`);
    console.log(`   Model: ${usedModel}`);
    console.log(`   Raw output: "${response.content.substring(0, 200)}${response.content.length > 200 ? '...' : ''}"}`);
    console.log(`   Length: ${response.content.length} chars`);
    
    // Validate the router response using strict contract
    const validatedResult = this.validateRouterResponse(response.content, usedModel);
    
    if (!validatedResult) {
      // Router output invalid - fall back to heuristics (no throw, no continue with empty data)
      console.log(`\n❌ Router validation FAILED - falling back to heuristics`);
      console.log(`   Heuristic fallback: ${heuristicFallback.tier} (${(heuristicFallback.confidence * 100).toFixed(0)}% confidence)`);
      return heuristicFallback;
    }
    
    console.log(`\n✅ Router validation PASSED`);
    console.log(`   Parsed route: ${validatedResult.route}`);
    console.log(`   Confidence: ${(validatedResult.confidence * 100).toFixed(0)}%`);
    console.log(`   Reason: ${validatedResult.reason}`);

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
