import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeAsrama = null;
let allAsramaData = [];
let currentAsramaId = null;

// State untuk filter & sortir
let filterStateAsrama = {
    ketua: 'Semua'
};
let sortStateAsrama = 'namaAsc';

export function loadAsrama(container) {
    renderAsramaPage(container);
    listenAsrama();
    listenSantriForCount();
}

function renderAsramaPage(container) {
    container.innerHTML = `
        <div id="asrama-header-actions">
            <div class="header-left-buttons">
                <button id="tambahAsramaBtn" class="btn-primary"><i class="fas fa-plus"></i></button>
                <button id="btnFilterAsrama" class="btn-secondary"><i class="fas fa-sliders-h"></i> Filter</button>
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

        <!-- Modal untuk lihat anggota -->
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
    };

    // Buat modal filter asrama
    if (!document.getElementById('filterModalAsrama')) {
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

    // Update opsi filter dinamis (ketua)
    updateFilterOptionsAsrama();
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
    allAsramaData.forEach(a => {
        if (a.ketua && a.ketua.trim()) ketuaSet.add(a.ketua.trim());
    });
    const ketuaSelect = document.getElementById('filterKetuaAsramaModal');
    if (ketuaSelect) {
        const currentVal = ketuaSelect.value;
        ketuaSelect.innerHTML = '<option value="Semua">Semua</option>';
        Array.from(ketuaSet).sort().forEach(ketua => {
            ketuaSelect.innerHTML += `<option value="${escapeHtml(ketua)}">${escapeHtml(ketua)}</option>`;
        });
        ketuaSelect.value = currentVal;
    }
}

// ====== FILTER & SORTIR ASRAMA ======
function applyFiltersAndSortAsrama() {
    const keyword = document.getElementById('searchAsrama')?.value?.toLowerCase() || '';
    let filtered = allAsramaData.filter(a => {
        if (keyword && !(a.nama && a.nama.toLowerCase().includes(keyword)) && !(a.ketua && a.ketua.toLowerCase().includes(keyword))) return false;
        if (filterStateAsrama.ketua !== 'Semua' && (a.ketua || '') !== filterStateAsrama.ketua) return false;
        return true;
    });

    // Hitung jumlah anggota untuk sorting
    const anggotaCounts = {};
    // Data santri akan diambil dari listener terpisah, kita simpan di variabel global
    if (window.santriListForAsrama) {
        window.santriListForAsrama.forEach(s => {
            const asrama = s.kepesantrenan?.asrama;
            if (asrama) {
                anggotaCounts[asrama] = (anggotaCounts[asrama] || 0) + 1;
            }
        });
    }

    switch (sortStateAsrama) {
        case 'namaAsc':
            filtered.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
            break;
        case 'namaDesc':
            filtered.sort((a, b) => (b.nama || '').localeCompare(a.nama || ''));
            break;
        case 'anggotaDesc':
            filtered.sort((a, b) => (anggotaCounts[b.nama] || 0) - (anggotaCounts[a.nama] || 0));
            break;
        case 'anggotaAsc':
            filtered.sort((a, b) => (anggotaCounts[a.nama] || 0) - (anggotaCounts[b.nama] || 0));
            break;
        default:
            break;
    }

    renderAsramaList(filtered, anggotaCounts);
}

// ========== EKSPOR CSV ASRAMA ==========
async function exportAsramaToCSV() {
    if (allAsramaData.length === 0) {
        await window.customAlert("Tidak ada data asrama untuk diekspor.");
        return;
    }
    // Hitung jumlah anggota
    const anggotaCounts = {};
    if (window.santriListForAsrama) {
        window.santriListForAsrama.forEach(s => {
            const asrama = s.kepesantrenan?.asrama;
            if (asrama) {
                anggotaCounts[asrama] = (anggotaCounts[asrama] || 0) + 1;
            }
        });
    }
    const columns = ["Nama", "Ketua", "Keterangan", "Jumlah Anggota"];
    const rows = [columns];
    for (const a of allAsramaData) {
        const row = [
            a.nama || '',
            a.ketua || '',
            a.keterangan || '',
            (anggotaCounts[a.nama] || 0).toString()
        ];
        rows.push(row.map(cell => {
            let str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }));
    }
    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", `asrama_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ========== CRUD ASRAMA ==========
function showAsramaForm(editData = null) {
    const formContainer = document.getElementById('asrama-form-container');
    const listContainer = document.getElementById('asramaList');
    const headerActions = document.getElementById('asrama-header-actions');
    
    if (headerActions) headerActions.style.display = 'none';
    listContainer.style.display = 'none';
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
    
    if (editData) {
        currentAsramaId = editData.id;
    } else {
        currentAsramaId = null;
    }
    
    formContainer.innerHTML = buildAsramaFormHtml(editData);
    
    if (currentAsramaId) {
        const formButtons = document.querySelector('#asramaForm .form-buttons');
        const oldDelete = formButtons.querySelector('.btn-danger');
        if (oldDelete) oldDelete.remove();
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
                } catch (err) { await window.customAlert(err.message); }
            }
        };
        formButtons.appendChild(deleteBtn);
    }
    
    document.getElementById('asramaForm').onsubmit = (e) => { e.preventDefault(); saveAsrama(); };
    document.getElementById('btnBatalAsramaForm').onclick = () => hideAsramaForm();
    
    if (editData) {
        document.getElementById('asramaNama').value = editData.nama || '';
        document.getElementById('ketuaAsrama').value = editData.ketua || '';
        document.getElementById('keteranganAsrama').value = editData.keterangan || '';
    }
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

