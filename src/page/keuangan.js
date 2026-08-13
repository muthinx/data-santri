// keuangan.js - Menampilkan daftar santri dengan saldo terakhir
// Fitur: paginasi client-side, real-time (refresh otomatis), filter kelas & pencarian nama, detail transaksi santri
// Versi tanpa tombol hapus semua transaksi
import { db, auth } from '../firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  getDoc, getDocs, query, where, orderBy, limit, startAfter,
  writeBatch, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeSantri = null;
let unsubscribeTransaksi = null;
let currentEditId = null;
let currentTransaksiId = null;

// Konfigurasi paginasi
const PAGE_SIZE = 40;
let currentPage = 1;
let totalDocuments = 0;

// State filter & sortir
let filterState = {
    kelas: 'Semua',
    search: ''
};
let sortState = 'kelasAsc';

// Cache data santri & transaksi
let allSantri = [];
let allTransaksi = [];
let santriSaldoMap = new Map();

// Fungsi utama memuat halaman keuangan (daftar santri + saldo)
export function loadKeuangan(container) {
    renderKeuanganPage(container);
    currentPage = 1;
    subscribeSantriDanTransaksi();
}

// ===== RENDER UI =====
function renderKeuanganPage(container) {
    container.innerHTML = `
        <div id="keuangan-page-container">
            <div id="keuangan-header-actions">
                <div class="header-left-buttons">
                    <button id="btnTambahTransaksi" class="btn-primary"><i class="fas fa-plus"></i></button>
                    <button id="btnFilterKeuangan" class="btn-secondary"><i class="fas fa-sliders-h"></i></button>
                </div>
                <div class="search-wrapper">
                    <i class="fas fa-search search-icon"></i>
                    <input type="text" id="searchKeuangan" placeholder="Cari nama santri..." class="search-input">
                </div>
                <div class="header-right-buttons desktop-only">
                    <button id="btnExportKeuanganCSV" class="btn-secondary"><i class="fas fa-download"></i> Ekspor CSV</button>
                    <button id="btnImportKeuanganCSV" class="btn-secondary"><i class="fas fa-upload"></i> Impor CSV</button>
                    <input type="file" id="fileImportKeuanganCSV" accept=".csv" style="display:none" />
                </div>
            </div>
            <div id="keuangan-scroll-area">
                <div id="keuanganTable"></div>
            </div>
        </div>
        <div id="transaksi-form-container" style="display:none;"></div>
    `;

    // Event listeners
    document.getElementById('btnTambahTransaksi').onclick = () => showFormTransaksi();
    document.getElementById('btnFilterKeuangan').onclick = () => openFilterModal();
    const searchInput = document.getElementById('searchKeuangan');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterState.search = e.target.value.trim().toLowerCase();
            currentPage = 1;
            applyFiltersAndSort();
        });
    }
    const importBtn = document.getElementById('btnImportKeuanganCSV');
    const fileInput = document.getElementById('fileImportKeuanganCSV');
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) importKeuanganFromCSV(e.target.files[0]);
        fileInput.value = '';
    };

    // Buat modal filter sekali
    if (!document.getElementById('filterModalKeuangan')) {
        const modalHTML = `
            <div id="filterModalKeuangan" class="modal" style="display:none;">
                <div class="modal-content">
                    <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan Santri</h3>
                    <div class="form-group">
                        <label for="sortKeuanganModal">Urutkan</label>
                        <select id="sortKeuanganModal">
                            <option value="kelasAsc">Kelas Diniyah (A-Z)</option>
                            <option value="kelasDesc">Kelas Diniyah (Z-A)</option>
                            <option value="namaAsc">Nama Santri (A-Z)</option>
                            <option value="namaDesc">Nama Santri (Z-A)</option>
                            <option value="saldoTertinggi">Saldo Tertinggi</option>
                            <option value="saldoTerendah">Saldo Terendah</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="filterKelasKeuanganModal">Kelas Diniyah</label>
                        <select id="filterKelasKeuanganModal">
                            <option value="Semua">Semua</option>
                        </select>
                    </div>
                    <div class="form-buttons" style="margin-top:1.5rem;">
                        <button id="applyFilterKeuanganBtn" class="btn-primary">Terapkan</button>
                        <button id="resetFilterKeuanganBtn" class="btn-secondary">Reset</button>
                        <button id="closeFilterKeuanganBtn" class="btn-secondary">Tutup</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        document.getElementById('applyFilterKeuanganBtn').onclick = () => {
            sortState = document.getElementById('sortKeuanganModal').value;
            filterState.kelas = document.getElementById('filterKelasKeuanganModal').value;
            currentPage = 1;
            applyFiltersAndSort();
            closeFilterModal();
        };
        document.getElementById('resetFilterKeuanganBtn').onclick = () => {
            document.getElementById('sortKeuanganModal').value = 'kelasAsc';
            document.getElementById('filterKelasKeuanganModal').value = 'Semua';
            sortState = 'kelasAsc';
            filterState.kelas = 'Semua';
            filterState.search = '';
            const searchInput2 = document.getElementById('searchKeuangan');
            if (searchInput2) searchInput2.value = '';
            currentPage = 1;
            applyFiltersAndSort();
            closeFilterModal();
        };
        document.getElementById('closeFilterKeuanganBtn').onclick = closeFilterModal;
        document.getElementById('filterModalKeuangan').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeFilterModal();
        });
    }

    updateKelasDropdown();
}

// ===== SUBSCRIBE REAL-TIME SANTRI & TRANSAKSI =====
function subscribeSantriDanTransaksi() {
    if (unsubscribeSantri) unsubscribeSantri();
    if (unsubscribeTransaksi) unsubscribeTransaksi();

    unsubscribeSantri = onSnapshot(collection(db, "santri"), (snapshot) => {
        allSantri = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            allSantri.push({
                id: doc.id,
                nama: data.nama || '',
                nisn: data.nisn || '',
                kelasDiniyah: data.kepesantrenan?.kelasDiniyah || '',
                kelasFormal: data.kepesantrenan?.kelasFormal || '',
                asrama: data.kepesantrenan?.asrama || '',
                ...data
            });
        });
        updateKelasDropdown();
        processData();
    }, (error) => {
        console.error("Error listening to santri:", error);
    });

    unsubscribeTransaksi = onSnapshot(collection(db, "keuangan"), (snapshot) => {
        allTransaksi = [];
        snapshot.forEach(doc => {
            allTransaksi.push({ id: doc.id, ...doc.data() });
        });
        processData();
    }, (error) => {
        console.error("Error listening to keuangan:", error);
    });
}

// ===== PROSES DATA =====
function processData() {
    santriSaldoMap = new Map();
    allSantri.forEach(s => {
        santriSaldoMap.set(s.id, {
            id: s.id,
            nama: s.nama,
            kelasDiniyah: s.kelasDiniyah,
            nisn: s.nisn,
            kelasFormal: s.kelasFormal,
            asrama: s.asrama,
            saldo: 0,
            transaksiCount: 0
        });
    });

    const transaksiPerSantri = new Map();
    allTransaksi.forEach(t => {
        if (!t.santriId) return;
        if (!transaksiPerSantri.has(t.santriId)) {
            transaksiPerSantri.set(t.santriId, []);
        }
        transaksiPerSantri.get(t.santriId).push(t);
    });

    for (const [santriId, transaksis] of transaksiPerSantri) {
        transaksis.sort((a, b) => {
            if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
            return (a.nomorTransaksi || '').localeCompare(b.nomorTransaksi || '');
        });
        let saldo = 0;
        for (const t of transaksis) {
            if (t.jenis === 'Pemasukan') saldo += (t.jumlah || 0);
            else if (t.jenis === 'Pengeluaran') saldo -= (t.jumlah || 0);
        }
        if (santriSaldoMap.has(santriId)) {
            const entry = santriSaldoMap.get(santriId);
            entry.saldo = saldo;
            entry.transaksiCount = transaksis.length;
        } else {
            const nama = transaksis[0]?.namaSantri || 'Santri tidak dikenal';
            const kelas = transaksis[0]?.kelas || '';
            santriSaldoMap.set(santriId, {
                id: santriId,
                nama: nama,
                kelasDiniyah: kelas,
                nisn: '',
                kelasFormal: '',
                asrama: '',
                saldo: saldo,
                transaksiCount: transaksis.length
            });
        }
    }

    applyFiltersAndSort();
}

// ===== FILTER & SORTIR =====
function applyFiltersAndSort() {
    const search = filterState.search || '';
    const kelasFilter = filterState.kelas;

    let filtered = Array.from(santriSaldoMap.values());

    if (kelasFilter !== 'Semua') {
        filtered = filtered.filter(s => s.kelasDiniyah === kelasFilter);
    }

    if (search) {
        filtered = filtered.filter(s => s.nama.toLowerCase().includes(search));
    }

    switch (sortState) {
        case 'kelasAsc':
            filtered.sort((a, b) => a.kelasDiniyah.localeCompare(b.kelasDiniyah) || a.nama.localeCompare(b.nama));
            break;
        case 'kelasDesc':
            filtered.sort((a, b) => b.kelasDiniyah.localeCompare(a.kelasDiniyah) || a.nama.localeCompare(b.nama));
            break;
        case 'namaAsc':
            filtered.sort((a, b) => a.nama.localeCompare(b.nama));
            break;
        case 'namaDesc':
            filtered.sort((a, b) => b.nama.localeCompare(a.nama));
            break;
        case 'saldoTertinggi':
            filtered.sort((a, b) => b.saldo - a.saldo);
            break;
        case 'saldoTerendah':
            filtered.sort((a, b) => a.saldo - b.saldo);
            break;
        default:
            filtered.sort((a, b) => a.kelasDiniyah.localeCompare(b.kelasDiniyah) || a.nama.localeCompare(b.nama));
    }

    totalDocuments = filtered.length;
    renderSantriTable(filtered);
}

// ===== RENDER TABEL SANTRI =====
function renderSantriTable(filteredData) {
    const container = document.getElementById('keuanganTable');
    if (!container) return;

    const isMobile = window.innerWidth <= 768;
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = 1;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, filteredData.length);
    const pageData = filteredData.slice(startIdx, endIdx);

    const startIndex = startIdx + 1;
    const endIndex = endIdx;

    if (pageData.length === 0) {
        container.innerHTML = `
            <div class="santri-count">Menampilkan 0 dari ${totalDocuments} santri</div>
            <p style="margin: 10px; text-align: center; font-size: large;">Tidak ada santri yang sesuai.</p>
        `;
        return;
    }

    let html = `<div class="santri-count">Menampilkan ${startIndex} - ${endIndex} dari ${totalDocuments} santri</div>`;
    html += '<div class="table-container"><table class="keuangan-table">';

    if (isMobile) {
        html += `<thead><tr><th>Nama</th><th>Kelas</th><th>Saldo</th></tr></thead><tbody>`;
        pageData.forEach(s => {
            html += `<tr>
                        <td><a href="#" class="santri-link" data-id="${s.id}">${escapeHtml(s.nama)}</a></td>
                        <td>${escapeHtml(s.kelasDiniyah || '-')}</td>
                        <td style="font-weight:bold; color:${s.saldo >= 0 ? '#2e7d32' : '#c62828'}">Rp ${(s.saldo || 0).toLocaleString()}</td>
                    </tr>`;
        });
    } else {
        html += `<thead><tr>
                    <th>Nama Santri</th>
                    <th>Kelas Diniyah</th>
                    <th>Saldo Terakhir</th>
                    <th>Jumlah Transaksi</th>
                    <th>Aksi</th>
                </tr></thead><tbody>`;
        pageData.forEach(s => {
            html += `<tr>
                        <td><a href="#" class="santri-link" data-id="${s.id}">${escapeHtml(s.nama)}</a></td>
                        <td>${escapeHtml(s.kelasDiniyah || '-')}</td>
                        <td style="font-weight:bold; color:${s.saldo >= 0 ? '#2e7d32' : '#c62828'}">Rp ${(s.saldo || 0).toLocaleString()}</td>
                        <td>${s.transaksiCount || 0}</td>
                        <td class="action-cell">
                            <button class="detail-transaksi-btn" data-id="${s.id}"><i class="fas fa-list"></i> Detail</button>
                        </td>
                    </tr>`;
        });
    }
    html += `</tbody></table></div>`;

    const prevDisabled = currentPage <= 1;
    const nextDisabled = currentPage >= totalPages;
    html += `<div class="pagination-controls" style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; flex-wrap:wrap; gap:0.5rem;">
        <span>Halaman ${currentPage} dari ${totalPages}</span>
        <div>
            <button class="btn-secondary" id="prevPageBtn" ${prevDisabled ? 'disabled' : ''}>Sebelumnya</button>
            <button class="btn-secondary" id="nextPageBtn" ${nextDisabled ? 'disabled' : ''}>Berikutnya</button>
        </div>
    </div>`;

    container.innerHTML = html;

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            applyFiltersAndSort();
        }
    });
    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            applyFiltersAndSort();
        }
    });

    document.querySelectorAll('.santri-link').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const santriId = link.dataset.id;
            await showSantriKeuangan(santriId);
        });
    });

    document.querySelectorAll('.detail-transaksi-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const santriId = btn.dataset.id;
            await showSantriKeuangan(santriId);
        });
    });
}

// ===== UPDATE DROPDOWN KELAS =====
function updateKelasDropdown() {
    const select = document.getElementById('filterKelasKeuanganModal');
    if (!select) return;
    const currentVal = select.value;
    const kelasSet = new Set();
    allSantri.forEach(s => {
        if (s.kelasDiniyah) kelasSet.add(s.kelasDiniyah);
    });
    const kelasList = Array.from(kelasSet).sort();
    select.innerHTML = '<option value="Semua">Semua</option>';
    kelasList.forEach(k => {
        select.innerHTML += `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`;
    });
    select.value = currentVal;
}

// ===== MODAL FILTER =====
function openFilterModal() {
    const modal = document.getElementById('filterModalKeuangan');
    if (!modal) return;
    document.getElementById('sortKeuanganModal').value = sortState;
    document.getElementById('filterKelasKeuanganModal').value = filterState.kelas;
    modal.style.display = 'flex';
}

function closeFilterModal() {
    const modal = document.getElementById('filterModalKeuangan');
    if (modal) modal.style.display = 'none';
}

// ===== EKSPOR CSV =====
async function exportSantriSaldoToCSV() {
    const data = Array.from(santriSaldoMap.values());
    if (data.length === 0) {
        await window.customAlert("Tidak ada data santri untuk diekspor.");
        return;
    }
    const columns = ["Nama", "Kelas Diniyah", "Saldo Terakhir", "Jumlah Transaksi", "NISN", "Kelas Formal", "Asrama"];
    const rows = [columns];
    for (const s of data) {
        const row = [
            `"${s.nama.replace(/"/g, '""')}"`,
            `"${(s.kelasDiniyah || '').replace(/"/g, '""')}"`,
            s.saldo || 0,
            s.transaksiCount || 0,
            `"${(s.nisn || '').replace(/"/g, '""')}"`,
            `"${(s.kelasFormal || '').replace(/"/g, '""')}"`,
            `"${(s.asrama || '').replace(/"/g, '""')}"`
        ];
        rows.push(row.join(','));
    }
    const csvContent = rows.join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", `saldo_santri_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ===== IMPOR CSV =====
