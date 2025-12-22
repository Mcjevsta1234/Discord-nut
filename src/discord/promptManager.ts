import { config } from '../config';
import { ConversationMemory } from '../ai/memoryManager';
import { Message } from '../ai/openRouterService';
import {
  getPersona,
  defaultPersonaId,
  isValidPersonaId,
  getAllPersonaIds,
  resolvePersonaId,
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
  // DEPRECATED: Model is now selected by RouterService, not PromptManager
  // This field is kept for backward compatibility but should not be used
  model?: string;
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
    // Resolve aliases (e.g., "emma" -> "mimi")
    override.personaId = resolvePersonaId(personaId);
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

  /**
   * DEPRECATED: Model selection is now handled by RouterService
   * This method should not be used - all model selection happens via RouterService
   */
  getChatModel(channelId: string, personaId?: string): string {
    console.error('❌ getChatModel() called but is deprecated! Use RouterService.route() instead.');
    throw new Error('getChatModel() is deprecated. Use RouterService for model selection.');
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

    // NOTE: model field is deprecated and no longer populated
    // RouterService handles all model selection
    return {
      messages,
    };
  }

  /**
   * Create minimal prompt for INSTANT tier (token optimization)
   * Strips out:
   * - Memory summaries
   * - Example messages
   * - Extra system prompts
   * Includes only:
   * - Minimal system prompt
   * - Compressed persona
   * - Latest user message only
   */
  composeMinimalPromptForInstant(
    channelId: string,
    latestUserMessage: Message,
    personaId?: string
  ): ComposedPrompt {
    const messages: Message[] = [];

    // Minimal system prompt
    messages.push({
      role: 'system',
      content: 'You are a helpful AI assistant. Be concise and friendly.',
    });

    // Compressed persona (if available)
    const activePersonaId = personaId || this.getChannelPersona(channelId);
    const persona = getPersona(activePersonaId);
    
    if (persona) {
      // Use only the personality prompt (shorter)
      messages.push({
        role: 'system',
        content: persona.personalityPrompt,
      });
    }

    // Only the latest user message
    messages.push(latestUserMessage);

    return {
      messages,
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
