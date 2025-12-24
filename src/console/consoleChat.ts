import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { OpenRouterService, Message } from '../ai/openRouterService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from '../discord/promptManager';
import { RouterService } from '../ai/routerService';
import { Planner } from '../ai/planner';
import { ActionExecutor } from '../ai/actionExecutor';
import { MCPClient, registerDefaultTools } from '../mcp';
import { ChatLogger } from '../ai/chatLogger';
import { ProjectRouter } from '../ai/projectRouter';
import { createJob, setJobOutputToLogsDir, updateJobStatus, ensureJobDirs, writeJobLog, markStageStart, markStageEnd, runDirectCachedCodegen } from '../jobs';
import { getCodegenModel } from '../jobs/directCachedCoder';

export class ConsoleChat {
  private aiService: OpenRouterService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;
  private router: RouterService;
  private planner: Planner;
  private executor: ActionExecutor;
  private chatLogger: ChatLogger;
  private rl: readline.Interface;
  private channelId: string = 'console-debug';
  private userId: string = 'console-user';
  private username: string = 'ConsoleUser';
  private currentPersona?: string;

  constructor() {
    // Initialize MCP client and register default tools
    const mcpClient = new MCPClient();
    registerDefaultTools(mcpClient);

    // Initialize AI services with MCP support
    this.aiService = new OpenRouterService(mcpClient);
    this.memoryManager = new MemoryManager(this.aiService);
    this.promptManager = new PromptManager();
    this.router = new RouterService(this.aiService);
    this.planner = new Planner(this.aiService);
    this.executor = new ActionExecutor(this.aiService);
    this.chatLogger = new ChatLogger();

    // Set up readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });
  }

  async start(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║          🤖 Discord Bot - Console Chat Mode 🤖               ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    console.log('📝 Type your messages to chat with the bot');
    console.log('🎭 Use persona names (emma, alex, max) to switch personas');
    console.log('💡 Commands:');
    console.log('   /personas - List available personas');
    console.log('   /persona <name> - Set active persona');
    console.log('   /clear - Clear conversation history');
    console.log('   /help - Show this help message');
    console.log('   /exit or /quit - Exit console chat\n');

    this.showPrompt();

    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      
      if (!trimmed) {
        this.showPrompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed);
        this.showPrompt();
        return;
      }

