# Model Selection Rationale

## Why These Specific Models?

This document explains the reasoning behind each model selection for the 4-tier routing system.

---

## Tier Assignments

### INSTANT Tier: `xiaomi/mimo-v2-flash:free`

**Requirements:**
- Ultra-fast response time (< 1s)
- Minimal token usage
- Good for simple, deterministic outputs
- Greetings and acknowledgements only

**Why Xiaomi MIMO V2 Flash:**
- ✅ Optimized for speed (flash variant)
- ✅ FREE tier with no rate limits
- ✅ Good at short, conversational responses
- ✅ Minimal overhead for simple tasks
- ✅ Reliable for greetings and small talk

**Alternatives Considered:**
- ❌ `mistralai/mistral-7b-instruct:free` - Too slow for instant responses
- ❌ `google/gemma-3-12b-it:free` - Overkill for greetings
- ❌ `openai/gpt-oss-20b:free` - Larger model, slower response time

**Token Limits:**
- Prompt: 4,000 tokens (sufficient for greeting + context)
- Output: 256 tokens (aggressive limiting for instant responses)

---

### SMART Tier: `deepseek/deepseek-r1-0528:free`

**Requirements:**
- General-purpose reasoning
- Tool-calling support
- Balanced speed/quality
- Handles most conversations
- Good at web search, calculations, API calls

**Why DeepSeek R1:**
- ✅ Strong reasoning capabilities (R1 series)
- ✅ Excellent tool-calling support
- ✅ Good instruction-following
- ✅ FREE tier on OpenRouter
- ✅ Balanced between speed and quality
- ✅ Reliable for general Q&A
- ✅ Good at integrating tool results

**Alternatives Considered:**
- ❌ `mistralai/mistral-7b-instruct:free` - Weaker tool-calling
- ❌ `google/gemma-3-27b-it:free` - Too large/slow for general chat
- ❌ `z-ai/glm-4.5-air:free` - Less proven for tool usage

**Token Limits:**
- Prompt: 32,000 tokens (enough for conversation history + tool results)
- Output: 8,000 tokens (sufficient for detailed responses)

---

### THINKING Tier: `google/gemma-3-27b-it:free`

**Requirements:**
- Deep, multi-step reasoning
- Complex analysis and explanations
- Long-form content generation
- "Explain in detail" queries
- Comparative analysis

**Why Gemma 3 27B:**
- ✅ Largest available free model (27B parameters)
- ✅ Strong reasoning capabilities
- ✅ Excellent at step-by-step explanations
- ✅ Good at comparative analysis
- ✅ Handles long contexts well
- ✅ Instruction-tuned (it variant)
- ✅ FREE tier from Google

**Alternatives Considered:**
- ❌ `openai/gpt-oss-20b:free` - Smaller (20B vs 27B)
- ❌ `deepseek/deepseek-r1-0528:free` - Already used for SMART
- ❌ `google/gemma-3-12b-it:free` - Half the size, less reasoning power

**Token Limits:**
- Prompt: 64,000 tokens (large context for complex queries)
- Output: 16,000 tokens (allows for detailed, long-form responses)

---

### CODING Tier: `google/gemma-3-12b-it:free`

**Requirements:**
- Code generation and debugging
- Strong instruction-following
- Good at formatting (markdown, code blocks)
- Repository analysis
- Refactoring suggestions

**Why Gemma 3 12B:**
- ✅ Strong instruction-following (12B sweet spot)
- ✅ Good at structured output (code blocks)
- ✅ Instruction-tuned for coding tasks
- ✅ Not oversized (faster than 27B)
- ✅ FREE tier from Google
- ✅ Consistent with THINKING tier (same model family)
- ✅ Reliable formatting

**Alternatives Considered:**
- ❌ `mistralai/mistral-7b-instruct:free` - Weaker at code generation
- ❌ `google/gemma-3-27b-it:free` - Too large for code tasks
- ❌ `deepseek/deepseek-r1-0528:free` - Already used for SMART
- ❌ `openai/gpt-oss-20b:free` - Less proven for code

**Token Limits:**
- Prompt: 32,000 tokens (enough for code files + context)
- Output: 8,000 tokens (sufficient for code + explanations)

---

## Router Model: `xiaomi/mimo-v2-flash:free`

**Requirements:**
- Ultra-fast classification
- Cheap/free to minimize costs
- Deterministic output (temperature = 0)
- Tiny output (just tier name)

**Why Xiaomi MIMO V2 Flash:**
- ✅ Fastest available free model
- ✅ Good at simple classification
- ✅ Minimal latency overhead
- ✅ FREE tier
- ✅ Reliable for structured output
- ✅ Same model as INSTANT tier (consistency)

**Constraints:**
- Temperature: 0 (deterministic)
- Max Tokens: 32 (just "INSTANT", "SMART", "THINKING", or "CODING")

**Alternatives Considered:**
- ❌ `mistralai/mistral-7b-instruct:free` - Slower, unnecessary for classification
- ❌ `google/gemma-3-12b-it:free` - Too large for simple routing
- ❌ `deepseek/deepseek-r1-0528:free` - Overkill for binary decision

