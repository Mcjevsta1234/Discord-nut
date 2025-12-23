import { Message as DiscordMessage, Client, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { MemoryManager } from '../ai/memoryManager';
import { ContextService } from '../ai/contextService';
import { FileContextManager } from '../ai/fileContextManager';
import { PromptManager } from './promptManager';
import { Planner, ActionPlan } from '../ai/planner';
import { ActionExecutor } from '../ai/actionExecutor';
import { MCPToolResult } from '../mcp';
import { ResponseRenderer, ResponseMetadata, ProgressTracker } from './responseRenderer';
import { aggregateLLMMetadata, LLMResponseMetadata } from '../ai/llmMetadata';
import { RouterService } from '../ai/routerService';
import { RoutingDecision, ModelTier } from '../ai/modelTiers';
import { getTierConfig } from '../config/routing';
import { ChatLogger } from '../ai/chatLogger';
import { CodeImprover } from '../ai/codeImprover';
import { ProjectRouter, ProjectRoutingDecision } from '../ai/projectRouter';

interface MessageContext {
  userContent: string;
  personaId?: string;
  channelId: string;
  originalMessageId: string;
}

export class MessageHandler {
  private client: Client;
  private aiService: OpenRouterService;
  private memoryManager: MemoryManager;
  private fileContextManager: FileContextManager;
  private promptManager: PromptManager;
  private contextService: ContextService;
  private planner: Planner;
  private executor: ActionExecutor;
  private router: RouterService;
  private messageContexts: Map<string, MessageContext>;
  private chatLogger: ChatLogger;
  private codeImprover: CodeImprover;

  constructor(
    client: Client,
    aiService: OpenRouterService,
    memoryManager: MemoryManager,
    promptManager: PromptManager
  ) {
    this.client = client;
    this.aiService = aiService;
    this.memoryManager = memoryManager;
    this.fileContextManager = new FileContextManager();
    this.promptManager = promptManager;
    this.contextService = new ContextService();
    this.planner = new Planner(aiService);
    this.executor = new ActionExecutor(aiService);
    this.router = new RouterService(aiService);
    this.messageContexts = new Map();
    this.chatLogger = new ChatLogger();
    this.codeImprover = new CodeImprover(aiService);
  }

  async shouldRespond(message: DiscordMessage): Promise<boolean> {
    // Don't respond to bots
    if (message.author.bot) return false;

    // Don't respond to system messages
    if (message.system) return false;

    const botId = this.client.user?.id;

    // 1. Check if THIS bot is directly mentioned
    const isBotMentioned = message.mentions.has(botId || '');

    // 2. Check if THIS bot's message was replied to
    let isReplyToBot = false;
    if (message.reference?.messageId && message.type === 19) {
      try {
        // Fetch the referenced message to check if it's from the bot
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        isReplyToBot = referencedMessage.author.id === botId;
      } catch (error) {
        // If we can't fetch the message, assume it's not a reply to the bot
        isReplyToBot = false;
      }
    }

    // 3. Check for explicit persona mention (hey emma, emma, etc)
    const detectedPersona = this.promptManager.detectPersonaFromMessage(
      message.content
    );

    // Only respond if: bot mentioned OR replied to bot's message OR explicit persona mention
    return isBotMentioned || isReplyToBot || detectedPersona !== null;
  }

  async handleMessage(message: DiscordMessage): Promise<void> {
    if (!(await this.shouldRespond(message))) {
      return;
    }

    try {
      // Get channel context
      const channelId = message.channelId;
      const userId = message.author.id;
      const guildId = message.guildId || undefined;

      // Determine which persona to use
      let personaId: string | undefined;

      // 1. Check if user explicitly mentioned a persona name
      const detectedPersona = this.promptManager.detectPersonaFromMessage(
        message.content
      );
      if (detectedPersona) {
        personaId = detectedPersona;
        console.log(`🎭 Detected persona from message: ${personaId}`);
      }
      // 2. If replying to bot, continue with same persona
      else if (message.reference?.messageId) {
        const referencedPersona = this.promptManager.getMessagePersona(
          message.reference.messageId
        );
        if (referencedPersona) {
          personaId = referencedPersona;
          console.log(`🎭 Using persona from referenced message: ${personaId}`);
        }
      }
      // 3. Use channel default (handled in composeChatPrompt)
      
      if (!personaId) {
        console.log(`🎭 No persona detected, will use channel default`);
      }

      // LOAD CONTEXT: Load isolated conversation history from file storage
      // Guilds: guildId + channelId + userId, DMs: userId only
      // Load isolated context via ContextService (no business logic here)
      const fileContext = await this.contextService.load(userId, channelId, guildId);
      console.log(`📂 Loaded file context: ${fileContext.length} messages for user ${userId}`);

      // Build user message
      const userMessage: Message = {
        role: 'user',
        content: `${message.author.username}: ${message.content}`,
      };

      // Log the raw user message (plain text) - fire-and-forget, non-blocking
      setImmediate(() => {
        try {
          const guildName = message.guild?.name || null;
          const channelName = (message.channel as any).name || 'direct-message';
          this.chatLogger.logUserMessage(
            message.author.username,
            message.content,
            userId,
            guildName,
            channelName
          );
        } catch (err) {
          // Logging failures must never affect bot behavior
        }
      });

      // Add to memory (for in-session use)
      await this.memoryManager.addMessage(channelId, userMessage);

      // Get message history for context (in-memory)
      const conversation = this.memoryManager.getConversationContext(channelId);
      
      // Check if replying to a message - add referenced message context
      let referencedMessageContent = '';
      if (message.reference?.messageId) {
        try {
          const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
          referencedMessageContent = referencedMsg.content;
          // Add referenced message to conversation context for planner
          if (referencedMessageContent) {
            console.log(`🔗 Reply detected - adding context from referenced message`);
          }
        } catch (err) {
          console.log('Could not fetch referenced message for context');
        }
      }
      
      const composedPrompt = this.promptManager.composeChatPrompt(
        channelId,
        conversation,
        personaId
      );

      // Create progress tracker with animated spinner
      const workingEmbed = ResponseRenderer.createWorkingEmbed(message.content);
      const workingMessage = await message.reply({ embeds: [workingEmbed] });
      const progressTracker = ResponseRenderer.createProgressTracker(workingMessage, message.content);

      try {
        // ROUTING STEP: Determine which model tier to use
        await progressTracker.addUpdate({
          stage: 'planning',
          message: 'Analyzing request and routing...',
          timestamp: Date.now(),
        });
        
        console.log(`🎯 Routing message from ${message.author.username}...`);
        const routingDecision = await this.router.route(
          message.content,
          composedPrompt.messages,
          message.content.length
        );

        // PLANNER STEP: Decide what actions to take
        await progressTracker.addUpdate({
          stage: 'planning',
          message: 'Planning response strategy...',
          timestamp: Date.now(),
        });

        const planStartTime = Date.now();
        let plan: ActionPlan;
        // Combine current message with referenced message context for planning
        const messageWithContext = referencedMessageContent
          ? `[Previous message context: "${referencedMessageContent}"]

Current message: ${message.content}`
          : message.content;
        
        const plannerNeeded = routingDecision.tier === 'INSTANT'
          ? true
          : this.shouldUsePlanner(messageWithContext);
        
        if (routingDecision.tier === 'INSTANT') {
          // Synthetic planning for INSTANT tier (no LLM call)
          // Pass messageWithContext for context-aware detection (e.g., "generate that")
          plan = this.planner.createSyntheticPlanForInstant(messageWithContext);
          console.log(`Action plan: INSTANT tier (synthetic, no LLM call)`);
        } else if (!plannerNeeded) {
          plan = {
            actions: [{ type: 'chat' }],
            reasoning: 'Direct response (no tools required)',
            metadata: undefined,
            isFallback: false,
          };
          console.log('Action plan: direct response (planner skipped)');
        } else {
          // LLM-based planning for other tiers - pass context for better image detection
          plan = await this.planner.planActionsWithRetry(
            messageWithContext,
            fileContext,
            personaId
          );
          console.log(`📋 Action plan created: ${plan.actions.map(a => a.type === 'tool' ? `tool(${a.toolName})` : a.type).join(' → ')}`);
          console.log(`📊 Plan details:`, JSON.stringify(plan, null, 2));
        }

        const reportedActions = plan.isFallback ? [] : plan.actions;
        const reportedReasoning = plan.isFallback
          ? 'Planner unavailable - direct response'
          : plan.reasoning;

        // Show plan summary
        if (reportedActions.length > 0) {
          const actionSummary = reportedActions
            .map(a => {
              if (a.type === 'tool') return `${a.toolName}`;
              if (a.type === 'image') return 'image generation';
              return a.type;
            })
            .filter(Boolean)
            .join(', ');
          
          await progressTracker.addUpdate({
            stage: 'planning',
            message: 'Plan created',
            details: actionSummary,
            timestamp: Date.now(),
          });
        }

        // Create response metadata for transparency
        const metadata: ResponseMetadata = ResponseRenderer.createMetadata(
          reportedActions,
          reportedReasoning,
          routingDecision.modelId,
          personaId
        );

        metadata.routingDecision = routingDecision;
        const planningCallMetadata = plan.isFallback ? undefined : plan.metadata;

        const hasExecutableActions = !plan.isFallback && plan.actions.some(action => action.type !== 'chat');
        console.log(`🔍 Has executable actions: ${hasExecutableActions}, isFallback: ${plan.isFallback}, actions:`, plan.actions.map(a => a.type));
        let executionResult: any = { results: [], hasImage: false };
        let execDuration = 0;

        if (hasExecutableActions) {
          await progressTracker.addUpdate({
            stage: 'executing',
            message: `Executing ${plan.actions.length} action(s)...`,
            timestamp: Date.now(),
          });

          // EXECUTOR STEP: Execute all planned actions with progress callbacks
          const execStartTime = Date.now();
          executionResult = await this.executor.executeActions(
            plan.actions,
            async (update) => {
              // Report each action progressively
              const actionDesc = update.action.type === 'tool'
                ? update.action.toolName
                : update.action.type === 'image'
                ? 'Generating image'
                : update.action.type;
              
              if (update.status === 'starting') {
                await progressTracker.addUpdate({
                  stage: 'executing',
                  message: `Running: ${actionDesc}`,
                  stepNumber: update.actionIndex + 1,
                  totalSteps: update.totalActions,
                  timestamp: Date.now(),
                });
              } else if (update.status === 'completed') {
                await progressTracker.addUpdate({
                  stage: 'executing',
                  message: `Completed: ${actionDesc}`,
                  stepNumber: update.actionIndex + 1,
                  totalSteps: update.totalActions,
                  timestamp: Date.now(),
                });
              } else if (update.status === 'failed') {
                await progressTracker.addUpdate({
                  stage: 'executing',
                  message: `Failed: ${actionDesc}`,
                  details: update.result?.error,
                  timestamp: Date.now(),
                });
              }
            }
          );
          execDuration = Date.now() - execStartTime;
        } else {
          console.log('Skipping action execution (no tool/image actions to run)');
        }

        // Update metadata with execution results
        const updatedMetadata = ResponseRenderer.updateWithExecution(
          metadata,
          executionResult.results,
          execDuration
        );

        // Handle image response separately if generated
        if (executionResult.hasImage && executionResult.imageData) {
          updatedMetadata.llmMetadata = aggregateLLMMetadata(
            planningCallMetadata,
            [],
            undefined
          );
          
          if (message.guild && message.author.username) {
            const userId = message.author.id;
            const buffer = executionResult.imageData.buffer;
            const prompt = executionResult.imageData.prompt;
            const username = message.author.username;
            const guildName = message.guild.name;
            const channelName = (message.channel as any).name || 'unknown';
            setImmediate(() => {
              try {
                this.chatLogger.logImageGeneration(
                  buffer,
                  prompt,
                  username,
                  userId,
                  guildName,
                  channelName
                );
              } catch (err) {
                // Logging failures must never affect bot behavior
              }
            });
          }
          
          await progressTracker.complete();
          progressTracker.close();
          
          // Image generation removed - project router handles coding requests
          console.log('⚠️ Image generation has been removed. Use coding tier for all projects.');
          const response = 'Image generation has been removed. For coding projects, just describe what you want and I\'ll create it!';
          
          await progressTracker.getMessage()?.edit({
            content: response,
            embeds: [],
            components: []
          });
          return;
        }

        // Generate final response
        await progressTracker.addUpdate({
          stage: 'responding',
          message: 'Generating response...',
          timestamp: Date.now(),
        });

        let finalPrompt: Message[];
        if (routingDecision.tier === 'INSTANT') {
          const minimalComposed = this.promptManager.composeMinimalPromptForInstant(
            channelId,
            userMessage,
            personaId
          );
          const systemBase = minimalComposed.messages.filter(m => m.role === 'system');
          finalPrompt = [...systemBase, ...fileContext, userMessage];
          console.log(`💰 INSTANT tier: using minimal prompt with file context (${finalPrompt.length} messages)`);
        } else {
          const systemBase = composedPrompt.messages.filter(m => m.role === 'system');
          finalPrompt = [...systemBase, ...fileContext, userMessage];
        }

        // CENTRALIZED PROJECT ROUTING: Determine project type for coding requests
        let finalResponse: string;
        let responseCallMetadata: LLMResponseMetadata | undefined;
        
        if (routingDecision.tier === 'CODING' && !hasExecutableActions) {
          console.log('🧪 CODING tier detected - routing to project handler');
          
          // STEP 1: Route to project type (rule-based, deterministic)
          const projectDecision = ProjectRouter.route(message.content);
          console.log('📦 Project Type:', projectDecision.projectType);
          console.log('📦 Preview Allowed:', projectDecision.previewAllowed);
          console.log('📦 Requires Build:', projectDecision.requiresBuild);
          console.log('📦 Matched Keywords:', projectDecision.matchedKeywords.join(', '));
          
          // STEP 2: TODO - Prompt Improver (will be added later)
          // Takes user message + project context → detailed coding prompt
          
          // STEP 3: TODO - Project Planner (will be added later)
          // Creates file structure, dependencies, configuration
          
          // STEP 4: TODO - Code Generator (will be added later)
          // Generates actual code files based on plan
          
          // STEP 5: TODO - Deployer (will be added later)
          // For static_html and node_project with previewAllowed=true
          
          // TEMPORARY: Use existing code generation until new pipeline is built
          await progressTracker.addUpdate({
            stage: 'responding',
            message: 'Generating production-ready code...',
            timestamp: Date.now(),
          });
          
          // Extract ONLY user messages - NO persona/system prompts for coder
          const userOnlyContext = conversation.recentMessages.filter((m: Message) => m.role === 'user');
          
          const codeResult = await this.codeImprover.improveCode(
            message.content,
            userOnlyContext,
            routingDecision.modelId
          );
          
          // Check for multi-file rejection
          if (!codeResult.finalCode && codeResult.explanation.includes('multiple files')) {
            finalResponse = codeResult.explanation;
          } else {
            // Generate persona wrapper message AFTER code generation
            console.log('👤 Generating persona wrapper message...');
            const smartModel = getTierConfig(ModelTier.SMART).modelId;
            const wrapperMessage = await this.generateCodeWrapperMessage(
              personaId || 'emma', // Fallback to emma if undefined
              message.content,
              smartModel // Use SMART tier model for wrapper
            );
            
            // Structure: [Persona Message] + [Code]
            finalResponse = wrapperMessage;
            
            // Add code with filename if provided
            if (codeResult.explanation && codeResult.explanation.includes('Generated file:')) {
              finalResponse = `${wrapperMessage}\n\n${codeResult.explanation}\n\n${codeResult.finalCode}`;
            } else {
              finalResponse = `${wrapperMessage}\n\n${codeResult.finalCode}`;
            }
          }
          
          // Use the single-call metadata as the response metadata
          responseCallMetadata = codeResult.metadata;
          
          console.log('✅ Project routing complete (using legacy generator temporarily)');
        } else {
          // Non-CODING tiers: Use standard response generation
          const responseResult = await this.generateFinalResponseWithMetadata(
            message.content,
            executionResult,
            finalPrompt,
            routingDecision.modelId,
            routingDecision.tier,
            personaId
          );

          finalResponse = responseResult.content;
          responseCallMetadata = responseResult.metadata;
        }

        // GUARDRAIL: Check if INSTANT tier response is low-confidence or malformed
        if (routingDecision.tier === 'INSTANT' && this.isLowQualityResponse(finalResponse)) {
          console.log('⚠️ INSTANT response appears low-quality, retrying with SMART tier...');
          
          await progressTracker.addUpdate({
            stage: 'responding',
            message: 'Retrying with higher quality model...',
            timestamp: Date.now(),
          });
          
          const higherTier = this.router.getHigherTier(routingDecision.tier);
          const retryDecision = this.router.createManualDecision(higherTier, 'INSTANT tier retry due to low confidence');
          
          const retryResult = await this.generateFinalResponseWithMetadata(
            message.content,
            executionResult,
            composedPrompt.messages,
            retryDecision.modelId,
            retryDecision.tier,
            personaId
          );
          
          finalResponse = retryResult.content;
          responseCallMetadata = retryResult.metadata;
          
          updatedMetadata.routingDecision = {
            ...retryDecision,
            routingReason: `${routingDecision.routingReason} → Retried with ${higherTier} (low quality detected)`,
          };
          
          console.log(`✅ Retry successful with ${higherTier} tier`);
        }

        // Complete progress tracking
        await progressTracker.complete();
        progressTracker.close();

        // Add assistant response to memory
        if (finalResponse && !finalResponse.includes('encountered an error')) {
          await this.memoryManager.addMessage(channelId, {
            role: 'assistant',
            content: finalResponse,
          });
        }

        // Aggregate all LLM metadata, including tool execution times
        updatedMetadata.llmMetadata = aggregateLLMMetadata(
          planningCallMetadata,
          [],
          responseCallMetadata,
          executionResult.toolExecutions
        );

        // Render and send complete response
        const rendered = ResponseRenderer.render(
          updatedMetadata,
          finalResponse,
          message.guildId || undefined,
          channelId
        );
        const sentMessage = await ResponseRenderer.sendToDiscord(
          message,
          rendered,
          progressTracker.getMessage()
        );

        // PERSIST CONTEXT
        if (sentMessage && finalResponse && !finalResponse.includes('encountered an error')) {
          try {
            const cleanResponse: Message = {
              role: 'assistant',
              content: finalResponse,
            };
            await this.contextService.appendUserAndAssistant(userId, userMessage, cleanResponse, channelId, guildId);
            console.log(`✓ Persisted context: user + response for user ${userId}`);
            
            setImmediate(() => {
              try {
                const guildName = message.guild?.name || null;
                const channelName = (message.channel as any).name || 'direct-message';
                this.chatLogger.logBotReply(
                  finalResponse,
                  message.author.username,
                  userId,
                  guildName,
                  channelName
                );
              } catch (err) {
                // Logging failures must never affect bot behavior
              }
            });
          } catch (error) {
            console.error('Failed to persist context to file:', error);
          }
        }

        // Track context for button interactions (always store context)
        if (sentMessage) {
          if (personaId) {
            this.promptManager.trackMessagePersona(sentMessage.id, personaId);
          }
          this.messageContexts.set(sentMessage.id, {
            userContent: message.content,
            personaId: personaId || undefined,
            channelId,
            originalMessageId: message.id,
          });
        }

        console.log(
          `Responded to ${message.author.username} in ${message.guild?.name || 'DM'}${
            personaId ? ` (persona: ${personaId})` : ''
          } with ${reportedActions.length} action(s)`
        );
      } catch (innerError) {
        // Handle errors with progress tracker
        console.error('Error during processing:', innerError);
        const errorMsg = innerError instanceof Error ? innerError.message : 'Unknown error occurred';
        await progressTracker.error('Processing failed', errorMsg);
        
        // Give user time to see the error
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        throw innerError; // Re-throw to be caught by outer catch
      }
    } catch (error) {
      console.error('Error handling message:', error);
      await message.reply(
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    }
  }

  /**
   * Generate a short persona wrapper message for code responses
   * Light personality, warmth, confidence - NO self-doubt or refusal language
   */
  private async generateCodeWrapperMessage(
    personaId: string,
    userRequest: string,
    model: string
  ): Promise<string> {
    const persona = this.promptManager.getPersona(personaId);
    if (!persona) {
      return 'Here\'s your code!';
    }

    const wrapperPrompt: Message[] = [
      {
        role: 'system',
        content: `You just generated production-ready code for the user. Write a SHORT (1-3 sentences) friendly message to accompany it.

Rules:
- Light personality, warm, confident
- NO self-doubt ("coding isn't my thing", "hope this works")
- NO refusal language
- Max 1 emoji if used
- Keep it concise and natural
- Reference what you built

Persona: ${persona.displayName}
Style: ${persona.personalityPrompt.substring(0, 200)}`,
      },
      {
        role: 'user',
        content: `User asked: "${userRequest.substring(0, 150)}"

You generated the code. Write a short, friendly message (1-3 sentences).`,
      },
    ];

    try {
      const response = await this.aiService.chatCompletionWithMetadata(wrapperPrompt, model, {
        temperature: 0.8,
        max_tokens: 100,
      });
      return response.content.trim();
    } catch (error) {
      console.warn('⚠️ Failed to generate wrapper message, using fallback');
      return 'Here\'s your production-ready code! Download the file below.';
    }
  }

  /**
   * Check if response is low quality and needs retry
   * Used for INSTANT tier guardrails
   */
  private isLowQualityResponse(response: string): boolean {
    if (!response || response.trim().length === 0) {
      return true;
    }
    
    // Check for very short responses that might be incomplete
    if (response.trim().length < 10) {
      return true;
    }
    
    // Check for common error patterns
    const errorPatterns = [
      /^(error|failed|unable to)/i,
      /^sorry,? (i|but)/i,
      /could not (complete|process|understand)/i,
      /\[object Object\]/i,
      /undefined/i,
      /null/i,
    ];
    
    if (errorPatterns.some(pattern => pattern.test(response))) {
      return true;
    }
    
    // Check for malformed JSON or gibberish
    if (response.startsWith('{') && !response.includes(':')) {
      return true;
    }
    
    return false;
  }

  /**
   * Add concise output guidance to messages (for non-INSTANT tiers)
   * Reduces completion tokens without increasing prompt tokens significantly
   */
  private addConciseGuidance(messages: Message[]): Message[] {
    const guidanceMessage: Message = {
      role: 'system',
      content: 'Be concise. No large code blocks inline. Summarize attached files. Complete answers only.'
    };
    
    // Insert guidance before the last user message
    const result = [...messages];
    const lastUserIndex = result.map(m => m.role).lastIndexOf('user');
    
    if (lastUserIndex > 0) {
      result.splice(lastUserIndex, 0, guidanceMessage);
    } else {
      result.push(guidanceMessage);
    }
    
    return result;
  }

  /**
   * Add coding-specific guidance to ensure single-file HTML generation with mobile compatibility
   */
  private addCodingGuidance(messages: Message[]): Message[] {
    const guidanceMessage: Message = {
      role: 'system',
      content: 'HTML/CSS/JS: Single file with inline <style> in <head>, <script> before </body>. Mobile: viewport meta, responsive (flex/grid), relative units, media queries. Brief explanations.'
    };
    
    // Insert guidance before the last user message
    const result = [...messages];
    const lastUserIndex = result.map(m => m.role).lastIndexOf('user');
    
    if (lastUserIndex > 0) {
      result.splice(lastUserIndex, 0, guidanceMessage);
    } else {
      result.push(guidanceMessage);
    }
    
    return result;
  }

  /**
   * Determine whether the planner should run based on the user's request
   * Only trigger planner when tools, searches, or structured actions are needed
   */
  private shouldUsePlanner(userContent: string): boolean {
    const normalized = userContent.toLowerCase();

    const toolKeywords = [
      'search',
      'look up',
      'lookup',
      'fetch',
      'scrape',
      'crawl',
      'web result',
      'web results',
      'news',
      'latest news',
      'current events',
      'trending',
      'update the status',
      'github',
      'repository',
      'repo',
      'readme',
      'issue #',
      'pull request',
      'http://',
      'https://',
      'www.',
      'url',
      'link please',
      'image',
      'picture',
      'photo',
      'generate',
      'create',
      'draw',
      'make an',
      'show me a',
      'paint',
      'sketch',
      'render',
      'visualize',
      'visualise',
      'illustration',
      'artwork',
      'minecraft',
      'mc network',
      'mc server',
      'server status',
      'server up',
      'server down',
      'servers online',
      'servers offline',
      'are the servers',
      'how are the servers',
      'server ip',
      'server ips',
      'minecraft servers',
      'network status',
      'witchyworlds',
    ];

    if (toolKeywords.some(keyword => normalized.includes(keyword))) {
      return true;
    }

    if (/(https?:\/\/|www\.)/.test(userContent)) {
      return true;
    }

    const needsGithubTool = /(github\.com|repo\s|repository\s|pull request|issue\s#)/i.test(userContent);
    if (needsGithubTool) {
      return true;
    }

    const mathPattern = /\d+\s*[\+\-\*\/]\s*\d+/;
    if (mathPattern.test(userContent) || /(calculate|calculation|sum|difference|multiply|divide|average|percent|percentage)/.test(normalized)) {
      return true;
    }

    if (/(convert|conversion|converter|currency|exchange rate|usd|eur|gbp|celsius|fahrenheit|kelvin|miles|kilometers|km|mi)/.test(normalized)) {
      return true;
    }

    if (/(what time|current time|what's the time|time is it|time zone|timezone|utc offset|tell me the time|show me the time)/.test(normalized)) {
      return true;
    }

    if (/(generate|create|draw|render).*(image|logo|icon|picture|art|banner|scene)/.test(normalized)) {
      return true;
    }

    if (/(latest|current|today|recent)\s+(price|prices|status|release|version|weather|forecast|numbers?)/.test(normalized)) {
      return true;
    }

    return false;
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
        // Image generation removed
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

      // Create buttons (image button removed)
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(redoButton);

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
    model: string,
    tier?: string,
    personaId?: string
  ): Promise<{ content: string; metadata?: LLMResponseMetadata }> {
    try {
      // Check if there are any tool results to summarize
      const hasToolResults = executionResult.results.some(
        (r: any) => r.success && r.content && r.content.length > 0
      );

      if (!hasToolResults) {
        // No tool results, just do normal chat WITH METADATA
        // Add tier-specific guidance
        let messagesWithGuidance = conversationMessages;
        if (tier === 'CODING') {
          messagesWithGuidance = this.addCodingGuidance(conversationMessages);
        } else if (tier && tier !== 'INSTANT') {
          messagesWithGuidance = this.addConciseGuidance(conversationMessages);
        }
        const response = await this.aiService.chatCompletionWithMetadata(messagesWithGuidance, model);
        return { content: response.content, metadata: response.metadata };
      }

      // Build context from tool results
      const toolContext = executionResult.results
        .filter((r: any) => r.success && r.content)
        .map((r: any, i: number) => `Result ${i + 1}:\n${r.content}`)
        .join('\n\n');

      // Get persona details for personality-driven responses
      const persona = personaId ? this.promptManager.getPersona(personaId) : null;
      const personaName = persona?.displayName || 'Assistant';
      
      // Create persona-specific instructions based on character
      let personalityGuidance = '';
      if (personaId === 'emma') {
        personalityGuidance = `Remember: You're EMMA - bubbly, witty, flirty 18-year-old college student. 
- Use emojis naturally (😏, ✨, 💅, 👀)
- Be playful and sassy in your response
- Use casual language and modern slang
- Show excitement and personality!
- Example tone: "Omg it's <t:1766430477:f> already! Time flies when you're having fun 😏✨"`;
      } else if (personaId === 'steve') {
        personalityGuidance = `Remember: You're STEVE - 24-year-old Minecraft expert, laid-back and helpful.
- Keep it chill and friendly
- Use gaming/tech language naturally
- Be enthusiastic about Minecraft stuff
- Example tone: "Hey! Checked the servers for you - looking good! 🎮"`;
      } else if (personaId === 'wiz') {
        personalityGuidance = `Remember: You're WIZ - 27-year-old developer, professional but friendly.
- Technical and precise but approachable
- Use developer terminology appropriately
- Be helpful and clear
- Example tone: "Here's the data: <timestamp>. Let me know if you need anything else!"`;
      } else {
        personalityGuidance = `Stay true to your persona's personality and speaking style.`;
      }

      // Create response prompt with tool context - PERSONALITY-DRIVEN
      const responsePrompt: Message[] = [
        ...conversationMessages,
        {
          role: 'assistant',
          content: `I executed the requested actions. Here are the results:\n\n${toolContext}`,
        },
        {
          role: 'user',
          content: `User: "${userQuery}"

PERSONALITY (CRITICAL):
${personalityGuidance}

RULES:
- Discord timestamps (<t:X:f>) MUST be EXACT
- BE IN CHARACTER - show personality
- Conversational, NEVER raw output

${tier === 'INSTANT' ? 'Keep timestamps EXACT!' : ''}

Respond IN CHARACTER:`,
        },
      ];

      // Add tier-specific guidance
      let guidedPrompt = responsePrompt;
      if (tier === 'CODING') {
        guidedPrompt = this.addCodingGuidance(responsePrompt);
      } else if (tier && tier !== 'INSTANT') {
        guidedPrompt = this.addConciseGuidance(responsePrompt);
      }
      // Note: INSTANT tier reminder is now inline in the user message above to avoid message ordering issues
      
      console.log(`📝 Calling LLM for final response with ${guidedPrompt.length} messages, model: ${model}, tier: ${tier}`);
      const response = await this.aiService.chatCompletionWithMetadata(guidedPrompt, model);
      console.log(`✅ LLM response received, length: ${response.content?.length || 0}`);

      // Ensure valid response
      if (!response.content || response.content.trim().length === 0) {
        console.warn('⚠️ Empty response from AI after tool execution, generating fallback');
        // Generate a basic conversational fallback with tool results
        const fallbackMessage = this.generateToolResultFallback(userQuery, toolContext);
        return {
          content: fallbackMessage,
          metadata: response.metadata,
        };
      }

      return { content: response.content, metadata: response.metadata };
    } catch (error) {
      console.error('❌ Error generating final response:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      
      // CRITICAL: Don't lose tool results even if LLM fails
      const toolResults = executionResult.results
        .filter((r: any) => r.success && r.content)
        .map((r: any) => r.content)
        .join('\n\n');

      if (toolResults) {
        console.log('LLM failed but tool succeeded - generating local fallback');
        const fallbackMessage = this.generateToolResultFallback(userQuery, toolResults);
        return { content: fallbackMessage, metadata: undefined };
      }

      return {
        content: 'I processed your request but encountered an error generating a response.',
        metadata: undefined,
      };
    }
  }

  /**
   * Generate a simple fallback response when LLM fails after successful tool execution
   * Preserves Discord timestamps and wraps tool output minimally
   */
  private generateToolResultFallback(userQuery: string, toolOutput: string): string {
    const lowerQuery = userQuery.toLowerCase();
    
    // Time queries
    if (lowerQuery.includes('time') || lowerQuery.includes('clock')) {
      return `Here's the time: ${toolOutput} ⏰`;
    }
    
    // Minecraft/server queries
    if (lowerQuery.includes('minecraft') || lowerQuery.includes('server') || lowerQuery.includes('mc')) {
      return `Server status:\n\n${toolOutput}`;
    }
    
    // Math/calculation
    if (lowerQuery.includes('calculate') || lowerQuery.includes('math') || /\d+[\+\-\*\/]\d+/.test(lowerQuery)) {
      return `Here's the result: ${toolOutput}`;
    }
    
    // Generic fallback
    return `Here's what I found:\n\n${toolOutput}`;
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
          content: `Response to: "${userQuery}"

Be natural & conversational.`,
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

  // Deprecated image methods removed - use ProjectRouter for all coding requests

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

      // Create buttons (image button removed)
      const redoButton = new ButtonBuilder()
        .setCustomId('redo_response')
        .setLabel('🔄 Regenerate')
        .setStyle(ButtonStyle.Secondary);

      const imageButton = new ButtonBuilder()
        .setCustomId('generate_image')
        .setLabel('🎨 Generate Image')
        .setStyle(ButtonStyle.Primary);

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

        // Handle image separately (image generation removed)
        if (executionResult.hasImage && executionResult.imageData) {
          await interaction.message.edit({
            content: 'Image generation has been removed. For coding projects, just describe what you want and I\'ll create it!',
            embeds: [],
            components: [],
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
          routingDecision.modelId, // Use routed model
          routingDecision.tier // Pass tier for concise guidance
        );

        const finalResponse = responseResult.content;

        // Aggregate LLM metadata
        updatedMetadata.llmMetadata = aggregateLLMMetadata(
          metadata.plannerModel ? plan.metadata : undefined,
          [],
          responseResult.metadata
        );

        // Render and send with full transparency
        const rendered = ResponseRenderer.render(
          updatedMetadata,
          finalResponse,
          interaction.guildId || undefined,
          interaction.channelId
        );

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
        // Image generation removed
        await interaction.reply({
          content: 'Image generation has been removed. For coding projects, just describe what you want and I\'ll create it!',
          ephemeral: true,
        });
        return;
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
