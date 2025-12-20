# Deterministic Tools Documentation

This document describes the deterministic web access and GitHub tooling improvements implemented in Discord-nut.

## Overview

The bot now uses deterministic, self-hosted tools that don't rely on LLM-based search or unpredictable APIs. This ensures:
- **Reliability**: Tools return structured data consistently
- **Speed**: No LLM inference for basic operations
- **Transparency**: Clear data sources and processing
- **No API Keys**: All tools use free/self-hosted services

## Tools

### 1. SearxNG Search (`searxng_search`)

**Purpose**: Web search using self-hosted SearxNG instance

**Endpoint**: `http://agent.witchy.world:4564/search`

**Parameters**:
- `query` (required): Search query string
- `max_results` (optional): Number of results (default: 5)

**Returns**:
```json
{
  "query": "search terms",
  "results": [
    {
      "title": "Result Title",
      "url": "https://example.com",
      "snippet": "Preview text..."
    }
  ]
}
```

**Usage Examples**:
- "Search for best Minecraft server hosting"
- "Find information about Docker containers"
- "Look up TypeScript documentation"

**Trigger Words**: search, find, look up, google

---

### 2. URL Fetcher (`fetch_url`)

**Purpose**: Fetch and extract readable content from URLs

**Parameters**:
- `url` (required): URL to fetch

**Returns**:
```json
{
  "url": "https://example.com",
  "content": "Extracted text content...",
  "contentType": "text/html"
}
```

**Features**:
- Strips scripts, styles, and HTML tags
- Returns clean, readable text
- Supports HTML, plain text, and JSON
- 5MB size limit
- 4000 character truncation

**Usage Examples**:
- "Here's a link, explain it: https://example.com"
- "Summarize this article: [URL]"
- User pastes a URL in chat

**Auto-trigger**: Automatically used when URLs are detected in messages

---

### 3. Enhanced GitHub Tool (`github_repo`)

**Purpose**: Deep read-only access to GitHub repositories

**Parameters**:
- `repo` (required): Repository as "owner/repo" or full GitHub URL
- `action` (optional): Action to perform (default: "info")
  - `info`: Basic repository information
  - `summary`: Tech stack detection + README preview
  - `readme`: Fetch full README.md content
  - `file`: Read specific file by path
  - `tree`: List repository structure
  - `commits`: Show recent commits
  - `package`: Fetch package.json
  - `config`: Detect configuration files
- `path` (optional): File/directory path for `file` and `tree` actions

**Returns** (for `readme` action):
```json
{
  "repo": "owner/repo",
  "readme": "Full README content...",
  "name": "owner/repo",
  "description": "Repo description",
  "stars": 123,
  "language": "TypeScript"
}
```

**Usage Examples**:
- "Summarize mcjevsta1234/discord-nut" → Uses `action=readme`
- "What does this repo do: github.com/user/repo" → Uses `action=readme`
- "List files in discord-nut" → Uses `action=tree`
- "Show recent commits" → Uses `action=commits`

**Critical Rule**: Repo summarization MUST use `action=readme` to fetch README first

---

## Multi-Step Execution

The planner can chain actions for complex workflows:

**Example 1**: Search + Summarize
```
User: "Search for Docker best practices then summarize"
Plan:
1. searxng_search("Docker best practices")
2. chat (summarize results)
```

**Example 2**: GitHub + Image
```
User: "Read the Discord-nut README then generate an image of its architecture"
Plan:
1. github_repo(repo="mcjevsta1234/discord-nut", action="readme")
2. image (generate diagram)
```

**Example 3**: URL + Analysis
```
User: "Fetch this article and explain it: https://example.com"
Plan:
1. fetch_url("https://example.com")
2. chat (analyze content)
```

---

## Error Handling

All tools implement graceful error handling:

1. **Tool Failures**: Don't block responses
   - Error logged to console
   - User receives friendly error message
   - Execution continues with next action

2. **Fallback Logic**:
   - SearxNG fails → suggest URL if present
   - GitHub fails → explain error cleanly
   - Image fails → send text-only response

3. **Validation**:
   - Invalid URLs rejected early
   - Empty queries caught before API calls
   - Malformed responses handled gracefully

---

## Routing Rules