async function importKeuanganFromCSV(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        const rows = parseCSV(content);
        if (rows.length < 2) {
            await window.customAlert("File CSV tidak memiliki data (minimal header + 1 baris data).");
            return;
        }

        const santriSnapshot = await getDocs(collection(db, "santri"));
        const santriMap = new Map();
        santriSnapshot.forEach(doc => {
            const data = doc.data();
            const nama = data.nama;
            if (nama) {
                santriMap.set(nama.toLowerCase(), { id: doc.id, nama: nama, kelasDiniyah: data.kepesantrenan?.kelasDiniyah || '' });
            }
        });

        const rawHeaders = rows[0];
        const headerIndex = {};
        const expectedHeaders = ["nomorTransaksi", "tanggal", "namaSantri", "jenis", "jumlah", "admin", "keterangan"];
        for (let i = 0; i < rawHeaders.length; i++) {
            const h = rawHeaders[i].trim().toLowerCase();
            const found = expectedHeaders.find(eh => eh.toLowerCase() === h);
            if (found) {
                headerIndex[found] = i;
            }
        }
        const missing = expectedHeaders.filter(h => !(h in headerIndex));
        if (missing.length > 0) {
            await window.customAlert(`Header CSV tidak lengkap. Kolom yang hilang: ${missing.join(', ')}`);
            return;
        }

        const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim() !== ""));
        if (dataRows.length === 0) {
            await window.customAlert("Tidak ada data valid untuk diimpor.");
            return;
        }

        const transaksiData = [];
        const errors = [];
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const obj = {};
            for (const field of expectedHeaders) {
                const idx = headerIndex[field];
                obj[field] = (idx !== undefined && row[idx] !== undefined) ? row[idx].trim() : '';
            }

            const namaSantri = obj.namaSantri;
            if (!namaSantri) {
                errors.push(`Baris ${i+2}: namaSantri wajib diisi`);
                continue;
            }
            const santriKey = namaSantri.toLowerCase();
            const santriData = santriMap.get(santriKey);
            if (!santriData) {
                errors.push(`Baris ${i+2}: santri dengan nama "${namaSantri}" tidak ditemukan`);
                continue;
            }
            obj.santriId = santriData.id;
            obj.namaSantri = santriData.nama;

            if (!obj.tanggal) {
                errors.push(`Baris ${i+2}: tanggal wajib diisi`);
                continue;
            }

            const jenisLower = obj.jenis.toLowerCase();
            if (!["pemasukan", "pengeluaran"].includes(jenisLower)) {
                errors.push(`Baris ${i+2}: jenis harus 'Pemasukan' atau 'Pengeluaran'`);
                continue;
            }
            obj.jenis = jenisLower === "pemasukan" ? "Pemasukan" : "Pengeluaran";

            const jumlah = parseInt(obj.jumlah);
            if (isNaN(jumlah) || jumlah <= 0) {
                errors.push(`Baris ${i+2}: jumlah harus angka positif`);
                continue;
            }
            obj.jumlah = jumlah;

            if (!obj.admin) obj.admin = auth.currentUser?.email || "Admin";

            transaksiData.push(obj);
        }

        if (errors.length > 0) {
            await window.customAlert(`Terdapat ${errors.length} error pada data:\n${errors.slice(0,5).join('\n')}${errors.length > 5 ? `\n... dan ${errors.length-5} lainnya` : ''}`);
            return;
        }

        const ok = await window.customConfirm(`Akan mengimpor ${transaksiData.length} transaksi. Lanjutkan?`);
        if (!ok) return;

        let successCount = 0, errorCount = 0;
        const batchSize = 500;
        for (let i = 0; i < transaksiData.length; i += batchSize) {
            const batch = writeBatch(db);
            const chunk = transaksiData.slice(i, i + batchSize);
            for (const trans of chunk) {
                try {
                    const nomorTransaksi = await generateNomorTransaksi();
                    const dataToSave = {
                        nomorTransaksi,
                        santriId: trans.santriId,
                        namaSantri: trans.namaSantri,
                        jenis: trans.jenis,
                        jumlah: trans.jumlah,
                        tanggal: trans.tanggal,
                        keterangan: trans.keterangan || '',
                        admin: trans.admin,
                        saldo: 0,
                        createdAt: new Date().toISOString()
                    };
                    const docRef = doc(collection(db, "keuangan"));
                    batch.set(docRef, dataToSave);
                    successCount++;
                } catch (err) {
                    errorCount++;
                    console.error("Error import transaksi:", err);
                }
            }
            if (chunk.length > 0) await batch.commit();
        }
        await recalculateAllSaldo();
        await window.customAlert(`Impor selesai. Sukses: ${successCount}, Gagal: ${errorCount}`);
    };
    reader.onerror = () => alert("Gagal membaca file.");
    reader.readAsText(file, "UTF-8");
}

