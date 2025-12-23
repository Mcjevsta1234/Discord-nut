/**
 * Prompt Improver (LLM Call #1)
 * 
 * Transforms raw user requests into detailed implementation specs.
 * First stage in the LLM pipeline - outputs structured spec for planner/generator.
 */

import * as path from 'path';
import { Job, ImprovedSpec, ProjectType } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../ai/openRouterService';

/**
 * Get the model to use for prompt improvement (configurable via env)
 */
function getPromptImproverModel(): string {
  return process.env.PROMPT_IMPROVER_MODEL || 'openai/gpt-oss-120b';
}

/**
 * Build the system prompt for the prompt improver
 */
function buildSystemPrompt(projectType: ProjectType): string {
  const commonRules = `You are a technical specification writer. Your job is to transform a user's brief request into a DETAILED implementation spec.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text before or after the JSON
- NO emojis or personality

Required JSON structure:
{
  "title": "short project title",
  "projectType": "${projectType}",
  "spec": "detailed multi-line specification",
  "output": {
    "format": "single_file" or "multi_file",
    "primaryFile": "filename.ext",
    "notes": "optional brief note"
  }
}

The "spec" field must be VERY detailed with explicit requirements. Use \\n for line breaks.`;

  const projectSpecificRules: Record<ProjectType, string> = {
    static_html: `
PROJECT TYPE: static_html
Requirements for spec field:
- Prefer multi_file format with separate HTML, CSS, and JS files for better organization
- Use completely offline assets (no CDNs, no external imports) unless user explicitly requested
- Include exact layout sections, navigation, interactions, color schemes
- Specify responsive behavior (mobile, tablet, desktop)
- Include accessibility requirements
- State "client-side demo/mock only" if backend would normally be needed
- Mention specific HTML5 semantic tags to use
- Detail file structure (index.html, styles.css, script.js if needed)`,

    node_project: `
PROJECT TYPE: node_project
Requirements for spec field:
- Always use multi_file format with proper project structure
- Default to Express.js unless user asked for different framework
- Prefer JavaScript unless user explicitly requested TypeScript
- Include package.json scripts needed (start, dev, etc)
- Specify detailed file structure (src/index.js, routes/, controllers/, middleware/, etc)
- Include basic README requirements
- Detail API endpoints if applicable
- Mention error handling approach
- State port and environment variables needed`,

    discord_bot: `
PROJECT TYPE: discord_bot
Requirements for spec field:
- Use discord.js v14
- Prefer multi_file format with organized structure (commands/, events/, config/) for better maintainability
- Use single_file only if the bot is extremely simple (1-2 commands)
- Include .env.example requirements (NO REAL TOKENS)
- Specify commands/interactions needed and their file organization
- Detail event handlers required and where they should be placed
- Include README with setup steps
- Mention intents required
- State whether slash commands or prefix commands
- NEVER include actual bot tokens`,
  };

  return commonRules + '\n\n' + projectSpecificRules[projectType];
}

/**
 * Validate the improved spec JSON structure
 */
function validateSpec(data: any): data is ImprovedSpec {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.title !== 'string' || !data.title) return false;
  if (!['static_html', 'node_project', 'discord_bot'].includes(data.projectType)) return false;
  if (typeof data.spec !== 'string' || !data.spec) return false;
  if (!data.output || typeof data.output !== 'object') return false;
  if (!['single_file', 'multi_file'].includes(data.output.format)) return false;
  if (typeof data.output.primaryFile !== 'string' || !data.output.primaryFile) return false;
  
  return true;
}

/**
 * Parse LLM response and extract JSON
 */
function parseImproverResponse(response: string): ImprovedSpec | null {
  try {
    // Try direct JSON parse first
    const parsed = JSON.parse(response);
    if (validateSpec(parsed)) {
      return parsed as ImprovedSpec;
    }
    return null;
  } catch {
    // If direct parse fails, try to extract JSON from markdown
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (validateSpec(parsed)) {
          return parsed as ImprovedSpec;
        }
      } catch {
        return null;
      }
    }
    
    // Try to find JSON object anywhere in the response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (validateSpec(parsed)) {
          return parsed as ImprovedSpec;
        }
      } catch {
        return null;
      }
    }
    
    return null;
  }
}

