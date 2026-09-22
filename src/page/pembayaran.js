// pembayaran.js — Catatan pembayaran santri (rekap kuitansi fisik).
// Terpisah total dari keuangan.js: tidak menyentuh saldo santri / saldo global.
// Read-irit: hanya listener ke saldo_santri untuk daftar nama.

import { db, auth } from '../firebase.js';
import {
  collection, doc, onSnapshot, getDocs, getDoc,
  query, where, orderBy, limit, runTransaction,
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getCache, setCache, getServerVersion } from '../utils/cache.js';

// ============================================================
//  STATE MODUL
// ============================================================
let unsubscribeSaldo = null;
let saldoSantriList = [];         // sumber daftar nama santri

const PAGE_SIZE = 40;
let currentPage = 1;
let totalDocuments = 0;

let filterState = { kelas: 'Semua', search: '' };
let sortState = 'kelasAsc';

// Detail page
let currentDetailSantriId = null;
let currentDetailTransaksiList = [];

// Form
let isFormOpen = false;

// ============================================================
//  ENTRY POINT
// ============================================================
export function loadPembayaran(container) {
  renderPembayaranPage(container);
  currentPage = 1;
  loadSantriForPembayaran();
}

// Dipanggil app.js saat pindah halaman / logout
export function cleanupPembayaran() {
  // unsubscribeSaldo tidak lagi aktif
  unsubscribeSaldo = null;

  saldoSantriList = [];
  currentDetailSantriId = null;
  currentDetailTransaksiList = [];
  currentPage = 1;
  filterState = { kelas: 'Semua', search: '' };
  sortState = 'kelasAsc';
  isFormOpen = false;
}

// ============================================================
//  RENDER HALAMAN UTAMA
// ============================================================
function renderPembayaranPage(container) {
  container.innerHTML = `
    <div id="pembayaran-page-container">
      <div id="pembayaran-header-actions">
        <div class="header-left-buttons">
          <button id="btnTambahPembayaran" class="btn-primary"><i class="fas fa-plus"></i></button>
          <button id="btnFilterPembayaran" class="btn-secondary"><i class="fas fa-sliders-h"></i></button>
        </div>
        <div class="search-wrapper">
          <i class="fas fa-search search-icon"></i>
          <input type="text" id="searchPembayaran" placeholder="Cari nama santri..." class="search-input">
        </div>
      </div>
      <div id="pembayaran-scroll-area">
        <div id="pembayaranTable"></div>
      </div>
    </div>
    <div id="pembayaran-form-container" style="display:none;"></div>
    <div id="pembayaran-detail-container" style="display:none;"></div>
  `;

  document.getElementById('btnTambahPembayaran').onclick = () => showFormPembayaran();
  document.getElementById('btnFilterPembayaran').onclick = () => openFilterModal();

  const searchInput = document.getElementById('searchPembayaran');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterState.search = e.target.value.trim().toLowerCase();
      currentPage = 1;
      applyFiltersAndSort();
    });
  }

  ensureFilterModal();
}

