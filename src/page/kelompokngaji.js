// kelompokngaji.js — versi bersih
// CRUD kelompok, filter & sortir per jenis, halaman detail dengan tambah/hapus anggota.
// Menggunakan satu listener santri bersama untuk semua keperluan hitung anggota.

import { db } from '../firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============================================================
//  STATE MODUL
// ============================================================
let unsubscribeKelompok = null;
let unsubscribeSantri = null;

let allKelompokData = [];
let santriList = [];
let anggotaCountsCache = {};   // { kelompokId: count }

let currentKelompokId = null;
let currentDetailKelompokId = null;

let filterStateKelompok = { jenis: 'Semua' };
let sortStateKelompok = 'urutanAsc';
let searchKeyword = '';

// ============================================================
//  ENTRY POINT
// ============================================================
export function loadKelompokNgaji(container) {
  renderKelompokPage(container);
  listenKelompok();
  listenSantriForCount();
}

// Dipanggil app.js saat pindah halaman / logout
export function cleanupKelompokNgaji() {
  if (unsubscribeKelompok) {
    unsubscribeKelompok();
    unsubscribeKelompok = null;
  }
  if (unsubscribeSantri) {
    unsubscribeSantri();
    unsubscribeSantri = null;
  }
  allKelompokData = [];
  santriList = [];
  anggotaCountsCache = {};
  currentKelompokId = null;
  currentDetailKelompokId = null;
  filterStateKelompok = { jenis: 'Semua' };
  sortStateKelompok = 'urutanAsc';
  searchKeyword = '';
}

// ============================================================
//  RENDER HALAMAN UTAMA
// ============================================================
function renderKelompokPage(container) {
  container.innerHTML = `
    <div id="kelompok-page-container">
      <div id="kelompok-header-actions">
        <div class="header-left-buttons">
          <button id="tambahKelompokBtn" class="btn-primary"><i class="fas fa-plus"></i></button>
          <button id="btnFilterKelompok" class="btn-secondary"><i class="fas fa-sliders-h"></i> Filter</button>
        </div>
        <div class="search-wrapper">
          <i class="fas fa-search search-icon"></i>
          <input type="text" id="searchKelompok" placeholder="Cari kelompok / pembina..." class="search-input">
        </div>
        <div class="header-right-buttons desktop-only">
          <button id="btnExportKelompokCSV" class="btn-secondary"><i class="fas fa-download"></i> Ekspor CSV</button>
        </div>
      </div>
      <div id="kelompok-scroll-area">
        <div id="kelompokList" class="kelompok-grid"></div>
      </div>
    </div>
    <div id="kelompok-detail-container" style="display:none;"></div>
    <div id="kelompok-form-container" style="display:none;"></div>
  `;

  document.getElementById('tambahKelompokBtn').onclick = () => showKelompokForm();
  document.getElementById('btnFilterKelompok').onclick = () => openFilterModalKelompok();
  document.getElementById('btnExportKelompokCSV').onclick = () => exportKelompokToCSV();

  const searchInput = document.getElementById('searchKelompok');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchKeyword = e.target.value.toLowerCase();
      applyFiltersAndSort();
    });
  }

  ensureFilterModal();
}

