# Quick Testing Guide

## Test the Routing System

### 1. INSTANT Tier Tests

**Simple Greetings** (should use heuristic routing with 95% confidence):
```
hi
hello
hey there
good morning
what's up
```

Expected output in System embed:
- Tier: `INSTANT`
- Model: `xiaomi/mimo-v2-flash:free`
- Method: ⚡ Heuristic
- Confidence: 95%

---

### 2. SMART Tier Tests

**General Questions** (should use SMART for general chat):
```
what is the capital of France?
tell me about climate change
how do I make pasta?
```

**Tool Usage** (should detect tool needs and use SMART):
```
search for TypeScript best practices
what time is it in Tokyo?
calculate 15 * 23 + 42
convert 100 USD to EUR
```

Expected output in System embed:
- Tier: `SMART`
- Model: `deepseek/deepseek-r1-0528:free`
- Method: ⚡ Heuristic or 🤖 Router LLM (depending on ambiguity)
- Confidence: 85%+ for tool usage, 60%+ for general chat

---

### 3. THINKING Tier Tests

**Complex Analysis** (should detect explicit depth request):
```
explain in detail how machine learning works
analyze the pros and cons of remote work
walk me through the steps of building a compiler
compare and contrast SQL vs NoSQL databases
think deeply about the implications of AI
```

Expected output in System embed:
- Tier: `THINKING`
- Model: `google/gemma-3-27b-it:free`
- Method: ⚡ Heuristic
- Confidence: 90%

---

### 4. CODING Tier Tests

**Code Generation** (should detect code keywords/blocks):
```
write a function to reverse a string
debug this code: ```python
def foo():
    return bar
```

refactor this component
how do I implement a binary search in JavaScript?
review this code for improvements
```

Expected output in System embed:
- Tier: `CODING`
- Model: `google/gemma-3-12b-it:free`
- Method: ⚡ Heuristic
- Confidence: 95%

---

### 5. Router Model Fallback Tests

**Ambiguous Queries** (should trigger router LLM due to low heuristic confidence):
```
Tell me something interesting
What do you think about that?
Interesting...
```

Expected output in System embed:
- Tier: Usually `SMART`
- Model: Various (depends on router decision)
- Method: 🤖 Router LLM
- Confidence: 85%

Console should show:
```
🤔 Heuristics ambiguous (60%), using router model...
🎯 Routing: SMART (router model, 85% confidence)
```

---

### 6. Guardrail Tests

**Test INSTANT Retry** (send very short greeting and monitor logs):
```
hi
```

If the INSTANT model returns a low-quality response (very unlikely but possible):

Console should show:
```
⚠️ INSTANT response appears low-quality, retrying with SMART tier...
✅ Retry successful with SMART tier
```

System embed will show:
- Reason: `Simple greeting or small talk → Retried with SMART (low quality detected)`

---

## Observability Checklist

Every response should show in the System embed:

✅ **Routing & Model Selection**
- [x] Tier displayed
- [x] Model ID displayed
- [x] Routing method with icon
- [x] Routing reason
- [x] Confidence percentage

✅ **Token Usage** (even for free tier)
- [x] Total tokens
- [x] Prompt/completion breakdown
- [x] "Cost: Free tier" message

✅ **Performance**
- [x] Total time
- [x] LLM latency
- [x] Tool execution time (if applicable)

---

## Console Log Examples

### Successful Heuristic Routing
```
🎯 Routing message from username...
🎯 Routing: INSTANT (heuristic, 95% confidence)
```

### Router Model Fallback
```
🎯 Routing message from username...
🤔 Heuristics ambiguous (60%), using router model...
🎯 Routing: SMART (router model, 85% confidence)
```

### Guardrail Activation
```
🎯 Routing message from username...
🎯 Routing: INSTANT (heuristic, 95% confidence)
⚠️ INSTANT response appears low-quality, retrying with SMART tier...
✅ Retry successful with SMART tier
```

### Invalid Router Output
```
🤔 Heuristics ambiguous (60%), using router model...
⚠️ Router model returned invalid tier: "foobar", defaulting to SMART
🎯 Routing: SMART (router model, 85% confidence)
```

---

## Configuration Validation

On bot startup, you should see:
```
🔍 Validating routing configuration...
✅ Routing configuration valid
   Mode: hybrid
   Tiers configured: INSTANT, SMART, THINKING, CODING
   Router model: xiaomi/mimo-v2-flash:free

📊 Routing Configuration Summary:
   Mode: hybrid
   Router: xiaomi/mimo-v2-flash:free
   Confidence threshold: 80%

   Tier Models:
   - INSTANT    → xiaomi/mimo-v2-flash:free
   - SMART      → deepseek/deepseek-r1-0528:free
   - THINKING   → google/gemma-3-27b-it:free
   - CODING     → google/gemma-3-12b-it:free
```

---

## Troubleshooting

### Issue: All queries use router model
- Check confidence threshold: `ROUTING_CONFIDENCE_THRESHOLD` (should be 80)
- Verify heuristics are working in console logs

### Issue: Models not responding
- Check OpenRouter API key is valid
- Verify model IDs are correct (check OpenRouter dashboard)
- Check rate limits on free tier models

### Issue: INSTANT tier always retries
- The xiaomi/mimo-v2-flash model might be having issues
- Check console logs for quality check triggers
- May need to adjust quality check thresholds

### Issue: Routing shows wrong tier
- Check heuristic patterns in `routerService.ts`
- Verify message analysis flags are correct
- Check console logs for routing decisions

---

## Expected Performance

- **INSTANT responses**: < 2 seconds
- **SMART responses**: 2-5 seconds
- **THINKING responses**: 5-10 seconds
- **CODING responses**: 3-7 seconds

Router model should add minimal latency (~200-500ms) when triggered.
