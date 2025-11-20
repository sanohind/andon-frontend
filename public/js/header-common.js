// Common Header JavaScript for all pages
class HeaderManager {
    constructor() {
        this.socket = null;
        this.socketConnected = false;
        this.nodeRedStatus = 'unknown';
        this.init();
    }

    init() {
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
        this.initSocket();
        this.checkNodeRedStatus();
        setInterval(() => this.checkNodeRedStatus(), 10000);
    }

    updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const timeElement = document.getElementById('currentTime');
        if (timeElement) {
            timeElement.textContent = timeString;
        }
    }

    initSocket() {
        this.socket = io({
            auth: {
                token: this.getAuthToken()
            }
        });

        this.socket.on('connect', () => {
            this.socketConnected = true;
            this.refreshCompositeConnectionStatus();
        });

        this.socket.on('disconnect', () => {
            this.socketConnected = false;
            this.refreshCompositeConnectionStatus();
        });
    }

    getAuthToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'auth_token') {
                return value;
            }
        }
        return null;
    }

    updateConnectionStatus(connected, statusClass = null, statusText = null, statusIcon = null) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            if (statusClass && statusText && statusIcon) {
                statusElement.className = statusClass;
                statusElement.innerHTML = `<i class="${statusIcon}"></i><span>${statusText}</span>`;
            } else {
                if (connected) {
                    statusElement.className = 'connection-status';
                    statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Connected</span>';
                } else {
                    statusElement.className = 'connection-status disconnected';
                    statusElement.innerHTML = '<i class="fas fa-wifi"></i><span>Disconnected</span>';
                }
            }
        }
    }

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

    async checkNodeRedStatus() {
        try {
            const token = this.getAuthToken();
            const response = await fetch('/api/plc-status', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const result = await response.json();
            if (result && result.success && Array.isArray(result.data)) {
                const nodeRedDevices = result.data.filter(d => d.device_id.includes('NODE_RED_PI'));
                
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
}

// Initialize header manager when DOM is ready
let headerManager;
document.addEventListener('DOMContentLoaded', () => {
    headerManager = new HeaderManager();
});

