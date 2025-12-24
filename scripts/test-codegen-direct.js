#!/usr/bin/env node
/**
 * Direct test of code generation through console interface
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testCodeGeneration() {
  console.log('🧪 Testing code generation through console interface\n');
  
  // Start the console process and send a coding request
  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn('node', ['dist/index.js', '--console'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000 // 5 minutes
    });

    let output = '';
    let hasCodeGenStarted = false;
    let hasJobCreated = false;

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(chunk);

      // Check for key milestones
      if (chunk.includes('📋 Job created:')) {
        hasJobCreated = true;
      }
      if (chunk.includes('CODING tier detected')) {
        hasCodeGenStarted = true;
      }
      if (chunk.includes('Code generation complete') || chunk.includes('Code generation failed')) {
        // Process completed
        setTimeout(() => {
          proc.stdin.write('/exit\n');
          setTimeout(() => proc.kill(), 1000);
        }, 2000);
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`STDERR: ${data}`);
    });

    proc.on('close', (code) => {
      console.log(`\n\n=== TEST COMPLETE ===`);
      console.log(`Exit code: ${code}`);
      
      if (hasJobCreated && hasCodeGenStarted) {
        console.log('✅ Code generation pipeline started');
        resolve(true);
      } else {
        console.log('❌ Code generation pipeline did not start');
        console.log(`hasCodeGenStarted: ${hasCodeGenStarted}`);
        console.log(`hasJobCreated: ${hasJobCreated}`);
        reject(new Error('Code generation not triggered'));
      }
    });

    // Wait for prompt, then send test message
    setTimeout(() => {
      console.log('\n\n=== SENDING CODE REQUEST ===\n');
      proc.stdin.write('Emma code me a simple calculator app in react\n');
    }, 3000);
  });
}

testCodeGeneration()
  .then(() => {
    console.log('\n✅ Test passed!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  });
