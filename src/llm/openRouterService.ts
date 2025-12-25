import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { routingConfig } from '../config/routing';
import { MCPClient, MCPToolResult } from '../mcp';
import { LLMResponse, LLMResponseMetadata, calculateCost } from './llmMetadata';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[]; // Support content blocks for caching
  reasoning_details?: any[]; // For reasoning preservation across iterations
}

/**
 * PART A: Content blocks for OpenRouter prompt caching
 */
export interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Build a message with cached content blocks
 * 
 * PART A: Cached blocks MUST be byte-for-byte identical across requests.
 * NO timestamps, NO job IDs, NO dynamic data in cached sections.
 * 
 * @param cachedBlocks - Stable content to cache (system prompts, schemas, rubrics)
 * @param dynamicContent - Dynamic user request (not cached)
 * @returns Message with content blocks
 */
export function buildCachedMessage(
  role: 'system' | 'user',
  cachedBlocks: string[],
  dynamicContent?: string,
  model?: string
): Message {
  const enableCaching = process.env.OPENROUTER_PROMPT_CACHE !== '0';
  
  // Import modelSupportsCaching dynamically to avoid circular dependency
  let modelCachingSupported = false;
  if (model) {
    try {
      const { modelSupportsCaching } = require('./modelCaps');
      modelCachingSupported = modelSupportsCaching(model);
    } catch (e) {
      // Fallback if import fails
      modelCachingSupported = false;
    }
  }
  
  if (!enableCaching || !modelCachingSupported) {
    // Caching disabled or model doesn't support it - send as plain string
    const allContent = [...cachedBlocks, dynamicContent].filter(Boolean).join('\n\n');
    console.log(`📝 buildCachedMessage: model=${model}, caching=${modelCachingSupported}, blocks=${cachedBlocks.length}, dynamic=${dynamicContent?.length || 0}, result=${allContent.length} chars`);
    return { role, content: allContent };
  }

  // Build content blocks with caching
  const blocks: ContentBlock[] = cachedBlocks.map(text => ({
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  }));

  // Append dynamic content without caching
  if (dynamicContent) {
    blocks.push({
      type: 'text',
      text: dynamicContent,
    });
  }

  return { role, content: blocks };
}

export interface RouteDecision {
  route: 'chat' | 'tool' | 'image';
  toolName?: string;
  toolParams?: Record<string, any>;
  imagePrompt?: string;
  imageResolution?: { width: number; height: number };
  reasoning?: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  provider?: any;
  reasoning?: { enabled: boolean };
  stream?: boolean;
  response_format?: { type: 'json_object' };
  plugins?: Array<{ id: string }>;
  includeUsage?: boolean;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
      reasoning_details?: any[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;  // For models with cache support (e.g., Gemini)
  };
  model?: string;
}

export class OpenRouterService {
  private client: AxiosInstance;
  private mcpClient: MCPClient;

  constructor(mcpClient?: MCPClient) {
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.mcpClient = mcpClient || new MCPClient();
  }

  /**
   * Chat completion with metadata tracking
   * Returns both content and token usage information
   * 
   * NOTE: Model should be selected via RouterService.
   * This is a low-level method that accepts any model ID.
   */
  async chatCompletionWithMetadata(
    messages: Message[], 
    model: string,
    options?: ChatCompletionOptions
  ): Promise<LLMResponse> {
    const requestTimestamp = Date.now();
    const selectedModel = model; // Model selection happens at RouterService level
    
    // LOG: Request details
    console.log('\n🔍 === OPENROUTER API REQUEST ===');
    console.log('Model:', selectedModel);
    console.log('Messages:', JSON.stringify(messages.map(m => {
      if (typeof m.content === 'string') {
        return {
          role: m.role,
          contentLength: m.content.length,
          preview: m.content.substring(0, 200)
        };
      } else {
        // ContentBlock[] - calculate total text length
        const totalChars = m.content.reduce((sum, block) => sum + (block.text?.length || 0), 0);
        const hasCaching = m.content.some(block => block.cache_control);
        return {
          role: m.role,
          contentBlocks: m.content.length,
          totalChars,
          hasCaching,
          preview: m.content[0]?.text?.substring(0, 150) || '[empty]'
        };
      }
    }), null, 2));
    if (options?.provider) console.log('Provider config:', JSON.stringify(options.provider));
    if (options?.reasoning) console.log('Reasoning config:', JSON.stringify(options.reasoning));
    
    // Retry logic for rate limits
    const maxRetries = 2;
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`⏳ Retry attempt ${attempt}/${maxRetries} after rate limit...`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
      }
      
