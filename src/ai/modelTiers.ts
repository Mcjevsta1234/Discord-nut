/**
 * Model Tier System & Routing Configuration
 * 
 * DEPRECATED: This file is being phased out.
 * Use config/routing.ts for all routing configuration.
 * 
 * This file now re-exports from the centralized config.
 */

// Re-export from centralized config
export {
  ModelTier,
  type TierConfig as ModelConfig,
  type RoutingConfig,
  type RoutingMode,
  type RetryPolicy,
  type RoutingFlags,
  type RoutingDecision,
  routingConfig,
  getTierConfig as getModelConfig,
  getAllTiers,
  isValidTier,
  validateRoutingConfig,
  logRoutingConfig,
} from '../config/routing';

// Legacy exports for backward compatibility
import { routingConfig } from '../config/routing';

export const DEFAULT_TIER_MODELS = routingConfig.tiers;
export const ROUTER_MODEL = routingConfig.routerModelId;