function buildAsramaFormHtml(editData = null) {
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
    } catch (err) { await window.customAlert(err.message); }
}

async function showAnggota(asramaNama) {
    const container = document.getElementById('detailAnggotaList');
    if (!window.santriListForAsrama) {
        container.innerHTML = "<p>Memuat data santri...</p>";
        return;
    }
    const anggota = window.santriListForAsrama
        .filter(s => s.kepesantrenan?.asrama === asramaNama)
        .map(s => s.nama)
        .filter(n => n);
    if (anggota.length === 0) {
        container.innerHTML = "<p>Tidak ada santri di asrama ini.</p>";
    } else {
        container.innerHTML = `<ul class="anggota-list">${anggota.map(n => `<li><i class="fas fa-user"></i> ${escapeHtml(n)}</li>`).join('')}</ul>`;
    }
    document.getElementById('detailAsramaModal').style.display = 'flex';
}

function renderAsramaList(asramas, anggotaCounts) {
    const container = document.getElementById('asramaList');
    if (!container) return;
    if (asramas.length === 0) {
        container.innerHTML = "<p class='empty-state'>Tidak ada asrama yang sesuai dengan filter.</p>";
        container.style.display = 'grid';
        return;
    }
    
    // Gunakan anggotaCounts yang dikirim atau hitung ulang
    if (!anggotaCounts && window.santriListForAsrama) {
        anggotaCounts = {};
        window.santriListForAsrama.forEach(s => {
            const asrama = s.kepesantrenan?.asrama;
            if (asrama) {
                anggotaCounts[asrama] = (anggotaCounts[asrama] || 0) + 1;
            }
        });
    }
    
    let html = '';
    for (let as of asramas) {
        const count = (anggotaCounts && anggotaCounts[as.nama]) ? anggotaCounts[as.nama] : 0;
        html += `
            <div class="asrama-card">
                <div class="card-header">
                    <i class="fas fa-building"></i>
                    <h3>${escapeHtml(as.nama)}</h3>
                </div>
                <div class="card-body">
                    <div class="info-row"><i class="fas fa-user-tie"></i> <strong>Ketua:</strong> ${escapeHtml(as.ketua) || '-'}</div>
                    <div class="info-row"><i class="fas fa-users"></i> <strong>Jumlah Anggota:</strong> ${count}</div>
                    ${as.keterangan ? `<div class="info-row"><i class="fas fa-info-circle"></i> <strong>Keterangan:</strong> ${escapeHtml(as.keterangan)}</div>` : ''}
                </div>
                <div class="card-actions">
                    <button class="lihatAnggota" data-nama="${escapeHtml(as.nama)}"><i class="fas fa-eye"></i> Anggota</button>
                    <button class="editAsrama" data-id="${as.id}"><i class="fas fa-edit"></i> Edit</button>
                    <button class="hapusAsrama" data-id="${as.id}"><i class="fas fa-trash"></i> Hapus</button>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
    container.style.display = 'grid';
    
    // Event listeners
    document.querySelectorAll('.lihatAnggota').forEach(btn => {
        btn.addEventListener('click', () => showAnggota(btn.dataset.nama));
    });
    document.querySelectorAll('.editAsrama').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "asrama", id));
            if (docSnap.exists()) showAsramaForm({ id, ...docSnap.data() });
        });
    });
    document.querySelectorAll('.hapusAsrama').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (await window.customConfirm("Hapus asrama ini?")) {
                try {
                    await deleteDoc(doc(db, "asrama", id));
                    await window.customAlert("Asrama dihapus");
                } catch (err) { await window.customAlert(err.message); }
            }
        });
    });
}

function listenAsrama() {
    if (unsubscribeAsrama) unsubscribeAsrama();
    unsubscribeAsrama = onSnapshot(collection(db, "asrama"), (snapshot) => {
        allAsramaData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateFilterOptionsAsrama();
        applyFiltersAndSortAsrama();
    });
}

// Dengarkan perubahan santri untuk update jumlah anggota
function listenSantriForCount() {
    // Gunakan onSnapshot sekali, simpan data di window agar bisa diakses
    onSnapshot(collection(db, "santri"), (snapshot) => {
        window.santriListForAsrama = snapshot.docs.map(doc => doc.data());
        // Re-render dengan data terbaru
        applyFiltersAndSortAsrama();
    });
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
