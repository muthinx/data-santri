import { db } from '../firebase.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Konfigurasi cache
const CACHE_KEY = 'dashboard_aggregated_data';
const CACHE_TTL = 10 * 60 * 1000; // 10 menit

// Fungsi untuk mengambil data dari cache atau fresh
async function getDashboardData() {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
            console.log('📦 Menggunakan cache dashboard');
            return data;
        }
        console.log('⏰ Cache kadaluarsa, mengambil data baru');
    }
    console.log('🔄 Mengambil data segar dari Firestore');
    // Fetch semua data paralel
    const [santriSnap, asramaSnap, kelompokSnap, keuanganSnap] = await Promise.all([
        getDocs(collection(db, "santri")),
        getDocs(collection(db, "asrama")),
        getDocs(collection(db, "kelompok")),
        getDocs(query(collection(db, "keuangan"), orderBy("tanggal", "desc")))
    ]);
    const santriList = santriSnap.docs.map(doc => doc.data());
    const asramasList = asramaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const kelompoksList = kelompokSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const transaksiList = keuanganSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Hitung semua agregat
    const totalSantri = santriList.length;
    const totalAsrama = asramasList.length;
    const totalKelompok = kelompoksList.length;
    const totalTransaksi = transaksiList.length;

    let totalPemasukan = 0, totalPengeluaran = 0;
    transaksiList.forEach(t => {
        if (t.jenis === "Pemasukan") totalPemasukan += t.jumlah;
        else totalPengeluaran += t.jumlah;
    });
    const saldo = totalPemasukan - totalPengeluaran;
    const transaksiTerbaru = transaksiList.slice(0, 5);

    // Sebaran kelas
    const kelasMap = new Map();
    // Map untuk asrama & kelompok
    const asramaCountMap = new Map();
    const kelompokNgajiCountMap = new Map();
    const kelompokBelajarCountMap = new Map();
    const kelasFormalCountMap = new Map();
    const kelasDiniyahCountMap = new Map();

    santriList.forEach(s => {
        const kelas = s.kepesantrenan?.kelasDiniyah || 'Tidak terdaftar';
        kelasMap.set(kelas, (kelasMap.get(kelas) || 0) + 1);

        if (s.kepesantrenan?.asrama) asramaCountMap.set(s.kepesantrenan.asrama, (asramaCountMap.get(s.kepesantrenan.asrama) || 0) + 1);
        if (s.kepesantrenan?.kelompokNgaji) kelompokNgajiCountMap.set(s.kepesantrenan.kelompokNgaji, (kelompokNgajiCountMap.get(s.kepesantrenan.kelompokNgaji) || 0) + 1);
        if (s.kepesantrenan?.kelompokBelajar) kelompokBelajarCountMap.set(s.kepesantrenan.kelompokBelajar, (kelompokBelajarCountMap.get(s.kepesantrenan.kelompokBelajar) || 0) + 1);
        if (s.kepesantrenan?.kelasFormal) kelasFormalCountMap.set(s.kepesantrenan.kelasFormal, (kelasFormalCountMap.get(s.kepesantrenan.kelasFormal) || 0) + 1);
        if (s.kepesantrenan?.kelasDiniyah) kelasDiniyahCountMap.set(s.kepesantrenan.kelasDiniyah, (kelasDiniyahCountMap.get(s.kepesantrenan.kelasDiniyah) || 0) + 1);
    });

    const kelasData = Array.from(kelasMap.entries()).sort((a,b) => b[1] - a[1]);

    const asramaCount = asramasList.map(as => ({
        nama: as.nama,
        count: asramaCountMap.get(as.nama) || 0
    })).sort((a,b) => b.count - a.count).slice(0, 3);

    const kelompokCount = kelompoksList.map(k => {
        let count = 0;
        if (k.jenis === 'Ngaji') count = kelompokNgajiCountMap.get(k.nama) || 0;
        else if (k.jenis === 'Belajar') count = kelompokBelajarCountMap.get(k.nama) || 0;
        else if (k.jenis === 'Diniyah') count = kelasDiniyahCountMap.get(k.nama) || 0;
        else count = kelasFormalCountMap.get(k.nama) || 0;
        return { nama: k.nama, jenis: k.jenis, count };
    }).sort((a,b) => b.count - a.count).slice(0, 3);

    const aggregatedData = {
        totalSantri, totalAsrama, totalKelompok, totalTransaksi,
        totalPemasukan, totalPengeluaran, saldo,
        transaksiTerbaru,
        kelasData,
        asramaCount,
        kelompokCount
    };

    // Simpan ke cache
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        data: aggregatedData,
        timestamp: Date.now()
    }));
    return aggregatedData;
}

