import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { MCPClient, MCPToolResult } from '../mcp';

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

  async chatCompletion(messages: Message[], model?: string): Promise<string> {
    try {
      const response = await this.client.post<ChatCompletionResponse>(
        '/chat/completions',
        {
          model: model || config.openRouter.models.chat,
          messages,
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in response');
      }

      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `OpenRouter API error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
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

      return await this.chatCompletion(
        summaryPrompt,
        config.openRouter.models.summarizer
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

      return await this.chatCompletion(
        routingPrompt,
        config.openRouter.models.router
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
- Use "image" route ONLY when user explicitly asks for image generation, pictures, drawings, or visual content
- If unclear whether they want an image, use "chat" and ask for clarification
- Use "tool" when explicitly needed (e.g., current time, web search, calculations)
- Default to "chat" for general conversation
- For imagePrompt: Use the user's EXACT words/prompt without modification. Do NOT add details, improvements, or elaborations unless the user specifically requests you to "enhance", "improve", or "add details to" their prompt`,
        },
        {
          role: 'user',
          content: query,
        },
      ];

      const response = await this.chatCompletion(
        routingPrompt,
        config.openRouter.models.router
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
