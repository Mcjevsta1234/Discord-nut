/**
 * Chunked code generator - generates files one at a time
 * Prevents buffer overflow and provides progress tracking
 */

import path from 'path';
import fs from 'fs';
import { Job, CodegenResult, ProjectType, FilePlanEntry } from './types';
import { writeJobLog, safeWriteFile } from './jobManager';
import { OpenRouterService } from '../llm/openRouterService';

// Configuration for dynamic token allocation
const TOKEN_ALLOCATION = {
  html_page: 12000,      // HTML pages need more for structure
  css: 10000,            // CSS files need space for comprehensive styling
  javascript: 10000,     // JS files need space for functionality
  config: 4000,          // Config files (package.json, .gitignore, etc.)
  readme: 6000,          // README files
  asset: 2000,           // Image placeholders, small assets
  directory: 500,        // Directory placeholders
  default: 8000          // Default for unknown types
};

// Hybrid model configuration
const MINIMAX_MODEL = 'minimax/minimax-m2.1';
const FREE_MODEL = 'kwaipilot/kat-coder-pro:free';
const MINIMAX_BUDGET = 64000; // 64K token budget cap
const CONSISTENCY_PASS_BUDGET = 10000; // Reserve 10K for final pass
const FOUNDATION_BUDGET = 28000; // index.html + CSS + JS in one call

// Track minimax usage
let minmaxTokensUsed = 0;

// Rate limit configuration (requests per minute)
const RATE_LIMITS = {
  free: 10,    // Conservative for free tier
  paid: 50     // More aggressive for paid tier
};

/**
 * Determine if using paid tier based on environment or model
 */
function isPaidTier(model: string): boolean {
  // Check environment variable
  if (process.env.OPENROUTER_TIER === 'paid') return true;
  if (process.env.OPENROUTER_TIER === 'free') return false;
  
  // Models that are typically free have 'free' in their name
  if (model.includes(':free')) return false;
  
  // Default to paid for safety (we'll be more conservative with rate limits)
  return true;
}

/**
 * Add delay between batch requests based on rate limits
 */
