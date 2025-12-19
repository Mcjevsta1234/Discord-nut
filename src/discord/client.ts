import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from '../config';
import { MessageHandler } from './messageHandler';
import { OpenRouterService } from '../ai/openRouterService';
import { MemoryManager } from '../ai/memoryManager';

export class DiscordBot {
  private client: Client;
  private messageHandler: MessageHandler;
  private aiService: OpenRouterService;
  private memoryManager: MemoryManager;

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

    // Initialize AI services
    this.aiService = new OpenRouterService();
    this.memoryManager = new MemoryManager(this.aiService);

    // Initialize message handler
    this.messageHandler = new MessageHandler(
      this.client,
      this.aiService,
      this.memoryManager
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Ready event
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
      console.log(`📊 Serving ${readyClient.guilds.cache.size} guilds`);
    });

    // Message event
    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await this.messageHandler.handleMessage(message);
      } catch (error) {
        console.error('Error in message handler:', error);
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
