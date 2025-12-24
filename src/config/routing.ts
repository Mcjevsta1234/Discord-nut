/**
 * Centralized Model Routing Configuration
 * 
 * SINGLE SOURCE OF TRUTH for all model routing decisions.
 * 
 * WHY CENTRALIZED:
 * - All model selection logic in one place
 * - Easy to update models without touching multiple files
 * - Clear separation: personas define personality, routing defines models
 * - Environment variables override defaults for production flexibility
 * 
 * WHY PERSONAS STAY MODEL-AGNOSTIC:
 * - Personas are character definitions (Emma is flirty, Steve is technical)
 * - Model selection is a routing concern, not a personality concern
 * - Same persona can use different models based on query complexity
 * - Prevents tight coupling between character and implementation
 */

import dotenv from 'dotenv';
dotenv.config();

/**
 * Model capability tiers
 */
export enum ModelTier {
  /** Fast, cheap models - greetings, simple queries, small talk */
  INSTANT = 'INSTANT',
  
  /** General-purpose reasoning - most conversations, tool usage */
  SMART = 'SMART',
  
  /** Deep reasoning - complex analysis, detailed explanations */
  THINKING = 'THINKING',
  
  /** Code-specialized - generation, debugging, refactoring */
  CODING = 'CODING',
}

/**
 * Complete model configuration for a tier
 * 
 * HOW TO CUSTOMIZE PRICING:
 * 
 * Option 1 - Environment Variables (.env file):
 *   MODEL_CODING_INPUT_PRICE=0.50
 *   MODEL_CODING_OUTPUT_PRICE=3.00
 *   MODEL_CODING_CACHE_READ_PRICE=0.05  # Optional: for models with cache support
 * 
 * Option 2 - Direct Edit (below in tiers config):
 *   inputPricePerMillionTokens: 0.50,
 *   outputPricePerMillionTokens: 3.00,
 *   cacheReadPricePerMillionTokens: 0.05,  # Optional: cache-read tokens (e.g., Gemini)
 * 
 * Three-part pricing (input/output/cache-read):
 *   INPUT:     Cost per 1M input tokens
 *   OUTPUT:    Cost per 1M output tokens
 *   CACHE_READ: Cost per 1M cached tokens that are read (optional, model-specific)
 * 
 * IMPORTANT: Code models (CODING tier) REQUIRE prompt caching to work efficiently.
 * Caching enables context reuse and significant cost savings on repeated queries.
 * 
 * Prices are in USD per 1 million tokens.
 * Find pricing at: https://openrouter.ai/models
 */
export interface TierConfig {
  tier: ModelTier;
  modelId: string;
  maxPromptTokens: number;
  maxOutputTokens: number;
  costTier: 'free' | 'cheap' | 'moderate' | 'expensive';
  provider: string;
  supportsTools: boolean;
  supportsCaching: boolean;
  // Pricing in USD per 1 million tokens
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  cacheReadPricePerMillionTokens?: number;  // Optional: for models supporting prompt caching (e.g., Gemini)
}

/**
 * Routing mode configuration
 */
export type RoutingMode = 'heuristic' | 'routerModel' | 'hybrid';

/**
 * Retry policy for failed requests
 */
export interface RetryPolicy {
  maxRetries: number;
  retryWithHigherTier: boolean;
  backoffMs: number;
}

/**
 * Complete routing configuration
 */
export interface RoutingConfig {
  mode: RoutingMode;
  routerModelId: string;
  fallbackRouterModelId: string; // Used when primary router fails
  confidenceThreshold: number; // 0-1, when to use router model vs heuristics
  retryPolicy: RetryPolicy;
  tiers: Record<ModelTier, TierConfig>;
}

/**
 * Helper to get env var with type safety
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  return value ? value === 'true' : defaultValue;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

function getEnvOptionalFloat(key: string, defaultValue?: number): number | undefined {
  const value = process.env[key];
  if (value) {
    return parseFloat(value);
  }
  return defaultValue;
}

/**
 * CENTRALIZED ROUTING CONFIGURATION
 * All model routing decisions read from this object
 */

/**
 * Routing flags that influence tier selection
 */
