import { db, auth } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, getDocs, query, where, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeKeuangan = null;
const ITEMS_PER_PAGE = 40;    // jumlah data per halaman
let currentPage = 1;          // halaman aktif
let filteredData = [];        // menyimpan hasil filter+sort sebelum dipaginasi
let currentEditId = null;
let currentTransaksiId = null;

// State untuk filter & sortir keuangan
let filterStateKeuangan = {
    jenis: 'Semua',
    santriId: 'Semua',
    admin: 'Semua'
};
let sortStateKeuangan = 'tanggalDesc';
let allTransaksiData = [];

export function loadKeuangan(container) {
    renderKeuanganPage(container);
    listenKeuangan();
}

function renderKeuanganPage(container) {
    container.innerHTML = `
        <div id="keuangan-page-container">
            <div id="keuangan-header-actions">
                <div class="header-left-buttons">
                    <button id="btnTambahTransaksi" class="btn-primary"><i class="fas fa-plus"></i></button>
                    <button id="btnFilterKeuangan" class="btn-secondary"><i class="fas fa-sliders-h"></i> Filter</button>
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
    document.getElementById('btnFilterKeuangan').onclick = () => openFilterModalKeuangan();
    document.getElementById('btnExportKeuanganCSV').onclick = () => exportKeuanganToCSV();
    const searchInput = document.getElementById('searchKeuangan');
    if (searchInput) {
        searchInput.addEventListener('input', () => applyFiltersAndSortKeuangan());
    }
    const importBtn = document.getElementById('btnImportKeuanganCSV');
    const fileInput = document.getElementById('fileImportKeuanganCSV');
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) importKeuanganFromCSV(e.target.files[0]);
        fileInput.value = '';
    };

    // Buat modal filter keuangan (sekali di body)
    if (!document.getElementById('filterModalKeuangan')) {
        const modalHTML = `
            <div id="filterModalKeuangan" class="modal" style="display:none;">
                <div class="modal-content">
                    <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan Transaksi</h3>
                    <div class="form-group">
                        <label for="sortKeuanganModal">Urutkan</label>
                        <select id="sortKeuanganModal">
                            <option value="tanggalDesc">Tanggal (terbaru)</option>
                            <option value="tanggalAsc">Tanggal (terlama)</option>
                            <option value="namaSantri">Nama Santri</option>
                            <option value="jenis">Jenis</option>
                            <option value="jumlahDesc">Jumlah (terbesar)</option>
                            <option value="jumlahAsc">Jumlah (terkecil)</option>
                            <option value="nomorAsc">Nomor Transaksi (lama ke baru)</option>
                            <option value="nomorDesc">Nomor Transaksi (baru ke lama)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="filterJenisKeuanganModal">Jenis Transaksi</label>
                        <select id="filterJenisKeuanganModal">
                            <option value="Semua">Semua</option>
                            <option value="Pemasukan">Pemasukan</option>
                            <option value="Pengeluaran">Pengeluaran</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="filterSantriKeuanganModal">Santri</label>
                        <select id="filterSantriKeuanganModal">
                            <option value="Semua">Semua</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="filterAdminKeuanganModal">Admin</label>
                        <select id="filterAdminKeuanganModal">
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
            sortStateKeuangan = document.getElementById('sortKeuanganModal').value;
            filterStateKeuangan.jenis = document.getElementById('filterJenisKeuanganModal').value;
            filterStateKeuangan.santriId = document.getElementById('filterSantriKeuanganModal').value;
            filterStateKeuangan.admin = document.getElementById('filterAdminKeuanganModal').value;
            applyFiltersAndSortKeuangan();
            closeFilterModalKeuangan();
        };
        document.getElementById('resetFilterKeuanganBtn').onclick = () => {
            document.getElementById('sortKeuanganModal').value = 'tanggalDesc';
            document.getElementById('filterJenisKeuanganModal').value = 'Semua';
            document.getElementById('filterSantriKeuanganModal').value = 'Semua';
            document.getElementById('filterAdminKeuanganModal').value = 'Semua';
            sortStateKeuangan = 'tanggalDesc';
            filterStateKeuangan.jenis = 'Semua';
            filterStateKeuangan.santriId = 'Semua';
            filterStateKeuangan.admin = 'Semua';
            applyFiltersAndSortKeuangan();
            closeFilterModalKeuangan();
        };
        document.getElementById('closeFilterKeuanganBtn').onclick = closeFilterModalKeuangan;
        document.getElementById('filterModalKeuangan').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeFilterModalKeuangan();
        });
    }

    updateFilterOptionsKeuangan();
}

