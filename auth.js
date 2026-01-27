// auth.js - Firebase initialization সংশোধন করুন

// ================= FIREBASE INITIALIZATION =================
function initializeFirebase() {
    try {
        console.log("🔥 Firebase initializing...");
        
        // Check if firebase is loaded
        if (typeof firebase === 'undefined' || typeof firebase.initializeApp === 'undefined') {
            console.error("❌ Firebase SDK not loaded properly");
            // Try to load Firebase dynamically
            setTimeout(initializeFirebase, 500);
            return false;
        }
        
        // Check if config exists
        if (typeof firebaseConfig === 'undefined') {
            console.error("❌ Firebase config not found");
            // Try to load config
            if (window.firebaseConfig) {
                firebaseConfig = window.firebaseConfig;
            } else {
                return false;
            }
        }
        
        // Initialize Firebase only once
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
                console.log("✅ Firebase initialized successfully");
            } else {
                console.log("ℹ️ Firebase already initialized");
            }
            return true;
        } catch (initError) {
            console.error("❌ Firebase initialization error:", initError);
            return false;
        }
        
    } catch (error) {
        console.error("❌ Firebase initialization error:", error);
        return false;
    }
}