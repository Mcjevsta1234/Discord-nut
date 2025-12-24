/**
 * PART C: Direct Cached Code Generator
 * 
 * Skips prompter + planner, goes straight to code generation using
 * preset cached prompts + user request.
 * 
 * Only used when model supports caching.
 */

import * as path from 'path';
import { Job, CodegenResult, ProjectType } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService, buildCachedMessage } from '../ai/openRouterService';
import { LLMResponseMetadata } from '../ai/llmMetadata';
import { getPresetForProjectType, isWebProject } from '../ai/presets';

export function getCodegenModel(): string {
  return process.env.CODEGEN_MODEL || 'google/gemini-3-flash-preview';
}

const MAX_FILES = 60;
const MAX_TOTAL_CHARS = 1_800_000;
const MAX_RESPONSE_SNAPSHOT = 12_000;

type ValidationOutcome = {
  ok: boolean;
  errors: string[];
  normalized?: CodegenResult;
};

/**
 * Progress callback for live updates
 */
export type DirectCodegenProgressCallback = (message: string, details?: string) => Promise<void> | void;

/**
 * Validate codegen result structure and normalize
 */
function validateCodegenResult(parsed: any): ValidationOutcome {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== 'object') {
    errors.push('Response is not a JSON object');
    return { ok: false, errors };
  }

  // Required top-level keys
  if (!('files' in parsed)) errors.push('Missing "files" key');
  if (!('notes' in parsed)) errors.push('Missing "notes" key');

  // Validate files array
  if (!Array.isArray(parsed.files)) {
    errors.push('"files" must be an array');
  } else {
    if (parsed.files.length === 0) {
      errors.push('files array is empty - must generate at least one file');
    }
    if (parsed.files.length > MAX_FILES) {
      errors.push(`Too many files: ${parsed.files.length} (max ${MAX_FILES})`);
    }

    let totalChars = 0;
    parsed.files.forEach((file: any, i: number) => {
      if (!file.path || typeof file.path !== 'string') {
        errors.push(`File ${i}: missing or invalid "path"`);
      }
      if (!('content' in file) || typeof file.content !== 'string') {
        errors.push(`File ${i} (${file.path || 'unknown'}): missing or invalid "content"`);
      } else {
        totalChars += file.content.length;
      }
    });

    if (totalChars > MAX_TOTAL_CHARS) {
      errors.push(`Total content too large: ${totalChars} chars (max ${MAX_TOTAL_CHARS})`);
    }
  }

  // Validate notes
  if (typeof parsed.notes !== 'string') {
    errors.push('"notes" must be a string');
  }

  // Normalize entrypoints (optional)
  const entrypoints = parsed.entrypoints || {};
  const normalized: CodegenResult = {
    files: parsed.files || [],
    entrypoints: {
      run: entrypoints.run || undefined,
      dev: entrypoints.dev || undefined,
      build: entrypoints.build || undefined,
    },
    notes: parsed.notes || '',
  };

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? normalized : undefined,
  };
}

/**
 * Robust JSON parser for LLM responses - handles markdown blocks, trailing commas, extra text
 */
function parseCodegenResponse(raw: string): CodegenResult {
  let jsonStr = raw.trim();
  
  // Step 1: Remove markdown code blocks
  if (jsonStr.startsWith('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }
  
  // Step 2: Extract JSON object if there's extra text
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    jsonStr = objMatch[0];
  }
  
  // Step 3: Fix common JSON issues
  // Remove trailing commas before closing braces/brackets
  jsonStr = jsonStr.replace(/,\s*([\}\]])/g, '$1');
  
  // Step 4: Try to parse - if it fails, try to fix and parse again
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (firstError) {
    // Try alternative parsing with relaxed JSON (allow trailing commas, comments)
    try {
      // Remove comments
      let cleaned = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      
      // Fix unescaped newlines in strings (common LLM mistake)
      // This is tricky - we need to find strings and escape newlines within them
      // For now, just try parsing and if it fails, give up
      
      parsed = JSON.parse(cleaned);
    } catch (secondError) {
      throw new Error(`Failed to parse JSON: ${firstError instanceof Error ? firstError.message : 'Unknown error'}. Raw response length: ${raw.length} chars. Try position ${(firstError as any).message?.match(/position (\d+)/)?.[1] || 'unknown'}`);
    }
  }
  
  const validation = validateCodegenResult(parsed);
  
  if (!validation.ok) {
    throw new Error(`Invalid codegen result: ${validation.errors.join('; ')}`);
  }
  
  return validation.normalized!;
}

/**
 * Run direct cached code generation (PART C: direct_cached pipeline)
 * 
 * Skips prompter and planner entirely.
 * Uses preset cached prompts + user request.
 * 
 * @param job Job instance
 * @param aiService OpenRouter service
 * @param model Model to use (must support caching)
 * @param onProgress Progress callback
 * @returns LLM metadata
 */
