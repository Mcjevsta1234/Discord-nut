import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  discord: {
    token: string;
    clientId: string;
  };
  openRouter: {
    apiKey: string;
    baseUrl: string;
    models: {
      router: string;
      chat: string;
      summarizer: string;
    };
  };
  bot: {
    systemPrompt: string;
    personality: string;
    exampleMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxMemoryMessages: number;
    enableSummary: boolean;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config: Config = {
  discord: {
    token: getEnvVar('DISCORD_TOKEN'),
    clientId: getEnvVar('DISCORD_CLIENT_ID'),
  },
  openRouter: {
    apiKey: getEnvVar('OPENROUTER_API_KEY'),
    baseUrl: getEnvVar('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    models: {
      router: getEnvVar('OPENROUTER_MODEL_ROUTER', 'openai/gpt-3.5-turbo'),
      chat: getEnvVar('OPENROUTER_MODEL_CHAT', 'openai/gpt-3.5-turbo'),
      summarizer: getEnvVar('OPENROUTER_MODEL_SUMMARIZER', 'openai/gpt-3.5-turbo'),
    },
  },
  bot: {
    systemPrompt: getEnvVar(
      'BOT_SYSTEM_PROMPT',
      'You are a helpful and friendly Discord bot assistant. Be conversational and engaging.'
    ),
    personality: getEnvVar(
      'BOT_PERSONALITY',
      'friendly, helpful, and slightly humorous'
    ),
    exampleMessages: [],
    maxMemoryMessages: parseInt(getEnvVar('BOT_MAX_MEMORY_MESSAGES', '10'), 10),
    enableSummary: getEnvVar('BOT_ENABLE_SUMMARY', 'true') === 'true',
  },
};
