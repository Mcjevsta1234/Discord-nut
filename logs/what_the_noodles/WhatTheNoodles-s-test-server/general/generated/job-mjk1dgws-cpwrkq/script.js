import { initNav } from './nav.js';
import { initConsole } from './console.js';
import { API_TOKEN, SERVER_UUID } from './config.js';

// Page title update
if (document.title.includes('Home')) {
  document.title = 'Cottage Minecraft Hosting – Home';
} else if (document.title.includes('Plans')) {
  document.title = 'Cottage Minecraft Hosting – Plans';
} else if (document.title.includes('About')) {
  document.title = 'Cottage Minecraft Hosting – About';
}

// Initialize modules
initNav();
if (document.getElementById('console-output')) {
  initConsole({
    apiToken: API_TOKEN,
    serverUuid: SERVER_UUID,
    maxLines: 200,
    spinner: document.getElementById('console-spinner'),
    output: document.getElementById('console-output'),
    input: document.getElementById('command-input')
  });
}

// Trap focus for drawer (fallback for Modernizr non-flex)
(function trapFocusFallback() {
  const hasFlex = Modernizr && Modernizr.flexbox;
  if (!hasFlex) {
    const drawer = document.getElementById('nav-menu');
    const links = drawer.querySelectorAll('a');
    const first = links[0];
    const last = links[links.length - 1];
    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
      if (e.key === 'Escape') {
        const btn = document.getElementById('hamburger');
        btn.setAttribute('aria-expanded', 'false');
        drawer.classList.remove('open');
      }
    });
  }
})();

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Page load console welcome
if (document.getElementById('console-output')) {
  const out = document.getElementById('console-output');
  out.textContent = '> Welcome to Cottage Hosting console.';
}

// Prevent form submission on Enter in input (handled by console)
const cmdInput = document.getElementById('command-input');
if (cmdInput) {
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
}
