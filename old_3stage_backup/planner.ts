/**
 * Planner (LLM Call #2)
 * 
 * Converts improved spec into an internal execution plan for the code generator.
 * Produces plan.json with file structure, steps, and acceptance mapping.
 */

import * as path from 'path';
import { Job, Plan, ProjectType } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../ai/openRouterService';

/**
 * Get the model to use for planning (configurable via env)
 */
function getPlannerModel(): string {
  return process.env.PLANNER_MODEL || 'openai/gpt-oss-120b';
}

/**
 * Build the system prompt for the planner
 */
function buildPlannerPrompt(projectType: ProjectType): string {
  return `You are a software architecture planner. Your job is to convert a detailed specification into a concrete execution plan for code generation.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text before or after the JSON
- NO emojis or personality

Required JSON structure:
{
  "title": "string",
  "projectType": "${projectType}",
  "buildStrategy": "none" | "static" | "node",
  "filePlan": [
    {
      "path": "string",
      "purpose": "string",
      "notes": "string"
    }
  ],
  "steps": [
    {
      "id": "S1",
      "name": "short step name",
      "goal": "what this step accomplishes",
      "inputs": ["what it depends on"],
      "outputs": ["what artifacts it produces/updates"],
      "risk": "low" | "medium" | "high",
      "validation": ["how we would know this step is correct"]
    }
  ],
  "acceptanceMapping": [
    {
      "checklistItem": "string (from acceptanceChecklist)",
      "coveredBySteps": ["S1", "S2"]
    }
  ],
  "guardrails": {
    "noExternalAssets": false,
    "singleShotUserFlow": true,
    "noUserIteration": true,
    "doNotAddFeaturesNotInSpec": true
  }
}

RULES:
- steps: MUST be 8-20 items (enough detail, not excessive)
- filePlan: List ALL files that should be generated
- buildStrategy: 
  * static_html → "static"
  * node_project → "node"
  * discord_bot → "node"
- acceptanceMapping: EVERY checklist item MUST map to at least one step
- Do NOT invent new requirements beyond the spec
- Plan for single-shot generation (no user iteration)
- Include validation notes per step
- risk: low (straightforward), medium (some complexity), high (critical/complex)

PROJECT-SPECIFIC FILE EXPECTATIONS:
${getProjectFileGuidance(projectType)}`;
}

/**
 * Get project-specific file structure guidance
 */
function getProjectFileGuidance(projectType: ProjectType): string {
  const guidance: Record<ProjectType, string> = {
    static_html: `
For static_html projects:
- filePlan should include: index.html, styles.css, script.js (if needed)
- May include: README.md, assets/* (if images/icons needed)
- buildStrategy: "static"`,

    node_project: `
For node_project projects:
- filePlan should include: package.json, src/index.js (or src/server.js)
- May include: src/routes/*, src/controllers/*, src/middleware/*, .env.example, README.md
- buildStrategy: "node"`,

    discord_bot: `
For discord_bot projects:
- filePlan should include: src/index.js, package.json, .env.example, README.md
- May include: src/commands/*, src/events/*, src/config/*, deploy-commands.js
- buildStrategy: "node"`,
  };

  return guidance[projectType];
}

/**
 * Validate plan structure
 */
