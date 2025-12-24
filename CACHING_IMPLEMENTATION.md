# AI Pipeline Refactor - Prompt Caching Implementation

## Overview
Major refactor to implement OpenRouter prompt caching support, enabling a direct single-shot code generation pipeline for caching-capable models while maintaining the existing 3-stage pipeline as fallback.

## Changes Summary

### Part 0: Model Capability Detection
**File:** `src/ai/modelCaps.ts` (NEW)
- Allowlist-based caching detection (no external API calls)
- Built-in support for Gemini 2.0 Flash/Thinking, Claude Sonnet/Opus
- Environment override via `MODEL_CACHE_CAPABLE` env var
- `modelSupportsCaching(modelId)` function exported

### Part A: Message Content Blocks with Caching
**File:** `src/ai/openRouterService.ts`
- Updated `Message` interface to support `content: string | ContentBlock[]`
- New `ContentBlock` interface with `cache_control: {type: 'ephemeral'}`
- New `buildCachedMessage()` helper function
- Respects `OPENROUTER_PROMPT_CACHE` env var (defaults to ON)
- Cached blocks must be byte-for-byte identical (no timestamps, no dynamic data)

### Part B: Preset Cached Prompts
**Files:** `src/ai/presets/*.ts` (NEW)
- `static_html.ts` - HTML/CSS/JS static sites
- `web_app_node.ts` - Express/Node.js web apps
- `discord_bot.ts` - Discord.js bots
- `node_cli.ts` - CLI tools
- `index.ts` - Preset loader with `getPresetForProjectType()`

Each preset exports:
- `stableSystemPrefix` - Expert developer persona
- `outputSchemaRules` - Strict JSON schema
- `fancyWebRubric` - Professional web standards (web projects only)
- `placeholderImageGuide` - Placeholdit usage (web projects only)

### Part C: Conditional Pipeline Switch
**Files:** 
- `src/jobs/types.ts` - Added `PipelineType = '3_stage' | 'direct_cached'`
- `src/jobs/directCachedCoder.ts` (NEW) - Direct cached code generator
- `src/jobs/index.ts` - Export `runDirectCachedCodegen`
- `src/discord/messageHandler.ts` - Pipeline decision logic

**Pipeline Decision:**
```typescript
if (modelSupportsCaching(codingModel) && OPENROUTER_PROMPT_CACHE=1) {
  // DIRECT_CACHED: Skip prompter + planner
  // Single LLM call: preset cached prompts + user request
  // Logged as: pipeline = "direct_cached"
} else {
  // 3_STAGE: Existing flow
  // prompter → planner → coder
  // Logged as: pipeline = "3_stage"
}
```

**Job Diagnostics Updated:**
- `pipeline?: PipelineType` - Which pipeline was used
- `cachingCapable?: boolean` - Was model cache-capable

### Part D: Robust JSON Retry with Full Context
**File:** `src/jobs/directCachedCoder.ts`
- Parse failure triggers ONE retry with full context
- Retry includes: cached blocks + user request + invalid output + repair instructions
- NO context loss (spec/rubrics/user request all preserved)
- Truncates invalid output to `MAX_RESPONSE_SNAPSHOT` (12K chars)
- Second failure marks job as failed with clean error

### Part E: Duplicate Progress Message Prevention
**Files:**
- `src/discord/requestDeduplication.ts` - Added `discordEventRegistry`, `jobId` tracking
- `src/discord/messageHandler.ts` - Added event dedupe check

**Deduplication Strategy:**
1. Discord event dedupe: `guildId:channelId:messageId` with 5-min TTL
2. Request registry links `jobId` with `progressMessageId`
3. ONE progress message per job (stored in registry)
4. All updates EDIT same message (no new messages)

### Part F: Persona Isolation + Enhanced Logging
**Files:**
- `src/ai/contextService.ts` - Added `persona` parameter to all methods
- `src/ai/fileContextManager.ts` - Updated context paths to include persona
- `src/discord/messageHandler.ts` - Pass persona to context operations
- `src/ai/openRouterLogger.ts` (NEW) - Detailed OpenRouter call logging

**Context Storage:**
- OLD: `context/guilds/{guildId}/{channelId}/{userId}.json`
- NEW: `context/guilds/{guildId}/{channelId}/{userId}_{persona}.json`
- DMs: `context/dms/{userId}_{persona}.json`

**OpenRouter Logging:**
- Path: `logs/{userId}/{persona}/{YYYY-MM-DD}.log`
- Logged fields: model, pipeline, projectType, tokens, latency, cost, cacheRead, cacheCreation
- One JSON line per API call
- Never crashes on logging failure

## Configuration

### Environment Variables
```bash
# Enable/disable prompt caching (default: ON)
OPENROUTER_PROMPT_CACHE=1

# Override caching capability (comma-separated)
MODEL_CACHE_CAPABLE="google/gemini-2.0-flash-exp:free,anthropic/claude-3.5-sonnet"

# Test mode (only ONE API call per request)
AI_TEST_MODE=1
```

