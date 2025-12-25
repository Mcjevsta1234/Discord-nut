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
  cacheReadTokens?: number;  // Cached prompt tokens that are read (not re-processed), for cache-aware pricing
}

/**
 * Tool execution timing metadata
 */
export interface ToolExecutionMetadata {
  toolName: string;
  startTimeMs: number;
  endTimeMs: number;
  latencyMs: number;
  success: boolean;
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
  
  // Tool execution timing (separate from LLM latency)
  toolExecutions: ToolExecutionMetadata[];
  
  // Final response generation
  responseCall?: LLMResponseMetadata;
  
  // Aggregated totals
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalLLMLatencyMs: number;
  totalToolLatencyMs: number;
  totalLatencyMs: number; // LLM + tools
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
  reasoning_details?: any[]; // OpenRouter reasoning preservation
}

/**
 * Pricing information for token-based cost estimation
 * Based on OpenRouter pricing (per 1M tokens)
 * 
 * Structure: { prompt: number, completion: number, cache_read?: number }
 * - prompt: cost per 1M input tokens
 * - completion: cost per 1M output tokens  
 * - cache_read: cost per 1M cached tokens that are read (not re-processed)
 *   Only applicable for models supporting prompt caching (e.g., Gemini)
 */
export const MODEL_PRICING: Record<string, { 
  prompt: number; 
  completion: number; 
  cache_read?: number;
}> = {
  // ===== FREE TIER MODELS =====
  'meta-llama/llama-3.3-70b-instruct:free': { prompt: 0, completion: 0 },
  'meta-llama/llama-3.2-3b-instruct:free': { prompt: 0, completion: 0 },
  'google/gemini-2.0-flash-exp:free': { prompt: 0, completion: 0 },
  'qwen/qwen3-4b:free': { prompt: 0, completion: 0 },
  'xiaomi/mimo-v2-flash:free': { prompt: 0, completion: 0 },
  'mistralai/mistral-7b-instruct:free': { prompt: 0, completion: 0 },
  'deepseek/deepseek-r1-0528:free': { prompt: 0, completion: 0 },
  'allenai/olmo-3.1-32b-think:free': { prompt: 0, completion: 0 },
  'kwaipilot/kat-coder-pro:free': { prompt: 0, completion: 0 },
  
  // ===== GOOGLE GEMINI MODELS (with cache-read support) =====
  'google/gemini-3-flash-preview': { 
    prompt: 0.20, 
    completion: 0.80,
    cache_read: 0.02,  // Gemini cache-read tokens are charged at reduced rate
  },
  'google/gemini-flash-1.5': { 
    prompt: 0.075, 
    completion: 0.30,
    cache_read: 0.0075,  // 10% of input rate for cache-read tokens
  },
  
  // ===== OPEN-SOURCE & DISCOUNTED MODELS =====
  'openai/gpt-oss-20b': { prompt: 0.10, completion: 0.10 },
  
  // ===== GLM-4 MODELS (Z-AI) =====
  'z-ai/glm-4-32b': { prompt: 0.10, completion: 0.10 },
  
  // ===== MINIMAX MODELS =====
  'minimax/minimax-m2.1': { prompt: 0.30, completion: 1.50 },
  
  // ===== PAID MODELS (Premium Providers) =====
  'anthropic/claude-3.5-sonnet': { prompt: 3.0, completion: 15.0 },
  'openai/gpt-4': { prompt: 30.0, completion: 60.0 },
  'openai/gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
  'openai/gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
  'openai/gpt-5.2': { 
    prompt: 1.75, 
    completion: 14.00,
    cache_read: 0.175,  // GPT-5.2 supports prompt caching
  },
  'z-ai/glm-4.7': {
    prompt: 0.40,
    completion: 1.50,
    cache_read: 0.11,  // GLM-4.7 supports prompt caching
  },
};

/**
 * Calculate estimated cost based on token usage and model
 * Accounts for input, output, and cached tokens (if applicable)
 */
export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0; // Unknown model, no cost estimate
  }
  
  const promptCost = (usage.promptTokens || 0) * pricing.prompt / 1_000_000;
  const completionCost = (usage.completionTokens || 0) * pricing.completion / 1_000_000;
  const cacheReadCost = pricing.cache_read 
    ? (usage.cacheReadTokens || 0) * pricing.cache_read / 1_000_000
    : 0;
  
  return promptCost + completionCost + cacheReadCost;
}

/**
 * Aggregate multiple LLM metadata objects into a summary
 * Separately tracks LLM latency and tool execution time
 */
export function aggregateLLMMetadata(
  planningCall?: LLMResponseMetadata,
  executionCalls?: LLMResponseMetadata[],
  responseCall?: LLMResponseMetadata,
  toolExecutions?: ToolExecutionMetadata[]
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
  
  const totalPromptTokens = allCalls.reduce(
    (sum, call) => sum + (call.usage?.promptTokens || 0),
    0
  );
  
  const totalCompletionTokens = allCalls.reduce(
    (sum, call) => sum + (call.usage?.completionTokens || 0),
    0
  );
  
  // Track LLM latency separately from tool execution
  const totalLLMLatencyMs = allCalls.reduce(
    (sum, call) => sum + (call.latencyMs || 0),
    0
  );
  
  // Track tool execution time separately
  const toolExecs = toolExecutions || [];
  const totalToolLatencyMs = toolExecs.reduce(
    (sum, tool) => sum + tool.latencyMs,
    0
  );
  
  const totalLatencyMs = totalLLMLatencyMs + totalToolLatencyMs;
  
  const totalCost = allCalls.reduce(
    (sum, call) => sum + (call.estimatedCost || 0),
    0
  );
  
  const modelsUsed = Array.from(new Set(allCalls.map(call => call.model)));
  
  return {
    planningCall,
    executionCalls: executionCalls || [],
    toolExecutions: toolExecs,
    responseCall,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    totalLLMLatencyMs,
    totalToolLatencyMs,
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
