/**
 * Router LLM Test Script
 * Tests routing decisions in hybrid mode with various message types
 */

const { RouterService } = require('../dist/ai/routerService');
const { OpenRouterService } = require('../dist/ai/openRouterService');

async function testRouter() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 ROUTER LLM TEST - HYBRID MODE');
  console.log('═══════════════════════════════════════════════════════\n');

  const aiService = new OpenRouterService();
  const router = new RouterService(aiService);

  // Test cases with different complexity levels
  const testCases = [
    {
      name: 'Simple Greeting',
      message: 'hey there!',
      expected: 'INSTANT',
      expectHeuristic: true,
    },
    {
      name: 'Coding Request',
      message: 'Emma code me a minecraft hosting website, with a console mock with working minecraft commands, and a react modern ui',
      expected: 'CODING',
      expectHeuristic: true,
    },
    {
      name: 'Tool Request',
      message: 'what time is it in Tokyo?',
      expected: 'SMART',
      expectHeuristic: true,
    },
    {
      name: 'Ambiguous Query (triggers router LLM)',
      message: 'tell me about quantum computing',
      expected: 'SMART or THINKING',
      expectHeuristic: false,
    },
    {
      name: 'Simple Code Request',
      message: 'write me a function to sort arrays',
      expected: 'CODING',
      expectHeuristic: true,
    },
    {
      name: 'Image Request',
      message: 'generate an image of a sunset',
      expected: 'INSTANT',
      expectHeuristic: false, // Might trigger router
    },
  ];

  let testNum = 0;
  for (const testCase of testCases) {
    testNum++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`TEST ${testNum}/${testCases.length}: ${testCase.name}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Message: "${testCase.message}"`);
    console.log(`Expected Tier: ${testCase.expected}`);
    console.log(`Expected Method: ${testCase.expectHeuristic ? 'Heuristic' : 'Router LLM'}`);
    console.log(`${'─'.repeat(60)}\n`);

    try {
      const decision = await router.route(testCase.message, [], testCase.message.length);

      console.log(`\n${'─'.repeat(60)}`);
      console.log('📊 ROUTING RESULT:');
      console.log(`   Tier: ${decision.tier}`);
      console.log(`   Model: ${decision.modelId}`);
      console.log(`   Method: ${decision.routingMethod}`);
      console.log(`   Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
      console.log(`   Reason: ${decision.routingReason}`);
      console.log(`   Flags:`, JSON.stringify(decision.flags, null, 2));

      // Check if result matches expectations
      const tierMatch = testCase.expected.includes(decision.tier);
      const methodMatch = testCase.expectHeuristic ? 
        (decision.routingMethod === 'heuristic' || decision.routingMethod === 'hybrid') : 
        (decision.routingMethod === 'routerModel' || decision.routingMethod === 'hybrid');

      console.log(`\n   ✅ Tier: ${tierMatch ? 'PASS' : 'FAIL'} (expected: ${testCase.expected}, got: ${decision.tier})`);
      console.log(`   ✅ Method: ${methodMatch ? 'PASS' : 'FAIL'}`);

    } catch (error) {
      console.error(`\n❌ TEST FAILED WITH ERROR:`);
      console.error(error);
    }

    // Brief delay between tests
    if (testNum < testCases.length) {
      console.log(`\n⏳ Waiting 2 seconds before next test...\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('🏁 ALL TESTS COMPLETE');
  console.log(`${'═'.repeat(60)}\n`);
}

// Run tests
testRouter()
  .then(() => {
    console.log('✅ Router test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Router test failed:', error);
    process.exit(1);
  });
