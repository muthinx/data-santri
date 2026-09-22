// app.js — versi final
// Router utama, manajemen auth, cleanup listener antar halaman.

import './utils/dialog.js';
import { auth, db } from './firebase.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ===== IMPORT HALAMAN =====
import { loadDashboard } from './page/dashboard.js';
import { loadSantri,        cleanupSantri }         from './page/santri.js';
import { loadKeuangan,      cleanupKeuangan }       from './page/keuangan.js';
import { loadAsrama,        cleanupAsrama }         from './page/asrama.js';
import { loadKelompokNgaji, cleanupKelompokNgaji }  from './page/kelompokngaji.js';
import { loadObrolan,       cleanupObrolan }        from './page/obrolan.js';
import { loadAbout } from './page/about.js';
import { loadPembayaran, cleanupPembayaran } from './page/pembayaran.js';

// ===== REGISTRASI HALAMAN =====
// Setiap entri: { load, title, cleanup? }
// cleanup() WAJIB mematikan semua listener halaman tersebut (Firestore / RTDB).
// Isi null kalau halaman memang tidak memasang listener.
const pages = {
  dashboard: {
    load: loadDashboard,
    title: 'Dashboard',
    cleanup: null
  },
  santri: {
    load: loadSantri,
    title: 'Data Santri',
    cleanup: cleanupSantri
  },
  keuangan: {
    load: loadKeuangan,
    title: 'Keuangan',
    cleanup: cleanupKeuangan
  },
  asrama: {
    load: loadAsrama,
    title: 'Manajemen Asrama',
    cleanup: cleanupAsrama
  },
  kelompokngaji: {
    load: loadKelompokNgaji,
    title: 'Kelompok Ngaji & Belajar',
    cleanup: cleanupKelompokNgaji
  },
  obrolan: {
    load: loadObrolan,
    title: 'Obrolan',
    cleanup: cleanupObrolan
  },
  pembayaran: {
    load: loadPembayaran,
    title: 'Pembayaran',
    cleanup: cleanupPembayaran
  },
  about: {
    load: loadAbout,
    title: 'Tentang Aplikasi',
    cleanup: null
  }
};

// ===== STATE MODUL =====
let currentPageName = null;   // halaman yang sedang aktif
let navBound = false;         // guard agar event nav hanya dipasang sekali

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker terdaftar, scope:', reg.scope))
      .catch((err) => console.error('Gagal daftar Service Worker:', err));
  });
}

// ============================================================
//  DARK MODE
// ============================================================
function initDarkMode() {
  const toggleBtn = document.getElementById('darkModeToggle');
  if (!toggleBtn) return;

  const isDark = localStorage.getItem('darkMode') === 'true';
  if (isDark) {
    document.body.classList.add('dark-mode');
    toggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
  }

  toggleBtn.addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', dark);
    toggleBtn.innerHTML = dark
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
  });
}

// ============================================================
//  SIDEBAR MOBILE
// ============================================================
function initMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('mobileMenuToggle');
  if (!sidebar || !overlay) return;

  window.__closeSidebarMobile = function () {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  };

  window.__openSidebarMobile = function () {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar.classList.contains('open')) window.__closeSidebarMobile();
      else window.__openSidebarMobile();
    });
  }

  overlay.addEventListener('click', window.__closeSidebarMobile);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) window.__closeSidebarMobile();
  });
}

// ============================================================
//  NAVIGASI
// ============================================================
function attachNavEvents() {
  if (navBound) return;
  navBound = true;

  document.querySelectorAll('.sidebar nav a').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      if (!page) return;

      await navigateTo(page);

      // Tutup sidebar di mobile
      if (window.innerWidth <= 768 && typeof window.__closeSidebarMobile === 'function') {
        window.__closeSidebarMobile();
      }
    });
  });
}

async function navigateTo(pageName) {
  if (!pages[pageName]) {
    console.warn(`Halaman "${pageName}" tidak dikenal.`);
    return;
  }

  // Kalau klik halaman yang sama, tidak perlu reload
  if (currentPageName === pageName) return;

  showLoading();
  try {
    await loadPage(pageName);
  } catch (err) {
    console.error(`Gagal memuat halaman ${pageName}:`, err);
    const container = document.getElementById('main-content');
    if (container) {
      container.innerHTML = `<p style="color:red;text-align:center;padding:2rem;">
        Gagal memuat halaman. ${err && err.message ? err.message : ''}
      </p>`;
    }
  } finally {
    hideLoading();
  }
}

