import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as cheerio from 'cheerio';

// Get latest test directory or accept CLI argument
function getLatestTestDir(): string {
  const testsDir = path.join(__dirname, '../test-output');
  if (!fs.existsSync(testsDir)) {
    throw new Error('test-output directory not found');
  }
  
  const existing = fs.readdirSync(testsDir).filter(d => d.startsWith('test-'));
  const numbers = existing.map(d => parseInt(d.split('-')[1])).filter(n => !isNaN(n));
  if (numbers.length === 0) {
    throw new Error('No test directories found');
  }
  
  const latestNum = Math.max(...numbers);
  return path.join(testsDir, `test-${latestNum}`);
}

// Allow CLI override: npm run site:validate -- test-5
const cliArg = process.argv[2];
const DIST_DIR = cliArg 
  ? path.join(__dirname, '../test-output', cliArg)
  : getLatestTestDir();

console.log(`Validating: ${DIST_DIR}\n`);

interface SiteMap {
  pages: Array<{ id: string; filename: string; title: string }>;
  navOrder: string[];
}

interface FrozenPartials {
  canonicalHeader: string;
  canonicalFooter: string;
  canonicalHeadIncludes: string;
}

function fail(message: string): never {
  console.error(`✗ Validation failed: ${message}`);
  process.exit(1);
}

function extractPartial(html: string, tag: 'header' | 'footer'): string {
  if (tag === 'header') {
    // Match first header (site header)
    const regex = /<header[\s\S]*?<\/header>/i;
    const match = html.match(regex);
    return match ? match[0].trim() : '';
  } else {
    // Match LAST footer (site footer, not article footer)
    const regex = /<footer[\s\S]*?<\/footer>/gi;
    const matches = html.match(regex);
    return matches && matches.length > 0 ? matches[matches.length - 1].trim() : '';
  }
}

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

function hashString(str: string): string {
  return crypto.createHash('md5').update(normalizeHtml(str)).digest('hex');
}

function validateSiteMapExists() {
  console.log('Checking site-map.json exists...');
  const siteMapPath = path.join(DIST_DIR, 'site-map.json');
  if (!fs.existsSync(siteMapPath)) {
    fail('site-map.json not found');
  }
  return JSON.parse(fs.readFileSync(siteMapPath, 'utf-8')) as SiteMap;
}

function validatePartialsExist() {
  console.log('Checking _partials.json exists...');
  const partialsPath = path.join(DIST_DIR, '_partials.json');
  if (!fs.existsSync(partialsPath)) {
    fail('_partials.json not found');
  }
  return JSON.parse(fs.readFileSync(partialsPath, 'utf-8')) as FrozenPartials;
}

function validateAllPagesExist(siteMap: SiteMap) {
  console.log(`Checking all ${siteMap.pages.length} pages exist...`);
  
  for (const page of siteMap.pages) {
    const filepath = path.join(DIST_DIR, page.filename);
    if (!fs.existsSync(filepath)) {
      fail(`Page ${page.filename} listed in site-map.json but not found in dist/`);
    }
  }
  
  console.log('  ✓ All pages exist');
}