function parseCSV(text) {
    const rows = [];
    let inQuote = false, currentRow = [], currentField = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuote && text[i+1] === '"') { currentField += '"'; i++; }
            else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
            currentRow.push(currentField);
            currentField = '';
        } else if (ch === '\n' && !inQuote) {
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += ch;
        }
        i++;
    }
    if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }
    return rows.map(row => row.map(field => field.trim()));
}

// ===== CRUD TRANSAKSI =====
async function generateNomorTransaksi() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `TRX-${yyyy}${mm}${dd}`;
    const snap = await getDocs(collection(db, "keuangan"));
    let count = 1;
    snap.forEach(docSnap => {
        const trx = docSnap.data();
        if (trx.nomorTransaksi && trx.nomorTransaksi.startsWith(prefix)) count++;
    });
    return `${prefix}-${String(count).padStart(3, '0')}`;
}

async function getLastSaldo() {
    const snap = await getDocs(collection(db, "keuangan"));
    let transactions = [];
    snap.forEach(docSnap => transactions.push({ id: docSnap.id, ...docSnap.data() }));
    transactions.sort((a, b) => {
        if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
        return (a.nomorTransaksi || '').localeCompare(b.nomorTransaksi || '');
    });
    if (transactions.length === 0) return 0;
    return transactions[transactions.length - 1].saldo || 0;
}

