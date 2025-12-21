import { Message as DiscordMessage, Client, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { ImageService } from '../ai/imageService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { Planner } from '../ai/planner';
import { ActionExecutor } from '../ai/actionExecutor';
import { MCPToolResult } from '../mcp';
import { ResponseRenderer, ResponseMetadata } from './responseRenderer';
import { aggregateLLMMetadata, LLMResponseMetadata } from '../ai/llmMetadata';
import { RouterService } from '../ai/routerService';
import { RoutingDecision } from '../ai/modelTiers';

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
  private router: RouterService;
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
    this.router = new RouterService(aiService);
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

      // Send working message immediately with new renderer
      const workingEmbed = ResponseRenderer.createWorkingEmbed(message.content);
      const workingMessage = await message.reply({ embeds: [workingEmbed] });

      // ROUTING STEP: Determine which model tier to use
      console.log(`🎯 Routing message from ${message.author.username}...`);
      const routingDecision = await this.router.route(
        message.content,
        composedPrompt.messages,
        message.content.length
      );

      // PLANNER STEP: Decide what actions to take
      const planStartTime = Date.now();
      const plan = await this.planner.planActionsWithRetry(
        message.content,
        composedPrompt.messages,
        personaId
      );

      console.log(`Action plan: ${plan.actions.map(a => a.type).join(' → ')}`);

      // Create response metadata for transparency
      const metadata: ResponseMetadata = ResponseRenderer.createMetadata(
        plan.actions,
        plan.reasoning,
        routingDecision.modelId, // Use routed model
        personaId
      );

      // Add routing decision to metadata
      metadata.routingDecision = routingDecision;

      // Track planning LLM call
      const planningCallMetadata = plan.metadata;

      // Update working message: Executing
      await workingMessage.edit({
        embeds: [ResponseRenderer.updateWorkingEmbed(workingEmbed, 'executing')],
      }).catch(() => {});

      // EXECUTOR STEP: Execute all planned actions
      const execStartTime = Date.now();
      const executionResult = await this.executor.executeActions(plan.actions);
      const execDuration = Date.now() - execStartTime;

      // Update metadata with execution results
      const updatedMetadata = ResponseRenderer.updateWithExecution(
        metadata,
        executionResult.results,
        execDuration
      );

      // Handle image response separately if generated
      if (executionResult.hasImage && executionResult.imageData) {
        // Add LLM metadata before sending
        updatedMetadata.llmMetadata = aggregateLLMMetadata(
          planningCallMetadata,
          [],
          undefined
        );
        
        await this.sendImageResponseWithRenderer(
          message,
          executionResult,
          updatedMetadata,
          workingMessage
        );
        return;
      }

      // Update working message: Responding
      await workingMessage.edit({
        embeds: [ResponseRenderer.updateWorkingEmbed(workingEmbed, 'responding')],
      }).catch(() => {});

      // RESPONDER STEP: Generate final response WITH METADATA
      const responseResult = await this.generateFinalResponseWithMetadata(
        message.content,
        executionResult,
        composedPrompt.messages,
        routingDecision.modelId // Use routed model
      );

      const finalResponse = responseResult.content;
      const responseCallMetadata = responseResult.metadata;

      // Add assistant response to memory (but not tool errors)
      if (finalResponse && !finalResponse.includes('encountered an error')) {
        await this.memoryManager.addMessage(channelId, {
          role: 'assistant',
          content: finalResponse,
        });
      }

      // Aggregate all LLM metadata
      updatedMetadata.llmMetadata = aggregateLLMMetadata(
        planningCallMetadata,
        [],
        responseCallMetadata
      );

      // Render and send complete response with full transparency
      const rendered = ResponseRenderer.render(updatedMetadata, finalResponse);
      const sentMessage = await ResponseRenderer.sendToDiscord(
        message,
        rendered,
        workingMessage
      );

      // Track context
      if (sentMessage && personaId) {
        this.promptManager.trackMessagePersona(sentMessage.id, personaId);
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
   * Build concise plan bullets from actions (public-friendly, no internal details)
   */
  private buildPlanBullets(actions: any[]): string[] {
    const bullets: string[] = [];

    for (const action of actions) {
      if (action.type === 'tool') {
        const toolName = action.toolName || 'unknown tool';
        
        // User-friendly tool descriptions
        if (toolName === 'github_repo') {
          const subAction = action.toolParams?.action || 'access';
          const repo = action.toolParams?.repo || 'repository';
          bullets.push(`• Check GitHub: ${repo} (${subAction})`);
        } else if (toolName === 'searxng_search') {
          const query = action.toolParams?.query || 'search';
          bullets.push(`• Search web: "${query.substring(0, 40)}${query.length > 40 ? '...' : ''}"`);
        } else if (toolName === 'fetch_url') {
          const url = action.toolParams?.url || 'URL';
          bullets.push(`• Fetch content from ${url.substring(0, 40)}${url.length > 40 ? '...' : ''}`);
        } else {
          bullets.push(`• Use ${toolName}`);
        }
      } else if (action.type === 'image') {
        bullets.push(`• Generate image`);
      } else if (action.type === 'chat') {
        bullets.push(`• Respond conversationally`);
      }
    }

    return bullets;
  }

  /**
   * Execute actions with live progress updates
   */
  private async executeWithProgress(
    actions: any[],
    workingMessage: DiscordMessage,
    workingEmbed: EmbedBuilder,
    planSection: string
  ): Promise<any> {
    const results: any[] = [];
    let hasImage = false;
    let imageData: any = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const actionNum = i + 1;
      const total = actions.length;

      // Show current progress
      const progressIcon = action.type === 'tool' ? '🔎' : action.type === 'image' ? '🎨' : '💬';
      const actionDesc = action.toolName || action.type;

      await workingMessage.edit({
        embeds: [
          workingEmbed.setDescription(
            `${planSection}\n\n${progressIcon} **Executing ${actionNum}/${total}:** ${actionDesc}...`
          ),
        ],
      }).catch(() => {}); // Ignore edit errors if message deleted

      // Execute action
      const result = await this.executor.executeAction(action);
      results.push(result);

      if (result.imageBuffer) {
        hasImage = true;
        imageData = {
          buffer: result.imageBuffer,
          resolution: result.resolution,
          prompt: result.prompt,
        };
      }

      // Show completion
      await workingMessage.edit({
        embeds: [
          workingEmbed.setDescription(
            `${planSection}\n\n✅ **Completed ${actionNum}/${total}:** ${actionDesc}`
          ),
        ],
      }).catch(() => {});

      // Brief delay for visibility
      if (i < actions.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return { results, hasImage, imageData };
  }

  /**
   * Send response with plan section kept at top
   */
  private async sendResponseWithPlan(
    message: DiscordMessage,
    response: string,
    planSection: string,
    workingMessage?: DiscordMessage
  ): Promise<DiscordMessage | null> {
    try {
      // Validate response
      if (!response || response.trim().length === 0) {
        response = 'Done!';
      }

      // Create final embed with plan + response
      const finalEmbed = new EmbedBuilder()
        .setColor(0x00ff00) // Green for success
        .setDescription(`${planSection}\n\n**Response**\n${response.substring(0, 1800)}`)
        .setTimestamp();

      // Create buttons
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const imageButton = new ButtonBuilder()
        .setCustomId('generate_image')
        .setLabel('🎨 Generate Image')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton, imageButton);

      if (workingMessage) {
        await workingMessage.edit({
          content: null,
          embeds: [finalEmbed],
          components: [row],
        });
        return workingMessage;
      } else {
        return await message.reply({
          embeds: [finalEmbed],
          components: [row],
        });
      }
    } catch (error) {
      console.error('Error sending response with plan:', error);
      return null;
    }
  }

  /**
   * Generate final response using persona model with action results as context
   * NEW: Returns both content and LLM metadata for token tracking
   */
  private async generateFinalResponseWithMetadata(
    userQuery: string,
    executionResult: any,
    conversationMessages: Message[],
    model: string
  ): Promise<{ content: string; metadata?: LLMResponseMetadata }> {
    try {
      // Check if there are any tool results to summarize
      const hasToolResults = executionResult.results.some(
        (r: any) => r.success && r.content && r.content.length > 0
      );

      if (!hasToolResults) {
        // No tool results, just do normal chat WITH METADATA
        const response = await this.aiService.chatCompletionWithMetadata(conversationMessages, model);
        return { content: response.content, metadata: response.metadata };
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

      const response = await this.aiService.chatCompletionWithMetadata(responsePrompt, model);

      // Ensure valid response
      if (!response.content || response.content.trim().length === 0) {
        console.warn('Empty response from AI, returning tool context directly');
        return {
          content: `**Results:**\n${toolContext}`,
          metadata: response.metadata,
        };
      }

      return { content: response.content, metadata: response.metadata };
    } catch (error) {
      console.error('Error generating final response:', error);
      
      // Fallback: return tool results directly
      const toolContext = executionResult.results
        .filter((r: any) => r.success && r.content)
        .map((r: any) => r.content)
        .join('\n\n');

      if (toolContext) {
        return { content: toolContext, metadata: undefined };
      }

      return {
        content: 'I processed your request but encountered an error generating a response.',
        metadata: undefined,
      };
    }
  }

  /**
   * Generate final response using persona model with action results as context
   * LEGACY: Kept for backward compatibility
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
   * Send image response using the new ResponseRenderer
   */
  private async sendImageResponseWithRenderer(
    message: DiscordMessage,
    executionResult: any,
    metadata: ResponseMetadata,
    workingMessage?: DiscordMessage
  ): Promise<void> {
    try {
      if (!executionResult.imageData) {
        const errorMsg = 'Image generation was requested but no image was produced.';
        if (workingMessage) {
          await workingMessage.edit({ content: errorMsg, embeds: [] });
        } else {
          await message.reply(errorMsg);
        }
        return;
      }

      const { buffer, resolution, prompt } = executionResult.imageData;

      // Check Discord size limit
      if (!this.imageService.isDiscordSafe(buffer.length)) {
        const sizeError = `⚠️ The generated image is too large for Discord (${Math.round(
          buffer.length / (1024 * 1024)
        )}MB). Try requesting a smaller resolution.`;
        
        if (workingMessage) {
          await workingMessage.edit({ content: sizeError, embeds: [] });
        } else {
          await message.reply(sizeError);
        }
        return;
      }

      // Create attachment
      const attachment = new AttachmentBuilder(buffer, {
        name: 'generated-image.png',
      });

      // Render response with full transparency
      const rendered = ResponseRenderer.render(
        metadata,
        `Generated image based on your request.`,
        { buffer, resolution, prompt }
      );

      // Send system embed and response
      const systemEmbed = rendered.systemEmbed;
      
      // Create image embed
      const imageEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🎨 Generated Image')
        .setDescription(`**Prompt:** ${prompt}\n**Resolution:** ${resolution.width}×${resolution.height}`)
        .setImage('attachment://generated-image.png')
        .setTimestamp();

      if (workingMessage) {
        await workingMessage.edit({
          content: null,
          embeds: [systemEmbed, imageEmbed],
          files: [attachment],
          components: rendered.actionButtons ? [rendered.actionButtons] : [],
        });
      } else {
        await message.reply({
          embeds: [systemEmbed, imageEmbed],
          files: [attachment],
          components: rendered.actionButtons ? [rendered.actionButtons] : [],
        });
      }

      console.log(`Generated image: ${resolution.width}×${resolution.height}, ${buffer.length} bytes`);
    } catch (error) {
      console.error('Error sending image response:', error);
      const errorMsg = 'I generated an image but encountered an error sending it.';
      if (workingMessage) {
        await workingMessage.edit({ content: errorMsg, embeds: [] });
      } else {
        await message.reply(errorMsg);
      }
    }
  }

  /**
   * Send image response with optional text context (DEPRECATED - use sendImageResponseWithRenderer)
   */
  private async sendImageResponse(
    message: DiscordMessage,
    executionResult: any,
    personaId?: string,
    workingMessage?: DiscordMessage
  ): Promise<void> {
    try {
      if (!executionResult.imageData) {
        const errorMsg = 'Image generation was requested but no image was produced.';
        if (workingMessage) {
          await workingMessage.edit({ content: errorMsg, embeds: [] });
        } else {
          await message.reply(errorMsg);
        }
        return;
      }

      const { buffer, resolution, prompt } = executionResult.imageData;

      // Check Discord size limit
      if (!this.imageService.isDiscordSafe(buffer.length)) {
        const sizeError = `⚠️ The generated image is too large for Discord (${Math.round(
          buffer.length / (1024 * 1024)
        )}MB). Try requesting a smaller resolution.`;
        
        if (workingMessage) {
          await workingMessage.edit({ content: sizeError, embeds: [] });
        } else {
          await message.reply(sizeError);
        }
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

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎨 Generated Image')
        .setDescription(`*${prompt}*\n\nResolution: ${resolution.width}×${resolution.height}`)
        .setImage('attachment://generated-image.png')
        .setTimestamp();

      if (textResults) {
        embed.setDescription(`${textResults}\n\n*${prompt}*\n\nResolution: ${resolution.width}×${resolution.height}`);
      }

      // Create buttons
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton);

      if (workingMessage) {
        const sentMessage = await workingMessage.edit({
          content: null,
          embeds: [embed],
          files: [attachment],
          components: [row],
        });

        if (personaId) {
          this.promptManager.trackMessagePersona(sentMessage.id, personaId);
        }
      } else {
        const sentMessage = await message.reply({
          embeds: [embed],
          files: [attachment],
          components: [row],
        });

        if (personaId) {
          this.promptManager.trackMessagePersona(sentMessage.id, personaId);
        }
      }

      console.log(`Generated image: ${resolution.width}×${resolution.height}, ${buffer.length} bytes`);
    } catch (error) {
      console.error('Error sending image response:', error);
      const errorMsg = 'I generated an image but encountered an error sending it.';
      if (workingMessage) {
        await workingMessage.edit({ content: errorMsg, embeds: [] });
      } else {
        await message.reply(errorMsg);
      }
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

      // Create buttons
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const imageButton = new ButtonBuilder()
        .setCustomId('generate_image')
        .setLabel('🎨 Generate Image')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton, imageButton);

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
          await workingMessage.edit({ content: response, embeds: [], components: [row] });
          return workingMessage;
        } else {
          return await message.reply({ content: response, components: [row] });
        }
      }

      // Split into chunks for long messages (only add buttons to first chunk)
      const chunks = this.splitMessage(response, MAX_LENGTH);

      // Edit working message with first chunk, send rest as follow-ups
      if (workingMessage) {
        await workingMessage.edit({ content: chunks[0], embeds: [], components: [row] });
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
          await workingMessage.edit({ content: 'I encountered an error sending my response.', embeds: [], components: [] });
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
        const workingEmbed = ResponseRenderer.createWorkingEmbed(context.userContent);

        await interaction.message.edit({
          content: null,
          embeds: [workingEmbed],
          files: [],
          components: [],
        });

        // Get conversation context
        const conversation = this.memoryManager.getConversationContext(context.channelId);
        const composedPrompt = this.promptManager.composeChatPrompt(
          context.channelId,
          conversation,
          context.personaId
        );

        // ROUTING: Determine model tier
        const routingDecision = await this.router.route(
          context.userContent,
          composedPrompt.messages,
          context.userContent.length
        );

        // Update: Planning
        await interaction.message.edit({
          embeds: [ResponseRenderer.updateWorkingEmbed(workingEmbed, 'planning')],
        });

        // Rerun planner
        const plan = await this.planner.planActionsWithRetry(
          context.userContent,
          composedPrompt.messages,
          context.personaId
        );

        // Create metadata with routing decision
        const metadata = ResponseRenderer.createMetadata(
          plan.actions,
          plan.reasoning,
          routingDecision.modelId, // Use routed model
          context.personaId
        );
        metadata.routingDecision = routingDecision;

        // Update: Executing
        await interaction.message.edit({
          embeds: [ResponseRenderer.updateWorkingEmbed(workingEmbed, 'executing')],
        });

        // Execute actions
        const execStartTime = Date.now();
        const executionResult = await this.executor.executeActions(plan.actions);
        const execDuration = Date.now() - execStartTime;

        // Update metadata
        const updatedMetadata = ResponseRenderer.updateWithExecution(
          metadata,
          executionResult.results,
          execDuration
        );

        // Handle image separately
        if (executionResult.hasImage && executionResult.imageData) {
          const { buffer, resolution, prompt } = executionResult.imageData;
          
          if (!this.imageService.isDiscordSafe(buffer.length)) {
            await interaction.message.edit({
              content: '⚠️ Generated image is too large for Discord.',
              embeds: [],
              components: [],
            });
            return;
          }

          const attachment = new AttachmentBuilder(buffer, {
            name: 'generated-image.png',
          });

          // Use renderer for system embed
          const rendered = ResponseRenderer.render(
            updatedMetadata,
            'Regenerated image based on your request.',
            { buffer, resolution, prompt }
          );

          const imageEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎨 Regenerated Image')
            .setDescription(`**Prompt:** ${prompt}\n**Resolution:** ${resolution.width}×${resolution.height}`)
            .setImage('attachment://generated-image.png')
            .setTimestamp();

          await interaction.message.edit({
            content: null,
            embeds: [rendered.systemEmbed, imageEmbed],
            files: [attachment],
            components: rendered.actionButtons ? [rendered.actionButtons] : [],
          });
          return;
        }

        // Update: Generating response
        await interaction.message.edit({
          embeds: [ResponseRenderer.updateWorkingEmbed(workingEmbed, 'responding')],
        });

        // Generate final response WITH METADATA
        const responseResult = await this.generateFinalResponseWithMetadata(
          context.userContent,
          executionResult,
          composedPrompt.messages,
          routingDecision.modelId // Use routed model
        );

        const finalResponse = responseResult.content;

        // Aggregate LLM metadata
        updatedMetadata.llmMetadata = aggregateLLMMetadata(
          metadata.plannerModel ? plan.metadata : undefined,
          [],
          responseResult.metadata
        );

        // Render and send with full transparency
        const rendered = ResponseRenderer.render(updatedMetadata, finalResponse);

        // Send both embeds
        const systemEmbed = rendered.systemEmbed;
        const responseEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('💬 Regenerated Response')
          .setDescription(rendered.responseContent.substring(0, 1900))
          .setTimestamp();

        await interaction.message.edit({
          content: null,
          embeds: [systemEmbed, responseEmbed],
          components: rendered.actionButtons ? [rendered.actionButtons] : [],
        });

        console.log(`Regenerated response for message ${interaction.message.id}`);
      } else if (interaction.customId === 'generate_image') {
        // Get the stored context
        const context = this.messageContexts.get(interaction.message.id);
        
        if (!context) {
          await interaction.reply({
            content: 'Sorry, I cannot generate an image (context expired).',
            ephemeral: true,
          });
          return;
        }

        // Acknowledge the interaction
        await interaction.deferUpdate();

        // Extract/create image prompt using AI
        const workingEmbed = ResponseRenderer.createWorkingEmbed('Generating image...');

        await interaction.message.edit({
          embeds: [workingEmbed],
          components: [],
        });

        try {
          // Use AI to extract or create an image prompt from the context
          const promptExtractionPrompt: Message[] = [
            {
              role: 'system',
              content: 'Extract or create a detailed image generation prompt from the user message and conversation. Output ONLY the image prompt, nothing else. Be descriptive and specific.',
            },
            {
              role: 'user',
              content: context.userContent,
            },
          ];

          const imagePrompt = await this.aiService.chatCompletion(
            promptExtractionPrompt,
            'meta-llama/llama-3.3-70b-instruct:free'
          );

          // Update: Generating image
          await interaction.message.edit({
            embeds: [ResponseRenderer.updateWorkingEmbed(
              workingEmbed,
              'executing',
              `🎨 Creating: ${imagePrompt.substring(0, 100)}...`
            )],
          });

          // Generate image
          const imageResult = await this.imageService.generateImage({
            prompt: imagePrompt.trim(),
            width: 512,
            height: 512,
          });

          if (!this.imageService.isDiscordSafe(imageResult.sizeBytes)) {
            await interaction.message.edit({
              content: '⚠️ Generated image is too large for Discord.',
              embeds: [],
              components: [],
            });
            return;
          }

          const attachment = new AttachmentBuilder(imageResult.imageBuffer, {
            name: 'generated-image.png',
          });

          // Create metadata for the image generation
          const metadata = ResponseRenderer.createMetadata(
            [{ type: 'image', imagePrompt: imagePrompt.trim() }],
            'Generated image from button request',
            'google/gemini-2.0-flash-exp:free',
            context.personaId
          );
          metadata.endTime = Date.now();

          // Render with transparency
          const rendered = ResponseRenderer.render(
            metadata,
            'Generated image based on your request.',
            {
              buffer: imageResult.imageBuffer,
              resolution: imageResult.resolution,
              prompt: imagePrompt.trim(),
            }
          );

          const imageEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎨 Generated Image')
            .setDescription(`**Prompt:** ${imagePrompt}\n**Resolution:** ${imageResult.resolution.width}×${imageResult.resolution.height}`)
            .setImage('attachment://generated-image.png')
            .setTimestamp();

          await interaction.message.edit({
            content: null,
            embeds: [rendered.systemEmbed, imageEmbed],
            files: [attachment],
            components: rendered.actionButtons ? [rendered.actionButtons] : [],
          });

          console.log(`Generated image from button: ${imageResult.resolution.width}×${imageResult.resolution.height}`);
        } catch (error) {
          console.error('Error generating image from button:', error);
          await interaction.message.edit({
            content: 'Sorry, I encountered an error generating the image.',
            embeds: [],
            components: [],
          });
        }
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: 'Sorry, I encountered an error processing your request.',
          });
        } else {
          await interaction.reply({
            content: 'Sorry, I encountered an error processing your request.',
            ephemeral: true,
          });
        }
      } catch (e) {
        console.error('Failed to send error message:', e);
      }
    }
  }
}
