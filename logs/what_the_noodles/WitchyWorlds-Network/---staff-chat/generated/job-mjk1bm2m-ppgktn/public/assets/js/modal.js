export class Modal {
  constructor(modalEl, closeEl) {
    this.modalEl = modalEl;
    this.closeEl = closeEl;
    this.firstFocusable = null;
    this.lastFocusable = null;
    this.init();
  }

  init() {
    if (!this.modalEl) return;
    this.firstFocusable = this.getFirstFocusable();
    this.lastFocusable = this.getLastFocusable();

    this.closeEl?.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Tab') this.trapFocus(e);
    });
  }

  getFirstFocusable() {
    return this.modalEl.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }
  getLastFocusable() {
    const focusables = Array.from(this.modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    return focusables[focusables.length - 1];
  }

  trapFocus(e) {
    if (this.modalEl.getAttribute('aria-hidden') === 'false') {
      if (!this.firstFocusable || !this.lastFocusable) return;
      if (e.shiftKey && document.activeElement === this.firstFocusable) {
        e.preventDefault();
        this.lastFocusable.focus();
      } else if (!e.shiftKey && document.activeElement === this.lastFocusable) {
        e.preventDefault();
        this.firstFocusable.focus();
      }
    }
  }

  show() {
    this.modalEl.setAttribute('aria-hidden', 'false');
    if (this.firstFocusable) this.firstFocusable.focus();
  }
  hide() {
    this.modalEl.setAttribute('aria-hidden', 'true');
    // Return focus to last known interactive element?
    // For simplicity, we leave focus as is.
  }
}
