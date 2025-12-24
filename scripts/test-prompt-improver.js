/**
 * Test script to debug prompt improver LLM responses
 */

const { createJob, ensureJobDirs } = require('../dist/jobs/jobManager');
const { runPromptImprover } = require('../dist/jobs/promptImprover');
const { OpenRouterService } = require('../dist/ai/openRouterService');
const { ProjectRouter } = require('../dist/ai/projectRouter');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('🧪 Testing Prompt Improver with simple request...\n');
  
  // Create AI service
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not set');
    process.exit(1);
  }
  const aiService = new OpenRouterService(apiKey);
  
  // Simple test request
  const userRequest = "code me a simple todo list app";
  console.log(`📝 Request: "${userRequest}"\n`);
  
  // Route to project type
  const projectDecision = ProjectRouter.route(userRequest);
  console.log(`📦 Project Type: ${projectDecision.projectType}\n`);
  
  // Create job
  const job = createJob(projectDecision, {
    userMessage: userRequest,
    userId: 'test-user',
    guildId: undefined,
    channelId: 'test-channel',
  });
  
  console.log(`📋 Job ID: ${job.jobId}\n`);
  ensureJobDirs(job);
  
  try {
    // Run prompt improver
    console.log('🔄 Running prompt improver...\n');
    await runPromptImprover(job, aiService);
    
    console.log('\n✅ Prompt improver completed successfully!\n');
    
    // Read and display the raw response
    const rawPath = path.join(job.paths.workspaceDir, 'spec_initial_raw.txt');
    if (fs.existsSync(rawPath)) {
      const rawContent = fs.readFileSync(rawPath, 'utf8');
      console.log('📄 RAW LLM RESPONSE:');
      console.log('─'.repeat(80));
      console.log('Length:', rawContent.length, 'chars');
      console.log('─'.repeat(80));
      console.log('\nFirst 1000 chars:');
      console.log(rawContent.substring(0, 1000));
      console.log('\n...\n');
      console.log('Last 1000 chars:');
      console.log(rawContent.substring(Math.max(0, rawContent.length - 1000)));
      console.log('─'.repeat(80));
      
      // Check for unterminated strings
      try {
        JSON.parse(rawContent);
        console.log('\n✅ Response is valid JSON!');
      } catch (e) {
        console.log('\n❌ JSON Parse Error:', e.message);
        console.log('\nError position:', e.message.match(/position (\d+)/)?.[1] || 'unknown');
      }
    } else {
      console.log('❌ Raw response file not found');
    }
    
    // Display the spec that was created
    console.log('\n📊 Generated Spec:');
    console.log('─'.repeat(80));
    console.log('Title:', job.spec.title);
    console.log('Project Type:', job.spec.projectType);
    console.log('Format:', job.spec.output.format);
    console.log('Primary File:', job.spec.output.primaryFile);
    console.log('Checklist Items:', job.spec.acceptanceChecklist.length);
    console.log('Spec Length:', job.spec.spec.length, 'chars');
    console.log('─'.repeat(80));
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
