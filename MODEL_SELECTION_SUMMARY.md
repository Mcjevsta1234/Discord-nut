# Model Selection & Router Configuration - Implementation Summary

## Overview
Successfully finalized the 4-tier automatic routing system using FREE OpenRouter models with centralized configuration and robust guardrails.

---

## 1. Final Tier → Model Mapping

### INSTANT Tier
- **Model**: `xiaomi/mimo-v2-flash:free`
- **Purpose**: Greetings, short chat, acknowledgements
- **Max Prompt Tokens**: 4,000
- **Max Output Tokens**: 256 (aggressive limiting)
- **Provider**: Xiaomi
- **Tool Support**: No (simple responses only)
- **Why chosen**: Ultra-fast, minimal tokens for simple responses

### SMART Tier
- **Model**: `deepseek/deepseek-r1-0528:free`
- **Purpose**: Normal chat, explanations, Q&A, tool usage
- **Max Prompt Tokens**: 32,000
- **Max Output Tokens**: 8,000
- **Provider**: DeepSeek
- **Tool Support**: Yes
- **Why chosen**: Strong general reasoning with good tool-calling capabilities

### THINKING Tier
- **Model**: `google/gemma-3-27b-it:free`
- **Purpose**: Long, detailed, multi-step reasoning
- **Max Prompt Tokens**: 64,000
- **Max Output Tokens**: 16,000
- **Provider**: Google
- **Tool Support**: Yes
- **Why chosen**: Largest model (27B params) for complex analysis and deep reasoning

### CODING Tier
- **Model**: `google/gemma-3-12b-it:free`
- **Purpose**: Coding, debugging, repo questions
- **Max Prompt Tokens**: 32,000
- **Max Output Tokens**: 8,000
- **Provider**: Google
- **Tool Support**: Yes
- **Why chosen**: Strong instruction-following (12B params) ideal for code generation

---

## 2. Router Model Configuration

### Router LLM
- **Model**: `xiaomi/mimo-v2-flash:free`
- **Routing Mode**: `hybrid` (heuristics first, router LLM only when ambiguous)
- **Temperature**: 0 (deterministic)
- **Max Tokens**: 32 (output constraint)
- **Output Format**: Exactly one of: `INSTANT | SMART | THINKING | CODING`
- **Why chosen**: Ultra-cheap and fast for classification tasks

### Confidence Threshold
- **Threshold**: 80%
- **Behavior**: Heuristics with confidence ≥80% are used directly; below 80% triggers router LLM

---

## 3. Routing Heuristics (Pre-Router)

Heuristics handle obvious cases without calling the router model:

### High Confidence Rules (95%+)
1. **Greetings** → INSTANT
   - Patterns: "hi", "hey", "hello", "good morning", etc.
   - Max 10 words

2. **Code Blocks** → CODING
   - Patterns: \`\`\`, function definitions, imports, class declarations
   - Keywords: refactor, debug, code review

### High Confidence Rules (90%+)
3. **Explicit Depth Request** → THINKING
   - Patterns: "explain in detail", "analyze deeply", "step by step"
   - Keywords: compare and contrast, pros and cons, deep dive

### Medium-High Confidence (85%+)
4. **Tool/Search Required** → SMART
   - Patterns: search, look up, find information, calculate, convert
   - Tool-calling capability required

### Medium Confidence (75%+)
5. **Short Query** → INSTANT
   - Word count ≤ 15
   - No code or complex requirements

### Medium-Low Confidence (70%+)
6. **Long Context** → SMART
   - Message length > 2000 chars
   - Estimated tokens > 8000

### Ambiguous (60%) - Triggers Router Model
7. **Default** → SMART
   - General queries that don't match patterns above
   - Low confidence triggers router LLM call

---

## 4. Guardrails & Fallbacks

### Router LLM Output Validation
- **Invalid Output**: Defaults to SMART tier
- **Empty Output**: Defaults to SMART tier
- **Logging**: All invalid outputs are logged with warnings

### INSTANT Tier Quality Check
Automatic retry with SMART tier if INSTANT response:
- Is empty or < 10 characters
- Contains error patterns (e.g., "error", "failed", "unable")
- Shows malformed JSON or gibberish
- Contains "undefined", "null", or "[object Object]"

### Retry Policy
- **Max Retries**: 1 (configurable via `ROUTING_MAX_RETRIES`)
- **Retry Strategy**: Upgrade to higher tier
  - INSTANT → SMART
  - SMART → THINKING
- **Logging**: All retries are logged with reason

### Error Handling
- Router model failures fall back to heuristic decision
- All routing failures are logged with context

---

## 5. Observability

### System/Reasoning Embed
Every response shows in the "🎯 Routing & Model Selection" section:

```
🎯 Routing & Model Selection
• Tier: `INSTANT`
• Model: `xiaomi/mimo-v2-flash:free`
• Method: ⚡ Heuristic / 🤖 Router LLM / 🔀 Hybrid
• Reason: Simple greeting or small talk
• Confidence: 95%
• Persona: `emma`
```

### Routing Method Icons
- ⚡ **Heuristic**: Used pattern-based routing
- 🤖 **Router LLM**: Used AI model for classification
- 🔀 **Hybrid**: Combination (shows which was actually used)

### Retry Visibility
When a retry occurs, the routing reason updates:
```
• Reason: Simple greeting or small talk → Retried with SMART (low quality detected)
```

### Console Logging
- `🎯 Routing: INSTANT (heuristic, 95% confidence)`
- `🤔 Heuristics ambiguous (60%), using router model...`
- `⚠️ INSTANT response appears low-quality, retrying with SMART tier...`
- `✅ Retry successful with SMART tier`

---

## 6. Code Organization

### Centralized Configuration
**File**: [src/config/routing.ts](src/config/routing.ts)
- Single source of truth for all model assignments
- Environment variable overrides supported
- Validation on startup

### Router Logic
**File**: [src/ai/routerService.ts](src/ai/routerService.ts)
- `route()`: Main routing entry point
- `analyzeMessage()`: Extract routing flags
- `routeByHeuristics()`: Pattern-based routing
- `routeByModel()`: LLM-based routing
- `getHigherTier()`: Retry escalation logic

### API Layer
**File**: [src/ai/openRouterService.ts](src/ai/openRouterService.ts)
- Updated `chatCompletionWithMetadata()` to accept temperature/max_tokens
- Supports router constraints (temp=0, max_tokens=32)

### Message Handling
**File**: [src/discord/messageHandler.ts](src/discord/messageHandler.ts)
- Routing decision before planning
- Quality check for INSTANT responses
- Automatic retry with higher tier
- Routing metadata passed to renderer

### Response Rendering
**File**: [src/discord/responseRenderer.ts](src/discord/responseRenderer.ts)
- Enhanced routing section with icons
- Always shows tier, model, method, reason, confidence
- Works even for trivial messages

---

## 7. Environment Variable Overrides

All defaults can be overridden via environment variables:

```bash
# Routing Configuration
ROUTING_MODE=hybrid                     # heuristic | routerModel | hybrid
MODEL_ROUTER=xiaomi/mimo-v2-flash:free
ROUTING_CONFIDENCE_THRESHOLD=80         # 0-100
ROUTING_MAX_RETRIES=1
ROUTING_RETRY_HIGHER_TIER=true

