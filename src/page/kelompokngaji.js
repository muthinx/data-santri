import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeKelompok = null;

export function loadKelompokNgaji(container) {
    renderKelompokPage(container);
    listenKelompok();
}

function renderKelompokPage(container) {
    container.innerHTML = `
        <div id="kelompok-header-actions" style="display: flex; justify-content: flex-end; margin-bottom: 1rem;">
            <button id="tambahKelompokBtn" class="btn-primary"><i class="fas fa-plus"></i> Tambah Kelompok</button>
        </div>
        <div id="kelompok-form-container" style="display:none;"></div>
        <div id="kelompokList" class="kelompok-grid"></div>

        <!-- Modal untuk lihat anggota -->
        <div id="detailKelompokModal" class="modal">
            <div class="modal-content">
                <h3>Daftar Anggota Kelompok</h3>
                <div id="detailAnggotaKelompokList"></div>
                <button id="tutupDetailKelompokModal" class="btn-secondary">Tutup</button>
            </div>
        </div>
    `;

    document.getElementById('tambahKelompokBtn').onclick = () => showKelompokForm();
    document.getElementById('tutupDetailKelompokModal').onclick = () => document.getElementById('detailKelompokModal').style.display = 'none';
}

// Form untuk tambah/edit kelompok
let currentKelompokId = null;

function showKelompokForm(editData = null) {
    const formContainer = document.getElementById('kelompok-form-container');
    const listContainer = document.getElementById('kelompokList');
    const headerActions = document.getElementById('kelompok-header-actions');
    
    if (headerActions) headerActions.style.display = 'none';
    listContainer.style.display = 'none';
    formContainer.style.display = 'block';
    
    // Tombol kembali
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
            if (confirm('Hapus kelompok ini? Data santri yang terkait tidak akan terhapus.')) {
                try {
                    await deleteDoc(doc(db, "kelompok", currentKelompokId));
                    alert('Kelompok dihapus');
                    hideKelompokForm();
                } catch (err) { alert(err.message); }
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
    }
}

function hideKelompokForm() {
    document.getElementById('kelompok-form-container').style.display = 'none';
    document.getElementById('kelompokList').style.display = 'grid';
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
                    <label>Nama Kelompok *</label>
                    <input id="kelompokNama" required>
                </div>
                <div class="form-group">
                    <label>Jenis Kelompok</label>
                    <select id="kelompokJenis">
                        <option value="Ngaji">Ngaji</option>
                        <option value="Belajar">Belajar</option>
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
    if (!nama) return alert("Nama kelompok harus diisi");
    const data = {
        nama,
        jenis: document.getElementById('kelompokJenis').value,
        pembina: document.getElementById('kelompokPembina').value
    };
    try {
        if (currentKelompokId) {
            await updateDoc(doc(db, "kelompok", currentKelompokId), data);
            alert("Kelompok diupdate");
        } else {
            await addDoc(collection(db, "kelompok"), data);
            alert("Kelompok ditambahkan");
        }
        hideKelompokForm();
    } catch (err) { alert(err.message); }
}

async function showAnggotaKelompok(kelompokNama, kelompokJenis) {
    const santriSnap = await getDocs(collection(db, "santri"));
    let field = '';
    if (kelompokJenis === 'Ngaji') field = 'kelompokNgaji';
    else if (kelompokJenis === 'Belajar') field = 'kelompokBelajar';
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

function renderKelompokList(kelompoks) {
    const container = document.getElementById('kelompokList');
    if (!container) return;
    if (kelompoks.length === 0) {
        container.innerHTML = "<p class='empty-state'>Belum ada kelompok. Klik tombol Tambah Kelompok.</p>";
        container.style.display = 'grid';
        return;
    }
    
    let html = '';
    for (let k of kelompoks) {
        html += `
            <div class="kelompok-card">
                <div class="card-header">
                    <i class="fas fa-users"></i>
                    <h3>${escapeHtml(k.nama)}</h3>
                </div>
                <div class="card-body">
                    <div class="info-row"><i class="fas fa-tag"></i> <strong>Jenis:</strong> ${escapeHtml(k.jenis)}</div>
                    <div class="info-row"><i class="fas fa-chalkboard-user"></i> <strong>Pembina:</strong> ${escapeHtml(k.pembina) || '-'}</div>
                    <div class="info-row"><i class="fas fa-users"></i> <strong>Jumlah Anggota:</strong> <span id="count-${k.id}">...</span></div>
                </div>
                <div class="card-actions">
                    <button class="lihatAnggotaKelompok" data-nama="${escapeHtml(k.nama)}" data-jenis="${escapeHtml(k.jenis)}"><i class="fas fa-eye"></i> Anggota</button>
                    <button class="editKelompok" data-id="${k.id}"><i class="fas fa-edit"></i> Edit</button>
                    <button class="hapusKelompok" data-id="${k.id}"><i class="fas fa-trash"></i> Hapus</button>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
    container.style.display = 'grid';
    
    // Update jumlah anggota
    updateAnggotaCounts(kelompoks);
    
    // Event listeners
    document.querySelectorAll('.lihatAnggotaKelompok').forEach(btn => {
        btn.addEventListener('click', () => showAnggotaKelompok(btn.dataset.nama, btn.dataset.jenis));
    });
    document.querySelectorAll('.editKelompok').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "kelompok", id));
            if (docSnap.exists()) showKelompokForm({ id, ...docSnap.data() });
        });
    });
    document.querySelectorAll('.hapusKelompok').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (confirm("Hapus kelompok ini?")) {
                await deleteDoc(doc(db, "kelompok", id));
            }
        });
    });
}

async function updateAnggotaCounts(kelompoks) {
    const santriSnap = await getDocs(collection(db, "santri"));
    const santriList = santriSnap.docs.map(d => d.data());
    for (let k of kelompoks) {
        let count = 0;
        if (k.jenis === 'Ngaji') count = santriList.filter(s => s.kepesantrenan?.kelompokNgaji === k.nama).length;
        else if (k.jenis === 'Belajar') count = santriList.filter(s => s.kepesantrenan?.kelompokBelajar === k.nama).length;
        else count = santriList.filter(s => s.kepesantrenan?.kelasFormal === k.nama).length;
        const span = document.getElementById(`count-${k.id}`);
        if (span) span.innerText = count;
    }
}

function listenKelompok() {
    if (unsubscribeKelompok) unsubscribeKelompok();
    unsubscribeKelompok = onSnapshot(collection(db, "kelompok"), (snapshot) => {
        const kelompoks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderKelompokList(kelompoks);
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