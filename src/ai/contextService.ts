import { Message } from './openRouterService';
import { FileContextManager } from './fileContextManager';

/**
 * ContextService - single entry point for conversation context.
 * - Loads and saves plain-text chat messages
 * - Handles trimming and expiration (delegated to FileContextManager)
 * - Handles clear operations (user/channel/guild)
 *
 * NO LLM logic here. NO business logic from handlers.
 */
export class ContextService {
  private storage: FileContextManager;

  constructor(storage?: FileContextManager) {
    this.storage = storage || new FileContextManager();
  }

  /**
   * Load isolated context for a Discord user in a channel/guild or DM.
   * Returns messages in {role, content}[] format.
   * 
   * PART F: Includes persona for isolation
   */
  async load(userId: string, channelId?: string, guildId?: string, persona?: string): Promise<Message[]> {
    return await this.storage.loadContext(userId, channelId, guildId, persona);
  }

  /**
   * Append a single message (user or assistant)
   * 
   * PART F: Includes persona for isolation
   */
  async append(userId: string, msg: Message, channelId?: string, guildId?: string, persona?: string): Promise<void> {
    await this.storage.appendMessage(userId, msg, channelId, guildId, persona);
  }

  /**
   * Append user + assistant messages atomically in order
   * 
   * PART F: Includes persona for isolation
   */
  async appendUserAndAssistant(
    userId: string,
    userMsg: Message,
    assistantMsg: Message,
    channelId?: string,
    guildId?: string,
    persona?: string
  ): Promise<void> {
    await this.storage.appendMessages(userId, [userMsg, assistantMsg], channelId, guildId, persona);
  }

  /**
   * Periodic cleanup of expired context files
   */
  async cleanupExpired(): Promise<void> {
    await this.storage.cleanupExpiredContexts();
  }

  /**
   * Clear context for a specific user in a channel/guild or DM
   */
  async clearUser(userId: string, channelId?: string, guildId?: string): Promise<void> {
    await this.storage.deleteContext(userId, channelId, guildId);
  }

  /**
   * Clear all contexts for a channel
   */
  async clearChannel(guildId: string, channelId: string): Promise<void> {
    await this.storage.deleteChannelContexts(guildId, channelId);
  }

  /**
   * Clear all contexts for a guild
   */
  async clearGuild(guildId: string): Promise<void> {
    await this.storage.deleteGuildContexts(guildId);
  }
}