## Testing

### Quick Test (Low Cost)
```bash
# Set test mode to only do one API call
AI_TEST_MODE=1 npm start

# In Discord, send a coding request:
"make me a simple HTML landing page"

# Check logs:
# - Should see "Pipeline: direct_cached" if using cache-capable model
# - Should see "Pipeline: 3_stage" if using non-cache model
# - Check logs/{userId}/{persona}/{date}.log for detailed API call info
```

### Integration Test
```bash
npm run test:openrouter  # TODO: Create this script
```

### Unit Tests
```bash
# Test cached block stability
npm test -- modelCaps
npm test -- presets
npm test -- dedupe
```

## How to Test Quickly

1. **Set a caching-capable model:**
   ```bash
   export CODEGEN_MODEL="google/gemini-2.0-flash-exp:free"
   ```

2. **Send a coding request in Discord:**
   ```
   @bot make me a to-do list web app
   ```

3. **Check console output:**
   ```
   Pipeline: direct_cached
   Caching capable: true
   Coding model: google/gemini-2.0-flash-exp:free
   🚀 Using direct_cached pipeline (caching available)
   💻 Direct codegen complete: 3 files
   ```

4. **Verify logs:**
   ```bash
   cat logs/{your-user-id}/emma/$(date +%Y-%m-%d).log | jq .
   # Should see single entry with:
   # - "stage": "direct_cached"
   # - "pipeline": "direct_cached"
   # - "cacheRead" and "cacheCreation" fields (if caching worked)
   ```

5. **Test 3-stage fallback:**
   ```bash
   # Use a non-caching model
   export CODEGEN_MODEL="meta-llama/llama-3.1-8b-instruct:free"
   # OR disable caching
   export OPENROUTER_PROMPT_CACHE=0
   ```

## Files Changed

### New Files (7)
- `src/ai/modelCaps.ts`
- `src/ai/presets/index.ts`
- `src/ai/presets/static_html.ts`
- `src/ai/presets/web_app_node.ts`
- `src/ai/presets/discord_bot.ts`
- `src/ai/presets/node_cli.ts`
- `src/jobs/directCachedCoder.ts`
- `src/ai/openRouterLogger.ts`

### Modified Files (8)
- `src/ai/openRouterService.ts` - Content blocks support
- `src/jobs/types.ts` - PipelineType, diagnostics
- `src/jobs/index.ts` - Export directCachedCoder
- `src/jobs/codeGenerator.ts` - Type fixes
- `src/discord/requestDeduplication.ts` - Event dedupe, jobId tracking
- `src/discord/messageHandler.ts` - Pipeline switch, persona isolation
- `src/ai/contextService.ts` - Persona parameter
- `src/ai/fileContextManager.ts` - Persona-based paths
- `src/console/consoleChat.ts` - Type fixes

## Expected Behavior

### With Caching (Gemini 2.0 Flash, Claude Sonnet)
- Single LLM call for code generation
- Progress: "💻 Generating code with cached prompts..."
- Logs show: `pipeline: "direct_cached"`, `cacheRead`, `cacheCreation`
- Faster responses, lower token costs

### Without Caching (Other Models)
- Three LLM calls: prompter → planner → coder
- Progress: "Stage 1/3", "Stage 2/3", "Stage 3/3"
- Logs show: `pipeline: "3_stage"`
- Same quality output, more API calls

## Cost Comparison

### 3-Stage Pipeline (OLD)
- Prompter: ~2K tokens
- Planner: ~8K tokens
- Coder: ~15K tokens
- **Total: ~25K tokens/request**

### Direct Cached Pipeline (NEW)
- First request: ~15K tokens (creates cache)
- Subsequent requests: ~3K tokens (cache hit) + dynamic content
- **Savings: ~80% on cached requests**

## Troubleshooting

### "Pipeline: 3_stage" when expecting direct_cached
- Check model in `modelCaps.ts` allowlist
- Verify `OPENROUTER_PROMPT_CACHE=1` (not 0)
- Confirm model selected by router supports caching

### Invalid JSON after direct cached generation
- Check logs for parse errors
- Verify preset prompts are stable (no dynamic data)
- Retry should include full context - check logs for retry attempt

### Duplicate progress messages
- Check `discordEventRegistry.hasSeen()` logs
- Verify `setProgressMessageId()` called with jobId
- Ensure one message created per job

### Persona context bleed
- Check context file paths include `_{persona}` suffix
- Verify `contextService.load()` receives persona parameter
- Test by switching personas mid-conversation

## Future Enhancements

1. **Cache Hit Metrics:** Track cache hit rate per model
2. **Dynamic Preset Selection:** Allow users to choose templates
3. **Image Generation Integration:** Replace Placeholdit with actual generation
4. **Multi-Stage Caching:** Cache spec + plan outputs for 3-stage pipeline
5. **A/B Testing:** Compare direct_cached vs 3_stage quality
