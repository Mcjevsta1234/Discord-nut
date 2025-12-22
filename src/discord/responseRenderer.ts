/**
 * Response Renderer - Transparent and structured Discord response formatting
 * 
 * This module provides a consistent way to display AI responses with full transparency:
 * - Planning and reasoning steps are always visible
 * - Tool usage is explicitly shown (or explicitly stated as not needed)
 * - Model selection and routing decisions are documented
 * - System information is separated from conversational responses
 * - Debug mode controls what information is displayed
 */

import { EmbedBuilder, Message as DiscordMessage, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextBasedChannel } from 'discord.js';
import { PlannedAction, ActionPlan } from '../ai/planner';
import { ActionResult, ExecutionResult } from '../ai/actionExecutor';
import { AggregatedLLMMetadata, LLMResponseMetadata } from '../ai/llmMetadata';
import { RoutingDecision } from '../ai/modelTiers';
import { getTierConfig } from '../config/routing';
import { DebugMode, DebugSection, shouldShowSection, getDebugMode } from './debugMode';
import { FileAttachmentHandler, FileContent } from './fileAttachments';

/**
 * Progress tracking for live UX updates
 */
export interface ProgressUpdate {
  stage: 'planning' | 'executing' | 'responding' | 'complete' | 'error';
  message: string;
  details?: string;
  stepNumber?: number;
  totalSteps?: number;
  actionType?: string;
  actionName?: string;
  timestamp: number;
}

/**
 * Progress tracker for managing animated indicators and incremental updates
 */
export class ProgressTracker {
  private message: DiscordMessage;
  private embed: EmbedBuilder;
  private updates: ProgressUpdate[] = [];
  private updateInterval?: NodeJS.Timeout;
  private spinnerIndex = 0;
  // Simple spinner loader
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private lastUpdateTime = 0;
  private minUpdateInterval = 1000; // Discord rate limit: max 5 edits per 5 seconds = 1 per second
  private isClosed = false;
  private pendingUpdate = false;
  
  // Snake game state
  private snakeX = 5;
  private snakeY = 3;
  private snakeBody: Array<{x: number, y: number}> = [{x: 5, y: 3}, {x: 4, y: 3}, {x: 3, y: 3}];
  private appleX = 12;
  private appleY = 3;
  private direction = 1; // 0=up, 1=right, 2=down, 3=left
  private score = 0;
  private readonly gameWidth = 20;
  private readonly gameHeight = 7;

  constructor(message: DiscordMessage, initialEmbed: EmbedBuilder) {
    this.message = message;
    this.embed = initialEmbed;
    this.startAnimatedSpinner();
  }

  /**
   * Start animated spinner that updates periodically
   * Uses 1.5s interval to stay well within Discord's rate limits (5 edits per 5 seconds)
   */
  private startAnimatedSpinner(): void {
    this.updateInterval = setInterval(async () => {
      if (this.isClosed) {
        this.stopAnimatedSpinner();
        return;
      }

      // Skip if an update is already in progress
      if (this.pendingUpdate) {
        return;
      }

      const now = Date.now();
      const timeSinceLastUpdate = now - this.lastUpdateTime;
      
      // Ensure we respect rate limits strictly
      if (timeSinceLastUpdate < this.minUpdateInterval) {
        return;
      }

      try {
        this.pendingUpdate = true;
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
        this.updateSnakeGame(); // Update snake game state
        await this.updateDisplay();
        this.lastUpdateTime = Date.now();
      } catch (error) {
        // Message might have been deleted, stop spinner
        this.stopAnimatedSpinner();
      } finally {
        this.pendingUpdate = false;
      }
    }, 1000); // Check every 1 second, matching our minimum interval
  }

