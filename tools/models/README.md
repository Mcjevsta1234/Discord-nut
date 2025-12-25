# Model Pools System

Automated discovery, ranking, and tiering of free OpenRouter models based on coding benchmark scores.

## Quick Start

```bash
# Fetch latest free models and coding scores
npm run models:sync

# Generate ranked model pools with tiers + HTML report
npm run models:rank

# Generate and open HTML report in browser
npm run models:report

# Validate the system
npx tsx tools/models/validate-pools.ts
```

## How It Works

### 1. OpenRouter Discovery (`sync-openrouter.ts`)
- Fetches all models from OpenRouter API
- Filters for free models (`:free` suffix or `pricing.prompt === "0"`)
- Caches to `.cache/openrouter-models.json` (24hr TTL)

### 2. Coding Score Calculation (`sync-llm-stats.ts`)
- Uses curated benchmark scores from public sources
- Focuses on coding-relevant benchmarks:
  - LiveCodeBench (3.0x weight)
  - SWE-bench Verified (2.5x weight)
  - HumanEval family (1.0-1.5x weight)
  - Aider-Polyglot (2.0x weight)
- Normalized weighted average: 0..1

### 3. Model Matching (`match-models.ts`)
- Matches OpenRouter IDs to benchmark model names
- Three strategies:
  1. Manual overrides (`model-id-overrides.json`)
  2. Exact normalized match
  3. Fuzzy string similarity (≥70% confidence)
- Outputs: `{ openRouterModelId, codingScore, contextLength, ranked }`

### 4. Tier Assignment (`rank-models.ts`)
- **LARGE**: Top 15% (best coding scores + context)
- **MEDIUM**: 50-85th percentile
- **SMALL**: Bottom 50% (fast/cheap)
- Auto-selects defaults:
  - `bulkModel`: Best ranked free coding model
  - `pageModel`: 2nd best
  - `smallTasksModel`: First MEDIUM tier model
- Outputs: 
  - `.cache/model-pools.json` (machine-readable)
  - `.cache/model-pools-report.html` (beautiful dark-themed report)

## Cache Files

| File | Purpose | TTL |
|------|---------|-----|
| `.cache/openrouter-models.json` | Free models list | 24 hours |
| `.cache/model-pools-report.html` | Beautiful dark-themed report | Manual refresh |
| `.cache/llm-stats-data/` | Benchmark data (unused currently) | 7 days |
| `.cache/model-pools.json` | Final ranked tiers | Manual refresh |

## Model Overrides

Edit `tools/models/model-id-overrides.json` to manually map OpenRouter IDs to benchmark names:

```json
{
  "overrides": {
    "mistralai/devstral-2512:free": "devstral-2412",
    "qwen/qwen3-coder:free": "qwen-2.5-coder-32b-instruct"
  }
}
```

## Curated Scores

If the llm-stats repo is unavailable, the system falls back to `curated-scores.ts` with manually verified benchmarks from:
- Model provider blogs (Qwen, DeepSeek, Mistral, etc)
- Public leaderboards (LiveCodeBench, HumanEval)
- Published papers

## Integration with Site Generator

The generated `.cache/model-pools.json` can be consumed by `tools/generate-site.ts`:

```typescript
import fs from 'fs';
const pools = JSON.parse(fs.readFileSync('.cache/model-pools.json', 'utf-8'));

// Use chosen defaults
const bulkModel = pools.chosenDefaults.bulkModel;
const pageModel = pools.chosenDefaults.pageModel;

// Or select from tiers
const largeTier = pools.tiers.find(t => t.name === 'LARGE');
const bestModel = largeTier.models[0];
```

## Commands

```bash
# Force refresh all caches
npm run models:sync -- --force
npm run models:rank -- --force
Generate and open HTML report
npm run models:report

# 
# Match models only (debugging)
npm run models:match

# Validate tier distribution and scoring
npx tsx tools/models/validate-pools.ts
```

## Output Example

```
Top 10 free coding models:
  1. qwen/qwen3-coder:free
     Score: 89.0%, Context: 262,000, Tier: LARGE
  2. nex-agi/deepseek-v3.1-nex-n1:free
     Score: 88.0%, Context: 131,072, Tier: LARGE
  3. google/gemini-2.0-flash-exp:free
     Score: 85.0%, Context: 1,048,576, Tier: MEDIUM
```

## Architecture

- **Deterministic**: Same inputs always produce same tiers
- **Cached**: Network calls minimized with TTL-based caching
- **Resilient**: Retries with exponential backoff
- **Fallback**: Curated scores when external data unavailable
- **Isolated**: Only affects site-gen workflow, not Discord bot