function ensureFilterModal() {
  if (document.getElementById('filterModalKelompok')) return;

  const modalHTML = `
    <div id="filterModalKelompok" class="modal" style="display:none;">
      <div class="modal-content">
        <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan Kelompok</h3>
        <div class="form-group">
          <label for="sortKelompokModal">Urutkan</label>
          <select id="sortKelompokModal">
            <option value="urutanAsc">Urutan (default)</option>
            <option value="namaAsc">Nama (A–Z)</option>
            <option value="namaDesc">Nama (Z–A)</option>
            <option value="anggotaDesc">Jumlah Anggota (terbanyak)</option>
            <option value="anggotaAsc">Jumlah Anggota (tersedikit)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="filterJenisKelompokModal">Jenis Kelompok</label>
          <select id="filterJenisKelompokModal">
            <option value="Semua">Semua</option>
            <option value="Ngaji">Ngaji</option>
            <option value="Belajar">Belajar</option>
            <option value="Diniyah">Diniyah</option>
            <option value="Formal">Formal</option>
          </select>
        </div>
        <div class="form-buttons" style="margin-top:1.5rem;">
          <button id="applyFilterKelompokBtn" class="btn-primary">Terapkan</button>
          <button id="resetFilterKelompokBtn" class="btn-secondary">Reset</button>
          <button id="closeFilterKelompokBtn" class="btn-secondary">Tutup</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('applyFilterKelompokBtn').onclick = () => {
    sortStateKelompok = document.getElementById('sortKelompokModal').value;
    filterStateKelompok.jenis = document.getElementById('filterJenisKelompokModal').value;
    applyFiltersAndSort();
    closeFilterModalKelompok();
  };
  document.getElementById('resetFilterKelompokBtn').onclick = () => {
    document.getElementById('sortKelompokModal').value = 'urutanAsc';
    document.getElementById('filterJenisKelompokModal').value = 'Semua';
    sortStateKelompok = 'urutanAsc';
    filterStateKelompok.jenis = 'Semua';
    applyFiltersAndSort();
    closeFilterModalKelompok();
  };
  document.getElementById('closeFilterKelompokBtn').onclick = closeFilterModalKelompok;
  document.getElementById('filterModalKelompok').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFilterModalKelompok();
  });
}

function openFilterModalKelompok() {
  const modal = document.getElementById('filterModalKelompok');
  if (!modal) return;
  document.getElementById('sortKelompokModal').value = sortStateKelompok;
  document.getElementById('filterJenisKelompokModal').value = filterStateKelompok.jenis;
  modal.style.display = 'flex';
}

function closeFilterModalKelompok() {
  const modal = document.getElementById('filterModalKelompok');
  if (modal) modal.style.display = 'none';
}

// ============================================================
//  LISTENER
// ============================================================
function listenKelompok() {
  if (unsubscribeKelompok) unsubscribeKelompok();

  const q = query(collection(db, "kelompok"), orderBy("urutan", "asc"));
  unsubscribeKelompok = onSnapshot(
    q,
    (snapshot) => {
      allKelompokData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      applyFiltersAndSort();
    },
    (err) => console.error("kelompok listener error:", err)
  );
}

// Satu listener santri untuk semua keperluan:
// - hitung anggota per kelompok di daftar
// - dropdown "tambah anggota" di detail
// - refresh detail saat anggota berubah
// - ekspor CSV
function listenSantriForCount() {
  if (unsubscribeSantri) unsubscribeSantri();

  unsubscribeSantri = onSnapshot(
    collection(db, "santri"),
    (snapshot) => {
      santriList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      recomputeAnggotaCounts();
      applyFiltersAndSort();

      // Kalau detail sedang terbuka, refresh
      if (currentDetailKelompokId) {
        const kelompok = allKelompokData.find((k) => k.id === currentDetailKelompokId);
        if (kelompok) {
          renderDetailAnggota(kelompok);
          refreshDropdownSantri(kelompok);
        }
      }
    },
    (err) => console.error("santri listener error:", err)
  );
}

function recomputeAnggotaCounts() {
  const counts = {};
  allKelompokData.forEach((k) => {
    const field = getFieldForJenis(k.jenis);
    counts[k.id] = santriList.filter((s) => s.kepesantrenan?.[field] === k.nama).length;
  });
  anggotaCountsCache = counts;
}

// ============================================================
//  FILTER & SORTIR
// ============================================================
function applyFiltersAndSort() {
  let filtered = allKelompokData.filter((k) => {
    if (searchKeyword) {
      const match = (k.nama && k.nama.toLowerCase().includes(searchKeyword)) ||
                    (k.pembina && k.pembina.toLowerCase().includes(searchKeyword));
      if (!match) return false;
    }
    if (filterStateKelompok.jenis !== 'Semua' && k.jenis !== filterStateKelompok.jenis) {
      return false;
    }
    return true;
  });

  switch (sortStateKelompok) {
    case 'urutanAsc':
      filtered.sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
      break;
    case 'namaAsc':
      filtered.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      break;
    case 'namaDesc':
      filtered.sort((a, b) => (b.nama || '').localeCompare(a.nama || ''));
      break;
    case 'anggotaDesc':
      filtered.sort((a, b) => (anggotaCountsCache[b.id] || 0) - (anggotaCountsCache[a.id] || 0));
      break;
    case 'anggotaAsc':
      filtered.sort((a, b) => (anggotaCountsCache[a.id] || 0) - (anggotaCountsCache[b.id] || 0));
      break;
    default:
      break;
  }

  renderKelompokList(filtered);
}

// ============================================================
//  RENDER DAFTAR KELOMPOK
// ============================================================
function renderKelompokList(kelompoks) {
  const container = document.getElementById('kelompokList');
  if (!container) return;

  if (kelompoks.length === 0) {
    container.innerHTML = "<p class='empty-state'>Tidak ada kelompok yang sesuai.</p>";
    container.style.display = 'grid';
    return;
  }

  // Kelompokkan per jenis
  const grouped = { Ngaji: [], Belajar: [], Diniyah: [], Formal: [] };
  kelompoks.forEach((k) => {
    if (grouped[k.jenis]) grouped[k.jenis].push(k);
    else grouped[k.jenis] = [k];
  });

  const jenisUrutan = ['Ngaji', 'Belajar', 'Diniyah', 'Formal'];
  let html = '';

  jenisUrutan.forEach((jenis) => {
    const items = grouped[jenis];
    if (!items || items.length === 0) return;

    html += `
      <div class="kelompok-section">
        <h3 class="kelompok-section-title">
          <i class="fas ${getJenisIcon(jenis)}"></i> ${jenis}
        </h3>
        <div class="kelompok-grid-inner">
    `;

    items.forEach((k) => {
      const count = anggotaCountsCache[k.id] || 0;
      html += `
        <div class="kelompok-card">
          <div class="card-header">
            <i class="fas fa-users"></i>
            <h3>${escapeHtml(k.nama)}</h3>
          </div>
          <div class="card-body">
            <div class="info-row"><i class="fas fa-tag"></i> <strong>Jenis:</strong> ${escapeHtml(k.jenis)}</div>
            <div class="info-row"><i class="fas fa-chalkboard-user"></i> <strong>Pembina:</strong> ${k.pembina ? escapeHtml(k.pembina) : '-'}</div>
            <div class="info-row"><i class="fas fa-users"></i> <strong>Jumlah Anggota:</strong> ${count}</div>
            ${k.urutan !== undefined ? `<div class="info-row"><i class="fas fa-sort"></i> <strong>Urutan:</strong> ${k.urutan}</div>` : ''}
          </div>
          <div class="card-actions">
            <button class="detailKelompok" data-id="${escapeHtml(k.id)}"><i class="fas fa-info-circle"></i> Detail</button>
            <button class="editKelompok" data-id="${escapeHtml(k.id)}"><i class="fas fa-edit"></i> Edit</button>
            <button class="hapusKelompok" data-id="${escapeHtml(k.id)}"><i class="fas fa-trash"></i> Hapus</button>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;
  container.style.display = 'block';

  container.querySelectorAll('.detailKelompok').forEach((btn) => {
    btn.addEventListener('click', () => showKelompokDetail(btn.dataset.id));
  });
  container.querySelectorAll('.editKelompok').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kelompok = allKelompokData.find((k) => k.id === btn.dataset.id);
      if (kelompok) showKelompokForm(kelompok);
    });
  });
  container.querySelectorAll('.hapusKelompok').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (await window.customConfirm("Hapus kelompok ini? Data santri yang terkait tidak akan terhapus.")) {
        try {
          await deleteDoc(doc(db, "kelompok", id));
          await window.customAlert("Kelompok dihapus");
        } catch (err) {
          await window.customAlert("Gagal hapus: " + err.message);
        }
      }
    });
  });
}

