const CACHE_NAME = 'santri-app-v1';

// Daftar file yang ingin disimpan di memori HP/Browser
// HAPUS garis miring (/) di depan agar menjadi path relatif
const urlsToCache = [
  './', // Mewakili halaman root (index.html)
  'index.html',
  'css/style.css',
  'src/app.js',
  'src/firebase.js',
  'src/auth.js',
  'src/page/about.js',
  'src/page/asrama.js',
  'src/page/dashboard.js',
  'src/page/kelompokngaji.js',
  'src/page/keuangan.js',
  'src/page/obrolan.js',
  'src/page/santri.js',
  'favicon.ico',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png'
];

// 1. Event Install: Menyimpan file ke Cache
self.addEventListener('install', event => {
  // Memaksa SW baru untuk segera mengambil alih tanpa menunggu browser ditutup
  self.skipWaiting(); 
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Membuka cache dan menyimpan aset');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('[Service Worker] Gagal menyimpan cache:', err);
      })
  );
});

// 2. Event Activate: Menghapus cache versi lama saat aplikasi di-update
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Jika nama cache tidak sama dengan versi saat ini, hapus!
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Menghapus cache lama:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Memastikan SW langsung mengontrol semua halaman yang terbuka
  return self.clients.claim(); 
});

// 3. Event Fetch: Menggunakan Cache jika ada, jika tidak ambil dari internet
self.addEventListener('fetch', event => {
  // Abaikan permintaan ke database Firebase (Firestore/Auth) agar selalu real-time
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('identitytoolkit.googleapis.com')) {
    return; // Biarkan browser yang menangani koneksi database
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika file ada di cache, gunakan itu. Jika tidak, ambil dari internet.
        return response || fetch(event.request);
      })
  );
});