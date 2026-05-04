import { db } from '../firebase.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentEditId = null;
let unsubscribe = null;

export function loadSantri(container) {
    renderSantriPage(container);
    listenSantri();
}

function renderSantriPage(container) {
    container.innerHTML = `
        <div id="santri-header-actions">
            <div class="header-left-buttons">
                <button id="btnTambahSantriBaru" class="btn-primary"><i class="fas fa-plus"></i> Tambah Santri</button>
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
    document.getElementById('btnExportCSV').onclick = () => exportToCSV();
    const importBtn = document.getElementById('btnImportCSV');
    const fileInput = document.getElementById('fileImportCSV');
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) importFromCSV(e.target.files[0]);
        fileInput.value = ''; // reset
    };
}

// Menampilkan form (tambah atau edit) - menggantikan tabel
function showForm(editData = null) {
    const formContainer = document.getElementById('santri-form-container');
    const tableContainer = document.getElementById('santri-table-container');
    const headerActions = document.getElementById('santri-header-actions');
    
    // Sembunyikan header actions (tombol tambah)
    if (headerActions) headerActions.style.display = 'none';
    
    // Cek apakah tombol kembali sudah ada, jika belum buat
    let backBtn = document.getElementById('btnBackFromForm');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'btnBackFromForm';
        backBtn.className = 'btn-secondary';
        backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Kembali';
        backBtn.style.marginBottom = '1rem';
        // Sisipkan sebelum form container
        formContainer.parentNode.insertBefore(backBtn, formContainer);
    }
    backBtn.style.display = 'inline-flex';
    backBtn.onclick = () => hideForm();
    
    // Atur currentEditId
    if (editData) {
        currentEditId = editData.id;
    } else {
        currentEditId = null;
    }
    
    // Tampilkan form container dan isi HTML form
    formContainer.style.display = 'block';
    tableContainer.style.display = 'none';
    formContainer.innerHTML = buildFormHtml(editData);
    
    // Jika mode edit, tambahkan tombol hapus (seperti kode Anda sebelumnya)
    if (currentEditId) {
        const formButtons = document.querySelector('.form-buttons');
        // Hapus tombol hapus lama jika ada
        const oldDelete = formButtons.querySelector('.btn-danger');
        if (oldDelete) oldDelete.remove();
        
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Hapus';
        deleteBtn.className = 'btn-danger';
        deleteBtn.onclick = async () => {
            if (confirm('Yakin hapus data santri ini?')) {
                try {
                    await deleteDoc(doc(db, "santri", currentEditId));
                    alert('Data berhasil dihapus');
                    hideForm();
                } catch (err) {
                    alert('Gagal hapus: ' + err.message);
                }
            }
        };
        formButtons.appendChild(deleteBtn);
    }
    
    // Pasang event handler
    document.getElementById('santriForm').onsubmit = (e) => { e.preventDefault(); saveSantri(); };
    document.getElementById('btnBatalForm').onclick = () => hideForm();
    
    // Isi data jika edit
    if (editData) {
        fillFormData(editData);
    }
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

function buildFormHtml(editData = null) {
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
                    <div class="form-group"><label>Jenis Kelamin</label><select id="jk"><option>Laki-laki</option><option>Perempuan</option></select></div>
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
                    <div class="form-group"><label>Wali Santri</label><select id="waliSantri"><option>Orang Tua Kandung</option><option>Asuh</option></select></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Nomor KK</label><input id="noKK"></div>
                    <div class="form-group"><label>Nama Kepala Keluarga</label><input id="namaKK"></div>
                </div>

                <h4>Data Ayah Kandung</h4>
                <div class="form-row">
                    <div class="form-group"><label>Nama Ayah</label><input id="ayahNama"></div>
                    <div class="form-group"><label>Status</label><select id="ayahStatus"><option>Masih Hidup</option><option>Meninggal</option></select></div>
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
                    <div class="form-group"><label>Status</label><select id="ibuStatus"><option>Masih Hidup</option><option>Meninggal</option></select></div>
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
                    <div class="form-group"><label>Asrama</label><input id="asrama"></div>
                    <div class="form-group"><label>Kelas Diniyah</label><input id="kelasDiniyah"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Kelas Formal</label><input id="kelasFormal"></div>
                    <div class="form-group"><label>Kelompok Belajar</label><input id="kelompokBelajar"></div>
                </div>
                <div class="form-group"><label>Kelompok Ngaji</label><input id="kelompokNgaji"></div>

                <div class="form-buttons">
                    <button type="submit" class="btn-primary">Simpan</button>
                    <button type="button" id="btnBatalForm" class="btn-secondary">Batal</button>
                </div>
            </form>
        </div>
    `;
}

