import fs from 'fs';
import path from 'path';
import { syncOpenRouterModels } from './sync-openrouter';
import { syncLLMStats, ModelCodingScore } from './sync-llm-stats';

const OVERRIDES_FILE = path.join(__dirname, 'model-id-overrides.json');

interface Overrides {
  comment: string;
  overrides: Record<string, string>;
}

interface MatchedModel {
  openRouterModelId: string;
  openRouterName: string;
  contextLength: number;
  codingScore: number;
  benchmarks: Record<string, number>;
  ranked: boolean;
  matchMethod: 'override' | 'exact' | 'fuzzy' | 'none';
}

function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(/:free$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function fuzzyMatch(str1: string, str2: string): number {
  const s1 = normalizeModelId(str1);
  const s2 = normalizeModelId(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Levenshtein distance ratio
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str1.length; i++) {
    for (let j = 1; j <= str2.length; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str1.length][str2.length];
}

function findBestMatch(
  openRouterModelId: string,
  codingScores: ModelCodingScore[],
  overrides: Record<string, string>
): { match: ModelCodingScore | null; method: 'override' | 'exact' | 'fuzzy' | 'none' } {
  // 1. Check overrides
  if (overrides[openRouterModelId]) {
    const overrideId = overrides[openRouterModelId];
    const match = codingScores.find(s => s.modelId === overrideId);
    if (match) {
      return { match, method: 'override' };
    }
  }
  
  // 2. Exact match (normalized)
  const normalized = normalizeModelId(openRouterModelId);
  for (const score of codingScores) {
    if (normalizeModelId(score.modelId) === normalized) {
      return { match: score, method: 'exact' };
    }
  }
  
  // 3. Fuzzy match (high confidence)
  let bestScore = 0;
  let bestMatch: ModelCodingScore | null = null;
  
  for (const score of codingScores) {
    const similarity = fuzzyMatch(openRouterModelId, score.modelId);
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = score;
    }
  }
  
  if (bestScore >= 0.7 && bestMatch) {
    return { match: bestMatch, method: 'fuzzy' };
  }
  
  return { match: null, method: 'none' };
}

export async function matchModels(force = false): Promise<MatchedModel[]> {
  console.log('=== Matching OpenRouter models with coding scores ===\n');
  
  const openRouterData = await syncOpenRouterModels(force);
  const codingScores = await syncLLMStats(force);
  
  const overrides: Overrides = fs.existsSync(OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'))
    : { comment: '', overrides: {} };
  
  const matched: MatchedModel[] = [];
  
  for (const model of openRouterData.models) {
    const { match, method } = findBestMatch(model.id, codingScores, overrides.overrides);
    
    matched.push({
      openRouterModelId: model.id,
      openRouterName: model.name,
      contextLength: model.context_length,
      codingScore: match?.codingScore || 0,
      benchmarks: match?.benchmarks || {},
      ranked: match?.ranked || false,
      matchMethod: method
    });
  }
  
  // Sort by coding score desc, then context length desc
  matched.sort((a, b) => {
    if (a.codingScore !== b.codingScore) {
      return b.codingScore - a.codingScore;
    }
    return b.contextLength - a.contextLength;
  });
  
  const rankedCount = matched.filter(m => m.ranked).length;
  const methodCounts = {
    override: matched.filter(m => m.matchMethod === 'override').length,
    exact: matched.filter(m => m.matchMethod === 'exact').length,
    fuzzy: matched.filter(m => m.matchMethod === 'fuzzy').length,
    none: matched.filter(m => m.matchMethod === 'none').length
  };
  
  console.log(`\n✓ Matched ${matched.length} OpenRouter models`);
  console.log(`  Ranked: ${rankedCount}`);
  console.log(`  Match methods: override=${methodCounts.override}, exact=${methodCounts.exact}, fuzzy=${methodCounts.fuzzy}, none=${methodCounts.none}`);
  
  return matched;
}

async function main() {
  const force = process.argv.includes('--force');
  
  try {
    const matched = await matchModels(force);
    
    console.log('\nTop 15 ranked free models:');
    matched.filter(m => m.ranked).slice(0, 15).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.openRouterModelId}`);
      console.log(`     Score: ${(m.codingScore * 100).toFixed(1)}%, Context: ${m.contextLength.toLocaleString()}, Match: ${m.matchMethod}`);
    });
  } catch (error: any) {
    console.error('✗ Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