// ===== MODAL FILTER =====
function openFilterModalKeuangan() {
    const modal = document.getElementById('filterModalKeuangan');
    if (!modal) return;
    document.getElementById('sortKeuanganModal').value = sortStateKeuangan;
    document.getElementById('filterJenisKeuanganModal').value = filterStateKeuangan.jenis;
    document.getElementById('filterSantriKeuanganModal').value = filterStateKeuangan.santriId;
    document.getElementById('filterAdminKeuanganModal').value = filterStateKeuangan.admin;
    modal.style.display = 'flex';
}

function closeFilterModalKeuangan() {
    const modal = document.getElementById('filterModalKeuangan');
    if (modal) modal.style.display = 'none';
}

// ===== UPDATE OPSI FILTER DINAMIS =====
function updateFilterOptionsKeuangan() {
    const santriSet = new Set();
    const adminSet = new Set();
    allTransaksiData.forEach(t => {
        if (t.santriId) santriSet.add(t.santriId);
        if (t.admin) adminSet.add(t.admin);
    });

    const santriSelect = document.getElementById('filterSantriKeuanganModal');
    const adminSelect = document.getElementById('filterAdminKeuanganModal');
    if (santriSelect) {
        const currentVal = santriSelect.value;
        santriSelect.innerHTML = '<option value="Semua">Semua</option>';
        const santriMap = {};
        allTransaksiData.forEach(t => {
            if (t.santriId && t.namaSantri) {
                santriMap[t.santriId] = t.namaSantri;
            }
        });
        Array.from(santriSet).sort().forEach(id => {
            const nama = santriMap[id] || id;
            santriSelect.innerHTML += `<option value="${escapeHtml(id)}">${escapeHtml(nama)}</option>`;
        });
        santriSelect.value = currentVal;
    }
    if (adminSelect) {
        const currentVal = adminSelect.value;
        adminSelect.innerHTML = '<option value="Semua">Semua</option>';
        Array.from(adminSet).sort().forEach(admin => {
            adminSelect.innerHTML += `<option value="${escapeHtml(admin)}">${escapeHtml(admin)}</option>`;
        });
        adminSelect.value = currentVal;
    }
}

// ===== FILTER & SORTIR =====
function applyFiltersAndSortKeuangan() {
    const keyword = document.getElementById('searchKeuangan')?.value?.toLowerCase() || '';
    let filtered = allTransaksiData.filter(t => {
        if (keyword && !(t.namaSantri && t.namaSantri.toLowerCase().includes(keyword))) return false;
        if (filterStateKeuangan.jenis !== 'Semua' && t.jenis !== filterStateKeuangan.jenis) return false;
        if (filterStateKeuangan.santriId !== 'Semua' && t.santriId !== filterStateKeuangan.santriId) return false;
        if (filterStateKeuangan.admin !== 'Semua' && t.admin !== filterStateKeuangan.admin) return false;
        return true;
    });

    // Sorting (tambahkan kasus nomor transaksi)
    switch (sortStateKeuangan) {
        case 'tanggalDesc':
            filtered.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
            break;
        case 'tanggalAsc':
            filtered.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
            break;
        case 'namaSantri':
            filtered.sort((a, b) => (a.namaSantri || '').localeCompare(b.namaSantri || ''));
            break;
        case 'jenis':
            filtered.sort((a, b) => (a.jenis || '').localeCompare(b.jenis || ''));
            break;
        case 'jumlahDesc':
            filtered.sort((a, b) => (b.jumlah || 0) - (a.jumlah || 0));
            break;
        case 'jumlahAsc':
            filtered.sort((a, b) => (a.jumlah || 0) - (b.jumlah || 0));
            break;
        case 'nomorAsc':   // baru
            filtered.sort((a, b) => (a.nomorTransaksi || '').localeCompare(b.nomorTransaksi || ''));
            break;
        case 'nomorDesc':  // baru
            filtered.sort((a, b) => (b.nomorTransaksi || '').localeCompare(a.nomorTransaksi || ''));
            break;
        default: break;
    }

    filteredData = filtered;
    currentPage = 1;                // kembali ke halaman pertama setiap kali filter/sort berubah
    renderPagedKeuangan();
}

