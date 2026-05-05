// src/utils/dialog.js
// Custom Alert & Confirm dengan tema aplikasi

// Modal container (dibuat sekali)
let modalOverlay = null;

function createModal() {
    if (modalOverlay) return modalOverlay;
    modalOverlay = document.createElement('div');
    modalOverlay.className = 'custom-dialog-overlay';
    modalOverlay.innerHTML = `
        <div class="custom-dialog">
            <div class="custom-dialog-header">
                <i class="fas fa-info-circle"></i>
                <span id="dialog-title">Peringatan</span>
            </div>
            <div class="custom-dialog-body" id="dialog-message"></div>
            <div class="custom-dialog-footer">
                <button id="dialog-ok-btn" class="btn-primary">OK</button>
                <button id="dialog-cancel-btn" class="btn-secondary" style="display:none;">Batal</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalOverlay);
    return modalOverlay;
}

function showDialog({ title, message, showCancel = false }) {
    return new Promise((resolve) => {
        const modal = createModal();
        const titleSpan = modal.querySelector('#dialog-title');
        const msgDiv = modal.querySelector('#dialog-message');
        const okBtn = modal.querySelector('#dialog-ok-btn');
        const cancelBtn = modal.querySelector('#dialog-cancel-btn');

        titleSpan.textContent = title || (showCancel ? 'Konfirmasi' : 'Peringatan');
        msgDiv.innerHTML = message;
        if (showCancel) {
            cancelBtn.style.display = 'inline-flex';
        } else {
            cancelBtn.style.display = 'none';
        }
        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        const onOk = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

window.customAlert = (message, title = 'Peringatan') => {
    return showDialog({ title, message, showCancel: false });
};

window.customConfirm = (message, title = 'Konfirmasi') => {
    return showDialog({ title, message, showCancel: true });
};

// Optional: replace native alert/confirm (berbahaya, lebih baik ganti manual)
// window.alert = window.customAlert;
// window.confirm = window.customConfirm;