import { DiscordBot } from './discord/client';
import { validateRoutingConfig, logRoutingConfig } from './config/routing';

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
  console.log('🤖 Discord Bot Starting...');
  console.log('Environment:', process.env.NODE_ENV || 'development');

  // Validate routing configuration at startup
  console.log('\n🔍 Validating routing configuration...');
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
    const bot = new DiscordBot();
    await bot.start();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();
