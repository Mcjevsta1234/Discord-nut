# Generation Flow Fix - December 25, 2025

## Problems Fixed

### 1. Index.html Regeneration Issue ❌ → ✅
**Problem**: Phase 1 was regenerating index.html, overwriting Phase 0's carefully crafted version with just a `<main>` tag, destroying the header/footer/layout.

**Solution**: 
- Filter `index.html` from Phase 1 generation
- Phase 0 remains the single source of truth for index.html
- Phase 1 now generates: `siteSpec.pages.filter(p => p.filename !== 'index.html')`

### 2. Fragile Header/Footer Extraction ❌ → ✅
**Problem**: `freezeHeaderFooter()` tried to extract header/footer from index.html, which was unreliable if Phase 0 generated malformed HTML.

**Solution**:
- Removed dependency on `freezeHeaderFooter()` extraction
- Use `freezeCanonicalPartials()` which builds header/footer in CODE
- Added fallback templates if Phase 0 returns empty/invalid templates
- Fallback includes proper ARIA attributes and mobile nav toggle

### 3. Forbidden Elements Causing Failures ❌ → ✅
**Problem**: When models returned full HTML (with `<html>`, `<head>`, `<body>`) instead of just `<main>`, validation would fail and reject the entire page.

**Solution**:
- Added `coerceToMainOnly(html)` function to salvage content
- Extracts `<main>` if present
- Wraps body content in `<main>` if needed
- Removes nested headers/footers
- Validation now salvages instead of failing

### 4. Route Map Not Available Early ❌ → ✅
**Problem**: Route map was built during `freezeHeaderFooter()`, but needed earlier for consistent link normalization.

**Solution**:
- Added `buildRouteMap(siteSpec)` function
- Maps: id → filename, title → filename, filename → filename
- Available throughout assembly and patching

### 5. Index.html Not Using Canonical Partials ❌ → ✅
**Problem**: Index.html from Phase 0 might not match the frozen header/footer used on other pages.

**Solution**:
- Added `patchIndexAfterPhase0()` function
- Ensures index.html has exactly one `<main>`
- Applies `enforceCanonicalLayout()` to inject frozen header/footer
- Guarantees consistency across all pages

### 6. Pairing Validation Too Strict ❌ → ✅
**Problem**: Validation assumed models returned pages in the exact order requested, but they sometimes reordered them.

**Solution**:
- Build filename map from parsed results
- Match by filename first, fallback to array position
- More flexible and resilient to model behavior

## New Flow

```
Phase 0 (BASE Model):
├─ Generate sitemap, index.html, styles.css, components.css, app.js
├─ Extract templates from response
└─ Write to dist/

↓

Ensure app.js:
└─ Create fallback if missing

↓

Build Route Map:
└─ Map all page IDs/titles/filenames to paths

↓

Freeze Canonical Partials:
├─ Build header/footer in CODE from templates
├─ Use fallback templates if needed
├─ Write to partials/header.html, partials/footer.html
└─ Write _partials.json

↓

Patch Index.html:
├─ Ensure exactly one <main>
├─ Apply enforceCanonicalLayout()
└─ Inject canonical header/footer

↓

Phase 1 (BULK Models):
├─ Generate all pages EXCEPT index.html
├─ Salvage forbidden elements (coerceToMainOnly)
├─ Match by filename (flexible pairing)
└─ Validate and store

↓

Assembly:
├─ Wrap each page with layout
├─ Inject canonical header/footer
└─ Normalize all links with routeMap

↓

Prettier:
└─ Format all HTML/CSS/JS files
```

## Key Functions Added

### `buildRouteMap(siteSpec)`
Creates comprehensive route mapping for link normalization:
```typescript
{
  'home' => './index.html',
  'Home' => './index.html',
  'index.html' => './index.html',
  'index' => './index.html',
  ...
}
```

### `coerceToMainOnly(html)`
Salvages content from malformed HTML:
```typescript
// Input: <html><body><header>...</header><main>Content</main></body></html>
// Output: <main>Content</main>

// Input: <html><body>Content</body></html>
// Output: <main id="page" class="content">Content</main>
```

### `patchIndexAfterPhase0(siteSpec, templates, routeMap)`
Fixes index.html after Phase 0:
1. Ensures exactly one `<main id="page">`
2. Applies canonical header/footer
3. Normalizes all links

### Updated `freezeCanonicalPartials()`
Now includes:
- Fallback templates if Phase 0 fails
- Writes `_partials.json` for validator
- Proper ARIA attributes

## Fallback Templates

### Header Fallback
```html
<header class="site-header">
  <div class="container">
    <a href="./index.html" class="logo">Site</a>
    <button type="button" aria-expanded="false" aria-controls="main-nav" class="nav-toggle">
      <span>Menu</span>
    </button>
    <nav id="main-nav">
      {{NAV_ITEMS}}
    </nav>
  </div>
</header>
```

### Footer Fallback
```html
<footer class="site-footer">
  <div class="container">
    <p>&copy; 2025. All rights reserved.</p>
    <nav>
      {{FOOTER_LINKS}}
    </nav>
  </div>
</footer>
```

## Testing Results

### Before Fix
```
✗ Phase 1 overwrites index.html
✗ Header/footer extraction fails if malformed
✗ "Contains forbidden elements" → entire page rejected
✗ Models reorder pages → validation fails
```

### After Fix
```
✓ index.html preserved from Phase 0
✓ Canonical partials always built successfully
✓ Forbidden elements salvaged → content extracted
✓ Flexible pairing matches by filename
✓ All pages consistent header/footer
✓ Route map available for all normalizations
```

## Files Modified

1. **tools/generate-site.ts**
   - Added `buildRouteMap()`
   - Added `coerceToMainOnly()`
   - Added `patchIndexAfterPhase0()`
   - Updated `freezeCanonicalPartials()` with fallbacks
   - Updated `phase1GeneratePages()` to exclude index.html
   - Updated `phase1LegacyGeneration()` to exclude index.html
   - Updated validation to salvage forbidden elements
   - Updated pairing to match by filename
   - Updated main() flow

## Validation Compatibility

The validator still works correctly because:
- `_partials.json` is written by `freezeCanonicalPartials()`
- All pages have identical frozen header/footer
- `site-map.json` is written by Phase 0
- All required files are present

## Migration Notes

No migration needed - this is a drop-in fix. Existing:
- `npm run site:gen` works better
- `npm run site:validate` unchanged
- `npm run site:zip` unchanged

## Future Improvements

Potential enhancements:
- [ ] Validate routeMap completeness
- [ ] Add more salvage patterns (e.g., article → main)
- [ ] Log salvage statistics
- [ ] Add option to disable salvage (strict mode)

## Credits

**Fixed By**: GitHub Copilot  
**Date**: December 25, 2025  
**Status**: ✅ All issues resolved, build passing  
**Lines Changed**: ~150 lines across 1 file
