import * as cheerio from 'cheerio';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateMainContent(mainHtml: string, filename: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if it's actually wrapped in <main>
  if (!mainHtml.includes('<main')) {
    errors.push(`${filename}: Missing <main> tag`);
  }

  // Parse with cheerio
  try {
    const $ = cheerio.load(mainHtml);
    const main = $('main');

    if (main.length === 0) {
      errors.push(`${filename}: No <main> element found`);
    }
    
    // Check for ONLY header/footer inside <main> (forbidden after salvage)
    const nestedHeader = main.find('header');
    const nestedFooter = main.find('footer');
    if (nestedHeader.length > 0) {
      errors.push(`${filename}: Contains <header> inside <main> (should have been salvaged)`);
    }
    if (nestedFooter.length > 0) {
      errors.push(`${filename}: Contains <footer> inside <main> (should have been salvaged)`);
    }
    
    // Warn if top-level forbidden elements exist (but these should be salvaged/stripped)
    const topLevelForbidden = ['<!DOCTYPE', '<html', '<head>', '<body'];
    for (const tag of topLevelForbidden) {
      if (mainHtml.toLowerCase().includes(tag.toLowerCase())) {
        warnings.push(`${filename}: Contains ${tag} (should have been salvaged)`);
      }
    }

    // Check for thin content (less than 200 chars)
    const textContent = main.text().trim();
    if (textContent.length < 200) {
      warnings.push(`${filename}: Thin content (${textContent.length} chars)`);
    }

    // Check for malformed HTML
    if (mainHtml.includes('undefined') || mainHtml.includes('null')) {
      errors.push(`${filename}: Contains literal 'undefined' or 'null'`);
    }

    // Check for unclosed tags (basic check)
    const openingTags = (mainHtml.match(/<[^/][^>]*>/g) || []).length;
    const closingTags = (mainHtml.match(/<\/[^>]+>/g) || []).length;
    const selfClosingTags = (mainHtml.match(/<[^>]+\/>/g) || []).length;
    
    if (openingTags - selfClosingTags - closingTags > 5) {
      warnings.push(`${filename}: Possible unclosed tags (${openingTags - selfClosingTags - closingTags} unmatched)`);
    }

  } catch (error: any) {
    errors.push(`${filename}: Failed to parse HTML: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function validateOutputSchema(content: string, expectedFilenames: string[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const parsed = JSON.parse(content);

    if (!parsed.pages || !Array.isArray(parsed.pages)) {
      errors.push('Response missing "pages" array');
      return { valid: false, errors, warnings };
    }

    for (const page of parsed.pages) {
      if (!page.filename) {
        errors.push('Page missing "filename" field');
      }
      if (!page.mainHtml) {
        errors.push(`Page ${page.filename || 'unknown'} missing "mainHtml" field`);
      }
      if (!page.title) {
        warnings.push(`Page ${page.filename || 'unknown'} missing "title" field`);
      }
    }

    // Check if expected filenames are present
    const returnedFilenames = parsed.pages.map((p: any) => p.filename);
    for (const expected of expectedFilenames) {
      if (!returnedFilenames.includes(expected)) {
        errors.push(`Expected filename not returned: ${expected}`);
      }
    }

  } catch (error: any) {
    errors.push(`Invalid JSON: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