function fillFormData(data) {
    document.getElementById('nama').value = data.nama || '';
    document.getElementById('nisn').value = data.nisn || '';
    document.getElementById('nik').value = data.nik || '';
    document.getElementById('tmpLahir').value = data.tempatLahir || '';
    document.getElementById('tglLahir').value = data.tanggalLahir || '';
    document.getElementById('jk').value = data.jenisKelamin || 'Laki-laki';
    document.getElementById('jmlSaudara').value = data.jumlahSaudara || 0;
    document.getElementById('anakKe').value = data.anakKe || 0;
    document.getElementById('citacita').value = data.citacita || '';
    document.getElementById('hobi').value = data.hobi || '';
    document.getElementById('pendFormal').value = data.pendidikanFormal || '';
    document.getElementById('waliSantri').value = data.waliSantri || 'Orang Tua Kandung';
    document.getElementById('noKK').value = data.nomorKK || '';
    document.getElementById('namaKK').value = data.namaKepalaKeluarga || '';
    if (data.ayah) {
        document.getElementById('ayahNama').value = data.ayah.nama || '';
        document.getElementById('ayahStatus').value = data.ayah.status || 'Masih Hidup';
        document.getElementById('ayahNik').value = data.ayah.nik || '';
        document.getElementById('ayahTmpLahir').value = data.ayah.tempatLahir || '';
        document.getElementById('ayahTglLahir').value = data.ayah.tanggalLahir || '';
        document.getElementById('ayahPekerjaan').value = data.ayah.pekerjaan || '';
        document.getElementById('ayahWa').value = data.ayah.wa || '';
    }
    if (data.ibu) {
        document.getElementById('ibuNama').value = data.ibu.nama || '';
        document.getElementById('ibuStatus').value = data.ibu.status || 'Masih Hidup';
        document.getElementById('ibuNik').value = data.ibu.nik || '';
        document.getElementById('ibuTmpLahir').value = data.ibu.tempatLahir || '';
        document.getElementById('ibuTglLahir').value = data.ibu.tanggalLahir || '';
        document.getElementById('ibuPekerjaan').value = data.ibu.pekerjaan || '';
        document.getElementById('ibuWa').value = data.ibu.wa || '';
    }
    if (data.alamat) {
        document.getElementById('provinsi').value = data.alamat.provinsi || '';
        document.getElementById('kabupaten').value = data.alamat.kabupaten || '';
        document.getElementById('kecamatan').value = data.alamat.kecamatan || '';
        document.getElementById('desa').value = data.alamat.desa || '';
        document.getElementById('jalan').value = data.alamat.jalan || '';
    }
    if (data.kepesantrenan) {
        document.getElementById('asrama').value = data.kepesantrenan.asrama || '';
        document.getElementById('kelasDiniyah').value = data.kepesantrenan.kelasDiniyah || '';
        document.getElementById('kelasFormal').value = data.kepesantrenan.kelasFormal || '';
        document.getElementById('kelompokBelajar').value = data.kepesantrenan.kelompokBelajar || '';
        document.getElementById('kelompokNgaji').value = data.kepesantrenan.kelompokNgaji || '';
    }
}

