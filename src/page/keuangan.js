// keuangan.js - v2 optimized
// Fitur: paginasi client-side, realtime pada saldo_santri, filter kelas & pencarian,
// detail transaksi santri, tambah & hapus transaksi, ekspor & impor CSV.
//
// Perubahan besar dari versi lama:
// - TIDAK lagi onSnapshot seluruh koleksi keuangan.
// - Hanya onSnapshot koleksi saldo_santri (1 dokumen per santri).
// - Saldo di-update pakai increment(), bukan hitung ulang.
// - Nomor transaksi pakai dokumen counter, bukan hitung getDocs.
// - loadSantriDatalist pakai data di memori, tidak getDocs.
// - Import CSV pakai batch + agregat di memori.
// - recalculateAllSaldo & getLastSaldo DIHAPUS.

import { db, auth } from '../firebase.js';
import {
  collection, doc, onSnapshot, getDocs, getDoc, setDoc,
  query, where, orderBy, limit, startAfter,
  writeBatch, increment, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ===== STATE =====
let unsubscribeSaldo = null;
let currentTransaksiId = null;

const PAGE_SIZE = 40;
let currentPage = 1;
let totalDocuments = 0;

let filterState = { kelas: 'Semua', search: '' };
let sortState = 'kelasAsc';

let saldoSantriList = []; // cache semua saldo santri dari saldo_santri

// ===== ENTRY POINT =====
export function loadKeuangan(container) {
  renderKeuanganPage(container);
  currentPage = 1;
  subscribeSaldoSantri();
}

// Panggil ini saat user pindah halaman / logout
export function cleanupKeuangan() {
  if (unsubscribeSaldo) {
    unsubscribeSaldo();
    unsubscribeSaldo = null;
  }
  saldoSantriList = [];
  currentTransaksiId = null;
}

// ===== RENDER HALAMAN UTAMA =====
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

  // Tombol & event
  document.getElementById('btnTambahTransaksi').onclick = () => showFormTransaksi();
  document.getElementById('btnFilterKeuangan').onclick = () => openFilterModal();
  document.getElementById('btnExportKeuanganCSV').onclick = () => exportSantriSaldoToCSV();

  const searchInput = document.getElementById('searchKeuangan');
  searchInput.addEventListener('input', (e) => {
    filterState.search = e.target.value.trim().toLowerCase();
    currentPage = 1;
    applyFiltersAndSort();
  });

  const importBtn = document.getElementById('btnImportKeuanganCSV');
  const fileInput = document.getElementById('fileImportKeuanganCSV');
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    if (e.target.files.length > 0) importKeuanganFromCSV(e.target.files[0]);
    fileInput.value = '';
  };

  // Modal filter sekali saja
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
      const s = document.getElementById('searchKeuangan');
      if (s) s.value = '';
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

// ===== LISTENER SALDO_SANTRI (satu-satunya realtime listener) =====
function subscribeSaldoSantri() {
  if (unsubscribeSaldo) unsubscribeSaldo();

  unsubscribeSaldo = onSnapshot(
    collection(db, "saldo_santri"),
    (snapshot) => {
      saldoSantriList = [];
      snapshot.forEach(d => {
        const data = d.data();
        saldoSantriList.push({
          id: d.id,
          nama: data.nama || '',
          nisn: data.nisn || '',
          kelasDiniyah: data.kelasDiniyah || '',
          kelasFormal: data.kelasFormal || '',
          asrama: data.asrama || '',
          saldo: data.saldo || 0,
          transaksiCount: data.transaksiCount || 0
        });
      });
      updateKelasDropdown();
      applyFiltersAndSort();
    },
    (err) => console.error("saldo_santri listener error:", err)
  );
}

