import { Message as DiscordMessage, Client } from 'discord.js';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { RouterService } from '../ai/routerService';
import { McpClient } from '../mcp/client';

export class MessageHandler {
  private client: Client;
  private aiService: OpenRouterService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;
  private routerService: RouterService;
  private mcpClient: McpClient;

  constructor(
    client: Client,
    aiService: OpenRouterService,
    memoryManager: MemoryManager,
    promptManager: PromptManager,
    routerService: RouterService,
    mcpClient: McpClient
  ) {
    this.client = client;
    this.aiService = aiService;
    this.memoryManager = memoryManager;
    this.promptManager = promptManager;
    this.routerService = routerService;
    this.mcpClient = mcpClient;
  }

  shouldRespond(message: DiscordMessage): boolean {
    // Don't respond to bots
    if (message.author.bot) return false;

    // Don't respond to system messages
    if (message.system) return false;

    const botId = this.client.user?.id;
    const botName = this.client.user?.username?.toLowerCase();
    const channelTriggers = this.promptManager.getTriggerNames(message.channelId);

    // Check if bot is mentioned
    const isMentioned = message.mentions.has(botId || '');

    // Check if bot is replied to
    const isRepliedTo =
      message.reference?.messageId !== undefined &&
      message.type === 19; // REPLY type

    // Check if bot name appears in message
    const contentLower = message.content.toLowerCase();
    const containsBotName = Boolean(botName && contentLower.includes(botName));
    const containsTrigger = channelTriggers.some((trigger) =>
      contentLower.includes(trigger)
    );

    return isMentioned || isRepliedTo || containsBotName || containsTrigger;
  }

  async handleMessage(message: DiscordMessage): Promise<void> {
    if (!this.shouldRespond(message)) {
      return;
    }

    try {
      // Show typing indicator
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Get channel context
      const channelId = message.channelId;

      // Build user message
      const userMessage: Message = {
        role: 'user',
        content: `${message.author.username}: ${message.content}`,
      };

      // Add to memory
      await this.memoryManager.addMessage(channelId, userMessage);

      // Get message history
      const conversation = this.memoryManager.getConversationContext(channelId);

      const routeDecision = await this.routerService.decideRoute(
        message.content
      );

      if (routeDecision.route === 'TOOL' && routeDecision.toolName) {
        const toolResult = await this.mcpClient.callTool(routeDecision.toolName, {
          query: message.content,
        });

        const toolPrompt = this.promptManager.composeChatPrompt(
          channelId,
          conversation,
          {
            toolName: routeDecision.toolName,
            userMessage: message.content,
            result: toolResult,
          }
        );

        const toolResponse = await this.aiService.chatCompletion(
          toolPrompt.messages,
          toolPrompt.model
        );

        await this.memoryManager.addMessage(channelId, {
          role: 'assistant',
          content: toolResponse,
        });

        await this.sendResponse(message, toolResponse);

        console.log(
          `Used tool ${routeDecision.toolName} for ${message.author.username} in ${message.guild?.name || 'DM'}`
        );
        return;
      }

      const composedPrompt = this.promptManager.composeChatPrompt(
        channelId,
        conversation
      );

      // Get AI response
      const response = await this.aiService.chatCompletion(
        composedPrompt.messages,
        composedPrompt.model
      );

      // Add assistant response to memory
      await this.memoryManager.addMessage(channelId, {
        role: 'assistant',
        content: response,
      });

      // Send response (split if too long)
      await this.sendResponse(message, response);

      console.log(
        `Responded to ${message.author.username} in ${message.guild?.name || 'DM'}`
      );
    } catch (error) {
      console.error('Error handling message:', error);
      await message.reply(
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    }
  }

  private async sendResponse(
    message: DiscordMessage,
    response: string
  ): Promise<void> {
    // Discord message limit is 2000 characters
    const MAX_LENGTH = 2000;

    if (response.length <= MAX_LENGTH) {
      await message.reply(response);
      return;
    }

    // Split into chunks
    const chunks: string[] = [];
    let currentChunk = '';

    const lines = response.split('\n');
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > MAX_LENGTH) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // If a single line is too long, split it by words
        if (line.length > MAX_LENGTH) {
          const words = line.split(' ');
          for (const word of words) {
            if ((currentChunk + word + ' ').length > MAX_LENGTH) {
              chunks.push(currentChunk.trim());
              currentChunk = word + ' ';
            } else {
              currentChunk += word + ' ';
            }
          }
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // Send first chunk as reply, rest as follow-ups
    await message.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      if ('send' in message.channel) {
        await message.channel.send(chunks[i]);
      }
    }
  }
}
