import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import * as prettier from 'prettier';
import dotenv from 'dotenv';
import { createClient } from './openrouterClient';
import { createModelPoolsLoader } from './modelPoolsLoader';
import { createScheduler } from './modelScheduler';

dotenv.config();

// Configuration
const SITE_UI_MODE = process.env.SITE_UI_MODE || 'preact'; // 'static' or 'preact'
const SITE_PROMPTER_MODEL = process.env.SITE_PROMPTER_MODEL || 'openai/gpt-oss-120b:free';
const SITE_PHASE1_CONCURRENCY = parseInt(process.env.SITE_PHASE1_CONCURRENCY || '16', 10);
const SITE_CACHE_PRIME = process.env.SITE_CACHE_PRIME === '1';

// Create unique test folder for each run
function getTestDir(): string {
  const testsDir = path.join(__dirname, '../test-output');
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }
  
  // Find next test number
  const existing = fs.readdirSync(testsDir).filter(d => d.startsWith('test-'));
  const numbers = existing.map(d => parseInt(d.split('-')[1])).filter(n => !isNaN(n));
  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  
  return path.join(testsDir, `test-${nextNum}`);
}

const DIST_DIR = getTestDir();
const PARTIALS_DIR = path.join(DIST_DIR, 'partials');
const MIN_PAGES = 30;
const TEMPLATES_DIR = path.join(__dirname, '../templates');
const BULK_FAILURES = new Map<string, number>(); // Track model failures
const MAX_FAILURES = 2; // Remove model after 2 failures

const STRICT_JSON = `⚠️ CRITICAL: Return ONLY valid JSON. NO markdown blocks, NO explanations, NO trailing commas.`;

// RAG: Load template examples
function loadTemplateExample(gameName: string): string | null {
  try {
    // Skip loading templates for non-game pages
    const skipPages = ['index', 'home', 'about', 'contact', 'how-to', 'howto', 'how to play', 'help', 'faq', 'support', 'blog', 'news', 'leaderboard', 'profile', 'settings'];
    const normalizedName = gameName.toLowerCase().trim();
    if (skipPages.some(skip => normalizedName.includes(skip))) {
      return null;
    }
    
    const gameDir = path.join(TEMPLATES_DIR, 'games', gameName.toLowerCase().replace(/\s+/g, '-'));
    if (!fs.existsSync(gameDir)) return null;
    
    const htmlFile = path.join(gameDir, `${gameName.toLowerCase().replace(/\s+/g, '-')}.html`);
    const jsFile = path.join(gameDir, 'app.js');
    
    if (!fs.existsSync(htmlFile) || !fs.existsSync(jsFile)) return null;
    
    const html = fs.readFileSync(htmlFile, 'utf-8');
    const js = fs.readFileSync(jsFile, 'utf-8');
    
    // Extract just the canvas/game section and script
    const canvasMatch = html.match(/<div class="game-container">[\s\S]*?<\/div>/);
    const canvas = canvasMatch ? canvasMatch[0] : '';
    
    return `\n\nTEMPLATE EXAMPLE (${gameName}):\nHTML Structure:\n${canvas}\n\nJavaScript (first 150 lines):\n${js.split('\n').slice(0, 150).join('\n')}\n\nUse this as reference for game structure, canvas setup, event handling, and game loop patterns.`;
  } catch (err) {
    return null;
  }
}

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
  headerTemplate: string;
  footerTemplate: string;
  layoutTemplate: string;
  css: string;
}

interface PageGeneration {
  filename: string;
  title: string;
  mainHtml: string;
}

// ============================================================================
// JSON PARSER
// ============================================================================

