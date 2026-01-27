// script.js - Complete Solar Dashboard with Firebase 9.8.0
// ==================== FIREBASE IMPORTS ====================
// ==================== GLOBAL VARIABLES ====================
let database;
let auth;
let isConnected = false;
let esp32Connected = false;
let esp32LastDataTime = 0;
const ESP32_TIMEOUT = 30000;
const COMMAND_COOLDOWN = 1000;
let lastCommandTime = 0;

// Auto mode variables
let autoModeInterval = null;
let autoModeLogs = [];
let autoCheckCounter = 0;
let lastAutoSwitchTime = 0;
const AUTO_SWITCH_COOLDOWN = 30000;

// Mode variables
let powerMode = 'manual';
let activePowerSource = 'grid';
let lastPowerSource = 'grid';
let currentBrushMode = 'auto';
let isSwitchingInProgress = false;

// System status
let brushStatus = 'stopped';
let pumpStatus = 'off';

// Current sensor values
let currentSolarVoltage = 0;
let currentBatteryVoltage = 0;
let currentBatterySOC = 0;

// Chart variables
let voltageChart = null;
let currentChart = null;
let timeLabels = [];
const chartDataPoints = 20;

// Cached DOM elements
let cachedElements = {};

// User variables
let userId = null;

// ==================== MAIN INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 Solar Dashboard loading (Firebase 9.8.0)...");
    
    // Initialize Firebase and dashboard
    initializeDashboard();
});

function initializeDashboard() {
    console.log("📊 Initializing dashboard...");
    
    // Initialize Firebase
    let firebaseInitialized = initializeFirebase();
    
    if (!firebaseInitialized) {
        showNotification("Firebase শুরু করা যায়নি", "error");
        return;
    }
    
    // Check authentication
    checkAuth().then((user) => {
        console.log("✅ User authenticated:", user.email);
        
        // Set user info
        document.getElementById('userEmail').textContent = user.email;
        userId = user.uid;
        
        // Hide auth overlay
        const authOverlay = document.getElementById('authCheckOverlay');
        if (authOverlay) {
            authOverlay.style.display = 'none';
        }
        
        // Show user info
        const userInfoDisplay = document.getElementById('userInfoDisplay');
        if (userInfoDisplay) {
            userInfoDisplay.style.display = 'flex';
        }
        
        // Cache DOM elements
        cacheDOMElements();
        
        // Initialize database connection
        initDatabase();
        
        // Initialize control panel
        setTimeout(() => {
            initControlPanel();
            testAllButtons();
        }, 1000);
        
        // Initialize charts
        setTimeout(initCharts, 1500);
        
        // Update system time
        setInterval(updateSystemTime, 1000);
        updateSystemTime();
        
        console.log("✅ Dashboard initialized successfully");
        
        // Test after 3 seconds
        setTimeout(() => {
            console.log("🧪 Running post-init tests...");
            testFirebaseConnection();
            manualFetchData();
        }, 3000);
        
    }).catch((error) => {
        console.error("❌ Authentication failed:", error);
        showNotification("লগইন প্রয়োজন", "error");
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    });
}

// ==================== FIREBASE INITIALIZATION ====================

function initializeFirebase() {
    try {
        console.log("🔥 Initializing Firebase 9.8.0...");
        
        // Check if firebaseConfig is loaded
        if (typeof firebaseConfig === 'undefined') {
            console.error("❌ Firebase config not loaded");
            showNotification("Firebase কনফিগারেশন নেই", "error");
            return false;
        }
        
        // Initialize Firebase app
        const app = initializeApp(firebaseConfig);
        console.log("✅ Firebase App Initialized");
        
        // Get auth and database instances
        auth = getAuth(app);
        database = getDatabase(app);
        
        if (!database) {
            showNotification("ডাটাবেস লোড করতে সমস্যা", "error");
            return false;
        }
        
        console.log("✅ Firebase initialized successfully");
        return true;
        
    } catch (error) {
        console.error("Firebase initialization error:", error);
        showNotification("Firebase ত্রুটি: " + error.message, "error");
        return false;
    }
}