export async function runDirectCachedCodegen(
  job: Job,
  aiService: OpenRouterService,
  model: string,
  onProgress?: DirectCodegenProgressCallback
): Promise<LLMResponseMetadata> {
  writeJobLog(job, `Starting direct cached code generation with model ${model}`);
  
  if (onProgress) {
    await onProgress('Generating code with cached prompts...', 'Single-shot generation (no spec/plan stages)');
  }

  // Get preset prompts for project type
  const preset = getPresetForProjectType(job.projectType);
  const isWeb = isWebProject(job.projectType);

  // Build cached message with stable prompt segments
  const cachedBlocks: string[] = [
    preset.stableSystemPrefix,
    preset.outputSchemaRules,
  ];

  // Add web-specific rubrics for web projects
  if (isWeb) {
    cachedBlocks.push(preset.fancyWebRubric);
    cachedBlocks.push(preset.placeholderImageGuide);
  }

  // User request as dynamic (non-cached) content
  const userRequest = `PROJECT REQUEST:
${job.input.userMessage}

Generate complete, production-ready code following the requirements above.
Return ONLY the JSON object (no markdown, no explanation).`;

  // Build message with cached blocks
  const messages = [
    buildCachedMessage('system', cachedBlocks, userRequest, model),
  ];

  writeJobLog(job, `Cached blocks: ${cachedBlocks.length}, total length: ${cachedBlocks.join('').length} chars`);
  writeJobLog(job, `User request length: ${userRequest.length} chars`);

  // Call LLM (single shot with caching)
  const response = await aiService.chatCompletionWithMetadata(messages, model, {
    temperature: 0.3,
    max_tokens: 128000,
  });

  writeJobLog(job, `Received codegen response: ${response.content.length} chars`);

  // Parse and validate response
  let result: CodegenResult;
  try {
    result = parseCodegenResponse(response.content);
    writeJobLog(job, `Parsed codegen result: ${result.files.length} files`);
  } catch (parseError) {
    writeJobLog(job, `Parse failed: ${parseError instanceof Error ? parseError.message : 'Unknown'}`);
    writeJobLog(job, `❌ RETRIES DISABLED - JSON parsing failed. Check model output.`);
    throw new Error(`Failed to generate valid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
  }

  // Web asset enforcement (replace external/local image URLs with Placeholdit)
  if (isWeb) {
    result.files = result.files.map(file => {
      if (file.path.endsWith('.html') || file.path.endsWith('.css')) {
        return {
          path: file.path,
          content: enforceWebsiteAssets(file.content),
        };
      }
      return file;
    });
    writeJobLog(job, `Enforced website asset policy on HTML/CSS files`);
  }

  // Materialize files to workspace
  for (const file of result.files) {
    const fullPath = path.join(job.paths.workspaceDir, file.path);
    safeWriteFile(fullPath, file.content);
  }
  writeJobLog(job, `Materialized ${result.files.length} files to workspace`);

  // Store result in job
  job.codegenResult = result;

  if (onProgress) {
    await onProgress('Code generation complete!', `Generated ${result.files.length} files`);
  }

  return response.metadata;
}

/**
 * PART D: Helper to enforce website assets on generated files
 */
function enforceWebsiteAssets(content: string): string {
  // Replace external/local image URLs with Placeholdit
  // img src
  content = content.replace(
    /<img\s+[^>]*src=["']([^"']+)["']/gi,
    (match, url) => {
      if (url.startsWith('data:') || url.includes('placehold.it')) {
        return match; // Keep data URIs and existing Placeholdit
      }
      // Replace with contextual placeholder
      const contextPlaceholder = getContextualPlaceholder(match);
      return match.replace(url, contextPlaceholder);
    }
  );

  // CSS background-image
  content = content.replace(
    /background-image:\s*url\(["']?([^"')]+)["']?\)/gi,
    (match, url) => {
      if (url.startsWith('data:') || url.includes('placehold.it')) {
        return match;
      }
      const contextPlaceholder = getContextualPlaceholder(match);
      return match.replace(url, contextPlaceholder);
    }
  );

  return content;
}

/**
 * Get contextually appropriate Placeholdit URL
 */
function getContextualPlaceholder(context: string): string {
  const lower = context.toLowerCase();
  
  if (lower.includes('hero') || lower.includes('banner')) {
    return 'https://placeholdit.com/1200x600/241142/0f0808?text=Hero+Banner';
  }
  if (lower.includes('card') || lower.includes('feature')) {
    return 'https://placeholdit.com/600x400/241142/0f0808?text=Feature';
  }
  if (lower.includes('avatar') || lower.includes('profile') || lower.includes('user')) {
    return 'https://placeholdit.com/128x128/241142/0f0808?text=User';
  }
  if (lower.includes('logo')) {
    return 'https://placeholdit.com/200x60/241142/ffffff?text=Logo';
  }
  
  return 'https://placeholdit.com/600x400/241142/0f0808?text=Placeholder';
}
