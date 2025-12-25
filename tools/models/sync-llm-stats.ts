import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';
import { CURATED_SCORES, CuratedScore } from './curated-scores';

const CACHE_DIR = path.join(__dirname, '../../.cache');
const LLM_STATS_DIR = path.join(CACHE_DIR, 'llm-stats-data');
const GITHUB_REPO = 'https://github.com/JonathanChavezTamales/llm-leaderboard';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BenchmarkScore {
  modelId: string;
  benchmarkName: string;
  score: number;
}

const CODING_BENCHMARKS = [
  'LiveCodeBench',
  'HumanEval',
  'Instruct HumanEval',
  'HumanEval+',
  'HumanEval-FIM',
  'SWE-bench Verified',
  'SWE-bench',
  'Aider-Polyglot',
  'MBPP',
  'CodeContests'
];

const BENCHMARK_WEIGHTS: Record<string, number> = {
  'LiveCodeBench': 3.0,
  'SWE-bench Verified': 2.5,
  'SWE-bench': 2.0,
  'Aider-Polyglot': 2.0,
  'HumanEval+': 1.5,
  'HumanEval': 1.0,
  'Instruct HumanEval': 1.0,
  'HumanEval-FIM': 1.0,
  'MBPP': 0.8,
  'CodeContests': 1.2
};

function isCodingBenchmark(name: string): boolean {
  return CODING_BENCHMARKS.some(b => 
    name.toLowerCase().includes(b.toLowerCase()) ||
    b.toLowerCase().includes(name.toLowerCase())
  );
}

function getBenchmarkWeight(name: string): number {
  for (const [key, weight] of Object.entries(BENCHMARK_WEIGHTS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return weight;
    }
  }
  return 1.0;
}

async function cloneOrUpdateRepo(force = false): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  
  if (fs.existsSync(LLM_STATS_DIR)) {
    // Check age
    const gitDir = path.join(LLM_STATS_DIR, '.git');
    if (fs.existsSync(gitDir)) {
      const stats = fs.statSync(gitDir);
      const age = Date.now() - stats.mtimeMs;
      
      if (!force && age < CACHE_MAX_AGE_MS) {
        console.log(`✓ Using cached llm-stats data (${(age / 1000 / 60 / 60 / 24).toFixed(1)}d old)`);
        return;
      }
      
      console.log('Updating llm-stats repo...');
      try {
        execSync('git pull --depth=1', { cwd: LLM_STATS_DIR, stdio: 'pipe' });
        console.log('✓ Updated llm-stats repo');
        return;
      } catch (error) {
        console.warn('Git pull failed, will re-clone');
        fs.rmSync(LLM_STATS_DIR, { recursive: true, force: true });
      }
    }
  }
  
  console.log('Cloning llm-stats repo (shallow)...');
  execSync(`git clone --depth=1 ${GITHUB_REPO} "${LLM_STATS_DIR}"`, {
    stdio: 'pipe'
  });
  console.log('✓ Cloned llm-stats repo');
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

function readBenchmarkScores(): BenchmarkScore[] {
  const benchmarksDir = path.join(LLM_STATS_DIR, 'data', 'model_benchmarks');
  
  if (!fs.existsSync(benchmarksDir)) {
    console.warn('⚠ model_benchmarks directory not found');
    return [];
  }
  
  const scores: BenchmarkScore[] = [];
  const files = fs.readdirSync(benchmarksDir).filter(f => f.endsWith('.csv'));
  
  for (const file of files) {
    const benchmarkName = file.replace('.csv', '');
    
    if (!isCodingBenchmark(benchmarkName)) {
      continue;
    }
    
    const content = fs.readFileSync(path.join(benchmarksDir, file), 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    if (lines.length < 2) continue;
    
    const headers = parseCSVLine(lines[0]);
    const modelColIndex = headers.findIndex(h => 
      h.toLowerCase().includes('model') || h.toLowerCase().includes('name')
    );
    const scoreColIndex = headers.findIndex(h => 
      h.toLowerCase().includes('score') || h.toLowerCase().includes('accuracy') || h.toLowerCase().includes('pass')
    );
    
    if (modelColIndex === -1 || scoreColIndex === -1) continue;
    
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCSVLine(lines[i]);
      if (cells.length <= Math.max(modelColIndex, scoreColIndex)) continue;
      
      const modelId = cells[modelColIndex].replace(/^"|"$/g, '').trim();
      const scoreStr = cells[scoreColIndex].replace(/^"|"$/g, '').trim().replace('%', '');
      const score = parseFloat(scoreStr);
      
      if (modelId && !isNaN(score)) {
        scores.push({
          modelId,
          benchmarkName,
          score: score > 1 ? score / 100 : score // Normalize to 0..1
        });
      }
    }
  }
  
  console.log(`✓ Parsed ${scores.length} coding benchmark scores from ${files.length} files`);
  return scores;
}

export interface ModelCodingScore {
  modelId: string;
  codingScore: number;
  benchmarks: Record<string, number>;
  ranked: boolean;
}

export function calculateCodingScores(scores: BenchmarkScore[]): ModelCodingScore[] {
  const modelMap = new Map<string, { scores: Record<string, number> }>();
  
  for (const score of scores) {
    if (!modelMap.has(score.modelId)) {
      modelMap.set(score.modelId, { scores: {} });
    }
    modelMap.get(score.modelId)!.scores[score.benchmarkName] = score.score;
  }
  
  const result: ModelCodingScore[] = [];
  
  for (const [modelId, data] of modelMap) {
    const benchmarks = data.scores;
    const benchmarkNames = Object.keys(benchmarks);
    
    if (benchmarkNames.length === 0) {
      result.push({ modelId, codingScore: 0, benchmarks, ranked: false });
      continue;
    }
    
    // Weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const [name, score] of Object.entries(benchmarks)) {
      const weight = getBenchmarkWeight(name);
      weightedSum += score * weight;
      totalWeight += weight;
    }
    
    const codingScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    
    result.push({
      modelId,
      codingScore,
      benchmarks,
      ranked: true
    });
  }
  
  return result.sort((a, b) => b.codingScore - a.codingScore);
}

export async function syncLLMStats(force = false): Promise<ModelCodingScore[]> {
  try {
    await cloneOrUpdateRepo(force);
    const scores = readBenchmarkScores();
    
    if (scores.length > 0) {
      return calculateCodingScores(scores);
    }
  } catch (error) {
    console.warn('⚠ Failed to fetch llm-stats data, using curated scores');
  }
  
  // Fallback to curated scores
  console.log('Using curated coding scores...');
  return CURATED_SCORES.map(s => ({
    modelId: s.modelId,
    codingScore: s.codingScore,
    benchmarks: s.benchmarks,
    ranked: true
  }));
}

async function main() {
  const force = process.argv.includes('--force');
  
  try {
    const codingScores = await syncLLMStats(force);
    
    console.log(`\n✓ Calculated coding scores for ${codingScores.filter(s => s.ranked).length} models`);
    console.log('\nTop 15 coding models:');
    
    codingScores.slice(0, 15).forEach((m, i) => {
      if (!m.ranked) return;
      const benchmarkCount = Object.keys(m.benchmarks).length;
      console.log(`  ${i + 1}. ${m.modelId}`);
      console.log(`     Score: ${(m.codingScore * 100).toFixed(1)}% (${benchmarkCount} benchmarks)`);
    });
  } catch (error: any) {
    console.error('✗ Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