function checkAuth() {
    return new Promise((resolve, reject) => {
        console.log("🔐 Checking authentication...");
        
        // Check if user is logged in via localStorage
        const isLoggedIn = localStorage.getItem('solar_user_logged_in') === 'true';
        const userEmail = localStorage.getItem('solar_user_email');
        const userUid = localStorage.getItem('solar_user_uid');
        
        if (isLoggedIn && userEmail && userUid) {
            console.log("✅ User authenticated from localStorage:", userEmail);
            
            // Create a mock user object
            const mockUser = {
                email: userEmail,
                uid: userUid
            };
            resolve(mockUser);
            return;
        }
        
        // Check Firebase auth
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            
            if (user) {
                console.log("✅ User authenticated via Firebase:", user.email);
                
                // Save user info to localStorage
                localStorage.setItem('solar_user_logged_in', 'true');
                localStorage.setItem('solar_user_email', user.email);
                localStorage.setItem('solar_user_uid', user.uid);
                
                resolve(user);
            } else {
                console.log("❌ No authenticated user found");
                reject(new Error("No authenticated user"));
            }
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
            unsubscribe();
            reject(new Error("Auth check timeout"));
        }, 5000);
    });
}

// ==================== DATABASE CONNECTION ====================

function initDatabase() {
    if (!database) {
        console.error("❌ Database not available");
        showNotification("ডাটাবেস লোড হয়নি", "error");
        return;
    }
    
    console.log("📡 Setting up database connection...");
    
    // Monitor connection state
    const connectedRef = ref(database, ".info/connected");
    
    onValue(connectedRef, (snap) => {
        const wasConnected = isConnected;
        isConnected = (snap.val() === true);
        
        console.log(`📊 Firebase Connection: ${isConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
        
        if (isConnected && !wasConnected) {
            console.log("✅ Firebase Database Connected");
            showNotification("Firebase সংযোগ সফল", "success");
            updateConnectionUI(true);
            
            // Test database access
            testDatabaseRead();
            
            // Setup real-time listeners
            setupRealtimeListeners();
            
        } else if (!isConnected && wasConnected) {
            console.log("❌ Firebase Database Disconnected");
            showNotification("Firebase সংযোগ বিচ্ছিন্ন", "warning");
            updateConnectionUI(false);
        }
    }, (error) => {
        console.error("Connection monitoring error:", error);
    });
}

// ==================== TEST DATABASE READ ====================

function testDatabaseRead() {
    console.log("🔍 Testing database read access...");
    
    const solarSystemRef = ref(database, "solar_system");
    
    get(solarSystemRef)
        .then(snapshot => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                console.log("✅ Database path 'solar_system' exists");
                console.log("📊 Database structure:", Object.keys(data));
                
                // Check current_data
                if (data.current_data) {
                    console.log("✅ current_data found");
                    console.log("Data:", data.current_data);
                    
                    // Update UI immediately
                    updateDashboard(data.current_data);
                    
                    // Update sensor values
                    updateSensorValues(data.current_data);
                    
                } else {
                    console.warn("⚠️ current_data not found in database");
                    createSampleData();
                }
                
            } else {
                console.warn("⚠️ Database path 'solar_system' does not exist");
                createInitialDatabaseStructure();
            }
        })
        .catch(error => {
            console.error("❌ Database read test failed:", error);
        });
}

// ==================== CREATE DATA IF MISSING ====================

function createInitialDatabaseStructure() {
    console.log("📝 Creating initial database structure...");
    
    const initialData = {
        current_data: {
            solar_voltage: 12.5,
            solar_current: 2.3,
            battery_voltage: 13,
            battery_current: 1,
            load_voltage: 12.1,
            load_current: 3.8,
            battery_soc: 40,
            dust_level: 45.3,
            total_energy: 1250,
            efficiency: 95,
            humidity: 65.8,
            relay1_state: true,
            relay2_state: false,
            timestamp: Date.now()
        },
        system_status: {
            mode: "manual",
            power_source: "grid",
            brush_status: "stopped",
            pump_status: "off",
            last_update: Date.now()
        },
        alerts: {
            alert1: {
                message: "সিস্টেম শুরু হয়েছে",
                level: "info",
                timestamp: Date.now()
            }
        }
    };
    
    set(ref(database, "solar_system"), initialData)
        .then(() => {
            console.log("✅ Initial database structure created");
            showNotification("প্রাথমিক ডাটা তৈরি করা হয়েছে", "success");
        })
        .catch(error => {
            console.error("❌ Failed to create initial data:", error);
        });
}

function createSampleData() {
    console.log("📝 Creating sample current_data...");
    
    const sampleData = {
        solar_voltage: 12.5 + (Math.random() * 2 - 1),
        solar_current: 2.3 + (Math.random() * 0.5 - 0.25),
        battery_voltage: 13 + (Math.random() * 0.3 - 0.15),
        battery_current: 1 + (Math.random() * 0.2 - 0.1),
        load_voltage: 12.1 + (Math.random() * 0.3 - 0.15),
        load_current: 3.8 + (Math.random() * 0.4 - 0.2),
        battery_soc: 40 + (Math.random() * 10 - 5),
        dust_level: 45.3 + (Math.random() * 10 - 5),
        total_energy: 1250 + Math.random() * 50,
        efficiency: 95 + (Math.random() * 5 - 2.5),
        humidity: 65.8 + (Math.random() * 10 - 5),
        relay1_state: Math.random() > 0.5,
        relay2_state: Math.random() > 0.5,
        timestamp: Date.now()
    };
    
    set(ref(database, "solar_system/current_data"), sampleData)
        .then(() => {
            console.log("✅ Sample data created:", sampleData);
            updateDashboard(sampleData);
        })
        .catch(error => {
            console.error("❌ Failed to create sample data:", error);
        });
}

// ==================== REALTIME LISTENERS ====================

function setupRealtimeListeners() {
    if (!database) {
        console.error("❌ Database not available for listeners");
        return;
    }
    
    console.log("📡 Setting up Firebase listeners...");
    
    try {
        // Current data listener
        const currentDataRef = ref(database, 'solar_system/current_data');
        onValue(currentDataRef, (snapshot) => {
            console.log("🎯 current_data listener TRIGGERED!");
            
            const data = snapshot.val();
            
            if (data) {
                console.log("✅ Data received from Firebase");
                
                esp32LastDataTime = Date.now();
                esp32Connected = true;
                updateESP32Status(true);
                
                // Update sensor values
                updateSensorValues(data);
                
                // Update dashboard
                updateDashboard(data);
                
                // Update charts
                updateCharts(data);
                
            } else {
                console.warn("⚠️ No data received");
            }
        }, (error) => {
            console.error("❌ current_data listener error:", error);
        });
        
        // System status listener
        const systemStatusRef = ref(database, 'solar_system/system_status');
        onValue(systemStatusRef, (snapshot) => {
            console.log("📊 System status listener triggered");
            const status = snapshot.val();
            
            if (status) {
                console.log("✅ System status:", status);
                
                if (status.brush_status) {
                    brushStatus = status.brush_status;
                    updateBrushStatus();
                }
                
                if (status.pump_status) {
                    pumpStatus = status.pump_status;
                    updatePumpStatus();
                }
                
                if (status.power_source) {
                    activePowerSource = status.power_source;
                    updatePowerFlow(activePowerSource);
                }
                
                if (status.mode) {
                    powerMode = status.mode;
                    updateModeUI(powerMode);
                }
            }
        });
        
        console.log("✅ All Firebase listeners setup complete");
        
    } catch (error) {
        console.error("Listener setup error:", error);
    }
    
    // Start ESP32 monitoring
    startESP32Monitoring();
}

// ==================== CONTROL PANEL ====================

function initControlPanel() {
    console.log("🔄 Initializing control panel...");
    
    // Mode buttons
    const autoModeBtn = document.getElementById('autoModeBtn');
    const manualModeBtn = document.getElementById('manualModeBtn');
    const stopModeBtn = document.getElementById('stopModeBtn');
    
    if (autoModeBtn) {
        autoModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Auto Mode button clicked");
            startAutoMode();
        });
    }
    
    if (manualModeBtn) {
        manualModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Manual Mode button clicked");
            stopAutoMode();
            powerMode = 'manual';
            updateModeUI('manual');
            showNotification('ম্যানুয়াল মোড চালু করা হয়েছে', 'info');
        });
    }
    
    if (stopModeBtn) {
        stopModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Stop Mode button clicked");
            if (confirm('সিস্টেম বন্ধ করতে চান?')) {
                emergencyStop();
            }
        });
    }
    
    // Power source buttons
    const powerSourceBtns = document.querySelectorAll('.power-source-btn');
    powerSourceBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const source = this.dataset.source;
            const state = this.dataset.state || 'on';
            console.log("Power source clicked:", source, state);
            
            if (powerMode === 'stop') {
                showNotification('সিস্টেম বন্ধ আছে', 'warning');
                return;
            }
            
            controlPowerSource(source, state);
        });
    });
    
    // Brush controls
    const brushAutoModeBtn = document.getElementById('brushAutoModeBtn');
    const brushManualModeBtn = document.getElementById('brushManualModeBtn');
    const autoBrushControl = document.getElementById('autoBrushControl');
    const manualBrushControl = document.getElementById('manualBrushControl');
    
    if (brushAutoModeBtn) {
        brushAutoModeBtn.addEventListener('click', function() {
            console.log("Brush Auto Mode clicked");
            currentBrushMode = 'auto';
            brushAutoModeBtn.classList.add('active');
            if (brushManualModeBtn) brushManualModeBtn.classList.remove('active');
            
            if (autoBrushControl) autoBrushControl.style.display = 'block';
            if (manualBrushControl) manualBrushControl.style.display = 'none';
            
            sendCloudCommand('set_brush_mode', { mode: 'auto' });
            showNotification('অটো ব্রাশ মোড', 'info');
        });
        
        // Set auto mode as default
        brushAutoModeBtn.classList.add('active');
    }
    
    if (brushManualModeBtn) {
        brushManualModeBtn.addEventListener('click', function() {
            console.log("Brush Manual Mode clicked");
            currentBrushMode = 'manual';
            if (brushAutoModeBtn) brushAutoModeBtn.classList.remove('active');
            brushManualModeBtn.classList.add('active');
            
            if (autoBrushControl) autoBrushControl.style.display = 'none';
            if (manualBrushControl) manualBrushControl.style.display = 'block';
            
            sendCloudCommand('set_brush_mode', { mode: 'manual' });
            showNotification('ম্যানুয়াল ব্রাশ মোড', 'info');
        });
    }
    
    // Brush direction controls
    const brushForwardBtn = document.getElementById('brushForwardBtn');
    const brushReverseBtn = document.getElementById('brushReverseBtn');
    const pumpOnBtn = document.getElementById('pumpOnBtn');
    const brushPumpStopBtn = document.getElementById('brushPumpStopBtn');
    
    if (brushForwardBtn) {
        brushForwardBtn.addEventListener('click', function() {
            console.log("Brush Forward clicked");
            sendCloudCommand('brush_forward');
            brushStatus = 'forward';
            updateBrushStatus();
        });
    }
    
    if (brushReverseBtn) {
        brushReverseBtn.addEventListener('click', function() {
            console.log("Brush Reverse clicked");
            sendCloudCommand('brush_reverse');
            brushStatus = 'reverse';
            updateBrushStatus();
        });
    }
    
    if (pumpOnBtn) {
        pumpOnBtn.addEventListener('click', function() {
            console.log("Pump ON clicked");
            sendCloudCommand('pump_on');
            pumpStatus = 'on';
            updatePumpStatus();
        });
    }
    
    if (brushPumpStopBtn) {
        brushPumpStopBtn.addEventListener('click', function() {
            console.log("Brush/Pump Stop clicked");
            sendCloudCommand('brush_pump_stop');
            brushStatus = 'stopped';
            pumpStatus = 'off';
            updateBrushStatus();
            updatePumpStatus();
        });
    }
    
    // Auto cleaning controls
    const startCleaningBtn = document.getElementById('startCleaningBtn');
    const stopCleaningBtn = document.getElementById('stopCleaningBtn');
    
    if (startCleaningBtn) {
        startCleaningBtn.addEventListener('click', function() {
            console.log("Start Cleaning clicked");
            const duration = document.getElementById('cleaningDuration')?.value || 30;
            const interval = document.getElementById('cleaningInterval')?.value || 6;
            
            sendCloudCommand('start_cleaning', { duration, interval });
            showNotification('অটো পরিষ্কার শুরু', 'success');
        });
    }
    
    if (stopCleaningBtn) {
        stopCleaningBtn.addEventListener('click', function() {
            console.log("Stop Cleaning clicked");
            sendCloudCommand('stop_cleaning');
            showNotification('পরিষ্কার বন্ধ', 'warning');
        });
    }
    
    // Servo controls
    const servoControlBtns = document.querySelectorAll('.servo-control-btn');
    servoControlBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const direction = this.dataset.direction;
            const angle = this.dataset.angle || 5;
            console.log("Servo control:", direction, angle);
            sendCloudCommand('control_servo', { direction, angle });
        });
    });
    
    console.log("✅ Control panel initialized");
}

// ==================== AUTO MODE ====================

function startAutoMode() {
    console.log("🚀 Starting Auto Mode...");
    
    if (powerMode === 'auto') {
        showNotification('ইতিমধ্যে অটো মোডে আছেন', 'info');
        return;
    }
    
    powerMode = 'auto';
    updateModeUI('auto');
    
    sendCloudCommand('set_mode', { 
        value: 'auto',
        timestamp: Date.now()
    });
    
    // Start auto mode interval
    if (autoModeInterval) {
        clearInterval(autoModeInterval);
    }
    
    autoModeInterval = setInterval(() => {
        checkAutoPowerConditions();
    }, 10000);
    
    showNotification('অটো মোড শুরু করা হয়েছে', 'success');
    
    console.log("✅ Auto Mode started successfully");
}

function stopAutoMode() {
    console.log("⏹️ Stopping Auto Mode...");
    
    if (autoModeInterval) {
        clearInterval(autoModeInterval);
        autoModeInterval = null;
    }
    
    powerMode = 'manual';
    updateModeUI('manual');
    
    sendCloudCommand('set_mode', { 
        value: 'manual'
    });
    
    showNotification('অটো মোড বন্ধ করা হয়েছে', 'warning');
}

function checkAutoPowerConditions() {
    if (powerMode !== 'auto') return;
    
    console.log("🔍 Auto Mode: Checking conditions...");
    console.log(`Solar: ${currentSolarVoltage}V, Battery: ${currentBatteryVoltage}V, SOC: ${currentBatterySOC}%`);
    
    // Simple auto logic
    if (currentSolarVoltage > 13 && currentSolarVoltage > currentBatteryVoltage + 0.5) {
        if (activePowerSource !== 'solar') {
            console.log("🔄 Switching to solar");
            controlPowerSource('solar');
        }
    } else if (currentBatteryVoltage > 12.2 && currentBatterySOC > 30) {
        if (activePowerSource !== 'battery') {
            console.log("🔄 Switching to battery");
            controlPowerSource('battery');
        }
    } else {
        if (activePowerSource !== 'grid') {
            console.log("🔄 Switching to grid");
            controlPowerSource('grid');
        }
    }
}

// ==================== POWER CONTROL ====================

function controlPowerSource(source, state = 'on') {
    if (!database || !isConnected) {
        showNotification('Firebase সংযোগ নেই', 'error');
        return;
    }
    
    const command = {
        action: 'set_power_source',
        source: source,
        state: state,
        timestamp: Date.now(),
        userId: userId || 'web_user'
    };
    
    console.log('Sending power command:', command);
    
    set(ref(database, "solar_system/commands"), command)
        .then(() => {
            console.log('✅ Power command sent:', command);
            
            if (state === 'on' && source !== 'all') {
                activePowerSource = source;
                lastPowerSource = source;
                
                const sourceNames = {
                    'solar': 'সোলার',
                    'battery': 'ব্যাটারি',
                    'grid': 'গ্রিড'
                };
                
                const modeText = powerMode === 'auto' ? ' (অটো)' : ' (ম্যানুয়াল)';
                const currentPowerSourceEl = document.getElementById('currentPowerSource');
                if (currentPowerSourceEl) {
                    currentPowerSourceEl.textContent = 
                        sourceNames[source] + ' → লোড' + modeText;
                    
                    const colors = {
                        'solar': '#FF9800',
                        'battery': '#4CAF50',
                        'grid': '#2196F3'
                    };
                    currentPowerSourceEl.style.color = colors[source] || '#000';
                }
                
                updatePowerFlow(source);
                showNotification(`${sourceNames[source]} চালু করা হয়েছে`, 'success');
            } else if (source === 'all' && state === 'off') {
                activePowerSource = 'off';
                const currentPowerSourceEl = document.getElementById('currentPowerSource');
                if (currentPowerSourceEl) {
                    currentPowerSourceEl.textContent = 'বন্ধ';
                    currentPowerSourceEl.style.color = '#F44336';
                }
                showNotification('সব পাওয়ার সোর্স বন্ধ করা হয়েছে', 'warning');
            }
        })
        .catch(error => {
            console.error('❌ Power command error:', error);
            showNotification('কমান্ড পাঠাতে সমস্যা', 'error');
        });
}

// ==================== UI UPDATE FUNCTIONS ====================

function updateModeUI(mode) {
    console.log("Updating mode UI to:", mode);
    
    const autoBtn = document.getElementById('autoModeBtn');
    const manualBtn = document.getElementById('manualModeBtn');
    const stopBtn = document.getElementById('stopModeBtn');
    const panel = document.getElementById('manualControlPanel');
    
    // Update button states
    if (autoBtn) autoBtn.classList.toggle('active', mode === 'auto');
    if (manualBtn) manualBtn.classList.toggle('active', mode === 'manual');
    if (stopBtn) stopBtn.classList.toggle('active', mode === 'stop');
    
    // Show/hide manual control panel
    if (panel) {
        panel.style.display = mode === 'manual' ? 'block' : 'none';
    }
    
    // Update mode indicator
    updateModeIndicator();
}

function updateModeIndicator() {
    const indicator = document.getElementById('mode_indicator');
    if (!indicator) return;
    
    const texts = {
        'auto': 'অটো মোড',
        'manual': 'ম্যানুয়াল',
        'stop': 'বন্ধ'
    };
    
    indicator.textContent = texts[powerMode] || powerMode;
    indicator.className = `${powerMode}-indicator`;
}

function updatePowerFlow(source) {
    const diagram = document.getElementById('powerFlowDiagram');
    if (!diagram) return;
    
    diagram.className = 'power-flow-path';
    
    // Reset all
    diagram.querySelectorAll('.path-item').forEach(item => {
        item.style.background = '#f5f5f5';
        item.style.color = '#999';
        item.style.opacity = '0.7';
    });
    
    diagram.querySelectorAll('.path-arrow').forEach(arrow => {
        arrow.style.color = '#666';
    });
    
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
        sourceItem.style.background = color;
        sourceItem.style.color = 'white';
        sourceItem.style.opacity = '1';
    }
    
    if (loadItem) {
        loadItem.style.background = color;
        loadItem.style.color = 'white';
        loadItem.style.opacity = '1';
    }
    
    if (arrow) arrow.style.color = color;
    
    diagram.classList.add(`${source}-active`);
}

// ==================== BRUSH AND PUMP STATUS ====================

function updateBrushStatus() {
    console.log("Updating brush status:", brushStatus);
    const statusEl = document.getElementById('brushStatus');
    const dirEl = document.getElementById('brushDirection');
    
    if (statusEl) {
        statusEl.textContent = brushStatus === 'stopped' ? 'বন্ধ' : 'চলছে';
        statusEl.style.color = brushStatus === 'stopped' ? '#F44336' : '#4CAF50';
    }
    
    if (dirEl) {
        dirEl.textContent = brushStatus === 'forward' ? 'ফরওয়ার্ড' : 
                          brushStatus === 'reverse' ? 'রিভার্স' : '-';
        dirEl.style.color = brushStatus === 'forward' ? '#2196F3' : 
                          brushStatus === 'reverse' ? '#FF9800' : '#666';
    }
}

function updatePumpStatus() {
    console.log("Updating pump status:", pumpStatus);
    const statusEl = document.getElementById('pumpStatus');
    if (statusEl) {
        statusEl.textContent = pumpStatus === 'on' ? 'চালু' : 'বন্ধ';
        statusEl.style.color = pumpStatus === 'on' ? '#4CAF50' : '#F44336';
    }
}

// ==================== DASHBOARD UPDATES ====================

function updateDashboard(data) {
    if (!data) return;
    
    console.log("📊 Updating dashboard with data:", data);
    
    const format = (value, decimals = 2) => {
        const num = parseFloat(value);
        return isNaN(num) ? "0.00" : num.toFixed(decimals);
    };
    
    // Update solar values
    updateElements('.solar_v', format(data.solar_voltage || 12.5), 'V');
    updateElements('.solar_a', format(data.solar_current || 2.3), 'A');
    updateElements('.solar_w', format((data.solar_voltage || 12.5) * (data.solar_current || 2.3)), 'W');
    
    // Update battery values
    updateElements('.battery_v', format(data.battery_voltage || 13), 'V');
    updateElements('.battery_a', format(data.battery_current || 1), 'A');
    updateElements('.battery_w', format((data.battery_voltage || 13) * (data.battery_current || 1)), 'W');
    updateElements('.battery_soc', format(data.battery_soc || 40, 1), '%');
    
    // Update load values
    updateElements('.load_v', format(data.load_voltage || 12.1), 'V');
    updateElements('.load_a', format(data.load_current || 3.8), 'A');
    updateElements('.load_w', format((data.load_voltage || 12.1) * (data.load_current || 3.8)), 'W');
    
    // Update other values
    updateElementById('total_energy', format(data.total_energy || 1250), 'Wh');
    updateElementById('efficiency', format(data.efficiency || 95, 1), '%');
    updateElementById('dust', format(data.dust_level || 45.3), 'μg/m³');
    updateElementById('humidity', format(data.humidity || 65.8, 1), '%');
    
    // Update relay status
    updateRelayStatus(data);
    
    // Update battery progress
    updateBatteryProgress(data.battery_soc || 40);
    
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

function updateRelayStatus(data) {
    const relay1El = document.getElementById('relay1_status');
    const relay2El = document.getElementById('relay2_status');
    
    if (relay1El) {
        const isOn = data.relay1_state === true || data.relay1_state === 'true';
        relay1El.textContent = isOn ? 'ON' : 'OFF';
        relay1El.className = isOn ? 'relay-status on' : 'relay-status off';
        relay1El.style.color = isOn ? '#4CAF50' : '#F44336';
    }
    
    if (relay2El) {
        const isOn = data.relay2_state === true || data.relay2_state === 'true';
        relay2El.textContent = isOn ? 'ON' : 'OFF';
        relay2El.className = isOn ? 'relay-status on' : 'relay-status off';
        relay2El.style.color = isOn ? '#4CAF50' : '#F44336';
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

// ==================== SENSOR VALUES UPDATE ====================

function updateSensorValues(data) {
    currentSolarVoltage = parseFloat(data.solar_voltage) || 0;
    currentBatteryVoltage = parseFloat(data.battery_voltage) || 13;
    currentBatterySOC = parseFloat(data.battery_soc) || 40;
    
    console.log(`📊 Sensor Update: 
        Solar=${currentSolarVoltage}V, 
        Battery=${currentBatteryVoltage}V, 
        SOC=${currentBatterySOC}%`);
}

// ==================== SYSTEM FUNCTIONS ====================

function updateSystemTime() {
    const el = document.getElementById('systemTime');
    if (!el) return;
    
    const now = new Date();
    el.textContent = now.toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function emergencyStop() {
    powerMode = 'stop';
    
    sendCloudCommand('emergency_stop', {
        reason: 'User initiated'
    });
    
    controlPowerSource('all', 'off');
    sendCloudCommand('brush_pump_stop');
    
    updateModeUI('stop');
    showNotification('সিস্টেম বন্ধ করা হয়েছে', 'warning');
}

// ==================== HELPER FUNCTIONS ====================

function cacheDOMElements() {
    cachedElements = {
        currentPowerSource: document.getElementById('currentPowerSource'),
        batteryProgressBar: document.getElementById('batteryProgressBar'),
        modeIndicator: document.getElementById('mode_indicator'),
        powerFlowDiagram: document.getElementById('powerFlowDiagram'),
        userEmail: document.getElementById('userEmail'),
        connectionIndicator: document.getElementById('connectionIndicator'),
        cloudStatus: document.getElementById('cloud_status')
    };
}

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

// ==================== SEND COMMAND ====================

function sendCloudCommand(action, data = {}) {
    const now = Date.now();
    
    if (now - lastCommandTime < COMMAND_COOLDOWN) {
        showNotification("অপেক্ষা করুন...", "warning");
        return Promise.resolve(false);
    }
    
    lastCommandTime = now;
    
    if (!isConnected) {
        showNotification("ক্লাউড সংযোগ নেই", "error");
        console.error("❌ Cannot send command: No database connection");
        return Promise.resolve(false);
    }
    
    const command = {
        action,
        ...data,
        timestamp: now,
        userId: userId || 'unknown'
    };
    
    console.log("📤 Sending command:", command);
    
    return set(ref(database, 'solar_system/commands'), command)
        .then(() => {
            console.log("✅ Command sent successfully");
            showNotification("কমান্ড পাঠানো হয়েছে", "success");
            return true;
        })
        .catch(error => {
            console.error("❌ Command failed:", error);
            showNotification("কমান্ড ব্যর্থ: " + error.message, "error");
            return false;
        });
}

// ==================== NOTIFICATION ====================

function showNotification(message, type = 'info') {
    console.log(`Notification (${type}): ${message}`);
    
    // Create notification element if not exists
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
        `;
        document.body.appendChild(notification);
    }
    
    // Set style based on type
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
    
    // Show animation
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Hide after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

// ==================== DEBUG FUNCTIONS ====================

function manualFetchData() {
    console.log("🔄 Manually fetching data...");
    
    if (!database) {
        console.error("❌ No database");
        showNotification("ডাটাবেস নেই", "error");
        return;
    }
    
    get(ref(database, 'solar_system/current_data'))
        .then(snapshot => {
            const data = snapshot.val();
            console.log("📊 Manual fetch data:", data);
            
            if (data) {
                updateDashboard(data);
                showNotification("ডাটা ম্যানুয়ালি লোড করা হয়েছে", "success");
            } else {
                showNotification("কোনো ডাটা নেই", "warning");
            }
        })
        .catch(error => {
            console.error("❌ Manual fetch error:", error);
            showNotification("ডাটা লোড ব্যর্থ: " + error.message, "error");
        });
}

function testFirebaseConnection() {
    console.log("🧪 Testing Firebase connection...");
    
    if (!database) {
        showNotification("ডাটাবেস নেই", "error");
        return;
    }
    
    set(ref(database, "test_connection"), {
        test: "connection_test",
        timestamp: Date.now(),
        user: userId
    })
    .then(() => {
        console.log("✅ Write test successful");
        showNotification("ডাটাবেস লেখা সফল", "success");
        
        return get(ref(database, "test_connection"));
    })
    .then(snapshot => {
        console.log("✅ Read test successful:", snapshot.val());
        showNotification("ডাটাবেস পড়া সফল", "success");
        
        // Clean up
        set(ref(database, "test_connection"), null);
    })
    .catch(error => {
        console.error("❌ Test failed:", error);
        showNotification("টেস্ট ব্যর্থ: " + error.message, "error");
    });
}

function testAllButtons() {
    console.log("🧪 Testing all buttons...");
    
    const buttons = [
        'autoModeBtn',
        'manualModeBtn', 
        'stopModeBtn',
        'brushAutoModeBtn',
        'brushManualModeBtn',
        'brushForwardBtn',
        'brushReverseBtn',
        'pumpOnBtn',
        'brushPumpStopBtn',
        'startCleaningBtn',
        'stopCleaningBtn'
    ];
    
    buttons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            console.log(`✅ Button found: ${btnId}`);
        } else {
            console.log(`❌ Button not found: ${btnId}`);
        }
    });
    
    const powerBtns = document.querySelectorAll('.power-source-btn');
    console.log(`✅ Found ${powerBtns.length} power source buttons`);
    
    const servoBtns = document.querySelectorAll('.servo-control-btn');
    console.log(`✅ Found ${servoBtns.length} servo control buttons`);
}

