import { ProjectType } from '../jobs/types';

type PlaceholderKind = 'hero' | 'card' | 'avatar' | 'logo' | 'generic';

const PLACEHOLDERS: Record<PlaceholderKind, string> = {
  hero: 'https://placehold.it/1400x600/1f2937/ffffff?text=Hero',
  card: 'https://placehold.it/600x400/111827/ffffff?text=Card',
  avatar: 'https://placehold.it/96x96/6366f1/ffffff?text=AB',
  logo: 'https://placehold.it/180x48?text=LOGO',
  generic: 'https://placehold.it/600x400/0f172a/ffffff?text=Image',
};

export const WEBSITE_STYLE_AND_ASSETS_APPENDIX = `WEBSITE STYLE & ASSETS (MANDATORY)\n\nPLACEHOLDERS & ASSET RULES\n- Allowed images: Placeholdit only unless user explicitly provides assets\n- Do NOT create or reference local assets folders; embed Placeholdit URLs directly in HTML/CSS/JS (no assets/, img/, public/ paths)\n- URL patterns:\n  * https://placehold.it/{WIDTH}x{HEIGHT}\n  * https://placehold.it/{WIDTH}x{HEIGHT}?text={URL_ENCODED_TEXT}\n  * https://placehold.it/{WIDTH}x{HEIGHT}/{BG_HEX}/{TEXT_HEX}?text=...\n- Examples:\n  * Hero: https://placehold.it/1400x600/1f2937/ffffff?text=Hero\n  * Card: https://placehold.it/600x400/111827/ffffff?text=Card\n  * Avatar: https://placehold.it/96x96/6366f1/ffffff?text=AB\n  * Logo alt: inline SVG preferred; if image: https://placehold.it/180x48?text=LOGO\n- REQUIRED placeholder slots (never omit imagery):\n  * hero background/banner\n  * 3-6 card thumbnails\n  * 4-6 avatar/testimonial images\n  * 1-2 small icons/tiles\n- If an image URL is empty, missing, local, or external (non-Placeholdit), replace with Placeholdit using sensible sizes (hero 1400x600, card 600x400, avatar 96x96, logo 180x48)\n\nSTYLING PRIORITIES\n- Looks > speed; premium UI feel\n- Modern layouts, gradients, glass panels, shadows, rounded corners\n- Animation and micro-interactions; graceful with prefers-reduced-motion\n- Responsive and accessible (ARIA, contrast, focus rings)\n- Clear typography scale and spacing rhythm\n- Keep motion tasteful; respect users who disable animation`;

export function shouldApplyWebsitePolicy(projectType: ProjectType, userMessage: string): boolean {
  const normalized = userMessage.toLowerCase();
  const websiteKeywords = [
    'website',
    'landing page',
    'landing',
    'homepage',
    'react',
    'next.js',
    'nextjs',
    'frontend',
    'ui',
    'page',
    'html',
    'css',
    'tailwind',
  ];

  const keywordHit = websiteKeywords.some(keyword => normalized.includes(keyword));
  return projectType === 'static_html' || keywordHit;
}

export function appendWebsitePolicy(text: string, force: boolean = false): string {
  if (!force && text.includes(WEBSITE_STYLE_AND_ASSETS_APPENDIX)) {
    return text;
  }
  const trimmed = text.trim();
  const separator = trimmed.endsWith('\n') ? '' : '\n\n';
  return `${trimmed}${separator}${WEBSITE_STYLE_AND_ASSETS_APPENDIX}`;
}

function isPlaceholdit(url: string): boolean {
  return url.includes('placehold.it');
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function pickPlaceholderByContext(context: string): string {
  const lower = context.toLowerCase();
  if (lower.match(/hero|banner|cover|header/)) return PLACEHOLDERS.hero;
  if (lower.match(/card|tile|feature|panel/)) return PLACEHOLDERS.card;
  if (lower.match(/avatar|testimonial|profile|author|team/)) return PLACEHOLDERS.avatar;
  if (lower.match(/logo|brand/)) return PLACEHOLDERS.logo;
  if (lower.match(/icon/)) return PLACEHOLDERS.card;
  return PLACEHOLDERS.generic;
}

function replaceImgSources(content: string): string {
  return content
    .replace(/(<img[^>]*\bsrc=)(["'])([^"']*)(\2)/gi, (_match, prefix, quote, url, suffix) => {
      const cleaned = (url || '').trim();
      if (cleaned.startsWith('data:') || isPlaceholdit(cleaned)) {
        return `${prefix}${quote}${cleaned}${suffix}`;
      }
      const placeholder = pickPlaceholderByContext(_match + url);
      return `${prefix}${quote}${placeholder}${suffix}`;
    })
    .replace(/(<source[^>]*\bsrcset=)(["'])([^"']*)(\2)/gi, (_match, prefix, quote, url, suffix) => {
      const cleaned = (url || '').trim();
      if (cleaned.startsWith('data:') || isPlaceholdit(cleaned)) {
        return `${prefix}${quote}${cleaned}${suffix}`;
      }
      const placeholder = pickPlaceholderByContext(_match + url);
      return `${prefix}${quote}${placeholder}${suffix}`;
    });
}

function replaceCssBackgrounds(content: string): string {
  return content.replace(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi, (fullMatch, url) => {
    const cleaned = stripQuotes(url.trim());
    if (cleaned.startsWith('data:') || isPlaceholdit(cleaned)) {
      return fullMatch;
    }
    const placeholder = PLACEHOLDERS.hero;
    return fullMatch.replace(url, `'${placeholder}'`);
  });
}

export function enforceWebsiteAssets(files: Array<{ path: string; content: string }>): Array<{ path: string; content: string }> {
  return files.map(file => {
    const lowerPath = file.path.toLowerCase();
    const isHtmlLike = lowerPath.endsWith('.html') || lowerPath.endsWith('.htm') || lowerPath.endsWith('.tsx') || lowerPath.endsWith('.jsx');
    const isCssLike = lowerPath.endsWith('.css') || lowerPath.endsWith('.scss');
    let content = file.content;

    if (isHtmlLike) {
      content = replaceImgSources(content);
      content = replaceCssBackgrounds(content);
    } else if (isCssLike) {
      content = replaceCssBackgrounds(content);
    }

    return { ...file, content };
  });
}

export function getPlaceholderUrl(kind: PlaceholderKind): string {
  return PLACEHOLDERS[kind];
}
