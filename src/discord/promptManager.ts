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

  getChatModel(channelId: string, personaId?: string): string {
    // Use persona-specific model if persona is provided
    if (personaId) {
      const persona = getPersona(personaId);
      if (persona?.model) {
        return persona.model;
      }
    }

    // Fall back to channel override model
    const overrideModel = this.overrides.get(channelId)?.chatModel;
    if (
      overrideModel &&
      config.openRouter.allowedChatModels.includes(overrideModel)
    ) {
      return overrideModel;
    }

    // Fall back to default chat model
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

    // Add memory summary if exists
    if (conversation.summaryData) {
      const summaryParts: string[] = [];
      
      if (conversation.summaryData.summary) {
        summaryParts.push(`Summary: ${conversation.summaryData.summary}`);
      }
      
      if (conversation.summaryData.facts.length > 0) {
        summaryParts.push(`Key facts:\n${conversation.summaryData.facts.map(f => `- ${f}`).join('\n')}`);
      }
      
      if (conversation.summaryData.preferences.length > 0) {
        summaryParts.push(`User preferences:\n${conversation.summaryData.preferences.map(p => `- ${p}`).join('\n')}`);
      }
      
      if (summaryParts.length > 0) {
        messages.push({
          role: 'system',
          content: `Previous conversation context:\n${summaryParts.join('\n\n')}`,
        });
      }
    }

    messages.push(...conversation.recentMessages);

    return {
      messages,
      model: this.getChatModel(channelId, activePersonaId),
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