// ===== HITUNG DATA TAMPIL =====
function renderPagedKeuangan() {
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, totalItems);
    const pageItems = filteredData.slice(start, end);
    renderKeuanganTable(pageItems, totalItems, currentPage, totalPages);
}

// ===== RENDER TABEL =====
function renderKeuanganTable(transaksis, totalItems, currentPageNum, totalPages) {
    const container = document.getElementById('keuanganTable');
    if (!container) return;

    const totalSemua = allTransaksiData.length;

    if (totalItems === 0) {
        container.innerHTML = `
            <div class="santri-count">Menampilkan 0 dari ${totalSemua} transaksi</div>
            <p style="margin: 10px; text-align: center; font-size: large;">Tidak ada transaksi.</p>
        `;
        return;
    }

    const isMobile = window.innerWidth <= 768;
    let html = `<div class="santri-count">
        Menampilkan ${transaksis.length} dari ${totalItems} transaksi (Halaman ${currentPageNum}/${totalPages})
    </div>`;
    html += '<div class="table-container"><table class="keuangan-table">';

    if (isMobile) {
        html += `<thead><tr><th>Tanggal</th><th>Santri</th><th>Jenis</th><th>Jumlah</th><th>Aksi</th></tr></thead><tbody>`;
        transaksis.forEach(trans => {
            html += `<tr>
                        <td>${formatTanggal(trans.tanggal)}</td>
                        <td><a href="#" class="santri-link" data-id="${trans.santriId}">${escapeHtml(trans.namaSantri)}</a></td>
                        <td style="color:${trans.jenis === 'Pemasukan' ? '#2e7d32' : '#c62828'}">${trans.jenis}</td>
                        <td>Rp ${(trans.jumlah || 0).toLocaleString()}</td>
                        <td class="action-cell">
                            <button class="edit-transaksi-btn" data-id="${trans.id}">Edit</button>
                        </td>
                    </tr>`;
        });
    } else {
        html += `<thead><tr>
                    <th>Nomor Transaksi</th>
                    <th>Tanggal</th>
                    <th>Nama Santri</th>
                    <th>Jenis</th>
                    <th>Jumlah</th>
                    <th>Admin</th>
                    <th>Aksi</th>
                </tr></thead><tbody>`;
        transaksis.forEach(trans => {
            html += `<tr>
                        <td>${escapeHtml(trans.nomorTransaksi || '-')}</td>
                        <td>${formatTanggal(trans.tanggal)}</td>
                        <td><a href="#" class="santri-link" data-id="${trans.santriId}">${escapeHtml(trans.namaSantri)}</a></td>
                        <td style="color:${trans.jenis === 'Pemasukan' ? '#2e7d32' : '#c62828'}">${trans.jenis}</td>
                        <td>Rp ${(trans.jumlah || 0).toLocaleString()}</td>
                        <td>${escapeHtml(trans.admin || '-')}</td>
                        <td class="action-cell">
                            <button class="edit-transaksi-btn" data-id="${trans.id}">Edit</button>
                        </td>
                    </tr>`;
        });
    }
    html += `</tbody></table></div>`;

    // === KONTROL PAGINASI ===
    html += `<div class="pagination-controls" style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; flex-wrap:wrap; gap:0.5rem;">
        <span>Halaman ${currentPageNum} dari ${totalPages}</span>
        <div>
            <button class="btn-secondary" id="prevPageBtn" ${currentPageNum <= 1 ? 'disabled' : ''}>Sebelumnya</button>
            <button class="btn-secondary" id="nextPageBtn" ${currentPageNum >= totalPages ? 'disabled' : ''}>Berikutnya</button>
        </div>
    </div>`;

    container.innerHTML = html;

    // Event listener untuk tombol paginasi
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPagedKeuangan();
        }
    });
    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPagedKeuangan();
        }
    });

    // Event listener untuk link santri (sama seperti sebelumnya)
    document.querySelectorAll('.santri-link').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const santriId = link.dataset.id;
            await showSantriKeuangan(santriId);
        });
    });

    // Event listener untuk tombol Edit
    document.querySelectorAll('.edit-transaksi-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "keuangan", id));
            if (docSnap.exists()) showFormTransaksi({ id, ...docSnap.data() });
        });
    });
}

