#!/usr/bin/env node

/**
 * Speed Test Script for z-ai/glm-4.7
 * Tests OpenRouter API with reasoning enabled and measures TPS
 */

require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'z-ai/glm-4.7';

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not found in .env');
  process.exit(1);
}

async function speedTest() {
  console.log(`\n🚀 GLM-4.7 Speed Test (with Reasoning)\n`);
  console.log(`Model: ${MODEL}`);
  console.log(`Reasoning: Enabled\n`);
  console.log('=' .repeat(60));

  try {
    // FIRST API CALL - Initial question with reasoning
    console.log('\n📝 Call 1: Initial question with reasoning...');
    const call1Start = Date.now();
    
    const response1 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: "How many r's are in the word 'strawberry'? Think step by step.",
          },
        ],
        reasoning: { enabled: true },
        provider: {
          order: ['z-ai'],
          allow_fallbacks: false
        },
        temperature: 0.7,
      }),
    });

    if (!response1.ok) {
      const error = await response1.text();
      throw new Error(`API Error (Call 1): ${response1.status} - ${error}`);
    }

    const result1 = await response1.json();
    const call1End = Date.now();
    const call1Duration = (call1End - call1Start) / 1000;

    const assistantMsg = result1.choices[0].message;
    const usage1 = result1.usage;

    console.log(`✅ Call 1 completed in ${call1Duration.toFixed(2)}s`);
    console.log(`   Input tokens: ${usage1.prompt_tokens}`);
    console.log(`   Output tokens: ${usage1.completion_tokens}`);
    console.log(`   Total tokens: ${usage1.total_tokens}`);
    
    const tps1 = usage1.completion_tokens / call1Duration;
    console.log(`   TPS (output): ${tps1.toFixed(2)} tokens/sec`);
    console.log(`   Content preview: ${assistantMsg.content.substring(0, 100)}...`);
    
    if (assistantMsg.reasoning_details) {
      console.log(`   ✓ Reasoning preserved (${JSON.stringify(assistantMsg.reasoning_details).length} bytes)`);
    }

    // SECOND API CALL - Follow-up with reasoning preserved
    console.log('\n📝 Call 2: Follow-up with reasoning context...');
    const call2Start = Date.now();

    const messages = [
      {
        role: 'user',
        content: "How many r's are in the word 'strawberry'? Think step by step.",
      },
      {
        role: 'assistant',
        content: assistantMsg.content,
        ...(assistantMsg.reasoning_details && { reasoning_details: assistantMsg.reasoning_details }),
      },
      {
        role: 'user',
        content: 'Are you sure? Count again carefully.',
      },
    ];

    const response2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        reasoning: { enabled: true },
        provider: {
          order: ['z-ai'],
          allow_fallbacks: false
        },
        temperature: 0.7,
      }),
    });

    if (!response2.ok) {
      const error = await response2.text();
      throw new Error(`API Error (Call 2): ${response2.status} - ${error}`);
    }

    const result2 = await response2.json();
    const call2End = Date.now();
    const call2Duration = (call2End - call2Start) / 1000;

    const usage2 = result2.usage;

    console.log(`✅ Call 2 completed in ${call2Duration.toFixed(2)}s`);
    console.log(`   Input tokens: ${usage2.prompt_tokens}`);
    console.log(`   Output tokens: ${usage2.completion_tokens}`);
    console.log(`   Total tokens: ${usage2.total_tokens}`);
    
    const tps2 = usage2.completion_tokens / call2Duration;
    console.log(`   TPS (output): ${tps2.toFixed(2)} tokens/sec`);
    console.log(`   Content preview: ${result2.choices[0].message.content.substring(0, 100)}...`);

    // SUMMARY
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    
    const totalInputTokens = usage1.prompt_tokens + usage2.prompt_tokens;
    const totalOutputTokens = usage1.completion_tokens + usage2.completion_tokens;
    const totalTime = call1Duration + call2Duration;
    const avgTps = totalOutputTokens / totalTime;

    console.log(`\nTotal Time: ${totalTime.toFixed(2)}s`);
    console.log(`Total Input Tokens: ${totalInputTokens}`);
    console.log(`Total Output Tokens: ${totalOutputTokens}`);
    console.log(`\n🎯 Average TPS (output): ${avgTps.toFixed(2)} tokens/sec`);
    console.log(`   Call 1: ${tps1.toFixed(2)} TPS`);
    console.log(`   Call 2: ${tps2.toFixed(2)} TPS`);

    // Cost estimation
    const inputCost = (totalInputTokens * 0.40) / 1_000_000;
    const outputCost = (totalOutputTokens * 1.50) / 1_000_000;
    const totalCost = inputCost + outputCost;

    console.log(`\n💰 Estimated Cost:`);
    console.log(`   Input: $${inputCost.toFixed(6)} (${totalInputTokens} @ $0.40/1M)`);
    console.log(`   Output: $${outputCost.toFixed(6)} (${totalOutputTokens} @ $1.50/1M)`);
    console.log(`   Total: $${totalCost.toFixed(6)}`);

    console.log('\n✅ Speed test complete!\n');

  } catch (error) {
    console.error('❌ Error during speed test:');
    console.error(error.message);
    process.exit(1);
  }
}

speedTest();
