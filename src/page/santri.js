// santri.js — versi bersih
// CRUD santri, filter & sortir, ekspor/impor CSV, halaman detail.
// Sinkron dengan koleksi saldo_santri agar konsisten dengan keuangan.js.

import { db } from '../firebase.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  getDoc, getDocs, writeBatch, query, where,
  increment, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getServerVersion, setCache,
  getMetaRef, versionIncrementPayload
} from '../utils/cache.js';

// ============================================================
//  STATE MODUL
// ============================================================
let unsubscribeSantri = null;
let allSantriData = [];
let currentEditId = null;

// Cache data asrama & kelompok untuk dropdown form (fetch sekali saat load)
let cachedAsramaList = [];
let cachedKelompokList = [];   // [{ id, nama, jenis }]

// State filter & sortir
let filterState = {
  jenisKelamin: 'Semua',
  asrama: 'Semua',
  kelasDiniyah: 'Semua'
};
let sortState = 'nama';

// ============================================================
//  ENTRY POINT
// ============================================================
export function loadSantri(container) {
  renderSantriPage(container);
  listenSantri();
  fetchDropdownData();   // fetch asrama & kelompok sekali, untuk dropdown form
}

// Dipanggil app.js saat pindah halaman / logout
export function cleanupSantri() {
  if (unsubscribeSantri) {
    unsubscribeSantri();
    unsubscribeSantri = null;
  }
  allSantriData = [];
  cachedAsramaList = [];
  cachedKelompokList = [];
  currentEditId = null;
  filterState = { jenisKelamin: 'Semua', asrama: 'Semua', kelasDiniyah: 'Semua' };
  sortState = 'nama';
}

// ============================================================
//  DETAIL PAGE (dipanggil juga oleh asrama.js & kelompokngaji.js)
// ============================================================
// Didaftarkan di module scope agar tersedia segera setelah santri.js di-import
window.showSantriDetailPage = function (santriId) {
  showSantriDetailPage(santriId);
};

// ============================================================
//  RENDER HALAMAN
// ============================================================
function renderSantriPage(container) {
  container.innerHTML = `
    <div id="santri-header-actions">
      <div class="header-left-buttons">
        <button id="btnTambahSantriBaru" class="btn-primary"><i class="fas fa-plus"></i></button>
        <button id="btnFilterSantri" class="btn-secondary"><i class="fas fa-sliders-h"></i></button>
      </div>
      <div class="search-wrapper">
        <i class="fas fa-search search-icon"></i>
        <input type="text" id="searchSantri" placeholder="Cari nama santri..." class="search-input">
      </div>
      <div class="header-right-buttons desktop-only">
        <button id="btnExportCSV" class="btn-secondary"><i class="fas fa-download"></i> Ekspor CSV</button>
        <button id="btnImportCSV" class="btn-secondary"><i class="fas fa-upload"></i> Impor CSV</button>
        <input type="file" id="fileImportCSV" accept=".csv" style="display:none" />
      </div>
    </div>
    <div id="santri-form-container" style="display:none;"></div>
    <div id="santri-table-container"></div>
  `;

  document.getElementById('btnTambahSantriBaru').onclick = () => showForm();
  document.getElementById('btnFilterSantri').onclick = () => openFilterModal();
  document.getElementById('btnExportCSV').onclick = () => exportToCSV();

  const searchInput = document.getElementById('searchSantri');
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFiltersAndSort());
  }

  const importBtn = document.getElementById('btnImportCSV');
  const fileInput = document.getElementById('fileImportCSV');
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    if (e.target.files.length > 0) importFromCSV(e.target.files[0]);
    fileInput.value = '';
  };

  ensureFilterModal();
}

