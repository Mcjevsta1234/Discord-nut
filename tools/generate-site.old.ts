import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { createClient } from './openrouterClient';
import { createModelPoolsLoader } from './modelPoolsLoader';
import { createScheduler } from './modelScheduler';

dotenv.config();

const DIST_DIR = path.join(__dirname, '../dist');
const PARTIALS_DIR = path.join(DIST_DIR, 'partials');
const STAGGER_MS = 3000;
const MAX_CONCURRENCY = 4;
const MIN_PAGES = 12;

const STRICT_JSON = `⚠️ CRITICAL: Return ONLY valid JSON. NO markdown blocks, NO explanations, NO trailing commas.`;

interface PageSpec {
  id: string;
  title: string;
  filename: string;
  purpose: string;
  category: 'main' | 'feature' | 'kb';
}

interface SiteSpec {
  pages: PageSpec[];
  navOrder: string[];
  footerLinks: Array<{ text: string; pageId: string }>;
  designTokens: {
    primaryColor: string;
    fontFamily: string;
    theme: string;
  };
}

interface Templates {
  headerTemplate: string;  // HTML with {{NAV_ITEMS}} placeholder
  footerTemplate: string;  // HTML with {{FOOTER_LINKS}} placeholder
  layoutTemplate: string;  // HTML with {{HEADER}}, {{MAIN}}, {{FOOTER}}, {{TITLE}}
}

interface Templates {
  headerTemplate: string;  // HTML with {{NAV_ITEMS}} placeholder
  footerTemplate: string;  // HTML with {{FOOTER_LINKS}} placeholder
  layoutTemplate: string;  // HTML with {{HEADER}}, {{MAIN}}, {{FOOTER}}, {{TITLE}}
}

interface PageGeneration {
  filename: string;
  title: string;
  mainHtml: string;
}

// ============================================================================
// PHASE 0: Site Contract (Single Call, Base Model Only)
// ============================================================================

async function phase0GenerateContract(client: ReturnType<typeof createClient>): Promise<{ siteSpec: SiteSpec; templates: Templates }> {
  console.log('=== PHASE 0: Generate Site Contract (Base Model) ===\n');
  console.log(`Using: ${client.getModelForRole('base')}\n`);

  const prompt = `Generate Minecraft Performance Optimization Knowledge Base contract.
${STRICT_JSON}

Return EXACTLY this JSON:
{
  "siteSpec": {
    "pages": [
      {"id": "home", "title": "Home", "filename": "index.html", "purpose": "Landing page", "category": "main"},
      ...11+ more pages across kb/feature/main categories
    ],
    "navOrder": ["home", "getting-started", "guides", ...],
    "footerLinks": [
      {"text": "Getting Started", "pageId": "getting-started"},
      {"text": "Guides", "pageId": "guides"}
    ],
    "designTokens": {
      "primaryColor": "#00ff00",
      "fontFamily": "Minecraft, monospace",
      "theme": "dark-minecraft"
    }
  },
  "templates": {
    "headerTemplate": "<header class='site-header'>...{{NAV_ITEMS}}...</header>",
    "footerTemplate": "<footer class='site-footer'>...{{FOOTER_LINKS}}...</footer>",
    "layoutTemplate": "<!DOCTYPE html><html>...<body>{{HEADER}}{{MAIN}}{{FOOTER}}</body></html>"
  }
}

REQUIREMENTS:
- headerTemplate: Dark Minecraft theme, logo, nav placeholder {{NAV_ITEMS}}
- footerTemplate: Multi-column, social links, placeholder {{FOOTER_LINKS}}
- layoutTemplate: Full HTML structure with {{HEADER}}, {{MAIN}}, {{FOOTER}}, {{TITLE}}, {{CSS}}
- NO hardcoded hrefs in templates (use placeholders only)
- Include 12+ pages: home, getting-started, optifine, sodium, fps-boost, render-settings, shaders, mods-list, jvm-args, troubleshooting, hardware, advanced

Return ONLY JSON, no markdown.`;

  const { content } = await client.callLLM(prompt, { 
    role: 'base',
    temperature: 0.2,
    maxTokens: 16000
  });

  const parsed = parseJSON(content);
  if (!parsed.siteSpec || !parsed.templates) {
    throw new Error('Invalid contract structure');
  }

  const siteSpec: SiteSpec = parsed.siteSpec;
  const templates: Templates = parsed.templates;

  if (siteSpec.pages.length < MIN_PAGES) {
    throw new Error(`Need ${MIN_PAGES} pages, got ${siteSpec.pages.length}`);
  }

  // Write contract files
  fs.writeFileSync(path.join(DIST_DIR, 'site-spec.json'), JSON.stringify(siteSpec, null, 2));
  fs.writeFileSync(path.join(DIST_DIR, '_templates.json'), JSON.stringify(templates, null, 2));
  
  console.log(`✓ Site spec: ${siteSpec.pages.length} pages`);
  console.log(`✓ Templates: header, footer, layout\n`);

  return { siteSpec, templates };
}

  return { siteSpec, templates };
}

