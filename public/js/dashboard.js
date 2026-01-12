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
        this.lastKnownUnresolvedProblems = new Set(); // Track unresolved problems for manager
        this.socketConnected = false;
        this.fallbackActive = false;
        this.lastMachineStatuses = {}; // Menyimpan data machine status yang sudah difilter
        this.lastActiveProblems = []; // Menyimpan data active problems yang sudah difilter
        this.problemStartTimes = new Map(); // Track when problems started for 15-minute notification
        this.sentLongDurationNotifications = new Set(); // Track which problems already got 15-min notification
		this.nodeRedOnline = true; // Track Node-RED core connectivity
		this.nodeRedStatus = 'unknown'; // Track Node-RED status: 'all_online', 'partial_offline', 'all_offline', 'unknown'
		this.plcDevices = []; // Track PLC devices and their controlled tables
        
        const dashboardDataElement = document.getElementById('dashboardData');
        const userDataElement = document.getElementById('userData');
        this.userRole = userDataElement ? userDataElement.dataset.role : null;
        this.userLineName = userDataElement ? userDataElement.dataset.line : null;
        this.userDivision = userDataElement ? userDataElement.dataset.division : null;
        
        // Safely parse machines data
        try {
            this.machines = dashboardDataElement && dashboardDataElement.dataset.machines 
                ? JSON.parse(dashboardDataElement.dataset.machines) 
                : [];
        } catch (e) {
            console.warn('Error parsing machines data:', e);
            this.machines = [];
        }
        
        // Get line filter from URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.lineFilter = urlParams.get('line') || null;

        this.metricsByAddress = new Map();
        this.machineNameToAddress = new Map();
        this.machineAddressToName = new Map();
        this.buildMachineAddressMaps();
        this.init();
    }

    getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // Helper method to get authentication headers
    getAuthHeaders() {
        const token = this.getCookieValue('auth_token');
        return {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    init() {
        try {
            this.initSocket();
            this.bindEvents();
            this.loadDashboardData();
            this.loadStats();

            // Load table metrics (target, cycle, oee) and refresh periodically
            this.loadTableMetrics();
            setInterval(() => {
                try {
                    this.loadTableMetrics();
                } catch (e) {
                    console.error('Error in loadTableMetrics interval:', e);
                }
            }, 60000);
            
            // Check Node-RED core status immediately and on interval
            this.checkNodeRedStatus();
            setInterval(() => {
                try {
                    this.checkNodeRedStatus();
                } catch (e) {
                    console.error('Error in checkNodeRedStatus interval:', e);
                }
            }, 10000);
            
            // Auto refresh every 30 seconds sebagai fallback HANYA jika socket tidak terhubung
            setInterval(() => {
                try {
                    if (!this.socketConnected) {
                        console.log('🔄 Fallback refresh activated (socket disconnected)');
                        this.fallbackActive = true;
                        this.loadDashboardDataWithFallbackDetection();
                    } else {
                        this.fallbackActive = false;
                    }
                } catch (e) {
                    console.error('Error in fallback refresh interval:', e);
                }
            }, 30000); // 30 detik untuk fallback
            
            console.log('🚀 Dashboard Manager initialized');
        } catch (error) {
            console.error('Error initializing DashboardManager:', error);
            // Tampilkan pesan error ke user
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;';
            errorDiv.innerHTML = '<h3 style="color: #e74c3c; margin-bottom: 10px;">Error Memuat Dashboard</h3><p>Terjadi error saat memuat dashboard. Silakan refresh halaman.</p><button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0A2856; color: white; border: none; border-radius: 4px; cursor: pointer;">Refresh Halaman</button>';
            document.body.appendChild(errorDiv);
        }
    }

    async loadTableMetrics() {
        try {
            const res = await fetch('/api/inspection-tables/metrics', { headers: this.getAuthHeaders() });
            const json = await res.json();
            if (!res.ok || !json.success) return;
            this.metricsByAddress.clear();
            // Build maps by address and by name for robust lookup
            this.metricsByName = new Map();
            json.data.forEach(item => {
                if (item.address) this.metricsByAddress.set(item.address, item);
                if (item.name) this.metricsByName.set(item.name, item);
            });

            // Update UI for all cards using current metrics
            document.querySelectorAll('.machine-card').forEach(card => {
                const machineName = card.getAttribute('data-machine');
                const lineName = card.getAttribute('data-line');
                const machineId = (machineName || '').replace(/ /g, '');
                // Try lookup by address, then by display name
                let metrics = this.metricsByAddress.get(machineName);
                if (!metrics) metrics = this.metricsByName?.get(machineName);
                if (!metrics) return;
                const targetEl = document.getElementById(`target-${machineId}-line-${lineName}`);
                const oeeEl = document.getElementById(`oee-${machineId}-line-${lineName}`);
                if (targetEl) targetEl.textContent = metrics.target_quantity ?? '-';
                if (oeeEl) oeeEl.textContent = (metrics.oee != null) ? `${Number(metrics.oee).toFixed(2)}%` : '-';
            });
        } catch (e) {
            console.warn('Unable to load table metrics', e);
        }
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
			this.refreshCompositeConnectionStatus();
            this.loadDashboardData();
            this.loadStats(); 
        });

		this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.socketConnected = false;
			this.refreshCompositeConnectionStatus();
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
        // PERBAIKAN: Notifikasi forwarded problem untuk maintenance, quality, engineering sekarang dipindahkan ke halaman divisi
        // Hanya leader yang masih mendapat notifikasi di dashboard utama (jika diperlukan)
        this.socket.on('problemForwarded', (data) => {
            console.log('📧 Received problemForwarded via socket:', data);
            // Notifikasi forwarded problem untuk maintenance, quality, engineering dipindahkan ke halaman divisi
            // Leader tidak menerima notifikasi forwarded problem (sesuai logic sebelumnya)
            // Refresh data setelah forward untuk update machine status dan problem list
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
                try {
                    this.updateLastUpdateTime();
                } catch (err) {
                    console.warn('Error updating last update time:', err);
                }
            } else {
                // Fallback: Jika data tidak tersedia, minta refresh dari server
                console.log('🔄 No cached data, requesting refresh from server');
                if (this.socket && this.socketConnected) {
                    this.socket.emit('requestUpdate');
                } else {
                    // Jika socket belum terhubung, gunakan fallback detection
                    console.log('🔄 Socket not connected, using fallback detection');
                    await this.loadDashboardDataWithFallbackDetection();
                }
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            // Jangan tampilkan error jika ini adalah error socket, gunakan fallback
            if (!this.socketConnected) {
                console.log('🔄 Socket error, trying fallback detection');
                await this.loadDashboardDataWithFallbackDetection();
            } else {
                this.showSweetAlert('error', 'Error', 'Failed to load dashboard data');
            }
        }
    }

    // Method to load active problems using new endpoint
    async loadActiveProblems() {
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch('/api/problems/active', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-User-Role': this.userRole || '',
                    'X-User-Division': this.userDivision || ''
                }
            });
            const data = await response.json();

            if (data.success) {
                return data.data;
            } else {
                console.error('Failed to load active problems:', data.message);
                return [];
            }
        } catch (error) {
            console.error('Error loading active problems:', error);
            return [];
        }
    }

    async loadUnresolvedProblemsForManager() {
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch('/api/problems/unresolved-manager', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-User-Division': this.userDivision || ''
                }
            });
            const data = await response.json();

            if (data.success) {
                return data.data;
            } else {
                console.error('Failed to load unresolved problems for manager:', data.message);
                return [];
            }
        } catch (error) {
            console.error('Error loading unresolved problems for manager:', error);
            return [];
        }
    }

    // Special method for fallback with problem detection
    async loadDashboardDataWithFallbackDetection() {
        try {
            // Load dashboard status for machine statuses
            // PERBAIKAN: Kirim lineFilter ke backend untuk filtering
            const token = this.getCookieValue('auth_token');
            const queryParams = {};
            if (this.lineFilter) {
                queryParams.line_name = this.lineFilter;
            }
            const queryString = Object.keys(queryParams).length > 0 
                ? '?' + new URLSearchParams(queryParams).toString() 
                : '';
            
            const response = await fetch(`/api/dashboard/status${queryString}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-User-Role': this.userRole || '',
                    'X-User-Division': this.userDivision || '',
                    'X-Line-Name': this.lineFilter || ''
                }
            });
            const data = await response.json();
            
            if (data.success) {
                // Load active problems using new endpoint
                const activeProblems = await this.loadActiveProblems();
                
                // Load unresolved problems for manager if user is manager
                let unresolvedProblems = [];
                if (this.userRole === 'manager') {
                    unresolvedProblems = await this.loadUnresolvedProblemsForManager();
                }
                
                // Detect new problems in fallback mode
                const currentProblems = activeProblems || [];
                const newProblems = [];

                // Create problem keys for current problems
                const currentProblemKeys = new Set();
                currentProblems.forEach(problem => {
                    const problemKey = `${problem.machine_name}-${problem.tipe_problem}-${problem.id}`;
                    currentProblemKeys.add(problemKey);
                    
                    // If this problem wasn't known before, it's new
                    if (!this.lastKnownProblems.has(problemKey)) {
                        newProblems.push(problem);
                        console.log('🚨 New problem detected via fallback:', problem);
                    }
                });

                // Check for new unresolved problems for manager
                if (this.userRole === 'manager') {
                    const currentUnresolvedKeys = new Set();
                    unresolvedProblems.forEach(problem => {
                        const problemKey = `unresolved-${problem.machine_name}-${problem.tipe_problem}-${problem.id}`;
                        currentUnresolvedKeys.add(problemKey);

                        // If this unresolved problem wasn't known before, it's new
                        if (!this.lastKnownUnresolvedProblems.has(problemKey)) {
                            newProblems.push(problem);
                            console.log('🚨 New unresolved problem detected for manager:', problem);
                        }
                    });
                    this.lastKnownUnresolvedProblems = currentUnresolvedKeys;
                }

                // Update tracking
                this.lastKnownProblems = currentProblemKeys;

                // Show notifications for new problems
                newProblems.forEach(problem => {
                    this.showProblemNotification(problem);
                });

                // Update UI
                this.updateMachineStatuses(data.data.machine_statuses_by_line);
                this.updateActiveProblems(activeProblems);
                this.updateStatsFromDashboardData({...data.data, active_problems: activeProblems});
                try {
                    this.updateLastUpdateTime();
                } catch (err) {
                    console.warn('Error updating last update time:', err);
                }
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
        
        // Priority: Apply line filter from URL if exists
        if (this.lineFilter) {
            activeProblems = activeProblems.filter(problem => 
                problem.line_name === this.lineFilter
            );
        }
        
        // PERBAIKAN: Filter active problems berdasarkan role dan line
        if (this.userRole === 'leader' && this.userLineName) {
            activeProblems = activeProblems.filter(problem => {
                return problem.line_name && problem.line_name.toString() === this.userLineName.toString();
            });
        } else if (this.userRole === 'manager' && this.userDivision) {
            activeProblems = activeProblems.filter(problem => {
                return problem.division && problem.division.toString() === this.userDivision.toString();
            });
        }
        // Untuk role lain (admin, maintenance, quality, engineering) tidak difilter
        
        // Count cycle-based problems from machine statuses
        // Only count machines where the problem is caused by cycle threshold (not from log)
        // Filter by line if lineFilter exists
        let cycleBasedProblemsCount = 0;
        if (dashboardData.machine_statuses_by_line) {
            Object.entries(dashboardData.machine_statuses_by_line).forEach(([lineName, machines]) => {
                // Skip if line filter is set and doesn't match
                if (this.lineFilter && lineName !== this.lineFilter) {
                    return;
                }
                
                machines.forEach(machine => {
                    // Check if machine has cycle-based problem status
                    // Status must be 'problem' AND cycle_based_status must also be 'problem'
                    // AND problem_type should be 'Cycle Time' (to distinguish from log problems)
                    if (machine.status === 'problem' && 
                        machine.cycle_based_status && 
                        machine.cycle_based_status.status === 'problem' &&
                        machine.problem_type === 'Cycle Time') {
                        cycleBasedProblemsCount++;
                    }
                });
            });
        }
        
        // Total active problems = log problems + cycle-based problems
        const activeProblemsCount = activeProblems.length + cycleBasedProblemsCount;
        
        // Hitung total machines dari data yang ada - filter by line if lineFilter exists
        let totalMachines = 0;
        if (dashboardData.machine_statuses_by_line) {
            Object.entries(dashboardData.machine_statuses_by_line).forEach(([lineName, machines]) => {
                // Skip if line filter is set and doesn't match
                if (this.lineFilter && lineName !== this.lineFilter) {
                    return;
                }
                totalMachines += machines.length;
            });
        }

        // BUGFIX: Jika lineFilter ada dan totalMachines = 0, berarti line tersebut memang tidak punya mesin
        // Jangan tampilkan total mesin keseluruhan, tampilkan 0
        const totalMachinesEl = document.getElementById('totalMachines');
        const currentShown = totalMachinesEl ? Number(totalMachinesEl.textContent || 0) : 0;
        let safeTotal = totalMachines;
        
        // Hanya gunakan fallback jika tidak ada lineFilter (untuk dashboard global)
        // Jika ada lineFilter, gunakan nilai actual (bisa 0)
        if (!this.lineFilter && Number.isFinite(totalMachines) && totalMachines === 0 && currentShown > 0) {
            // Dashboard global: jangan turunkan angka valid ke 0 jika data sementara kosong
            safeTotal = currentShown;
        }

        // Update counters dengan data yang sudah difilter - dengan null checks
        if (totalMachinesEl) totalMachinesEl.textContent = safeTotal;
        const activeProblemsEl = document.getElementById('activeProblems');
        if (activeProblemsEl) activeProblemsEl.textContent = activeProblemsCount;
    }

    async loadStats() {
        const userRole = this.userRole;
        const userLineName = this.userLineName;
        const userDivision = this.userDivision;

        let apiUrl = '/api/dashboard/stats';
        const params = [];

        // Priority: line filter from URL > user role-based filter
        if (this.lineFilter) {
            params.push(`line_name=${encodeURIComponent(this.lineFilter)}`);
        } else if (userRole === 'leader' && userLineName) {
            params.push(`line_name=${encodeURIComponent(userLineName)}`);
        } else if (userRole === 'manager' && userDivision) {
            params.push(`division=${encodeURIComponent(userDivision)}`);
        }

        if (params.length > 0) {
            apiUrl += '?' + params.join('&');
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
            try {
                this.updateLastUpdateTime();
            } catch (err) {
                console.warn('Error updating last update time:', err);
            }
            
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
                const machineLineName = machineData.line_name; // PERBAIKAN: Ambil line_name dari data
                const machineId = machineName.replace(/ /g, '');
                
                // PERBAIKAN KRITIS: Gunakan kombinasi name + line_name untuk selector yang unik
                const card = document.querySelector(`[data-machine="${machineName}"][data-line="${machineLineName}"]`);
                const light = document.getElementById(`light-${machineId}-line-${machineLineName}`);
                const statusText = document.getElementById(`status-${machineId}-line-${machineLineName}`);

                if (!card || !light || !statusText) {
                    // Silently skip if elements not found (machine might not be rendered on current page due to filtering)
                    return;
                }

                // Check if this machine is controlled by an offline PLC first
                const isPlcOffline = this.isMachineControlledByOfflinePlc(machineName);
                
                if (isPlcOffline) {
                    // PLC is offline - override any other status
                    card.classList.remove('problem', 'warning', 'idle'); 
                    light.className = 'indicator-light offline';
                    statusText.className = 'status-text offline';
                    statusText.innerHTML = '<i class="fas fa-power-off"></i><span>PLC Offline</span>';
                } else if (machineData) {
                    card.classList.remove('problem', 'warning', 'idle'); 

                    // PERBAIKAN: Backend sudah melakukan role filtering, jadi kita langsung gunakan status dari backend
                    // Debug logging for cycle-based status
                    if (machineData.cycle_based_status && machineData.cycle_based_status.status !== 'normal') {
                        console.log(`[${machineName}] Cycle-based status:`, {
                            status: machineData.status,
                            cycle_status: machineData.cycle_based_status.status,
                            cycles_elapsed: machineData.cycle_based_status.cycles_elapsed,
                            warning_threshold: machineData.cycle_based_status.warning_threshold,
                            problem_threshold: machineData.cycle_based_status.problem_threshold
                        });
                    }
                    
                    if (machineData.status === 'problem') {
                        card.classList.add('problem');
                        light.className = 'indicator-light problem';
                        statusText.className = 'status-text problem'; 
                        statusText.style.display = '';
                        const problemType = machineData.problem_type || 'Unknown';
                        const cycleInfo = machineData.cycle_based_status?.status === 'problem' 
                            ? ` (${machineData.cycle_based_status.cycles_without_increase} cycles)` 
                            : '';
                        statusText.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span>Problem - ${problemType}${cycleInfo}</span>`;
                    } else if (machineData.status === 'warning') {
                        card.classList.add('idle');
                        card.classList.remove('warning');
                        light.className = 'indicator-light idle';
                        statusText.className = 'status-text idle';
                        statusText.style.display = '';
                        const cycleInfo = machineData.cycle_based_status 
                            ? ` (${machineData.cycle_based_status.cycles_without_increase} cycles)` 
                            : '';
                        statusText.innerHTML = `<i class="fas fa-pause-circle"></i><span>Idle - Quantity tidak bertambah${cycleInfo}</span>`;
                    } else {
                        light.className = 'indicator-light normal';
                        statusText.className = 'status-text normal'; 
                        statusText.style.display = '';
                        statusText.innerHTML = `<i class="fas fa-check-circle"></i><span>Normal Operation</span>`;
                    }
                } else {
                    console.warn(`[${machineName} Line ${machineLineName}]: Tidak ada data status yang diterima dari server untuk meja ini.`);
                    card.classList.remove('problem', 'warning', 'idle'); 
                    light.className = 'indicator-light unknown';
                    statusText.className = 'status-text unknown';
                    statusText.innerHTML = `<i class="fas fa-question-circle"></i><span>No Data / Disconnected</span>`;
                }

                // PERBAIKAN: Update ID untuk quantity dan lastcheck dengan line_name
                const quantityEl = document.getElementById(`quantity-${machineId}-line-${machineLineName}`);
                if (quantityEl) {
                    quantityEl.textContent = (machineData && machineData.quantity !== undefined) ? machineData.quantity : '0';
                }

                // Update target and OEE if metrics are available
                try {
                    let metrics = this.metricsByAddress?.get(machineName);
                    if (!metrics) metrics = this.metricsByName?.get(machineName);
                    const targetEl = document.getElementById(`target-${machineId}-line-${machineLineName}`);
                    const oeeEl = document.getElementById(`oee-${machineId}-line-${machineLineName}`);
                    if (metrics && targetEl) targetEl.textContent = metrics.target_quantity ?? '-';

                    // Real-time OEE: compute from current actual quantity and cached cycle_time
                    if (metrics && oeeEl) {
                        const cycle = Number(metrics.cycle_time);
                        const actual = Number((machineData && machineData.quantity !== undefined) ? machineData.quantity : 0);
                        const runningHour = Number(metrics.running_hour) || 8; // Default 8 hours if not set
                        if (cycle > 0) {
                            const oee = ((actual * cycle) / (runningHour * 3600)) * 100;
                            oeeEl.textContent = `${oee.toFixed(2)}%`;
                        } else {
                            oeeEl.textContent = '-';
                        }
                    }
                } catch (_) {}

                const lastCheckEl = document.getElementById(`lastcheck-${machineId}-line-${machineLineName}`);
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

        // BUGFIX: Priority 1 - Filter berdasarkan lineFilter (jika ada)
        // Hanya tampilkan problem pada dashboard line yang mesinnya bermasalah
        if (this.lineFilter) {
            filteredProblems = filteredProblems.filter(problem => {
                return problem.line_name && problem.line_name.toString() === this.lineFilter.toString();
            });
        }

        // Filter berdasarkan role dan line_name
        if (this.userRole === 'leader' && this.userLineName) {
            // Leader hanya melihat problem dari line mereka sendiri
            filteredProblems = filteredProblems.filter(problem => {
                return problem.line_name && problem.line_name.toString() === this.userLineName.toString();
            });
        } else if (this.userRole === 'manager' && this.userDivision) {
            // Manager hanya melihat problem dari divisi mereka
            // Filter berdasarkan line_name karena data dari API tidak memiliki field division
            const divisionLineMapping = {
                'Brazing': ['Leak Test Inspection', 'Support', 'Hand Bending', 'Welding'],
                'Chassis': ['Cutting', 'Flaring', 'MF/TK', 'LRFD', 'Assy'],
                'Nylon': ['Injection/Extrude', 'Roda Dua', 'Roda Empat']
            };
            const allowedLines = divisionLineMapping[this.userDivision] || [];
            filteredProblems = filteredProblems.filter(problem => {
                // Filter by line_name yang sesuai dengan divisi manager
                return problem.line_name && allowedLines.includes(problem.line_name);
            });
        } else if (this.userRole === 'admin') {
            // Admin melihat semua problem (tidak perlu filter lagi jika sudah difilter by lineFilter)
            // filteredProblems tetap seperti di atas
        } else if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
            // Department users hanya melihat problem yang sudah di-forward ke mereka
            filteredProblems = filteredProblems.filter(problem => {
                return problem.is_forwarded && problem.forwarded_to_role === this.userRole;
            });
        }

        // PERBAIKAN: Simpan data active problems yang sudah difilter untuk digunakan di loadDashboardData
        this.lastActiveProblems = filteredProblems;

        // Cek problem yang sudah 15 menit untuk manager
        // PERBAIKAN: Notifikasi 15 menit untuk manager sekarang dipindahkan ke halaman divisi
        // Hanya leader yang masih mendapat notifikasi di dashboard utama
        if (this.userRole === 'leader') {
            // Leader tetap mendapat notifikasi di dashboard utama (tidak diubah)
            // Note: checkLongDurationProblems hanya untuk manager, jadi tidak dipanggil untuk leader
        }

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
                <div class="problem-machine">${problem.machine_name || problem.machine}</div>
                <div class="problem-type">${problem.tipe_problem || problem.problem_type}</div>
                <div class="problem-time">${durationText}</div>
            </div>
            <div class="problem-severity">
                <span class="severity-badge ${problem.severity}">${problem.severity.toUpperCase()}</span>
            </div>
        `;

        div.addEventListener('click', () => {
            this.showProblemDetail(problem.machine_name || problem.machine, problem.id);
        });

        return div;
    }

    updateStats(stats) {
        // Jangan pernah menimpa angka valid dengan 0 akibat refresh cepat
        const totalMachinesEl = document.getElementById('totalMachines');
        if (!totalMachinesEl) return; // Exit early if element doesn't exist
        
        const backendTotal = Number(stats.total_machines);
        const currentShown = Number(totalMachinesEl.textContent || 0);

        let totalMachines;
        if (Number.isFinite(backendTotal) && backendTotal > 0) {
            totalMachines = backendTotal;
        } else if (currentShown > 0) {
            // Pertahankan angka yang sudah valid di layar
            totalMachines = currentShown;
        } else {
            // Fallback ke kalkulasi dari lastMachineStatuses
            totalMachines = this.computeTotalMachinesFromLastStatuses();
        }

        // Safe update with null checks (totalMachinesEl already defined above)
        const activeProblemsEl = document.getElementById('activeProblems');
        const resolvedTodayEl = document.getElementById('resolvedToday');
        
        totalMachinesEl.textContent = Number.isFinite(totalMachines) ? totalMachines : 0;
        if (activeProblemsEl) activeProblemsEl.textContent = stats.active_problems || 0;
        if (resolvedTodayEl) resolvedTodayEl.textContent = stats.resolved_today || 0;
    }

    computeTotalMachinesFromLastStatuses() {
        let total = 0;
        const grouped = this.lastMachineStatuses || {};
        Object.values(grouped).forEach(machines => {
            if (Array.isArray(machines)) total += machines.length;
        });
        return total;
    }

    updateConnectionStatus(connected, statusClass = null, statusText = null, statusIcon = null) {
        const statusElement = document.getElementById('connectionStatus');
        
        if (statusClass && statusText && statusIcon) {
            // Use custom status
            statusElement.className = statusClass;
            statusElement.innerHTML = `<i class="${statusIcon}"></i><span>${statusText}</span>`;
        } else {
            // Use default behavior
            if (connected) {
                statusElement.className = 'connection-status';
                statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Connected</span>';
            } else {
                statusElement.className = 'connection-status disconnected';
                statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Disconnected</span>';
            }
        }
    }

	// Combine socket status with Node-RED core status
	refreshCompositeConnectionStatus() {
		let connectionStatus = false;
		let statusClass = 'connection-status';
		let statusText = 'Disconnected';
		let statusIcon = 'fas fa-wifi';
		
		if (this.socketConnected) {
			switch (this.nodeRedStatus) {
				case 'all_online':
					connectionStatus = true;
					statusClass = 'connection-status';
					statusText = 'Connected';
					statusIcon = 'fas fa-wifi';
					break;
				case 'partial_offline':
					connectionStatus = false;
					statusClass = 'connection-status warning';
					statusText = 'Warning - Some Node-RED Offline';
					statusIcon = 'fas fa-exclamation-triangle';
					break;
				case 'all_offline':
					connectionStatus = false;
					statusClass = 'connection-status disconnected';
					statusText = 'Disconnected - All Node-RED Offline';
					statusIcon = 'fas fa-wifi';
					break;
				default:
					connectionStatus = false;
					statusClass = 'connection-status disconnected';
					statusText = 'Disconnected';
					statusIcon = 'fas fa-wifi';
			}
		}
		
		this.updateConnectionStatus(connectionStatus, statusClass, statusText, statusIcon);
	}

	// Poll Node-RED status from device_status table via backend API
	async checkNodeRedStatus() {
		try {
			const token = this.getCookieValue('auth_token');
			const response = await fetch('/api/plc-status', {
				headers: {
					'Authorization': `Bearer ${token}`,
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				}
			});
			const result = await response.json();
			if (result && result.success && Array.isArray(result.data)) {
				// Find all NODE_RED_PI devices
				const nodeRedDevices = result.data.filter(d => d.device_id.includes('NODE_RED_PI'));
				
				// Store all PLC devices for inspect table status checking
				this.plcDevices = result.data.filter(d => d.device_id.startsWith('PLC'));
				
				if (nodeRedDevices.length === 0) {
					this.nodeRedStatus = 'unknown';
				} else {
					const now = new Date();
					let onlineCount = 0;
					let offlineCount = 0;
					
					nodeRedDevices.forEach(node => {
						const lastSeen = node.last_seen ? new Date(node.last_seen) : null;
						const over1min = lastSeen ? (now - lastSeen) > (1 * 60 * 1000) : true;
						const offlineByStatus = (node.status || '').toUpperCase() === 'OFFLINE';
						
						if (over1min || offlineByStatus) {
							offlineCount++;
						} else {
							onlineCount++;
						}
					});
					
					// Determine overall status
					if (offlineCount === 0) {
						this.nodeRedStatus = 'all_online';
					} else if (onlineCount === 0) {
						this.nodeRedStatus = 'all_offline';
					} else {
						this.nodeRedStatus = 'partial_offline';
					}
				}
				
				this.refreshCompositeConnectionStatus();
			}
		} catch (e) {
			console.warn('checkNodeRedStatus failed:', e);
		}
	}

    buildMachineAddressMaps() {
        (this.machines || []).forEach(machine => {
            if (machine && machine.name && machine.address) {
                this.machineNameToAddress.set(machine.name, machine.address);
                this.machineAddressToName.set(machine.address, machine.name);
            }
        });
    }

    // Check if a machine is controlled by an offline PLC
	isMachineControlledByOfflinePlc(machineName) {
		if (!this.plcDevices || this.plcDevices.length === 0) return false;
		
		const now = new Date();
        const machineAddress = this.machineNameToAddress.get(machineName);
		
		for (const plc of this.plcDevices) {
			const lastSeen = plc.last_seen ? new Date(plc.last_seen) : null;
			const over1min = lastSeen ? (now - lastSeen) > (1 * 60 * 1000) : true;
			const offlineByStatus = (plc.status || '').toUpperCase() === 'OFFLINE';
			const isOffline = over1min || offlineByStatus;
			
			if (isOffline && plc.controlled_tables) {
                const normalized = this.normalizeControlledTables(plc.controlled_tables);
                
                if (machineAddress && normalized.addresses.has(machineAddress)) {
					return true;
				}

                if (normalized.names.has(machineName)) {
                    return true;
                }
			}
		}
		
		return false;
	}

    normalizeControlledTables(rawTables) {
        const normalized = {
            addresses: new Set(),
            names: new Set()
        };

        if (!rawTables) {
            return normalized;
        }

        let parsedTables = rawTables;
        if (typeof rawTables === 'string') {
            try {
                parsedTables = JSON.parse(rawTables);
            } catch (e) {
                console.warn('Failed to parse controlled_tables JSON:', rawTables);
                return normalized;
            }
        }

        if (!Array.isArray(parsedTables)) {
            return normalized;
        }

        parsedTables.forEach(entry => {
            if (!entry) return;
            if (typeof entry === 'object') {
                if (entry.address) {
                    this.addControlledTableEntry(normalized, entry.address);
                }
                if (entry.name) {
                    normalized.names.add(entry.name);
                    const addressFromName = this.machineNameToAddress.get(entry.name);
                    if (addressFromName) {
                        normalized.addresses.add(addressFromName);
                    }
                }
            } else if (typeof entry === 'string') {
                this.addControlledTableEntry(normalized, entry);
            }
        });

        return normalized;
    }

    addControlledTableEntry(normalized, value) {
        if (!value) return;
        const trimmed = value.toString().trim();
        if (!trimmed) return;

        // If matches an address, store address and name (if known)
        if (this.machineAddressToName.has(trimmed)) {
            normalized.addresses.add(trimmed);
            normalized.names.add(this.machineAddressToName.get(trimmed));
            return;
        }

        // If matches a machine name, map to address if available
        const addressFromName = this.machineNameToAddress.get(trimmed);
        if (addressFromName) {
            normalized.addresses.add(addressFromName);
            normalized.names.add(trimmed);
            return;
        }

        // Fallback: treat as name to maintain backward compatibility
        normalized.names.add(trimmed);
    }

    updateLastUpdateTime() {
        const lastUpdateElement = document.getElementById('lastUpdate');
        if (lastUpdateElement) {
            lastUpdateElement.textContent = moment().format('HH:mm:ss');
        }
        // Update currentTime if it exists (for header display)
        const currentTimeElement = document.getElementById('currentTime');
        if (currentTimeElement) {
            currentTimeElement.textContent = moment().format('HH:mm:ss');
        }
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
                const response = await fetch(`/api/dashboard/problem/${problemId}`, {
                    headers: this.getAuthHeaders()
                });
                const data = await response.json();

                if (data.success) {
                    this.currentProblemId = problemId;
                    const problemDetailHTML = await this.createProblemDetailHTML(data.data);
                    
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
                            line_name: foundMachine.line_name || machineLine // Pastikan line_name benar
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
                        line_name: foundMachine.line_name || lineNumber
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
                line_name: machineLine || 'N/A'
            };
        } catch (error) {
            console.error('❌ Error saat mengambil status mesin:', error);
            return { 
                status: 'normal', 
                last_check: new Date().toISOString(),
                name: machine,
                problem_type: null,
                line_name: machineLine || 'N/A' // PERBAIKAN: Gunakan parameter machineLine
            };
        }
    }


    createMachineDetailHTML(machine, machineStatus) {
        console.log('Creating new detail HTML for:', machine, machineStatus);
        
        // Check if this machine is controlled by an offline PLC first
        const isPlcOffline = this.isMachineControlledByOfflinePlc(machine);
        
        let isProblem, statusClass, statusIcon, statusText;
        
        if (isPlcOffline) {
            // PLC is offline - override any other status
            isProblem = false;
            statusClass = 'status-offline';
            statusIcon = 'fa-power-off';
            statusText = 'PLC Offline';
        } else {
            // Normal logic for problem/warning/normal status
            if (machineStatus.status === 'problem') {
                isProblem = true;
                statusClass = 'status-problem';
                statusIcon = 'fa-exclamation-triangle';
                statusText = machineStatus.problem_type || 'Problem';
            } else if (machineStatus.status === 'warning') {
                isProblem = false;
                statusClass = 'status-idle';
                statusIcon = 'fa-pause-circle';
                statusText = 'Idle';
            } else {
                isProblem = false;
                statusClass = 'status-normal';
                statusIcon = 'fa-check-circle';
                statusText = 'Normal Operation';
            }
        }

        const lastCheck = machineStatus.last_check ? moment(machineStatus.last_check).format('DD/MM/YYYY HH:mm:ss') : 'N/A';
        const lineName = machineStatus.line_name || 'N/A';

        let messageBoxHTML = '';
        if (isPlcOffline) {
            messageBoxHTML = `
                <div class="system-message system-offline">
                    <h4><i class="fas fa-power-off"></i> PLC Offline</h4>
                    <p>Machine ${machine} is offline because its controlling PLC is not responding.</p>
                </div>
            `;
        } else if (isProblem) {
            const problemType = machineStatus.problem_type || 'Unknown';
            const cycleInfo = machineStatus.cycle_based_status?.status === 'problem' 
                ? `<br><small>Quantity tidak bertambah selama ${machineStatus.cycle_based_status.cycles_without_increase} cycle times</small>` 
                : '';
            messageBoxHTML = `
                <div class="system-message system-problem">
                    <h4><i class="fas fa-exclamation-triangle"></i> Problem Detected!</h4>
                    <p>Machine ${machine} is experiencing a <strong>${problemType}</strong> issue.${cycleInfo}</p>
                </div>
            `;
        } else if (machineStatus.status === 'warning') {
            const cycleInfo = machineStatus.cycle_based_status 
                ? `Quantity tidak bertambah selama ${machineStatus.cycle_based_status.cycles_without_increase} cycle times` 
                : 'Quantity tidak bertambah';
            messageBoxHTML = `
                <div class="system-message system-warning">
                    <h4><i class="fas fa-pause-circle"></i> Idle</h4>
                    <p>${cycleInfo}. Threshold warning: ${machineStatus.cycle_based_status?.warning_threshold || 'N/A'} cycles.</p>
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
                        <strong>Line Name:</strong>
                        <span>${lineName}</span>
                    </li>
                </ul>

                ${messageBoxHTML}
            </div>
        `;
    }

    async createProblemDetailHTML(problem) {
        const isLeader = this.userRole === 'leader';
        const isManager = this.userRole === 'manager';
        const isDepartmentUser = ['maintenance', 'quality', 'engineering'].includes(this.userRole);
        
        // Tentukan target role berdasarkan problem type
        let targetRole = '';
        switch (problem.problem_type.toLowerCase()) {
            case 'machine':
                targetRole = 'Maintenance';
                break;
            case 'quality':
                targetRole = 'Quality Control';
                break;
            case 'engineering':
                targetRole = 'Engineering';
                break;
            case 'material':
                targetRole = 'Engineering';
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
            // Problem baru, leader bisa forward, cancel, atau resolve langsung
            actionButtons = `
                <div class="action-buttons">
                    <button class="btn btn-forward" id="forwardBtn">
                        <i class="fas fa-share"></i>
                        Forward
                    </button>
                    <button class="btn btn-cancel" id="cancelBtn">
                        <i class="fas fa-times"></i>
                        Cancel
                    </button>
                    <button class="btn btn-direct-resolve" id="directResolveBtn">
                        <i class="fas fa-check"></i>
                        Resolve
                    </button>
                </div>
            `;
        } else if (actualStatus === 'forwarded' && isDepartmentUser) {
            // Problem sudah di-forward, department user bisa receive
            actionButtons = `
                <div class="action-buttons">
                    <button class="btn btn-receive" id="receiveBtn">
                        <i class="fas fa-hand-paper"></i>
                        Receive
                    </button>
                </div>
            `;
        } else if (actualStatus === 'received' && isDepartmentUser) {
            // Problem sudah diterima, department user bisa feedback resolved
            let ticketingButton = '';
            let resolvedButton = '';
            
            if ((this.userRole === 'maintenance' && problem.problem_type.toLowerCase() === 'machine') ||
                (this.userRole === 'quality' && problem.problem_type.toLowerCase() === 'quality') ||
                (this.userRole === 'engineering' && (problem.problem_type.toLowerCase() === 'engineering' || problem.problem_type.toLowerCase() === 'material'))) {
                // Cek apakah sudah ada ticketing untuk problem ini
                const hasTicketing = await this.checkTicketingExists(problem.id);
                
                if (!hasTicketing) {
                    // Belum ada ticketing, tampilkan tombol isi form
                    ticketingButton = `
                        <button class="btn btn-ticketing" id="ticketingBtn">
                            <i class="fas fa-clipboard-list"></i>
                            Isi Form Ticketing
                        </button>
                    `;
                    // Jangan tampilkan tombol resolved jika belum ada ticketing
                } else {
                    // Sudah ada ticketing, tampilkan tombol mark as resolved
                    resolvedButton = `
                        <button class="btn btn-feedback-resolved" id="feedbackResolvedBtn">
                            <i class="fas fa-check-circle"></i>
                            Feedback
                        </button>
                    `;
                }
            } else {
                // Bukan maintenance/quality atau bukan machine/quality problem, langsung tampilkan resolved button
                resolvedButton = `
                    <button class="btn btn-feedback-resolved" id="feedbackResolvedBtn">
                        <i class="fas fa-check-circle"></i>
                        Feedback
                    </button>
                `;
            }
            
            actionButtons = `
                <div class="action-buttons">
                    ${ticketingButton}
                    ${resolvedButton}
                </div>
            `;
        } else if (actualStatus === 'feedback_resolved' && isLeader) {
            // Problem sudah ada feedback resolved, leader bisa final resolve
            actionButtons = `
                <div class="action-buttons">
                    <button class="btn btn-final-resolve" id="finalResolveBtn">
                        <i class="fas fa-check-double"></i>
                        Final Resolve
                    </button>
                </div>
            `;
        } else if (actualStatus === 'active' && isManager) {
            // Manager bisa kirim notifikasi ulang ke leader
            actionButtons = `
                <div class="action-buttons">
                    <button class="btn btn-notify-leader" id="notifyLeaderBtn">
                        <i class="fas fa-bell"></i>
                        Kirim Notifikasi Ulang ke Leader
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
                        <span class="value">${problem.line_name || 'N/A'}</span>
                    </div>
                </div>

                ${problem.forwarded_by ? `
                    <div class="forward-info" style="margin: 15px 0; padding: 10px; background-color: #e7f3ff; border-left: 4px solid #0066cc; border-radius: 4px;">
                        <strong>Forwarded by:</strong> ${problem.forwarded_by}<br>
                        <strong>Forwarded at:</strong> ${problem.forwarded_at || 'N/A'}<br>
                        <strong>Target:</strong> ${targetRole}<br>
                        ${problem.forward_message ? `<strong>Message:</strong> ${problem.forward_message}` : ''}
                        ${problem.forward_photo ? `
                            <div style="margin-top: 10px;">
                                <strong>Foto:</strong><br>
                                <img src="${problem.forward_photo}" alt="Forward Photo" style="max-width: 100%; max-height: 300px; border-radius: 4px; margin-top: 5px; border: 1px solid #ced4da; cursor: pointer;" onclick="window.open('${problem.forward_photo}', '_blank')">
                            </div>
                        ` : ''}
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
                headers: this.getAuthHeaders(),
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
        const problemLineName = problem.line_name || problem.lineName || problem.line; // Multiple fallback
        
        // DEBUG: Log semua data untuk debugging
        console.log('=== DEBUG NOTIFICATION DATA ===');
        console.log('Problem data:', problem);
        console.log('User role:', this.userRole);
        console.log('User line name:', this.userLineName);
        console.log('Problem line name:', problemLineName);
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
            case 'engineering':
                // Department users TIDAK PERNAH melihat notifikasi problem baru
                // Mereka hanya melihat notifikasi ketika problem di-forward ke mereka
                console.log(`🔔 Notifikasi untuk Department User (${this.userRole}) disembunyikan. Mereka hanya melihat notifikasi forward.`);
                return;

            case 'leader':
                // PERBAIKAN: Validasi data dan filter berdasarkan line
                console.log(`🔍 Checking leader notification filter...`);
                
                // Validasi apakah userLineName tersedia
                if (!this.userLineName) {
                    console.warn('⚠️ User line name tidak tersedia untuk leader, notifikasi akan ditampilkan');
                    break; // Jika tidak ada line name user, tampilkan semua
                }
                
                // Validasi apakah problemLineName tersedia
                if (!problemLineName) {
                    console.warn('⚠️ Problem line name tidak tersedia, notifikasi akan ditampilkan');
                    break; // Jika tidak ada line name problem, tampilkan
                }
                
                // Convert ke string untuk comparison yang lebih reliable
                const userLine = String(this.userLineName).trim();
                const problemLine = String(problemLineName).trim();
                
                console.log(`🔍 Comparing lines - User: "${userLine}" vs Problem: "${problemLine}"`);
                
                // Jika line tidak cocok, sembunyikan notifikasi
                if (userLine !== problemLine) {
                    console.log(`🔔 Notifikasi untuk Leader disembunyikan. Problem line: ${problemLine}, User line: ${userLine}`);
                    return; // STOP eksekusi di sini
                }
                
                console.log(`✅ Line cocok, notifikasi akan ditampilkan untuk leader`);
                break;

            case 'manager':
                // Manager hanya melihat notifikasi untuk problem ACTIVE > 15 menit
                if (problem.is_manager_notification) {
                    console.log(`🔔 Notifikasi Manager untuk problem yang tidak di-resolve > 15 menit`);
                    break; // Lanjutkan ke notifikasi
                } else {
                    console.log(`🔔 Notifikasi untuk Manager disembunyikan. Mereka hanya melihat notifikasi untuk problem ACTIVE > 15 menit.`);
                    return;
                }

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

        console.log(`🔔 Menampilkan notifikasi untuk: ${machineName} - ${problemType} (Role: ${this.userRole}, Line: ${this.userLineName})`);

        Swal.fire({
            title: `⚠️ Problem Detected!`,
            html: `
                <div style="text-align: left; margin: 10px 0;">
                    <p><strong>Mesin:</strong> ${machineName}</p>
                    <p><strong>Problem Type:</strong> ${problemType}</p>
                    <p><strong>Line:</strong> ${problemLineName || 'N/A'}</p>
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
        console.log('User line name:', this.userLineName);
        console.log('User line type:', typeof this.userLineName);
        console.log('===============================');
        
        if (this.userRole === 'leader' && !this.userLineName) {
            console.error('⚠️ PERINGATAN: User dengan role leader tidak memiliki line name!');
            // Tampilkan peringatan ke user atau admin
            Swal.fire({
                title: 'Konfigurasi Tidak Lengkap',
                text: 'User leader tidak memiliki line name yang valid. Silakan hubungi administrator.',
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
                targetRole = 'Engineering Team';
                break;
            case 'engineering':
                targetRole = 'Engineering Team';
                break;
            default:
                // Log untuk debugging jika ada tipe problem yang tidak dikenali
                console.warn('Unknown problem type:', problemData.problem_type);
                targetRole = 'Engineering Team'; // Default ke Engineering Team
        }

        Swal.fire({
            title: 'Forward Problem?',
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Mesin:</strong> ${problemData.machine}</p>
                    <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                    <p><strong>Akan diteruskan ke:</strong> <span style="color: #0066cc; font-weight: bold;">${targetRole}</span></p>
                </div>
                <div style="text-align: left; margin-top: 20px;">
                    <label for="forwardMessage" style="display: block; margin-bottom: 8px; font-weight: bold; color: #495057;">Pesan <span style="color: #dc3545;">*</span>:</label>
                    <textarea id="forwardMessage" placeholder="Tambahkan pesan untuk tim yang menangani..." style="width: 100%; min-width: 100%; max-width: 100%; height: 100px; padding: 12px; border: 1px solid #ced4da; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 0.95rem; line-height: 1.5; box-sizing: border-box; transition: border-color 0.2s ease, box-shadow 0.2s ease;"></textarea>
                </div>
                <div style="text-align: left; margin-top: 20px;">
                    <label for="forwardPhoto" style="display: block; margin-bottom: 8px; font-weight: bold; color: #495057;">Foto (Opsional):</label>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="file" id="forwardPhoto" accept="image/*" capture="environment" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-family: inherit; font-size: 0.95rem; box-sizing: border-box;">
                        <button type="button" id="openCameraBtn" style="padding: 8px 16px; background-color: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.95rem; font-weight: 500; white-space: nowrap; transition: background-color 0.2s ease, opacity 0.2s ease;">📷 Buka Kamera</button>
                    </div>
                    <small style="color: #6c757d; display: block; margin-top: 5px;">Format: JPG, PNG, atau GIF (max 5MB)</small>
                    <div id="photoPreview" style="margin-top: 10px; display: none;">
                        <img id="photoPreviewImg" src="" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 4px; border: 1px solid #ced4da; margin-top: 10px;">
                        <button type="button" id="removePhotoBtn" style="margin-top: 5px; padding: 5px 10px; background-color: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Hapus Foto</button>
                    </div>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Forward',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#0066cc',
            cancelButtonColor: '#6c757d',
            allowEnterKey: false,
            allowOutsideClick: false,
            width: '600px',
            didOpen: () => {
                // Tambahkan focus style untuk textarea
                const forwardMessageField = document.getElementById('forwardMessage');
                let pollInterval = null;
                
                if (forwardMessageField) {
                    // Check if there's already a poll interval running (prevent multiple intervals)
                    if (forwardMessageField._pollInterval) {
                        clearInterval(forwardMessageField._pollInterval);
                        forwardMessageField._pollInterval = null;
                    }
                    
                    // Remove old event listeners if they exist
                    if (forwardMessageField._inputHandler) {
                        forwardMessageField.removeEventListener('input', forwardMessageField._inputHandler);
                    }
                    if (forwardMessageField._pasteHandler) {
                        forwardMessageField.removeEventListener('paste', forwardMessageField._pasteHandler);
                    }
                    if (forwardMessageField._focusHandler) {
                        forwardMessageField.removeEventListener('focus', forwardMessageField._focusHandler);
                    }
                    if (forwardMessageField._blurHandler) {
                        forwardMessageField.removeEventListener('blur', forwardMessageField._blurHandler);
                    }
                    
                    // Disable tombol forward secara default
                    let lastButtonState = null;
                    const updateButtonState = () => {
                        const button = Swal.getConfirmButton();
                        if (!button) return;
                        
                        const value = (forwardMessageField.value || '').trim();
                        const shouldEnable = value.length > 0;
                        
                        // Only update if state changed to prevent unnecessary DOM manipulation
                        if (lastButtonState === shouldEnable) return;
                        lastButtonState = shouldEnable;
                        
                        if (shouldEnable) {
                                button.disabled = false;
                                button.removeAttribute('disabled');
                                button.removeAttribute('aria-disabled');
                            button.style.opacity = '1';
                            button.style.pointerEvents = 'auto';
                            button.style.cursor = 'pointer';
                                button.classList.remove('swal2-disabled', 'swal2-deny');
                            } else {
                                button.disabled = true;
                                button.style.opacity = '0.5';
                                button.style.pointerEvents = 'none';
                                button.classList.add('swal2-disabled');
                        }
                    };

                    const focusHandler = function() {
                        this.style.borderColor = '#0A2856';
                        this.style.boxShadow = '0 0 0 3px rgba(10, 40, 86, 0.1)';
                    };
                    
                    const blurHandler = function() {
                        this.style.borderColor = '#ced4da';
                        this.style.boxShadow = 'none';
                    };
                    
                    // Event listener untuk input dan paste
                    const inputHandler = () => {
                        lastButtonState = null; // Reset to force update
                        updateButtonState();
                    };
                    const pasteHandler = () => {
                        setTimeout(() => {
                            lastButtonState = null; // Reset to force update
                            updateButtonState();
                        }, 10);
                    };
                    
                    forwardMessageField.addEventListener('focus', focusHandler);
                    forwardMessageField.addEventListener('blur', blurHandler);
                    forwardMessageField.addEventListener('input', inputHandler);
                    forwardMessageField.addEventListener('paste', pasteHandler);
                    
                    // Polling dengan interval yang lebih lama untuk mengurangi flicker
                    pollInterval = setInterval(() => {
                        updateButtonState();
                    }, 300);
                    
                    // Initial check
                    updateButtonState();
                    
                    // Simpan reference untuk cleanup
                    forwardMessageField._pollInterval = pollInterval;
                    forwardMessageField._inputHandler = inputHandler;
                    forwardMessageField._pasteHandler = pasteHandler;
                    forwardMessageField._focusHandler = focusHandler;
                    forwardMessageField._blurHandler = blurHandler;
                }

                // Handle foto upload dan preview
                const photoInput = document.getElementById('forwardPhoto');
                const photoPreview = document.getElementById('photoPreview');
                const photoPreviewImg = document.getElementById('photoPreviewImg');
                const removePhotoBtn = document.getElementById('removePhotoBtn');

                if (photoInput) {
                    const photoChangeHandler = function(e) {
                        const file = e.target.files[0];
                        if (file) {
                            // Validasi ukuran file (max 5MB)
                            if (file.size > 5 * 1024 * 1024) {
                                Swal.showValidationMessage('Ukuran foto terlalu besar. Maksimal 5MB.');
                                photoInput.value = '';
                                return;
                            }

                            // Validasi tipe file
                            if (!file.type.startsWith('image/')) {
                                Swal.showValidationMessage('File harus berupa gambar.');
                                photoInput.value = '';
                                return;
                            }

                            // Tampilkan preview
                            const reader = new FileReader();
                            reader.onload = function(event) {
                                photoPreviewImg.src = event.target.result;
                                photoPreview.style.display = 'block';
                            };
                            reader.readAsDataURL(file);
                        } else {
                            // If no file selected, hide preview
                            photoPreview.style.display = 'none';
                            photoPreviewImg.src = '';
                        }
                    };
                    
                    // Remove old listener if exists
                    if (photoInput._changeHandler) {
                        photoInput.removeEventListener('change', photoInput._changeHandler);
                    }
                    
                    photoInput.addEventListener('change', photoChangeHandler);
                    photoInput._changeHandler = photoChangeHandler;
                }

                if (removePhotoBtn) {
                    const removePhotoHandler = function() {
                        photoInput.value = '';
                        photoPreview.style.display = 'none';
                        photoPreviewImg.src = '';
                        // Clear the files property
                        if (photoInput.files && photoInput.files.length > 0) {
                            const dataTransfer = new DataTransfer();
                            photoInput.files = dataTransfer.files;
                        }
                    };
                    
                    // Remove old listener if exists
                    if (removePhotoBtn._clickHandler) {
                        removePhotoBtn.removeEventListener('click', removePhotoBtn._clickHandler);
                }
                    
                    removePhotoBtn.addEventListener('click', removePhotoHandler);
                    removePhotoBtn._clickHandler = removePhotoHandler;
                }

                // Handle camera button
                const openCameraBtn = document.getElementById('openCameraBtn');
                let cameraBtnHoverEnterHandler = null;
                let cameraBtnHoverLeaveHandler = null;
                let cameraBtnClickHandler = null;
                
                if (openCameraBtn) {
                    // Add hover effect
                    cameraBtnHoverEnterHandler = function() {
                        this.style.backgroundColor = '#0052a3';
                    };
                    cameraBtnHoverLeaveHandler = function() {
                        this.style.backgroundColor = '#0066cc';
                    };
                    cameraBtnClickHandler = function() {
                        openCameraModal(photoInput, photoPreview, photoPreviewImg);
                    };
                    
                    openCameraBtn.addEventListener('mouseenter', cameraBtnHoverEnterHandler);
                    openCameraBtn.addEventListener('mouseleave', cameraBtnHoverLeaveHandler);
                    openCameraBtn.addEventListener('click', cameraBtnClickHandler);
                    
                    // Store handlers for cleanup
                    openCameraBtn._hoverEnterHandler = cameraBtnHoverEnterHandler;
                    openCameraBtn._hoverLeaveHandler = cameraBtnHoverLeaveHandler;
                    openCameraBtn._clickHandler = cameraBtnClickHandler;
                }

                // Function to open camera modal
                const openCameraModal = (photoInput, photoPreview, photoPreviewImg) => {
                    let stream = null;
                    let video = null;
                    let canvas = null;
                    let photoCaptured = false;

                    Swal.fire({
                        title: 'Akses Kamera',
                        html: `
                            <div style="text-align: center;">
                                <video id="cameraVideo" autoplay playsinline style="width: 100%; max-width: 640px; height: auto; border-radius: 8px; background: #000; display: none;"></video>
                                <canvas id="cameraCanvas" style="display: none;"></canvas>
                                <div id="cameraError" style="color: #dc3545; margin-top: 10px; display: none;"></div>
                                <div id="cameraLoading" style="margin-top: 20px;">
                                    <p>Meminta akses kamera...</p>
                                </div>
                            </div>
                        `,
                        showCancelButton: true,
                        confirmButtonText: 'Ambil Foto',
                        cancelButtonText: 'Batal',
                        confirmButtonColor: '#0066cc',
                        cancelButtonColor: '#6c757d',
                        width: '700px',
                        allowOutsideClick: false,
                        didOpen: async () => {
                            video = document.getElementById('cameraVideo');
                            canvas = document.getElementById('cameraCanvas');
                            const cameraError = document.getElementById('cameraError');
                            const cameraLoading = document.getElementById('cameraLoading');
                            const captureBtn = Swal.getConfirmButton();

                            if (!captureBtn) return;

                            // Disable capture button initially
                            captureBtn.disabled = true;
                            captureBtn.style.opacity = '0.5';
                            captureBtn.style.pointerEvents = 'none';

                            try {
                                // Request camera access
                                stream = await navigator.mediaDevices.getUserMedia({
                                    video: {
                                        facingMode: 'environment', // Use back camera if available
                                        width: { ideal: 1280 },
                                        height: { ideal: 720 }
                                    },
                                    audio: false
                                });

                                // Success - show video
                                video.srcObject = stream;
                                video.style.display = 'block';
                                cameraLoading.style.display = 'none';
                                
                                // Enable capture button
                                captureBtn.disabled = false;
                                captureBtn.style.opacity = '1';
                                captureBtn.style.pointerEvents = 'auto';

                                // Wait for video to be ready
                                video.onloadedmetadata = () => {
                                    video.play().catch(err => {
                                        console.error('Error playing video:', err);
                                    });
                                };
                            } catch (error) {
                                console.error('Error accessing camera:', error);
                                cameraLoading.style.display = 'none';
                                cameraError.style.display = 'block';
                                
                                if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                                    cameraError.textContent = 'Akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser Anda.';
                                } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                                    cameraError.textContent = 'Kamera tidak ditemukan. Pastikan perangkat Anda memiliki kamera.';
                                } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                                    cameraError.textContent = 'Kamera sedang digunakan oleh aplikasi lain.';
                                } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                                    cameraError.textContent = 'Kamera tidak mendukung resolusi yang diminta.';
                                } else {
                                    cameraError.textContent = 'Tidak dapat mengakses kamera: ' + (error.message || 'Error tidak diketahui');
                                }
                            }
                        },
                        preConfirm: () => {
                            if (!video || !canvas || photoCaptured) {
                                Swal.showValidationMessage('Video kamera belum siap. Tunggu sebentar dan coba lagi.');
                                return false;
                            }

                            // Check if video is ready
                            if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
                                Swal.showValidationMessage('Video kamera belum siap. Tunggu sebentar dan coba lagi.');
                                return false;
                            }

                            try {
                                // Set canvas size to match video
                                canvas.width = video.videoWidth;
                                canvas.height = video.videoHeight;

                                // Draw video frame to canvas
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                                // Convert canvas to blob, then to File
                                return new Promise((resolve) => {
                                    canvas.toBlob((blob) => {
                                        if (!blob) {
                                            Swal.showValidationMessage('Gagal mengambil foto');
                                            resolve(false);
                                            return;
                                        }

                                        // Create File object from blob
                                        const file = new File([blob], `camera_photo_${Date.now()}.jpg`, {
                                            type: 'image/jpeg',
                                            lastModified: Date.now()
                                        });

                                        // Validate file size (max 5MB)
                                        if (file.size > 5 * 1024 * 1024) {
                                            Swal.showValidationMessage('Foto terlalu besar. Maksimal 5MB.');
                                            resolve(false);
                                            return;
                                        }

                                        photoCaptured = true;
                                        resolve(file);
                                    }, 'image/jpeg', 0.92); // Use JPEG with quality 0.92
                                });
                            } catch (error) {
                                console.error('Error capturing photo:', error);
                                Swal.showValidationMessage('Gagal mengambil foto: ' + (error.message || 'Error tidak diketahui'));
                                return false;
                            }
                        },
                        willClose: () => {
                            // Stop camera stream
                            if (stream) {
                                stream.getTracks().forEach(track => {
                                    track.stop();
                                });
                                stream = null;
                            }
                            
                            // Clean up
                            if (video && video.srcObject) {
                                video.srcObject = null;
                            }
                        }
                    }).then((result) => {
                        if (result.isConfirmed && result.value) {
                            const capturedFile = result.value;
                            
                            // Modal kamera sudah ditutup, sekarang update file di modal konfirmasi
                            // Use setTimeout to ensure modal kamera is fully closed and main modal is visible
                            setTimeout(() => {
                                try {
                                    // Get elements again from main modal (they might have been recreated)
                                    const mainPhotoInput = document.getElementById('forwardPhoto');
                                    const mainPhotoPreview = document.getElementById('photoPreview');
                                    const mainPhotoPreviewImg = document.getElementById('photoPreviewImg');
                                    
                                    if (!mainPhotoInput) {
                                        console.error('Photo input not found in main modal');
                                        return;
                                    }

                                    // Create a FileList-like object and set it to the input
                                    if (typeof DataTransfer !== 'undefined') {
                                        const dataTransfer = new DataTransfer();
                                        dataTransfer.items.add(capturedFile);
                                        mainPhotoInput.files = dataTransfer.files;
                                    } else {
                                        // Fallback for older browsers - use Object.defineProperty
                                        Object.defineProperty(mainPhotoInput, 'files', {
                                            value: [capturedFile],
                                            writable: false
                                        });
                                    }

                                    // Update preview directly to ensure it shows immediately
                                    // Also trigger change event to ensure handler runs
                                    const updatePreview = () => {
                                        const currentPhotoInput = document.getElementById('forwardPhoto');
                                        const currentPhotoPreview = document.getElementById('photoPreview');
                                        const currentPhotoPreviewImg = document.getElementById('photoPreviewImg');
                                        
                                        if (currentPhotoInput && currentPhotoPreview && currentPhotoPreviewImg) {
                                            // Update preview directly
                                            const reader = new FileReader();
                                            reader.onload = function(event) {
                                                currentPhotoPreviewImg.src = event.target.result;
                                                currentPhotoPreview.style.display = 'block';
                                                
                                                // Show success message
                                                const existingMsg = document.getElementById('camera-success-notification');
                                                if (existingMsg) {
                                                    existingMsg.remove();
                                                }
                                                
                                                const successMsg = document.createElement('div');
                                                successMsg.id = 'camera-success-notification';
                                                successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #28a745; color: white; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; display: flex; align-items: center; gap: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; animation: slideIn 0.3s ease;';
                                                successMsg.innerHTML = `
                                                    <span style="font-size: 20px;">✓</span>
                                                    <span>Foto berhasil diambil dan tersimpan</span>
                                                `;
                                                
                                                // Add animation style if not exists
                                                if (!document.getElementById('camera-notification-style')) {
                                                    const style = document.createElement('style');
                                                    style.id = 'camera-notification-style';
                                                    style.textContent = `
                                                        @keyframes slideIn {
                                                            from {
                                                                transform: translateX(100%);
                                                                opacity: 0;
                                                            }
                                                            to {
                                                                transform: translateX(0);
                                                                opacity: 1;
                                                            }
                                                        }
                                                    `;
                                                    document.head.appendChild(style);
                                                }
                                                
                                                document.body.appendChild(successMsg);
                                                
                                                // Remove message after 2 seconds
                                                setTimeout(() => {
                                                    if (successMsg && successMsg.parentNode) {
                                                        successMsg.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                                                        successMsg.style.transform = 'translateX(100%)';
                                                        successMsg.style.opacity = '0';
                                                        setTimeout(() => {
                                                            if (successMsg && successMsg.parentNode) {
                                                                successMsg.parentNode.removeChild(successMsg);
                                                            }
                                                        }, 300);
                                                    }
                                                }, 2000);
                                            };
                                            reader.onerror = function() {
                                                console.error('Error reading captured file');
                                                // Fallback: trigger change event
                                                const changeEvent = new Event('change', { bubbles: true });
                                                currentPhotoInput.dispatchEvent(changeEvent);
                                            };
                                            reader.readAsDataURL(capturedFile);
                                            
                                            // Also trigger change event as backup
                                            setTimeout(() => {
                                                const changeEvent = new Event('change', { bubbles: true });
                                                currentPhotoInput.dispatchEvent(changeEvent);
                                            }, 50);
                                        } else {
                                            // Fallback: trigger change event if preview elements not found
                                            const fallbackInput = document.getElementById('forwardPhoto');
                                            if (fallbackInput) {
                                                const changeEvent = new Event('change', { bubbles: true });
                                                fallbackInput.dispatchEvent(changeEvent);
                                            }
                                        }
                                    };
                                    
                                    // Try to update preview immediately
                                    updatePreview();
                                    
                                    // Also try again after a short delay in case DOM is not ready
                                    setTimeout(updatePreview, 150);
                                } catch (error) {
                                    console.error('Error setting captured file:', error);
                                    
                                    // Show error message
                                    const errorMsg = document.createElement('div');
                                    errorMsg.id = 'camera-error-notification';
                                    errorMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #dc3545; color: white; padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; display: flex; align-items: center; gap: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; animation: slideIn 0.3s ease;';
                                    errorMsg.innerHTML = `
                                        <span style="font-size: 20px;">✕</span>
                                        <span>Gagal menambahkan foto. Silakan coba lagi atau gunakan upload file.</span>
                                    `;
                                    document.body.appendChild(errorMsg);
                                    
                                    // Remove message after 3 seconds
                                    setTimeout(() => {
                                        if (errorMsg && errorMsg.parentNode) {
                                            errorMsg.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                                            errorMsg.style.transform = 'translateX(100%)';
                                            errorMsg.style.opacity = '0';
                                            setTimeout(() => {
                                                if (errorMsg && errorMsg.parentNode) {
                                                    errorMsg.parentNode.removeChild(errorMsg);
                                                }
                                            }, 300);
                                        }
                                    }, 3000);
                                }
                            }, 100); // Increased timeout to ensure modal transition completes
                        }
                    });
                };
            },
            willClose: () => {
                // Cleanup polling interval saat modal ditutup
                try {
                    const forwardMessageField = document.getElementById('forwardMessage');
                    if (forwardMessageField) {
                        // Hapus event listeners
                        if (forwardMessageField._inputHandler) {
                            forwardMessageField.removeEventListener('input', forwardMessageField._inputHandler);
                            forwardMessageField._inputHandler = null;
                        }
                        if (forwardMessageField._pasteHandler) {
                            forwardMessageField.removeEventListener('paste', forwardMessageField._pasteHandler);
                            forwardMessageField._pasteHandler = null;
                        }
                        // Clear interval
                        if (forwardMessageField._pollInterval) {
                            clearInterval(forwardMessageField._pollInterval);
                            forwardMessageField._pollInterval = null;
                        }
                    }
                    
                    // Cleanup camera button event listeners
                    const openCameraBtn = document.getElementById('openCameraBtn');
                    if (openCameraBtn) {
                        if (openCameraBtn._hoverEnterHandler) {
                            openCameraBtn.removeEventListener('mouseenter', openCameraBtn._hoverEnterHandler);
                            openCameraBtn._hoverEnterHandler = null;
                        }
                        if (openCameraBtn._hoverLeaveHandler) {
                            openCameraBtn.removeEventListener('mouseleave', openCameraBtn._hoverLeaveHandler);
                            openCameraBtn._hoverLeaveHandler = null;
                        }
                        if (openCameraBtn._clickHandler) {
                            openCameraBtn.removeEventListener('click', openCameraBtn._clickHandler);
                            openCameraBtn._clickHandler = null;
                        }
                    }
                    
                    // Cleanup photo input event listener if exists
                    const photoInput = document.getElementById('forwardPhoto');
                    if (photoInput && photoInput._changeHandler) {
                        photoInput.removeEventListener('change', photoInput._changeHandler);
                        photoInput._changeHandler = null;
                    }
                    
                    // Cleanup remove photo button event listener if exists
                    const removePhotoBtn = document.getElementById('removePhotoBtn');
                    if (removePhotoBtn && removePhotoBtn._clickHandler) {
                        removePhotoBtn.removeEventListener('click', removePhotoBtn._clickHandler);
                        removePhotoBtn._clickHandler = null;
                    }
                    
                    // Also cleanup focus/blur handlers for message field
                    if (forwardMessageField && forwardMessageField._focusHandler) {
                        forwardMessageField.removeEventListener('focus', forwardMessageField._focusHandler);
                        forwardMessageField._focusHandler = null;
                    }
                    if (forwardMessageField && forwardMessageField._blurHandler) {
                        forwardMessageField.removeEventListener('blur', forwardMessageField._blurHandler);
                        forwardMessageField._blurHandler = null;
                    }
                } catch (e) {
                    console.warn('Error during modal cleanup:', e);
                }
            },
            preConfirm: () => {
                const forwardMessageField = document.getElementById('forwardMessage');
                if (!forwardMessageField) {
                    Swal.showValidationMessage('Field pesan tidak ditemukan');
                    return false;
                }
                
                const message = (forwardMessageField.value || '').trim();
                
                // Validasi: pesan wajib diisi
                if (message.length === 0) {
                    Swal.showValidationMessage('Pesan wajib diisi');
                    return false;
                }

                // Get photo file if exists
                const photoInput = document.getElementById('forwardPhoto');
                const photoFile = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
                
                return { message: message, photo: photoFile };
            }
        }).then((result) => {
            if (result.isConfirmed && result.value) {
                this.forwardProblem(problemId, result.value.message, result.value.photo);
            }
        });
    }

    // 5. METHOD BARU: forwardProblem
    async forwardProblem(problemId, message = '', photo = null) {
        try {
            // Use FormData if photo exists, otherwise use JSON
            const formData = new FormData();
            formData.append('message', message || 'Problem telah diteruskan untuk penanganan.');
            if (photo) {
                formData.append('photo', photo);
            }

            const headers = this.getAuthHeaders();
            // Don't set Content-Type for FormData, let browser set it with boundary
            delete headers['Content-Type'];

            const response = await fetch(`/api/dashboard/problem/${problemId}/forward`, {
                method: 'POST',
                headers: headers,
                body: photo ? formData : JSON.stringify({ message: message || 'Problem telah diteruskan untuk penanganan.' })
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

        // Cancel button (for canceling problem without saving to database/analytics)
        const cancelBtn = document.getElementById('cancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.showCancelConfirmation(problemId, problemData);
            });
        }

        // Direct resolve button (for direct resolve by leader without forward)
        const directResolveBtn = document.getElementById('directResolveBtn');
        if (directResolveBtn) {
            directResolveBtn.addEventListener('click', () => {
                this.showDirectResolveConfirmation(problemId, problemData);
            });
        }

        // Ticketing button
        const ticketingBtn = document.getElementById('ticketingBtn');
        if (ticketingBtn) {
            ticketingBtn.addEventListener('click', () => {
                this.openTicketingForm(problemId);
            });
        }

        // Notify leader button (for manager)
        const notifyLeaderBtn = document.getElementById('notifyLeaderBtn');
        if (notifyLeaderBtn) {
            notifyLeaderBtn.addEventListener('click', () => {
                this.sendNotificationToLeader(problemId, problemData);
            });
        }
    }

    // Method untuk kirim notifikasi ulang ke leader (untuk manager)
    async sendNotificationToLeader(problemId, problemData) {
        try {
            Swal.fire({
                title: 'Kirim Notifikasi ke Leader?',
                html: `
                    <div style="text-align: left; margin: 15px 0;">
                        <p><strong>Mesin:</strong> ${problemData.machine || problemData.machine_name}</p>
                        <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                        <p><strong>Line:</strong> ${problemData.line_name || 'N/A'}</p>
                        <p style="color: #ff9800; font-weight: bold; margin-top: 10px;">Notifikasi akan dikirim ke leader yang menangani line ini sebagai pengingat bahwa ada problem yang belum ditangani.</p>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Kirim Notifikasi',
                cancelButtonText: 'Batal',
                confirmButtonColor: '#ff9800',
                cancelButtonColor: '#6c757d'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        console.log(`📤 Sending notification request to: /api/dashboard/problem/${problemId}/notify-leader`);
                        console.log(`Problem ID: ${problemId}`);
                        console.log(`User role: ${this.userRole}`);
                        
                        const response = await fetch(`/api/dashboard/problem/${problemId}/notify-leader`, {
                            method: 'POST',
                            headers: this.getAuthHeaders(),
                            body: JSON.stringify({})
                        });
                        
                        console.log(`Response status: ${response.status}, OK: ${response.ok}`);

                        // Check if response is ok
                        if (!response.ok) {
                            // Try to get error message from response
                            let errorMessage = 'Failed to send notification';
                            try {
                                const errorData = await response.json();
                                errorMessage = errorData.message || errorData.error || errorMessage;
                            } catch (e) {
                                // If response is not JSON, use status text
                                if (response.status === 404) {
                                    errorMessage = 'API endpoint not found. Please check server configuration.';
                                } else if (response.status === 401) {
                                    errorMessage = 'Unauthorized. Please login again.';
                                } else if (response.status === 403) {
                                    errorMessage = 'Access denied. Only manager can send notifications.';
                                } else {
                                    errorMessage = response.statusText || errorMessage;
                                }
                            }
                            throw new Error(errorMessage);
                        }

                        const data = await response.json();
                        
                        if (data.success) {
                            this.showSweetAlert('success', 'Notifikasi Terkirim', data.message || 'Notifikasi telah dikirim ke leader yang menangani line ini.');
                        } else {
                            throw new Error(data.message || 'Failed to send notification');
                        }
                    } catch (error) {
                        console.error('Error sending notification to leader:', error);
                        this.showSweetAlert('error', 'Error', 'Gagal mengirim notifikasi: ' + error.message);
                    }
                }
            });
        } catch (error) {
            console.error('Error in sendNotificationToLeader:', error);
            this.showSweetAlert('error', 'Error', 'Gagal mengirim notifikasi: ' + error.message);
        }
    }

    // Method untuk receive problem
    async receiveProblem(problemId) {
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${problemId}/receive`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Received', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
                
                // Otomatis tampilkan form ticketing jika user memerlukan ticketing
                try {
                    const token = this.getCookieValue('auth_token');
                    const problemResponse = await fetch(`/api/dashboard/problem/${problemId}`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        }
                    });
                    const problemData = await problemResponse.json();
                    
                    if (problemData.success && problemData.data.problem_type) {
                        const problemType = problemData.data.problem_type.toLowerCase();
                        const shouldShowTicketing = 
                            (this.userRole === 'maintenance' && problemType === 'machine') ||
                            (this.userRole === 'quality' && problemType === 'quality') ||
                            (this.userRole === 'engineering' && (problemType === 'engineering' || problemType === 'material'));
                        
                        if (shouldShowTicketing) {
                            // Delay sedikit untuk memastikan modal sebelumnya sudah tertutup
                            setTimeout(() => {
                                this.openTicketingForm(problemId);
                            }, 1000);
                        }
                    }
                } catch (error) {
                    // Silent fail, tidak perlu log error
                }
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
                <div style="text-align: left; margin-top: 20px;">
                    <label for="resultRepair" style="display: block; margin-bottom: 8px; font-weight: bold; color: #495057;">Result/Perbaikan yang Dilakukan: <span style="color: red;">*</span></label>
                    <textarea id="resultRepair" placeholder="Jelaskan perbaikan yang telah dilakukan..." style="width: 100%; min-width: 100%; max-width: 100%; height: 120px; padding: 12px; border: 1px solid #ced4da; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 0.95rem; line-height: 1.5; box-sizing: border-box; transition: border-color 0.2s ease, box-shadow 0.2s ease;" required></textarea>
                </div>
                <div style="text-align: left; margin-top: 20px;">
                    <label for="feedbackMessage" style="display: block; margin-bottom: 8px; font-weight: bold; color: #495057;">Pesan (Opsional):</label>
                    <textarea id="feedbackMessage" placeholder="Tambahkan catatan tentang penanganan problem..." style="width: 100%; min-width: 100%; max-width: 100%; height: 100px; padding: 12px; border: 1px solid #ced4da; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 0.95rem; line-height: 1.5; box-sizing: border-box; transition: border-color 0.2s ease, box-shadow 0.2s ease;"></textarea>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Mark as Resolved',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#ffc107',
            cancelButtonColor: '#6c757d',
            allowEnterKey: true,
            allowOutsideClick: false,
            width: '600px',
            didOpen: () => {
                // Tambahkan focus style untuk textarea
                const resultRepairField = document.getElementById('resultRepair');
                const feedbackMessageField = document.getElementById('feedbackMessage');
                
                if (resultRepairField) {
                    resultRepairField.addEventListener('focus', function() {
                        this.style.borderColor = '#0A2856';
                        this.style.boxShadow = '0 0 0 3px rgba(10, 40, 86, 0.1)';
                    });
                    resultRepairField.addEventListener('blur', function() {
                        this.style.borderColor = '#ced4da';
                        this.style.boxShadow = 'none';
                    });
                }
                
                if (feedbackMessageField) {
                    feedbackMessageField.addEventListener('focus', function() {
                        this.style.borderColor = '#0A2856';
                        this.style.boxShadow = '0 0 0 3px rgba(10, 40, 86, 0.1)';
                    });
                    feedbackMessageField.addEventListener('blur', function() {
                        this.style.borderColor = '#ced4da';
                        this.style.boxShadow = 'none';
                    });
                }
                
                // Enable/disable confirm button based on result_repair field
                // Validasi sederhana: hanya cek apakah result_repair tidak kosong
                let pollInterval = null;
                
                const enableButton = () => {
                    const confirmButton = Swal.getConfirmButton() || document.querySelector('.swal2-confirm');
                    if (confirmButton) {
                        // Force enable - override semua
                        confirmButton.disabled = false;
                        confirmButton.removeAttribute('disabled');
                        confirmButton.removeAttribute('aria-disabled');
                        confirmButton.style.cssText += 'opacity: 1 !important; pointer-events: auto !important; cursor: pointer !important;';
                        confirmButton.classList.remove('swal2-disabled', 'swal2-deny');
                    }
                };
                
                const disableButton = () => {
                    let confirmButton = Swal.getConfirmButton();
                    if (!confirmButton) {
                        confirmButton = document.querySelector('.swal2-confirm');
                    }
                    if (!confirmButton) {
                        confirmButton = document.querySelector('button.swal2-confirm');
                    }
                    
                    if (confirmButton) {
                        confirmButton.disabled = true;
                        confirmButton.setAttribute('disabled', 'disabled');
                        confirmButton.setAttribute('aria-disabled', 'true');
                        confirmButton.style.opacity = '0.5';
                        confirmButton.style.cursor = 'not-allowed';
                        confirmButton.style.pointerEvents = 'none';
                        confirmButton.classList.add('swal2-disabled');
                    }
                };
                
                const updateButtonState = () => {
                    const resultRepairField = document.getElementById('resultRepair');
                    if (!resultRepairField) {
                        return;
                    }
                    
                    const value = resultRepairField.value || '';
                    const hasValue = value.trim().length > 0;
                    
                    if (hasValue) {
                        enableButton();
                    } else {
                        disableButton();
                    }
                };
                
                // Setup sederhana: langsung monitor dan force enable jika perlu
                const setupValidation = () => {
                    const resultRepairField = document.getElementById('resultRepair');
                    const confirmButton = Swal.getConfirmButton() || document.querySelector('.swal2-confirm');
                    
                    if (!resultRepairField || !confirmButton) {
                        setTimeout(setupValidation, 50);
                        return;
                    }
                    
                    // Event listener sederhana
                    const inputHandler = () => updateButtonState();
                    const pasteHandler = () => setTimeout(updateButtonState, 10);
                    
                    resultRepairField.addEventListener('input', inputHandler);
                    resultRepairField.addEventListener('paste', pasteHandler);
                    
                    // Polling sederhana - terus force enable jika ada value
                    pollInterval = setInterval(() => {
                        const button = Swal.getConfirmButton() || document.querySelector('.swal2-confirm');
                        const value = (resultRepairField.value || '').trim();
                        if (value.length > 0 && button) {
                            // Force enable terus-menerus - override semua
                            button.disabled = false;
                            button.removeAttribute('disabled');
                            button.removeAttribute('aria-disabled');
                            button.style.cssText += 'opacity: 1 !important; pointer-events: auto !important; cursor: pointer !important;';
                            button.classList.remove('swal2-disabled', 'swal2-deny');
                        } else if (button) {
                            button.disabled = true;
                            button.style.opacity = '0.5';
                            button.style.pointerEvents = 'none';
                        }
                    }, 100);
                    
                    // Initial check
                    updateButtonState();
                    
                    // Simpan reference untuk cleanup
                    if (resultRepairField) {
                        resultRepairField._pollInterval = pollInterval;
                        resultRepairField._inputHandler = inputHandler;
                        resultRepairField._pasteHandler = pasteHandler;
                    }
                };
                
                setTimeout(setupValidation, 50);
            },
            willClose: () => {
                // Cleanup polling interval saat modal ditutup
                try {
                    const resultRepairField = document.getElementById('resultRepair');
                    if (resultRepairField) {
                        // Hapus event listeners
                        if (resultRepairField._inputHandler) {
                            resultRepairField.removeEventListener('input', resultRepairField._inputHandler);
                        }
                        if (resultRepairField._pasteHandler) {
                            resultRepairField.removeEventListener('paste', resultRepairField._pasteHandler);
                        }
                        // Clear interval
                        if (resultRepairField._pollInterval) {
                            clearInterval(resultRepairField._pollInterval);
                            resultRepairField._pollInterval = null;
                        }
                    }
                } catch (e) {
                    console.warn('Error during modal cleanup:', e);
                }
            },
            preConfirm: () => {
                const resultRepairField = document.getElementById('resultRepair');
                if (!resultRepairField) {
                    Swal.showValidationMessage('Field Result/Perbaikan tidak ditemukan');
                    return false;
                }
                
                const resultRepair = (resultRepairField.value || '').trim();
                const message = (document.getElementById('feedbackMessage')?.value || '').trim();
                
                // Validasi sederhana: hanya cek apakah tidak kosong
                if (resultRepair.length === 0) {
                    Swal.showValidationMessage('Result/Perbaikan yang Dilakukan wajib diisi');
                    return false;
                }
                
                // Jika sudah terisi, return data
                return { 
                    result_repair: resultRepair,
                    message: message 
                };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                this.feedbackResolvedProblem(problemId, result.value.result_repair, result.value.message);
            }
        });
    }

    // Method untuk feedback resolved problem
    async feedbackResolvedProblem(problemId, resultRepair, message = '') {
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${problemId}/feedback-resolved`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    result_repair: resultRepair,
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

    // Method untuk show cancel confirmation (cancel problem without saving to database/analytics)
    showCancelConfirmation(problemId, problemData) {
        Swal.fire({
            title: 'Cancel Problem?',
            html: `
                <div style="text-align: left; margin: 15px 0;">
                    <p><strong>Mesin:</strong> ${problemData.machine}</p>
                    <p><strong>Problem:</strong> ${problemData.problem_type}</p>
                    <p style="color: #dc3545; font-weight: bold;">Ini akan mematikan problem tanpa menyimpan data ke database atau analytics. Digunakan untuk mengatasi kesalahan penekanan tombol oleh operator.</p>
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, Cancel Problem',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                this.cancelProblem(problemId);
            }
        });
    }

    // Method untuk cancel problem (hanya mematikan problem tanpa logging)
    async cancelProblem(problemId) {
        try {
            const response = await fetch(`/api/dashboard/problem/${problemId}/cancel`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSweetAlert('success', 'Problem Cancelled', data.message);
                this.closeModal();
                this.loadDashboardData(); // Refresh data
                this.loadStats(); // Refresh stats
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('Error canceling problem:', error);
            this.showSweetAlert('error', 'Error', 'Failed to cancel problem: ' + error.message);
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
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${problemId}/final-resolved`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
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
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${problemId}/final-resolved`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
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
    // PERBAIKAN: Method ini sekarang dipindahkan ke halaman divisi
    // Notifikasi forwarded problem untuk maintenance, quality, engineering tidak lagi muncul di dashboard utama
    showForwardedProblemNotification(data) {
        console.log(`📧 Showing forwarded problem notification for role: ${this.userRole}`);

        // Notifikasi forwarded problem untuk maintenance, quality, engineering sekarang dipindahkan ke halaman divisi
        // Method ini tidak lagi digunakan di dashboard utama untuk role tersebut
        if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
            // Return early karena notifikasi sudah dipindahkan ke halaman divisi
            return;
        }
        
        // Untuk role lain (jika ada), tetap bisa menggunakan logic lama
        // Tapi saat ini tidak ada role lain yang menggunakan notifikasi forwarded problem di dashboard utama
        console.log(`📧 Notifikasi forward tidak untuk role ${this.userRole} di dashboard utama, disembunyikan`);
        return;

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
            case 'engineering':
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
                    <p><strong>Line:</strong> ${data.line_name || 'N/A'}</p>
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
            // Notifikasi ini membutuhkan aksi dari leader, jadi jangan auto-close
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                // Buka langsung modal detail problem untuk final resolve
                // Gunakan problem_id untuk memuat detail problem; nama mesin akan diambil dari API
                this.showProblemDetail(`Problem ${data.problem_id}`, data.problem_id);
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

    // Method untuk cek apakah sudah ada ticketing untuk problem
    async checkTicketingExists(problemId) {
        try {
            const response = await fetch(`/api/dashboard/ticketing/problem/${problemId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getCookieValue('auth_token')}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 404) {
                // 404 adalah normal jika ticketing belum ada
                return false;
            }

            if (!response.ok) {
                // Jangan log error, return false saja
                return false;
            }

            const data = await response.json();
            return data.success && data.data; // Return true jika ada ticketing
        } catch (error) {
            // Jangan log error, karena 404 adalah normal
            return false; // Default ke false jika error
        }
    }

    // Ticketing methods
    async openTicketingForm(problemId) {
        try {
            // Load technicians list
            await this.loadTechnicians();
            
            // Set problem ID
            document.getElementById('ticketingProblemId').value = problemId;
            
            // Fetch problem detail to get received_at
            try {
                const problemResponse = await fetch(`/api/dashboard/problem/${problemId}`, {
                    headers: {
                        'Authorization': `Bearer ${this.getCookieValue('auth_token')}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (problemResponse.ok) {
                    const problemData = await problemResponse.json();
                    if (problemData.success && problemData.data) {
                        const problem = problemData.data;
                        
                        // Set problem_received_at jika problem sudah di-receive
                        const problemReceivedAtElement = document.getElementById('problemReceivedAt');
                        if (problemReceivedAtElement && problem.received_at) {
                            // Convert received_at format (d/m/Y H:i:s) to datetime-local format
                            const receivedAtParts = problem.received_at.split(' ');
                            if (receivedAtParts.length === 2) {
                                const datePart = receivedAtParts[0].split('/');
                                const timePart = receivedAtParts[1];
                                if (datePart.length === 3) {
                                    // Format: DD/MM/YYYY HH:mm:ss -> YYYY-MM-DDTHH:mm
                                    const formattedDate = `${datePart[2]}-${datePart[1]}-${datePart[0]}T${timePart.substring(0, 5)}`;
                                    problemReceivedAtElement.value = formattedDate;
                                }
                            }
                        } else if (problemReceivedAtElement && !problem.received_at) {
                            // Jika belum di-receive, set dengan waktu sekarang
                            const now = new Date();
                            const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                            problemReceivedAtElement.value = localDateTime;
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching problem detail:', error);
                // Jika error, set dengan waktu sekarang sebagai fallback
                const problemReceivedAtElement = document.getElementById('problemReceivedAt');
                if (problemReceivedAtElement) {
                    const now = new Date();
                    const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    problemReceivedAtElement.value = localDateTime;
                }
            }
            
            // Show modal with proper centering
            const modal = document.getElementById('ticketingModal');
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            
            // Set current time as default for diagnosis and repair start time
            const now = new Date();
            const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            
            // Set default values for diagnosis and repair start time
            const diagnosisElement = document.getElementById('diagnosisStartedAt');
            const repairElement = document.getElementById('repairStartedAt');
            
            if (diagnosisElement) {
                diagnosisElement.value = localDateTime;
            }
            if (repairElement) {
                repairElement.value = localDateTime;
            }
            
        } catch (error) {
            console.error('Error opening ticketing form:', error);
            this.showSweetAlert('error', 'Error', 'Gagal membuka form ticketing');
        }
    }

    closeTicketingModal() {
        const modal = document.getElementById('ticketingModal');
        modal.style.display = 'none';
        document.getElementById('ticketingForm').reset();
    }

    async loadTechnicians() {
        try {
            const response = await fetch('/api/dashboard/ticketing/technicians', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getCookieValue('auth_token')}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Technicians data:', data); // Debug log
            
            const select = document.getElementById('picTechnician');
            
            // Clear existing options except the first one
            select.innerHTML = '<option value="">Pilih Teknisi</option>';
            
            // Add technician options
            if (data.success && data.data && Array.isArray(data.data)) {
                data.data.forEach(technician => {
                    const option = document.createElement('option');
                    // Handle both old format (string) and new format (object with id, nama, departement)
                    if (typeof technician === 'string') {
                        option.value = technician;
                        option.textContent = technician;
                    } else if (technician.nama) {
                        option.value = technician.nama;
                        option.textContent = technician.nama;
                        // Store id as data attribute if needed
                        if (technician.id) {
                            option.dataset.id = technician.id;
                        }
                    }
                    select.appendChild(option);
                });
            } else {
                throw new Error('Invalid data format received');
            }
            
        } catch (error) {
            console.error('Error loading technicians:', error);
            // Fallback to default technicians if API fails
            const select = document.getElementById('picTechnician');
            select.innerHTML = `
                <option value="">Pilih Teknisi</option>
                <option value="Teknisi A">Teknisi A</option>
                <option value="Teknisi B">Teknisi B</option>
                <option value="Teknisi C">Teknisi C</option>
            `;
        }
    }

    async submitTicketingForm() {
        try {
            const form = document.getElementById('ticketingForm');
            if (!form) {
                this.showSweetAlert('error', 'Error', 'Form tidak ditemukan');
                return;
            }
            
            const formData = new FormData(form);
            
            // Convert form data to JSON
            const data = {};
            for (let [key, value] of formData.entries()) {
                // Abaikan field repair_completed_at yang diatur otomatis oleh sistem
                // Tapi tetap kirim problem_received_at karena sudah diisi di form
                if (key === 'repair_completed_at') continue;
                // Trim string values
                data[key] = typeof value === 'string' ? value.trim() : value;
            }
            
            // Validate required fields dengan pesan yang lebih spesifik
            const errors = [];
            
            // Check problem_id dari form
            const problemIdInput = document.getElementById('ticketingProblemId');
            if (!problemIdInput || !problemIdInput.value) {
                errors.push('Problem ID tidak ditemukan. Silakan tutup form dan buka lagi.');
            } else {
                data.problem_id = problemIdInput.value;
            }
            
            // Check PIC/Technician dari select
            const picSelect = document.getElementById('picTechnician');
            if (!picSelect || !picSelect.value || picSelect.value === '') {
                errors.push('PIC/Teknisi wajib dipilih');
            }
            
            // Check Diagnosis dari textarea
            const diagnosisTextarea = document.getElementById('diagnosis');
            if (!diagnosisTextarea || !diagnosisTextarea.value || diagnosisTextarea.value.trim() === '') {
                errors.push('Diagnosa/Analisis Masalah wajib diisi');
            }
            
            if (errors.length > 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Validasi Error',
                    html: errors.join('<br>')
                });
                return;
            }
            
            // Show loading
            Swal.fire({
                title: 'Menyimpan...',
                text: 'Sedang menyimpan ticketing problem',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });
            
            const response = await fetch('/api/dashboard/ticketing', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getCookieValue('auth_token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            // Handle non-OK responses
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({
                    message: `HTTP error! status: ${response.status}`
                }));
                
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: errorData.message || 'Gagal menyimpan ticketing. Silakan coba lagi.'
                });
                return;
            }

            const result = await response.json();
            
            if (result.success) {
                // Cek apakah modal problem detail masih terbuka sebelum close ticketing modal
                const problemModal = document.getElementById('problemModal');
                const shouldRefreshProblemDetail = problemModal && 
                    (problemModal.classList.contains('show') || problemModal.style.display !== 'none') && 
                    this.currentProblemId;
                
                Swal.fire({
                    title: 'Berhasil!',
                    text: 'Ticketing problem berhasil disimpan',
                    icon: 'success',
                    confirmButtonText: 'OK',
                    timer: 1500,
                    timerProgressBar: true
                }).then(async () => {
                    this.closeTicketingModal();
                    
                    // Refresh problem detail jika modal masih terbuka - lakukan SEBELUM loadDashboardData
                    if (shouldRefreshProblemDetail) {
                        console.log('Refreshing problem detail after ticketing save...');
                        await this.refreshCurrentProblemDetail();
                    }
                    
                    // Refresh dashboard data
                    this.loadDashboardData();
                });
            } else {
                throw new Error(result.message || 'Failed to save ticketing');
            }
            
        } catch (error) {
            console.error('Error submitting ticketing form:', error);
            Swal.fire({
                title: 'Error!',
                text: error.message || 'Gagal menyimpan ticketing problem',
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    }

    // Method untuk refresh problem detail yang sedang terbuka
    async refreshCurrentProblemDetail() {
        if (!this.currentProblemId) return;
        
        try {
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${this.currentProblemId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            
            if (data.success) {
                const modalBody = document.getElementById('modalBody');
                const modalFooter = document.querySelector('.modal-footer');
                
                if (modalBody && modalFooter) {
                    const problemDetailHTML = await this.createProblemDetailHTML(data.data);
                    
                    // Extract action buttons from the HTML and move them to footer
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = problemDetailHTML;
                    const actionButtons = tempDiv.querySelector('.action-buttons');
                    
                    // Clear existing action buttons from footer
                    const existingActionButtons = modalFooter.querySelectorAll('.action-buttons');
                    existingActionButtons.forEach(btn => btn.remove());
                    
                    if (actionButtons) {
                        // Remove action buttons from the main content
                        const contentWithoutActions = problemDetailHTML.replace(/<div class="action-buttons"[\s\S]*?<\/div>/g, '');
                        modalBody.innerHTML = contentWithoutActions;
                        
                        // Add action buttons to footer
                        modalFooter.appendChild(actionButtons);
                    } else {
                        modalBody.innerHTML = problemDetailHTML;
                    }
                    
                    // Re-bind event listeners untuk tombol-tombol action
                    this.bindProblemActionButtons(this.currentProblemId, data.data);
                }
            }
        } catch (error) {
            console.error('Error refreshing problem detail:', error);
        }
    }

    // Method untuk mengecek problem yang sudah 15 menit (hanya untuk manager)
    // PERBAIKAN: Method ini sekarang dipindahkan ke halaman divisi
    // Notifikasi 15 menit untuk manager tidak lagi muncul di dashboard utama
    checkLongDurationProblems(problems) {
        // Notifikasi 15 menit untuk manager sekarang dipindahkan ke halaman divisi
        // Method ini tidak lagi digunakan di dashboard utama
        if (this.userRole !== 'manager') {
            return;
        }
        // Return early untuk manager karena notifikasi sudah dipindahkan ke halaman divisi
        return;

        const now = new Date();
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

        // Filter hanya problem dengan status 'ACTIVE'
        const activeProblems = problems.filter(problem => problem.status === 'ACTIVE');

        activeProblems.forEach(problem => {
            const problemId = problem.id;
            const problemTimestamp = new Date(problem.timestamp);
            
            // Jika problem belum pernah dicatat start time, catat sekarang
            if (!this.problemStartTimes.has(problemId)) {
                this.problemStartTimes.set(problemId, problemTimestamp);
            }

            // Ambil waktu mulai problem dari tracking
            const problemStartTime = this.problemStartTimes.get(problemId);
            
            // Cek apakah problem sudah 15 menit sejak menjadi ACTIVE dan belum pernah dikirim notifikasi
            if (problemStartTime <= fifteenMinutesAgo && 
                !this.sentLongDurationNotifications.has(problemId)) {
                
                console.log(`🚨 Manager notification: Problem ${problemId} has been ACTIVE for more than 15 minutes`);
                this.showLongDurationNotification(problem);
                this.sentLongDurationNotifications.add(problemId);
            }
        });

        // Clean up problem start times untuk problem yang sudah resolved
        const currentProblemIds = new Set(activeProblems.map(p => p.id));
        for (const [problemId, startTime] of this.problemStartTimes) {
            if (!currentProblemIds.has(problemId)) {
                this.problemStartTimes.delete(problemId);
                this.sentLongDurationNotifications.delete(problemId);
            }
        }
    }

    // Method untuk menampilkan notifikasi problem 15 menit
    showLongDurationNotification(problem) {
        const duration = this.calculateProblemDuration(problem.timestamp);
        
        Swal.fire({
            title: '⚠️ Problem Tidak Ditangani',
            html: `
                <div style="text-align: left;">
                    <p><strong>Machine:</strong> ${problem.machine || 'Unknown'}</p>
                    <p><strong>Problem Type:</strong> ${problem.problem_type || 'Unknown'}</p>
                    <p><strong>Line:</strong> ${problem.line_name || 'Unknown'}</p>
                    <p><strong>Duration:</strong> ${duration}</p>
                    <p style="color: #e74c3c; font-weight: bold;">Problem ini sudah aktif selama lebih dari 15 menit dan belum ditangani!</p>
                </div>
            `,
            icon: 'warning',
            confirmButtonText: 'OK',
            confirmButtonColor: '#e74c3c',
            allowOutsideClick: false,
            allowEscapeKey: false
        });

        // Play alert sound
        if (this.alertSound) {
            this.alertSound.play().catch(e => console.log('Could not play alert sound:', e));
        }
    }

    // Method untuk menghitung durasi problem
    calculateProblemDuration(timestamp) {
        const now = new Date();
        const problemTime = new Date(timestamp);
        const diffMs = now - problemTime;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }
}

// Global functions (called from HTML)
let dashboardManager;

function showProblemDetail(machine, problemId = null, machineLine = null) {
    if (dashboardManager) {
        dashboardManager.showProblemDetail(machine, problemId, machineLine);
    } else {
        console.error('DashboardManager not initialized');
    }
}

function closeModal() {
    dashboardManager.closeModal();
}

function resolveProblem() {
    // This function is deprecated - use new forward problem workflow instead
    console.warn('resolveProblem() is deprecated. Use new forward problem workflow.');
}

// Ticketing functions
function openTicketingForm(problemId) {
    dashboardManager.openTicketingForm(problemId);
}

function closeTicketingModal() {
    dashboardManager.closeTicketingModal();
}

function submitTicketingForm() {
    dashboardManager.submitTicketingForm();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Pastikan body visible
        if (document.body) {
            document.body.style.visibility = 'visible';
            document.body.style.display = 'block';
        }
        
        dashboardManager = new DashboardManager();
        
        // Request notification permission on load (for browser notifications as backup)
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    } catch (error) {
        console.error('Error initializing DashboardManager:', error);
        
        // Pastikan konten tetap terlihat meskipun ada error
        if (document.body) {
            document.body.style.visibility = 'visible';
            document.body.style.display = 'block';
        }
        
        // Tampilkan pesan error ke user
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #e74c3c; color: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000; max-width: 400px;';
        errorDiv.innerHTML = '<strong>Error Memuat Dashboard</strong><p style="margin: 10px 0 0 0; font-size: 0.9em;">Terjadi error saat memuat dashboard. Silakan refresh halaman.</p><button onclick="location.reload()" style="margin-top: 10px; padding: 6px 12px; background: white; color: #e74c3c; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Refresh</button>';
        document.body.appendChild(errorDiv);
        
        // Auto-hide setelah 10 detik
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 10000);
    }
});