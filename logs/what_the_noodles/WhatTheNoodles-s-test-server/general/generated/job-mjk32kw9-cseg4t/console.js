import config from './config.js';
import { formatTimestamp, sanitize } from './utils.js';

const CONSOLE_INTERVAL_MS = 3000;
const BACKOFF_MS = 10000;
const MAX_LOG_LINES = 200;

let intervalId = null;
let backoffTimer = null;
let paused = false;

const outputEl = document.getElementById('console-output');
const spinnerEl = document.getElementById('console-spinner');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const inputEl = document.getElementById('command-input');
const errorEl = document.getElementById('command-error');
const consoleEl = document.getElementById('console');
const toggleBtn = document.getElementById('console-toggle');

const ALLOWED_CMDS = [
  /^\/spark profiler$/i,
  /^\/spark tps$/i,
  /^\/spark healthreport --memory$/i,
  /^\/list$/i,
  /^\/help$/i
];

const DISALLOWED_CMDS = [
  /^\/stop$/i,
  /^\/op /i,
  /^\/deop /i,
  /^\/ban /i,
  /^\/pardon /i,
  /^\/kick /i
];

function appendLine(type, text, ts) {
  const time = formatTimestamp(ts || new Date().toISOString());
  const line = `[${time}] ${text}\n`;
  const span = document.createElement('span');
  span.className = `mh-console__${type}`;
  span.textContent = line;
  outputEl.appendChild(span);
  if (outputEl.children.length > MAX_LOG_LINES) {
    outputEl.removeChild(outputEl.firstElementChild);
  }
  if (!paused) {
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

function showSpinner(show) {
  if (!spinnerEl) return;
  spinnerEl.style.display = show ? 'block' : 'none';
}

async function fetchLogs() {
  if (paused || !outputEl) return;
  try {
    showSpinner(true);
    const res = await fetch(`${config.API_BASE}/${config.SERVER_ID}/logs/latest`, {
      headers: {
        'Authorization': `Bearer ${config.TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.status === 429) {
      clearTimeout(backoffTimer);
      backoffTimer = setTimeout(() => {
        fetchLogs();
      }, BACKOFF_MS);
      return;
    }
    if (!res.ok) {
      throw new Error('Failed to fetch logs');
    }
    const data = await res.json();
    if (data && Array.isArray(data.logs)) {
      data.logs.forEach(entry => {
        const msg = sanitize(entry.message || '');
        const type = entry.type === 'error' ? 'error' : (entry.type === 'warning' ? 'warning' : 'normal');
        appendLine(type, msg, entry.date);
      });
    } else {
      appendLine('normal', 'No recent logs.', new Date().toISOString());
    }
  } catch (e) {
    console.error('Console fetch error:', e);
  } finally {
    showSpinner(false);
  }
}

async function sendCommand(cmd) {
  if (!cmd || !cmd.trim()) return;
  const clean = cmd.trim();
  // Check disallowed first
  const isDisallowed = DISALLOWED_CMDS.some(rx => rx.test(clean));
  if (isDisallowed) {
    showError('Command not allowed.');
    return;
  }
  const isAllowed = ALLOWED_CMDS.some(rx => rx.test(clean));
  if (!isAllowed) {
    showError('Command not recognized or not allowed.');
    return;
  }
  clearError();
  try {
    const res = await fetch(`${config.API_BASE}/${config.SERVER_ID}/command`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ command: clean })
    });
    if (!res.ok) {
      throw new Error('Command failed');
    }
    appendLine('normal', `Command sent: ${clean}`, new Date().toISOString());
  } catch (e) {
    console.error('Command error:', e);
    showError('Failed to send command.');
  }
}

function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
}

function clearError() {
  if (!errorEl) return;
  errorEl.textContent = '';
}

function init() {
  if (!outputEl) return;

  // Start polling
  intervalId = setInterval(fetchLogs, CONSOLE_INTERVAL_MS);

  // Copy button
  copyBtn?.addEventListener('click', async () => {
    const last = outputEl.lastElementChild?.textContent || '';
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last);
    } catch (e) {
      console.warn('Clipboard write failed', e);
    }
  });

  // Clear button
  clearBtn?.addEventListener('click', () => {
    if (confirm('Clear console history?')) {
      outputEl.innerHTML = '';
      appendLine('normal', 'Console cleared.', new Date().toISOString());
    }
  });

  // Command input
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendCommand(inputEl.value);
      inputEl.value = '';
    }
  });

  // Ctrl+Enter shortcut
  inputEl?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendCommand(inputEl.value);
      inputEl.value = '';
    }
  });

  // Pause polling on focus
  outputEl?.addEventListener('focus', () => { paused = true; });
  outputEl?.addEventListener('blur', () => { paused = false; });

  // Toggle console visibility on mobile
  if (toggleBtn && consoleEl) {
    toggleBtn.addEventListener('click', () => {
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      consoleEl.style.display = expanded ? 'none' : 'flex';
    });
  }

  // Initial fetch
  fetchLogs();
}

export { init };