### Planner Detection

The planner automatically routes requests to appropriate tools:

| Request Pattern | Tool | Example |
|----------------|------|---------|
| "search for...", "find..." | `searxng_search` | "search for Minecraft mods" |
| URLs in message | `fetch_url` | "explain: https://..." |
| "summarize [repo]" | `github_repo` (readme) | "summarize discord-nut" |
| "convert X to Y" | `convert_units` | "6ft to cm" |
| Math expressions | `calculate` | "14*3+9" |

### Tool Preference

1. **Deterministic tools first**: Always prefer tools over LLM chat for data fetching
2. **Multi-step when needed**: Chain actions instead of asking user for multiple requests
3. **Chat as fallback**: Only use chat when no tool fits

---

## Legacy Tools

### Deprecated: `web_search` (DuckDuckGo HTML)

**Replaced by**: `searxng_search`

**Why**: DuckDuckGo HTML parsing was unreliable and slow. SearxNG provides:
- JSON API responses
- Self-hosted control
- Better rate limiting
- Consistent structure

**Migration**: All "search" requests now use SearxNG automatically

---

## Testing Scenarios

### ✅ Must Work

1. **Search + Summarize**
   ```
   User: "Search for best modded Minecraft hosting"
   Expected: SearxNG search → summarize results
   ```

2. **GitHub README Summary**
   ```
   User: "Summarise the README for mcjevsta1234/discord-nut"
   Expected: github_repo(action=readme) → summarize content
   ```

3. **URL Explanation**
   ```
   User: "Here's a link, explain it: https://example.com"
   Expected: fetch_url → analyze content
   ```

4. **Multi-Action Workflow**
   ```
   User: "Search then generate an image"
   Expected: searxng_search → image generation
   ```

5. **Reply Handling**
   ```
   User replies to bot message with "search for X"
   Expected: Keeps persona, runs planner, executes search
   ```

---

## Architecture

### Data Flow

```
User Message
    ↓
Planner (analyzes request)
    ↓
Action Plan (ordered actions)
    ↓
Executor (runs actions sequentially)
    ↓
Results Aggregation
    ↓
Final Response Generator
    ↓
Discord Message
```

### Tool Registry

Tools are registered in `src/mcp/index.ts`:

```typescript
registry.register(new SearxNGSearchTool());
registry.register(new FetchUrlTool());
registry.register(new GitHubInfoTool());
// ... other tools
```

### No API Keys Required

All deterministic tools work without API keys:
- **SearxNG**: Self-hosted instance
- **GitHub**: Public API (no auth for public repos)
- **URL Fetch**: Direct HTTP requests

---

## Configuration

### SearxNG Endpoint

Default: `http://agent.witchy.world:4564/search`

To change, edit `src/mcp/tools/searxngSearch.ts`:
```typescript
private readonly SEARXNG_ENDPOINT = 'http://your-instance:port/search';
```

### Limits

- **SearxNG**: 15s timeout, default 5 results
- **fetch_url**: 15s timeout, 5MB max, 4000 chars output
- **GitHub**: 10s timeout per request

---

## Troubleshooting

### SearxNG Not Responding

**Symptom**: "SearxNG search failed" errors

**Solutions**:
1. Check endpoint is accessible: `curl http://agent.witchy.world:4564/search?q=test&format=json`
2. Verify network connectivity
3. Check SearxNG instance logs
4. Fallback: Use `fetch_url` if URLs are known

### GitHub Rate Limiting

**Symptom**: 403 errors from GitHub API

**Solutions**:
1. Wait 1 hour (rate limit resets)
2. Add GitHub token in future (optional)
3. Use `raw.githubusercontent.com` for README (no rate limit)

### URL Fetch Timeouts

**Symptom**: "Failed to fetch URL" after 15s

**Solutions**:
1. Check if URL is accessible
2. Try shorter URL or different source
3. Some sites block bots - expected behavior

---

## Future Enhancements

- [ ] Add GitHub personal access token support (higher rate limits)
- [ ] Implement caching for frequently accessed repos
- [ ] Add more SearxNG instances for redundancy
- [ ] Support PDF/document extraction in fetch_url
- [ ] Add Wikipedia tool for factual lookups