function ensureFilterModal() {
  if (document.getElementById('filterModal')) return;

  const modalHTML = `
    <div id="filterModal" class="modal" style="display:none;">
      <div class="modal-content">
        <h3><i class="fas fa-sliders-h"></i> Filter & Urutkan</h3>
        <div class="form-group">
          <label for="sortSantriModal">Urutkan</label>
          <select id="sortSantriModal">
            <option value="nama">Nama (A–Z)</option>
            <option value="kelas">Kelas Diniyah</option>
            <option value="asrama">Asrama</option>
            <option value="usia">Usia (termuda)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="filterJenisKelaminModal">Jenis Kelamin</label>
          <select id="filterJenisKelaminModal">
            <option value="Semua">Semua</option>
            <option value="Laki-laki">Laki-laki</option>
            <option value="Perempuan">Perempuan</option>
          </select>
        </div>
        <div class="form-group">
          <label for="filterAsramaModal">Asrama</label>
          <select id="filterAsramaModal"><option value="Semua">Semua</option></select>
        </div>
        <div class="form-group">
          <label for="filterKelasDiniyahModal">Kelas Diniyah</label>
          <select id="filterKelasDiniyahModal"><option value="Semua">Semua</option></select>
        </div>
        <div class="form-buttons" style="margin-top:1.5rem;">
          <button id="applyFilterBtn" class="btn-primary">Terapkan</button>
          <button id="resetFilterBtn" class="btn-secondary">Reset</button>
          <button id="closeFilterBtn" class="btn-secondary">Tutup</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('applyFilterBtn').onclick = () => {
    sortState = document.getElementById('sortSantriModal').value;
    filterState.jenisKelamin = document.getElementById('filterJenisKelaminModal').value;
    filterState.asrama = document.getElementById('filterAsramaModal').value;
    filterState.kelasDiniyah = document.getElementById('filterKelasDiniyahModal').value;
    applyFiltersAndSort();
    closeFilterModal();
  };
  document.getElementById('resetFilterBtn').onclick = () => {
    document.getElementById('sortSantriModal').value = 'nama';
    document.getElementById('filterJenisKelaminModal').value = 'Semua';
    document.getElementById('filterAsramaModal').value = 'Semua';
    document.getElementById('filterKelasDiniyahModal').value = 'Semua';
    sortState = 'nama';
    filterState = { jenisKelamin: 'Semua', asrama: 'Semua', kelasDiniyah: 'Semua' };
    applyFiltersAndSort();
    closeFilterModal();
  };
  document.getElementById('closeFilterBtn').onclick = closeFilterModal;
  document.getElementById('filterModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFilterModal();
  });
}

function openFilterModal() {
  const modal = document.getElementById('filterModal');
  if (!modal) return;
  document.getElementById('sortSantriModal').value = sortState;
  document.getElementById('filterJenisKelaminModal').value = filterState.jenisKelamin;
  document.getElementById('filterAsramaModal').value = filterState.asrama;
  document.getElementById('filterKelasDiniyahModal').value = filterState.kelasDiniyah;
  modal.style.display = 'flex';
}

function closeFilterModal() {
  const modal = document.getElementById('filterModal');
  if (modal) modal.style.display = 'none';
}

// ============================================================
//  LISTENER & FETCH DATA
// ============================================================
function listenSantri() {
  if (unsubscribeSantri) unsubscribeSantri();

  unsubscribeSantri = onSnapshot(
    collection(db, "santri"),
    async (snapshot) => {
      allSantriData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      updateFilterOptions();
      applyFiltersAndSort();

      // Simpan ke cache dengan versi server saat ini
      try {
        const v = await getServerVersion('santri_version');
        if (v !== null) {
          setCache('santri', v, allSantriData);
        }
      } catch (e) {
        console.warn('Gagal update cache santri:', e);
      }
    },
    (err) => console.error("santri listener error:", err)
  );
}

// Fetch asrama & kelompok sekali saat halaman dibuka. Data ini jarang berubah,
// jadi tidak perlu listener realtime. Dipakai untuk isi dropdown form.
async function fetchDropdownData() {
  try {
    const [asramaSnap, kelompokSnap] = await Promise.all([
      getDocs(collection(db, "asrama")),
      getDocs(collection(db, "kelompok"))
    ]);
    cachedAsramaList = asramaSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cachedKelompokList = kelompokSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Gagal fetch dropdown data:", err);
  }
}

// Update opsi filter dinamis (asrama & kelas diniyah) dari data santri
function updateFilterOptions() {
  const asramaSet = new Set();
  const kelasSet = new Set();
  allSantriData.forEach((s) => {
    if (s.kepesantrenan?.asrama) asramaSet.add(s.kepesantrenan.asrama);
    if (s.kepesantrenan?.kelasDiniyah) kelasSet.add(s.kepesantrenan.kelasDiniyah);
  });

  const asramaSelect = document.getElementById('filterAsramaModal');
  const kelasSelect = document.getElementById('filterKelasDiniyahModal');

  if (asramaSelect) {
    const currentVal = asramaSelect.value;
    asramaSelect.innerHTML = '<option value="Semua">Semua</option>';
    Array.from(asramaSet).sort().forEach((val) => {
      asramaSelect.innerHTML += `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`;
    });
    asramaSelect.value = currentVal || 'Semua';
  }
  if (kelasSelect) {
    const currentVal = kelasSelect.value;
    kelasSelect.innerHTML = '<option value="Semua">Semua</option>';
    Array.from(kelasSet).sort().forEach((val) => {
      kelasSelect.innerHTML += `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`;
    });
    kelasSelect.value = currentVal || 'Semua';
  }
}

// ============================================================
//  FILTER & SORTIR
// ============================================================
function applyFiltersAndSort() {
  const keyword = document.getElementById('searchSantri')?.value?.toLowerCase() || '';

  let filtered = allSantriData.filter((s) => {
    if (keyword && !(s.nama && s.nama.toLowerCase().includes(keyword))) return false;
    if (filterState.jenisKelamin !== 'Semua' && s.jenisKelamin !== filterState.jenisKelamin) return false;
    if (filterState.asrama !== 'Semua' && (s.kepesantrenan?.asrama || '') !== filterState.asrama) return false;
    if (filterState.kelasDiniyah !== 'Semua' && (s.kepesantrenan?.kelasDiniyah || '') !== filterState.kelasDiniyah) return false;
    return true;
  });

  switch (sortState) {
    case 'nama':
      filtered.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
      break;
    case 'kelas':
      filtered.sort((a, b) =>
        (a.kepesantrenan?.kelasDiniyah || '').localeCompare(b.kepesantrenan?.kelasDiniyah || ''));
      break;
    case 'asrama':
      filtered.sort((a, b) =>
        (a.kepesantrenan?.asrama || '').localeCompare(b.kepesantrenan?.asrama || ''));
      break;
    case 'usia': {
      const getAge = (s) => {
        if (!s.tanggalLahir) return Infinity;
        const birth = new Date(s.tanggalLahir);
        if (isNaN(birth)) return Infinity;
        return (Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      };
      filtered.sort((a, b) => getAge(a) - getAge(b));
      break;
    }
  }

  renderSantriTable(filtered);
}

// ============================================================
//  RENDER TABEL
// ============================================================
function renderSantriTable(data) {
  const container = document.getElementById('santri-table-container');
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<p>Belum ada data santri.</p>`;
    container.style.display = 'block';
    return;
  }

  const total = allSantriData.length;
  const isMobile = window.innerWidth <= 768;
  let html = `<div class="santri-count">Menampilkan ${data.length} dari ${total} santri</div>`;
  html += '<div class="table-container"><table class="santri-table">';

  if (isMobile) {
    html += `<thead><tr><th>Nama</th><th>Kelas</th><th>Aksi</th></tr></thead><tbody>`;
    data.forEach((s) => {
      html += `<tr>
        <td><span class="santri-name-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</span></td>
        <td>${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</td>
        <td class="action-cell">
          <button class="edit-santri-btn" data-id="${escapeHtml(s.id)}">Edit</button>
        </td>
      </tr>`;
    });
  } else {
    html += `<thead><tr>
      <th>Nama</th>
      <th>NISN</th>
      <th>Kelas Diniyah</th>
      <th>Kelas Formal</th>
      <th>Asrama</th>
      <th>Aksi</th>
    </tr></thead><tbody>`;
    data.forEach((s) => {
      html += `<tr>
        <td><span class="santri-name-link" data-id="${escapeHtml(s.id)}">${escapeHtml(s.nama)}</span></td>
        <td>${escapeHtml(s.nisn || '-')}</td>
        <td>${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</td>
        <td>${escapeHtml(s.kepesantrenan?.kelasFormal || '-')}</td>
        <td>${escapeHtml(s.kepesantrenan?.asrama || '-')}</td>
        <td class="action-cell">
          <button class="edit-santri-btn" data-id="${escapeHtml(s.id)}">Edit</button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;
  container.innerHTML = html;
  container.style.display = 'block';

  container.querySelectorAll('.santri-name-link').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showSantriDetailPage(link.dataset.id);
    });
  });

  container.querySelectorAll('.edit-santri-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const santri = allSantriData.find((s) => s.id === btn.dataset.id);
      if (santri) showForm(santri);
    });
  });
}

// ============================================================
//  FORM
// ============================================================
function showForm(editData = null) {
  const formContainer = document.getElementById('santri-form-container');
  const tableContainer = document.getElementById('santri-table-container');
  const headerActions = document.getElementById('santri-header-actions');

  if (headerActions) headerActions.style.display = 'none';

  let backBtn = document.getElementById('btnBackFromForm');
  if (!backBtn) {
    backBtn = document.createElement('button');
    backBtn.id = 'btnBackFromForm';
    backBtn.className = 'btn-secondary';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
    backBtn.style.marginBottom = '1rem';
    formContainer.parentNode.insertBefore(backBtn, formContainer);
  }
  backBtn.style.display = 'inline-flex';
  backBtn.onclick = () => hideForm();

  currentEditId = editData ? editData.id : null;

  formContainer.style.display = 'block';
  tableContainer.style.display = 'none';
  formContainer.innerHTML = buildFormHtml();

  // Isi dropdown dari cache (tanpa read)
  populateDropdowns(editData);

  // Isi field kalau edit
  if (editData) fillFormData(editData);

  // Tombol Hapus di form (saat edit)
  if (currentEditId) {
    const formButtons = document.querySelector('#santriForm .form-buttons');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.className = 'btn-danger';
    deleteBtn.onclick = async () => {
      if (await window.customConfirm('Yakin hapus data santri ini?')) {
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, "santri", currentEditId));
          batch.delete(doc(db, "saldo_santri", currentEditId));
          batch.set(getMetaRef('santri_version'), versionIncrementPayload(), { merge: true });
          // BARU: hapus entry dari meta/saldo_semua
          batch.update(getMetaRef('saldo_semua'), {
            [`data.${currentEditId}`]: deleteField(),
            version: increment(1),
            updatedAt: serverTimestamp()
          });
          await batch.commit();
          await window.customAlert('Data berhasil dihapus');
          hideForm();
        } catch (err) {
          await window.customAlert('Gagal hapus: ' + err.message);
        }
      }
    };
    formButtons.appendChild(deleteBtn);
  }

  document.getElementById('santriForm').onsubmit = (e) => {
    e.preventDefault();
    saveSantri();
  };
  document.getElementById('btnBatalForm').onclick = () => hideForm();
}

function hideForm() {
  document.getElementById('santri-form-container').style.display = 'none';
  document.getElementById('santri-table-container').style.display = 'block';
  const headerActions = document.getElementById('santri-header-actions');
  if (headerActions) headerActions.style.display = 'flex';
  const backBtn = document.getElementById('btnBackFromForm');
  if (backBtn) backBtn.style.display = 'none';
  currentEditId = null;
}

function populateDropdowns(editData) {
  const selectedAsrama = editData?.kepesantrenan?.asrama || '';
  const selectedNgaji = editData?.kepesantrenan?.kelompokNgaji || '';
  const selectedBelajar = editData?.kepesantrenan?.kelompokBelajar || '';
  const selectedKelasDiniyah = editData?.kepesantrenan?.kelasDiniyah || '';
  const selectedKelasFormal = editData?.kepesantrenan?.kelasFormal || '';

  // Asrama
  const asramaSelect = document.getElementById('asrama');
  if (asramaSelect) {
    asramaSelect.innerHTML = buildAsramaOptionsHtml(selectedAsrama);
  }

  // Kelompok per jenis
  const kelompokFields = [
    { id: 'kelompokNgaji', jenis: 'Ngaji', selected: selectedNgaji },
    { id: 'kelompokBelajar', jenis: 'Belajar', selected: selectedBelajar },
    { id: 'kelasDiniyah', jenis: 'Diniyah', selected: selectedKelasDiniyah },
    { id: 'kelasFormal', jenis: 'Formal', selected: selectedKelasFormal }
  ];
  kelompokFields.forEach(({ id, jenis, selected }) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = buildKelompokOptionsHtml(jenis, selected);
  });
}

function buildAsramaOptionsHtml(selected = '') {
  let html = '<option value="">-- Pilih Asrama --</option>';
  cachedAsramaList
    .slice()
    .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
    .forEach((a) => {
      html += `<option value="${escapeHtml(a.nama)}" ${selected === a.nama ? 'selected' : ''}>${escapeHtml(a.nama)}</option>`;
    });
  return html;
}

function buildKelompokOptionsHtml(jenis, selected = '') {
  let html = `<option value="">-- Pilih ${jenis} --</option>`;
  cachedKelompokList
    .filter((k) => k.jenis === jenis)
    .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
    .forEach((k) => {
      html += `<option value="${escapeHtml(k.nama)}" ${selected === k.nama ? 'selected' : ''}>${escapeHtml(k.nama)}</option>`;
    });
  return html;
}

function buildFormHtml() {
  const title = currentEditId ? 'Edit Santri' : 'Tambah Santri Baru';
  return `
    <div class="form-card">
      <h3>${title}</h3>
      <form id="santriForm">
        <div class="form-row">
          <div class="form-group"><label>Nama Santri *</label><input id="nama" required></div>
          <div class="form-group"><label>NISN</label><input id="nisn"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>NIK</label><input id="nik"></div>
          <div class="form-group"><label>Tempat Lahir</label><input id="tmpLahir"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tgl Lahir</label><input type="date" id="tglLahir"></div>
          <div class="form-group"><label>Jenis Kelamin</label>
            <select id="jk"><option>Laki-laki</option><option>Perempuan</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Jumlah Saudara</label><input type="number" id="jmlSaudara"></div>
          <div class="form-group"><label>Anak Ke-</label><input type="number" id="anakKe"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Cita-cita</label><input id="citacita"></div>
          <div class="form-group"><label>Hobi</label><input id="hobi"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Pendidikan Formal</label><input id="pendFormal"></div>
          <div class="form-group"><label>Wali Santri</label>
            <select id="waliSantri"><option>Orang Tua Kandung</option><option>Asuh</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Nomor KK</label><input id="noKK"></div>
          <div class="form-group"><label>Nama Kepala Keluarga</label><input id="namaKK"></div>
        </div>

        <h4>Data Ayah Kandung</h4>
        <div class="form-row">
          <div class="form-group"><label>Nama Ayah</label><input id="ayahNama"></div>
          <div class="form-group"><label>Status</label>
            <select id="ayahStatus"><option>Masih Hidup</option><option>Meninggal</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>NIK Ayah</label><input id="ayahNik"></div>
          <div class="form-group"><label>Tempat Lahir Ayah</label><input id="ayahTmpLahir"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tgl Lahir Ayah</label><input type="date" id="ayahTglLahir"></div>
          <div class="form-group"><label>Pekerjaan</label><input id="ayahPekerjaan"></div>
        </div>
        <div class="form-group"><label>No WA Ayah</label><input id="ayahWa"></div>

        <h4>Data Ibu Kandung</h4>
        <div class="form-row">
          <div class="form-group"><label>Nama Ibu</label><input id="ibuNama"></div>
          <div class="form-group"><label>Status</label>
            <select id="ibuStatus"><option>Masih Hidup</option><option>Meninggal</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>NIK Ibu</label><input id="ibuNik"></div>
          <div class="form-group"><label>Tempat Lahir Ibu</label><input id="ibuTmpLahir"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tgl Lahir Ibu</label><input type="date" id="ibuTglLahir"></div>
          <div class="form-group"><label>Pekerjaan Ibu</label><input id="ibuPekerjaan"></div>
        </div>
        <div class="form-group"><label>No WA Ibu</label><input id="ibuWa"></div>

        <h4>Alamat</h4>
        <div class="form-row">
          <div class="form-group"><label>Provinsi</label><input id="provinsi"></div>
          <div class="form-group"><label>Kabupaten</label><input id="kabupaten"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Kecamatan</label><input id="kecamatan"></div>
          <div class="form-group"><label>Desa</label><input id="desa"></div>
        </div>
        <div class="form-group"><label>Jalan / RT RW / Ancer-ancer</label><textarea id="jalan" rows="2"></textarea></div>

        <h4>Data Kepesantrenan</h4>
        <div class="form-row">
          <div class="form-group"><label>NIS Pondok / NISPDF</label><input id="nisPondok"></div>
          <div class="form-group"><label>Kelompok Ngaji</label><select id="kelompokNgaji"></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Asrama</label><select id="asrama"></select></div>
          <div class="form-group"><label>Kelas Diniyah</label><select id="kelasDiniyah"></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Kelas Formal</label><select id="kelasFormal"></select></div>
          <div class="form-group"><label>Kelompok Belajar</label><select id="kelompokBelajar"></select></div>
        </div>
        <div class="form-buttons">
          <button type="submit" class="btn-primary">Simpan</button>
          <button type="button" id="btnBatalForm" class="btn-secondary">Batal</button>
        </div>
      </form>
    </div>
  `;
}

function fillFormData(data) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setVal('nama', data.nama);
  setVal('nisn', data.nisn);
  setVal('nik', data.nik);
  setVal('tmpLahir', data.tempatLahir);
  setVal('tglLahir', data.tanggalLahir);
  setVal('jk', data.jenisKelamin || 'Laki-laki');
  setVal('jmlSaudara', data.jumlahSaudara || 0);
  setVal('anakKe', data.anakKe || 0);
  setVal('citacita', data.citacita);
  setVal('hobi', data.hobi);
  setVal('pendFormal', data.pendidikanFormal);
  setVal('waliSantri', data.waliSantri || 'Orang Tua Kandung');
  setVal('noKK', data.nomorKK);
  setVal('namaKK', data.namaKepalaKeluarga);

  if (data.ayah) {
    setVal('ayahNama', data.ayah.nama);
    setVal('ayahStatus', data.ayah.status || 'Masih Hidup');
    setVal('ayahNik', data.ayah.nik);
    setVal('ayahTmpLahir', data.ayah.tempatLahir);
    setVal('ayahTglLahir', data.ayah.tanggalLahir);
    setVal('ayahPekerjaan', data.ayah.pekerjaan);
    setVal('ayahWa', data.ayah.wa);
  }
  if (data.ibu) {
    setVal('ibuNama', data.ibu.nama);
    setVal('ibuStatus', data.ibu.status || 'Masih Hidup');
    setVal('ibuNik', data.ibu.nik);
    setVal('ibuTmpLahir', data.ibu.tempatLahir);
    setVal('ibuTglLahir', data.ibu.tanggalLahir);
    setVal('ibuPekerjaan', data.ibu.pekerjaan);
    setVal('ibuWa', data.ibu.wa);
  }
  if (data.alamat) {
    setVal('provinsi', data.alamat.provinsi);
    setVal('kabupaten', data.alamat.kabupaten);
    setVal('kecamatan', data.alamat.kecamatan);
    setVal('desa', data.alamat.desa);
    setVal('jalan', data.alamat.jalan);
  }
  if (data.kepesantrenan) {
    setVal('nisPondok', data.kepesantrenan.nisPondok);
    setVal('asrama', data.kepesantrenan.asrama);
    setVal('kelasDiniyah', data.kepesantrenan.kelasDiniyah);
    setVal('kelasFormal', data.kepesantrenan.kelasFormal);
    setVal('kelompokBelajar', data.kepesantrenan.kelompokBelajar);
    setVal('kelompokNgaji', data.kepesantrenan.kelompokNgaji);
  }
}

// ============================================================
//  SIMPAN (termasuk sync ke saldo_santri)
// ============================================================
async function saveSantri() {
  const data = {
    nama: document.getElementById('nama').value.trim(),
    nisn: document.getElementById('nisn').value.trim(),
    nik: document.getElementById('nik').value.trim(),
    tempatLahir: document.getElementById('tmpLahir').value.trim(),
    tanggalLahir: document.getElementById('tglLahir').value,
    jenisKelamin: document.getElementById('jk').value,
    jumlahSaudara: parseInt(document.getElementById('jmlSaudara').value) || 0,
    anakKe: parseInt(document.getElementById('anakKe').value) || 0,
    citacita: document.getElementById('citacita').value.trim(),
    hobi: document.getElementById('hobi').value.trim(),
    pendidikanFormal: document.getElementById('pendFormal').value.trim(),
    waliSantri: document.getElementById('waliSantri').value,
    nomorKK: document.getElementById('noKK').value.trim(),
    namaKepalaKeluarga: document.getElementById('namaKK').value.trim(),
    ayah: {
      nama: document.getElementById('ayahNama').value.trim(),
      status: document.getElementById('ayahStatus').value,
      nik: document.getElementById('ayahNik').value.trim(),
      tempatLahir: document.getElementById('ayahTmpLahir').value.trim(),
      tanggalLahir: document.getElementById('ayahTglLahir').value,
      pekerjaan: document.getElementById('ayahPekerjaan').value.trim(),
      wa: document.getElementById('ayahWa').value.trim()
    },
    ibu: {
      nama: document.getElementById('ibuNama').value.trim(),
      status: document.getElementById('ibuStatus').value,
      nik: document.getElementById('ibuNik').value.trim(),
      tempatLahir: document.getElementById('ibuTmpLahir').value.trim(),
      tanggalLahir: document.getElementById('ibuTglLahir').value,
      pekerjaan: document.getElementById('ibuPekerjaan').value.trim(),
      wa: document.getElementById('ibuWa').value.trim()
    },
    alamat: {
      provinsi: document.getElementById('provinsi').value.trim(),
      kabupaten: document.getElementById('kabupaten').value.trim(),
      kecamatan: document.getElementById('kecamatan').value.trim(),
      desa: document.getElementById('desa').value.trim(),
      jalan: document.getElementById('jalan').value.trim()
    },
    kepesantrenan: {
      nisPondok: document.getElementById('nisPondok').value.trim(),
      asrama: document.getElementById('asrama').value,
      kelasDiniyah: document.getElementById('kelasDiniyah').value,
      kelasFormal: document.getElementById('kelasFormal').value,
      kelompokBelajar: document.getElementById('kelompokBelajar').value,
      kelompokNgaji: document.getElementById('kelompokNgaji').value
    }
  };

  if (!data.nama) return await window.customAlert("Nama santri wajib diisi");

  // Data minimal untuk saldo_santri (dipakai di halaman keuangan)
  const saldoPayload = {
    nama: data.nama,
    nisn: data.nisn,
    kelasDiniyah: data.kepesantrenan.kelasDiniyah,
    kelasFormal: data.kepesantrenan.kelasFormal,
    asrama: data.kepesantrenan.asrama,
    updatedAt: serverTimestamp()
  };

  try {
    if (currentEditId) {
      const batch = writeBatch(db);
      batch.update(doc(db, "santri", currentEditId), data);
      batch.set(doc(db, "saldo_santri", currentEditId), saldoPayload, { merge: true });
      batch.set(getMetaRef('santri_version'), versionIncrementPayload(), { merge: true });
      await batch.commit();
      await window.customAlert("Data santri berhasil diupdate");
    } else {
      const newSantriRef = doc(collection(db, "santri"));
      const newSantriId = newSantriRef.id;

      const batch = writeBatch(db);
      batch.set(newSantriRef, data);
      batch.set(doc(db, "saldo_santri", newSantriId), {
        santriId: newSantriId,
        ...saldoPayload,
        saldo: 0,
        transaksiCount: 0
      });
      batch.set(getMetaRef('santri_version'), versionIncrementPayload(), { merge: true });
      // BARU: daftarkan di meta/saldo_semua
      batch.set(getMetaRef('saldo_semua'), {
        [`data.${newSantriId}`]: { saldo: 0, count: 0 },
        version: increment(1),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      await window.customAlert("Santri berhasil ditambahkan");
    }
    hideForm();
  } catch (err) {
    await window.customAlert("Error: " + err.message);
  }
  
}

// ============================================================
//  EKSPOR CSV
// ============================================================
async function exportToCSV() {
  if (allSantriData.length === 0) {
    return await window.customAlert("Tidak ada data santri untuk diekspor.");
  }

  const columns = [
    "nama", "nisn", "nik", "tempatLahir", "tanggalLahir", "jenisKelamin",
    "jumlahSaudara", "anakKe", "citacita", "hobi", "pendidikanFormal", "waliSantri",
    "nomorKK", "namaKepalaKeluarga",
    "ayah.nama", "ayah.status", "ayah.nik", "ayah.tempatLahir", "ayah.tanggalLahir", "ayah.pekerjaan", "ayah.wa",
    "ibu.nama", "ibu.status", "ibu.nik", "ibu.tempatLahir", "ibu.tanggalLahir", "ibu.pekerjaan", "ibu.wa",
    "alamat.provinsi", "alamat.kabupaten", "alamat.kecamatan", "alamat.desa", "alamat.jalan",
    "kepesantrenan.nisPondok", "kepesantrenan.asrama", "kepesantrenan.kelasDiniyah",
    "kepesantrenan.kelasFormal", "kepesantrenan.kelompokBelajar", "kepesantrenan.kelompokNgaji"
  ];

  const rows = [columns];
  for (const s of allSantriData) {
    const row = columns.map((col) => {
      const parts = col.split('.');
      let value = s;
      for (const part of parts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      if (value === undefined || value === null) return '';
      return csvEscape(String(value));
    });
    rows.push(row);
  }

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute("download", `santri_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================
//  IMPOR CSV
// ============================================================
async function importFromCSV(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) {
        return await window.customAlert("File CSV tidak memiliki data (minimal header + 1 baris data).");
      }

      const headers = rows[0];
      const dataRows = rows.slice(1).filter((row) =>
        row.length === headers.length && row.some((cell) => cell.trim() !== "")
      );
      if (dataRows.length === 0) {
        return await window.customAlert("Tidak ada data valid untuk diimpor.");
      }

      const ok = await window.customConfirm(`Akan mengimpor ${dataRows.length} data santri. Lanjutkan?`);
      if (!ok) return;

      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      const batchSize = 400;   // sisakan slot untuk saldo_santri di batch yang sama

      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = dataRows.slice(i, i + batchSize);

        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const santriData = {};

          for (let k = 0; k < headers.length; k++) {
            const header = headers[k];
            const value = row[k] ? row[k].trim() : '';
            if (value === "") continue;
            const parts = header.split('.');
            let obj = santriData;
            for (let p = 0; p < parts.length - 1; p++) {
              if (!obj[parts[p]]) obj[parts[p]] = {};
              obj = obj[parts[p]];
            }
            obj[parts[parts.length - 1]] = value;
          }

          if (!santriData.nama) {
            errorCount++;
            errors.push(`Baris ${i + j + 2}: Nama santri wajib diisi`);
            continue;
          }
          if (santriData.jenisKelamin && !["Laki-laki", "Perempuan"].includes(santriData.jenisKelamin)) {
            errorCount++;
            errors.push(`Baris ${i + j + 2}: Jenis kelamin tidak valid`);
            continue;
          }
          if (santriData.waliSantri && !["Orang Tua Kandung", "Asuh"].includes(santriData.waliSantri)) {
            errorCount++;
            errors.push(`Baris ${i + j + 2}: Wali Santri tidak valid`);
            continue;
          }
          if (santriData.jumlahSaudara) santriData.jumlahSaudara = parseInt(santriData.jumlahSaudara) || 0;
          if (santriData.anakKe) santriData.anakKe = parseInt(santriData.anakKe) || 0;

          const santriRef = doc(collection(db, "santri"));
          const santriId = santriRef.id;
          batch.set(santriRef, santriData);

          // Sinkron ke saldo_santri
          batch.set(doc(db, "saldo_santri", santriId), {
            santriId,
            nama: santriData.nama,
            nisn: santriData.nisn || '',
            kelasDiniyah: santriData.kepesantrenan?.kelasDiniyah || '',
            kelasFormal: santriData.kepesantrenan?.kelasFormal || '',
            asrama: santriData.kepesantrenan?.asrama || '',
            saldo: 0,
            transaksiCount: 0,
            updatedAt: serverTimestamp()
          });

          successCount++;
        }

        if (chunk.length > 0) await batch.commit();
      }

      if (successCount > 0) {
        try {
          const batch = writeBatch(db);
          batch.set(getMetaRef('santri_version'), versionIncrementPayload(), { merge: true });
          await batch.commit();
        } catch (e) {
          console.warn('Gagal increment versi santri setelah impor:', e);
        }
      }

      await window.customAlert(
        `Impor selesai. Sukses: ${successCount}, Gagal: ${errorCount}` +
        (errors.length ? `\nDetail:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... dan ${errors.length - 5} lainnya` : ''}` : '')
      );

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
  let inQuote = false;
  let currentRow = [];
  let currentField = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
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
  return rows.map((row) => row.map((field) => field.trim()));
}

// ============================================================
//  HALAMAN DETAIL SANTRI
// ============================================================
async function showSantriDetailPage(santriId) {
  const container = document.getElementById('main-content');

  // Coba ambil dari cache dulu
  let s = allSantriData.find((x) => x.id === santriId);

  // Kalau tidak ada (mungkin dipanggil dari halaman lain sebelum listener siap), ambil 1 dokumen
  if (!s) {
    try {
      const docSnap = await getDoc(doc(db, "santri", santriId));
      if (!docSnap.exists()) {
        return await window.customAlert("Data santri tidak ditemukan");
      }
      s = { id: docSnap.id, ...docSnap.data() };
    } catch (err) {
      return await window.customAlert("Gagal memuat data: " + err.message);
    }
  }

  const detailHtml = `
    <div id="santri-detail-container">
      <button id="backToSantriList" class="btn-secondary" style="margin-bottom:1.5rem">
        <i class="fas fa-arrow-left"></i> Kembali ke Daftar Santri
      </button>
      <div class="santri-detail-card">
        <div class="santri-detail-header">
          <div class="santri-avatar"><i class="fas fa-user-graduate"></i></div>
          <div class="santri-info">
            <h2>${escapeHtml(s.nama)}</h2>
            <div class="santri-badges">
              <span><i class="fas fa-id-card"></i> NISN: ${escapeHtml(s.nisn || '-')}</span>
              <span><i class="fas fa-building"></i> Asrama: ${escapeHtml(s.kepesantrenan?.asrama || '-')}</span>
              <span><i class="fas fa-book"></i> Kelas: ${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</span>
            </div>
          </div>
        </div>
        <div class="santri-detail-body">
          <div class="detail-section">
            <h3><i class="fas fa-user"></i> Data Pribadi</h3>
            <div class="detail-grid">
              <div><strong>NIK:</strong> ${escapeHtml(s.nik || '-')}</div>
              <div><strong>Tempat Lahir:</strong> ${escapeHtml(s.tempatLahir || '-')}</div>
              <div><strong>Tanggal Lahir:</strong> ${escapeHtml(s.tanggalLahir || '-')}</div>
              <div><strong>Jenis Kelamin:</strong> ${escapeHtml(s.jenisKelamin || '-')}</div>
              <div><strong>Jumlah Saudara:</strong> ${s.jumlahSaudara || 0}</div>
              <div><strong>Anak Ke-:</strong> ${s.anakKe || 0}</div>
              <div><strong>Cita-cita:</strong> ${escapeHtml(s.citacita || '-')}</div>
              <div><strong>Hobi:</strong> ${escapeHtml(s.hobi || '-')}</div>
              <div><strong>Pendidikan Formal:</strong> ${escapeHtml(s.pendidikanFormal || '-')}</div>
              <div><strong>Wali Santri:</strong> ${escapeHtml(s.waliSantri || '-')}</div>
              <div><strong>Nomor KK:</strong> ${escapeHtml(s.nomorKK || '-')}</div>
              <div><strong>Kepala Keluarga:</strong> ${escapeHtml(s.namaKepalaKeluarga || '-')}</div>
            </div>
          </div>
          <div class="detail-section">
            <h3><i class="fas fa-male"></i> Ayah Kandung</h3>
            <div class="detail-grid">
              <div><strong>Nama:</strong> ${escapeHtml(s.ayah?.nama || '-')}</div>
              <div><strong>Status:</strong> ${escapeHtml(s.ayah?.status || '-')}</div>
              <div><strong>NIK:</strong> ${escapeHtml(s.ayah?.nik || '-')}</div>
              <div><strong>Tempat Lahir:</strong> ${escapeHtml(s.ayah?.tempatLahir || '-')}</div>
              <div><strong>Tanggal Lahir:</strong> ${escapeHtml(s.ayah?.tanggalLahir || '-')}</div>
              <div><strong>Pekerjaan:</strong> ${escapeHtml(s.ayah?.pekerjaan || '-')}</div>
              <div><strong>No WA:</strong> ${escapeHtml(s.ayah?.wa || '-')}</div>
            </div>
          </div>
          <div class="detail-section">
            <h3><i class="fas fa-female"></i> Ibu Kandung</h3>
            <div class="detail-grid">
              <div><strong>Nama:</strong> ${escapeHtml(s.ibu?.nama || '-')}</div>
              <div><strong>Status:</strong> ${escapeHtml(s.ibu?.status || '-')}</div>
              <div><strong>NIK:</strong> ${escapeHtml(s.ibu?.nik || '-')}</div>
              <div><strong>Tempat Lahir:</strong> ${escapeHtml(s.ibu?.tempatLahir || '-')}</div>
              <div><strong>Tanggal Lahir:</strong> ${escapeHtml(s.ibu?.tanggalLahir || '-')}</div>
              <div><strong>Pekerjaan:</strong> ${escapeHtml(s.ibu?.pekerjaan || '-')}</div>
              <div><strong>No WA:</strong> ${escapeHtml(s.ibu?.wa || '-')}</div>
            </div>
          </div>
          <div class="detail-section">
            <h3><i class="fas fa-map-marker-alt"></i> Alamat</h3>
            <div class="detail-grid">
              <div><strong>Provinsi:</strong> ${escapeHtml(s.alamat?.provinsi || '-')}</div>
              <div><strong>Kabupaten:</strong> ${escapeHtml(s.alamat?.kabupaten || '-')}</div>
              <div><strong>Kecamatan:</strong> ${escapeHtml(s.alamat?.kecamatan || '-')}</div>
              <div><strong>Desa:</strong> ${escapeHtml(s.alamat?.desa || '-')}</div>
              <div><strong>Jalan:</strong> ${escapeHtml(s.alamat?.jalan || '-')}</div>
            </div>
          </div>
          <div class="detail-section">
            <h3><i class="fas fa-mosque"></i> Data Kepesantrenan</h3>
            <div class="detail-grid">
              <div><strong>Asrama:</strong> ${escapeHtml(s.kepesantrenan?.asrama || '-')}</div>
              <div><strong>Kelas Diniyah:</strong> ${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</div>
              <div><strong>Kelas Formal:</strong> ${escapeHtml(s.kepesantrenan?.kelasFormal || '-')}</div>
              <div><strong>Kelompok Belajar:</strong> ${escapeHtml(s.kepesantrenan?.kelompokBelajar || '-')}</div>
              <div><strong>Kelompok Ngaji:</strong> ${escapeHtml(s.kepesantrenan?.kelompokNgaji || '-')}</div>
              <div><strong>NIS Pondok:</strong> ${escapeHtml(s.kepesantrenan?.nisPondok || '-')}</div>
            </div>
          </div>
        </div>
        <div class="santri-detail-footer">
          <button id="editSantriFromDetail" class="btn-primary">
            <i class="fas fa-edit"></i> Edit Santri
          </button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = detailHtml;

  document.getElementById('backToSantriList').onclick = () => {
    loadSantri(container);
  };
  document.getElementById('editSantriFromDetail').onclick = () => {
    // Tetap di halaman santri, langsung buka form edit
    loadSantri(container);
    setTimeout(() => showForm(s), 50);
  };
}

// ============================================================
//  UTILITY
// ============================================================
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