async function saveTransaksiForm() {
    const namaSantri = document.getElementById('namaSantriInput').value.trim();
    if (!namaSantri) return await window.customAlert("Pilih nama santri");

    const santriQuery = query(collection(db, "santri"), where("nama", "==", namaSantri));
    const santriSnap = await getDocs(santriQuery);
    if (santriSnap.empty) {
        await window.customAlert(`Santri dengan nama "${namaSantri}" tidak ditemukan. Pilih dari daftar.`);
        return;
    }
    const santriId = santriSnap.docs[0].id;
    const namaSantriDoc = santriSnap.docs[0].data().nama;

    const jenis = document.getElementById('jenisTransaksi').value;
    const jumlah = parseInt(document.getElementById('jumlahTransaksi').value);
    if (isNaN(jumlah) || jumlah <= 0) return await window.customAlert("Jumlah harus positif");
    const tanggal = document.getElementById('tglTransaksi').value;
    if (!tanggal) return await window.customAlert("Pilih tanggal");
    const keterangan = document.getElementById('keteranganTransaksi').value;
    const admin = auth.currentUser?.email || "Admin";

    if (currentTransaksiId) {
        await window.customAlert("Edit transaksi tidak diizinkan untuk menjaga konsistensi saldo. Hapus dan buat baru.");
        return;
    } else {
        const nomorTransaksi = await generateNomorTransaksi();
        const lastSaldo = await getLastSaldo();
        const saldoTerbaru = jenis === "Pemasukan" ? lastSaldo + jumlah : lastSaldo - jumlah;
        const data = {
            nomorTransaksi, santriId, namaSantri: namaSantriDoc, jenis, jumlah, tanggal, keterangan, admin,
            saldo: saldoTerbaru, createdAt: new Date().toISOString()
        };
        try {
            await addDoc(collection(db, "keuangan"), data);
            await window.customAlert("Transaksi berhasil disimpan");
            hideFormTransaksi();
        } catch (err) {
            await window.customAlert("Gagal simpan: " + err.message);
        }
    }
}