// ============================================================================
// FREEZE CONTRACT: Build Canonical Header/Footer in CODE
// ============================================================================

function freezeCanonicalPartials(siteSpec: SiteSpec, templates: Templates): void {
  console.log('=== FREEZE CONTRACT: Build Canonical Partials ===\n');

  // Build nav items from site-spec
  const navItems = siteSpec.navOrder
    .map(pageId => {
      const page = siteSpec.pages.find(p => p.id === pageId);
      if (!page) return '';
      return `<a href="./${page.filename}" class="nav-link">${page.title}</a>`;
    })
    .filter(Boolean)
    .join('\\n      ');

  // Build footer links from site-spec
  const footerLinks = siteSpec.footerLinks
    .map(link => {
      const page = siteSpec.pages.find(p => p.id === link.pageId);
      if (!page) return '';
      return `<a href="./${page.filename}" class="footer-link">${link.text}</a>`;
    })
    .filter(Boolean)
    .join('\\n        ');

  // Inject into templates
  const canonicalHeader = templates.headerTemplate.replace('{{NAV_ITEMS}}', navItems);
  const canonicalFooter = templates.footerTemplate.replace('{{FOOTER_LINKS}}', footerLinks);

  // Write IMMUTABLE partials
  if (!fs.existsSync(PARTIALS_DIR)) {
    fs.mkdirSync(PARTIALS_DIR, { recursive: true });
  }

  fs.writeFileSync(path.join(PARTIALS_DIR, 'header.html'), canonicalHeader);
  fs.writeFileSync(path.join(PARTIALS_DIR, 'footer.html'), canonicalFooter);

  console.log(`✓ Canonical header: ${canonicalHeader.length} chars`);
  console.log(`✓ Canonical footer: ${canonicalFooter.length} chars`);
  console.log(`✓ Written to: ${PARTIALS_DIR}/\\n`);
}

// ============================================================================
// PHASE 1: Parallel Page Generation (BULK Models Only)
// ============================================================================