async function saveSantri() {
    const data = {
        nama: document.getElementById('nama').value,
        nisn: document.getElementById('nisn').value,
        nik: document.getElementById('nik').value,
        tempatLahir: document.getElementById('tmpLahir').value,
        tanggalLahir: document.getElementById('tglLahir').value,
        jenisKelamin: document.getElementById('jk').value,
        jumlahSaudara: parseInt(document.getElementById('jmlSaudara').value) || 0,
        anakKe: parseInt(document.getElementById('anakKe').value) || 0,
        citacita: document.getElementById('citacita').value,
        hobi: document.getElementById('hobi').value,
        pendidikanFormal: document.getElementById('pendFormal').value,
        waliSantri: document.getElementById('waliSantri').value,
        nomorKK: document.getElementById('noKK').value,
        namaKepalaKeluarga: document.getElementById('namaKK').value,
        ayah: {
            nama: document.getElementById('ayahNama').value,
            status: document.getElementById('ayahStatus').value,
            nik: document.getElementById('ayahNik').value,
            tempatLahir: document.getElementById('ayahTmpLahir').value,
            tanggalLahir: document.getElementById('ayahTglLahir').value,
            pekerjaan: document.getElementById('ayahPekerjaan').value,
            wa: document.getElementById('ayahWa').value
        },
        ibu: {
            nama: document.getElementById('ibuNama').value,
            status: document.getElementById('ibuStatus').value,
            nik: document.getElementById('ibuNik').value,
            tempatLahir: document.getElementById('ibuTmpLahir').value,
            tanggalLahir: document.getElementById('ibuTglLahir').value,
            pekerjaan: document.getElementById('ibuPekerjaan').value,
            wa: document.getElementById('ibuWa').value
        },
        alamat: {
            provinsi: document.getElementById('provinsi').value,
            kabupaten: document.getElementById('kabupaten').value,
            kecamatan: document.getElementById('kecamatan').value,
            desa: document.getElementById('desa').value,
            jalan: document.getElementById('jalan').value
        },
        kepesantrenan: {
            asrama: document.getElementById('asrama').value,
            kelasDiniyah: document.getElementById('kelasDiniyah').value,
            kelasFormal: document.getElementById('kelasFormal').value,
            kelompokBelajar: document.getElementById('kelompokBelajar').value,
            kelompokNgaji: document.getElementById('kelompokNgaji').value
        }
    };
    if (!data.nama) return alert("Nama santri wajib diisi");

    try {
        if (currentEditId) {
            await updateDoc(doc(db, "santri", currentEditId), data);
            alert("Data santri berhasil diupdate");
        } else {
            await addDoc(collection(db, "santri"), data);
            alert("Santri berhasil ditambahkan");
        }
        hideForm();
    } catch (err) {
        alert("Error: " + err.message);
    }
}

function listenSantri() {
    if (unsubscribe) unsubscribe();
    unsubscribe = onSnapshot(collection(db, "santri"), (snapshot) => {
        const santriList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderSantriTable(santriList);
    });
}

