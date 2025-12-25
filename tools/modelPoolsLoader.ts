import fs from 'fs';
import path from 'path';

interface ModelPools {
  generatedAt: number;
  chosenDefaults: {
    bulkModel: string;
    pageModel: string;
    smallTasksModel: string;
  };
  tiers: Array<{
    name: 'SMALL' | 'MEDIUM' | 'LARGE';
    description: string;
    models: string[];
  }>;
  models: Array<{
    openRouterModelId: string;
    openRouterName: string;
    contextLength: number;
    codingScore?: number;
    benchmarks?: Record<string, number>;
    ranked: boolean;
    matchMethod?: string;
  }>;
  namedAliases?: {
    dev: string;
    kat: string;
    zip: string;
  };
}

interface ModelTrustCache {
  [modelId: string]: {
    trusted: boolean;
    testedAt: number;
    failures: number;
    successes: number;
  };
}

interface ModelRoles {
  BASE_MODEL: string;         // Phase 0 authority (sitemap, header, footer, layout)
  ESCALATION_MODEL: string;   // Retry/validation failures
  BULK_MODELS: string[];      // Main content generation (SMALL + unranked)
  MEDIUM_MODELS: string[];    // Feature pages
  NAMED_MODELS: {             // Legacy named models
    dev: string;
    kat: string;
    zip: string;
  };
}

const CACHE_DIR = path.join(__dirname, '../.cache');
const POOLS_FILE = path.join(CACHE_DIR, 'model-pools.json');
const TRUST_CACHE_FILE = path.join(CACHE_DIR, 'model-trust.json');

export class ModelPoolsLoader {
  private pools: ModelPools | null = null;
  private trustCache: ModelTrustCache = {};
  private roles: ModelRoles | null = null;

  constructor() {
    this.loadPools();
    this.loadTrustCache();
    this.computeRoles();
  }

  private loadPools(): void {
    if (!fs.existsSync(POOLS_FILE)) {
      console.warn('⚠️  Model pools not found. Run: npm run models:rank');
      console.warn('   Falling back to hardcoded models...\n');
      
      // Minimal fallback
      this.pools = {
        generatedAt: Date.now(),
        chosenDefaults: {
          bulkModel: 'qwen/qwen3-coder:free',
          pageModel: 'qwen/qwen3-coder:free',
          smallTasksModel: 'kwaipilot/kat-coder-pro:free'
        },
        tiers: [
          {
            name: 'LARGE',
            description: 'Best tier',
            models: ['qwen/qwen3-coder:free']
          },
          {
            name: 'MEDIUM',
            description: 'Mid tier',
            models: []
          },
          {
            name: 'SMALL',
            description: 'Fast tier',
            models: ['kwaipilot/kat-coder-pro:free', 'mistralai/devstral-2512:free']
          }
        ],
        models: [],
        namedAliases: {
          dev: 'mistralai/devstral-2512:free',
          kat: 'kwaipilot/kat-coder-pro:free',
          zip: 'qwen/qwen3-coder:free'
        }
      };
      return;
    }

    try {
      const data = fs.readFileSync(POOLS_FILE, 'utf-8');
      this.pools = JSON.parse(data);
      console.log(`✓ Loaded model pools: ${this.pools!.models.length} models, generated ${new Date(this.pools!.generatedAt).toLocaleString()}`);
    } catch (error: any) {
      console.error(`Failed to load model pools: ${error.message}`);
      throw error;
    }
  }

  private loadTrustCache(): void {
    if (!fs.existsSync(TRUST_CACHE_FILE)) {
      this.trustCache = {};
      return;
    }

    try {
      const data = fs.readFileSync(TRUST_CACHE_FILE, 'utf-8');
      this.trustCache = JSON.parse(data);
      const trustedCount = Object.values(this.trustCache).filter(t => t.trusted).length;
      console.log(`✓ Loaded trust cache: ${trustedCount} trusted models\n`);
    } catch (error) {
      console.warn('Failed to load trust cache, starting fresh');
      this.trustCache = {};
    }
  }

  private saveTrustCache(): void {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(TRUST_CACHE_FILE, JSON.stringify(this.trustCache, null, 2));
  }