function getJenisIcon(jenis) {
  switch (jenis) {
    case 'Ngaji':   return 'fa-book-quran';
    case 'Belajar': return 'fa-chalkboard-user';
    case 'Diniyah': return 'fa-mosque';
    case 'Formal':  return 'fa-school';
    default:        return 'fa-tag';
  }
}

// ============================================================
//  FORM TAMBAH / EDIT
// ============================================================
function showKelompokForm(editData = null) {
  const formContainer = document.getElementById('kelompok-form-container');
  const pageContainer = document.getElementById('kelompok-page-container');
  const detailContainer = document.getElementById('kelompok-detail-container');
  const headerActions = document.getElementById('kelompok-header-actions');

  if (headerActions) headerActions.style.display = 'none';
  if (pageContainer) pageContainer.style.display = 'none';
  if (detailContainer) detailContainer.style.display = 'none';
  formContainer.style.display = 'block';

  let backBtn = document.getElementById('btnBackKelompokForm');
  if (!backBtn) {
    backBtn = document.createElement('button');
    backBtn.id = 'btnBackKelompokForm';
    backBtn.className = 'btn-secondary';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
    backBtn.style.marginBottom = '1rem';
    formContainer.parentNode.insertBefore(backBtn, formContainer);
  }
  backBtn.style.display = 'inline-flex';
  backBtn.onclick = () => hideKelompokForm();

  currentKelompokId = editData ? editData.id : null;

  formContainer.innerHTML = buildKelompokFormHtml();

  if (currentKelompokId) {
    const formButtons = document.querySelector('#kelompokForm .form-buttons');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.className = 'btn-danger';
    deleteBtn.onclick = async () => {
      if (await window.customConfirm('Hapus kelompok ini? Data santri yang terkait tidak akan terhapus.')) {
        try {
          await deleteDoc(doc(db, "kelompok", currentKelompokId));
          await window.customAlert('Kelompok dihapus');
          hideKelompokForm();
        } catch (err) {
          await window.customAlert("Gagal hapus: " + err.message);
        }
      }
    };
    formButtons.appendChild(deleteBtn);
  }

  if (editData) {
    document.getElementById('kelompokNama').value = editData.nama || '';
    document.getElementById('kelompokJenis').value = editData.jenis || 'Ngaji';
    document.getElementById('kelompokPembina').value = editData.pembina || '';
    document.getElementById('kelompokUrutan').value = editData.urutan || 0;
  }

  document.getElementById('kelompokForm').onsubmit = (e) => {
    e.preventDefault();
    saveKelompok();
  };
  document.getElementById('btnBatalKelompokForm').onclick = () => hideKelompokForm();
}

