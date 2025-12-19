import { config } from '../config';
import { ConversationMemory } from '../ai/memoryManager';
import { Message } from '../ai/openRouterService';
import {
  getPersona,
  defaultPersonaId,
  isValidPersonaId,
  getAllPersonaIds,
} from '../personas.config';

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
  personaId?: string;
}

export interface ComposedPrompt {
  messages: Message[];
  model: string;
}

export class PromptManager {
  private overrides: Map<string, ChannelPromptOverrides>;
  private lastUsedPersona: Map<string, string>; // messageId -> personaId

  constructor() {
    this.overrides = new Map();
    this.lastUsedPersona = new Map();
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

  setPersona(channelId: string, personaId: string): boolean {
    if (!isValidPersonaId(personaId)) {
      return false;
    }
    const override = this.getOverrides(channelId);
    override.personaId = personaId.toLowerCase();
    this.overrides.set(channelId, override);
    return true;
  }

  getChannelPersona(channelId: string): string {
    const override = this.overrides.get(channelId);
    return override?.personaId || defaultPersonaId;
  }

  trackMessagePersona(messageId: string, personaId: string): void {
    this.lastUsedPersona.set(messageId, personaId);
  }

  getMessagePersona(messageId: string): string | undefined {
    return this.lastUsedPersona.get(messageId);
  }

  detectPersonaFromMessage(content: string): string | null {
    const contentLower = content.toLowerCase();
    const personaIds = getAllPersonaIds();

    // Check for persona names with word boundaries
    for (const personaId of personaIds) {
      const regex = new RegExp(`\\b${personaId}\\b`, 'i');
      if (regex.test(contentLower)) {
        return personaId;
      }
    }

    return null;
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
    conversation: ConversationMemory,
    personaId?: string
  ): ComposedPrompt {
    const messages: Message[] = [];

    // Use provided persona or channel default
    const activePersonaId = personaId || this.getChannelPersona(channelId);
    const persona = getPersona(activePersonaId);

    const systemPrompt = this.buildSystemPrompt(channelId);
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Add persona-specific prompts
    if (persona) {
      messages.push({
        role: 'system',
        content: persona.systemPrompt,
      });

      messages.push({
        role: 'system',
        content: persona.personalityPrompt,
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
