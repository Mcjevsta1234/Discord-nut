/**
 * Example: Using model pools in generate-site.ts
 * 
 * This shows how to integrate the model pools system with the site generator.
 */

import fs from 'fs';
import path from 'path';

const POOLS_FILE = path.join(__dirname, '../../.cache/model-pools.json');

interface ModelPools {
  generatedAt: number;
  chosenDefaults: {
    bulkModel: string;
    pageModel: string;
    smallTasksModel: string;
  };
  tiers: Array<{
    name: 'SMALL' | 'MEDIUM' | 'LARGE';
    models: string[];
  }>;
  models: Array<{
    openRouterModelId: string;
    codingScore: number;
    contextLength: number;
    ranked: boolean;
  }>;
}

// Load model pools
function loadModelPools(): ModelPools | null {
  if (!fs.existsSync(POOLS_FILE)) {
    console.warn('⚠ Model pools not found. Run: npm run models:rank');
    return null;
  }
  
  const pools: ModelPools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf-8'));
  
  // Check if stale (> 7 days)
  const age = Date.now() - pools.generatedAt;
  if (age > 7 * 24 * 60 * 60 * 1000) {
    console.warn('⚠ Model pools are stale (>7d). Consider running: npm run models:rank');
  }
  
  return pools;
}

// STRATEGY 1: Use chosen defaults
function useDefaultModels() {
  const pools = loadModelPools();
  if (!pools) {
    // Fallback to hardcoded
    return {
      bulk: 'kwaipilot/kat-coder-pro:free',
      page: 'mistralai/devstral-2512:free',
      small: 'qwen/qwen3-coder:free'
    };
  }
  
  return {
    bulk: pools.chosenDefaults.bulkModel,
    page: pools.chosenDefaults.pageModel,
    small: pools.chosenDefaults.smallTasksModel
  };
}

// STRATEGY 2: Select from specific tiers
function selectByTier(tierName: 'SMALL' | 'MEDIUM' | 'LARGE', index = 0): string | null {
  const pools = loadModelPools();
  if (!pools) return null;
  
  const tier = pools.tiers.find(t => t.name === tierName);
  if (!tier || tier.models.length === 0) return null;
  
  return tier.models[Math.min(index, tier.models.length - 1)];
}

// STRATEGY 3: Round-robin across tiers
function* tierRoundRobin(tierName: 'SMALL' | 'MEDIUM' | 'LARGE') {
  const pools = loadModelPools();
  if (!pools) return;
  
  const tier = pools.tiers.find(t => t.name === tierName);
  if (!tier) return;
  
  let index = 0;
  while (true) {
    yield tier.models[index % tier.models.length];
    index++;
  }
}

// STRATEGY 4: Smart selection by context requirements
function selectByContextRequirement(minContext: number): string | null {
  const pools = loadModelPools();
  if (!pools) return null;
  
  // Filter ranked models with sufficient context
  const suitable = pools.models.filter(
    m => m.ranked && m.contextLength >= minContext
  );
  
  if (suitable.length === 0) return null;
  
  // Sort by codingScore desc
  suitable.sort((a, b) => b.codingScore - a.codingScore);
  
  return suitable[0].openRouterModelId;
}

// EXAMPLE USAGE IN SITE GENERATOR

// Phase 0: Use best model for bulk generation (needs high context)
async function phase0Example() {
  const pools = loadModelPools();
  
  // Prefer LARGE tier first model
  const bulkModel = selectByTier('LARGE', 0) || pools?.chosenDefaults.bulkModel || 'kwaipilot/kat-coder-pro:free';
  
  console.log(`Phase 0 bulk generation: ${bulkModel}`);
  // await client.callLLM(prompt, { preferredModel: bulkModel });
}

// Phase 1: Distribute across MEDIUM tier for parallel generation
async function phase1Example() {
  const mediumGen = tierRoundRobin('MEDIUM');
  
  for (let i = 0; i < 8; i++) {
    const model = mediumGen.next().value;
    console.log(`Batch ${i}: ${model}`);
    // await client.callLLM(prompt, { preferredModel: model });
  }
}

// Adaptive: Choose based on task complexity
async function adaptiveExample(complexityScore: number) {
  let model: string | null;
  
  if (complexityScore > 0.8) {
    // Hard task: use LARGE tier
    model = selectByTier('LARGE', 0);
  } else if (complexityScore > 0.4) {
    // Medium task: use MEDIUM tier
    model = selectByTier('MEDIUM', 0);
  } else {
    // Simple task: use SMALL tier (fastest)
    model = selectByTier('SMALL', 0);
  }
  
  console.log(`Task complexity ${complexityScore}: ${model}`);
}

// Context-aware selection
async function contextAwareExample() {
  // Need 100k context for this task
  const model = selectByContextRequirement(100000);
  console.log(`100k+ context model: ${model}`);
}

// Export for use
export {
  loadModelPools,
  useDefaultModels,
  selectByTier,
  tierRoundRobin,
  selectByContextRequirement
};