function hideKelompokForm() {
  document.getElementById('kelompok-form-container').style.display = 'none';
  const pageContainer = document.getElementById('kelompok-page-container');
  const detailContainer = document.getElementById('kelompok-detail-container');
  if (pageContainer) pageContainer.style.display = 'block';
  if (detailContainer) detailContainer.style.display = 'none';
  const headerActions = document.getElementById('kelompok-header-actions');
  if (headerActions) headerActions.style.display = 'flex';
  const backBtn = document.getElementById('btnBackKelompokForm');
  if (backBtn) backBtn.style.display = 'none';
  currentKelompokId = null;
  applyFiltersAndSort();
}

function buildKelompokFormHtml() {
  const title = currentKelompokId ? 'Edit Kelompok' : 'Tambah Kelompok Baru';
  return `
    <div class="form-card">
      <h3>${title}</h3>
      <form id="kelompokForm">
        <div class="form-group">
          <label>Urutan Tampil</label>
          <input type="number" id="kelompokUrutan" value="0">
        </div>
        <div class="form-group">
          <label>Nama Kelompok *</label>
          <input id="kelompokNama" required>
        </div>
        <div class="form-group">
          <label>Jenis Kelompok</label>
          <select id="kelompokJenis">
            <option value="Ngaji">Ngaji</option>
            <option value="Belajar">Belajar</option>
            <option value="Diniyah">Diniyah</option>
            <option value="Formal">Formal</option>
          </select>
        </div>
        <div class="form-group">
          <label>Pembina / Ketua</label>
          <input id="kelompokPembina">
        </div>
        <div class="form-buttons">
          <button type="submit" class="btn-primary">Simpan</button>
          <button type="button" id="btnBatalKelompokForm" class="btn-secondary">Batal</button>
        </div>
      </form>
    </div>
  `;
}