async function phase1GeneratePages(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec
): Promise<Map<string, PageGeneration>> {
  console.log('=== PHASE 1: Parallel Page Generation (BULK Models) ===\n');

  const poolsLoader = client.getPoolsLoader();
  if (!poolsLoader) {
    return phase1LegacyGeneration(client, siteSpec);
  }

  const scheduler = createScheduler(poolsLoader, {
    maxConcurrency: MAX_CONCURRENCY,
    staggerDelayMs: STAGGER_MS,
  });

  const roles = poolsLoader.getRoles();
  console.log(`Scheduler: ${MAX_CONCURRENCY} concurrent, ${STAGGER_MS}ms stagger`);
  console.log(`BULK models: ${roles.BULK_MODELS.length}\\n`);

  const results = new Map<string, PageGeneration>();
  const remainingPages = siteSpec.pages.filter(p => p.filename !== 'index.html');

  // Group into pairs (2 pages per call)
  const pagePairs: PageSpec[][] = [];
  for (let i = 0; i < remainingPages.length; i += 2) {
    pagePairs.push(remainingPages.slice(i, i + 2));
  }

  // Schedule all pairs
  const promises = pagePairs.map((pair, idx) => {
    return scheduler.schedule(async () => {
      const modelId = roles.BULK_MODELS[idx % roles.BULK_MODELS.length];
      console.log(`[${idx + 1}/${pagePairs.length}] ${pair.map(p => p.filename).join(', ')} -> ${modelId.split('/')[1]}`);

      const prompt = `Generate MAIN content ONLY. NO header/footer/nav.
${STRICT_JSON}

Return:
{
  "pages": [
${pair.map(p => `    {"filename": "${p.filename}", "title": "${p.title}", "mainHtml": "<main>...</main>"}`).join(',\\n')}
  ]
}

Pages:
${pair.map((p, i) => `${i + 1}. ${p.filename}: ${p.purpose} (${p.category})`).join('\\n')}

STRICT RULES:
- Return ONLY <main>...</main>
- NO <header>, <footer>, <head>, <html>, <body>
- NO nav links outside <main>
- Use Minecraft theme classes
- Rich content: hero, cards, code examples
- Properly escape quotes in JSON

Example: {"pages":[{"filename":"about.html","title":"About","mainHtml":"<main><h1>About</h1></main>"}]}`;

      try {
        const { content } = await client.callLLM(prompt, {
          temperature: 0.2,
          maxTokens: 12000,
          preferredModel: modelId
        });

        const parsed = parseJSON(content);
        if (parsed.pages && Array.isArray(parsed.pages)) {
          for (const pg of parsed.pages) {
            if (pg.filename && pg.mainHtml && pg.title) {
              // Validate NO forbidden elements
              if (/<header|<footer|<head|<!DOCTYPE|<html|<body/i.test(pg.mainHtml)) {
                console.warn(`  ⚠️ ${pg.filename}: Contains forbidden elements, skipping`);
                continue;
              }
              results.set(pg.filename, pg);
              console.log(`  ✓ ${pg.filename}`);
            }
          }
        }
      } catch (error: any) {
        console.error(`  ✗ Failed: ${error.message}`);
        // Fallback minimal content
        for (const page of pair) {
          results.set(page.filename, {
            filename: page.filename,
            title: page.title,
            mainHtml: `<main class="content"><h1>${page.title}</h1><p>${page.purpose}</p></main>`
          });
        }
      }
    });
  });

  await Promise.allSettled(promises);
  await scheduler.waitForCompletion();

  console.log(`\\n✓ Generated ${results.size} pages\\n`);
  return results;
}
  console.log('=== PHASE 0: Bulk Generation + Freeze Canonical Layout ===');
  console.log(`Using BASE MODEL: ${client.getModelForRole('base')}\n`);
  
  const prompt = `Generate foundation for Minecraft Performance Optimization Knowledge Base.
${STRICT_JSON_INSTRUCTIONS}

Return EXACTLY one JSON array:
[
  {"path": "index.html", "content": "<!DOCTYPE html><html>...full index page...</html>"},
  {"path": "styles.css", "content": "/* complete global styles */"},
  {"path": "components.css", "content": "/* component styles */"},
  {"path": "app.js", "content": "// interactions"}
]

REQUIREMENTS:
- index.html: Complete page with <head>, <header>, <main>, <footer>
- Dark theme, Minecraft aesthetic, glassmorphism
- Header: Logo ⛏️ Minecraft Performance Hub, nav with placeholder links
- Footer: Multi-column, social links, newsletter form
- styles.css: Reset, typography, CSS variables, responsive
- components.css: .card, .btn-primary, .hero, .stat-card, etc
- app.js: Smooth scroll, mobile menu, intersection observer

EXAMPLE FORMAT:
[{"path":"index.html","content":"<!DOCTYPE html>..."},{"path":"styles.css","content":"body{}"}]

Return ONLY the JSON array - no markdown blocks, no explanations.`;

  console.log('Calling BASE model for foundation generation...');
  const { content, metrics } = await client.callLLM(prompt, { 
    temperature: 0.2, 
    maxTokens: 16000,
    role: 'base'
  });
  
  console.log(`✓ Response: ${metrics.totalTokens} tokens in ${((metrics.endTime - metrics.startTime) / 1000).toFixed(1)}s (${metrics.tokensPerSecond?.toFixed(1)} tok/s)\n`);
  
  let parsedArray: any[] = [];
  try {
    parsedArray = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```json?\n?([\s\S]*?)```/);
    if (jsonMatch) {
      parsedArray = JSON.parse(jsonMatch[1]);
    } else {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        parsedArray = JSON.parse(arrayMatch[0]);
      }
    }
  }
  
  if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
    throw new Error('Failed to parse foundation files');
  }
  
  // Write files
  for (const fileObj of parsedArray) {
    if (fileObj.path && fileObj.content) {
      fs.writeFileSync(path.join(DIST_DIR, fileObj.path), fileObj.content);
      console.log(`✓ ${fileObj.path} (${fileObj.content.length} chars)`);
    }
  }
  
  // Extract and FREEZE canonical layout from index.html
  const indexPath = path.join(DIST_DIR, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');
  const $ = cheerio.load(indexHtml);
  
  const canonicalHeader = $('header').first().toString();
  const canonicalFooter = $('footer').first().toString();
  
  // Extract head includes (link/script tags)
  const headIncludes: string[] = [];
  $('head link[rel="stylesheet"]').each((_, el) => {
    headIncludes.push($.html(el));
  });
  $('head script[src]').each((_, el) => {
    headIncludes.push($.html(el));
  });
  const canonicalHeadIncludes = headIncludes.join('\n  ');
  
  const frozenPartials: FrozenPartials = {
    canonicalHeader,
    canonicalFooter,
    canonicalHeadIncludes
  };
  
  fs.writeFileSync(
    path.join(DIST_DIR, '_partials.json'),
    JSON.stringify(frozenPartials, null, 2)
  );
  
  console.log('\n✓ FROZEN canonical layout:');
  console.log(`  - Header: ${canonicalHeader.length} chars`);
  console.log(`  - Footer: ${canonicalFooter.length} chars`);
  console.log(`  - Head includes: ${headIncludes.length} tags\n`);
  
  return frozenPartials;
}