  /**
   * Stop the animated spinner
   */
  private stopAnimatedSpinner(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  /**
   * Add a progress update and refresh display
   */
  async addUpdate(update: ProgressUpdate): Promise<void> {
    if (this.isClosed) return;

    this.updates.push(update);
    
    // Force immediate update for important stages
    const forceUpdate = update.stage === 'error' || update.stage === 'complete';
    if (forceUpdate) {
      await this.updateDisplay(true);
    }
  }

  /**
   * Update the Discord message with current progress
   */
  private async updateDisplay(force = false): Promise<void> {
    if (this.isClosed) return;

    const now = Date.now();
    if (!force && now - this.lastUpdateTime < this.minUpdateInterval) {
      return; // Rate limit
    }

    try {
      const description = this.buildProgressDescription();
      this.embed.setDescription(description);
      
      // Update color based on stage
      const latestUpdate = this.updates[this.updates.length - 1];
      if (latestUpdate) {
        if (latestUpdate.stage === 'error') {
          this.embed.setColor(0xff0000); // Red for error
        } else if (latestUpdate.stage === 'complete') {
          this.embed.setColor(0x00ff00); // Green for complete
        } else {
          this.embed.setColor(0xffa500); // Orange for in-progress
        }
      }

      await this.message.edit({ embeds: [this.embed] });
      this.lastUpdateTime = now;
    } catch (error) {
      // Message might have been deleted
      this.stopAnimatedSpinner();
    }
  }

  /**
   * Build progress description with incremental updates (append mode)
   */
  private buildProgressDescription(): string {
    if (this.updates.length === 0) {
      return `${this.getCurrentSpinner()} Processing...`;
    }

    const lines: string[] = [];
    
    // Group updates by stage
    const latestUpdate = this.updates[this.updates.length - 1];
    
    // Show current spinner for active stages
    const spinner = latestUpdate.stage === 'complete' || latestUpdate.stage === 'error'
      ? ''
      : this.getCurrentSpinner() + ' ';

    // Build incremental list of steps
    for (let i = 0; i < this.updates.length; i++) {
      const update = this.updates[i];
      const isLatest = i === this.updates.length - 1;
      
      let icon = '';
      if (update.stage === 'error') {
        icon = '❌';
      } else if (update.stage === 'complete') {
        icon = '✅';
      } else if (isLatest) {
        icon = spinner.trim();
      } else {
        icon = '✓';
      }
      
      let line = `${icon} ${update.message}`;
      if (update.details && isLatest) {
        line += `\n  └ ${update.details}`;
      }
      
      lines.push(line);
    }

    // Add snake game at the bottom (only if still processing)
    if (latestUpdate.stage !== 'complete' && latestUpdate.stage !== 'error') {
      lines.push('\n' + this.renderSnakeGame());
    }

    return lines.join('\n');
  }

  /**
   * Update snake game state
   */
  private updateSnakeGame(): void {
    // Intelligent movement: move towards apple
    const currentHead = this.snakeBody[0];
    const dx = this.appleX - currentHead.x;
    const dy = this.appleY - currentHead.y;
    
    // Determine best direction to move towards apple
    // Prioritize the axis with the larger distance
    let targetDirection = this.direction;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      // Move horizontally
      if (dx > 0) {
        targetDirection = 1; // right
      } else if (dx < 0) {
        targetDirection = 3; // left
      }
    } else if (dy !== 0) {
      // Move vertically
      if (dy > 0) {
        targetDirection = 2; // down
      } else if (dy < 0) {
        targetDirection = 0; // up
      }
    }
    
    // Avoid going backwards into own body
    const oppositeDirection = (targetDirection + 2) % 4;
    if (this.direction !== oppositeDirection) {
      this.direction = targetDirection;
    } else {
      // If target direction is backwards, try a perpendicular direction
      this.direction = (this.direction + 1) % 4;
    }
    
    // Move snake head
    const head = { ...currentHead };
    
    switch (this.direction) {
      case 0: head.y--; break; // up
      case 1: head.x++; break; // right
      case 2: head.y++; break; // down
      case 3: head.x--; break; // left
    }
    
    // Wrap around walls
    if (head.x < 0) head.x = this.gameWidth - 1;
    if (head.x >= this.gameWidth) head.x = 0;
    if (head.y < 0) head.y = this.gameHeight - 1;
    if (head.y >= this.gameHeight) head.y = 0;
    
    // Add new head
    this.snakeBody.unshift(head);
    
    // Check if ate apple
    if (head.x === this.appleX && head.y === this.appleY) {
      this.score++;
      // Spawn new apple, avoiding snake body
      let newX: number = 0;
      let newY: number = 0;
      let attempts = 0;
      do {
        newX = Math.floor(Math.random() * this.gameWidth);
        newY = Math.floor(Math.random() * this.gameHeight);
        attempts++;
      } while (attempts < 100 && this.snakeBody.some(s => s.x === newX && s.y === newY));
      
      this.appleX = newX;
      this.appleY = newY;
    } else {
      // Remove tail if didn't eat apple
      this.snakeBody.pop();
    }
  }

  /**
   * Render snake game as ASCII art in a box
   */
  private renderSnakeGame(): string {
    const lines: string[] = [];
    
    // Top border with score
    lines.push(`╔${'═'.repeat(this.gameWidth)}╗ Score: ${this.score}`);
    
    // Game board
    for (let y = 0; y < this.gameHeight; y++) {
      let row = '║';
      for (let x = 0; x < this.gameWidth; x++) {
        // Check if this position has snake body
        const isSnakeHead = this.snakeBody[0].x === x && this.snakeBody[0].y === y;
        const isSnakeBody = this.snakeBody.slice(1).some(s => s.x === x && s.y === y);
        const isApple = this.appleX === x && this.appleY === y;
        
        if (isSnakeHead) {
          row += '◉';
        } else if (isSnakeBody) {
          row += '●';
        } else if (isApple) {
          row += '◆';
        } else {
          row += ' ';
        }
      }
      row += '║';
      lines.push(row);
    }
    
    // Bottom border
    lines.push(`╚${'═'.repeat(this.gameWidth)}╝`);
    
    return '```\n' + lines.join('\n') + '\n```';
  }

  /**
   * Get current spinner frame
   */
  private getCurrentSpinner(): string {
    return this.spinnerFrames[this.spinnerIndex];
  }

  /**
   * Mark as complete and stop updates
   */
  async complete(): Promise<void> {
    if (this.isClosed) return;
    
    this.isClosed = true;
    this.stopAnimatedSpinner();
    
    await this.addUpdate({
      stage: 'complete',
      message: 'Processing complete',
      timestamp: Date.now(),
    });
  }

