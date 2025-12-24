const CACHE_NAME = 'mh-static-v1';
const URLS = [
  '/',
  '/index.html',
  '/plans.html',
  '/about.html',
  '/styles.css',
  '/config.js',
  '/utils.js',
  '/nav.js',
  '/console.js',
  '/form.js',
  '/favicon.png',
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  'https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSsV7T28t.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css',
  'https://kit.fontawesome.com/0c9c25770b.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
