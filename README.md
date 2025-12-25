# Discord-nut

A TypeScript Discord bot powered by OpenRouter. It listens to mentions, replies, or name references, plans actions (tools), routes models by tier, keeps memory lean, and supports console mode for headless use.

## Quick Start

```
npm install
cp .env.example .env  # set DISCORD_TOKEN, DISCORD_CLIENT_ID, OPENROUTER_API_KEY
npm run dev           # hot reload (Discord)
`# or`
npm run build && npm start
```

Console-only: `npm run console` or `npm start -- --console`
Hybrid (Discord + console): `npm start -- --hybrid`

## Features

- Smart triggers (mentions/replies/name), persona-aware prompts
- LLM routing across INSTANT/SMART/THINKING/CODING tiers
- Action planning + MCP tool execution; cost tracking when enabled
- Conversation memory with summarization to stay within token limits
- Image generation hooks preserved (OpenRouter image models)

## Environment

Key variables (see .env.example for full list):

- DISCORD_TOKEN, DISCORD_CLIENT_ID – required for Discord
- OPENROUTER_API_KEY – required for LLM calls
- MODEL_INSTANT, MODEL_SMART, MODEL_THINKING, MODEL_CODING – model choices per tier
- MODEL_*_INPUT_PRICE, MODEL_*_OUTPUT_PRICE – optional cost tracking
- CONSOLE_MODE, HYBRID_MODE – select run mode
- IMAGE_MODEL, IMAGE_DEFAULT_WIDTH, IMAGE_DEFAULT_HEIGHT – image generation defaults

## Usage

- Discord: npm run dev (or npm start after build)
- Console: /help, /personas, /persona <name>, /clear, /exit

## Static Site Generator

Generate a cohesive multi-page static website using LLM-powered parallel generation:

```bash
npm run site:build
```

This command:
1. Generates >= 12 HTML pages for a "Linux Terminal Learning Lab" theme
2. Creates canonical header/footer via `dist/_partials.json` (single source of truth)
3. Validates all navigation links and ensures header/footer consistency across pages
4. Packages everything into `dist/site.zip`

**Requirements:**
- `OPENROUTER_API_KEY` environment variable (required)
- Optional: `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` (defaults to `kwaipilot/kat-coder-pro:free`)

**Generated files:**
- `dist/site-map.json` - Site structure with all pages
- `dist/style.json` - Design tokens and theme
- `dist/styles.css`, `dist/components.css`, `dist/app.js` - Shared assets
- `dist/_partials.json` - Canonical header/footer markup
- `dist/*.html` - All HTML pages (>= 12)
- `dist/site.zip` - Complete packaged site

**Features:**
- Parallel page generation with 3-second stagger between starts
- Validation guarantees against header/footer/link mismatches
- All pages use relative links (./about.html) for local browsing
- Consistent shared assets across all pages

**Individual commands:**
- `npm run site:gen` - Generate site files only
- `npm run site:validate` - Run validation checks
- `npm run site:zip` - Create zip archive

## Documentation

A single-page HTML lives at docs/index.html.

## License

ISC
