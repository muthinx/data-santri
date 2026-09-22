// asrama.js — versi bersih
// CRUD asrama, filter & sortir, hitung anggota dari listener santri.

import { db } from '../firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getCache, setCache, getServerVersion } from '../utils/cache.js';


// ============================================================
//  STATE MODUL
// ============================================================
let unsubscribeAsrama = null;
let unsubscribeSantri = null;

let allAsramaData = [];
let santriList = [];              // pengganti window.santriListForAsrama
let anggotaCountsCache = null;    // cache hasil hitung anggota

let currentAsramaId = null;
let currentDetailAsramaNama = null; // nama asrama yang sedang dilihat di modal

let filterStateAsrama = { ketua: 'Semua' };
let sortStateAsrama = 'namaAsc';

// ============================================================
//  ENTRY POINT
// ============================================================
export function loadAsrama(container) {
  renderAsramaPage(container);
  listenAsrama();
  loadSantriForCount();
}

// Dipanggil app.js saat pindah halaman / logout
export function cleanupAsrama() {
  if (unsubscribeAsrama) {
    unsubscribeAsrama();
    unsubscribeAsrama = null;
  }
  // unsubscribeSantri tidak lagi dipakai, tapi tetap reset variabelnya
  unsubscribeSantri = null;

  allAsramaData = [];
  santriList = [];
  anggotaCountsCache = null;
  currentAsramaId = null;
  currentDetailAsramaNama = null;
  filterStateAsrama = { ketua: 'Semua' };
  sortStateAsrama = 'namaAsc';
}

// ============================================================
//  RENDER HALAMAN
// ============================================================
function renderAsramaPage(container) {
  container.innerHTML = `
    <div id="asrama-header-actions">
      <div class="header-left-buttons">
        <button id="tambahAsramaBtn" class="btn-primary"><i class="fas fa-plus"></i></button>
        <button id="btnFilterAsrama" class="btn-secondary"><i class="fas fa-sliders-h"></i></button>
      </div>
      <div class="search-wrapper">
        <i class="fas fa-search search-icon"></i>
        <input type="text" id="searchAsrama" placeholder="Cari asrama..." class="search-input">
      </div>
      <div class="header-right-buttons desktop-only">
        <button id="btnExportAsramaCSV" class="btn-secondary"><i class="fas fa-download"></i> Ekspor CSV</button>
      </div>
    </div>
    <div id="asrama-form-container" style="display:none;"></div>
    <div id="asramaList" class="asrama-grid"></div>

    <div id="detailAsramaModal" class="modal" style="display:none;">
      <div class="modal-content">
        <h3>Daftar Anggota Asrama</h3>
        <div id="detailAnggotaList"></div>
        <button id="tutupDetailModal" class="btn-secondary">Tutup</button>
      </div>
    </div>
  `;

  document.getElementById('tambahAsramaBtn').onclick = () => showAsramaForm();
  document.getElementById('btnFilterAsrama').onclick = () => openFilterModalAsrama();
  document.getElementById('btnExportAsramaCSV').onclick = () => exportAsramaToCSV();

  const searchInput = document.getElementById('searchAsrama');
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFiltersAndSortAsrama());
  }

  document.getElementById('tutupDetailModal').onclick = () => {
    document.getElementById('detailAsramaModal').style.display = 'none';
    currentDetailAsramaNama = null;
  };

  ensureFilterModal();
  updateFilterOptionsAsrama();
}

