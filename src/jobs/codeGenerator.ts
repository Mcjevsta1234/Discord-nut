/**
 * Code Generator (LLM Call #3)
 * 
 * Generates actual project files based on spec and plan.
 * Outputs strict JSON file bundle, validates, and materializes to disk.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Job, CodegenResult, ProjectType } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../llm/openRouterService';

// Safety limits
const MAX_FILES = 60;
const MAX_TOTAL_CHARS = 1_800_000;

/**
 * Get the model to use for code generation (configurable via env)
 */
function getCodegenModel(): string {
  return process.env.CODEGEN_MODEL || 'minimax/minimax-m2.1';
}

/**
 * Build the system prompt for the codegen LLM call.
 */
function buildCodegenPrompt(projectType: ProjectType): string {
  return `You are a code generator. Your job is to generate complete, production-ready project files based on a detailed specification and execution plan.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text before or after the JSON
- NO explanations or commentary
- NO TODO placeholders - implement all functionality

Required JSON structure:
{
  "files": [
    {
      "path": "relative/path/from/root",
      "content": "complete file content as string"
    }
  ],
  "entrypoints": {
    "run": "command to run the project (optional)",
    "dev": "command for development mode (optional)",
    "build": "command to build (optional)"
  },
  "notes": "brief summary of what was generated"
}

REQUIREMENTS:
- Generate ALL files listed in the plan's filePlan
- Implement ALL acceptance checklist items from the spec
- Use complete, working code - NO placeholders or TODO comments
- Follow the execution steps from the plan
- Paths use forward slashes (/)
- All content must be valid UTF-8 text
- No binary files

PROJECT TYPE: ${projectType}
${getProjectTypeGuidance(projectType)}`;
}

/**
 * Provide additional guidance for specific project types.
 */
function getProjectTypeGuidance(projectType: ProjectType): string {
  const guidance: Record<ProjectType, string> = {
    static_html: `
For static_html projects:
- Generate index.html (and styles.css, script.js if needed)
- Use semantic HTML5
- Include complete, working CSS and JavaScript
- May use CDNs for fonts/libraries unless spec says otherwise
- Implement all interactive features from spec
- Include proper accessibility attributes
- Add real content (not "Lorem ipsum")`,

    node_project: `
For node_project projects:
- Generate package.json with all dependencies
- Generate src/ files with complete implementation
- Include README.md with setup/run instructions
- Use Express.js + Zod by default unless spec says otherwise
- Implement all API endpoints from spec
- Add proper error handling
- Include .env.example for configuration`,

    discord_bot: `
For discord_bot projects:
- Use discord.js v14
- Generate bot entry file (src/index.js or bot.js)
- Include package.json with discord.js@14
- Generate .env.example (NO REAL TOKENS)
- Include README.md with setup instructions
- Implement all commands from spec
- Add proper event handlers
- Use slash commands (interactions)`
  };

  return guidance[projectType];
}

/**
 * Validate path safety
 */
function isPathSafe(filePath: string): boolean {
  // No absolute paths
  if (path.isAbsolute(filePath)) return false;
  
  // No parent directory traversal
  if (filePath.includes('..')) return false;
  
  // No drive letters (Windows)
  if (/^[a-zA-Z]:/.test(filePath)) return false;
  
  // No null bytes
  if (filePath.includes('\0')) return false;
  
  // Must have content
  if (!filePath || filePath.trim() === '') return false;
  
  return true;
}

/**
 * Validate codegen result
 */
function validateCodegenResult(data: any): data is CodegenResult {
  if (!data || typeof data !== 'object') return false;
  
  // Validate files array
  if (!Array.isArray(data.files) || data.files.length === 0) return false;
  if (data.files.length > MAX_FILES) {
    console.log(`⚠ Too many files: ${data.files.length} > ${MAX_FILES}`);
    return false;
  }
  
  // Validate each file
  let totalChars = 0;
  for (const file of data.files) {
    if (typeof file.path !== 'string' || !file.path) return false;
    if (typeof file.content !== 'string') return false;
    if (!isPathSafe(file.path)) {
      console.log(`⚠ Unsafe path: ${file.path}`);
      return false;
    }
    totalChars += file.content.length;
  }
  
  if (totalChars > MAX_TOTAL_CHARS) {
    console.log(`⚠ Total content too large: ${totalChars} > ${MAX_TOTAL_CHARS}`);
    return false;
  }
  
  // Validate entrypoints
  if (!data.entrypoints || typeof data.entrypoints !== 'object') return false;
  
  // Validate notes
  if (typeof data.notes !== 'string') return false;
  
  return true;
}

