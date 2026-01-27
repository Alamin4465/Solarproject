// dashboard.js - Smart Auto Power Switching with Firebase Data Only

// ==================== GLOBAL VARIABLES ====================
let database;
let auth;
let isConnected = false;
let esp32Connected = false;
let esp32LastDataTime = 0;
const ESP32_TIMEOUT = 30000;
let lastCommandTime = 0;

// Auto mode variables
let autoPowerInterval = null;
let autoCheckInterval = null;
let powerMode = 'manual'; // Start with manual
let activePowerSource = 'grid';
let lastPowerSource = 'grid';
let currentBrushMode = 'auto';
let isSwitchingInProgress = false;
let lastSwitchTime = 0;
const MIN_SWITCH_INTERVAL = 15000; // 15 seconds minimum between switches

// System status
let brushStatus = 'stopped';
let pumpStatus = 'off';

// Current sensor values - Updated ONLY from Firebase
let currentSolarVoltage = 0;
let currentBatteryVoltage = 0;
let currentBatterySOC = 0;
let solarCurrent = 0;
let batteryCurrent = 0;
let loadCurrent = 0;
let lastValidDataTime = 0;

// User variables
let userId = null;

// Auto mode thresholds
const AUTO_THRESHOLDS = {
    SOLAR_MIN_VOLTAGE: 12.0,         // Minimum solar voltage to consider
    BATTERY_MIN_VOLTAGE: 11.5,       // Minimum battery voltage to use
    BATTERY_CRITICAL_SOC: 20,        // Switch to grid if below this
    BATTERY_LOW_SOC: 30,             // Prefer solar if battery low
    SOLAR_BATTERY_DIFF: 0.5,         // Solar must be this much higher than battery
    HYSTERESIS: 0.2,                 // Prevent rapid switching
    DATA_TIMEOUT: 60000,             // 60 seconds without data
    MIN_SOLAR_VOLTAGE_FOR_SWITCH: 13.0, // Solar voltage must be at least this to switch from grid
    GRID_TO_SOLAR_THRESHOLD: 1.0,    // Solar must be 1.0V higher than battery to switch from grid to solar
    SOLAR_TO_GRID_THRESHOLD: 10.0    // Solar must be below 10.0V to switch to grid
};

// ==================== MAIN INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 Solar Dashboard loading...");
    initializeDashboard();
});

function initializeDashboard() {
    console.log("📊 Initializing dashboard...");
    
    // Clear any existing intervals first
    stopAllIntervals();
    
    // Initialize Firebase
    let firebaseInitialized = initializeFirebaseCompat();
    
    if (!firebaseInitialized) {
        showNotification("Firebase শুরু করা যায়নি", "error");
        return;
    }
    
    // Check authentication
    checkAuthCompat().then((user) => {
        console.log("✅ User authenticated:", user.email);
        
        // Set user info
        const userEmailElement = document.getElementById('userEmailDisplay');
        if (userEmailElement) {
            userEmailElement.textContent = user.email;
        }
        userId = user.uid;
        
        // Initialize database connection
        initDatabaseCompat();
        
        // Initialize control panel
        setTimeout(() => {
            initControlPanel();
            testAllButtons();
            
            // Start with manual mode
            updateModeUI('manual');
            updateActivePowerSourceButton('grid');
            
            // Update system time
            setInterval(updateSystemTime, 1000);
            updateSystemTime();
            
            // Add debug button
            addDebugButton();
            
            console.log("✅ Dashboard initialized successfully");
            console.log("📊 Waiting for Firebase data...");
            
        }, 1000);
        
    }).catch((error) => {
        console.error("❌ Authentication failed:", error);
        showNotification("লগইন প্রয়োজন", "error");
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    });
}

// ==================== FIREBASE COMPAT INITIALIZATION ====================

function initializeFirebaseCompat() {
    try {
        console.log("🔥 Initializing Firebase...");
        
        if (typeof firebase === 'undefined') {
            console.error("❌ Firebase SDK not loaded");
            showNotification("Firebase লোড হয়নি", "error");
            return false;
        }
        
        if (typeof firebaseConfig === 'undefined') {
            console.error("❌ Firebase config not loaded");
            showNotification("Firebase কনফিগারেশন নেই", "error");
            return false;
        }
        
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("✅ Firebase App Initialized");
        } else {
            console.log("✅ Firebase already initialized");
        }
        
        auth = firebase.auth();
        database = firebase.database();
        
        if (!database) {
            showNotification("ডাটাবেস লোড করতে সমস্যা", "error");
            return false;
        }
        
        console.log("✅ Firebase services initialized");
        return true;
        
    } catch (error) {
        console.error("Firebase initialization error:", error);
        showNotification("Firebase ত্রুটি: " + error.message, "error");
        return false;
    }
}

function checkAuthCompat() {
    return new Promise((resolve, reject) => {
        console.log("🔐 Checking authentication...");
        
        const isLoggedIn = localStorage.getItem('solar_user_logged_in') === 'true';
        const userEmail = localStorage.getItem('solar_user_email');
        const userUid = localStorage.getItem('solar_user_uid');
        
        if (isLoggedIn && userEmail && userUid) {
            console.log("✅ User authenticated from localStorage:", userEmail);
            const mockUser = {
                email: userEmail,
                uid: userUid
            };
            resolve(mockUser);
            return;
        }
        
        const unsubscribe = auth.onAuthStateChanged((user) => {
            unsubscribe();
            
            if (user) {
                console.log("✅ User authenticated via Firebase:", user.email);
                localStorage.setItem('solar_user_logged_in', 'true');
                localStorage.setItem('solar_user_email', user.email);
                localStorage.setItem('solar_user_uid', user.uid);
                resolve(user);
            } else {
                console.log("❌ No authenticated user found");
                reject(new Error("No authenticated user"));
            }
        });
        
        setTimeout(() => {
            unsubscribe();
            reject(new Error("Auth check timeout"));
        }, 5000);
    });
}

// ==================== DATABASE CONNECTION ====================

