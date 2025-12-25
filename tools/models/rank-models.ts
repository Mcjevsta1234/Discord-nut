import fs from 'fs';
import path from 'path';
import { matchModels } from './match-models';
import { generateHtmlReport } from './generate-report';

const CACHE_DIR = path.join(__dirname, '../../.cache');
const OUTPUT_FILE = path.join(CACHE_DIR, 'model-pools.json');

interface MatchedModel {
  openRouterModelId: string;
  openRouterName: string;
  contextLength: number;
  codingScore: number;
  benchmarks: Record<string, number>;
  ranked: boolean;
  matchMethod: string;
}

interface ModelTier {
  name: 'SMALL' | 'MEDIUM' | 'LARGE';
  description: string;
  models: string[];
}

interface ChosenDefaults {
  bulkModel: string;
  pageModel: string;
  smallTasksModel: string;
}

interface ModelPools {
  generatedAt: number;
  chosenDefaults: ChosenDefaults;
  tiers: ModelTier[];
  models: MatchedModel[];
  namedAliases: {
    dev: string;
    kat: string;
    zip: string;
  };
}

const NAMED_MODELS = {
  dev: 'mistralai/devstral-2512:free',
  kat: 'kwaipilot/kat-coder-pro:free',
  zip: 'qwen/qwen3-coder:free'
};

function createTiers(rankedModels: MatchedModel[]): ModelTier[] {
  if (rankedModels.length === 0) {
    return [
      { name: 'SMALL', description: 'Fast/cheap tier (bottom 50%)', models: [] },
      { name: 'MEDIUM', description: 'Mid tier (50-85th percentile)', models: [] },
      { name: 'LARGE', description: 'Best tier (top 15%)', models: [] }
    ];
  }
  
  const count = rankedModels.length;
  const smallCount = Math.floor(count * 0.5);
  const mediumCount = Math.floor(count * 0.35);
  
  const large = rankedModels.slice(0, count - smallCount - mediumCount);
  const medium = rankedModels.slice(large.length, large.length + mediumCount);
  const small = rankedModels.slice(large.length + mediumCount);
  
  return [
    {
      name: 'SMALL',
      description: 'Fast/cheap tier (bottom 50%)',
      models: small.map(m => m.openRouterModelId)
    },
    {
      name: 'MEDIUM',
      description: 'Mid tier (50-85th percentile)',
      models: medium.map(m => m.openRouterModelId)
    },
    {
      name: 'LARGE',
      description: 'Best tier (top 15%)',
      models: large.map(m => m.openRouterModelId)
    }
  ];
}

function chooseDefaults(rankedModels: MatchedModel[], tiers: ModelTier[]): ChosenDefaults {
  // bulkModel: Best ranked coding model, or kat as fallback
  let bulkModel = NAMED_MODELS.kat;
  if (rankedModels.length > 0) {
    bulkModel = rankedModels[0].openRouterModelId;
  }
  
  // pageModel: 2nd best or dev
  let pageModel = NAMED_MODELS.dev;
  if (rankedModels.length > 1) {
    pageModel = rankedModels[1].openRouterModelId;
  }
  
  // smallTasksModel: MEDIUM tier first, or zip
  let smallTasksModel = NAMED_MODELS.zip;
  const mediumTier = tiers.find(t => t.name === 'MEDIUM');
  if (mediumTier && mediumTier.models.length > 0) {
    smallTasksModel = mediumTier.models[0];
  }
  
  return {
    bulkModel,
    pageModel,
    smallTasksModel
  };
}

export async function rankModels(force = false): Promise<ModelPools> {
  console.log('=== Ranking models and creating tiers ===\n');
  
  const matched = await matchModels(force);
  const rankedModels = matched.filter(m => m.ranked);
  
  const tiers = createTiers(rankedModels);
  const chosenDefaults = chooseDefaults(rankedModels, tiers);
  
  const pools: ModelPools = {
    generatedAt: Date.now(),
    chosenDefaults,
    tiers,
    models: matched,
    namedAliases: NAMED_MODELS
  };
  
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pools, null, 2));
  
  console.log(`✓ Written model pools to ${OUTPUT_FILE}`);
  console.log(`\nTier counts:`);
  tiers.forEach(tier => {
    console.log(`  ${tier.name}: ${tier.models.length} models`);
  });
  
  console.log(`\nChosen defaults:`);
  console.log(`  bulkModel: ${chosenDefaults.bulkModel}`);
  console.log(`  pageModel: ${chosenDefaults.pageModel}`);
  console.log(`  smallTasksModel: ${chosenDefaults.smallTasksModel}`);
  
  console.log(`\nTop 10 free coding models:`);
  rankedModels.slice(0, 10).forEach((m, i) => {
    const tierName = tiers.find(t => t.models.includes(m.openRouterModelId))?.name || '?';
    console.log(`  ${i + 1}. ${m.openRouterModelId}`);
    console.log(`     Score: ${(m.codingScore * 100).toFixed(1)}%, Context: ${m.contextLength.toLocaleString()}, Tier: ${tierName}`);
  });
  
  // Generate HTML report
  generateHtmlReport(pools);
  
  return pools;
}

async function main() {
  const force = process.argv.includes('--force');
  
  try {
    await rankModels(force);
  } catch (error: any) {
    console.error('✗ Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
