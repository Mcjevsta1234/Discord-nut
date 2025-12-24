#!/usr/bin/env node
/**
 * Test code generation through console
 * Send input directly and wait for responses
 */
const { spawn } = require('child_process');
const readline = require('readline');

async function testConsoleCodegen() {
  console.log('🧪 Test 1: Simple Code Request\n');
  console.log('Starting console in code generation mode...\n');
  
  const proc = spawn('node', ['dist/index.js', '--console'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'inherit', 'inherit']
  });

  // Wait for prompt
  setTimeout(() => {
    console.log('\n📝 Sending: "Emma code me a simple calculator in react"\n');
    proc.stdin.write('Emma code me a simple calculator in react\n');
    
    // Exit after response
    setTimeout(() => {
      console.log('\n✅ Test 1 Complete - Check console output above for code generation\n');
      proc.stdin.write('/exit\n');
    }, 120000); // Wait 2 minutes for LLM response
  }, 3000);

  proc.on('close', (code) => {
    console.log(`\nProcess exited with code: ${code}`);
    process.exit(code);
  });
}

testConsoleCodegen().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