function initDatabaseCompat() {
    if (!database) {
        console.error("❌ Database not available");
        showNotification("ডাটাবেস লোড হয়নি", "error");
        return;
    }
    
    console.log("📡 Setting up database connection...");
    
    const connectedRef = database.ref(".info/connected");
    
    connectedRef.on("value", (snap) => {
        const wasConnected = isConnected;
        isConnected = (snap.val() === true);
        
        console.log(`📊 Firebase Connection: ${isConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
        
        if (isConnected && !wasConnected) {
            console.log("✅ Firebase Database Connected");
            showNotification("Firebase সংযোগ সফল", "success");
            updateConnectionUI(true);
            
            // Setup real-time listeners
            setupRealtimeListenersCompat();
            
            // Get initial data immediately
            fetchInitialData();
            
        } else if (!isConnected && wasConnected) {
            console.log("❌ Firebase Database Disconnected");
            showNotification("Firebase সংযোগ বিচ্ছিন্ন", "warning");
            updateConnectionUI(false);
            stopAllIntervals();
        }
    }, (error) => {
        console.error("Connection monitoring error:", error);
    });
}

function fetchInitialData() {
    if (!database || !isConnected) return;
    
    console.log("📥 Fetching initial data from Firebase...");
    
    // Fetch current data
    database.ref('solar_system/current_data').once("value")
        .then((snapshot) => {
            const data = snapshot.val();
            if (data) {
                console.log("✅ Initial data received");
                updateSensorValuesFromFirebase(data);
                updateDashboard(data);
                lastValidDataTime = Date.now();
            } else {
                console.log("⚠️ No initial data found");
            }
        })
        .catch(error => {
            console.error("❌ Initial data fetch error:", error);
        });
    
    // Fetch system status
    database.ref('solar_system/system_status').once("value")
        .then((snapshot) => {
            const status = snapshot.val();
            if (status) {
                console.log("✅ System status loaded:", status);
                
                if (status.mode) {
                    powerMode = status.mode;
                    updateModeUI(powerMode);
                    
                    if (powerMode === 'auto') {
                        startAutoPowerSwitching();
                    }
                }
                
                if (status.power_source) {
                    activePowerSource = status.power_source;
                    lastPowerSource = status.power_source;
                    updatePowerFlow(activePowerSource);
                    updateActivePowerSourceButton(activePowerSource);
                }
            }
        })
        .catch(error => {
            console.error("❌ Status fetch error:", error);
        });
}

// ==================== REALTIME LISTENERS ====================

function setupRealtimeListenersCompat() {
    if (!database) return;
    
    console.log("📡 Setting up Firebase listeners...");
    
    try {
        // Clear any existing listeners
        database.ref('solar_system/current_data').off();
        database.ref('solar_system/system_status').off();
        database.ref('solar_system/commands').off();
        
        // Current data listener
        const currentDataRef = database.ref('solar_system/current_data');
        currentDataRef.on("value", (snapshot) => {
            const data = snapshot.val();
            if (data) {
                esp32LastDataTime = Date.now();
                lastValidDataTime = Date.now();
                esp32Connected = true;
                updateESP32Status(true);
                
                // Update sensor values
                updateSensorValuesFromFirebase(data);
                
                // Update dashboard UI
                updateDashboard(data);
                
                // Check auto mode conditions
                if (powerMode === 'auto') {
                    console.log("🔄 New data - Checking auto conditions...");
                    checkAutoPowerConditions();
                }
            } else {
                console.log("⚠️ No real-time data from Firebase");
                if (esp32Connected) {
                    esp32Connected = false;
                    updateESP32Status(false);
                }
            }
        }, (error) => {
            console.error("Current data listener error:", error);
        });
        
        // System status listener
        const systemStatusRef = database.ref('solar_system/system_status');
        systemStatusRef.on("value", (snapshot) => {
            const status = snapshot.val();
            if (status) {
                console.log("📊 System status updated:", status);
                
                // Update power source if changed
                if (status.power_source && status.power_source !== activePowerSource) {
                    activePowerSource = status.power_source;
                    lastPowerSource = status.power_source;
                    updatePowerFlow(activePowerSource);
                    updateActivePowerSourceButton(activePowerSource);
                }
                
                // Update mode if changed
                if (status.mode && status.mode !== powerMode) {
                    powerMode = status.mode;
                    updateModeUI(powerMode);
                    
                    if (powerMode === 'auto') {
                        startAutoPowerSwitching();
                    } else {
                        stopAutoPowerSwitching();
                    }
                }
            }
        });
        
        // Commands listener (to detect emergency stop)
        const commandsRef = database.ref('solar_system/commands');
        commandsRef.on("value", (snapshot) => {
            const command = snapshot.val();
            if (command && command.action === 'emergency_stop') {
                console.log("⚠️ Emergency stop detected from Firebase");
                // Update UI to reflect emergency stop
                powerMode = 'stop';
                updateModeUI('stop');
                stopAllIntervals();
            }
        });
        
        console.log("✅ All Firebase listeners setup complete");
        
    } catch (error) {
        console.error("❌ Listener setup error:", error);
        showNotification("লিসেনার সেটাপ ত্রুটি", "error");
    }
    
    startESP32Monitoring();
    startDataValidityCheck();
}

// ==================== INTERVAL MANAGEMENT ====================

function stopAllIntervals() {
    console.log("🛑 Stopping all intervals...");
    
    if (autoPowerInterval) {
        clearInterval(autoPowerInterval);
        autoPowerInterval = null;
        console.log("✅ Auto power interval stopped");
    }
    
    if (autoCheckInterval) {
        clearInterval(autoCheckInterval);
        autoCheckInterval = null;
        console.log("✅ Auto check interval stopped");
    }
}

// ==================== DATA VALIDITY CHECK ====================

function startDataValidityCheck() {
    // Clear existing interval
    if (autoCheckInterval) {
        clearInterval(autoCheckInterval);
    }
    
    autoCheckInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceValidData = now - lastValidDataTime;
        
        if (timeSinceValidData > AUTO_THRESHOLDS.DATA_TIMEOUT) {
            console.log("⚠️ No valid data for", Math.floor(timeSinceValidData/1000), "seconds");
            
            if (powerMode === 'auto') {
                console.log("🔌 Auto mode: Switching to grid due to no data");
                if (activePowerSource !== 'grid') {
                    executePowerSwitch('grid', 'ডেটা না পাওয়ায় গ্রিডে সুইচ');
                }
            }
        }
    }, 10000);
    
    console.log("✅ Data validity check started");
}

// ==================== UPDATE SENSOR VALUES FROM FIREBASE ====================

function updateSensorValuesFromFirebase(data) {
    // Update from Firebase data only
    currentSolarVoltage = parseFloat(data.solar_voltage) || 0;
    currentBatteryVoltage = parseFloat(data.battery_voltage) || 0;
    currentBatterySOC = parseFloat(data.battery_soc) || 0;
    solarCurrent = parseFloat(data.solar_current) || 0;
    batteryCurrent = parseFloat(data.battery_current) || 0;
    loadCurrent = parseFloat(data.load_current) || 0;
    
    console.log(`📊 Firebase Data Update:`);
    console.log(`   Solar: ${currentSolarVoltage.toFixed(2)}V, ${solarCurrent.toFixed(2)}A`);
    console.log(`   Battery: ${currentBatteryVoltage.toFixed(2)}V, ${batteryCurrent.toFixed(2)}A, SOC: ${currentBatterySOC.toFixed(1)}%`);
    console.log(`   Load: ${loadCurrent.toFixed(2)}A`);
    
    // Update voltage display
    const solarVElement = document.querySelector('.solar_v .value');
    const batteryVElement = document.querySelector('.battery_v .value');
    
    if (solarVElement) solarVElement.textContent = currentSolarVoltage.toFixed(2);
    if (batteryVElement) batteryVElement.textContent = currentBatteryVoltage.toFixed(2);
}

// ==================== AUTO POWER SWITCHING ====================

function startAutoPowerSwitching() {
    console.log("🔋 Auto power switching starting...");
    
    // Stop any existing auto mode
    stopAutoPowerSwitching();
    
    // Set mode to auto
    powerMode = 'auto';
    updateModeUI('auto');
    updateActivePowerSourceButton('auto');
    
    // Update Firebase status
    updateFirebaseStatus('auto', activePowerSource);
    
    // Start checking interval
    autoPowerInterval = setInterval(() => {
        if (powerMode === 'auto' && !isSwitchingInProgress) {
            console.log("⏰ Auto mode scheduled check");
            checkAutoPowerConditions();
        }
    }, 15000); // Check every 15 seconds
    
    // First check after 3 seconds
    setTimeout(() => {
        if (powerMode === 'auto') {
            console.log("🚀 First auto mode check");
            checkAutoPowerConditions();
        }
    }, 3000);
    
    console.log("✅ Auto power switching started");
    showNotification("অটো মোড চালু হয়েছে", "success");
}

function stopAutoPowerSwitching() {
    if (autoPowerInterval) {
        clearInterval(autoPowerInterval);
        autoPowerInterval = null;
        console.log("⏹️ Auto power switching stopped");
    }
}

function checkAutoPowerConditions() {
    // Check if we can proceed
    if (powerMode !== 'auto') {
        console.log("⚠️ Auto mode not active");
        return;
    }
    
    if (isSwitchingInProgress) {
        console.log("⚠️ Switching already in progress");
        return;
    }
    
    const now = Date.now();
    if (now - lastSwitchTime < MIN_SWITCH_INTERVAL) {
        console.log("⏰ Too soon after last switch");
        return;
    }
    
    // Check Firebase connection
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected");
        showNotification("Firebase সংযোগ নেই", "warning");
        return;
    }
    
    // Check if we have valid data
    if (currentSolarVoltage === 0 && currentBatteryVoltage === 0) {
        console.log("⚠️ No valid sensor data");
        
        // Try to fetch fresh data
        database.ref('solar_system/current_data').once("value")
            .then((snapshot) => {
                const freshData = snapshot.val();
                if (freshData) {
                    updateSensorValuesFromFirebase(freshData);
                    // Retry after getting data
                    setTimeout(checkAutoPowerConditions, 1000);
                } else {
                    console.log("❌ Still no data - switching to grid");
                    executePowerSwitch('grid', 'ডেটা না পাওয়ায় গ্রিড');
                }
            });
        return;
    }
    
    console.log("=".repeat(60));
    console.log("🔍 AUTO MODE: SMART POWER SWITCHING CHECK");
    console.log("=".repeat(60));
    
    const solarVoltage = currentSolarVoltage;
    const batteryVoltage = currentBatteryVoltage;
    const batterySOC = currentBatterySOC;
    const voltageDiff = solarVoltage - batteryVoltage;
    
    console.log(`📊 CURRENT VALUES:`);
    console.log(`   Solar: ${solarVoltage.toFixed(2)}V (Current: ${solarCurrent.toFixed(2)}A)`);
    console.log(`   Battery: ${batteryVoltage.toFixed(2)}V (SOC: ${batterySOC.toFixed(1)}%, Current: ${batteryCurrent.toFixed(2)}A)`);
    console.log(`   Difference: ${voltageDiff.toFixed(2)}V`);
    console.log(`   Current Source: ${lastPowerSource}`);
    
    // Decision making logic
    let newPowerSource = null;
    let reason = "";
    
    // 🚨 PRIORITY 1: EMERGENCY - Battery critically low
    if (batterySOC > 0 && batterySOC < AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
        newPowerSource = 'grid';
        reason = `ব্যাটারি SOC কম: ${batterySOC.toFixed(1)}% < ${AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC}%`;
        console.log(`🚨 EMERGENCY: ${reason}`);
    }
    
    // ☀️ PRIORITY 2: SOLAR - If solar is available and good enough
    if (!newPowerSource && solarVoltage > 0) {
        const solarGood = solarVoltage >= AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE;
        const solarBetterThanBattery = voltageDiff >= AUTO_THRESHOLDS.SOLAR_BATTERY_DIFF;
        const solarGoodForGridSwitch = solarVoltage >= AUTO_THRESHOLDS.MIN_SOLAR_VOLTAGE_FOR_SWITCH;
        const solarMuchBetter = voltageDiff >= AUTO_THRESHOLDS.GRID_TO_SOLAR_THRESHOLD;
        const batteryLow = batterySOC < AUTO_THRESHOLDS.BATTERY_LOW_SOC;
        
        // Check current source
        const currentlyOnGrid = lastPowerSource === 'grid';
        const currentlyOnSolar = lastPowerSource === 'solar';
        const currentlyOnBattery = lastPowerSource === 'battery';
        
        // If currently on grid, only switch to solar if it's VERY good
        if (currentlyOnGrid) {
            if (solarGood && solarGoodForGridSwitch && solarMuchBetter) {
                newPowerSource = 'solar';
                reason = `সোলার খুব ভালো: ${solarVoltage.toFixed(2)}V (ব্যাটারি থেকে ${voltageDiff.toFixed(2)}V বেশি)`;
                console.log(`☀️ GRID → SOLAR: ${reason}`);
            } else {
                console.log(`⏸️ Staying on GRID (solar not good enough):`);
                console.log(`   Solar: ${solarVoltage.toFixed(2)}V, Need: ${AUTO_THRESHOLDS.MIN_SOLAR_VOLTAGE_FOR_SWITCH}V for switch`);
                console.log(`   Diff: ${voltageDiff.toFixed(2)}V, Need: ${AUTO_THRESHOLDS.GRID_TO_SOLAR_THRESHOLD}V for switch`);
            }
        }
        // If currently on solar, stay if still good
        else if (currentlyOnSolar) {
            const solarStillGood = solarVoltage >= (AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE - 0.5);
            const solarPowerGood = solarCurrent > 0.1; // Some current is flowing
            
            if (solarStillGood && solarPowerGood) {
                console.log(`✅ Staying on SOLAR:`);
                console.log(`   Voltage: ${solarVoltage.toFixed(2)}V, Current: ${solarCurrent.toFixed(2)}A`);
                // Stay on solar, no switch
            } else if (solarVoltage < AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD) {
                // Solar too low, switch to battery or grid
                if (batteryVoltage >= AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE && batterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
                    newPowerSource = 'battery';
                    reason = `সোলার কম: ${solarVoltage.toFixed(2)}V, ব্যাটারি ভালো: ${batteryVoltage.toFixed(2)}V`;
                    console.log(`🔋 SOLAR → BATTERY: ${reason}`);
                } else {
                    newPowerSource = 'grid';
                    reason = `সোলার কম: ${solarVoltage.toFixed(2)}V, ব্যাটারি অপর্যাপ্ত`;
                    console.log(`🔌 SOLAR → GRID: ${reason}`);
                }
            }
        }
        // If currently on battery, switch to solar if better
        else if (currentlyOnBattery) {
            if (solarGood && solarBetterThanBattery) {
                newPowerSource = 'solar';
                reason = `সোলার ভালো: ${solarVoltage.toFixed(2)}V (ব্যাটারি থেকে ${voltageDiff.toFixed(2)}V বেশি)`;
                console.log(`☀️ BATTERY → SOLAR: ${reason}`);
            } else if (batteryLow && solarGood) {
                newPowerSource = 'solar';
                reason = `ব্যাটারি কম: ${batterySOC.toFixed(1)}%, সোলার ব্যবহার`;
                console.log(`☀️ BATTERY → SOLAR (low battery): ${reason}`);
            }
        }
        // If no current source or starting up
        else {
            if (solarGood && solarBetterThanBattery) {
                newPowerSource = 'solar';
                reason = `সোলার ভালো: ${solarVoltage.toFixed(2)}V`;
                console.log(`☀️ START → SOLAR: ${reason}`);
            }
        }
    }
    
    // 🔋 PRIORITY 3: BATTERY - If battery is good and solar is insufficient
    if (!newPowerSource && batteryVoltage > 0) {
        const batteryGood = batteryVoltage >= AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE;
        const batterySOCGood = batterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC;
        const solarInsufficient = solarVoltage < AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE;
        
        const currentlyOnGrid = lastPowerSource === 'grid';
        const currentlyOnSolar = lastPowerSource === 'solar';
        
        if (batteryGood && batterySOCGood) {
            // If on grid and solar is insufficient, switch to battery
            if (currentlyOnGrid && solarInsufficient) {
                newPowerSource = 'battery';
                reason = `সোলার অপর্যাপ্ত: ${solarVoltage.toFixed(2)}V, ব্যাটারি ভালো: ${batteryVoltage.toFixed(2)}V`;
                console.log(`🔋 GRID → BATTERY: ${reason}`);
            }
            // If on solar and solar became insufficient, switch to battery
            else if (currentlyOnSolar && solarInsufficient) {
                newPowerSource = 'battery';
                reason = `সোলার কমে গেছে: ${solarVoltage.toFixed(2)}V, ব্যাটারি ব্যবহার`;
                console.log(`🔋 SOLAR → BATTERY: ${reason}`);
            }
        }
    }
    
    // 🔌 PRIORITY 4: GRID - Fallback only if solar and battery both insufficient
    if (!newPowerSource) {
        const solarBad = solarVoltage < AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE;
        const batteryBad = batteryVoltage < AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE;
        const batterySOCBad = batterySOC <= AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC;
        
        const currentlyOnGrid = lastPowerSource === 'grid';
        
        // Only switch to grid if both solar and battery are bad AND we're not already on grid
        if (!currentlyOnGrid && solarBad && (batteryBad || batterySOCBad)) {
            newPowerSource = 'grid';
            reason = `সোলার অপর্যাপ্ত: ${solarVoltage.toFixed(2)}V, ব্যাটারি ${batterySOCBad ? 'SOC কম' : 'ভোল্টেজ কম'}`;
            console.log(`🔌 SWITCH TO GRID: ${reason}`);
        } else if (currentlyOnGrid && (solarBad || batteryBad || batterySOCBad)) {
            // Already on grid and conditions are bad, stay on grid
            console.log(`✅ Staying on GRID: Conditions not good for switch`);
            console.log(`   Solar: ${solarVoltage.toFixed(2)}V, Battery: ${batteryVoltage.toFixed(2)}V, SOC: ${batterySOC.toFixed(1)}%`);
        } else {
            // Keep current source if it's still working
            console.log(`✅ NO SWITCH NEEDED: Current source (${lastPowerSource}) still viable`);
            console.log(`   Solar: ${solarVoltage.toFixed(2)}V, Battery: ${batteryVoltage.toFixed(2)}V, SOC: ${batterySOC.toFixed(1)}%`);
            console.log("=".repeat(60));
            return;
        }
    }
    
    // Check if switching is needed
    if (newPowerSource && newPowerSource !== lastPowerSource) {
        console.log(`🔄 DECISION: ${lastPowerSource} → ${newPowerSource}`);
        console.log(`📝 REASON: ${reason}`);
        
        // Apply hysteresis to prevent rapid switching
        if (lastPowerSource === 'solar' && newPowerSource === 'battery') {
            const hysteresisThreshold = -AUTO_THRESHOLDS.SOLAR_BATTERY_DIFF - AUTO_THRESHOLDS.HYSTERESIS;
            if (voltageDiff > hysteresisThreshold) {
                console.log(`⏸️ HYSTERESIS: Staying on solar (diff: ${voltageDiff.toFixed(2)}V)`);
                console.log("=".repeat(60));
                return;
            }
        }
        
        // Don't switch from solar to grid unnecessarily
        if (lastPowerSource === 'solar' && newPowerSource === 'grid') {
            // Only switch from solar to grid if solar is very bad
            const solarVeryBad = solarVoltage < AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD;
            if (!solarVeryBad) {
                console.log(`⏸️ Staying on SOLAR: Not bad enough for grid (${solarVoltage.toFixed(2)}V)`);
                console.log("=".repeat(60));
                return;
            }
        }
        
        // Execute the switch
        executePowerSwitch(newPowerSource, reason);
        
    } else if (activePowerSource === 'off') {
        console.log("⚠️ System is off");
    } else {
        console.log(`✅ NO SWITCH NEEDED: Already on optimal source (${lastPowerSource})`);
    }
    
    console.log("=".repeat(60));
}

function executePowerSwitch(targetSource, reason) {
    if (isSwitchingInProgress) return;
    
    console.log(`⚡ Executing switch: ${lastPowerSource} → ${targetSource}`);
    isSwitchingInProgress = true;
    lastSwitchTime = Date.now();
    
    // Update UI immediately
    updatePowerFlow(targetSource);
    updateActivePowerSourceButton(targetSource);
    
    // Add delay for smooth switching
    setTimeout(() => {
        if (targetSource === 'solar') {
            switchToSolarPower(reason);
        } else if (targetSource === 'battery') {
            switchToBatteryPower(reason);
        } else if (targetSource === 'grid') {
            switchToGridPower(reason);
        }
        
        isSwitchingInProgress = false;
    }, 1500);
}

// ==================== SWITCH FUNCTIONS ====================

function switchToSolarPower(reason) {
    console.log("☀️ Switching to SOLAR");
    controlPowerSource('solar', 'on', reason);
}

function switchToBatteryPower(reason) {
    console.log("🔋 Switching to BATTERY");
    controlPowerSource('battery', 'on', reason);
}

function switchToGridPower(reason) {
    console.log("🔌 Switching to GRID");
    controlPowerSource('grid', 'on', reason);
}

// ==================== CONTROL PANEL ====================

function initControlPanel() {
    console.log("🔄 Initializing control panel...");
    
    // ================= MODE BUTTONS =================
    const autoModeBtn = document.getElementById('autoModeBtn');
    const manualModeBtn = document.getElementById('manualModeBtn');
    const stopModeBtn = document.getElementById('stopModeBtn');
    
    if (autoModeBtn) {
        autoModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Auto Mode button clicked");
            
            if (powerMode !== 'auto') {
                // Switch to AUTO mode
                switchToMode('auto');
            }
        });
    }
    
    if (manualModeBtn) {
        manualModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Manual Mode button clicked");
            
            if (powerMode !== 'manual') {
                // Switch to MANUAL mode
                switchToMode('manual');
            }
        });
    }
    
    if (stopModeBtn) {
        stopModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Stop Mode button clicked");
            
            if (powerMode !== 'stop') {
                // Switch to STOP mode
                switchToMode('stop');
            }
        });
    }
    
    // ================= সার্ভো কন্ট্রোল বাটন =================
    // ================= সার্ভো কন্ট্রোল বাটন =================
const servoControlBtns = document.querySelectorAll('.servo-control-btn');
servoControlBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const direction = this.getAttribute('data-direction');
        const angle = this.getAttribute('data-angle') || 5;
        console.log("Servo control clicked:", direction, angle);
        
        // আগের সব active ক্লাস রিমুভ করুন
        servoControlBtns.forEach(b => b.classList.remove('active'));
        
        // বর্তমান বাটনে active ক্লাস যোগ করুন
        this.classList.add('active');
        
        // ২ সেকেন্ড পর active ক্লাস রিমুভ করুন
        setTimeout(() => {
            this.classList.remove('active');
        }, 2000);
        
        // সার্ভো কমান্ড পাঠান
        sendServoCommand(direction, parseInt(angle));
        
        // নোটিফিকেশন দেখান
        showNotification(`সার্ভো ${getDirectionText(direction)} দিকে ${angle}° ঘোরানো হয়েছে`, 'info');
    });
});

// দিকের বাংলা নাম ফাংশন
function getDirectionText(direction) {
    const directions = {
        'up': 'উপরের',
        'down': 'নিচের',
        'left': 'বাম',
        'right': 'ডান',
        'center': 'সেন্টার'
    };
    return directions[direction] || direction;
}
    
    // ==================== SERVO VISUAL FEEDBACK ====================

function activateServoButton(button) {
    // Remove active class from all servo buttons
    document.querySelectorAll('.servo-control-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to clicked button
    button.classList.add('active');
    
    // Add icon animation
    const icon = button.querySelector('i');
    if (icon) {
        icon.style.transform = 'scale(1.3)';
        setTimeout(() => {
            icon.style.transform = 'scale(1)';
        }, 300);
    }
    
    // Auto remove after 2 seconds
    setTimeout(() => {
        button.classList.remove('active');
    }, 2000);
}

// Test function for servo buttons
window.testServoVisual = function() {
    console.log("🧪 Testing servo button visual feedback...");
    
    const servoButtons = document.querySelectorAll('.servo-control-btn');
    if (servoButtons.length === 0) {
        console.log("❌ No servo buttons found");
        return;
    }
    
    // Test each button with delay
    servoButtons.forEach((btn, index) => {
        setTimeout(() => {
            const direction = btn.getAttribute('data-direction');
            console.log(`Testing: ${direction} button`);
            activateServoButton(btn);
        }, index * 1000);
    });
    
    console.log("✅ Servo visual test started");
};
    
    
    
    
    
// ================= পাওয়ার সোর্স বাটন =================
const powerSourceBtns = document.querySelectorAll('.power-source-btn');
powerSourceBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const source = this.getAttribute('data-source');
        const state = this.getAttribute('data-state');
        
        console.log(`Power source button clicked: ${source}, state: ${state}`);
        
        if (powerMode === 'stop') {
            showNotification('সিস্টেম জরুরি বন্ধ আছে', 'warning');
            return;
        }
        
        // আগের সব active ক্লাস রিমুভ করুন
        powerSourceBtns.forEach(b => {
            b.classList.remove('active', 'manual-active');
        });
        
        // বর্তমান বাটনে manual-active ক্লাস যোগ করুন
        this.classList.add('manual-active');
        
        if (source === 'all' && state === 'off') {
            // "সব OFF" বাটন → ম্যানুয়াল স্টপ
            manualStop();
            showNotification('সব OFF করা হয়েছে', 'warning');
            return;
        }
        
        if (source === 'solar' || source === 'battery' || source === 'grid') {
            // Switch to MANUAL mode if not already
            if (powerMode !== 'manual') {
                switchToMode('manual');
            }
            
            // Send command for the selected source
            controlPowerSource(source, state, 'ম্যানুয়াল সিলেকশন');
            
            const sourceNames = {
                'solar': 'সোলার',
                'battery': 'ব্যাটারি',
                'grid': 'গ্রিড'
            };
            showNotification(`${sourceNames[source]} চালু করা হয়েছে`, 'info');
        }
    });
});
    // ================= ব্রাশ কন্ট্রোল =================
    // ব্রাশ মোড সিলেকশন
    const brushAutoBtn = document.getElementById('brushAutoModeBtn');
    const brushManualBtn = document.getElementById('brushManualModeBtn');
    const manualBrushControl = document.getElementById('manualBrushControl');
    const autoBrushControl = document.getElementById('autoBrushControl');
    
    if (brushAutoBtn && brushManualBtn) {
        // Set initial state
        if (currentBrushMode === 'auto') {
            brushAutoBtn.classList.add('active');
            brushManualBtn.classList.remove('active');
            if (manualBrushControl) manualBrushControl.style.display = 'none';
            if (autoBrushControl) autoBrushControl.style.display = 'block';
        } else {
            brushAutoBtn.classList.remove('active');
            brushManualBtn.classList.add('active');
            if (manualBrushControl) manualBrushControl.style.display = 'block';
            if (autoBrushControl) autoBrushControl.style.display = 'none';
        }
        
        brushAutoBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Auto Mode clicked");
            currentBrushMode = 'auto';
            brushAutoBtn.classList.add('active');
            brushManualBtn.classList.remove('active');
            if (manualBrushControl) manualBrushControl.style.display = 'none';
            if (autoBrushControl) autoBrushControl.style.display = 'block';
            showNotification('অটো ব্রাশ মোড সিলেক্ট করা হয়েছে', 'info');
        });
        
        brushManualBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Manual Mode clicked");
            currentBrushMode = 'manual';
            brushManualBtn.classList.add('active');
            brushAutoBtn.classList.remove('active');
            if (manualBrushControl) manualBrushControl.style.display = 'block';
            if (autoBrushControl) autoBrushControl.style.display = 'none';
            showNotification('ম্যানুয়াল ব্রাশ মোড সিলেক্ট করা হয়েছে', 'info');
        });
    }
    
    // ম্যানুয়াল ব্রাশ কন্ট্রোল
    const brushForwardBtn = document.getElementById('brushForwardBtn');
    const brushReverseBtn = document.getElementById('brushReverseBtn');
    const brushStopBtn = document.getElementById('brushPumpStopBtn');
    const pumpOnBtn = document.getElementById('pumpOnBtn');
    const startCleaningBtn = document.getElementById('startCleaningBtn');
    const stopCleaningBtn = document.getElementById('stopCleaningBtn');
    const pumpOffBtn = document.getElementById('pumpOffBtn');
    
    if (brushForwardBtn) {
        brushForwardBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Forward clicked");
            brushStatus = 'forward';
            updateBrushStatus();
            sendBrushCommand('forward');
            showNotification('ব্রাশ ফরওয়ার্ড চালু করা হয়েছে', 'info');
        });
    }
    
    if (brushReverseBtn) {
        brushReverseBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Reverse clicked");
            brushStatus = 'reverse';
            updateBrushStatus();
            sendBrushCommand('reverse');
            showNotification('ব্রাশ রিভার্স চালু করা হয়েছে', 'info');
        });
    }
    
    if (brushStopBtn) {
        brushStopBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Stop clicked");
            brushStatus = 'stopped';
            pumpStatus = 'off';
            updateBrushStatus();
            updatePumpStatus();
            sendBrushCommand('stop');
            sendPumpCommand('off');
            showNotification('ব্রাশ ও পাম্প বন্ধ করা হয়েছে', 'warning');
        });
    }
    
    if (pumpOnBtn) {
        pumpOnBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Pump ON clicked");
            pumpStatus = 'on';
            updatePumpStatus();
            sendPumpCommand('on');
            showNotification('পাম্প চালু করা হয়েছে', 'info');
        });
    }
    
    // Check for pumpOffBtn (may not exist)
    if (pumpOffBtn) {
        pumpOffBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Pump OFF clicked");
            pumpStatus = 'off';
            updatePumpStatus();
            sendPumpCommand('off');
            showNotification('পাম্প বন্ধ করা হয়েছে', 'warning');
        });
    }
    
    if (startCleaningBtn) {
        startCleaningBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Start Cleaning clicked");
            const duration = document.getElementById('cleaningDuration')?.value || 30;
            const interval = document.getElementById('cleaningInterval')?.value || 6;
            sendCleaningCommand('start', duration, interval);
            showNotification(`অটো পরিষ্কার শুরু: ${duration} সেকেন্ড, বিরতি: ${interval} ঘণ্টা`, 'info');
        });
    }
    
    if (stopCleaningBtn) {
        stopCleaningBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Stop Cleaning clicked");
            sendCleaningCommand('stop');
            showNotification('অটো পরিষ্কার বন্ধ করা হয়েছে', 'warning');
        });
    }
    
    console.log("✅ Control panel initialized");
}

// ==================== MODE SWITCHING FUNCTIONS ====================

function switchToMode(mode) {
    console.log(`🔄 Switching to ${mode} mode`);
    
    // Handle mode switching
    switch(mode) {
        case 'auto':
            if (powerMode !== 'auto') {
                powerMode = 'auto';
                updateModeUI('auto');
                updateActivePowerSourceButton('auto');
                startAutoPowerSwitching();
                showNotification('অটো মোড চালু হয়েছে', 'success');
                updateFirebaseStatus('auto', activePowerSource);
            }
            break;
            
        case 'manual':
            if (powerMode !== 'manual') {
                stopAutoPowerSwitching();
                powerMode = 'manual';
                updateModeUI('manual');
                showNotification('ম্যানুয়াল মোড চালু হয়েছে', 'info');
                updateFirebaseStatus('manual', activePowerSource);
            }
            break;
            
        case 'stop':
            if (powerMode !== 'stop') {
                if (confirm('সিস্টেম জরুরি বন্ধ করতে চান?')) {
                    emergencyStop();
                }
            }
            break;
    }
}

// ==================== MANUAL STOP FUNCTION ====================

function manualStop() {
    console.log("⏹️ Manual Stop (রিলে বন্ধ)");
    
    // শুধু রিলে বন্ধ করা, ইমারজেন্সি নয়
    powerMode = 'manual';
    activePowerSource = 'off';
    
    // Update UI
    updateModeUI('manual');
    updatePowerFlow('off');
    
    // Send manual stop command (not emergency)
    const manualStopCommand = {
        action: 'manual_stop',
        relays: {
            relay1: false,
            relay2: false,
            relay3: false
        },
        reason: 'User initiated manual stop (রিলে বন্ধ)',
        timestamp: Date.now(),
        userId: userId || 'web_user',
        emergency: false // ইমারজেন্সি নয়
    };
    
    if (database && isConnected) {
        database.ref("solar_system/commands").set(manualStopCommand)
            .then(() => {
                console.log('✅ Manual stop command sent');
                showNotification('রিলে বন্ধ করা হয়েছে (ম্যানুয়াল স্টপ)', 'warning');
                
                // Update current power source display
                updateCurrentPowerSourceDisplay();
                updateFirebaseStatus('manual', 'off');
            })
            .catch(error => {
                console.error('❌ Manual stop command error:', error);
            });
    }
}

// ==================== EMERGENCY STOP FUNCTION ====================

function emergencyStop() {
    console.log("🛑 Emergency Stop (জরুরি বন্ধ)!");
    
    // First stop all intervals
    stopAllIntervals();
    
    powerMode = 'stop';
    activePowerSource = 'off';
    
    // Update UI
    updateModeUI('stop');
    updatePowerFlow('off');
    
    // Stop brush and pump
    brushStatus = 'stopped';
    pumpStatus = 'off';
    updateBrushStatus();
    updatePumpStatus();
    
    // Send stop commands for brush and pump
    if (database && isConnected) {
        sendBrushCommand('stop');
        sendPumpCommand('off');
    }
    
    // Send emergency stop command with emergency flag
    const emergencyCommand = {
        action: 'emergency_stop',
        relays: {
            relay1: false,
            relay2: false,
            relay3: false
        },
        reason: 'User initiated emergency stop (জরুরি বন্ধ)',
        timestamp: Date.now(),
        userId: userId || 'web_user',
        emergency: true, // ইমারজেন্সি
        system_state: 'emergency_stopped'
    };
    
    if (database && isConnected) {
        database.ref("solar_system/commands").set(emergencyCommand)
            .then(() => {
                console.log('✅ Emergency stop command sent');
                showNotification('সিস্টেম জরুরি বন্ধ করা হয়েছে', 'error');
                
                // Update Firebase status to stop mode
                updateFirebaseStatus('stop', 'off');
                
                // Update current power source display
                updateCurrentPowerSourceDisplay();
                
                // Auto refresh after 5 seconds
                setTimeout(() => {
                    console.log("🔄 Auto-refreshing system status...");
                    refreshSystemStatus();
                }, 5000);
            })
            .catch(error => {
                console.error('❌ Emergency stop command error:', error);
            });
    }
}

// ==================== REFRESH SYSTEM STATUS ====================

function refreshSystemStatus() {
    console.log("🔄 Refreshing system status...");
    
    if (!database || !isConnected) {
        console.error("❌ Cannot refresh - Firebase not connected");
        return;
    }
    
    // Fetch fresh data from Firebase
    fetchInitialData();
    
    // Force UI update
    updateModeUI(powerMode);
    updateCurrentPowerSourceDisplay();
    
    showNotification("সিস্টেম স্ট্যাটাস রিফ্রেশ করা হয়েছে", "info");
}

// ==================== DEVICE CONTROL FUNCTIONS ====================

function sendBrushCommand(direction) {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for brush command");
        return;
    }
    
    const command = {
        action: 'brush_control',
        direction: direction,
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_mode: powerMode
    };
    
    console.log('📤 Sending brush command:', command);
    
    database.ref("solar_system/commands").update(command)
        .then(() => {
            console.log('✅ Brush command sent');
        })
        .catch(error => {
            console.error('❌ Brush command error:', error);
            showNotification('ব্রাশ কমান্ড পাঠাতে সমস্যা', 'error');
        });
}

function sendPumpCommand(state) {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for pump command");
        return;
    }
    
    const command = {
        action: 'pump_control',
        state: state,
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_mode: powerMode
    };
    
    console.log('📤 Sending pump command:', command);
    
    database.ref("solar_system/commands").update(command)
        .then(() => {
            console.log('✅ Pump command sent');
        })
        .catch(error => {
            console.error('❌ Pump command error:', error);
            showNotification('পাম্প কমান্ড পাঠাতে সমস্যা', 'error');
        });
}

function sendServoCommand(direction, angle) {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for servo command");
        return;
    }
    
    const command = {
        action: 'servo_control',
        direction: direction,
        angle: angle,
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_mode: powerMode
    };
    
    console.log('📤 Sending servo command:', command);
    
    database.ref("solar_system/commands").update(command)
        .then(() => {
            console.log('✅ Servo command sent');
        })
        .catch(error => {
            console.error('❌ Servo command error:', error);
            showNotification('সার্ভো কমান্ড পাঠাতে সমস্যা', 'error');
        });
}

function sendCleaningCommand(action, duration = 30, interval = 6) {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for cleaning command");
        return;
    }
    
    const command = {
        action: 'cleaning_control',
        mode: action,
        duration: parseInt(duration),
        interval: parseInt(interval),
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_mode: powerMode
    };
    
    console.log('📤 Sending cleaning command:', command);
    
    database.ref("solar_system/commands").update(command)
        .then(() => {
            console.log('✅ Cleaning command sent');
        })
        .catch(error => {
            console.error('❌ Cleaning command error:', error);
            showNotification('পরিষ্কার কমান্ড পাঠাতে সমস্যা', 'error');
        });
}

// ==================== POWER CONTROL FUNCTIONS ====================

function controlPowerSource(source, state = 'on', reason = '') {
    if (!database || !isConnected) {
        showNotification('Firebase সংযোগ নেই', 'error');
        return;
    }
    
    // If All Off is clicked (this should call manualStop, not emergencyStop)
    if (source === 'all' && state === 'off') {
        manualStop();
        return;
    }
    
    // IMPORTANT: Only one relay should be ON at a time
    let relay1 = false, relay2 = false, relay3 = false;
    
    if (source === 'solar' && state === 'on') {
        relay1 = true;   // Solar relay ON
        relay2 = false;  // Battery relay OFF
        relay3 = false;  // Grid relay OFF
    } else if (source === 'battery' && state === 'on') {
        relay1 = false;
        relay2 = true;
        relay3 = false;
    } else if (source === 'grid' && state === 'on') {
        relay1 = false;
        relay2 = false;
        relay3 = true;
    } else {
        // All OFF
        relay1 = false;
        relay2 = false;
        relay3 = false;
        activePowerSource = 'off';
    }
    
    // Update local variables
    if (state === 'on' && source !== 'all') {
        lastPowerSource = source;
        activePowerSource = source;
    }
    
    const command = {
        action: 'set_power_source',
        source: source,
        state: state,
        relays: {
            relay1: relay1,
            relay2: relay2,
            relay3: relay3
        },
        timestamp: Date.now(),
        userId: userId || 'web_user',
        mode: powerMode,
        reason: reason,
        command_source: 'dashboard_' + powerMode,
        sensor_data: {
            solar_voltage: currentSolarVoltage,
            battery_voltage: currentBatteryVoltage,
            battery_soc: currentBatterySOC,
            solar_current: solarCurrent,
            battery_current: batteryCurrent,
            load_current: loadCurrent,
            voltage_diff: (currentSolarVoltage - currentBatteryVoltage).toFixed(2)
        }
    };
    
    console.log('📤 Sending power command to Firebase:', command);
    console.log(`⚡ Relay States → Solar(R1):${relay1} Battery(R2):${relay2} Grid(R3):${relay3}`);
    
    database.ref("solar_system/commands").set(command)
        .then(() => {
            console.log('✅ Power command sent to Firebase');
            
            // Update Firebase status
            updateFirebaseStatus(powerMode, source);
            
            if (state === 'on' && source !== 'all') {
                // Update UI
                updateUIAfterPowerSwitch(source);
                
                // Update current power source display
                updateCurrentPowerSourceDisplay();
                
                updatePowerFlow(source);
                
                // Show notification with reason
                const sourceNames = {
                    'solar': 'সোলার',
                    'battery': 'ব্যাটারি',
                    'grid': 'গ্রিড'
                };
                const notificationReason = reason ? `কারণ: ${reason}` : '';
                showNotification(`${sourceNames[source]} চালু হয়েছে ${notificationReason}`, 'success');
                
                // Log the switch
                console.log(`📝 Switch recorded: ${source} at ${new Date().toLocaleTimeString()}`);
                console.log(`   Solar: ${currentSolarVoltage.toFixed(2)}V`);
                console.log(`   Battery: ${currentBatteryVoltage.toFixed(2)}V, SOC: ${currentBatterySOC.toFixed(1)}%`);
            }
        })
        .catch(error => {
            console.error('❌ Power command error:', error);
            showNotification('কমান্ড পাঠাতে সমস্যা', 'error');
            isSwitchingInProgress = false;
        });
}

function updateFirebaseStatus(mode, source) {
    if (!database || !isConnected) return;
    
    const statusUpdate = {
        mode: mode,
        power_source: source,
        last_updated: Date.now(),
        auto_mode_running: (mode === 'auto'),
        last_switch: {
            source: source,
            time: Date.now(),
            solar_voltage: currentSolarVoltage,
            battery_voltage: currentBatteryVoltage,
            battery_soc: currentBatterySOC
        }
    };
    
    database.ref("solar_system/system_status").update(statusUpdate)
        .then(() => {
            console.log("✅ Firebase status updated");
        })
        .catch(error => {
            console.error("❌ Firebase status update error:", error);
        });
}

// ==================== UI UPDATE FUNCTIONS ====================

function updateUIAfterPowerSwitch(source) {
    // Update mode indicator
    const mode = powerMode === 'auto' ? (
        source === 'solar' ? 'auto_solar' :
        source === 'battery' ? 'auto_battery' :
        source === 'grid' ? 'auto_grid' : 'auto'
    ) : 'manual';
    
    updateModeIndicator(mode);
    
    // Update current power source text
    updateCurrentPowerSourceText();
    
    // Update power flow visualization
    updatePowerFlow(source);
    
    // Update active button
    updateActivePowerSourceButton(source);
}

function updateCurrentPowerSourceDisplay() {
    const currentPowerSourceEl = document.getElementById('currentPowerSource');
    if (!currentPowerSourceEl) return;
    
    const sourceNames = {
        'solar': 'সোলার',
        'battery': 'ব্যাটারি',
        'grid': 'গ্রিড',
        'off': 'বন্ধ'
    };
    
    let modeText = '';
    if (powerMode === 'auto') {
        modeText = ' (অটো)';
    } else if (powerMode === 'manual') {
        modeText = ' (ম্যানুয়াল)';
    } else if (powerMode === 'stop') {
        modeText = ' (জরুরি বন্ধ)';
    }
    
    if (powerMode === 'stop') {
        currentPowerSourceEl.textContent = 'সিস্টেম জরুরি বন্ধ' + modeText;
        currentPowerSourceEl.style.color = '#F44336'; // লাল রঙ
    } else if (activePowerSource === 'off') {
        currentPowerSourceEl.textContent = 'সিস্টেম বন্ধ (ম্যানুয়াল)' + modeText;
        currentPowerSourceEl.style.color = '#FF9800'; // কমলা রঙ
    } else {
        currentPowerSourceEl.textContent = 
            sourceNames[activePowerSource] + ' → লোড' + modeText;
        
        const colors = {
            'solar': '#FF9800',
            'battery': '#4CAF50',
            'grid': '#2196F3'
        };
        currentPowerSourceEl.style.color = colors[activePowerSource] || '#000';
    }
}

function updateModeIndicator(mode) {
    const indicator = document.getElementById('mode_indicator');
    if (!indicator) return;
    
    const modeTexts = {
        'auto': 'অটো মোড',
        'auto_solar': 'অটো মোড (সোলার)',
        'auto_battery': 'অটো মোড (ব্যাটারি)',
        'auto_grid': 'অটো মোড (গ্রিড)',
        'manual': 'ম্যানুয়াল মোড',
        'stop': 'জরুরি বন্ধ'
    };
    
    indicator.textContent = modeTexts[mode] || 'অটো মোড';
    indicator.className = mode === 'auto' ? 'auto-indicator' : 
                         mode === 'stop' ? 'stop-indicator' : 'manual-indicator';
}

function updateCurrentPowerSourceText() {
    const el = document.querySelector('.current-source-text');
    if (!el) return;
    
    const texts = {
        'solar': 'সোলার',
        'battery': 'ব্যাটারি',
        'grid': 'গ্রিড',
        'off': 'বন্ধ',
        'auto': 'অটো'
    };
    
    el.textContent = texts[activePowerSource] || activePowerSource;
}

function updateActivePowerSourceButton(source) {
    // Remove active class from all buttons
    document.querySelectorAll('.power-source-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('manual-active');
    });
    
    // Add appropriate class
    if (powerMode === 'manual' && source !== 'auto') {
        const manualBtn = document.querySelector(`.power-source-btn[data-source="${source}"]`);
        if (manualBtn) {
            manualBtn.classList.add('manual-active');
        }
    } else if (source === 'auto' || powerMode === 'auto') {
        const autoBtn = document.querySelector('.power-source-btn[data-source="auto"]');
        if (autoBtn) {
            autoBtn.classList.add('active');
        }
    }
}

function updateModeUI(mode) {
    console.log("Updating mode UI to:", mode);
    
    // Update mode buttons
    const autoBtn = document.getElementById('autoModeBtn');
    const manualBtn = document.getElementById('manualModeBtn');
    const stopBtn = document.getElementById('stopModeBtn');
    const panel = document.getElementById('manualControlPanel');
    
    // Remove active class from all
    if (autoBtn) autoBtn.classList.remove('active');
    if (manualBtn) manualBtn.classList.remove('active');
    if (stopBtn) stopBtn.classList.remove('active');
    
    // Add active class to current mode
    if (mode === 'auto' && autoBtn) autoBtn.classList.add('active');
    if (mode === 'manual' && manualBtn) manualBtn.classList.add('active');
    if (mode === 'stop' && stopBtn) stopBtn.classList.add('active');
    
    // Show/hide manual control panel
    if (panel) {
        panel.style.display = mode === 'manual' ? 'block' : 'none';
    }
    
    // Update mode indicator
    updateModeIndicator(mode);
    
    // Update current power source display
    updateCurrentPowerSourceDisplay();
}

function updatePowerFlow(source) {
    const diagram = document.getElementById('powerFlowDiagram');
    if (!diagram) return;
    
    // Reset all
    diagram.querySelectorAll('.path-item').forEach(item => {
        item.classList.remove('active');
        item.style.background = '#f5f5f5';
        item.style.color = '#999';
        item.style.opacity = '0.7';
    });
    
    diagram.querySelectorAll('.path-arrow').forEach(arrow => {
        arrow.classList.remove('active');
        arrow.style.color = '#666';
    });
    
    // Remove all active classes
    diagram.classList.remove('solar-active', 'battery-active', 'grid-active', 'off-state');
    
    if (source === 'off') {
        diagram.classList.add('off-state');
        return;
    }
    
    const colors = {
        'solar': '#FF9800',
        'battery': '#4CAF50',
        'grid': '#2196F3'
    };
    
    const color = colors[source] || '#9C27B0';
    
    // Highlight active path
    const sourceItem = diagram.querySelector(`.path-item[data-id="${source}"]`);
    const loadItem = diagram.querySelector('.path-item[data-id="load"]');
    const arrow = diagram.querySelector(`.path-arrow[data-from="${source}"]`);
    
    if (sourceItem) {
        sourceItem.classList.add('active');
        sourceItem.style.background = color;
        sourceItem.style.color = 'white';
        sourceItem.style.opacity = '1';
    }
    
    if (loadItem) {
        loadItem.classList.add('active');
        loadItem.style.background = color;
        loadItem.style.color = 'white';
        loadItem.style.opacity = '1';
    }
    
    if (arrow) {
        arrow.classList.add('active');
        arrow.style.color = color;
    }
    
    diagram.classList.add(`${source}-active`);
}

function updateBrushStatus() {
    const statusEl = document.getElementById('brushStatus');
    const dirEl = document.getElementById('brushDirection');
    
    if (statusEl) {
        const statusText = {
            'stopped': 'বন্ধ',
            'forward': 'ফরওয়ার্ড চলছে',
            'reverse': 'রিভার্স চলছে'
        };
        statusEl.textContent = statusText[brushStatus] || brushStatus;
        statusEl.style.color = brushStatus === 'stopped' ? '#F44336' : '#4CAF50';
    }
    
    if (dirEl) {
        const dirText = {
            'forward': 'ফরওয়ার্ড',
            'reverse': 'রিভার্স'
        };
        dirEl.textContent = dirText[brushStatus] || '-';
        dirEl.style.color = brushStatus === 'forward' ? '#2196F3' : 
                          brushStatus === 'reverse' ? '#FF9800' : '#666';
    }
}

function updatePumpStatus() {
    const statusEl = document.getElementById('pumpStatus');
    if (statusEl) {
        statusEl.textContent = pumpStatus === 'on' ? 'চালু' : 'বন্ধ';
        statusEl.style.color = pumpStatus === 'on' ? '#4CAF50' : '#F44336';
    }
}

// ==================== DASHBOARD UPDATES ====================

function updateDashboard(data) {
    if (!data) {
        console.log("⚠️ No data to update dashboard");
        return;
    }
    
    const format = (value, decimals = 2) => {
        const num = parseFloat(value);
        return isNaN(num) ? "0.00" : num.toFixed(decimals);
    };
    
    // Update solar values
    updateElements('.solar_v', format(data.solar_voltage || 0), 'V');
    updateElements('.solar_a', format(data.solar_current || 0), 'A');
    updateElements('.solar_w', format((data.solar_voltage || 0) * (data.solar_current || 0)), 'W');
    
    // Update battery values
    updateElements('.battery_v', format(data.battery_voltage || 0), 'V');
    updateElements('.battery_a', format(data.battery_current || 0), 'A');
    updateElements('.battery_w', format((data.battery_voltage || 0) * (data.battery_current || 0)), 'W');
    updateElements('.battery_soc', format(data.battery_soc || 0, 1), '%');
    
    // Update load values
    updateElements('.load_v', format(data.load_voltage || 0), 'V');
    updateElements('.load_a', format(data.load_current || 0), 'A');
    updateElements('.load_w', format((data.load_voltage || 0) * (data.load_current || 0)), 'W');
    
    // Update other values
    updateElementById('total_energy', format(data.total_energy || 0), 'Wh');
    updateElementById('efficiency', format(data.efficiency || 0, 1), '%');
    updateElementById('dust', format(data.dust_level || 0), 'μg/m³');
    
    // Update battery progress
    updateBatteryProgress(data.battery_soc || 0);
    
    // Update last sync time
    updateLastSyncTime(data.timestamp || Date.now());
}

function updateElements(selector, value, unit) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
        if (el) {
            el.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;
        }
    });
}

function updateElementById(id, value, unit) {
    const el = document.getElementById(id);
    if (el) {
        el.innerHTML = `<span class="value">${value}</span><span class="unit">${unit}</span>`;
    }
}

function updateBatteryProgress(soc) {
    const bar = document.getElementById('batteryProgressBar');
    if (!bar) return;
    
    const percent = Math.min(Math.max(parseFloat(soc), 0), 100);
    bar.style.width = `${percent}%`;
    
    if (percent >= 70) {
        bar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)';
    } else if (percent >= 30) {
        bar.style.background = 'linear-gradient(90deg, #FF9800, #FFC107)';
    } else {
        bar.style.background = 'linear-gradient(90deg, #F44336, #FF5722)';
    }
}

function updateLastSyncTime(timestamp) {
    const el = document.getElementById('last_sync');
    if (!el) return;
    
    const time = new Date(timestamp);
    el.textContent = time.toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ==================== SYSTEM FUNCTIONS ====================

function updateSystemTime() {
    const el = document.getElementById('systemTime');
    if (!el) return;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const dateString = now.toLocaleDateString('bn-BD', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    el.innerHTML = `
        <span class="time">${timeString}</span><br>
        <small class="date">${dateString}</small>
    `;
}

// ==================== HELPER FUNCTIONS ====================

function updateConnectionUI(isConnected) {
    const indicator = document.getElementById('connectionIndicator');
    const cloudStatus = document.getElementById('cloud_status');
    
    if (indicator) {
        indicator.className = `connection-dot ${isConnected ? 'connected' : 'disconnected'}`;
    }
    
    if (cloudStatus) {
        cloudStatus.textContent = isConnected ? '☁️ ক্লাউড কানেক্টেড' : '☁️ ক্লাউড ডিসকানেক্টেড';
        cloudStatus.style.color = isConnected ? '#4CAF50' : '#F44336';
    }
}

function updateESP32Status(connected) {
    const statusEl = document.querySelector('.network-status');
    if (statusEl) {
        statusEl.textContent = connected ? "কানেক্টেড" : "ডিসকানেক্টেড";
        statusEl.className = `network-status ${connected ? 'connected' : 'disconnected'}`;
    }
}

function startESP32Monitoring() {
    setInterval(checkESP32Connection, 5000);
    checkESP32Connection();
}

function checkESP32Connection() {
    const now = Date.now();
    const timeDiff = now - esp32LastDataTime;
    
    if (esp32LastDataTime > 0 && timeDiff < ESP32_TIMEOUT) {
        if (!esp32Connected) {
            esp32Connected = true;
            updateESP32Status(true);
        }
    } else if (esp32LastDataTime > 0 && timeDiff >= ESP32_TIMEOUT) {
        if (esp32Connected) {
            esp32Connected = false;
            updateESP32Status(false);
            showNotification("ESP32 সংযোগ বিচ্ছিন্ন", "warning");
        }
    }
}

// ==================== NOTIFICATION ====================

function showNotification(message, type = 'info') {
    console.log(`Notification (${type}): ${message}`);
    
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            font-weight: bold;
            z-index: 10000;
            display: none;
            transition: all 0.3s ease;
            max-width: 400px;
            word-wrap: break-word;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        document.body.appendChild(notification);
    }
    
    const colors = {
        'success': '#4CAF50',
        'error': '#F44336',
        'warning': '#FF9800',
        'info': '#2196F3'
    };
    
    notification.textContent = message;
    notification.style.background = colors[type] || '#2196F3';
    notification.style.display = 'block';
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

// ==================== DEBUG FUNCTIONS ====================

function testAllButtons() {
    console.log("🧪 Testing all buttons...");
    
    const buttons = [
        {id: 'autoModeBtn', type: 'mode'},
        {id: 'manualModeBtn', type: 'mode'},
        {id: 'stopModeBtn', type: 'mode'},
        {id: 'brushAutoModeBtn', type: 'brush'},
        {id: 'brushManualModeBtn', type: 'brush'},
        {id: 'brushForwardBtn', type: 'brush'},
        {id: 'brushReverseBtn', type: 'brush'},
        {id: 'brushPumpStopBtn', type: 'brush'},
        {id: 'pumpOnBtn', type: 'pump'},
        {id: 'startCleaningBtn', type: 'auto-clean'},
        {id: 'stopCleaningBtn', type: 'auto-clean'},
        {selector: '.servo-control-btn', type: 'servo', count: document.querySelectorAll('.servo-control-btn').length},
        {selector: '.power-source-btn', type: 'power', count: document.querySelectorAll('.power-source-btn').length}
    ];
    
    buttons.forEach(item => {
        let element;
        if (item.id) {
            element = document.getElementById(item.id);
        } else if (item.selector) {
            const elements = document.querySelectorAll(item.selector);
            element = elements.length > 0 ? elements[0] : null;
        }
        
        if (element) {
            console.log(`✅ ${item.type} button found: ${item.id || item.selector} (${item.count || 1} found)`);
        } else {
            console.log(`❌ ${item.type} button NOT found: ${item.id || item.selector}`);
        }
    });
}

function addDebugButton() {
    // Create debug button
    const debugBtn = document.createElement('button');
    debugBtn.id = 'debugButton';
    debugBtn.innerHTML = '<i class="fas fa-bug"></i> ডিবাগ';
    debugBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        padding: 10px 15px;
        background: #ff9800;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
    
    debugBtn.addEventListener('click', function() {
        debugAutoMode();
    });
    
    document.body.appendChild(debugBtn);
}

// Debug function for auto mode
window.debugAutoMode = function() {
    console.log("=".repeat(60));
    console.log("🐛 AUTO MODE DEBUG INFO");
    console.log("=".repeat(60));
    console.log("Power Mode:", powerMode);
    console.log("Active Power Source:", activePowerSource);
    console.log("Last Power Source:", lastPowerSource);
    console.log("Firebase Connected:", isConnected);
    console.log("ESP32 Connected:", esp32Connected);
    console.log("Auto Interval Running:", autoPowerInterval !== null);
    console.log("Switching in Progress:", isSwitchingInProgress);
    console.log("Time since last switch:", Date.now() - lastSwitchTime, "ms");
    console.log("");
    console.log("📊 CURRENT SENSOR VALUES:");
    console.log("Solar Voltage:", currentSolarVoltage);
    console.log("Battery Voltage:", currentBatteryVoltage);
    console.log("Battery SOC:", currentBatterySOC);
    console.log("Solar Current:", solarCurrent);
    console.log("Battery Current:", batteryCurrent);
    console.log("Load Current:", loadCurrent);
    console.log("");
    console.log("📊 AUTO THRESHOLDS:");
    console.log("SOLAR_MIN_VOLTAGE:", AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE);
    console.log("BATTERY_MIN_VOLTAGE:", AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE);
    console.log("BATTERY_CRITICAL_SOC:", AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC);
    console.log("BATTERY_LOW_SOC:", AUTO_THRESHOLDS.BATTERY_LOW_SOC);
    console.log("SOLAR_BATTERY_DIFF:", AUTO_THRESHOLDS.SOLAR_BATTERY_DIFF);
    console.log("MIN_SOLAR_VOLTAGE_FOR_SWITCH:", AUTO_THRESHOLDS.MIN_SOLAR_VOLTAGE_FOR_SWITCH);
    console.log("GRID_TO_SOLAR_THRESHOLD:", AUTO_THRESHOLDS.GRID_TO_SOLAR_THRESHOLD);
    console.log("SOLAR_TO_GRID_THRESHOLD:", AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD);
    console.log("=".repeat(60));
    
    // Check Firebase data
    if (database && isConnected) {
        database.ref('solar_system/current_data').once("value")
            .then((snapshot) => {
                const data = snapshot.val();
                console.log("📊 Firebase Current Data:", data);
            })
            .catch(error => {
                console.error("❌ Firebase data fetch error:", error);
            });
    }
    
    // Manually trigger auto check
    if (powerMode === 'auto') {
        console.log("🔄 Manually triggering auto check...");
        checkAutoPowerConditions();
    } else {
        console.log("⚠️ Auto mode not active");
    }
};

// ==================== LOGOUT ====================

function logout() {
    if (confirm('আপনি কি লগআউট করতে চান?')) {
        showNotification("লগআউট করা হচ্ছে...", "info");
        
        // Stop auto mode
        stopAllIntervals();
        
        if (auth) {
            auth.signOut().then(() => {
                localStorage.removeItem('solar_user_logged_in');
                localStorage.removeItem('solar_user_email');
                localStorage.removeItem('solar_user_uid');
                window.location.href = 'login.html';
            });
        } else {
            window.location.href = 'login.html';
        }
    }
}


// dashboard.js এ যোগ করুন

// ==================== SAFETY ALERT FUNCTIONS ====================

function showSafetyAlert(type, message, action = null) {
    const alertDiv = document.getElementById('safety_alert');
    if (!alertDiv) return;
    
    const alertTypes = {
        'emergency': 'alert-emergency',
        'warning': 'alert-warning',
        'danger': 'alert-danger',
        'info': 'alert-info'
    };
    
    const icons = {
        'emergency': '⚠️',
        'warning': '🔥',
        'danger': '⚡',
        'info': 'ℹ️'
    };
    
    let actionButton = '';
    if (action) {
        actionButton = `<button onclick="${action.function}">${action.text}</button>`;
    }
    
    alertDiv.innerHTML = `
        <div class="${alertTypes[type] || 'alert-info'}">
            ${icons[type] || 'ℹ️'} <strong>${type.toUpperCase()}:</strong> ${message}
            ${actionButton}
        </div>
    `;
    alertDiv.style.display = 'block';
    
    // অটো হাইড করার টাইমার
    if (type !== 'emergency') {
        setTimeout(() => {
            hideSafetyAlert();
        }, 10000); // 10 সেকেন্ড পর হাইড
    }
}

function hideSafetyAlert() {
    const alertDiv = document.getElementById('safety_alert');
    if (alertDiv) {
        alertDiv.style.display = 'none';
    }
}

// ==================== SAFETY CHECKS ====================

function checkSafetyConditions(data) {
    if (!data) return;
    
    // ১. ব্যাটারি SOC চেক
    if (data.battery_soc < 15) {
        showSafetyAlert('emergency', 
            `ব্যাটারি SOC ${data.battery_soc}%! সিস্টেম বন্ধ হতে পারে`,
            { text: 'গ্রিডে সুইচ', function: 'switchToGridPower()' }
        );
    }
    
    // ২. অতিরিক্ত তাপমাত্রা চেক
    if (data.temperature > 60) {
        showSafetyAlert('danger',
            `তাপমাত্রা ${data.temperature}°C! সিস্টেম গরম`,
            { text: 'ফ্যান চালু', function: 'turnOnCoolingFan()' }
        );
    }
    
    // ৩. অতিরিক্ত কারেন্ট চেক
    if (data.load_current > 20) {
        showSafetyAlert('warning',
            `লোড কারেন্ট ${data.load_current.toFixed(2)}A! অতিরিক্ত লোড`,
            { text: 'লোড কমান', function: 'reduceLoad()' }
        );
    }
    
    // ৪. ভোল্টেজ ফ্লাকচুয়েশন চেক
    if (data.solar_voltage > 18 || data.battery_voltage > 15) {
        showSafetyAlert('danger',
            `ভোল্টেজ বেশি: সোলার ${data.solar_voltage}V, ব্যাটারি ${data.battery_voltage}V`,
            { text: 'সিস্টেম চেক', function: 'checkSystemStatus()' }
        );
    }
}

// ==================== FIREBASE LISTENER এ যোগ করুন ====================

function setupRealtimeListenersCompat() {
    // ... existing code ...
    
    const currentDataRef = database.ref('solar_system/current_data');
    currentDataRef.on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) {
            // ... existing updates ...
            
            // সেফটি চেক করুন
            checkSafetyConditions(data);
        }
    });
    
    // ... rest of the code ...
}

// ==================== ACTION FUNCTIONS ====================

function switchToGridPower() {
    console.log("গ্রিডে সুইচ করা হচ্ছে...");
    controlPowerSource('grid', 'on', 'সুরক্ষা সতর্কতা');
    hideSafetyAlert();
}

function turnOnCoolingFan() {
    console.log("কুলিং ফ্যান চালু করা হচ্ছে...");
    // ফ্যান কন্ট্রোল কোড
    hideSafetyAlert();
}

function reduceLoad() {
    console.log("লোড কমানো হচ্ছে...");
    // লোড রিডিউস কোড
    hideSafetyAlert();
}

function checkSystemStatus() {
    console.log("সিস্টেম স্ট্যাটাস চেক করা হচ্ছে...");
    refreshSystemStatus();
    hideSafetyAlert();
}

// ==================== EXPORT FUNCTIONS ====================

window.startAutoPowerSwitching = startAutoPowerSwitching;
window.stopAutoPowerSwitching = stopAutoPowerSwitching;
window.controlPowerSource = controlPowerSource;
window.switchToSolarPower = switchToSolarPower;
window.switchToBatteryPower = switchToBatteryPower;
window.switchToGridPower = switchToGridPower;
window.emergencyStop = emergencyStop;
window.manualStop = manualStop;
window.logout = logout;
window.testAllButtons = testAllButtons;
window.initControlPanel = initControlPanel;
window.debugAutoMode = debugAutoMode;
window.showNotification = showNotification;
window.switchToMode = switchToMode;
window.refreshSystemStatus = refreshSystemStatus;

console.log("✅ Solar Dashboard script loaded successfully");