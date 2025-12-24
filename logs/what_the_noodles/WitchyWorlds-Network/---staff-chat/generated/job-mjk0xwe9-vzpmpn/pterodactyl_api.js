import { SERVER_UUID, API_KEY } from './config.js';
import { renderLog, setStatusDot, showToast } from './modules/console_ui.js';
import { throttle } from './modules/utils.js';

const API_BASE = 'https://api.pterodactyl.host/api/client/servers';
const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = 3000;
let scrollLocked = false;
let lastLogCount = 0;

export function initConsole() {
  const input = document.getElementById('console-input');
  const lockBtn = document.getElementById('scroll-lock-btn');

  // Scroll lock toggle
  lockBtn.addEventListener('click', () => {
    scrollLocked = !scrollLocked;
    lockBtn.setAttribute('aria-pressed', String(scrollLocked));
    lockBtn.textContent = scrollLocked ? 'Scroll Unlock' : 'Scroll Lock';
    if (!scrollLocked) autoScroll();
  });

  // Connect WebSocket
  connectWebSocket();

  // Poll logs every 2s if WebSocket unavailable
  setInterval(pollLogs, 2000);
}

export function sendCommand(cmd) {
  const body = { command: cmd };
  fetch(`${API_BASE}/${SERVER_UUID}/command`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  .then(res => {
    if (!res.ok) throw new Error('API error');
    renderLog(`> ${cmd}`);
  })
  .catch(err => showToast('Failed to send command: ' + err.message));
}

function connectWebSocket() {
  try {
    ws = new WebSocket(`wss://api.pterodactyl.host/api/client/servers/${SERVER_UUID}/ws`);
    ws.onopen = () => {
      reconnectAttempts = 0;
      setStatusDot(true);
      showToast('WebSocket connected');
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.data?.output) renderLog(data.data.output);
      } catch (err) {
        // ignore
      }
    };
    ws.onclose = () => {
      setStatusDot(false);
      attemptReconnect();
    };
    ws.onerror = () => {
      setStatusDot(false);
    };
  } catch (err) {
    setStatusDot(false);
  }
}

function attemptReconnect() {
  if (reconnectAttempts < MAX_RECONNECT) {
    reconnectAttempts++;
    setTimeout(connectWebSocket, RECONNECT_DELAY);
  }
}

const pollLogs = throttle(() => {
  fetch(`${API_BASE}/${SERVER_UUID}/activity`, { headers })
  .then(res => res.json())
  .then(data => {
    if (data?.data) {
      const logs = Array.isArray(data.data) ? data.data : [];
      if (logs.length > lastLogCount) {
        logs.slice(lastLogCount).forEach(entry => {
          renderLog(formatLog(entry));
        });
        lastLogCount = logs.length;
      }
    }
  })
  .catch(() => {}); // silently fail
}, 2000);

function formatLog(entry) {
  const ts = new Date(entry?.timestamp).toISOString();
  const level = entry?.level || 'INFO';
  const msg = entry?.message || '';
  return `[${ts}] [${level}] ${msg}`;
}

function autoScroll() {
  if (scrollLocked) return;
  const body = document.getElementById('console-body');
  body.scrollTop = body.scrollHeight;
}
