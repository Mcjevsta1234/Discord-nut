import * as path from 'path';
import { Job, CodegenResult } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../llm/openRouterService';
import { LLMResponseMetadata } from '../llm/llmMetadata';
import { getPresetForProjectType, isWebProject } from '../llm/presets';

const MAX_FILES = 60;
const MAX_TOTAL_CHARS = 1_800_000;
const MAX_RESPONSE_SNAPSHOT = 12_000;

type ValidationOutcome = {
  ok: boolean;
  errors: string[];
  normalized?: CodegenResult;
};

export type DirectCodegenProgressCallback = (message: string, details?: string) => Promise<void> | void;

function validateCodegenResult(parsed: any): ValidationOutcome {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== 'object') {
    errors.push('Response is not a JSON object');
    return { ok: false, errors };
  }

  if (!('files' in parsed)) errors.push('Missing "files" key');
  if (!('notes' in parsed)) errors.push('Missing "notes" key');

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

  if (typeof parsed.notes !== 'string') {
    errors.push('"notes" must be a string');
  }

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
 * Repair invalid backslash escapes in JSON strings
 * Fixes common issues like \m, \_, \: by converting them to \\
 */
function repairInvalidBackslashes(jsonText: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  
  for (let i = 0; i < jsonText.length; i++) {
    const c = jsonText[i];
    
    if (!inStr) {
      if (c === '"') inStr = true;
      out += c;
      continue;
    }
    
    // Inside string
    if (esc) {
      // This char is escaped; just emit and clear esc flag
      out += c;
      esc = false;
      continue;
    }
    
    if (c === '\\') {
      const next = jsonText[i + 1] ?? '';
      const validEscape = next === '"' || next === '\\' || next === '/' || 
                          next === 'b' || next === 'f' || next === 'n' || 
                          next === 'r' || next === 't' || next === 'u';
      
      if (!validEscape) {
        // Invalid escape: repair by doubling the backslash
        out += '\\\\';
      } else {
        out += c;
        esc = true;
      }
      continue;
    }
    
    if (c === '"') {
      inStr = false;
      out += c;
      continue;
    }
    
    out += c;
  }
  
  return out;
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
  
  // Step 4: Try to parse - if it fails, use repair strategies
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (firstError) {
    const firstErrorMsg = firstError instanceof Error ? firstError.message : '';
    
    // If error is about bad escaped characters, try repair
    if (firstErrorMsg.includes('Bad escaped character') || firstErrorMsg.includes('Unexpected token') || firstErrorMsg.includes('escape')) {
      try {
        console.log('⚠️ JSON parse failed with escape error, attempting repair...');
        const repaired = repairInvalidBackslashes(jsonStr);
        parsed = JSON.parse(repaired);
        console.log('✓ JSON repair successful');
      } catch (repairError) {
        // Repair failed, try fallback
        try {
          let cleaned = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
          cleaned = cleaned.replace(/\\(?!["\\\/ bfnrtu])/g, '\\\\');
          parsed = JSON.parse(cleaned);
        } catch (secondError) {
          throw new Error(`Failed to parse JSON after repair: ${firstErrorMsg}. Raw response length: ${raw.length} chars.`);
        }
      }
    } else {
      // Other error, try fallback
      try {
        let cleaned = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        cleaned = cleaned.replace(/\\(?!["\\\/ bfnrtu])/g, '\\\\');
        parsed = JSON.parse(cleaned);
      } catch (secondError) {
        throw new Error(`Failed to parse JSON: ${firstErrorMsg}. Raw response length: ${raw.length} chars.`);
      }
    }
  }
  
  const validation = validateCodegenResult(parsed);
  
  if (!validation.ok) {
    throw new Error(`Invalid codegen result: ${validation.errors.join('; ')}`);
  }
  
  return validation.normalized!;
}

export async function runDirectCodegen(
  job: Job,
  aiService: OpenRouterService,
  model: string,
  onProgress?: DirectCodegenProgressCallback
): Promise<LLMResponseMetadata> {
  writeJobLog(job, `Starting direct code generation with model ${model} (no caching)`);
  
  if (onProgress) {
    await onProgress('Generating code...', 'Direct generation (no caching)');
  }

  const preset = getPresetForProjectType(job.projectType);
  const isWeb = isWebProject(job.projectType);

  // Build system prompt as plain string (no ContentBlocks)
  let systemPrompt = preset.stableSystemPrefix + '\n\n' + preset.outputSchemaRules;
  
  if (isWeb) {
    systemPrompt += '\n\n' + preset.fancyWebRubric + '\n\n' + preset.placeholderImageGuide;
  }
  
  systemPrompt += '\n\nIMPORTANT: Return ONLY valid JSON. No markdown. No code fences. All file contents MUST be valid JSON strings: escape backslashes as \\\\ and quotes as \\".';

  const userRequest = `PROJECT REQUEST:
${job.input.userMessage}

Generate complete, production-ready code following the requirements above.
Return ONLY the JSON object. Ensure all strings are properly escaped.`;

  writeJobLog(job, `System prompt length: ${systemPrompt.length} chars`);
  writeJobLog(job, `User request length: ${userRequest.length} chars`);

  // Check if model supports reasoning (minimax, deepseek, gemini, gpt, glm, etc)
  const supportsReasoning = model.includes('minimax') || model.includes('deepseek-r1') || model.includes('gemini') || model.includes('gpt') || model.includes('glm');
  
  if (supportsReasoning) {
    writeJobLog(job, `Model ${model} supports reasoning - enabling reasoning mode`);
  }
  
  const response = await aiService.chatCompletionWithMetadata(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userRequest },
    ],
    model,
    {
      temperature: 0.3,
      max_tokens: 128000,
      stream: false,
      response_format: { type: 'json_object' },
      plugins: [{ id: 'response-healing' }],
      ...(supportsReasoning && { reasoning: { enabled: true } }),
    }
  );

  writeJobLog(job, `Received codegen response: ${response.content.length} chars`);

  let result: CodegenResult;
  try {
    result = parseCodegenResponse(response.content);
    writeJobLog(job, `Parsed codegen result: ${result.files.length} files`);
  } catch (parseError) {
    writeJobLog(job, `Parse failed: ${parseError instanceof Error ? parseError.message : 'Unknown'}`);
    writeJobLog(job, `❌ RETRIES DISABLED - JSON parsing failed. Check model output.`);
    throw new Error(`Failed to generate valid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
  }

  // Web asset enforcement
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

  job.codegenResult = result;

  if (onProgress) {
    await onProgress('Code generation complete!', `Generated ${result.files.length} files`);
  }

  return response.metadata;
}

function enforceWebsiteAssets(content: string): string {
  content = content.replace(
    /<img\s+[^>]*src=["']([^"']+)["']/gi,
    (match, url) => {
      if (url.startsWith('data:') || url.includes('placehold.it')) {
        return match;
      }
      const contextPlaceholder = getContextualPlaceholder(match);
      return match.replace(url, contextPlaceholder);
    }
  );

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