/**
 * Parse LLM response and extract JSON
 */
function parseCodegenResponse(response: string): any | null {
  try {
    // Try direct JSON parse first
    const parsed = JSON.parse(response);
    return parsed;
  } catch {
    // If direct parse fails, try to extract JSON from markdown
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        return null;
      }
    }
    
    // Try to find JSON object anywhere in the response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    
    return null;
  }
}

/**
 * Materialize files to disk
 */
function materializeFiles(job: Job, result: CodegenResult): number {
  const generatedDir = path.join(job.paths.workspaceDir, 'generated');
  
  // Create generated directory
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }
  
  // Write each file
  let writtenCount = 0;
  for (const file of result.files) {
    const filePath = path.join(generatedDir, file.path);
    const fileDir = path.dirname(filePath);
    
    // Ensure parent directory exists
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(filePath, file.content, 'utf-8');
    writtenCount++;
    writeJobLog(job, `Generated: ${file.path} (${file.content.length} chars)`);
  }
  
  return writtenCount;
}

/**
 * Copy generated files to output directory
 */
function copyGeneratedToOutput(job: Job): number {
  const generatedDir = path.join(job.paths.workspaceDir, 'generated');
  
  if (!fs.existsSync(generatedDir)) {
    return 0;
  }
  
  let copiedCount = 0;
  
  function copyRecursive(srcDir: string, destDir: string) {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        copiedCount++;
      }
    }
  }
  
  copyRecursive(generatedDir, job.paths.outputDir);
  
  return copiedCount;
}

/**
 * Run the code generator stage
 */