export interface RoutingFlags {
  needsTools: boolean;
  needsSearch: boolean;
  containsCode: boolean;
  needsLongContext: boolean;
  explicitDepthRequest: boolean;
  isGreeting: boolean;
  isShortQuery: boolean;
}

/**
 * Routing decision with full context
 */
export interface RoutingDecision {
  tier: ModelTier;
  modelId: string;
  modelConfig: TierConfig;
  routingMethod: 'heuristic' | 'routerModel' | 'hybrid';
  routingReason: string;
  confidence: number;
  flags: RoutingFlags;
}

export const routingConfig: RoutingConfig = {
  // Routing mode: 'heuristic' (fast), 'routerModel' (intelligent), 'hybrid' (best of both)
  mode: getEnv('ROUTING_MODE', 'hybrid') as RoutingMode,
  
  // Router model used for intelligent routing decisions (should be fast and cheap)
  // Using GPT-OSS 20B - fast, efficient, and reliable
  routerModelId: getEnv('MODEL_ROUTER', 'mistralai/mistral-7b-instruct:free'),
  
  // Fallback router if primary fails (rate limits, errors)
  fallbackRouterModelId: getEnv('MODEL_ROUTER_FALLBACK', 'meta-llama/llama-3.2-3b-instruct:free'),
  
  // Confidence threshold: if heuristic confidence < this, use router model
  confidenceThreshold: getEnvNumber('ROUTING_CONFIDENCE_THRESHOLD', 80) / 100,
  
  // Retry policy for failed requests
  retryPolicy: {
    maxRetries: getEnvNumber('ROUTING_MAX_RETRIES', 1),
    retryWithHigherTier: getEnvBoolean('ROUTING_RETRY_HIGHER_TIER', true),
    backoffMs: getEnvNumber('ROUTING_BACKOFF_MS', 1000),
  },
  
  // Per-tier model configurations
  tiers: {
    [ModelTier.INSTANT]: {
      tier: ModelTier.INSTANT,
      modelId: getEnv('MODEL_INSTANT', 'qwen/qwen3-4b:free'),
      maxPromptTokens: getEnvNumber('MODEL_INSTANT_MAX_PROMPT', 8192),
      maxOutputTokens: getEnvNumber('MODEL_INSTANT_MAX_OUTPUT', 2048),
      costTier: 'free',
      provider: 'qwen',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: getEnvFloat('MODEL_INSTANT_INPUT_PRICE', 0),
      outputPricePerMillionTokens: getEnvFloat('MODEL_INSTANT_OUTPUT_PRICE', 0),
      cacheReadPricePerMillionTokens: getEnvOptionalFloat('MODEL_INSTANT_CACHE_READ_PRICE'),
    },
    
    [ModelTier.SMART]: {
      tier: ModelTier.SMART,
      modelId: getEnv('MODEL_SMART', 'deepseek/deepseek-r1-0528:free'),
      maxPromptTokens: getEnvNumber('MODEL_SMART_MAX_PROMPT', 131072),
      maxOutputTokens: getEnvNumber('MODEL_SMART_MAX_OUTPUT', 32000),
      costTier: 'free',
      provider: 'deepseek',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: getEnvFloat('MODEL_SMART_INPUT_PRICE', 0),
      outputPricePerMillionTokens: getEnvFloat('MODEL_SMART_OUTPUT_PRICE', 0),
      cacheReadPricePerMillionTokens: getEnvOptionalFloat('MODEL_SMART_CACHE_READ_PRICE'),
    },
    
    [ModelTier.THINKING]: {
      tier: ModelTier.THINKING,
      modelId: getEnv('MODEL_THINKING', 'allenai/olmo-3.1-32b-think:free'),
      maxPromptTokens: getEnvNumber('MODEL_THINKING_MAX_PROMPT', 64000),
      maxOutputTokens: getEnvNumber('MODEL_THINKING_MAX_OUTPUT', 16000),
      costTier: 'free',
      provider: 'allenai',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: getEnvFloat('MODEL_THINKING_INPUT_PRICE', 0),
      outputPricePerMillionTokens: getEnvFloat('MODEL_THINKING_OUTPUT_PRICE', 0),
      cacheReadPricePerMillionTokens: getEnvOptionalFloat('MODEL_THINKING_CACHE_READ_PRICE'),
    },
    
    [ModelTier.CODING]: {
      tier: ModelTier.CODING,
      modelId: getEnv('MODEL_CODING', 'z-ai/glm-4.7'),
      maxPromptTokens: getEnvNumber('MODEL_CODING_MAX_PROMPT', 128000),
      maxOutputTokens: getEnvNumber('MODEL_CODING_MAX_OUTPUT', 128000),
      costTier: 'moderate',
      provider: 'z-ai',
      supportsTools: true,
      supportsCaching: true,  // GLM-4.7 supports prompt caching
      inputPricePerMillionTokens: getEnvFloat('MODEL_CODING_INPUT_PRICE', 0.40),
      outputPricePerMillionTokens: getEnvFloat('MODEL_CODING_OUTPUT_PRICE', 1.50),
      cacheReadPricePerMillionTokens: getEnvOptionalFloat('MODEL_CODING_CACHE_READ_PRICE', 0.11),  // Cache-read pricing
    },
  },
};

