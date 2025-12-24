# Minecraft Host Static Site

A dark-themed Minecraft hosting website featuring a live console powered by the Pterodactyl API.

## Features

- Live console with real-time logs
- Command execution via Pterodactyl API
- Responsive design with mobile navigation
- Hosting plans page
- About page with contact form
- Accessibility (WCAG AA)
- Service worker for offline support

## Configuration

1. Set your Pterodactyl API token and server ID in `config.js`:
   ```js
   export default {
     SERVER_ID: 'YOUR_SERVER_ID',
     TOKEN: 'YOUR_PTERODACTYL_TOKEN',
     API_BASE: 'https://your-panel.example.com/api/client/servers'
   };
   ```

2. Alternatively, inject via script tag or environment variables:
   ```html
   <script>
     window.PTERODACTYL_TOKEN = 'TOKEN';
     window.SERVER_ID = 'SERVER_ID';
   </script>
   ```

## Deployment

- Push to GitHub and enable GitHub Pages on the `main` branch.
- Or deploy to Netlify with default settings.

## License

MIT
