// Divisions & Lines Selection Page JavaScript

class DivisionsManager {
    constructor() {
        this.socket = null;
        this.updateInterval = null;
        this.socketConnected = false;
        this.nodeRedStatus = 'unknown'; // Track Node-RED status: 'all_online', 'partial_offline', 'all_offline', 'unknown'
        
        // User data
        const userDataElement = document.getElementById('userData');
        this.userRole = userDataElement ? userDataElement.dataset.role : null;
        this.userLineName = userDataElement ? userDataElement.dataset.line : null;
        this.userDivision = userDataElement ? userDataElement.dataset.division : null;
        
        // Problem tracking for manager notifications
        this.problemStartTimes = new Map(); // Track when problems started for 15-minute notification
        this.sentLongDurationNotifications = new Set(); // Track which problems already got 15-min notification
        
        // Alert sound
        this.alertSound = null;
        this.initAlertSound();
        
        this.init();
    }

    init() {
        this.loadDivisions();
        this.initSocketForDivisions();
        this.startAutoRefresh();
        
        // For manager, maintenance, quality, engineering: check active problems and setup notifications
        // Load active problems after divisions are loaded to avoid blocking
        if (['manager', 'maintenance', 'quality', 'engineering'].includes(this.userRole)) {
            // Delay loadActiveProblems to ensure loadDivisions completes first
            setTimeout(() => {
                this.loadActiveProblems().catch(err => {
                    console.error('Error in initial loadActiveProblems:', err);
                });
            }, 1000);
            // Check active problems every 30 seconds
            setInterval(() => {
                this.loadActiveProblems().catch(err => {
                    console.error('Error in periodic loadActiveProblems:', err);
                });
            }, 30000);
        }
        
        // Listen for divisions updated event from manage-lines page
        window.addEventListener('divisionsUpdated', () => {
            console.log('Divisions updated event received, reloading divisions...');
            this.loadDivisions();
        });
        
        // Listen for localStorage changes (cross-tab communication)
        window.addEventListener('storage', (e) => {
            if (e.key === 'divisionsUpdated') {
                console.log('Divisions updated in another tab, reloading divisions...');
                this.loadDivisions();
            }
        });
        
        // Check localStorage periodically for updates (fallback)
        setInterval(() => {
            const lastUpdate = localStorage.getItem('divisionsUpdated');
            if (lastUpdate && (!this.lastDivisionsUpdate || parseInt(lastUpdate) > this.lastDivisionsUpdate)) {
                this.lastDivisionsUpdate = parseInt(lastUpdate);
                console.log('Divisions updated detected, reloading divisions...');
                this.loadDivisions();
            }
        }, 2000);
    }
    
    initAlertSound() {
        // Use audio element from HTML if available, otherwise create new one
        try {
            const audioElement = document.getElementById('alertSound');
            if (audioElement) {
                this.alertSound = audioElement;
            } else {
                // Fallback: create new audio element
                this.alertSound = new Audio('/audio/alert.mp3');
                this.alertSound.volume = 0.7;
                this.alertSound.preload = 'auto';
                this.alertSound.load().catch(e => console.log('Could not load alert sound:', e));
            }
        } catch (e) {
            console.log('Could not initialize alert sound:', e);
            this.alertSound = null;
        }
    }
    
    playAlertSound() {
        if (this.alertSound) {
            try {
                // Reset to start and play
                if (this.alertSound.currentTime !== undefined) {
                    this.alertSound.currentTime = 0;
                }
                this.alertSound.play().catch(e => console.log('Could not play alert sound:', e));
            } catch (error) {
                console.log('Alert sound not available:', error);
            }
        }
    }


    async loadDivisions() {
        try {
            console.log('Loading divisions...');
            const response = await fetch('/api/divisions-lines', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Failed to fetch divisions:', response.status, errorText);
                throw new Error(`Failed to fetch divisions and lines: ${response.status}`);
            }

            const result = await response.json();
            console.log('Divisions data received:', result);
            
            if (result.success && result.data) {
                this.renderDivisions(result.data);
            } else {
                console.error('Invalid response format:', result);
                this.showError('Gagal memuat data divisi dan line');
            }
        } catch (error) {
            console.error('Error loading divisions:', error);
            this.showError(`Terjadi kesalahan saat memuat data: ${error.message}`);
        }
    }

