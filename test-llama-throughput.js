require('dotenv').config();

(async () => {
  console.log('\n🔄 Running 5 throughput tests...\n');
  
  for (let i = 1; i <= 5; i++) {
    try {
      const start = Date.now();
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.2-3b-instruct',
          messages: [{role: 'user', content: 'Say hello in 5 words'}],
          provider: {
            sort: 'throughput'
          },
          max_tokens: 20
        })
      });

      const data = await response.json();
      const latency = Date.now() - start;
      
      console.log(`Test ${i}/5:`);
      console.log(`  Model: ${data.model}`);
      console.log(`  Provider: ${data.provider || 'Not specified'}`);
      console.log(`  Latency: ${latency}ms`);
      console.log(`  TPS: ${(data.usage.completion_tokens / (latency/1000)).toFixed(2)} tokens/sec`);
      console.log(`  Response: "${data.choices[0].message.content}"\n`);
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`Test ${i} Error:`, err.message);
    }
  }
  
  console.log('✅ All tests complete');
})();