// ===== EKSPOR CSV =====
async function exportKeuanganToCSV() {
    const data = allTransaksiData;
    if (data.length === 0) {
        await window.customAlert("Tidak ada transaksi untuk diekspor.");
        return;
    }
    const columns = ["nomorTransaksi", "tanggal", "namaSantri", "jenis", "jumlah", "admin", "keterangan"];
    const rows = [columns];
    for (const t of data) {
        const row = columns.map(col => {
            let value = t[col];
            if (value === undefined || value === null) return '';
            if (col === 'tanggal') value = formatTanggal(value);
            if (col === 'jumlah') value = value.toString();
            let str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        rows.push(row);
    }
    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", `keuangan_export_${new Date().toISOString().slice(0,10)}.csv`);
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
        const headers = rows[0];
        const expectedHeaders = ["nomorTransaksi", "tanggal", "namaSantri", "jenis", "jumlah", "admin", "keterangan"];
        const headerIndex = {};
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].trim();
            if (expectedHeaders.includes(h)) headerIndex[h] = i;
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
            if (!obj.namaSantri) { errors.push(`Baris ${i+2}: namaSantri wajib diisi`); continue; }
            if (!obj.tanggal) { errors.push(`Baris ${i+2}: tanggal wajib diisi`); continue; }
            if (!obj.jenis || !["Pemasukan", "Pengeluaran"].includes(obj.jenis)) {
                errors.push(`Baris ${i+2}: jenis harus 'Pemasukan' atau 'Pengeluaran'`);
                continue;
            }
            const jumlah = parseInt(obj.jumlah);
            if (isNaN(jumlah) || jumlah <= 0) {
                errors.push(`Baris ${i+2}: jumlah harus angka positif`);
                continue;
            }
            obj.jumlah = jumlah;
            const santriQuery = query(collection(db, "santri"), where("nama", "==", obj.namaSantri));
            const santriSnap = await getDocs(santriQuery);
            if (santriSnap.empty) {
                errors.push(`Baris ${i+2}: santri dengan nama "${obj.namaSantri}" tidak ditemukan`);
                continue;
            }
            obj.santriId = santriSnap.docs[0].id;
            if (!obj.admin) obj.admin = window.currentAdminName || auth.currentUser?.email || "Admin";
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

// ===== CRUD =====
async function loadSantriDropdown() {
    const snap = await getDocs(collection(db, "santri"));
    const select = document.getElementById('namaSantriSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Pilih Santri --</option>';
    snap.forEach(docSnap => {
        const santri = docSnap.data();
        select.innerHTML += `<option value="${docSnap.id}">${santri.nama}</option>`;
    });
}

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
    const admin = window.currentAdminName || auth.currentUser?.email || "Admin";

    if (currentTransaksiId) {
        await window.customAlert("Edit transaksi tidak diizinkan untuk menjaga konsistensi saldo. Hapus dan buat baru.");
        return;
    } else {
        const nomorTransaksi = await generateNomorTransaksi();
        const lastSaldo = await getLastSaldo();
        const saldoTerbaru = jenis === "Pemasukan" ? lastSaldo + jumlah : lastSaldo - jumlah;
        const data = {
            nomorTransaksi, santriId, namaSantri, jenis, jumlah, tanggal, keterangan, admin,
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

function listenKeuangan() {
    if (unsubscribeKeuangan) unsubscribeKeuangan();
    unsubscribeKeuangan = onSnapshot(collection(db, "keuangan"), (snapshot) => {
        allTransaksiData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFilterOptionsKeuangan();
        applyFiltersAndSortKeuangan();
    });
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

    loadSantriDropdown().then(() => {
        if (editData && editData.santriId) {
            document.getElementById('namaSantriSelect').value = editData.santriId;
        }
    });

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
                <i class="fas fa-arrow-left"></i> Kembali ke Semua Transaksi
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
        </div>
    `;

    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = detailHtml;
    document.getElementById('backToKeuangan').onclick = async () => {
        await loadKeuangan(mainContent);
    };
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