async function saveKelompok() {
  const nama = document.getElementById('kelompokNama').value.trim();
  if (!nama) return await window.customAlert("Nama kelompok harus diisi");

  // Cek duplikat nama dalam jenis yang sama
  const jenis = document.getElementById('kelompokJenis').value;
  const duplicate = allKelompokData.some(
    (k) => k.nama.toLowerCase() === nama.toLowerCase()
      && k.jenis === jenis
      && k.id !== currentKelompokId
  );
  if (duplicate) {
    return await window.customAlert(`Kelompok "${nama}" (${jenis}) sudah ada.`);
  }

  const data = {
    nama,
    jenis,
    pembina: document.getElementById('kelompokPembina').value.trim(),
    urutan: parseInt(document.getElementById('kelompokUrutan').value) || 0
  };

  try {
    if (currentKelompokId) {
      await updateDoc(doc(db, "kelompok", currentKelompokId), data);
      await window.customAlert("Kelompok diupdate");
    } else {
      await addDoc(collection(db, "kelompok"), data);
      await window.customAlert("Kelompok ditambahkan");
    }
    hideKelompokForm();
  } catch (err) {
    await window.customAlert("Gagal simpan: " + err.message);
  }
}

// ============================================================
//  HALAMAN DETAIL KELOMPOK
// ============================================================
function showKelompokDetail(kelompokId) {
  const kelompok = allKelompokData.find((k) => k.id === kelompokId);
  if (!kelompok) {
    window.customAlert("Kelompok tidak ditemukan.");
    return;
  }

  currentDetailKelompokId = kelompokId;

  const pageContainer = document.getElementById('kelompok-page-container');
  const detailContainer = document.getElementById('kelompok-detail-container');
  const formContainer = document.getElementById('kelompok-form-container');
  const headerActions = document.getElementById('kelompok-header-actions');

  if (headerActions) headerActions.style.display = 'none';
  if (pageContainer) pageContainer.style.display = 'none';
  if (formContainer) formContainer.style.display = 'none';
  detailContainer.style.display = 'block';

  renderKelompokDetailPage(kelompok);
  renderDetailAnggota(kelompok);
  refreshDropdownSantri(kelompok);
}

function renderKelompokDetailPage(kelompok) {
  const container = document.getElementById('kelompok-detail-container');
  const count = anggotaCountsCache[kelompok.id] || 0;

  container.innerHTML = `
    <div class="detail-header">
      <button id="backFromDetail" class="btn-secondary"><i class="fas fa-arrow-left"></i> Kembali</button>
      <h2><i class="fas fa-users"></i> ${escapeHtml(kelompok.nama)}</h2>
      <div class="detail-info">
        <span><strong>Jenis:</strong> ${escapeHtml(kelompok.jenis)}</span>
        <span><strong>Pembina:</strong> ${kelompok.pembina ? escapeHtml(kelompok.pembina) : '-'}</span>
        <span><strong>Urutan:</strong> ${kelompok.urutan || 0}</span>
        <span><strong>Jumlah Anggota:</strong> <span id="detailJumlahAnggota">${count}</span></span>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-actions">
        <div class="tambah-anggota-wrapper">
          <select id="pilihSantriTambah" class="form-control">
            <option value="">-- Pilih Santri --</option>
          </select>
          <button id="btnTambahAnggota" class="btn-primary"><i class="fas fa-plus"></i> Tambah</button>
        </div>
      </div>
      <div id="detailAnggotaList" class="anggota-list-detail">
        <p>Memuat anggota...</p>
      </div>
    </div>
  `;

  document.getElementById('backFromDetail').onclick = hideKelompokDetail;
  document.getElementById('btnTambahAnggota').onclick = () => tambahAnggotaKeKelompok(kelompok);
}

