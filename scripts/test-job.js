#!/usr/bin/env node
/**
 * Job System Test Script
 * 
 * Tests the job lifecycle without Discord:
 * - Router decision
 * - Job creation
 * - Directory creation
 * - Prompt improver (with --with-llm flag)
 * - Planner (with --with-llm flag)
 * - Code generator (with --with-llm flag)
 * - Output verification
 * 
 * COST CONTROL: Tests only ONE project type per run
 * Set TEST_PROJECT_TYPE env var to test different types:
 *   - static_html (default)
 *   - node_project
 *   - discord_bot
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
const { runPlanner } = require('../dist/jobs/planner');
const { runCodeGenerator } = require('../dist/jobs/codeGenerator');
const { OpenRouterService } = require('../dist/ai/openRouterService');

// Check if we should test LLM stages
const testWithLLM = process.argv.includes('--with-llm');

// Get project type from env (default: static_html for cost control)
const projectType = process.env.TEST_PROJECT_TYPE || 'static_html';

// Single message based on project type
const messageMap = {
  'static_html': 'create a landing page for my startup',
  'node_project': 'make an Express API server',
  'discord_bot': 'build a discord bot with slash commands'
};

const testMessage = messageMap[projectType];
if (!testMessage) {
  console.error(`❌ Invalid TEST_PROJECT_TYPE: ${projectType}`);
  console.error(`Valid types: static_html, node_project, discord_bot`);
  process.exit(1);
}

console.log('=== Job System Test Suite ===\n');
console.log(`📦 Testing project type: ${projectType}`);
console.log(`💬 Message: "${testMessage}"\n`);

if (testWithLLM) {
  console.log('⚠️  Running WITH LLM calls (--with-llm flag detected)');
  console.log('This will make actual API calls to OpenRouter\n');
} else {
  console.log('ℹ️  Running WITHOUT LLM calls (add --with-llm to test full pipeline)');
  console.log('Only testing job creation and placeholder generation\n');
}

async function runTests() {
  console.log('='.repeat(80));
  console.log(`Test: "${testMessage}"`);
  console.log('='.repeat(80));

  try {
    // Step 1: Router decision
    console.log('\n📍 Step 1: Router Decision');
    const routerDecision = ProjectRouter.route(testMessage);
    console.log(`  Project Type: ${routerDecision.projectType}`);
    console.log(`  Preview Allowed: ${routerDecision.previewAllowed}`);
    console.log(`  Requires Build: ${routerDecision.requiresBuild}`);

    // Step 2: Create job
    console.log('\n📍 Step 2: Create Job');
    const job = createJob(routerDecision, {
      userMessage: testMessage,
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
    writeJobLog(job, `Job created for message: "${testMessage}"`);
    writeJobLog(job, `Project type: ${job.projectType}`);

    // Step 5: Test prompt improver (if enabled)
    if (testWithLLM) {
      console.log('\n📍 Step 4: Run Prompt Improver (LLM #1)');
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
          
          if (job.spec.tokenUsage) {
            console.log(`  ✓ Token usage: ${job.spec.tokenUsage.promptTokens}p + ${job.spec.tokenUsage.completionTokens}c = ${job.spec.tokenUsage.totalTokens}t`);
          }
          
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
        throw error;
      }

      // Step 6: Test planner
      console.log('\n📍 Step 5: Run Planner (LLM #2)');
      try {
        const aiService = new OpenRouterService();
        markStageStart(job, 'planner');
        await runPlanner(job, aiService);
        markStageEnd(job, 'planner');
        
        if (job.plan) {
          console.log(`  ✓ Plan generated: "${job.plan.title}"`);
          console.log(`  ✓ Steps: ${job.plan.steps.length}`);
          console.log(`  ✓ Files to generate: ${job.plan.filePlan.length}`);
          console.log(`  ✓ Build strategy: ${job.plan.buildStrategy}`);
          
          if (job.plan.tokenUsage) {
            console.log(`  ✓ Token usage: ${job.plan.tokenUsage.promptTokens}p + ${job.plan.tokenUsage.completionTokens}c = ${job.plan.tokenUsage.totalTokens}t`);
          }
          
          // Show first 3 steps
          console.log(`  ✓ First 3 steps:`);
          job.plan.steps.slice(0, 3).forEach(step => {
            console.log(`     [${step.id}] ${step.name} (risk: ${step.risk})`);
          });
          
          // Check acceptance coverage
          const checkedItems = job.plan.acceptanceMapping.length;
          const totalItems = job.spec.acceptanceChecklist.length;
          console.log(`  ✓ Acceptance coverage: ${checkedItems}/${totalItems} items`);
          
          // Check files exist
          const fs = require('fs');
          const path = require('path');
          const planJsonPath = path.join(job.paths.workspaceDir, 'plan.json');
          const planTxtPath = path.join(job.paths.workspaceDir, 'plan.txt');
          
          if (fs.existsSync(planJsonPath)) {
            console.log(`  ✓ plan.json saved`);
          }
          if (fs.existsSync(planTxtPath)) {
            console.log(`  ✓ plan.txt saved`);
          }
        }
      } catch (error) {
        console.error(`  ✗ Planner failed: ${error.message}`);
        throw error;
      }

      // Step 7: Test code generator
      console.log('\n📍 Step 6: Run Code Generator (LLM #3)');
      try {
        const aiService = new OpenRouterService();
        markStageStart(job, 'codegen');
        await runCodeGenerator(job, aiService);
        markStageEnd(job, 'codegen');
        
        if (job.codegenResult) {
          console.log(`  ✓ Code generated: ${job.codegenResult.files.length} files`);
          console.log(`  ✓ Notes: ${job.codegenResult.notes}`);
          
          if (job.codegenResult.tokenUsage) {
            console.log(`  ✓ Token usage: ${job.codegenResult.tokenUsage.promptTokens}p + ${job.codegenResult.tokenUsage.completionTokens}c = ${job.codegenResult.tokenUsage.totalTokens}t`);
          }
          
          // List first 5 files
          console.log(`  ✓ Generated files (showing first 5):`);
          job.codegenResult.files.slice(0, 5).forEach(f => {
            console.log(`     - ${f.path} (${f.content.length} chars)`);
          });
          
          if (job.codegenResult.files.length > 5) {
            console.log(`     ... and ${job.codegenResult.files.length - 5} more`);
          }
          
          // Verify entrypoints
          if (job.codegenResult.entrypoints) {
            console.log(`  ✓ Entrypoints:`);
            if (job.codegenResult.entrypoints.run) {
              console.log(`     run: ${job.codegenResult.entrypoints.run}`);
            }
            if (job.codegenResult.entrypoints.dev) {
              console.log(`     dev: ${job.codegenResult.entrypoints.dev}`);
            }
            if (job.codegenResult.entrypoints.build) {
              console.log(`     build: ${job.codegenResult.entrypoints.build}`);
            }
          }
          
          // Check files exist in output
          const fs = require('fs');
          const path = require('path');
          console.log(`  ✓ Verifying files in output directory...`);
          let existCount = 0;
          job.codegenResult.files.slice(0, 5).forEach(f => {
            const outputPath = path.join(job.paths.outputDir, f.path);
            if (fs.existsSync(outputPath)) {
              existCount++;
            } else {
              console.error(`     ✗ ${f.path} MISSING from output`);
            }
          });
          console.log(`     ✓ ${existCount}/${Math.min(5, job.codegenResult.files.length)} verified files exist in output`);
        }
        
        updateJobStatus(job, 'generated');
      } catch (error) {
        console.error(`  ✗ Code generator failed: ${error.message}`);
        console.error(`     Falling back to placeholders`);
        
        // Fallback to placeholders
        markStageStart(job, 'artifact_generation');
        const files = writePlaceholderArtifacts(job);
        markStageEnd(job, 'artifact_generation');
        updateJobStatus(job, 'generated');
        console.log(`  ✓ Created ${files.length} placeholder files as fallback`);
        
        markStageStart(job, 'output_copy');
        const copiedCount = copyWorkspaceToOutput(job);
        markStageEnd(job, 'output_copy');
        console.log(`  ✓ Copied ${copiedCount} files to output directory`);
      }
    } else {
      // No LLM - just generate placeholders
      const stepNum = 4;
      console.log(`\n📍 Step ${stepNum}: Generate Placeholder Artifacts`);
      markStageStart(job, 'artifact_generation');
      const files = writePlaceholderArtifacts(job);
      markStageEnd(job, 'artifact_generation');
      updateJobStatus(job, 'generated');
      console.log(`  ✓ Created ${files.length} placeholder files:`);
      files.forEach(file => console.log(`    - ${file}`));

      // Copy to output
      console.log(`\n📍 Step ${stepNum + 1}: Copy to Output`);
      markStageStart(job, 'output_copy');
      const copiedCount = copyWorkspaceToOutput(job);
      markStageEnd(job, 'output_copy');
      console.log(`  ✓ Copied ${copiedCount} files to output directory`);
    }

    // Verify output
    const stepNum = testWithLLM ? 7 : 6;
    console.log(`\n📍 Step ${stepNum}: Verify Output`);
    const outputFiles = listOutputFiles(job);
    console.log(`  ✓ Output contains ${outputFiles.length} files:`);
    outputFiles.slice(0, 10).forEach(file => console.log(`    - ${file}`));
    if (outputFiles.length > 10) {
      console.log(`    ... and ${outputFiles.length - 10} more`);
    }

    // Mark complete
    updateJobStatus(job, 'done');

    // Print summary
    console.log(`\n📍 Job Summary:`);
    console.log(getJobSummary(job).split('\n').map(line => `  ${line}`).join('\n'));

    // Print token totals (if LLM tested)
    if (testWithLLM && (job.spec || job.plan || job.codegenResult)) {
      console.log(`\n📊 Total Token Usage:`);
      let totalPrompt = 0;
      let totalCompletion = 0;
      let totalTokens = 0;
      
      if (job.spec?.tokenUsage) {
        totalPrompt += job.spec.tokenUsage.promptTokens;
        totalCompletion += job.spec.tokenUsage.completionTokens;
        totalTokens += job.spec.tokenUsage.totalTokens;
      }
      if (job.plan?.tokenUsage) {
        totalPrompt += job.plan.tokenUsage.promptTokens;
        totalCompletion += job.plan.tokenUsage.completionTokens;
        totalTokens += job.plan.tokenUsage.totalTokens;
      }
      if (job.codegenResult?.tokenUsage) {
        totalPrompt += job.codegenResult.tokenUsage.promptTokens;
        totalCompletion += job.codegenResult.tokenUsage.completionTokens;
        totalTokens += job.codegenResult.tokenUsage.totalTokens;
      }
      
      console.log(`  Prompt tokens: ${totalPrompt}`);
      console.log(`  Completion tokens: ${totalCompletion}`);
      console.log(`  Total tokens: ${totalTokens}`);
    }

  } catch (error) {
    console.error(`\n❌ Test failed:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
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