function validatePlan(data: any, job: Job): data is Plan {
  const log = (msg: string) => writeJobLog(job, msg);
  
  if (!data || typeof data !== 'object') {
    log('Validation failed: data is not an object');
    return false;
  }
  if (typeof data.title !== 'string' || !data.title) {
    log('Validation failed: title is missing or not a string');
    return false;
  }
  if (data.projectType !== job.projectType) {
    log(`Validation failed: projectType '${data.projectType}' does not match job projectType '${job.projectType}'`);
    return false;
  }
  if (!['none', 'static', 'node'].includes(data.buildStrategy)) {
    log(`Validation failed: buildStrategy '${data.buildStrategy}' is invalid (must be none/static/node)`);
    return false;
  }
  
  // Validate filePlan
  if (!Array.isArray(data.filePlan) || data.filePlan.length < 1) {
    log(`Validation failed: filePlan is not an array or empty (length: ${data.filePlan?.length || 0})`);
    return false;
  }
  if (!data.filePlan.every((f: any) => 
    typeof f.path === 'string' && 
    typeof f.purpose === 'string' && 
    typeof f.notes === 'string'
  )) {
    log('Validation failed: filePlan contains invalid entries (must have path, purpose, notes as strings)');
    return false;
  }
  
  // Validate steps
  if (!Array.isArray(data.steps) || data.steps.length < 8 || data.steps.length > 20) {
    log(`Validation failed: steps array has ${data.steps?.length || 0} items (need 8-20)`);
    return false;
  }
  if (!data.steps.every((s: any) => 
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.goal === 'string' &&
    Array.isArray(s.inputs) &&
    Array.isArray(s.outputs) &&
    ['low', 'medium', 'high'].includes(s.risk) &&
    Array.isArray(s.validation)
  )) {
    log('Validation failed: steps contain invalid entries (must have id/name/goal/inputs/outputs/risk/validation)');
    return false;
  }
  
  // Validate acceptanceMapping
  if (!Array.isArray(data.acceptanceMapping)) {
    log('Validation failed: acceptanceMapping is not an array');
    return false;
  }
  if (!job.spec) {
    log('Validation failed: job.spec is missing');
    return false;
  }
  
  // Check coverage: every checklist item must be mapped
  const mappedItems = new Set(data.acceptanceMapping.map((m: any) => m.checklistItem));
  const allCovered = job.spec.acceptanceChecklist.every(item => mappedItems.has(item));
  if (!allCovered) {
    log(`Validation failed: not all acceptance checklist items are mapped (${mappedItems.size}/${job.spec.acceptanceChecklist.length})`);
    return false;
  }
  
  if (!data.acceptanceMapping.every((m: any) =>
    typeof m.checklistItem === 'string' &&
    Array.isArray(m.coveredBySteps) &&
    m.coveredBySteps.length > 0
  )) {
    log('Validation failed: acceptanceMapping contains invalid entries');
    return false;
  }
  
  // Validate guardrails
  if (!data.guardrails || typeof data.guardrails !== 'object') {
    log('Validation failed: guardrails is missing or not an object');
    return false;
  }
  if (typeof data.guardrails.noExternalAssets !== 'boolean') {
    log('Validation failed: guardrails.noExternalAssets must be boolean');
    return false;
  }
  if (typeof data.guardrails.singleShotUserFlow !== 'boolean') {
    log('Validation failed: guardrails.singleShotUserFlow must be boolean');
    return false;
  }
  if (typeof data.guardrails.noUserIteration !== 'boolean') {
    log('Validation failed: guardrails.noUserIteration must be boolean');
    return false;
  }
  if (typeof data.guardrails.doNotAddFeaturesNotInSpec !== 'boolean') {
    log('Validation failed: guardrails.doNotAddFeaturesNotInSpec must be boolean');
    return false;
  }
  
  return true;
}

/**
 * Parse LLM response and extract JSON
 */
