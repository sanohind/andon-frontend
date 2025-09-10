// Dashboard JavaScript for IoT Monitoring
class DashboardManager {
    constructor() {
        this.socket = null;
        this.currentProblemId = null;
        this.alertSound = document.getElementById('alertSound');
        this.succesSound = document.getElementById('succesSound');
        this.lastNotificationTime = 0;
        this.processedNotifications = new Set();
        this.lastKnownProblems = new Set(); // Track problems for fallback detection
        this.socketConnected = false;
        this.fallbackActive = false;
        
        const dashboardDataElement = document.getElementById('dashboardData');
        const userDataElement = document.getElementById('userData');
        this.userRole = userDataElement ? userDataElement.dataset.role : null;
        this.userLineNumber = userDataElement ? userDataElement.dataset.line : null;
        this.machines = dashboardDataElement ? JSON.parse(dashboardDataElement.dataset.machines) : [];

        this.init();
    }

    getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    init() {
        this.initSocket();
        this.bindEvents();
        this.loadDashboardData();
        this.loadStats();
        
        // Auto refresh every 30 seconds sebagai fallback HANYA jika socket tidak terhubung
        setInterval(() => {
            if (!this.socketConnected) {
                console.log('🔄 Fallback refresh activated (socket disconnected)');
                this.fallbackActive = true;
                this.loadDashboardDataWithFallbackDetection();
            } else {
                this.fallbackActive = false;
            }
        }, 30000); // 30 detik untuk fallback
        
        console.log('🚀 Dashboard Manager initialized');
    }

