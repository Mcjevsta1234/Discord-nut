export function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('name');
    const email = document.getElementById('email');
    const message = document.getElementById('message');
    const nameErr = document.getElementById('name-error');
    const emailErr = document.getElementById('email-error');
    const messageErr = document.getElementById('message-error');
    const success = document.getElementById('success-message');

    // Reset errors
    [nameErr, emailErr, messageErr].forEach(el => {
      if (el) el.style.display = 'none';
      el.textContent = '';
    });
    if (success) success.style.display = 'none';

    let hasError = false;

    if (!name.value.trim()) {
      nameErr.textContent = 'Name is required.';
      nameErr.style.display = 'block';
      hasError = true;
    }
    if (!email.value.trim()) {
      emailErr.textContent = 'Email is required.';
      emailErr.style.display = 'block';
      hasError = true;
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) {
      emailErr.textContent = 'Enter a valid email address.';
      emailErr.style.display = 'block';
      hasError = true;
    }
    if (!message.value.trim()) {
      messageErr.textContent = 'Message is required.';
      messageErr.style.display = 'block';
      hasError = true;
    }

    if (!hasError) {
      // Simulate send
      success.textContent = 'Thank you! Your message has been sent.';
      success.style.display = 'block';
      form.reset();
    }
  });
}
