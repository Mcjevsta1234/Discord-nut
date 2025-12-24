import assert from 'assert';
import { calculateCost, MODEL_PRICING, TokenUsage } from '../src/ai/llmMetadata';

// ===== PRICING & CACHE-READ TESTS =====

(function testCacheReadTokensFieldExists() {
  const usage: TokenUsage = {
    promptTokens: 100,
    completionTokens: 50,
    cacheReadTokens: 30,
    totalTokens: 180,
  };
  assert(usage.cacheReadTokens === 30, 'TokenUsage interface should support cacheReadTokens');
  console.log('✓ Cache-read tokens field exists');
})();

(function testModelPricingIncludesGeminiCacheRead() {
  const geminiPricing = MODEL_PRICING['google/gemini-3-flash-preview'];
  assert(geminiPricing !== undefined, 'Gemini 3 Flash Preview pricing must be defined');
  assert(geminiPricing.prompt === 0.50, 'Gemini input should be $0.50/1M');
  assert(geminiPricing.completion === 3.00, 'Gemini output should be $3.00/1M');
  assert(geminiPricing.cache_read === 0.05, 'Gemini cache-read should be $0.05/1M');
  console.log('✓ Gemini cache-read pricing configured correctly');
})();

(function testCostCalculationWithoutCacheRead() {
  const usage: TokenUsage = {
    promptTokens: 1_000_000,  // 1M tokens
    completionTokens: 1_000_000,  // 1M tokens
    totalTokens: 2_000_000,
  };
  
  // Using Gemini pricing: $0.50/1M input + $3.00/1M output = $3.50 total
  const cost = calculateCost(usage, 'google/gemini-3-flash-preview');
  const expected = 0.50 + 3.00; // = 3.50
  assert(Math.abs(cost - expected) < 0.001, `Cost should be ${expected}, got ${cost}`);
  console.log(`✓ Cost without cache-read: $${cost.toFixed(2)} (expected $${expected.toFixed(2)})`);
})();

(function testCostCalculationWithCacheRead() {
  const usage: TokenUsage = {
    promptTokens: 1_000_000,  // 1M tokens
    completionTokens: 1_000_000,  // 1M tokens
    cacheReadTokens: 1_000_000,  // 1M cached tokens
    totalTokens: 3_000_000,
  };
  
  // Using Gemini pricing: $0.50/1M input + $3.00/1M output + $0.05/1M cache-read = $3.55 total
  const cost = calculateCost(usage, 'google/gemini-3-flash-preview');
  const expected = 0.50 + 3.00 + 0.05; // = 3.55
  assert(Math.abs(cost - expected) < 0.001, `Cost with cache should be ${expected}, got ${cost}`);
  console.log(`✓ Cost with cache-read: $${cost.toFixed(2)} (expected $${expected.toFixed(2)})`);
})();

(function testFreeModelCostsZero() {
  const usage: TokenUsage = {
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    totalTokens: 3_000_000,
  };
  
  // Free models should always cost 0
  const cost = calculateCost(usage, 'qwen/qwen3-4b:free');
  assert(cost === 0, `Free model should cost 0, got ${cost}`);
  console.log('✓ Free models cost $0.00');
})();

(function testAllRequiredModelsHavePricing() {
  const requiredModels = [
    'google/gemini-3-flash-preview',
    'qwen/qwen3-4b:free',
    'xiaomi/mimo-v2-flash:free',
    'openai/gpt-oss-20b',
    'deepseek/deepseek-r1-0528:free',
    'allenai/olmo-3.1-32b-think:free',
    'mistralai/mistral-7b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
  ];
  
  for (const model of requiredModels) {
    assert(MODEL_PRICING[model] !== undefined, `Model ${model} must have pricing defined`);
  }
  console.log(`✓ All ${requiredModels.length} required models have pricing defined`);
})();

(function testCacheReadPricingIsOptional() {
  // Not all models need cache-read pricing
  const usage: TokenUsage = {
    promptTokens: 100,
    completionTokens: 100,
    cacheReadTokens: 50,
    totalTokens: 250,
  };
  
  // Model without cache_read pricing should ignore cache tokens
  const cost = calculateCost(usage, 'openai/gpt-oss-20b');
  const inputCost = (100 * 0.10) / 1_000_000; // 0.00001
  const outputCost = (100 * 0.10) / 1_000_000; // 0.00001
  const expected = inputCost + outputCost;
  
  assert(Math.abs(cost - expected) < 0.00001, `Cost without cache rate should be ${expected}, got ${cost}`);
  console.log('✓ Cache-read pricing is optional per model');
})();

console.log('\n✅ All pricing and cache-read tests passed!');