  /**
   * Mark as failed and stop updates
   */
  async error(errorMessage: string, details?: string): Promise<void> {
    if (this.isClosed) return;
    
    this.isClosed = true;
    this.stopAnimatedSpinner();
    
    await this.addUpdate({
      stage: 'error',
      message: errorMessage || 'Processing failed',
      details: details,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle timeout
   */
  async timeout(timeoutSeconds: number): Promise<void> {
    await this.error(
      'Request timed out',
      `Processing took longer than ${timeoutSeconds} seconds`
    );
  }

  /**
   * Handle cancellation
   */
  async cancel(reason?: string): Promise<void> {
    await this.error(
      'Request cancelled',
      reason || 'Processing was cancelled'
    );
  }

  /**
   * Close and cleanup
   */
  close(): void {
    this.isClosed = true;
    this.stopAnimatedSpinner();
  }

  /**
   * Get the Discord message being tracked
   */
  getMessage(): DiscordMessage {
    return this.message;
  }
}

/**
 * Metadata about the response generation process
 */
export interface ResponseMetadata {
  // Planning phase
  planReasoning?: string;
  plannedActions: PlannedAction[];
  plannerModel?: string;
  
  // Execution phase
  executionResults?: ActionResult[];
  executionDuration?: number;
  
  // Response generation
  responseModel: string;
  personaId?: string;
  
  // Routing information (NEW)
  routingDecision?: RoutingDecision;
  
  // LLM token usage and timing (NEW)
  llmMetadata?: AggregatedLLMMetadata;
  
  // Timing
  startTime: number;
  endTime?: number;
}

/**
 * Complete response package ready for Discord rendering
 */
export interface RenderedResponse {
  systemEmbed: EmbedBuilder;
  responseContent: string;
  actionButtons?: ActionRowBuilder<ButtonBuilder>;
  imageAttachment?: Buffer;
  imageMetadata?: {
    prompt: string;
    resolution: { width: number; height: number };
  };
}

export class ResponseRenderer {
  /**
   * Create initial metadata object at start of response generation
   */
  static createMetadata(
    plannedActions: PlannedAction[],
    planReasoning: string | undefined,
    responseModel: string,
    personaId?: string
  ): ResponseMetadata {
    return {
      planReasoning,
      plannedActions,
      responseModel,
      personaId,
      startTime: Date.now(),
    };
  }

  /**
   * Update metadata with execution results
   */
  static updateWithExecution(
    metadata: ResponseMetadata,
    executionResults: ActionResult[],
    executionDuration: number
  ): ResponseMetadata {
    return {
      ...metadata,
      executionResults,
      executionDuration,
      endTime: Date.now(),
    };
  }

  /**
   * Build the system/reasoning embed (Embed 1)
   * This shows all the "behind the scenes" information
   * Respects debug mode settings
   */
  static buildSystemEmbed(metadata: ResponseMetadata, guildId?: string, channelId?: string): EmbedBuilder {
    const debugMode = getDebugMode(guildId, channelId);
    
    // If debug mode is OFF, return null (no embed)
    if (debugMode === DebugMode.OFF) {
      return new EmbedBuilder(); // Return empty embed (will be filtered out)
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple for system info
      .setTitle('🧠 System Information')
      .setTimestamp();

    // Build description with all sections
    const sections: string[] = [];

    // 1. PLAN SECTION (always shown in SIMPLE and FULL)
    if (shouldShowSection(DebugSection.PLAN, debugMode)) {
      sections.push('**📋 Plan**');
      if (metadata.plannedActions.length === 0) {
        sections.push('• Direct response (no actions needed)');
      } else {
        const planBullets = this.formatPlanBullets(metadata.plannedActions);
        sections.push(planBullets.join('\n'));
      }
    }

    // 2. REASONING SECTION (FULL only)
    if (shouldShowSection(DebugSection.REASONING, debugMode)) {
      if (metadata.planReasoning && metadata.planReasoning !== 'Planned actions' && metadata.planReasoning !== 'Conversational response') {
        sections.push('\n**🤔 Reasoning**');
        sections.push(metadata.planReasoning.substring(0, 200));
      }
    }

    // 3. TOOLS SECTION (always shown in SIMPLE and FULL)
    if (shouldShowSection(DebugSection.TOOLS_USED, debugMode)) {
      sections.push('\n**🔧 Tools Used**');
      const toolsUsed = this.extractToolsUsed(metadata);
      const toolCount = metadata.executionResults?.filter(r => 
        r.success && metadata.plannedActions[metadata.executionResults!.indexOf(r)]?.type === 'tool'
      ).length || 0;
      
      sections.push(`• Count: ${toolCount}`);
      if (toolsUsed.length === 0) {
        sections.push('• No tools were required for this response');
      } else {
        sections.push(toolsUsed.join('\n'));
      }
    }

    // 4. ROUTING & MODEL SECTION (FULL only) - with cost-based pricing
    if (shouldShowSection(DebugSection.ROUTING, debugMode)) {
      sections.push('\n**🎯 Model & Routing**');
      
      if (metadata.routingDecision) {
        const rd = metadata.routingDecision;
        sections.push(`• Model: \`${this.truncate(rd.modelId, 50)}\``);
        sections.push(`• Method: ${rd.routingMethod === 'heuristic' ? '⚡ Heuristic' : rd.routingMethod === 'routerModel' ? '🤖 Router LLM' : '🔀 Hybrid'}`);
        sections.push(`• Reason: ${rd.routingReason}`);
        sections.push(`• Confidence: ${(rd.confidence * 100).toFixed(0)}%`);
      } else {
        // Fallback if no routing decision available
        sections.push(`• Model: \`${this.truncate(metadata.responseModel, 50)}\``);
      }
      
      if (metadata.personaId) {
        sections.push(`• Persona: \`${metadata.personaId}\``);
      }
    }

    // 5. PRICING SECTION (FULL only) - cost-based display
    if (shouldShowSection(DebugSection.PRICING, debugMode) && metadata.routingDecision) {
      sections.push('\n**💰 Pricing**');
      const tierConfig = getTierConfig(metadata.routingDecision.tier);
      
      if (tierConfig.inputPricePerMillionTokens === 0 && tierConfig.outputPricePerMillionTokens === 0) {
        sections.push(`• Input: $0.00 / 1M tokens`);
        sections.push(`• Output: $0.00 / 1M tokens`);
        sections.push(`• This message: **$0.00** (free tier)`);
      } else {
        sections.push(`• Input: $${tierConfig.inputPricePerMillionTokens.toFixed(2)} / 1M tokens`);
        sections.push(`• Output: $${tierConfig.outputPricePerMillionTokens.toFixed(2)} / 1M tokens`);
        
        // Calculate actual cost for this message
        if (metadata.llmMetadata && metadata.llmMetadata.totalTokens > 0) {
          const inputCost = (metadata.llmMetadata.totalPromptTokens / 1000000) * tierConfig.inputPricePerMillionTokens;
          const outputCost = (metadata.llmMetadata.totalCompletionTokens / 1000000) * tierConfig.outputPricePerMillionTokens;
          const totalCost = inputCost + outputCost;
          sections.push(`• This message: **$${totalCost.toFixed(4)}**`);
        }
      }
    }

    // 6. TOKEN USAGE SECTION (FULL only)
    if (shouldShowSection(DebugSection.TOKEN_USAGE, debugMode)) {
      sections.push('\n**📊 Token Usage**');
      if (metadata.llmMetadata) {
        const llm = metadata.llmMetadata;
        
        // Show aggregated stats
        if (llm.totalTokens > 0) {
          sections.push(`• Total Tokens: ${llm.totalTokens.toLocaleString()}`);
          
          // Show breakdown by phase if multiple calls
          if (llm.totalCalls > 1) {
            if (llm.planningCall?.usage) {
              sections.push(`  - Planning: ${llm.planningCall.usage.totalTokens || 0} tokens`);
            }
            if (llm.responseCall?.usage) {
              sections.push(`  - Response: ${llm.responseCall.usage.totalTokens || 0} tokens`);
            }
          }
          
          // Show prompt/completion breakdown for main response
          if (llm.responseCall?.usage) {
            const u = llm.responseCall.usage;
            sections.push(`• Prompt: ${u.promptTokens || 0} | Completion: ${u.completionTokens || 0}`);
          }
        } else {
          sections.push('• Token data unavailable from provider');
        }
        
        // Show models used
        if (llm.modelsUsed.length > 0) {
          sections.push(`• Models: ${llm.modelsUsed.map(m => `\`${this.truncate(m, 30)}\``).join(', ')}`);
        }
      } else {
        sections.push('• Token usage tracking unavailable');
        sections.push('• (Provider did not return usage data)');
      }
    }

    // 7. PERFORMANCE SECTION (always shown in SIMPLE and FULL)
    if (shouldShowSection(DebugSection.PERFORMANCE, debugMode)) {
      sections.push('\n**⚡ Performance**');
      
      // Total end-to-end time
      if (metadata.endTime) {
        const totalDuration = metadata.endTime - metadata.startTime;
        sections.push(`• Total Time: ${(totalDuration / 1000).toFixed(2)}s`);
      }
      
      // LLM latency
      if (metadata.llmMetadata && metadata.llmMetadata.totalLatencyMs > 0) {
        sections.push(`• LLM Latency: ${(metadata.llmMetadata.totalLatencyMs / 1000).toFixed(2)}s`);
      }
      
      // Execution time (tool calls)
      if (metadata.executionDuration !== undefined && metadata.executionDuration > 0) {
        sections.push(`• Tool Execution: ${(metadata.executionDuration / 1000).toFixed(2)}s`);
      }
    }

    // Combine all sections
    embed.setDescription(sections.join('\n'));

    return embed;
  }

  /**
   * Format planned actions into user-friendly bullets
   */
  private static formatPlanBullets(actions: PlannedAction[]): string[] {
    return actions.map((action, index) => {
      const num = index + 1;
      
      if (action.type === 'tool' && action.toolName) {
        // Format based on specific tool
        if (action.toolName === 'github_repo') {
          const subAction = action.toolParams?.action || 'access';
          const repo = action.toolParams?.repo || 'repository';
          return `${num}. GitHub: ${repo} (${subAction})`;
        } else if (action.toolName === 'searxng_search') {
          const query = action.toolParams?.query || 'search';
          return `${num}. Web Search: "${this.truncate(query, 40)}"`;
        } else if (action.toolName === 'fetch_url') {
          const url = action.toolParams?.url || 'URL';
          return `${num}. Fetch: ${this.truncate(url, 40)}`;
        } else if (action.toolName === 'calculate') {
          const expr = action.toolParams?.expression || 'calculation';
          return `${num}. Calculate: ${expr}`;
        } else if (action.toolName === 'convert_units') {
          return `${num}. Convert Units`;
        } else if (action.toolName === 'convert_currency') {
          return `${num}. Convert Currency`;
        } else if (action.toolName === 'get_time') {
          return `${num}. Get Current Time`;
        } else {
          return `${num}. Tool: ${action.toolName}`;
        }
      } else if (action.type === 'image') {
        return `${num}. Generate Image`;
      } else if (action.type === 'chat') {
        return `${num}. Conversational Response`;
      }
      
      return `${num}. Unknown Action`;
    });
  }

  /**
   * Extract and format tools that were actually used with results
   */
  private static extractToolsUsed(metadata: ResponseMetadata): string[] {
    if (!metadata.executionResults || metadata.executionResults.length === 0) {
      return [];
    }

    const toolLines: string[] = [];

    metadata.executionResults.forEach((result, index) => {
      const action = metadata.plannedActions[index];
      
      if (!action) return;

      if (action.type === 'tool' && action.toolName) {
        const status = result.success ? '✅' : '❌';
        const toolName = action.toolName;
        
        // Show tool with status and brief result
        let resultPreview = '';
        if (result.success && result.content) {
          resultPreview = ` - ${this.truncate(result.content, 50)}`;
        } else if (!result.success && result.error) {
          resultPreview = ` - Error: ${this.truncate(result.error, 40)}`;
        }
        
        toolLines.push(`• ${status} ${toolName}${resultPreview}`);
      } else if (action.type === 'image') {
        const status = result.success ? '✅' : '❌';
        toolLines.push(`• ${status} Image Generation`);
      }
    });

    return toolLines;
  }

  /**
   * Build action buttons for the response
   */
  static buildActionButtons(): ActionRowBuilder<ButtonBuilder> {
    const redoButton = new ButtonBuilder()
      .setCustomId('redo_response')
      .setLabel('🔄 Regenerate')
      .setStyle(ButtonStyle.Secondary);

    const imageButton = new ButtonBuilder()
      .setCustomId('generate_image')
      .setLabel('🎨 Generate Image')
      .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton, imageButton);
  }

  /**
   * Create a complete rendered response package
   */
  static render(
    metadata: ResponseMetadata,
    responseContent: string,
    guildId?: string,
    channelId?: string,
    imageData?: { buffer: Buffer; prompt: string; resolution: { width: number; height: number } }
  ): RenderedResponse {
    // Build system embed with all transparency info (respects debug mode)
    const systemEmbed = this.buildSystemEmbed(metadata, guildId, channelId);

    // Clean up response content
    const cleanedResponse = this.cleanResponseContent(responseContent);

    return {
      systemEmbed,
      responseContent: cleanedResponse,
      actionButtons: this.buildActionButtons(),
      imageAttachment: imageData?.buffer,
      imageMetadata: imageData ? { prompt: imageData.prompt, resolution: imageData.resolution } : undefined,
    };
  }

  /**
   * Send the rendered response to Discord
   * STRICT ORDER:
   * 1. System/debug embed FIRST (if not in OFF mode)
   * 2. User-facing response SECOND as separate message with attachments
   * 
   * Handles:
   * - File attachments for code/HTML
   * - Message splitting for long text
   * - Proper ordering
   */
  static async sendToDiscord(
    message: DiscordMessage,
    rendered: RenderedResponse,
    workingMessage?: DiscordMessage
  ): Promise<DiscordMessage | null> {
    try {
      const guildId = message.guildId || undefined;
      const channelId = message.channelId;
      const debugMode = getDebugMode(guildId, channelId);

      // PROCESSING ORDER: normalize → extract → prepare attachments → clean text → split → validate
      const normalizedContent = this.normalizeModelOutput(rendered.responseContent);
      const extractionResult = this.extractCodeAndHtml(normalizedContent);
      const consolidated = this.consolidateAttachments(extractionResult.attachments);
      const renamedContent = this.applyAttachmentRename(extractionResult.content, consolidated.renameMap);

      const fileContents: FileContent[] = consolidated.attachments.map(file => ({
        filename: file.filename,
        content: file.content,
      }));

      const { attachments: discordAttachments, warnings: attachmentWarnings, errors: attachmentErrors } =
        FileAttachmentHandler.createMultipleAttachments(fileContents);

      let messageChunks = this.splitLongText(renamedContent, 1900);

      if (attachmentWarnings.length || attachmentErrors.length) {
        if (messageChunks.length === 0) {
          messageChunks.push('');
        }
        const noticeLines = [
          ...attachmentWarnings.map(w => `⚠️ ${w}`),
          ...attachmentErrors.map(e => `⚠️ ${e}`),
        ];
        const lastIndex = messageChunks.length - 1;
        const existing = messageChunks[lastIndex];
        messageChunks[lastIndex] = existing
          ? `${existing}\n\n${noticeLines.join('\n')}`
          : noticeLines.join('\n');
      }

      messageChunks = this.validateMessageChunks(messageChunks, discordAttachments.length > 0);

      // STEP 1: Send system embed FIRST (if not in OFF mode)
      let systemMessage: DiscordMessage | null = null;
      
      if (debugMode !== DebugMode.OFF && rendered.systemEmbed.data.description) {
        if (workingMessage) {
          // Edit working message to show system embed
          await workingMessage.edit({
            content: null,
            embeds: [rendered.systemEmbed],
            components: [],
          });
          systemMessage = workingMessage;
        } else {
          // Send system embed as new message
          systemMessage = await message.reply({
            embeds: [rendered.systemEmbed],
          });
        }
      } else if (workingMessage) {
        // Delete working message if debug is OFF
        await workingMessage.delete().catch(() => {});
      }

      // STEP 2: Send user-facing text AFTER system embed
      let lastResponseMessage: DiscordMessage | null = null;
      
      for (let i = 0; i < messageChunks.length; i++) {
        const chunk = messageChunks[i];
        const isLastChunk = i === messageChunks.length - 1;
        
        // Add continuation indicator if not the last chunk
        const chunkContent = messageChunks.length > 1 && !isLastChunk
          ? `${chunk}\n\n*(continued...)*`
          : chunk;
        
        // Send as reply to original message (not reply to system embed)
        if ('send' in message.channel) {
          lastResponseMessage = await message.channel.send({
            content: chunkContent,
          });
        }
        
        // Small delay between chunks to ensure ordering
        if (!isLastChunk) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // STEP 3: Send file attachments LAST (after embeds and text)
      if (discordAttachments.length > 0 && 'send' in message.channel) {
        const summaryLines: string[] = [];
        const summary = this.buildAttachmentSummary(consolidated.attachments);
        if (summary) {
          summaryLines.push(summary);
        }
        if (attachmentWarnings.length || attachmentErrors.length) {
          summaryLines.push(...attachmentWarnings.map(w => `⚠️ ${w}`));
          summaryLines.push(...attachmentErrors.map(e => `⚠️ ${e}`));
        }

        lastResponseMessage = await message.channel.send({
          content: summaryLines.join('\n') || '📎 Attached files:',
          files: discordAttachments,
        });
      }

      return lastResponseMessage || systemMessage;
    } catch (error) {
      console.error('Error sending rendered response to Discord:', error);
      
      // Fallback: try to send basic response
      try {
        if ('send' in message.channel) {
          return await message.channel.send({
            content: this.truncate(rendered.responseContent, 1900),
          });
        }
        return null;
      } catch (fallbackError) {
        console.error('Fallback send also failed:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Create a "working" embed shown during processing
   */
  static createWorkingEmbed(userQuery: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0xffa500) // Orange for in-progress
      .setTitle('⏳ Processing...')
      .setDescription(`**Query:** ${this.truncate(userQuery, 200)}\n\n⠋ Starting...`)
      .setTimestamp();
  }

  /**
   * Create a progress tracker for live updates
   */
  static createProgressTracker(message: DiscordMessage, userQuery: string): ProgressTracker {
    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('⚡ Processing Your Request')
      .setDescription(`**Query:** ${this.truncate(userQuery, 200)}\n\n⠋ Starting...`)
      .setTimestamp();
    
    return new ProgressTracker(message, embed);
  }

  /**
   * Update working embed with current progress
   */
  static updateWorkingEmbed(
    embed: EmbedBuilder,
    stage: 'planning' | 'executing' | 'responding',
    details?: string
  ): EmbedBuilder {
    let icon = '🤔';
    let text = 'Planning...';

    if (stage === 'executing') {
      icon = '⚙️';
      text = 'Executing actions...';
    } else if (stage === 'responding') {
      icon = '💭';
      text = 'Generating response...';
    }

    const currentDesc = embed.data.description || '';
    const baseDesc = currentDesc.split('\n\n')[0]; // Keep the query part

    return embed.setDescription(
      `${baseDesc}\n\n${icon} ${text}${details ? `\n${details}` : ''}`
    );
  }

  /**
  * Extract code blocks or HTML from response for file attachment
  * STRICT RULES:
  * - Tiny snippets (≤10 lines AND ≤200 chars) may stay inline if illustrative only
  * - Complete programs/files MUST be attached
  * - Full HTML/JS/CSS always attached
  * - Correct file extensions enforced
  * - Default to a single attachment unless multiple languages force separation
  * Returns: { content: cleaned text, attachments: file data }
   */
  static extractCodeAndHtml(responseContent: string): {
    content: string;
    attachments: Array<{ content: string; filename: string; language: string }>;
  } {
    const attachments: Array<{ content: string; filename: string; language: string }> = [];
    let cleanedContent = responseContent;

    // Extract code blocks (```language\ncode\n```)
    const codeBlockRegex = /```([a-z0-9]*)?\n([\s\S]*?)```/gi;
    let match;
    let blockIndex = 0;

    while ((match = codeBlockRegex.exec(responseContent)) !== null) {
      const language = match[1] || '';
      const code = match[2].trim();
      const lineCount = code.split('\n').length;
      const charCount = code.length;
      
      // HARD RULE: Attach if > 10 lines OR > 200 chars OR is a complete program
      const exceedsTinySnippetLimit = lineCount > 10 || charCount > 200;
      const isCompleteProgram = this.looksLikeCompleteCode(code, language);
      
      if (exceedsTinySnippetLimit || isCompleteProgram) {
        blockIndex++;
        const extension = this.getFileExtension(language, code);
        const filename = this.generateFilename(language, blockIndex, extension);
        
        attachments.push({
          content: code,
          filename,
          language: language || this.detectLanguage(code),
        });
        
        // Replace with file reference
        cleanedContent = cleanedContent.replace(
          match[0],
          `📎 **Code attached:** \`${filename}\``
        );
      }
    }

    // Extract HTML blocks (ALWAYS attach complete HTML files)
    // CRITICAL: Search in cleanedContent, not responseContent, to avoid duplicating HTML from code blocks
    const htmlRegex = /<(!DOCTYPE html|html)[\s\S]*?<\/html>/gi;
    let htmlMatch;
    let htmlIndex = 0;

    while ((htmlMatch = htmlRegex.exec(cleanedContent)) !== null) {
      const html = htmlMatch[0].trim();
      
      // ALWAYS attach HTML files (no inline HTML allowed)
      htmlIndex++;
      const filename = htmlIndex === 1 ? 'index.html' : `page-${htmlIndex}.html`;
      
      attachments.push({
        content: html,
        filename,
        language: 'html',
      });
      
      // Replace with file reference
      cleanedContent = cleanedContent.replace(
        html,
        `📎 **HTML attached:** \`${filename}\``
      );
    }

    return {
      content: cleanedContent.trim(),
      attachments,
    };
  }

  /**
   * Collapse multiple attachments into a single file when safe
   * Returns consolidated attachments plus a rename map to keep text references accurate
   */
  private static consolidateAttachments(
    attachments: Array<{ content: string; filename: string; language: string }>
  ): {
    attachments: Array<{ content: string; filename: string; language: string }>;
    renameMap: Record<string, string>;
  } {
    if (attachments.length <= 1) {
      return { attachments, renameMap: {} };
    }

    // SPECIAL CASE: Merge HTML + CSS + JS into single HTML file
    const htmlFile = attachments.find(f => f.filename.endsWith('.html'));
    const cssFiles = attachments.filter(f => f.filename.endsWith('.css'));
    const jsFiles = attachments.filter(f => f.filename.endsWith('.js') || f.filename.endsWith('.ts'));
    
    if (htmlFile && (cssFiles.length > 0 || jsFiles.length > 0)) {
      const renameMap: Record<string, string> = {};
      let htmlContent = htmlFile.content;
      
      // Inject CSS as <style> tags
      if (cssFiles.length > 0) {
        const combinedCSS = cssFiles.map(f => f.content).join('\n\n');
        const styleTag = `<style>\n${combinedCSS}\n</style>`;
        
        // Try to insert before </head>, or after <head>, or at the start
        if (htmlContent.includes('</head>')) {
          htmlContent = htmlContent.replace('</head>', `${styleTag}\n</head>`);
        } else if (htmlContent.includes('<head>')) {
          htmlContent = htmlContent.replace('<head>', `<head>\n${styleTag}`);
        } else if (htmlContent.includes('<html>')) {
          htmlContent = htmlContent.replace('<html>', `<html>\n<head>\n${styleTag}\n</head>`);
        } else {
          htmlContent = styleTag + '\n' + htmlContent;
        }
        
        // Mark CSS files as merged
        cssFiles.forEach(f => renameMap[f.filename] = htmlFile.filename);
      }
      
      // Inject JS as <script> tags
      if (jsFiles.length > 0) {
        const combinedJS = jsFiles.map(f => f.content).join('\n\n');
        const scriptTag = `<script>\n${combinedJS}\n</script>`;
        
        // Try to insert before </body>, or at the end
        if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', `${scriptTag}\n</body>`);
        } else if (htmlContent.includes('</html>')) {
          htmlContent = htmlContent.replace('</html>', `${scriptTag}\n</html>`);
        } else {
          htmlContent = htmlContent + '\n' + scriptTag;
        }
        
        // Mark JS files as merged
        jsFiles.forEach(f => renameMap[f.filename] = htmlFile.filename);
      }
      
      // Return single consolidated HTML file
      const consolidated = [{
        content: htmlContent,
        filename: 'index.html',
        language: 'html',
      }];
      
      // Add any remaining non-HTML/CSS/JS files
      const otherFiles = attachments.filter(f => 
        !f.filename.endsWith('.html') && 
        !f.filename.endsWith('.css') && 
        !f.filename.endsWith('.js') &&
        !f.filename.endsWith('.ts')
      );
      
      consolidated.push(...otherFiles);
      renameMap[htmlFile.filename] = 'index.html';
      
      return { attachments: consolidated, renameMap };
    }

    // Group by extension for other files
    const grouped = new Map<string, typeof attachments>();
    for (const file of attachments) {
      const ext = file.filename.split('.').pop()?.toLowerCase() || 'txt';
      if (!grouped.has(ext)) {
        grouped.set(ext, []);
      }
      grouped.get(ext)!.push(file);
    }

    // Consolidate each group separately
    const consolidated: typeof attachments = [];
    const renameMap: Record<string, string> = {};

    for (const [ext, files] of grouped.entries()) {
      if (files.length === 1) {
        consolidated.push(files[0]);
        continue;
      }

      // Always consolidate multiple files of the same type into one
      const commentDelimiters = this.getSectionDelimiter(ext);
      const primaryFilename = ext === 'html' ? 'index.html' : files[0].filename;

      const combinedContent = files
        .map((file) => {
          const header = commentDelimiters.end
            ? `${commentDelimiters.start} File: ${file.filename} ${commentDelimiters.end}`
            : `${commentDelimiters.start} File: ${file.filename}`;
          return `${header}\n${file.content}`;
        })
        .join('\n\n');

      // Map all old filenames to the primary one
      for (const file of files) {
        renameMap[file.filename] = primaryFilename;
      }

      consolidated.push({
        content: combinedContent,
        filename: primaryFilename,
        language: files[0].language,
      });
    }

    return { attachments: consolidated, renameMap };
  }

  /**
   * Keep text markers aligned with renamed/merged files
   */
  private static applyAttachmentRename(content: string, renameMap: Record<string, string>): string {
    if (!renameMap || Object.keys(renameMap).length === 0) {
      return content;
    }

    let updated = content;
    for (const [from, to] of Object.entries(renameMap)) {
      if (from === to) continue;
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\`${escaped}\``, 'g');
      updated = updated.replace(pattern, `\`${to}\``);
    }

    return updated;
  }

  /**
   * Provide language-appropriate section delimiters when merging files
   */
  private static getSectionDelimiter(extension: string): { start: string; end?: string } {
    const normalized = extension.toLowerCase();

    switch (normalized) {
      case 'py':
        return { start: '# ---' };
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
      case 'java':
      case 'cpp':
      case 'c':
      case 'rs':
      case 'go':
      case 'rb':
      case 'kt':
      case 'cs':
        return { start: '// ---' };
      case 'css':
      case 'scss':
      case 'sass':
        return { start: '/*', end: '*/' };
      case 'html':
        return { start: '<!--', end: '-->' };
      case 'yaml':
      case 'yml':
        return { start: '# ---' };
      default:
        return { start: '// ---' };
    }
  }

  /**
   * Detect if code looks like a complete program vs a tiny snippet
   */
  private static looksLikeCompleteCode(code: string, language: string): boolean {
    const normalized = code.toLowerCase();
    
    // HTML/XML documents are always complete
    if (/<!doctype|<html|<\?xml/.test(normalized)) {
      return true;
    }
    
    // Multiple function/class definitions = complete
    const functionCount = (code.match(/\b(function|def|func|fn|class|interface|struct)\s+\w+/g) || []).length;
    if (functionCount >= 2) {
      return true;
    }
    
    // Import/require statements = likely complete module
    if (/\b(import|require|from\s+['"]|use\s+|#include|package)/.test(normalized)) {
      return true;
    }
    
    // Main entry points = complete program
    if (/\b(if\s+__name__\s*==|public\s+static\s+void\s+main|func\s+main\s*\(|def\s+main\s*\()/.test(normalized)) {
      return true;
    }
    
    // Full event listeners or lifecycle hooks = complete
    if (/(addEventListener|document\.ready|componentDidMount|useEffect|ngOnInit)/.test(code)) {
      return true;
    }
    
    // Export statements = module file
    if (/\b(export\s+(default|const|function|class)|module\.exports)/.test(code)) {
      return true;
    }
    
    return false;
  }

  /**
   * Generate appropriate filename based on language and content
   */
  private static generateFilename(language: string, index: number, extension: string): string {
    // Single file defaults
    if (index === 1) {
      if (language === 'html' || extension === 'html') return 'index.html';
      if (language === 'javascript' || language === 'js') return 'script.js';
      if (language === 'typescript' || language === 'ts') return 'main.ts';
      if (language === 'python' || language === 'py') return 'main.py';
      if (language === 'css') return 'styles.css';
      if (language === 'json') return 'config.json';
    }
    
    // Multi-file fallback
    return `code-${index}.${extension}`;
  }

  /**
   * Detect language from code content when not specified
   */
  private static detectLanguage(code: string): string {
    if (/<\?php/.test(code)) return 'php';
    if (/<(!DOCTYPE|html|script|style)/.test(code)) return 'html';
    if (/\{[\s\S]*:[\s\S]*\}/.test(code) && /"\w+"\s*:/.test(code)) return 'json';
    if (/(const|let|var|function|=>|console\.)/.test(code)) return 'javascript';
    if (/(def\s+\w+|import\s+\w+|print\()/.test(code)) return 'python';
    if (/(package|func\s+\w+|import\s+")/.test(code)) return 'go';
    return 'txt';
  }

  /**
   * Get file extension for a language
   * NEVER returns .txt for structured code - always uses proper extension
   */
  private static getFileExtension(language: string, code?: string): string {
    const normalized = language.toLowerCase().trim();
    
    const extensions: Record<string, string> = {
      javascript: 'js',
      js: 'js',
      typescript: 'ts',
      ts: 'ts',
      python: 'py',
      py: 'py',
      java: 'java',
      cpp: 'cpp',
      'c++': 'cpp',
      c: 'c',
      csharp: 'cs',
      'c#': 'cs',
      cs: 'cs',
      go: 'go',
      golang: 'go',
      rust: 'rs',
      php: 'php',
      ruby: 'rb',
      rb: 'rb',
      swift: 'swift',
      kotlin: 'kt',
      kt: 'kt',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yml',
      sql: 'sql',
      sh: 'sh',
      bash: 'sh',
      shell: 'sh',
      markdown: 'md',
      md: 'md',
      jsx: 'jsx',
      tsx: 'tsx',
      vue: 'vue',
      svelte: 'svelte',
    };
    
    // Try language first
    if (extensions[normalized]) {
      return extensions[normalized];
    }
    
    // If no language specified but have code, detect from content
    if (code) {
      const detected = this.detectLanguage(code);
      if (detected !== 'txt' && extensions[detected]) {
        return extensions[detected];
      }
    }
    
    // Default: use language as-is if it looks like an extension, otherwise .txt
    if (normalized.length <= 5 && /^[a-z0-9]+$/.test(normalized)) {
      return normalized;
    }
    
    return 'txt';
  }

  /**
   * Split long text into multiple messages (for Discord length limits)
   * Returns array of message chunks
   */
  static splitLongText(text: string, maxLength: number = 1900): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    const paragraphs = text.split('\\n\\n');
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // If single paragraph exceeds limit, split by sentences
      if (paragraph.length > maxLength) {
        const sentences = paragraph.split(/(?<=[.!?])\\s+/);
        
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 2 > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
            // If single sentence exceeds limit, force split
            if (sentence.length > maxLength) {
              for (let i = 0; i < sentence.length; i += maxLength) {
                chunks.push(sentence.slice(i, i + maxLength));
              }
            } else {
              currentChunk = sentence;
            }
          } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          }
        }
      } else {
        // Normal paragraph
        if (currentChunk.length + paragraph.length + 2 > maxLength) {
          chunks.push(currentChunk.trim());
          currentChunk = paragraph;
        } else {
          currentChunk += (currentChunk ? '\\n\\n' : '') + paragraph;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Ensure final message chunks are valid before sending and add fallback text when needed
   */
  private static validateMessageChunks(chunks: string[], hasAttachments: boolean): string[] {
    const validated: string[] = [];

    for (const chunk of chunks) {
      if (chunk && chunk.trim().length > 0) {
        validated.push(chunk);
      }
    }

    if (validated.length === 0) {
      validated.push(hasAttachments ? '📎 Files attached below.' : 'Done! (no additional text response)');
    }

    return validated;
  }

  /**
   * Normalize model output before extraction so concatenated strings become real code blocks
   */
  private static normalizeModelOutput(content: string): string {
    if (!content) {
      return 'Done!';
    }

    let normalized = content.replace(/\r\n/g, '\n').trim();
    normalized = this.mergeConcatenatedLiterals(normalized);

    return normalized.length > 0 ? normalized : 'Done!';
  }

  /**
   * Detect string-literal concatenations ("foo" + "bar") that wrap code/HTML and collapse them
   */
  private static mergeConcatenatedLiterals(text: string): string {
    const concatRegex = /((["]|')(?:\\.|(?!\2)[\s\S])*?\2)(\s*\+\s*(["]|')(?:\\.|(?!\4)[\s\S])*?\4)+/g;

    return text.replace(concatRegex, (match) => {
      const literalRegex = /(["'])(?:\\.|(?!\1)[\s\S])*?\1/g;
      const collectedLiterals: string[] = [];
      let literalMatch: RegExpExecArray | null;

      while ((literalMatch = literalRegex.exec(match)) !== null) {
        collectedLiterals.push(literalMatch[0]);
      }

      if (collectedLiterals.length === 0) {
        return match;
      }

      const combined = collectedLiterals
        .map(lit => this.unescapeLiteral(lit.slice(1, -1)))
        .join('');

      const looksLikeCode = combined.includes('```') || /<!doctype/i.test(combined) || /<\/?html/i.test(combined);
      if (looksLikeCode) {
        return combined;
      }

      return match;
    });
  }

  /**
   * Convert escaped newline/tab sequences back to their literal characters
   */
  private static unescapeLiteral(segment: string): string {
    return segment
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\`/g, '`')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  /**
   * Build a short summary describing which files were attached
   */
  private static buildAttachmentSummary(attachments: Array<{ filename: string }>): string {
    if (!attachments || attachments.length === 0) {
      return '';
    }

    const names = attachments.map(file => file.filename).join(', ');
    return `📎 Attached files: ${names}`;
  }

  /**
   * Helper: Clean response content of any system artifacts
   */
  private static cleanResponseContent(content: string): string {
    if (!content || content.trim().length === 0) {
      return 'Done! (No additional text response)';
    }

    return content.trim();
  }

  /**
   * Helper: Truncate text with ellipsis
   */
  private static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }
}
