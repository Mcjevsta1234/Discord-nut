# File-Based Context Manager

## Overview
Conversation context is now stored locally in JSON files with **zero leakage** between users and channels.

## Context Isolation

### Key Principle
Each conversation is **completely isolated** based on:
- **Guilds (servers):** Context key = `guildId + channelId + userId`
- **Direct Messages (DMs):** Context key = `userId` only

### Why This Matters
- Messages in channel A never affect channel B (even for the same user)
- User X's messages never affect User Y (even in the same channel)
- All isolation is enforced at the filesystem level

## File Structure

```
context/
├── guilds/
│   └── {guildId}/
│       └── {channelId}/
│           └── {userId}.json          ← Guild channel context
└── dms/
    └── {userId}.json                   ← DM context
```

### Example
- **Guild channel:** `context/guilds/12345/67890/99999.json`
  - Guild ID: 12345
  - Channel ID: 67890
  - User ID: 99999

- **Direct message:** `context/dms/99999.json`
  - User ID: 99999
  - (DMs are not scoped to guild)

## Context File Format

```json
{
  "version": 1,
  "createdAt": 1640188800000,
  "lastUpdated": 1640188900000,
  "expiresAt": 1640275200000,
  "messages": [
    {
      "role": "user",
      "content": "user message here",
      "timestamp": 1640188800000
    },
    {
      "role": "assistant",
      "content": "assistant response here",
      "timestamp": 1640188850000
    }
  ]
}
```

## What Gets Stored

### ✅ Stored
- User messages (plain text)
- Final assistant replies (plain text only)

### ❌ NOT Stored
- Embeds (debug/system info)
- Planner output / reasoning
- Routing decisions
- Token statistics
- Error details
- Images / attachments

## Limits and Behavior

### Message Limits
- **Max messages per context:** 15 (conservative: 10–20 range)
- **Trimming:** Oldest messages are removed when limit exceeded
- **Keeps newest only:** Recent messages take priority

### Expiration
- **TTL:** 24 hours
- **Auto-cleanup:** Expired files are removed when accessed
- **Periodic cleanup:** Run `cleanupExpiredContexts()` to remove stale files

## Usage

### Load Context
```typescript
const context = await fileContextManager.loadContext(userId, channelId, guildId);
// Returns: Message[] (plain text only, sorted by timestamp)
```

### Append Messages
```typescript
await fileContextManager.appendMessage(userId, message, channelId, guildId);
// OR
await fileContextManager.appendMessages(userId, [msg1, msg2], channelId, guildId);
```

### Delete Context
```typescript
await fileContextManager.deleteContext(userId, channelId, guildId);
// Removes the user's context from a specific channel
```

### Cleanup Expired
```typescript
await fileContextManager.cleanupExpiredContexts();
// Removes all files older than 24 hours
```

## Integration with messageHandler

1. **At message start:** Load context from file
   ```typescript
   const fileContext = await this.fileContextManager.loadContext(userId, channelId, guildId);
   ```

2. **After successful response:** Append to file
   ```typescript
   await this.fileContextManager.appendMessages(userId, [userMessage, assistantResponse], channelId, guildId);
   ```

## Security & Isolation Guarantees

| Scenario | Isolation? | Reason |
|----------|-----------|--------|
| User A in Channel 1 vs User B in Channel 1 | ✅ Yes | Different userId in filename |
| User A in Channel 1 vs User A in Channel 2 | ✅ Yes | Different channelId in path |
| DM with User A vs Channel with User A | ✅ Yes | Different directory (dms/ vs guilds/) |
| User A in Guild 1 vs User A in Guild 2 | ✅ Yes | Different guildId in path |

## Token Reduction

By storing persistent context:
- **No need to reconstruct** conversation history from chat memory
- **Cleaner isolation** prevents cross-contamination
- **Faster loading** from disk cache
- **Reduced retries** due to consistent context

## Monitoring

Get context stats:
```typescript
const stats = fileContextManager.getContextStats(userId, channelId, guildId);
// Returns: { exists, messageCount, expiresIn }
```

Example output:
```json
{
  "exists": true,
  "messageCount": 12,
  "expiresIn": 86400000
}
```

## Lifecycle Rules

- **Explicit Clear Only:** Context is cleared ONLY via the `/clear-context` slash command.
  - Natural language phrases like "reset" or "start over" do NOT clear context.
  - No NLP-based reset detection is used.
- **Expiration Handling:** Expired context is automatically ignored and removed during cleanup.
- **Strict Scoping:**
  - In guilds, context NEVER falls back to broader scopes (no server-wide or channel-wide sharing).
  - In DMs, context uses the user ID only (no guild association).

### Slash Command: Clear Context

Run in the desired scope:
- **Guild channel:** clears YOUR context at `context/guilds/{guildId}/{channelId}/{userId}.json`
- **DM:** clears YOUR context at `context/dms/{userId}.json`

## Agentic Workflows

When routing to agentic tasks (e.g., external agents like OpenHands):
- Do NOT pass stored chat context into the agent run.
- Agent runs must ALWAYS start clean.

Implementation guidance (TypeScript only, no routing/persona changes):
- Use file context for chat prompts only.
- For agent runs, start with an empty context array.
- Never auto-reset or auto-delete context based on user phrasing.

Expected Results:
- No accidental context deletion.
- Agent workflows remain isolated and deterministic.
