/**
 * File-based Context Manager
 * 
 * Stores conversation context locally in JSON files with zero leakage.
 * 
 * Context isolation:
 * - Guilds: key = guildId + channelId + userId
 * - DMs: key = userId only
 * 
 * Storage structure:
 * - context/guilds/{guildId}/{channelId}/{userId}.json
 * - context/dms/{userId}.json
 * 
 * What gets stored:
 * - User messages (plain text)
 * - Final assistant replies (plain text only)
 * - No embeds, no planner output, no routing info, no token stats
 */

import fs from 'fs';
import path from 'path';
import { Message } from './openRouterService';

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ContextFile {
  version: number;
  createdAt: number;
  lastUpdated: number;
  expiresAt: number;
  messages: StoredMessage[];
}

export class FileContextManager {
  private readonly contextDir = path.join(process.cwd(), 'context');
  private readonly MAX_MESSAGES = 15; // Conservative: 10-20 range
  private readonly EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly VERSION = 1;

  constructor() {
    // Ensure context directory exists
    this.ensureDirectories();
  }

  /**
   * Load context from disk
   * Guilds: guildId + channelId + userId + persona
   * DMs: userId + persona
   * 
   * PART F: Persona isolation - each persona has separate context
   */
  async loadContext(
    userId: string,
    channelId?: string,
    guildId?: string,
    persona?: string
  ): Promise<Message[]> {
    try {
      const contextPath = this.getContextPath(userId, channelId, guildId, persona);

      if (!fs.existsSync(contextPath)) {
        return []; // No context file yet
      }

      const raw = fs.readFileSync(contextPath, 'utf-8');
      const data = JSON.parse(raw) as ContextFile;

      // Check expiration
      if (Date.now() > data.expiresAt) {
        console.log(`Context expired for ${contextPath}, clearing...`);
        fs.unlinkSync(contextPath);
        return [];
      }

      // Convert to Message format (drop timestamps for prompt)
      return data.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
    } catch (error) {
      console.error(`Failed to load context from ${this.getContextPath(userId, channelId, guildId, persona)}:`, error);
      return [];
    }
  }

