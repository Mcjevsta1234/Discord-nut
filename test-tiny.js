require('dotenv').config();

(async () => {
  try {
    const start = Date.now();
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'z-ai/glm-4.7',
        messages: [{role: 'user', content: 'Hi GLM, one word reply.'}],
        reasoning: { enabled: true },
        provider: {
          order: ['z-ai'],  // ONLY z-ai provider
          allow_fallbacks: false  // NO fallback allowed
        },
        max_tokens: 20
      })
    });

    const data = await response.json();
    const latency = Date.now() - start;
    
    console.log('\n✓ SINGLE PASS TEST COMPLETE');
    console.log('─'.repeat(40));
    console.log(`Model: ${data.model}`);
    console.log(`Provider: z-ai (EXCLUSIVE - no fallback)`);
    console.log(`Latency: ${latency}ms`);
    console.log(`Tokens: ${data.usage.prompt_tokens} → ${data.usage.completion_tokens}`);
    console.log(`Response: "${data.choices[0].message.content}"`);
    console.log(`Reasoning: ${data.choices[0].message.reasoning_details ? '✓ Enabled' : '✗ Not captured'}`);
    console.log('─'.repeat(40));
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
