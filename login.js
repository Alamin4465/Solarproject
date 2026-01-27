// login.js - FINAL & STABLE VERSION

document.addEventListener("DOMContentLoaded", () => {
    console.log("📄 Login page loaded");

    // Initialize Firebase
    if (!initializeFirebase()) {
        showNotification("Firebase লোড করতে সমস্যা", "error");
        return;
    }

    setupFormHandlers();
});

// ================= FORM HANDLERS =================
function setupFormHandlers() {

    // ===== LOGIN FORM (submit only) =====
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", e => {
            e.preventDefault();

            const email = document.getElementById("loginEmail").value.trim();
            const password = document.getElementById("loginPassword").value;

            handleLogin(email, password);
        });
    }

    // ===== REGISTER =====
    const registerBtn = document.querySelector(".register-btn");
    if (registerBtn) {
        registerBtn.addEventListener("click", e => {
            e.preventDefault();

            const email = document.getElementById("registerEmail").value.trim();
            const password = document.getElementById("registerPassword").value;
            const confirmPassword = document.getElementById("confirmPassword").value;
            const fullName = document.getElementById("fullName").value.trim();
            const terms = document.getElementById("acceptTerms");

            if (!terms || !terms.checked) {
                showNotification("সেবা শর্তাবলী গ্রহণ করুন", "error");
                return;
            }

            handleRegister(email, password, confirmPassword, fullName);
        });
    }

    // ===== PASSWORD RESET =====
    const resetBtn = document.querySelector(".reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", e => {
            e.preventDefault();
            const email = document.getElementById("resetEmail").value.trim();
            handlePasswordReset(email);
        });
    }

    // ===== GOOGLE LOGIN =====
    const googleBtn = document.querySelector(".google-login-btn");
    if (googleBtn) {
        googleBtn.addEventListener("click", e => {
            e.preventDefault();
            handleGoogleLogin();
        });
    }

    // ===== TOGGLE SCREENS =====
    document.querySelectorAll(".show-register").forEach(btn =>
        btn.onclick = e => {
            e.preventDefault();
            showRegister();
        }
    );

    document.querySelectorAll(".show-login").forEach(btn =>
        btn.onclick = e => {
            e.preventDefault();
            showLogin();
        }
    );

    document.querySelectorAll(".forgot-password").forEach(btn =>
        btn.onclick = e => {
            e.preventDefault();
            showForgotPassword();
        }
    );
}

// ================= LOGIN =================
function handleLogin(email, password) {
    if (!email || !password) {
        showNotification("ইমেইল এবং পাসওয়ার্ড দিন", "error");
        return;
    }

    showNotification("লগইন করা হচ্ছে...", "info");

    login(email, password)
        .then(res => {
            localStorage.setItem("solar_user_logged_in", "true");
            localStorage.setItem("solar_user_email", res.user.email);
            localStorage.setItem("solar_user_uid", res.user.uid);

            showNotification("লগইন সফল!", "success");
            setTimeout(() => {
                window.location.href = "Solar.html";
            }, 700);
        })
        .catch(err => {
            showNotification(getAuthErrorMessage(err), "error");
        });
}

// ================= REGISTER =================
function handleRegister(email, password, confirmPassword, fullName) {
    if (!email || !password) {
        showNotification("ইমেইল এবং পাসওয়ার্ড দিন", "error");
        return;
    }

    if (password.length < 6) {
        showNotification("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে", "error");
        return;
    }

    if (password !== confirmPassword) {
        showNotification("পাসওয়ার্ড মিলছে না", "error");
        return;
    }

    showNotification("অ্যাকাউন্ট তৈরি করা হচ্ছে...", "info");

    register(email, password, fullName)
        .then(res => {
            localStorage.setItem("solar_user_logged_in", "true");
            localStorage.setItem("solar_user_email", res.user.email);
            localStorage.setItem("solar_user_uid", res.user.uid);

            showNotification("অ্যাকাউন্ট তৈরি সফল!", "success");
            setTimeout(() => {
                window.location.href = "Solar.html";
            }, 700);
        })
        .catch(err => {
            showNotification(getAuthErrorMessage(err), "error");
        });
}

// ================= PASSWORD RESET =================
function handlePasswordReset(email) {
    if (!email) {
        showNotification("ইমেইল দিন", "error");
        return;
    }

    showNotification("রিসেট লিংক পাঠানো হচ্ছে...", "info");

    resetPassword(email)
        .then(() => {
            showNotification("রিসেট লিংক ইমেইলে পাঠানো হয়েছে", "success");
            showLogin();
        })
        .catch(err => {
            showNotification(getAuthErrorMessage(err), "error");
        });
}

// ================= GOOGLE LOGIN =================
function handleGoogleLogin() {
    showNotification("Google লগইন শুরু হচ্ছে...", "info");

    loginWithGoogle()
        .then(user => {
            localStorage.setItem("solar_user_logged_in", "true");
            localStorage.setItem("solar_user_email", user.email);
            localStorage.setItem("solar_user_uid", user.uid);

            showNotification("Google লগইন সফল!", "success");
            setTimeout(() => {
                window.location.href = "Solar.html";
            }, 700);
        })
        .catch(err => {
            showNotification(getAuthErrorMessage(err), "error");
        });
}

// ================= UI TOGGLES =================
function showLogin() {
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("registerBox").style.display = "none";
    document.getElementById("forgotPasswordBox").style.display = "none";
}

function showRegister() {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("registerBox").style.display = "block";
    document.getElementById("forgotPasswordBox").style.display = "none";
}

function showForgotPassword() {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("registerBox").style.display = "none";
    document.getElementById("forgotPasswordBox").style.display = "block";
}

// ================= PASSWORD TOGGLE =================
function togglePassword(id) {
    const input = document.getElementById(id);
    input.type = input.type === "password" ? "text" : "password";
}

// ================= EXPORT =================
window.showLogin = showLogin;
window.showRegister = showRegister;
window.showForgotPassword = showForgotPassword;
window.togglePassword = togglePassword;