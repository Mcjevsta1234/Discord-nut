import { CommandFilter } from './command-filter.js';
import { mockLogRows } from './mock-logs.js';

export class MinecraftConsole {
  constructor({ inputEl, sendEl, outputEl, statusEl, loadingEl, serverId, apiToken, apiEndpoint, modal }) {
    this.inputEl = inputEl;
    this.sendEl = sendEl;
    this.outputEl = outputEl;
    this.statusEl = statusEl;
    this.loadingEl = loadingEl;
    this.serverId = serverId;
    this.apiToken = apiToken;
    this.apiEndpoint = apiEndpoint;
    this.modal = modal;
    this.filter = new CommandFilter();
    this.logRows = [];
    this.isConnected = false;
    this.stdoutFetchController = null;
  }

  init() {
    this.sendEl?.addEventListener('click', () => this.handleSend());
    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });
    this.startStreaming();
  }

  handleSend() {
    const cmd = (this.inputEl?.value || '').trim();
    if (!cmd) return;
    if (!this.filter.isAllowed(cmd)) {
      this.modal?.show();
      this.inputEl.value = '';
      return;
    }
    this.sendCommand(cmd).then(() => {
      this.inputEl.value = '';
    });
  }

  async sendCommand(command) {
    const url = `${this.apiEndpoint}/servers/${this.serverId}/command`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ command })
      });
      if (res.ok) {
        this.appendLog(`> ${command}`);
      } else {
        this.appendLog(`[Error sending command: ${res.status}]`);
      }
    } catch (err) {
      this.appendLog(`[Network error: ${err.message}]`);
    }
  }

  startStreaming() {
    const url = `${this.apiEndpoint}/servers/${this.serverId}/stdout`;
    this.stdoutFetchController = new AbortController();
    this.statusEl.textContent = 'Connecting...';
    this.loadingEl.style.display = 'inline-block';

    // Fallback to mock data if no token
    if (!this.apiToken) {
      this.appendMockLogs();
      this.loadingEl.style.display = 'none';
      this.statusEl.textContent = 'Offline (mock)';
      return;
    }

    fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      },
      signal: this.stdoutFetchController.signal
    })
    .then(res => {
      if (!res.ok) {
        this.appendMockLogs();
        this.loadingEl.style.display = 'none';
        this.statusEl.textContent = 'Offline (mock)';
        return;
      }
      this.loadingEl.style.display = 'none';
      this.statusEl.textContent = 'Online';
      this.statusEl.classList.add('online');
      this.isConnected = true;
      return res.json();
    })
    .then(data => {
      if (data && data.log) {
        const rows = Array.isArray(data.log) ? data.log : [];
        rows.forEach(line => this.appendLog(line));
      }
    })
    .catch(err => {
      console.warn('Console fetch error (fallback to mock):', err);
      this.appendMockLogs();
      this.loadingEl.style.display = 'none';
      this.statusEl.textContent = 'Offline (mock)';
    });
  }

  appendMockLogs() {
    mockLogRows.forEach(line => this.appendLog(line));
  }

  appendLog(line) {
    const timestamp = this.formatTimestamp();
    const entry = `[${timestamp}] ${line}\n`;
    this.outputEl.textContent += entry;
    this.scrollToBottom();
  }

  formatTimestamp() {
    const d = new Date();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  scrollToBottom() {
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    } else {
      this.outputEl.scrollTo({ top: this.outputEl.scrollHeight, behavior: 'smooth' });
    }
  }
}

// CommandFilter module
export class CommandFilter {
  constructor() {
    this.whitelist = [
      /^\s*\/spark\s+profiler\s*$/i,
      /^\s*\/spark\s+tps\s*$/i,
      /^\s*\/spark\s+healthreport\s+--memory\s*$/i,
      /^\s*\/list\s*$/i,
      /^\s*\/help\s*$/i
    ];
    this.blacklist = [
      /\/stop\b/i,
      /\/op\b/i,
      /\/start\b/i,
      /\/restart\b/i,
      /\/halt\b/i,
      /\/settime\b/i,
      /\/gamerule\b/i
    ];
  }

  isAllowed(command) {
    const lower = command.toLowerCase();
    // Blacklist check first
    for (const regex of this.blacklist) {
      if (regex.test(lower)) return false;
    }
    // Whitelist check
    for (const regex of this.whitelist) {
      if (regex.test(command)) return true;
    }
    // Allow if not matched by blacklist and not matched by whitelist? No, block.
    return false;
  }
}
