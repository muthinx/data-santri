import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeAsrama = null;

export function loadAsrama(container) {
    renderAsramaPage(container);
    listenAsrama();
}

function renderAsramaPage(container) {
    container.innerHTML = `
        <div id="asrama-header-actions" style="display: flex; justify-content: flex-end; margin-bottom: 1rem;">
            <button id="tambahAsramaBtn" class="btn-primary"><i class="fas fa-plus"></i> Tambah Asrama</button>
        </div>
        <div id="asrama-form-container" style="display:none;"></div>
        <div id="asramaList" class="asrama-grid"></div>

        <!-- Modal untuk lihat anggota -->
        <div id="detailAsramaModal" class="modal">
            <div class="modal-content">
                <h3>Daftar Anggota Asrama</h3>
                <div id="detailAnggotaList"></div>
                <button id="tutupDetailModal" class="btn-secondary">Tutup</button>
            </div>
        </div>
    `;

    document.getElementById('tambahAsramaBtn').onclick = () => showAsramaForm();
    document.getElementById('tutupDetailModal').onclick = () => document.getElementById('detailAsramaModal').style.display = 'none';
}

// Form untuk tambah/edit asrama (menggantikan tabel, seperti santri.js)
let currentAsramaId = null;

function showAsramaForm(editData = null) {
    const formContainer = document.getElementById('asrama-form-container');
    const listContainer = document.getElementById('asramaList');
    const headerActions = document.getElementById('asrama-header-actions');
    
    if (headerActions) headerActions.style.display = 'none';
    listContainer.style.display = 'none';
    formContainer.style.display = 'block';
    
    // Tombol kembali
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
        // Tambah tombol hapus jika edit
        const formButtons = document.querySelector('#asramaForm .form-buttons');
        const oldDelete = formButtons.querySelector('.btn-danger');
        if (oldDelete) oldDelete.remove();
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Hapus';
        deleteBtn.className = 'btn-danger';
        deleteBtn.onclick = async () => {
            if (confirm('Hapus asrama ini? Data santri yang terkait tidak akan terhapus.')) {
                try {
                    await deleteDoc(doc(db, "asrama", currentAsramaId));
                    alert('Asrama dihapus');
                    hideAsramaForm();
                } catch (err) { alert(err.message); }
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
    if (!nama) return alert("Nama asrama harus diisi");
    const data = { nama, ketua: document.getElementById('ketuaAsrama').value, keterangan: document.getElementById('keteranganAsrama').value };
    try {
        if (currentAsramaId) {
            await updateDoc(doc(db, "asrama", currentAsramaId), data);
            alert("Asrama diupdate");
        } else {
            await addDoc(collection(db, "asrama"), data);
            alert("Asrama ditambahkan");
        }
        hideAsramaForm();
    } catch (err) { alert(err.message); }
}

async function showAnggota(asramaNama) {
    const santriSnap = await getDocs(collection(db, "santri"));
    const anggota = [];
    santriSnap.forEach(docSnap => {
        const s = docSnap.data();
        if (s.kepesantrenan?.asrama === asramaNama) anggota.push(s.nama);
    });
    const container = document.getElementById('detailAnggotaList');
    if (anggota.length === 0) container.innerHTML = "<p>Tidak ada santri di asrama ini.</p>";
    else container.innerHTML = `<ul class="anggota-list">${anggota.map(n => `<li><i class="fas fa-user"></i> ${escapeHtml(n)}</li>`).join('')}</ul>`;
    document.getElementById('detailAsramaModal').style.display = 'flex';
}

function renderAsramaList(asramas) {
    const container = document.getElementById('asramaList');
    if (!container) return;
    if (asramas.length === 0) {
        container.innerHTML = "<p class='empty-state'>Belum ada asrama. Klik tombol Tambah Asrama.</p>";
        container.style.display = 'grid';
        return;
    }
    
    let html = '';
    for (let as of asramas) {
        html += `
            <div class="asrama-card">
                <div class="card-header">
                    <i class="fas fa-building"></i>
                    <h3>${escapeHtml(as.nama)}</h3>
                </div>
                <div class="card-body">
                    <div class="info-row"><i class="fas fa-user-tie"></i> <strong>Ketua:</strong> ${escapeHtml(as.ketua) || '-'}</div>
                    <div class="info-row"><i class="fas fa-users"></i> <strong>Jumlah Anggota:</strong> <span id="count-${as.id}">...</span></div>
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
    
    // Update jumlah anggota
    updateAnggotaCounts(asramas);
    
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
            if (confirm("Hapus asrama ini?")) {
                await deleteDoc(doc(db, "asrama", id));
            }
        });
    });
}

async function updateAnggotaCounts(asramas) {
    const santriSnap = await getDocs(collection(db, "santri"));
    const santriList = santriSnap.docs.map(d => d.data());
    for (let as of asramas) {
        const count = santriList.filter(s => s.kepesantrenan?.asrama === as.nama).length;
        const span = document.getElementById(`count-${as.id}`);
        if (span) span.innerText = count;
    }
}

function listenAsrama() {
    if (unsubscribeAsrama) unsubscribeAsrama();
    unsubscribeAsrama = onSnapshot(collection(db, "asrama"), (snapshot) => {
        const asramas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAsramaList(asramas);
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