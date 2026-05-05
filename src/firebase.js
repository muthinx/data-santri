import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🔄 GANTI DENGAN KONFIGURASI FIREBASE ANDA
const firebaseConfig = {
    apiKey: "AIzaSyCu-HXX-rNiAYZmaQH80mjSiLVn_W8GJTw",
    authDomain: "data-santri-a731a.firebaseapp.com",
    projectId: "data-santri-a731a",
    storageBucket: "data-santri-a731a.firebasestorage.app",
    messagingSenderId: "62427084530",
    appId: "1:62427084530:web:7ddcc7cd97a1a5dff1826b",
    databaseURL: "https://data-santri-a731a-default-rtdb.asia-southeast1.firebasedatabase.app/",
    measurementId: "G-BH47KWY2Z9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const dbRTDB = getDatabase(app);
