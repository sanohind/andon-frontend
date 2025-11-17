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
        this.machines = dashboardDataElement ? JSON.parse(dashboardDataElement.dataset.machines) : [];
        
        // Get line filter from URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.lineFilter = urlParams.get('line') || null;

        this.metricsByAddress = new Map();
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
		this.initSocket();
        this.bindEvents();
        this.loadDashboardData();
        this.loadStats();

        // Load table metrics (target, cycle, oee) and refresh periodically
        this.loadTableMetrics();
        setInterval(() => this.loadTableMetrics(), 60000);
		// Check Node-RED core status immediately and on interval
		this.checkNodeRedStatus();
		setInterval(() => {
			this.checkNodeRedStatus();
		}, 10000);
        
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
            const token = this.getCookieValue('auth_token');
            const response = await fetch('/api/dashboard/status', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-User-Role': this.userRole || '',
                    'X-User-Division': this.userDivision || ''
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
        const criticalProblemsCount = activeProblems.filter(p => p.severity === 'critical').length;
        
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

        // Jangan turunkan angka valid ke 0 jika data sementara kosong
        const currentShown = Number(document.getElementById('totalMachines').textContent || 0);
        const safeTotal = (Number.isFinite(totalMachines) && totalMachines > 0)
            ? totalMachines
            : (currentShown > 0 ? currentShown : totalMachines);

        // Update counters dengan data yang sudah difilter
        document.getElementById('totalMachines').textContent = safeTotal;
        document.getElementById('activeProblems').textContent = activeProblemsCount;
        document.getElementById('criticalProblems').textContent = criticalProblemsCount;
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
                const machineLineName = machineData.line_name; // PERBAIKAN: Ambil line_name dari data
                const machineId = machineName.replace(/ /g, '');
                
                // PERBAIKAN KRITIS: Gunakan kombinasi name + line_name untuk selector yang unik
                const card = document.querySelector(`[data-machine="${machineName}"][data-line="${machineLineName}"]`);
                const light = document.getElementById(`light-${machineId}-line-${machineLineName}`);
                const statusText = document.getElementById(`status-${machineId}-line-${machineLineName}`);

                if (!card || !light || !statusText) {
                    console.warn(`Elements not found for ${machineName} line ${machineLineName}`);
                    return;
                }

                // Check if this machine is controlled by an offline PLC first
                const isPlcOffline = this.isMachineControlledByOfflinePlc(machineName);
                
                if (isPlcOffline) {
                    // PLC is offline - override any other status
                    card.classList.remove('problem', 'warning'); 
                    light.className = 'indicator-light offline';
                    statusText.className = 'status-text offline';
                    statusText.innerHTML = '<i class="fas fa-power-off"></i><span>PLC Offline</span>';
                } else if (machineData) {
                    card.classList.remove('problem', 'warning'); 

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
                        card.classList.add('warning');
                        light.className = 'indicator-light warning';
                        statusText.className = 'status-text warning';
                        statusText.style.display = '';
                        const cycleInfo = machineData.cycle_based_status 
                            ? ` (${machineData.cycle_based_status.cycles_without_increase} cycles)` 
                            : '';
                        statusText.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>Warning - Quantity tidak bertambah${cycleInfo}</span>`;
                    } else {
                        light.className = 'indicator-light normal';
                        statusText.className = 'status-text normal'; 
                        statusText.style.display = '';
                        statusText.innerHTML = `<i class="fas fa-check-circle"></i><span>Normal Operation</span>`;
                    }
                } else {
                    console.warn(`[${machineName} Line ${machineLineName}]: Tidak ada data status yang diterima dari server untuk meja ini.`);
                    card.classList.remove('problem', 'warning'); 
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

        // Filter berdasarkan role dan line_name
        if (this.userRole === 'leader' && this.userLineName) {
            // Leader hanya melihat problem dari line mereka sendiri
            filteredProblems = problems.filter(problem => {
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
            filteredProblems = problems.filter(problem => {
                // Filter by line_name yang sesuai dengan divisi manager
                return problem.line_name && allowedLines.includes(problem.line_name);
            });
        } else if (this.userRole === 'admin') {
            // Admin melihat semua problem
            filteredProblems = problems;
        } else if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
            // Department users hanya melihat problem yang sudah di-forward ke mereka
            filteredProblems = problems.filter(problem => {
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
        const backendTotal = Number(stats.total_machines);
        const currentShown = Number(document.getElementById('totalMachines').textContent || 0);

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

        document.getElementById('totalMachines').textContent = Number.isFinite(totalMachines) ? totalMachines : 0;
        document.getElementById('activeProblems').textContent = stats.active_problems || 0;
        document.getElementById('resolvedToday').textContent = stats.resolved_today || 0;
        document.getElementById('criticalProblems').textContent = stats.critical_problems || 0;
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

	// Check if a machine is controlled by an offline PLC
	isMachineControlledByOfflinePlc(machineName) {
		if (!this.plcDevices || this.plcDevices.length === 0) return false;
		
		const now = new Date();
		
		for (const plc of this.plcDevices) {
			const lastSeen = plc.last_seen ? new Date(plc.last_seen) : null;
			const over1min = lastSeen ? (now - lastSeen) > (1 * 60 * 1000) : true;
			const offlineByStatus = (plc.status || '').toUpperCase() === 'OFFLINE';
			const isOffline = over1min || offlineByStatus;
			
			if (isOffline && plc.controlled_tables) {
				let controlledTables = [];
				try {
					controlledTables = typeof plc.controlled_tables === 'string' 
						? JSON.parse(plc.controlled_tables) 
						: plc.controlled_tables;
				} catch (e) {
					console.warn('Failed to parse controlled_tables for PLC:', plc.device_id);
					continue;
				}
				
				if (controlledTables.includes(machineName)) {
					return true;
				}
			}
		}
		
		return false;
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
                statusClass = 'status-warning';
                statusIcon = 'fa-exclamation-circle';
                statusText = 'Warning';
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
                    <h4><i class="fas fa-exclamation-circle"></i> Warning!</h4>
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
                        <button class="btn ticketing-btn" id="ticketingBtn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 10px; width: 100%;">
                            <i class="fas fa-clipboard-list" style="margin-right: 5px;"></i>
                            Isi Form Ticketing
                        </button>
                    `;
                    // Jangan tampilkan tombol resolved jika belum ada ticketing
                } else {
                    // Sudah ada ticketing, tampilkan tombol mark as resolved
                    resolvedButton = `
                        <button class="btn btn-feedback-resolved" id="feedbackResolvedBtn" style="background-color: #ffc107; color: #212529; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                            <i class="fas fa-check-circle" style="margin-right: 5px;"></i>
                            Mark as Resolved (Feedback)
                        </button>
                    `;
                }
            } else {
                // Bukan maintenance/quality atau bukan machine/quality problem, langsung tampilkan resolved button
                resolvedButton = `
                    <button class="btn btn-feedback-resolved" id="feedbackResolvedBtn" style="background-color: #ffc107; color: #212529; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                        <i class="fas fa-check-circle" style="margin-right: 5px;"></i>
                        Mark as Resolved (Feedback)
                    </button>
                `;
            }
            
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px;">
                    ${ticketingButton}
                    ${resolvedButton}
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
        } else if (actualStatus === 'active' && isManager) {
            // Manager bisa kirim notifikasi ulang ke leader
            actionButtons = `
                <div class="action-buttons" style="margin-top: 20px;">
                    <button class="btn btn-notify-leader" id="notifyLeaderBtn" style="background-color: #ff9800; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%;">
                        <i class="fas fa-bell" style="margin-right: 5px;"></i>
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
                headers: this.getAuthHeaders(),
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
                
                // Jika user adalah maintenance dan problem type adalah machine, tampilkan form ticketing
                if (this.userRole === 'maintenance') {
                    // Get problem detail untuk cek tipe problem
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
                        
                        if (problemData.success && problemData.data.problem_type && 
                            problemData.data.problem_type.toLowerCase() === 'machine') {
                            // Delay sedikit untuk memastikan modal sebelumnya sudah tertutup
                            setTimeout(() => {
                                this.openTicketingForm(problemId);
                            }, 1000);
                        }
                    } catch (error) {
                        console.error('Error checking problem type:', error);
                    }
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
            const token = this.getCookieValue('auth_token');
            const response = await fetch(`/api/dashboard/problem/${problemId}/feedback-resolved`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
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
                return false; // Ticketing belum ada
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.success && data.data; // Return true jika ada ticketing
        } catch (error) {
            console.error('Error checking ticketing:', error);
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
                    option.value = technician;
                    option.textContent = technician;
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
            const formData = new FormData(form);
            
            // Convert form data to JSON
            const data = {};
            for (let [key, value] of formData.entries()) {
                // Abaikan field waktu manual yang kini diatur otomatis oleh sistem
                if (key === 'problem_received_at' || key === 'repair_completed_at') continue;
                data[key] = value;
            }
            
            // Validate required fields
            if (!data.pic_technician || !data.diagnosis || !data.result_repair) {
                this.showSweetAlert('warning', 'Validasi Error', 'Mohon isi semua field yang wajib diisi');
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
    dashboardManager = new DashboardManager();
    
    // Request notification permission on load (for browser notifications as backup)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});