import * as path from 'path';
import { Job, CodegenResult } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../ai/openRouterService';
import { LLMResponseMetadata } from '../ai/llmMetadata';
import { getPresetForProjectType, isWebProject } from '../ai/presets';

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

function parseCodegenResponse(raw: string): CodegenResult {
  const trimmed = raw.trim();
  
  let jsonStr = trimmed;
  if (trimmed.startsWith('```json')) {
    const match = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  } else if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const validation = validateCodegenResult(parsed);
    
    if (!validation.ok) {
      throw new Error(`Invalid codegen result: ${validation.errors.join('; ')}`);
    }
    
    return validation.normalized!;
  } catch (err) {
    throw new Error(`Failed to parse codegen response: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
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

  const userRequest = `PROJECT REQUEST:
${job.input.userMessage}

Generate complete, production-ready code following the requirements above.
Return ONLY the JSON object (no markdown, no explanation).`;

  writeJobLog(job, `System prompt length: ${systemPrompt.length} chars`);
  writeJobLog(job, `User request length: ${userRequest.length} chars`);

  // Check if model supports reasoning (minimax, deepseek, etc)
  const supportsReasoning = model.includes('minimax') || model.includes('deepseek-r1');
  
  const response = await aiService.chatCompletionWithMetadata(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userRequest },
    ],
    model,
    {
      temperature: 0.3,
      max_tokens: 128000,
      ...(supportsReasoning && { reasoning: { enabled: true } }),
    }
  );

  writeJobLog(job, `Received codegen response: ${response.content.length} chars`);

  let result: CodegenResult;
  try {
    result = parseCodegenResponse(response.content);
    writeJobLog(job, `Parsed codegen result: ${result.files.length} files`);
  } catch (parseError) {
    writeJobLog(job, `Parse failed on first attempt: ${parseError instanceof Error ? parseError.message : 'Unknown'}`);
    
    if (onProgress) {
      await onProgress('Fixing JSON format...', 'Retrying with schema guidance');
    }

    const retryMessage = `Your previous output was not valid JSON. Here is what you returned:

${response.content.substring(0, MAX_RESPONSE_SNAPSHOT)}

Please convert this into the required JSON schema WITHOUT losing any content:

{
  "files": [{"path": "string", "content": "string"}],
  "entrypoints": {"run": "string", "dev": "string", "build": "string"},
  "notes": "string"
}

Return ONLY the corrected JSON object.`;

    const retryResponse = await aiService.chatCompletionWithMetadata(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userRequest },
        { role: 'assistant', content: response.content.substring(0, MAX_RESPONSE_SNAPSHOT), ...(response.reasoning_details && { reasoning_details: response.reasoning_details }) },
        { role: 'user', content: retryMessage },
      ],
      model,
      { 
        temperature: 0.2, 
        max_tokens: 128000,
        ...(supportsReasoning && { reasoning: { enabled: true } }),
      }
    );

    try {
      result = parseCodegenResponse(retryResponse.content);
      writeJobLog(job, `Parse succeeded on retry: ${result.files.length} files`);
    } catch (retryError) {
      writeJobLog(job, `Parse failed on retry: ${retryError instanceof Error ? retryError.message : 'Unknown'}`);
      throw new Error('Failed to generate valid code after retry');
    }
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
