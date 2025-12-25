import { Message, OpenRouterService } from '../llm/openRouterService';
import { config } from '../config';
import { routingConfig } from '../config/routing';

export interface MemorySummary {
  summary: string;
  facts: string[];
  preferences: string[];
  lastUpdated: number;
}

export interface ConversationMemory {
  summaryData?: MemorySummary;
  recentMessages: Message[];
}

export class MemoryManager {
  private memories: Map<string, ConversationMemory>;
  private aiService: OpenRouterService;
  private readonly MAX_RECENT_MESSAGES = 10;
  private readonly SUMMARIZATION_THRESHOLD = 12;

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

    // Trigger summarization when threshold is reached
    if (
      config.bot.enableSummary &&
      memory.recentMessages.length >= this.SUMMARIZATION_THRESHOLD
    ) {
      await this.summarizeAndTrim(channelId);
    } else if (memory.recentMessages.length > this.MAX_RECENT_MESSAGES * 3) {
      // Hard limit: trim oldest messages if summary is disabled
      memory.recentMessages = memory.recentMessages.slice(-this.MAX_RECENT_MESSAGES);
    }
  }

  private async summarizeAndTrim(channelId: string): Promise<void> {
    const memory = this.getMemory(channelId);
    const messagesToSummarize = memory.recentMessages.slice(
      0,
      -this.MAX_RECENT_MESSAGES
    );

    if (messagesToSummarize.length === 0) return;

    try {
      const summaryPrompt: Message[] = [
        {
          role: 'system',
          content: `Summarize this conversation into concise facts and preferences. Ignore jokes, banter, and tool errors. Focus on: decisions made, ongoing tasks, user preferences, important context.

Output format:
SUMMARY: One sentence overview
FACTS: Bullet list of key information
PREFERENCES: User preferences discovered

Be extremely concise. Skip irrelevant chatter.`,
        },
        ...messagesToSummarize,
        {
          role: 'user',
          content: 'Summarize the above conversation.',
        },
      ];

      // Summarization uses INSTANT tier (fast, cheap, good at summarization)
      const summaryText = await this.aiService.chatCompletion(
        summaryPrompt,
        routingConfig.tiers.INSTANT.modelId
      );

      // Parse summary into structured format
      const summary = this.parseSummary(summaryText);
      
      // Merge with existing summary if present
      if (memory.summaryData) {
        summary.facts = [...memory.summaryData.facts, ...summary.facts].slice(-10);
        summary.preferences = [
          ...memory.summaryData.preferences,
          ...summary.preferences,
        ].slice(-5);
      }

      memory.summaryData = {
        ...summary,
        lastUpdated: Date.now(),
      };

      // Keep only recent messages
      memory.recentMessages = memory.recentMessages.slice(-this.MAX_RECENT_MESSAGES);

      console.log(
        `✓ Summarized ${messagesToSummarize.length} messages for channel ${channelId}`
      );
    } catch (error) {
      console.warn(`⚠️ Summarization skipped for channel ${channelId}:`, error instanceof Error ? error.message : 'Unknown error');
      // Keep messages if summarization fails, but enforce hard limit
      memory.recentMessages = memory.recentMessages.slice(
        -this.MAX_RECENT_MESSAGES * 2
      );
    }
  }

  private parseSummary(text: string): Omit<MemorySummary, 'lastUpdated'> {
    const summary: Omit<MemorySummary, 'lastUpdated'> = {
      summary: '',
      facts: [],
      preferences: [],
    };

    // Extract summary line
    const summaryMatch = text.match(/SUMMARY:?\s*(.+?)(?:\n|$)/i);
    if (summaryMatch) {
      summary.summary = summaryMatch[1].trim();
    }

    // Extract facts
    const factsMatch = text.match(/FACTS:?\s*([\s\S]*?)(?:PREFERENCES|$)/i);
    if (factsMatch) {
      summary.facts = factsMatch[1]
        .split('\n')
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter((line) => line.length > 0 && line.length < 200);
    }

    // Extract preferences
    const preferencesMatch = text.match(/PREFERENCES:?\s*([\s\S]*?)$/i);
    if (preferencesMatch) {
      summary.preferences = preferencesMatch[1]
        .split('\n')
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter((line) => line.length > 0 && line.length < 200);
    }

    return summary;
  }

  getConversationContext(channelId: string): ConversationMemory {
    const memory = this.getMemory(channelId);

    return {
      summaryData: memory.summaryData,
      recentMessages: memory.recentMessages.slice(-this.MAX_RECENT_MESSAGES),
    };
  }

  /**
   * Build context for AI with summary prepended if exists
   */
  buildContextWithSummary(channelId: string): Message[] {
    const memory = this.getConversationContext(channelId);
    const messages: Message[] = [];

    // Include summary as system context if exists
    if (memory.summaryData) {
      const summaryText = this.formatSummaryForContext(memory.summaryData);
      messages.push({
        role: 'system',
        content: `Previous conversation context:\n${summaryText}`,
      });
    }

    // Add recent messages
    messages.push(...memory.recentMessages);

    return messages;
  }

  private formatSummaryForContext(summary: MemorySummary): string {
    const parts: string[] = [];

    if (summary.summary) {
      parts.push(`Summary: ${summary.summary}`);
    }

    if (summary.facts.length > 0) {
      parts.push(`Facts:\n${summary.facts.map((f) => `- ${f}`).join('\n')}`);
    }

    if (summary.preferences.length > 0) {
      parts.push(
        `Preferences:\n${summary.preferences.map((p) => `- ${p}`).join('\n')}`
      );
    }

    return parts.join('\n\n');
  }

  clearMemory(channelId: string): void {
    this.memories.delete(channelId);
    console.log(`Cleared memory for channel ${channelId}`);
  }

  getMemoryStats(channelId: string): {
    messageCount: number;
    hasSummary: boolean;
    factCount: number;
    preferenceCount: number;
  } {
    const memory = this.getMemory(channelId);
    return {
      messageCount: memory.recentMessages.length,
      hasSummary: !!memory.summaryData,
      factCount: memory.summaryData?.facts.length || 0,
      preferenceCount: memory.summaryData?.preferences.length || 0,
    };
  }
}