function renderDetailAnggota(kelompok) {
  const container = document.getElementById('detailAnggotaList');
  if (!container) return;

  const field = getFieldForJenis(kelompok.jenis);
  const anggota = santriList.filter((s) => s.kepesantrenan?.[field] === kelompok.nama);

  // Update jumlah
  const jumlahSpan = document.getElementById('detailJumlahAnggota');
  if (jumlahSpan) jumlahSpan.textContent = anggota.length;

  if (anggota.length === 0) {
    container.innerHTML = `<p class="empty-state">Belum ada santri di kelompok ini.</p>`;
    return;
  }

  let html = `<div class="anggota-grid">`;
  anggota.forEach((s) => {
    html += `
      <div class="anggota-item">
        <div class="anggota-info">
          <i class="fas fa-user-circle"></i>
          <span><strong>${escapeHtml(s.nama)}</strong></span>
          ${s.nisn ? `<span class="nis">NISN: ${escapeHtml(s.nisn)}</span>` : ''}
        </div>
        <button class="btn-danger btn-hapus-anggota"
                data-id="${escapeHtml(s.id)}"
                data-nama="${escapeHtml(s.nama)}">
          <i class="fas fa-user-minus"></i> Hapus
        </button>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll('.btn-hapus-anggota').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const santriId = btn.dataset.id;
      const santriNama = btn.dataset.nama;
      if (await window.customConfirm(`Hapus santri "${santriNama}" dari kelompok ini?`)) {
        await hapusAnggotaDariKelompok(kelompok, santriId);
      }
    });
  });
}

function refreshDropdownSantri(kelompok) {
  const select = document.getElementById('pilihSantriTambah');
  if (!select) return;

  const field = getFieldForJenis(kelompok.jenis);

  // Santri yang belum ada di kelompok ini (field kosong atau beda)
  const tersedia = santriList.filter((s) => {
    const val = s.kepesantrenan?.[field];
    return !val || val !== kelompok.nama;
  });

  select.innerHTML = `<option value="">-- Pilih Santri --</option>`;
  if (tersedia.length === 0) {
    select.innerHTML = `<option value="">Tidak ada santri tersedia</option>`;
    return;
  }

  tersedia
    .slice()
    .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
    .forEach((s) => {
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = s.nisn ? `${s.nama} (NISN: ${s.nisn})` : s.nama;
      select.appendChild(option);
    });
}

async function tambahAnggotaKeKelompok(kelompok) {
  const select = document.getElementById('pilihSantriTambah');
  const santriId = select.value;
  if (!santriId) {
    return await window.customAlert('Pilih santri terlebih dahulu.');
  }

  const field = getFieldForJenis(kelompok.jenis);
  try {
    await updateDoc(doc(db, "santri", santriId), {
      [`kepesantrenan.${field}`]: kelompok.nama
    });
    await window.customAlert('Santri berhasil ditambahkan ke kelompok.');
  } catch (err) {
    await window.customAlert("Gagal tambah: " + err.message);
  }
}

async function hapusAnggotaDariKelompok(kelompok, santriId) {
  const field = getFieldForJenis(kelompok.jenis);
  try {
    await updateDoc(doc(db, "santri", santriId), {
      [`kepesantrenan.${field}`]: null
    });
  } catch (err) {
    await window.customAlert("Gagal hapus: " + err.message);
  }
}

function hideKelompokDetail() {
  currentDetailKelompokId = null;

  const detailContainer = document.getElementById('kelompok-detail-container');
  const pageContainer = document.getElementById('kelompok-page-container');
  const headerActions = document.getElementById('kelompok-header-actions');

  if (detailContainer) detailContainer.style.display = 'none';
  if (pageContainer) pageContainer.style.display = 'block';
  if (headerActions) headerActions.style.display = 'flex';

  applyFiltersAndSort();
}

function getFieldForJenis(jenis) {
  switch (jenis) {
    case 'Ngaji':   return 'kelompokNgaji';
    case 'Belajar': return 'kelompokBelajar';
    case 'Diniyah': return 'kelasDiniyah';
    case 'Formal':  return 'kelasFormal';
    default:        return 'kelompokNgaji';
  }
}

// ============================================================
//  EKSPOR CSV
// ============================================================
async function exportKelompokToCSV() {
  if (allKelompokData.length === 0) {
    return await window.customAlert("Tidak ada data kelompok untuk diekspor.");
  }

  const columns = ["Nama", "Jenis", "Pembina", "Urutan", "Jumlah Anggota"];
  const rows = [columns];

  allKelompokData.forEach((k) => {
    rows.push([
      k.nama || '',
      k.jenis || '',
      k.pembina || '',
      k.urutan || 0,
      anggotaCountsCache[k.id] || 0
    ].map(csvEscape));
  });

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", `kelompok_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(cell) {
  let str = String(cell);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ============================================================
//  UTILITY
// ============================================================
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
