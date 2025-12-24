/**
 * Console Test - Full Code Generation with Zip and Extraction
 * 
 * Tests the complete workflow:
 * 1. Generate code with qwen model
 * 2. Create zip archive
 * 3. Extract zip to local directory
 * 4. Display all generated files
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Build TypeScript first
const { execSync } = require('child_process');
console.log('📦 Building TypeScript...\n');
try {
  execSync('npx tsc', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
} catch (error) {
  console.error('❌ Build failed');
  process.exit(1);
}

const { 
  createJob, 
  ensureJobDirs, 
  writeJobLog,
  markStageStart,
  markStageEnd,
  updateJobStatus,
  runPromptImprover,
  runPlanner,
  runCodeGenerator,
  createZipArchive,
  extractZipArchive,
  saveFilesLocally,
} = require('../dist/jobs');
const { ProjectRouter } = require('../dist/ai/projectRouter');
const { OpenRouterService } = require('../dist/ai/openRouterService');

// Prompt to test with
const TEST_PROMPT = process.argv[2] || 'create a simple todo list web app with HTML, CSS, and JavaScript. It should be colorful and modern with a gradient background.';

async function testConsoleGeneration() {
  console.log('🎯 Console Code Generation Test\n');
  console.log('📝 Prompt:', TEST_PROMPT);
  console.log('═'.repeat(80) + '\n');
  
  // Initialize OpenRouter service
  const aiService = new OpenRouterService(
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_BASE_URL
  );
  
  // STEP 1: Route to project type
  console.log('1️⃣  ROUTING PROJECT TYPE...');
  const projectDecision = ProjectRouter.route(TEST_PROMPT);
  console.log(`   ✓ Project Type: ${projectDecision.projectType}`);
  console.log(`   ✓ Preview Allowed: ${projectDecision.previewAllowed}`);
  console.log(`   ✓ Build Required: ${projectDecision.requiresBuild}\n`);
  
  // STEP 2: Create job
  console.log('2️⃣  CREATING JOB...');
  const job = createJob(projectDecision, {
    userMessage: TEST_PROMPT,
    userId: 'console-test-user',
    guildId: 'console-test',
    channelId: 'console-test-channel',
  });
  console.log(`   ✓ Job ID: ${job.jobId}`);
  console.log(`   ✓ Workspace: ${job.paths.workspaceDir}`);
  console.log(`   ✓ Output: ${job.paths.outputDir}\n`);
  
  ensureJobDirs(job);
  writeJobLog(job, `Console test: ${TEST_PROMPT}`);
  
  // STEP 3: Run prompt improver
  console.log('3️⃣  ANALYZING REQUIREMENTS...');
  markStageStart(job, 'prompt_improver');
  try {
    await runPromptImprover(job, aiService);
    updateJobStatus(job, 'planned');
    markStageEnd(job, 'prompt_improver');
    console.log(`   ✓ Spec Title: "${job.spec?.title}"`);
    console.log(`   ✓ Primary File: ${job.spec?.output.primaryFile}`);
    console.log(`   ✓ Format: ${job.spec?.output.format}\n`);
  } catch (error) {
    console.error('   ✗ Prompt improver failed:', error.message);
    throw error;
  }
  
  // STEP 4: Run planner
  console.log('4️⃣  CREATING EXECUTION PLAN...');
  markStageStart(job, 'planner');
  try {
    await runPlanner(job, aiService);
    markStageEnd(job, 'planner');
    console.log(`   ✓ Plan Steps: ${job.plan?.steps.length}`);
    console.log(`   ✓ Files Planned: ${job.plan?.filePlan.length}`);
    console.log(`   ✓ Build Strategy: ${job.plan?.buildStrategy}\n`);
    
    // Show file plan
    console.log('   📋 File Plan:');
    job.plan?.filePlan.forEach(file => {
      console.log(`      • ${file.path} - ${file.purpose}`);
    });
    console.log();
  } catch (error) {
    console.error('   ✗ Planner failed:', error.message);
    throw error;
  }
  
  // STEP 5: Generate code
  console.log('5️⃣  GENERATING CODE...');
  markStageStart(job, 'codegen');
  try {
    await runCodeGenerator(job, aiService);
    updateJobStatus(job, 'generated');
    markStageEnd(job, 'codegen');
    console.log(`   ✓ Files Generated: ${job.codegenResult?.files.length}`);
    console.log(`   ✓ Notes: ${job.codegenResult?.notes}\n`);
    
    // Show generated files with sizes
    console.log('   📁 Generated Files:');
    job.codegenResult?.files.forEach(file => {
      const size = Buffer.byteLength(file.content, 'utf8');
      console.log(`      • ${file.path} (${size} bytes)`);
    });
    console.log();
  } catch (error) {
    console.error('   ✗ Code generation failed:', error.message);
    throw error;
  }
  
  // STEP 6: Create zip archive
  console.log('6️⃣  CREATING ZIP ARCHIVE...');
  markStageStart(job, 'zip_archive');
  try {
    const zipPath = await createZipArchive(job);
    job.zipPath = zipPath;
    markStageEnd(job, 'zip_archive');
    
    const zipStats = fs.statSync(zipPath);
    console.log(`   ✓ Zip Created: ${path.basename(zipPath)}`);
    console.log(`   ✓ Zip Size: ${zipStats.size} bytes (${(zipStats.size / 1024).toFixed(2)} KB)`);
    console.log(`   ✓ Zip Path: ${zipPath}\n`);
  } catch (error) {
    console.error('   ✗ Zip creation failed:', error.message);
    throw error;
  }
  
  // STEP 7: Save files locally
  console.log('7️⃣  SAVING FILES LOCALLY...');
  try {
    const localDir = await saveFilesLocally(job, './output-local');
    console.log(`   ✓ Local Directory: ${localDir}`);
    
    const localFiles = fs.readdirSync(localDir);
    console.log(`   ✓ Files Saved: ${localFiles.length}\n`);
  } catch (error) {
    console.error('   ✗ Local save failed:', error.message);
    throw error;
  }
  
  // STEP 8: Extract zip to test extraction
  console.log('8️⃣  EXTRACTING ZIP ARCHIVE...');
  try {
    const extractDir = path.join('./output-local', `${job.jobId}-extracted`);
    await extractZipArchive(job.zipPath, extractDir);
    
    const extractedFiles = fs.readdirSync(extractDir);
    console.log(`   ✓ Extract Directory: ${extractDir}`);
    console.log(`   ✓ Files Extracted: ${extractedFiles.length}\n`);
    
    // Verify extraction matches original
    const originalFiles = fs.readdirSync(job.paths.outputDir);
    const allMatch = extractedFiles.every(file => originalFiles.includes(file));
    console.log(`   ✓ Extraction Verified: ${allMatch ? 'All files match' : 'Mismatch detected'}\n`);
  } catch (error) {
    console.error('   ✗ Extraction failed:', error.message);
    throw error;
  }
  
  // STEP 9: Display file contents
  console.log('9️⃣  FILE CONTENTS:\n');
  console.log('═'.repeat(80));
  
  for (const file of job.codegenResult?.files || []) {
    console.log(`\n📄 ${file.path}`);
    console.log('─'.repeat(80));
    
    // Truncate very long files
    const lines = file.content.split('\n');
    const maxLines = 50;
    
    if (lines.length > maxLines) {
      console.log(lines.slice(0, maxLines).join('\n'));
      console.log(`\n... (${lines.length - maxLines} more lines) ...`);
    } else {
      console.log(file.content);
    }
    
    console.log('─'.repeat(80));
  }
  
  // STEP 10: Summary
  console.log('\n' + '═'.repeat(80));
  console.log('✅ GENERATION COMPLETE!\n');
  console.log('📊 Summary:');
  console.log(`   • Job ID: ${job.jobId}`);
  console.log(`   • Project Type: ${job.projectType}`);
  console.log(`   • Files Generated: ${job.codegenResult?.files.length}`);
  console.log(`   • Zip Size: ${(fs.statSync(job.zipPath).size / 1024).toFixed(2)} KB`);
  console.log(`   • Local Directory: ./output-local/${job.jobId}`);
  console.log(`   • Extracted Directory: ./output-local/${job.jobId}-extracted`);
  console.log(`   • Logs: ${job.diagnostics.logsPath}\n`);
  
  console.log('🎯 Timings:');
  Object.entries(job.diagnostics.stageTimings)
    .filter(([key]) => !key.endsWith('_start'))
    .forEach(([stage, ms]) => {
      console.log(`   • ${stage}: ${ms}ms (${(ms / 1000).toFixed(2)}s)`);
    });
  
  const totalTime = Object.values(job.diagnostics.stageTimings)
    .filter((_, i) => i % 2 === 1) // Only end times
    .reduce((sum, val) => sum + val, 0);
  console.log(`   • TOTAL: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)\n`);
  
  console.log('💡 Next Steps:');
  console.log(`   1. Open: ./output-local/${job.jobId}/index.html`);
  console.log(`   2. Or extract: ${job.zipPath}`);
  console.log(`   3. Check logs: ${job.diagnostics.logsPath}\n`);
  
  updateJobStatus(job, 'done');
}

// Run test
console.log('🚀 Starting Console Generation Test...\n');
testConsoleGeneration()
  .then(() => {
    console.log('✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  });
