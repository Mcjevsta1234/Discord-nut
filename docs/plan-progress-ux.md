# Plan/Progress UX - Public Thinking

## Overview

The bot now shows a **public "Plan/Progress"** UX for complex multi-step tasks. This is NOT chain-of-thought reasoning - it's a user-friendly view of what the bot is doing.

## When It Triggers

Plan/Progress UX activates when:
- Request uses any tools (GitHub, search, fetch, etc.)
- Multiple actions are planned
- Complex tasks requiring multiple steps

Simple chat-only responses skip this UX for speed.

## UX Flow

### 1. Initial Plan

When a complex request is received, the bot immediately shows:

```
Plan
• Check GitHub: owner/repo (summary)
• Search web: "relevant query"
• Respond conversationally

⚙️ Executing actions...
```

**Plan bullets** (max 6):
- Concise, user-friendly descriptions
- No internal tool names or JSON
- Shows WHAT, not HOW

### 2. Live Progress Updates

As each action executes, the message updates:

```
Plan
• Check GitHub: owner/repo (summary)
• Search web: "relevant query"
• Respond conversationally

🔎 Executing 1/3: github_repo...
```

Progress icons:
- 🔎 Tool execution
- 🎨 Image generation
- 💬 Chat response

### 3. Completion Steps

After each action:

```
Plan
• Check GitHub: owner/repo (summary)
• Search web: "relevant query"
• Respond conversationally

✅ Completed 1/3: github_repo
```

### 4. Final Response

The plan stays visible at the top, with the response below:

```
Plan
• Check GitHub: owner/repo (summary)
• Search web: "relevant query"
• Respond conversationally

Response
Based on the repository information and web search...
[actual response text here]
```

## Design Principles

### ✅ DO

- Keep plan bullets short (3-7 words each)
- Use user-friendly language
- Show progress with icons
- Keep plan visible in final response
- Use Discord embeds for clean formatting

### ❌ DON'T

- Expose internal tool schemas
- Show raw JSON or prompts
- Reveal reasoning process
- Include too many bullets (max 6)
- Show technical implementation details

## Examples

### Example 1: GitHub Repository Summary

**User:** `emma summarize https://github.com/microsoft/vscode`

**Plan:**
```
Plan
• Check GitHub: microsoft/vscode (summary)
• Read README content
• Summarize key features

⚙️ Executing actions...
```

**Progress:**
```
Plan
• Check GitHub: microsoft/vscode (summary)
• Read README content
• Summarize key features

🔎 Executing 1/1: github_repo...
```

**Final:**
```
Plan
• Check GitHub: microsoft/vscode (summary)
• Read README content
• Summarize key features

Response
VS Code is a lightweight but powerful source code editor...
[summary continues]
```

### Example 2: Web Search + Fetch

**User:** `wiz search for "rust async" and summarize the top result`

**Plan:**
```
Plan
• Search web: "rust async"
• Fetch top result content
• Summarize findings

⚙️ Executing actions...
```

**Progress:**
```
Plan
• Search web: "rust async"
• Fetch top result content
• Summarize findings

🔎 Executing 1/2: searxng_search...
```

Then:
```
Plan
• Search web: "rust async"
• Fetch top result content
• Summarize findings

✅ Completed 1/2: searxng_search

🔎 Executing 2/2: fetch_url...
```

**Final:**
```
Plan
• Search web: "rust async"
• Fetch top result content
• Summarize findings

Response
Found comprehensive documentation on Rust's async/await...
[summary continues]
```

### Example 3: Simple Chat (No Plan/Progress)

**User:** `emma what's the weather like?`

No plan shown - just immediate response:
```
⏳ Working on it...
```

Then:
```
I don't have access to real-time weather data...
[response continues]
```

## Implementation Details

### Trigger Logic

```typescript
const hasTools = plan.actions.some((a) => a.type === 'tool');
const hasMultipleActions = plan.actions.length > 1;
const isComplex = hasTools || hasMultipleActions;

if (isComplex) {
  // Show Plan/Progress UX
} else {
  // Simple response
}
```

### Plan Bullet Generation

Converts internal action types to user-friendly descriptions:

```typescript
// Internal: { type: 'tool', toolName: 'github_repo', toolParams: {...} }
// Public: "• Check GitHub: owner/repo (summary)"

// Internal: { type: 'tool', toolName: 'searxng_search', toolParams: {query: "..."} }
// Public: "• Search web: "query...""

// Internal: { type: 'image', imagePrompt: "..." }
// Public: "• Generate image"
```

### Discord Formatting

- **Embeds** for structured content
- **Bold headers** for sections
- **Bullets** for lists
- **Icons** for visual clarity
- **Timestamps** for context

## Benefits

1. **Transparency**: Users see what's happening
2. **Reduced perceived latency**: Progress updates keep users engaged
3. **Trust building**: Shows actual steps, not fabricated claims
4. **Educational**: Users learn what the bot can do
5. **Debugging**: Clear visibility into execution flow

## Configuration

No configuration needed - automatically activates based on request complexity.

## Files Modified

- `src/discord/messageHandler.ts`: Main implementation
  - `buildPlanBullets()`: Convert actions to user-friendly bullets
  - `executeWithProgress()`: Live progress updates
  - `sendResponseWithPlan()`: Keep plan in final response

## Future Enhancements

Potential improvements:

- [ ] Collapsible plan section for long responses
- [ ] Time estimates per action
- [ ] Failure recovery indicators
- [ ] Parallel action visualization
- [ ] User preference to disable/enable
