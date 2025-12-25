import axios, { AxiosInstance } from 'axios';
import { ModelPoolsLoader } from './modelPoolsLoader';

// Cache control for Gemini prompt caching
interface ORCacheControl {
  type: 'ephemeral';
  ttl?: '1h';
}

// Multipart content for structured messages with caching
interface ORContentPart {
  type: 'text';
  text: string;
  cache_control?: ORCacheControl;
}

// OpenRouter message (string content OR multipart array)
interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ORContentPart[];
}

// Reasoning options (Gemini extended thinking)
interface ReasoningOpts {
  max_tokens: number;
  exclude: true;  // Never include reasoning in output
}

// Provider routing options
interface ProviderRouting {
  order?: string[];  // e.g., ["z-ai", "novita"]
  allow_fallbacks?: boolean;
}

// Response format for JSON-only responses
interface ResponseFormat {
  type: 'json_object' | 'json_schema';
  json_schema?: any;  // Optional JSON schema definition
}

// Plugin configuration (e.g., response-healing)
interface PluginConfig {
  id: string;
}

// Chat options with full control
interface ChatOpts {
  model: string;
  messages: OpenRouterMessage[];
  maxTokens?: number;
  temperature?: number;
  reasoning?: ReasoningOpts;
  includeUsage?: boolean;
  provider?: ProviderRouting;
  stream?: boolean;  // Default true if not specified
  response_format?: ResponseFormat;
  plugins?: PluginConfig[];
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;  // Gemini: tokens read from cache
    cache_creation_tokens?: number;  // Gemini: tokens written to cache
  };
  model?: string;  // Actual model used by OpenRouter
}

interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  preferredModel?: string;
  role?: 'base' | 'bulk' | 'escalation' | 'medium';
}

interface GenerationMetrics {
  model: string;
  startTime: number;
  endTime: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
}

export class OpenRouterClient {
  private client: AxiosInstance;
  private poolsLoader: ModelPoolsLoader | null = null;

  constructor(useModelPools: boolean = false) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }

    const baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000, // 2 minute timeout
    });

    // Initialize model pools if requested
    if (useModelPools) {
      try {
        this.poolsLoader = new ModelPoolsLoader();
      } catch (error: any) {
        console.warn(`Failed to load model pools: ${error.message}`);
        console.warn('Continuing without model pools...\n');
      }
    }
  }

  getModelForRole(role: 'base' | 'bulk' | 'escalation' | 'medium'): string {
    if (!this.poolsLoader) {
      // Fallback to hardcoded models (NO QWEN - rate limited)
      const fallbackMap = {
        base: 'nex-agi/deepseek-v3.1-nex-n1:free',
        escalation: 'nex-agi/deepseek-v3.1-nex-n1:free',
        bulk: 'kwaipilot/kat-coder-pro:free',
        medium: 'google/gemini-2.0-flash-exp:free'
      };
      return fallbackMap[role];
    }

    const roles = this.poolsLoader.getRoles();

    switch (role) {
      case 'base':
        return roles.BASE_MODEL;
      case 'escalation':
        return roles.ESCALATION_MODEL;
      case 'bulk':
        // Return first bulk model (scheduler will handle round-robin)
        return roles.BULK_MODELS[0] || 'kwaipilot/kat-coder-pro:free';
      case 'medium':
        return roles.MEDIUM_MODELS[0] || roles.BASE_MODEL;
      default:
        return roles.BASE_MODEL;
    }
  }

  getPoolsLoader(): ModelPoolsLoader | null {
    return this.poolsLoader;
  }

  /**
   * Full-featured chat method with multipart content, caching, and reasoning support
   */
  async chat(opts: ChatOpts): Promise<string | { content: string; meta?: any }> {
    const maxRetries = 2;
    let lastError: any;
    const startTime = Date.now();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const body: any = {
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 32000,
        };

        // Add stream control (default true unless explicitly false for JSON)
        if (opts.stream !== undefined) {
          body.stream = opts.stream;
        }

        // Add response_format if specified (for JSON output)
        if (opts.response_format) {
          body.response_format = opts.response_format;
        }

        // Add plugins if specified (e.g., response-healing)
        if (opts.plugins) {
          body.plugins = opts.plugins;
        }

        // Add provider routing if specified
        if (opts.provider) {
          body.provider = opts.provider;
        }

        // Add reasoning if specified (Gemini extended thinking)
        if (opts.reasoning) {
          body.reasoning = opts.reasoning;
        }

        // Add usage tracking if requested
        if (opts.includeUsage) {
          body.usage = { include: true };
        }

        const response = await this.client.post<OpenRouterResponse>('/chat/completions', body);

        const content = response.data.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from LLM');
        }

        // Log usage if available
        if (opts.includeUsage && response.data.usage) {
          const { prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens } = response.data.usage;
          const duration = (Date.now() - startTime) / 1000;
          let usageMsg = `[Usage] Prompt: ${prompt_tokens}, Completion: ${completion_tokens}, Total: ${total_tokens}`;
          if (cache_read_tokens || cache_creation_tokens) {
            usageMsg += ` | Cache: read=${cache_read_tokens || 0}, created=${cache_creation_tokens || 0}`;
          }
          usageMsg += `, Duration: ${duration.toFixed(1)}s`;
          console.log(`  ${usageMsg}`);
        }

        // Return content + meta if usage tracking enabled
        if (opts.includeUsage) {
          return {
            content,
            meta: {
              usage: response.data.usage,
              cache_discount: (response.data as any).cache_discount,
              model: response.data.model || opts.model,
              duration: (Date.now() - startTime) / 1000
            }
          };
        }

        return content;
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
        
        if (attempt < maxRetries - 1) {
          console.warn(`  ⚠️ Attempt ${attempt + 1} failed: ${errorMsg}`);
          console.warn(`  Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.error(`  ❌ All ${maxRetries} attempts failed: ${errorMsg}`);
        }
      }
    }

    throw new Error(`Chat call failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  async callLLM(prompt: string, opts: CallOptions = {}): Promise<{ content: string; metrics: GenerationMetrics }> {
    const maxRetries = 2;
    let lastError: any;
    
    // Determine model from role or explicit preference
    let model: string;
    if (opts.preferredModel || opts.model) {
      model = opts.preferredModel || opts.model!;
    } else if (opts.role) {
      model = this.getModelForRole(opts.role);
    } else {
      // Default to base model
      model = this.getModelForRole('base');
    }
    
    const startTime = Date.now();

    // Route through chat() method with simple message
    try {
      const response = await this.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: opts.maxTokens ?? 32000,
        temperature: opts.temperature ?? 0.2,
      });

      const content = typeof response === 'string' ? response : response.content;

      const endTime = Date.now();
      const metrics: GenerationMetrics = {
        model,
        startTime,
        endTime,
      };

      return { content, metrics };
    } catch (error: any) {
      throw new Error(`LLM call failed: ${error.message || 'Unknown error'}`);
    }
  }
}

export function createClient(useModelPools: boolean = false): OpenRouterClient {
  return new OpenRouterClient(useModelPools);
}
