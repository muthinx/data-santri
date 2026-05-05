import { db, auth } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, getDocs, query, where, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let unsubscribeKeuangan = null;
let currentEditId = null;
let currentTransaksiId = null;

export function loadKeuangan(container) {
    console.log("loadKeuangan: window.currentAdminName =", window.currentAdminName);
    renderKeuanganPage(container);
    listenKeuangan();
}

function renderKeuanganPage(container) {
    container.innerHTML = `
        <div id="keuangan-header-actions">
            <div class="header-left-buttons">
                <button id="btnTambahTransaksi" class="btn-primary"><i class="fas fa-plus"></i> Tambah Transaksi</button>
            </div>
        </div>
        <div id="transaksi-form-container" style="display:none;"></div>
        <div id="keuanganTable"></div>
    `;
    document.getElementById('btnTambahTransaksi').onclick = () => showFormTransaksi();
}

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
    
    // Ambil semua transaksi, filter manual di JS
    const snap = await getDocs(collection(db, "keuangan"));
    let count = 1;
    snap.forEach(docSnap => {
        const trx = docSnap.data();
        if (trx.nomorTransaksi && trx.nomorTransaksi.startsWith(prefix)) {
            count++;
        }
    });
    return `${prefix}-${String(count).padStart(3, '0')}`;
}

// Hitung saldo terakhir dengan sorting manual di JS
async function getLastSaldo() {
    const snap = await getDocs(collection(db, "keuangan"));
    let transactions = [];
    snap.forEach(docSnap => {
        transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    // Sortir berdasarkan tanggal, lalu nomor transaksi
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
    
    // Cari santriId berdasarkan nama
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
        // Edit: update data (tidak mengubah nomor transaksi dan saldo? Lebih baik tidak izinkan edit atau rekalkulasi)
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

function openTransaksiModal(editData = null) {
    if (editData) {
        currentEditId = editData.id;
        document.getElementById('modalTransaksiTitle').innerText = "Edit Transaksi";
        document.getElementById('namaSantriSelect').value = editData.santriId;
        document.getElementById('jenisTransaksi').value = editData.jenis;
        document.getElementById('jumlahTransaksi').value = editData.jumlah;
        document.getElementById('tglTransaksi').value = editData.tanggal;
        document.getElementById('keteranganTransaksi').value = editData.keterangan || '';
    } else {
        currentEditId = null;
        document.getElementById('namaSantriSelect').value = "";
        document.getElementById('jenisTransaksi').value = "Pemasukan";
        document.getElementById('jumlahTransaksi').value = "";
        document.getElementById('tglTransaksi').value = new Date().toISOString().slice(0,10);
        document.getElementById('keteranganTransaksi').value = "";
    }
    document.getElementById('transaksiModal').style.display = 'flex';
}

function closeTransaksiModal() {
    document.getElementById('transaksiModal').style.display = 'none';
    currentEditId = null;
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
    snap.forEach(docSnap => {
        transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    // Sortir berdasarkan tanggal, lalu nomor transaksi
    transactions.sort((a, b) => {
        if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
        return (a.nomorTransaksi || '').localeCompare(b.nomorTransaksi || '');
    });
    
    let runningSaldo = 0;
    for (const trans of transactions) {
        if (trans.jenis === "Pemasukan") {
            runningSaldo += trans.jumlah;
        } else {
            runningSaldo -= trans.jumlah;
        }
        await updateDoc(doc(db, "keuangan", trans.id), { saldo: runningSaldo });
    }
    console.log("Saldo berhasil dihitung ulang");
}

function renderKeuanganTable(transaksis) {
    const container = document.getElementById('keuanganTable');
    if (!container) return;
    
    // Urutkan dari tanggal terbaru ke terlama
    transaksis.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
    
    if (transaksis.length === 0) {
        container.innerHTML = "<p>Belum ada transaksi.</p>";
        container.style.display = 'block';
        return;
    }

    const isMobile = window.innerWidth <= 768;
    let html = '<div class="table-container"><table class="keuangan-table">';
    
    if (isMobile) {
        // Mode mobile: hanya kolom: Tanggal, Nama Santri, Jenis, Jumlah, Aksi
        html += `<thead>
                    <tr>
                        <th>Tanggal</th>
                        <th>Santri</th>
                        <th>Jenis</th>
                        <th>Jumlah</th>
                        <th>Aksi</th>
                    </tr>
                </thead><tbody>`;
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
        // Mode desktop: tampilkan semua kolom
        html += `<thead>
                    <tr>
                        <th>Nomor Transaksi</th>
                        <th>Tanggal</th>
                        <th>Nama Santri</th>
                        <th>Jenis</th>
                        <th>Jumlah</th>
                        <th>Admin</th>
                        <th>Aksi</th>
                    </tr>
                </thead><tbody>`;
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
    container.innerHTML = html;
    // Event listener untuk link santri
    document.querySelectorAll('.santri-link').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const santriId = link.dataset.id;
            await showSantriKeuangan(santriId);
        });
    });
    container.style.display = 'block';

    // Event listener untuk tombol Edit
    document.querySelectorAll('.edit-transaksi-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "keuangan", id));
            if (docSnap.exists()) showFormTransaksi({ id, ...docSnap.data() });
        });
    });
}

