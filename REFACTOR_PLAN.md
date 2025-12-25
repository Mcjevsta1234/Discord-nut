# Site Pipeline Refactor Plan

## Goal
Refactor `tools/generate-site.ts` to support `/web` and `/web-pro` modes with smart page-count intent detection.

## Changes Required

### 1. Add Exports (DONE)
```typescript
export type WebMode = 'web' | 'web-pro';
export type IntentPlan = { pages: number; reason: string; explicit: boolean };
function detectPageIntent(prompt: string): IntentPlan
function getCommonRules(theme: string): string
```

### 2. Update Function Signatures

#### improveWebsitePrompt()
```typescript
// BEFORE
async function improveWebsitePrompt(
  rawPrompt: string,
  client: ReturnType<typeof createClient>
): Promise<PrompterResult>

// AFTER
async function improveWebsitePrompt(
  rawPrompt: string,
  client: ReturnType<typeof createClient>,
  commonRules: string
): Promise<PrompterResult>
```
- Append `commonRules` to prompterPrompt before calling model

#### phase0GenerateContract()
```typescript
// BEFORE  
async function phase0GenerateContract(
  client: ReturnType<typeof createClient>,
  siteBrief: string
): Promise<{ siteSpec: SiteSpec; templates: Templates }>

// AFTER
async function phase0GenerateContract(
  client: ReturnType<typeof createClient>,
  siteBrief: string,
  minPages: number,
  mode: WebMode,
  commonRules: string,
  distDir: string
): Promise<{ siteSpec: SiteSpec; templates: Templates }>
```
- Use `minPages` instead of global `MIN_PAGES`
- If `mode === 'web-pro'`, set `PHASE_0_MODEL = 'google/gemini-3-flash-preview'`
- If `mode === 'web'`, keep current behavior (`kwaipilot/kat-coder-pro:free`)
- Append `commonRules` to prompt
- Remove cache priming logic (already disabled for free models)
- Use `distDir` parameter instead of global `DIST_DIR`

#### phase1GeneratePages()
```typescript
// BEFORE
async function phase1GeneratePages(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec,
  poolsLoader: ReturnType<typeof createModelPoolsLoader>
): Promise<PageGeneration[]>

// AFTER
async function phase1GeneratePages(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec,
  poolsLoader: ReturnType<typeof createModelPoolsLoader>,
  mode: WebMode,
  commonRules: string,
  distDir: string
): Promise<PageGeneration[]>
```
- If `mode === 'web-pro'`, use `'google/gemini-3-flash-preview'` instead of BULK pool
- If `mode === 'web'`, use BULK pool (current behavior)
- Append `commonRules` to buildPrompt()
- Use `distDir` parameter

#### Helper Functions
Update all these to accept `distDir` parameter:
- `ensureAppJs(distDir: string)`
- `freezeCanonicalPartials(siteSpec, templates, distDir, partialsDir)`
- `patchIndexAfterPhase0(siteSpec, templates, routeMap, distDir)`
- `assembleAllPages(pageGenerations, siteSpec, templates, routeMap, distDir)`
- `formatAllFiles(distDir: string)`
- `phase1LegacyGeneration(client, siteSpec, distDir)`

### 3. Model Selection Logic

```typescript
function getPhase0Model(mode: WebMode): string {
  return mode === 'web-pro' 
    ? 'google/gemini-3-flash-preview'
    : 'kwaipilot/kat-coder-pro:free';
}

function getPhase1Model(mode: WebMode): string | undefined {
  return mode === 'web-pro'
    ? 'google/gemini-3-flash-preview'
    : undefined; // undefined = use BULK pool
}
```

### 4. Export runSitePipeline()

```typescript
export async function runSitePipeline(opts: {
  mode: WebMode;
  prompt: string;
  theme: string;
  outputDir?: string;
  onProgress?: (p: { 
    step: string; 
    status: 'start'|'progress'|'done'; 
    message?: string; 
    batch?: {current:number; total:number} 
  }) => void;
}): Promise<{ outputDir: string; zipPath: string; pageCount: number }> {
  
  const progress = opts.onProgress || (() => {});
  const intent = detectPageIntent(opts.prompt);
  const DIST_DIR = opts.outputDir || getTestDir();
  const commonRules = getCommonRules(opts.theme);
  
  // Call all phases with updated signatures
  // ...
  
  return { outputDir: DIST_DIR, zipPath, pageCount: siteSpec.pages.length };
}
```

### 5. Update main() for CLI

```typescript
async function main() {
  const result = await runSitePipeline({
    mode: 'web', // default to free mode
    prompt: 'a minecraft hosting website...',
    theme: 'dark purple gaming theme',
    onProgress: (p) => {
      if (p.status === 'start') console.log(`\n=== ${p.step.toUpperCase()} ===`);
      if (p.message) console.log(p.message);
    }
  });
  
  console.log(`✅ Complete! ${result.pageCount} pages generated`);
  console.log(`📂 ${result.outputDir}`);
}
```

## Implementation Order

1. ✅ Add exports and helper functions
2. Update function signatures (bottom-up)
3. Update phase0GenerateContract() model selection
4. Update phase1GeneratePages() model selection
5. Implement runSitePipeline()
6. Update main() to use runSitePipeline()
7. Test with both modes

## Testing

```bash
# Test web mode (free)
npm run site:gen

# Test web-pro mode (requires changes in main())
# Change main() temporarily to mode: 'web-pro'
npm run site:gen
```