      // Handle regular chat
      await this.handleChat(trimmed);
      this.showPrompt();
    });

    this.rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      process.exit(0);
    });
  }

  private showPrompt(): void {
    const personaIndicator = this.currentPersona ? `[${this.currentPersona}]` : '';
    process.stdout.write(`\n${personaIndicator}> `);
  }

  private async handleCommand(command: string): Promise<void> {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/help':
        console.log('\n💡 Available Commands:');
        console.log('   /personas - List available personas');
        console.log('   /persona <name> - Set active persona');
        console.log('   /clear - Clear conversation history');
        console.log('   /help - Show this help message');
        console.log('   /exit or /quit - Exit console chat');
        break;

      case '/personas':
        const personaIds = ['emma', 'alex', 'max']; // Get from personas config
        console.log('\n🎭 Available Personas:');
        personaIds.forEach((id) => {
          const persona = this.promptManager.getPersona(id);
          if (persona) {
            const isCurrent = id === this.currentPersona;
            console.log(`   ${isCurrent ? '✓' : ' '} ${id} - ${persona.displayName}`);
          }
        });
        break;

      case '/persona':
        if (args.length === 0) {
          console.log('❌ Usage: /persona <name>');
          console.log('   Available personas: emma, alex, max');
        } else {
          const personaId = args[0].toLowerCase();
          const persona = this.promptManager.getPersona(personaId);
          if (persona) {
            this.currentPersona = personaId;
            console.log(`✅ Switched to persona: ${persona.displayName} (${personaId})`);
          } else {
            console.log(`❌ Unknown persona: ${personaId}`);
            console.log('   Available personas: emma, alex, max');
          }
        }
        break;

      case '/clear':
        // Clear memory by setting a new empty context
        const memory = this.memoryManager.getMemory(this.channelId);
        memory.recentMessages = [];
        memory.summaryData = undefined;
        console.log('✅ Conversation history cleared');
        break;

      case '/exit':
      case '/quit':
        this.rl.close();
        break;

      default:
        console.log(`❌ Unknown command: ${cmd}`);
        console.log('   Type /help for available commands');
    }
  }

  private async handleChat(userInput: string): Promise<void> {
    try {
      // Detect persona from message if not explicitly set
      let personaId = this.currentPersona;
      const detectedPersona = this.promptManager.detectPersonaFromMessage(userInput);
      if (detectedPersona) {
        personaId = detectedPersona;
        console.log(`🎭 Detected persona: ${personaId}`);
      }

      // Build user message
      const userMessage: Message = {
        role: 'user',
        content: `${this.username}: ${userInput}`,
      };

      // Log the user message
      setImmediate(() => {
        try {
          this.chatLogger.logUserMessage(
            this.username,
            userInput,
            this.userId,
            null, // no guild in console mode
            'console-debug'
          );
        } catch (err) {
          // Logging failures must never affect bot behavior
        }
      });

      // Add to memory
      await this.memoryManager.addMessage(this.channelId, userMessage);

      // Get conversation context
      const memory = this.memoryManager.getMemory(this.channelId);
      const conversation = memory.recentMessages;

      // Compose prompt with persona
      const composedPrompt = this.promptManager.composeChatPrompt(
        this.channelId,
        memory,
        personaId
      );

      console.log('\n🤔 Thinking...');

      // Route the request
      const routingDecision = await this.router.route(
        userInput,
        conversation,
        undefined
      );

      console.log(`🎯 Using model: ${routingDecision.modelId} (${routingDecision.tier} tier)`);
      if (routingDecision.routingReason) {
        console.log(`💭 Reason: ${routingDecision.routingReason}`);
      }

      // Handle CODING tier with full project generation pipeline
      if (routingDecision.tier === 'CODING') {
        console.log('\n🧪 CODING tier detected - routing to project handler');
        await this.handleCodeGeneration(userInput);
        return;
      }

      // Create action plan based on tier
      let plan;
      if (routingDecision.tier === 'INSTANT') {
        // Use synthetic planning for INSTANT tier (no LLM call)
        plan = this.planner.createSyntheticPlanForInstant(userInput);
      } else {
        // Use LLM-based planning for higher tiers
        const systemContent = (typeof composedPrompt.messages[0].content === 'string' 
          ? composedPrompt.messages[0].content 
          : JSON.stringify(composedPrompt.messages[0].content)) as string;
        plan = await this.planner.planActionsWithRetry(
          systemContent, // system prompt
          conversation,
          routingDecision.modelId
        );
      }

      if (plan && plan.actions.length > 0) {
        console.log(`\n📋 Action Plan: ${plan.actions.length} action(s)`);
        plan.actions.forEach((action, idx) => {
          const toolName = action.toolName || action.type;
          const reasoning = action.reasoning || 'No reasoning provided';
          console.log(`   ${idx + 1}. ${toolName}: ${reasoning}`);
        });

        // Execute actions if they're not just chat
        const nonChatActions = plan.actions.filter(a => a.type !== 'chat');
        if (nonChatActions.length > 0) {
          console.log('\n⚙️ Executing actions...');
          const executionResult = await this.executor.executeActions(
            nonChatActions,
            async (update) => {
              if (update.status === 'starting') {
                console.log(`   ⏳ Starting: ${update.action.toolName || update.action.type}`);
              } else if (update.status === 'completed') {
                console.log(`   ✓ Completed: ${update.action.toolName || update.action.type}`);
              } else if (update.status === 'failed') {
                console.log(`   ✗ Failed: ${update.action.toolName || update.action.type}`);
              }
            }
          );
          
          // Show summary
          const successCount = executionResult.results.filter(r => r.success).length;
          console.log(`\n   Summary: ${successCount}/${executionResult.results.length} actions succeeded`);
          
          // Add tool results to conversation messages
          const hasToolResults = executionResult.results.some(
            (r: any) => r.success && r.content && r.content.length > 0
          );
          
          if (hasToolResults) {
            // Build context from tool results
            const toolContext = executionResult.results
              .filter((r: any) => r.success && r.content)
              .map((r: any, i: number) => `Result ${i + 1}:\n${r.content}`)
              .join('\n\n');
            
            // Add tool results to the messages
            composedPrompt.messages.push({
              role: 'assistant',
              content: `I executed the requested actions. Here are the results:\n\n${toolContext}`,
            });
            
            // Get persona name for instructions
            const persona = personaId ? this.promptManager.getPersona(personaId) : null;
            const personaName = persona?.displayName || 'Assistant';
            
            composedPrompt.messages.push({
              role: 'user',
              content: `The user asked: "${userInput}"\n\nPlease provide a natural, conversational response as ${personaName} using the tool results above. Be in character and make it friendly!`,
            });
          }
        }
      }

      // Generate response with routing
      console.log('\n💬 Generating response...\n');
      
      const response = await this.aiService.chatCompletion(
        composedPrompt.messages,
        routingDecision.modelId
      );

      // Extract text content from response
      const responseText = response;

      // Display response
      const personaName = personaId 
        ? this.promptManager.getPersona(personaId)?.displayName || 'Bot'
        : 'Bot';
      
      console.log(`┌─ ${personaName} ─────────────────────────────────────────────────────────`);
      console.log(this.wrapText(responseText, 60));
      console.log('└──────────────────────────────────────────────────────────────────');

      // Add assistant response to memory
      const assistantMessage: Message = {
        role: 'assistant',
        content: responseText,
      };
      await this.memoryManager.addMessage(this.channelId, assistantMessage);

      // Log assistant message
      setImmediate(() => {
        try {
          this.chatLogger.logBotReply(
            responseText,
            this.username,
            this.userId,
            null, // no guild
            'console-debug'
          );
        } catch (err) {
          // Logging failures must never affect bot behavior
        }
      });

    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    }
  }

  private async handleCodeGeneration(userInput: string): Promise<void> {
    try {
      // STEP 1: Route to project type (rule-based, deterministic)
      const projectDecision = ProjectRouter.route(userInput);
      console.log('📦 Project Type:', projectDecision.projectType);
      console.log('📦 Preview Allowed:', projectDecision.previewAllowed);
      console.log('📦 Requires Build:', projectDecision.requiresBuild);
      console.log('📦 Matched Keywords:', projectDecision.matchedKeywords.join(', '));
      
      // STEP 2: Create Job for lifecycle tracking
      const job = createJob(projectDecision, {
        userMessage: userInput,
        userId: this.userId,
        guildId: undefined,
        channelId: this.channelId,
      });
      console.log(`\n📋 Job created: ${job.jobId}`);
      
      // Update output directory to use logs structure for console
      setJobOutputToLogsDir(job, 'consoleuser', null, 'console');
      
      // Create job directories and initialize logging
      ensureJobDirs(job);
      writeJobLog(job, `Coding request from console user`);
      writeJobLog(job, `Message: "${userInput}"`);
      writeJobLog(job, `Project type: ${job.projectType}`);
      writeJobLog(job, `Router decision: ${JSON.stringify(projectDecision)}`);
      
      // Direct code generation
      console.log('\n💻 Generating code with direct cached prompts...');
      markStageStart(job, 'codegen_direct');
      try {
        const codingModel = getCodegenModel();
        const codegenMetadata = await runDirectCachedCodegen(job, this.aiService, codingModel);
        updateJobStatus(job, 'generated');
        markStageEnd(job, 'codegen_direct');
        
        console.log(`✅ Code generated: ${job.codegenResult?.files.length} files`);
        if (job.codegenResult?.notes) {
          console.log(`   Notes: ${job.codegenResult.notes}`);
        }
        
        // Display output location
        const outputDir = path.join(process.cwd(), 'generated', job.jobId);
        if (fs.existsSync(outputDir)) {
          console.log(`\n📁 Generated files saved to: ./generated/${job.jobId}/`);
          const files = fs.readdirSync(outputDir);
          console.log(`   Files: ${files.join(', ')}`);
          
          // Log code generation to logs folder
          setImmediate(() => {
            this.chatLogger.logCodeGeneration(
              userInput,
              job.jobId,
              job.projectType,
              `./generated/${job.jobId}/`,
              files,
              this.username,
              this.userId,
              null, // guildName (null for console)
              this.channelId
            );
          });
        }
      } catch (error) {
        writeJobLog(job, `Code generator failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        updateJobStatus(job, 'failed');
        markStageEnd(job, 'codegen');
        throw error;
      }
      
      console.log('\n✨ Code generation complete!');
    } catch (error) {
      console.error('\n❌ Code generation failed:', error instanceof Error ? error.message : String(error));
    }
  }

  private wrapText(text: string, width: number): string {
    const lines = text.split('\n');
    const wrapped: string[] = [];

    for (const line of lines) {
      if (line.length <= width) {
        wrapped.push(line);
      } else {
        let remaining = line;
        while (remaining.length > width) {
          const breakPoint = remaining.lastIndexOf(' ', width);
          if (breakPoint === -1) {
            wrapped.push(remaining.substring(0, width));
            remaining = remaining.substring(width);
          } else {
            wrapped.push(remaining.substring(0, breakPoint));
            remaining = remaining.substring(breakPoint + 1);
          }
        }
        if (remaining.length > 0) {
          wrapped.push(remaining);
        }
      }
    }

    return wrapped.join('\n');
  }

  stop(): void {
    this.rl.close();
  }
}