// Generate sitemap
async function generateSiteMap(client: ReturnType<typeof createClient>): Promise<SiteMap> {
  console.log('=== Generating Site Map (30 pages) ===');
  console.log(`Using BASE MODEL: ${client.getModelForRole('base')}\n`);
  
  const prompt = `Generate sitemap for Minecraft Performance Optimization Knowledge Base with 30 pages.
${STRICT_JSON_INSTRUCTIONS}

Return ONLY JSON:
{
  "pages": [
    {"id": "home", "title": "Home", "filename": "index.html", "purpose": "Landing"},
    {"id": "getting-started", "title": "Getting Started", "filename": "getting-started.html", "purpose": "Beginner guide"},
    ...28 more pages
  ],
  "navOrder": ["home", "getting-started", ...]
}

Include 30 pages covering: home, getting-started, optifine-guide, sodium-guide, iris-shaders, fps-optimization, render-settings, video-settings, shaders-guide, mods-list, performance-mods, jvm-arguments, java-optimization, troubleshooting, crash-fixes, lag-solutions, benchmarking, fps-monitoring, advanced-tweaks, world-optimization, server-optimization, server-performance, modpack-optimization, modpack-creation, hardware-guide, gpu-settings, cpu-optimization, memory-allocation, resource-packs, texture-optimization.

EXAMPLE FORMAT:
{"pages":[{"id":"home","title":"Home","filename":"index.html","purpose":"Landing page"}],"navOrder":["home"]}

Return ONLY valid JSON object - no markdown, no explanations.`;

  const { content } = await client.callLLM(prompt, { role: 'base' });
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No sitemap JSON found');
  
  const siteMap: SiteMap = JSON.parse(jsonMatch[0]);
  
  if (siteMap.pages.length < MIN_PAGES) {
    throw new Error(`Need ${MIN_PAGES} pages, got ${siteMap.pages.length}`);
  }
  
  fs.writeFileSync(path.join(DIST_DIR, 'site-map.json'), JSON.stringify(siteMap, null, 2));
  console.log(`✓ Sitemap: ${siteMap.pages.length} pages\n`);
  
  return siteMap;
}

