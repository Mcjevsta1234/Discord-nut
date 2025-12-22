import { DiscordBot } from './discord/client';
import { ConsoleChat } from './console/consoleChat';
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

/**
 * Detect if we should run in hybrid mode (Discord + Console)
 */
function shouldRunHybridMode(): boolean {
  const args = process.argv.slice(2);
  return args.includes('--hybrid') || args.includes('--both') ||
         process.env.HYBRID_MODE === 'true' || process.env.HYBRID_MODE === '1';
}

/**
 * Detect if we should run in console-only mode
 * Checks for:
 * 1. --console or -c command line flag
 * 2. CONSOLE_MODE=true environment variable
 * 3. Missing Discord token
 */
function shouldRunConsoleMode(): boolean {
  // Check command line arguments
  const args = process.argv.slice(2);
  if (args.includes('--console') || args.includes('-c')) {
    return true;
  }

  // Check environment variable
  if (process.env.CONSOLE_MODE === 'true' || process.env.CONSOLE_MODE === '1') {
    return true;
  }

  // Check if Discord token is missing (might be console-only deployment)
  if (!process.env.DISCORD_TOKEN) {
    console.log('⚠️  No DISCORD_TOKEN found, starting in console mode');
    return true;
  }

  return false;
}

async function main() {
  const isHybridMode = shouldRunHybridMode();
  const isConsoleMode = shouldRunConsoleMode();

  if (isHybridMode) {
    console.log('🤖 Discord Bot - Hybrid Mode (Discord + Console)');
  } else if (isConsoleMode) {
    console.log('🤖 Discord Bot - Console Mode');
  } else {
    console.log('🤖 Discord Bot Starting...');
  }
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
    if (isHybridMode) {
      // Hybrid mode: Run both Discord bot AND console chat
      console.log('\n🌐 Starting Discord bot...');
      const bot = new DiscordBot();
      await bot.start();

      console.log('\n💬 Starting console interface...');
      const consoleChat = new ConsoleChat();
      await consoleChat.start();

      const shutdown = async (signal: string) => {
        console.log(`\n${signal} received, shutting down gracefully...`);
        consoleChat.stop();
        await bot.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } else if (isConsoleMode) {
      // Console-only mode
      const consoleChat = new ConsoleChat();
      await consoleChat.start();

      const shutdown = (signal: string) => {
        console.log(`\n${signal} received, shutting down gracefully...`);
        consoleChat.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } else {
      // Discord-only mode
      const bot = new DiscordBot();
      await bot.start();

      const shutdown = async (signal: string) => {
        console.log(`\n${signal} received, shutting down gracefully...`);
        await bot.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

main();
