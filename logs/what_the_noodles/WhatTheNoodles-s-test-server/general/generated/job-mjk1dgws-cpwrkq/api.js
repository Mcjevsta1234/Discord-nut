import { API_BASE_URL, API_TOKEN } from './config.js';

/**
 * Sends a command to the Pterodactyl API.
 * @param {string} cmd - The command string.
 * @param {string} serverUuid - Server UUID.
 * @returns {Promise<Object>} - Resolves with response data.
 */
export async function sendCommand(cmd, serverUuid) {
  const url = API_BASE_URL(serverUuid);
  const body = JSON.stringify({ command: cmd });
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('API error:', err);
    throw err;
  }
}
