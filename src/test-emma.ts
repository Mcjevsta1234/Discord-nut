import { ConsoleChat } from './console/consoleChat';
import { validateRoutingConfig } from './config/routing';

async function test() {
  console.log('🧪 Testing Emma Persona with Minecraft Queries\n');
  
  // Validate config
  try {
    validateRoutingConfig();
    console.log('✅ Configuration valid\n');
  } catch (error) {
    console.error('❌ Configuration error:', error);
    process.exit(1);
  }

  const chat = new ConsoleChat();
  
  // Simulate user inputs
  const testQueries = [
    { desc: 'Set Emma persona', input: '/persona emma' },
    { desc: 'Minecraft server check #1', input: 'hey emma, can you check the minecraft servers?' },
    { desc: 'Minecraft server check #2', input: 'what\'s the status of witchyworlds?' },
    { desc: 'Network status check', input: 'tell me about the minecraft network status' },
  ];

  console.log('📝 Test Queries:');
  testQueries.forEach((q, i) => {
    console.log(`   ${i + 1}. ${q.desc}: "${q.input}"`);
  });
  console.log('\n' + '='.repeat(70) + '\n');

  // Run tests
  for (const test of testQueries) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🧪 TEST: ${test.desc}`);
    console.log('='.repeat(70));
    console.log(`📨 Input: ${test.input}\n`);
    
    try {
      if (test.input.startsWith('/')) {
        // Handle command
        await (chat as any).handleCommand(test.input);
      } else {
        // Handle chat
        await (chat as any).handleChat(test.input);
      }
      console.log('\n✅ Test completed successfully');
    } catch (error) {
      console.error('\n❌ Test failed:', error);
    }
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('🎉 All tests completed!');
  console.log('='.repeat(70));
  
  chat.stop();
  process.exit(0);
}

test().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
