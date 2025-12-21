/**
 * LLM Response Metadata
 * 
 * Centralized interface for tracking token usage, timing, and model information
 * across all LLM providers (OpenRouter, OpenAI, etc.)
 * 
 * This provides a normalized view of LLM responses regardless of provider,
 * enabling consistent token tracking and cost estimation across the application.
 */

/**
 * Token usage statistics from an LLM call
 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Complete metadata about an LLM API call
 */
export interface LLMResponseMetadata {
  // Model information
  model: string;
  provider: 'openrouter' | 'openai' | 'gemini' | 'unknown';
  
  // Token usage
  usage?: TokenUsage;
  
  // Timing
  latencyMs?: number;
  
  // Cost estimation (if available)
  estimatedCost?: number;
  costCurrency?: string;
  
  // Request metadata
  requestTimestamp: number;
  responseTimestamp?: number;
  
  // Status
  success: boolean;
  error?: string;
}

/**
 * Aggregated LLM metadata across multiple calls in a single response
 * This is used when a response involves multiple LLM calls (planning + execution + final response)
 */
export interface AggregatedLLMMetadata {
  // Planning phase
  planningCall?: LLMResponseMetadata;
  
  // Execution phase (tool calls might use LLM)
  executionCalls: LLMResponseMetadata[];
  
  // Final response generation
  responseCall?: LLMResponseMetadata;
  
  // Aggregated totals
  totalTokens: number;
  totalLatencyMs: number;
  totalCost: number;
  
  // Summary
  totalCalls: number;
  modelsUsed: string[];
}

/**
 * Response wrapper that includes both content and metadata
 */
export interface LLMResponse<T = string> {
  content: T;
  metadata: LLMResponseMetadata;
}

/**
 * Pricing information for token-based cost estimation
 * Based on OpenRouter pricing (per 1M tokens)
 */
export const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  // Free models
  'meta-llama/llama-3.3-70b-instruct:free': { prompt: 0, completion: 0 },
  'google/gemini-2.0-flash-exp:free': { prompt: 0, completion: 0 },
  'google/gemini-flash-1.5': { prompt: 0.075, completion: 0.30 },
  
  // Paid models (example pricing - adjust based on actual rates)
  'anthropic/claude-3.5-sonnet': { prompt: 3.0, completion: 15.0 },
  'openai/gpt-4': { prompt: 30.0, completion: 60.0 },
  'openai/gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
  'openai/gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
};

/**
 * Calculate estimated cost based on token usage and model
 */
export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0; // Unknown model, no cost estimate
  }
  
  const promptCost = (usage.promptTokens || 0) * pricing.prompt / 1_000_000;
  const completionCost = (usage.completionTokens || 0) * pricing.completion / 1_000_000;
  
  return promptCost + completionCost;
}

/**
 * Aggregate multiple LLM metadata objects into a summary
 */
export function aggregateLLMMetadata(
  planningCall?: LLMResponseMetadata,
  executionCalls?: LLMResponseMetadata[],
  responseCall?: LLMResponseMetadata
): AggregatedLLMMetadata {
  const allCalls: LLMResponseMetadata[] = [
    planningCall,
    ...(executionCalls || []),
    responseCall,
  ].filter((m): m is LLMResponseMetadata => m !== undefined);
  
  const totalTokens = allCalls.reduce(
    (sum, call) => sum + (call.usage?.totalTokens || 0),
    0
  );
  
  const totalLatencyMs = allCalls.reduce(
    (sum, call) => sum + (call.latencyMs || 0),
    0
  );
  
  const totalCost = allCalls.reduce(
    (sum, call) => sum + (call.estimatedCost || 0),
    0
  );
  
  const modelsUsed = Array.from(new Set(allCalls.map(call => call.model)));
  
  return {
    planningCall,
    executionCalls: executionCalls || [],
    responseCall,
    totalTokens,
    totalLatencyMs,
    totalCost,
    totalCalls: allCalls.length,
    modelsUsed,
  };
}

/**
 * Create a metadata object for when LLM data is unavailable
 */
export function createUnavailableMetadata(model: string, reason?: string): LLMResponseMetadata {
  return {
    model,
    provider: 'unknown',
    success: false,
    error: reason || 'Token usage data unavailable from provider',
    requestTimestamp: Date.now(),
  };
}