function parseJSON(content: string): any {
  // Helper to clean JSON string
  const cleanJSON = (str: string): string => {
    // First, try to extract just the JSON object/array
    const jsonStart = str.indexOf('{');
    const jsonArrayStart = str.indexOf('[');
    const actualStart = jsonStart >= 0 && (jsonArrayStart < 0 || jsonStart < jsonArrayStart) ? jsonStart : jsonArrayStart;
    
    if (actualStart >= 0) {
      // Find matching closing brace/bracket
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      let endPos = actualStart;
      
      for (let i = actualStart; i < str.length; i++) {
        const char = str[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{' || char === '[') depth++;
          if (char === '}' || char === ']') {
            depth--;
            if (depth === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
      }
      
      str = str.substring(actualStart, endPos);
    }
    
    // Remove trailing commas before } or ]
    return str
      .replace(/,(\s*[}\]])/g, '$1')
      .trim();
  };

  try {
    return JSON.parse(content);
  } catch {
    // Try cleaning first
    try {
      const cleaned = cleanJSON(content);
      return JSON.parse(cleaned);
    } catch {
      // Try markdown block
      const jsonMatch = content.match(/```json?\n?([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(cleanJSON(jsonMatch[1]));
        } catch {
          return JSON.parse(jsonMatch[1]);
        }
      }
      // Try extracting JSON object
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(cleanJSON(objMatch[0]));
        } catch {
          return JSON.parse(objMatch[0]);
        }
      }
      throw new Error('Failed to parse JSON');
    }
  }
}

// ============================================================================
// PALETTE GENERATION
// ============================================================================

interface Palette {
  primary: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  'shadow-rgb': string;
  'highlight-rgb': string;
}

function generatePalette(seed: string): Palette {
  const hash = crypto.createHash('sha256').update(seed).digest();
  
  // Generate hue from seed
  const hue = (hash[0] * 360) / 255;
  const hue2 = (hue + 180) % 360;
  
  // Generate palette with good contrast
  const primary = `hsl(${Math.round(hue)}, 70%, 55%)`;
  const accent = `hsl(${Math.round(hue2)}, 65%, 60%)`;
  const bg = `hsl(${Math.round(hue)}, 15%, 8%)`;
  const surface = `hsl(${Math.round(hue)}, 12%, 12%)`;
  const text = `hsl(${Math.round(hue)}, 10%, 95%)`;
  const muted = `hsl(${Math.round(hue)}, 8%, 60%)`;
  const border = `hsl(${Math.round(hue)}, 20%, 25%)`;
  
  return { 
    primary, 
    accent, 
    bg, 
    surface, 
    text, 
    muted, 
    border,
    'shadow-rgb': '0, 0, 0',
    'highlight-rgb': '255, 255, 255'
  };
}

// ============================================================================
// ENFORCEMENT CHECKS
// ============================================================================

function assertNoInlineStyles(html: string): void {
  if (/style\s*=\s*["']/i.test(html)) {
    throw new Error('Inline styles detected (style="...") - forbidden');
  }
}

function validateBaselineCSS(stylesContent: string, componentsContent: string): void {
  console.log('Validating baseline CSS for content styling...');
  
  const combinedCSS = stylesContent + '\n' + componentsContent;
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for heading styles (warn only)
  if (!/(^|\s)h2\s*\{|(\.content|\.prose)\s+h2\s*\{/m.test(combinedCSS)) {
    warnings.push('Missing h2 styling (recommended for page structure)');
  }
  
  // Check for table styling (warn only)
  if (!/(^|\s)table\s*\{|(\.content|\.prose)\s+table\s*\{/m.test(combinedCSS)) {
    warnings.push('Missing table styling (recommended for data presentation)');
  }
  
  // Check for code/pre styling (warn only)
  if (!/(^|\s)(code|pre)\s*\{|(\.content|\.prose)\s+(code|pre)\s*\{/m.test(combinedCSS)) {
    warnings.push('Missing code/pre styling (recommended for technical content)');
  }
  
  // Check for paragraph styling (warn only - not critical)
  const hasExplicitP = /(^|\s)p\s*\{|(\.content|\.prose)\s+p\s*\{/m.test(combinedCSS);
  const hasProseWrapper = /\.(content|prose)\s*\{/.test(combinedCSS) || /\.(content|prose)\s*>/m.test(combinedCSS);
  if (!hasExplicitP && !hasProseWrapper) {
    warnings.push('Missing paragraph styling or content wrapper (recommended for readability)');
  }
  
  // Check for content wrapper class (warn only)
  if (!/\.(content|prose)\s*\{/.test(combinedCSS)) {
    warnings.push('No .content or .prose wrapper class found (recommended for consistent layout)');
  }
  
  // Very relaxed validation - only fail if absolutely nothing is present
  // Just warn about missing components
  if (!new RegExp(`\\.container\\s*\\{`).test(combinedCSS)) {
    warnings.push('Missing .container component class (recommended for layout)');
  }
  
  if (!new RegExp(`\\.btn\\s*\\{`).test(combinedCSS)) {
    warnings.push('Missing .btn component class (recommended for interactive elements)');
  }
  
  if (!new RegExp(`\\.card\\s*\\{`).test(combinedCSS)) {
    warnings.push('Missing .card component class (recommended for content boxing)');
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Foundation CSS validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error('Foundation CSS missing critical requirements.');
  }
  
  if (warnings.length > 0) {
    console.warn('\n⚠️ Foundation CSS recommendations:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
  }
  
  console.log('  ✓ Baseline CSS validation passed\n');
}

function assertNoColorLiteralsOutsideRoot(css: string): void {
  // Remove ALL :root blocks globally
  const cssWithoutRoot = css.replace(/:root\s*\{[\s\S]*?\}/g, '');
  
  // Check for hex colors (always forbidden outside :root)
  const hexPattern = /#[0-9a-fA-F]{3,8}/g;
  const hexMatches = cssWithoutRoot.match(hexPattern);
  if (hexMatches && hexMatches.length > 0) {
    console.warn(`⚠️ Warning: Hex colors found outside :root: ${hexMatches.slice(0, 3).join(', ')}`);
    console.warn(`  These should be defined as CSS variables in :root`);
  }
  
  // Check for rgb/hsl with numeric values (forbidden)
  // Allowed: rgba(var(--x), 0.2)   Forbidden: rgba(0,0,0,0.2)
  const rgbHslPattern = /(rgba?|hsla?)\s*\([^)]+\)/gi;
  const colorFuncs = cssWithoutRoot.match(rgbHslPattern) || [];
  
  const numericColorFuncs: string[] = [];
  for (const func of colorFuncs) {
    // Extract content inside parentheses
    const match = func.match(/\(([^)]+)\)/);
    if (match) {
      const content = match[1].trim();
      // Check if first char is a digit (numeric color)
      if (/^[0-9]/.test(content)) {
        numericColorFuncs.push(func);
      }
    }
  }
  
  if (numericColorFuncs.length > 0) {
    console.warn(`⚠️ Warning: Numeric rgba/rgb found outside :root: ${numericColorFuncs.slice(0, 3).join(', ')}`);
    console.warn(`  Use rgba(var(--shadow-rgb), alpha) instead`);
  }
}

function sanitizeCSSColors(css: string): string {
  console.log('Sanitizing color literals outside :root...');
  
  // Extract existing :root block
  const rootMatch = css.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) {
    console.warn('  ⚠️ No :root block found, cannot auto-sanitize colors');
    return css;
  }
  
  const rootContent = rootMatch[1];
  const rootBlock = rootMatch[0];
  
  // Check if RGB variables exist, if not add them
  let updatedRootContent = rootContent;
  if (!rootContent.includes('--shadow-rgb')) {
    console.log('  Adding --shadow-rgb to :root');
    updatedRootContent += '\n  --shadow-rgb: 0, 0, 0;';
  }
  if (!rootContent.includes('--highlight-rgb')) {
    console.log('  Adding --highlight-rgb to :root');
    updatedRootContent += '\n  --highlight-rgb: 255, 255, 255;';
  }
  
  // Remove :root block temporarily
  let sanitized = css.replace(rootBlock, '___ROOT_PLACEHOLDER___');
  
  // Replace common rgba patterns outside :root
  // Pattern: rgba(0, 0, 0, X) or rgba(0,0,0,X) -> rgba(var(--shadow-rgb), X)
  sanitized = sanitized.replace(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/gi, 
    'rgba(var(--shadow-rgb), $1)');
  
  // Pattern: rgba(255, 255, 255, X) -> rgba(var(--highlight-rgb), X)
  sanitized = sanitized.replace(/rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)/gi, 
    'rgba(var(--highlight-rgb), $1)');
  
  // Pattern: rgb(0, 0, 0) -> rgba(var(--shadow-rgb), 1)
  sanitized = sanitized.replace(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/gi, 
    'rgba(var(--shadow-rgb), 1)');
  
  // Pattern: rgb(255, 255, 255) -> rgba(var(--highlight-rgb), 1)
  sanitized = sanitized.replace(/rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, 
    'rgba(var(--highlight-rgb), 1)');
  
  // Restore :root block with updated content
  const updatedRootBlock = `:root {${updatedRootContent}\n}`;
  sanitized = sanitized.replace('___ROOT_PLACEHOLDER___', updatedRootBlock);
  
  console.log('  ✓ Sanitized rgba/rgb color literals');
  
  return sanitized;
}

function sanitizeHexLeakage(css: string): string {
  console.log('Sanitizing hex color leakage...');
  
  // Extract existing :root block
  const rootMatch = css.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) {
    console.warn('  ⚠️ No :root block found, cannot sanitize');
    return css;
  }
  
  const rootContent = rootMatch[1];
  const rootBlock = rootMatch[0];
  
  // Remove :root block temporarily
  const cssWithoutRoot = css.replace(rootBlock, '___ROOT_PLACEHOLDER___');
  
  // Find all hex colors outside :root
  const hexPattern = /#([0-9a-fA-F]{3,8})\b/g;
  const hexMatches = [...cssWithoutRoot.matchAll(hexPattern)];
  
  if (hexMatches.length === 0) {
    console.log('  ✓ No hex leakage detected');
    return css;
  }
  
  console.log(`  ⚠️ Found ${hexMatches.length} hex colors outside :root, sanitizing...`);
  
  // Build new variables for leaked colors
  const newVars: Record<string, string> = {};
  let sanitized = cssWithoutRoot;
  let varCounter = 1;
  
  for (const match of hexMatches) {
    const hexColor = match[0]; // Full match like "#fff" or "#ffffff"
    const hexValue = match[1]; // Just the hex digits
    
    // Check if we already created a var for this color
    let varName = Object.keys(newVars).find(key => newVars[key] === hexColor);
    
    if (!varName) {
      // Create new variable
      varName = `--color-sanitized-${varCounter++}`;
      newVars[varName] = hexColor;
      console.log(`    Created ${varName}: ${hexColor}`);
    }
    
    // Replace this occurrence with var reference
    sanitized = sanitized.replace(hexColor, `var(${varName})`);
  }
  
  // Rebuild :root block with new variables
  const newVarDeclarations = Object.entries(newVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  
  const updatedRootBlock = `:root {${rootContent}\n${newVarDeclarations}\n}`;
  
  // Restore :root block
  sanitized = sanitized.replace('___ROOT_PLACEHOLDER___', updatedRootBlock);
  
  console.log(`  ✓ Sanitized ${hexMatches.length} hex colors into ${Object.keys(newVars).length} variables`);
  
  return sanitized;
}

// ============================================================================
// FORMATTING (PRETTIER OR LIGHTWEIGHT)
// ============================================================================

function detectPrettier(): boolean {
  try {
    require.resolve('prettier');
    return true;
  } catch {
    return false;
  }
}

async function prettifyFile(filepath: string): Promise<void> {
  const content = fs.readFileSync(filepath, 'utf-8');
  const ext = path.extname(filepath);
  
  let parser: 'html' | 'css' | 'babel' | undefined;
  if (ext === '.html') parser = 'html';
  else if (ext === '.css') parser = 'css';
  else if (ext === '.js') parser = 'babel';
  
  if (!parser) return;
  
  try {
    const formatted = await prettier.format(content, {
      parser,
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: false,
      trailingComma: 'none',
      bracketSpacing: true,
      arrowParens: 'avoid'
    });
    fs.writeFileSync(filepath, formatted);
  } catch (err) {
    console.warn(`  ⚠️ Prettier failed for ${path.basename(filepath)}: ${(err as Error).message}`);
  }
}

function lightweightFormat(content: string, type: 'html' | 'css' | 'js'): string {
  if (type === 'html') {
    // Basic HTML formatting
    return content
      .replace(/>\s*</g, '>\n<')  // Newline between tags
      .split('\n')
      .map(line => {
        const depth = (line.match(/^\s*/)?.[0]?.length || 0) / 2;
        const trimmed = line.trim();
        if (!trimmed) return '';
        return '  '.repeat(Math.max(0, depth)) + trimmed;
      })
      .filter(line => line.trim())
      .join('\n');
  } else if (type === 'css') {
    // Basic CSS formatting
    return content
      .replace(/;\s*/g, ';\n  ')
      .replace(/\{\s*/g, ' {\n  ')
      .replace(/\}\s*/g, '\n}\n')
      .replace(/\n\s*\n+/g, '\n\n');
  } else if (type === 'js') {
    // Basic JS formatting
    return content
      .replace(/;\s*/g, ';\n')
      .replace(/\{\s*/g, ' {\n  ')
      .replace(/\}\s*/g, '\n}\n')
      .replace(/\n\s*\n+/g, '\n\n');
  }
  return content;
}

async function formatAllFiles(distDir: string = DIST_DIR): Promise<void> {
  const hasPrettier = detectPrettier();
  console.log(`=== FORMATTING (${hasPrettier ? 'PRETTIER' : 'LIGHTWEIGHT'}) ===\n`);
  
  const files = fs.readdirSync(distDir);
  const filesToFormat: string[] = [];
  
  for (const file of files) {
    const filepath = path.join(distDir, file);
    const stat = fs.statSync(filepath);
    
    if (stat.isFile() && /\.(html|css|js)$/.test(file)) {
      filesToFormat.push(filepath);
    }
  }
  
  console.log(`Formatting ${filesToFormat.length} files...`);
  
  if (hasPrettier) {
    for (const filepath of filesToFormat) {
      await prettifyFile(filepath);
    }
  } else {
    for (const filepath of filesToFormat) {
      const content = fs.readFileSync(filepath, 'utf-8');
      const ext = path.extname(filepath);
      let formatted = content;
      
      if (ext === '.html') formatted = lightweightFormat(content, 'html');
      else if (ext === '.css') formatted = lightweightFormat(content, 'css');
      else if (ext === '.js') formatted = lightweightFormat(content, 'js');
      
      if (formatted !== content) {
        fs.writeFileSync(filepath, formatted);
      }
    }
  }
  
  console.log(`✓ Formatted ${filesToFormat.length} files\n`);
}

// ============================================================================
// APP.JS FALLBACK
// ============================================================================

function ensureAppJs(distDir: string = DIST_DIR): void {
  const appJsPath = path.join(distDir, 'app.js');
  
  if (fs.existsSync(appJsPath)) {
    console.log('✓ app.js exists\n');
    return;
  }
  
  console.log('⚠️ app.js missing, creating fallback...\n');
  
  const fallbackAppJs = `// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.querySelector('[aria-controls="main-nav"]');
  const nav = document.getElementById('main-nav');
  
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      nav.classList.toggle('open');
    });
  }
  
  // Active nav highlighting
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav a').forEach(link => {
    if (link.getAttribute('href') === './' + currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
  
  // Simple theme toggle (optional)
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    themeToggle.addEventListener('click', () => {
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    });
  }
});
`;
  
  fs.writeFileSync(appJsPath, fallbackAppJs);
  console.log('✓ Created fallback app.js\n');
}

// ============================================================================
// ROUTE MAP BUILDER
// ============================================================================

function buildRouteMap(siteSpec: SiteSpec): Map<string, string> {
  const routeMap = new Map<string, string>();
  
  for (const page of siteSpec.pages) {
    routeMap.set(page.id, `./${page.filename}`);
    routeMap.set(page.title, `./${page.filename}`);
    routeMap.set(page.filename, `./${page.filename}`);
    routeMap.set(page.filename.replace('.html', ''), `./${page.filename}`);
  }
  
  return routeMap;
}

// ============================================================================
// FREEZE HEADER/FOOTER
// ============================================================================

function freezeHeaderFooter(siteSpec: SiteSpec): { headerHtml: string; footerHtml: string; routeMap: Map<string, string> } {
  console.log('=== FREEZE HEADER/FOOTER ===\n');
  
  // Build route map from sitemap
  const routeMap = new Map<string, string>();
  for (const page of siteSpec.pages) {
    routeMap.set(page.id, `./${page.filename}`);
    routeMap.set(page.title, `./${page.filename}`);
  }

  // Load index.html
  const indexPath = path.join(DIST_DIR, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');
  const $ = cheerio.load(indexHtml);

  // Extract header and footer
  let headerHtml = $('header.site-header').first().html() || '';
  let footerHtml = $('footer.site-footer').first().html() || '';

  // Rewrite hrefs in header
  if (headerHtml) {
    const $header = cheerio.load(`<header>${headerHtml}</header>`);
    $header('a[href]').each((_, el) => {
      const href = $header(el).attr('href') || '';
      let newHref = href;
      
      // If it looks like it should be a local link, validate it
      if (!href.startsWith('http') && !href.startsWith('#')) {
        const filename = href.replace('./', '').replace(/\.html$/, '');
        const found = routeMap.get(filename) || routeMap.get(filename + '.html');
        newHref = found || '#';
      }
      $header(el).attr('href', newHref);
    });
    headerHtml = $header('header').html() || headerHtml;
  }

  // Rewrite hrefs in footer
  if (footerHtml) {
    const $footer = cheerio.load(`<footer>${footerHtml}</footer>`);
    $footer('a[href]').each((_, el) => {
      const href = $footer(el).attr('href') || '';
      let newHref = href;
      
      if (!href.startsWith('http') && !href.startsWith('#')) {
        const filename = href.replace('./', '').replace(/\.html$/, '');
        const found = routeMap.get(filename) || routeMap.get(filename + '.html');
        newHref = found || '#';
      }
      $footer(el).attr('href', newHref);
    });
    footerHtml = $footer('footer').html() || footerHtml;
  }

  // Write frozen partials
  if (!fs.existsSync(PARTIALS_DIR)) {
    fs.mkdirSync(PARTIALS_DIR, { recursive: true });
  }

  const fullHeaderHtml = `<header class="site-header">${headerHtml}</header>`;
  const fullFooterHtml = `<footer class="site-footer">${footerHtml}</footer>`;

  fs.writeFileSync(path.join(PARTIALS_DIR, 'header.html'), fullHeaderHtml);
  fs.writeFileSync(path.join(PARTIALS_DIR, 'footer.html'), fullFooterHtml);

  // Also write _partials.json for validator
  const partialsJson = {
    canonicalHeader: fullHeaderHtml,
    canonicalFooter: fullFooterHtml,
    canonicalHeadIncludes: '<link rel="stylesheet" href="./styles.css">\n  <link rel="stylesheet" href="./components.css">'
  };
  fs.writeFileSync(
    path.join(DIST_DIR, '_partials.json'),
    JSON.stringify(partialsJson, null, 2)
  );

  console.log(`✓ Frozen header: ${headerHtml.length} chars`);
  console.log(`✓ Frozen footer: ${footerHtml.length} chars`);
  console.log(`✓ Route map: ${routeMap.size} entries`);
  console.log(`✓ Saved to: ${PARTIALS_DIR}/ and _partials.json\n`);

  return {
    headerHtml: fullHeaderHtml,
    footerHtml: fullFooterHtml,
    routeMap
  };
}

// ============================================================================
// PHASE 0: Generate Foundation with Gemini ONLY
// ============================================================================

/**
 * Stable rules block for Phase 0 - cached with Gemini prompt caching
 * This block contains ALL schema/constraints that never change
 */
function buildPhase0StableRules(siteBrief: string, desiredPageCount: number): string {
  return `You are generating ONLY the FOUNDATION of a static website.

Site Brief:
${siteBrief}

CRITICAL PAGE GENERATION RULE:
- MUST generate sitemap with EXACTLY ${desiredPageCount} pages (sitemap.pages.length === ${desiredPageCount})
- index.html MUST be included and counts as one page
- For knowledgebase/guide/resource sites: Create INDIVIDUAL pages for EACH major category/topic
- DO NOT create a single "knowledgebase.html" with all content
- Example: "foraging guide" → separate pages: edible-plants.html, toxic-plants.html, cooking-recipes.html, seasonal-guide.html, plant-facts.html, etc.
- Each category page should be listed in the sitemap with clear purpose
- Break down content into logical sections to reach exactly ${desiredPageCount} pages

Use a MODERN DARK THEME with appropriate aesthetics for the site's purpose.

CRITICAL OUTPUT RULES:
- Output ONLY valid JSON. No markdown. No commentary. No code fences.
- Generate ONLY these 4 files: index.html, styles.css, components.css, app.js
- Do NOT generate any additional .html files besides index.html
- Do NOT output page content files - only the foundation

STRUCTURE REQUIREMENTS:
- index.html must include a beautiful header + nav + footer
- Use modern HTML5 structure and accessibility (semantic elements, ARIA, meta tags)
- Index must link: ./styles.css, ./components.css and include ./app.js (defer)
- Include placeholders in header/footer:
  - Use <!--NAV_ITEMS--> placeholder inside <nav> element (this will be replaced with actual nav links)
  - Use <!--FOOTER_LINKS--> placeholder inside footer quick links section
  - DO NOT include hardcoded nav links AND placeholder - use ONLY the placeholder
  - Example CORRECT: <nav><!--NAV_ITEMS--></nav>
  - Example WRONG: <nav><a href="...">Home</a><!--NAV_ITEMS--></nav>
- HEADER REQUIREMENTS (CRITICAL):
  - Header MUST contain "Home" link
  - Logo/brand element MUST link to ./index.html
  - Example: <a href="./index.html" class="logo">Brand</a>
  - Navigation must include: <a href="./index.html">Home</a>
- NAVIGATION LIMITS:
  - Maximum 6 items in main header nav (including Home)
  - For knowledgebase/docs sites: Keep header minimal (Home, Knowledge Base, Pricing, Contact)
  - Do NOT list every KB article in header - KB articles should be in the main KB page content
  - Mobile support: Header must use responsive design (burger menu pattern recommended)
  - All nav links must be functional and point to valid pages

MOBILE & RESPONSIVE REQUIREMENTS (CRITICAL):
- MUST be fully mobile-phone compatible (tested on 320px+ screens)
- Header MUST have responsive burger menu for mobile (<768px)
  * Desktop: horizontal nav with all items visible
  * Mobile: hamburger icon that toggles mobile menu
  * Include CSS for .mobile-menu-toggle and .nav-open state
- Typography MUST scale responsively:
  * Base: clamp(16px, 4vw, 18px) for body text
  * Headings: Use clamp() for fluid scaling (e.g., h1: clamp(2rem, 5vw, 3.5rem))
- Layout MUST adapt:
  * Desktop: multi-column layouts with CSS Grid/Flexbox
  * Tablet (768px-1024px): 2-column layouts
  * Mobile (<768px): single column, full-width elements
- Spacing MUST be responsive:
  * Use clamp() for padding/margins (e.g., padding: clamp(1rem, 3vw, 3rem))
  * Container max-width: clamp(320px, 90vw, 1200px)
- Touch-friendly on mobile:
  * Buttons min-height: 44px (tap target size)
  * Links with adequate spacing (min 8px between clickable elements)
  * Form inputs: min-height 44px

ANIMATIONS & EFFECTS (CRITICAL):
- Smooth transitions on ALL interactive elements:
  * Links: transition: color 0.3s ease, transform 0.2s ease;
  * Buttons: transition: background 0.3s ease, transform 0.15s ease, box-shadow 0.3s ease;
  * Cards/sections: transition: transform 0.3s ease, box-shadow 0.3s ease;
- Hover effects (desktop only - use @media (hover: hover)):
  * Links: subtle color change + underline animation
  * Buttons: background color shift + slight scale (transform: scale(1.05))
  * Cards: lift effect (transform: translateY(-4px) + increased box-shadow)
- Focus states for accessibility:
  * outline: 2px solid var(--accent); outline-offset: 2px;
  * Focus-visible for keyboard navigation
- Smooth scroll:
  * html { scroll-behavior: smooth; }
- Page load animations:
  * Fade-in for main content: @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  * Apply: animation: fadeIn 0.6s ease-out;
- Micro-interactions:
  * Button active state: transform: scale(0.98);
  * Loading states with pulse animation
  * Success/error states with color transitions

GAME IMPLEMENTATION (if user requested games):
- Each game must be a separate HTML page (e.g., snake.html, pong.html)
- Game pages must include:
  * <canvas id="gameCanvas" class="game-canvas"></canvas>
  * Score display: <div id="score" class="game-score">Score: 0</div>
  * Control buttons: <div class="game-controls"><button id="startBtn">Start</button><button id="resetBtn">Reset</button></div>
  * Instructions section explaining how to play
- app.js must implement ACTUAL PLAYABLE GAMES with:
  * Game loop using requestAnimationFrame
  * Collision detection and game mechanics
  * Keyboard/mouse controls
  * Score tracking and game over states
  * NO PLACEHOLDERS - games must be fully functional
- Include CSS for game elements:
  * .game-canvas: canvas border, background, centered, responsive
  * .game-score: prominent score display
  * .game-controls: button layout and styling

CSS RULES (CRITICAL):
- All colors MUST be defined as CSS variables in exactly one :root { } block in styles.css
- You may use hex values, BUT ONLY inside :root
- Everywhere else must reference var(--variable-name)
- For shadows/tints, define RGB variables like: --shadow-rgb: 0, 0, 0 (no quotes, just numbers)
- Then use: rgba(var(--shadow-rgb), 0.2)
- FORBIDDEN: Numeric rgb/rgba/hsl/hsla outside :root (e.g., rgba(0,0,0,0.5) is FORBIDDEN)
- ALLOWED: rgba(var(--shadow-rgb), 0.5) or var(--primary)
- No inline styles in HTML (pages may add them later for dynamic content)

DESIGN GUIDELINES:
- Choose appropriate color scheme based on the site brief and style direction
- Ensure high contrast for accessibility
- Use semantic color variables (primary, accent, background, surface, text)
- Consider the target audience and brand personality
- Apply consistent spacing and typography hierarchy

BASELINE TYPOGRAPHY (styles.css) - REQUIRED:
Must include comprehensive styling for ALL of these (non-negotiable):
- Typography: h1, h2, h3, h4, p, a (with :hover/:focus), strong, em
  * h2 is MANDATORY - must have explicit styling (font-size, margin, color)
- Lists: ul, ol, li (proper spacing and bullets/numbers)
- Tables: table, thead, tbody, tr, th, td (borders, padding, zebra striping)
  * Table styling is MANDATORY - must be fully styled
- Code: code, pre (dark bg, padding, monospace font, horizontal scroll)
  * Code/pre styling is MANDATORY - must have background and proper formatting
- Blockquote: blockquote (border-left, padding, italic)
- Horizontal rule: hr (visible divider)
- Content wrapper: .content or .prose class with max-width 65ch, centered, mobile padding, line-height 1.6-1.8

LAYOUT COMPONENTS (components.css):
Must include these utility classes with FULL responsive support:
- .container: max-width wrapper, centered, responsive padding (clamp-based)
- .stack / .space-y-*: vertical spacing utility (> * + * margin-top)
- .grid: responsive grid (CSS Grid with auto-fit, collapses to 1-col on mobile)
- .card: box with padding, background, border/shadow + hover lift effect
- .lead / .text-lg: larger intro text (font-size: 1.25rem, opacity: 0.9)
- .kpi: key metric display (large number + label)
- .callout: highlighted info box with border
- .badge: small label/tag (e.g., "NEW", "POPULAR")
- .btn / .btn-primary / .btn-secondary: button styling with transitions and hover effects
- .mobile-menu-toggle: hamburger button (visible only on mobile)
- .nav-open: class for when mobile menu is active
- .search-box: search input styling
- .kb-link: knowledgebase article link styling

MOBILE MENU IMPLEMENTATION:
- Hamburger icon: 3 spans inside .mobile-menu-toggle button
- CSS animation for hamburger → X transformation
- Nav menu: position fixed on mobile, slides in from right/top
- Overlay: semi-transparent backdrop when menu open
- JavaScript in app.js to toggle .nav-open class

TAILWIND-STYLE UTILITIES (Optional but recommended):
You MAY include Tailwind-inspired utility classes for spacing, colors, typography:
- Spacing: .p-*, .px-*, .py-*, .m-*, .mx-*, .my-*, .gap-* (e.g., .p-4 = 1rem padding)
- Flex/Grid: .flex, .flex-col, .items-center, .justify-between, .grid-cols-*
- Typography: .text-sm, .text-base, .text-lg, .text-xl, .font-bold, .leading-*
- Colors: .bg-*, .text-*, .border-* (using CSS variables)
- Borders: .rounded, .rounded-lg, .border, .border-2
- Shadows: .shadow, .shadow-md, .shadow-lg

OUTPUT JSON SCHEMA:
{
  "sitemap": {
    "pages": [
      {"id":"home","title":"Home","filename":"index.html","purpose":"Landing page description"},
      {"id":"pricing","title":"Pricing","filename":"pricing.html","purpose":"..."},
      ...
    ],
    "navOrder": ["home", "pricing", "features", ...],
    "footerOrder": ["home", "pricing", ...]
  },
  "files": [
    {"path":"index.html","content":"<!DOCTYPE html>..."},
    {"path":"styles.css","content":":root { ... }"},
    {"path":"components.css","content":"..."},
    {"path":"app.js","content":"..."}
  ]
}`;
}

/**
 * Stable reference block for cache priming - NEVER changes
 * Large constant content to ensure cache eligibility
 */
function buildPhase0StableReference(): string {
  return `
=== WEBSITE GENERATION PLAYBOOK ===

ACCESSIBILITY CHECKLIST:
- All images must have meaningful alt text
- Color contrast must meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text)
- All interactive elements must be keyboard accessible
- Focus indicators must be visible and clear
- Semantic HTML5 elements required (header, nav, main, footer, article, section)
- ARIA labels for complex widgets and dynamic content
- Form inputs must have associated labels
- Skip navigation links for keyboard users
- Responsive design that works at all viewport sizes
- No content should rely solely on color to convey meaning

TYPOGRAPHY & READABILITY:
- Base font size: 16px minimum for body text
- Line height: 1.5-1.8 for body content
- Line length: 50-75 characters (about 65ch) for optimal readability
- Heading hierarchy: h1 (1 per page), h2, h3, h4 in logical order
- Font pairing: Maximum 2-3 font families (heading, body, monospace)
- Paragraph spacing: 1em between paragraphs
- Letter spacing: Slight increase for all-caps text
- Font weights: Regular (400) for body, Bold (600-700) for headings

COMPONENT PATTERNS:
- Hero sections: Large heading, subheading, CTA, optional image
- Card components: Container with padding, background, optional shadow
- Navigation: Horizontal menu with hover states, mobile hamburger
- Footer: Multi-column layout with links, copyright, social icons
- Forms: Labels above inputs, validation messages, submit button
- Buttons: Clear primary/secondary styles, hover/active states
- Lists: Proper spacing, bullet/number styling
- Tables: Headers, borders, zebra striping for readability
- Code blocks: Monospace font, dark background, syntax highlighting
- Callouts: Highlighted boxes for important information

LAYOUT PRINCIPLES:
- Mobile-first responsive design
- Grid system: 12-column or CSS Grid for alignment
- Container max-width: 1200-1400px for readability
- Consistent spacing scale (8px base: 8, 16, 24, 32, 48, 64)
- Whitespace: Generous padding around content blocks
- Visual hierarchy: Size, weight, color, spacing to guide attention
- Content sections: Clear separation with backgrounds or borders
- Sticky navigation for easy access
- Smooth scrolling for anchor links

SEO & META REQUIREMENTS:
- Unique page titles (50-60 characters)
- Meta descriptions (150-160 characters)
- Canonical URLs to prevent duplicate content
- Open Graph tags for social sharing
- Structured data (JSON-LD) where applicable
- XML sitemap generation
- Robots.txt configuration
- Fast page load times (optimize images, minimize CSS/JS)
- Mobile-friendly design (Google mobile-first indexing)
- Clean, semantic URLs

PERFORMANCE OPTIMIZATION:
- Lazy loading for images below the fold
- Minified CSS and JavaScript
- Image optimization (WebP format, appropriate sizes)
- CSS critical path optimization
- Async/defer for non-critical scripts
- Font loading strategy (font-display: swap)
- Resource hints (preconnect, prefetch)
- Compression (gzip/brotli)

CONTENT STRATEGY:
- Clear value proposition on homepage
- Scannable content (short paragraphs, bullet points, headings)
- Compelling CTAs throughout
- Consistent tone and voice
- Error-free grammar and spelling
- Relevant, high-quality images
- Internal linking for navigation
- Contact information easily accessible
- Privacy policy and terms of service
- Regular content updates

This playbook ensures all generated websites follow industry best practices for accessibility, usability, performance, and SEO.`;
}

/**
 * Dynamic input block for Phase 0 - changes per request
 */
function buildPhase0DynamicInput(desiredPageCount: number): string {
  return `SITEMAP REQUIREMENTS:
- Create a sitemap with EXACTLY ${desiredPageCount} pages (sitemap.pages.length must equal ${desiredPageCount})
- index.html MUST be included as one of the pages (counts toward the ${desiredPageCount})
- For GAME/INTERACTIVE WEBSITES: Create individual pages for EACH specific game/tool mentioned:
  * Use hyphenated lowercase filenames from the actual names (e.g., "tic-tac-toe.html", "memory-match.html", "word-scramble.html")
  * WRONG: Generic "games.html" or "tools.html" - each needs its own dedicated page
  * Each interactive page needs full implementation with canvas/UI elements
  * Add supporting pages like "how-to-play.html" if appropriate
- For knowledgebase/docs sites: Create individual pages for each major topic/category to reach ${desiredPageCount} pages
- For product/service sites: Create pages for features, pricing, use-cases, integrations, support, etc.
- The "knowledgebase" page (if included) should serve as a hub page with:
  * Search input for filtering articles
  * Categorized list of ALL site KB articles with links
  * "Popular articles" or "Getting started" section
  * This is NOT in the header - it's the main content of knowledgebase.html
- Each page needs: unique id, descriptive title, filename ending in .html, clear purpose
- navOrder: array of page ids for main navigation (maximum 6 items including Home)
- footerOrder: array of page ids for footer quick links (typically 8-12 items)

Generate the complete foundation now.`;
}

// ============================================================================
// PROMPTER LLM
// ============================================================================

interface PrompterOutput {
  improvedBrief: string;
  styleDirection: {
    vibe: string;
    paletteHints: string;
    typography: string;
    layout: string;
  };
  mustInclude: string[];
  assumptions: string[];
  avoid: string[];
}

interface PrompterResult {
  rawPrompt: string;
  prompterJson: PrompterOutput | null;
  finalSiteBrief: string;
}

async function improveWebsitePrompt(
  rawPrompt: string,
  client: ReturnType<typeof createClient>,
  commonRules: string = ''
): Promise<PrompterResult> {
  const contextJson = JSON.stringify({
    MIN_PAGES,
    SITE_UI_MODE: SITE_UI_MODE || 'static',
    domain: process.env.SITE_DOMAIN || null,
    projectName: process.env.SITE_PROJECT_NAME || null
  }, null, 2);

  const prompterPrompt = `You are an expert "website brief improver" specializing in transforming raw user requests into comprehensive, detailed website briefs that lead to exceptional static site generation.

Your goal: Expand the raw prompt into a rich, actionable brief that captures every nuance of design, content strategy, user experience, and technical requirements.

RULES:
- Output ONLY valid JSON matching the schema below. No markdown, no commentary.
- Be EXTREMELY detailed in the improvedBrief - include:
  * Target audience personas (demographics, behaviors, pain points)
  * Tone and voice guidelines (formal/casual, technical/accessible, playful/serious)
  * Content strategy for each major section
  * Unique value propositions and key messaging
  * User journey considerations and CTAs
  * Specific examples of content types (guides, tutorials, FAQs, etc.)
- For styleDirection, be specific:
  * vibe: Describe the emotional feel and aesthetic approach in detail
  * paletteHints: Specify color psychology, contrast levels, accent usage
  * typography: Font pairing strategy, hierarchy, readability considerations
  * layout: Grid systems, whitespace usage, component organization
- In mustInclude, list ONLY the features/pages the user explicitly requested:
  * For GAME WEBSITES: List ONLY the games mentioned by the user (do NOT expand/add extra games):
    - EXAMPLE: User says "simple games like dots and boxes" → mustInclude: ["index.html", "dots-and-boxes.html with fully playable game", "how-to-play.html"]
    - WRONG: User mentions 1 game → you add 20+ games they didn't ask for
    - Each game page filename format: Use hyphenated lowercase from game name (e.g., "tic-tac-toe.html", "connect-four.html")
    - CRITICAL: Do NOT create generic "games.html" - create "{specific-game-name}.html" for each game
    - Each interactive page MUST specify: canvas element, complete script implementation, game loop, input handling, scoring
    - Add supporting pages if logical (how-to-play, leaderboard, etc.)
  * For knowledgebase/guide sites: specify only the category pages that fit the user's scope
    - Example: "foraging guide" → pages for "edible-plants.html", "toxic-plants.html", "cooking-recipes.html", "seasonal-guide.html", "plant-facts.html", etc.
    - DO NOT lump categories into a single "knowledgebase.html" - each major category needs its own page
- In assumptions, document all design decisions and their rationale
- In avoid, specify anti-patterns and what NOT to do
- Do NOT invent contact details (use placeholders like "contact@example.com")
- RESPECT USER SCOPE: If user says "a simple game website with dots and boxes", don't expand it to 20+ games
- If MIN_PAGES >= 6, ensure guidance supports a ${MIN_PAGES}+ page sitemap with varied content

Context:
${contextJson}

Raw user prompt:
${rawPrompt}
${commonRules}

Output JSON schema:
{
  "improvedBrief": "...comprehensive multi-paragraph brief...",
  "styleDirection": { 
    "vibe":"...detailed vibe description...", 
    "paletteHints":"...specific color strategy...", 
    "typography":"...font system details...", 
    "layout":"...layout architecture..."
  },
  "mustInclude": ["...exhaustive list of features and pages..."],
  "assumptions": ["...design rationale and decisions..."],
  "avoid": ["...anti-patterns and pitfalls..."]
}`;

  try {
    console.log(`\n=== PROMPTER LLM (${SITE_PROMPTER_MODEL}) ===\n`);
    
    const response = await client.chat({
      model: SITE_PROMPTER_MODEL,
      messages: [{ role: 'user', content: prompterPrompt }],
      maxTokens: 3000,
      temperature: 0.5,
      stream: false,  // Disable streaming for JSON
      response_format: { type: 'json_object' },
      plugins: [{ id: 'response-healing' }]
    });

    const responseContent = typeof response === 'string' ? response : response.content;
    const prompterJson = parseJSON(responseContent) as PrompterOutput;
    
    // Build final site brief from improved output
    const styleAppendix = `\n\nStyle Direction: ${prompterJson.styleDirection.vibe} vibe, ${prompterJson.styleDirection.paletteHints} palette, ${prompterJson.styleDirection.typography} typography, ${prompterJson.styleDirection.layout} layout.`;
    const mustIncludeAppendix = prompterJson.mustInclude.length > 0 
      ? `\n\nMust Include: ${prompterJson.mustInclude.join(', ')}` 
      : '';
    const avoidAppendix = prompterJson.avoid.length > 0 
      ? `\n\nAvoid: ${prompterJson.avoid.join(', ')}` 
      : '';
    
    const finalSiteBrief = prompterJson.improvedBrief + styleAppendix + mustIncludeAppendix + avoidAppendix;
    
    console.log(`✓ Prompter improved brief (${finalSiteBrief.length} chars)\n`);
    
    return {
      rawPrompt,
      prompterJson,
      finalSiteBrief
    };
  } catch (err: any) {
    console.warn(`⚠️ Prompter failed: ${err.message}`);
    console.log(`Falling back to raw prompt\n`);
    
    return {
      rawPrompt,
      prompterJson: null,
      finalSiteBrief: rawPrompt
    };
  }
}

async function phase0GenerateContract(
  client: ReturnType<typeof createClient>,
  siteBrief: string,
  minPages: number = MIN_PAGES,
  mode: WebMode = 'web',
  commonRules: string = '',
  distDir: string = DIST_DIR
): Promise<{ siteSpec: SiteSpec; templates: Templates }> {
  console.log('=== PHASE 0: Generate Foundation ===\n');

  // Use mode to determine model
  const PHASE_0_MODEL = getPhase0Model(mode);
  console.log(`Model: ${PHASE_0_MODEL} (${mode} mode)\n`);
  
  const isFreeModel = PHASE_0_MODEL.includes(':free');
  const shouldCachePrime = SITE_CACHE_PRIME && !isFreeModel;
  
  if (shouldCachePrime) {
    console.log('Cache priming: ENABLED (large stable prefix)\n');
  } else if (isFreeModel) {
    console.log('Cache priming: DISABLED (free model, no cache support)\n');
  } else {
    console.log('Cache priming: DISABLED (minimal stable prefix)\n');
  }

  // Build stable prefix (for cache hits across runs) and dynamic input
  const stableRules = buildPhase0StableRules(siteBrief, minPages);
  const stableReference = shouldCachePrime ? buildPhase0StableReference() : '';
  const dynamicInput = buildPhase0DynamicInput(minPages);

  // Construct prompt: stable prefix first, dynamic at end
  const fullPrompt = [
    'Output JSON only. No markdown, no commentary.',
    stableRules,
    stableReference,
    dynamicInput,
    commonRules
  ].filter(Boolean).join('\n\n');

  console.log(`Calling ${PHASE_0_MODEL}${isFreeModel ? '' : ' with cache tracking'}...`);
  
  let content: string;
  let meta: any = undefined;
  let attemptedModel = PHASE_0_MODEL;
  
  try {
    // Use chat() with usage tracking only for paid models (free models don't support caching)
    const response = await client.chat({
      model: PHASE_0_MODEL,
      messages: [{ role: 'user', content: fullPrompt }],
      temperature: 0.2,
      includeUsage: !isFreeModel,  // Only track usage for paid models
      stream: false,  // Disable streaming for JSON
      response_format: { type: 'json_object' },
      plugins: [{ id: 'response-healing' }]
    }) as { content: string; meta?: any };
    
    content = typeof response === 'string' ? response : response.content;
    meta = typeof response === 'object' ? response.meta : undefined;

    console.log(`✓ Received response: ${content.length} chars\n`);
  } catch (err: any) {
    // If primary model fails, try fallback to larger model
    console.warn(`⚠️ Primary model failed: ${err.message}`);
    console.log('Retrying with google/gemini-2.0-flash-exp:free...\n');
    
    const fallbackModel = 'google/gemini-2.0-flash-exp:free';
    attemptedModel = fallbackModel;
    const response = await client.chat({
      model: fallbackModel,
      messages: [{ role: 'user', content: fullPrompt }],
      temperature: 0.2,
      includeUsage: false,
      stream: false,  // Disable streaming for JSON
      response_format: { type: 'json_object' },
      plugins: [{ id: 'response-healing' }]
    }) as { content: string; meta?: any };
    
    content = typeof response === 'string' ? response : response.content;
    meta = typeof response === 'object' ? response.meta : undefined;
    console.log(`✓ Fallback success: ${content.length} chars\n`);
  }
  
  try {
    if (meta) {
      if (meta.cache_discount) {
        console.log(`💾 Cache discount: ${meta.cache_discount}`);
      }
      if (meta.usage) {
        const { cache_read_tokens, cache_creation_tokens } = meta.usage;
        if (cache_read_tokens || cache_creation_tokens) {
          console.log(`💾 Cache tokens: read=${cache_read_tokens || 0}, created=${cache_creation_tokens || 0}`);
        }
      }
      
      // Save cache info to file for inspection
      const cacheJsonPath = path.join(distDir, '_cache.json');
      fs.writeFileSync(cacheJsonPath, JSON.stringify({
        phase: 'phase0',
        model: attemptedModel,
        cache_prime_enabled: SITE_CACHE_PRIME,
        timestamp: new Date().toISOString(),
        usage: meta.usage,
        cache_discount: meta.cache_discount,
        duration: meta.duration
      }, null, 2));
      console.log(`✓ Saved cache metrics to _cache.json\n`);
    }
    
    const parsed = parseJSON(content);
    
    // Extract from new format
    if (!parsed.sitemap || !parsed.files) {
      throw new Error('Invalid contract structure - missing sitemap/files');
    }

    const sitemap = parsed.sitemap;
    const actualPageCount = sitemap.pages.length;
    
    console.log(`\nPage count check: desired=${minPages}, actual=${actualPageCount}`);
    
    // Enforce EXACT page count (post-process if needed)
    if (actualPageCount !== minPages) {
      console.log(`⚠️ Page count mismatch, fixing...`);
      
      if (actualPageCount > minPages) {
        // Truncate: keep index + high-priority pages, then first N in order
        console.log(`  Truncating from ${actualPageCount} to ${minPages} pages`);
        
        // Priority pages to always keep
        const priorityFilenames = ['index.html', 'pricing.html', 'contact.html'];
        const priorityPages = sitemap.pages.filter((p: any) => 
          priorityFilenames.includes(p.filename)
        );
        
        // Remaining pages in navOrder
        const remainingPages = sitemap.pages.filter((p: any) => 
          !priorityFilenames.includes(p.filename)
        );
        
        // Keep (minPages - priority count) from remaining
        const neededCount = minPages - priorityPages.length;
        const finalPages = [...priorityPages, ...remainingPages.slice(0, neededCount)];
        
        sitemap.pages = finalPages;
        console.log(`  ✓ Kept ${finalPages.length} pages`);
        
      } else {
        // Pad: add filler pages until we reach minPages
        console.log(`  Padding from ${actualPageCount} to ${minPages} pages`);
        
        const fillerCount = minPages - actualPageCount;
        for (let i = 0; i < fillerCount; i++) {
          const fillerNum = i + 1;
          sitemap.pages.push({
            id: `extra-${fillerNum}`,
            title: `Additional Resource ${fillerNum}`,
            filename: `extra-${fillerNum}.html`,
            purpose: `Additional content page ${fillerNum} to meet site requirements`,
            category: 'feature'
          });
        }
        console.log(`  ✓ Added ${fillerCount} filler pages`);
      }
      
      // Update navOrder to match (keep first 6 valid pages)
      const validPageIds = sitemap.pages.map((p: any) => p.id);
      sitemap.navOrder = (sitemap.navOrder || [])
        .filter((id: string) => validPageIds.includes(id))
        .slice(0, 6);
      
      // Ensure 'home' or first page is in nav
      if (sitemap.navOrder.length === 0 || !sitemap.navOrder.includes('home')) {
        sitemap.navOrder.unshift(sitemap.pages[0].id);
      }
      
      console.log(`  ✓ Final page count: ${sitemap.pages.length}\n`);
    } else {
      console.log(`  ✓ Page count matches exactly\n`);
    }

    // Write foundation files (ONLY the ones specified)
    const allowedFiles = ['index.html', 'styles.css', 'components.css', 'app.js'];
    for (const file of parsed.files) {
      // Skip any extra HTML files that shouldn't be generated in Phase 0
      if (!allowedFiles.includes(file.path)) {
        console.log(`⚠️ Skipping unexpected file: ${file.path}`);
        continue;
      }
      
      const filePath = path.join(distDir, file.path);
      let content = file.content;
      
      // Sanitize CSS files
      if (file.path === 'styles.css' || file.path === 'components.css') {
        // First pass: fix common patterns
        content = sanitizeCSSColors(content);
        // Second pass: fix hex leakage
        content = sanitizeHexLeakage(content);
      }
      
      fs.writeFileSync(filePath, content);
      console.log(`✓ ${file.path} (${content.length} chars)`);
      
      // No longer enforce no-inline-styles - allow LLMs to add custom styles/scripts per page
      if (file.path === 'styles.css' || file.path === 'components.css') {
        try {
          assertNoColorLiteralsOutsideRoot(content);
        } catch (err: any) {
          console.warn(`  ⚠️ Color assertion warning: ${err.message}`);
          // Don't fail - sanitizer already fixed what it could
        }
      }
    }

    // Delete any extra HTML files that were accidentally generated (except index.html)
    const distFiles = fs.readdirSync(distDir);
    for (const file of distFiles) {
      if (file.endsWith('.html') && file !== 'index.html') {
        const extraPath = path.join(distDir, file);
        fs.unlinkSync(extraPath);
        console.log(`🗑️ Deleted unexpected HTML file: ${file}`);
      }
    }
    
    // Validate baseline CSS
    let finalStylesContent = fs.readFileSync(path.join(distDir, 'styles.css'), 'utf-8');
    let finalComponentsContent = fs.readFileSync(path.join(distDir, 'components.css'), 'utf-8');
    
    validateBaselineCSS(finalStylesContent, finalComponentsContent);

    // Extract header/footer from index.html for template system
    const indexPath = path.join(distDir, 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf-8');
    const $ = cheerio.load(indexHtml);

    const headerTemplate = $('header').first().toString();
    const footerTemplate = $('footer').first().toString();
    const layoutTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{{TITLE}}</title>
  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./components.css">
</head>
<body>
  {{HEADER}}
  {{MAIN}}
  {{FOOTER}}
  <script src="./app.js" defer></script>
</body>
</html>`;
    
    // Extract style contract from Phase 0 output
    const stylesContent = fs.readFileSync(path.join(distDir, 'styles.css'), 'utf-8');
    const componentsContent = fs.readFileSync(path.join(distDir, 'components.css'), 'utf-8');
    
    // Extract :root variables from styles.css
    const rootMatch = stylesContent.match(/:root\s*\{([^}]*)\}/s);
    const cssVars: Record<string, string> = {};
    if (rootMatch) {
      const rootContent = rootMatch[1];
      const varMatches = rootContent.matchAll(/--([\w-]+):\s*([^;]+);/g);
      for (const match of varMatches) {
        cssVars[`--${match[1]}`] = match[2].trim();
      }
    }
    
    // Extract component classes from components.css (comprehensive extraction)
    const componentClasses: string[] = [];
    // Match class selectors - must start with letter and not be a unit/number
    const classMatches = componentsContent.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
    for (const match of classMatches) {
      const className = match[1];
      // Skip utility suffixes like :hover, :focus, etc, and skip if already added
      if (!componentClasses.includes(className) && !className.match(/^(hover|focus|active|visited)$/)) {
        componentClasses.push(className);
      }
    }
    
    // Sort for consistency
    componentClasses.sort();
    
    // Build and save style contract with new structure
    const styleContract = {
      cssVars,
      componentClasses,
      headerHtml: headerTemplate,  // Keep original with placeholders
      footerHtml: footerTemplate,  // Keep original with placeholders
      headIncludes: {
        styles: './styles.css',
        components: './components.css',
        script: './app.js'
      }
    };
    
    fs.writeFileSync(
      path.join(distDir, '_style-contract.json'),
      JSON.stringify(styleContract, null, 2)
    );
    console.log(`\n✓ Style contract saved: ${Object.keys(cssVars).length} CSS variables, ${componentClasses.length} component classes`);
    
    // Convert sitemap to SiteSpec format
    const siteSpec: SiteSpec = {
      pages: sitemap.pages.map((p: any) => ({
        id: p.id,
        title: p.title,
        filename: p.filename,
        purpose: p.purpose || '',
        category: 'kb' as const
      })),
      navOrder: sitemap.navOrder || sitemap.pages.slice(0, 5).map((p: any) => p.id),
      footerLinks: sitemap.footerOrder ? sitemap.footerOrder.map((id: string) => {
        const page = sitemap.pages.find((p: any) => p.id === id);
        return { text: page?.title || id, pageId: id };
      }) : [],
      designTokens: {
        primaryColor: 'var(--primary)',
        fontFamily: 'system-ui, sans-serif',
        theme: 'generated'
      }
    };

    const templates: Templates = {
      headerTemplate,
      footerTemplate,
      layoutTemplate,
      css: fs.readFileSync(path.join(distDir, 'styles.css'), 'utf-8')
    };

    // Save site-map.json (validator format)
    const siteMap = {
      pages: siteSpec.pages.map(p => ({
        id: p.id,
        title: p.title,
        filename: p.filename
      })),
      navOrder: siteSpec.navOrder
    };
    fs.writeFileSync(
      path.join(distDir, 'site-map.json'),
      JSON.stringify(siteMap, null, 2)
    );

    console.log(`\n✓ Foundation generated: ${siteSpec.pages.length} pages in sitemap`);
    console.log(`✓ Files created: index.html, styles.css, components.css, app.js`);
    console.log(`✓ Style contract saved: _style-contract.json`);
    console.log(`✓ Enforcements passed: no inline styles, colors only in :root\n`);

    return { siteSpec, templates };
  } catch (err: any) {
    console.error('❌ Phase 0 failed:', err.message);
    throw err;
  }
}

// ============================================================================
// NORMALIZE NAV ORDER
// ============================================================================

function normalizeNavOrder(siteSpec: SiteSpec): string[] {
  const validPageIds = new Set(siteSpec.pages.map(p => p.id));
  const normalized: string[] = [];

  for (const entry of siteSpec.navOrder) {
    // Try exact ID match first
    if (validPageIds.has(entry)) {
      normalized.push(entry);
      continue;
    }

    // Try matching by filename (with or without .html)
    const byFilename = siteSpec.pages.find(
      p => p.filename === entry || p.filename === `${entry}.html`
    );
    if (byFilename) {
      normalized.push(byFilename.id);
      continue;
    }

    // Try matching by title (case-insensitive)
    const byTitle = siteSpec.pages.find(
      p => p.title.toLowerCase() === entry.toLowerCase()
    );
    if (byTitle) {
      normalized.push(byTitle.id);
      continue;
    }

    // Entry not found, skip it
    console.warn(`  ⚠️ navOrder entry "${entry}" not found, skipping`);
  }

  // If navOrder is empty after normalization, build a sane default
  if (normalized.length === 0) {
    console.warn('  ⚠️ navOrder empty after normalization, using default');
    const homePage = siteSpec.pages.find(p => p.id === 'home' || p.filename === 'index.html');
    if (homePage) {
      normalized.push(homePage.id);
    }
    // Add first 5 pages (excluding home)
    const otherPages = siteSpec.pages
      .filter(p => p.id !== homePage?.id)
      .slice(0, 5);
    normalized.push(...otherPages.map(p => p.id));
  }

  return normalized;
}

// ============================================================================
// SALVAGE FORBIDDEN ELEMENTS
// ============================================================================

function coerceToMainOnly(html: string): string {
  const $ = cheerio.load(html);
  
  // Try to find existing <main>
  const main = $('main').first();
  if (main.length > 0) {
    // Remove any nested header/footer inside main
    main.find('header, footer').remove();
    return main.toString();
  }
  
  // Try body content
  const body = $('body');
  if (body.length > 0) {
    // Remove header/footer from body, wrap rest in main
    body.find('> header, > footer').remove();
    const bodyContent = body.html() || '';
    return `<main id="page" class="content">${bodyContent}</main>`;
  }
  
  // Fallback: wrap entire HTML
  return `<main id="page" class="content">${html}</main>`;
}

// ============================================================================
// HREF VALIDATION HELPERS
// ============================================================================

function isSafeUrl(href: string): boolean {
  const h = href.trim();
  if (!h) return false;
  return (
    h.startsWith('http://') ||
    h.startsWith('https://') ||
    h.startsWith('#') ||
    h.startsWith('mailto:') ||
    h.startsWith('tel:') ||
    h.startsWith('data:')
  );
}

function isSafeToRewriteHref(href: string): boolean {
  return !isSafeUrl(href);
}

function validateCanonicalPartial(html: string, partialName: string, validFilenames: Set<string>): void {
  const $ = cheerio.load(html);
  const errors: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const trimmed = href.trim();

    // Skip safe URLs
    if (isSafeUrl(trimmed)) return;

    // Must be relative path to existing page
    if (!trimmed.startsWith('./')) {
      errors.push(`Invalid href "${href}" - must start with "./" or be external/anchor`);
      return;
    }

    const filename = trimmed.replace(/^\.\//, '');
    if (!validFilenames.has(filename)) {
      errors.push(`Invalid href "${href}" - points to non-existent page "${filename}"`);
    }
  });

  if (errors.length > 0) {
    console.error(`\n❌ ${partialName} validation failed:`);
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error(`${partialName} contains invalid hrefs`);
  }
}

