# Model Pools Integration for Site Generator

## Overview
The site generation pipeline now uses deterministic model pools with tier-based routing, ensuring optimal model selection for each generation phase while maintaining the frozen layout architecture.

## Architecture

### Components
1. **ModelPoolsLoader** (`tools/modelPoolsLoader.ts`)
   - Loads `.cache/model-pools.json`
   - Computes model roles from tiers
   - Manages runtime trust cache
   - Fallback to hardcoded models if pools unavailable

2. **ModelScheduler** (`tools/modelScheduler.ts`)
   - Manages concurrent LLM calls with staggering
   - Round-robin model selection across BULK models
   - Rate limit detection and cooldown management
   - Priority-based queue processing

3. **ValidationHelpers** (`tools/validationHelpers.ts`)
   - Schema validation for JSON responses
   - Content validation for main HTML
   - Detects forbidden elements (header/footer in main content)
   - Thin content and malformed HTML detection

4. **OpenRouterClient** (updated)
   - Role-based model selection
   - Integration with model pools loader
   - Backward compatible (works without pools)

5. **generate-site.ts** (updated)
   - Phase 0: Uses BASE model exclusively
   - Phase 1: Uses BULK models with scheduler
   - Validation + escalation on failures
   - Trust cache tracking

## Model Roles

### BASE MODEL (Authority)
- **Model**: `qwen/qwen3-coder:free` (89% coding score, LARGE tier)
- **Fallback**: `nex-agi/deepseek-v3.1-nex-n1:free`
- **Used for**:
  - Phase 0: Sitemap, header, footer, CSS, JS
  - Foundation files that define the contract
  - Escalation when BULK models fail

### ESCALATION MODEL
- **Model**: Same as BASE model
- **Used for**:
  - Retry after 2 validation failures
  - Schema violations
  - Malformed/thin content

### BULK MODELS (Content Scale)
- **Pool**: SMALL tier (3 models) + unranked free models (28 models) = 31 models
- **Selection**: Round-robin with cooldown avoidance
- **Models**:
  - `mistralai/devstral-2512:free` (82%)
  - `kwaipilot/kat-coder-pro:free` (78%)
  - `nvidia/nemotron-3-nano-30b-a3b:free` (72%)
  - Plus 28 unranked free models
- **Used for**:
  - Phase 1: Main content generation ONLY
  - Must follow frozen layout contract
  - Cannot generate header/footer/nav/head

### MEDIUM MODELS
- **Pool**: MEDIUM tier (2 models)
- **Models**:
  - `google/gemini-2.0-flash-exp:free` (85%)
  - `deepseek/deepseek-r1-0528:free` (84%)
- **Reserved for**: Future feature pages (not currently used)

### NAMED MODELS (Legacy)
- **dev**: `mistralai/devstral-2512:free`
- **kat**: `kwaipilot/kat-coder-pro:free`
- **zip**: `qwen/qwen3-coder:free`

## Scheduler Configuration

### Settings
- **Max Concurrency**: 4 simultaneous calls
- **Stagger Delay**: 3000ms between call starts
- **Cooldown Duration**: 15000ms after rate limit
- **Max Escalation Retries**: 2 attempts before escalation

### Behavior
1. Calls start with 3s stagger (overlap allowed)
2. Round-robin through BULK models
3. Skip models in cooldown
4. Rate limit detection (429, 500 status codes)
5. Automatic cooldown management
6. Priority queue for retries

## Validation Pipeline

### Schema Validation
- Checks for `pages` array
- Validates `filename`, `mainHtml`, `title` fields
- Ensures expected filenames are returned

### Content Validation
- Must contain `<main>` tag
- NO forbidden elements: `<header>`, `<footer>`, `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`
- Minimum 200 chars of content (warns if less)
- Detects literal 'undefined' or 'null'
- Basic unclosed tag detection

### Escalation Flow
```
BULK Model Attempt 1
  ↓ (validation fails)
BULK Model Attempt 2
  ↓ (validation fails)
ESCALATION to BASE Model
  ↓ (still fails)
Fallback: Minimal HTML
```

## Runtime Trust Cache

### Location
`.cache/model-trust.json`

