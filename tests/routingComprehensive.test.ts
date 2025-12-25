import assert from 'assert';
import { RouterService } from '../src/llm/routerService';
import { ModelTier } from '../src/config/routing';
import { OpenRouterService, Message } from '../src/llm/openRouterService';
import { LLMResponse } from '../src/llm/llmMetadata';

class StubOpenRouterService implements Pick<OpenRouterService, 'chatCompletionWithMetadata'> {
  async chatCompletionWithMetadata(_messages: Message[], model: string): Promise<LLMResponse> {
    return {
      content: '{"route":"chat","confidence":0.99,"reason":"stub"}',
      metadata: {
        model,
        provider: 'openrouter',
        success: true,
        requestTimestamp: Date.now(),
      },
    };
  }
}

async function main() {
  const router = new RouterService(new StubOpenRouterService() as unknown as OpenRouterService);
  
  const testCases = [
    { message: 'please build me a full landing page for my startup', expected: ModelTier.CODING },
    { message: 'code me this html website', expected: ModelTier.CODING },
    { message: 'create a react app for my business', expected: ModelTier.CODING },
    { message: 'make me a discord bot', expected: ModelTier.CODING },
    { message: 'build a website', expected: ModelTier.CODING },
    { message: 'help me code this feature', expected: ModelTier.CODING },
    { message: 'what is the weather today', expected: ModelTier.SMART },
    { message: 'search for react tutorials', expected: ModelTier.SMART },
    { message: 'hey how are you', expected: ModelTier.INSTANT },
  ];

  console.log('🧪 Running comprehensive routing tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    try {
      const decision = await router.route(testCase.message, [], 500);
      if (decision.tier === testCase.expected) {
        console.log(`✅ "${testCase.message}"`);
        console.log(`   → ${decision.tier} (expected ${testCase.expected})\n`);
        passed++;
      } else {
        console.log(`❌ "${testCase.message}"`);
        console.log(`   → ${decision.tier} (expected ${testCase.expected})\n`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ "${testCase.message}"`);
      console.log(`   → ERROR: ${error}\n`);
      failed++;
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
