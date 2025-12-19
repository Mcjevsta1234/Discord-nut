# MCP Integration Examples

## Overview

This document provides examples of how the MCP (Model Context Protocol) integration works in Discord-nut.

## How It Works

1. **User sends a message** to the bot
2. **AI Router analyzes** the message to determine if a tool is needed
3. **Tool is executed** if appropriate (or normal chat response is generated)
4. **Results are summarized** back to the user in a natural, conversational way

## Example Interactions

### Get Time Tool

**User:** "What time is it?"

**Bot Process:**
1. Router decides to use `get_time` tool
2. Executes `get_time` with default parameters
3. Receives: `{ success: true, data: { time: "2024-12-19T10:30:00Z", format: "iso" } }`
4. AI summarizes: "It's currently 10:30 AM UTC (2024-12-19)."

### Web Search Tool

**User:** "Search for latest TypeScript features"

**Bot Process:**
1. Router decides to use `web_search` tool
2. Executes `web_search` with `{ query: "latest TypeScript features", max_results: 5 }`
3. Receives search results from DuckDuckGo
4. AI summarizes the top results in a conversational format

### Normal Chat (No Tool)

**User:** "Hello, how are you?"

**Bot Process:**
1. Router decides normal chat is appropriate
2. Generates conversational response directly
3. No tool execution occurs

## Tool Decision Logic

The AI router uses the following logic:

- **Use get_time**: When user asks about current time, date, or timezone
- **Use web_search**: When user explicitly asks to search or needs current information
- **Use chat**: For greetings, questions about known information, general conversation

## Adding Custom Tools

See the main README.md for step-by-step instructions on adding new read-only tools.

### Tool Requirements

- Must implement the `MCPTool` interface
- Must define clear parameters with types
- Must return `MCPToolResult` with success/error states
- Should be read-only (no side effects)
- Should handle errors gracefully

## Testing Tools

You can test tools directly in your code:

```typescript
import { MCPClient, registerDefaultTools } from './mcp';

const client = new MCPClient();
registerDefaultTools(client);

// Test get_time
const timeResult = await client.executeTool('get_time', { format: 'locale' });
console.log(timeResult);

// Test web_search
const searchResult = await client.executeTool('web_search', { 
  query: 'TypeScript tutorials',
  max_results: 3 
});
console.log(searchResult);
```

## Architecture Flow

```
User Message
    ↓
MessageHandler.handleMessage()
    ↓
OpenRouterService.decideRoute()
    ↓
    ├─→ route: "chat" → chatCompletion()
    │
    └─→ route: "tool" → executeMCPTool()
            ↓
        MCPClient.executeTool()
            ↓
        Tool.execute()
            ↓
        chatCompletion() [summarize result]
            ↓
        Response sent to Discord
```

## Notes

- Tools are automatically registered on bot startup
- Tool selection is fully automatic based on context
- Tool results are always summarized by the AI before sending to users
- Failed tool executions fall back to error messages
- Normal chat behavior is preserved when tools aren't needed