function formatTanggal(tgl) {
    if (!tgl) return '-';
    const parts = tgl.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return tgl;
}

function listenKeuangan() {
    if (unsubscribeKeuangan) unsubscribeKeuangan();
    unsubscribeKeuangan = onSnapshot(collection(db, "keuangan"), (snapshot) => {
        let transaksis = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sorting dilakukan di dalam renderKeuanganTable
        renderKeuanganTable(transaksis);
    });
}

async function showFormTransaksi(editData = null) {
    const formContainer = document.getElementById('transaksi-form-container');
    const tableContainer = document.getElementById('keuanganTable');
    const headerActions = document.getElementById('keuangan-header-actions');
    
    if (headerActions) headerActions.style.display = 'none';
    
    // Tombol kembali
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
    
    // Set current id
    if (editData) {
        currentTransaksiId = editData.id;
    } else {
        currentTransaksiId = null;
    }
    
    formContainer.style.display = 'block';
    tableContainer.style.display = 'none';
    formContainer.innerHTML = buildFormTransaksiHtml(editData);

    await loadSantriDatalist();
    const namaInput = document.getElementById('namaSantriInput');
    if (editData && editData.namaSantri) {
        namaInput.value = editData.namaSantri;
    }

    loadSantriDropdown().then(() => {
        if (editData && editData.santriId) {
            document.getElementById('namaSantriSelect').value = editData.santriId;
        }
    });
    
    // Jika mode edit, tambah tombol hapus
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
    
    if (editData) {
        fillTransaksiFormData(editData);
    }
}

function hideFormTransaksi() {
    document.getElementById('transaksi-form-container').style.display = 'none';
    document.getElementById('keuanganTable').style.display = 'block';
    const headerActions = document.getElementById('keuangan-header-actions');
    if (headerActions) headerActions.style.display = 'flex';
    const backBtn = document.getElementById('btnBackTransaksiForm');
    if (backBtn) backBtn.style.display = 'none';
    currentTransaksiId = null;
}

function buildFormTransaksiHtml(editData = null) {
    const title = currentTransaksiId ? 'Edit Transaksi' : 'Tambah Transaksi Baru';
    // Pilihan santri diambil dari database secara dinamis melalui event listener terpisah
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
    // set dropdown santri
    const santriSelect = document.getElementById('namaSantriSelect');
    if (santriSelect && data.santriId) {
        santriSelect.value = data.santriId;
    }
}

// ========== DETAIL KEUANGAN PER SANTRI ==========
async function showSantriKeuangan(santriId) {
    const santriDoc = await getDoc(doc(db, "santri", santriId));
    if (!santriDoc.exists()) {
        await window.customAlert("Santri tidak ditemukan");
        return;
    }
    const santri = santriDoc.data();
    
    // Ambil semua transaksi santri ini, urutkan ascending untuk hitung saldo
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
        transaksiDenganSaldo.push({
            id: docSnap.id,
            ...trans,
            saldoHitung: runningSaldo
        });
    });
    const saldoAkhir = runningSaldo;
    // Urutkan descending untuk tampilan
    const transaksiTerbaru = [...transaksiDenganSaldo].reverse();
    
    const detailHtml = `
        <div id="santri-keuangan-detail">
            <button id="backToKeuangan" class="btn-secondary" style="margin-bottom:1.5rem">
                <i class="fas fa-arrow-left"></i> Kembali ke Semua Transaksi
            </button>
            <div class="santri-profile-card">
                <div class="santri-avatar">
                    <i class="fas fa-user-graduate"></i>
                </div>
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
                        <thead>
                            <tr><th>Tanggal</th><th>Jenis</th><th>Jumlah</th><th>Keterangan</th><th>Admin</th></tr>
                        </thead>
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
