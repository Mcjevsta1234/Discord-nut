import { Message as DiscordMessage, Client, AttachmentBuilder } from 'discord.js';
import { OpenRouterService, Message, RouteDecision } from '../ai/openRouterService';
import { ImageService } from '../ai/imageService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { MCPToolResult } from '../mcp';

export class MessageHandler {
  private client: Client;
  private aiService: OpenRouterService;
  private imageService: ImageService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;

  constructor(
    client: Client,
    aiService: OpenRouterService,
    memoryManager: MemoryManager,
    promptManager: PromptManager
  ) {
    this.client = client;
    this.aiService = aiService;
    this.imageService = new ImageService();
    this.memoryManager = memoryManager;
    this.promptManager = promptManager;
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
      const composedPrompt = this.promptManager.composeChatPrompt(
        channelId,
        conversation
      );

      // Decide if we need to use a tool
      const routeDecision = await this.aiService.decideRoute(message.content);

      if (routeDecision.route === 'image') {
        // Handle image generation
        await this.handleImageGeneration(message, routeDecision);
        return; // Image sent directly, no text response needed
      }

      let response: string;

      if (routeDecision.route === 'tool' && routeDecision.toolName) {
        // Execute tool and summarize result
        response = await this.handleToolExecution(
          routeDecision,
          message.content,
          composedPrompt.messages,
          composedPrompt.model
        );
      } else {
        // Regular chat completion
        response = await this.aiService.chatCompletion(
          composedPrompt.messages,
          composedPrompt.model
        );
      }

      // Add assistant response to memory
      await this.memoryManager.addMessage(channelId, {
        role: 'assistant',
        content: response,
      });

      // Send response (split if too long)
      await this.sendResponse(message, response);

      console.log(
        `Responded to ${message.author.username} in ${message.guild?.name || 'DM'}${
          routeDecision.route === 'tool' ? ` (used tool: ${routeDecision.toolName})` : ''
        }`
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

  /**
   * Handle tool execution and summarize results back to user
   */
  private async handleToolExecution(
    decision: RouteDecision,
    userQuery: string,
    conversationMessages: Message[],
    model: string
  ): Promise<string> {
    try {
      // Execute the tool
      const toolResult = await this.aiService.executeMCPTool(
        decision.toolName!,
        decision.toolParams || {}
      );

      // Create a summary prompt that includes the tool result
      const summaryPrompt: Message[] = [
        ...conversationMessages,
        {
          role: 'assistant',
          content: `I used the ${decision.toolName} tool. Here's the result:\n${JSON.stringify(
            toolResult,
            null,
            2
          )}`,
        },
        {
          role: 'user',
          content: `Based on the tool result above, provide a natural, conversational response to the user's query: "${userQuery}"`,
        },
      ];

      // Get AI to summarize the result
      const summary = await this.aiService.chatCompletion(summaryPrompt, model);

      return summary;
    } catch (error) {
      console.error('Error executing tool:', error);
      return `I tried to use a tool to help answer your question, but encountered an error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }

  /**
   * Handle image generation request
   */
  private async handleImageGeneration(
    message: DiscordMessage,
    decision: RouteDecision
  ): Promise<void> {
    try {
      // Parse resolution from prompt if specified
      const resolution = this.imageService.parseResolutionFromPrompt(
        decision.imagePrompt || message.content
      );

      // Generate image
      const result = await this.imageService.generateImage({
        prompt: decision.imagePrompt || message.content,
        width: decision.imageResolution?.width || resolution.width,
        height: decision.imageResolution?.height || resolution.height,
      });

      // Check if image is Discord-safe
      if (!this.imageService.isDiscordSafe(result.sizeBytes)) {
        await message.reply(
          `⚠️ The generated image is too large for Discord (${Math.round(
            result.sizeBytes / (1024 * 1024)
          )}MB). Even after compression, it exceeds the 8MB limit. Try requesting a smaller resolution.`
        );
        return;
      }

      // Create attachment
      const attachment = new AttachmentBuilder(result.imageBuffer, {
        name: 'generated-image.png',
      });

      // Send with a short caption
      const caption = `🎨 **Generated Image**\n*${
        decision.imagePrompt || message.content
      }*\nResolution: ${result.resolution.width}×${result.resolution.height}`;

      await message.reply({
        content: caption,
        files: [attachment],
      });

      console.log(
        `Generated image for ${message.author.username}: ${result.resolution.width}×${result.resolution.height}, ${result.sizeBytes} bytes`
      );
    } catch (error) {
      console.error('Error generating image:', error);
      await message.reply(
        `Sorry, I encountered an error generating your image: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}