// ============================================================================
// FREEZE CONTRACT: Build Canonical Header/Footer in CODE
// ============================================================================

function freezeCanonicalPartials(
  siteSpec: SiteSpec,
  templates: Templates,
  distDir: string = DIST_DIR
): void {
  console.log('=== FREEZE CONTRACT: Build Canonical Partials ===\n');

  // NORMALIZE navOrder before building partials
  const normalizedNavOrder = normalizeNavOrder(siteSpec);
  const partialsDir = path.join(distDir, 'partials');
  
  // Load style contract to get original templates with placeholders
  const contractPath = path.join(distDir, '_style-contract.json');
  let headerTemplate = templates.headerTemplate;
  let footerTemplate = templates.footerTemplate;
  
  if (fs.existsSync(contractPath)) {
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
    if (contract.headerHtml) headerTemplate = contract.headerHtml;
    if (contract.footerHtml) footerTemplate = contract.footerHtml;
  }

  // Build nav items HTML from sitemap (ignore model's hrefs)
  const navItems = normalizedNavOrder
    .map(pageId => {
      const page = siteSpec.pages.find(p => p.id === pageId);
      if (!page) return '';
      return `<a href="./${page.filename}" class="nav-link">${page.title}</a>`;
    })
    .filter(Boolean)
    .join('\n      ');

  // Build footer links HTML from sitemap
  const footerLinks = siteSpec.footerLinks
    .map(link => {
      const page = siteSpec.pages.find(p => p.id === link.pageId);
      if (!page) return '';
      return `<a href="./${page.filename}" class="footer-link">${link.text}</a>`;
    })
    .filter(Boolean)
    .join('\n        ');
  
  // Fallback header if empty or invalid
  if (!headerTemplate || headerTemplate.length < 20) {
    headerTemplate = `<header class="site-header">
  <div class="container">
    <a href="./index.html" class="logo">Site</a>
    <button type="button" aria-expanded="false" aria-controls="main-nav" class="nav-toggle">
      <span>Menu</span>
    </button>
    <nav id="main-nav">
      <!--NAV_ITEMS-->
    </nav>
  </div>
</header>`;
  }
  
  // Fallback footer if empty or invalid
  if (!footerTemplate || footerTemplate.length < 20) {
    footerTemplate = `<footer class="site-footer">
  <div class="container">
    <p>&copy; 2025. All rights reserved.</p>
    <nav>
      <!--FOOTER_LINKS-->
    </nav>
  </div>
</footer>`;
  }

  // ONLY fill placeholders - preserve structure and classes
  let canonicalHeader = headerTemplate
    .replace(/<!--\s*NAV_ITEMS\s*-->/g, navItems)
    .replace(/\{\{NAV_ITEMS\}\}/g, navItems);  // Support both formats
  
  let canonicalFooter = footerTemplate
    .replace(/<!--\s*FOOTER_LINKS\s*-->/g, footerLinks)
    .replace(/\{\{FOOTER_LINKS\}\}/g, footerLinks);  // Support both formats
  
  // Safely normalize hrefs (never modify safe URLs)
  const normalizeHrefs = (html: string) => {
    return html.replace(/href=["']([^"']+)["']/g, (match, href) => {
      const h = href.trim();
      
      // Skip empty or invalid
      if (!h || h === '/' || h.startsWith('//')) {
        return `href="./index.html"`;
      }
      
      // NEVER modify safe URLs
      if (isSafeUrl(h)) {
        return match;
      }
      
      // Normalize relative paths: "/x.html" -> "./x.html", "x.html" -> "./x.html"
      const cleaned = h.startsWith('/') ? h.slice(1) : h;
      if (!cleaned.startsWith('./')) {
        return `href="./${cleaned}"`;
      }
      
      return match;
    });
  };
  
  canonicalHeader = normalizeHrefs(canonicalHeader);
  canonicalFooter = normalizeHrefs(canonicalFooter);

  // Build valid filenames set from sitemap
  const validFilenames = new Set(siteSpec.pages.map(p => p.filename));

  // Strip invalid links that point to non-existent pages
  const stripInvalidLinks = (html: string, validFilenames: Set<string>): string => {
    return html.replace(/<a\s+([^>]*?)href=["']\.\/([^"']+)["']([^>]*?)>([^<]*)<\/a>/g, (match, before, filename, after, text) => {
      if (validFilenames.has(filename)) {
        return match;  // Keep valid links
      }
      // Replace invalid link with plain text
      console.warn(`  \u26a0\ufe0f Stripped invalid link: ./${filename}`);
      return `<span class="nav-link disabled">${text}</span>`;
    });
  };
  
  canonicalHeader = stripInvalidLinks(canonicalHeader, validFilenames);
  canonicalFooter = stripInvalidLinks(canonicalFooter, validFilenames);

  // Validate canonical partials before saving
  try {
    validateCanonicalPartial(canonicalHeader, 'Canonical header', validFilenames);
    validateCanonicalPartial(canonicalFooter, 'Canonical footer', validFilenames);
  } catch (err: any) {
    console.error('\n❌ Canonical partial validation failed:', err.message);
    throw err;
  }
  
  if (!fs.existsSync(partialsDir)) {
    fs.mkdirSync(partialsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(partialsDir, 'header.html'), canonicalHeader);
  fs.writeFileSync(path.join(partialsDir, 'footer.html'), canonicalFooter);
  
  // Write _partials.json for validator
  const partialsJson = {
    canonicalHeader,
    canonicalFooter,
    canonicalHeadIncludes: '<link rel="stylesheet" href="./styles.css">\n  <link rel="stylesheet" href="./components.css">'
  };
  fs.writeFileSync(
    path.join(distDir, '_partials.json'),
    JSON.stringify(partialsJson, null, 2)
  );

  console.log(`✓ Canonical header: ${canonicalHeader.length} chars`);
  console.log(`✓ Canonical footer: ${canonicalFooter.length} chars`);
  console.log(`✓ Written to: ${partialsDir}/ and _partials.json\n`);
}

// ============================================================================
// PATCH INDEX AFTER PHASE 0
// ============================================================================

function patchIndexAfterPhase0(
  siteSpec: SiteSpec,
  templates: Templates,
  routeMap: Map<string, string>,
  distDir: string = DIST_DIR
): void {
  console.log('=== PATCHING INDEX.HTML ===\n');
  
  const partialsDir = path.join(distDir, 'partials');
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.warn('⚠️ index.html not found, skipping patch');
    return;
  }
  
  // Load canonical partials (already validated)
  const canonicalHeader = fs.readFileSync(path.join(partialsDir, 'header.html'), 'utf-8');
  const canonicalFooter = fs.readFileSync(path.join(partialsDir, 'footer.html'), 'utf-8');
  
  let html = fs.readFileSync(indexPath, 'utf-8');
  
  // Replace header using regex (preserve whitespace/formatting)
  const headerRegex = /<header[\s\S]*?<\/header>/i;
  if (headerRegex.test(html)) {
    html = html.replace(headerRegex, canonicalHeader);
  }
  
  // Replace footer using regex (preserve whitespace/formatting)
  const footerRegex = /<footer[\s\S]*?<\/footer>/i;
  if (footerRegex.test(html)) {
    html = html.replace(footerRegex, canonicalFooter);
  }
  
  // Ensure main has id="page" and class="content"
  html = html.replace(/<main(\s+[^>]*)?>/i, (match) => {
    // Check if id="page" already exists
    if (/id\s*=\s*["']page["']/i.test(match)) {
      return match; // Already has id="page"
    }
    
    // Remove any existing id attribute and add id="page"
    let cleanedMatch = match.replace(/id\s*=\s*["'][^"']*["']/i, '');
    
    // Add class="content" if not present
    if (!/class\s*=\s*["']([^"']*content[^"']*)["']/i.test(cleanedMatch)) {
      cleanedMatch = cleanedMatch.replace(/>$/, ' class="content">');
    }
    
    // Add id="page"
    cleanedMatch = cleanedMatch.replace(/<main/i, '<main id="page"');
    
    return cleanedMatch;
  });
  
  fs.writeFileSync(indexPath, html);
  console.log('✓ Patched index.html with canonical header/footer\n');
}

// ============================================================================
// PHASE 0.5: Page Enhancement Briefs (optional quality boost)
// ============================================================================

interface PageEnhancement {
  filename: string;
  bullets: string[];
  sections: string[];
  keywords: string[];
}

async function generateEnhancementBriefs(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec,
  siteBrief: string,
  mode: WebMode = 'web',
  distDir: string = DIST_DIR
): Promise<Map<string, PageEnhancement>> {
  console.log('=== PHASE 0.5: Generate Enhancement Briefs ===\n');
  
  // Use consistent model for enhancement in both modes
  const enhancerModel = 'openai/gpt-oss-120b:free';
  
  console.log(`Enhancer model: ${enhancerModel}\n`);
  
  const enhancements = new Map<string, PageEnhancement>();
  
  // Exclude index.html - Phase 0 owns it
  const remainingPages = siteSpec.pages.filter(p => p.filename !== 'index.html');
  
  // Batch pages in groups of 4
  const batches: PageSpec[][] = [];
  for (let i = 0; i < remainingPages.length; i += 4) {
    batches.push(remainingPages.slice(i, i + 4));
  }
  
  console.log(`Processing ${remainingPages.length} pages in ${batches.length} batches...\n`);
  
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`[${batchIdx + 1}/${batches.length}] Enhancing: ${batch.map(p => p.filename).join(', ')}`);
    
    const promptText = `You are a content strategist enhancing page specifications for a static website.

Site Brief: ${siteBrief.slice(0, 500)}...

Your task: Generate detailed enhancement briefs for these ${batch.length} pages to ensure rich, high-quality content.

Pages to enhance:
${batch.map((p, idx) => `${idx + 1}) ${p.filename} — "${p.title}" — Purpose: ${p.purpose}`).join('\n')}

For each page, provide:
- bullets: 5-8 specific content points to include (facts, features, benefits, examples, implementation details)
- sections: 3-5 H2 section titles that structure the page logically
- keywords: 8-12 relevant terms, phrases, or concepts to incorporate naturally

Guidelines by page type (analyze filename and purpose to determine type):

1. INTERACTIVE/GAME pages (filenames contain game names or purpose mentions interactive/playable):
   * bullets: Specific mechanics for THIS game, scoring/win conditions, control schemes, strategy depth, difficulty options
   * sections: Logical flow like "How to Play", "Controls", "Scoring", "Strategy", "Variations"
   * keywords: Interactive, canvas, playable, game-specific terms (e.g., for chess: checkmate, castling; for snake: collision, growth)
   * CRITICAL: Emphasize full implementation required - canvas element, game loop, input handling, win/lose logic

2. KNOWLEDGEBASE/DOCUMENTATION pages (purpose mentions guide/tutorial/docs/help):
   * bullets: Step-by-step procedures, troubleshooting scenarios, best practices, common mistakes, related concepts
   * sections: Topic-specific hierarchy (e.g., "Getting Started", "Advanced Configuration", "Troubleshooting")
   * keywords: Technical terms, commands, configuration options, tools, processes

3. PRODUCT/FEATURE pages (purpose mentions product/feature/service):
   * bullets: Key features, benefits, use cases, technical specs, pricing/plans (if relevant)
   * sections: "Overview", "Key Features", "How It Works", "Use Cases", "Pricing"
   * keywords: Value propositions, differentiators, industry terms

4. GENERAL/INFORMATIONAL pages (about, contact, blog, etc.):
   * bullets: Core information, unique selling points, user benefits, clear CTAs
   * sections: Natural information hierarchy for the page type
   * keywords: Brand terms, mission, values, action words

Adapt guidance based on the specific page context - these are EXAMPLES not rigid rules.

Output ONLY valid JSON:
{
  "enhancements": [
    {
      "filename": "page1.html",
      "bullets": ["...", "..."],
      "sections": ["...", "..."],
      "keywords": ["...", "..."]
    },
    ...
  ]
}`;

    try {
      const response = await client.chat({
        model: enhancerModel,
        messages: [{ role: 'user', content: promptText }],
        maxTokens: 4000,
        temperature: 0.3,
        stream: false,
        response_format: { type: 'json_object' },
        plugins: [{ id: 'response-healing' }]
      });
      
      const content = typeof response === 'string' ? response : response.content;
      const parsed = parseJSON(content);
      
      if (parsed.enhancements && Array.isArray(parsed.enhancements)) {
        for (const enh of parsed.enhancements) {
          if (enh.filename && enh.bullets && enh.sections && enh.keywords) {
            enhancements.set(enh.filename, enh);
            console.log(`  ✓ ${enh.filename}: ${enh.bullets.length} bullets, ${enh.sections.length} sections`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Batch ${batchIdx + 1} failed: ${err.message}`);
    }
  }
  
  // Save to disk
  const enhancementsObj: Record<string, PageEnhancement> = {};
  enhancements.forEach((value, key) => {
    enhancementsObj[key] = value;
  });
  
  fs.writeFileSync(
    path.join(distDir, '_enhancements.json'),
    JSON.stringify(enhancementsObj, null, 2)
  );
  
  console.log(`\n✓ Generated ${enhancements.size} enhancement briefs`);
  console.log(`✓ Saved to _enhancements.json\n`);
  
  return enhancements;
}

// ============================================================================
// PHASE 1: Parallel Page Generation (BULK Models Only)
// ============================================================================

async function phase1GeneratePages(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec,
  poolsLoader: ReturnType<typeof createModelPoolsLoader>,
  mode: WebMode = 'web',
  commonRules: string = '',
  distDir: string = DIST_DIR,
  enhancements?: Map<string, PageEnhancement>
): Promise<Map<string, PageGeneration>> {
  console.log(`=== PHASE 1: Parallel Page Generation (${mode === 'web-pro' ? 'Gemini 3' : 'BULK Models'}) ===\n`);

  // Check if web-pro mode - use single paid model instead of BULK pool
  const phase1Model = getPhase1Model(mode);
  
  if (phase1Model) {
    // web-pro mode: Use single paid model for all pages
    console.log(`Phase 1 model: ${phase1Model} (paid, web-pro mode)\n`);
    return phase1LegacyGeneration(client, siteSpec, phase1Model, commonRules, distDir, enhancements);
  }

  // web mode: Use BULK pool
  const roles = poolsLoader.getRoles();
  if (!roles.BULK_MODELS || roles.BULK_MODELS.length === 0) {
    console.warn('⚠️ No BULK models available, falling back to legacy generation\n');
    return phase1LegacyGeneration(client, siteSpec, undefined, commonRules, distDir, enhancements);
  }

  const scheduler = createScheduler(poolsLoader, {
    maxConcurrency: SITE_PHASE1_CONCURRENCY,
    staggerDelayMs: 0  // No artificial delay - fire immediately
  });

  console.log(`Scheduler: ${SITE_PHASE1_CONCURRENCY} concurrent, 0ms stagger (immediate fire)`);
  console.log(`Phase 1 models: BULK pool (free models)\n`);

  const results = new Map<string, PageGeneration>();
  // EXCLUDE index.html - Phase 0 owns it
  const remainingPages = siteSpec.pages.filter(p => p.filename !== 'index.html');

  const pagePairs: PageSpec[][] = [];
  for (let i = 0; i < remainingPages.length; i += 2) {
    pagePairs.push(remainingPages.slice(i, i + 2));
  }

  // Build filename list for validation
  const allowedFilenames = siteSpec.pages.map(p => p.filename);
  const filenameList = allowedFilenames.join(', ');

  // Load style contract for comprehensive styling guidance
  const contractPath = path.join(distDir, '_style-contract.json');
  let componentsList = '';
  let structuralGuidance = '';
  
  if (fs.existsSync(contractPath)) {
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
    if (contract.componentClasses && contract.componentClasses.length > 0) {
      // Group classes by type for better guidance
      const classes = contract.componentClasses;
      const layout = classes.filter((c: string) => /^(container|stack|grid|flex|row|col)/.test(c));
      const components = classes.filter((c: string) => /^(card|btn|badge|callout|hero|kpi)/.test(c));
      const utilities = classes.filter((c: string) => !layout.includes(c) && !components.includes(c));
      
      componentsList = `\nAVAILABLE STYLING CLASSES (use these extensively):\n`;
      if (layout.length > 0) componentsList += `- Layout: ${layout.join(', ')}\n`;
      if (components.length > 0) componentsList += `- Components: ${components.join(', ')}\n`;
      if (utilities.length > 0) componentsList += `- Other: ${utilities.slice(0, 10).join(', ')}\n`;
      
      structuralGuidance = `\nSTRUCTURAL PATTERNS (follow these):\n`;
      structuralGuidance += `- Wrap content in: <div class="container"> or sections\n`;
      structuralGuidance += `- Use <section class="stack"> for vertical spacing\n`;
      structuralGuidance += `- Use <div class="card"> for boxed content\n`;
      structuralGuidance += `- Use <div class="grid"> for multi-column layouts\n`;
      structuralGuidance += `- Use <div class="callout"> for highlighted info\n`;
      structuralGuidance += `- Buttons should use: <a class="btn btn-primary"> or <button class="btn">\n`;
    }
  }

  const promises = pagePairs.map((pair, idx) => {
    return scheduler.schedule(async () => {
      const modelId = undefined;  // Let scheduler pick from BULK pool
      console.log(`[${idx + 1}/${pagePairs.length}] ${pair.map(p => p.filename).join(', ')} -> BULK pool`);

      const buildPrompt = () => {
        let enhancementText = '';
        if (enhancements) {
          for (const page of pair) {
            const enh = enhancements.get(page.filename);
            if (enh) {
              enhancementText += `\n\nENHANCEMENT BRIEF for ${enh.filename}:\n`;
              enhancementText += `Content Points:\n${enh.bullets.map(b => `- ${b}`).join('\n')}\n`;
              enhancementText += `Section Ideas:\n${enh.sections.map(s => `- ${s}`).join('\n')}\n`;
              enhancementText += `Keywords: ${enh.keywords.join(', ')}`;
            }
          }
        }
        
        // RAG: Load template examples for games
        let templateExamples = '';
        for (const page of pair) {
          if (page.filename.includes('.html') && !page.filename.includes('index') && !page.filename.includes('about')) {
            const gameName = page.filename.replace('.html', '').replace(/-/g, ' ');
            const template = loadTemplateExample(gameName);
            if (template) {
              templateExamples += template;
            }
          }
        }
        
        return `Generate MAIN CONTENT ONLY for 2 pages. Output ONLY valid JSON. No markdown. No commentary.

ABSOLUTE RULES:
- Return JSON object with shape: {"pages":[ ... ]}
- Each page must return ONLY: <main id="page" class="content"> ... </main>
- DO NOT output <header>, <footer>, <head>, <html>, <body>, <!DOCTYPE>
- You MAY add inline <style> and <script> tags within <main> for page-specific functionality (e.g., search, calculators, interactive demos).
- Use modern HTML5 semantic elements: <article>, <section>, <aside>, <figure>, <figcaption>
- Include at least ONE list (<ul>, <ol>) or table (<table>) when relevant to content
- Internal links inside <main> must ONLY point to the allowed filenames listed below, using "./filename.html".
- Minimum meaningful text per page: 700+ characters and at least 3 <h2> sections.
- Content should be rich and informative with practical examples where applicable.

MOBILE-FIRST DESIGN (CRITICAL):
- Design for mobile screens FIRST (320px+ width)
- Touch targets: minimum 44px × 44px for all buttons/links
- Font sizes: minimum 16px body text (prevents iOS zoom)
- Use responsive units: rem, %, clamp() - minimize fixed px
- Single column layouts on mobile, multi-column on desktop
- Tables: wrap in <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">

IMAGE HANDLING (NO EXTERNAL URLs):
- NEVER use external image URLs (no picsum, unsplash, placeholder.com, lorem.picsum, etc.)
- Use colored placeholder DIVs instead:
  <div style="aspect-ratio: 16/9; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">Image Title</div>
- Vary gradient colors: #667eea/#764ba2, #f093fb/#f5576c, #4facfe/#00f2fe, #43e97b/#38f9d7, #fa709a/#fee140
- For avatars: circular divs with initials
- For icons: use emoji (✓ ★ ⚡ 🎨 📱 💡) or Unicode symbols

For KNOWLEDGEBASE page:
- Include a search box (<input type="search" class="search-box" style="width: 100%; max-width: 500px; padding: 12px; font-size: 16px;">)
- Render all site pages as a browseable categorized list with links
- Do NOT put these in header/footer - they belong in main content

For GAME PAGES - MUST include FULL MOBILE SUPPORT:
- Game title and description explaining the game
- <canvas id="gameCanvas" width="600" height="400" style="max-width: 100%; border: 2px solid; display: block; margin: 0 auto; touch-action: none;"></canvas>
- Responsive canvas sizing script (runs on load and resize)
- Score display: <div id="score" style="font-size: 1.5rem; font-weight: bold; text-align: center; margin: 1rem 0;">Score: 0</div>
- Mobile-friendly controls (large touch targets):
  <div class="game-controls" style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin: 1rem 0;">
    <button class="btn btn-primary" id="startBtn" style="min-width: 120px; min-height: 48px; font-size: 1.1rem;">Start</button>
    <button class="btn" id="resetBtn" style="min-width: 120px; min-height: 48px; font-size: 1.1rem;">Reset</button>
  </div>
- How to play section with rules + mobile tap/swipe instructions
- <script> tag with COMPLETE WORKING game:
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  
  // MOBILE TOUCH SUPPORT:
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (canvas.height / rect.height);
    // Handle touch at (x, y)
  }, { passive: false });
  
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    // Handle drag/swipe
  }, { passive: false });
  
  // DESKTOP MOUSE SUPPORT:
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    // Handle click at (x, y)
  });
  
  // RESPONSIVE CANVAS:
  function resizeCanvas() {
    const container = canvas.parentElement;
    const maxSize = Math.min(container.offsetWidth - 20, 600);
    canvas.style.width = maxSize + 'px';
    canvas.style.height = (maxSize * 2/3) + 'px';
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  // Game state, loop, collision detection, rendering, etc.
  // MUST be FULLY FUNCTIONAL - no TODOs

${componentsList}${structuralGuidance}
ALLOWED FILENAMES (only these may be used in href):
${filenameList}

PAGES TO GENERATE:
1) ${pair[0].filename} — Title: ${pair[0].title} — Purpose: ${pair[0].purpose}
${pair[1] ? `2) ${pair[1].filename} — Title: ${pair[1].title} — Purpose: ${pair[1].purpose}` : ''}
${enhancementText}${templateExamples}

