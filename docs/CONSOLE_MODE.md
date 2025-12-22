# Console Chat Mode

The Discord Bot includes a **Console Chat Mode** for debugging, testing, and standalone deployments without Discord.

## Features

✅ **Interactive Chat Interface** - Chat directly with the bot in your terminal  
✅ **Persona Support** - Test different personas (Emma, Steve, Wiz)  
✅ **Full AI Pipeline** - Uses the same routing, planning, and execution as Discord mode  
✅ **Action Planning** - See the bot's action plans and execution results  
✅ **Conversation History** - Maintains context throughout the session  
✅ **Chat Logging** - All conversations are logged (same as Discord mode)  
✅ **Tool Integration** - All MCP tools are available  
✅ **Universal Compatibility** - Works in Pterodactyl, Docker, standard terminals, etc.

## Starting Console Mode

### Hybrid Mode (Discord + Console Simultaneously) 🌟

**Best option if you want both Discord AND console access:**

```bash
# Development mode
npm run dev -- --hybrid

# Production mode
npm start -- --hybrid
node dist/index.js --hybrid
node dist/index.js --both  # alternative flag
```

**Pterodactyl Example (Hybrid):**
```
node dist/index.js --hybrid
```

**Environment Variable:**
```bash
HYBRID_MODE=true npm start
```

With hybrid mode:
- Bot connects to Discord servers (responds to @mentions and messages)
- Console interface accepts commands (`/persona`, `/help`, etc.)
- Both work at the same time from the same process

### Method 1: Command Line Flag (Console-Only)

Works with **any** hosting environment including Pterodactyl, Docker, PM2, systemd, etc:

```bash
# Development mode
npm run dev -- --console
# or
tsx src/index.ts --console

# Production mode (any of these work)
npm start -- --console
node dist/index.js --console
node dist/index.js -c  # short flag
```

**Pterodactyl Example (Console-only):**
```
node dist/index.js --console
```

### Method 2: Environment Variable

Set `CONSOLE_MODE=true` in your `.env` file or environment:

```bash
# In .env file
CONSOLE_MODE=true

# Or as environment variable
CONSOLE_MODE=true npm start
```

**Docker Example:**
```dockerfile
ENV CONSOLE_MODE=true
CMD ["node", "dist/index.js"]
```

### Method 3: Automatic Detection

Remove or comment out `DISCORD_TOKEN` in your `.env`:

```bash
# DISCORD_TOKEN=your_token_here  # commented out
npm start
# Automatically detects missing token and starts console mode
```

### Method 4: NPM Scripts (Legacy, requires npm)

```bash
# Development mode (with hot reload)
npm run console

# Production mode (compiled)
npm run console:build
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message with all commands |
| `/personas` | List all available personas |
| `/persona <name>` | Switch to a specific persona (emma, alex, max) |
| `/clear` | Clear conversation history |
| `/exit` or `/quit` | Exit console chat mode |

## Usage Examples

### Basic Chat
```
> hello
🤔 Thinking...
🎯 Using model: google/gemini-2.0-flash-exp:free (INSTANT tier)
💬 Generating response...

┌─ Bot ──────────────────────────────────────────────────────────
Hello! How can I help you today?
└────────────────────────────────────────────────────────────────
```

### Using Personas
```
> /persona emma
✅ Switched to persona: Emma (emma)

[emma]> hey emma, tell me a joke
🎭 Detected persona: emma
🤔 Thinking...
🎯 Using model: google/gemini-2.0-flash-exp:free (INSTANT tier)
💬 Generating response...

┌─ Emma ─────────────────────────────────────────────────────────
Why don't scientists trust atoms? Because they make up everything! 😄
└────────────────────────────────────────────────────────────────
```

### Natural Persona Detection
You can also trigger personas naturally in your messages:
```
> hey max, what's the weather like?
🎭 Detected persona: max
```

### Viewing Action Plans
When the bot needs to use tools, you'll see the action plan:

```
> what time is it in tokyo?
🤔 Thinking...
🎯 Using model: google/gemini-2.0-flash-exp:free (INSTANT tier)

📋 Action Plan: 1 action(s)
   1. get_time: Get current time in Tokyo timezone

⚙️ Executing actions...
   ✓ Action 1: get_time completed

💬 Generating response...
```

## Benefits for Debugging

1. **Faster Iteration** - No need to set up Discord servers or channels
2. **Direct Feedback** - See routing decisions, action plans, and execution results
3. **Model Testing** - Test different routing tiers and models
4. **Persona Testing** - Easily switch between personas to test their behavior
5. **Conversation Flow** - Debug conversation history and context management
6. **Tool Testing** - Test MCP tools without Discord integration overhead

## Logging

Console chat sessions are logged the same way as Discord conversations:
- Location: `logs/ConsoleUser/console-debug/`
- Format: `YYYY-MM-DD.txt`
- Includes: User messages, assistant responses, model info, and routing decisions

## Configuration

Console mode uses the same `.env` configuration as the Discord bot:
- OpenRouter API key
- Routing configuration
- Model tier settings
- Tool configurations

## Tips

- Use `/clear` to reset conversation history when testing different scenarios
- Switch personas to test how different personalities handle the same queries
- Watch the action plans to understand which tools the bot decides to use
- Monitor routing decisions to see which models are selected for different tasks

## Example Session

```bash
$ npm run console

🤖 Discord Bot - Console Mode
Environment: development

🔍 Validating routing configuration...
✅ Routing configuration valid
   Mode: hybrid
   Tiers configured: INSTANT, SMART, THINKING, CODING

╔════════════════════════════════════════════════════════════════╗
║          🤖 Discord Bot - Console Chat Mode 🤖               ║
╚════════════════════════════════════════════════════════════════╝

📝 Type your messages to chat with the bot
🎭 Use persona names (emma, alex, max) to switch personas
💡 Commands:
   /personas - List available personas
   /persona <name> - Set active persona
   /clear - Clear conversation history
   /help - Show this help message
   /exit or /quit - Exit console chat

> /personas

🎭 Available Personas:
     emma - Emma
     alex - Alex
     max - Max

> /persona emma
✅ Switched to persona: Emma (emma)

[emma]> hi emma! can you help me with something?
🤔 Thinking...
🎯 Using model: google/gemini-2.0-flash-exp:free (INSTANT tier)
💬 Generating response...

┌─ Emma ─────────────────────────────────────────────────────────
Of course! I'd be happy to help. What do you need?
└────────────────────────────────────────────────────────────────

[emma]> /exit
👋 Goodbye!
```