function parsePlannerResponse(response: string): any | null {
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
 * Run the planner stage
 */
export async function runPlanner(
  job: Job,
  aiService: OpenRouterService
): Promise<void> {
  if (!job.spec) {
    throw new Error('Cannot run planner without spec');
  }
  
  const model = getPlannerModel();
  
  writeJobLog(job, `Starting planner with model: ${model}`);
  writeJobLog(job, `Spec title: "${job.spec.title}"`);
  writeJobLog(job, `Project type: ${job.projectType}`);
  
  const systemPrompt = buildPlannerPrompt(job.projectType);
  const userPrompt = `Here is the detailed specification to plan for:

Title: ${job.spec.title}
Project Type: ${job.spec.projectType}

Specification:
${job.spec.spec}

Acceptance Checklist (MUST map ALL items):
${job.spec.acceptanceChecklist.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Generate the execution plan JSON now.`;
  
  let attempt = 0;
  let rawResponse: string | null = null;
  let plan: Plan | null = null;
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
    writeJobLog(job, `Attempt ${attempt}: Calling LLM for plan generation`);
    
    const result = await aiService.chatCompletionWithMetadata(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      {
        provider: {
          order: ['Cerebras', 'Together'],
          allow_fallbacks: true
        }
      }
    );
    
    rawResponse = result.content;
    
    if (result.metadata.usage) {
      tokenUsage.promptTokens = result.metadata.usage.promptTokens || 0;
      tokenUsage.completionTokens = result.metadata.usage.completionTokens || 0;
      tokenUsage.totalTokens = result.metadata.usage.totalTokens || 0;
      tokenUsage.cost = result.metadata.estimatedCost || 0;
    }
    
    writeJobLog(job, `Received response (${rawResponse.length} chars, ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
    
    const parsed = parsePlannerResponse(rawResponse);
    if (parsed && validatePlan(parsed, job)) {
      plan = parsed as Plan;
      writeJobLog(job, `✓ Successfully parsed plan on attempt ${attempt}`);
    }
  } catch (error) {
    writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Attempt 2: Retry with fix instructions if needed
  if (!plan && attempt === 1) {
    try {
      attempt = 2;
      writeJobLog(job, `Attempt ${attempt}: Retrying with fix instructions`);
      
      const fixPrompt = `Your previous response was not valid JSON or did not match the required schema. Please return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text.

CRITICAL REQUIREMENTS:
- projectType must be "${job.projectType}"
- steps must be 8-20 items
- filePlan must have at least 1 entry
- acceptanceMapping MUST cover ALL ${job.spec!.acceptanceChecklist.length} checklist items
- guardrails must be an object with all required boolean fields

Return the plan JSON now:`;
      
      const result = await aiService.chatCompletionWithMetadata(
        [
          { role: 'system', content: 'Return only valid JSON. No markdown. No extra text.' },
          { role: 'user', content: fixPrompt },
        ],
        model
      );
      
      rawResponse = result.content;
      
      // Add token usage from retry
      if (result.metadata.usage) {
        tokenUsage.promptTokens += result.metadata.usage.promptTokens || 0;
        tokenUsage.completionTokens += result.metadata.usage.completionTokens || 0;
        tokenUsage.totalTokens += result.metadata.usage.totalTokens || 0;
        tokenUsage.cost += result.metadata.estimatedCost || 0;
      }
      
      writeJobLog(job, `Received retry response (${rawResponse.length} chars, cumulative: ${tokenUsage.totalTokens} tokens, $${tokenUsage.cost.toFixed(4)})`);
      
      const parsed = parsePlannerResponse(rawResponse);
      if (parsed && validatePlan(parsed, job)) {
        plan = parsed as Plan;
        writeJobLog(job, `✓ Successfully parsed plan on attempt ${attempt}`);
      }
    } catch (error) {
      writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Final validation
  if (!plan) {
    writeJobLog(job, `✗ Failed to generate valid plan after ${attempt} attempts`);
    writeJobLog(job, `Raw response: ${rawResponse?.substring(0, 500) || 'null'}`);
    throw new Error('Failed to generate valid execution plan');
  }
  
  // Log plan summary
  writeJobLog(job, `Plan summary:`);
  writeJobLog(job, `  Steps: ${plan.steps.length}`);
  writeJobLog(job, `  Files: ${plan.filePlan.length}`);
  writeJobLog(job, `  Build strategy: ${plan.buildStrategy}`);
  writeJobLog(job, `  Acceptance coverage: ${plan.acceptanceMapping.length}/${job.spec!.acceptanceChecklist.length}`);
  
  // Log to console
  console.log(`📋 Plan Generated:`);
  console.log(`   Steps: ${plan.steps.length}`);
  console.log(`   Files: ${plan.filePlan.length}`);
  console.log(`   Build: ${plan.buildStrategy}`);
  
  // Store token usage
  job.diagnostics.tokenUsage.planner = tokenUsage;
  
  // Save plan to job
  job.plan = plan;
  
  // Save plan.json
  const planJsonPath = path.join(job.paths.workspaceDir, 'plan.json');
  safeWriteFile(planJsonPath, JSON.stringify(plan, null, 2));
  writeJobLog(job, `Saved plan.json: ${planJsonPath}`);
  
  // Save plan.txt (human-friendly)
  const planTxtPath = path.join(job.paths.workspaceDir, 'plan.txt');
  const planText = `Title: ${plan.title}
Project Type: ${plan.projectType}
Build Strategy: ${plan.buildStrategy}

File Plan (${plan.filePlan.length} files):
${plan.filePlan.map((f, i) => `${i + 1}. ${f.path}
   Purpose: ${f.purpose}
   Notes: ${f.notes}`).join('\n\n')}

Execution Steps (${plan.steps.length} steps):
${plan.steps.map(s => `[${s.id}] ${s.name}
   Goal: ${s.goal}
   Inputs: ${s.inputs.join(', ') || 'none'}
   Outputs: ${s.outputs.join(', ')}
   Risk: ${s.risk}
   Validation: ${s.validation.join('; ')}`).join('\n\n')}

Acceptance Mapping:
${plan.acceptanceMapping.map((m, i) => `${i + 1}. "${m.checklistItem}"
   Covered by: ${m.coveredBySteps.join(', ')}`).join('\n\n')}

Guardrails:
- No external assets: ${plan.guardrails.noExternalAssets}
- Single-shot user flow: ${plan.guardrails.singleShotUserFlow}
- No user iteration: ${plan.guardrails.noUserIteration}
- Do not add features not in spec: ${plan.guardrails.doNotAddFeaturesNotInSpec}`;
  
  safeWriteFile(planTxtPath, planText);
  writeJobLog(job, `Saved plan.txt: ${planTxtPath}`);
  
  writeJobLog(job, `Plan generation complete - Title: "${plan.title}"`);
}
