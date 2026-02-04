// dashboard.js - Complete Solar Smart Controller Dashboard
// All features working - Energy, History, Alerts, Charts, Power Control
// Firebase Only - No Local Storage

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
const MIN_SWITCH_INTERVAL = 10000; // 10 seconds minimum between isSwitchingInProgress
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

// Energy calculation
let totalEnergyWh = 0;
let lastEnergyUpdateTime = 0;
const ENERGY_UPDATE_INTERVAL = 5000; // 5 seconds

// User variables
let userId = null;
let userEmail = null;

// Auto mode thresholds - UPDATED FOR SOLAR PRIORITY
const AUTO_THRESHOLDS = {
    SOLAR_MIN_VOLTAGE: 12.0,
    BATTERY_MIN_VOLTAGE: 11.5,
    BATTERY_CRITICAL_SOC: 20,
    BATTERY_LOW_SOC: 30,
    SOLAR_BATTERY_DIFF: 0.5,
    HYSTERESIS: 0.3,  // Increased to prevent frequent switching
    DATA_TIMEOUT: 60000,
    MIN_SOLAR_VOLTAGE_FOR_SWITCH: 13.0,
    GRID_TO_SOLAR_THRESHOLD: 1.0,
    SOLAR_TO_GRID_THRESHOLD: 11.5,  // Increased from 10.0V to 11.5V
    BATTERY_TO_GRID_THRESHOLD: 11.0,
    SOLAR_MIN_FOR_OPERATION: 12.5,  // New: Minimum solar voltage to stay on solar
    SOLAR_PRIORITY_MODE: true  // New: Solar priority mode enabled
};

// Button state management
let buttonStates = {
    mode: { auto: false, manual: false, stop: false },
    power: { solar: false, battery: false, grid: false, auto: false, all_off: false, stop: false },
    brush: { auto: false, manual: false, forward: false, reverse: false, stop: false },
    pump: { on: false, off: false },
    cleaning: { start: false, stop: false }
};

// Chart variables
let voltageChart = null;
let currentChart = null;
let timeLabels = [];
const chartDataPoints = 20;

// Firebase Connection Manager
let firebaseConnectionManager = null;
let lastAutoCheckTime = 0;
let autoModeStartTime = 0;
let retryCount = 0;
const MAX_RETRY_COUNT = 3;

// Solar priority tracking
let solarPriorityBlockCount = 0;
let lastSolarPriorityBlockTime = 0;

// Alerts system
let alerts = [];
const MAX_ALERTS = 10;

// ==================== MAIN INITIALIZATION ====================

function initializeDashboard() {
    console.log("🚀 Solar Dashboard initializing...");
    
    // Clear any existing intervals first
    stopAllIntervals();
    
    // Initialize Firebase
    if (!initializeFirebase()) {
        showNotification("Firebase শুরু করা যায়নি", "error");
        return;
    }
    
    // Setup the dashboard
    setupDashboard();
}

function initializeFirebase() {
    try {
        console.log("🔥 Initializing Firebase...");
        
        if (typeof firebase === 'undefined') {
            console.error("❌ Firebase SDK not loaded");
            showNotification("Firebase SDK লোড হয়নি", "error");
            return false;
        }
        
        if (typeof firebaseConfig === 'undefined') {
            console.error("❌ Firebase config not loaded");
            showNotification("Firebase কনফিগারেশন নেই", "error");
            return false;
        }
        
        // Initialize Firebase app if not already
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("✅ Firebase app initialized");
        }
        
        // Get Firebase instances
        auth = firebase.auth();
        database = firebase.database();
        
        if (!database || !auth) {
            showNotification("Firebase সেবা লোড করতে সমস্যা", "error");
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

function setupDashboard() {
    console.log("🔧 Setting up dashboard...");
    
    // Check user authentication from Firebase
    if (!auth) {
        console.error("❌ Firebase Auth not available");
        return;
    }
    
    const currentUser = auth.currentUser;
    if (!currentUser) {
        console.log("❌ No user authenticated");
        return;
    }
    
    // Set user info
    userEmail = currentUser.email;
    userId = currentUser.uid;
    
    console.log("✅ User authenticated:", userEmail);
    
    // Initialize Firebase Connection Manager
    initializeFirebaseConnection();
    
    // Initialize database connection
    initDatabaseConnection();
    
    // Start energy calculation
    startEnergyCalculation();
    
    // Create solar priority indicator
    createSolarPriorityIndicator();
    
    // Initialize control panel
    setTimeout(() => {
        initControlPanel();
        testAllButtons();
        
        // Start with manual mode
        updateModeUI('manual');
        updatePowerButtonsUI();
        
        // Update system time
        setInterval(updateSystemTime, 1000);
        updateSystemTime();
        
        // Initialize alerts system
        initAlertsSystem();
        
        // Initialize charts
        initCharts();
        
        console.log("✅ Dashboard setup complete");
        
    }, 1000);
}

// ==================== FIREBASE CONNECTION MANAGER ====================

class FirebaseConnectionManager {
    constructor() {
        this.isConnected = false;
        this.lastConnectionTime = null;
        this.connectionCheckInterval = null;
        this.databaseRef = null;
        this.connectionRef = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        this.initConnectionMonitoring();
    }
    
    initConnectionMonitoring() {
        try {
            // Check Firebase availability
            if (!firebase || !firebase.database) {
                this.updateConnectionUI(false, 'Firebase SDK লোড হয়নি');
                return;
            }
            
            // Get database reference
            const database = firebase.database();
            this.databaseRef = database.ref();
            
            // Monitor connection state
            this.connectionRef = database.ref('.info/connected');
            
            this.connectionRef.on('value', (snapshot) => {
                const connected = snapshot.val() === true;
                this.isConnected = connected;
                
                if (connected) {
                    this.handleConnected();
                } else {
                    this.handleDisconnected();
                }
            });
            
            // Monitor connection errors
            database.ref('.info/connected').onDisconnect().set(false);
            
            // Periodic connection health check
            this.connectionCheckInterval = setInterval(() => {
                this.checkConnectionHealth();
            }, 30000);
            
            console.log('🔗 Firebase Connection Manager initialized');
            
        } catch (error) {
            console.error('❌ Firebase Connection Manager init error:', error);
            this.updateConnectionUI(false, 'কানেকশন ত্রুটি');
        }
    }
    
    handleConnected() {
        this.lastConnectionTime = new Date();
        this.reconnectAttempts = 0;
        
        // Update last sync time
        this.updateLastSyncTime();
        
        // Update UI
        this.updateConnectionUI(true, 'Firebase সংযুক্ত');
        
        console.log('✅ Firebase connected at:', this.lastConnectionTime.toLocaleTimeString());
        
        // Show success notification
        showNotification('Firebase সংযুক্ত হয়েছে', 'success');
    }
    
    handleDisconnected() {
        this.updateConnectionUI(false, 'Firebase সংযোগ বিচ্ছিন্ন');
        
        // Attempt reconnection
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            setTimeout(() => {
                if (!this.isConnected) {
                    this.attemptReconnection();
                }
            }, 2000 * this.reconnectAttempts);
        }
        
        console.warn(`❌ Firebase disconnected. Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    }
    
    attemptReconnection() {
        if (this.isConnected) return;
        
        this.updateConnectionUI(false, 'পুনঃসংযোগের চেষ্টা করা হচ্ছে...');
        
        if (firebase.database()) {
            firebase.database().goOnline();
        }
    }
    
    updateConnectionUI(connected, message) {
        const connectionDot = document.getElementById('connectionIndicator');
        const cloudStatus = document.getElementById('cloud_status');
        
        if (!connectionDot || !cloudStatus) return;
        
        if (connected) {
            connectionDot.className = 'connection-dot connected';
            cloudStatus.textContent = message || 'Firebase সংযুক্ত';
            cloudStatus.style.color = '#4CAF50';
        } else {
            connectionDot.className = 'connection-dot disconnected';
            cloudStatus.textContent = message || 'Firebase সংযোগ বিচ্ছিন্ন';
            cloudStatus.style.color = '#f44336';
        }
    }
    
    updateLastSyncTime() {
        const lastSyncElement = document.getElementById('last_sync');
        if (lastSyncElement) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('bn-BD', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            lastSyncElement.textContent = `সর্বশেষ: ${timeStr}`;
        }
    }
    
    updateSystemDateTime() {
        const now = new Date();
        
        // Update time
        const timeElement = document.getElementById('systemTime');
        if (timeElement) {
            const timeStr = now.toLocaleTimeString('bn-BD', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            timeElement.textContent = timeStr;
        }
        
        // Update date
        const dateElement = document.getElementById('systemDate');
        if (dateElement) {
            const dateStr = now.toLocaleDateString('bn-BD', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            dateElement.textContent = dateStr;
        }
    }
    
    checkConnectionHealth() {
        if (!this.isConnected && this.lastConnectionTime) {
            const now = new Date();
            const disconnectDuration = (now - this.lastConnectionTime) / 1000;
            
            if (disconnectDuration > 60) {
                console.warn(`⚠️ Firebase disconnected for ${Math.floor(disconnectDuration)} seconds`);
                
                const cloudStatus = document.getElementById('cloud_status');
                if (cloudStatus) {
                    cloudStatus.textContent = `সংযোগ বিচ্ছিন্ন (${Math.floor(disconnectDuration)}s)`;
                }
            }
        }
    }
    
    destroy() {
        if (this.connectionRef) {
            this.connectionRef.off();
        }
        
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
        }
        
        console.log('🔗 Firebase Connection Manager destroyed');
    }
    
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            lastConnectionTime: this.lastConnectionTime,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

function initializeFirebaseConnection() {
    if (!firebaseConnectionManager) {
        firebaseConnectionManager = new FirebaseConnectionManager();
        
        // Start system date/time updates
        setInterval(() => {
            firebaseConnectionManager.updateSystemDateTime();
        }, 1000);
        
        // Initial update
        firebaseConnectionManager.updateSystemDateTime();
    }
    return firebaseConnectionManager;
}

// ==================== ENERGY CALCULATION ====================

function startEnergyCalculation() {
    console.log("🔋 Starting energy calculation...");
    
    // Load saved energy from Firebase
    loadSavedEnergy();
    
    // Start periodic energy calculation
    setInterval(() => {
        calculateEnergy();
    }, ENERGY_UPDATE_INTERVAL);
}

function loadSavedEnergy() {
    if (!database || !isConnected) {
        console.error("❌ Database not connected for loading energy");
        return;
    }
    
    console.log("📥 Loading saved energy from Firebase...");
    
    const energyRef = database.ref('solar_system/energy_data/total_energy_wh');
    
    energyRef.once("value")
        .then((snapshot) => {
            const savedEnergy = snapshot.val();
            if (savedEnergy !== null && savedEnergy !== undefined) {
                totalEnergyWh = parseFloat(savedEnergy) || 0;
                console.log("✅ Loaded saved energy:", totalEnergyWh.toFixed(2), "Wh");
                updateTotalEnergyDisplay();
            } else {
                console.log("⚠️ No saved energy found, starting from 0");
                totalEnergyWh = 0;
                updateTotalEnergyDisplay();
            }
        })
        .catch(error => {
            console.error("❌ Error loading saved energy:", error);
            totalEnergyWh = 0;
            updateTotalEnergyDisplay();
        });
}

function calculateEnergy() {
    const now = Date.now();
    
    if (lastEnergyUpdateTime === 0) {
        lastEnergyUpdateTime = now;
        return;
    }
    
    const timeDiffHours = (now - lastEnergyUpdateTime) / (1000 * 3600);
    
    // Calculate solar power in watts
    const solarPowerW = currentSolarVoltage * solarCurrent;
    
    // Calculate energy generated
    const energyGeneratedWh = solarPowerW * timeDiffHours;
    
    if (energyGeneratedWh > 0) {
        totalEnergyWh += energyGeneratedWh;
        
        updateTotalEnergyDisplay();
        
        // Save to Firebase every 1 minute
        if (now - lastEnergyUpdateTime > 60000) {
            saveEnergyToFirebase();
        }
    }
    
    lastEnergyUpdateTime = now;
}

function updateTotalEnergyDisplay() {
    // Update total energy in dashboard
    const totalEnergyElement = document.getElementById('total_energy');
    if (totalEnergyElement) {
        totalEnergyElement.textContent = totalEnergyWh.toFixed(2);
        
        // Add unit if not present
        if (!totalEnergyElement.querySelector('.unit')) {
            const unit = document.createElement('span');
            unit.className = 'unit';
            unit.textContent = ' Wh';
            totalEnergyElement.appendChild(unit);
        }
    }
    
    // Update energy in power parameters section
    const powerParamsEnergy = document.querySelector('.solar-group .parameter-item.full-width .param-value');
    if (powerParamsEnergy) {
        powerParamsEnergy.textContent = totalEnergyWh.toFixed(2);
        if (!powerParamsEnergy.querySelector('.unit')) {
            const unit = document.createElement('span');
            unit.className = 'unit';
            unit.textContent = ' Wh';
            powerParamsEnergy.appendChild(unit);
        }
    }
    
    // Update energy in stats panel
    const statsEnergy = document.querySelector('.stat-card .stat-value');
    if (statsEnergy && statsEnergy.id === 'total_energy_stat') {
        statsEnergy.textContent = totalEnergyWh.toFixed(2);
    }
    
    console.log("🔋 Energy updated:", totalEnergyWh.toFixed(2), "Wh");
}

function saveEnergyToFirebase() {
    if (!database || !isConnected) {
        console.error("❌ Database not connected for saving energy");
        return;
    }
    
    const energyData = {
        total_energy_wh: totalEnergyWh,
        last_updated: Date.now(),
        solar_voltage_at_save: currentSolarVoltage,
        solar_current_at_save: solarCurrent,
        calculated_power: (currentSolarVoltage * solarCurrent).toFixed(2)
    };
    
    const energyRef = database.ref('solar_system/energy_data');
    
    energyRef.set(energyData)
        .then(() => {
            console.log("✅ Energy saved to Firebase:", totalEnergyWh.toFixed(2), "Wh");
        })
        .catch(error => {
            console.error("❌ Error saving energy to Firebase:", error);
        });
}

// ==================== DATABASE CONNECTION ====================

function initDatabaseConnection() {
    if (!database) {
        console.error("❌ Database not available");
        showNotification("ডাটাবেস লোড হয়নি", "error");
        return;
    }
    
    console.log("📡 Setting up Firebase database connection...");
    
    const connectedRef = database.ref(".info/connected");
    
    connectedRef.on("value", function(snap) {
        const wasConnected = isConnected;
        isConnected = (snap.val() === true);
        
        console.log(`📊 Firebase Connection: ${isConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
        updateConnectionUI(isConnected);
        
        if (isConnected && !wasConnected) {
            console.log("✅ Firebase Database Connected");
            showNotification("Firebase সংযোগ সফল", "success");
            
            setupRealtimeListeners();
            fetchInitialData();
            
        } else if (!isConnected && wasConnected) {
            console.log("❌ Firebase Database Disconnected");
            showNotification("Firebase সংযোগ বিচ্ছিন্ন", "warning");
            stopAllIntervals();
        }
    });
}

function fetchInitialData() {
    if (!database || !isConnected) return;
    
    console.log("📥 Fetching initial data from Firebase...");
    
    // Fetch current data
    const currentDataRef = database.ref('solar_system/current_data');
    
    currentDataRef.once("value")
        .then((snapshot) => {
            const data = snapshot.val();
            if (data) {
                console.log("✅ Initial data received");
                updateSensorValuesFromFirebase(data);
                updateDashboard(data);
                lastValidDataTime = Date.now();
                
                if (powerMode === 'auto') {
                    console.log("🔄 Auto mode - checking conditions with fresh data");
                    checkAutoPowerConditions();
                }
            } else {
                console.log("⚠️ No initial data found");
                
                if (powerMode === 'auto') {
                    console.log("⚠️ Auto mode: No initial data, switching to grid");
                    executePowerSwitch('grid', 'প্রাথমিক ডেটা না পাওয়ায় গ্রিডে সুইচ');
                }
            }
        })
        .catch(error => {
            console.error("❌ Initial data fetch error:", error);
        });
    
    // Fetch system status
    const systemStatusRef = database.ref('solar_system/system_status');
    
    systemStatusRef.once("value")
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
                    updatePowerButtonsUI();
                }
            }
        })
        .catch(error => {
            console.error("❌ Status fetch error:", error);
        });
    
    // Fetch energy data
    const energyRef = database.ref('solar_system/energy_data');
    
    energyRef.once("value")
        .then((snapshot) => {
            const energyData = snapshot.val();
            if (energyData) {
                console.log("✅ Energy data loaded:", energyData);
                if (energyData.total_energy_wh) {
                    totalEnergyWh = parseFloat(energyData.total_energy_wh);
                    updateTotalEnergyDisplay();
                }
            }
        })
        .catch(error => {
            console.error("❌ Energy data fetch error:", error);
        });
}