async function deleteTransaksi(id) {
    if (await window.customConfirm("Hapus transaksi ini? Saldo akan dihitung ulang secara otomatis.")) {
        try {
            await deleteDoc(doc(db, "keuangan", id));
            await recalculateAllSaldo();
            await window.customAlert("Transaksi dihapus dan saldo telah diperbarui.");
        } catch (err) {
            await window.customAlert("Gagal hapus: " + err.message);
        }
    }
}

async function recalculateAllSaldo() {
    const snap = await getDocs(collection(db, "keuangan"));
    let transactions = [];
    snap.forEach(docSnap => transactions.push({ id: docSnap.id, ...docSnap.data() }));
    transactions.sort((a, b) => {
        if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
        return (a.nomorTransaksi || '').localeCompare(b.nomorTransaksi || '');
    });
    let runningSaldo = 0;
    for (const trans of transactions) {
        if (trans.jenis === "Pemasukan") runningSaldo += trans.jumlah;
        else runningSaldo -= trans.jumlah;
        await updateDoc(doc(db, "keuangan", trans.id), { saldo: runningSaldo });
    }
}

// ===== FORM TRANSAKSI =====
async function showFormTransaksi(editData = null) {
    const formContainer = document.getElementById('transaksi-form-container');
    const pageContainer = document.getElementById('keuangan-page-container');
    const headerActions = document.getElementById('keuangan-header-actions');

    if (headerActions) headerActions.style.display = 'none';
    if (pageContainer) pageContainer.style.display = 'none';
    formContainer.style.display = 'block';

    let backBtn = document.getElementById('btnBackTransaksiForm');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'btnBackTransaksiForm';
        backBtn.className = 'btn-secondary';
        backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
        backBtn.style.marginBottom = '1rem';
        formContainer.parentNode.insertBefore(backBtn, formContainer);
    }
    backBtn.style.display = 'inline-flex';
    backBtn.onclick = () => hideFormTransaksi();

    if (editData) currentTransaksiId = editData.id;
    else currentTransaksiId = null;

    formContainer.innerHTML = buildFormTransaksiHtml(editData);
    await loadSantriDatalist();
    const namaInput = document.getElementById('namaSantriInput');
    if (editData && editData.namaSantri) namaInput.value = editData.namaSantri;

    if (currentTransaksiId) {
        const formButtons = document.querySelector('#transaksiForm .form-buttons');
        const oldDelete = formButtons.querySelector('.btn-danger');
        if (oldDelete) oldDelete.remove();
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Hapus';
        deleteBtn.className = 'btn-danger';
        deleteBtn.onclick = async () => {
            if (await window.customConfirm('Yakin hapus transaksi ini? Saldo akan dihitung ulang.')) {
                try {
                    await deleteDoc(doc(db, "keuangan", currentTransaksiId));
                    await recalculateAllSaldo();
                    await window.customAlert('Transaksi dihapus');
                    hideFormTransaksi();
                } catch (err) {
                    await window.customAlert('Gagal hapus: ' + err.message);
                }
            }
        };
        formButtons.appendChild(deleteBtn);
    }

    document.getElementById('transaksiForm').onsubmit = (e) => { e.preventDefault(); saveTransaksiForm(); };
    document.getElementById('btnBatalTransaksiForm').onclick = () => hideFormTransaksi();

    if (editData) fillTransaksiFormData(editData);
}