    renderDivisions(divisions) {
        const container = document.getElementById('divisionsContainer');
        
        if (!divisions || divisions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>Tidak ada data divisi dan line</p>
                </div>
            `;
            return;
        }

        const divisionsHTML = divisions.map(division => {
            // Hitung agregat per divisi
            const totals = division.lines.reduce((acc, line) => {
                acc.total_machines += Number(line.total_machines || 0);
                acc.active_problems += Number(line.active_problems || 0);
                return acc;
            }, { total_machines: 0, active_problems: 0 });

            const linesHTML = division.lines.map(line => {
                const hasProblems = line.active_problems > 0;
                const problemIndicatorColor = hasProblems ? 'red' : 'gray';
                const runningCount = line.running_count || 0;
                const idleCount = line.idle_count || 0;
                return `
                    <div class="line-card" data-line="${line.name}" onclick="divisionsManager.navigateToDashboard('${line.name}')">
                        <div class="line-header">
                            <div class="line-title-wrapper">
                                <h3 class="line-name">${line.name}</h3>
                                <div class="line-stats-header">
                                    <div class="line-stat-item">
                                        <span class="line-stat-label">Total Mesin</span>
                                        <span class="line-stat-value">${line.total_machines}</span>
                                    </div>
                                </div>
                            </div>
                            <i class="fas fa-arrow-right line-arrow"></i>
                        </div>
                        <div class="line-stats">
                            <div class="stat-item">
                                <div class="stat-label-wrapper">
                                    <div class="stat-indicator running"></div>
                                    <span class="stat-label">Running</span>
                                </div>
                                <span class="stat-value running-value">${runningCount}</span>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label-wrapper">
                                    <div class="stat-indicator idle"></div>
                                    <span class="stat-label">Idle</span>
                                </div>
                                <span class="stat-value idle-value">${idleCount}</span>
                            </div>
                            <div class="stat-item ${hasProblems ? 'has-problem-highlight' : ''}">
                                <div class="stat-label-wrapper">
                                    <div class="stat-indicator ${problemIndicatorColor}"></div>
                                    <span class="stat-label">Problem Aktif</span>
                                </div>
                                <span class="stat-value problems ${hasProblems ? 'has-problems' : ''}">${line.active_problems}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="division-card">
                    <div class="division-header">
                        <h2 class="division-title">${division.name}</h2>
                        <div class="division-stats">
                            <div class="division-stat-item">
                                <span class="division-stat-label">Total Mesin</span>
                                <span class="division-stat-value">${totals.total_machines}</span>
                            </div>
                            <div class="division-stat-item">
                                <span class="division-stat-label">Problem Aktif</span>
                                <span class="division-stat-value problems ${totals.active_problems > 0 ? 'has-problems' : ''}">${totals.active_problems}</span>
                            </div>
                        </div>
                        <i class="fas fa-industry division-icon"></i>
                    </div>
                    <div class="lines-container">
                        ${linesHTML}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="divisions-grid">
                ${divisionsHTML}
            </div>
        `;
    }

    navigateToDashboard(lineName) {
        // Redirect to dashboard with line filter
        window.location.href = `/?line=${encodeURIComponent(lineName)}`;
    }

    showError(message) {
        const container = document.getElementById('divisionsContainer');
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${message}</p>
                <button onclick="divisionsManager.loadDivisions()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: var(--primary-color); color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Coba Lagi
                </button>
            </div>
        `;
    }

    // Socket connection for divisions updates (separate from header socket)
    initSocketForDivisions() {
        if (!this.socket) {
            this.socket = io({
                auth: {
                    token: this.getAuthToken()
                }
            });
        }

        // Listen for division/line updates
        this.socket.on('divisionsUpdated', (data) => {
            this.loadDivisions();
        });
        
        // Listen for forwarded problem notifications (for maintenance, quality, engineering)
        if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
            this.socket.on('problemForwarded', (data) => {
                console.log('📧 Received problemForwarded via socket:', data);
                this.showForwardedProblemNotification(data);
            });
        }
    }