async function loadPage(pageName) {
  const container = document.getElementById('main-content');
  if (!container) return;

  // 1) Bersihkan listener halaman sebelumnya
  cleanupCurrentPage(pageName);

  // 2) Update judul
  const page = pages[pageName];
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.innerText = page.title || pageName;

  // 3) Handle class khusus obrolan
  if (pageName === 'obrolan') {
    document.body.classList.add('page-chat');
  } else {
    document.body.classList.remove('page-chat');
  }

  // 4) Muat halaman baru
  await page.load(container);

  // 5) Tandai halaman aktif
  currentPageName = pageName;
  setActiveNav(pageName);
}

function setActiveNav(pageName) {
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === pageName);
  });
}

// ============================================================
//  CLEANUP LISTENER
// ============================================================
function cleanupCurrentPage(nextPageName) {
  if (!currentPageName || currentPageName === nextPageName) return;

  const page = pages[currentPageName];
  if (!page) return;

  const cleanup = page.cleanup;
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (err) {
      console.error(`Cleanup halaman "${currentPageName}" gagal:`, err);
    }
  } else if (cleanup !== null) {
    // cleanup bukan null dan bukan function — konfigurasi salah
    console.warn(`Cleanup halaman "${currentPageName}" bukan function.`);
  }
  // Kalau cleanup === null, memang tidak ada listener (mis. dashboard, about)
}

function cleanupAllPages() {
  Object.entries(pages).forEach(([name, page]) => {
    if (typeof page.cleanup === 'function') {
      try {
        page.cleanup();
      } catch (err) {
        console.error(`Cleanup "${name}" gagal:`, err);
      }
    }
  });
  currentPageName = null;
}

// ============================================================
//  AUTH
// ============================================================
function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      let displayName = user.displayName || user.email;
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().nama) {
          displayName = userDoc.data().nama;
        }
      } catch (e) {
        // Diamkan — kalau rules belum izinkan, fallback ke email.
        console.warn('Gagal baca user doc:', e.message);
      }
      window.currentAdminName = displayName;
      const nameSpan = document.getElementById('user-name-display');
      if (nameSpan) nameSpan.innerText = displayName;
      await showApp();
    } else {
      cleanupAllPages();
      showLogin();
    }
  });

  // ---- Login ----
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value;
      if (!email || !pass) {
        await window.customAlert("Email dan password wajib diisi.");
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, email, pass);
      } catch (err) {
        await window.customAlert("Login gagal: " + err.message);
      }
    });
  }

  // ---- Signup ----
  const signupBtn = document.getElementById('signup-btn');
  if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const pass = document.getElementById('signup-password').value;
      if (!name || !email || !pass) {
        await window.customAlert("Semua field wajib diisi.");
        return;
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: name });
        // Rules /users saat ini melarang write. Bungkus try-catch agar
        // signup tetap berhasil walau profil gagal disimpan.
        try {
          await setDoc(doc(db, "users", cred.user.uid), { nama: name, email });
        } catch (e) {
          console.warn('Gagal simpan profil user (cek rules /users):', e.message);
        }
        await window.customAlert("Daftar berhasil, silakan login.");
        showSignupCard(false);
      } catch (err) {
        await window.customAlert("Gagal daftar: " + err.message);
      }
    });
  }

  // ---- Logout ----
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      cleanupAllPages();
      await signOut(auth);
    });
  }

  // ---- Toggle Login / Signup ----
  const toSignup = document.getElementById('to-signup');
  const toLogin = document.getElementById('to-login');
  if (toSignup) toSignup.onclick = () => showSignupCard(true);
  if (toLogin)  toLogin.onclick  = () => showSignupCard(false);
}

function showSignupCard(show) {
  const loginCard = document.querySelector('#login-container > .login-card:not(#signup-card)');
  const signupCard = document.getElementById('signup-card');
  if (loginCard)  loginCard.style.display  = show ? 'none' : 'block';
  if (signupCard) signupCard.style.display = show ? 'block' : 'none';
}

// ============================================================
//  TAMPILAN APP / LOGIN
// ============================================================
async function showApp() {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  attachNavEvents();

  showLoading();
  try {
    // Halaman awal setelah login. Ganti ke 'dashboard' jika diinginkan.
    await loadPage('obrolan');
  } catch (err) {
    console.error('Error loading app:', err);
    const container = document.getElementById('main-content');
    if (container) {
      container.innerHTML = '<p>Gagal memuat aplikasi. Silakan refresh halaman.</p>';
    }
  } finally {
    hideLoading();
  }
}

function showLogin() {
  document.getElementById('login-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';

  // Bersihkan sisa halaman agar tidak berkedip saat login lagi
  const container = document.getElementById('main-content');
  if (container) container.innerHTML = '';
  document.body.classList.remove('page-chat');
}

// ============================================================
//  LOADING SCREEN
// ============================================================
function showLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'flex';
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'none';
}

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initMobileSidebar();
  initAuth();
});