### Structure
```json
{
  "model-id": {
    "trusted": true,
    "testedAt": 1735104013000,
    "failures": 0,
    "successes": 5
  }
}
```

### Rules
- New models start as "untrusted"
- Mark trusted after first success
- Untrust if failures exceed successes by 3+
- Displayed at end of generation

## Usage

### Commands
```bash
# Generate site (uses model pools automatically)
npm run site:gen

# Validate generated site
npm run site:validate

# Zip for deployment
npm run site:zip

# Update model pools (if needed)
npm run models:sync
npm run models:rank
```

### Output
```
=== 🎨 Static Site Generator (Model Pools + Frozen Layout) ===

✓ Loaded model pools: 35 models, generated 25/12/2025, 03:00:13
✓ Model roles computed:
  BASE: qwen/qwen3-coder:free
  ESCALATION: qwen/qwen3-coder:free
  BULK (31): mistralai/devstral-2512:free, kwaipilot/kat-coder-pro:free, nvidia/nemotron-3-nano-30b-a3b:free...
  MEDIUM (2): google/gemini-2.0-flash-exp:free, deepseek/deepseek-r1-0528:free
  NAMED: dev=mistralai/devstral-2512:free, kat=kwaipilot/kat-coder-pro:free, zip=qwen/qwen3-coder:free

=== PHASE 0: Bulk Generation + Freeze Canonical Layout ===
Using BASE MODEL: qwen/qwen3-coder:free

[Phase 0 generates foundation files...]

=== PHASE 1: Parallel Generation (Main-Only) ===
Scheduler: 4 concurrent, 3000ms stagger
BULK MODELS (31): mistralai/devstral-2512:free, kwaipilot/kat-coder-pro:free...

[1/8] Starting getting-started.html, optifine-guide.html -> devstral-2512
  ✓ getting-started.html
  ✓ optifine-guide.html
[2/8] Starting sodium-guide.html, fps-optimization.html -> kat-coder-pro
  ✓ sodium-guide.html
  ✓ fps-optimization.html
...

✓ Phase 1 complete: 15 pages generated
  Scheduler stats: 0 inflight, 0 queued, 0 cooldowns

✓ Site generation complete!

📊 Model Trust Cache:
  ✓ mistralai/devstral-2512:free: 6 successes, 0 failures
  ✓ kwaipilot/kat-coder-pro:free: 5 successes, 0 failures
  ✓ nvidia/nemotron-3-nano-30b-a3b:free: 4 successes, 0 failures
```

## Acceptance Criteria

✅ **BASE Model Authority**: `qwen/qwen3-coder:free` used exclusively for Phase 0
✅ **BULK Model Scaling**: 31 models available for parallel content generation
✅ **Contract Enforcement**: BULK models only generate `<main>` content
✅ **No Drift**: Frozen header/footer/nav maintained across all pages
✅ **Deterministic**: Model selection follows predictable round-robin
✅ **Stable Under Load**: Scheduler manages concurrency, staggering, cooldowns
✅ **Escalation**: Failed validations retry with BASE model
✅ **Trust Cache**: Runtime tracking of model reliability

## Integration with Existing Features

### Frozen Layout (Preserved)
- Phase 0 still extracts and freezes canonical layout
- Phase 1 still generates main-only content
- Enforcement still wraps with frozen partials
- Validation still checks for drift

### Validation (Enhanced)
- Schema validation before content parsing
- Content validation for each page
- Escalation on validation failures
- Trust cache for model reliability

### Parallel Generation (Improved)
- Scheduler replaces ad-hoc concurrency management
- Staggering prevents rate limit cascades
- Cooldown management avoids thrashing
- Round-robin distributes load across BULK models

## Backward Compatibility

If model pools are unavailable (`.cache/model-pools.json` missing):
- Falls back to hardcoded models
- Legacy generation still works
- Warning logged but generation continues
- Run `npm run models:rank` to generate pools

## Future Enhancements

1. **MEDIUM Tier Usage**: Use MEDIUM models for feature-rich pages
2. **Adaptive Escalation**: Track which models require escalation most
3. **Performance Metrics**: Log tokens/s, cost, duration per model
4. **Smart Model Selection**: Use success rate to prioritize models
5. **Incremental Regeneration**: Only regenerate changed pages