      try {
        const requestBody: any = {
        model: selectedModel,
        messages,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.max_tokens !== undefined && { max_tokens: options.max_tokens }),
        ...(options?.top_p !== undefined && { top_p: options.top_p }),
        provider: options?.provider || { sort: 'throughput' },
        ...(options?.reasoning && { reasoning: options.reasoning }),
      };
      
      // JSON mode and healing for codegen
      if (options?.stream !== undefined) requestBody.stream = options.stream;
      if (options?.response_format) requestBody.response_format = options.response_format;
      if (options?.plugins) requestBody.plugins = options.plugins;
      if (options?.includeUsage) requestBody.usage = { include: true };
      
      const response = await this.client.post<ChatCompletionResponse>(
        '/chat/completions',
        requestBody,
        {
          timeout: 600000, // 3 minute timeout for code generation
        }
      );

      const responseTimestamp = Date.now();
      
      // Check if response has expected structure FIRST
      if (!response.data || !response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
        console.log('❌ Response received in', responseTimestamp - requestTimestamp, 'ms');
        console.error('🚨 Invalid API response structure:', JSON.stringify(response.data, null, 2));
        
        // Check for API error message
        if (response.data && 'error' in response.data) {
          const apiError = (response.data as any).error;
          throw new Error(`OpenRouter API error: ${apiError.message || JSON.stringify(apiError)}`);
        }
        
        throw new Error('Invalid response structure from OpenRouter API - no choices array');
      }
      
      // LOG: Response details
      console.log('✅ Response received in', responseTimestamp - requestTimestamp, 'ms');
      console.log('Response model:', response.data.model);
      console.log('Response content length:', response.data.choices[0]?.message?.content?.length || 0);
      console.log('Response preview:', response.data.choices[0]?.message?.content?.substring(0, 300));
      console.log('=== END REQUEST ===\n');
      
      const content = response.data.choices[0]?.message?.content;
      const reasoning_details = response.data.choices[0]?.message?.reasoning_details;
      
      if (!content) {
        throw new Error('No content in response');
      }

