import { sendCommand } from './api.js';
import { formatTimestamp, applyColorCodes, debounce } from './utils.js';

/**
 * Initializes console UI and command handling.
 * @param {Object} options
 * @param {string} options.apiToken
 * @param {string} options.serverUuid
 * @param {number} options.maxLines
 * @param {HTMLElement} options.spinner
 * @param {HTMLElement} options.output
 * @param {HTMLElement} options.input
 */
export function initConsole({ apiToken, serverUuid, maxLines, spinner, output, input }) {
  if (!apiToken || !serverUuid) {
    appendLine(output, 'ERROR: API token or server UUID not configured.', 'color-red');
    return;
  }

  const forbidden = ['/stop', '/op'];

  input.addEventListener('keydown', debounce((e) => {
    if (e.key !== 'Enter') return;
    const cmd = input.value.trim();
    if (!cmd) return;

    if (forbidden.includes(cmd.toLowerCase())) {
      appendLine(output, `ERROR: Command forbidden`, 'color-red');
      input.value = '';
      return;
    }

    const prompt = `> ${cmd}`;
    appendLine(output, `[${formatTimestamp()}] ${prompt}`);
    input.value = '';
    showSpinner(true);

    sendCommand(cmd, serverUuid)
      .then(res => {
        const text = Array.isArray(res) ? res.join('\n') : JSON.stringify(res);
        appendLine(output, `[${formatTimestamp()}] ${text}`);
      })
      .catch(err => {
        appendLine(output, `ERROR: ${err.message}`, 'color-red');
      })
      .finally(() => {
        showSpinner(false);
        scrollToBottom();
      });
  }, 150));

  // Clear console with Ctrl+K
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      output.textContent = '> Welcome to Cottage Hosting console.';
    }
  });

  function appendLine(el, text, cssClass = '') {
    const line = document.createElement('div');
    const colored = applyColorCodes(text);
    line.innerHTML = colored;
    if (cssClass) line.classList.add(cssClass);
    el.appendChild(line);

    // Limit lines
    const lines = el.querySelectorAll('div');
    if (lines.length > maxLines) {
      lines[0].remove();
    }
    scrollToBottom();
  }

  function showSpinner(show) {
    if (!spinner) return;
    spinner.style.display = show ? 'block' : 'none';
  }

  function scrollToBottom() {
    output.scrollTop = output.scrollHeight;
  }
}
