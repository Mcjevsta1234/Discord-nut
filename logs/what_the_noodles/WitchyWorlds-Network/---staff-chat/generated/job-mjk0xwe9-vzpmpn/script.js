import { initNavigation, toggleScrollLock, showToast } from './modules/ui.js';
import { initConsole, sendCommand } from './modules/console.js';

// Initialize navigation
initNavigation();

// Initialize console if on index.html
if (window.location.pathname.endsWith('index.html')) {
  try {
    initConsole();
  } catch (e) {
    showToast('Failed to load console: ' + e.message);
  }
}

// Initialize plan modals if on plans.html
if (window.location.pathname.endsWith('plans.html')) {
  initPlanModals();
}

// Initialize command validation
setupCommandInput();

function setupCommandInput() {
  const input = document.getElementById('console-input');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (!cmd) return;
      handleCommand(cmd);
      input.value = '';
    }
  });
}

function handleCommand(cmd) {
  const allowed = [
    /^\/spark profiler$/i,
    /^\/spark tps$/i,
    /^\/spark healthreport\s+--memory$/i,
    /^\/list$/i,
    /^\/help/i
  ];
  const disallowed = [\s*\/stop\s*$\, \s*\/op\s*$\, \s*\/restart\s*$\, \s*\/kill\s*$\, \s*\/console\s*$\];
  const lower = cmd.toLowerCase();
  if (disallowed.some(r => r.test(lower))) {
    showCommandDeniedModal();
    return;
  }
  if (!allowed.some(r => r.test(cmd))) {
    showToast('Command not recognized or not permitted');
    return;
  }
  sendCommand(cmd);
}

function showCommandDeniedModal() {
  const modal = document.getElementById('command-denied-modal');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('.modal__overlay').focus();
}

function initPlanModals() {
  const btns = document.querySelectorAll('.plan-card__btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan;
      openConfirmModal(plan);
    });
  });

  const confirmModal = document.getElementById('confirm-modal');
  const overlay = confirmModal.querySelector('.modal__overlay');
  const cancel = document.getElementById('confirm-cancel');
  const submit = document.getElementById('confirm-submit');

  function closeModal() {
    confirmModal.setAttribute('aria-hidden', 'true');
  }

  overlay.addEventListener('click', closeModal);
  cancel.addEventListener('click', closeModal);
  submit.addEventListener('click', () => {
    showToast('Plan selected! Thanks for choosing us.');
    closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openConfirmModal(planId) {
  const nameMap = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };
  document.getElementById('selected-plan-name').textContent = nameMap[planId] || planId;
  document.getElementById('confirm-modal').setAttribute('aria-hidden', 'false');
}