// Update frozen header with real nav links
function updateFrozenNav(siteMap: SiteMap, frozenPartials: FrozenPartials): FrozenPartials {
  console.log('=== Updating Frozen Header with Nav Links ===\n');
  
  const $ = cheerio.load(frozenPartials.canonicalHeader);
  const nav = $('nav').first();
  
  if (nav.length > 0) {
    const navHtml = siteMap.navOrder.map(id => {
      const page = siteMap.pages.find(p => p.id === id);
      return `<a href="./${page?.filename}" class="nav-link">${page?.title}</a>`;
    }).join('\n        ');
    
    nav.html(navHtml);
    
    // CRITICAL: Extract ONLY the header element, not full HTML wrapper
    frozenPartials.canonicalHeader = $('header').first().toString();
    
    fs.writeFileSync(
      path.join(DIST_DIR, '_partials.json'),
      JSON.stringify(frozenPartials, null, 2)
    );
    
    console.log(`✓ Updated nav with ${siteMap.navOrder.length} links\n`);
    
    // CRITICAL: Re-enforce index.html with updated frozen header
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      const indexHtml = fs.readFileSync(indexPath, 'utf-8');
      const $index = cheerio.load(indexHtml);
      $index('header').replaceWith(frozenPartials.canonicalHeader);
      $index('footer').replaceWith(frozenPartials.canonicalFooter);
      fs.writeFileSync(indexPath, $index.html());
      console.log(`✓ Re-enforced index.html with frozen layout\n`);
    }
  }
  
  return frozenPartials;
}

// Escalation: Retry with BASE model when validation fails
async function escalateGeneration(
  client: ReturnType<typeof createClient>,
  pages: PageInfo[]
): Promise<PageGeneration[]> {
  console.log(`  ⚠️  ESCALATING to BASE model: ${pages.map(p => p.filename).join(', ')}`);
  
  const prompt = `Generate MAIN CONTENT ONLY for ${pages.length} page(s). NO header/footer/head.
${STRICT_JSON_INSTRUCTIONS}

Return EXACTLY:
{
  "pages": [
${pages.map((p) => `    {"filename": "${p.filename}", "title": "${p.title}", "mainHtml": "<main>...</main>"}`).join(',\n')}
  ]
}

Pages:
${pages.map((p, i) => `${i + 1}. ${p.filename} - ${p.title}: ${p.purpose}`).join('\n')}

CRITICAL:
- Return ONLY <main>...</main> content
- NO <header>, NO <footer>, NO <head>
- Use classes: .card, .btn-primary, .hero, .stat-card
- Rich content with hero, features, code examples, interactive elements
- Minimum 500 chars of meaningful content per page
- Properly escape all quotes and special characters in HTML

EXAMPLE FORMAT:
{"pages":[{"filename":"page1.html","title":"Title","mainHtml":"<main><h1>Title</h1><p>Content</p></main>"}]}

Return ONLY valid JSON object - no markdown blocks, no explanations, no extra text.`;

  const { content } = await client.callLLM(prompt, { 
    temperature: 0.3,
    maxTokens: 16000,
    role: 'escalation'
  });
  
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  }
  
  if (!parsed.pages || !Array.isArray(parsed.pages)) {
    throw new Error('Escalation failed: Invalid response schema');
  }
  
  return parsed.pages;
}