function renderSantriTable(data) {
    const container = document.getElementById('santri-table-container');
    if (!container) return;
    if (data.length === 0) {
        container.innerHTML = "<p>Belum ada data santri.</p>";
        container.style.display = 'block';
        return;
    }

    const isMobile = window.innerWidth <= 768;
    let html = '<div class="table-container"><table class="santri-table">';
    if (isMobile) {
        html += `<thead><tr><th>Nama</th><th>Aksi</th></tr></thead><tbody>`;
        data.forEach(s => {
            html += `<tr>
                        <td>${escapeHtml(s.nama)}</td>
                        <td class="action-cell">
                            <button class="edit-santri-btn" data-id="${s.id}">Edit</button>
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
        data.forEach(s => {
            html += `<tr>
                        <td>${escapeHtml(s.nama)}</td>
                        <td>${escapeHtml(s.nisn)}</td>
                        <td>${escapeHtml(s.kepesantrenan?.kelasDiniyah || '-')}</td>
                        <td>${escapeHtml(s.kepesantrenan?.kelasFormal || '-')}</td>
                        <td>${escapeHtml(s.kepesantrenan?.asrama || '-')}</td>
                        <td class="action-cell">
                            <button class="edit-santri-btn" data-id="${s.id}">Edit</button>
                        </td>
                     </tr>`;
        });
    }
    html += `</tbody></table></div>`;
    container.innerHTML = html;
    container.style.display = 'block';

    // Event listener untuk dropdown
    document.querySelectorAll('.edit-santri-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const id = btn.dataset.id;
            const docSnap = await getDoc(doc(db, "santri", id));
            if (docSnap.exists()) showForm({ id, ...docSnap.data() });
        });
    });
}

// ========== EKSPOR CSV ==========
async function exportToCSV() {
    const snapshot = await getDocs(collection(db, "santri"));
    const santriList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (santriList.length === 0) {
        alert("Tidak ada data santri untuk diekspor.");
        return;
    }
    const columns = [
        "nama", "nisn", "nik", "tempatLahir", "tanggalLahir", "jenisKelamin",
        "jumlahSaudara", "anakKe", "citacita", "hobi", "pendidikanFormal", "waliSantri",
        "nomorKK", "namaKepalaKeluarga",
        "ayah.nama", "ayah.status", "ayah.nik", "ayah.tempatLahir", "ayah.tanggalLahir", "ayah.pekerjaan", "ayah.wa",
        "ibu.nama", "ibu.status", "ibu.nik", "ibu.tempatLahir", "ibu.tanggalLahir", "ibu.pekerjaan", "ibu.wa",
        "alamat.provinsi", "alamat.kabupaten", "alamat.kecamatan", "alamat.desa", "alamat.jalan",
        "kepesantrenan.asrama", "kepesantrenan.kelasDiniyah", "kepesantrenan.kelasFormal", "kepesantrenan.kelompokBelajar", "kepesantrenan.kelompokNgaji"
    ];
    const rows = [columns];
    for (const s of santriList) {
        const row = columns.map(col => {
            const parts = col.split('.');
            let value = s;
            for (const part of parts) {
                value = value?.[part];
                if (value === undefined) break;
            }
            if (value === undefined || value === null) return '';
            let str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        rows.push(row);
    }
    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", "santri_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ========== IMPOR CSV ==========
async function importFromCSV(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        const rows = parseCSV(content);
        if (rows.length < 2) {
            alert("File CSV tidak memiliki data (minimal header + 1 baris data).");
            return;
        }
        const headers = rows[0];
        const dataRows = rows.slice(1).filter(row => row.length === headers.length && row.some(cell => cell.trim() !== ""));
        if (dataRows.length === 0) {
            alert("Tidak ada data valid untuk diimpor.");
            return;
        }
        if (!confirm(`Akan mengimpor ${dataRows.length} data santri. Lanjutkan?`)) return;
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const batchSize = 500;
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
                    obj[parts[parts.length-1]] = value;
                }
                if (!santriData.nama) {
                    errorCount++;
                    errors.push(`Baris ${i+j+2}: Nama santri wajib diisi`);
                    continue;
                }
                if (santriData.jenisKelamin && !["Laki-laki","Perempuan"].includes(santriData.jenisKelamin)) {
                    errorCount++;
                    errors.push(`Baris ${i+j+2}: Jenis kelamin harus 'Laki-laki' atau 'Perempuan'`);
                    continue;
                }
                if (santriData.waliSantri && !["Orang Tua Kandung","Asuh"].includes(santriData.waliSantri)) {
                    errorCount++;
                    errors.push(`Baris ${i+j+2}: Wali Santri harus 'Orang Tua Kandung' atau 'Asuh'`);
                    continue;
                }
                if (santriData.jumlahSaudara) santriData.jumlahSaudara = parseInt(santriData.jumlahSaudara) || 0;
                if (santriData.anakKe) santriData.anakKe = parseInt(santriData.anakKe) || 0;
                const docRef = doc(collection(db, "santri"));
                batch.set(docRef, santriData);
                successCount++;
            }
            if (chunk.length > 0) await batch.commit();
        }
        alert(`Impor selesai. Sukses: ${successCount}, Gagal: ${errorCount}${errors.length ? "\nDetail error:\n" + errors.slice(0,5).join("\n") + (errors.length>5 ? `\n... dan ${errors.length-5} lainnya` : "") : ""}`);
    };
    reader.onerror = () => alert("Gagal membaca file.");
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
            if (inQuote && text[i+1] === '"') {
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
        } else {
            currentField += ch;
        }
        i++;
    }
    if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }
    return rows.map(row => row.map(field => field.trim()));
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