function ensureFilterModal() {
  if (document.getElementById('filterModalPembayaran')) return;

  const modalHTML = `
    <div id="filterModalPembayaran" class="modal" style="display:none;">
      <div class="modal-content">
        <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan Santri</h3>
        <div class="form-group">
          <label for="sortPembayaranModal">Urutkan</label>
          <select id="sortPembayaranModal">
            <option value="kelasAsc">Kelas Diniyah (A-Z)</option>
            <option value="kelasDesc">Kelas Diniyah (Z-A)</option>
            <option value="namaAsc">Nama Santri (A-Z)</option>
            <option value="namaDesc">Nama Santri (Z-A)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="filterKelasPembayaranModal">Kelas Diniyah</label>
          <select id="filterKelasPembayaranModal">
            <option value="Semua">Semua</option>
          </select>
        </div>
        <div class="form-buttons" style="margin-top:1.5rem;">
          <button id="applyFilterPembayaranBtn" class="btn-primary">Terapkan</button>
          <button id="resetFilterPembayaranBtn" class="btn-secondary">Reset</button>
          <button id="closeFilterPembayaranBtn" class="btn-secondary">Tutup</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('applyFilterPembayaranBtn').onclick = () => {
    sortState = document.getElementById('sortPembayaranModal').value;
    filterState.kelas = document.getElementById('filterKelasPembayaranModal').value;
    currentPage = 1;
    applyFiltersAndSort();
    closeFilterModal();
  };
  document.getElementById('resetFilterPembayaranBtn').onclick = () => {
    document.getElementById('sortPembayaranModal').value = 'kelasAsc';
    document.getElementById('filterKelasPembayaranModal').value = 'Semua';
    sortState = 'kelasAsc';
    filterState.kelas = 'Semua';
    filterState.search = '';
    const s = document.getElementById('searchPembayaran');
    if (s) s.value = '';
    currentPage = 1;
    applyFiltersAndSort();
    closeFilterModal();
  };
  document.getElementById('closeFilterPembayaranBtn').onclick = closeFilterModal;
  document.getElementById('filterModalPembayaran').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFilterModal();
  });
}

function openFilterModal() {
  const modal = document.getElementById('filterModalPembayaran');
  if (!modal) return;
  document.getElementById('sortPembayaranModal').value = sortState;
  document.getElementById('filterKelasPembayaranModal').value = filterState.kelas;
  modal.style.display = 'flex';
}

function closeFilterModal() {
  const modal = document.getElementById('filterModalPembayaran');
  if (modal) modal.style.display = 'none';
}

// ============================================================
//  LISTENER SALDO_SANTRI (untuk daftar nama)
// ============================================================
async function loadSantriForPembayaran() {
  try {
    const serverVersion = await getServerVersion('santri_version');
    const cached = getCache('santri');

    let list;
    if (cached && serverVersion !== null && cached.version === serverVersion) {
      list = cached.data;
    } else {
      const snap = await getDocs(collection(db, "santri"));
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (serverVersion !== null) {
        setCache('santri', serverVersion, list);
      }
    }

    // Transform ke format yang dipakai halaman pembayaran
    saldoSantriList = list.map((s) => ({
      id: s.id,
      nama: s.nama || '',
      nisn: s.nisn || '',
      kelasDiniyah: s.kepesantrenan?.kelasDiniyah || '',
      kelasFormal: s.kepesantrenan?.kelasFormal || '',
      asrama: s.kepesantrenan?.asrama || ''
    }));

    updateKelasDropdown();
    applyFiltersAndSort();
  } catch (err) {
    console.error("Gagal load santri untuk pembayaran:", err);
  }
}

function updateKelasDropdown() {
  const select = document.getElementById('filterKelasPembayaranModal');
  if (!select) return;
  const currentVal = select.value;
  const kelasSet = new Set();
  saldoSantriList.forEach((s) => {
    if (s.kelasDiniyah) kelasSet.add(s.kelasDiniyah);
  });
  const kelasList = Array.from(kelasSet).sort();
  select.innerHTML = '<option value="Semua">Semua</option>';
  kelasList.forEach((k) => {
    select.innerHTML += `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`;
  });
  select.value = currentVal || 'Semua';
}

// ============================================================
//  FILTER & SORTIR
// ============================================================
function applyFiltersAndSort() {
  const search = filterState.search || '';
  const kelasFilter = filterState.kelas;

  let filtered = saldoSantriList.slice();

  if (kelasFilter !== 'Semua') {
    filtered = filtered.filter((s) => s.kelasDiniyah === kelasFilter);
  }

  if (search) {
    filtered = filtered.filter((s) => s.nama.toLowerCase().includes(search));
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
    default:
      filtered.sort((a, b) =>
        a.kelasDiniyah.localeCompare(b.kelasDiniyah) || a.nama.localeCompare(b.nama));
  }

  totalDocuments = filtered.length;
  renderSantriTable(filtered);
}

// ============================================================
//  TABEL SANTRI
// ============================================================
function renderSantriTable(filteredData) {
  const container = document.getElementById('pembayaranTable');
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
    html += `<thead><tr><th>Nama</th><th>Kelas</th></tr></thead><tbody>`;
    pageData.forEach((s) => {
      html += `<tr>
        <td><a href="#" class="santri-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</a></td>
        <td>${escapeHtml(s.kelasDiniyah || '-')}</td>
      </tr>`;
    });
  } else {
    html += `<thead><tr>
      <th>Nama Santri</th>
      <th>Kelas Diniyah</th>
      <th>Aksi</th>
    </tr></thead><tbody>`;
    pageData.forEach((s) => {
      html += `<tr>
        <td><a href="#" class="santri-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</a></td>
        <td>${escapeHtml(s.kelasDiniyah || '-')}</td>
        <td class="action-cell">
          <button class="detail-transaksi-btn" data-id="${escapeHtml(s.id)}">
            <i class="fas fa-receipt"></i> Pembayaran
          </button>
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

  document.querySelectorAll('.santri-link, .detail-transaksi-btn').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      await showSantriPembayaran(el.dataset.id);
    });
  });
}

