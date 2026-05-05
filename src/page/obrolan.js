import { dbRTDB, auth } from '../firebase.js';
import { ref, push, onChildAdded, remove, serverTimestamp, query, limitToLast, orderByChild } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

let messagesRef = null;
let unsubscribe = null;

export function loadObrolan(container) {
    const user = auth.currentUser;
    if (!user) {
        container.innerHTML = '<div class="alert alert-warning">Silakan login untuk mengakses obrolan.</div>';
        return;
    }

    container.innerHTML = `
        <div class="chat-container">
            <div class="chat-header">
                <h2><i class="fas fa-comments"></i>Chat</h2>
                <button id="clear-all-btn" class="btn-danger" style="padding: 0.3rem 0.8rem; font-size: 0.8rem;">
                    <i class="fas fa-trash-alt"></i> Bersihkan
                </button>
            </div>
            <div id="chat-messages" class="chat-messages">
                <div class="empty-chat">Memuat pesan...</div>
            </div>
            <div class="chat-input-area">
                <input type="text" id="chat-input" placeholder="Tulis pesan..." autocomplete="off" maxlength="500">
                <button id="send-button" class="btn-primary"><i class="fas fa-paper-plane"></i></button>
            </div>
            <div class="chat-info">
                <small><i class="fas fa-info-circle"></i> Pesan tersimpan secara permanen | Hanya 50 pesan terakhir ditampilkan</small>
            </div>
        </div>
    `;

    messagesRef = ref(dbRTDB, 'chat/messages');
    const sendBtn = document.getElementById('send-button');
    const chatInput = document.getElementById('chat-input');
    const messagesContainer = document.getElementById('chat-messages');

    // Fungsi untuk mendapatkan nama dari sidebar (user-name-display)
    const getDisplayName = () => {
        const nameSpan = document.getElementById('user-name-display');
        let name = nameSpan ? nameSpan.innerText.trim() : '';
        if (name) return name;
        // Fallback jika belum ada
        if (window.currentAdminName) return window.currentAdminName;
        return user.displayName || user.email.split('@')[0];
    };

    const sendMessage = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        const displayName = getDisplayName();
        
        try {
            await push(messagesRef, {
                text: text,
                uid: user.uid,
                displayName: displayName,
                timestamp: serverTimestamp()
            });
            chatInput.value = '';
            messagesContainer.focus();
        } catch (err) {
            console.error(err);
            await window.customAlert('Gagal mengirim pesan: ' + err.message);
        }
    };

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Hapus semua pesan
    const clearBtn = document.getElementById('clear-all-btn');
    clearBtn.addEventListener('click', async () => {
        if (await window.customConfirm('Yakin ingin menghapus SEMUA pesan? Tindakan ini tidak dapat dibatalkan.')) {
            try {
                await remove(messagesRef);
                if (messagesContainer) messagesContainer.innerHTML = '<div class="empty-chat">Semua pesan telah dihapus. Mulai obrolan baru...</div>';
            } catch (err) {
                await window.customAlert('Gagal menghapus: ' + err.message);
            }
        }
    });

    // Ambil 50 pesan terakhir dan dengarkan pesan baru
    const messagesQuery = query(messagesRef, orderByChild('timestamp'), limitToLast(50));
    unsubscribe = onChildAdded(messagesQuery, (snapshot) => {
        const msg = snapshot.val();
        displayMessage(msg);
    });

    function displayMessage(msg) {
        if (!messagesContainer) return;
        if (messagesContainer.querySelector('.empty-chat')) {
            messagesContainer.innerHTML = '';
        }
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('chat-message');
        if (msg.uid === user.uid) msgDiv.classList.add('my-message');
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('id-ID') : 'baru saja';
        msgDiv.innerHTML = `
            <div class="message-sender">${escapeHtml(msg.displayName)}</div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-time">${time}</div>
        `;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
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