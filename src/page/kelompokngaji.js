import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs, getDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeKelompok = null;
let allKelompokData = [];
let currentKelompokId = null;

// State filter & sortir
let filterStateKelompok = {
    jenis: 'Semua'
};
let sortStateKelompok = 'urutanAsc'; // default: urutan
let searchKeyword = '';

export function loadKelompokNgaji(container) {
    renderKelompokPage(container);
    listenKelompok();
}

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
        <div id="kelompok-form-container" style="display:none;"></div>
        <!-- Modal detail anggota -->
        <div id="detailKelompokModal" class="modal">
            <div class="modal-content">
                <h3>Daftar Anggota Kelompok</h3>
                <div id="detailAnggotaKelompokList"></div>
                <button id="tutupDetailKelompokModal" class="btn-secondary">Tutup</button>
            </div>
        </div>
    `;

    // Event listeners
    document.getElementById('tambahKelompokBtn').onclick = () => showKelompokForm();
    document.getElementById('btnFilterKelompok').onclick = () => openFilterModalKelompok();
    document.getElementById('btnExportKelompokCSV').onclick = () => exportKelompokToCSV();
    document.getElementById('tutupDetailKelompokModal').onclick = () => document.getElementById('detailKelompokModal').style.display = 'none';

    const searchInput = document.getElementById('searchKelompok');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchKeyword = e.target.value.toLowerCase();
            applyFiltersAndSort();
        });
    }

    // Buat modal filter kelompok
    if (!document.getElementById('filterModalKelompok')) {
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

// ===== FILTER & SORTIR =====
function applyFiltersAndSort() {
    let filtered = allKelompokData.filter(k => {
        // Search
        if (searchKeyword) {
            const match = (k.nama && k.nama.toLowerCase().includes(searchKeyword)) ||
                          (k.pembina && k.pembina.toLowerCase().includes(searchKeyword));
            if (!match) return false;
        }
        // Filter jenis
        if (filterStateKelompok.jenis !== 'Semua' && k.jenis !== filterStateKelompok.jenis) return false;
        return true;
    });

    // Sortir
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
            filtered.sort((a, b) => (b._anggotaCount || 0) - (a._anggotaCount || 0));
            break;
        case 'anggotaAsc':
            filtered.sort((a, b) => (a._anggotaCount || 0) - (b._anggotaCount || 0));
            break;
        default: break;
    }

    renderKelompokList(filtered);
}

// ===== FORM TAMBAH/EDIT KELOMPOK =====
function showKelompokForm(editData = null) {
    const formContainer = document.getElementById('kelompok-form-container');
    const pageContainer = document.getElementById('kelompok-page-container');
    const headerActions = document.getElementById('kelompok-header-actions');
    
    if (headerActions) headerActions.style.display = 'none';
    if (pageContainer) pageContainer.style.display = 'none';
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
    
    if (editData) {
        currentKelompokId = editData.id;
    } else {
        currentKelompokId = null;
    }
    
    formContainer.innerHTML = buildKelompokFormHtml(editData);
    
    if (currentKelompokId) {
        const formButtons = document.querySelector('#kelompokForm .form-buttons');
        const oldDelete = formButtons.querySelector('.btn-danger');
        if (oldDelete) oldDelete.remove();
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
                } catch (err) { await window.customAlert(err.message); }
            }
        };
        formButtons.appendChild(deleteBtn);
    }
    
    document.getElementById('kelompokForm').onsubmit = (e) => { e.preventDefault(); saveKelompok(); };
    document.getElementById('btnBatalKelompokForm').onclick = () => hideKelompokForm();
    
    if (editData) {
        document.getElementById('kelompokNama').value = editData.nama || '';
        document.getElementById('kelompokJenis').value = editData.jenis || 'Ngaji';
        document.getElementById('kelompokPembina').value = editData.pembina || '';
        const urutanInput = document.getElementById('kelompokUrutan');
        if (urutanInput) urutanInput.value = editData.urutan || 0;
    }
}

function hideKelompokForm() {
    document.getElementById('kelompok-form-container').style.display = 'none';
    const pageContainer = document.getElementById('kelompok-page-container').style.display ='block';
    const headerActions = document.getElementById('kelompok-header-actions');
    if (headerActions) headerActions.style.display = 'flex';
    const backBtn = document.getElementById('btnBackKelompokForm');
    if (backBtn) backBtn.style.display = 'none';
    currentKelompokId = null;
}

function buildKelompokFormHtml(editData = null) {
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
    const data = {
        nama,
        jenis: document.getElementById('kelompokJenis').value,
        pembina: document.getElementById('kelompokPembina').value,
        urutan: parseInt(document.getElementById('kelompokUrutan').value) || 0,
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
    } catch (err) { await window.customAlert(err.message); }
}

// ===== LIHAT ANGGOTA =====
async function showAnggotaKelompok(kelompokNama, kelompokJenis) {
    const santriSnap = await getDocs(collection(db, "santri"));
    let field = '';
    if (kelompokJenis === 'Ngaji') field = 'kelompokNgaji';
    else if (kelompokJenis === 'Belajar') field = 'kelompokBelajar';
    else if (kelompokJenis === 'Diniyah') field = 'kelasDiniyah';
    else field = 'kelasFormal';
    
    const anggota = [];
    santriSnap.forEach(docSnap => {
        const s = docSnap.data();
        const nilai = s.kepesantrenan?.[field];
        if (nilai === kelompokNama) anggota.push(s.nama);
    });
    
    const container = document.getElementById('detailAnggotaKelompokList');
    if (anggota.length === 0) container.innerHTML = "<p>Tidak ada santri di kelompok ini.</p>";
    else container.innerHTML = `<ul class="anggota-list">${anggota.map(n => `<li><i class="fas fa-user"></i> ${escapeHtml(n)}</li>`).join('')}</ul>`;
    document.getElementById('detailKelompokModal').style.display = 'flex';
}

// ===== RENDER LIST =====
async function renderKelompokList(kelompoks) {
    const container = document.getElementById('kelompokList');
    if (!container) return;

    // Hitung jumlah anggota untuk setiap kelompok
    const santriSnap = await getDocs(collection(db, "santri"));
    const santriList = santriSnap.docs.map(d => d.data());
    const countMap = {};
    kelompoks.forEach(k => {
        let count = 0;
        if (k.jenis === 'Ngaji') count = santriList.filter(s => s.kepesantrenan?.kelompokNgaji === k.nama).length;
        else if (k.jenis === 'Belajar') count = santriList.filter(s => s.kepesantrenan?.kelompokBelajar === k.nama).length;
        else if (k.jenis === 'Diniyah') count = santriList.filter(s => s.kepesantrenan?.kelasDiniyah === k.nama).length;
        else count = santriList.filter(s => s.kepesantrenan?.kelasFormal === k.nama).length;
        k._anggotaCount = count;
        countMap[k.id] = count;
    });

    if (kelompoks.length === 0) {
        container.innerHTML = "<p class='empty-state'>Tidak ada kelompok yang sesuai.</p>";
        container.style.display = 'grid';
        return;
    }

    // Kelompokkan berdasarkan jenis
    const grouped = {
        'Ngaji': [],
        'Belajar': [],
        'Diniyah': [],
        'Formal': []
    };
    kelompoks.forEach(k => {
        if (grouped[k.jenis]) grouped[k.jenis].push(k);
        else grouped[k.jenis] = [k];
    });

    let html = '';
    const jenisUrutan = ['Ngaji', 'Belajar', 'Diniyah', 'Formal'];
    for (const jenis of jenisUrutan) {
        const items = grouped[jenis];
        if (items && items.length > 0) {
            html += `
                <div class="kelompok-section">
                    <h3 class="kelompok-section-title">
                        <i class="fas ${getJenisIcon(jenis)}"></i> 
                        ${jenis}
                    </h3>
                    <div class="kelompok-grid-inner">
            `;
            for (let k of items) {
                const count = countMap[k.id] || 0;
                html += `
                    <div class="kelompok-card">
                        <div class="card-header">
                            <i class="fas fa-users"></i>
                            <h3>${escapeHtml(k.nama)}</h3>
                        </div>
                        <div class="card-body">
                            <div class="info-row"><i class="fas fa-tag"></i> <strong>Jenis:</strong> ${escapeHtml(k.jenis)}</div>
                            <div class="info-row"><i class="fas fa-chalkboard-user"></i> <strong>Pembina:</strong> ${escapeHtml(k.pembina) || '-'}</div>
                            <div class="info-row"><i class="fas fa-users"></i> <strong>Jumlah Anggota:</strong> ${count}</div>
                            ${k.urutan !== undefined ? `<div class="info-row"><i class="fas fa-sort"></i> <strong>Urutan:</strong> ${k.urutan}</div>` : ''}
                        </div>
                        <div class="card-actions">
                            <button class="lihatAnggotaKelompok" data-nama="${escapeHtml(k.nama)}" data-jenis="${escapeHtml(k.jenis)}"><i class="fas fa-eye"></i> Anggota</button>
                            <button class="editKelompok" data-id="${k.id}"><i class="fas fa-edit"></i> Edit</button>
                            <button class="hapusKelompok" data-id="${k.id}"><i class="fas fa-trash"></i> Hapus</button>
                        </div>
                    </div>
                `;
            }
            html += `</div></div>`;
        }
    }

    container.innerHTML = html;
    container.style.display = 'block';

    // Event listeners
    container.querySelectorAll('.lihatAnggotaKelompok').forEach(btn => {
        btn.addEventListener('click', () => showAnggotaKelompok(btn.dataset.nama, btn.dataset.jenis));
    });
    container.querySelectorAll('.editKelompok').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "kelompok", id));
            if (docSnap.exists()) showKelompokForm({ id, ...docSnap.data() });
        });
    });
    container.querySelectorAll('.hapusKelompok').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (await window.customConfirm("Hapus kelompok ini?")) {
                try {
                    await deleteDoc(doc(db, "kelompok", id));
                } catch (err) { await window.customAlert(err.message); }
            }
        });
    });
}

function getJenisIcon(jenis) {
    switch(jenis) {
        case 'Ngaji': return 'fa-book-quran';
        case 'Belajar': return 'fa-chalkboard-user';
        case 'Diniyah': return 'fa-mosque';
        case 'Formal': return 'fa-school';
        default: return 'fa-tag';
    }
}

// ===== LISTENER & SYNC =====
function listenKelompok() {
    if (unsubscribeKelompok) unsubscribeKelompok();
    const q = query(collection(db, "kelompok"), orderBy("urutan", "asc"));
    unsubscribeKelompok = onSnapshot(q, (snapshot) => {
        allKelompokData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Reset filter options (jenis sudah statis)
        applyFiltersAndSort();
    });
}

// ===== EKSPOR CSV =====
async function exportKelompokToCSV() {
    const data = allKelompokData;
    if (data.length === 0) {
        await window.customAlert("Tidak ada data kelompok untuk diekspor.");
        return;
    }
    // Hitung jumlah anggota
    const santriSnap = await getDocs(collection(db, "santri"));
    const santriList = santriSnap.docs.map(d => d.data());
    const countMap = {};
    data.forEach(k => {
        let count = 0;
        if (k.jenis === 'Ngaji') count = santriList.filter(s => s.kepesantrenan?.kelompokNgaji === k.nama).length;
        else if (k.jenis === 'Belajar') count = santriList.filter(s => s.kepesantrenan?.kelompokBelajar === k.nama).length;
        else if (k.jenis === 'Diniyah') count = santriList.filter(s => s.kepesantrenan?.kelasDiniyah === k.nama).length;
        else count = santriList.filter(s => s.kepesantrenan?.kelasFormal === k.nama).length;
        countMap[k.id] = count;
    });

    const columns = ["Nama", "Jenis", "Pembina", "Urutan", "Jumlah Anggota"];
    const rows = [columns];
    for (const k of data) {
        const row = [
            k.nama || '',
            k.jenis || '',
            k.pembina || '',
            k.urutan || 0,
            countMap[k.id] || 0
        ];
        const escaped = row.map(val => {
            let str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        rows.push(escaped);
    }
    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", `kelompok_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