# Tier Models
MODEL_INSTANT=xiaomi/mimo-v2-flash:free
MODEL_SMART=deepseek/deepseek-r1-0528:free
MODEL_THINKING=google/gemma-3-27b-it:free
MODEL_CODING=google/gemma-3-12b-it:free

# Token Limits (per tier)
MODEL_INSTANT_MAX_PROMPT=4000
MODEL_INSTANT_MAX_OUTPUT=256
MODEL_SMART_MAX_PROMPT=32000
MODEL_SMART_MAX_OUTPUT=8000
MODEL_THINKING_MAX_PROMPT=64000
MODEL_THINKING_MAX_OUTPUT=16000
MODEL_CODING_MAX_PROMPT=32000
MODEL_CODING_MAX_OUTPUT=8000
```

---

## 8. Testing Recommendations

### Test Cases

1. **INSTANT Tier**
   - "hi" → Should route to INSTANT via heuristic
   - "hey there!" → Should route to INSTANT with 95% confidence
   - Malformed INSTANT response → Should retry with SMART

2. **SMART Tier**
   - "what's the weather like?" → SMART (general query)
   - "search for Python tutorials" → SMART (tool usage)
   - "calculate 15 * 23" → SMART (tool required)

3. **THINKING Tier**
   - "explain in detail how quantum computing works" → THINKING
   - "analyze pros and cons of microservices" → THINKING

4. **CODING Tier**
   - "write a function to sort an array" → CODING
   - "debug this code: \`\`\`python..." → CODING
   - "explain this repo: owner/repo" → CODING

5. **Router Model Fallback**
   - Ambiguous queries that don't match heuristics
   - Should trigger router LLM with clear logging

6. **Guardrails**
   - Empty INSTANT response → Should retry with SMART
   - Invalid router output → Should default to SMART

---

## Summary of Changes

### Modified Files
1. ✅ [src/config/routing.ts](src/config/routing.ts) - Updated all tier model IDs and token limits
2. ✅ [src/ai/routerService.ts](src/ai/routerService.ts) - Enhanced heuristics, improved router prompt, added guardrails
3. ✅ [src/ai/openRouterService.ts](src/ai/openRouterService.ts) - Added temperature/max_tokens support
4. ✅ [src/discord/messageHandler.ts](src/discord/messageHandler.ts) - Added quality check and retry logic
5. ✅ [src/discord/responseRenderer.ts](src/discord/responseRenderer.ts) - Enhanced routing display with icons

### Key Improvements
- ✅ All tiers use FREE OpenRouter models
- ✅ Router uses ultra-cheap xiaomi/mimo-v2-flash:free with strict constraints
- ✅ Hybrid routing minimizes router LLM calls
- ✅ Guardrails prevent low-quality INSTANT responses
- ✅ Full transparency in routing decisions
- ✅ Comprehensive logging for debugging
- ✅ Clean, centralized configuration
- ✅ Personas remain model-agnostic
- ✅ No TypeScript errors

---

## Why These Models?

| Model | Params | Use Case | Reasoning |
|-------|--------|----------|-----------|
| **xiaomi/mimo-v2-flash** | Small | INSTANT + Router | Ultra-fast, minimal tokens, perfect for greetings and routing classification |
| **deepseek-r1-0528** | 7B-class | SMART | Strong general reasoning, excellent tool-calling, good for most conversations |
| **gemma-3-27b-it** | 27B | THINKING | Largest available, best for complex multi-step reasoning |
| **gemma-3-12b-it** | 12B | CODING | Strong instruction-following, good for code generation without being oversized |

All models are FREE on OpenRouter, ensuring cost-effective operation while maintaining quality across all tiers.