  private computeRoles(): void {
    if (!this.pools) {
      throw new Error('Model pools not loaded');
    }

    const largeTier = this.pools.tiers.find(t => t.name === 'LARGE');
    const mediumTier = this.pools.tiers.find(t => t.name === 'MEDIUM');
    const smallTier = this.pools.tiers.find(t => t.name === 'SMALL');

    // BASE MODEL: Use best available from LARGE tier (fallback if qwen rate-limited)
    const largeModels = largeTier?.models || ['qwen/qwen3-coder:free'];
    // Try second model if available (deepseek-v3.1), otherwise use qwen
    const BASE_MODEL = largeModels.length > 1 ? largeModels[1] : largeModels[0];

    // ESCALATION: Same as BASE
    const ESCALATION_MODEL = BASE_MODEL;

    // MEDIUM_MODELS: From medium tier
    const MEDIUM_MODELS = mediumTier?.models || [];

    // BULK_MODELS: SMALL tier + unranked free models
    const smallModels = smallTier?.models || [];
    
    // Get all unranked free models
    const unrankedModels = this.pools.models
      .filter(m => !m.ranked && m.openRouterModelId.includes(':free'))
      .map(m => m.openRouterModelId);

    // Combine SMALL + unranked, exclude BASE model and nemotron (always fails)
    const BULK_MODELS = [...smallModels, ...unrankedModels]
      .filter(m => m !== BASE_MODEL && !m.includes('nemotron'));

    // Named aliases
    const NAMED_MODELS = this.pools.namedAliases || {
      dev: 'mistralai/devstral-2512:free',
      kat: 'kwaipilot/kat-coder-pro:free',
      zip: 'qwen/qwen3-coder:free'
    };

    this.roles = {
      BASE_MODEL,
      ESCALATION_MODEL,
      BULK_MODELS,
      MEDIUM_MODELS,
      NAMED_MODELS
    };

    console.log('✓ Model roles computed:');
    console.log(`  BASE: ${BASE_MODEL}`);
    console.log(`  ESCALATION: ${ESCALATION_MODEL}`);
    console.log(`  BULK (${BULK_MODELS.length}): ${BULK_MODELS.slice(0, 3).join(', ')}${BULK_MODELS.length > 3 ? '...' : ''}`);
    console.log(`  MEDIUM (${MEDIUM_MODELS.length}): ${MEDIUM_MODELS.join(', ')}`);
    console.log(`  NAMED: dev=${NAMED_MODELS.dev}, kat=${NAMED_MODELS.kat}, zip=${NAMED_MODELS.zip}\n`);
  }

  getRoles(): ModelRoles {
    if (!this.roles) {
      throw new Error('Model roles not computed');
    }
    return this.roles;
  }

  getPools(): ModelPools {
    if (!this.pools) {
      throw new Error('Model pools not loaded');
    }
    return this.pools;
  }

  // Trust cache methods
  isTrusted(modelId: string): boolean {
    const entry = this.trustCache[modelId];
    if (!entry) return false;
    return entry.trusted;
  }

  markSuccess(modelId: string): void {
    if (!this.trustCache[modelId]) {
      this.trustCache[modelId] = {
        trusted: true,
        testedAt: Date.now(),
        failures: 0,
        successes: 1
      };
    } else {
      this.trustCache[modelId].successes++;
      this.trustCache[modelId].trusted = true;
    }
    this.saveTrustCache();
  }

  markFailure(modelId: string): void {
    if (!this.trustCache[modelId]) {
      this.trustCache[modelId] = {
        trusted: false,
        testedAt: Date.now(),
        failures: 1,
        successes: 0
      };
    } else {
      this.trustCache[modelId].failures++;
      // Untrust if failures exceed successes by 3+
      if (this.trustCache[modelId].failures - this.trustCache[modelId].successes >= 3) {
        this.trustCache[modelId].trusted = false;
      }
    }
    this.saveTrustCache();
  }

  getTrustStats(modelId: string): { trusted: boolean; successes: number; failures: number } | null {
    const entry = this.trustCache[modelId];
    if (!entry) return null;
    return {
      trusted: entry.trusted,
      successes: entry.successes,
      failures: entry.failures
    };
  }
}

export function createModelPoolsLoader(): ModelPoolsLoader {
  return new ModelPoolsLoader();
}
