export function initMenu() {
  const hamburger = document.getElementById('hamburger');
  const offcanvas = document.getElementById('offcanvas');
  const offcanvasClose = document.getElementById('offcanvas-close');

  function openMenu() {
    offcanvas.setAttribute('aria-hidden', 'false');
    hamburger.setAttribute('aria-expanded', 'true');
    // Trap focus inside offcanvas
    const focusable = offcanvas.querySelectorAll('a, button, input, textarea, select');
    if (focusable.length) focusable[0].focus();
  }
  function closeMenu() {
    offcanvas.setAttribute('aria-hidden', 'true');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.focus();
  }

  hamburger?.addEventListener('click', () => {
    const hidden = offcanvas.getAttribute('aria-hidden') === 'true';
    if (hidden) openMenu(); else closeMenu();
  });
  offcanvasClose?.addEventListener('click', closeMenu);

  // Close on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && offcanvas.getAttribute('aria-hidden') === 'false') {
      closeMenu();
    }
  });

  // Close on backdrop click
  offcanvas?.addEventListener('click', (e) => {
    if (e.target === offcanvas) closeMenu();
  });
}
