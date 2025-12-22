import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from '../config';
import { MessageHandler } from './messageHandler';
import { OpenRouterService } from '../ai/openRouterService';
import { MemoryManager } from '../ai/memoryManager';
import { PromptManager } from './promptManager';
import { AdminCommandHandler } from './adminCommands';
import { MCPClient, registerDefaultTools } from '../mcp';

export class DiscordBot {
  private client: Client;
  private messageHandler: MessageHandler;
  private aiService: OpenRouterService;
  private memoryManager: MemoryManager;
  private promptManager: PromptManager;
  private adminCommands: AdminCommandHandler;

  constructor() {
    // Initialize Discord client with required intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // Initialize MCP client and register default tools
    const mcpClient = new MCPClient();
    registerDefaultTools(mcpClient);

    // Initialize AI services with MCP support
    this.aiService = new OpenRouterService(mcpClient);
    this.memoryManager = new MemoryManager(this.aiService);
    this.promptManager = new PromptManager();

    // Initialize message handler
    this.messageHandler = new MessageHandler(
      this.client,
      this.aiService,
      this.memoryManager,
      this.promptManager
    );

    this.adminCommands = new AdminCommandHandler(
      this.client,
      this.promptManager
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Ready event
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
      console.log(`📊 Serving ${readyClient.guilds.cache.size} guilds`);
      
      // Generate and display OAuth invite URL
      const permissions = [
        'SendMessages',
        'ReadMessages',
        'ReadMessageHistory',
        'MentionEveryone',
        'EmbedLinks',
        'AttachFiles',
        'ManageMessages',
        'UseExternalEmojis',
        'AddReactions',
        'UseApplicationCommands',
        'ViewChannel',
      ];
      const permissionBits = 0x00000800 | // View Channels
                             0x00000400 | // Send Messages
                             0x00001000 | // Manage Messages
                             0x00008000 | // Embed Links
                             0x00010000 | // Attach Files
                             0x00020000 | // Read Message History
                             0x00100000 | // Use External Emojis
                             0x00040000 | // Add Reactions
                             0x80000000 | // Use Application Commands
                             0x00000001;  // Mention @everyone/@here/@all roles
      
      const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=${permissionBits}&scope=bot%20applications.commands`;
      
      console.log('\n🔗 OAuth Invite URL:');
      console.log(oauthUrl);
      console.log('\n');
      
      this.adminCommands
        .registerCommands()
        .then(() => console.log('Slash commands registered'))
        .catch((error) =>
          console.error('Failed to register slash commands:', error)
        );
    });

    // Message event
    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await this.messageHandler.handleMessage(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        // Handle button interactions
        if (interaction.isButton()) {
          await this.messageHandler.handleButtonInteraction(interaction);
        }
        // Handle slash commands
        else {
          await this.adminCommands.handleInteraction(interaction);
        }
      } catch (error) {
        console.error('Error handling interaction:', error);
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });

    // Warning handling
    this.client.on(Events.Warn, (warning) => {
      console.warn('Discord client warning:', warning);
    });
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Discord bot...');
      await this.client.login(config.discord.token);
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Discord bot...');
    this.client.destroy();
  }

  getClient(): Client {
    return this.client;
  }
}
