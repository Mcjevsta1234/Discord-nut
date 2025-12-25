/**
 * Model Capabilities - Detects which models support OpenRouter prompt caching
 * 
 * PART 0: Simple allowlist-based capability detection
 * No external API calls - we control the list.
 */

/**
 * Models known to support OpenRouter prompt caching
 * This is an explicit allowlist that we maintain
 */
const CACHING_CAPABLE_MODELS = new Set<string>([
  'google/gemini-3-flash-preview',
  'google/gemini-3-pro-preview',
  'google/gemini-2.0-flash-thinking-exp:free',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-5-sonnet-20241022',
  'anthropic/claude-3-opus',
]);

/**
 * Check if a model supports prompt caching
 * 
 * Checks:
 * 1. Built-in allowlist
 * 2. Environment override (MODEL_CACHE_CAPABLE)
 * 
 * @param modelId The OpenRouter model ID
 * @returns true if model supports caching
 */
export function modelSupportsCaching(modelId: string): boolean {
  // Check built-in allowlist
  if (CACHING_CAPABLE_MODELS.has(modelId)) {
    return true;
  }

  // Check environment override
  const envOverride = process.env.MODEL_CACHE_CAPABLE;
  if (envOverride) {
    const envModels = envOverride.split(',').map(m => m.trim());
    if (envModels.includes(modelId)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all caching-capable model IDs (for debugging)
 */
export function getCachingCapableModels(): string[] {
  const models = Array.from(CACHING_CAPABLE_MODELS);
  
  const envOverride = process.env.MODEL_CACHE_CAPABLE;
  if (envOverride) {
    const envModels = envOverride.split(',').map(m => m.trim());
    models.push(...envModels.filter(m => !CACHING_CAPABLE_MODELS.has(m)));
  }
  
  return models;
}
