import { env } from './config/env';

export interface Config {
  discord: {
    token: string;
    clientId: string;
  };
  openRouter: {
    apiKey: string;
    baseUrl: string;
  };
  image: {
    model: string;
    defaultResolution: {
      width: number;
      height: number;
    };
    maxResolution: {
      width: number;
      height: number;
    };
  };
  bot: {
    systemPrompt: string;
    personality: string;
    exampleMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    maxMemoryMessages: number;
    enableSummary: boolean;
    triggerNames: string[];
  };
}

export const config: Config = {
  discord: {
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
  },
  openRouter: {
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
  },
  image: {
    model: env.IMAGE_MODEL,
    defaultResolution: {
      width: env.IMAGE_DEFAULT_WIDTH,
      height: env.IMAGE_DEFAULT_HEIGHT,
    },
    maxResolution: {
      width: env.IMAGE_MAX_WIDTH,
      height: env.IMAGE_MAX_HEIGHT,
    },
  },
  bot: {
    systemPrompt: env.BOT_SYSTEM_PROMPT,
    personality: env.BOT_PERSONALITY,
    exampleMessages: [],
    maxMemoryMessages: env.BOT_MAX_MEMORY_MESSAGES,
    enableSummary: env.BOT_ENABLE_SUMMARY,
    triggerNames: env.BOT_TRIGGER_NAMES.map((name) => name.toLowerCase()),
  },
};
