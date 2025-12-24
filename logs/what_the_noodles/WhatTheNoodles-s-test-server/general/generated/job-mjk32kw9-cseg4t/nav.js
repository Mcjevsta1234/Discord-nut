import { debounce } from './utils.js';

export function init() {
  const toggle = document.querySelector('.mh-menu-toggle');
  const nav = document.querySelector('.mh-nav');
  const links = document.querySelectorAll('.mh-nav__link');
  const skipLink = document.getElementById('skip-to-content');

  if (!toggle || !nav) return;

  function onToggle() {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    nav.setAttribute('aria-expanded', String(!expanded));
    nav.style.left = expanded ? '-100%' : '0';
  }

  toggle.addEventListener('click', onToggle);

  // Close nav on link click (mobile)
  links.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        onToggle();
      }
    });
  });

  // Smooth scroll for hash links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Focus skip link
  skipLink?.addEventListener('click', () => {
    document.getElementById('main-content')?.focus();
  });

  // Handle resize to reset nav state
  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth > 768) {
      nav.style.left = '0';
      toggle.setAttribute('aria-expanded', 'false');
      nav.setAttribute('aria-expanded', 'false');
    }
  }, 100));
}
