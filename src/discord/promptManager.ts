import { config } from '../config';
import { ConversationMemory } from '../ai/memoryManager';
import { Message } from '../ai/openRouterService';

type OverrideMode = 'replace' | 'append' | 'clear';

export interface ChannelPromptOverrides {
  systemPrompt?: {
    mode: OverrideMode;
    content?: string;
  };
  chatModel?: string;
  triggerNames?: {
    mode: OverrideMode;
    names: string[];
  };
}

export interface ComposedPrompt {
  messages: Message[];
  model: string;
}

export class PromptManager {
  private overrides: Map<string, ChannelPromptOverrides>;

  constructor() {
    this.overrides = new Map();
  }

  updateSystemPrompt(
    channelId: string,
    mode: OverrideMode,
    content?: string
  ): void {
    const override = this.getOverrides(channelId);
    override.systemPrompt = { mode, content: content?.trim() };
    this.overrides.set(channelId, override);
  }

  updateChatModel(channelId: string, model: string): void {
    const override = this.getOverrides(channelId);
    override.chatModel = model;
    this.overrides.set(channelId, override);
  }

  updateTriggerNames(
    channelId: string,
    mode: OverrideMode,
    names: string[]
  ): void {
    const override = this.getOverrides(channelId);
    override.triggerNames = {
      mode,
      names: names.map((name) => name.toLowerCase()).filter(Boolean),
    };
    this.overrides.set(channelId, override);
  }

  getTriggerNames(channelId: string): string[] {
    const override = this.overrides.get(channelId);
    const baseTriggers = config.bot.triggerNames;

    if (override?.triggerNames?.mode === 'clear') {
      return [];
    }

    if (override?.triggerNames?.mode === 'replace') {
      return override.triggerNames.names;
    }

    if (override?.triggerNames?.mode === 'append') {
      return Array.from(
        new Set([...baseTriggers, ...override.triggerNames.names])
      );
    }

    return baseTriggers;
  }

  getChatModel(channelId: string): string {
    const overrideModel = this.overrides.get(channelId)?.chatModel;
    if (
      overrideModel &&
      config.openRouter.allowedChatModels.includes(overrideModel)
    ) {
      return overrideModel;
    }
    return config.openRouter.models.chat;
  }

  composeChatPrompt(
    channelId: string,
    conversation: ConversationMemory
  ): ComposedPrompt {
    const messages: Message[] = [];

    const systemPrompt = this.buildSystemPrompt(channelId);
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    if (config.bot.personality) {
      messages.push({
        role: 'system',
        content: `Personality: ${config.bot.personality}`,
      });
    }

    if (config.bot.exampleMessages.length > 0) {
      messages.push(...config.bot.exampleMessages);
    }

    if (conversation.summary) {
      messages.push({
        role: 'system',
        content: `Previous conversation summary: ${conversation.summary}`,
      });
    }

    messages.push(...conversation.recentMessages);

    return {
      messages,
      model: this.getChatModel(channelId),
    };
  }

  private getOverrides(channelId: string): ChannelPromptOverrides {
    if (!this.overrides.has(channelId)) {
      this.overrides.set(channelId, {});
    }
    return this.overrides.get(channelId)!;
  }

  private buildSystemPrompt(channelId: string): string {
    const override = this.overrides.get(channelId)?.systemPrompt;
    const basePrompt = config.bot.systemPrompt;

    if (!override) {
      return basePrompt;
    }

    if (override.mode === 'clear') {
      return '';
    }

    if (override.mode === 'replace') {
      return override.content || '';
    }

    if (override.mode === 'append') {
      const appended = [basePrompt, override.content || '']
        .filter(Boolean)
        .join('\n');
      return appended.trim();
    }

    return basePrompt;
  }
}
