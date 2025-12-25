# Site Generator Updates - v2.0

## Overview
Major update to the static site generation pipeline with improved formatting, modern HTML5 support, and optional React-like enhancements.

## Key Changes

### 1. Iterative Output Folders
- **Old**: `tests-output/test-N`
- **New**: `test-output/test-*` (auto-incrementing)
- Each run creates a new numbered folder for easy review
- Example: `test-output/test-1`, `test-output/test-2`, etc.

### 2. Prettier Formatting
- All HTML, CSS, and JS files are automatically formatted
- Consistent indentation and spacing
- Makes diffs between test runs easier to review
- Configuration:
  - Print width: 100
  - Tab width: 2 spaces
  - No semicolons (except JS)
  - Single quotes

### 3. Guaranteed app.js
- app.js is always generated and included
- If Phase 0 model forgets, a fallback is created with:
  - Mobile navigation toggle
  - Active nav highlighting
  - Optional theme toggle (dark/light)
- All pages include: `<script src="./app.js" defer></script>`

### 4. Modern HTML5 + Accessibility
- Proper doctype: `<!doctype html>`
- Language attribute: `<html lang="en">`
- Character encoding: `<meta charset="utf-8">`
- Viewport meta: `<meta name="viewport" content="width=device-width,initial-scale=1">`
- Semantic elements: `<header>`, `<nav>`, `<main>`, `<footer>`, `<article>`, `<section>`
- ARIA attributes:
  - `aria-expanded` for mobile nav toggle
  - `aria-controls` for nav toggle button
  - `aria-current="page"` for active nav link
  - `aria-label` where appropriate

### 5. Optional Preact Mode
- Enable with: `SITE_UI_MODE=preact npm run site:gen`
- No build step required - uses CDN (esm.sh)
- Adds "island architecture" example:
  - FAQ accordion or pricing calculator
  - Interactive component rendered into `<div id="island-pricing"></div>`
- Pages remain static HTML with optional interactive islands
- Uses Preact + HTM for template literals

### 6. Enhanced Phase 1 Requirements
- Content must include at least ONE list or table when relevant
- Modern HTML5 semantic elements required
- Richer, more informative content
- Practical examples where applicable

## Usage

### Generate Site (Static Mode)
```bash
npm run site:gen
```
Output: `test-output/test-1/` (or next available number)

### Generate Site (Preact Mode)
```bash
SITE_UI_MODE=preact npm run site:gen
```
Output: Same as above, but with Preact islands included

### Validate Latest Run
```bash
npm run site:validate
```
Automatically finds and validates the latest `test-output/test-N/`

### Validate Specific Run
```bash
npm run site:validate -- test-5
```
Validates `test-output/test-5/`

### Zip Latest Run
```bash
npm run site:zip
```
Creates `test-output/test-N/test-N.zip` with all files

### Zip Specific Run
```bash
npm run site:zip -- test-5
```
Creates `test-output/test-5/test-5.zip`

### Full Pipeline
```bash
npm run site:build
```
Runs: generate → validate → zip

## Output Structure

Each test run produces:
```
test-output/
  test-1/
    index.html          # Home page
    about.html          # About page (example)
    ...                 # 10+ more pages
    styles.css          # Global styles with :root variables
    components.css      # Component styles
    app.js             # JavaScript functionality
    site-map.json      # Page sitemap (for validator)
    _partials.json     # Frozen header/footer (for validator)
    partials/
      header.html      # Canonical header
      footer.html      # Canonical footer
    test-1.zip         # Packaged site (after npm run site:zip)
```

## Validation Checks

The validator ensures:
1. ✓ All pages listed in site-map.json exist
2. ✓ All navigation links are valid
3. ✓ Headers/footers match frozen partials
4. ✓ All pages reference required assets (styles.css, components.css, app.js)
5. ✓ Preact scripts are allowed (if present)

## Formatting Benefits

Prettier formatting provides:
- **Consistency**: All files follow the same style
- **Readability**: Proper indentation and spacing
- **Diff-friendly**: Easy to compare changes between test runs
- **Professional**: Production-ready code formatting

## Preact Mode Details

When `SITE_UI_MODE=preact`:

1. **CDN Scripts**: Loaded via esm.sh (no build step)
2. **Island Container**: `<div id="island-pricing"></div>` in pages
3. **Interactive Components**: FAQ accordion, pricing calculator, etc.
4. **Static Base**: Pages remain static HTML
5. **Progressive Enhancement**: Works without JavaScript

Example Preact island:
```javascript
function Island() {
  const [expanded, setExpanded] = useState(null);
  return html`
    <div class="island">
      ${faqs.map((faq, i) => html`
        <button onClick=${() => setExpanded(i)}>
          ${faq.q}
        </button>
        ${expanded === i && html`<p>${faq.a}</p>`}
      `)}
    </div>
  `;
}
```

## Browser Compatibility

- **HTML5**: All modern browsers
- **CSS**: Grid, Flexbox, Custom Properties
- **JavaScript**: ES6+ (async/await, arrow functions, etc.)
- **Preact**: Modern browsers with ES modules support

## Performance

- **Parallel Generation**: 31 BULK models, 4 concurrent requests
- **Smart Caching**: Model trust cache for reliability
- **Retry Logic**: Auto-escalation to BASE model on failure
- **Efficient Bundling**: Minified CSS, deferred JS

## Future Enhancements

Potential future additions:
- [ ] TypeScript support for app.js
- [ ] CSS modules or scoped styles
- [ ] More Preact island examples
- [ ] Image optimization
- [ ] SEO meta tags
- [ ] Sitemap.xml generation
- [ ] RSS feed generation

## Migration Guide

If upgrading from old version:

1. **Output Directory**: Change references from `tests-output` to `test-output`
2. **Validator**: Now auto-finds latest run (or accepts CLI arg)
3. **Zip Tool**: Now saves zip inside test directory (not separate)
4. **app.js**: Now guaranteed to exist (fallback if missing)
5. **HTML**: Now uses proper HTML5 doctype and structure

## Troubleshooting

### Prettier Errors
If prettier fails on a file, check the console warning. The file will be saved without formatting.

### Missing app.js
If Phase 0 doesn't generate app.js, the fallback will be created automatically.

### Preact Not Loading
Ensure esm.sh is accessible (CDN). Check browser console for errors.

### Validation Failures
Run validator with verbose logging to see detailed errors.

## Credits

Built with:
- **OpenRouter**: 35 free AI models for content generation
- **Prettier**: Code formatting
- **Cheerio**: HTML parsing and manipulation
- **Preact**: Lightweight React alternative
- **HTM**: JSX-like syntax for Preact (no build step)

---

**Version**: 2.0  
**Last Updated**: December 25, 2025  
**Status**: ✅ All features implemented and tested
