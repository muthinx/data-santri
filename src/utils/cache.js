// src/utils/cache.js
// Modul cache localStorage dengan versioning.
// Setiap entri: { version, data, cachedAt }

import { db } from '../firebase.js';
import {
  doc, getDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const PREFIX = 'app_cache_';

// ============================================================
//  READ / WRITE CACHE
// ============================================================
export function getCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Cache read gagal:', e);
    return null;
  }
}

export function setCache(key, version, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({
      version,
      data,
      cachedAt: Date.now()
    }));
  } catch (e) {
    // localStorage penuh / disabled
    console.warn('Cache write gagal:', e);
  }
}

export function clearCache(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (e) {}
}

export function clearAllCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
}

// ============================================================
//  META VERSION HELPER
// ============================================================
// Baca versi server dari meta/{metaName}
// Return: number (versi) atau null (gagal baca)
export async function getServerVersion(metaName) {
  try {
    const snap = await getDoc(doc(db, "meta", metaName));
    return snap.exists() ? (snap.data().version || 0) : 0;
  } catch (e) {
    console.warn('Gagal baca versi meta:', metaName, e);
    return null;
  }
}

// Ref ke meta document
export function getMetaRef(metaName) {
  return doc(db, "meta", metaName);
}

// Payload untuk increment versi (dipakai di writeBatch)
export function versionIncrementPayload() {
  return {
    version: increment(1),
    updatedAt: serverTimestamp()
  };
}

// ============================================================
//  HELPER: GET SANTRI DATA (cache-first)
// ============================================================
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function getSantriData() {
  const serverVersion = await getServerVersion('santri_version');
  const cached = getCache('santri');

  if (cached && serverVersion !== null && cached.version === serverVersion) {
    return cached.data;
  }

  const snap = await getDocs(collection(db, "santri"));
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (serverVersion !== null) {
    setCache('santri', serverVersion, data);
  }

  return data;
}

// ============================================================
//  HELPER: GET SALDO SEMUA (cache-first)
// ============================================================

export async function getSaldoSemua() {
  // 1. Ambil dari cache dulu (instant)
  const cached = getCache('saldo_semua');

  // 2. Background: baca meta dari server
  try {
    const metaSnap = await getDoc(doc(db, "meta", "saldo_semua"));
    if (metaSnap.exists()) {
      const metaData = metaSnap.data();
      const serverVersion = metaData.version || 0;
      const data = metaData.data || {};
      setCache('saldo_semua', serverVersion, data);
      return data;
    }
  } catch (e) {
    console.warn('Gagal baca meta/saldo_semua:', e);
  }

  // Fallback ke cache kalau server error
  return cached ? cached.data : {};
}