---

## Hybrid Routing Strategy

### Why Heuristics First?
- ✅ **Instant**: No API call for 70%+ of queries
- ✅ **Deterministic**: Same input always gives same tier
- ✅ **Free**: No cost for obvious cases
- ✅ **Reliable**: Pattern-based rules are predictable

### When Router Model is Called
- Ambiguous queries (heuristic confidence < 80%)
- Queries that don't match clear patterns
- Edge cases between tiers

### Benefits
1. **Cost Savings**: Avoid router LLM for obvious cases
2. **Speed**: Heuristics are instant
3. **Intelligence**: Router model handles edge cases
4. **Reliability**: Fallback if router fails

---

## Model Comparison Table

| Model | Params | Speed | Reasoning | Tools | Code | Free | Use Case |
|-------|--------|-------|-----------|-------|------|------|----------|
| **xiaomi/mimo-v2-flash** | Small | ⚡⚡⚡⚡⚡ | ⭐⭐ | ❌ | ⭐ | ✅ | INSTANT + Router |
| **deepseek-r1-0528** | ~7B | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐ | ✅ | SMART (general) |
| **gemma-3-27b-it** | 27B | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐ | ✅ | THINKING (deep) |
| **gemma-3-12b-it** | 12B | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ | ✅ | CODING |

---

## Token Limit Philosophy

### INSTANT (256 tokens)
- **Aggressive limiting**: Forces concise responses
- **Purpose**: Greetings should be short
- **Benefit**: Prevents rambling, faster responses

### SMART (8,000 tokens)
- **Balanced**: Enough for detailed answers
- **Purpose**: Normal conversations
- **Benefit**: Not too verbose, not too brief

### THINKING (16,000 tokens)
- **Generous**: Allows deep explanations
- **Purpose**: Complex analysis
- **Benefit**: No artificial cutoffs for detailed responses

### CODING (8,000 tokens)
- **Moderate**: Sufficient for code + explanation
- **Purpose**: Code files with context
- **Benefit**: Enough for full implementations

---

## Why NOT These Models?

### `mistralai/mistral-7b-instruct:free`
- ❌ Slower than xiaomi for instant responses
- ❌ Weaker tool-calling than DeepSeek
- ❌ Not specialized for any particular tier

### `z-ai/glm-4.5-air:free`
- ❌ Less proven in production
- ❌ Fewer community benchmarks
- ❌ Unknown tool-calling performance

### `openai/gpt-oss-20b:free`
- ❌ Smaller than Gemma 27B for THINKING
- ❌ Not specialized for coding vs Gemma 12B
- ❌ Less instruction-following than DeepSeek

---

## Future Considerations

### If Models Change or Become Unavailable

**INSTANT Alternatives:**
1. `mistralai/mistral-7b-instruct:free`
2. Any small, fast free model

**SMART Alternatives:**
1. `mistralai/mistral-7b-instruct:free`
2. `z-ai/glm-4.5-air:free`
3. `google/gemma-3-12b-it:free`

**THINKING Alternatives:**
1. `openai/gpt-oss-20b:free`
2. `google/gemma-3-12b-it:free` (downgrade)

**CODING Alternatives:**
1. `deepseek/deepseek-r1-0528:free`
2. `mistralai/mistral-7b-instruct:free`
3. `google/gemma-3-27b-it:free` (upgrade)

### Easy Migration
All model IDs are in [src/config/routing.ts](src/config/routing.ts) - just update the defaults or set environment variables:

```bash
export MODEL_INSTANT="new-model:free"
export MODEL_SMART="new-model:free"
export MODEL_THINKING="new-model:free"
export MODEL_CODING="new-model:free"
```

---

## Cost Analysis

All selected models are FREE on OpenRouter:
- **Total Cost**: $0.00/month
- **INSTANT**: Free (unlimited)
- **SMART**: Free (unlimited)
- **THINKING**: Free (may have rate limits)
- **CODING**: Free (may have rate limits)
- **Router**: Free (unlimited)

**Estimated Usage:**
- 70% of queries use heuristics (no router cost)
- 30% use router model (~$0.00)
- All response tiers are free
- **Total monthly cost**: $0.00

---

## Performance Expectations

### Latency Targets
- **INSTANT**: < 2s (including network)
- **SMART**: 2-5s
- **THINKING**: 5-10s
- **CODING**: 3-7s
- **Router**: +200-500ms (when triggered)

### Accuracy Targets
- **Heuristics**: 95%+ accuracy for clear cases
- **Router Model**: 85%+ accuracy for ambiguous cases
- **Guardrails**: < 1% retry rate

---

## Conclusion

The selected models provide:
- ✅ **Zero cost** (all free tier)
- ✅ **Optimal performance** (right-sized for each task)
- ✅ **Reliable routing** (hybrid approach)
- ✅ **Full observability** (complete transparency)
- ✅ **Easy migration** (centralized config)

This configuration balances speed, quality, and cost while maintaining full transparency and flexibility.