// ===== FILTER & SORTIR =====
function applyFiltersAndSort() {
  const search = filterState.search || '';
  const kelasFilter = filterState.kelas;

  let filtered = saldoSantriList.slice();

  if (kelasFilter !== 'Semua') {
    filtered = filtered.filter(s => s.kelasDiniyah === kelasFilter);
  }

  if (search) {
    filtered = filtered.filter(s => s.nama.toLowerCase().includes(search));
  }

  switch (sortState) {
    case 'kelasAsc':
      filtered.sort((a, b) =>
        a.kelasDiniyah.localeCompare(b.kelasDiniyah) || a.nama.localeCompare(b.nama));
      break;
    case 'kelasDesc':
      filtered.sort((a, b) =>
        b.kelasDiniyah.localeCompare(a.kelasDiniyah) || a.nama.localeCompare(b.nama));
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
      filtered.sort((a, b) =>
        a.kelasDiniyah.localeCompare(b.kelasDiniyah) || a.nama.localeCompare(b.nama));
  }

  totalDocuments = filtered.length;
  renderSantriTable(filtered);
}

// ===== RENDER TABEL SANTRI =====
function renderSantriTable(filteredData) {
  const container = document.getElementById('keuanganTable');
  if (!container) return;

  const isMobile = window.innerWidth <= 768;
  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filteredData.length);
  const pageData = filteredData.slice(startIdx, endIdx);

  if (pageData.length === 0) {
    container.innerHTML = `
      <div class="santri-count">Menampilkan 0 dari ${totalDocuments} santri</div>
      <p style="margin: 10px; text-align: center; font-size: large;">Tidak ada santri yang sesuai.</p>
    `;
    return;
  }

  const startIndex = startIdx + 1;
  const endIndex = endIdx;

  let html = `<div class="santri-count">Menampilkan ${startIndex} - ${endIndex} dari ${totalDocuments} santri</div>`;
  html += '<div class="table-container"><table class="keuangan-table">';

  if (isMobile) {
    html += `<thead><tr><th>Nama</th><th>Kelas</th><th>Saldo</th></tr></thead><tbody>`;
    pageData.forEach(s => {
      html += `<tr>
        <td><a href="#" class="santri-link" data-id="${s.id}">${escapeHtml(s.nama)}</a></td>
        <td>${escapeHtml(s.kelasDiniyah || '-')}</td>
        <td style="font-weight:bold;color:${s.saldo >= 0 ? '#2e7d32' : '#c62828'}">Rp ${(s.saldo || 0).toLocaleString('id-ID')}</td>
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
        <td style="font-weight:bold;color:${s.saldo >= 0 ? '#2e7d32' : '#c62828'}">Rp ${(s.saldo || 0).toLocaleString('id-ID')}</td>
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
  html += `<div class="pagination-controls" style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:0.5rem;">
    <span>Halaman ${currentPage} dari ${totalPages}</span>
    <div>
      <button class="btn-secondary" id="prevPageBtn" ${prevDisabled ? 'disabled' : ''}>Sebelumnya</button>
      <button class="btn-secondary" id="nextPageBtn" ${nextDisabled ? 'disabled' : ''}>Berikutnya</button>
    </div>
  </div>`;

  container.innerHTML = html;

  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; applyFiltersAndSort(); }
  });
  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; applyFiltersAndSort(); }
  });

  document.querySelectorAll('.santri-link, .detail-transaksi-btn').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      await showSantriKeuangan(el.dataset.id);
    });
  });
}

// ===== DROPDOWN KELAS =====
function updateKelasDropdown() {
  const select = document.getElementById('filterKelasKeuanganModal');
  if (!select) return;
  const currentVal = select.value;
  const kelasSet = new Set();
  saldoSantriList.forEach(s => {
    if (s.kelasDiniyah) kelasSet.add(s.kelasDiniyah);
  });
  const kelasList = Array.from(kelasSet).sort();
  select.innerHTML = '<option value="Semua">Semua</option>';
  kelasList.forEach(k => {
    select.innerHTML += `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`;
  });
  select.value = currentVal || 'Semua';
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

// ===== GENERATE NOMOR TRANSAKSI (counter dokumen) =====
async function generateNomorTransaksi() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const counterRef = doc(db, "counters", `trx_${dateStr}`);
  let nomor;
  await runTransaction(db, async (trx) => {
    const snap = await trx.get(counterRef);
    const next = snap.exists() ? (snap.data().last || 0) + 1 : 1;
    trx.set(counterRef, { last: next, date: dateStr }, { merge: true });
    nomor = `TRX-${dateStr}-${String(next).padStart(4, '0')}`;
  });
  return nomor;
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

  currentTransaksiId = editData ? editData.id : null;

  formContainer.innerHTML = buildFormTransaksiHtml();
  loadSantriDatalist();

  if (editData && editData.namaSantri) {
    const namaInput = document.getElementById('namaSantriInput');
    if (namaInput) namaInput.value = editData.namaSantri;
  }

  document.getElementById('transaksiForm').onsubmit = (e) => {
    e.preventDefault();
    saveTransaksiForm();
  };
  document.getElementById('btnBatalTransaksiForm').onclick = () => hideFormTransaksi();
}

function hideFormTransaksi() {
  const formContainer = document.getElementById('transaksi-form-container');
  if (formContainer) formContainer.style.display = 'none';
  const pageContainer = document.getElementById('keuangan-page-container');
  if (pageContainer) pageContainer.style.display = 'flex';
  const headerActions = document.getElementById('keuangan-header-actions');
  if (headerActions) headerActions.style.display = 'flex';
  const backBtn = document.getElementById('btnBackTransaksiForm');
  if (backBtn) backBtn.style.display = 'none';
  currentTransaksiId = null;
}

function buildFormTransaksiHtml() {
  return `
    <div class="form-card">
      <h3>Tambah Transaksi Baru</h3>
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
            <input type="number" id="jumlahTransaksi" required min="1">
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

// Pakai data di memori, tanpa getDocs
function loadSantriDatalist() {
  const datalist = document.getElementById('santriDatalist');
  if (!datalist) return;
  datalist.innerHTML = '';
  saldoSantriList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.nama;
    opt.setAttribute('data-id', s.id);
    opt.textContent = `${s.nama} (NISN: ${s.nisn || '-'})`;
    datalist.appendChild(opt);
  });
}

// ===== SIMPAN TRANSAKSI (batch + increment) =====
async function saveTransaksiForm() {
  const namaSantri = document.getElementById('namaSantriInput').value.trim();
  if (!namaSantri) return await window.customAlert("Pilih nama santri");

  const santri = saldoSantriList.find(s => s.nama.toLowerCase() === namaSantri.toLowerCase());
  if (!santri) {
    return await window.customAlert(`Santri "${namaSantri}" tidak ditemukan. Pilih dari daftar.`);
  }

  const jenis = document.getElementById('jenisTransaksi').value;
  const jumlah = parseInt(document.getElementById('jumlahTransaksi').value);
  const tanggal = document.getElementById('tglTransaksi').value;
  const keterangan = document.getElementById('keteranganTransaksi').value.trim();
  const admin = auth.currentUser?.email || "Admin";

  if (isNaN(jumlah) || jumlah <= 0) return await window.customAlert("Jumlah harus positif");
  if (!tanggal) return await window.customAlert("Pilih tanggal");

  if (currentTransaksiId) {
    return await window.customAlert("Edit transaksi tidak diizinkan. Hapus dan buat baru.");
  }

  try {
    const nomorTransaksi = await generateNomorTransaksi();
    const delta = jenis === "Pemasukan" ? jumlah : -jumlah;

    const batch = writeBatch(db);

    const trxRef = doc(collection(db, "keuangan"));
    batch.set(trxRef, {
      nomorTransaksi,
      santriId: santri.id,
      namaSantri: santri.nama,
      kelas: santri.kelasDiniyah,
      jenis, jumlah, tanggal, keterangan, admin,
      createdAt: new Date().toISOString()
    });

    const saldoRef = doc(db, "saldo_santri", santri.id);
    batch.set(saldoRef, {
      santriId: santri.id,
      nama: santri.nama,
      nisn: santri.nisn || '',
      kelasDiniyah: santri.kelasDiniyah || '',
      kelasFormal: santri.kelasFormal || '',
      asrama: santri.asrama || '',
      saldo: increment(delta),
      transaksiCount: increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await batch.commit();
    await window.customAlert("Transaksi berhasil disimpan");
    hideFormTransaksi();
  } catch (err) {
    console.error(err);
    await window.customAlert("Gagal simpan: " + err.message);
  }
}

// ===== HAPUS TRANSAKSI (batch + increment negatif) =====
async function deleteTransaksi(id) {
  if (!await window.customConfirm("Hapus transaksi ini? Saldo akan diperbarui otomatis.")) return;

  try {
    const trxSnap = await getDoc(doc(db, "keuangan", id));
    if (!trxSnap.exists()) {
      return await window.customAlert("Transaksi tidak ditemukan.");
    }
    const t = trxSnap.data();

    const delta = t.jenis === "Pemasukan" ? -t.jumlah : t.jumlah;

    const batch = writeBatch(db);
    batch.delete(doc(db, "keuangan", id));
    batch.set(doc(db, "saldo_santri", t.santriId), {
      saldo: increment(delta),
      transaksiCount: increment(-1),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await batch.commit();
    await window.customAlert("Transaksi dihapus.");
  } catch (err) {
    console.error(err);
    await window.customAlert("Gagal hapus: " + err.message);
  }
}

// ===== DETAIL KEUANGAN SANTRI =====
async function showSantriKeuangan(santriId) {
  const santri = saldoSantriList.find(x => x.id === santriId);
  if (!santri) {
    return await window.customAlert("Santri tidak ditemukan");
  }

  const mainContent = document.getElementById('main-content');
  mainContent.innerHTML = `
    <div style="display:flex;justify-content:center;padding:2rem;color:var(--primary);">
      <i class="fas fa-spinner fa-spin fa-2x"></i>
    </div>
  `;

  let transaksi = [];
  try {
    const q = query(
      collection(db, "keuangan"),
      where("santriId", "==", santriId),
      orderBy("tanggal", "desc"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const snap = await getDocs(q);
    transaksi = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    mainContent.innerHTML = `<p style="color:red;padding:1rem;">Gagal memuat transaksi: ${err.message}</p>`;
    return;
  }

  // Hitung saldo berjalan per transaksi (dari terlama ke terbaru)
  const asc = [...transaksi].reverse();
  let running = 0;
  const withSaldo = asc.map(t => {
    if (t.jenis === "Pemasukan") running += t.jumlah;
    else running -= t.jumlah;
    return { ...t, saldoHitung: running };
  });
  const transaksiTerbaru = [...withSaldo].reverse();

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
            <div class="detail-item"><i class="fas fa-building"></i> Asrama: ${escapeHtml(santri.asrama || '-')}</div>
            <div class="detail-item"><i class="fas fa-book"></i> Kelas Diniyah: ${escapeHtml(santri.kelasDiniyah || '-')}</div>
            <div class="detail-item"><i class="fas fa-school"></i> Kelas Formal: ${escapeHtml(santri.kelasFormal || '-')}</div>
          </div>
        </div>
      </div>
      <div class="saldo-card-modern">
        <div class="saldo-label"><i class="fas fa-wallet"></i> Saldo Akhir Santri</div>
        <div class="saldo-amount">Rp ${(santri.saldo || 0).toLocaleString('id-ID')}</div>
      </div>
      <div class="history-section">
        <h3><i class="fas fa-history"></i> Riwayat Transaksi ${transaksiTerbaru.length >= 100 ? '(100 terbaru)' : ''}</h3>
        <div class="table-container">
          <table class="keuangan-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Nomor</th>
                <th>Jenis</th>
                <th>Jumlah</th>
                <th>Keterangan</th>
                <th>Admin</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${transaksiTerbaru.map(t => `
                <tr>
                  <td>${formatTanggal(t.tanggal)}</td>
                  <td><small>${escapeHtml(t.nomorTransaksi || '-')}</small></td>
                  <td style="color:${t.jenis === 'Pemasukan' ? '#2e7d32' : '#c62828'}">
                    <i class="fas ${t.jenis === 'Pemasukan' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                    ${t.jenis}
                  </td>
                  <td>Rp ${(t.jumlah || 0).toLocaleString('id-ID')}</td>
                  <td>${escapeHtml(t.keterangan || '-')}</td>
                  <td>${escapeHtml(t.admin || '-')}</td>
                  <td class="action-cell">
                    <button class="btn-danger delete-trx-btn" data-id="${t.id}" title="Hapus">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${transaksiTerbaru.length === 0 ? '<p class="empty-state">Belum ada transaksi untuk santri ini.</p>' : ''}
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem;">
        <button id="btnTambahTransaksiSantri" class="btn-primary"><i class="fas fa-plus"></i> Tambah Transaksi</button>
      </div>
    </div>
  `;

  mainContent.innerHTML = detailHtml;

  document.getElementById('backToKeuangan').onclick = async () => {
    await loadKeuangan(mainContent);
  };
  document.getElementById('btnTambahTransaksiSantri').onclick = () => {
    showFormTransaksi();
    setTimeout(() => {
      const namaInput = document.getElementById('namaSantriInput');
      if (namaInput) {
        namaInput.value = santri.nama;
        namaInput.dispatchEvent(new Event('input'));
      }
    }, 100);
  };

  // Tombol hapus per transaksi
  mainContent.querySelectorAll('.delete-trx-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteTransaksi(btn.dataset.id);
      // Refresh halaman detail
      await showSantriKeuangan(santriId);
    });
  });
}

// ===== EKSPOR CSV =====
async function exportSantriSaldoToCSV() {
  if (saldoSantriList.length === 0) {
    return await window.customAlert("Tidak ada data santri untuk diekspor.");
  }
  const columns = ["Nama", "Kelas Diniyah", "Saldo Terakhir", "Jumlah Transaksi", "NISN", "Kelas Formal", "Asrama"];
  const rows = [columns];
  for (const s of saldoSantriList) {
    rows.push([
      `"${(s.nama || '').replace(/"/g, '""')}"`,
      `"${(s.kelasDiniyah || '').replace(/"/g, '""')}"`,
      s.saldo || 0,
      s.transaksiCount || 0,
      `"${(s.nisn || '').replace(/"/g, '""')}"`,
      `"${(s.kelasFormal || '').replace(/"/g, '""')}"`,
      `"${(s.asrama || '').replace(/"/g, '""')}"`
    ].join(','));
  }
  const csvContent = rows.join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", `saldo_santri_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== IMPOR CSV =====
async function importKeuanganFromCSV(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) {
        return await window.customAlert("File CSV tidak memiliki data (minimal header + 1 baris).");
      }

      // Santri map dari memori (0 read)
      const santriMap = new Map();
      saldoSantriList.forEach(s => {
        if (s.nama) santriMap.set(s.nama.toLowerCase(), s);
      });

      const rawHeaders = rows[0];
      const headerIndex = {};
      const expectedHeaders = ["nomorTransaksi", "tanggal", "namaSantri", "jenis", "jumlah", "admin", "keterangan"];
      for (let i = 0; i < rawHeaders.length; i++) {
        const h = rawHeaders[i].trim().toLowerCase();
        const found = expectedHeaders.find(eh => eh.toLowerCase() === h);
        if (found) headerIndex[found] = i;
      }
      const missing = expectedHeaders.filter(h => !(h in headerIndex));
      if (missing.length > 0) {
        return await window.customAlert(`Header CSV tidak lengkap. Kolom yang hilang: ${missing.join(', ')}`);
      }

      const dataRows = rows.slice(1).filter(row => row.some(c => c.trim() !== ""));
      if (dataRows.length === 0) {
        return await window.customAlert("Tidak ada data valid untuk diimpor.");
      }

      const transaksiData = [];
      const deltaPerSantri = new Map();
      const countPerSantri = new Map();
      const errors = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const obj = {};
        for (const field of expectedHeaders) {
          const idx = headerIndex[field];
          obj[field] = (idx !== undefined && row[idx] !== undefined) ? row[idx].trim() : '';
        }

        const namaSantri = obj.namaSantri;
        if (!namaSantri) { errors.push(`Baris ${i + 2}: namaSantri wajib diisi`); continue; }

        const santriData = santriMap.get(namaSantri.toLowerCase());
        if (!santriData) { errors.push(`Baris ${i + 2}: santri "${namaSantri}" tidak ditemukan`); continue; }

        if (!obj.tanggal) { errors.push(`Baris ${i + 2}: tanggal wajib diisi`); continue; }

        const jenisLower = obj.jenis.toLowerCase();
        if (!["pemasukan", "pengeluaran"].includes(jenisLower)) {
          errors.push(`Baris ${i + 2}: jenis harus 'Pemasukan' atau 'Pengeluaran'`); continue;
        }
        const jenis = jenisLower === "pemasukan" ? "Pemasukan" : "Pengeluaran";

        const jumlah = parseInt(obj.jumlah);
        if (isNaN(jumlah) || jumlah <= 0) {
          errors.push(`Baris ${i + 2}: jumlah harus angka positif`); continue;
        }

        const admin = obj.admin || auth.currentUser?.email || "Admin";
        const delta = jenis === "Pemasukan" ? jumlah : -jumlah;

        deltaPerSantri.set(santriData.id, (deltaPerSantri.get(santriData.id) || 0) + delta);
        countPerSantri.set(santriData.id, (countPerSantri.get(santriData.id) || 0) + 1);

        transaksiData.push({
          santriId: santriData.id,
          namaSantri: santriData.nama,
          kelas: santriData.kelasDiniyah || '',
          jenis, jumlah,
          tanggal: obj.tanggal,
          keterangan: obj.keterangan || '',
          admin
        });
      }

      if (errors.length > 0) {
        return await window.customAlert(
          `Terdapat ${errors.length} error:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... dan ${errors.length - 5} lainnya` : ''}`
        );
      }

      const ok = await window.customConfirm(`Akan mengimpor ${transaksiData.length} transaksi. Lanjutkan?`);
      if (!ok) return;

      // Siapkan nomor transaksi (1x baca counter)
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const counterRef = doc(db, "counters", `trx_${dateStr}`);
      const counterSnap = await getDoc(counterRef);
      let lastNumber = counterSnap.exists() ? (counterSnap.data().last || 0) : 0;

      transaksiData.forEach(t => {
        lastNumber++;
        t.nomorTransaksi = `TRX-${dateStr}-${String(lastNumber).padStart(4, '0')}`;
        t.createdAt = new Date().toISOString();
      });

      // Tulis transaksi dalam batch
      const BATCH_SIZE = 400;
      for (let i = 0; i < transaksiData.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        transaksiData.slice(i, i + BATCH_SIZE).forEach(t => {
          batch.set(doc(collection(db, "keuangan")), t);
        });
        await batch.commit();
      }

      // Update saldo_santri dengan agregat per santri
      const saldoEntries = Array.from(deltaPerSantri.entries());
      for (let i = 0; i < saldoEntries.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        saldoEntries.slice(i, i + BATCH_SIZE).forEach(([sid, delta]) => {
          batch.set(doc(db, "saldo_santri", sid), {
            saldo: increment(delta),
            transaksiCount: increment(countPerSantri.get(sid) || 0),
            updatedAt: serverTimestamp()
          }, { merge: true });
        });
        await batch.commit();
      }

      // Update counter sekali
      await setDoc(counterRef, { last: lastNumber, date: dateStr }, { merge: true });

      await window.customAlert(`Impor selesai: ${transaksiData.length} transaksi berhasil.`);
    } catch (err) {
      console.error("Import error:", err);
      await window.customAlert("Gagal impor: " + err.message);
    }
  };
  reader.onerror = () => window.customAlert("Gagal membaca file.");
  reader.readAsText(file, "UTF-8");
}

function parseCSV(text) {
  const rows = [];
  let inQuote = false, currentRow = [], currentField = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { currentField += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\n' && !inQuote) {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (ch === '\r' && !inQuote) {
      // skip
    } else {
      currentField += ch;
    }
    i++;
  }
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows.map(row => row.map(f => f.trim()));
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
  return String(str).replace(/[&<>"]/g, m => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return m;
  });
}