/**
 * Get tier configuration
 */
export function getTierConfig(tier: ModelTier): TierConfig {
  return routingConfig.tiers[tier];
}

/**
 * Get all available tiers
 */
export function getAllTiers(): ModelTier[] {
  return Object.values(ModelTier);
}

/**
 * Check if a tier exists
 */
export function isValidTier(tier: string): tier is ModelTier {
  return Object.values(ModelTier).includes(tier as ModelTier);
}

/**
 * Validate routing configuration at startup
 * Fails fast with clear errors if misconfigured
 */
export function validateRoutingConfig(): void {
  console.log('🔍 Validating routing configuration...');
  
  const errors: string[] = [];
  
  // 1. Validate routing mode
  const validModes: RoutingMode[] = ['heuristic', 'routerModel', 'hybrid'];
  if (!validModes.includes(routingConfig.mode)) {
    errors.push(`Invalid routing mode: "${routingConfig.mode}". Must be one of: ${validModes.join(', ')}`);
  }
  
  // 2. Ensure every tier has a config
  for (const tier of getAllTiers()) {
    const config = routingConfig.tiers[tier];
    if (!config) {
      errors.push(`Missing configuration for tier: ${tier}`);
      continue;
    }
    
    if (!config.modelId) {
      errors.push(`Tier ${tier}: modelId is required`);
    }
    
    if (config.maxPromptTokens <= 0) {
      errors.push(`Tier ${tier}: maxPromptTokens must be > 0`);
    }
    
    if (config.maxOutputTokens <= 0) {
      errors.push(`Tier ${tier}: maxOutputTokens must be > 0`);
    }
  }
  
  // 3. Validate router model (if using router or hybrid mode)
  if (routingConfig.mode === 'routerModel' || routingConfig.mode === 'hybrid') {
    if (!routingConfig.routerModelId) {
      errors.push('Router model ID is required for routerModel/hybrid mode');
    }
  }
  
  // 4. Validate confidence threshold
  if (routingConfig.confidenceThreshold < 0 || routingConfig.confidenceThreshold > 1) {
    errors.push(`Confidence threshold must be between 0 and 1, got: ${routingConfig.confidenceThreshold}`);
  }
  
  // Report results
  if (errors.length > 0) {
    console.error('❌ Routing configuration validation FAILED:');
    errors.forEach(err => console.error(`   - ${err}`));
    throw new Error('Invalid routing configuration. See errors above.');
  }
  
  console.log('✅ Routing configuration valid');
  console.log(`   Mode: ${routingConfig.mode}`);
  console.log(`   Tiers configured: ${getAllTiers().join(', ')}`);
  console.log(`   Router model: ${routingConfig.routerModelId}`);
}

/**
 * Log routing configuration summary (for debugging)
 */
export function logRoutingConfig(): void {
  console.log('\n📊 Routing Configuration Summary:');
  console.log(`   Mode: ${routingConfig.mode}`);
  console.log(`   Router: ${routingConfig.routerModelId}`);
  console.log(`   Confidence threshold: ${(routingConfig.confidenceThreshold * 100).toFixed(0)}%`);
  console.log('\n   Tier Models:');
  for (const tier of getAllTiers()) {
    const config = routingConfig.tiers[tier];
    console.log(`   - ${tier.padEnd(10)} → ${config.modelId}`);
  }
  console.log('');
}
