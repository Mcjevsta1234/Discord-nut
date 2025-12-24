# Dark‑Themed Minecraft Hosting Website with Live Pterodactyl Console

A lightweight, static website for Minecraft hosting with a live console powered by Pterodactyl API. Built with vanilla HTML5, CSS3, and JavaScript. Fully responsive, accessible, and respects `prefers-reduced-motion`.

## Features
- Dark theme with high contrast colors
- Live console panel with WebSocket/SSE fallback
- Command validation: allows `/spark` and utility commands, blocks power/operator commands
- Three hosting plans with modal confirmation
- About page with team bios
- Progressive enhancement: console shows placeholder without JS
- WCAG AA accessible (4.5:1 contrast)
- Keyboard navigation and focus management
- No backend required

## Tech Stack
- HTML5, CSS3 (BEM), JavaScript (ES6 modules)
- Pterodactyl API (WebSocket + REST)
- CDN: Google Fonts (Space Mono), Font Awesome

## Quick Start
1. Clone the repo
2. Serve locally (e.g., `npx serve` or `python -m http.server`)
3. Open `index.html` in a browser

> **Note**: Replace `YOUR_PTERODACTYL_API_KEY` and `SERVER_UUID_PLACEHOLDER` in `config.js` with your actual values.

## Structure
- `index.html` - Landing page with hero and console
- `plans.html` - Hosting plans with modals
- `about.html` - Story and team bios
- `styles.css` - Dark theme styles, responsive, accessible
- `script.js` - UI logic and command validation
- `pterodactyl_api.js` - Pterodactyl WebSocket and POST interactions
- `config.js` - API credentials
- `modules/` - UI, console UI, utilities

## Accessibility
- Skip navigation link
- ARIA labels, live regions, focus traps
- Keyboard operable
- WCAG AA contrast ratios
- Prefers-reduced-motion support

## Console Commands
Allowed: `/spark profiler`, `/spark tps`, `/spark healthreport --memory`, `/list`, `/help`

Disallowed: `/stop`, `/op`, `/restart`, `/kill`, `/console` (triggers modal)

## Browser Support
- Chrome, Firefox, Edge (latest)
- No IE support

## License
MIT