export async function loadDashboard(container) {
    // Tampilkan loading
    container.innerHTML = `
        <div style="display:flex; justify-content:center; padding: 3rem; color: var(--primary);">
            <i class="fas fa-spinner fa-spin fa-2x"></i>
        </div>
    `;

    try {
        const data = await getDashboardData();
        
        // Render HTML (sama seperti sebelumnya, menggunakan data)
        container.innerHTML = `
            <div class="dashboard-container">
                <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem;">
                    <button id="manualRefreshBtn" class="btn-secondary" style="padding: 0.3rem 0.8rem;">
                        <i class="fas fa-sync-alt"></i> Refresh Data
                    </button>
                </div>
                <div class="stats-grid">
                    <div class="stat-card">
                        <i class="fas fa-users"></i>
                        <div class="stat-number">${data.totalSantri}</div>
                        <div class="stat-label">Total Santri</div>
                    </div>
                    <div class="stat-card">
                        <i class="fas fa-building"></i>
                        <div class="stat-number">${data.totalAsrama}</div>
                        <div class="stat-label">Asrama</div>
                    </div>
                    <div class="stat-card">
                        <i class="fas fa-book-quran"></i>
                        <div class="stat-number">${data.totalKelompok}</div>
                        <div class="stat-label">Kelompok</div>
                    </div>
                    <div class="stat-card">
                        <i class="fas fa-coins"></i>
                        <div class="stat-number">${data.totalTransaksi}</div>
                        <div class="stat-label">Transaksi</div>
                    </div>
                </div>

                <div class="finance-summary">
                    <div class="finance-card pemasukan">
                        <i class="fas fa-arrow-up"></i>
                        <div>Pemasukan</div>
                        <strong>Rp ${data.totalPemasukan.toLocaleString('id-ID')}</strong>
                    </div>
                    <div class="finance-card pengeluaran">
                        <i class="fas fa-arrow-down"></i>
                        <div>Pengeluaran</div>
                        <strong>Rp ${data.totalPengeluaran.toLocaleString('id-ID')}</strong>
                    </div>
                    <div class="finance-card saldo">
                        <i class="fas fa-wallet"></i>
                        <div>Saldo</div>
                        <strong>Rp ${data.saldo.toLocaleString('id-ID')}</strong>
                    </div>
                </div>

                <div class="dashboard-grid">
                    <div class="dashboard-card">
                        <h3><i class="fas fa-chart-bar"></i> Sebaran Kelas Diniyah</h3>
                        <div class="kelas-list">
                            ${data.kelasData.map(([kelas, jumlah]) => {
                                const percent = data.totalSantri === 0 ? 0 : (jumlah / data.totalSantri * 100).toFixed(1);
                                return `
                                    <div class="kelas-item">
                                        <span class="kelas-name">${escapeHtml(kelas)}</span>
                                        <div class="progress-bar">
                                            <div class="progress-fill" style="width: ${percent}%"></div>
                                        </div>
                                        <span class="kelas-count">${jumlah} santri (${percent}%)</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div class="dashboard-card">
                        <h3><i class="fas fa-history"></i> Transaksi Terbaru</h3>
                        <div class="transaksi-list">
                            ${data.transaksiTerbaru.length ? data.transaksiTerbaru.map(t => `
                                <div class="transaksi-item">
                                    <div class="transaksi-info">
                                        <strong>${escapeHtml(t.namaSantri || t.keterangan || 'Transaksi')}</strong>
                                        <small>${t.tanggal}</small>
                                    </div>
                                    <span class="transaksi-jumlah ${t.jenis === 'Pemasukan' ? 'plus' : 'minus'}">
                                        ${t.jenis === 'Pemasukan' ? '+' : '-'} Rp ${t.jumlah.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            `).join('') : '<p>Belum ada transaksi</p>'}
                        </div>
                        <a href="#" data-page="keuangan" class="view-all">Lihat semua →</a>
                    </div>

                    <div class="dashboard-card">
                        <h3><i class="fas fa-building"></i> Asrama Terpadat</h3>
                        <div class="asrama-list">
                            ${data.asramaCount.length ? data.asramaCount.map(a => `
                                <div class="populer-item">
                                    <span>${escapeHtml(a.nama)}</span>
                                    <span class="badge">${a.count} santri</span>
                                </div>
                            `).join('') : '<p>Belum ada asrama</p>'}
                        </div>
                        <a href="#" data-page="asrama" class="view-all">Kelola asrama →</a>
                    </div>

                    <div class="dashboard-card">
                        <h3><i class="fas fa-users"></i> Kelompok Teraktif</h3>
                        <div class="kelompok-list">
                            ${data.kelompokCount.length ? data.kelompokCount.map(k => `
                                <div class="populer-item">
                                    <span>${escapeHtml(k.nama)} <small>(${k.jenis})</small></span>
                                    <span class="badge">${k.count} anggota</span>
                                </div>
                            `).join('') : '<p>Belum ada kelompok</p>'}
                        </div>
                        <a href="#" data-page="kelompokngaji" class="view-all">Kelola kelompok →</a>
                    </div>
                </div>
            </div>
        `;

        // Tombol refresh manual
        const refreshBtn = document.getElementById('manualRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                sessionStorage.removeItem(CACHE_KEY);
                loadDashboard(container); // reload dashboard fresh
            });
        }

        // Event view all
        document.querySelectorAll('.view-all').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                if (page) {
                    const navLink = document.querySelector(`.sidebar nav a[data-page="${page}"]`);
                    if (navLink) navLink.click();
                }
            });
        });

    } catch (error) {
        console.error("Gagal memuat dashboard:", error);
        container.innerHTML = `<p style="color:red; text-align:center;">Gagal memuat data: ${error.message}</p>`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