// Phase 1: Parallel generation with scheduler
async function phase1ParallelGeneration(
  client: ReturnType<typeof createClient>,
  siteMap: SiteMap,
  frozenPartials: FrozenPartials
): Promise<Map<string, PageGeneration>> {
  console.log('=== PHASE 1: Parallel Generation (Main-Only) ===');
  
  const poolsLoader = client.getPoolsLoader();
  if (!poolsLoader) {
    console.log('⚠️  Model pools not available, using legacy round-robin\n');
    return phase1LegacyGeneration(client, siteMap, frozenPartials);
  }

  const scheduler = createScheduler(poolsLoader, {
    maxConcurrency: MAX_CONCURRENCY,
    staggerDelayMs: STAGGER_MS,
    cooldownMs: 15000
  });

  const roles = poolsLoader.getRoles();
  console.log(`Scheduler: ${MAX_CONCURRENCY} concurrent, ${STAGGER_MS}ms stagger`);
  console.log(`BULK MODELS (${roles.BULK_MODELS.length}): ${roles.BULK_MODELS.join(', ')}\n`);
  
  const results = new Map<string, PageGeneration>();
  const remainingPages = siteMap.pages.filter(p => p.filename !== 'index.html');
  
  // Group into pairs
  const pagePairs: PageInfo[][] = [];
  for (let i = 0; i < remainingPages.length; i += 2) {
    pagePairs.push(remainingPages.slice(i, i + 2));
  }
  
  // Schedule all pairs
  const promises = pagePairs.map((pair, pairIndex) => {
    return scheduler.schedule(async () => {
      const modelId = roles.BULK_MODELS[pairIndex % roles.BULK_MODELS.length];
      console.log(`[${pairIndex + 1}/${pagePairs.length}] Starting ${pair.map(p => p.filename).join(', ')} -> ${modelId.split('/')[1]}`);
      
      const prompt = `Generate MAIN CONTENT ONLY for ${pair.length} page(s). NO header/footer/head.
${STRICT_JSON_INSTRUCTIONS}

Return EXACTLY:
{
  "pages": [
    {"filename": "page1.html", "title": "Title", "mainHtml": "<main>...</main>"}${pair.length > 1 ? `,
    {"filename": "page2.html", "title": "Title", "mainHtml": "<main>...</main>"}` : ''}
  ]
}

Pages:
${pair.map((p, i) => `${i + 1}. ${p.filename} - ${p.title}: ${p.purpose}`).join('\n')}

CRITICAL:
- Return ONLY <main>...</main> content
- NO <header>, NO <footer>, NO <head>
- Use classes: .card, .btn-primary, .hero, .stat-card
- Include hero, features, code examples, interactive elements
- Properly escape quotes in HTML attributes: use \\" inside JSON strings

EXAMPLE FORMAT:
{"pages":[{"filename":"page1.html","title":"Title","mainHtml":"<main><h1>Title</h1></main>"}]}

Return ONLY valid JSON - no markdown code blocks (no \`\`\`), no explanations.`;

      let attemptCount = 0;
      let lastError: any = null;

      while (attemptCount < MAX_ESCALATION_RETRIES) {
        try {
          const { content } = await client.callLLM(prompt, { 
            temperature: 0.2,
            maxTokens: 16000,
            preferredModel: modelId
          });
          
          // Validate output schema
          const expectedFilenames = pair.map(p => p.filename);
          const schemaValidation = validateOutputSchema(content, expectedFilenames);
          
          if (!schemaValidation.valid) {
            console.warn(`  ⚠️  Schema validation failed: ${schemaValidation.errors.join(', ')}`);
            throw new Error(`Schema validation failed: ${schemaValidation.errors[0]}`);
          }
          
          let parsed: any = {};
          try {
            parsed = JSON.parse(content);
          } catch {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          }
          
          if (parsed.pages && Array.isArray(parsed.pages)) {
            let allValid = true;
            
            // Validate each page's content
            for (const pg of parsed.pages) {
              if (pg.filename && pg.mainHtml) {
                const contentValidation = validateMainContent(pg.mainHtml, pg.filename);
                
                if (!contentValidation.valid) {
                  console.warn(`  ⚠️  Content validation failed for ${pg.filename}: ${contentValidation.errors.join(', ')}`);
                  allValid = false;
                  break;
                }
                
                if (contentValidation.warnings.length > 0) {
                  console.warn(`  ⚠️  ${contentValidation.warnings.join(', ')}`);
                }
              }
            }
            
            if (allValid) {
              // Success! Store results
              for (const pg of parsed.pages) {
                if (pg.filename && pg.mainHtml) {
                  results.set(pg.filename, pg);
                  console.log(`  ✓ ${pg.filename}`);
                }
              }
              return { success: true, pair };
            } else {
              throw new Error('Content validation failed');
            }
          }
        } catch (error: any) {
          lastError = error;
          attemptCount++;
          
          if (attemptCount >= MAX_ESCALATION_RETRIES) {
            console.error(`  ✗ Max retries reached, escalating to BASE model...`);
            break;
          }
          
          console.warn(`  ⚠️  Attempt ${attemptCount} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Escalation: Use BASE model
      try {
        const escalatedPages = await escalateGeneration(client, pair);
        
        for (const pg of escalatedPages) {
          if (pg.filename && pg.mainHtml) {
            results.set(pg.filename, pg);
            console.log(`  ✓ ${pg.filename} (escalated)`);
          }
        }
        
        return { success: true, pair, escalated: true };
      } catch (escalationError: any) {
        console.error(`  ✗ Escalation failed: ${escalationError.message}`);
        
        // Final fallback
        for (const page of pair) {
          results.set(page.filename, {
            filename: page.filename,
            title: page.title,
            mainHtml: `<main><h1>${page.title}</h1><p>${page.purpose}</p></main>`
          });
          console.log(`  ⚠️  ${page.filename} (fallback)`);
        }
        
        return { success: false, pair, error: lastError };
      }
    });
  });
  
  // Wait for all to complete
  console.log('\nWaiting for all generations to complete...\n');
  await Promise.allSettled(promises);
  await scheduler.waitForCompletion();
  
  const stats = scheduler.getStats();
  console.log(`\n✓ Phase 1 complete: ${results.size} pages generated`);
  console.log(`  Scheduler stats: ${stats.inflight} inflight, ${stats.queued} queued, ${stats.cooldowns} cooldowns\n`);
  
  return results;
}

// Legacy fallback without model pools
async function phase1LegacyGeneration(
  client: ReturnType<typeof createClient>,
  siteMap: SiteMap,
  frozenPartials: FrozenPartials
): Promise<Map<string, PageGeneration>> {
  console.log(`Recursive stagger: ${STAGGER_MS}ms delay, max ${MAX_CONCURRENCY} concurrent\n`);
  
  const results = new Map<string, PageGeneration>();
  const remainingPages = siteMap.pages.filter(p => p.filename !== 'index.html');
  
  // Group into pairs
  const pagePairs: PageInfo[][] = [];
  for (let i = 0; i < remainingPages.length; i += 2) {
    pagePairs.push(remainingPages.slice(i, i + 2));
  }
  
  let inflightCount = 0;
  let completedCount = 0;
  const queue = [...pagePairs];
  
  async function processPair(pair: PageInfo[], pairIndex: number): Promise<void> {
    inflightCount++;
    const legacyModels = ['kwaipilot/kat-coder-pro:free', 'mistralai/devstral-2512:free', 'qwen/qwen3-coder:free'];
    const model = legacyModels[pairIndex % legacyModels.length];
    
    console.log(`[${pairIndex + 1}/${pagePairs.length}] Starting ${pair.map(p => p.filename).join(', ')} -> ${model.split('/')[1]}`);
    
    const prompt = `Generate MAIN CONTENT ONLY for ${pair.length} page(s). NO header/footer/head.
${STRICT_JSON_INSTRUCTIONS}

Return EXACTLY:
{
  "pages": [
    {"filename": "page1.html", "title": "Title", "mainHtml": "<main>...</main>"}${pair.length > 1 ? `,
    {"filename": "page2.html", "title": "Title", "mainHtml": "<main>...</main>"}` : ''}
  ]
}

Pages:
${pair.map((p, i) => `${i + 1}. ${p.filename} - ${p.title}: ${p.purpose}`).join('\n')}

CRITICAL:
- Return ONLY <main>...</main> content
- NO <header>, NO <footer>, NO <head>
- Use classes: .card, .btn-primary, .hero, .stat-card
- Include hero, features, code examples, interactive elements
- Properly escape quotes in HTML attributes

EXAMPLE FORMAT:
{"pages":[{"filename":"page1.html","title":"Title","mainHtml":"<main><h1>Title</h1></main>"}]}

Return ONLY valid JSON - no markdown blocks, no explanations.`;

    try {
      const { content } = await client.callLLM(prompt, { 
        temperature: 0.2,
        maxTokens: 16000,
        preferredModel: model
      });
      
      let parsed: any = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }
      
      if (parsed.pages && Array.isArray(parsed.pages)) {
        for (const pg of parsed.pages) {
          if (pg.filename && pg.mainHtml) {
            results.set(pg.filename, pg);
            console.log(`  ✓ ${pg.filename}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`  ✗ Failed: ${error.message}`);
      // Add fallback
      for (const page of pair) {
        results.set(page.filename, {
          filename: page.filename,
          title: page.title,
          mainHtml: `<main><h1>${page.title}</h1><p>${page.purpose}</p></main>`
        });
      }
    }
    
    inflightCount--;
    completedCount++;
    console.log(`  [${completedCount}/${pagePairs.length} complete, ${inflightCount} inflight]\n`);
  }
  
  // Recursive scheduler
  async function startNext(): Promise<void> {
    if (queue.length === 0) return;
    
    const pair = queue.shift()!;
    const pairIndex = pagePairs.indexOf(pair);
    
    // Start this job
    processPair(pair, pairIndex);
    
    // Wait stagger time before starting next
    if (queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, STAGGER_MS));
      
      // Only start next if under concurrency limit
      if (inflightCount < MAX_CONCURRENCY) {
        await startNext();
      }
    }
  }
  
  // Start initial batch
  const initialBatch = Math.min(MAX_CONCURRENCY, queue.length);
  for (let i = 0; i < initialBatch; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, STAGGER_MS));
    }
    await startNext();
  }
  
  // Wait for all to complete
  while (inflightCount > 0 || queue.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Resume if capacity available
    if (inflightCount < MAX_CONCURRENCY && queue.length > 0) {
      await startNext();
    }
  }
  
  console.log(`\n✓ Phase 1 complete: ${results.size} pages generated\n`);
  return results;
}