      // Extract token usage from response
      // OpenRouter includes: prompt_tokens, completion_tokens, total_tokens
      // For models with cache support (e.g., Gemini): cache_read_tokens
      const usage = response.data.usage;
      const metadata: LLMResponseMetadata = {
        model: response.data.model || selectedModel,
        provider: 'openrouter',
        usage: usage ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          // Cache-read tokens are charged at reduced rate for models like Gemini
          cacheReadTokens: usage.cache_read_tokens || 0,
        } : undefined,
        latencyMs: responseTimestamp - requestTimestamp,
        requestTimestamp,
        responseTimestamp,
        success: true,
      };

      // Calculate cost if usage is available
      if (metadata.usage && metadata.usage.totalTokens) {
        metadata.estimatedCost = calculateCost(metadata.usage, metadata.model);
        metadata.costCurrency = 'USD';
      }

      return { content, metadata, reasoning_details };
      } catch (error) {
        lastError = error;
        
        // Check if it's a rate limit error (429)
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          console.warn(`⚠️ Rate limited (attempt ${attempt + 1}/${maxRetries + 1})`);
          if (attempt < maxRetries) {
            continue; // Retry
          }
        }
        
        // Not a rate limit or out of retries - break and handle error
        break;
      }
    }
    
    // If we get here, all retries failed
    const responseTimestamp = Date.now();
    const error = lastError;
    
    // Log detailed error information
    if (axios.isAxiosError(error)) {
      console.error('OpenRouter API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        model: selectedModel,
      });
    } else {
      console.error('Non-Axios error in chatCompletionWithMetadata:', error);
    }
    
    // Return error metadata
    const errorMetadata: LLMResponseMetadata = {
      model: selectedModel,
      provider: 'openrouter',
      latencyMs: responseTimestamp - requestTimestamp,
      requestTimestamp,
      responseTimestamp,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data?.error;
      const errorMsg = errorData?.message || error.message;
      
      // User-friendly error messages
      if (status === 429) {
        throw new Error(`⏱️ **Rate Limit Reached**\n\nThe AI provider is receiving too many requests. Please try again in a few moments.`);
      } else if (status === 402 || status === 403) {
        throw new Error(`💳 **Payment Required**\n\nThe API key has insufficient credits or has been deactivated. Please contact the bot administrator.`);
      } else if (status === 400) {
        throw new Error(`⚠️ **Invalid Request**\n\n${errorMsg}\n\nThis might be a configuration issue. Please contact the bot administrator.`);
      } else if (status === 500 || status === 502 || status === 503) {
        throw new Error(`🔧 **Service Unavailable**\n\nThe AI provider is experiencing technical difficulties. Please try again later.`);
      } else {
        throw new Error(`❌ **API Error**\n\n${errorMsg}`);
      }
    }
    throw error;
  }

  /**
   * Legacy method - kept for backward compatibility
   * Prefer chatCompletionWithMetadata for new code
   * 
   * NOTE: This should only be used for special-purpose calls.
   * For chat responses, use RouterService to select the model.
   */
  async chatCompletion(messages: Message[], model: string): Promise<string> {
    const response = await this.chatCompletionWithMetadata(messages, model);
    return response.content;
  }

  /**
   * Planning completion with metadata tracking
   * Uses a fast, cheap model optimized for structured planning output
   */
  async planCompletionWithMetadata(messages: Message[]): Promise<LLMResponse> {
    const requestTimestamp = Date.now();
    // Planner uses INSTANT tier model (fast, cheap, good at structured output)
    const selectedModel = routingConfig.tiers.INSTANT.modelId;
    
    try {
      const response = await this.client.post<ChatCompletionResponse>(
        '/chat/completions',
        {
          model: selectedModel,
          messages,
          temperature: 0,
          top_p: 1,
          max_tokens: 256,
          response_format: { type: 'json_object' },
        }
      );

      const responseTimestamp = Date.now();
      const content = response.data.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in planner response');
      }

      const usage = response.data.usage;
      const metadata: LLMResponseMetadata = {
        model: response.data.model || selectedModel,
        provider: 'openrouter',
        usage: usage ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        } : undefined,
        latencyMs: responseTimestamp - requestTimestamp,
        requestTimestamp,
        responseTimestamp,
        success: true,
      };

      if (metadata.usage && metadata.usage.totalTokens) {
        metadata.estimatedCost = calculateCost(metadata.usage, metadata.model);
        metadata.costCurrency = 'USD';
      }

      return { content, metadata };
    } catch (error) {
      const responseTimestamp = Date.now();
      
      const errorMetadata: LLMResponseMetadata = {
        model: selectedModel,
        provider: 'openrouter',
        latencyMs: responseTimestamp - requestTimestamp,
        requestTimestamp,
        responseTimestamp,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      if (axios.isAxiosError(error)) {
        throw new Error(
          `OpenRouter planner error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Strict planning completion with temperature 0 for deterministic JSON output
   * Legacy method - kept for backward compatibility
   */
  async planCompletion(messages: Message[]): Promise<string> {
    const response = await this.planCompletionWithMetadata(messages);
    return response.content;
  }

  async summarizeConversation(messages: Message[]): Promise<string> {
    try {
      const summaryPrompt: Message[] = [
        {
          role: 'system',
          content:
            'You are a conversation summarizer. Summarize the following conversation concisely, capturing key points and context.',
        },
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${messages
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n')}`,
        },
      ];

      // Summarization uses INSTANT tier (fast, cheap, good at summarization)
      return await this.chatCompletion(
        summaryPrompt,
        routingConfig.tiers.INSTANT.modelId
      );
    } catch (error) {
      console.error('Error summarizing conversation:', error);
      return 'Previous conversation context';
    }
  }

  async routeQuery(query: string): Promise<string> {
    try {
      const routingPrompt: Message[] = [
        {
          role: 'system',
          content:
            'You are a query router. Determine the best way to handle this query and respond appropriately.',
        },
        {
          role: 'user',
          content: query,
        },
      ];

      // Use router model for routing decisions
      return await this.chatCompletion(
        routingPrompt,
        routingConfig.routerModelId
      );
    } catch (error) {
      console.error('Error routing query:', error);
      throw error;
    }
  }

  /**
   * Determine if a query should use a tool and which one
   */
  async decideRoute(query: string): Promise<RouteDecision> {
    try {
      const availableTools = this.mcpClient.getAvailableTools();
      const toolList = availableTools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join('\n');

      const routingPrompt: Message[] = [
        {
          role: 'system',
          content: `You are a query router. Analyze the user's query and decide if it requires a tool, image generation, or regular chat.

Available tools:
${toolList}

IMPORTANT Tool Detection Rules:
- Math expressions (e.g., "14*3+9", "what's 5+5") → use "calculate" tool
- Unit conversions (e.g., "6ft to cm", "convert 50kg to pounds") → use "convert_units" tool
- Currency conversions (e.g., "£25 in USD", "$100 to EUR") → use "convert_currency" tool
- GitHub queries (e.g., "summarize owner/repo", "what does this repo do") → use "github_repo" tool with action="readme"
- Time queries → use "get_time" tool
- Web searches ("search for", "find", "look up") → use "searxng_search" tool
- URLs/links in message → use "fetch_url" tool
- Minecraft server status → use "minecraft_status" tool

Critical: GitHub repo summaries require action="readme" parameter

Respond with ONLY a JSON object in this format:

For regular chat:
{
  "route": "chat",
  "reasoning": "brief explanation"
}

For tool usage:
{
  "route": "tool",
  "toolName": "tool_name",
  "toolParams": {"param": "value"},
  "reasoning": "brief explanation"
}

For image generation (ONLY when user explicitly or clearly requests visual/image creation):
{
  "route": "image",
  "imagePrompt": "user's exact prompt",
  "imageResolution": {"width": 512, "height": 512},
  "reasoning": "brief explanation"
}

Routing rules:
- ALWAYS prefer tools over chat for deterministic tasks (math, conversions, repo info)
- Use "image" route ONLY when user explicitly asks for image generation, pictures, drawings, or visual content
- If unclear whether they want an image, use "chat" and ask for clarification
- Default to "chat" only for general conversation that doesn't fit any tool
- For imagePrompt: Use the user's EXACT words/prompt without modification`,
        },
        {
          role: 'user',
          content: query,
        },
      ];

      const response = await this.chatCompletion(
        routingPrompt,
        routingConfig.routerModelId
      );

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Default to chat if parsing fails
        return { route: 'chat' };
      }

      const decision = JSON.parse(jsonMatch[0]) as RouteDecision;
      return decision;
    } catch (error) {
      console.error('Error deciding route:', error);
      // Default to chat on error
      return { route: 'chat' };
    }
  }

  /**
   * Execute an MCP tool
   */
  async executeMCPTool(
    toolName: string,
    params: Record<string, any>
  ): Promise<MCPToolResult> {
    return await this.mcpClient.executeTool(toolName, params);
  }

  /**
   * Get available MCP tools
   */
  getAvailableMCPTools(): Array<{ name: string; description: string }> {
    return this.mcpClient.getAvailableTools();
  }

  /**
   * Get the MCP client instance
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }
}