  /**
   * Append a message to context (user or assistant)
   * Only stores plain text - no embeds or metadata
   * 
   * PART F: Persona isolation
   */
  async appendMessage(
    userId: string,
    message: Message,
    channelId?: string,
    guildId?: string,
    persona?: string
  ): Promise<void> {
    try {
      // Only store user and assistant messages (skip system)
      if (message.role === 'system') {
        return; // System messages are not stored in persistent context
      }

      const contextPath = this.getContextPath(userId, channelId, guildId, persona);
      const contextDir = path.dirname(contextPath);

      // Ensure directory exists
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }

      let context: ContextFile;

      // Load existing or create new
      if (fs.existsSync(contextPath)) {
        const raw = fs.readFileSync(contextPath, 'utf-8');
        context = JSON.parse(raw) as ContextFile;
      } else {
        context = {
          version: this.VERSION,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          expiresAt: Date.now() + this.EXPIRATION_MS,
          messages: [],
        };
      }

      // Add message (plain text only)
      const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      context.messages.push({
        role: message.role as 'user' | 'assistant',
        content: contentStr,
        timestamp: Date.now(),
      });

      // Trim to max size (keep newest messages)
      if (context.messages.length > this.MAX_MESSAGES) {
        context.messages = context.messages.slice(-this.MAX_MESSAGES);
      }

      // Update metadata
      context.lastUpdated = Date.now();
      context.expiresAt = Date.now() + this.EXPIRATION_MS;

      // Write to disk
      fs.writeFileSync(contextPath, JSON.stringify(context, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to append message to context for user ${userId}:`, error);
    }
  }

  /**
   * Append multiple messages (e.g., user message + assistant response)
   * 
   * PART F: Persona isolation
   */
  async appendMessages(
    userId: string,
    messages: Message[],
    channelId?: string,
    guildId?: string,
    persona?: string
  ): Promise<void> {
    for (const msg of messages) {
      await this.appendMessage(userId, msg, channelId, guildId, persona);
    }
  }

  /**
   * Clear expired contexts
   * Safe to run periodically
   */
  async cleanupExpiredContexts(): Promise<void> {
    try {
      const now = Date.now();
      const guildDir = path.join(this.contextDir, 'guilds');
      const dmDir = path.join(this.contextDir, 'dms');

      // Clean guilds
      if (fs.existsSync(guildDir)) {
        this.cleanupDir(guildDir, now);
      }

      // Clean DMs
      if (fs.existsSync(dmDir)) {
        this.cleanupDir(dmDir, now);
      }

      console.log('✓ Cleaned up expired context files');
    } catch (error) {
      console.error('Failed to cleanup expired contexts:', error);
    }
  }

  /**
   * Delete specific context (e.g., when user leaves or on request)
   */
  async deleteContext(
    userId: string,
    channelId?: string,
    guildId?: string
  ): Promise<void> {
    try {
      const contextPath = this.getContextPath(userId, channelId, guildId);

      if (fs.existsSync(contextPath)) {
        fs.unlinkSync(contextPath);
        console.log(`Deleted context: ${contextPath}`);
      }
    } catch (error) {
      console.error(`Failed to delete context for user ${userId}:`, error);
    }
  }

  /**
   * Delete ALL user contexts for a specific guild channel
   * Path: context/guilds/{guildId}/{channelId}/
   */
  async deleteChannelContexts(guildId: string, channelId: string): Promise<void> {
    try {
      const dirPath = path.join(this.contextDir, 'guilds', guildId, channelId);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        // Recreate empty dir to keep structure tidy (optional)
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Deleted all contexts for guild ${guildId} channel ${channelId}`);
      }
    } catch (error) {
      console.error(`Failed to delete channel contexts for ${guildId}/${channelId}:`, error);
    }
  }

  /**
   * Delete ALL contexts for an entire guild
   * Path: context/guilds/{guildId}/
   */
  async deleteGuildContexts(guildId: string): Promise<void> {
    try {
      const dirPath = path.join(this.contextDir, 'guilds', guildId);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Deleted all contexts for guild ${guildId}`);
      }
    } catch (error) {
      console.error(`Failed to delete guild contexts for ${guildId}:`, error);
    }
  }

  /**
   * Get file system path for context file
   * 
   * PART F: Persona isolation
   * - Guilds: context/guilds/{guildId}/{channelId}/{userId}_{persona}.json
   * - DMs: context/dms/{userId}_{persona}.json
   */
  private getContextPath(userId: string, channelId?: string, guildId?: string, persona?: string): string {
    const personaSuffix = persona ? `_${persona}` : '';
    
    if (guildId && channelId) {
      // Guild channel context
      return path.join(this.contextDir, 'guilds', guildId, channelId, `${userId}${personaSuffix}.json`);
    } else {
      // DM context
      return path.join(this.contextDir, 'dms', `${userId}${personaSuffix}.json`);
    }
  }

  /**
   * Ensure all necessary directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      path.join(this.contextDir, 'guilds'),
      path.join(this.contextDir, 'dms'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Recursively clean expired files from a directory
   */
  private cleanupDir(dir: string, now: number): void {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        // Recurse
        this.cleanupDir(itemPath, now);

        // Remove empty directories
        const remaining = fs.readdirSync(itemPath);
        if (remaining.length === 0) {
          fs.rmdirSync(itemPath);
        }
      } else if (item.endsWith('.json')) {
        // Check expiration
        try {
          const raw = fs.readFileSync(itemPath, 'utf-8');
          const data = JSON.parse(raw) as ContextFile;

          if (now > data.expiresAt) {
            fs.unlinkSync(itemPath);
            console.log(`Cleaned expired context: ${itemPath}`);
          }
        } catch (error) {
          // Skip invalid files
          console.warn(`Could not parse context file ${itemPath}, skipping cleanup`);
        }
      }
    }
  }

  /**
   * Get context stats (for debugging/monitoring)
   */
  getContextStats(
    userId: string,
    channelId?: string,
    guildId?: string
  ): { exists: boolean; messageCount: number; expiresIn: number } | null {
    try {
      const contextPath = this.getContextPath(userId, channelId, guildId);

      if (!fs.existsSync(contextPath)) {
        return null;
      }

      const raw = fs.readFileSync(contextPath, 'utf-8');
      const data = JSON.parse(raw) as ContextFile;

      const expiresIn = Math.max(0, data.expiresAt - Date.now());

      return {
        exists: true,
        messageCount: data.messages.length,
        expiresIn,
      };
    } catch (error) {
      return null;
    }
  }
}
