# Discord-nut

A TypeScript Discord bot powered by OpenRouter AI. The bot responds when mentioned, replied to, or when its name appears in messages. Features include conversational AI, image generation, web search, and MCP tools.

## Features

- 🤖 **Smart Triggers**: Responds when mentioned, replied to, or name appears
- 💬 **Conversational AI**: Natural language conversation with configurable personality
- 🎨 **Image Generation**: Automatic image generation with cost-aware routing
- 🔍 **Web Search**: Built-in web search via DuckDuckGo (no API key needed)
- 🛠️ **MCP Tools**: 7 integrated tools (calculator, unit converter, GitHub info, time, etc.)
- 🧠 **Smart Memory**: Token-efficient conversation history with automatic summarization
- 🔀 **Model Routing**: Intelligent model selection based on query complexity (INSTANT/SMART/THINKING/CODING tiers)
- 💰 **Cost Tracking**: Built-in cost calculation per message based on configurable pricing
- 🖥️ **Console Mode**: Chat with the bot in your terminal (Discord not required)

## Prerequisites

- **Node.js** 16.x or higher
- **Discord bot token** (from [Discord Developer Portal](https://discord.com/developers/applications))
- **OpenRouter API key** (from [OpenRouter](https://openrouter.ai/keys))

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/Mcjevsta1234/Discord-nut.git
cd Discord-nut
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# Required
DISCORD_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id_here
OPENROUTER_API_KEY=your_key_here

# Optional (see .env.example for all options)
BOT_MAX_MEMORY_MESSAGES=10
BOT_ENABLE_SUMMARY=true
IMAGE_MODEL=google/gemini-2.5-flash-image
IMAGE_DEFAULT_WIDTH=512
IMAGE_DEFAULT_HEIGHT=512
```

### 3. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Enable these Privileged Gateway Intents:
   - **Message Content Intent**
   - **Server Members Intent** (optional)
4. Go to OAuth2 > URL Generator
5. Select scopes: `bot`
6. Select permissions: Read Messages, Send Messages, Read Message History
7. Use the generated invite URL to add bot to your server

## Usage

### Development Mode

```bash
npm run dev
```

### Production (Build + Run)

```bash
npm run build
npm start
```

### Console Mode (no Discord required)

```bash
npm run console
```

Or with environment variable:

```bash
CONSOLE_MODE=true npm start
```

Commands in console mode:
- `/persona <name>` - Switch persona (emma, steve, wiz)
- `/personas` - List available personas
- `/clear` - Clear conversation history
- `/help` - Show commands
- `/exit` or `/quit` - Exit

## Configuration

### Environment Variables

Only critical variables shown here. See `.env.example` for all options.

| Variable | Purpose | Default |
|----------|---------|---------|
| `DISCORD_TOKEN` | Bot authentication token | _(required)_ |
| `DISCORD_CLIENT_ID` | Discord app ID | _(required)_ |
| `OPENROUTER_API_KEY` | API key for OpenRouter | _(required)_ |
| `BOT_MAX_MEMORY_MESSAGES` | Messages to keep in memory | 10 |
| `BOT_ENABLE_SUMMARY` | Auto-summarize old messages | true |
| `IMAGE_MODEL` | Model for image generation | google/gemini-2.5-flash-image |
| `IMAGE_DEFAULT_WIDTH` | Default image width | 512 |
| `IMAGE_DEFAULT_HEIGHT` | Default image height | 512 |

### Model Selection

The bot intelligently routes queries to different models based on complexity:

- **INSTANT** (fast, free): Simple greetings, quick queries
- **SMART** (default): General conversation and reasoning
- **THINKING** (explicit): Complex analysis and explanations
- **CODING**: Code generation and debugging

Configure models in `.env`:

```env
MODEL_INSTANT=xiaomi/mimo-v2-flash:free
MODEL_SMART=deepseek/deepseek-r1-0528
MODEL_THINKING=google/gemma-3-27b-it:free
MODEL_CODING=google/gemma-3-12b-it:free
```

### Pricing Configuration

Model pricing is configured per tier. Set pricing in `.env` to track costs (prices are per 1 million tokens):

```env
MODEL_SMART_INPUT_PRICE=0.05
MODEL_SMART_OUTPUT_PRICE=0.22
```

**Pricing is calculated and displayed when debugging is enabled.**

Pricing configuration is in: [src/config/routing.ts](src/config/routing.ts) (lines 39-220)

## MCP Tools

The bot includes 7 built-in tools for enhanced capabilities:

- **get_time**: Current date/time with Discord timestamps
- **web_search**: Search the web via DuckDuckGo
- **calculate**: Math expressions (2+2, 100/3, etc.)
- **convert_units**: Convert between units (km to miles, C to F, kg to lb, etc.)
- **github_info**: Get GitHub repository stats (read-only)
- **minecraft_status**: Check Minecraft server status
- **info_utils**: UUID, random numbers, base64, hashing

The bot automatically decides when to use a tool based on your query.

For adding custom tools, see [docs/mcp-examples.md](docs/mcp-examples.md).

## Troubleshooting

### Bot doesn't respond in Discord
- Verify bot is online and connected
- Check that bot has **Message Content Intent** enabled in Developer Portal
- Ensure bot has permissions to read and send messages in the channel
- Bot only responds when mentioned, replied to, or name appears in message

### "Invalid token" error
- Verify `DISCORD_TOKEN` is correct in `.env`
- Regenerate the token in Discord Developer Portal if needed

### "API error 401" (OpenRouter)
- Verify `OPENROUTER_API_KEY` is valid and has available quota
- Check at [OpenRouter dashboard](https://openrouter.ai/account/usage)

### "Missing required environment variable"
- Ensure all required variables in `.env` are filled (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OPENROUTER_API_KEY`)
- Run `cp .env.example .env` to get the template

### Image generation fails
- Verify `IMAGE_MODEL` is a valid image model on OpenRouter
- Default `google/gemini-2.5-flash-image` is recommended
- Check that image model pricing/quota is available

### Build errors
- Run `npm install` to ensure dependencies are installed
- Verify Node.js version is 16.x or higher: `node --version`
- Delete `dist/` and `node_modules/`, then reinstall: `rm -r dist node_modules && npm install && npm run build`

## Documentation

- [MCP Tools & Examples](docs/mcp-examples.md) - Custom tool development
- [Personas](docs/PERSONAS.md) - Bot personality presets
- [Prompts](docs/prompts.md) - System prompts and configuration
- [GitHub Integration](docs/github-integration.md) - GitHub API setup (if using GitHub tools)
- [File Attachments](docs/file-attachments.md) - File handling in messages

## License

ISC

## Contributing

Pull requests welcome!
