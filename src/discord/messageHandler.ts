import { Message as DiscordMessage, Client, AttachmentBuilder } from 'discord.js';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { ImageService } from '../ai/imageService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { Planner } from '../ai/planner';
import { ActionExecutor } from '../ai/actionExecutor';
import { MCPToolResult } from '../mcp';

export class MessageHandler {
  private client: Client;
  private aiService: OpenRouterService;
  private imageService: ImageService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;
  private planner: Planner;
  private executor: ActionExecutor;

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
    this.planner = new Planner(aiService);
    this.executor = new ActionExecutor(aiService);
  }

  shouldRespond(message: DiscordMessage): boolean {
    // Don't respond to bots
    if (message.author.bot) return false;

    // Don't respond to system messages
    if (message.system) return false;

    const botId = this.client.user?.id;
    const contentLower = message.content.toLowerCase();

    // Check if bot is mentioned
    const isMentioned = message.mentions.has(botId || '');

    // Check if bot is replied to
    const isRepliedTo =
      message.reference?.messageId !== undefined &&
      message.type === 19; // REPLY type

    // Check if any persona name appears in message
    const containsPersonaName = this.promptManager.detectPersonaFromMessage(
      message.content
    ) !== null;

    return isMentioned || isRepliedTo || containsPersonaName;
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

      // Determine which persona to use
      let personaId: string | undefined;

      // 1. Check if user explicitly mentioned a persona name
      const detectedPersona = this.promptManager.detectPersonaFromMessage(
        message.content
      );
      if (detectedPersona) {
        personaId = detectedPersona;
      }
      // 2. If replying to bot, continue with same persona
      else if (message.reference?.messageId) {
        const referencedPersona = this.promptManager.getMessagePersona(
          message.reference.messageId
        );
        if (referencedPersona) {
          personaId = referencedPersona;
        }
      }
      // 3. Use channel default (handled in composeChatPrompt)

      // Build user message
      const userMessage: Message = {
        role: 'user',
        content: `${message.author.username}: ${message.content}`,
      };

      // Add to memory
      await this.memoryManager.addMessage(channelId, userMessage);

      // Get message history for context
      const conversation = this.memoryManager.getConversationContext(channelId);
      const composedPrompt = this.promptManager.composeChatPrompt(
        channelId,
        conversation,
        personaId
      );

      // PLANNER STEP: Decide what actions to take
      const plan = await this.planner.planActionsWithRetry(
        message.content,
        composedPrompt.messages,
        personaId
      );

      console.log(`Action plan: ${plan.actions.map(a => a.type).join(' → ')}`);

      // EXECUTOR STEP: Execute actions sequentially
      const executionResult = await this.executor.executeActions(plan.actions);

      // Handle image response separately if generated
      if (executionResult.hasImage && executionResult.imageData) {
        await this.sendImageResponse(message, executionResult, personaId);
        return;
      }

      // RESPONDER STEP: Generate final response using persona model
      const finalResponse = await this.generateFinalResponse(
        message.content,
        executionResult,
        composedPrompt.messages,
        composedPrompt.model
      );

      // Add assistant response to memory
      await this.memoryManager.addMessage(channelId, {
        role: 'assistant',
        content: finalResponse,
      });

      // Send response
      const sentMessage = await this.sendResponse(message, finalResponse);

      // Track which persona was used for this response
      if (sentMessage && personaId) {
        this.promptManager.trackMessagePersona(sentMessage.id, personaId);
      }

      console.log(
        `Responded to ${message.author.username} in ${message.guild?.name || 'DM'}${
          personaId ? ` (persona: ${personaId})` : ''
        } with ${plan.actions.length} action(s)`
      );
    } catch (error) {
      console.error('Error handling message:', error);
      await message.reply(
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    }
  }

  /**
   * Generate final response using persona model with action results as context
   */
  private async generateFinalResponse(
    userQuery: string,
    executionResult: any,
    conversationMessages: Message[],
    model: string
  ): Promise<string> {
    try {
      // Check if there are any tool results to summarize
      const hasToolResults = executionResult.results.some(
        (r: any) => r.success && r.content && r.content.length > 0
      );

      if (!hasToolResults) {
        // No tool results, just do normal chat
        return await this.aiService.chatCompletion(conversationMessages, model);
      }

      // Build context from tool results
      const toolContext = executionResult.results
        .filter((r: any) => r.success && r.content)
        .map((r: any, i: number) => `Result ${i + 1}:\n${r.content}`)
        .join('\n\n');

      // Create response prompt with tool context
      const responsePrompt: Message[] = [
        ...conversationMessages,
        {
          role: 'assistant',
          content: `I executed the requested actions. Here are the results:\n\n${toolContext}`,
        },
        {
          role: 'user',
          content: `Based on the results above, provide a natural, conversational response to: "${userQuery}"`,
        },
      ];

      const response = await this.aiService.chatCompletion(responsePrompt, model);

      // Ensure valid response
      if (!response || response.trim().length === 0) {
        console.warn('Empty response from AI, returning tool context directly');
        return `**Results:**\n${toolContext}`;
      }

      return response;
    } catch (error) {
      console.error('Error generating final response:', error);
      
      // Fallback: return tool results directly
      const toolContext = executionResult.results
        .filter((r: any) => r.success && r.content)
        .map((r: any) => r.content)
        .join('\n\n');

      if (toolContext) {
        return toolContext;
      }

      return 'I processed your request but encountered an error generating a response.';
    }
  }

  /**
   * Send image response with optional text context
   */
  private async sendImageResponse(
    message: DiscordMessage,
    executionResult: any,
    personaId?: string
  ): Promise<void> {
    try {
      if (!executionResult.imageData) {
        await message.reply('Image generation was requested but no image was produced.');
        return;
      }

      const { buffer, resolution, prompt } = executionResult.imageData;

      // Check Discord size limit
      if (!this.imageService.isDiscordSafe(buffer.length)) {
        await message.reply(
          `⚠️ The generated image is too large for Discord (${Math.round(
            buffer.length / (1024 * 1024)
          )}MB). Try requesting a smaller resolution.`
        );
        return;
      }

      // Create attachment
      const attachment = new AttachmentBuilder(buffer, {
        name: 'generated-image.png',
      });

      // Build caption with any text results
      const textResults = executionResult.results
        .filter((r: any) => r.success && r.content && !r.imageBuffer)
        .map((r: any) => r.content)
        .join('\n\n');

      let caption = `🎨 **Generated Image**\n*${prompt}*\nResolution: ${resolution.width}×${resolution.height}`;

      if (textResults) {
        caption = `${textResults}\n\n${caption}`;
      }

      const sentMessage = await message.reply({
        content: caption,
        files: [attachment],
      });

      // Track persona
      if (personaId) {
        this.promptManager.trackMessagePersona(sentMessage.id, personaId);
      }

      console.log(`Generated image: ${resolution.width}×${resolution.height}, ${buffer.length} bytes`);
    } catch (error) {
      console.error('Error sending image response:', error);
      await message.reply('I generated an image but encountered an error sending it.');
    }
  }

  private async sendResponse(
    message: DiscordMessage,
    response: string
  ): Promise<DiscordMessage | null> {
    try {
      // Validate response
      if (!response || response.trim().length === 0) {
        console.warn('Attempted to send empty response, using fallback');
        response = 'I processed your request.';
      }

      // Discord message limit is 2000 characters
      const MAX_LENGTH = 2000;

      if (response.length <= MAX_LENGTH) {
        const sentMessage = await message.reply(response);
        return sentMessage;
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

      // Ensure we have at least one chunk
      if (chunks.length === 0) {
        chunks.push('Response was empty.');
      }

      // Send first chunk as reply, rest as follow-ups
      const firstMessage = await message.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        if ('send' in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }

      // Return the first message for persona tracking
      return firstMessage;
    } catch (error) {
      console.error('Error sending response:', error);
      // Attempt to send a simple error message
      try {
        await message.reply('I encountered an error sending my response.');
      } catch (fallbackError) {
        console.error('Failed to send fallback error message:', fallbackError);
      }
      return null;
    }
  }
}
