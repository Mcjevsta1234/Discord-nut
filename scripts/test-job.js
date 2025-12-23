#!/usr/bin/env node
/**
 * Job System Test Script
 * 
 * Tests the job lifecycle without Discord:
 * - Router decision
 * - Job creation
 * - Directory creation
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

console.log('=== Job System Test Suite ===\n');

const testMessages = [
  'create a landing page for my startup',
  'build a discord bot with slash commands',
  'make an Express API server',
];

testMessages.forEach((message, index) => {
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

    // Step 5: Generate placeholders
    console.log('\n📍 Step 4: Generate Placeholder Artifacts');
    markStageStart(job, 'artifact_generation');
    const files = writePlaceholderArtifacts(job);
    markStageEnd(job, 'artifact_generation');
    updateJobStatus(job, 'generated');
    console.log(`  ✓ Created ${files.length} placeholder files:`);
    files.forEach(file => console.log(`    - ${file}`));

    // Step 6: Copy to output
    console.log('\n📍 Step 5: Copy to Output');
    markStageStart(job, 'output_copy');
    const copiedCount = copyWorkspaceToOutput(job);
    markStageEnd(job, 'output_copy');
    console.log(`  ✓ Copied ${copiedCount} files to output directory`);

    // Step 7: Verify output
    console.log('\n📍 Step 6: Verify Output');
    const outputFiles = listOutputFiles(job);
    console.log(`  ✓ Output contains ${outputFiles.length} files:`);
    outputFiles.forEach(file => console.log(`    - ${file}`));

    // Step 8: Mark complete
    updateJobStatus(job, 'done');

    // Step 9: Print summary
    console.log('\n📍 Job Summary:');
    console.log(getJobSummary(job).split('\n').map(line => `  ${line}`).join('\n'));

  } catch (error) {
    console.error(`\n❌ Test ${index + 1} failed:`, error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ Test suite completed!');
console.log('='.repeat(80) + '\n');
