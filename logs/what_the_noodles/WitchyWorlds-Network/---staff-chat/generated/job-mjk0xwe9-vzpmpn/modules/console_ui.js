export function renderLog(text) {
  const body = document.getElementById('console-body');
  const line = document.createElement('div');
  line.textContent = text;
  body.appendChild(line);
  if (!scrollLocked) autoScroll();
}

export function setStatusDot(connected) {
  const dot = document.getElementById('status-dot');
  dot.classList.toggle('console__status-dot--connected', connected);
}

let scrollLocked = false;

export function setScrollLock(lock) {
  scrollLocked = lock;
}

function autoScroll() {
  if (scrollLocked) return;
  const body = document.getElementById('console-body');
  body.scrollTop = body.scrollHeight;
}
