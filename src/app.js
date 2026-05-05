import './utils/dialog.js';
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Import halaman
import { loadDashboard } from './page/dashboard.js';
import { loadSantri } from './page/santri.js';
import { loadKeuangan } from './page/keuangan.js';
import { loadAsrama } from './page/asrama.js';
import { loadKelompokNgaji } from './page/kelompokngaji.js';
import { loadAbout } from './page/about.js';
import { loadObrolan } from './page/obrolan.js';

const pages = {
    dashboard: loadDashboard,
    santri: loadSantri,
    keuangan: loadKeuangan,
    asrama: loadAsrama,
    kelompokngaji: loadKelompokNgaji,
    obrolan: loadObrolan,
    about: loadAbout
};

// ========== DARK MODE ==========
function initDarkMode() {
    const toggleBtn = document.getElementById('darkModeToggle');
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        toggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }
    toggleBtn.addEventListener('click', () => {
        const dark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', dark);
        toggleBtn.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    });
}

// ========== SIDEBAR MOBILE (tutup otomatis setelah klik link) ==========
function initMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const toggleBtn = document.getElementById('mobileMenuToggle');
    const navLinks = document.querySelectorAll('.sidebar nav a');

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        });
    }
    if (overlay) overlay.addEventListener('click', closeSidebar);
    // Tutup sidebar saat link diklik
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });
    // Tutup saat resize ke desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeSidebar();
    });
}

// ========== AUTH ==========
function showApp() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    loadPage('dashboard');
    attachNavEvents();
}

function showLogin() {
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function attachNavEvents() {
    document.querySelectorAll('.sidebar nav a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            if (page) loadPage(page);
            document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
            link.classList.add('active');
        });
    });
}

async function loadPage(pageName) {
    const container = document.getElementById('main-content');
    const titleMap = {
        dashboard: 'Dashboard', santri: 'Data Santri', keuangan: 'Keuangan',
        asrama: 'Manajemen Asrama', kelompokngaji: 'Kelompok Ngaji & Belajar', 
        about: 'Tentang Aplikasi', obrolan: 'Obrolan'
    };
    document.getElementById('page-title').innerText = titleMap[pageName] || pageName;
    
    // Tambah/hapus class untuk halaman obrolan
    if (pageName === 'obrolan') {
        document.body.classList.add('page-chat');
    } else {
        document.body.classList.remove('page-chat');
    }
    
    if (pages[pageName]) {
        await pages[pageName](container);
    } else {
        container.innerHTML = '<p>Halaman tidak ditemukan</p>';
    }
}

// Inisialisasi auth
function initAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            let displayName = user.email;
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists() && userDoc.data().nama) displayName = userDoc.data().nama;
            } catch(e) { console.error(e); }
            window.currentAdminName = displayName;
            const nameSpan = document.getElementById('user-name-display');
            if (nameSpan) nameSpan.innerText = displayName;
            showApp();
        } else {
            showLogin();
        }
    });

    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch(err) { alert("Login gagal: " + err.message); }
    });

    // Signup (optional, jika ingin tetap ada)
    const signupBtn = document.getElementById('signup-btn');
    if (signupBtn) {
        signupBtn.addEventListener('click', async () => {
            const name = document.getElementById('signup-name').value;
            const email = document.getElementById('signup-email').value;
            const pass = document.getElementById('signup-password').value;
            try {
                const cred = await createUserWithEmailAndPassword(auth, email, pass);
                await updateProfile(cred.user, { displayName: name });
                await setDoc(doc(db, "users", cred.user.uid), { nama: name, email });
                alert("Daftar berhasil, silakan login.");
                document.getElementById('signup-card').style.display = 'none';
                document.querySelector('.login-card').style.display = 'block';
            } catch(err) { alert("Gagal: " + err.message); }
        });
    }

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut(auth);
    });

    // Toggle login/signup (jika ada)
    const toSignup = document.getElementById('to-signup');
    const toLogin = document.getElementById('to-login');
    if (toSignup) toSignup.onclick = () => {
        document.querySelector('.login-card').style.display = 'none';
        document.getElementById('signup-card').style.display = 'block';
    };
    if (toLogin) toLogin.onclick = () => {
        document.getElementById('signup-card').style.display = 'none';
        document.querySelector('.login-card').style.display = 'block';
    };
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    initMobileSidebar();
    initAuth();
});
