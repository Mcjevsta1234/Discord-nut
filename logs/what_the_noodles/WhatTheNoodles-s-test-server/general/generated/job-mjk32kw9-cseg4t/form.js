import { sanitize } from './utils.js';

function validateEmail(email) {
  const re = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(String(email).toLowerCase());
}

function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.elements.name?.value.trim() || '';
  const email = form.elements.email?.value.trim() || '';
  const message = form.elements.message?.value.trim() || '';

  clearError('name-error');
  clearError('email-error');
  clearError('message-error');

  let valid = true;

  if (!name) {
    showError('name-error', 'Name is required.');
    valid = false;
  }
  if (!email) {
    showError('email-error', 'Email is required.');
    valid = false;
  } else if (!validateEmail(email)) {
    showError('email-error', 'Please enter a valid email address.');
    valid = false;
  }
  if (!message) {
    showError('message-error', 'Message is required.');
    valid = false;
  }

  if (!valid) return;

  // Mock submission
  try {
    // Sanitize inputs
    const payload = {
      name: sanitize(name),
      email: sanitize(email),
      message: sanitize(message)
    };
    console.log('Form payload:', payload);
    alert('Your message has been sent.');
    form.reset();
  } catch (err) {
    console.error('Form submit error:', err);
    alert('Failed to send message.');
  }
}

export function init() {
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }
}
