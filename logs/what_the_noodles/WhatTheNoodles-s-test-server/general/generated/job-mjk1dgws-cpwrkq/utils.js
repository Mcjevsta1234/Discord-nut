/**
 * Formats an ISO timestamp to HH:MM:SS.
 * @param {string} [iso] - Optional ISO string, defaults to now.
 * @returns {string}
 */
export function formatTimestamp(iso) {
  const date = iso ? new Date(iso) : new Date();
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Applies Minecraft color codes to text using CSS classes.
 * @param {string} text
 * @returns {string}
 */
export function applyColorCodes(text) {
  const map = {
    '§0': '<span class="color-black">',
    '§1': '<span class="color-dark-blue">',
    '§2': '<span class="color-dark-green">',
    '§3': '<span class="color-dark-aqua">',
    '§4': '<span class="color-dark-red">',
    '§5': '<span class="color-dark-purple">',
    '§6': '<span class="color-gold">',
    '§7': '<span class="color-gray">',
    '§8': '<span class="color-dark-gray">',
    '§9': '<span class="color-blue">',
    '§a': '<span class="color-green">',
    '§b': '<span class="color-aqua">',
    '§c': '<span class="color-red">',
    '§d': '<span class="color-light-purple">',
    '§e': '<span class="color-yellow">',
    '§f': '<span class="color-white">',
    '§r': '</span>',
    '§l': '<b>',
    '§m': '<s>',
    '§n': '<u>',
    '§o': '<i>',
    '§k': '', // obfuscated, ignored
  };

  let out = text.replace(/§[0-9a-fklmnor]/g, m => map[m] || m);
  // Close any unclosed spans
  const open = (out.match(/<span/g) || []).length;
  const close = (out.match(/<\/span>/g) || []).length;
  out += '</span>'.repeat(Math.max(0, open - close));
  return out;
}

/**
 * Debounces a function.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}