function hideFormTransaksi() {
    document.getElementById('transaksi-form-container').style.display = 'none';
    const pageContainer = document.getElementById('keuangan-page-container');
    if (pageContainer) pageContainer.style.display = 'flex';
    const headerActions = document.getElementById('keuangan-header-actions');
    if (headerActions) headerActions.style.display = 'flex';
    const backBtn = document.getElementById('btnBackTransaksiForm');
    if (backBtn) backBtn.style.display = 'none';
    currentTransaksiId = null;
}

function buildFormTransaksiHtml(editData = null) {
    const title = currentTransaksiId ? 'Edit Transaksi' : 'Tambah Transaksi Baru';
    return `
        <div class="form-card">
            <h3>${title}</h3>
            <form id="transaksiForm">
                <div class="form-group">
                    <label>Nama Santri</label>
                    <input type="text" id="namaSantriInput" list="santriDatalist" required 
                        placeholder="Ketik nama santri..." autocomplete="off" class="search-input">
                    <datalist id="santriDatalist"></datalist>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Jenis Transaksi</label>
                        <select id="jenisTransaksi">
                            <option value="Pemasukan">Pemasukan (Uang Masuk)</option>
                            <option value="Pengeluaran">Pengeluaran (Uang Keluar)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Jumlah (Rp)</label>
                        <input type="number" id="jumlahTransaksi" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Tanggal</label>
                        <input type="date" id="tglTransaksi" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Keterangan (Opsional)</label>
                    <textarea id="keteranganTransaksi" rows="2"></textarea>
                </div>
                <div class="form-buttons">
                    <button type="submit" class="btn-primary">Simpan</button>
                    <button type="button" id="btnBatalTransaksiForm" class="btn-secondary">Batal</button>
                </div>
            </form>
        </div>
    `;
}

