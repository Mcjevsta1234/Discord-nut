# Persona System

The Discord bot supports multiple personas with distinct personalities, expertise areas, and AI models.

## Available Personas

### Emma (Default)
- **Model**: meta-llama/llama-3.3-70b-instruct:free (Llama 3.3 70B)
- **Personality**: Flirty, sassy, bubbly, and confident
- **Behavior**: Acts human, comfortable with playful banter
- **Use Case**: General conversation, friendly interactions

### Steve
- **Model**: xiaomi/mimo-v2-flash:free (Mimo V2 Flash)
- **Personality**: Friendly, practical, no-nonsense
- **Expertise**: Minecraft, modded Minecraft (Forge/Fabric), server management, Pterodactyl panel
- **Use Case**: Game server help, Minecraft technical support

### Wiz
- **Model**: mistralai/devstral-2512:free (Devstral)
- **Personality**: Precise, technical, minimal fluff
- **Expertise**: TypeScript, Node.js, backend development, DevOps, coding
- **Use Case**: Programming assistance, code review, technical guidance

## How It Works

### Automatic Name-Based Triggers
Persona names are **always active triggers**. Just mention a persona name anywhere in your message:

```
Emma what's the time?                → Emma responds
hey steve my forge server crashed    → Steve responds  
wiz can you refactor this?           → Wiz responds
```

**No @mention or setup required** - persona names work automatically.

### Routing Rules
- Message contains one persona name → Route to that persona
- Multiple persona names → Use first mentioned
- Bot @mentioned with NO persona name → Default to Emma
- Reply to bot message → Continue same persona (unless different name mentioned)

### Per-Persona Models
Each persona uses a specific AI model optimized for their role:
- **Emma**: Llama 3.3 70B (conversational, creative)
- **Steve**: Mimo V2 Flash (fast, practical)
- **Wiz**: Devstral (coding-focused)

When you switch personas, you automatically switch models.

## Commands

### Set Channel Default Persona
Server admins can set a default persona for each channel:

```
/set-persona persona:Emma
/set-persona persona:Steve
/set-persona persona:Wiz
```

This affects responses when the bot is @mentioned without a persona name.

### Override Chat Model (Advanced)
Admins can override the default model for a channel:

```
/set-chat-model model:openai/gpt-4o-mini
```

Note: Persona-specific models take priority over channel overrides.

## Examples

```
User: Emma are you there?
Bot (Emma/Llama 3.3): Hey! Of course I'm here 😊 What's up?

User: steve why won't my forge mods load?
Bot (Steve/Mimo): Check your forge version compatibility...

User: wiz explain async/await
Bot (Wiz/Devstral): async/await is syntactic sugar for Promises...
```

## Adding New Personas

To add a new persona, edit `src/personas.config.ts`:

```typescript
export const personas: Record<string, Persona> = {
  // ... existing personas ...
  newpersona: {
    id: 'newpersona',
    displayName: 'New Persona',
    description: 'Brief description',
    model: 'provider/model-name:free',
    systemPrompt: `Core traits and capabilities...`,
    personalityPrompt: `Personality guidelines and behavior...`,
  },
};
```

The system will automatically:
- Detect the persona name in messages
- Add it to the `/set-persona` command
- Use the specified model for requests

## Technical Details

- **Configuration**: `src/personas.config.ts`
- **Routing Logic**: `src/discord/promptManager.ts` and `src/discord/messageHandler.ts`
- **Admin Commands**: `src/discord/adminCommands.ts`
- **Model Selection**: Each persona specifies its own OpenRouter model
- **Prompt Construction**: Base system prompt + persona.systemPrompt + persona.personalityPrompt
