import { db } from '../firebase.js';
import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function loadAbout(container) {
    // Ambil statistik real-time dari Firestore
    const santriCount = await getCountFromServer(collection(db, "santri"));
    const asramaCount = await getCountFromServer(collection(db, "asrama"));
    const kelompokCount = await getCountFromServer(collection(db, "kelompok"));
    const keuanganCount = await getCountFromServer(collection(db, "keuangan"));

    container.innerHTML = `
        <div class="about-container">
            <div class="about-hero">
                <i class="fas fa-mosque about-icon"></i>
                <h1>Sistem Informasi Pondok Pesantren</h1>
                <p>Versi 2.0.0 | Modern, Cepat, dan Mudah Digunakan</p>
            </div>

            <div class="stats-grid-about">
                <div class="stat-card">
                    <i class="fas fa-users"></i>
                    <div class="stat-number">${santriCount.data().count}</div>
                    <div class="stat-label">Total Santri</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-building"></i>
                    <div class="stat-number">${asramaCount.data().count}</div>
                    <div class="stat-label">Asrama</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-book-quran"></i>
                    <div class="stat-number">${kelompokCount.data().count}</div>
                    <div class="stat-label">Kelompok Belajar</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-coins"></i>
                    <div class="stat-number">${keuanganCount.data().count}</div>
                    <div class="stat-label">Transaksi Keuangan</div>
                </div>
            </div>

            <div class="about-grid">
                <div class="about-card">
                    <h3><i class="fas fa-info-circle"></i> Tentang Aplikasi</h3>
                    <p>Aplikasi ini dirancang khusus untuk mengelola data santri, asrama, kelompok belajar, dan keuangan pondok pesantren secara digital.</p>
                    <p><strong>Fitur Unggulan:</strong></p>
                    <ul>
                        <li>CRUD data santri dengan detail lengkap</li>
                        <li>Pengelolaan asrama & kelompok (ngaji, belajar, formal)</li>
                        <li>Riwayat keuangan dengan saldo otomatis per santri</li>
                        <li>Ekspor & impor data CSV untuk santri</li>
                        <li>Tampilan responsif & dark mode</li>
                        <li>Autentikasi aman via Firebase Auth</li>
                    </ul>
                </div>

                <div class="about-card">
                    <h3><i class="fas fa-question-circle"></i> Panduan Penggunaan</h3>
                    <div class="accordion">
                        <div class="accordion-item">
                            <div class="accordion-header">📋 Menu Santri</div>
                            <div class="accordion-body">
                                Tambah, edit, hapus data santri lengkap. Bisa ekspor/impor CSV. Di mode mobile, aksi edit ada di tombol Edit. Untuk hapus, buka form edit lalu klik Hapus.
                            </div>
                        </div>
                        <div class="accordion-item">
                            <div class="accordion-header">💰 Menu Keuangan</div>
                            <div class="accordion-body">
                                Catat pemasukan/pengeluaran per santri. Klik nama santri di histori untuk melihat detail saldo dan transaksinya. Saldo dihitung otomatis berdasarkan urutan transaksi.
                            </div>
                        </div>
                        <div class="accordion-item">
                            <div class="accordion-header">🏠 Menu Asrama & 📖 Kelompok Ngaji</div>
                            <div class="accordion-body">
                                Kelola asrama dan kelompok. Setiap entitas memiliki jumlah anggota yang terupdate otomatis. Klik "Anggota" untuk melihat daftar santri yang terdaftar.
                            </div>
                        </div>
                    </div>
                </div>

                <div class="about-card">
                    <h3><i class="fas fa-cogs"></i> Teknologi yang Digunakan</h3>
                    <div class="tech-stack">
                        <span class="tech-badge">HTML5</span>
                        <span class="tech-badge">CSS3 (Custom)</span>
                        <span class="tech-badge">JavaScript (ES Modules)</span>
                        <span class="tech-badge">Firebase Auth</span>
                        <span class="tech-badge">Firestore Database</span>
                        <span class="tech-badge">Font Awesome 6</span>
                    </div>
                    <p class="mt-2"><strong>Developer:</strong> Tim IT Pondok Pesantren</p>
                </div>

                <div class="about-card">
                    <h3><i class="fas fa-headset"></i> Dukungan & Bantuan</h3>
                    <p>Jika mengalami kendala atau memiliki saran, silakan hubungi:</p>
                    <ul>
                        <li><i class="fas fa-envelope"></i> Email: support@ponpes.app</li>
                        <li><i class="fab fa-whatsapp"></i> WhatsApp: +62 812-3456-7890</li>
                        <li><i class="fab fa-github"></i> GitHub: github.com/ponpes-system</li>
                    </ul>
                    <p class="mt-2"><small>&copy; 2024 - 2025. All rights reserved.</small></p>
                </div>
            </div>
        </div>
    `;

    // Inisialisasi accordion
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            // Tutup semua body terlebih dahulu
            document.querySelectorAll('.accordion-body').forEach(body => {
                if (body !== header.nextElementSibling) body.style.display = 'none';
            });
            const body = header.nextElementSibling;
            const isOpen = body.style.display === 'block';
            body.style.display = isOpen ? 'none' : 'block';
        });
    });
}