// ============================================================
//  DETAIL PEMBAYARAN SANTRI
// ============================================================
async function showSantriPembayaran(santriId) {
  const santri = saldoSantriList.find((x) => x.id === santriId);
  if (!santri) {
    return await window.customAlert("Santri tidak ditemukan");
  }

  currentDetailSantriId = santriId;

  // Sembunyikan halaman utama, tampilkan detail
  const pageContainer = document.getElementById('pembayaran-page-container');
  const formContainer = document.getElementById('pembayaran-form-container');
  const detailContainer = document.getElementById('pembayaran-detail-container');
  if (pageContainer) pageContainer.style.display = 'none';
  if (formContainer) formContainer.style.display = 'none';
  detailContainer.style.display = 'block';

  detailContainer.innerHTML = `
    <div style="display:flex;justify-content:center;padding:2rem;color:var(--primary);">
      <i class="fas fa-spinner fa-spin fa-2x"></i>
    </div>
  `;

  // Ambil 50 transaksi terakhir milik santri ini
  let transaksi = [];
  try {
    const q = query(
      collection(db, "pembayaran"),
      where("santriId", "==", santriId),
      orderBy("tanggal", "desc"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    transaksi = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    detailContainer.innerHTML = `<p style="color:red;padding:1rem;">Gagal memuat pembayaran: ${escapeHtml(err.message)}</p>`;
    return;
  }

  currentDetailTransaksiList = transaksi;

  const totalNominal = transaksi.reduce((sum, t) => sum + (t.jumlah || 0), 0);

  detailContainer.innerHTML = `
    <div id="santri-pembayaran-detail">
      <button id="backToPembayaran" class="btn-secondary" style="margin-bottom:1.5rem">
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
        <div class="saldo-label"><i class="fas fa-receipt"></i> Total Pembayaran Tercatat</div>
        <div class="saldo-amount">Rp ${totalNominal.toLocaleString('id-ID')}</div>
        <div style="margin-top:0.5rem;font-size:0.85rem;color:var(--gray-600);">
          ${transaksi.length} transaksi ${transaksi.length >= 50 ? '(50 terbaru)' : ''}
        </div>
      </div>

      <div class="history-section">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
          <h3 style="margin:0;"><i class="fas fa-history"></i> Riwayat Pembayaran</h3>
          <button id="btnExportPembayaranCSV" class="btn-secondary" style="font-size:0.85rem;padding:6px 12px;">
            <i class="fas fa-download"></i> Ekspor CSV
          </button>
        </div>
        <div class="table-container">
          <table class="keuangan-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Nomor</th>
                <th>Jumlah</th>
                <th>Keterangan</th>
                <th>Admin</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${transaksi.length === 0 ? '' : transaksi.map((t) => `
                <tr>
                  <td>${formatTanggal(t.tanggal)}</td>
                  <td><small>${escapeHtml(t.nomorTransaksi || '-')}</small></td>
                  <td>Rp ${(t.jumlah || 0).toLocaleString('id-ID')}</td>
                  <td>${escapeHtml(t.keterangan || '-')}</td>
                  <td>${escapeHtml(t.admin || '-')}</td>
                  <td class="action-cell">
                    <button class="btn-danger delete-pay-btn" data-id="${escapeHtml(t.id)}" title="Hapus">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${transaksi.length === 0 ? '<p class="empty-state">Belum ada pembayaran untuk santri ini.</p>' : ''}
      </div>

      <div style="margin-top:1rem;display:flex;gap:0.5rem;">
        <button id="btnTambahPembayaranSantri" class="btn-primary">
          <i class="fas fa-plus"></i> Tambah Pembayaran
        </button>
      </div>
    </div>
  `;

  document.getElementById('backToPembayaran').onclick = () => {
    currentDetailSantriId = null;
    currentDetailTransaksiList = [];
    backToMainList();
  };
  document.getElementById('btnTambahPembayaranSantri').onclick = () => {
    showFormPembayaran(santri);
  };
  document.getElementById('btnExportPembayaranCSV').onclick = () => {
    exportDetailPembayaranCSV(santri, transaksi);
  };

  document.querySelectorAll('.delete-pay-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await deletePembayaran(btn.dataset.id);
      if (ok) {
        // Refresh halaman detail
        await showSantriPembayaran(santriId);
      }
    });
  });
}

function backToMainList() {
  const pageContainer = document.getElementById('pembayaran-page-container');
  const formContainer = document.getElementById('pembayaran-form-container');
  const detailContainer = document.getElementById('pembayaran-detail-container');
  if (formContainer) formContainer.style.display = 'none';
  if (detailContainer) detailContainer.style.display = 'none';
  if (pageContainer) pageContainer.style.display = 'flex';
  applyFiltersAndSort();
}

// ============================================================
//  FORM TAMBAH PEMBAYARAN
// ============================================================
function showFormPembayaran(santriPreset = null) {
  const formContainer = document.getElementById('pembayaran-form-container');
  const pageContainer = document.getElementById('pembayaran-page-container');
  const detailContainer = document.getElementById('pembayaran-detail-container');

  if (pageContainer) pageContainer.style.display = 'none';
  if (detailContainer) detailContainer.style.display = 'none';
  formContainer.style.display = 'block';

  isFormOpen = true;

  // Tombol kembali
  let backBtn = document.getElementById('btnBackPembayaranForm');
  if (!backBtn) {
    backBtn = document.createElement('button');
    backBtn.id = 'btnBackPembayaranForm';
    backBtn.className = 'btn-secondary';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
    backBtn.style.marginBottom = '1rem';
    formContainer.parentNode.insertBefore(backBtn, formContainer);
  }
  backBtn.style.display = 'inline-flex';
  backBtn.onclick = () => {
    isFormOpen = false;
    // Kalau sebelumnya dari detail, kembali ke detail; kalau tidak, ke daftar
    if (currentDetailSantriId) {
      formContainer.style.display = 'none';
      backBtn.style.display = 'none';
      showSantriPembayaran(currentDetailSantriId);
    } else {
      backBtn.style.display = 'none';
      backToMainList();
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  formContainer.innerHTML = `
    <div class="form-card">
      <h3>Tambah Pembayaran Baru</h3>
      <form id="pembayaranForm">
        <div class="form-group">
          <label>Nama Santri *</label>
          <input type="text" id="namaSantriPembayaran" list="santriDatalistPembayaran"
            required placeholder="Ketik nama santri..." autocomplete="off" class="search-input">
          <datalist id="santriDatalistPembayaran"></datalist>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Tanggal *</label>
            <input type="date" id="tglPembayaran" required value="${today}">
          </div>
          <div class="form-group">
            <label>Jumlah (Rp) *</label>
            <input type="number" id="jumlahPembayaran" required min="1" placeholder="Contoh: 50000">
          </div>
        </div>
        <div class="form-group">
          <label>Keterangan (Opsional)</label>
          <textarea id="keteranganPembayaran" rows="2" placeholder="Contoh: SPP bulan September, Syahriah, dll."></textarea>
        </div>
        <div class="form-buttons">
          <button type="submit" class="btn-primary">Simpan</button>
          <button type="button" id="btnBatalPembayaranForm" class="btn-secondary">Batal</button>
        </div>
      </form>
    </div>
  `;

  // Isi datalist dari memori (0 read)
  const datalist = document.getElementById('santriDatalistPembayaran');
  if (datalist) {
    saldoSantriList.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.nama;
      opt.setAttribute('data-id', s.id);
      opt.textContent = `${s.nama} (NISN: ${s.nisn || '-'})`;
      datalist.appendChild(opt);
    });
  }

  // Kalau preset santri (dari detail), isi otomatis
  if (santriPreset) {
    const namaInput = document.getElementById('namaSantriPembayaran');
    if (namaInput) namaInput.value = santriPreset.nama;
  }

  document.getElementById('pembayaranForm').onsubmit = (e) => {
    e.preventDefault();
    savePembayaran();
  };
  document.getElementById('btnBatalPembayaranForm').onclick = () => {
    isFormOpen = false;
    formContainer.style.display = 'none';
    backBtn.style.display = 'none';
    if (currentDetailSantriId) {
      showSantriPembayaran(currentDetailSantriId);
    } else {
      backToMainList();
    }
  };
}

// ============================================================
//  SIMPAN PEMBAYARAN
// ============================================================
async function savePembayaran() {
  const namaSantri = document.getElementById('namaSantriPembayaran').value.trim();
  if (!namaSantri) return await window.customAlert("Pilih nama santri");

  const santri = saldoSantriList.find(
    (s) => s.nama.toLowerCase() === namaSantri.toLowerCase()
  );
  if (!santri) {
    return await window.customAlert(`Santri "${namaSantri}" tidak ditemukan. Pilih dari daftar.`);
  }

  const jumlah = parseInt(document.getElementById('jumlahPembayaran').value);
  const tanggal = document.getElementById('tglPembayaran').value;
  const keterangan = document.getElementById('keteranganPembayaran').value.trim();
  const admin = auth.currentUser?.email || "Admin";

  if (isNaN(jumlah) || jumlah <= 0) return await window.customAlert("Jumlah harus positif");
  if (!tanggal) return await window.customAlert("Pilih tanggal");

  try {
    const nomorTransaksi = await generateNomorPembayaran();

    const data = {
      nomorTransaksi,
      santriId: santri.id,
      namaSantri: santri.nama,
      kelasDiniyah: santri.kelasDiniyah || '',
      tanggal,
      jumlah,
      keterangan,
      admin,
      createdAt: new Date().toISOString()
    };

    await writeBatch(db).set(doc(collection(db, "pembayaran")), data).commit();

    await window.customAlert("Pembayaran berhasil dicatat");
    isFormOpen = false;

    const backBtn = document.getElementById('btnBackPembayaranForm');
    if (backBtn) backBtn.style.display = 'none';
    document.getElementById('pembayaran-form-container').style.display = 'none';

    // Kalau sebelumnya di detail, kembali ke detail
    if (currentDetailSantriId) {
      await showSantriPembayaran(currentDetailSantriId);
    } else {
      backToMainList();
    }
  } catch (err) {
    console.error(err);
    await window.customAlert("Gagal simpan: " + err.message);
  }
}

// ============================================================
//  HAPUS PEMBAYARAN
// ============================================================
async function deletePembayaran(id) {
  const ok = await window.customConfirm(
    "Hapus catatan pembayaran ini? Tindakan ini tidak dapat dibatalkan."
  );
  if (!ok) return false;

  try {
    await writeBatch(db).delete(doc(db, "pembayaran", id)).commit();
    await window.customAlert("Pembayaran dihapus.");
    return true;
  } catch (err) {
    console.error(err);
    await window.customAlert("Gagal hapus: " + err.message);
    return false;
  }
}

// ============================================================
//  NOMOR TRANSAKSI PEMBAYARAN
// ============================================================
// Prefix "PAY-" beda dari "TRX-" di keuangan.js.
// Pakai counter dokumen agar tidak perlu baca seluruh koleksi.
async function generateNomorPembayaran() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const counterRef = doc(db, "counters", `pay_${dateStr}`);

  let nomor;
  await runTransaction(db, async (trx) => {
    const snap = await trx.get(counterRef);
    const next = snap.exists() ? (snap.data().last || 0) + 1 : 1;
    trx.set(counterRef, { last: next, date: dateStr, updatedAt: serverTimestamp() }, { merge: true });
    nomor = `PAY-${dateStr}-${String(next).padStart(4, '0')}`;
  });
  return nomor;
}

// ============================================================
//  EKSPOR CSV DARI DETAIL
// ============================================================
function exportDetailPembayaranCSV(santri, transaksi) {
  if (!transaksi || transaksi.length === 0) {
    window.customAlert("Belum ada pembayaran untuk diekspor.");
    return;
  }

  const columns = ["Nomor Transaksi", "Tanggal", "Nama Santri", "Kelas Diniyah", "Jumlah", "Keterangan", "Admin"];
  const rows = [columns];

  transaksi.forEach((t) => {
    rows.push([
      t.nomorTransaksi || '',
      t.tanggal || '',
      t.namaSantri || santri.nama || '',
      t.kelasDiniyah || santri.kelasDiniyah || '',
      t.jumlah || 0,
      t.keterangan || '',
      t.admin || ''
    ].map(csvEscape));
  });

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  const safeName = (santri.nama || 'santri').replace(/[^a-z0-9]/gi, '_');
  link.href = url;
  link.setAttribute("download", `pembayaran_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================
//  UTILITY
// ============================================================
function formatTanggal(tgl) {
  if (!tgl) return '-';
  const parts = tgl.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return tgl;
}

function csvEscape(cell) {
  let str = String(cell);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default:  return m;
    }
  });
}