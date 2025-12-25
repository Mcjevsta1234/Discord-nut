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
  const decision = await router.route('please build me a full landing page for my startup', [], 500);
  assert.strictEqual(decision.tier, ModelTier.CODING, 'Explicit coding intent should route to CODING tier');
  console.log('✅ coding intent routing test passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