// ==================== REALTIME LISTENERS ====================

function setupRealtimeListeners() {
    if (!database) return;
    
    console.log("📡 Setting up Firebase listeners...");
    
    try {
        // Current data listener
        const currentDataRef = database.ref('solar_system/current_data');
        
        currentDataRef.on("value", (snapshot) => {
            const data = snapshot.val();
            if (data) {
                esp32LastDataTime = Date.now();
                lastValidDataTime = Date.now();
                esp32Connected = true;
                updateESP32Status(true);
                
                updateSensorValuesFromFirebase(data);
                updateDashboard(data);
                
                // Update solar priority indicator
                updateSolarPriorityIndicator();
                
                if (powerMode === 'auto') {
                    const now = Date.now();
                    if (!lastAutoCheckTime || now - lastAutoCheckTime >= 1000) {
                        lastAutoCheckTime = now;
                        console.log("🔄 Auto mode check (1s interval)...");
                        checkAutoPowerConditions();
                    }
                }
            } else {
                console.log("⚠️ No real-time data from Firebase");
                if (esp32Connected) {
                    esp32Connected = false;
                    updateESP32Status(false);
                }
                
                // Update solar priority indicator
                updateSolarPriorityIndicator();
                
                if (powerMode === 'auto') {
                    console.log("⚠️ Auto mode: No real-time data, switching to grid");
                    if (activePowerSource !== 'grid') {
                        executePowerSwitch('grid', 'রিয়েল-টাইম ডেটা না পাওয়ায় গ্রিডে সুইচ');
                    }
                }
            }
        });
        
        // System status listener
        const systemStatusRef = database.ref('solar_system/system_status');
        
        systemStatusRef.on("value", (snapshot) => {
            const status = snapshot.val();
            if (status) {
                console.log("📊 System status updated:", status);
                
                if (status.power_source && status.power_source !== activePowerSource) {
                    activePowerSource = status.power_source;
                    lastPowerSource = status.power_source;
                    updatePowerFlow(activePowerSource);
                    updatePowerButtonsUI();
                }
                
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
        
        // Energy data listener
        const energyRef = database.ref('solar_system/energy_data');
        
        energyRef.on("value", (snapshot) => {
            const energyData = snapshot.val();
            if (energyData && energyData.total_energy_wh) {
                const newEnergy = parseFloat(energyData.total_energy_wh);
                if (newEnergy !== totalEnergyWh) {
                    totalEnergyWh = newEnergy;
                    updateTotalEnergyDisplay();
                    console.log("🔋 Energy updated from Firebase:", totalEnergyWh.toFixed(2), "Wh");
                }
            }
        });
        
        // Commands listener
        const commandsRef = database.ref('solar_system/commands');
        
        commandsRef.on("value", (snapshot) => {
            const command = snapshot.val();
            if (command && command.action === 'emergency_stop') {
                console.log("⚠️ Emergency stop detected from Firebase");
                powerMode = 'stop';
                updateModeUI('stop');
                stopAllIntervals();
            }
            
            if (command && command.action === 'reset_system') {
                console.log("🔄 System reset detected from Firebase");
                
                setTimeout(() => {
                    console.log("🔄 Refreshing data after reset...");
                    fetchInitialData();
                    
                    if (powerMode === 'auto') {
                        setTimeout(() => {
                            forceDataFetchForAutoMode();
                        }, 2000);
                    }
                }, 1000);
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

// ==================== CONTROL PANEL INITIALIZATION ====================

function initControlPanel() {
    console.log("🔄 Initializing control panel...");
    
    setupModeButtons();
    setupPowerButtons();
    setupBrushButtons();
    setupPumpButtons();
    setupCleaningButtons();
    
    console.log("✅ Control panel initialized");
}

function setupModeButtons() {
    const autoModeBtn = document.getElementById('autoModeBtn');
    const manualModeBtn = document.getElementById('manualModeBtn');
    const stopModeBtn = document.getElementById('stopModeBtn');
    
    if (autoModeBtn) {
        autoModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Auto Mode button clicked");
            
            if (powerMode !== 'auto') {
                if (powerMode === 'stop') {
                    if (confirm('ইমারজেন্সি স্টপ থেকে সিস্টেম রিসেট করতে চান?')) {
                        resetFromEmergencyStop('auto');
                    }
                } else {
                    switchToMode('auto');
                }
            }
            
            updateModeButtons();
        });
    }
    
    if (manualModeBtn) {
        manualModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Manual Mode button clicked");
            
            if (powerMode !== 'manual') {
                if (powerMode === 'stop') {
                    if (confirm('ইমারজেন্সি স্টপ থেকে সিস্টেম রিসেট করতে চান?')) {
                        resetFromEmergencyStop('manual');
                    }
                } else {
                    switchToMode('manual');
                }
            }
            
            updateModeButtons();
        });
    }
    
    if (stopModeBtn) {
        stopModeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Stop Mode button clicked");
            
            if (powerMode !== 'stop') {
                if (confirm('সিস্টেম জরুরি বন্ধ করতে চান?')) {
                    emergencyStop();
                }
            }
            
            updateModeButtons();
        });
    }
}

function setupPowerButtons() {
    const powerSourceBtns = document.querySelectorAll('.power-source-btn');
    
    powerSourceBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const source = this.getAttribute('data-source');
            const state = this.getAttribute('data-state');
            
            console.log(`Power source button clicked: ${source}, state: ${state}`);
            
            handlePowerButtonClick(source, state);
            updatePowerButtonsUI();
        });
    });
}

