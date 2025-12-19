import { Message, OpenRouterService } from './openRouterService';
import { config } from '../config';

export interface ConversationMemory {
  summary?: string;
  recentMessages: Message[];
}

export class MemoryManager {
  private memories: Map<string, ConversationMemory>;
  private aiService: OpenRouterService;

  constructor(aiService: OpenRouterService) {
    this.memories = new Map();
    this.aiService = aiService;
  }

  getMemory(channelId: string): ConversationMemory {
    if (!this.memories.has(channelId)) {
      this.memories.set(channelId, {
        recentMessages: [],
      });
    }
    return this.memories.get(channelId)!;
  }

  async addMessage(channelId: string, message: Message): Promise<void> {
    const memory = this.getMemory(channelId);
    memory.recentMessages.push(message);

    // If we have too many messages, summarize older ones
    if (
      config.bot.enableSummary &&
      memory.recentMessages.length > config.bot.maxMemoryMessages * 2
    ) {
      await this.summarizeOldMessages(channelId);
    } else if (memory.recentMessages.length > config.bot.maxMemoryMessages * 3) {
      // Hard limit: trim oldest messages if summary is disabled or fails
      memory.recentMessages = memory.recentMessages.slice(
        -config.bot.maxMemoryMessages * 2
      );
    }
  }

  private async summarizeOldMessages(channelId: string): Promise<void> {
    const memory = this.getMemory(channelId);
    const messagesToSummarize = memory.recentMessages.slice(
      0,
      config.bot.maxMemoryMessages
    );

    try {
      const summary = await this.aiService.summarizeConversation(
        messagesToSummarize
      );
      memory.summary = summary;
      memory.recentMessages = memory.recentMessages.slice(
        config.bot.maxMemoryMessages
      );
      console.log(`Summarized ${messagesToSummarize.length} messages for channel ${channelId}`);
    } catch (error) {
      console.error('Failed to summarize messages:', error);
      // Keep messages if summarization fails
    }
  }

  buildMessageHistory(channelId: string): Message[] {
    const memory = this.getMemory(channelId);
    const messages: Message[] = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: `${config.bot.systemPrompt}\n\nYour personality is: ${config.bot.personality}`,
    });

    // Add example messages if configured
    if (config.bot.exampleMessages.length > 0) {
      messages.push(...config.bot.exampleMessages);
    }

    // Add summary if exists
    if (memory.summary) {
      messages.push({
        role: 'system',
        content: `Previous conversation summary: ${memory.summary}`,
      });
    }

    // Add recent messages (keep only the last N messages)
    const recentCount = config.bot.maxMemoryMessages;
    const recentMessages = memory.recentMessages.slice(-recentCount);
    messages.push(...recentMessages);

    return messages;
  }

  clearMemory(channelId: string): void {
    this.memories.delete(channelId);
    console.log(`Cleared memory for channel ${channelId}`);
  }

  getMemoryStats(channelId: string): {
    messageCount: number;
    hasSummary: boolean;
  } {
    const memory = this.getMemory(channelId);
    return {
      messageCount: memory.recentMessages.length,
      hasSummary: !!memory.summary,
    };
  }
}