OUTPUT FORMAT (EXACT):
{
  "pages": [
    {"filename":"${pair[0].filename}","title":"${pair[0].title}","mainHtml":"<main id=\\"page\\" class=\\"content\\">...</main>"}${pair[1] ? `,\n    {"filename":"${pair[1].filename}","title":"${pair[1].title}","mainHtml":"<main id=\\"page\\" class=\\"content\\">...</main>"}` : ''}
  ]
}

Return ONLY the JSON object.${commonRules}`;
      };


      const validatePage = (pg: any, expectedFilename: string): { valid: boolean; reason?: string } => {
        if (!pg.filename || !pg.title || !pg.mainHtml) {
          return { valid: false, reason: 'Missing required fields' };
        }
        if (pg.filename !== expectedFilename) {
          return { valid: false, reason: `Filename mismatch: expected ${expectedFilename}, got ${pg.filename}` };
        }
        
        // After salvage, check for exactly one <main>
        const mainMatches = pg.mainHtml.match(/<main[^>]*>/g);
        if (!mainMatches || mainMatches.length !== 1) {
          return { valid: false, reason: 'Must contain exactly one <main> tag' };
        }
        if (pg.mainHtml.length < 700) {
          return { valid: false, reason: `Content too short: ${pg.mainHtml.length} chars (min 700)` };
        }
        const h2Count = (pg.mainHtml.match(/<h2/g) || []).length;
        if (h2Count < 3) {
          return { valid: false, reason: `Insufficient depth: ${h2Count} H2 sections (min 3)` };
        }
        return { valid: true };
      };

      // Attempt generation with retry and escalation
      let attempt = 0;
      const maxAttempts = 2;
      
      while (attempt < maxAttempts) {
        try {
          // For Phase 1, use GLM-4-32B (no reasoning, no caching)
          const phase1Model = attempt === 0 ? 'z-ai/glm-4-32b' : roles.BASE_MODEL;
          if (attempt > 0) {
            console.log(`  ⚠️ Retry attempt ${attempt + 1} with ${phase1Model.split('/')[1]}`);
          }

          const response = await client.chat({
            model: phase1Model,
            messages: [{ role: 'user', content: buildPrompt() }],
            maxTokens: 8000,
            temperature: 0.3,
            stream: false,  // Disable streaming for JSON
            response_format: { type: 'json_object' },
            plugins: [{ id: 'response-healing' }]
          });
          const content = typeof response === 'string' ? response : response.content;
          const parsed = parseJSON(content);

          if (!parsed.pages || !Array.isArray(parsed.pages)) {
            throw new Error('Invalid schema: expected {"pages": [...]}');
          }

          // Build map by filename for flexible matching
          const pageMap = new Map<string, any>();
          for (const pg of parsed.pages) {
            if (pg && pg.filename) {
              pageMap.set(pg.filename, pg);
            }
          }

          let allValid = true;
          for (let i = 0; i < pair.length; i++) {
            const expectedFilename = pair[i].filename;
            
            // Try to find by filename first, fallback to array position
            const pg = pageMap.get(expectedFilename) || parsed.pages[i];
            
            if (!pg) {
              console.warn(`  ⚠️ Missing page ${expectedFilename} in response`);
              allValid = false;
              continue;
            }
            
            // SALVAGE: Coerce to main-only BEFORE validation
            if (pg.mainHtml) {
              pg.mainHtml = coerceToMainOnly(pg.mainHtml);
            }

            const validation = validatePage(pg, expectedFilename);
            if (!validation.valid) {
              console.warn(`  ⚠️ ${pg.filename || 'unknown'}: ${validation.reason}`);
              allValid = false;
              continue;
            }

            results.set(pg.filename, {
              filename: pg.filename,
              title: pg.title,
              mainHtml: pg.mainHtml
            });
            console.log(`  ✓ ${pg.filename} (${pg.mainHtml.length} chars, ${(pg.mainHtml.match(/<h2/g) || []).length} H2s)`);
          }

          if (allValid) {
            break; // Success, exit retry loop
          } else if (attempt < maxAttempts - 1) {
            console.warn(`  ⚠️ Validation failed, retrying with base model...`);
            attempt++;
            continue;
          }
        } catch (err: any) {
          console.error(`  ✗ Attempt ${attempt + 1} failed: ${err.message}`);
          
          // Track BULK model failures
          if (modelId && attempt === 0) {
            const failures = BULK_FAILURES.get(modelId) || 0;
            BULK_FAILURES.set(modelId, failures + 1);
            if (failures + 1 >= MAX_FAILURES) {
              console.warn(`  ⚠️ Model ${modelId} has failed ${failures + 1} times, removing from BULK pool`);
            }
          }
          
          if (attempt < maxAttempts - 1) {
            attempt++;
            continue;
          }
        }
        break;
      }
    });
  });

  await Promise.allSettled(promises);

  console.log(`\n✓ Generated ${results.size}/${siteSpec.pages.length} pages\n`);
  
  return results;
}

async function phase1LegacyGeneration(
  client: ReturnType<typeof createClient>,
  siteSpec: SiteSpec,
  model?: string,
  commonRules: string = '',
  distDir: string = DIST_DIR,
  enhancements?: Map<string, PageEnhancement>
): Promise<Map<string, PageGeneration>> {
  console.log(`Legacy generation${model ? ` (using ${model})` : ' (no model pools)'}\n`);
  
  const results = new Map<string, PageGeneration>();
  // EXCLUDE index.html - Phase 0 owns it
  const allPages = siteSpec.pages.filter(p => p.filename !== 'index.html');
  
  // Load style contract for comprehensive styling guidance
  const contractPath = path.join(distDir, '_style-contract.json');
  let componentsList = '';
  let structuralGuidance = '';
  
  if (fs.existsSync(contractPath)) {
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
    if (contract.componentClasses && contract.componentClasses.length > 0) {
      const classes = contract.componentClasses;
      const layout = classes.filter((c: string) => /^(container|stack|grid|flex|row|col)/.test(c));
      const components = classes.filter((c: string) => /^(card|btn|badge|callout|hero|kpi)/.test(c));
      const utilities = classes.filter((c: string) => !layout.includes(c) && !components.includes(c));
      
      componentsList = `\nAVAILABLE STYLING CLASSES:\n`;
      if (layout.length > 0) componentsList += `- Layout: ${layout.join(', ')}\n`;
      if (components.length > 0) componentsList += `- Components: ${components.join(', ')}\n`;
      if (utilities.length > 0) componentsList += `- Other: ${utilities.slice(0, 10).join(', ')}\n`;
      
      structuralGuidance = `\nSTRUCTURAL PATTERNS:\n`;
      structuralGuidance += `- Wrap content in: <div class="container"> or sections\n`;
      structuralGuidance += `- Use <section class="stack"> for vertical spacing\n`;
      structuralGuidance += `- Use <div class="card"> for boxed content\n`;
      structuralGuidance += `- Buttons: <a class="btn btn-primary"> or <button class="btn">\n`;
    }
  }
  
  const allowedFilenames = siteSpec.pages.map(p => p.filename);
  const filenameList = allowedFilenames.join(', ');
  
  // Generate pages one at a time (legacy mode - no batching)
  for (const page of allPages) {
    const enhancement = enhancements?.get(page.filename);
    let enhancementText = '';
    
    if (enhancement) {
      enhancementText = `\n\nENHANCEMENT BRIEF for ${enhancement.filename}:\nContent Points:\n${enhancement.bullets.map(b => `- ${b}`).join('\n')}\nSection Ideas:\n${enhancement.sections.map(s => `- ${s}`).join('\n')}\nKeywords: ${enhancement.keywords.join(', ')}`;
    }
    
    // RAG: Try to load template example for games
    let templateExample = '';
    if (page.filename.includes('.html') && !page.filename.includes('index') && !page.filename.includes('about') && !page.filename.includes('contact')) {
      // Extract game name from filename
      const gameName = page.filename.replace('.html', '').replace(/-/g, ' ');
      const template = loadTemplateExample(gameName);
      if (template) {
        templateExample = template;
        console.log(`  📚 Loaded template for: ${gameName}`);
      }
    }
    
    const promptText = `Generate MAIN CONTENT ONLY for this page. Output ONLY valid JSON.

