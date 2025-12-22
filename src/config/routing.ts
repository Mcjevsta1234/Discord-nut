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
  routerModelId: getEnv('MODEL_ROUTER', 'xiaomi/mimo-v2-flash:free'),
  
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
      modelId: getEnv('MODEL_INSTANT', 'xiaomi/mimo-v2-flash:free'),
      maxPromptTokens: getEnvNumber('MODEL_INSTANT_MAX_PROMPT', 4000),
      maxOutputTokens: getEnvNumber('MODEL_INSTANT_MAX_OUTPUT', 256),
      costTier: 'free',
      provider: 'xiaomi',
      supportsTools: false, // INSTANT tier for greetings/short chat only
      supportsCaching: false,
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
    
    [ModelTier.SMART]: {
      tier: ModelTier.SMART,
      modelId: getEnv('MODEL_SMART', 'deepseek/deepseek-r1-0528:free'),
      maxPromptTokens: getEnvNumber('MODEL_SMART_MAX_PROMPT', 32000),
      maxOutputTokens: getEnvNumber('MODEL_SMART_MAX_OUTPUT', 8000),
      costTier: 'free',
      provider: 'deepseek',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
    
    [ModelTier.THINKING]: {
      tier: ModelTier.THINKING,
      modelId: getEnv('MODEL_THINKING', 'google/gemma-3-27b-it:free'),
      maxPromptTokens: getEnvNumber('MODEL_THINKING_MAX_PROMPT', 64000),
      maxOutputTokens: getEnvNumber('MODEL_THINKING_MAX_OUTPUT', 16000),
      costTier: 'free',
      provider: 'google',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
    
    [ModelTier.CODING]: {
      tier: ModelTier.CODING,
      modelId: getEnv('MODEL_CODING', 'google/gemma-3-12b-it:free'),
      maxPromptTokens: getEnvNumber('MODEL_CODING_MAX_PROMPT', 32000),
      maxOutputTokens: getEnvNumber('MODEL_CODING_MAX_OUTPUT', 8000),
      costTier: 'free',
      provider: 'google',
      supportsTools: true,
      supportsCaching: false,
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
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