// Enforcement: Wrap main-only content with frozen layout
function enforceCanonicalLayout(
  pageGen: PageGeneration,
  frozenPartials: FrozenPartials,
  siteMap: SiteMap
): string {
  const page = siteMap.pages.find(p => p.filename === pageGen.filename);
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${page?.purpose || ''}">
  <meta name="theme-color" content="#0a0a0a">
  <title>${pageGen.title} | Minecraft Performance Hub</title>
  ${frozenPartials.canonicalHeadIncludes}
</head>
<body class="dark-theme">
${frozenPartials.canonicalHeader}
${pageGen.mainHtml}
${frozenPartials.canonicalFooter}
<script src="app.js"></script>
</body>
</html>`;
  
  // Parse and enforce with cheerio
  const $ = cheerio.load(html);
  
  // Replace header/footer with frozen versions (defensive)
  $('header').replaceWith(frozenPartials.canonicalHeader);
  $('footer').replaceWith(frozenPartials.canonicalFooter);
  
  return $.html();
}

// Assemble and write final pages
function assemblePages(
  siteMap: SiteMap,
  pageGenerations: Map<string, PageGeneration>,
  frozenPartials: FrozenPartials
): string[] {
  console.log('=== Assembling Final Pages ===\n');
  
  const generatedFiles: string[] = [];
  
  // Index already exists and was enforced in updateFrozenNav
  generatedFiles.push('dist/index.html');
  console.log(`✓ index.html (already enforced)`);
  
  // Other pages
  for (const [filename, pageGen] of pageGenerations) {
    const finalHtml = enforceCanonicalLayout(pageGen, frozenPartials, siteMap);
    fs.writeFileSync(path.join(DIST_DIR, filename), finalHtml);
    generatedFiles.push(`dist/${filename}`);
    console.log(`✓ ${filename}`);
  }
  
  console.log(`\n✓ Assembled ${generatedFiles.length} pages\n`);
  return generatedFiles;
}

async function main() {
  console.log('=== 🎨 Static Site Generator (Model Pools + Frozen Layout) ===\n');
  
  // Ensure clean dist
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  
  const client = createClient(true); // Enable model pools
  
  // Phase 0: Bulk + Freeze (uses BASE model: qwen/qwen3-coder:free)
  const frozenPartials = await phase0BulkGeneration(client);
  
  // Generate sitemap (uses BASE model)
  const siteMap = await generateSiteMap(client);
  
  // Update frozen nav with real links
  updateFrozenNav(siteMap, frozenPartials);
  
  // Phase 1: Parallel generation (uses BULK models with scheduler)
  const pageGenerations = await phase1ParallelGeneration(client, siteMap, frozenPartials);
  
  // Assemble with enforcement
  const generatedFiles = assemblePages(siteMap, pageGenerations, frozenPartials);
  
  // Output footnote
  const allFiles = [
    ...generatedFiles,
    'dist/site-map.json',
    'dist/_partials.json',
    'dist/styles.css',
    'dist/components.css',
    'dist/app.js'
  ];
  
  console.log('✓ Site generation complete!');
  console.log(`† Files: ${allFiles.join(', ')}\n`);
  
  // Display trust cache summary
  const poolsLoader = client.getPoolsLoader();
  if (poolsLoader) {
    const roles = poolsLoader.getRoles();
    console.log('\n📊 Model Trust Cache:');
    for (const modelId of roles.BULK_MODELS) {
      const stats = poolsLoader.getTrustStats(modelId);
      if (stats) {
        const trustIcon = stats.trusted ? '✓' : '✗';
        console.log(`  ${trustIcon} ${modelId}: ${stats.successes} successes, ${stats.failures} failures`);
      }
    }
    console.log('');
  }
}

main().catch(error => {
  console.error('Generation failed:', error);
  process.exit(1);
});