// ==================== CHART FUNCTIONS ====================

function initCharts() {
    console.log("📈 Initializing charts...");
    
    if (typeof Chart === 'undefined') {
        console.log("Chart.js not loaded, loading now...");
        loadChartJS();
        return;
    }
    
    try {
        // Voltage Chart
        const voltageCtx = document.getElementById('voltageChart');
        if (voltageCtx) {
            voltageChart = new Chart(voltageCtx, {
                type: 'line',
                data: {
                    labels: timeLabels,
                    datasets: [
                        {
                            label: 'সোলার ভোল্টেজ (V)',
                            data: [],
                            borderColor: '#FF9800',
                            backgroundColor: 'rgba(255, 152, 0, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'ব্যাটারি ভোল্টেজ (V)',
                            data: [],
                            borderColor: '#4CAF50',
                            backgroundColor: 'rgba(76, 175, 80, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'লোড ভোল্টেজ (V)',
                            data: [],
                            borderColor: '#2196F3',
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                usePointStyle: true
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            title: {
                                display: true,
                                text: 'ভোল্টেজ (V)'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'সময়'
                            }
                        }
                    }
                }
            });
        }
        
        console.log("✅ Charts initialized");
        
    } catch (error) {
        console.error("❌ Chart initialization error:", error);
    }
}

