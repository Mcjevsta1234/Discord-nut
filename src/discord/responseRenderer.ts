/**
 * Response Renderer - Transparent and structured Discord response formatting
 * 
 * This module provides a consistent way to display AI responses with full transparency:
 * - Planning and reasoning steps are always visible
 * - Tool usage is explicitly shown (or explicitly stated as not needed)
 * - Model selection and routing decisions are documented
 * - System information is separated from conversational responses
 */

import { EmbedBuilder, Message as DiscordMessage, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PlannedAction, ActionPlan } from '../ai/planner';
import { ActionResult, ExecutionResult } from '../ai/actionExecutor';
import { AggregatedLLMMetadata, LLMResponseMetadata } from '../ai/llmMetadata';
import { RoutingDecision } from '../ai/modelTiers';

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
   */
  static buildSystemEmbed(metadata: ResponseMetadata): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple for system info
      .setTitle('🧠 System Information')
      .setTimestamp();

    // Build description with all sections
    const sections: string[] = [];

    // 1. PLAN SECTION
    sections.push('**📋 Plan**');
    if (metadata.plannedActions.length === 0) {
      sections.push('• Direct response (no actions needed)');
    } else {
      const planBullets = this.formatPlanBullets(metadata.plannedActions);
      sections.push(planBullets.join('\n'));
    }

    // 2. REASONING SECTION (if available)
    if (metadata.planReasoning && metadata.planReasoning !== 'Planned actions') {
      sections.push('\n**🤔 Reasoning**');
      sections.push(metadata.planReasoning.substring(0, 200));
    }

    // 3. TOOLS SECTION
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

    // 4. ROUTING & MODEL SECTION (Shows routing decisions)
    sections.push('\n**🎯 Routing & Model Selection**');
    
    if (metadata.routingDecision) {
      const rd = metadata.routingDecision;
      sections.push(`• Tier: \`${rd.tier}\``);
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

    // 5. TOKEN USAGE SECTION (NEW - ALWAYS SHOW)
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
        
        // Show cost if available
        if (llm.totalCost > 0) {
          sections.push(`• Estimated Cost: $${llm.totalCost.toFixed(4)}`);
        } else {
          sections.push(`• Cost: Free tier`);
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

    // 6. PERFORMANCE SECTION
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
    imageData?: { buffer: Buffer; prompt: string; resolution: { width: number; height: number } }
  ): RenderedResponse {
    // Build system embed with all transparency info
    const systemEmbed = this.buildSystemEmbed(metadata);

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
   * This handles both the system embed and the conversational response
   */
  static async sendToDiscord(
    message: DiscordMessage,
    rendered: RenderedResponse,
    workingMessage?: DiscordMessage
  ): Promise<DiscordMessage | null> {
    try {
      // Create response embed (Embed 2) for the actual conversational reply
      const responseEmbed = new EmbedBuilder()
        .setColor(0x00ff00) // Green for user-facing response
        .setTitle('💬 Response')
        .setDescription(this.truncate(rendered.responseContent, 1900))
        .setTimestamp();

      const embeds = [rendered.systemEmbed, responseEmbed];

      // If there's a working message, edit it
      if (workingMessage) {
        await workingMessage.edit({
          content: null,
          embeds,
          components: rendered.actionButtons ? [rendered.actionButtons] : [],
        });
        return workingMessage;
      } else {
        // Send new message
        return await message.reply({
          embeds,
          components: rendered.actionButtons ? [rendered.actionButtons] : [],
        });
      }
    } catch (error) {
      console.error('Error sending rendered response to Discord:', error);
      return null;
    }
  }

  /**
   * Create a "working" embed shown during processing
   */
  static createWorkingEmbed(userQuery: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0xffa500) // Orange for in-progress
      .setTitle('⏳ Processing...')
      .setDescription(`**Query:** ${this.truncate(userQuery, 200)}\n\n🤔 Planning response...`)
      .setTimestamp();
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
