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
 * - Saves test results as HTML
 * 
 * COST CONTROL: Tests only ONE project type per run
 * Set TEST_PROJECT_TYPE env var to test different types:
 *   - static_html (default)
 *   - node_project
 *   - discord_bot
 */

const fs = require('fs');
const path = require('path');
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

// HTML output collection
let htmlLog = [];
function logHTML(msg, type = 'info') {
  const timestamp = new Date().toISOString();
  htmlLog.push({ timestamp, message: msg, type });
  console.log(msg);
}

async function runTests() {
  console.log('='.repeat(80));
  console.log(`Test: "${testMessage}"`);
  console.log('='.repeat(80));

  let job; // Declare job in function scope
  
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
    logHTML(`\n❌ Test failed: ${error.message}`, 'error');
    if (error.stack) {
      logHTML(error.stack, 'error');
    }
    
    // Save HTML output even on failure
    saveHTMLReport(job, error);
    process.exit(1);
  }

  logHTML('\n' + '='.repeat(80));
  logHTML('✅ Test suite completed!', 'success');
  logHTML('='.repeat(80) + '\n');
  
  // Save HTML report
  saveHTMLReport(job);
}

// Generate HTML report
function saveHTMLReport(job, error = null) {
  const testResultsDir = path.join(__dirname, '..', 'test-results');
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlPath = path.join(testResultsDir, `test-${projectType}-${timestamp}.html`);
  
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job System Test - ${projectType} - ${new Date().toLocaleString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      background: #0d1117; 
      color: #c9d1d9; 
      padding: 20px; 
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #58a6ff; margin-bottom: 20px; border-bottom: 2px solid #30363d; padding-bottom: 10px; }
    h2 { color: #79c0ff; margin: 20px 0 10px; font-size: 1.3em; }
    h3 { color: #8b949e; margin: 15px 0 8px; font-size: 1.1em; }
    .metadata { 
      background: #161b22; 
      padding: 15px; 
      border-radius: 6px; 
      margin-bottom: 20px; 
      border: 1px solid #30363d;
    }
    .metadata-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }
    .metadata-item { padding: 8px; background: #0d1117; border-radius: 4px; }
    .metadata-label { color: #8b949e; font-size: 0.9em; }
    .metadata-value { color: #58a6ff; font-weight: bold; margin-top: 4px; }
    .log-entry { 
      padding: 8px 12px; 
      margin: 4px 0; 
      border-left: 3px solid #30363d; 
      background: #161b22;
      border-radius: 4px;
    }
    .log-entry.info { border-left-color: #58a6ff; }
    .log-entry.success { border-left-color: #3fb950; background: rgba(63, 185, 80, 0.1); }
    .log-entry.error { border-left-color: #f85149; background: rgba(248, 81, 73, 0.1); }
    .log-entry.warning { border-left-color: #d29922; background: rgba(210, 153, 34, 0.1); }
    .timestamp { color: #6e7681; font-size: 0.85em; margin-right: 10px; }
    .section { 
      background: #161b22; 
      padding: 20px; 
      margin: 20px 0; 
      border-radius: 6px; 
      border: 1px solid #30363d;
    }
    .file-list { list-style: none; }
    .file-list li { 
      padding: 8px; 
      margin: 4px 0; 
      background: #0d1117; 
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .file-list li:before { content: "📄 "; margin-right: 8px; }
    pre { 
      background: #0d1117; 
      padding: 15px; 
      border-radius: 4px; 
      overflow-x: auto; 
      border: 1px solid #30363d;
      font-size: 0.9em;
    }
    code { color: #79c0ff; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .stat-card { 
      background: #0d1117; 
      padding: 15px; 
      border-radius: 6px; 
      text-align: center; 
      border: 2px solid #30363d;
    }
    .stat-value { font-size: 2em; color: #58a6ff; font-weight: bold; }
    .stat-label { color: #8b949e; margin-top: 5px; }
    .success-banner { 
      background: linear-gradient(135deg, #238636 0%, #2ea043 100%); 
      padding: 20px; 
      border-radius: 8px; 
      text-align: center; 
      margin: 20px 0;
      font-size: 1.2em;
      font-weight: bold;
    }
    .error-banner { 
      background: linear-gradient(135deg, #da3633 0%, #f85149 100%); 
      padding: 20px; 
      border-radius: 8px; 
      text-align: center; 
      margin: 20px 0;
      font-size: 1.2em;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Job System Test Report</h1>
    
    <div class="metadata">
      <div class="metadata-grid">
        <div class="metadata-item">
          <div class="metadata-label">Project Type</div>
          <div class="metadata-value">${projectType}</div>
        </div>
        <div class="metadata-item">
          <div class="metadata-label">Test Message</div>
          <div class="metadata-value">${testMessage}</div>
        </div>
        <div class="metadata-item">
          <div class="metadata-label">Test Date</div>
          <div class="metadata-value">${new Date().toLocaleString()}</div>
        </div>
        <div class="metadata-item">
          <div class="metadata-label">LLM Mode</div>
          <div class="metadata-value">${testWithLLM ? 'ENABLED ⚠️' : 'DISABLED'}</div>
        </div>
      </div>
    </div>
    
    ${error ? `<div class="error-banner">❌ Test Failed: ${error.message}</div>` : '<div class="success-banner">✅ Test Completed Successfully</div>'}
`;

  if (job) {
    // Job Information
    html += `
    <div class="section">
      <h2>📋 Job Information</h2>
      <div class="metadata-grid">
        <div class="metadata-item">
          <div class="metadata-label">Job ID</div>
          <div class="metadata-value">${job.jobId}</div>
        </div>
        <div class="metadata-item">
          <div class="metadata-label">Status</div>
          <div class="metadata-value">${job.status}</div>
        </div>
        <div class="metadata-item">
          <div class="metadata-label">Created</div>
          <div class="metadata-value">${new Date(job.createdAt).toLocaleString()}</div>
        </div>
      </div>
      <h3>📁 Paths</h3>
      <pre><code>Workspace: ${job.paths.workspaceDir}
Output:    ${job.paths.outputDir}
Logs:      ${job.diagnostics.logsPath}</code></pre>
    </div>
`;

    // Spec Information
    if (job.spec) {
      html += `
    <div class="section">
      <h2>📝 Specification (LLM #1)</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${job.spec.spec.split(/\s+/).length}</div>
          <div class="stat-label">Words</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${(job.spec.spec.match(/^-\s/gm) || []).length}</div>
          <div class="stat-label">Bullets</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${job.spec.acceptanceChecklist.length}</div>
          <div class="stat-label">Acceptance Items</div>
        </div>
        ${job.spec.tokenUsage ? `
        <div class="stat-card">
          <div class="stat-value">${job.spec.tokenUsage.totalTokens?.toLocaleString() || '?'}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${(job.spec.cost || 0).toFixed(4)}</div>
          <div class="stat-label">Cost</div>
        </div>
        ` : ''}
      </div>
      <h3>Title: ${job.spec.title}</h3>
      <h3>Output Format: ${job.spec.output.format}</h3>
      <h3>Primary File: ${job.spec.output.primaryFile}</h3>
    </div>
`;
    }

    // Plan Information
    if (job.plan) {
      html += `
    <div class="section">
      <h2>📋 Execution Plan (LLM #2)</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${job.plan.steps.length}</div>
          <div class="stat-label">Steps</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${job.plan.filePlan.length}</div>
          <div class="stat-label">Files Planned</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${job.plan.acceptanceMapping.length}/${job.spec?.acceptanceChecklist.length || '?'}</div>
          <div class="stat-label">Coverage</div>
        </div>
        ${job.plan.tokenUsage ? `
        <div class="stat-card">
          <div class="stat-value">${job.plan.tokenUsage.totalTokens?.toLocaleString() || '?'}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${(job.plan.cost || 0).toFixed(4)}</div>
          <div class="stat-label">Cost</div>
        </div>
        ` : ''}
      </div>
      <h3>Build Strategy: ${job.plan.buildStrategy}</h3>
    </div>
`;
    }

    // Code Generation Results
    if (job.codegenResult) {
      html += `
    <div class="section">
      <h2>💻 Generated Code (LLM #3)</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${job.codegenResult.files.length}</div>
          <div class="stat-label">Files Generated</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${job.codegenResult.files.reduce((sum, f) => sum + f.content.length, 0).toLocaleString()}</div>
          <div class="stat-label">Total Characters</div>
        </div>
        ${job.codegenResult.tokenUsage ? `
        <div class="stat-card">
          <div class="stat-value">${job.codegenResult.tokenUsage.totalTokens?.toLocaleString() || '?'}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${(job.codegenResult.cost || 0).toFixed(4)}</div>
          <div class="stat-label">Cost</div>
        </div>
        ` : ''}
      </div>
      <h3>Notes:</h3>
      <p>${job.codegenResult.notes}</p>
      <h3>Generated Files:</h3>
      <ul class="file-list">
        ${job.codegenResult.files.map(f => `<li>${f.path} <span style="color: #6e7681;">(${f.content.length.toLocaleString()} chars)</span></li>`).join('\n        ')}
      </ul>
      ${job.codegenResult.entrypoints ? `
      <h3>Entrypoints:</h3>
      <pre><code>${Object.entries(job.codegenResult.entrypoints).map(([k, v]) => `${k}: ${v}`).join('\n')}</code></pre>
      ` : ''}
    </div>
`;
    }

    // Timing Information
    if (job.diagnostics.stageTimings && Object.keys(job.diagnostics.stageTimings).length > 0) {
      html += `
    <div class="section">
      <h2>⏱️ Stage Timings</h2>
      <div class="stats-grid">
        ${Object.entries(job.diagnostics.stageTimings).map(([stage, timing]) => `
        <div class="stat-card">
          <div class="stat-value">${((timing.end - timing.start) / 1000).toFixed(1)}s</div>
          <div class="stat-label">${stage}</div>
        </div>
        `).join('\n        ')}
      </div>
    </div>
`;
    }

    // Total Cost
    const totalCost = (job.spec?.cost || 0) + (job.plan?.cost || 0) + (job.codegenResult?.cost || 0);
    const totalTokens = (job.spec?.tokenUsage?.totalTokens || 0) + (job.plan?.tokenUsage?.totalTokens || 0) + (job.codegenResult?.tokenUsage?.totalTokens || 0);
    
    if (totalCost > 0 || totalTokens > 0) {
      html += `
    <div class="section">
      <h2>💰 Total Cost Summary</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${totalTokens.toLocaleString()}</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">$${totalCost.toFixed(4)}</div>
          <div class="stat-label">Total Cost</div>
        </div>
      </div>
    </div>
`;
    }
  }

  // Test Log
  html += `
    <div class="section">
      <h2>📜 Test Log</h2>
      ${htmlLog.map(entry => `
      <div class="log-entry ${entry.type}">
        <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span>${entry.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
      </div>
      `).join('\n      ')}
    </div>
`;

  html += `
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n📊 HTML report saved to: ${htmlPath}`);
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
