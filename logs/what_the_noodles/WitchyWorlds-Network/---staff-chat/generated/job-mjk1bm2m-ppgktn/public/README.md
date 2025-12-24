# Emma’s Minecraft Host

Dark themed, responsive Minecraft hosting landing site with live console via Pterodactyl API.

## Features
- Dark UI with high contrast
- Real‑time console (whitelisted commands only)
- Plans page with Starter, Pro, Elite tiers
- About page with contact form
- Mobile‑first responsive design
- Accessible (keyboard, screen reader)

## Project Structure
```
/public
├─ index.html
├─ plans.html
├─ about.html
├─ assets
│  ├─ images/logo.png
│  ├─ css/styles.css
│  └─ js/
│     ├─ script.js
│     ├─ menu.js
│     ├─ console.js
│     ├─ modal.js
│     ├─ contact.js
│     ├─ command-filter.js
│     └─ mock-logs.js
├─ data/mock_server_log.json
└─ README.md
```

## API Setup
1. Obtain a Pterodactyl API token from your panel.
2. Set the token on the console placeholder in `index.html`:
   ```html
   <div id="console-placeholder" data-server-id="YOUR_SERVER_ID" data-api-token="YOUR_API_TOKEN" data-api-endpoint="https://your-pterodactyl.example/api"></div>
   ```
3. The console will connect and stream stdout, and send commands via POST.

## Command Filtering
- Allowed: `/spark profiler`, `/spark tps`, `/spark healthreport --memory`, `/list`, `/help`
- Blocked: `/stop`, `/op`, `/start`, `/restart`, `/halt`, `/settime`, `/gamerule`

## Local Development
No build step required. Serve the `/public` folder via any static server (e.g., `npx serve public` or `python -m http.server`).

## Browser Compatibility
- Modern browsers supporting ES6 modules, fetch, and CSS Grid/Flexbox
- HTTPS required for Pterodactyl API calls

## Accessibility
- Skip navigation link
- Focus indicators
- ARIA labels on icons and inputs
- Keyboard navigation
- Reduced‑motion support

## License
MIT
