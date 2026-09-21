// obrolan.js — versi bersih
// Chat realtime pakai Firebase Realtime Database.
// Listener dibersihkan via cleanupObrolan() saat pindah halaman / logout.

import { dbRTDB, auth } from '../firebase.js';
import {
  ref, push, onChildAdded, onChildRemoved, remove,
  serverTimestamp, query, limitToLast, orderByChild
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ============================================================
//  STATE MODUL
// ============================================================
let messagesRef = null;
let unsubscribeAdded = null;
let unsubscribeRemoved = null;
let currentUserId = null;

// ============================================================
//  ENTRY POINT
// ============================================================
export function loadObrolan(container) {
  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = '<div class="alert alert-warning">Silakan login untuk mengakses obrolan.</div>';
    return;
  }

  currentUserId = user.uid;

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

  // Bersihkan listener lama kalau ada (mis. user buka obrolan 2x)
  cleanupObrolan();

  messagesRef = ref(dbRTDB, 'chat/messages');

  const sendBtn = document.getElementById('send-button');
  const chatInput = document.getElementById('chat-input');
  const messagesContainer = document.getElementById('chat-messages');
  const clearBtn = document.getElementById('clear-all-btn');

  // ===== KIRIM PESAN =====
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    const displayName = getDisplayName();
    try {
      await push(messagesRef, {
        text,
        uid: currentUserId,
        displayName,
        timestamp: serverTimestamp()
      });
      chatInput.value = '';
      chatInput.focus();   // fix: dulu salah, fokus ke div messages
    } catch (err) {
      console.error(err);
      await window.customAlert('Gagal mengirim pesan: ' + err.message);
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // ===== BERSIHKAN SEMUA PESAN =====
  clearBtn.addEventListener('click', async () => {
    if (await window.customConfirm('Yakin ingin menghapus SEMUA pesan? Tindakan ini tidak dapat dibatalkan.')) {
      try {
        await remove(messagesRef);
        if (messagesContainer) {
          messagesContainer.innerHTML = '<div class="empty-chat">Semua pesan telah dihapus. Mulai obrolan baru...</div>';
        }
      } catch (err) {
        await window.customAlert('Gagal menghapus: ' + err.message);
      }
    }
  });

  // ===== LISTENER: pesan baru + pesan dihapus =====
  const messagesQuery = query(
    messagesRef,
    orderByChild('timestamp'),
    limitToLast(50)
  );

  // Pesan baru: onChildAdded dipanggil untuk 50 pesan awal + setiap pesan baru.
  unsubscribeAdded = onChildAdded(messagesQuery, (snapshot) => {
    displayMessage(snapshot.val(), snapshot.key);
  });

  // Pesan dihapus: memastikan kalau admin klik "Bersihkan", pesan lama
  // langsung hilang di layar semua user tanpa reload.
  unsubscribeRemoved = onChildRemoved(messagesQuery, (snapshot) => {
    removeMessageFromUI(snapshot.key);
  });
}

// ============================================================
//  CLEANUP — dipanggil app.js saat pindah halaman / logout
// ============================================================
export function cleanupObrolan() {
  if (typeof unsubscribeAdded === 'function') {
    try { unsubscribeAdded(); } catch (e) { console.warn(e); }
    unsubscribeAdded = null;
  }
  if (typeof unsubscribeRemoved === 'function') {
    try { unsubscribeRemoved(); } catch (e) { console.warn(e); }
    unsubscribeRemoved = null;
  }
  messagesRef = null;
  currentUserId = null;
}

// ============================================================
//  HELPER
// ============================================================
function getDisplayName() {
  // Prioritas: nama yang tampil di sidebar
  const nameSpan = document.getElementById('user-name-display');
  const name = nameSpan ? nameSpan.innerText.trim() : '';
  if (name) return name;

  // Fallback ke global yang diset app.js
  if (window.currentAdminName) return window.currentAdminName;

  // Fallback terakhir ke Firebase Auth
  const u = auth.currentUser;
  if (!u) return 'Anonim';
  return u.displayName || (u.email ? u.email.split('@')[0] : 'Anonim');
}

function displayMessage(msg, key) {
  const container = document.getElementById('chat-messages');
  if (!container || !msg) return;

  // Hapus empty state kalau ada
  const emptyEl = container.querySelector('.empty-chat');
  if (emptyEl) emptyEl.remove();

  const msgDiv = document.createElement('div');
  msgDiv.classList.add('chat-message');
  msgDiv.dataset.key = key || '';
  if (msg.uid === currentUserId) msgDiv.classList.add('my-message');

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString('id-ID')
    : 'baru saja';

  msgDiv.innerHTML = `
    <div class="message-sender">${escapeHtml(msg.displayName || 'Anonim')}</div>
    <div class="message-text">${escapeHtml(msg.text || '')}</div>
    <div class="message-time">${escapeHtml(time)}</div>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function removeMessageFromUI(key) {
  const container = document.getElementById('chat-messages');
  if (!container || !key) return;

  const msgDiv = container.querySelector(`.chat-message[data-key="${cssEscape(key)}"]`);
  if (msgDiv) msgDiv.remove();

  // Kalau sudah tidak ada pesan, tampilkan empty state
  if (!container.querySelector('.chat-message')) {
    container.innerHTML = '<div class="empty-chat">Belum ada pesan.</div>';
  }
}

// Escape untuk selector CSS attribute
function cssEscape(str) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(str);
  }
  return String(str).replace(/["\\]/g, '\\$&');
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