function ensureFilterModal() {
  if (document.getElementById('filterModalAsrama')) return;

  const modalHTML = `
    <div id="filterModalAsrama" class="modal" style="display:none;">
      <div class="modal-content">
        <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan Asrama</h3>
        <div class="form-group">
          <label for="sortAsramaModal">Urutkan</label>
          <select id="sortAsramaModal">
            <option value="namaAsc">Nama (A–Z)</option>
            <option value="namaDesc">Nama (Z–A)</option>
            <option value="anggotaDesc">Jumlah Anggota (terbanyak)</option>
            <option value="anggotaAsc">Jumlah Anggota (tersedikit)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="filterKetuaAsramaModal">Ketua Asrama</label>
          <select id="filterKetuaAsramaModal">
            <option value="Semua">Semua</option>
          </select>
        </div>
        <div class="form-buttons" style="margin-top:1.5rem;">
          <button id="applyFilterAsramaBtn" class="btn-primary">Terapkan</button>
          <button id="resetFilterAsramaBtn" class="btn-secondary">Reset</button>
          <button id="closeFilterAsramaBtn" class="btn-secondary">Tutup</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('applyFilterAsramaBtn').onclick = () => {
    sortStateAsrama = document.getElementById('sortAsramaModal').value;
    filterStateAsrama.ketua = document.getElementById('filterKetuaAsramaModal').value;
    applyFiltersAndSortAsrama();
    closeFilterModalAsrama();
  };
  document.getElementById('resetFilterAsramaBtn').onclick = () => {
    document.getElementById('sortAsramaModal').value = 'namaAsc';
    document.getElementById('filterKetuaAsramaModal').value = 'Semua';
    sortStateAsrama = 'namaAsc';
    filterStateAsrama.ketua = 'Semua';
    applyFiltersAndSortAsrama();
    closeFilterModalAsrama();
  };
  document.getElementById('closeFilterAsramaBtn').onclick = closeFilterModalAsrama;
  document.getElementById('filterModalAsrama').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFilterModalAsrama();
  });
}

function openFilterModalAsrama() {
  const modal = document.getElementById('filterModalAsrama');
  if (!modal) return;
  document.getElementById('sortAsramaModal').value = sortStateAsrama;
  document.getElementById('filterKetuaAsramaModal').value = filterStateAsrama.ketua;
  modal.style.display = 'flex';
}

function closeFilterModalAsrama() {
  const modal = document.getElementById('filterModalAsrama');
  if (modal) modal.style.display = 'none';
}

function updateFilterOptionsAsrama() {
  const ketuaSet = new Set();
  allAsramaData.forEach((a) => {
    if (a.ketua && a.ketua.trim()) ketuaSet.add(a.ketua.trim());
  });

  const select = document.getElementById('filterKetuaAsramaModal');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="Semua">Semua</option>';
  Array.from(ketuaSet).sort().forEach((ketua) => {
    select.innerHTML += `<option value="${escapeHtml(ketua)}">${escapeHtml(ketua)}</option>`;
  });
  // Kembalikan ke nilai sebelumnya kalau masih ada
  if (currentVal && Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

// ============================================================
//  LISTENER: ASRAMA
// ============================================================
function listenAsrama() {
  if (unsubscribeAsrama) unsubscribeAsrama();

  unsubscribeAsrama = onSnapshot(
    collection(db, "asrama"),
    (snapshot) => {
      allAsramaData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      updateFilterOptionsAsrama();
      applyFiltersAndSortAsrama();
    },
    (err) => console.error("asrama listener error:", err)
  );
}

// ============================================================
//  LISTENER: SANTRI (untuk hitung anggota)
// ============================================================
// Catatan: listener ini membaca seluruh koleksi santri. Kalau nanti
// santri bertambah banyak dan read jadi masalah, ganti ke getDocs
// + tombol refresh manual, atau pindahkan hitungan ke Cloud Function.
// Cache-first: cek versi, kalau sama pakai cache, kalau beda fetch ulang
async function loadSantriForCount() {
  try {
    const serverVersion = await getServerVersion('santri_version');
    const cached = getCache('santri');

    let list;
    if (cached && serverVersion !== null && cached.version === serverVersion) {
      // Cache hit — tidak fetch
      list = cached.data;
    } else {
      // Cache miss — fetch dari Firestore
      const snap = await getDocs(collection(db, "santri"));
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (serverVersion !== null) {
        setCache('santri', serverVersion, list);
      }
    }

    santriList = list;
    recomputeAnggotaCounts();
    applyFiltersAndSortAsrama();

    // Kalau modal detail sedang terbuka, refresh
    if (currentDetailAsramaNama) {
      renderDetailAnggota(currentDetailAsramaNama);
    }
  } catch (err) {
    console.error("Gagal load santri untuk hitung asrama:", err);
  }
}

function recomputeAnggotaCounts() {
  const counts = {};
  santriList.forEach((s) => {
    const asrama = s.kepesantrenan?.asrama;
    if (asrama) counts[asrama] = (counts[asrama] || 0) + 1;
  });
  anggotaCountsCache = counts;
}

// ============================================================
//  FILTER & SORTIR
// ============================================================
function applyFiltersAndSortAsrama() {
  const keyword = document.getElementById('searchAsrama')?.value?.toLowerCase() || '';

  let filtered = allAsramaData.filter((a) => {
    if (keyword) {
      const matchNama = a.nama && a.nama.toLowerCase().includes(keyword);
      const matchKetua = a.ketua && a.ketua.toLowerCase().includes(keyword);
      if (!matchNama && !matchKetua) return false;
    }
    if (filterStateAsrama.ketua !== 'Semua' && (a.ketua || '') !== filterStateAsrama.ketua) {
      return false;
    }
    return true;
  });

  // Pakai cache, jangan hitung ulang tiap kali filter jalan
  const counts = anggotaCountsCache || {};

  switch (sortStateAsrama) {
    case 'namaAsc':
      filtered.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      break;
    case 'namaDesc':
      filtered.sort((a, b) => (b.nama || '').localeCompare(a.nama || ''));
      break;
    case 'anggotaDesc':
      filtered.sort((a, b) => (counts[b.nama] || 0) - (counts[a.nama] || 0));
      break;
    case 'anggotaAsc':
      filtered.sort((a, b) => (counts[a.nama] || 0) - (counts[b.nama] || 0));
      break;
  }

  renderAsramaList(filtered, counts);
}

// ============================================================
//  RENDER DAFTAR ASRAMA
// ============================================================
function renderAsramaList(asramas, anggotaCounts) {
  const container = document.getElementById('asramaList');
  if (!container) return;

  if (asramas.length === 0) {
    container.innerHTML = "<p class='empty-state'>Tidak ada asrama yang sesuai dengan filter.</p>";
    container.style.display = 'grid';
    return;
  }

  let html = '';
  asramas.forEach((as) => {
    const count = (anggotaCounts && anggotaCounts[as.nama]) || 0;
    html += `
      <div class="asrama-card">
        <div class="card-header">
          <i class="fas fa-building"></i>
          <h3>${escapeHtml(as.nama)}</h3>
        </div>
        <div class="card-body">
          <div class="info-row">
            <i class="fas fa-user-tie"></i>
            <strong>Ketua:</strong> ${as.ketua ? escapeHtml(as.ketua) : '-'}
          </div>
          <div class="info-row">
            <i class="fas fa-users"></i>
            <strong>Jumlah Anggota:</strong> ${count}
          </div>
          ${as.keterangan ? `
            <div class="info-row">
              <i class="fas fa-info-circle"></i>
              <strong>Keterangan:</strong> ${escapeHtml(as.keterangan)}
            </div>` : ''}
        </div>
        <div class="card-actions">
          <button class="lihatAnggota" data-nama="${escapeHtml(as.nama)}">
            <i class="fas fa-eye"></i> Anggota
          </button>
          <button class="editAsrama" data-id="${escapeHtml(as.id)}">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="hapusAsrama" data-id="${escapeHtml(as.id)}">
            <i class="fas fa-trash"></i> Hapus
          </button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  container.style.display = 'grid';

  // Event listeners
  container.querySelectorAll('.lihatAnggota').forEach((btn) => {
    btn.addEventListener('click', () => showAnggota(btn.dataset.nama));
  });
  container.querySelectorAll('.editAsrama').forEach((btn) => {
    btn.addEventListener('click', () => {
      const asrama = allAsramaData.find((a) => a.id === btn.dataset.id);
      if (asrama) showAsramaForm(asrama);
    });
  });
  container.querySelectorAll('.hapusAsrama').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (await window.customConfirm("Hapus asrama ini? Data santri yang terkait tidak akan terhapus.")) {
        try {
          await deleteDoc(doc(db, "asrama", id));
          await window.customAlert("Asrama dihapus");
        } catch (err) {
          await window.customAlert("Gagal hapus: " + err.message);
        }
      }
    });
  });
}

