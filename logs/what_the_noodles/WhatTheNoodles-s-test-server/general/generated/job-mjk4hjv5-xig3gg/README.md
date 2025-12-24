# WitchyWorlds Hosting Website

A premium, dark-themed Minecraft hosting website featuring glassmorphism design and a simulated Pterodactyl console.

## Project Structure

- `index.html`: Main landing page with the interactive console.
- `pages/`: Contains sub-pages (`plans.html`, `about.html`).
- `css/`: Stylesheets (`style.css` for layout, `animations.css` for effects).
- `js/`: JavaScript logic (`main.js` for UI, `console.js` for the mock terminal).

## The Console Feature

The console on the homepage is currently in **Simulation Mode**. It mimics a Pterodactyl server console.

- **Allowed Commands:** `/spark`, `/list`, `/help`, `/tps`, `/say`
- **Blocked Commands:** `/stop`, `/op` (Returns security error)

### Connecting to Real API
To connect to a real Pterodactyl instance, edit `js/console.js`.
1. Authenticate using your Client API Key.
2. Establish a WebSocket connection to the specific server UUID.
3. Replace the `processCommand` logic to send JSON payloads to the socket.

## Setup

1. No build process required. This is a static site.
2. Open `index.html` in any modern browser.
3. For best results, serve via a local server (e.g., VS Code Live Server) to ensure path resolution works perfectly.