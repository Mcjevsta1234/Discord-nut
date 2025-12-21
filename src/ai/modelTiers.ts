/**
 * Model Tier System & Routing Configuration
 * 
 * Centralized 4-tier automatic routing system for LLM selection.
 * Personas NO LONGER choose models - the RouterService makes all routing decisions.
 */

/**
 * 4-Tier Model System
 */
export enum ModelTier {
  /** Very small, fast, cheap - greetings, small talk, simple questions */
  INSTANT = 'INSTANT',
  
  /** General-purpose reasoning - most queries, tool usage, normal conversations */
  SMART = 'SMART',
  
  /** Deep, multi-step reasoning - complex analysis, long explanations, detailed planning */
  THINKING = 'THINKING',
  
  /** Code generation, refactoring, repo analysis, debugging */
  CODING = 'CODING',
}

/**
 * Model configuration for a specific tier
 */
export interface ModelConfig {
  tier: ModelTier;
  modelId: string;
  maxPromptTokens: number;
  maxOutputTokens: number;
  costTier: 'free' | 'cheap' | 'moderate' | 'expensive';
  provider: string;
}

/**
 * Default tier-to-model mapping
 * Can be overridden via environment variables
 */
export const DEFAULT_TIER_MODELS: Record<ModelTier, ModelConfig> = {
  [ModelTier.INSTANT]: {
    tier: ModelTier.INSTANT,
    modelId: process.env.MODEL_INSTANT || 'google/gemini-2.0-flash-exp:free',
    maxPromptTokens: 32000,
    maxOutputTokens: 8000,
    costTier: 'free',
    provider: 'google',
  },
  [ModelTier.SMART]: {
    tier: ModelTier.SMART,
    modelId: process.env.MODEL_SMART || 'meta-llama/llama-3.3-70b-instruct:free',
    maxPromptTokens: 128000,
    maxOutputTokens: 32000,
    costTier: 'free',
    provider: 'meta',
  },
  [ModelTier.THINKING]: {
    tier: ModelTier.THINKING,
    modelId: process.env.MODEL_THINKING || 'google/gemini-2.0-flash-thinking-exp-1219:free',
    maxPromptTokens: 32000,
    maxOutputTokens: 8000,
    costTier: 'free',
    provider: 'google',
  },
  [ModelTier.CODING]: {
    tier: ModelTier.CODING,
    modelId: process.env.MODEL_CODING || 'mistralai/devstral-2512:free',
    maxPromptTokens: 32000,
    maxOutputTokens: 8000,
    costTier: 'free',
    provider: 'mistralai',
  },
};

/**
 * Model used for routing decisions (small, cheap, fast)
 */
export const ROUTER_MODEL = process.env.MODEL_ROUTER || 'google/gemini-2.0-flash-exp:free';

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
  modelConfig: ModelConfig;
  routingMethod: 'heuristic' | 'routerModel' | 'hybrid';
  routingReason: string;
  confidence: number; // 0-1
  flags: RoutingFlags;
}

/**
 * Get model configuration for a tier
 */
export function getModelConfig(tier: ModelTier): ModelConfig {
  return DEFAULT_TIER_MODELS[tier];
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