    getAuthToken() {
        // Get token from cookie
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'auth_token') {
                return value;
            }
        }
        return null;
    }

    getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }


    startAutoRefresh() {
        // Refresh data every 30 seconds
        this.updateInterval = setInterval(() => {
            this.loadDivisions();
        }, 30000);
    }
    
    // Load active problems for manager, maintenance, quality, engineering
    async loadActiveProblems() {
        try {
            const token = this.getCookieValue('auth_token');
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            };
            
            // Add user division header for manager
            if (this.userRole === 'manager' && this.userDivision) {
                headers['X-User-Division'] = this.userDivision;
            }
            
            const response = await fetch('/api/problems/active', {
                headers: headers,
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch active problems');
            }
            
            const result = await response.json();
            
            if (result.success && Array.isArray(result.data)) {
                let filteredProblems = result.data;
                
                // Filter based on user role
                if (this.userRole === 'manager' && this.userDivision) {
                    // Manager only sees problems from their division
                    filteredProblems = result.data.filter(problem => {
                        // Filter by division lines
                        const divisionLineMapping = {
                            'Brazing': ['Leak Test Inspection', 'Support', 'Hand Bending', 'Welding'],
                            'Chassis': ['Cutting', 'Flaring', 'MF/TK', 'LRFD', 'Assy'],
                            'Nylon': ['Injection/Extrude', 'Roda Dua', 'Roda Empat']
                        };
                        const allowedLines = divisionLineMapping[this.userDivision] || [];
                        return problem.line_name && allowedLines.includes(problem.line_name);
                    });
                } else if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
                    // Department users only see forwarded problems
                    filteredProblems = result.data.filter(problem => {
                        return problem.is_forwarded && problem.forwarded_to_role === this.userRole;
                    });
                }
                
                // For manager: check long duration problems
                if (this.userRole === 'manager') {
                    this.checkLongDurationProblems(filteredProblems);
                }
            }
        } catch (error) {
            console.error('Error loading active problems:', error);
        }
    }
    
    // Method untuk mengecek problem yang sudah 15 menit (hanya untuk manager)
    checkLongDurationProblems(problems) {
        if (this.userRole !== 'manager') {
            return; // Hanya manager yang mendapat notifikasi 15 menit
        }

        const now = new Date();
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

        // Filter hanya problem dengan status 'ACTIVE' atau 'ON'
        const activeProblems = problems.filter(problem => {
            const status = problem.status || problem.problem_status || '';
            return status === 'ACTIVE' || status === 'ON';
        });

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
        
        // Play alert sound
        this.playAlertSound();
        
        Swal.fire({
            title: '⚠️ Problem Tidak Ditangani',
            html: `
                <div style="text-align: left;">
                    <p><strong>Machine:</strong> ${problem.machine_name || problem.machine || 'Unknown'}</p>
                    <p><strong>Problem Type:</strong> ${problem.problem_type || problem.tipe_problem || 'Unknown'}</p>
                    <p><strong>Line:</strong> ${problem.line_name || problem.table_line_name || 'Unknown'}</p>
                    <p><strong>Duration:</strong> ${duration}</p>
                    <p style="color: #e74c3c; font-weight: bold; margin-top: 15px;">Problem ini sudah aktif selama lebih dari 15 menit dan belum ditangani!</p>
                </div>
            `,
            icon: 'warning',
            iconColor: '#e74c3c',
            showCancelButton: true,
            confirmButtonText: 'View Detail',
            cancelButtonText: 'OK',
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#6c757d',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showClass: {
                popup: 'animate__animated animate__bounceIn'
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOut'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Redirect to dashboard with line filter
                const lineName = problem.line_name || problem.table_line_name;
                if (lineName) {
                    window.location.href = `/?line=${encodeURIComponent(lineName)}`;
                } else {
                    window.location.href = '/';
                }
            }
        });
    }
    
    // Method untuk menampilkan notifikasi forwarded problem (untuk maintenance, quality, engineering)
    showForwardedProblemNotification(data) {
        console.log(`📧 Showing forwarded problem notification for role: ${this.userRole}`);

        // Pastikan hanya department users yang sesuai yang melihat notifikasi ini
        if (['maintenance', 'quality', 'engineering'].includes(this.userRole)) {
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
                            <div style="font-size: 12px; color: #666;">From: ${data.forwarded_by || 'Leader'}</div>
                        </div>
                    </div>
                    <p><strong>Mesin:</strong> ${data.machine_name || data.machine || 'Unknown'}</p>
                    <p><strong>Problem Type:</strong> ${data.problem_type || data.tipe_problem || 'Unknown'}</p>
                    <p><strong>Line:</strong> ${data.line_name || 'N/A'}</p>
                    <p><strong>Waktu Forward:</strong> ${moment(data.timestamp || data.forwarded_at).format('DD/MM/YYYY HH:mm:ss')}</p>
                    ${data.message ? `<div style="margin-top: 15px; padding: 10px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;"><strong>Pesan:</strong><br>"${data.message}"</div>` : ''}
                </div>
            `,
            icon: 'info',
            iconColor: roleColor,
            showCancelButton: true,
            confirmButtonText: 'View Detail',
            cancelButtonText: 'OK',
            confirmButtonColor: roleColor,
            cancelButtonColor: '#6c757d',
            toast: false,
            position: 'center',
            timer: 12000,
            timerProgressBar: true,
            allowOutsideClick: false,
            allowEscapeKey: false,
            showClass: {
                popup: 'animate__animated animate__bounceIn'
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOut'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Redirect to dashboard with line filter
                const lineName = data.line_name;
                if (lineName) {
                    window.location.href = `/?line=${encodeURIComponent(lineName)}`;
                } else {
                    window.location.href = '/';
                }
            }
        });
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

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// Initialize divisions manager
let divisionsManager;
document.addEventListener('DOMContentLoaded', () => {
    divisionsManager = new DivisionsManager();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (divisionsManager) {
        divisionsManager.destroy();
    }
});

