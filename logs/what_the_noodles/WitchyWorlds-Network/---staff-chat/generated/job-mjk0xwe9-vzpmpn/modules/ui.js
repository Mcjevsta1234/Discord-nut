export function initNavigation() {
  const hamburger = document.getElementById('hamburger');
  const menu = document.getElementById('main-menu');
  const overlay = document.querySelector('.modal__overlay');

  hamburger.addEventListener('click', () => {
    const expanded = hamburger.getAttribute('aria-expanded') === 'true';
    hamburger.setAttribute('aria-expanded', String(!expanded));
    menu.setAttribute('aria-hidden', String(expanded));
  });

  // Close on ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hamburger.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
      overlay?.blur();
    }
  });
}

export function toggleScrollLock() {
  const btn = document.getElementById('scroll-lock-btn');
  const status = btn.getAttribute('aria-pressed') === 'true';
  btn.setAttribute('aria-pressed', String(!status));
  btn.textContent = !status ? 'Scroll Unlock' : 'Scroll Lock';
}

export function showToast(message) {
  const toast = document.getElementById('toast');
  const content = document.getElementById('toast-content');
  content.textContent = message;
  toast.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    toast.setAttribute('aria-hidden', 'true');
  }, 3000);
}