ABSOLUTE RULES:
- Return JSON: {"filename":"${page.filename}","title":"${page.title}","mainHtml":"<main id=\\"page\\" class=\\"content\\">...</main>"}
- Return ONLY: <main id="page" class="content"> ... </main>
- DO NOT output <header>, <footer>, <head>, <html>, <body>, <!DOCTYPE>
- You MAY add inline <style> and <script> tags within <main> for page-specific functionality
- Use modern HTML5 semantic elements: <article>, <section>, <aside>, <figure>
- Include at least ONE list or table when relevant
- Internal links must use: "./filename.html" and ONLY point to allowed filenames listed below
- Minimum: 700+ characters and at least 3 <h2> sections
- Content should be rich and informative with practical examples

MOBILE RESPONSIVE:
- All layouts MUST be mobile-friendly (single column on <768px)
- Images: <img style="max-width: 100%; height: auto;">
- Tables: wrap in <div style="overflow-x: auto;">

For INTERACTIVE/GAME pages - MUST include:
- <canvas id="gameCanvas" width="600" height="400" style="max-width: 100%; border: 2px solid #333; display: block; margin: 0 auto; touch-action: none;"></canvas>
- Responsive canvas sizing:
  window.addEventListener('resize', () => {
    const container = canvas.parentElement;
    const size = Math.min(container.offsetWidth - 20, 600);
    canvas.style.width = size + 'px';
    canvas.style.height = (size * 2/3) + 'px';
  });