function loadChartJS() {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.onload = function() {
        console.log("Chart.js loaded successfully");
        initCharts();
    };
    document.head.appendChild(script);
}

function updateCharts(data) {
    if (!voltageChart) return;
    
    try {
        const now = new Date().toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        timeLabels.push(now);
        
        voltageChart.data.datasets[0].data.push(parseFloat(data.solar_voltage) || 0);
        voltageChart.data.datasets[1].data.push(parseFloat(data.battery_voltage) || 0);
        voltageChart.data.datasets[2].data.push(parseFloat(data.load_voltage) || 0);
        
        if (timeLabels.length > chartDataPoints) {
            timeLabels.shift();
            voltageChart.data.datasets.forEach(dataset => dataset.data.shift());
        }
        
        voltageChart.update();
        
    } catch (error) {
        console.error("Error updating charts:", error);
    }
}

// ==================== LOGOUT ====================

function logout() {
    if (confirm('আপনি কি লগআউট করতে চান?')) {
        showNotification("লগআউট করা হচ্ছে...", "info");
        
        if (auth) {
            signOut(auth).then(() => {
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

// ==================== EXPORT FUNCTIONS ====================

window.startAutoMode = startAutoMode;
window.stopAutoMode = stopAutoMode;
window.controlPowerSource = controlPowerSource;
window.sendCloudCommand = sendCloudCommand;
window.emergencyStop = emergencyStop;
window.logout = logout;
window.testFirebaseConnection = testFirebaseConnection;
window.manualFetchData = manualFetchData;
window.testAllButtons = testAllButtons;
window.initControlPanel = initControlPanel;

console.log("✅ Solar Dashboard script loaded successfully (Firebase 9.8.0)");