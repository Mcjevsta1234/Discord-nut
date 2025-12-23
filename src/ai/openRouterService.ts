import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { routingConfig } from '../config/routing';
import { MCPClient, MCPToolResult } from '../mcp';
import { LLMResponse, LLMResponseMetadata, calculateCost } from './llmMetadata';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouteDecision {
  route: 'chat' | 'tool' | 'image';
  toolName?: string;
  toolParams?: Record<string, any>;
  imagePrompt?: string;
  imageResolution?: { width: number; height: number };
  reasoning?: string;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
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
    options?: {
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      provider?: {
        order?: string[];
        allow_fallbacks?: boolean;
      };
    }
  ): Promise<LLMResponse> {
    const requestTimestamp = Date.now();
    const selectedModel = model; // Model selection happens at RouterService level
    
    try {
      const response = await this.client.post<ChatCompletionResponse>(
        '/chat/completions',
        {
          model: selectedModel,
          messages,
          ...(options?.temperature !== undefined && { temperature: options.temperature }),
          ...(options?.max_tokens !== undefined && { max_tokens: options.max_tokens }),
          ...(options?.top_p !== undefined && { top_p: options.top_p }),
          ...(options?.provider && { provider: options.provider }),
        }
      );

      const responseTimestamp = Date.now();
      const content = response.data.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in response');
      }

      // Extract token usage from response
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

      // Calculate cost if usage is available
      if (metadata.usage && metadata.usage.totalTokens) {
        metadata.estimatedCost = calculateCost(metadata.usage, metadata.model);
        metadata.costCurrency = 'USD';
      }

      return { content, metadata };
    } catch (error) {
      const responseTimestamp = Date.now();
      
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
        const errorMsg = error.response?.data?.error?.message || error.message;
        throw new Error(`OpenRouter API error: ${errorMsg}`);
      }
      throw error;
    }
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