export async function runCodeGenerator(
  job: Job,
  aiService: OpenRouterService
): Promise<void> {
  if (!job.spec) {
    throw new Error('Cannot run code generator without spec');
  }
  
  if (!job.plan) {
    throw new Error('Cannot run code generator without plan');
  }
  
  const model = getCodegenModel();
  
  writeJobLog(job, `Starting code generator with model: ${model}`);
  writeJobLog(job, `Spec: "${job.spec.title}"`);
  writeJobLog(job, `Plan: ${job.plan.steps.length} steps, ${job.plan.filePlan.length} files`);
  
  const systemPrompt = buildCodegenPrompt(job.projectType);
  
  // Build user prompt with spec + plan details
  const userPrompt = `Generate the complete project based on this specification and plan:

SPECIFICATION:
Title: ${job.spec.title}
Project Type: ${job.spec.projectType}
Output Format: ${job.spec.output.format}
Primary File: ${job.spec.output.primaryFile}

Detailed Spec:
${job.spec.spec}

Acceptance Checklist (MUST satisfy ALL items):
${job.spec.acceptanceChecklist.map((item, i) => `${i + 1}. ${item}`).join('\n')}

${(job.spec as any).ragContext ? `
REFERENCE CONTENT (Use for inspiration and context):
${(job.spec as any).ragContext}
` : ''}

EXECUTION PLAN:
Build Strategy: ${job.plan.buildStrategy}

Files to Generate:
${job.plan.filePlan.map((f, i) => `${i + 1}. ${f.path}
   Purpose: ${f.purpose}
   Notes: ${f.notes}`).join('\n\n')}

Execution Steps:
${job.plan.steps.map(s => `[${s.id}] ${s.name}
   Goal: ${s.goal}
   Risk: ${s.risk}`).join('\n\n')}

Generate the complete JSON file bundle now.`;
  
  let attempt = 0;
  let rawResponse: string | null = null;
  let result: CodegenResult | null = null;
  let tokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    model,
    cost: 0,
  };
  
  // Attempt 1: Initial call
  try {
    attempt = 1;
    writeJobLog(job, `Attempt ${attempt}: Calling LLM for code generation`);
    
    const response = await aiService.chatCompletionWithMetadata(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      {
        provider: {
          order: ['Cerebras', 'Together'],
          allow_fallbacks: true,
          sort: 'throughput'
        }
      }
    );
    
    rawResponse = response.content;
    
    // Track token usage from metadata
    if (response.metadata.usage) {
      tokenUsage.promptTokens = response.metadata.usage.promptTokens || 0;
      tokenUsage.completionTokens = response.metadata.usage.completionTokens || 0;
      tokenUsage.totalTokens = response.metadata.usage.totalTokens || 0;
      tokenUsage.cost = response.metadata.estimatedCost || 0;
    }
    
    writeJobLog(job, `Received response (${rawResponse.length} chars, ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
    
    // Save raw response
    const rawResponsePath = path.join(job.paths.workspaceDir, 'generated_response.json');
    safeWriteFile(rawResponsePath, rawResponse);
    writeJobLog(job, `Saved raw response: ${rawResponsePath}`);
    
    const parsed = parseCodegenResponse(rawResponse);
    if (parsed && validateCodegenResult(parsed)) {
      result = parsed as CodegenResult;
      writeJobLog(job, `✓ Successfully parsed codegen result on attempt ${attempt}`);
      writeJobLog(job, `  Files: ${result.files.length}`);
      writeJobLog(job, `  Total content: ${result.files.reduce((sum, f) => sum + f.content.length, 0)} chars`);
    }
  } catch (error) {
    writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Attempt 2: Retry with fix instructions if needed
  if (!result && attempt === 1) {
    try {
      attempt = 2;
      writeJobLog(job, `Attempt ${attempt}: Retrying with fix instructions`);
      
      const fixPrompt = `Your previous response was not valid JSON or did not match the required schema. Please return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text.

Required structure:
{
  "files": [
    { "path": "string", "content": "string" }
  ],
  "entrypoints": {
    "run": "optional string",
    "dev": "optional string",
Requirements:
- At least 1 file
- Maximum ${MAX_FILES} files
- Maximum ${MAX_TOTAL_CHARS} total characters
- Safe paths (no .., no absolute, no drive letters)
- Complete implementation (no TODO placeholders)

Return the JSON now:`;
      
      const response = await aiService.chatCompletionWithMetadata(
        [
          { role: 'system', content: 'Return only valid JSON. No markdown. No extra text. Generate complete file contents with no placeholders.' },
          { role: 'user', content: fixPrompt },
        ],
        model,
        {
          provider: {
            order: ['Cerebras', 'Together'],
            allow_fallbacks: true,
            sort: 'throughput'
          }
        }
      );
      
      rawResponse = response.content;
      
      // Add token usage from retry
      if (response.metadata.usage) {
        tokenUsage.promptTokens += response.metadata.usage.promptTokens || 0;
        tokenUsage.completionTokens += response.metadata.usage.completionTokens || 0;
        tokenUsage.totalTokens += response.metadata.usage.totalTokens || 0;
        tokenUsage.cost += response.metadata.estimatedCost || 0;
      }
      
      writeJobLog(job, `Received retry response (${rawResponse.length} chars, cumulative: ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
      
      // Save retry response
      const retryResponsePath = path.join(job.paths.workspaceDir, 'generated_response_retry.json');
      safeWriteFile(retryResponsePath, rawResponse);
      
      const parsed = parseCodegenResponse(rawResponse);
      if (parsed && validateCodegenResult(parsed)) {
        result = parsed as CodegenResult;
        writeJobLog(job, `✓ Successfully parsed codegen result on attempt ${attempt}`);
      }
    } catch (error) {
      writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Final validation
  if (!result) {
    writeJobLog(job, `✗ Failed to generate valid code after ${attempt} attempts`);
    writeJobLog(job, `Raw response: ${rawResponse?.substring(0, 500) || 'null'}`);
    throw new Error('Failed to generate valid code');
  }
  
  // Log summary
  writeJobLog(job, `Code generation summary:`);
  writeJobLog(job, `  Files: ${result.files.length}`);
  writeJobLog(job, `  Notes: ${result.notes}`);
  if (result.entrypoints.run) {
    writeJobLog(job, `  Run: ${result.entrypoints.run}`);
  }
  
  // Log to console
  console.log(`💻 Code Generated:`);
  console.log(`   Files: ${result.files.length}`);
  console.log(`   Notes: ${result.notes}`);
  
  // Store token usage
  job.diagnostics.tokenUsage.generator = tokenUsage;
  
  // Store result in job
  job.codegenResult = result;
  
  // Materialize files to disk
  const writtenCount = materializeFiles(job, result);
  writeJobLog(job, `Materialized ${writtenCount} files to generated/`);
  
  // Copy to output directory
  const copiedCount = copyGeneratedToOutput(job);
  writeJobLog(job, `Copied ${copiedCount} files to output directory`);
  
  writeJobLog(job, `Code generation complete`);
}
