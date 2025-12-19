# Discord-nut

A stable TypeScript Discord bot using discord.js v14 with OpenRouter AI integration. The bot acts as a conversational AI that responds when mentioned, replied to, or when its name appears in messages.

## Features

- 🤖 **Smart Response Triggers**: Responds only when:
  - Bot is mentioned (@bot)
  - Someone replies to the bot's message
  - Bot name appears in the message
- 💬 **Conversational AI**: Acts as a natural conversational assistant
- 🧠 **Token-Efficient Memory**: Uses conversation summaries + recent messages to minimize token usage
- 🔀 **Multiple AI Models**: Supports separate models for routing, chat, and summarization
- ⚙️ **Configurable**: System prompts, personality, and example messages
- 🏗️ **Clean Architecture**: Modular structure with separated Discord and AI logic
- 🔒 **Secure**: Environment variables for all secrets
- ✅ **Error Handling**: Comprehensive error handling and logging

## Architecture

```
src/
├── index.ts                 # Main entry point
├── config.ts                # Configuration management
├── discord/
│   ├── client.ts           # Discord client wrapper
│   └── messageHandler.ts   # Message processing logic
└── ai/
    ├── openRouterService.ts # OpenRouter API integration
    └── memoryManager.ts     # Conversation memory management
```

## Prerequisites

- Node.js 16.x or higher
- A Discord bot token
- An OpenRouter API key

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Mcjevsta1234/Discord-nut.git
   cd Discord-nut
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and fill in your credentials:
   - `DISCORD_TOKEN`: Your Discord bot token (from [Discord Developer Portal](https://discord.com/developers/applications))
   - `DISCORD_CLIENT_ID`: Your Discord application client ID
   - `OPENROUTER_API_KEY`: Your OpenRouter API key (from [OpenRouter](https://openrouter.ai/))
   - Configure model preferences and bot personality as desired

4. **Build the project**
   ```bash
   npm run build
   ```

## Usage

### Development Mode
Run the bot directly with TypeScript:
```bash
npm run dev
```

### Production Mode
Build and run the compiled JavaScript:
```bash
npm run build
npm start
```

## Configuration

### Prompt configuration

Default prompts are Discord-aware and can be overridden per channel (system prompt, chat model, trigger names). See [docs/prompts.md](docs/prompts.md) for defaults, merge rules, and admin slash commands.

### Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token to your `.env` file
5. Enable the following Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent (optional)
6. Go to OAuth2 > URL Generator
7. Select scopes: `bot`
8. Select bot permissions: 
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
9. Use the generated URL to invite the bot to your server

### OpenRouter Setup

1. Sign up at [OpenRouter](https://openrouter.ai/)
2. Get your API key from the dashboard
3. Add the API key to your `.env` file
4. Choose your preferred models (see [available models](https://openrouter.ai/models))

### Bot Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_SYSTEM_PROMPT` | System prompt for the AI | Helpful assistant prompt |
| `BOT_PERSONALITY` | Bot's personality description | friendly, helpful, and slightly humorous |
| `BOT_MAX_MEMORY_MESSAGES` | Max messages to keep in memory | 10 |
| `BOT_ENABLE_SUMMARY` | Enable conversation summarization | true |
| `OPENROUTER_MODEL_ROUTER` | Model for query routing | openai/gpt-3.5-turbo |
| `OPENROUTER_MODEL_CHAT` | Model for chat responses | openai/gpt-3.5-turbo |
| `OPENROUTER_MODEL_SUMMARIZER` | Model for summarization | openai/gpt-3.5-turbo |

## Memory Management

The bot uses a token-efficient memory system:

1. **Recent Messages**: Keeps the last N messages (configurable)
2. **Conversation Summaries**: When memory fills up, older messages are summarized
3. **Automatic Cleanup**: Prevents unbounded memory growth

This approach balances context retention with token usage efficiency.

## Error Handling

The bot includes comprehensive error handling:

- API errors are caught and logged
- User-facing error messages for failed requests
- Graceful shutdown on SIGINT/SIGTERM
- Uncaught exception handling

## Development

### Project Scripts

- `npm run dev` - Run in development mode with tsx
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled JavaScript

### Code Structure

- **Modular Design**: Discord and AI logic are completely separated
- **Type Safety**: Full TypeScript typing throughout
- **Dependency Injection**: Services are injected for testability
- **Configuration**: Centralized config management

## Troubleshooting

### Bot doesn't respond
- Verify the bot has proper permissions in Discord
- Check that Message Content Intent is enabled
- Ensure the bot is properly mentioned or replied to

### API errors
- Verify your OpenRouter API key is correct
- Check that you have credits/quota available
- Ensure the model names are valid

### Build errors
- Run `npm install` to ensure all dependencies are installed
- Check that you're using Node.js 16.x or higher
- Verify TypeScript is properly installed

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