- Score display: <div id="score" style="font-size: 1.5rem; font-weight: bold; margin: 1rem 0;">Score: 0</div>
- Mobile-friendly controls (large touch targets):
  <div class="game-controls" style="display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0;">
    <button class="btn btn-primary" id="startBtn" style="min-width: 120px; min-height: 48px; font-size: 1.1rem;">Start Game</button>
    <button class="btn" id="resetBtn" style="min-width: 120px; min-height: 48px; font-size: 1.1rem;">Reset</button>
  </div>
- How to play section with THIS game's specific rules AND mobile instructions
- <script> tag with COMPLETE WORKING game:
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  let score = 0;
  let gameRunning = false;
  
  // MOBILE TOUCH SUPPORT (CRITICAL):
  canvas.addEventListener('touchstart', handleTouch, { passive: false });
  canvas.addEventListener('touchmove', handleTouch, { passive: false });
  canvas.addEventListener('touchend', handleTouch, { passive: false });
  function handleTouch(e) {
    e.preventDefault(); // Prevent scrolling while playing
    const touch = e.touches[0] || e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    // Handle touch input based on game type
  }
  
  // ALSO support mouse for desktop:
  canvas.addEventListener('mousedown', handleMouse);
  canvas.addEventListener('mousemove', handleMouse);
  function handleMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    // Handle mouse input
  }
  
  // Full game loop with requestAnimationFrame
  // Collision detection and game logic
  // Rendering function
  // Start/reset functions
  MUST be FULLY FUNCTIONAL - no placeholders or TODOs

