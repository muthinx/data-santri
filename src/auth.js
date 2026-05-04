import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function initAuth(showApp, showLogin) {
    console.log("=== initAuth dipanggil ===");

    onAuthStateChanged(auth, async (user) => {
        console.log("onAuthStateChanged triggered, user:", user);
        
        if (user) {
            console.log("✅ User login detected, UID:", user.uid);
            let displayName = user.email; // fallback
            console.log("📧 Fallback displayName (email):", displayName);
            
            try {
                console.log(`🔍 Mencoba mengambil dokumen Firestore: users/${user.uid}`);
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);
                
                console.log("📄 Apakah dokumen exist?", userDocSnap.exists());
                
                if (userDocSnap.exists()) {
                    const userData = userDocSnap.data();
                    console.log("📦 Data dari Firestore:", userData);
                    
                    if (userData.nama && userData.nama.trim() !== "") {
                        displayName = userData.nama;
                        console.log("✅ Nama ditemukan di Firestore:", displayName);
                    } else {
                        console.warn("⚠️ Field 'nama' kosong atau tidak ada di dokumen");
                    }
                } else {
                    console.warn(`⚠️ Dokumen users/${user.uid} tidak ditemukan di Firestore`);
                }
            } catch (error) {
                console.error("❌ Gagal mengambil data pengguna:", error);
            }
            
            // Tampilkan nama di header
            const userNameSpan = document.getElementById('user-name-display');
            console.log("🔎 Elemen #user-name-display ditemukan?", userNameSpan);
            
            if (userNameSpan) {
                userNameSpan.innerText = displayName;
                window.currentAdminName = displayName;
                console.log("✅ Nama berhasil di-set ke elemen:", displayName);
            } else {
                console.error("❌ Elemen dengan id 'user-name-display' TIDAK ditemukan di DOM");
            }
            
            console.log("📱 Memanggil showApp()");
            showApp();
        } else {
            console.log("🚫 User tidak login, memanggil showLogin()");
            showLogin();
        }
    });

    // LOGIN
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            if (!email || !password) {
                alert("Email dan password harus diisi");
                return;
            }
            
            console.log("🔐 Mencoba login dengan email:", email);
            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                console.log("✅ Login berhasil, user:", userCredential.user);
                alert("Login berhasil!");
            } catch (error) {
                console.error("❌ Login gagal:", error);
                alert("Login gagal: " + error.message);
            }
        });
    } else {
        console.error("❌ Tombol login dengan id 'login-btn' tidak ditemukan");
    }

    // LOGOUT
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            console.log("🚪 Logout dipanggil");
            try {
                await signOut(auth);
                console.log("✅ Logout berhasil");
                alert("Logout berhasil");
            } catch (error) {
                console.error("❌ Logout gagal:", error);
                alert("Logout gagal: " + error.message);
            }
        });
    } else {
        console.error("❌ Tombol logout dengan id 'logout-btn' tidak ditemukan");
    }
}