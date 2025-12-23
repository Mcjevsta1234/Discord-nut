#!/usr/bin/env node
/**
 * Job System Test Script
 * 
 * Tests the job lifecycle without Discord:
 * - Router decision
 * - Job creation
 * - Directory creation
 * - Prompt improver (optional with --with-llm flag)
 * - Placeholder generation
 * - Output copying
 */

const { ProjectRouter } = require('../dist/ai/projectRouter');
const {
  createJob,
  ensureJobDirs,
  writeJobLog,
  markStageStart,
  markStageEnd,
  updateJobStatus,
  getJobSummary,
} = require('../dist/jobs/jobManager');
const {
  writePlaceholderArtifacts,
  copyWorkspaceToOutput,
  listOutputFiles,
} = require('../dist/jobs/artifactWriter');
const { runPromptImprover } = require('../dist/jobs/promptImprover');
const { OpenRouterService } = require('../dist/ai/openRouterService');

// Check if we should test prompt improver
const testPromptImprover = process.argv.includes('--with-llm');

console.log('=== Job System Test Suite ===\n');
if (testPromptImprover) {
  console.log('⚠️  Running WITH LLM calls (--with-llm flag detected)');
  console.log('This will make actual API calls to OpenRouter\n');
} else {
  console.log('ℹ️  Running WITHOUT LLM calls (add --with-llm to test prompt improver)');
  console.log('Only testing job creation and placeholder generation\n');
}

const testMessages = [
  'create a landing page for my startup',
  'build a discord bot with slash commands',
  'make an Express API server',
];

async function runTests() {
  for (const [index, message] of testMessages.entries()) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${index + 1}: "${message}"`);
    console.log('='.repeat(80));

    try {
      // Step 1: Router decision
      console.log('\n📍 Step 1: Router Decision');
      const routerDecision = ProjectRouter.route(message);
      console.log(`  Project Type: ${routerDecision.projectType}`);
      console.log(`  Preview Allowed: ${routerDecision.previewAllowed}`);
      console.log(`  Requires Build: ${routerDecision.requiresBuild}`);

      // Step 2: Create job
      console.log('\n📍 Step 2: Create Job');
      const job = createJob(routerDecision, {
        userMessage: message,
        userId: 'test-user-123',
        guildId: 'test-guild-456',
        channelId: 'test-channel-789',
      });
      console.log(`  Job ID: ${job.jobId}`);
      console.log(`  Created At: ${job.createdAt}`);

      // Step 3: Create directories
      console.log('\n📍 Step 3: Create Directories');
      ensureJobDirs(job);
      console.log(`  ✓ Workspace: ${job.paths.workspaceDir}`);
      console.log(`  ✓ Output: ${job.paths.outputDir}`);
      console.log(`  ✓ Logs: ${job.diagnostics.logsPath}`);

      // Step 4: Write initial log
      writeJobLog(job, `Job created for message: "${message}"`);
      writeJobLog(job, `Project type: ${job.projectType}`);

      // Step 5: Test prompt improver (if enabled)
      if (testPromptImprover) {
        console.log('\n📍 Step 4: Run Prompt Improver (LLM)');
        try {
          const aiService = new OpenRouterService();
          markStageStart(job, 'prompt_improver');
          await runPromptImprover(job, aiService);
          markStageEnd(job, 'prompt_improver');
          
          if (job.spec) {
            console.log(`  ✓ Spec generated: "${job.spec.title}"`);
            console.log(`  ✓ Primary file: ${job.spec.output.primaryFile}`);
            console.log(`  ✓ Format: ${job.spec.output.format}`);
            console.log(`  ✓ Spec length: ${job.spec.spec.length} chars`);
            
            // Check files exist
            const fs = require('fs');
            const path = require('path');
            const specJsonPath = path.join(job.paths.workspaceDir, 'spec.json');
            const specTxtPath = path.join(job.paths.workspaceDir, 'spec.txt');
            
            if (fs.existsSync(specJsonPath)) {
              console.log(`  ✓ spec.json saved`);
            }
            if (fs.existsSync(specTxtPath)) {
              console.log(`  ✓ spec.txt saved`);
            }
          }
        } catch (error) {
          console.error(`  ✗ Prompt improver failed: ${error.message}`);
        }
      }

      // Step 6: Generate placeholders
      const stepNum = testPromptImprover ? 5 : 4;
      console.log(`\n📍 Step ${stepNum}: Generate Placeholder Artifacts`);
      markStageStart(job, 'artifact_generation');
      const files = writePlaceholderArtifacts(job);
      markStageEnd(job, 'artifact_generation');
      updateJobStatus(job, 'generated');
      console.log(`  ✓ Created ${files.length} placeholder files:`);
      files.forEach(file => console.log(`    - ${file}`));

      // Step 7: Copy to output
      console.log(`\n📍 Step ${stepNum + 1}: Copy to Output`);
      markStageStart(job, 'output_copy');
      const copiedCount = copyWorkspaceToOutput(job);
      markStageEnd(job, 'output_copy');
      console.log(`  ✓ Copied ${copiedCount} files to output directory`);

      // Step 8: Verify output
      console.log(`\n📍 Step ${stepNum + 2}: Verify Output`);
      const outputFiles = listOutputFiles(job);
      console.log(`  ✓ Output contains ${outputFiles.length} files:`);
      outputFiles.forEach(file => console.log(`    - ${file}`));

      // Step 9: Mark complete
      updateJobStatus(job, 'done');

      // Step 10: Print summary
      console.log(`\n📍 Job Summary:`);
      console.log(getJobSummary(job).split('\n').map(line => `  ${line}`).join('\n'));

    } catch (error) {
      console.error(`\n❌ Test ${index + 1} failed:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Test suite completed!');
  console.log('='.repeat(80) + '\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
