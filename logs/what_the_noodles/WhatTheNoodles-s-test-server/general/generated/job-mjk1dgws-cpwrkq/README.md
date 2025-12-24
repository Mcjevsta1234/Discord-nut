# Cottage Minecraft Hosting with Console Integration

A fully static, cottage‑themed front‑end that mirrors a real Minecraft server console.

## Overview
- **Purpose**: Static website with index, plans, and about pages.
- **Console**: Real‑time console adjacent to hero title, communicating with Pterodactyl API.
- **Design**: Rustic aesthetics, mobile‑responsive, WCAG‑AA compliant.
- **Tech**: HTML5, CSS3, Vanilla JS ES6+, PostCSS, Autoprefixer, ESLint, Prettier.

## Project Structure
```
├─ index.html
├─ plans.html
├─ about.html
├─ styles.css
├─ script.js
├─ config.js
├─ api.js
├─ console.js
├─ nav.js
├─ utils.js
├─ README.md
├─ license.txt
├─ CHANGELOG.md
├─ robots.txt
├─ assets/
│   ├─ img/
│   │   ├─ hero.webp
│   │   ├─ hero.jpg
│   │   ├─ team-01.webp
│   │   └─ cottage.png
│   └─ favicon.png
```

## Features
- Real‑time console with color codes and command whitelist/blacklist.
- Mobile navigation drawer with focus trap.
- Dynamic page titles.
- Prefers‑reduced‑motion support.
- Keyboard shortcuts: `Ctrl+K` (clear), `Esc` (close nav), `Enter` (submit).
- BEM naming, CSS variables, PostCSS with Autoprefixer.
- ESLint + Prettier linting/formatting.

## Setup
1. Clone the repository.
2. Ensure `config.js` contains real `API_TOKEN` and `SERVER_UUID`.
3. Optional build: `npm run build` (simple copy to `dist/` and inject token).

## Deployment
Deploy to Netlify, GitHub Pages, or any static host.

## API Integration
- Endpoint: `POST /api/client/servers/<UUID>/command`.
- Headers: `Authorization: Bearer <TOKEN>`, `Content-Type: application/json`.
- Body: `{"command":"<CMD>"}`.
- Responses: 200 with JSON array of output; 400/500 with error JSON.
- Rate limit: 5 req/s.

## Accessibility
- Skip‑navigation link.
- All interactive elements have focus states and ARIA labels.
- Console uses `role="log"`, `aria-live="polite"`.
- WCAG AA contrast.

## License
See `license.txt`.
