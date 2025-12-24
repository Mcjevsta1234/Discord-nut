(function () {
  // Theme colors and config
  const THEME = {
    bgCream: '#FAF4E4',
    accentGreen: '#5C8B5B',
    focusRing: '#FF4C4C'
  };

  const APP_STATE = {
    currentPlan: null,
    modalOpen: false,
    menuOpen: false,
    blogData: []
  };

  // DOM selectors
  const selectors = {
    heroTitle: document.getElementById('heroTitle'),
    heroCTA: document.getElementById('heroCTA'),
    planSignup: document.querySelectorAll('.plan-signup'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalClose: document.getElementById('modalClose'),
    signupForm: document.getElementById('signupForm'),
    username: document.getElementById('username'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    confirmPassword: document.getElementById('confirmPassword'),
    selectedPlan: document.getElementById('selectedPlan'),
    accordionHeaders: document.querySelectorAll('.accordion-header'),
    contactForm: document.getElementById('contactForm'),
    contactName: document.getElementById('contactName'),
    contactEmail: document.getElementById('contactEmail'),
    contactMessage: document.getElementById('contactMessage'),
    blogGrid: document.getElementById('blogGrid'),
    hamburger: document.querySelector('.hamburger'),
    navList: document.querySelector('.nav-list'),
    toast: document.getElementById('toast')
  };

  // Utility functions
  const showToast = (message) => {
    selectors.toast.textContent = message;
    selectors.toast.classList.add('show');
    setTimeout(() => selectors.toast.classList.remove('show'), 3000);
  };

  const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const closeModal = () => {
    selectors.modalOverlay.setAttribute('aria-hidden', 'true');
    APP_STATE.modalOpen = false;
    selectors.modalOverlay.style.display = 'none';
    selectors.signupForm.reset();
    // Restore focus to trigger button
    const triggerBtn = document.querySelector(`[data-plan="${APP_STATE.currentPlan}"]`);
    if (triggerBtn) triggerBtn.focus();
  };

  const openModal = (plan) => {
    APP_STATE.currentPlan = plan;
    selectors.selectedPlan.value = plan;
    selectors.modalOverlay.style.display = 'flex';
    selectors.modalOverlay.setAttribute('aria-hidden', 'false');
    APP_STATE.modalOpen = true;
    const firstInput = selectors.username;
    if (firstInput) firstInput.focus();
  };

  const toggleMenu = () => {
    APP_STATE.menuOpen = !APP_STATE.menuOpen;
    selectors.navList.setAttribute('aria-hidden', String(!APP_STATE.menuOpen));
    selectors.hamburger.setAttribute('aria-expanded', String(APP_STATE.menuOpen));
    if (APP_STATE.menuOpen) {
      selectors.navList.style.transform = 'translateX(0)';
    } else {
      selectors.navList.style.transform = 'translateX(-100%)';
    }
  };

  // Modal interactions
  selectors.hamburger.addEventListener('click', toggleMenu);
  selectors.modalClose.addEventListener('click', closeModal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && APP_STATE.modalOpen) {
      closeModal();
    }
    if (APP_STATE.menuOpen && e.key === 'Escape') {
      toggleMenu();
    }
  });

  // Focus trap for modal
  selectors.modalOverlay.addEventListener('keydown', (e) => {
    if (!APP_STATE.modalOpen) return;
    const focusableEls = selectors.modalOverlay.querySelectorAll('input, button, [tabindex]:not([tabindex="-1"])');
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });

  // Plan sign up
  selectors.planSignup.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const plan = e.currentTarget.getAttribute('data-plan');
      openModal(plan);
    });
  });

  // Form validation
  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validatePassword = (password) => password.length >= 8;

  const clearErrors = () => {
    document.querySelectorAll('.error-text').forEach(el => el.textContent = '');
  };

  const setFieldError = (field, message) => {
    const errorEl = document.getElementById(field + 'Error');
    if (errorEl) errorEl.textContent = message;
  };

  selectors.signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    let valid = true;

    if (!selectors.username.value.trim()) {
      setFieldError('username', 'Username is required.');
      valid = false;
    }

    if (!validateEmail(selectors.email.value)) {
      setFieldError('email', 'Please enter a valid email address.');
      valid = false;
    }

    if (!validatePassword(selectors.password.value)) {
      setFieldError('password', 'Password must be at least 8 characters.');
      valid = false;
    }

    if (selectors.password.value !== selectors.confirmPassword.value) {
      setFieldError('confirmPassword', 'Passwords do not match.');
      valid = false;
    }

    if (valid) {
      showToast('Sign up successful! Welcome to your cottage.');
      closeModal();
    }
  });

  selectors.contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    let valid = true;

    if (!selectors.contactName.value.trim()) {
      setFieldError('contactName', 'Name is required.');
      valid = false;
    }

    if (!validateEmail(selectors.contactEmail.value)) {
      setFieldError('contactEmail', 'Please enter a valid email address.');
      valid = false;
    }

    if (!selectors.contactMessage.value.trim()) {
      setFieldError('contactMessage', 'Message is required.');
      valid = false;
    }

    if (valid) {
      showToast('Message sent successfully!');
      selectors.contactForm.reset();
    }
  });

  // Accordion
  selectors.accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const expanded = header.getAttribute('aria-expanded') === 'true';
      const panel = document.getElementById(header.getAttribute('aria-controls'));

      // Close all
      selectors.accordionHeaders.forEach(h => {
        h.setAttribute('aria-expanded', 'false');
        const p = document.getElementById(h.getAttribute('aria-controls'));
        p.style.maxHeight = '0';
      });

      if (!expanded) {
        header.setAttribute('aria-expanded', 'true');
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  });

  // Blog loader
  const loadBlog = async () => {
    try {
      const res = await fetch('assets/blog/posts.json');
      if (!res.ok) throw new Error('Failed to load blog data');
      const data = await res.json();
      APP_STATE.blogData = data;
      renderBlog();
    } catch (err) {
      console.warn('Blog data not available, using fallback content.');
      APP_STATE.blogData = [
        { id: 1, title: 'Welcome to Our Cottage', excerpt: 'First post about cozy hosting.', img: 'assets/images/blog/thumbnail1.jpg' },
        { id: 2, title: 'Tips for Beginners', excerpt: 'How to set up your first server.', img: 'assets/images/blog/thumbnail2.jpg' },
        { id: 3, title: 'Seasonal Events', excerpt: 'Celebrate in-game holidays.', img: 'assets/images/blog/thumbnail3.jpg' },
        { id: 4, title: 'Plugin Spotlight', excerpt: 'Discover useful plugins.', img: 'assets/images/blog/thumbnail4.jpg' }
      ];
      renderBlog();
    }
  };

  const renderBlog = () => {
    selectors.blogGrid.innerHTML = APP_STATE.blogData.map(post => `
      <article class="blog-card">
        <img src="${post.img}" alt="${post.title} image" loading="lazy">
        <div class="blog-card-content">
          <h3>${post.title}</h3>
          <p>${post.excerpt}</p>
        </div>
      </article>
    `).join('');
  };

  // Skip link focus management
  document.querySelector('.skip-link').addEventListener('click', (e) => {
    const target = document.querySelector('#main-content');
    target.focus();
  });

  // Hero animation timing
  if (!isReducedMotion()) {
    // Fade‑in already handled via CSS keyframes; nothing extra needed.
  }

  // Initialize
  loadBlog();

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    selectors.navList.style.transform = 'translateX(-100%)';
  });

})();