    initSocket() {
        // Kirim token untuk socket authentication
        const token = this.getCookieValue('auth_token');
        
        console.log('Mengirim token:', token);

        this.socket = io({
            auth: {
                token: token
            }
        }); 
        
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.socketConnected = true;
            this.fallbackActive = false;
            this.updateConnectionStatus(true);
            this.loadDashboardData();
            this.loadStats(); 
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.socketConnected = false;
            this.updateConnectionStatus(false);
        });

        this.socket.on('authError', (error) => {
            console.error('Authentication error:', error);
            this.showSweetAlert('error', 'Session Expired', 'Your session has expired. Please login again.', {
                willClose: () => {
                    window.location.href = '/login';
                }
            });
        });

        this.socket.on('dashboardUpdate', (data) => {
            console.log('📡 Received dashboardUpdate via socket');
            this.handleDashboardUpdate(data);
        });

        this.socket.on('newProblem', (problem) => {
            console.log('🚨 Received newProblem via socket:', problem);
            this.showProblemNotification(problem);
            // Tidak perlu load dashboard data lagi karena dashboardUpdate akan handle ini
        });

        this.socket.on('problemResolved', (data) => {
            console.log('✅ Received problemResolved via socket:', data);
            this.loadDashboardData();
            this.loadStats();
        })

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            if (error.message && error.message.includes('Authentication')) {
                window.location.href = '/login';
            } else {
                this.showSweetAlert('error', 'Connection Error', error.message);
            }
        });
    }

    bindEvents() {
        // Modal close events
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal();
            }
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });

        // Page visibility change - pause/resume updates
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('📴 Page hidden, reducing update frequency');
            } else {
                console.log('📱 Page visible, resuming normal updates');
                this.loadDashboardData();
            }
        });
    }

    async loadDashboardData() {
        try {
            const response = await fetch('/api/dashboard/status');
            const data = await response.json();
            
            if (data.success) {
                this.updateMachineStatuses(data.data.machine_statuses);
                this.updateActiveProblems(data.data.active_problems);
                this.updateStatsFromDashboardData(data.data);
                this.updateLastUpdateTime();
            } else {
                throw new Error(data.message || 'Failed to load dashboard data');
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.showSweetAlert('error', 'Error', 'Failed to load dashboard data');
        }
    }

    // Special method for fallback with problem detection
    async loadDashboardDataWithFallbackDetection() {
        try {
            const response = await fetch('/api/dashboard/status');
            const data = await response.json();
            
            if (data.success) {
                // Detect new problems in fallback mode
                const currentProblems = data.data.active_problems || [];
                const newProblems = [];

                // Create problem keys for current problems
                const currentProblemKeys = new Set();
                currentProblems.forEach(problem => {
                    const problemKey = `${problem.machine}-${problem.problem_type}-${problem.id}`;
                    currentProblemKeys.add(problemKey);
                    
                    // If this problem wasn't known before, it's new
                    if (!this.lastKnownProblems.has(problemKey)) {
                        newProblems.push(problem);
                        console.log('🚨 New problem detected via fallback:', problem);
                    }
                });

                // Update tracking
                this.lastKnownProblems = currentProblemKeys;

                // Show notifications for new problems
                newProblems.forEach(problem => {
                    this.showProblemNotification(problem);
                });

                // Update UI
                this.updateMachineStatuses(data.data.machine_statuses);
                this.updateActiveProblems(data.data.active_problems);
                this.updateStatsFromDashboardData(data.data);
                this.updateLastUpdateTime();
                this.loadStats(); // Refresh stats too
            } else {
                throw new Error(data.message || 'Failed to load dashboard data');
            }
        } catch (error) {
            console.error('Error loading dashboard data (fallback):', error);
        }
    }

    updateStatsFromDashboardData(dashboardData) {
        let activeProblems = dashboardData.active_problems || [];
        
        // PERBAIKAN: Filter active problems berdasarkan role dan line
        if (this.userRole === 'leader' && this.userLineNumber) {
            activeProblems = activeProblems.filter(problem => {
                return problem.line_number && problem.line_number.toString() === this.userLineNumber.toString();
            });
        }
        // Untuk role lain (admin, maintenance, quality, warehouse) tidak difilter
        
        const activeProblemsCount = activeProblems.length;
        const criticalProblemsCount = activeProblems.filter(p => p.severity === 'critical').length;
        
        // Update counters dengan data yang sudah difilter
        document.getElementById('activeProblems').textContent = activeProblemsCount;
        document.getElementById('criticalProblems').textContent = criticalProblemsCount;
    }

    async loadStats() {
        const userRole = this.userRole;
        const userLineNumber = this.userLineNumber;

        let apiUrl = '/api/dashboard/stats';

        // Jika pengguna adalah 'leader' dan memiliki nomor lini, tambahkan parameter ke URL
        if (userRole === 'leader' && userLineNumber) {
            apiUrl += `?line_number=${userLineNumber}`;
        }

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (data.success) {
                this.updateStats(data.data);
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    handleDashboardUpdate(data) {
        if (data.success && data.data) {
            this.updateMachineStatuses(data.data.machine_statuses_by_line);
            this.updateActiveProblems(data.data.active_problems);
            this.updateStatsFromDashboardData(data.data);
            this.updateLastUpdateTime();
            
            // Handle new problems for notifications (this comes from server-side detection)
            if (data.data.new_problems && data.data.new_problems.length > 0) {
                data.data.new_problems.forEach(problem => {
                    const notificationKey = `${problem.machine}-${problem.problem_type}-${problem.timestamp}`;
                    if (!this.processedNotifications.has(notificationKey)) {
                        this.processedNotifications.add(notificationKey);
                        console.log('🚨 Showing notification for new problem from dashboardUpdate:', problem);
                        this.showProblemNotification(problem);
                    }
                });
            }

            // Update fallback tracking when receiving socket updates
            if (data.data.active_problems) {
                this.lastKnownProblems.clear();
                data.data.active_problems.forEach(problem => {
                    const problemKey = `${problem.machine}-${problem.problem_type}-${problem.id}`;
                    this.lastKnownProblems.add(problemKey);
                });
            }

            // Also refresh stats
            //this.loadStats();
        }
    }

    updateMachineStatuses(groupedStatuses) {
        if (!groupedStatuses) {
            console.warn("Fungsi updateMachineStatuses dipanggil tanpa data status.");
            return;
        }

        // Iterasi melalui setiap NOMOR LINE yang diterima dari server (misalnya "1", "2")
        for (const lineNumber in groupedStatuses) {
            
            // Dapatkan array dari semua meja yang ada di line tersebut
            const machinesInLine = groupedStatuses[lineNumber];

            // Sekarang, iterasi melalui setiap MEJA di dalam line tersebut
            machinesInLine.forEach(machineData => {
                const machineName = machineData.name;
                const machineLineNumber = machineData.line_number; // PERBAIKAN: Ambil line_number dari data
                const machineId = machineName.replace(/ /g, '');
                
                // PERBAIKAN KRITIS: Gunakan kombinasi name + line_number untuk selector yang unik
                const card = document.querySelector(`[data-machine="${machineName}"][data-line="${machineLineNumber}"]`);
                const light = document.getElementById(`light-${machineId}-line-${machineLineNumber}`);
                const statusText = document.getElementById(`status-${machineId}-line-${machineLineNumber}`);

                if (!card || !light || !statusText) {
                    console.warn(`Elements not found for ${machineName} line ${machineLineNumber}`);
                    return;
                }

                if (machineData) {
                    card.classList.remove('problem'); 

                    if (machineData.status === 'problem') {
                        card.classList.add('problem');
                        light.className = 'indicator-light problem';
                        statusText.className = 'status-text problem'; 
                        statusText.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>Problem - ${machineData.problem_type || 'Unknown'}</span>`;
                    } else {
                        light.className = 'indicator-light normal';
                        statusText.className = 'status-text normal'; 
                        statusText.innerHTML = `<i class="fas fa-check-circle"></i><span>Normal Operation</span>`;
                    }
                } else {
                    console.warn(`[${machineName} Line ${machineLineNumber}]: Tidak ada data status yang diterima dari server untuk meja ini.`);
                    card.classList.remove('problem'); 
                    light.className = 'indicator-light unknown';
                    statusText.className = 'status-text unknown';
                    statusText.innerHTML = `<i class="fas fa-question-circle"></i><span>No Data / Disconnected</span>`;
                }

                // PERBAIKAN: Update ID untuk quantity dan lastcheck dengan line_number
                const quantityEl = document.getElementById(`quantity-${machineId}-line-${machineLineNumber}`);
                if (quantityEl) {
                    quantityEl.textContent = (machineData && machineData.quantity !== undefined) ? machineData.quantity : '0';
                }

                const lastCheckEl = document.getElementById(`lastcheck-${machineId}-line-${machineLineNumber}`);
                if (lastCheckEl && machineData && machineData.last_check) {
                    lastCheckEl.textContent = moment(machineData.last_check).format('HH:mm:ss');
                }
            });
        }

        console.log("--- Pembaruan Status Real-time Selesai ---");
    }

    updateActiveProblems(problems) {
        const problemsList = document.getElementById('problemsList');
        const noProblems = document.getElementById('noProblems');

        if (!problems || problems.length === 0) {
            noProblems.style.display = 'block';
            const existingProblems = problemsList.querySelectorAll('.problem-item');
            existingProblems.forEach(item => item.remove());
            return;
        }

        // PERBAIKAN: Filter problems berdasarkan role user
        let filteredProblems = problems;

        // Filter berdasarkan role dan line_number
        if (this.userRole === 'leader' && this.userLineNumber) {
            // Leader hanya melihat problem dari line mereka sendiri
            filteredProblems = problems.filter(problem => {
                return problem.line_number && problem.line_number.toString() === this.userLineNumber.toString();
            });
        }
        // Admin, maintenance, quality, warehouse melihat semua problem (tidak difilter)

        // Tampilkan hasil filter
        if (filteredProblems.length === 0) {
            noProblems.style.display = 'block';
            const existingProblems = problemsList.querySelectorAll('.problem-item');
            existingProblems.forEach(item => item.remove());
            return;
        }

        noProblems.style.display = 'none';
        const existingProblems = problemsList.querySelectorAll('.problem-item');
        existingProblems.forEach(item => item.remove());

        filteredProblems.forEach(problem => {
            const problemElement = this.createProblemElement(problem);
            problemsList.appendChild(problemElement);
        });
    }

    createProblemElement(problem) {
        const div = document.createElement('div');
        div.className = 'problem-item';
        // Remove double 'ago' if already present in problem.duration
        let durationText = problem.duration.trim();
        if (durationText.endsWith('ago ago')) {
            durationText = durationText.replace(/ago ago$/, 'ago');
        }
        div.innerHTML = `
            <div class="problem-info">
                <div class="problem-machine">${problem.machine}</div>
                <div class="problem-type">${problem.problem_type}</div>
                <div class="problem-time">${durationText}</div>
            </div>
            <div class="problem-severity">
                <span class="severity-badge ${problem.severity}">${problem.severity.toUpperCase()}</span>
            </div>
        `;

        div.addEventListener('click', () => {
            this.showProblemDetail(problem.machine, problem.id);
        });

        return div;
    }

    updateStats(stats) {
        document.getElementById('totalMachines').textContent = stats.total_machines || 5;
        document.getElementById('activeProblems').textContent = stats.active_problems || 0;
        document.getElementById('resolvedToday').textContent = stats.resolved_today || 0;
        document.getElementById('criticalProblems').textContent = stats.critical_problems || 0;
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        if (connected) {
            statusElement.className = 'connection-status';
            statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Connected</span>';
        } else {
            statusElement.className = 'connection-status disconnected';
            statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Disconnected</span>';
        }
    }

    updateLastUpdateTime() {
        document.getElementById('lastUpdate').textContent = moment().format('HH:mm:ss');
    }

    async showProblemDetail(machine, problemId = null) {
        const modal = document.getElementById('problemModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        
        if (!modal || !modalTitle || !modalBody) return;

        modalTitle.textContent = `Problem Detail - ${machine}`;
        modalBody.innerHTML = '<div class="loading">Loading...</div>';
        
        modal.classList.add('show');

        try {
            if (problemId) {
                const response = await fetch(`/api/dashboard/problem/${problemId}`);
                const data = await response.json();

                if (data.success) {
                    this.currentProblemId = problemId;
                    modalBody.innerHTML = this.createProblemDetailHTML(data.data);
                } else {
                    throw new Error(data.message);
                }
            } else {
                // PERBAIKAN: Get current machine status yang sudah diperbaiki
                const machineStatus = await this.getCurrentMachineStatus(machine);
                console.log('Machine status received:', machineStatus); // Debug log
                modalBody.innerHTML = this.createMachineDetailHTML(machine, machineStatus);
            }
        } catch (error) {
            console.error('Error loading problem detail:', error);
            modalBody.innerHTML = `<div class="error">Failed to load problem details: ${error.message}</div>`;
        }
    }


    async getCurrentMachineStatus(machine) {
        try {
            console.log(`🔍 Mencari status untuk machine: "${machine}"`);
            
            // Panggil API /status untuk mendapatkan data terbaru
            const response = await fetch('/api/dashboard/status');
            const result = await response.json();
            
            console.log('📡 Response dari API:', result);
            
            if (result.success && result.data && result.data.machine_statuses_by_line) {
                const groupedStatuses = result.data.machine_statuses_by_line;
                console.log('📊 Grouped statuses:', groupedStatuses);

                // Cari data untuk mesin yang diklik di dalam struktur data
                for (const lineNumber in groupedStatuses) {
                    console.log(`🔍 Mencari di line ${lineNumber}:`, groupedStatuses[lineNumber]);
                    
                    const foundMachine = groupedStatuses[lineNumber].find(m => {
                        console.log(`🔍 Comparing "${m.name}" with "${machine}"`);
                        return m.name === machine;
                    });
                    
                    if (foundMachine) {
                        console.log('✅ Machine ditemukan:', foundMachine);
                        return {
                            ...foundMachine,
                            line_number: foundMachine.line_number || lineNumber
                        };
                    }
                }

                // Jika tidak ditemukan di manapun
                console.warn(`❌ Status untuk '${machine}' tidak ditemukan di data terbaru.`);
                
                // PERBAIKAN: Cek apakah ada active problem untuk machine ini dari active_problems
                const activeProblems = result.data.active_problems || [];
                const machineActiveProblem = activeProblems.find(problem => 
                    problem.machine === machine || problem.tipe_mesin === machine
                );
                
                if (machineActiveProblem) {
                    console.log('✅ Ditemukan active problem untuk machine ini:', machineActiveProblem);
                    return {
                        status: 'problem',
                        name: machine,
                        problem_type: machineActiveProblem.problem_type,
                        line_number: machineActiveProblem.line_number,
                        last_check: new Date().toISOString()
                    };
                }
                
                return { 
                    status: 'normal', 
                    last_check: new Date().toISOString(),
                    name: machine,
                    problem_type: null
                };
                
            } else {
                console.error("❌ Respons API tidak valid:", result);
                return { 
                    status: 'normal', 
                    last_check: new Date().toISOString(),
                    name: machine,
                    problem_type: null
                };
            }
        } catch (error) {
            console.error('❌ Error saat mengambil status mesin:', error);
            return { 
                status: 'normal', 
                last_check: new Date().toISOString(),
                name: machine,
                problem_type: null
            };
        }
    }

    createMachineDetailHTML(machine, machineStatus) {
        console.log('Creating detail HTML for:', machine, machineStatus); // Debug log
        
        const isProblematic = machineStatus.status === 'problem';
        const statusClass = isProblematic ? 'problem' : 'normal';
        const statusIcon = isProblematic ? 'fas fa-exclamation-triangle' : 'fas fa-check-circle';
        const statusText = isProblematic ? 'Problem Detected!' : 'Normal Operation';
        const statusColor = isProblematic ? '#dc3545' : '#28a745';
        
        let problemSection = '';
        if (isProblematic && machineStatus.problem_type) {
            problemSection = `
                <div class="detail-item">
                    <span class="label">Problem Type:</span>
                    <span class="value problem-type" style="color: #dc3545; font-weight: bold;">${machineStatus.problem_type}</span>
                </div>
            `;
        }

        // TAMBAHAN: Tampilkan line number juga
        let lineSection = '';
        if (machineStatus.line_number) {
            lineSection = `
                <div class="detail-item">
                    <span class="label">Line Number:</span>
                    <span class="value">${machineStatus.line_number}</span>
                </div>
            `;
        }

        return `
            <div class="machine-detail ${statusClass}">
                <div class="machine-header">
                    <h4>${machine}</h4>
                    <div class="status-indicator ${statusClass}">
                        <i class="${statusIcon}" style="color: ${statusColor};"></i>
                        <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                    </div>
                </div>
                <p>Real-time machine status and operational information</p>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="label">Current Status:</span>
                        <span class="value status-value" style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Last Check:</span>
                        <span class="value">${moment(machineStatus.last_check).format('DD/MM/YYYY HH:mm:ss')}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Connection:</span>
                        <span class="value" style="color: #28a745;">Online</span>
                    </div>
                    ${lineSection}
                    ${problemSection}
                </div>
                
                ${isProblematic ? `
                    <div class="problem-alert" style="margin-top: 15px; padding: 15px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px;">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <i class="fas fa-exclamation-triangle" style="color: #dc3545; margin-right: 8px;"></i>
                            <strong style="color: #721c24;">Problem Detected!</strong>
                        </div>
                        <p style="margin: 0; color: #721c24;">Machine ${machine} is experiencing ${machineStatus.problem_type} issue.</p>
                    </div>
                ` : `
                    <div class="normal-status" style="margin-top: 15px; padding: 15px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px;">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <i class="fas fa-check-circle" style="color: #28a745; margin-right: 8px;"></i>
                            <strong style="color: #155724;">All Systems Normal</strong>
                        </div>
                        <p style="margin: 0; color: #155724;">Machine is operating within normal parameters. No action required.</p>
                    </div>
                `}
            </div>
        `;
    }

    createProblemDetailHTML(problem) {
        return `
            <div class="problem-detail">
                <div class="problem-header">
                    <h4>${problem.machine}</h4>
                    <span class="severity-badge ${problem.severity}">${problem.severity.toUpperCase()}</span>
                </div>
                
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="label">Problem Type:</span>
                        <span class="value">${problem.problem_type}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Started:</span>
                        <span class="value">${problem.timestamp}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Duration:</span>
                        <span class="value">${problem.duration}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Status:</span>
                        <span class="value problem-status">${problem.status}</span>
                    </div>
                </div>

                <div class="problem-description">
                    <h5>Description:</h5>
                    <p>${problem.description}</p>
                </div>

                <div class="problem-alert" style="margin-top: 15px; padding: 15px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px;">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <i class="fas fa-exclamation-triangle" style="color: #dc3545; margin-right: 8px;"></i>
                            <strong style="color: #721c24;">Action Required</strong>
                        </div>
                        <p style="margin: 0; color: #721c24;">${problem.recommended_action}</p>
                </div>
            </div>
        `;
    }
    
    async resolveProblem() {
        if (!this.currentProblemId) return;

        try {
            const response = await fetch(`/api/dashboard/problem/${this.currentProblemId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    status: 'OFF'
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Success', 'Problem marked as resolved');
                this.succesSound.currentTime = 0;
                this.succesSound.play().catch;
                this.closeModal();
                this.loadDashboardData(); // Refresh data
                this.loadStats(); // Refresh stats untuk update counter
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error resolving problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to resolve problem');
        }
    }

    closeModal() {
        const modal = document.getElementById('problemModal');
        modal.classList.remove('show');
        this.currentProblemId = null;
    }

    showProblemNotification(problem) {
        const machineName = problem.machine || problem.machine_name;
        const problemType = problem.problem_type || problem.problemType;
        const problemLineNumber = problem.line_number || problem.lineNumber || problem.line; // Multiple fallback
        
        // DEBUG: Log semua data untuk debugging
        console.log('=== DEBUG NOTIFICATION DATA ===');
        console.log('Problem data:', problem);
        console.log('User role:', this.userRole);
        console.log('User line number:', this.userLineNumber);
        console.log('Problem line number:', problemLineNumber);
        console.log('================================');

        // ==========================================================
        // LOGIKA FILTER BERBASIS ROLE DAN LINE
        // ==========================================================

        switch (this.userRole) {
            case 'admin':
                // Admin tidak pernah melihat pop-up notifikasi.
                console.log(`🔔 Notifikasi untuk Admin disembunyikan. Masalah: ${machineName} - ${problemType}`);
                return;

            case 'maintenance':
                // Maintenance hanya melihat notifikasi tipe 'Machine'.
                if (problemType && problemType.toLowerCase() !== 'machine') {
                    console.log(`🔔 Notifikasi untuk Maintenance disembunyikan. Tipe masalah: ${problemType}`);
                    return;
                }
                break;

            case 'quality':
                // Quality hanya melihat notifikasi tipe 'Quality'.
                if (problemType && problemType.toLowerCase() !== 'quality') {
                    console.log(`🔔 Notifikasi untuk Quality disembunyikan. Tipe masalah: ${problemType}`);
                    return;
                }
                break;

            case 'warehouse':
                // Warehouse hanya melihat notifikasi tipe 'Material'.
                if (problemType && problemType.toLowerCase() !== 'material') {
                    console.log(`🔔 Notifikasi untuk Warehouse disembunyikan. Tipe masalah: ${problemType}`);
                    return;
                }
                break;

            case 'leader':
                // PERBAIKAN: Validasi data dan filter berdasarkan line
                console.log(`🔍 Checking leader notification filter...`);
                
                // Validasi apakah userLineNumber tersedia
                if (!this.userLineNumber) {
                    console.warn('⚠️ User line number tidak tersedia untuk leader, notifikasi akan ditampilkan');
                    break; // Jika tidak ada line number user, tampilkan semua
                }
                
                // Validasi apakah problemLineNumber tersedia
                if (!problemLineNumber) {
                    console.warn('⚠️ Problem line number tidak tersedia, notifikasi akan ditampilkan');
                    break; // Jika tidak ada line number problem, tampilkan
                }
                
                // Convert ke string untuk comparison yang lebih reliable
                const userLine = String(this.userLineNumber).trim();
                const problemLine = String(problemLineNumber).trim();
                
                console.log(`🔍 Comparing lines - User: "${userLine}" vs Problem: "${problemLine}"`);
                
                // Jika line tidak cocok, sembunyikan notifikasi
                if (userLine !== problemLine) {
                    console.log(`🔔 Notifikasi untuk Leader disembunyikan. Problem line: ${problemLine}, User line: ${userLine}`);
                    return; // STOP eksekusi di sini
                }
                
                console.log(`✅ Line cocok, notifikasi akan ditampilkan untuk leader`);
                break;

            default:
                console.log('🔔 Role tidak dikenali atau tidak ada filter khusus');
                break;
        }

        // ==========================================================
        // AKHIR DARI LOGIKA FILTER
        // ==========================================================

        // Cooldown check
        const now = Date.now();
        if (now - this.lastNotificationTime < 3000) {
            console.log('🔔 Notifikasi diblokir karena cooldown');
            return;
        }
        this.lastNotificationTime = now;

        // Play alert sound
        this.playAlertSound();

        // Show SweetAlert2 notification
        const severity = problem.severity || 'critical';
        let icon = 'error';
        if (severity === 'warning') icon = 'warning';

        console.log(`🔔 Menampilkan notifikasi untuk: ${machineName} - ${problemType} (Role: ${this.userRole}, Line: ${this.userLineNumber})`);

        Swal.fire({
            title: `⚠️ Problem Detected!`,
            html: `
                <div style="text-align: left; margin: 10px 0;">
                    <p><strong>Mesin:</strong> ${machineName}</p>
                    <p><strong>Problem Type:</strong> ${problemType}</p>
                    <p><strong>Line:</strong> ${problemLineNumber || 'N/A'}</p>
                    <p><strong>Severity:</strong> <span style="color: ${severity === 'critical' ? '#dc3545' : '#ffc107'}">${severity.toUpperCase()}</span></p>
                    <p><strong>Waktu:</strong> ${moment().format('DD/MM/YYYY HH:mm:ss')}</p>
                </div>
            `,
            icon: icon,
            iconColor: '#dc3545',
            confirmButtonText: 'View Detail',
            cancelButtonText: 'OK',
            showCancelButton: true,
            confirmButtonColor: '#007bff',
            cancelButtonColor: '#6c757d',
            toast: false,
            position: 'center',
            showClass: {
                popup: 'animate__animated animate__pulse'
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOut'
            },
            timer: 8000,
            timerProgressBar: true
        }).then((result) => {
            if (result.isConfirmed) {
                this.showProblemDetail(machineName);
            }
        });
    }

    // TAMBAHAN: Method untuk memverifikasi data user line saat login
    verifyUserLineData() {
        console.log('=== USER LINE VERIFICATION ===');
        console.log('User role:', this.userRole);
        console.log('User line number:', this.userLineNumber);
        console.log('User line type:', typeof this.userLineNumber);
        console.log('===============================');
        
        if (this.userRole === 'leader' && !this.userLineNumber) {
            console.error('⚠️ PERINGATAN: User dengan role leader tidak memiliki line number!');
            // Tampilkan peringatan ke user atau admin
            Swal.fire({
                title: 'Konfigurasi Tidak Lengkap',
                text: 'User leader tidak memiliki line number yang valid. Silakan hubungi administrator.',
                icon: 'warning'
            });
        }
    }

    playAlertSound() {
        try {
            this.alertSound.currentTime = 0;
            this.alertSound.play().catch(error => {
                console.log('Could not play alert sound:', error);
            });
        } catch (error) {
            console.log('Alert sound not available:', error);
        }
    }

    // Utility method for showing SweetAlert2 notifications
    showSweetAlert(type, title, message, options = {}) {
        const config = {
            title: title,
            text: message,
            icon: type,
            confirmButtonText: 'OK',
            ...options
        };

        // Set colors based on type
        switch(type) {
            case 'success':
                config.confirmButtonColor = '#28a745';
                break;
            case 'error':
                config.confirmButtonColor = '#dc3545';
                break;
            case 'warning':
                config.confirmButtonColor = '#ffc107';
                break;
            default:
                config.confirmButtonColor = '#007bff';
        }

        Swal.fire(config);
    }
}

// Global functions (called from HTML)
let dashboardManager;

function showProblemDetail(machine) {
    dashboardManager.showProblemDetail(machine);
    dashboardManager.resolveProblem(machine);
}

function closeModal() {
    dashboardManager.closeModal();
}

function resolveProblem() {
    dashboardManager.resolveProblem();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    dashboardManager = new DashboardManager();
    
    // Request notification permission on load (for browser notifications as backup)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});