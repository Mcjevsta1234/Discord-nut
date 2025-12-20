import { Message as DiscordMessage, Client, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { ImageService } from '../ai/imageService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { Planner } from '../ai/planner';
import { ActionExecutor } from '../ai/actionExecutor';
import { MCPToolResult } from '../mcp';

interface MessageContext {
  userContent: string;
  personaId?: string;
  channelId: string;
  originalMessageId: string;
}

export class MessageHandler {
  private client: Client;
  private aiService: OpenRouterService;
  private imageService: ImageService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;
  private planner: Planner;
  private executor: ActionExecutor;
  private messageContexts: Map<string, MessageContext>;

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
    this.messageContexts = new Map();
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

      // Show working message for multi-step or tool actions
      let workingMessage: DiscordMessage | null = null;
      const hasToolActions = plan.actions.some(a => a.type === 'tool' || a.type === 'image');
      
      if (hasToolActions && plan.actions.length > 0) {
        workingMessage = await message.reply('⏳ Working on it...');
      }

      // EXECUTOR STEP: Execute actions sequentially
      const executionResult = await this.executor.executeActions(plan.actions);

      // Handle image response separately if generated
      if (executionResult.hasImage && executionResult.imageData) {
        // Delete working message
        if (workingMessage) {
          await workingMessage.delete().catch(() => {});
        }
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

      // Add assistant response to memory (but not tool errors)
      if (finalResponse && !finalResponse.includes('encountered an error')) {
        await this.memoryManager.addMessage(channelId, {
          role: 'assistant',
          content: finalResponse,
        });
      }

      // Send response (replace working message if exists)
      const sentMessage = await this.sendResponse(message, finalResponse, workingMessage);

      // Track which persona was used for this response
      if (sentMessage && personaId) {
        this.promptManager.trackMessagePersona(sentMessage.id, personaId);
        
        // Store context for redo functionality
        this.messageContexts.set(sentMessage.id, {
          userContent: message.content,
          personaId,
          channelId,
          originalMessageId: message.id,
        });
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
    response: string,
    workingMessage?: DiscordMessage | null
  ): Promise<DiscordMessage | null> {
    try {
      // Validate response
      if (!response || response.trim().length === 0) {
        console.warn('Attempted to send empty response, using fallback');
        response = 'I processed your request.';
      }

      // Create redo button
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton);

      // Check if response should use an embed (for structured content)
      if (this.shouldUseEmbed(response)) {
        const embed = this.createEmbed(response);
        
        if (workingMessage) {
          await workingMessage.edit({ content: null, embeds: [embed], components: [row] });
          return workingMessage;
        } else {
          return await message.reply({ embeds: [embed], components: [row] });
        }
      }

      // Discord message limit is 2000 characters
      const MAX_LENGTH = 1800; // Lower to leave room for formatting

      if (response.length <= MAX_LENGTH) {
        if (workingMessage) {
          await workingMessage.edit({ content: response, components: [row] });
          return workingMessage;
        } else {
          return await message.reply({ content: response, components: [row] });
        }
      }

      // Split into chunks for long messages (only add button to first chunk)
      const chunks = this.splitMessage(response, MAX_LENGTH);

      // Edit working message with first chunk, send rest as follow-ups
      if (workingMessage) {
        await workingMessage.edit({ content: chunks[0], components: [row] });
        for (let i = 1; i < chunks.length; i++) {
          if ('send' in message.channel) {
            await message.channel.send(chunks[i]);
          }
        }
        return workingMessage;
      } else {
        const firstMessage = await message.reply({ content: chunks[0], components: [row] });
        for (let i = 1; i < chunks.length; i++) {
          if ('send' in message.channel) {
            await message.channel.send(chunks[i]);
          }
        }
        return firstMessage;
      }
    } catch (error) {
      console.error('Error sending response:', error);
      try {
        if (workingMessage) {
          await workingMessage.edit('I encountered an error sending my response.');
          return workingMessage;
        } else {
          await message.reply('I encountered an error sending my response.');
        }
      } catch (fallbackError) {
        console.error('Failed to send fallback error message:', fallbackError);
      }
      return null;
    }
  }

  private shouldUseEmbed(response: string): boolean {
    // Use embeds for structured content
    return (
      response.includes('```') ||
      response.includes('**GitHub Repository') ||
      response.includes('**Repository Structure') ||
      response.includes('**Recent Commits') ||
      response.includes('**Results:**') ||
      (response.split('\n').length > 10 && response.includes('•'))
    );
  }

  private createEmbed(content: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple
      .setTimestamp();

    // Extract title if present
    const titleMatch = content.match(/^\*\*(.+?)\*\*/);
    if (titleMatch) {
      embed.setTitle(titleMatch[1]);
      content = content.replace(titleMatch[0], '').trim();
    }

    // Truncate description if too long (Discord limit: 4096)
    if (content.length > 4000) {
      content = content.substring(0, 3990) + '\n\n...(truncated)';
    }

    embed.setDescription(content);

    return embed;
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // If a single line is too long, split it by words
        if (line.length > maxLength) {
          const words = line.split(' ');
          for (const word of words) {
            if ((currentChunk + word + ' ').length > maxLength) {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
              }
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

    return chunks;
  }

  async handleButtonInteraction(interaction: any): Promise<void> {
    try {
      if (interaction.customId === 'redo_response') {
        // Get the stored context
        const context = this.messageContexts.get(interaction.message.id);
        
        if (!context) {
          await interaction.reply({
            content: 'Sorry, I cannot regenerate this response (context expired).',
            ephemeral: true,
          });
          return;
        }

        // Acknowledge the interaction
        await interaction.deferUpdate();

        // Update message to show regenerating
        await interaction.message.edit({
          content: '⏳ Regenerating response...',
          embeds: [],
          components: [],
        });

        // Get conversation context
        const conversation = this.memoryManager.getConversationContext(context.channelId);
        const composedPrompt = this.promptManager.composeChatPrompt(
          context.channelId,
          conversation,
          context.personaId
        );

        // Rerun planner
        const plan = await this.planner.planActionsWithRetry(
          context.userContent,
          composedPrompt.messages,
          context.personaId
        );

        // Execute actions
        const executionResult = await this.executor.executeActions(plan.actions);

        // Handle image separately
        if (executionResult.hasImage && executionResult.imageData) {
          const { buffer, resolution, prompt } = executionResult.imageData;
          
          if (!this.imageService.isDiscordSafe(buffer.length)) {
            await interaction.message.edit({
              content: '⚠️ Generated image is too large for Discord.',
              components: [],
            });
            return;
          }

          const attachment = new AttachmentBuilder(buffer, {
            name: 'generated-image.png',
          });

          const caption = `🎨 **Regenerated Image**\n*${prompt}*\nResolution: ${resolution.width}×${resolution.height}`;

          await interaction.message.edit({
            content: caption,
            files: [attachment],
            components: [],
          });
          return;
        }

        // Generate final response
        const finalResponse = await this.generateFinalResponse(
          context.userContent,
          executionResult,
          composedPrompt.messages,
          composedPrompt.model
        );

        // Create new redo button
        const redoButton = new ButtonBuilder()
          .setCustomId('redo_response')
          .setLabel('🔄 Regenerate')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton);

        // Update message with new response
        if (this.shouldUseEmbed(finalResponse)) {
          const embed = this.createEmbed(finalResponse);
          await interaction.message.edit({
            content: null,
            embeds: [embed],
            components: [row],
          });
        } else {
          await interaction.message.edit({
            content: finalResponse,
            embeds: [],
            components: [row],
          });
        }

        console.log(`Regenerated response for message ${interaction.message.id}`);
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: 'Sorry, I encountered an error regenerating the response.',
          });
        } else {
          await interaction.reply({
            content: 'Sorry, I encountered an error regenerating the response.',
            ephemeral: true,
          });
        }
      } catch (e) {
        console.error('Failed to send error message:', e);
      }
    }
  }
}
