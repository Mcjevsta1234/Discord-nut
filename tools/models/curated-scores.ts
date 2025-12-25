/**
 * Curated coding benchmark scores for common free models
 * Sources: HumanEval, LiveCodeBench, SWE-bench Verified, various public benchmarks
 * 
 * This is a fallback when the llm-stats repo structure changes or is unavailable.
 * Scores are normalized 0..1 and weighted toward coding tasks.
 */

export interface CuratedScore {
  modelId: string;
  codingScore: number;
  benchmarks: Record<string, number>;
  source: string;
}

export const CURATED_SCORES: CuratedScore[] = [
  {
    modelId: "qwen-2.5-coder-32b-instruct",
    codingScore: 0.89,
    benchmarks: {
      "HumanEval": 0.92,
      "LiveCodeBench": 0.38,
      "SWE-bench Verified": 0.31
    },
    source: "Qwen blog, LiveCodeBench leaderboard"
  },
  {
    modelId: "deepseek-v3",
    codingScore: 0.88,
    benchmarks: {
      "HumanEval": 0.90,
      "LiveCodeBench": 0.40,
      "SWE-bench Verified": 0.35
    },
    source: "DeepSeek paper, various benchmarks"
  },
  {
    modelId: "gemini-2.0-flash-exp",
    codingScore: 0.85,
    benchmarks: {
      "HumanEval": 0.87,
      "LiveCodeBench": 0.35
    },
    source: "Google AI Studio benchmarks"
  },
  {
    modelId: "devstral-2412",
    codingScore: 0.82,
    benchmarks: {
      "HumanEval": 0.83,
      "LiveCodeBench": 0.32
    },
    source: "Mistral AI benchmarks"
  },
  {
    modelId: "kat-coder-pro",
    codingScore: 0.78,
    benchmarks: {
      "HumanEval": 0.80,
      "CodeContests": 0.28
    },
    source: "Kwai AI benchmarks"
  },
  {
    modelId: "qwen3-coder",
    codingScore: 0.76,
    benchmarks: {
      "HumanEval": 0.78,
      "MBPP": 0.74
    },
    source: "Qwen benchmarks"
  },
  {
    modelId: "deepseek-r1-0528",
    codingScore: 0.84,
    benchmarks: {
      "HumanEval": 0.85,
      "LiveCodeBench": 0.36
    },
    source: "DeepSeek reasoning model benchmarks"
  },
  {
    modelId: "nemotron-3-nano-30b",
    codingScore: 0.72,
    benchmarks: {
      "HumanEval": 0.74,
      "MBPP": 0.70
    },
    source: "NVIDIA benchmarks"
  }
];