async function rateLimitDelay(isPaid: boolean, filesInBatch: number): Promise<void> {
  // Optimized delays based on testing - OpenRouter handles most rate limiting
  // We add small delays to be respectful and avoid overwhelming the API
  const delayMs = isPaid ? 200 : 1000;  // 0.2s for paid, 1s for free
  
  if (delayMs > 0) {
    console.log(`⏳ Rate limit delay: ${delayMs}ms`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

/**
 * Detect file type from path for token allocation
 */
function detectFileType(filePath: string): string {
  const lower = filePath.toLowerCase();
  
  // HTML pages
  if (lower.endsWith('.html')) return 'html_page';
  
  // Styles
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  
  // Scripts
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return 'javascript';
  
  // README
  if (lower.includes('readme')) return 'readme';
  
  // Config files
  if (lower.match(/\.(json|yaml|yml|toml|env|gitignore)$/)) return 'config';
  
  // Directories (usually just placeholders)
  if (lower.endsWith('/') || !lower.includes('.')) return 'directory';
  
  // Assets
  if (lower.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|ttf)$/)) return 'asset';
  
  return 'default';
}

/**
 * Calculate token allocation for each file based on type
 */
function calculateTokenAllocations(filePlan: FilePlanEntry[]): Map<string, number> {
  const allocations = new Map<string, number>();
  
  for (const file of filePlan) {
    const fileType = detectFileType(file.path);
    const tokens = (TOKEN_ALLOCATION as any)[fileType] || TOKEN_ALLOCATION.default;
    allocations.set(file.path, tokens);
  }
  
  return allocations;
}

/**
 * Analyze dependencies between files to determine generation order
 * Returns batches with foundation-first strategy
 */
function analyzeDependencies(filePlan: FilePlanEntry[]): { batches: string[][], batchTypes: string[] } {
  const batches: string[][] = [];
  const batchTypes: string[] = [];
  const htmlFiles: string[] = [];
  const cssFiles: string[] = [];
  const jsFiles: string[] = [];
  const configFiles: string[] = [];
  const assetFiles: string[] = [];
  const readmeFiles: string[] = [];
  
  // Categorize files
  for (const file of filePlan) {
    const fileType = detectFileType(file.path);
    
    switch (fileType) {
      case 'html_page':
        htmlFiles.push(file.path);
        break;
      case 'css':
        cssFiles.push(file.path);
        break;
      case 'javascript':
        jsFiles.push(file.path);
        break;
      case 'config':
      case 'directory':
        configFiles.push(file.path);
        break;
      case 'asset':
        assetFiles.push(file.path);
        break;
      case 'readme':
        readmeFiles.push(file.path);
        break;
      default:
        configFiles.push(file.path);
    }
  }
  
  // Batch 1: Config files and assets (no dependencies)
  if (configFiles.length > 0 || assetFiles.length > 0) {
    batches.push([...configFiles, ...assetFiles]);
    batchTypes.push('config');
  }
  
  // Batch 2: Foundation (index.html + CSS + JS in SINGLE CALL)
  // This prevents CSS styling issues
  const foundationFiles: string[] = [];
  const indexFile = htmlFiles.find(f => f.toLowerCase().includes('index') || f.toLowerCase().includes('landing'));
  if (indexFile) {
    foundationFiles.push(indexFile);
  }
  foundationFiles.push(...cssFiles);
  foundationFiles.push(...jsFiles);
  
  if (foundationFiles.length > 0) {
    batches.push(foundationFiles);
    batchTypes.push('foundation');
  }
  
  // Batch 3: Priority pages (complex/important pages get minimax)
  const priorityPages = htmlFiles.filter(f => 
    f !== indexFile && (
      f.includes('console') ||
      f.includes('mock') ||
      f.includes('about') ||
      f.includes('dashboard')
    )
  );
  
  if (priorityPages.length > 0) {
    batches.push(priorityPages);
    batchTypes.push('priority');
  }
  
  // Batch 4: Content pages (all remaining HTML - use free model)
  const contentPages = htmlFiles.filter(f => 
    f !== indexFile && !priorityPages.includes(f)
  );
  
  if (contentPages.length > 0) {
    batches.push(contentPages);
    batchTypes.push('content');
  }
  
  // Batch 5: README (depends on everything)
  if (readmeFiles.length > 0) {
    batches.push(readmeFiles);
    batchTypes.push('readme');
  }
  
  return { batches, batchTypes };
}

/**
 * Generate contextual guidance based on project type and user request
 */
function getProjectContextGuidance(projectType: ProjectType, userMessage: string): string {
  const lower = userMessage.toLowerCase();
  
  // Detect key themes from user message
  const themes = [];
  
  // Gaming/Minecraft specific
  if (lower.includes('minecraft') || lower.includes('gaming') || lower.includes('server host')) {
    themes.push('gaming aesthetics and server hosting features');
  }
  
  // E-commerce
  if (lower.includes('shop') || lower.includes('store') || lower.includes('ecommerce') || lower.includes('e-commerce')) {
    themes.push('e-commerce functionality, product displays, and shopping cart features');
  }
  
  // Portfolio
  if (lower.includes('portfolio') || lower.includes('showcase')) {
    themes.push('professional portfolio presentation and project showcasing');
  }
  
  // Dashboard/Admin
  if (lower.includes('dashboard') || lower.includes('admin')) {
    themes.push('dashboard UI, data visualization, and admin controls');
  }
  
  // Social/Community
  if (lower.includes('social') || lower.includes('community') || lower.includes('forum')) {
    themes.push('social features, user interaction, and community engagement');
  }
  
  // If no specific themes detected, provide generic guidance based on project type
  if (themes.length === 0) {
    switch (projectType) {
      case 'static_html':
        return 'Focus on clean, modern web design with responsive layouts and good UX.';
      case 'discord_bot':
        return 'Focus on Discord bot functionality, slash commands, event handling, and user interaction.';
      case 'node_project':
        return 'Focus on robust Node.js architecture, API design, and scalable backend patterns.';
      default:
        return 'Focus on clean, professional implementation following best practices.';
    }
  }
  
  return `Focus on ${themes.join(', ')}.`;
}

/**
 * Get project type description for prompts
 */
function getProjectTypeDescription(projectType: ProjectType): string {
  switch (projectType) {
    case 'static_html':
      return 'static website';
    case 'discord_bot':
      return 'Discord bot application';
    case 'node_project':
      return 'Node.js application';
    default:
      return 'application';
  }
}

function getCodegenModel(): string {
  return process.env.CODEGEN_MODEL || FREE_MODEL;
}

/**
 * Select model for specific file based on priority and budget
 */
function selectModelForFile(
  fileSpec: FilePlanEntry,
  tokenAllocation: number,
  isFoundationBatch: boolean = false
): string {
  // Foundation batch always uses minimax
  if (isFoundationBatch) {
    return MINIMAX_MODEL;
  }
  
  const available = MINIMAX_BUDGET - CONSISTENCY_PASS_BUDGET - minmaxTokensUsed;
  
  // If no budget left, use free
  if (available <= 0) {
    return FREE_MODEL;
  }
  
  // Priority files for minimax (if budget allows)
  const isPriority = 
    fileSpec.path.includes('console') ||
    fileSpec.path.includes('mock') ||
    fileSpec.path.includes('about') ||
    fileSpec.path.includes('api') ||
    fileSpec.path.includes('integration') ||
    fileSpec.path.includes('auth') ||
    fileSpec.path.includes('dashboard') ||
    fileSpec.purpose.toLowerCase().includes('core') ||
    fileSpec.purpose.toLowerCase().includes('important') ||
    fileSpec.purpose.toLowerCase().includes('critical');
  
  if (isPriority && tokenAllocation <= available) {
    minmaxTokensUsed += tokenAllocation;
    return MINIMAX_MODEL;
  }
  
  return FREE_MODEL;
}

/**
 * Get flexible token allocation for free model based on complexity
 */
function getFreeModelTokens(fileSpec: FilePlanEntry): number {
  const path = fileSpec.path.toLowerCase();
  
  // Complex pages get more tokens
  if (path.match(/index|landing|main|home/)) return 20000;
  if (path.match(/dashboard|admin|console/)) return 20000;
  
  // JavaScript gets more for logic
  if (path.endsWith('.js') || path.endsWith('.ts')) return 18000;
  
  // Standard HTML pages
  if (path.endsWith('.html')) return 16000;
  
  // Config files
  if (path.match(/\.(json|yaml|yml|toml)$/)) return 12000;
  
  return 16000; // Default
}

/**
 * Get provider configuration based on model
 */
function getProviderForModel(model: string) {
  const cerebrasModels = [
    'meta-llama/llama-3.3-70b-instruct',
  ];
  
  if (cerebrasModels.includes(model)) {
    return {
      provider: {
        order: ['Cerebras', 'Together'],
        allow_fallbacks: true,
        sort: 'throughput'
      }
    };
  }
  
  if (model.includes('minimax')) {
    return {
      reasoning: {
        enabled: true
      }
    };
  }
  
  return undefined;
}

/**
 * Parse response to extract file object
 */
function parseFileResponse(response: string): { path: string; content: string } | null {
  try {
    const parsed = JSON.parse(response);
    if (parsed.path && parsed.content) {
      return parsed;
    }
  } catch {
    // Try to extract from markdown
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.path && parsed.content) {
          return parsed;
        }
      } catch {}
    }
    
    // Try to find JSON object
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (parsed.path && parsed.content) {
          return parsed;
        }
      } catch {}
    }
  }
  
  return null;
}

