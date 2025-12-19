import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

  constructor() {
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
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
}
