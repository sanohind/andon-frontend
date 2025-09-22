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
        this.lastMachineStatuses = {}; // Menyimpan data machine status yang sudah difilter
        this.lastActiveProblems = []; // Menyimpan data active problems yang sudah difilter
        
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
        });

        // TAMBAHAN BARU: Handler untuk problem forwarded
        this.socket.on('problemForwarded', (data) => {
            console.log('📧 Received problemForwarded via socket:', data);
            this.showForwardedProblemNotification(data);
            // PERBAIKAN: Refresh data setelah forward untuk update machine status dan problem list
            this.loadDashboardData();
        });

        // Handler untuk problem received
        this.socket.on('problemReceived', (data) => {
            console.log('📥 Received problemReceived via socket:', data);
            this.showProblemReceivedNotification(data);
        });

        // Handler untuk problem feedback resolved
        this.socket.on('problemFeedbackResolved', (data) => {
            console.log('📝 Received problemFeedbackResolved via socket:', data);
            this.showProblemFeedbackResolvedNotification(data);
        });

        // Handler untuk problem final resolved
        this.socket.on('problemFinalResolved', (data) => {
            console.log('✅ Received problemFinalResolved via socket:', data);
            this.showProblemFinalResolvedNotification(data);
            this.loadDashboardData();
            this.loadStats();
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
            // PERBAIKAN: Gunakan data yang sudah difilter dari socket, bukan memanggil API langsung
            // Ini memastikan department users tidak melihat problem sebelum forward
            if (this.lastMachineStatuses && this.lastActiveProblems) {
                console.log('🔄 Using cached filtered data for refresh');
                this.updateMachineStatuses(this.lastMachineStatuses);
                this.updateActiveProblems(this.lastActiveProblems);
                this.updateLastUpdateTime();
            } else {
                // Fallback: Jika data tidak tersedia, minta refresh dari server
                console.log('🔄 No cached data, requesting refresh from server');
                this.socket.emit('requestUpdate');
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.showSweetAlert('error', 'Error', 'Failed to load dashboard data');
        }
    }

    // Special method for fallback with problem detection
    async loadDashboardDataWithFallbackDetection() {
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch('/api/dashboard/status', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
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
                this.updateMachineStatuses(data.data.machine_statuses_by_line);
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
            const token = this.getCookieValue('auth_token');
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
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

        // PERBAIKAN: Simpan data machine status yang sudah difilter untuk digunakan di getCurrentMachineStatus
        this.lastMachineStatuses = groupedStatuses;

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

                    // PERBAIKAN: Backend sudah melakukan role filtering, jadi kita langsung gunakan status dari backend
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
        } else if (['maintenance', 'quality', 'warehouse'].includes(this.userRole)) {
            // Department users hanya melihat problem yang sudah di-forward ke mereka
            filteredProblems = problems.filter(problem => {
                return problem.is_forwarded && problem.forwarded_to_role === this.userRole;
            });
        }
        // Admin melihat semua problem (tidak difilter)

        // PERBAIKAN: Simpan data active problems yang sudah difilter untuk digunakan di loadDashboardData
        this.lastActiveProblems = filteredProblems;

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

    async showProblemDetail(machine, problemId = null, machineLine = null) {
        const modal = document.getElementById('problemModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        const modalFooter = document.querySelector('.modal-footer');
        
        if (!modal || !modalTitle || !modalBody) return;

        modalTitle.textContent = `Detail - ${machine}`;
        modalBody.innerHTML = '<div class="loading">Loading...</div>';
        
        // Clear any existing action buttons from footer
        const existingActionButtons = modalFooter.querySelectorAll('.action-buttons');
        existingActionButtons.forEach(btn => btn.remove());
        
        modal.classList.add('show');

        try {
            if (problemId) {
                const response = await fetch(`/api/dashboard/problem/${problemId}`);
                const data = await response.json();

                if (data.success) {
                    this.currentProblemId = problemId;
                    const problemDetailHTML = this.createProblemDetailHTML(data.data);
                    
                    // Extract action buttons from the HTML and move them to footer
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = problemDetailHTML;
                    const actionButtons = tempDiv.querySelector('.action-buttons');
                    
                    if (actionButtons) {
                        // Remove action buttons from the main content
                        const contentWithoutActions = problemDetailHTML.replace(/<div class="action-buttons"[\s\S]*?<\/div>/g, '');
                        modalBody.innerHTML = contentWithoutActions;
                        
                        // Add action buttons to footer
                        modalFooter.appendChild(actionButtons);
                    } else {
                        modalBody.innerHTML = problemDetailHTML;
                    }
                    
                    // Event listeners untuk tombol-tombol action
                    this.bindProblemActionButtons(problemId, data.data);
                } else {
                    throw new Error(data.message);
                }
            } else {
                console.log(`🔍 showProblemDetail called with machine: ${machine}, machineLine: ${machineLine}`);
                
                if (!machineLine) {
                    const machineCard = document.querySelector(`[data-machine="${machine}"]`);
                    if (machineCard) {
                        machineLine = machineCard.getAttribute('data-line');
                        console.log(`🔍 Extracted line from DOM: ${machineLine}`);
                    }
                }
                
                const machineStatus = await this.getCurrentMachineStatus(machine, machineLine);
                console.log('Machine status received:', machineStatus);
                modalBody.innerHTML = this.createMachineDetailHTML(machine, machineStatus);
            }
        } catch (error) {
            console.error('Error loading problem detail:', error);
            modalBody.innerHTML = `<div class="error">Failed to load problem details: ${error.message}</div>`;
        }
    }

    async getCurrentMachineStatus(machine, machineLine) {
        try {
            console.log(`🔍 getCurrentMachineStatus called with machine: "${machine}", line: "${machineLine}"`);
            
            // PERBAIKAN: Gunakan data yang sudah difilter dari socket, bukan memanggil API langsung
            // Ini memastikan department users tidak melihat problem sebelum forward
            const groupedStatuses = this.lastMachineStatuses || {};
            console.log('📊 Using filtered machine statuses:', groupedStatuses);

            // PERBAIKAN UTAMA: Prioritaskan pencarian berdasarkan machineLine jika tersedia
            if (machineLine) {
                console.log(`🎯 Mencari di line spesifik: ${machineLine}`);
                const machinesInLine = groupedStatuses[machineLine];
                
                if (machinesInLine && Array.isArray(machinesInLine)) {
                    const foundMachine = machinesInLine.find(m => m.name === machine);
                    if (foundMachine) {
                        console.log('✅ Machine ditemukan di line yang tepat:', foundMachine);
                        return {
                            ...foundMachine,
                            line_number: foundMachine.line_number || machineLine // Pastikan line_number benar
                        };
                    }
                }
            }

            // Fallback: Cari di semua line jika machineLine tidak tersedia atau tidak ditemukan
            for (const lineNumber in groupedStatuses) {
                console.log(`🔍 Fallback search di line ${lineNumber}:`, groupedStatuses[lineNumber]);
                
                const foundMachine = groupedStatuses[lineNumber].find(m => {
                    console.log(`🔍 Comparing "${m.name}" with "${machine}"`);
                    return m.name === machine;
                });
                
                if (foundMachine) {
                    console.log('✅ Machine ditemukan via fallback:', foundMachine);
                    return {
                        ...foundMachine,
                        line_number: foundMachine.line_number || lineNumber
                    };
                }
            }

            // Jika tidak ditemukan di manapun, return status normal
            console.warn(`❌ Status untuk '${machine}' tidak ditemukan di data terbaru.`);
            return { 
                status: 'normal', 
                last_check: new Date().toISOString(),
                name: machine,
                problem_type: null,
                line_number: machineLine || 'N/A'
            };
        } catch (error) {
            console.error('❌ Error saat mengambil status mesin:', error);
            return { 
                status: 'normal', 
                last_check: new Date().toISOString(),
                name: machine,
                problem_type: null,
                line_number: machineLine || 'N/A' // PERBAIKAN: Gunakan parameter machineLine
            };
        }
    }


    createMachineDetailHTML(machine, machineStatus) {
        console.log('Creating new detail HTML for:', machine, machineStatus);
        
        const isProblem = machineStatus.status === 'problem';
        const statusClass = isProblem ? 'status-problem' : 'status-normal';
        const statusIcon = isProblem ? 'fa-exclamation-triangle' : 'fa-check-circle';
        const statusText = isProblem ? (machineStatus.problem_type || 'Problem') : 'Normal Operation';

        const lastCheck = machineStatus.last_check ? moment(machineStatus.last_check).format('DD/MM/YYYY HH:mm:ss') : 'N/A';
        const lineNumber = machineStatus.line_number || 'N/A';

        let messageBoxHTML = '';
        if (isProblem) {
            messageBoxHTML = `
                <div class="system-message system-problem">
                    <h4><i class="fas fa-exclamation-triangle"></i> Problem Detected!</h4>
                    <p>Machine ${machine} is experiencing a <strong>${machineStatus.problem_type || 'Unknown'}</strong> issue.</p>
                </div>
            `;
        } else {
            messageBoxHTML = `
                <div class="system-message system-normal">
                    <h4><i class="fas fa-check-circle"></i> All Systems Normal</h4>
                    <p>Machine is operating within normal parameters. No action required.</p>
                </div>
            `;
        }

        // Ini adalah template HTML baru yang lebih bersih
        return `
            <div class="new-modal-layout">
                <div class="modal-main-header">
                    <h3>${machine}</h3>
                    <span class="status-badge ${statusClass}">
                        <i class="fas ${statusIcon}"></i>
                        ${statusText}
                    </span>
                </div>
                <p class="modal-description">Real-time machine status and operational information.</p>

                <ul class="detail-list">
                    <li>
                        <i class="fas fa-power-off detail-icon"></i>
                        <strong>Current Status:</strong>
                        <span class="status-value ${statusClass}">${statusText}</span>
                    </li>
                    <li>
                        <i class="fas fa-clock detail-icon"></i>
                        <strong>Last Check:</strong>
                        <span>${lastCheck}</span>
                    </li>
                    <li>
                        <i class="fas fa-wifi detail-icon"></i>
                        <strong>Connection:</strong>
                        <span style="color: #28a745;">Online</span>
                    </li>
                    <li>
                        <i class="fas fa-sitemap detail-icon"></i>
                        <strong>Line Number:</strong>
                        <span>${lineNumber}</span>
                    </li>
                </ul>

                ${messageBoxHTML}
            </div>
        `;
    }

    createProblemDetailHTML(problem) {
        const isLeader = this.userRole === 'leader';
        const isDepartmentUser = ['maintenance', 'quality', 'warehouse'].includes(this.userRole);
        
        // Tentukan target role berdasarkan problem type
        let targetRole = '';
        switch (problem.problem_type.toLowerCase()) {
            case 'machine':
                targetRole = 'Maintenance';
                break;
            case 'quality':
                targetRole = 'Quality Control';
                break;
            case 'material':
                targetRole = 'Warehouse';
                break;
            default:
                targetRole = 'Unknown';
        }

        // Tentukan status problem dan tampilan yang sesuai
        let statusDisplay = '';
        let actionButtons = '';
        
        // Debug log untuk troubleshooting
        console.log('Creating problem detail HTML:', {
            problem_status: problem.problem_status,
            is_forwarded: problem.is_forwarded,
            is_received: problem.is_received,
            has_feedback_resolved: problem.has_feedback_resolved,
            userRole: this.userRole,
            isLeader,
            isDepartmentUser
        });
        
        // Tentukan status berdasarkan kondisi problem
        let actualStatus = 'active';
        if (problem.status === 'OFF') {
            actualStatus = 'resolved';
        } else if (problem.has_feedback_resolved) {
            actualStatus = 'feedback_resolved';
        } else if (problem.is_received) {
            actualStatus = 'received';
        } else if (problem.is_forwarded) {
            actualStatus = 'forwarded';
        }
        
        // Update problem object dengan status yang benar
        problem.problem_status = actualStatus;
        
        if (actualStatus === 'active' && isLeader) {
            // Problem baru, leader bisa forward atau resolve langsung
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px; display: flex; gap: 10px;">
                    <button class="btn btn-forward" id="forwardBtn" style="background-color: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-share" style="margin-right: 5px;"></i>
                        Forward ke ${targetRole}
                    </button>
                    <button class="btn btn-direct-resolve" id="directResolveBtn" style="background-color: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-check" style="margin-right: 5px;"></i>
                        Direct Resolve
                    </button>
                </div>
            `;
        } else if (actualStatus === 'forwarded' && isDepartmentUser) {
            // Problem sudah di-forward, department user bisa receive
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px;">
                    <button class="btn btn-receive" id="receiveBtn" style="background-color: #17a2b8; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                        <i class="fas fa-hand-paper" style="margin-right: 5px;"></i>
                        Receive Problem
                    </button>
                </div>
            `;
        } else if (actualStatus === 'received' && isDepartmentUser) {
            // Problem sudah diterima, department user bisa feedback resolved
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px;">
                    <button class="btn btn-feedback-resolved" id="feedbackResolvedBtn" style="background-color: #ffc107; color: #212529; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                        <i class="fas fa-check-circle" style="margin-right: 5px;"></i>
                        Mark as Resolved (Feedback)
                    </button>
                </div>
            `;
        } else if (actualStatus === 'feedback_resolved' && isLeader) {
            // Problem sudah ada feedback resolved, leader bisa final resolve
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px;">
                    <button class="btn btn-final-resolve" id="finalResolveBtn" style="background-color: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                        <i class="fas fa-check-double" style="margin-right: 5px;"></i>
                        Final Resolve
                    </button>
                </div>
            `;
        }

        // Status display berdasarkan problem status
        switch (actualStatus) {
            case 'active':
                statusDisplay = '<span class="status-badge status-active">Active - Waiting for Action</span>';
                break;
            case 'forwarded':
                statusDisplay = '<span class="status-badge status-forwarded">Forwarded - Waiting for Receive</span>';
                break;
            case 'received':
                statusDisplay = '<span class="status-badge status-received">Received - In Progress</span>';
                break;
            case 'feedback_resolved':
                statusDisplay = '<span class="status-badge status-feedback-resolved">Feedback Resolved - Waiting for Final Confirmation</span>';
                break;
            case 'resolved':
                statusDisplay = '<span class="status-badge status-resolved">Resolved</span>';
                break;
            default:
                statusDisplay = '<span class="status-badge status-unknown">Unknown Status</span>';
        }

        return `
            <div class="problem-detail">
                <div class="problem-header">
                    <h4>${problem.machine}</h4>
                    <span class="severity-badge ${problem.severity}">${problem.severity.toUpperCase()}</span>
                </div>
                
                <div class="problem-status-display" style="margin: 15px 0; text-align: center;">
                    ${statusDisplay}
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
                        <span class="label">Line:</span>
                        <span class="value">${problem.line_number || 'N/A'}</span>
                    </div>
                </div>

                ${problem.forwarded_by ? `
                    <div class="forward-info" style="margin: 15px 0; padding: 10px; background-color: #e7f3ff; border-left: 4px solid #0066cc; border-radius: 4px;">
                        <strong>Forwarded by:</strong> ${problem.forwarded_by}<br>
                        <strong>Forwarded at:</strong> ${problem.forwarded_at || 'N/A'}<br>
                        <strong>Target:</strong> ${targetRole}<br>
                        ${problem.forward_message ? `<strong>Message:</strong> ${problem.forward_message}` : ''}
                    </div>
                ` : ''}

                ${problem.received_by ? `
                    <div class="receive-info" style="margin: 15px 0; padding: 10px; background-color: #d1ecf1; border-left: 4px solid #17a2b8; border-radius: 4px;">
                        <strong>Received by:</strong> ${problem.received_by}<br>
                        <strong>Received at:</strong> ${problem.received_at || 'N/A'}
                    </div>
                ` : ''}

                ${problem.feedback_resolved_by ? `
                    <div class="feedback-info" style="margin: 15px 0; padding: 10px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <strong>Feedback by:</strong> ${problem.feedback_resolved_by}<br>
                        <strong>Feedback at:</strong> ${problem.feedback_resolved_at || 'N/A'}<br>
                        ${problem.feedback_message ? `<strong>Message:</strong> ${problem.feedback_message}` : ''}
                    </div>
                ` : ''}

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

                ${actionButtons}
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
            case 'quality':
            case 'warehouse':
                // Department users TIDAK PERNAH melihat notifikasi problem baru
                // Mereka hanya melihat notifikasi ketika problem di-forward ke mereka
                console.log(`🔔 Notifikasi untuk Department User (${this.userRole}) disembunyikan. Mereka hanya melihat notifikasi forward.`);
                return;

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

    showForwardConfirmation(problemId, problemData) {
    let targetRole = '';
    switch (problemData.problem_type.toLowerCase()) {
        case 'machine':
            targetRole = 'Maintenance Team';
            break;
        case 'quality':
            targetRole = 'Quality Control Team';
            break;
        case 'material':
            targetRole = 'Warehouse Team';
            break;
        default:
            targetRole = 'Unknown Team';
    }

    Swal.fire({
        title: 'Forward Problem?',
        html: `
            <div style="text-align: left; margin: 15px 0;">
                <p><strong>Mesin:</strong> ${problemData.machine}</p>
                <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                <p><strong>Akan diteruskan ke:</strong> <span style="color: #0066cc; font-weight: bold;">${targetRole}</span></p>
            </div>
            <div style="text-align: left; margin-top: 15px;">
                <label for="forwardMessage" style="display: block; margin-bottom: 5px; font-weight: bold;">Pesan (Opsional):</label>
                <textarea id="forwardMessage" class="swal2-input" placeholder="Tambahkan pesan untuk tim yang menangani..." style="height: 80px; resize: vertical;"></textarea>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Forward',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#0066cc',
        cancelButtonColor: '#6c757d',
        preConfirm: () => {
            const message = document.getElementById('forwardMessage').value;
            return { message: message };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            this.forwardProblem(problemId, result.value.message);
        }
    });
}

    // 5. METHOD BARU: forwardProblem
    async forwardProblem(problemId, message = '') {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/forward`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message || 'Problem telah diteruskan untuk penanganan.'
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Forwarded', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error forwarding problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to forward problem: ' + error.message);
        }
    }

    // Method untuk bind event listeners pada tombol-tombol action
    bindProblemActionButtons(problemId, problemData) {
        // Forward button
        const forwardBtn = document.getElementById('forwardBtn');
        if (forwardBtn) {
            forwardBtn.addEventListener('click', () => {
                this.showForwardConfirmation(problemId, problemData);
            });
        }

        // Receive button
        const receiveBtn = document.getElementById('receiveBtn');
        if (receiveBtn) {
            receiveBtn.addEventListener('click', () => {
                this.receiveProblem(problemId);
            });
        }

        // Feedback resolved button
        const feedbackResolvedBtn = document.getElementById('feedbackResolvedBtn');
        if (feedbackResolvedBtn) {
            feedbackResolvedBtn.addEventListener('click', () => {
                this.showFeedbackResolvedConfirmation(problemId, problemData);
            });
        }

        // Final resolve button
        const finalResolveBtn = document.getElementById('finalResolveBtn');
        if (finalResolveBtn) {
            finalResolveBtn.addEventListener('click', () => {
                this.showFinalResolveConfirmation(problemId, problemData);
            });
        }

        // Direct resolve button (for direct resolve by leader without forward)
        const directResolveBtn = document.getElementById('directResolveBtn');
        if (directResolveBtn) {
            directResolveBtn.addEventListener('click', () => {
                this.showDirectResolveConfirmation(problemId, problemData);
            });
        }
    }

    // Method untuk receive problem
    async receiveProblem(problemId) {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/receive`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Received', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error receiving problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to receive problem: ' + error.message);
        }
    }

    // Method untuk show feedback resolved confirmation
    showFeedbackResolvedConfirmation(problemId, problemData) {
        Swal.fire({
            title: 'Mark as Resolved?',
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Mesin:</strong> ${problemData.machine}</p>
                    <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                    <p style="color: #ffc107; font-weight: bold;">Ini adalah feedback bahwa problem sudah selesai ditangani. Leader akan melakukan final confirmation.</p>
                </div>
                <div style="text-align: left; margin-top: 15px;">
                    <label for="feedbackMessage" style="display: block; margin-bottom: 5px; font-weight: bold;">Pesan (Opsional):</label>
                    <textarea id="feedbackMessage" class="swal2-input" placeholder="Tambahkan catatan tentang penanganan problem..." style="height: 80px; resize: vertical;"></textarea>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Mark as Resolved',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#ffc107',
            cancelButtonColor: '#6c757d',
            preConfirm: () => {
                const message = document.getElementById('feedbackMessage').value;
                return { message: message };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                this.feedbackResolvedProblem(problemId, result.value.message);
            }
        });
    }

    // Method untuk feedback resolved problem
    async feedbackResolvedProblem(problemId, message = '') {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/feedback-resolved`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message || 'Problem sudah selesai ditangani.'
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Feedback Sent', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error feedback resolved problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to send feedback: ' + error.message);
        }
    }

    // Method untuk show direct resolve confirmation (leader resolve without forward)
    showDirectResolveConfirmation(problemId, problemData) {
        Swal.fire({
            title: 'Direct Resolve Problem?',
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Mesin:</strong> ${problemData.machine}</p>
                    <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                    <p style="color: #28a745; font-weight: bold;">Ini akan menyelesaikan problem secara langsung tanpa forward ke department.</p>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, Resolve Directly',
            cancelButtonText: 'Cancel'
        }).then((result) => {
            if (result.isConfirmed) {
                this.directResolveProblem(problemId);
            }
        });
    }

    // Method untuk direct resolve problem
    async directResolveProblem(problemId) {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/final-resolved`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Resolved', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
                this.loadStats(); // Refresh stats
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error direct resolving problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to direct resolve problem: ' + error.message);
        }
    }

    // Method untuk show final resolve confirmation
    showFinalResolveConfirmation(problemId, problemData) {
        Swal.fire({
            title: 'Final Resolve Problem?',
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Mesin:</strong> ${problemData.machine}</p>
                    <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                    <p style="color: #28a745; font-weight: bold;">Ini akan menyelesaikan problem secara final. Problem akan dihapus dari daftar aktif.</p>
                    ${problemData.feedback_resolved_by ? `<p><strong>Feedback dari:</strong> ${problemData.feedback_resolved_by}</p>` : ''}
                    ${problemData.feedback_message ? `<p><strong>Feedback message:</strong> ${problemData.feedback_message}</p>` : ''}
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Final Resolve',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d'
        }).then((result) => {
            if (result.isConfirmed) {
                this.finalResolveProblem(problemId);
            }
        });
    }

    // Method untuk final resolve problem
    async finalResolveProblem(problemId) {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/final-resolved`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Resolved', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
                this.loadStats(); // Refresh stats
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error final resolving problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to final resolve problem: ' + error.message);
        }
    }

    // 6. METHOD BARU: showForwardedProblemNotification
    showForwardedProblemNotification(data) {
        console.log(`📧 Showing forwarded problem notification for role: ${this.userRole}`);

        // PERBAIKAN: Pastikan hanya department users yang sesuai yang melihat notifikasi ini
        if (['maintenance', 'quality', 'warehouse'].includes(this.userRole)) {
            // Cek apakah notifikasi ini untuk role user ini
            if (data.target_role !== this.userRole) {
                console.log(`📧 Notifikasi forward tidak untuk role ${this.userRole}, disembunyikan`);
                return;
            }
        } else {
            console.log(`📧 Notifikasi forward tidak untuk role ${this.userRole}, disembunyikan`);
            return;
        }

        // Play alert sound
        this.playAlertSound();

        // Determine icon and color based on target role
        let roleIcon = 'fas fa-tools';
        let roleColor = '#0066cc';
        
        switch(data.target_role) {
            case 'maintenance':
                roleIcon = 'fas fa-tools';
                roleColor = '#dc3545';
                break;
            case 'quality':
                roleIcon = 'fas fa-clipboard-check';
                roleColor = '#ffc107';
                break;
            case 'warehouse':
                roleIcon = 'fas fa-boxes';
                roleColor = '#28a745';
                break;
        }

        Swal.fire({
            title: `📧 Problem Forwarded to You!`,
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <div style="display: flex; align-items: center; margin-bottom: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px;">
                        <i class="${roleIcon}" style="color: ${roleColor}; font-size: 24px; margin-right: 12px;"></i>
                        <div>
                            <div style="font-weight: bold; color: #333;">Assigned to: ${data.target_role.toUpperCase()}</div>
                            <div style="font-size: 12px; color: #666;">From: ${data.forwarded_by}</div>
                        </div>
                    </div>
                    <p><strong>Mesin:</strong> ${data.machine_name}</p>
                    <p><strong>Problem Type:</strong> ${data.problem_type}</p>
                    <p><strong>Line:</strong> ${data.line_number || 'N/A'}</p>
                    <p><strong>Waktu Forward:</strong> ${moment(data.timestamp).format('DD/MM/YYYY HH:mm:ss')}</p>
                    ${data.message ? `<div style="margin-top: 15px; padding: 10px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;"><strong>Pesan:</strong><br>"${data.message}"</div>` : ''}
                </div>
            `,
            icon: 'info',
            iconColor: roleColor,
            confirmButtonText: 'View Problem',
            cancelButtonText: 'OK',
            showCancelButton: true,
            confirmButtonColor: roleColor,
            cancelButtonColor: '#6c757d',
            toast: false,
            position: 'center',
            timer: 12000,
            timerProgressBar: true,
            showClass: {
                popup: 'animate__animated animate__bounceIn'
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOut'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Tutup SweetAlert dan buka problem detail
                this.showProblemDetail(data.machine_name, data.id);
            }
        });
    }

    // Method untuk show problem received notification (untuk leader)
    showProblemReceivedNotification(data) {
        console.log(`📥 Showing problem received notification for leader`);

        Swal.fire({
            title: `📥 Problem Received`,
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Problem ID:</strong> ${data.problem_id}</p>
                    <p><strong>Received by:</strong> ${data.received_by}</p>
                    <p><strong>Received at:</strong> ${data.received_at}</p>
                    <p style="color: #17a2b8; font-weight: bold;">Problem telah diterima dan sedang ditangani.</p>
                </div>
            `,
            icon: 'info',
            iconColor: '#17a2b8',
            confirmButtonText: 'OK',
            toast: true,
            position: 'top-end',
            timer: 5000,
            timerProgressBar: true
        });
    }

    // Method untuk show problem feedback resolved notification (untuk leader)
    showProblemFeedbackResolvedNotification(data) {
        console.log(`📝 Showing problem feedback resolved notification for leader`);

        Swal.fire({
            title: `📝 Problem Feedback Resolved`,
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Problem ID:</strong> ${data.problem_id}</p>
                    <p><strong>Feedback by:</strong> ${data.feedback_by}</p>
                    <p><strong>Feedback at:</strong> ${data.feedback_at}</p>
                    <p><strong>Message:</strong> ${data.message}</p>
                    <p style="color: #ffc107; font-weight: bold;">Problem sudah selesai ditangani, menunggu konfirmasi final dari leader.</p>
                </div>
            `,
            icon: 'warning',
            iconColor: '#ffc107',
            confirmButtonText: 'View Problem',
            cancelButtonText: 'OK',
            showCancelButton: true,
            confirmButtonColor: '#ffc107',
            cancelButtonColor: '#6c757d',
            toast: false,
            position: 'center',
            timer: 10000,
            timerProgressBar: true
        }).then((result) => {
            if (result.isConfirmed) {
                // Buka problem detail untuk final resolve
                this.loadDashboardData(); // Refresh data first
                // Note: Problem ID akan didapat dari data yang sudah di-refresh
            }
        });
    }

    // Method untuk show problem final resolved notification
    showProblemFinalResolvedNotification(data) {
        console.log(`✅ Showing problem final resolved notification`);

        Swal.fire({
            title: `✅ Problem Resolved`,
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Problem ID:</strong> ${data.problem_id}</p>
                    <p><strong>Resolved by:</strong> ${data.resolved_by}</p>
                    <p><strong>Resolved at:</strong> ${data.resolved_at}</p>
                    <p><strong>Duration:</strong> ${data.duration_seconds} seconds</p>
                    <p style="color: #28a745; font-weight: bold;">Problem telah diselesaikan secara final.</p>
                </div>
            `,
            icon: 'success',
            iconColor: '#28a745',
            confirmButtonText: 'OK',
            toast: true,
            position: 'top-end',
            timer: 5000,
            timerProgressBar: true
        });
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
    // This function is deprecated - use new forward problem workflow instead
    console.warn('resolveProblem() is deprecated. Use new forward problem workflow.');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    dashboardManager = new DashboardManager();
    
    // Request notification permission on load (for browser notifications as backup)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});