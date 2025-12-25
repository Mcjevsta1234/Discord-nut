# Coding Request Fix - Summary

## Problem
Coding requests like "code me this html website" or "build me a landing page" were triggering searxng_search tool instead of routing to the CODING tier for code generation.

## Root Causes

### 1. Planner Interference
The `shouldUsePlanner()` method included generic keywords like `'generate'`, `'create'`, `'make an'` that matched coding requests, causing the planner to be invoked even when routing correctly identified CODING tier.

### 2. Weak Coding Intent Detection
The `hasCodingIntent()` patterns were too rigid:
- Required exact word sequences without gaps
- Didn't account for natural language variations like "build me a **full** landing page"

### 3. Tool Actions Blocked Codegen
When planner created tool actions (searxng_search), the check `routingDecision.tier === 'CODING' && !hasExecutableActions` would fail because `hasExecutableActions` was true.

## Fixes Applied

### 1. Skip Planner for CODING Tier
```typescript
// messageHandler.ts - Line ~305
const plannerNeeded = routingDecision.tier === 'CODING'
  ? false  // Skip planner entirely for coding requests
  : routingDecision.tier === 'INSTANT'
  ? true
  : this.shouldUsePlanner(messageWithContext);
```

### 2. Improved Coding Intent Patterns
```typescript
// routerService.ts - Line ~172
private hasCodingIntent(userMessage: string): boolean {
  const intentPatterns = [
    // Flexible patterns that allow words between verb and target
    /(build|create|make|code|write|develop|design)\s+.{0,50}(website|web\s*app|...)/,
    /(scaffold|generate|spin\s*up|draft|setup|set\s*up)\s+.{0,30}(react|next\.?js|...)/,
    // ... more patterns
  ];
  return intentPatterns.some((pattern) => pattern.test(normalized));
}
```

### 3. Removed Coding Keywords from Planner Triggers
```typescript
// messageHandler.ts - Line ~1085
const toolKeywords = [
  'search',
  'look up',
  'lookup',
  // ... removed: 'generate', 'create', 'draw', 'make an', etc.
  'minecraft',
  // ...
];
```

### 4. Removed Stale `/codegen` Reference
Updated system guidance to remove non-existent `/codegen` command reference.

## Testing

### Unit Tests Created
1. **routerCodingIntent.test.ts** - Verifies coding intent routing to CODING tier
2. **routingComprehensive.test.ts** - Tests 9 scenarios across all tiers
3. **codingIntentDebug.test.ts** - Pattern validation debugging

### Test Results
```
✅ All 9 comprehensive routing tests passed:
   - 6 coding requests → CODING tier
   - 2 search/tool requests → SMART tier  
   - 1 greeting → INSTANT tier
```

## Flow After Fix

1. User: "code me a website"
2. Router detects coding intent via `hasCodingIntent()` → flags `containsCode: true`
3. Heuristic routing: Rule 2 matched → CODING tier (95% confidence)
4. Planner: **SKIPPED** (plannerNeeded = false for CODING tier)
5. No executable actions → condition `!hasExecutableActions` is true
6. Codegen path triggered: ProjectRouter → createJob → runDirectCachedCodegen
7. Zip archive created and sent to user

## Verification Commands

```bash
# Build
npm run build

# Run tests
npx tsx tests/routerCodingIntent.test.ts
npx tsx tests/routingComprehensive.test.ts
npx tsx tests/codingIntentDebug.test.ts

# Start bot
npm start
```

## Files Modified
- `src/discord/messageHandler.ts` - Skip planner for CODING tier, remove coding keywords
- `src/llm/routerService.ts` - Improved coding intent patterns
- `tests/routerCodingIntent.test.ts` - Basic routing test
- `tests/routingComprehensive.test.ts` - Full coverage test
- `tests/codingIntentDebug.test.ts` - Pattern debugging

## Next Steps
1. Restart bot: `npm start`
2. Test with: "code me a landing page for my startup"
3. Verify codegen is triggered and zip file is generated
4. Monitor logs for "🧪 CODING tier detected - routing to project handler"
