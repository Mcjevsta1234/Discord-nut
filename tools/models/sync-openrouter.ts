import fs from 'fs';
import path from 'path';
import axios from 'axios';

const CACHE_DIR = path.join(__dirname, '../../.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'openrouter-models.json');
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface OpenRouterPricing {
  prompt: string;
  completion: string;
  request?: string;
  image?: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterPricing;
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  supported_parameters?: string[];
}

interface CachedModels {
  fetchedAt: number;
  models: OpenRouterModel[];
}

function isFreeModel(model: OpenRouterModel): boolean {
  // Check if ends with :free
  if (model.id.endsWith(':free')) {
    return true;
  }
  
  // Check if pricing is zero (string "0")
  if (model.pricing.prompt === "0" && model.pricing.completion === "0") {
    return true;
  }
  
  return false;
}

async function fetchWithRetry(url: string, retries = 3, backoff = 1000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'discord-nut-site-gen/1.0'
        }
      });
      return response.data;
    } catch (error: any) {
      if (i === retries - 1) throw error;
      
      const delay = backoff * Math.pow(2, i);
      console.warn(`Retry ${i + 1}/${retries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function syncOpenRouterModels(force = false): Promise<CachedModels> {
  // Check cache freshness
  if (!force && fs.existsSync(CACHE_FILE)) {
    const cached: CachedModels = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const age = Date.now() - cached.fetchedAt;
    
    if (age < CACHE_MAX_AGE_MS) {
      console.log(`✓ Using cached OpenRouter models (${(age / 1000 / 60).toFixed(0)}m old)`);
      return cached;
    }
  }
  
  console.log('Fetching OpenRouter models...');
  const response = await fetchWithRetry(OPENROUTER_API);
  
  if (!response.data || !Array.isArray(response.data)) {
    throw new Error('Invalid OpenRouter API response');
  }
  
  const allModels: OpenRouterModel[] = response.data;
  const freeModels = allModels.filter(isFreeModel);
  
  console.log(`✓ Found ${freeModels.length} free models out of ${allModels.length} total`);
  
  const cached: CachedModels = {
    fetchedAt: Date.now(),
    models: freeModels
  };
  
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cached, null, 2));
  
  return cached;
}

async function main() {
  const force = process.argv.includes('--force');
  
  try {
    const cached = await syncOpenRouterModels(force);
    console.log(`\n✓ Cached ${cached.models.length} free models to ${CACHE_FILE}`);
    
    // Show top 10 by context length
    const sorted = [...cached.models].sort((a, b) => b.context_length - a.context_length);
    console.log('\nTop 10 by context length:');
    sorted.slice(0, 10).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.id} (${m.context_length.toLocaleString()} tokens)`);
    });
    
    // Auto-generate report if model-pools.json exists
    const poolsFile = path.join(CACHE_DIR, 'model-pools.json');
    if (fs.existsSync(poolsFile)) {
      console.log('\n🔄 Regenerating model pools report...');
      const { exec } = require('child_process');
      exec('npm run models:rank', (error: any) => {
        if (error) {
          console.log('  ⓘ Run "npm run models:rank" to regenerate report');
        }
      });
    }
  } catch (error: any) {
    console.error('✗ Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