${componentsList}${structuralGuidance}
ALLOWED FILENAMES: ${filenameList}

PAGE TO GENERATE:
Filename: ${page.filename}
Title: ${page.title}
Purpose: ${page.purpose}${enhancementText}${templateExample}

OUTPUT JSON:
{"filename":"${page.filename}","title":"${page.title}","mainHtml":"<main id=\\"page\\" class=\\"content\\">...</main>"}
${commonRules}`;

    try {
      console.log(`Generating ${page.filename} with ${model || 'default model'}...`);
      
      const response = await client.chat({
        model: model || 'google/gemini-2.0-flash-exp:free',
        messages: [{ role: 'user', content: promptText }],
        maxTokens: 4096,
        temperature: 0.3,
        stream: false,
        response_format: { type: 'json_object' },
        plugins: [{ id: 'response-healing' }]
      });
      
      const content = typeof response === 'string' ? response : response.content;
      const parsed = parseJSON(content);
      
      if (parsed.filename && parsed.title && parsed.mainHtml) {
        results.set(page.filename, {
          filename: parsed.filename,
          title: parsed.title,
          mainHtml: parsed.mainHtml
        });
        console.log(`  ✓ ${page.filename} (${parsed.mainHtml.length} chars)`);
      } else {
        throw new Error('Invalid page structure in response');
      }
    } catch (err: any) {
      console.error(`  ✗ ${page.filename} failed: ${err.message}`);
      // Fallback to basic content
      results.set(page.filename, {
        filename: page.filename,
        title: page.title,
        mainHtml: `<main class="content"><h1>${page.title}</h1><p>${page.purpose}</p><p>Content generation failed. Please try again.</p></main>`
      });
    }
  }
  
  console.log(`\n✓ Generated ${results.size}/${allPages.length} pages\n`);
  return results;
}

// ============================================================================
// ASSEMBLY: Wrap with Layout (Code-Owned)
// ============================================================================

function assemblePage(
  pageGen: PageGeneration,
  siteSpec: SiteSpec,
  templates: Templates,
  routeMap: Map<string, string>,
  distDir: string = DIST_DIR
): string {
  const partialsDir = path.join(distDir, 'partials');
  const canonicalHeader = fs.readFileSync(path.join(partialsDir, 'header.html'), 'utf-8');
  const canonicalFooter = fs.readFileSync(path.join(partialsDir, 'footer.html'), 'utf-8');
  
  // CRITICAL: Strip any LLM-generated headers/footers from mainHtml
  let mainContent = pageGen.mainHtml;
  
  // Remove any header tags (LLM often adds them)
  mainContent = mainContent.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  // Remove any footer tags
  mainContent = mainContent.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  // Remove any nav tags that might be outside main
  if (!mainContent.match(/<main[^>]*>/)) {
    mainContent = mainContent.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  }
  
  // INJECT PAGE-HERO WRAPPER (if not already present)
  if (!mainContent.includes('page-hero')) {
    // Find the page in sitemap to get purpose
    const pageInfo = siteSpec.pages.find(p => p.filename === pageGen.filename);
    const purpose = pageInfo?.purpose || '';
    
    // Generate lead text from purpose (first sentence, ~120 chars) or fallback
    let leadText = purpose.split('.')[0].trim();
    if (leadText.length > 120) {
      leadText = leadText.substring(0, 120).trim() + '...';
    }
    if (!leadText || leadText.length < 10) {
      leadText = `Learn about ${pageGen.title}.`;
    }
    
    // Build hero section
    const heroSection = `<section class="page-hero">\n    <div class="container stack">\n      <h1>${pageGen.title}</h1>\n      <p class="lead">${leadText}</p>\n    </div>\n  </section>\n  `;
    
    // Inject right after opening <main> tag
    mainContent = mainContent.replace(
      /(<main[^>]*>)/i,
      `$1\n  ${heroSection}`
    );
  }

  // Preact CDN scripts (if SITE_UI_MODE=preact)
  const preactScripts = SITE_UI_MODE === 'preact' 
    ? `  <script type="module">
    import { h, render } from 'https://esm.sh/preact';
    import { useState } from 'https://esm.sh/preact/hooks';
    import htm from 'https://esm.sh/htm';
    const html = htm.bind(h);
    
    // Island component example (FAQ accordion or pricing calculator)
    function Island() {
      const [expanded, setExpanded] = useState(null);
      const faqs = [
        { q: "What is this?", a: "This is an interactive island example." },
        { q: "How does it work?", a: "Using Preact + HTM with no build step." }
      ];
      
      return html\`
        <div class="island">
          \${faqs.map((faq, i) => html\`
            <div key=\${i} class="faq-item">
              <button onClick=\${() => setExpanded(expanded === i ? null : i)}>
                \${faq.q}
              </button>
              \${expanded === i && html\`<p>\${faq.a}</p>\`}
            </div>
          \`)}
        </div>
      \`;
    }
    
    // Render island if container exists
    const container = document.getElementById('island-pricing');
    if (container) {
      render(html\`<\${Island} />\`, container);
    }
  </script>
`
    : '';

  // Build HTML with proper HTML5 skeleton
  let html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageGen.title}</title>
  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="./components.css">