function fillTransaksiFormData(data) {
    document.getElementById('jenisTransaksi').value = data.jenis || 'Pemasukan';
    document.getElementById('jumlahTransaksi').value = data.jumlah || '';
    document.getElementById('tglTransaksi').value = data.tanggal || '';
    document.getElementById('keteranganTransaksi').value = data.keterangan || '';
}

async function loadSantriDatalist() {
    const snapshot = await getDocs(collection(db, "santri"));
    const datalist = document.getElementById('santriDatalist');
    if (!datalist) return;
    datalist.innerHTML = '';
    snapshot.forEach(doc => {
        const santri = doc.data();
        const option = document.createElement('option');
        option.value = santri.nama;
        option.setAttribute('data-id', doc.id);
        option.textContent = `${santri.nama} (NISN: ${santri.nisn || '-'})`;
        datalist.appendChild(option);
    });
}

// ===== DETAIL KEUANGAN SANTRI =====
async function showSantriKeuangan(santriId) {
    const santriDoc = await getDoc(doc(db, "santri", santriId));
    if (!santriDoc.exists()) {
        await window.customAlert("Santri tidak ditemukan");
        return;
    }
    const santri = santriDoc.data();

    const q = query(
        collection(db, "keuangan"),
        where("santriId", "==", santriId),
        orderBy("tanggal", "asc"),
        orderBy("createdAt", "asc")
    );
    const snapshot = await getDocs(q);
    let runningSaldo = 0;
    const transaksiDenganSaldo = [];
    snapshot.forEach(docSnap => {
        const trans = docSnap.data();
        if (trans.jenis === "Pemasukan") runningSaldo += trans.jumlah;
        else runningSaldo -= trans.jumlah;
        transaksiDenganSaldo.push({ id: docSnap.id, ...trans, saldoHitung: runningSaldo });
    });
    const saldoAkhir = runningSaldo;
    const transaksiTerbaru = [...transaksiDenganSaldo].reverse();

    const detailHtml = `
        <div id="santri-keuangan-detail">
            <button id="backToKeuangan" class="btn-secondary" style="margin-bottom:1.5rem">
                <i class="fas fa-arrow-left"></i> Kembali ke Daftar Santri
            </button>
            <div class="santri-profile-card">
                <div class="santri-avatar"><i class="fas fa-user-graduate"></i></div>
                <div class="santri-info">
                    <h2>${escapeHtml(santri.nama)}</h2>
                    <div class="santri-details">
                        <div class="detail-item"><i class="fas fa-id-card"></i> NISN: ${escapeHtml(santri.nisn || '-')}</div>
                        <div class="detail-item"><i class="fas fa-building"></i> Asrama: ${escapeHtml(santri.kepesantrenan?.asrama || '-')}</div>
                        <div class="detail-item"><i class="fas fa-book"></i> Kelas Diniyah: ${escapeHtml(santri.kepesantrenan?.kelasDiniyah || '-')}</div>
                        <div class="detail-item"><i class="fas fa-school"></i> Kelas Formal: ${escapeHtml(santri.kepesantrenan?.kelasFormal || '-')}</div>
                    </div>
                </div>
            </div>
            <div class="saldo-card-modern">
                <div class="saldo-label"><i class="fas fa-wallet"></i> Saldo Akhir Santri</div>
                <div class="saldo-amount">Rp ${saldoAkhir.toLocaleString()}</div>
            </div>
            <div class="history-section">
                <h3><i class="fas fa-history"></i> Riwayat Transaksi</h3>
                <div class="table-container">
                    <table class="keuangan-table">
                        <thead><tr><th>Tanggal</th><th>Jenis</th><th>Jumlah</th><th>Keterangan</th><th>Admin</th></tr></thead>
                        <tbody>
                            ${transaksiTerbaru.map(trans => `
                                <tr>
                                    <td>${formatTanggal(trans.tanggal)}</td>
                                    <td style="color:${trans.jenis === 'Pemasukan' ? '#2e7d32' : '#c62828'}"><i class="fas ${trans.jenis === 'Pemasukan' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${trans.jenis}</td>
                                    <td>Rp ${trans.jumlah.toLocaleString()}</td>
                                    <td>${escapeHtml(trans.keterangan || '-')}</td>
                                    <td>${escapeHtml(trans.admin || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${transaksiTerbaru.length === 0 ? '<p class="empty-state">Belum ada transaksi untuk santri ini.</p>' : ''}
            </div>
            <div style="margin-top:1rem; display:flex; gap:0.5rem;">
                <button id="btnTambahTransaksiSantri" class="btn-primary"><i class="fas fa-plus"></i> Tambah Transaksi</button>
            </div>
        </div>
    `;

    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = detailHtml;
    document.getElementById('backToKeuangan').onclick = async () => {
        await loadKeuangan(mainContent);
    };
    document.getElementById('btnTambahTransaksiSantri').onclick = () => {
        showFormTransaksi(null);
        setTimeout(() => {
            const namaInput = document.getElementById('namaSantriInput');
            if (namaInput) {
                namaInput.value = santri.nama;
                namaInput.dispatchEvent(new Event('input'));
            }
        }, 100);
    };
}

// ===== UTILITY =====
function formatTanggal(tgl) {
    if (!tgl) return '-';
    const parts = tgl.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return tgl;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
