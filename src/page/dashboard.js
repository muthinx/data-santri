import { db } from '../firebase.js';
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function loadDashboard(container) {
    // Ambil semua data yang dibutuhkan
    const santriSnap = await getDocs(collection(db, "santri"));
    const asramaSnap = await getDocs(collection(db, "asrama"));
    const kelompokSnap = await getDocs(collection(db, "kelompok"));
    const transaksiSnap = await getDocs(query(collection(db, "keuangan"), orderBy("tanggal", "desc"), limit(5)));

    const totalSantri = santriSnap.size;
    const totalAsrama = asramaSnap.size;
    const totalKelompok = kelompokSnap.size;
    const totalTransaksi = transaksiSnap.size;

    // Hitung total pemasukan & pengeluaran (dari semua transaksi)
    let totalPemasukan = 0, totalPengeluaran = 0;
    const allTransaksi = await getDocs(collection(db, "keuangan"));
    allTransaksi.forEach(doc => {
        const t = doc.data();
        if (t.jenis === "Pemasukan") totalPemasukan += t.jumlah;
        else totalPengeluaran += t.jumlah;
    });
    const saldo = totalPemasukan - totalPengeluaran;

    // Hitung sebaran kelas diniyah
    const kelasMap = new Map();
    santriSnap.forEach(doc => {
        const kelas = doc.data().kepesantrenan?.kelasDiniyah || 'Tidak terdaftar';
        kelasMap.set(kelas, (kelasMap.get(kelas) || 0) + 1);
    });
    const kelasData = Array.from(kelasMap.entries()).sort((a,b) => b[1] - a[1]);

    // Data untuk transaksi terbaru
    const transaksiTerbaru = [];
    transaksiSnap.forEach(doc => {
        transaksiTerbaru.push({ id: doc.id, ...doc.data() });
    });

    // HTML dashboard
    container.innerHTML = `
        <div class="dashboard-container">
            <!-- Statistik Utama -->
            <div class="stats-grid">
                <div class="stat-card">
                    <i class="fas fa-users"></i>
                    <div class="stat-number">${totalSantri}</div>
                    <div class="stat-label">Total Santri</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-building"></i>
                    <div class="stat-number">${totalAsrama}</div>
                    <div class="stat-label">Asrama</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-book-quran"></i>
                    <div class="stat-number">${totalKelompok}</div>
                    <div class="stat-label">Kelompok</div>
                </div>
                <div class="stat-card">
                    <i class="fas fa-coins"></i>
                    <div class="stat-number">${totalTransaksi}</div>
                    <div class="stat-label">Transaksi</div>
                </div>
            </div>

            <!-- Keuangan Ringkas -->
            <div class="finance-summary">
                <div class="finance-card pemasukan">
                    <i class="fas fa-arrow-up"></i>
                    <div>Pemasukan</div>
                    <strong>Rp ${totalPemasukan.toLocaleString()}</strong>
                </div>
                <div class="finance-card pengeluaran">
                    <i class="fas fa-arrow-down"></i>
                    <div>Pengeluaran</div>
                    <strong>Rp ${totalPengeluaran.toLocaleString()}</strong>
                </div>
                <div class="finance-card saldo">
                    <i class="fas fa-wallet"></i>
                    <div>Saldo</div>
                    <strong>Rp ${saldo.toLocaleString()}</strong>
                </div>
            </div>

            <div class="dashboard-grid">
                <!-- Sebaran Kelas Diniyah -->
                <div class="dashboard-card">
                    <h3><i class="fas fa-chart-bar"></i> Sebaran Kelas Diniyah</h3>
                    <div class="kelas-list">
                        ${kelasData.map(([kelas, jumlah]) => {
                            const percent = (jumlah / totalSantri * 100).toFixed(1);
                            return `
                                <div class="kelas-item">
                                    <span class="kelas-name">${kelas}</span>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${percent}%"></div>
                                    </div>
                                    <span class="kelas-count">${jumlah} santri (${percent}%)</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Transaksi Terbaru -->
                <div class="dashboard-card">
                    <h3><i class="fas fa-history"></i> Transaksi Terbaru</h3>
                    <div class="transaksi-list">
                        ${transaksiTerbaru.length ? transaksiTerbaru.map(t => `
                            <div class="transaksi-item">
                                <div class="transaksi-info">
                                    <strong>${t.namaSantri}</strong>
                                    <small>${t.tanggal}</small>
                                </div>
                                <span class="transaksi-jumlah ${t.jenis === 'Pemasukan' ? 'plus' : 'minus'}">
                                    ${t.jenis === 'Pemasukan' ? '+' : '-'} Rp ${t.jumlah.toLocaleString()}
                                </span>
                            </div>
                        `).join('') : '<p>Belum ada transaksi</p>'}
                    </div>
                    <a href="#" data-page="keuangan" class="view-all">Lihat semua →</a>
                </div>

                <!-- Asrama Populer (jumlah anggota terbanyak) -->
                <div class="dashboard-card">
                    <h3><i class="fas fa-building"></i> Asrama Terpadat</h3>
                    <div class="asrama-list" id="asrama-populer">
                        Memuat...
                    </div>
                    <a href="#" data-page="asrama" class="view-all">Kelola asrama →</a>
                </div>

                <!-- Kelompok Terbanyak -->
                <div class="dashboard-card">
                    <h3><i class="fas fa-users"></i> Kelompok Teraktif</h3>
                    <div class="kelompok-list" id="kelompok-teraktif">
                        Memuat...
                    </div>
                    <a href="#" data-page="kelompokngaji" class="view-all">Kelola kelompok →</a>
                </div>
            </div>
        </div>
    `;

    // Load asrama populer & kelompok teraktif secara async
    loadTopAsrama();
    loadTopKelompok();

    // Function untuk mengambil asrama dengan anggota terbanyak
    async function loadTopAsrama() {
        const asramaSnap = await getDocs(collection(db, "asrama"));
        const asramas = asramaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Hitung jumlah anggota dari koleksi santri
        const santriAll = await getDocs(collection(db, "santri"));
        const santriList = santriAll.docs.map(d => d.data());
        const asramaCount = asramas.map(as => ({
            nama: as.nama,
            count: santriList.filter(s => s.kepesantrenan?.asrama === as.nama).length
        })).sort((a,b) => b.count - a.count).slice(0, 3);
        
        const containerAsrama = document.getElementById('asrama-populer');
        if (asramaCount.length) {
            containerAsrama.innerHTML = asramaCount.map(a => `
                <div class="populer-item">
                    <span>${a.nama}</span>
                    <span class="badge">${a.count} santri</span>
                </div>
            `).join('');
        } else {
            containerAsrama.innerHTML = '<p>Belum ada asrama</p>';
        }
    }

    async function loadTopKelompok() {
        const kelompokSnap = await getDocs(collection(db, "kelompok"));
        const kelompoks = kelompokSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const santriAll = await getDocs(collection(db, "santri"));
        const santriList = santriAll.docs.map(d => d.data());

        const kelompokCount = kelompoks.map(k => {
            let count = 0;
            if (k.jenis === 'Ngaji') count = santriList.filter(s => s.kepesantrenan?.kelompokNgaji === k.nama).length;
            else if (k.jenis === 'Belajar') count = santriList.filter(s => s.kepesantrenan?.kelompokBelajar === k.nama).length;
            else count = santriList.filter(s => s.kepesantrenan?.kelasFormal === k.nama).length;
            return { nama: k.nama, jenis: k.jenis, count };
        }).sort((a,b) => b.count - a.count).slice(0, 3);

        const containerKelompok = document.getElementById('kelompok-teraktif');
        if (kelompokCount.length) {
            containerKelompok.innerHTML = kelompokCount.map(k => `
                <div class="populer-item">
                    <span>${k.nama} <small>(${k.jenis})</small></span>
                    <span class="badge">${k.count} anggota</span>
                </div>
            `).join('');
        } else {
            containerKelompok.innerHTML = '<p>Belum ada kelompok</p>';
        }
    }

    // Event delegation untuk navigasi (jika ada view-all)
    document.querySelectorAll('.view-all').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            if (page) {
                // Panggil fungsi global untuk ganti halaman (dari app.js)
                if (typeof window.navigateTo === 'function') window.navigateTo(page);
                else {
                    // Trigger klik manual pada sidebar link
                    const navLink = document.querySelector(`.sidebar nav a[data-page="${page}"]`);
                    if (navLink) navLink.click();
                }
            }
        });
    });
}