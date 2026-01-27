

// ==================== CHART FUNCTIONS ====================
function initCharts() {
    console.log("Initializing charts...");
    
    if (typeof Chart === 'undefined') {
        console.error("Chart.js not loaded!");
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
                            label: 'সোলার ভোল্টেজ',
                            data: [],
                            borderColor: '#FF6384',
                            backgroundColor: 'rgba(255, 99, 132, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2
                        },
                        {
                            label: 'ব্যাটারি ভোল্টেজ',
                            data: [],
                            borderColor: '#36A2EB',
                            backgroundColor: 'rgba(54, 162, 235, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2
                        },
                        {
                            label: 'লোড ভোল্টেজ',
                            data: [],
                            borderColor: '#FFCE56',
                            backgroundColor: 'rgba(255, 206, 86, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2
                        }
                    ]
                },
                options: getChartOptions('ভোল্টেজ ট্রেন্ড (V)', 'V')
            });
        }
        
        // Current Chart
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
                            pointRadius: 2
                        },
                        {
                            label: 'ব্যাটারি কারেন্ট',
                            data: [],
                            borderColor: '#9966FF',
                            backgroundColor: 'rgba(153, 102, 255, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2
                        },
                        {
                            label: 'লোড কারেন্ট',
                            data: [],
                            borderColor: '#FF9F40',
                            backgroundColor: 'rgba(255, 159, 64, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 2
                        }
                    ]
                },
                options: getChartOptions('কারেন্ট ট্রেন্ড (A)', 'A')
            });
        }
        
        console.log("✅ Charts initialized successfully");
        setTimeout(addDemoChartData, 500);
        
    } catch (error) {
        console.error("❌ Chart initialization error:", error);
    }
}

function loadChartJS() {
    // Check if already loaded
    if (typeof Chart !== 'undefined') {
        initCharts();
        return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.onload = function() {
        console.log("Chart.js loaded successfully");
        initCharts();
    };
    script.onerror = function() {
        console.error("Failed to load Chart.js");
        showNotification("চার্ট লাইব্রেরি লোড করা যায়নি", "error");
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
                    }
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        label += context.parsed.y.toFixed(2);
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
                    }
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                }
            },
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                title: {
                    display: true,
                    text: 'সময়',
                    font: {
                        size: 12,
                        weight: 'bold'
                    }
                }
            }
        }
    };
}


function updateCharts(data) {
    if (!voltageChart || !currentChart) {
        console.warn("Charts not initialized yet");
        return;
    }
    
    try {
        const now = new Date().toLocaleTimeString('bn-BD', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Add new time label
        timeLabels.push(now);
        
        // Update voltage chart data
        voltageChart.data.datasets[0].data.push(parseFloat(data.solar_voltage) || 0);
        voltageChart.data.datasets[1].data.push(parseFloat(data.battery_voltage) || 0);
        voltageChart.data.datasets[2].data.push(parseFloat(data.load_voltage) || 0);
        
        // Update current chart data
        currentChart.data.datasets[0].data.push(parseFloat(data.solar_current) || 0);
        currentChart.data.datasets[1].data.push(parseFloat(data.battery_current) || 0);
        currentChart.data.datasets[2].data.push(parseFloat(data.load_current) || 0);
        
        // Keep only last chartDataPoints
        if (timeLabels.length > chartDataPoints) {
            timeLabels.shift();
            
            voltageChart.data.datasets.forEach(dataset => dataset.data.shift());
            currentChart.data.datasets.forEach(dataset => dataset.data.shift());
        }
        
        // Update charts
        voltageChart.update('none');
        currentChart.update('none');
        
    } catch (error) {
        console.error("Error updating charts:", error);
    }
}

function addDemoChartData() {
    if (!voltageChart || !currentChart) return;
    
    console.log("Adding demo chart data...");
    
    // Clear existing data
    timeLabels = [];
    voltageChart.data.labels = timeLabels;
    currentChart.data.labels = timeLabels;
    
    voltageChart.data.datasets.forEach(dataset => dataset.data = []);
    currentChart.data.datasets.forEach(dataset => dataset.data = []);
    
    // Generate demo data
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
}