function handlePowerButtonClick(source, state) {
    if (powerMode === 'stop') {
        if (source === 'auto') {
            if (confirm('ইমারজেন্সি স্টপ থেকে সিস্টেম রিসেট করতে চান?')) {
                resetFromEmergencyStop('auto');
            }
        } else if (source === 'solar' || source === 'battery' || source === 'grid') {
            if (confirm('ইমারজেন্সি স্টপ থেকে সিস্টেম রিসেট করতে চান?')) {
                resetFromEmergencyStop('manual', source);
            }
        } else if (source === 'all' && state === 'off') {
            if (confirm('ইমারজেন্সি স্টপ থেকে ম্যানুয়াল স্টপ করতে চান?')) {
                resetFromEmergencyStop('manual', 'off');
            }
        }
        return;
    }
    
    if (source === 'all' && state === 'off') {
        manualStop();
        showNotification('সব OFF করা হয়েছে', 'warning');
        return;
    }
    
    if (source === 'stop') {
        if (confirm('সিস্টেম জরুরি বন্ধ করতে চান?')) {
            emergencyStop();
        }
        return;
    }
    
    if (source === 'solar' || source === 'battery' || source === 'grid') {
        if (powerMode !== 'manual') {
            powerMode = 'manual';
            updateModeUI('manual');
            stopAutoPowerSwitching();
        }
        
        controlPowerSource(source, state, 'ম্যানুয়াল সিলেকশন');
        
        const sourceNames = {
            'solar': 'সোলার',
            'battery': 'ব্যাটারি',
            'grid': 'গ্রিড'
        };
        showNotification(`${sourceNames[source]} চালু করা হয়েছে (ম্যানুয়াল)`, 'info');
    }
    
    if (source === 'auto') {
        switchToMode('auto');
    }
}

function setupBrushButtons() {
    const brushAutoBtn = document.getElementById('brushAutoModeBtn');
    const brushManualBtn = document.getElementById('brushManualModeBtn');
    const manualBrushControl = document.getElementById('manualBrushControl');
    const autoBrushControl = document.getElementById('autoBrushControl');
    
    if (brushAutoBtn && brushManualBtn) {
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
            
            sendBrushCommand('auto_mode');
            updateBrushButtons();
            
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
            
            sendBrushCommand('manual_mode');
            updateBrushButtons();
            
            showNotification('ম্যানুয়াল ব্রাশ মোড সিলেক্ট করা হয়েছে', 'info');
        });
    }
    
    const brushForwardBtn = document.getElementById('brushForwardBtn');
    const brushReverseBtn = document.getElementById('brushReverseBtn');
    const brushStopBtn = document.getElementById('brushPumpStopBtn');
    const pumpOnBtn = document.getElementById('pumpOnBtn');
    const pumpOffBtn = document.getElementById('pumpOffBtn');
    
    if (brushForwardBtn) {
        brushForwardBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Forward clicked");
            
            currentBrushMode = 'manual';
            brushStatus = 'forward';
            
            updateBrushButtons();
            sendBrushCommand('forward');
            
            showNotification('ব্রাশ ফরওয়ার্ড চালু করা হয়েছে', 'info');
        });
    }
    
    if (brushReverseBtn) {
        brushReverseBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Brush Reverse clicked");
            
            currentBrushMode = 'manual';
            brushStatus = 'reverse';
            
            updateBrushButtons();
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
            
            updateBrushButtons();
            updatePumpButtons();
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
            updatePumpButtons();
            sendPumpCommand('on');
            
            showNotification('পাম্প চালু করা হয়েছে', 'info');
        });
    }
    
    if (pumpOffBtn) {
        pumpOffBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Pump OFF clicked");
            
            pumpStatus = 'off';
            updatePumpButtons();
            sendPumpCommand('off');
            
            showNotification('পাম্প বন্ধ করা হয়েছে', 'warning');
        });
    }
}

function setupCleaningButtons() {
    const startCleaningBtn = document.getElementById('startCleaningBtn');
    const stopCleaningBtn = document.getElementById('stopCleaningBtn');
    
    if (startCleaningBtn) {
        startCleaningBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Start Cleaning clicked");
            const duration = document.getElementById('cleaningDuration')?.value || 30;
            const interval = document.getElementById('cleaningInterval')?.value || 6;
            
            this.classList.add('active');
            
            setTimeout(() => {
                this.classList.remove('active');
                updateCleaningButtons();
            }, 1000);
            
            sendCleaningCommand('start', duration, interval);
            showNotification(`অটো পরিষ্কার শুরু: ${duration} সেকেন্ড, বিরতি: ${interval} ঘণ্টা`, 'info');
        });
    }
    
    if (stopCleaningBtn) {
        stopCleaningBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log("Stop Cleaning clicked");
            
            this.classList.add('active');
            
            setTimeout(() => {
                this.classList.remove('active');
                updateCleaningButtons();
            }, 1000);
            
            sendCleaningCommand('stop');
            showNotification('অটো পরিষ্কার বন্ধ করা হয়েছে', 'warning');
        });
    }
}

// ==================== BUTTON STATE MANAGEMENT ====================

function updateAllButtonStates() {
    updateModeButtons();
    updatePowerButtonsUI();
    updateBrushButtons();
    updatePumpButtons();
    updateCleaningButtons();
}

function updateModeButtons() {
    const autoBtn = document.getElementById('autoModeBtn');
    const manualBtn = document.getElementById('manualModeBtn');
    const stopBtn = document.getElementById('stopModeBtn');
    
    if (autoBtn) autoBtn.classList.remove('active');
    if (manualBtn) manualBtn.classList.remove('active');
    if (stopBtn) stopBtn.classList.remove('active');
    
    switch(powerMode) {
        case 'auto':
            if (autoBtn) autoBtn.classList.add('active');
            buttonStates.mode.auto = true;
            buttonStates.mode.manual = false;
            buttonStates.mode.stop = false;
            break;
        case 'manual':
            if (manualBtn) manualBtn.classList.add('active');
            buttonStates.mode.auto = false;
            buttonStates.mode.manual = true;
            buttonStates.mode.stop = false;
            break;
        case 'stop':
            if (stopBtn) stopBtn.classList.add('active');
            buttonStates.mode.auto = false;
            buttonStates.mode.manual = false;
            buttonStates.mode.stop = true;
            break;
    }
}

function updatePowerButtonsUI() {
    const powerButtons = document.querySelectorAll('.power-source-btn');
    
    powerButtons.forEach(btn => {
        btn.classList.remove('active', 'manual-active', 'auto-active');
    });
    
    if (powerMode === 'stop') {
        const stopBtn = document.querySelector('.power-source-btn[data-source="stop"]');
        if (stopBtn) stopBtn.classList.add('active');
        buttonStates.power.stop = true;
        return;
    }
    
    if (powerMode === 'auto') {
        const autoBtn = document.querySelector('.power-source-btn[data-source="auto"]');
        if (autoBtn) {
            autoBtn.classList.add('active');
            autoBtn.classList.add('auto-active');
        }
        buttonStates.power.auto = true;
        
        const currentSourceBtn = document.querySelector(`.power-source-btn[data-source="${activePowerSource}"]`);
        if (currentSourceBtn && activePowerSource !== 'off') {
            currentSourceBtn.classList.add('manual-active');
        }
    } else if (powerMode === 'manual') {
        if (activePowerSource === 'off') {
            const allOffBtn = document.querySelector('.power-source-btn[data-state="off"]');
            if (allOffBtn) allOffBtn.classList.add('manual-active');
        } else {
            const currentBtn = document.querySelector(`.power-source-btn[data-source="${activePowerSource}"]`);
            if (currentBtn) {
                currentBtn.classList.add('active');
                currentBtn.classList.add('manual-active');
            }
        }
    }
    
    Object.keys(buttonStates.power).forEach(key => {
        buttonStates.power[key] = false;
    });
    
    if (powerMode === 'auto') {
        buttonStates.power.auto = true;
    } else if (activePowerSource !== 'off') {
        buttonStates.power[activePowerSource] = true;
    }
}

function updateBrushButtons() {
    const brushAutoBtn = document.getElementById('brushAutoModeBtn');
    const brushManualBtn = document.getElementById('brushManualModeBtn');
    const brushForwardBtn = document.getElementById('brushForwardBtn');
    const brushReverseBtn = document.getElementById('brushReverseBtn');
    const brushStopBtn = document.getElementById('brushPumpStopBtn');
    
    if (brushAutoBtn) brushAutoBtn.classList.remove('active');
    if (brushManualBtn) brushManualBtn.classList.remove('active');
    if (brushForwardBtn) brushForwardBtn.classList.remove('active');
    if (brushReverseBtn) brushReverseBtn.classList.remove('active');
    if (brushStopBtn) brushStopBtn.classList.remove('active');
    
    if (currentBrushMode === 'auto' && brushAutoBtn) {
        brushAutoBtn.classList.add('active');
        buttonStates.brush.auto = true;
        buttonStates.brush.manual = false;
    } else if (currentBrushMode === 'manual' && brushManualBtn) {
        brushManualBtn.classList.add('active');
        buttonStates.brush.auto = false;
        buttonStates.brush.manual = true;
    }
    
    switch(brushStatus) {
        case 'forward':
            if (brushForwardBtn) brushForwardBtn.classList.add('active');
            buttonStates.brush.forward = true;
            buttonStates.brush.reverse = false;
            buttonStates.brush.stop = false;
            break;
        case 'reverse':
            if (brushReverseBtn) brushReverseBtn.classList.add('active');
            buttonStates.brush.forward = false;
            buttonStates.brush.reverse = true;
            buttonStates.brush.stop = false;
            break;
        case 'stopped':
            if (brushStopBtn) brushStopBtn.classList.add('active');
            buttonStates.brush.forward = false;
            buttonStates.brush.reverse = false;
            buttonStates.brush.stop = true;
            break;
    }
}

