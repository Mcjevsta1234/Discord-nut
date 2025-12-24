import { initMenu } from './menu.js';
import { initContactForm } from './contact.js';
import { MinecraftConsole } from './console.js';
import { Modal } from './modal.js';

(function () {
  'use strict';

  // Show loading spinner if console exists
  const loadingEl = document.getElementById('loading');
  const statusEl = document.getElementById('status-indicator');
  if (loadingEl && statusEl) {
    loadingEl.style.display = 'inline-block';
    loadingEl.setAttribute('aria-hidden', 'false');
    statusEl.textContent = 'Connecting...';
  }

  // Initialize components
  initMenu();
  initContactForm();

  // Initialize console if on index page
  const consolePlaceholder = document.getElementById('console-placeholder');
  if (consolePlaceholder) {
    const serverId = consolePlaceholder.dataset.serverId || '123';
    const apiToken = consolePlaceholder.dataset.apiToken || '';
    const apiEndpoint = consolePlaceholder.dataset.apiEndpoint || 'https://demo-pterodactyl.example/api';

    const modal = new Modal(document.getElementById('modal'), document.getElementById('modal-close'));
    const mcConsole = new MinecraftConsole({
      inputEl: document.getElementById('console-input'),
      sendEl: document.getElementById('console-send'),
      outputEl: document.getElementById('console-output'),
      statusEl: document.getElementById('status-indicator'),
      loadingEl: loadingEl,
      serverId,
      apiToken,
      apiEndpoint,
      modal,
    });
    mcConsole.init();
  }

  // Accessibility: focus visible polyfill (skip if CSS handles it)
  // Ensure focus outlines visible for keyboard users
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.add('user-is-tabbing');
    }
  });
})();