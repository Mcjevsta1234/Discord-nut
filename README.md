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
- � **MCP Tools**: Model Context Protocol integration for extensible tool support
- 🔍 **Web Search**: Built-in web search using DuckDuckGo (no API key required)
- �🔒 **Secure**: Environment variables for all secrets
- ✅ **Error Handling**: Comprehensive error handling and logging

## Architecture

```
src/
├── index.ts                 # Main entry point
├── config.ts                # Configuration management
├── discord/
│   ├── client.ts           # Discord client wrapper
│   ├── messageHandler.ts   # Message processing logic
│   ├── promptManager.ts    # Per-channel prompt management
│   └── adminCommands.ts    # Slash commands for configuration
├── ai/
│   ├── openRouterService.ts # OpenRouter API integration
│   └── memoryManager.ts     # Conversation memory management
└── mcp/
    ├── index.ts            # MCP module exports
    ├── client.ts           # MCP client abstraction
    ├── toolRegistry.ts     # Tool registration and management
    ├── types.ts            # MCP type definitions
    └── tools/
        ├── getTime.ts      # Get current time tool
        └── webSearch.ts    # Web search tool (DuckDuckGo)
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
| `OPENROUTER_MODEL_ROUTER` | Model for query routing | openai/gpt-3.

## MCP (Model Context Protocol) Integration

The bot includes built-in support for MCP tools, which allow the AI to perform actions beyond simple chat responses. Tools are automatically selected when appropriate and results are summarized back to the user.

### What is MCP?

MCP (Model Context Protocol) provides a standardized way to give AI models access to external tools and data sources. In this bot:

- The AI router automatically decides when to use a tool vs. normal chat
- Tools are executed safely with read-only access
- Results are formatted and presented naturally to users
- Normal chat behavior is preserved unless a tool is explicitly needed

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_time` | Get current date/time with Discord timestamps | `format` (s/f/R/t/T/D/F or unix, default: s) |
| `web_search` | Search the web via DuckDuckGo | `query` (required), `max_results` (1-10, default 5) |
| `minecraft_status` | Check Minecraft Java server status | `server` (optional hostname, checks WitchyWorlds network by default) |
| `github_info` | Get GitHub repository info (read-only) | `repo` (owner/repo format, e.g., "facebook/react") |
| `calculate` | Perform mathematical calculations | `expression` (e.g., "2 + 2", "(10 * 5) / 2") |
| `convert_units` | Convert between units | `value`, `from_unit`, `to_unit` (supports length/weight/temp/storage) |
| `info_utils` | Utility functions (UUID, random, %, base64, hash) | `operation` (uuid/random/percentage/base64_encode/base64_decode/hash) |

**Note**: All tools use public APIs and require **no API keys**.

#### Tool Examples

**GitHub Repository Info:**
- "Show me info about microsoft/vscode"
- "What are the stats for facebook/react?"
- Returns: stars, forks, open issues, language, last update

**Calculator:**
- "Calculate (15 * 4) + 23"
- "What's 100 / 3?"
- Supports: +, -, *, /, %, parentheses, decimals

**Unit Conversion:**
- "Convert 100 km to miles"
- "How many pounds is 75 kg?"
- "What's 98.6 F in Celsius?"
- Supports: length (m/km/mi/ft/in), weight (kg/lb/oz), temperature (C/F/K), storage (B/KB/MB/GB/TB)

**Info Utilities:**
- "Generate a UUID"
- "Random number between 1 and 100"
- "What's 45 as a percentage of 200?"
- "Base64 encode 'hello world'"
- "Hash this text with sha256"

#### Minecraft Server Status Tool

The `minecraft_status` tool checks the status of Minecraft Java Edition servers using the mcstatus.io API.

**Default Behavior:**
When you ask questions like "how are the servers", "server status", or "are the servers up" without specifying a server, the bot checks these WitchyWorlds network servers:
- `atm10.witchyworlds.top`
- `sb4.witchyworlds.top`
- `tts10.witchyworlds.top`
- `valley.witchyworlds.top`

**Check a Specific Server:**
To check a specific server, mention it in your message:
- "Check mc.hypixel.net status"
- "Is play.example.com online?"

**Output Includes:**
- Server online/offline status
- Player count (current/max)
- Clear Discord-formatted output with inline code for server names

### Where MCP Tools Live

All MCP tools are located in the `src/mcp/` directory:

- `src/mcp/tools/` - Individual tool implementations
- `src/mcp/toolRegistry.ts` - Tool registration system
- `src/mcp/client.ts` - MCP client for tool execution
- `src/mcp/index.ts` - Tool registration and exports

### How to Add a New Read-Only Tool

1. **Create your tool file** in `src/mcp/tools/yourTool.ts`:

```typescript
import { MCPTool, MCPToolDefinition, MCPToolResult } from '../types';

export class YourTool implements MCPTool {
  definition: MCPToolDefinition = {
    name: 'your_tool',
    description: 'What your tool does',
    parameters: [
      {
        name: 'param_name',
        type: 'string',
        description: 'Parameter description',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      // Your tool logic here
      const result = params.param_name;

      return {
        success: true,
        data: { result },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

2. **Register your tool** in `src/mcp/index.ts`:

```typescript
import { YourTool } from './tools/yourTool';

export function registerDefaultTools(mcpClient: MCPClient): void {
  const registry = mcpClient.getToolRegistry();

  registry.register(new GetTimeTool());
  registry.register(new WebSearchTool());
  registry.register(new YourTool()); // Add your tool here

  console.log(`Registered ${registry.count()} MCP tools`);
}
```

3. **Export your tool** (optional, for direct imports):

```typescript
export { YourTool } from './tools/yourTool';
```

That's it! The bot will automatically:
- Make your tool available to the AI router
- Decide when to use it based on user queries
- Execute it safely and summarize results

### MCP Constraints

For safety and stability, all MCP tools in this bot are **read-only** with:
- ❌ No shell/terminal access
- ❌ No filesystem writes
- ❌ No GitHub writes or mutations
- ✅ Safe data fetching and computation only

### Editing the Model List

The list of allowed chat models is configured in your `.env` file:

```bash
OPENROUTER_ALLOWED_CHAT_MODELS=openai/gpt-3.5-turbo,openai/gpt-4o-mini,anthropic/claude-3.5-sonnet
```

To add or remove models:
1. Edit the `OPENROUTER_ALLOWED_CHAT_MODELS` variable in `.env`
2. Add model IDs as a comma-separated list
3. Restart the bot for changes to take effect

You can find available models at [OpenRouter Models](https://openrouter.ai/models).

To change the default models for routing, chat, and summarization:
```bash
OPENROUTER_MODEL_ROUTER=openai/gpt-3.5-turbo
OPENROUTER_MODEL_CHAT=openai/gpt-3.5-turbo
OPENROUTER_MODEL_SUMMARIZER=openai/gpt-3.5-turbo
```5-turbo |
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