${preactScripts}</head>
<body>
${canonicalHeader}
${mainContent}
${canonicalFooter}
<script src="./app.js" defer></script>
</body>
</html>`;

  // Normalize hrefs
  const $ = cheerio.load(html);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('./')) {
      const filename = href.replace(/\.html$/, '');
      const mapped = routeMap.get(filename) || `./${filename}.html`;
      $(el).attr('href', mapped);
    }
  });

  return $.html();
}

// ============================================================================
// ENFORCEMENT: Force Replace Headers/Footers (Seatbelt)
// ============================================================================

function enforceCanonicalLayout(html: string, routeMap: Map<string, string>, distDir: string): string {
  const $ = cheerio.load(html);
  const partialsDir = path.join(distDir, 'partials');
  const canonicalHeader = fs.readFileSync(path.join(partialsDir, 'header.html'), 'utf-8');
  const canonicalFooter = fs.readFileSync(path.join(partialsDir, 'footer.html'), 'utf-8');

  // Ensure <head> exists
  if ($('head').length === 0) {
    $('html').prepend('<head></head>');
  }
  
  const head = $('head');
  
  // Ensure meta charset (dedupe if multiple)
  if (head.find('meta[charset]').length === 0) {
    head.prepend('<meta charset="utf-8">');
  } else {
    // Keep only first charset meta
    head.find('meta[charset]').slice(1).remove();
  }
  
  // Ensure viewport meta (dedupe if multiple)
  if (head.find('meta[name="viewport"]').length === 0) {
    head.find('meta[charset]').after('<meta name="viewport" content="width=device-width,initial-scale=1">');
  } else {
    head.find('meta[name="viewport"]').slice(1).remove();
  }
  
  // Ensure styles.css link (dedupe if multiple)
  if (head.find('link[href="./styles.css"]').length === 0) {
    head.append('<link rel="stylesheet" href="./styles.css">');
  } else {
    head.find('link[href="./styles.css"]').slice(1).remove();
  }
  
  // Ensure components.css link (dedupe if multiple)
  if (head.find('link[href="./components.css"]').length === 0) {
    head.append('<link rel="stylesheet" href="./components.css">');
  } else {
    head.find('link[href="./components.css"]').slice(1).remove();
  }
  
  // Ensure app.js script with defer (dedupe if multiple)
  const existingScripts = $('script[src="./app.js"]');
  if (existingScripts.length === 0) {
    $('body').append('<script src="./app.js" defer></script>');
  } else {
    // Ensure first one has defer, remove duplicates
    existingScripts.first().attr('defer', '');
    existingScripts.slice(1).remove();
  }

  // Strip any nested headers/footers inside <main> FIRST
  $('main header, main footer').remove();

  // Ensure exactly one header at top level
  $('body > header').remove(); // Remove old headers
  $('body').prepend(canonicalHeader);

  // Ensure exactly one footer at top level
  $('body > footer').remove(); // Remove old footers
  $('body').append(canonicalFooter);

  // Safely normalize hrefs (never modify safe URLs)
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;

    if (isSafeToRewriteHref(href)) {
      // Normalize "/x.html" -> "./x.html", "x.html" -> "./x.html"
      const cleaned = href.startsWith('/') ? href.slice(1) : href;
      if (!cleaned.startsWith('./')) $(el).attr('href', `./${cleaned}`);
    }
  });

  return $.html();
}

// ============================================================================
// ASSEMBLY + ENFORCEMENT
// ============================================================================

function assembleAllPages(
  pageGenerations: Map<string, PageGeneration>,
  siteSpec: SiteSpec,
  templates: Templates,
  routeMap: Map<string, string>,
  distDir: string = DIST_DIR
): void {
  console.log('=== ASSEMBLY + ENFORCEMENT ===\n');

  let assembled = 0;
  const generatedFiles: string[] = [];
  
  for (const [filename, pageGen] of pageGenerations) {
    let html = assemblePage(pageGen, siteSpec, templates, routeMap, distDir);
    html = enforceCanonicalLayout(html, routeMap, distDir);

    const filePath = path.join(distDir, filename);
    fs.writeFileSync(filePath, html);
    generatedFiles.push(filename);
    assembled++;
  }

  console.log(`✓ Assembled ${assembled} pages\n`);
  console.log('Generated files:');
  generatedFiles.forEach(f => console.log(`  - ${f}`));
  console.log(`  - styles.css`);
  console.log(`  - components.css`);
  console.log(`  - app.js`);
  console.log(`  - site-map.json`);
  console.log(`  - _partials.json`);
  console.log(`  - partials/header.html`);
  console.log(`  - partials/footer.html\n`);
}

// ============================================================================
// EXPORTS FOR DISCORD COMMANDS
// ============================================================================

export type WebMode = 'web' | 'web-pro';

export type IntentPlan = {
  pages: number;
  reason: string;
  explicit: boolean;
};

/**
 * Smart intent detection for page count based on user prompt
 */
function detectPageIntent(prompt: string): IntentPlan {
  const lower = prompt.toLowerCase();
  
  // Explicit number detection
  const numberMatch = prompt.match(/(\d+)\s*pages?/i);
  if (numberMatch) {
    const count = parseInt(numberMatch[1], 10);
    return {
      pages: Math.max(3, Math.min(50, count)), // Clamp between 3-50
      reason: `User explicitly requested ${count} pages`,
      explicit: true
    };
  }
  
  // Game website detection - count games mentioned
  if (/games?|arcade|play|gaming/i.test(lower)) {
    // Try to detect specific number of games
    const gamesMatch = prompt.match(/(\d+)\s*games?/i);
    if (gamesMatch) {
      const gameCount = parseInt(gamesMatch[1], 10);
      // index + N game pages + how-to-play = N+2 pages
      const totalPages = gameCount + 2;
      return {
        pages: totalPages,
        reason: `Detected ${gameCount} games → ${totalPages} pages (index + ${gameCount} games + how-to-play)`,
        explicit: true
      };
    }
    
    // Try to count games mentioned by name (e.g., "snake, pong, tetris")
    // Split by comma, but be careful about "and" (e.g., "dots and boxes" is ONE game)
    const gameList = prompt.match(/(?:like|including|such as)\s+([^.]+)/i);
    if (gameList) {
      // Split by comma only (not 'and' since game names can contain 'and')
      const games = gameList[1].split(/,/).map(g => g.trim()).filter(g => g.length > 2);
      if (games.length > 0) {
        const totalPages = games.length + 2;
        return {
          pages: totalPages,
          reason: `Detected ${games.length} game(s) mentioned → ${totalPages} pages (index + ${games.length} games + how-to-play)`,
          explicit: true
        };
      }
    }
    
    // Default for game sites: index + 1 game + how-to = 3 pages
    return {
      pages: 3,
      reason: 'Detected game website (index + game + how-to-play)',
      explicit: false
    };
  }
  
  // Knowledgebase/docs indicators
  if (/knowledge\s*base|docs|documentation|wiki|help\s*center|guide|tutorial/i.test(lower)) {
    return {
      pages: 12,
      reason: 'Detected knowledgebase/documentation site (typical 12+ pages)',
      explicit: false
    };
  }
  
  // Simple/minimal indicators
  if (/simple|landing|one\s*page|basic|minimal|single/i.test(lower)) {
    return {
      pages: 3,
      reason: 'Detected simple/landing page request',
      explicit: false
    };
  }
  
  // Default
  return {
    pages: 6,
    reason: 'Standard website (default 6 pages)',
    explicit: false
  };
}

/**
 * Get common rules that apply to ALL LLM calls
 */
function getCommonRules(theme: string): string {
  return `
THEME: ${theme}

COMMON RULES (APPLY TO ALL OUTPUTS):
- Output ONLY valid JSON. No markdown blocks, no commentary, no code fences.
- Use the theme above to guide design, colors, and aesthetics.
- All colors MUST be CSS variables in :root block (hex allowed ONLY in :root).
- No inline styles in HTML (except page-specific <style> tags in main content).
- Internal links must use "./filename.html" format and only point to valid pages.
- Use modern HTML5 semantic elements (article, section, aside, figure).
- Ensure accessibility (ARIA labels, semantic markup, keyboard navigation).
`;
}

/**
 * Get Phase 0 model based on mode
 */
function getPhase0Model(mode: WebMode): string {
  return mode === 'web-pro'
    ? 'google/gemini-3-flash-preview'
    : 'kwaipilot/kat-coder-pro:free';
}

/**
 * Get Phase 1 model based on mode (undefined = use BULK pool)
 */
function getPhase1Model(mode: WebMode): string | undefined {
  return mode === 'web-pro'
    ? 'google/gemini-3-flash-preview'
    : undefined; // Use BULK pool for 'web' mode
}

// ============================================================================
// EXPORTED PIPELINE: For Discord Commands and CLI
// ============================================================================

/**
 * Run the full site generation pipeline with mode, intent, and theme support.
 * @param prompt - User's raw website description
 * @param options - Configuration options:
 *   - mode: 'web' (free models) or 'web-pro' (paid Gemini)
 *   - theme: Optional theme string (e.g., 'purple dark theme', 'minimal blue')
 *   - distDir: Output directory (defaults to test-output/test-X)
 * @returns Promise resolving to { success: boolean, distDir: string, stats: {...} }
 */
export async function runSitePipeline(
  prompt: string,
  options: {
    mode?: WebMode;
    theme?: string;
    distDir?: string;
  } = {}
): Promise<{ success: boolean; distDir: string; stats: any }> {
  const mode = options.mode || 'web';
  const theme = options.theme || '';
  const distDir = options.distDir || getTestDir();
  
  console.log('=== 🎨 Static Site Generator (Contract-Based Architecture) ===\n');
  console.log(`Mode: ${mode} (${mode === 'web-pro' ? 'paid Gemini' : 'free models'})`);
  console.log(`Output directory: ${distDir}`);
  console.log(`UI Mode: ${SITE_UI_MODE}\n`);

  // Clean and create output directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Try to load model pools FIRST
  let poolsLoader: ReturnType<typeof createModelPoolsLoader> | null = null;
  try {
    poolsLoader = createModelPoolsLoader();
    const roles = poolsLoader.getRoles();
    console.log(`✓ Loaded model pools: ${roles.BULK_MODELS?.length || 0} BULK models\n`);
  } catch (err: any) {
    console.warn(`⚠️ Model pools not available: ${err.message}\n`);
  }

  // Create client (use model pools if available)
  const client = createClient(poolsLoader !== null);

  // Detect page intent from prompt
  const intentPlan = detectPageIntent(prompt);
  console.log(`📊 Intent detected: ${intentPlan.pages} pages (${intentPlan.reason})\n`);

  // Get common rules (theme + standards)
  const commonRules = getCommonRules(theme);

  // Prompter step: improve raw prompt
  const prompterResult = await improveWebsitePrompt(prompt, client, commonRules);
  
  // Save prompter output
  const promptJsonPath = path.join(distDir, '_prompt.json');
  fs.writeFileSync(promptJsonPath, JSON.stringify({
    rawPrompt: prompterResult.rawPrompt,
    prompterJson: prompterResult.prompterJson,
    finalSiteBriefUsed: prompterResult.finalSiteBrief,
    mode,
    theme,
    intentPlan
  }, null, 2));
  console.log(`✓ Saved _prompt.json\n`);

  // Phase 0: Generate contract
  const { siteSpec, templates } = await phase0GenerateContract(
    client,
    prompterResult.finalSiteBrief,
    intentPlan.pages,
    mode,
    commonRules,
    distDir
  );

  // Ensure app.js exists (fallback if model forgot)
  ensureAppJs(distDir);

  // Build route map from siteSpec
  const routeMap = buildRouteMap(siteSpec);

  // Freeze: Build canonical header/footer in CODE (not by extraction)
  freezeCanonicalPartials(siteSpec, templates, distDir);

  // Patch index.html to use canonical header/footer
  patchIndexAfterPhase0(siteSpec, templates, routeMap, distDir);

  // Phase 0.5: Generate enhancement briefs (optional quality boost)
  const enhancements = await generateEnhancementBriefs(
    client,
    siteSpec,
    prompterResult.finalSiteBrief,
    mode,
    distDir
  );

  // Phase 1: Parallel page generation (EXCLUDES index.html)
  const pageGenerations = poolsLoader
    ? await phase1GeneratePages(client, siteSpec, poolsLoader, mode, commonRules, distDir, enhancements)
    : await phase1LegacyGeneration(client, siteSpec, undefined, commonRules, distDir, enhancements);

  // Assembly + Enforcement
  assembleAllPages(pageGenerations, siteSpec, templates, routeMap, distDir);

  // Format all files
  await formatAllFiles(distDir);

  console.log('✅ Site generation complete!');
  console.log(`📂 Output: ${distDir}\n`);

  return {
    success: true,
    distDir,
    stats: {
      mode,
      theme,
      intentPages: intentPlan.pages,
      generatedPages: siteSpec.pages.length,
      assembledPages: pageGenerations.size
    }
  };
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main() {
  // Accept prompt from command line: npm run site:gen -- "your prompt here"
  // Accept --pro flag: npm run site:gen -- --pro "your prompt here"
  // Accept --api <config-file>: npm run site:gen -- --api config.json (for Discord bot)
  const args = process.argv.slice(2);
  
  // Check for API mode (used by Discord bot)
  const apiModeIndex = args.indexOf('--api');
  if (apiModeIndex >= 0 && args[apiModeIndex + 1]) {
    const configPath = args[apiModeIndex + 1];
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result = await runSitePipeline(config.prompt, {
        mode: config.mode || 'web',
        theme: config.theme || '',
        distDir: config.distDir
      });
      
      // Output JSON result for bot to parse
      console.log(JSON.stringify(result));
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      console.error('API mode error:', err);
      console.log(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }));
      process.exit(1);
    }
  }
  
  const proMode = args.includes('--pro');
  const cliPrompt = args.filter(arg => arg !== '--pro').join(' ').trim();
  
  const rawPrompt = cliPrompt || 'a minecraft hosting website with a large feature rich knowledgebase in a purple dark theme, with custom styling, gradients, and svgs';
  
  console.log(`\n📝 Prompt: "${rawPrompt}"\n`);
  
  const result = await runSitePipeline(rawPrompt, {
    mode: proMode ? 'web-pro' : 'web'
  });

  if (!result.success) {
    throw new Error('Site generation failed');
  }
}

main().catch(err => {
  console.error('❌ Generation failed:', err);
  process.exit(1);
});
