/**
 * PART F: Enhanced OpenRouter Call Logging
 * 
 * Logs every OpenRouter API call to persona-specific daily log files
 * with full details: model, pipeline, projectType, tokens, latency, caching
 */

import * as fs from 'fs';
import * as path from 'path';
import { LLMResponseMetadata } from './llmMetadata';
import { PipelineType, ProjectType } from '../jobs/types';

interface OpenRouterCallLog {
  timestamp: string;
  model: string;
  pipeline?: PipelineType;
  projectType?: ProjectType;
  userId: string;
  persona: string;
  stage: 'prompter' | 'planner' | 'coder' | 'chat' | 'direct_cached';
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs: number;
  cost?: number;
  // Caching fields (may not be present in all responses)
  cacheRead?: number;
  cacheCreation?: number;
  success: boolean;
  error?: string;
}

/**
 * Log an OpenRouter API call to persona-specific daily log
 * 
 * Log path: logs/{userId}/{persona}/{YYYY-MM-DD}.log
 */
export function logOpenRouterCall(
  userId: string,
  persona: string,
  stage: OpenRouterCallLog['stage'],
  metadata: LLMResponseMetadata,
  options?: {
    pipeline?: PipelineType;
    projectType?: ProjectType;
  }
): void {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // logs/userId/persona/YYYY-MM-DD.log
    const logDir = path.join('logs', userId, persona);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logPath = path.join(logDir, `${dateStr}.log`);
    
    const logEntry: OpenRouterCallLog = {
      timestamp: now.toISOString(),
      model: metadata.model,
      pipeline: options?.pipeline,
      projectType: options?.projectType,
      userId,
      persona,
      stage,
      tokens: metadata.usage ? {
        prompt: metadata.usage.promptTokens || 0,
        completion: metadata.usage.completionTokens || 0,
        total: metadata.usage.totalTokens || 0,
      } : undefined,
      latencyMs: metadata.latencyMs || 0,
      cost: metadata.estimatedCost,
      success: metadata.success,
      error: metadata.error,
    };
    
    // Extract caching fields if present (OpenRouter returns these for cache-capable models)
    // These fields are not part of standard LLMResponseMetadata, so we check raw usage
    if (metadata.usage) {
      const usageAny = metadata.usage as any;
      if (usageAny.prompt_tokens_details?.cached_tokens) {
        logEntry.cacheRead = usageAny.prompt_tokens_details.cached_tokens;
      }
      if (usageAny.prompt_tokens_details?.cache_creation_input_tokens) {
        logEntry.cacheCreation = usageAny.prompt_tokens_details.cache_creation_input_tokens;
      }
    }
    
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logPath, logLine, 'utf-8');
    
    console.log(`📝 Logged OpenRouter call: ${userId}/${persona}/${dateStr}.log (${stage})`);
  } catch (error) {
    // Logging failures should never crash the bot
    console.error('Failed to log OpenRouter call:', error);
  }
}