/**
 * Generate a batch of files in parallel or as foundation
 */
async function generateBatch(
  job: Job,
  aiService: OpenRouterService,
  fileSpecs: FilePlanEntry[],
  tokenAllocations: Map<string, number>,
  providerConfig: any,
  generatedFiles: Map<string, { path: string; content: string }>,
  batchNum: number,
  totalBatches: number,
  isFoundationBatch: boolean = false
): Promise<{ tokensUsed: number; filesGenerated: number }> {
  const spec = job.spec!;
  const plan = job.plan!;
  
  const batchType = isFoundationBatch ? 'Foundation (Single Call)' : 'Parallel';
  console.log(`\n📦 Batch ${batchNum}/${totalBatches} [${batchType}]: ${fileSpecs.length} file(s)`);
  writeJobLog(job, `\n📦 Batch ${batchNum}/${totalBatches} [${batchType}]: ${fileSpecs.length} file(s)`);
  
  // Show what we're generating with model selection
  let batchTokensAllocated = 0;
  for (const fileSpec of fileSpecs) {
    const tokens = tokenAllocations.get(fileSpec.path) || 8000;
    const model = selectModelForFile(fileSpec, tokens, isFoundationBatch);
    const modelDisplay = model === MINIMAX_MODEL ? '💎 minimax' : '🆓 free';
    batchTokensAllocated += tokens;
    console.log(`   🔨 ${fileSpec.path} (${tokens.toLocaleString()} tokens) [${modelDisplay}]`);
    writeJobLog(job, `   - ${fileSpec.path} (${tokens.toLocaleString()} tokens) [${model}]`);
  }
  
  const batchStartTime = Date.now();
  
  // Track API calls for this batch
  let apiCallCount = 0;
  let tokensUsedThisBatch = 0;
  
  // Build comprehensive context including ALL previously generated files
  let fileStructureContext = '';
  if (generatedFiles.size > 0) {
    fileStructureContext = '\n\nPREVIOUSLY GENERATED FILES (FULL CONTENT):\n';
    fileStructureContext += '='.repeat(60) + '\n';
    
    for (const [filePath, file] of generatedFiles.entries()) {
      fileStructureContext += `\n### ${filePath} ###\n`;
      fileStructureContext += file.content;
      fileStructureContext += '\n' + '='.repeat(60) + '\n';
    }
  }
  
  // FOUNDATION BATCH: Generate all files in single API call
  if (isFoundationBatch) {
    console.log(`\n   ⚡ Foundation batch: Generating all files in single ${FOUNDATION_BUDGET.toLocaleString()} token call...`);
    apiCallCount++;
    
    const contextGuidance = getProjectContextGuidance(spec.projectType, job.input.userMessage);
    const projectTypeDesc = getProjectTypeDescription(spec.projectType);
    
    const systemPrompt = `You are an expert full-stack web developer. Generate ALL requested files in a SINGLE response.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON array of file objects
- NO markdown formatting (no \`\`\`json)
- NO extra text

Required JSON structure:
[
  {
    "path": "index.html",
    "content": "complete HTML content"
  },
  {
    "path": "styles.css",
    "content": "complete CSS content"
  },
  {
    "path": "main.js",
    "content": "complete JavaScript content"
  }
]

CRITICAL FOUNDATION REQUIREMENTS:
- index.html: Complete landing page with semantic HTML, proper structure, all sections
- styles.css: COMPREHENSIVE styling system that matches index.html EXACTLY - study the HTML structure you create and style every element
- main.js: ALL interactive features, complete functionality, no placeholders
- All files must work together seamlessly - they are being generated simultaneously
- Use modern best practices (CSS Grid/Flexbox, ES6+, semantic HTML5)
- Make it look PROFESSIONAL and POLISHED
- NO placeholders, NO TODOs - everything must be 100% complete`;

    const userPrompt = `Generate the complete website foundation in ONE response: index.html, styles.css, and main.js

Project Context:
Title: ${spec.title}
Type: ${spec.projectType} (${projectTypeDesc})
User Request: "${job.input.userMessage}"
Guidance: ${contextGuidance}

Files to generate:
${fileSpecs.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}

Key Requirements (ALL must be implemented):
${spec.acceptanceChecklist.map((item: string, i: number) => `${i + 1}. ${item}`).join('\n')}

CRITICAL: Generate ALL files as a JSON array. CSS must style the EXACT HTML structure you create.`;

    try {
      const response = await aiService.chatCompletionWithMetadata(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        MINIMAX_MODEL,
        {
          reasoning: { enabled: true },
          max_tokens: FOUNDATION_BUDGET
        }
      );

      const rawResponse = response.content;
      tokensUsedThisBatch = response.metadata.usage?.totalTokens || FOUNDATION_BUDGET;
      
      console.log(`   📊 API Call #${apiCallCount}: ${tokensUsedThisBatch.toLocaleString()} tokens used`);
      console.log(`   📝 Response length: ${rawResponse.length} chars`);
      console.log(`   📝 Response preview: ${rawResponse.substring(0, 200)}...`);
      
      // Parse array response
      let parsedArray: any[] = [];
      let parseMethod = 'none';
      
      try {
        parsedArray = JSON.parse(rawResponse);
        parseMethod = 'direct';
      } catch (e1) {
        console.log(`   ⚠️  Direct JSON parse failed: ${e1 instanceof Error ? e1.message : 'unknown'}`);
        
        // Try markdown json block
        const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            parsedArray = JSON.parse(jsonMatch[1]);
            parseMethod = 'markdown';
          } catch (e2) {
            console.log(`   ⚠️  Markdown JSON parse failed: ${e2 instanceof Error ? e2.message : 'unknown'}`);
          }
        }
        
        // Try to find raw array
        if (parsedArray.length === 0) {
          const arrayMatch = rawResponse.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            try {
              parsedArray = JSON.parse(arrayMatch[0]);
              parseMethod = 'regex';
            } catch (e3) {
              console.log(`   ⚠️  Regex array parse failed: ${e3 instanceof Error ? e3.message : 'unknown'}`);
            }
          }
        }
      }
      
      console.log(`   📊 Parse method: ${parseMethod}, array length: ${parsedArray.length}`);
      
      if (Array.isArray(parsedArray) && parsedArray.length > 0) {
        for (const fileObj of parsedArray) {
          if (fileObj.path && fileObj.content) {
            generatedFiles.set(fileObj.path, fileObj);
            console.log(`   ✓ ${fileObj.path} generated (${fileObj.content.length} chars)`);
            writeJobLog(job, `  ✓ ${fileObj.path} (${fileObj.content.length} chars)`);
          } else {
            console.log(`   ⚠️  Invalid file object: ${JSON.stringify(fileObj).substring(0, 100)}`);
          }
        }
      } else {
        console.log(`   ✗ Parse failed - not a valid array or empty`);
        console.log(`   📝 Full response: ${rawResponse}`);
        throw new Error('Failed to parse foundation batch response');
      }
    } catch (error) {
      console.log(`   ✗ Foundation batch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      writeJobLog(job, `  ✗ Foundation batch failed`);
    }
    
    const batchEndTime = Date.now();
    const batchDuration = ((batchEndTime - batchStartTime) / 1000).toFixed(1);
    
    console.log(`\n✓ Batch ${batchNum}/${totalBatches} complete: ${generatedFiles.size} files in ${batchDuration}s (${apiCallCount} API call)`);
    console.log(`   💎 Minimax tokens used: ${tokensUsedThisBatch.toLocaleString()}/${MINIMAX_BUDGET.toLocaleString()}`);
    writeJobLog(job, `✓ Batch ${batchNum} complete: ${generatedFiles.size} files in ${batchDuration}s`);
    
    return { tokensUsed: tokensUsedThisBatch, filesGenerated: generatedFiles.size };
  }
  
  // PARALLEL BATCH: Generate files individually in parallel
  // PARALLEL BATCH: Generate files individually in parallel
  const promises = fileSpecs.map(async (fileSpec) => {
    const tokens = tokenAllocations.get(fileSpec.path) || 8000;
    const model = selectModelForFile(fileSpec, tokens, false);
    
    apiCallCount++;
    const callNum = apiCallCount;
    
    // Get contextual guidance based on user's original request
    const contextGuidance = getProjectContextGuidance(spec.projectType, job.input.userMessage);
    const projectTypeDesc = getProjectTypeDescription(spec.projectType);
    
    const systemPrompt = `You are an expert full-stack web developer. Generate ONLY the specific file requested.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text

Required JSON structure:
{
  "path": "exact/file/path.ext",
  "content": "complete file content as string"
}

IMPORTANT FOR QUALITY:
- Generate production-ready, professional code
- If generating CSS: Study the HTML structure carefully and create comprehensive styles that match EXACTLY
- If generating JS: Reference the actual HTML elements and CSS classes used, ensure all functionality is complete
- If generating HTML: Use semantic, clean markup with proper class names and structure
- Maintain consistency across all files - they must work together seamlessly
- Use modern best practices (ES6+, CSS Grid/Flexbox, semantic HTML5)
- NO placeholders, NO TODOs, NO incomplete sections - every file must be 100% complete and polished

Generate complete, production-ready code that looks professional.`;

    const userPrompt = `Generate file: ${fileSpec.path}

Purpose: ${fileSpec.purpose}
Notes: ${fileSpec.notes}

Project Context:
Title: ${spec.title}
Type: ${spec.projectType} (${projectTypeDesc})
User Request: "${job.input.userMessage}"
Guidance: ${contextGuidance}

Full File Structure Plan:
${plan.filePlan.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}

Key Requirements (ALL must be implemented):
${spec.acceptanceChecklist.map((item: string, i: number) => `${i + 1}. ${item}`).join('\n')}
${fileStructureContext}

CRITICAL INSTRUCTIONS:
1. Generate ONLY ${fileSpec.path} as JSON
2. Make it 100% complete, production-ready, and polished
3. If CSS: Match HTML structure EXACTLY, use modern styling (Grid/Flexbox), make it look professional
4. If JS: Reference actual HTML elements, implement ALL functionality completely
5. If HTML: Use semantic markup, proper structure, accessibility features
6. Study the previously generated files above to ensure perfect consistency
7. Follow the user's original request and implement the features they asked for`;

    try {
      const providerConfigForModel = model === MINIMAX_MODEL ? { reasoning: { enabled: true } } : providerConfig;
      
      const response = await aiService.chatCompletionWithMetadata(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model,
        {
          ...providerConfigForModel,
          max_tokens: model === FREE_MODEL ? getFreeModelTokens(fileSpec) : tokens
        }
      );

      const rawResponse = response.content;
      const tokenCount = response.metadata.usage?.totalTokens || 0;
      tokensUsedThisBatch += tokenCount;
      
      console.log(`   📊 API Call #${callNum}: ${fileSpec.path} - ${tokenCount.toLocaleString()} tokens [${model === MINIMAX_MODEL ? 'minimax' : 'free'}]`);
      
      const parsed = parseFileResponse(rawResponse);
      
      if (parsed && typeof parsed.path === 'string' && typeof parsed.content === 'string') {
        writeJobLog(job, `  ✓ Generated ${fileSpec.path} (${parsed.content.length} chars, ${tokenCount} tokens)`);
        return { fileSpec, result: parsed, success: true, tokens: tokenCount, model };
      }
      
      writeJobLog(job, `  ✗ Failed to parse response for ${fileSpec.path}`);
      return { fileSpec, result: null, success: false, tokens: tokenCount, model };
    } catch (error) {
      writeJobLog(job, `  ✗ Error generating ${fileSpec.path}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { fileSpec, result: null, success: false, error: error instanceof Error ? error : new Error('Unknown error'), tokens: 0, model };
    }
  });
  
  // Wait for all files in batch to complete
  const results = await Promise.all(promises);
  
  const batchEndTime = Date.now();
  const batchDuration = ((batchEndTime - batchStartTime) / 1000).toFixed(1);
  
  // Collect failed files for retry
  const failedFiles: Array<{ fileSpec: FilePlanEntry; error?: Error }> = [];
  const completedFiles: string[] = [];
  
  // Store successfully generated files
  let successCount = 0;
  for (const result of results) {
    if (result.success && result.result) {
      generatedFiles.set(result.fileSpec.path, result.result);
      successCount++;
      completedFiles.push(result.fileSpec.path);
      console.log(`   ✓ ${result.fileSpec.path} generated (${result.result.content.length} chars)`);
    } else {
      console.log(`   ✗ ${result.fileSpec.path} failed`);
      failedFiles.push({ fileSpec: result.fileSpec, error: (result as any).error });
    }
  }
  
  console.log(`\n✓ Batch ${batchNum}/${totalBatches} complete: ${successCount}/${fileSpecs.length} files in ${batchDuration}s (${apiCallCount} API calls)`);
  console.log(`   💎 Minimax tokens used this batch: ${tokensUsedThisBatch.toLocaleString()}`);
  console.log(`   📁 Completed files:`);
  
  console.log(`\n✓ Batch ${batchNum}/${totalBatches} complete: ${successCount}/${fileSpecs.length} files in ${batchDuration}s (${apiCallCount} API calls)`);
  console.log(`   💎 Minimax tokens used this batch: ${tokensUsedThisBatch.toLocaleString()}`);
  console.log(`   📁 Completed files:`);
  for (const file of completedFiles) {
    console.log(`      ✓ ${file}`);
  }
  
  if (failedFiles.length > 0) {
    console.log(`   ⚠️  Failed files:`);
    for (const { fileSpec } of failedFiles) {
      console.log(`      ✗ ${fileSpec.path}`);
    }
  }
  
  writeJobLog(job, `✓ Batch ${batchNum} complete: ${successCount}/${fileSpecs.length} files in ${batchDuration}s`);
  
  // Retry failed files once
  if (failedFiles.length > 0 && failedFiles.length < fileSpecs.length) {
    console.log(`\n🔄 Retrying ${failedFiles.length} failed file(s)...`);
    writeJobLog(job, `🔄 Retrying ${failedFiles.length} failed file(s)...`);
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
    
    const retryPromises = failedFiles.map(async ({ fileSpec }) => {
      const tokens = tokenAllocations.get(fileSpec.path) || 8000;
      const model = selectModelForFile(fileSpec, tokens, false);
      console.log(`   🔄 Retry: ${fileSpec.path} [${model === MINIMAX_MODEL ? 'minimax' : 'free'}]`);
      
      apiCallCount++;
      
      // Use same generation logic (simplified for retry)
      const contextGuidance = getProjectContextGuidance(spec.projectType, job.input.userMessage);
      const projectTypeDesc = getProjectTypeDescription(spec.projectType);
      
      const systemPrompt = `You are an expert full-stack web developer. Generate ONLY the specific file requested.

CRITICAL OUTPUT FORMAT:
- Return EXACTLY one JSON object
- NO markdown formatting (no \`\`\`json)
- NO extra text

Required JSON structure:
{
  "path": "exact/file/path.ext",
  "content": "complete file content as string"
}

IMPORTANT FOR QUALITY:
- Generate production-ready, professional code
- If generating CSS: Study the HTML structure carefully and create comprehensive styles that match EXACTLY
- If generating JS: Reference the actual HTML elements and CSS classes used, ensure all functionality is complete
- If generating HTML: Use semantic, clean markup with proper class names and structure
- Maintain consistency across all files - they must work together seamlessly
- Use modern best practices (ES6+, CSS Grid/Flexbox, semantic HTML5)
- NO placeholders, NO TODOs, NO incomplete sections - every file must be 100% complete and polished

Generate complete, production-ready code that looks professional.`;

      let fileStructureContext = '';
      if (generatedFiles.size > 0) {
        fileStructureContext = '\n\nPREVIOUSLY GENERATED FILES (FULL CONTENT):\n';
        fileStructureContext += '='.repeat(60) + '\n';
        
        for (const [filePath, file] of generatedFiles.entries()) {
          fileStructureContext += `\n### ${filePath} ###\n`;
          fileStructureContext += file.content;
          fileStructureContext += '\n' + '='.repeat(60) + '\n';
        }
      }

      const userPrompt = `Generate file: ${fileSpec.path}

Purpose: ${fileSpec.purpose}
Notes: ${fileSpec.notes}

Project Context:
Title: ${spec.title}
Type: ${spec.projectType} (${projectTypeDesc})
User Request: "${job.input.userMessage}"
Guidance: ${contextGuidance}

Full File Structure Plan:
${plan.filePlan.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}

Key Requirements (ALL must be implemented):
${spec.acceptanceChecklist.map((item: string, i: number) => `${i + 1}. ${item}`).join('\n')}
${fileStructureContext}

CRITICAL INSTRUCTIONS:
1. Generate ONLY ${fileSpec.path} as JSON
2. Make it 100% complete, production-ready, and polished
3. If CSS: Match HTML structure EXACTLY, use modern styling (Grid/Flexbox), make it look professional
4. If JS: Reference actual HTML elements, implement ALL functionality completely
5. If HTML: Use semantic markup, proper structure, accessibility features
6. Study the previously generated files above to ensure perfect consistency
7. Follow the user's original request and implement the features they asked for`;

      try {
        const providerConfigForModel = model === MINIMAX_MODEL ? { reasoning: { enabled: true } } : providerConfig;
        
        const response = await aiService.chatCompletionWithMetadata(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model,
          {
            ...providerConfigForModel,
            max_tokens: model === FREE_MODEL ? getFreeModelTokens(fileSpec) : tokens
          }
        );

        const rawResponse = response.content;
        const tokenCount = response.metadata.usage?.totalTokens || 0;
        tokensUsedThisBatch += tokenCount;
        
        const parsed = parseFileResponse(rawResponse);
        
        if (parsed && typeof parsed.path === 'string' && typeof parsed.content === 'string') {
          return { fileSpec, result: parsed, success: true, tokens: tokenCount };
        }
        
        return { fileSpec, result: null, success: false, tokens: tokenCount };
      } catch (error) {
        return { fileSpec, result: null, success: false, tokens: 0 };
      }
    });
    
    const retryResults = await Promise.all(retryPromises);
    
    for (const result of retryResults) {
      if (result.success && result.result) {
        generatedFiles.set(result.fileSpec.path, result.result);
        successCount++;
        console.log(`   ✓ ${result.fileSpec.path} generated on retry (${result.result.content.length} chars)`);
        writeJobLog(job, `  ✓ Retry success: ${result.fileSpec.path}`);
      } else {
        console.log(`   ✗ ${result.fileSpec.path} failed on retry`);
        writeJobLog(job, `  ✗ Retry failed: ${result.fileSpec.path}`);
      }
    }
  }
  
  return { tokensUsed: tokensUsedThisBatch, filesGenerated: successCount };
}

/**
 * Run chunked code generator with hybrid parallelization
 */
export async function runCodeGeneratorChunked(
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
  const plan = job.plan;
  const spec = job.spec;
  
  writeJobLog(job, `Starting chunked code generator with model: ${model}`);
  writeJobLog(job, `Spec: "${spec.title}"`);
  writeJobLog(job, `Plan: ${plan.steps.length} steps, ${plan.filePlan.length} files`);
  
  const providerConfig = getProviderForModel(model);
  if (providerConfig?.provider) {
    writeJobLog(job, `Using provider: ${providerConfig.provider.order.join(', ')}`);
  } else if (providerConfig?.reasoning) {
    writeJobLog(job, `Using reasoning mode for ${model}`);
  } else {
    writeJobLog(job, `Using default OpenRouter routing for ${model}`);
  }
  
  // Calculate dynamic token allocation per file
  const tokenAllocations = calculateTokenAllocations(plan.filePlan);
  
  writeJobLog(job, ``);
  writeJobLog(job, `📊 Token Allocation:`);
  for (const [filePath, tokens] of tokenAllocations.entries()) {
    writeJobLog(job, `   ${filePath}: ${tokens.toLocaleString()} tokens`);
  }
  
  // Analyze dependencies and create batches
  const { batches, batchTypes } = analyzeDependencies(plan.filePlan);
  
  console.log(`\n🔄 Hybrid Model Strategy: 64K minimax budget + unlimited free`);
  console.log(`   💎 Minimax: ${MINIMAX_MODEL} ($0.30 in / $1.50 out per 1M tokens)`);
  console.log(`   🆓 Free: ${FREE_MODEL} ($0.00)`);
  console.log(`   🎯 Foundation: ${FOUNDATION_BUDGET.toLocaleString()} tokens (single call)`);
  console.log(`   🔒 Reserved for final pass: ${CONSISTENCY_PASS_BUDGET.toLocaleString()} tokens`);
  console.log(`   📊 Available for priority pages: ${(MINIMAX_BUDGET - FOUNDATION_BUDGET - CONSISTENCY_PASS_BUDGET).toLocaleString()} tokens\n`);
  
  console.log(`🔄 Generation Strategy: ${batches.length} batch(es)`);
  writeJobLog(job, ``);
  writeJobLog(job, `🔄 Generation Strategy: ${batches.length} batch(es) with hybrid model selection`);
  for (let i = 0; i < batches.length; i++) {
    const typeLabel = batchTypes[i] === 'foundation' ? ' [Foundation - Single Call]' : batchTypes[i] === 'priority' ? ' [Priority - Minimax]' : batchTypes[i] === 'content' ? ' [Content - Free]' : '';
    console.log(`   Batch ${i + 1}: ${batches[i].length} file(s)${typeLabel} - ${batches[i].join(', ')}`);
    writeJobLog(job, `   Batch ${i + 1}: ${batches[i].length} file(s)${typeLabel} - ${batches[i].join(', ')}`);
  }
  console.log(``);
  writeJobLog(job, ``);
  
  const generatedFilesMap = new Map<string, { path: string; content: string }>();
  const startTime = Date.now();
  let totalMinimaxTokens = 0;
  
  console.log(`🚀 Starting code generation...\n`);
  
  // Execute batches sequentially (files within each batch may be parallel or single call)
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batchPaths = batches[batchIndex];
    const batchSpecs = plan.filePlan.filter(f => batchPaths.includes(f.path));
    const isFoundation = batchTypes[batchIndex] === 'foundation';
    
    const batchResult = await generateBatch(
      job,
      aiService,
      batchSpecs,
      tokenAllocations,
      providerConfig,
      generatedFilesMap,
      batchIndex + 1,
      batches.length,
      isFoundation
    );
    
    totalMinimaxTokens += batchResult.tokensUsed;
    
    // Rate limit delay between batches (not after last batch)
    if (batchIndex < batches.length - 1) {
      const isPaid = isPaidTier(FREE_MODEL);
      await rateLimitDelay(isPaid, batchSpecs.length);
    }
  }
  
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  
  // Convert map to array
  const generatedFiles = Array.from(generatedFilesMap.values());
  
  // FINAL CONSISTENCY PASS: Check headers/footers/styling
  console.log(`\n🔍 Final Consistency Pass (${CONSISTENCY_PASS_BUDGET.toLocaleString()} tokens reserved)...`);
  writeJobLog(job, `\n🔍 Running final consistency pass...`);
  
  try {
    const htmlFiles = generatedFiles.filter(f => f.path.endsWith('.html'));
    
    if (htmlFiles.length > 1) {
      const systemPrompt = `You are an expert web developer performing quality assurance. Analyze all HTML pages and identify any inconsistencies in headers, footers, navigation, or styling.

Output a JSON object with recommended fixes:
{
  "issues": [
    { "file": "filename.html", "issue": "description", "fix": "how to fix it" }
  ],
  "suggestions": "overall recommendations"
}`;

      const userPrompt = `Review these HTML pages for consistency:

${htmlFiles.map(f => `### ${f.path} ###\n${f.content.substring(0, 2000)}...\n`).join('\n')}

Check for:
1. Headers/navigation identical across all pages
2. Footers identical across all pages
3. Consistent class names and styling approach
4. Proper internal links between pages
5. No broken references`;

      const response = await aiService.chatCompletionWithMetadata(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        MINIMAX_MODEL,
        {
          reasoning: { enabled: true },
          max_tokens: CONSISTENCY_PASS_BUDGET
        }
      );

      const consistencyTokens = response.metadata.usage?.totalTokens || CONSISTENCY_PASS_BUDGET;
      totalMinimaxTokens += consistencyTokens;
      
      console.log(`   ✓ Consistency check complete (${consistencyTokens.toLocaleString()} tokens)`);
      
      try {
        const analysis = JSON.parse(response.content);
        if (analysis.issues && analysis.issues.length > 0) {
          console.log(`   ⚠️  Found ${analysis.issues.length} consistency issue(s):`);
          for (const issue of analysis.issues.slice(0, 3)) {
            console.log(`      - ${issue.file}: ${issue.issue}`);
          }
          writeJobLog(job, `  ⚠️  Found ${analysis.issues.length} consistency issues - review recommended`);
        } else {
          console.log(`   ✓ No consistency issues found`);
          writeJobLog(job, `  ✓ Consistency check passed`);
        }
      } catch {
        console.log(`   ℹ️  Consistency analysis completed`);
      }
    }
  } catch (error) {
    console.log(`   ⚠️  Consistency pass failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    writeJobLog(job, `  ⚠️  Consistency pass failed`);
  }
  
  // Calculate costs
  const inputCost = (totalMinimaxTokens * 0.30) / 1000000;
  const outputCost = (totalMinimaxTokens * 1.50) / 1000000; // Approximate output same as input
  const totalCost = inputCost + outputCost;
  
  writeJobLog(job, ``);
  writeJobLog(job, `✓ Generated ${generatedFiles.length}/${plan.filePlan.length} files in ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`\n✓ Generated ${generatedFiles.length}/${plan.filePlan.length} files in ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`\n💰 Cost Analysis:`);
  console.log(`   💎 Minimax tokens used: ${totalMinimaxTokens.toLocaleString()}/${MINIMAX_BUDGET.toLocaleString()} (${((totalMinimaxTokens/MINIMAX_BUDGET)*100).toFixed(1)}%)`);
  console.log(`   💵 Estimated cost: $${totalCost.toFixed(4)} (~${(totalCost * 100).toFixed(2)} cents)`);
  console.log(`   🎯 Remaining budget: ${(MINIMAX_BUDGET - totalMinimaxTokens).toLocaleString()} tokens`);
  
  writeJobLog(job, `💎 Minimax tokens: ${totalMinimaxTokens.toLocaleString()}/${MINIMAX_BUDGET.toLocaleString()}`);
  writeJobLog(job, `💵 Est. cost: $${totalCost.toFixed(4)}`);
  
  if (generatedFiles.length === 0) {
    throw new Error('Failed to generate any files');
  }
  
  // Calculate total tokens allocated
  const totalTokensAllocated = Array.from(tokenAllocations.values()).reduce((sum, tokens) => sum + tokens, 0);
  
  // Create result object
  const result: CodegenResult = {
    files: generatedFiles,
    entrypoints: {
      run: spec.output.primaryFile
    },
    notes: `Generated ${generatedFiles.length} files using hybrid model strategy. Minimax: ${totalMinimaxTokens.toLocaleString()} tokens. Est. cost: $${totalCost.toFixed(4)}`
  };
  
  // Store in job
  job.codegenResult = result;
  
  // Track token usage in diagnostics
  if (!job.diagnostics.tokenUsage) {
    job.diagnostics.tokenUsage = { total: 0 };
  }
  job.diagnostics.tokenUsage.generator = {
    promptTokens: totalMinimaxTokens,
    completionTokens: 0,
    totalTokens: totalMinimaxTokens,
    cost: 0,
    model: `${MINIMAX_MODEL} + ${FREE_MODEL}`
  };
  
  // Materialize files to disk
  const generatedDir = path.join(job.paths.workspaceDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }
  
  for (const file of result.files) {
    const filePath = path.join(generatedDir, file.path);
    const fileDir = path.dirname(filePath);
    
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, file.content, 'utf-8');
  }
  
  writeJobLog(job, `✓ Wrote ${result.files.length} files to disk`);
  
  // Copy to output directory
  const copiedCount = copyGeneratedToOutput(job);
  writeJobLog(job, `✓ Copied ${copiedCount} files to output directory`);
}

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