function validateNavLinks(siteMap: SiteMap) {
  console.log('Checking navigation links...');
  
  const validFilenames = new Set(siteMap.pages.map(p => p.filename));
  
  for (const page of siteMap.pages) {
    const filepath = path.join(DIST_DIR, page.filename);
    const html = fs.readFileSync(filepath, 'utf-8');
    
    // Extract header section only for nav validation
    const headerMatch = html.match(/<header[\s\S]*?<\/header>/i);
    if (!headerMatch) {
      fail(`${page.filename} missing <header> element`);
    }
    
    const headerHtml = headerMatch[0];
    
    // Extract hrefs from header
    const hrefMatches = headerHtml.matchAll(/href=["'](.+?)["']/g);
    
    for (const match of hrefMatches) {
      const href = match[1];
      
      // Skip external links and anchors
      if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
        continue;
      }
      
      // Extract filename from relative path
      const filename = href.replace(/^\.\//, '');
      
      if (filename.endsWith('.html') && !validFilenames.has(filename)) {
        fail(`Invalid nav link in ${page.filename}: "${href}" points to non-existent ${filename}`);
      }
    }
  }
  
  console.log('  ✓ All navigation links valid');
}

function validateHeaderFooterConsistency(siteMap: SiteMap, frozenPartials: FrozenPartials) {
  console.log('Checking header/footer consistency against frozen partials...');
  
  const canonicalHeaderHash = hashString(frozenPartials.canonicalHeader);
  const canonicalFooterHash = hashString(frozenPartials.canonicalFooter);
  
  console.log(`  Canonical header hash: ${canonicalHeaderHash}`);
  console.log(`  Canonical footer hash: ${canonicalFooterHash}`);
  
  for (const page of siteMap.pages) {
    const filepath = path.join(DIST_DIR, page.filename);
    const html = fs.readFileSync(filepath, 'utf-8');
    const $ = cheerio.load(html);
    
    // Check layout invariants
    const topLevelHeaders = $('body > header');
    const topLevelFooters = $('body > footer');
    const mains = $('main#page');
    
    if (topLevelHeaders.length !== 1) {
      fail(`${page.filename} must have exactly one <header> at body top level (found ${topLevelHeaders.length})`);
    }
    
    if (topLevelFooters.length !== 1) {
      fail(`${page.filename} must have exactly one <footer> at body top level (found ${topLevelFooters.length})`);
    }
    
    if (mains.length !== 1) {
      fail(`${page.filename} must have exactly one <main id="page"> (found ${mains.length})`);
    }
    
    // Check no header/footer inside main
    const nestedHeaders = mains.find('header');
    const nestedFooters = mains.find('footer');
    if (nestedHeaders.length > 0) {
      fail(`${page.filename} has <header> inside <main> (forbidden)`);
    }
    if (nestedFooters.length > 0) {
      fail(`${page.filename} has <footer> inside <main> (forbidden)`);
    }
    
    const pageHeader = topLevelHeaders.first().toString();
    const pageFooter = topLevelFooters.first().toString();
    
    const pageHeaderHash = hashString(pageHeader);
    const pageFooterHash = hashString(pageFooter);
    
    if (pageHeaderHash !== canonicalHeaderHash) {
      fail(`${page.filename} header mismatch (hash: ${pageHeaderHash}, expected: ${canonicalHeaderHash}`);
    }
    
    if (pageFooterHash !== canonicalFooterHash) {
      fail(`${page.filename} footer mismatch (hash: ${pageFooterHash}, expected: ${canonicalFooterHash}`);
    }
  }
  
  console.log('  ✓ All headers/footers match canonical');
}

function validateSharedAssets(siteMap: SiteMap) {
  console.log('Checking shared asset references...');
  
  const requiredAssets = [
    { name: 'styles.css', pattern: /\.?\/styles\.css/ },
    { name: 'components.css', pattern: /\.?\/components\.css/ },
    { name: 'app.js', pattern: /\.?\/app\.js/ }
  ];
  
  for (const page of siteMap.pages) {
    const filepath = path.join(DIST_DIR, page.filename);
    const html = fs.readFileSync(filepath, 'utf-8');
    
    for (const asset of requiredAssets) {
      if (!asset.pattern.test(html)) {
        fail(`${page.filename} missing reference to ${asset.name}`);
      }
    }
    
    // Validate app.js has defer attribute (best practice)
    if (html.includes('src="./app.js"') || html.includes("src='./app.js'")) {
      if (!html.match(/<script[^>]*src=["']\.\/app\.js["'][^>]*defer/)) {
        console.warn(`  ⚠️ ${page.filename}: app.js should have defer attribute`);
      }
    }
  }
  
  console.log('  ✓ All pages reference shared assets');
}

function validateHeadIncludes(siteMap: SiteMap) {
  console.log('Checking head includes...');
  
  for (const page of siteMap.pages) {
    const filepath = path.join(DIST_DIR, page.filename);
    const html = fs.readFileSync(filepath, 'utf-8');
    
    // Check for essential meta tags
    if (!html.includes('charset=')) {
      fail(`${page.filename} missing charset meta tag`);
    }
    
    // Check for page-hero section (required on all pages for consistent polish)
    if (!html.includes('page-hero')) {
      fail(`${page.filename} missing .page-hero section - required for consistent page layout`);
    }
    
    if (!html.includes('viewport')) {
      fail(`${page.filename} missing viewport meta tag`);
    }
    
    // Check for unreplaced placeholders (especially in index.html)
    if (html.includes('<!--NAV_ITEMS-->') || html.includes('{{NAV_ITEMS}}')) {
      fail(`${page.filename} contains unreplaced NAV_ITEMS placeholder`);
    }
    if (html.includes('<!--FOOTER_LINKS-->') || html.includes('{{FOOTER_LINKS}}')) {
      fail(`${page.filename} contains unreplaced FOOTER_LINKS placeholder`);
    }
  }
  
  console.log('  ✓ All pages have essential head includes');
}

function main() {
  console.log('=== Site Validation ===\n');
  
  if (!fs.existsSync(DIST_DIR)) {
    fail('dist/ directory not found. Run site:gen first.');
  }
  
  const siteMap = validateSiteMapExists();
  const frozenPartials = validatePartialsExist();
  
  validateAllPagesExist(siteMap);
  validateNavLinks(siteMap);
  validateHeaderFooterConsistency(siteMap, frozenPartials);
  validateSharedAssets(siteMap);
  validateHeadIncludes(siteMap);
  
  console.log('\n✓ All validation checks passed!');
}

main();