/**
 * Run the prompt improver stage
 */
export async function runPromptImprover(
  job: Job,
  aiService: OpenRouterService
): Promise<void> {
  const model = getPromptImproverModel();
  
  writeJobLog(job, `Starting prompt improver with model: ${model}`);
  writeJobLog(job, `User message: "${job.input.userMessage}"`);
  writeJobLog(job, `Project type: ${job.projectType}`);
  
  const systemPrompt = buildSystemPrompt(job.projectType);
  const userPrompt = `User request: ${job.input.userMessage}\n\nGenerate the detailed specification JSON now.`;
  
  let attempt = 0;
  let rawResponse: string | null = null;
  let spec: ImprovedSpec | null = null;
  let tokenUsage = {
    promptTokens: null as number | null,
    completionTokens: null as number | null,
    totalTokens: null as number | null,
    model,
  };
  
  // Attempt 1: Initial call
  try {
    attempt = 1;
    writeJobLog(job, `Attempt ${attempt}: Calling LLM for spec generation`);
    
    const result = await aiService.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model
    );
    
    rawResponse = result;
    
    // Try to extract token usage if available (OpenRouter sometimes includes this)
    // For now, we'll leave as null since we don't have direct access to response metadata
    writeJobLog(job, `Received response (${rawResponse.length} chars)`);
    
    spec = parseImproverResponse(rawResponse);
    
    if (spec) {
      writeJobLog(job, `✓ Successfully parsed spec on attempt ${attempt}`);
    }
  } catch (error) {
    writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Attempt 2: Retry with fix instructions if needed
  if (!spec && attempt === 1) {
    try {
      attempt = 2;
      writeJobLog(job, `Attempt ${attempt}: Retrying with fix instructions`);
      
      const fixPrompt = `Your previous response was not valid JSON. Please return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text. Just the raw JSON object starting with { and ending with }.

Required structure:
{
  "title": "string",
  "projectType": "${job.projectType}",
  "spec": "string",
  "output": {
    "format": "single_file" or "multi_file",
    "primaryFile": "string",
    "notes": "optional string"
  }
}

Return the JSON now:`;
      
      const result = await aiService.chatCompletion(
        [
          { role: 'system', content: 'Return only valid JSON. No markdown. No extra text.' },
          { role: 'user', content: fixPrompt },
        ],
        model
      );
      
      rawResponse = result;
      writeJobLog(job, `Received retry response (${rawResponse.length} chars)`);
      
      spec = parseImproverResponse(rawResponse);
      
      if (spec) {
        writeJobLog(job, `✓ Successfully parsed spec on attempt ${attempt}`);
      }
    } catch (error) {
      writeJobLog(job, `✗ Attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Final validation
  if (!spec) {
    writeJobLog(job, `✗ Failed to generate valid spec after ${attempt} attempts`);
    writeJobLog(job, `Raw response: ${rawResponse?.substring(0, 500) || 'null'}`);
    throw new Error('Failed to generate valid specification');
  }
  
  // Store token usage
  job.diagnostics.tokenUsage.promptImprover = tokenUsage;
  
  // Save spec to job
  job.spec = spec;
  
  // Save spec.json
  const specJsonPath = path.join(job.paths.workspaceDir, 'spec.json');
  safeWriteFile(specJsonPath, JSON.stringify(spec, null, 2));
  writeJobLog(job, `Saved spec.json: ${specJsonPath}`);
  
  // Save spec.txt (human-friendly)
  const specTxtPath = path.join(job.paths.workspaceDir, 'spec.txt');
  const specText = `Title: ${spec.title}
Project Type: ${spec.projectType}
Output Format: ${spec.output.format}
Primary File: ${spec.output.primaryFile}
${spec.output.notes ? `Notes: ${spec.output.notes}\n` : ''}
Specification:
${spec.spec}`;
  
  safeWriteFile(specTxtPath, specText);
  writeJobLog(job, `Saved spec.txt: ${specTxtPath}`);
  
  writeJobLog(job, `Spec generation complete - Title: "${spec.title}"`);
  writeJobLog(job, `Primary file: ${spec.output.primaryFile} (${spec.output.format})`);
}