// ============================================================
//  DETAIL ANGGOTA
// ============================================================
function showAnggota(asramaNama) {
  currentDetailAsramaNama = asramaNama;
  renderDetailAnggota(asramaNama);
  document.getElementById('detailAsramaModal').style.display = 'flex';
}

function renderDetailAnggota(asramaNama) {
  const container = document.getElementById('detailAnggotaList');
  if (!container) return;

  // Kalau data santri belum siap, tampilkan loading.
  // Akan otomatis di-refresh saat listener santri memanggil renderDetailAnggota lagi.
  if (!santriList || santriList.length === 0) {
    container.innerHTML = `<p>Memuat data santri...</p>`;
    return;
  }

  const anggota = santriList.filter((s) => s.kepesantrenan?.asrama === asramaNama);

  if (anggota.length === 0) {
    container.innerHTML = `<p>Tidak ada santri di asrama ini.</p>`;
    return;
  }

  const isMobile = window.innerWidth <= 768;
  let html = `<div class="santri-count">Jumlah anggota: ${anggota.length}</div>`;
  html += '<div class="table-container"><table class="santri-table">';

  if (isMobile) {
    html += `<thead><tr><th>Nama</th><th>Kelas Diniyah</th></tr></thead><tbody>`;
    anggota.forEach((s) => {
      html += `<tr>
        <td><span class="santri-name-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</span></td>
        <td>${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</td>
      </tr>`;
    });
  } else {
    html += `<thead><tr>
      <th>Nama</th>
      <th>NISN</th>
      <th>Kelas Diniyah</th>
      <th>Kelas Formal</th>
    </tr></thead><tbody>`;
    anggota.forEach((s) => {
      html += `<tr>
        <td><span class="santri-name-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</span></td>
        <td>${escapeHtml(s.nisn || '-')}</td>
        <td>${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</td>
        <td>${escapeHtml(s.kepesantrenan?.kelasFormal || '-')}</td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  container.querySelectorAll('.santri-name-link').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = link.dataset.id;
      if (typeof window.showSantriDetailPage === 'function') {
        await window.showSantriDetailPage(id);
      } else {
        await window.customAlert("Fitur detail santri belum tersedia.");
      }
    });
  });
}

// ============================================================
//  CRUD ASRAMA
// ============================================================
function showAsramaForm(editData = null) {
  const formContainer = document.getElementById('asrama-form-container');
  const listContainer = document.getElementById('asramaList');
  const headerActions = document.getElementById('asrama-header-actions');

  if (headerActions) headerActions.style.display = 'none';
  if (listContainer) listContainer.style.display = 'none';
  formContainer.style.display = 'block';

  let backBtn = document.getElementById('btnBackAsramaForm');
  if (!backBtn) {
    backBtn = document.createElement('button');
    backBtn.id = 'btnBackAsramaForm';
    backBtn.className = 'btn-secondary';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
    backBtn.style.marginBottom = '1rem';
    formContainer.parentNode.insertBefore(backBtn, formContainer);
  }
  backBtn.style.display = 'inline-flex';
  backBtn.onclick = () => hideAsramaForm();

  currentAsramaId = editData ? editData.id : null;

  formContainer.innerHTML = buildAsramaFormHtml();

  // Tombol Hapus di form (hanya saat edit)
  if (currentAsramaId) {
    const formButtons = document.querySelector('#asramaForm .form-buttons');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.className = 'btn-danger';
    deleteBtn.onclick = async () => {
      if (await window.customConfirm('Hapus asrama ini? Data santri yang terkait tidak akan terhapus.')) {
        try {
          await deleteDoc(doc(db, "asrama", currentAsramaId));
          await window.customAlert('Asrama dihapus');
          hideAsramaForm();
        } catch (err) {
          await window.customAlert("Gagal hapus: " + err.message);
        }
      }
    };
    formButtons.appendChild(deleteBtn);
  }

  // Isi form kalau edit
  if (editData) {
    document.getElementById('asramaNama').value = editData.nama || '';
    document.getElementById('ketuaAsrama').value = editData.ketua || '';
    document.getElementById('keteranganAsrama').value = editData.keterangan || '';
  }

  document.getElementById('asramaForm').onsubmit = (e) => {
    e.preventDefault();
    saveAsrama();
  };
  document.getElementById('btnBatalAsramaForm').onclick = () => hideAsramaForm();
}

function hideAsramaForm() {
  document.getElementById('asrama-form-container').style.display = 'none';
  document.getElementById('asramaList').style.display = 'grid';
  const headerActions = document.getElementById('asrama-header-actions');
  if (headerActions) headerActions.style.display = 'flex';
  const backBtn = document.getElementById('btnBackAsramaForm');
  if (backBtn) backBtn.style.display = 'none';
  currentAsramaId = null;
}

function buildAsramaFormHtml() {
  const title = currentAsramaId ? 'Edit Asrama' : 'Tambah Asrama Baru';
  return `
    <div class="form-card">
      <h3>${title}</h3>
      <form id="asramaForm">
        <div class="form-group">
          <label>Nama Asrama *</label>
          <input id="asramaNama" required>
        </div>
        <div class="form-group">
          <label>Ketua Asrama</label>
          <input id="ketuaAsrama">
        </div>
        <div class="form-group">
          <label>Keterangan</label>
          <textarea id="keteranganAsrama" rows="2"></textarea>
        </div>
        <div class="form-buttons">
          <button type="submit" class="btn-primary">Simpan</button>
          <button type="button" id="btnBatalAsramaForm" class="btn-secondary">Batal</button>
        </div>
      </form>
    </div>
  `;
}

async function saveAsrama() {
  const nama = document.getElementById('asramaNama').value.trim();
  if (!nama) return await window.customAlert("Nama asrama harus diisi");

  // Cek duplikat nama
  const duplicate = allAsramaData.some(
    (a) => a.nama.toLowerCase() === nama.toLowerCase() && a.id !== currentAsramaId
  );
  if (duplicate) {
    return await window.customAlert(`Asrama dengan nama "${nama}" sudah ada.`);
  }

  const data = {
    nama,
    ketua: document.getElementById('ketuaAsrama').value.trim(),
    keterangan: document.getElementById('keteranganAsrama').value.trim()
  };

  try {
    if (currentAsramaId) {
      await updateDoc(doc(db, "asrama", currentAsramaId), data);
      await window.customAlert("Asrama diupdate");
    } else {
      await addDoc(collection(db, "asrama"), data);
      await window.customAlert("Asrama ditambahkan");
    }
    hideAsramaForm();
  } catch (err) {
    await window.customAlert("Gagal simpan: " + err.message);
  }
}

// ============================================================
//  EKSPOR CSV
// ============================================================
async function exportAsramaToCSV() {
  if (allAsramaData.length === 0) {
    return await window.customAlert("Tidak ada data asrama untuk diekspor.");
  }

  const counts = anggotaCountsCache || {};
  const columns = ["Nama", "Ketua", "Keterangan", "Jumlah Anggota"];
  const rows = [columns];

  allAsramaData.forEach((a) => {
    rows.push([
      a.nama || '',
      a.ketua || '',
      a.keterangan || '',
      (counts[a.nama] || 0).toString()
    ].map(csvEscape));
  });

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", `asrama_export_${new Date().toISOString().slice(0, 10)}.csv`);
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
