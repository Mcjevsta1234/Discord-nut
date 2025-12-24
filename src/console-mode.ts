import { ConsoleChat } from './console/consoleChat';
import { validateRoutingConfig, logRoutingConfig } from './config/routing';
import { config } from './config';

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

async function main() {
  console.log('🤖 Discord Bot - Console Mode');
  console.log('Environment:', process.env.NODE_ENV || 'development');

  // Validate config at startup (fails fast with helpful errors)
  try {
    console.log('\n🔍 Validating configuration...');
    // Access config to trigger validation - throws if missing required env vars
    if (!config.openRouter.apiKey) {
      throw new Error('Missing required OpenRouter API key');
    }
    console.log('✅ Main configuration valid');
  } catch (error) {
    console.error('\n❌ FATAL: Configuration error:', error instanceof Error ? error.message : String(error));
    console.error('\nTo fix:');
    console.error('  1. Copy template: cp .env.example .env');
    console.error('  2. Edit .env and fill in required values:');
    console.error('     - OPENROUTER_API_KEY (required)');
    console.error('     - DISCORD_TOKEN (optional if console-only)');
    console.error('  3. Restart the bot');
    process.exit(1);
  }

  // Validate routing configuration at startup
  console.log('🔍 Validating routing configuration...');
  try {
    validateRoutingConfig();
    console.log('✅ Routing configuration valid');
    logRoutingConfig();
  } catch (error) {
    console.error('❌ FATAL: Invalid routing configuration:', error);
    console.error('Please check your environment variables and try again.');
    process.exit(1);
  }

  try {
    const consoleChat = new ConsoleChat();
    await consoleChat.start();

    // Graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      consoleChat.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start console chat:', error);
    process.exit(1);
  }
}

main();