function updatePumpButtons() {
    const pumpOnBtn = document.getElementById('pumpOnBtn');
    const pumpOffBtn = document.getElementById('pumpOffBtn') || document.getElementById('brushPumpStopBtn');
    
    if (pumpOnBtn) pumpOnBtn.classList.remove('active');
    if (pumpOffBtn) pumpOffBtn.classList.remove('active');
    
    if (pumpStatus === 'on' && pumpOnBtn) {
        pumpOnBtn.classList.add('active');
        buttonStates.pump.on = true;
        buttonStates.pump.off = false;
    } else if (pumpStatus === 'off' && pumpOffBtn) {
        pumpOffBtn.classList.add('active');
        buttonStates.pump.on = false;
        buttonStates.pump.off = true;
    }
}

function updateCleaningButtons() {
    const startCleaningBtn = document.getElementById('startCleaningBtn');
    const stopCleaningBtn = document.getElementById('stopCleaningBtn');
    
    if (startCleaningBtn) startCleaningBtn.classList.remove('active');
    if (stopCleaningBtn) stopCleaningBtn.classList.remove('active');
    
    buttonStates.cleaning.start = false;
    buttonStates.cleaning.stop = false;
}

// ==================== FIREBASE COMMAND FUNCTIONS ====================

function sendBrushCommand(command) {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for brush command");
        return;
    }
    
    const brushCommand = {
        action: 'brush_control',
        command: command,
        mode: currentBrushMode,
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_mode: powerMode,
        brush_status: brushStatus
    };
    
    console.log('📤 Sending brush command:', brushCommand);
    
    const commandsRef = database.ref("solar_system/commands");
    
    commandsRef.set(brushCommand)
        .then(() => {
            console.log('✅ Brush command sent');
            updateBrushStatusDisplay();
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
    
    const commandsRef = database.ref("solar_system/commands");
    
    commandsRef.update(command)
        .then(() => {
            console.log('✅ Pump command sent');
        })
        .catch(error => {
            console.error('❌ Pump command error:', error);
            showNotification('পাম্প কমান্ড পাঠাতে সমস্যা', 'error');
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
    
    const commandsRef = database.ref("solar_system/commands");
    
    commandsRef.update(command)
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
    
    if (source === 'all' && state === 'off') {
        manualStop();
        return;
    }
    
    let relay1 = false, relay2 = false, relay3 = false;
    
    if (source === 'solar' && state === 'on') {
        relay1 = true;
        relay2 = false;
        relay3 = false;
    } else if (source === 'battery' && state === 'on') {
        relay1 = false;
        relay2 = true;
        relay3 = false;
    } else if (source === 'grid' && state === 'on') {
        relay1 = false;
        relay2 = false;
        relay3 = true;
    } else {
        relay1 = false;
        relay2 = false;
        relay3 = false;
        activePowerSource = 'off';
    }
    
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
    
    const commandsRef = database.ref("solar_system/commands");
    
    commandsRef.set(command)
        .then(() => {
            console.log('✅ Power command sent to Firebase');
            
            updateFirebaseStatus(powerMode, source);
            
            if (state === 'on' && source !== 'all') {
                updateUIAfterPowerSwitch(source);
                updateCurrentPowerSourceDisplay();
                updatePowerFlow(source);
                updatePowerButtonsUI();
                
                const sourceNames = {
                    'solar': 'সোলার',
                    'battery': 'ব্যাটারি',
                    'grid': 'গ্রিড'
                };
                const notificationReason = reason ? `কারণ: ${reason}` : '';
                showNotification(`${sourceNames[source]} চালু হয়েছে ${notificationReason}`, 'success');
                
                console.log(`📝 Switch recorded: ${source} at ${new Date().toLocaleTimeString()}`);
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
    
    const statusRef = database.ref("solar_system/system_status");
    
    statusRef.update(statusUpdate)
        .then(() => {
            console.log("✅ Firebase status updated");
        })
        .catch(error => {
            console.error("❌ Firebase status update error:", error);
        });
}

// ==================== AUTO POWER SWITCHING ====================

function startAutoPowerSwitching() {
    console.log("🔋 Auto power switching starting...");
    
    stopAutoPowerSwitching();
    
    autoModeStartTime = Date.now();
    retryCount = 0;
    
    powerMode = 'auto';
    updateModeUI('auto');
    updatePowerButtonsUI();
    
    activePowerSource = 'grid';
    lastPowerSource = 'grid';
    
    updateFirebaseStatus('auto', activePowerSource);
    
    setTimeout(() => {
        console.log("🚀 Auto mode: Initial data fetch...");
        forceDataFetchForAutoMode();
    }, 500);
    
    autoPowerInterval = setInterval(() => {
        if (powerMode === 'auto' && !isSwitchingInProgress) {
            console.log("⏰ Auto mode scheduled check (1s interval)");
            
            if (currentSolarVoltage === 0 && currentBatteryVoltage === 0) {
                console.log("⚠️ No sensor data for auto check - fetching fresh data");
                forceDataFetchForAutoMode();
            } else {
                checkAutoPowerConditions();
            }
        }
    }, 1000);
    
    console.log("✅ Auto power switching started (1s interval)");
    showNotification("অটো মোড চালু হয়েছে (প্রতি ১ সেকেন্ডে চেক)", "success");
}

// ==================== SOLAR PRIORITY FUNCTIONS ====================

function shouldStayOnSolar() {
    const solarGood = currentSolarVoltage >= AUTO_THRESHOLDS.SOLAR_MIN_FOR_OPERATION;
    const dataGood = esp32Connected && (Date.now() - esp32LastDataTime < 30000);
    const voltageDiff = currentSolarVoltage - currentBatteryVoltage;
    const solarBetterThanBattery = voltageDiff > -AUTO_THRESHOLDS.HYSTERESIS;
    const batteryGood = currentBatterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC;
    
    if (solarGood && dataGood && solarBetterThanBattery && batteryGood) {
        console.log("🔆 Solar priority: Conditions good for staying on solar");
        return true;
    }
    
    console.log("⚠️ Solar priority: Conditions not met for staying on solar");
    return false;
}

function createSolarPriorityIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'solarPriorityIndicator';
    indicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-weight: bold;
        z-index: 1000;
        display: none;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        font-size: 14px;
    `;
    document.body.appendChild(indicator);
    return indicator;
}

function updateSolarPriorityIndicator() {
    const indicator = document.getElementById('solarPriorityIndicator');
    if (!indicator) return;
    
    const solarGood = currentSolarVoltage >= AUTO_THRESHOLDS.SOLAR_MIN_FOR_OPERATION;
    const dataGood = esp32Connected && (Date.now() - esp32LastDataTime < 30000);
    
    if (solarGood && dataGood && activePowerSource === 'solar' && powerMode === 'auto') {
        indicator.innerHTML = `🔆 সোলার প্রায়রি সক্রিয় (${currentSolarVoltage.toFixed(2)}V)`;
        indicator.style.background = 'rgba(76, 175, 80, 0.9)';
        indicator.style.color = 'white';
        indicator.style.display = 'block';
    } else if (activePowerSource === 'solar' && powerMode === 'auto') {
        indicator.innerHTML = `⚠️ সোলার চলছে (${currentSolarVoltage.toFixed(2)}V)`;
        indicator.style.background = 'rgba(255, 152, 0, 0.9)';
        indicator.style.color = 'white';
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

function debugSolarConditions() {
    console.log("=== সোলার কন্ডিশন ডিবাগ ===");
    console.log(`সোলার ভোল্টেজ: ${currentSolarVoltage.toFixed(2)}V`);
    console.log(`ব্যাটারি ভোল্টেজ: ${currentBatteryVoltage.toFixed(2)}V`);
    console.log(`ভোল্টেজ ডিফারেন্স: ${(currentSolarVoltage - currentBatteryVoltage).toFixed(2)}V`);
    console.log(`ব্যাটারি SOC: ${currentBatterySOC.toFixed(1)}%`);
    console.log(`সোলার থেকে গ্রিড থ্রেশহোল্ড: ${AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD}V`);
    console.log(`সোলার মিনিমাম ফর অপারেশন: ${AUTO_THRESHOLDS.SOLAR_MIN_FOR_OPERATION}V`);
    console.log(`সোলার ভালো কিনা: ${currentSolarVoltage >= AUTO_THRESHOLDS.SOLAR_MIN_FOR_OPERATION ? 'হ্যাঁ' : 'না'}`);
    console.log(`কারেন্ট সোর্স: ${activePowerSource}`);
    console.log(`মোড: ${powerMode}`);
    console.log(`ESP32 সংযুক্ত: ${esp32Connected}`);
    console.log("==========================");
}

function checkAutoPowerConditions() {
    if (powerMode !== 'auto') return;
    
    debugSolarConditions();
    
    console.log("🤖 Auto mode checking conditions...");
    console.log(`   Solar: ${currentSolarVoltage.toFixed(2)}V, Battery: ${currentBatteryVoltage.toFixed(2)}V (${currentBatterySOC.toFixed(1)}%)`);
    
    if (Date.now() - lastValidDataTime > AUTO_THRESHOLDS.DATA_TIMEOUT) {
        console.log("⚠️ Auto mode: Data timeout - switching to grid");
        executePowerSwitch('grid', 'ডেটা টাইমআউট');
        return;
    }
    
    const voltageDiff = currentSolarVoltage - currentBatteryVoltage;
    
    switch(activePowerSource) {
        case 'grid':
            if (currentSolarVoltage >= AUTO_THRESHOLDS.MIN_SOLAR_VOLTAGE_FOR_SWITCH && 
                voltageDiff >= AUTO_THRESHOLDS.GRID_TO_SOLAR_THRESHOLD) {
                console.log("🔆 Solar is good, switching from grid to solar");
                executePowerSwitch('solar', `সোলার ভালো (${voltageDiff.toFixed(2)}V বেশি)`);
            } else if (currentBatteryVoltage >= AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE && 
                      currentBatterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
                console.log("🔋 Battery is OK, switching from grid to battery");
                executePowerSwitch('battery', `ব্যাটারি ভালো (${currentBatterySOC.toFixed(1)}%)`);
            } else {
                console.log("✅ Staying on grid - solar/battery conditions not met");
            }
            break;
            
        case 'solar':
            if (shouldStayOnSolar()) {
                console.log("✅ Staying on solar - solar priority mode active");
                logAutoDecision('STAY_ON_SOLAR', 'সোলার প্রায়রি সক্রিয় - সোলারে থাকা হবে');
                return;
            }
            
            let shouldSwitchFromSolar = false;
            let switchReason = '';
            let targetSource = 'grid';
            
            if (currentSolarVoltage < AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD) {
                shouldSwitchFromSolar = true;
                switchReason = `সোলার ভোল্টেজ খুব কম (${currentSolarVoltage.toFixed(2)}V < ${AUTO_THRESHOLDS.SOLAR_TO_GRID_THRESHOLD}V)`;
                targetSource = 'grid';
            } else if (voltageDiff < -AUTO_THRESHOLDS.HYSTERESIS && 
                      currentBatteryVoltage >= AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE &&
                      currentBatterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
                shouldSwitchFromSolar = true;
                switchReason = `ব্যাটারি বেশি (${(-voltageDiff).toFixed(2)}V বেশি)`;
                targetSource = 'battery';
            } else if (!esp32Connected || Date.now() - esp32LastDataTime > 30000) {
                shouldSwitchFromSolar = true;
                switchReason = 'ESP32 সংযোগ সমস্যা';
                targetSource = 'grid';
            } else if (currentBatterySOC <= AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
                shouldSwitchFromSolar = true;
                switchReason = `ব্যাটারি ক্রিটিকাল (${currentBatterySOC.toFixed(1)}%)`;
                targetSource = 'grid';
            }
            
            if (shouldSwitchFromSolar) {
                console.log(`🔄 Auto mode decision: Switch from solar to ${targetSource} - ${switchReason}`);
                executePowerSwitch(targetSource, switchReason);
            } else {
                console.log("✅ Staying on solar - conditions good");
                logAutoDecision('STAY_ON_SOLAR', 'সোলার কন্ডিশন ভালো');
            }
            break;
            
        case 'battery':
            if (currentSolarVoltage >= AUTO_THRESHOLDS.MIN_SOLAR_VOLTAGE_FOR_SWITCH && 
                voltageDiff >= AUTO_THRESHOLDS.SOLAR_BATTERY_DIFF) {
                console.log("🔆 Solar is better, switching from battery to solar");
                executePowerSwitch('solar', `সোলার ভালো (${voltageDiff.toFixed(2)}V বেশি)`);
            } else if (currentBatteryVoltage < AUTO_THRESHOLDS.BATTERY_TO_GRID_THRESHOLD || 
                      currentBatterySOC <= AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
                console.log("⚠️ Battery critical, switching to grid");
                executePowerSwitch('grid', `ব্যাটারি ক্রিটিকাল (${currentBatterySOC.toFixed(1)}%)`);
            } else {
                console.log("✅ Staying on battery - conditions OK");
            }
            break;
    }
}

function logAutoDecision(decision, details) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
        timestamp: timestamp,
        decision: decision,
        solarV: currentSolarVoltage.toFixed(2),
        batteryV: currentBatteryVoltage.toFixed(2),
        voltageDiff: (currentSolarVoltage - currentBatteryVoltage).toFixed(2),
        batterySOC: currentBatterySOC.toFixed(1),
        currentSource: activePowerSource,
        targetSource: decision.includes('SWITCH') ? details.split(' ')[0] : activePowerSource,
        details: details,
        mode: powerMode,
        esp32Connected: esp32Connected,
        dataAge: Date.now() - lastValidDataTime
    };
    
    if (database && isConnected) {
        const logRef = database.ref('solar_system/auto_mode_logs').push();
        logRef.set(logEntry)
            .then(() => {
                console.log(`📝 Auto decision logged: ${decision}`);
            })
            .catch(error => {
                console.error('❌ Error logging auto decision:', error);
            });
    }
    
    console.log(`🤖 ${timestamp} - ${decision}: ${details}`);
}

function executePowerSwitch(targetSource, reason) {
    const now = Date.now();
    
    if (now - lastSwitchTime < MIN_SWITCH_INTERVAL) {
        console.log(`⏳ Skipping switch - too soon after last switch (${(now - lastSwitchTime)/1000}s)`);
        return;
    }
    
    if (targetSource === activePowerSource) {
        console.log(`⚠️ Already on ${targetSource}, skipping switch`);
        return;
    }
    
    if (activePowerSource === 'solar' && targetSource === 'grid') {
        if (currentSolarVoltage >= AUTO_THRESHOLDS.SOLAR_MIN_FOR_OPERATION && 
            esp32Connected && (Date.now() - esp32LastDataTime < 30000) &&
            currentBatterySOC > AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC) {
            
            console.log(`🚫 Blocked switch from solar to grid - solar is good (${currentSolarVoltage.toFixed(2)}V)`);
            logAutoDecision('BLOCK_SWITCH_TO_GRID', `সোলার ভালো আছে (${currentSolarVoltage.toFixed(2)}V)`);
            
            showNotification(`সোলার ভালো আছে (${currentSolarVoltage.toFixed(2)}V), গ্রিডে সুইচ ব্লক করা হয়েছে`, 'warning');
            
            solarPriorityBlockCount++;
            lastSolarPriorityBlockTime = now;
            
            const blockLog = {
                timestamp: new Date().toLocaleTimeString(),
                solar_voltage: currentSolarVoltage.toFixed(2),
                battery_voltage: currentBatteryVoltage.toFixed(2),
                battery_soc: currentBatterySOC.toFixed(1),
                reason: reason,
                block_count: solarPriorityBlockCount,
                total_block_count: solarPriorityBlockCount
            };
            
            if (database && isConnected) {
                database.ref('solar_system/solar_priority_blocks').push(blockLog);
            }
            
            return;
        }
    }
    
    console.log(`🔄 Auto switching to ${targetSource}: ${reason}`);
    
    logAutoDecision(`SWITCH_TO_${targetSource.toUpperCase()}`, reason);
    
    isSwitchingInProgress = true;
    
    controlPowerSource(targetSource, 'on', `অটো: ${reason}`);
    
    lastSwitchTime = now;
    
    setTimeout(() => {
        isSwitchingInProgress = false;
    }, 5000);
}

function forceDataFetchForAutoMode() {
    if (!database || !isConnected) {
        console.error("❌ Firebase not connected for force data fetch");
        return;
    }
    
    console.log("📥 Force fetching data for auto mode...");
    
    const currentDataRef = database.ref('solar_system/current_data');
    
    currentDataRef.once("value")
        .then((snapshot) => {
            const data = snapshot.val();
            if (data) {
                console.log("✅ Force data fetch successful");
                updateSensorValuesFromFirebase(data);
                updateDashboard(data);
                lastValidDataTime = Date.now();
                
                updateSolarPriorityIndicator();
                
                if (powerMode === 'auto') {
                    console.log("🔄 Checking auto conditions with forced data...");
                    setTimeout(() => {
                        checkAutoPowerConditions();
                    }, 1000);
                }
            } else {
                console.log("❌ No data even after force fetch");
                
                if (powerMode === 'auto') {
                    console.log("⚠️ Auto mode: Switching to grid (no data after force fetch)");
                    if (activePowerSource !== 'grid') {
                        executePowerSwitch('grid', 'ফোর্স ডেটা ফেচেও ডেটা না পাওয়ায় গ্রিডে সুইচ');
                    }
                }
            }
        })
        .catch(error => {
            console.error("❌ Force data fetch error:", error);
        });
}

function stopAutoPowerSwitching() {
    console.log("🛑 Stopping auto power switching...");
    
    if (autoPowerInterval) {
        clearInterval(autoPowerInterval);
        autoPowerInterval = null;
    }
    
    if (autoCheckInterval) {
        clearInterval(autoCheckInterval);
        autoCheckInterval = null;
    }
    
    const indicator = document.getElementById('solarPriorityIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    
    console.log("✅ Auto power switching stopped");
}

// ==================== MODE SWITCHING FUNCTIONS ====================

function switchToMode(mode) {
    console.log(`🔄 Switching to ${mode} mode`);
    
    switch(mode) {
        case 'auto':
            if (powerMode !== 'auto') {
                powerMode = 'auto';
                updateModeUI('auto');
                updatePowerButtonsUI();
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
                updatePowerButtonsUI();
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

function updateModeUI(mode) {
    console.log("Updating mode UI to:", mode);
    
    updateModeButtons();
    
    const panel = document.getElementById('manualControlPanel');
    if (panel) {
        panel.style.display = mode === 'manual' ? 'block' : 'none';
    }
    
    updateModeIndicator(mode);
    updateCurrentPowerSourceDisplay();
}

function updateModeIndicator(mode) {
    const modeIndicator = document.getElementById('mode_indicator');
    if (!modeIndicator) return;
    
    switch(mode) {
        case 'auto':
            modeIndicator.textContent = 'অটো মোড';
            modeIndicator.className = 'auto-indicator';
            break;
        case 'manual':
            modeIndicator.textContent = 'ম্যানুয়াল মোড';
            modeIndicator.className = 'manual-indicator';
            break;
        case 'stop':
            modeIndicator.textContent = 'জরুরি বন্ধ';
            modeIndicator.className = 'stop-indicator';
            break;
        default:
            modeIndicator.textContent = mode;
            modeIndicator.className = '';
    }
}

// ==================== UI UPDATE FUNCTIONS ====================

function updateUIAfterPowerSwitch(source) {
    const mode = powerMode === 'auto' ? (
        source === 'solar' ? 'auto_solar' :
        source === 'battery' ? 'auto_battery' :
        source === 'grid' ? 'auto_grid' : 'auto'
    ) : 'manual';
    
    updateModeIndicator(mode);
    updateCurrentPowerSourceText();
    updatePowerFlow(source);
    updatePowerButtonsUI();
    
    updateSolarPriorityIndicator();
}

function updateCurrentPowerSourceDisplay(source = activePowerSource) {
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
        currentPowerSourceEl.className = 'off';
    } else if (source === 'off') {
        currentPowerSourceEl.textContent = 'সিস্টেম বন্ধ' + modeText;
        currentPowerSourceEl.className = 'off';
    } else {
        currentPowerSourceEl.textContent = 
            sourceNames[source] + ' → লোড' + modeText;
        currentPowerSourceEl.className = source;
    }
}

function updateCurrentPowerSourceText() {
    const sourceNames = {
        'solar': 'সোলার',
        'battery': 'ব্যাটারি',
        'grid': 'গ্রিড',
        'off': 'বন্ধ'
    };
    
    const modeText = powerMode === 'auto' ? ' (অটো)' : powerMode === 'manual' ? ' (ম্যানুয়াল)' : '';
    return sourceNames[activePowerSource] + modeText;
}

function updatePowerFlow(source) {
    const pathItems = document.querySelectorAll('.path-item');
    const pathArrows = document.querySelectorAll('.path-arrow');
    const currentPowerSourceEl = document.getElementById('currentPowerSource');
    
    pathItems.forEach(item => {
        item.classList.remove('active', 'solar-active', 'battery-active', 'grid-active');
        item.style.opacity = '0.6';
    });
    
    pathArrows.forEach(arrow => {
        arrow.classList.remove('active', 'solar-active', 'battery-active', 'grid-active');
        arrow.style.opacity = '0.6';
    });
    
    if (currentPowerSourceEl) {
        currentPowerSourceEl.className = '';
        currentPowerSourceEl.classList.add(source);
    }
    
    switch(source) {
        case 'solar':
            const solarItem = document.querySelector('.path-item[data-id="solar"]');
            const solarArrow = document.querySelector('.path-arrow[data-from="solar"]');
            const loadItemSolar = document.querySelector('.path-item[data-id="load"]');
            
            if (solarItem) {
                solarItem.classList.add('active', 'solar-active');
                solarItem.style.opacity = '1';
            }
            if (solarArrow) {
                solarArrow.classList.add('active', 'solar-active');
                solarArrow.style.opacity = '1';
            }
            if (loadItemSolar) {
                loadItemSolar.classList.add('active', 'solar-active');
                loadItemSolar.style.opacity = '1';
            }
            
            updateCurrentPowerSourceDisplay('solar');
            break;
            
        case 'battery':
            const batteryItem = document.querySelector('.path-item[data-id="battery"]');
            const batteryArrow = document.querySelector('.path-arrow[data-from="battery"]');
            const loadItemBattery = document.querySelector('.path-item[data-id="load"]');
            
            if (batteryItem) {
                batteryItem.classList.add('active', 'battery-active');
                batteryItem.style.opacity = '1';
            }
            if (batteryArrow) {
                batteryArrow.classList.add('active', 'battery-active');
                batteryArrow.style.opacity = '1';
            }
            if (loadItemBattery) {
                loadItemBattery.classList.add('active', 'battery-active');
                loadItemBattery.style.opacity = '1';
            }
            
            updateCurrentPowerSourceDisplay('battery');
            break;
            
        case 'grid':
            const gridItem = document.querySelector('.path-item[data-id="grid"]');
            const gridArrow = document.querySelector('.path-arrow[data-from="load"]');
            const loadItemGrid = document.querySelector('.path-item[data-id="load"]');
            
            if (gridItem) {
                gridItem.classList.add('active', 'grid-active');
                gridItem.style.opacity = '1';
            }
            if (gridArrow) {
                gridArrow.classList.add('active', 'grid-active');
                gridArrow.style.opacity = '1';
            }
            if (loadItemGrid) {
                loadItemGrid.classList.add('active', 'grid-active');
                loadItemGrid.style.opacity = '1';
            }
            
            updateCurrentPowerSourceDisplay('grid');
            break;
            
        case 'off':
            pathItems.forEach(item => {
                item.style.opacity = '0.4';
            });
            pathArrows.forEach(arrow => {
                arrow.style.opacity = '0.4';
            });
            
            updateCurrentPowerSourceDisplay('off');
            break;
    }
    
    console.log(`🔌 Power flow updated: ${source}`);
}

// ==================== DASHBOARD DATA UPDATES ====================

function updateSensorValuesFromFirebase(data) {
    currentSolarVoltage = parseFloat(data.solar_voltage) || 0;
    currentBatteryVoltage = parseFloat(data.battery_voltage) || 0;
    currentBatterySOC = parseFloat(data.battery_soc) || 0;
    solarCurrent = parseFloat(data.solar_current) || 0;
    batteryCurrent = parseFloat(data.battery_current) || 0;
    loadCurrent = parseFloat(data.load_current) || 0;
}

function updateDashboard(data) {
    updateElementValue('.solar_v', formatValue(data.solar_voltage, 'V'));
    updateElementValue('.battery_v', formatValue(data.battery_voltage, 'V'));
    updateElementValue('.load_v', formatValue(data.load_voltage, 'V'));
    
    updateElementValue('.solar_a', formatValue(data.solar_current, 'A'));
    updateElementValue('.battery_a', formatValue(data.battery_current, 'A'));
    updateElementValue('.load_a', formatValue(data.load_current, 'A'));
    
    const solarPower = (parseFloat(data.solar_voltage) || 0) * (parseFloat(data.solar_current) || 0);
    const batteryPower = (parseFloat(data.battery_voltage) || 0) * (parseFloat(data.battery_current) || 0);
    const loadPower = (parseFloat(data.load_voltage) || 0) * (parseFloat(data.load_current) || 0);
    
    updateElementValue('.solar_w', formatValue(solarPower, 'W'));
    updateElementValue('.battery_w', formatValue(batteryPower, 'W'));
    updateElementValue('.load_w', formatValue(loadPower, 'W'));
    
    updateElementValue('.battery_soc', formatValue(data.battery_soc, '%'));
    
    const batteryProgressBar = document.getElementById('batteryProgressBar');
    if (batteryProgressBar) {
        const soc = Math.min(100, Math.max(0, parseFloat(data.battery_soc) || 0));
        batteryProgressBar.style.width = soc + '%';
        
        if (soc < 20) {
            batteryProgressBar.style.backgroundColor = '#F44336';
        } else if (soc < 50) {
            batteryProgressBar.style.backgroundColor = '#FF9800';
        } else {
            batteryProgressBar.style.backgroundColor = '#4CAF50';
        }
    }
    
    const batteryHealth = document.getElementById('batteryHealthStatus');
    if (batteryHealth) {
        const soc = parseFloat(data.battery_soc) || 0;
        if (soc > 80) {
            batteryHealth.textContent = 'অতি ভালো';
            batteryHealth.style.color = '#4CAF50';
        } else if (soc > 50) {
            batteryHealth.textContent = 'ভালো';
            batteryHealth.style.color = '#8BC34A';
        } else if (soc > 30) {
            batteryHealth.textContent = 'স্বাভাবিক';
            batteryHealth.style.color = '#FFC107';
        } else if (soc > 20) {
            batteryHealth.textContent = 'সতর্কতা';
            batteryHealth.style.color = '#FF9800';
        } else {
            batteryHealth.textContent = 'ঝুঁকিপূর্ণ';
            batteryHealth.style.color = '#F44336';
        }
    }
    
    const dustElement = document.getElementById('dust');
    if (dustElement && data.dust_level) {
        dustElement.textContent = formatValue(data.dust_level, 'μg/m³');
    }
    
    const efficiencyElement = document.getElementById('efficiency');
    if (efficiencyElement && data.efficiency) {
        efficiencyElement.textContent = formatValue(data.efficiency, '%');
    }
    
    const chargingIndicator = document.getElementById('chargingIndicator');
    if (chargingIndicator) {
        if (parseFloat(data.solar_current) > 0.1 && parseFloat(data.battery_current) > 0) {
            chargingIndicator.style.display = 'inline-block';
            chargingIndicator.style.color = '#4CAF50';
        } else {
            chargingIndicator.style.display = 'none';
        }
    }
    
    const lastSyncElement = document.getElementById('last_sync');
    if (lastSyncElement) {
        const now = new Date();
        lastSyncElement.textContent = now.toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    updateHistoryTable(data);
    updateCharts(data);
    checkForAlerts(data);
}

function updateElementValue(selector, value) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(element => {
        const valueSpan = element.querySelector('.value-number') || element;
        valueSpan.textContent = value;
        
        if (!valueSpan.querySelector('.unit') && selector.includes('_v') || selector.includes('_a') || selector.includes('_w')) {
            const unit = document.createElement('span');
            unit.className = 'unit';
            if (selector.includes('_v')) unit.textContent = ' V';
            else if (selector.includes('_a')) unit.textContent = ' A';
            else if (selector.includes('_w')) unit.textContent = ' W';
            valueSpan.appendChild(unit);
        }
    });
}

function formatValue(value, unit) {
    if (value === null || value === undefined) return '0.00';
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return '0.00';
    
    const formatted = numValue.toFixed(2);
    
    if (typeof unit === 'string' && unit.length > 0) {
        return formatted;
    }
    
    return formatted + unit;
}

// ==================== HISTORY TABLE FUNCTIONS ====================

function updateHistoryTable(data) {
    const historyBody = document.getElementById('history_body');
    if (!historyBody) {
        console.error("❌ History table body not found");
        return;
    }
    
    if (historyBody.innerHTML.includes('লোড হচ্ছে') || historyBody.innerHTML.includes('Loading')) {
        historyBody.innerHTML = '';
    }
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('bn-BD', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const row = document.createElement('tr');
    
    const timeCell = document.createElement('td');
    timeCell.textContent = timeStr;
    timeCell.className = 'time-cell';
    row.appendChild(timeCell);
    
    const solarCell = document.createElement('td');
    solarCell.textContent = formatValue(data.solar_voltage, 'V');
    solarCell.className = 'voltage-cell';
    row.appendChild(solarCell);
    
    const batteryCell = document.createElement('td');
    batteryCell.textContent = formatValue(data.battery_voltage, 'V');
    batteryCell.className = 'voltage-cell';
    row.appendChild(batteryCell);
    
    const solarCurrentCell = document.createElement('td');
    solarCurrentCell.textContent = formatValue(data.solar_current, 'A');
    solarCurrentCell.className = 'current-cell';
    row.appendChild(solarCurrentCell);
    
    const socCell = document.createElement('td');
    socCell.textContent = formatValue(data.battery_soc, '%');
    socCell.className = 'soc-cell';
    row.appendChild(socCell);
    
    const dustCell = document.createElement('td');
    dustCell.textContent = data.dust_level ? formatValue(data.dust_level, 'μg/m³') : '-';
    dustCell.className = 'dust-cell';
    row.appendChild(dustCell);
    
    historyBody.insertBefore(row, historyBody.firstChild);
    
    while (historyBody.children.length > 10) {
        historyBody.removeChild(historyBody.lastChild);
    }
    
    console.log("📊 History table updated with new data");
}

// ==================== ALERTS SYSTEM ====================

function initAlertsSystem() {
    console.log("🚨 Initializing alerts system...");
    
    alerts = [];
    updateAlertsDisplay();
    
    setInterval(() => {
        checkSystemAlerts();
    }, 30000);
}

function checkForAlerts(data) {
    const newAlerts = [];
    
    if (currentSolarVoltage < AUTO_THRESHOLDS.SOLAR_MIN_VOLTAGE && currentSolarVoltage > 0) {
        newAlerts.push({
            type: 'warning',
            message: `সোলার ভোল্টেজ কম: ${currentSolarVoltage.toFixed(2)}V`,
            timestamp: new Date().toLocaleTimeString(),
            priority: 'medium'
        });
    }
    
    if (currentBatteryVoltage < AUTO_THRESHOLDS.BATTERY_MIN_VOLTAGE && currentBatteryVoltage > 0) {
        newAlerts.push({
            type: 'warning',
            message: `ব্যাটারি ভোল্টেজ কম: ${currentBatteryVoltage.toFixed(2)}V`,
            timestamp: new Date().toLocaleTimeString(),
            priority: 'high'
        });
    }
    
    if (currentBatterySOC <= AUTO_THRESHOLDS.BATTERY_CRITICAL_SOC && currentBatterySOC > 0) {
        newAlerts.push({
            type: 'error',
            message: `ব্যাটারি ক্রিটিকাল: ${currentBatterySOC.toFixed(1)}%`,
            timestamp: new Date().toLocaleTimeString(),
            priority: 'critical'
        });
    }
    
    if (!esp32Connected && powerMode === 'auto') {
        newAlerts.push({
            type: 'error',
            message: 'ESP32 সংযোগ বিচ্ছিন্ন',
            timestamp: new Date().toLocaleTimeString(),
            priority: 'high'
        });
    }
    
    if (Date.now() - lastValidDataTime > AUTO_THRESHOLDS.DATA_TIMEOUT / 2) {
        newAlerts.push({
            type: 'warning',
            message: 'ডেটা আপডেট বিলম্বিত হচ্ছে',
            timestamp: new Date().toLocaleTimeString(),
            priority: 'medium'
        });
    }
    
    newAlerts.forEach(alert => {
        addAlert(alert);
    });
}

function checkSystemAlerts() {
    if (powerMode === 'auto' && activePowerSource === 'grid' && currentSolarVoltage > 13) {
        addAlert({
            type: 'info',
            message: `সোলার ভালো আছে (${currentSolarVoltage.toFixed(2)}V) কিন্তু গ্রিডে চলছে`,
            timestamp: new Date().toLocaleTimeString(),
            priority: 'low'
        });
    }
}

function addAlert(alert) {
    const existingAlert = alerts.find(a => a.message === alert.message);
    if (existingAlert) {
        existingAlert.timestamp = alert.timestamp;
    } else {
        alerts.unshift(alert);
        
        if (alerts.length > MAX_ALERTS) {
            alerts.pop();
        }
        
        if (alert.priority === 'critical' || alert.priority === 'high') {
            showNotification(alert.message, alert.type);
        }
    }
    
    updateAlertsDisplay();
}

function updateAlertsDisplay() {
    const alertsContainer = document.getElementById('recent_alerts');
    const alertsCount = document.getElementById('alertsCount');
    
    if (!alertsContainer) {
        console.error("❌ Alerts container not found");
        return;
    }
    
    if (alertsCount) {
        alertsCount.textContent = alerts.length;
        alertsCount.style.display = alerts.length > 0 ? 'inline-block' : 'none';
    }
    
    alertsContainer.innerHTML = '';
    
    if (alerts.length === 0) {
        const emptyAlert = document.createElement('div');
        emptyAlert.className = 'alert-empty';
        emptyAlert.textContent = 'কোনো অ্যালার্ট নেই';
        alertsContainer.appendChild(emptyAlert);
        return;
    }
    
    alerts.forEach(alert => {
        const alertElement = document.createElement('div');
        alertElement.className = `alert-item alert-${alert.type}`;
        
        const alertIcon = document.createElement('i');
        if (alert.type === 'error') {
            alertIcon.className = 'fas fa-exclamation-circle';
        } else if (alert.type === 'warning') {
            alertIcon.className = 'fas fa-exclamation-triangle';
        } else {
            alertIcon.className = 'fas fa-info-circle';
        }
        
        const alertContent = document.createElement('div');
        alertContent.className = 'alert-content';
        
        const alertMessage = document.createElement('div');
        alertMessage.className = 'alert-message';
        alertMessage.textContent = alert.message;
        
        const alertTime = document.createElement('div');
        alertTime.className = 'alert-time';
        alertTime.textContent = alert.timestamp;
        
        alertContent.appendChild(alertMessage);
        alertContent.appendChild(alertTime);
        
        alertElement.appendChild(alertIcon);
        alertElement.appendChild(alertContent);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'alert-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = function(e) {
            e.stopPropagation();
            removeAlert(alert.message);
        };
        
        alertElement.appendChild(closeBtn);
        
        alertsContainer.appendChild(alertElement);
    });
    
    console.log(`🚨 Alerts displayed: ${alerts.length}`);
}

function removeAlert(message) {
    const index = alerts.findIndex(alert => alert.message === message);
    if (index !== -1) {
        alerts.splice(index, 1);
        updateAlertsDisplay();
    }
}

function clearAllAlerts() {
    alerts = [];
    updateAlertsDisplay();
    showNotification('সমস্ত অ্যালার্ট মুছে ফেলা হয়েছে', 'info');
}

// ==================== CHART FUNCTIONS ====================

function initCharts() {
    console.log("📊 Initializing charts...");
    
    if (typeof Chart === 'undefined') {
        console.error("❌ Chart.js not loaded!");
        loadChartJS();
        return;
    }
    
    try {
        const voltageCtx = document.getElementById('voltageChart');
        if (voltageCtx) {
            voltageChart = new Chart(voltageCtx, {
                type: 'line',
                data: {
                    labels: timeLabels,
                    datasets: [
                        {
                            label: 'সোলার ভোল্টেজ',
                            data: [],
                            borderColor: '#FF6384',
                            backgroundColor: 'rgba(255, 99, 132, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#FF6384'
                        },
                        {
                            label: 'ব্যাটারি ভোল্টেজ',
                            data: [],
                            borderColor: '#36A2EB',
                            backgroundColor: 'rgba(54, 162, 235, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#36A2EB'
                        },
                        {
                            label: 'লোড ভোল্টেজ',
                            data: [],
                            borderColor: '#FFCE56',
                            backgroundColor: 'rgba(255, 206, 86, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#FFCE56'
                        }
                    ]
                },
                options: getChartOptions('ভোল্টেজ ট্রেন্ড (V)', 'V')
            });
            console.log("✅ Voltage chart initialized");
        }
        
        const currentCtx = document.getElementById('currentChart');
        if (currentCtx) {
            currentChart = new Chart(currentCtx, {
                type: 'line',
                data: {
                    labels: timeLabels,
                    datasets: [
                        {
                            label: 'সোলার কারেন্ট',
                            data: [],
                            borderColor: '#4BC0C0',
                            backgroundColor: 'rgba(75, 192, 192, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#4BC0C0'
                        },
                        {
                            label: 'ব্যাটারি কারেন্ট',
                            data: [],
                            borderColor: '#9966FF',
                            backgroundColor: 'rgba(153, 102, 255, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#9966FF'
                        },
                        {
                            label: 'লোড কারেন্ট',
                            data: [],
                            borderColor: '#FF9F40',
                            backgroundColor: 'rgba(255, 159, 64, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2,
                            pointBackgroundColor: '#FF9F40'
                        }
                    ]
                },
                options: getChartOptions('কারেন্ট ট্রেন্ড (A)', 'A')
            });
            console.log("✅ Current chart initialized");
        }
        
        setTimeout(addDemoChartData, 1000);
        
    } catch (error) {
        console.error("❌ Chart initialization error:", error);
        showNotification("চার্ট শুরু করতে সমস্যা", "error");
    }
}

function loadChartJS() {
    if (typeof Chart !== 'undefined') {
        initCharts();
        return;
    }
    
    console.log("📥 Loading Chart.js from CDN...");
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    script.onload = function() {
        console.log("✅ Chart.js loaded successfully");
        initCharts();
    };
    script.onerror = function() {
        console.error("❌ Failed to load Chart.js");
        showNotification("চার্ট লাইব্রেরি লোড করা যায়নি", "error");
    };
    document.head.appendChild(script);
}

function getChartOptions(title, yAxisLabel) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    padding: 20,
                    usePointStyle: true,
                    font: {
                        size: 11
                    },
                    color: '#333'
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        label += context.parsed.y.toFixed(2) + ' ' + yAxisLabel;
                        return label;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: yAxisLabel,
                    font: {
                        size: 12,
                        weight: 'bold'
                    },
                    color: '#333'
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                    color: '#333'
                }
            },
            x: {
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                },
                title: {
                    display: true,
                    text: 'সময়',
                    font: {
                        size: 12,
                        weight: 'bold'
                    },
                    color: '#333'
                },
                ticks: {
                    color: '#333',
                    maxTicksLimit: 10
                }
            }
        },
        animation: {
            duration: 500,
            easing: 'linear'
        }
    };
}

function updateCharts(data) {
    if (!voltageChart || !currentChart) {
        console.warn("Charts not initialized yet");
        return;
    }
    
    try {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        timeLabels.push(timeStr);
        
        voltageChart.data.datasets[0].data.push(parseFloat(data.solar_voltage) || 0);
        voltageChart.data.datasets[1].data.push(parseFloat(data.battery_voltage) || 0);
        voltageChart.data.datasets[2].data.push(parseFloat(data.load_voltage) || 0);
        
        currentChart.data.datasets[0].data.push(parseFloat(data.solar_current) || 0);
        currentChart.data.datasets[1].data.push(parseFloat(data.battery_current) || 0);
        currentChart.data.datasets[2].data.push(parseFloat(data.load_current) || 0);
        
        if (timeLabels.length > chartDataPoints) {
            timeLabels.shift();
            
            voltageChart.data.datasets.forEach(dataset => dataset.data.shift());
            currentChart.data.datasets.forEach(dataset => dataset.data.shift());
        }
        
        voltageChart.data.labels = timeLabels;
        currentChart.data.labels = timeLabels;
        
        voltageChart.update('none');
        currentChart.update('none');
        
        console.log("📈 Charts updated with new data");
        
    } catch (error) {
        console.error("❌ Error updating charts:", error);
    }
}

function addDemoChartData() {
    if (!voltageChart || !currentChart) return;
    
    console.log("📊 Adding demo chart data...");
    
    timeLabels = [];
    voltageChart.data.labels = timeLabels;
    currentChart.data.labels = timeLabels;
    
    voltageChart.data.datasets.forEach(dataset => dataset.data = []);
    currentChart.data.datasets.forEach(dataset => dataset.data = []);
    
    for (let i = 0; i < 10; i++) {
        const time = new Date(Date.now() - (10 - i) * 60000).toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        timeLabels.push(time);
        
        voltageChart.data.datasets[0].data.push(24.5 + Math.random() * 2 - 1);
        voltageChart.data.datasets[1].data.push(12.3 + Math.random() * 0.5 - 0.25);
        voltageChart.data.datasets[2].data.push(12.1 + Math.random() * 0.3 - 0.15);
        
        currentChart.data.datasets[0].data.push(5.2 + Math.random() * 0.4 - 0.2);
        currentChart.data.datasets[1].data.push(2.1 + Math.random() * 0.2 - 0.1);
        currentChart.data.datasets[2].data.push(3.8 + Math.random() * 0.3 - 0.15);
    }
    
    voltageChart.update();
    currentChart.update();
    
    console.log("✅ Demo chart data added");
}

function updateBrushStatusDisplay() {
    const brushStatusElement = document.getElementById('brushStatus');
    const brushDirectionElement = document.getElementById('brushDirection');
    const pumpStatusElement = document.getElementById('pumpStatus');
    
    if (brushStatusElement) {
        brushStatusElement.textContent = brushStatus === 'stopped' ? 'বন্ধ' : 'চলছে';
        brushStatusElement.style.color = brushStatus === 'stopped' ? '#F44336' : '#4CAF50';
    }
    
    if (brushDirectionElement) {
        if (brushStatus === 'forward') {
            brushDirectionElement.textContent = 'ফরওয়ার্ড';
            brushDirectionElement.style.color = '#4CAF50';
        } else if (brushStatus === 'reverse') {
            brushDirectionElement.textContent = 'রিভার্স';
            brushDirectionElement.style.color = '#FF9800';
        } else {
            brushDirectionElement.textContent = '-';
            brushDirectionElement.style.color = '#9E9E9E';
        }
    }
    
    if (pumpStatusElement) {
        pumpStatusElement.textContent = pumpStatus === 'on' ? 'চালু' : 'বন্ধ';
        pumpStatusElement.style.color = pumpStatus === 'on' ? '#4CAF50' : '#F44336';
    }
}

// ==================== EMERGENCY STOP & RESET FUNCTIONS ====================

function emergencyStop() {
    console.log("🛑 Emergency Stop (জরুরি বন্ধ)!");
    
    stopAllIntervals();
    
    powerMode = 'stop';
    activePowerSource = 'off';
    
    updateModeUI('stop');
    updatePowerFlow('off');
    
    brushStatus = 'stopped';
    pumpStatus = 'off';
    updateBrushButtons();
    updatePumpButtons();
    
    const indicator = document.getElementById('solarPriorityIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    
    addAlert({
        type: 'error',
        message: 'সিস্টেম জরুরি বন্ধ করা হয়েছে',
        timestamp: new Date().toLocaleTimeString(),
        priority: 'critical'
    });
    
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
        emergency: true,
        system_state: 'emergency_stopped'
    };
    
    if (database && isConnected) {
        const commandsRef = database.ref("solar_system/commands");
        
        commandsRef.set(emergencyCommand)
            .then(() => {
                console.log('✅ Emergency stop command sent');
                showNotification('সিস্টেম জরুরি বন্ধ করা হয়েছে', 'error');
                
                updateFirebaseStatus('stop', 'off');
                updateCurrentPowerSourceDisplay();
                updateAllButtonStates();
            })
            .catch(error => {
                console.error('❌ Emergency stop command error:', error);
            });
    }
}

function resetFromEmergencyStop(mode, source = 'grid') {
    console.log(`🔄 Resetting from emergency stop to ${mode} mode`);
    
    const resetCommand = {
        action: 'reset_system',
        mode: mode,
        power_source: source,
        timestamp: Date.now(),
        userId: userId || 'web_user',
        system_state: 'resetting',
        emergency_reset: true,
        sensor_data_request: true,
        command: 'ENABLE_SENSORS'
    };
    
    if (database && isConnected) {
        const commandsRef = database.ref("solar_system/commands");
        
        commandsRef.set(resetCommand)
            .then(() => {
                console.log('✅ Reset command sent');
                showNotification('সিস্টেম রিসেট করা হচ্ছে...', 'info');
                
                setTimeout(() => {
                    powerMode = mode;
                    activePowerSource = source;
                    lastPowerSource = source;
                    
                    updateModeUI(mode);
                    updatePowerFlow(source);
                    updateAllButtonStates();
                    
                    setTimeout(() => {
                        console.log("🔄 Force fetching data after reset...");
                        forceDataFetchForAutoMode();
                    }, 1500);
                    
                    if (mode === 'auto') {
                        setTimeout(() => {
                            console.log("🚀 Starting auto mode after reset...");
                            startAutoPowerSwitching();
                        }, 2000);
                    }
                    
                    updateFirebaseStatus(mode, source);
                    
                    showNotification(`সিস্টেম রিসেট হয়েছে (${mode} মোড)`, 'success');
                    
                    addAlert({
                        type: 'info',
                        message: `সিস্টেম রিসেট করা হয়েছে (${mode} মোড)`,
                        timestamp: new Date().toLocaleTimeString(),
                        priority: 'low'
                    });
                }, 1000);
            })
            .catch(error => {
                console.error('❌ Reset command error:', error);
                showNotification('রিসেট কমান্ড পাঠাতে সমস্যা', 'error');
            });
    }
}

function manualStop() {
    console.log("⏹️ Manual Stop (রিলে বন্ধ)");
    
    powerMode = 'manual';
    activePowerSource = 'off';
    
    updateModeUI('manual');
    updatePowerFlow('off');
    
    const indicator = document.getElementById('solarPriorityIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    
    addAlert({
        type: 'warning',
        message: 'সিস্টেম ম্যানুয়ালি বন্ধ করা হয়েছে',
        timestamp: new Date().toLocaleTimeString(),
        priority: 'medium'
    });
    
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
        emergency: false
    };
    
    if (database && isConnected) {
        const commandsRef = database.ref("solar_system/commands");
        
        commandsRef.set(manualStopCommand)
            .then(() => {
                console.log('✅ Manual stop command sent');
                showNotification('রিলে বন্ধ করা হয়েছে (ম্যানুয়াল স্টপ)', 'warning');
                
                updateCurrentPowerSourceDisplay();
                updateFirebaseStatus('manual', 'off');
                updateAllButtonStates();
            })
            .catch(error => {
                console.error('❌ Manual stop command error:', error);
            });
    }
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

// ==================== MONITORING FUNCTIONS ====================

function startESP32Monitoring() {
    setInterval(() => {
        const now = Date.now();
        if (esp32Connected && now - esp32LastDataTime > ESP32_TIMEOUT) {
            console.log("⚠️ ESP32 connection timeout");
            esp32Connected = false;
            updateESP32Status(false);
            
            addAlert({
                type: 'error',
                message: 'ESP32 সংযোগ বিচ্ছিন্ন',
                timestamp: new Date().toLocaleTimeString(),
                priority: 'high'
            });
            
            if (powerMode === 'auto') {
                console.log("⚠️ Auto mode: ESP32 timeout, switching to grid");
                if (activePowerSource !== 'grid') {
                    executePowerSwitch('grid', 'ESP32 সংযোগ বিচ্ছিন্ন');
                }
            }
        }
    }, 10000);
}

function startDataValidityCheck() {
    setInterval(() => {
        const now = Date.now();
        if (now - lastValidDataTime > AUTO_THRESHOLDS.DATA_TIMEOUT) {
            console.log("⚠️ Data validity timeout - no valid data received");
            
            addAlert({
                type: 'error',
                message: 'ডেটা টাইমআউট - কোন ভ্যালিড ডেটা পাওয়া যায়নি',
                timestamp: new Date().toLocaleTimeString(),
                priority: 'high'
            });
            
            if (powerMode === 'auto') {
                console.log("⚠️ Auto mode: Data timeout, switching to grid");
                if (activePowerSource !== 'grid') {
                    executePowerSwitch('grid', 'ডেটা ভ্যালিডিটি টাইমআউট');
                }
            }
        }
    }, 30000);
}

function updateESP32Status(connected) {
    const cloudStatus = document.getElementById('cloud_status');
    if (cloudStatus) {
        if (connected) {
            cloudStatus.innerHTML = '☁️ ESP32 সংযুক্ত';
            cloudStatus.style.color = '#4CAF50';
        } else {
            cloudStatus.innerHTML = '☁️ ESP32 সংযোগ বিচ্ছিন্ন';
            cloudStatus.style.color = '#F44336';
        }
    }
}

function updateConnectionUI(connected) {
    const connectionIndicator = document.getElementById('connectionIndicator');
    const cloudStatus = document.getElementById('cloud_status');
    
    if (connectionIndicator) {
        connectionIndicator.className = connected ? 'connection-dot connected' : 'connection-dot disconnected';
    }
    
    if (cloudStatus) {
        if (connected) {
            cloudStatus.innerHTML = '☁️ Firebase সংযুক্ত';
            cloudStatus.style.color = '#4CAF50';
        } else {
            cloudStatus.innerHTML = '☁️ Firebase সংযোগ বিচ্ছিন্ন';
            cloudStatus.style.color = '#F44336';
            
            addAlert({
                type: 'error',
                message: 'Firebase সংযোগ বিচ্ছিন্ন',
                timestamp: new Date().toLocaleTimeString(),
                priority: 'critical'
            });
        }
    }
}

// ==================== NOTIFICATION SYSTEM ====================

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
        {id: 'brushManualBtn', type: 'brush'},
        {id: 'brushForwardBtn', type: 'brush'},
        {id: 'brushReverseBtn', type: 'brush'},
        {id: 'brushPumpStopBtn', type: 'brush'},
        {id: 'pumpOnBtn', type: 'pump'},
        {id: 'pumpOffBtn', type: 'pump'},
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

function debugAutoMode() {
    console.log("=== AUTO MODE DEBUG ===");
    console.log("Current Mode:", powerMode);
    console.log("Active Power Source:", activePowerSource);
    console.log("Solar Voltage:", currentSolarVoltage.toFixed(2), "V");
    console.log("Battery Voltage:", currentBatteryVoltage.toFixed(2), "V");
    console.log("Battery SOC:", currentBatterySOC.toFixed(1), "%");
    console.log("Voltage Diff:", (currentSolarVoltage - currentBatteryVoltage).toFixed(2), "V");
    console.log("Last Valid Data:", new Date(lastValidDataTime).toLocaleTimeString());
    console.log("ESP32 Connected:", esp32Connected);
    console.log("Firebase Connected:", isConnected);
    console.log("Is Switching:", isSwitchingInProgress);
    console.log("Solar Priority Blocks:", solarPriorityBlockCount);
    console.log("Total Energy:", totalEnergyWh.toFixed(2), "Wh");
    console.log("Alerts Count:", alerts.length);
    console.log("======================");
    
    showNotification(`ডিবাগ: ${powerMode} মোড, ${activePowerSource} সোর্স, সোলার: ${currentSolarVoltage.toFixed(2)}V`, "info");
}

function updateSystemTime() {
    const timeElement = document.getElementById('systemTime');
    if (timeElement) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        timeElement.textContent = timeStr;
    }
}

// ==================== LOGOUT FUNCTION ====================

function logout() {
    const confirmLogout = confirm("আপনি কি নিশ্চিতভাবে লগআউট করতে চান?");

    if (!confirmLogout) {
        // না চাপলে কিছুই হবে না
        return;
    }

    firebase.auth().signOut()
        .then(() => {
            console.log("✅ Logout successful");

            // UI update
            const emailSpan = document.getElementById("userEmailDisplay");
            if (emailSpan) {
                emailSpan.textContent = "লগইন করা নেই";
            }

            // Redirect to login page
            window.location.href = "login.html";
        })
        .catch((error) => {
            console.error("❌ Logout error:", error);
            alert("লগআউট করতে সমস্যা হয়েছে");
        });
}


firebase.auth().onAuthStateChanged((user) => {
    const emailSpan = document.getElementById("userEmailDisplay");

    if (user) {
        console.log("👤 Logged in:", user.email);
        if (emailSpan) {
            emailSpan.textContent = user.email;
        }
    } else {
        console.log("🚪 User logged out");
        if (emailSpan) {
            emailSpan.textContent = "লগইন করা নেই";
        }

        // Dashboard protect করতে চাইলে
        window.location.href = "login.html";
    }
});
