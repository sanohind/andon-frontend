// Global helper functions
function getCookieValue(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function getAuthHeaders() {
    const token = getCookieValue('auth_token');
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('plc-monitoring-content');
    
    // Get user role from data attribute
    const userDataElement = document.getElementById('userData');
    const currentUserRole = userDataElement ? userDataElement.dataset.role : null;
    
    // Disable write operations for management role
    if (currentUserRole === 'management') {
        // Hide add device form if exists
        const addDeviceForm = document.getElementById('addDeviceForm');
        if (addDeviceForm) {
            addDeviceForm.closest('.form-container').style.display = 'none';
        }
        // Disable edit/delete buttons will be handled in createTableRow function
    }
    let refreshInterval;

    // Function to determine device status based on smart logic
    function determineDeviceStatus(device) {
        const now = new Date();
        const lastSeen = new Date(device.last_seen);
        const timeDiff = (now - lastSeen) / 1000 / 60; // difference in minutes

        // Check if device is NODE_RED_PI and last_seen > 1 minute
        if (device.device_id === 'NODE_RED_PI' && timeDiff > 1) {
            return {
                status: 'OFFLINE',
                class: 'offline',
                isOffline: true
            };
        }

        // Check if device is PLC and last_seen > 1 minute
        if (device.device_id.startsWith('PLC') && timeDiff > 1) {
            return {
                status: 'OFFLINE',
                class: 'offline',
                isOffline: true
            };
        }

        // Check if status from database is OFFLINE
        if (device.status === 'OFFLINE') {
            return {
                status: 'OFFLINE',
                class: 'offline',
                isOffline: true
            };
        }

        // Default to online status
        return {
            status: device.status,
            class: 'online',
            isOffline: false
        };
    }

    // Function to format last seen time
    function formatLastSeen(lastSeen) {
        const now = new Date();
        const time = new Date(lastSeen);
        const diffMs = now - time;
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);

        if (diffMins > 0) {
            return `${diffMins}m ${diffSecs}s ago`;
        } else {
            return `${diffSecs}s ago`;
        }
    }

    // Function to create table row
    function createTableRow(device) {
        const deviceStatus = determineDeviceStatus(device);
        const lastSeenFormatted = formatLastSeen(device.last_seen);
        const isManagement = currentUserRole === 'management';
        const disabledAttr = isManagement ? 'disabled style="opacity: 0.5; cursor: not-allowed;" title="Role management hanya dapat melihat data"' : '';
        
        return `
            <tr style="${deviceStatus.isOffline ? 'background-color: #fff5f5;' : 'background-color: #f0fff4;'}">
                <td>
                    <div class="device-id">${device.device_id}</div>
                </td>
                <td>
                    <div class="device-name">${device.device_name || 'N/A'}</div>
                </td>
                <td class="status-cell">
                    <span class="status-badge ${deviceStatus.class}" 
                          title="${device.details || 'No additional details'}"
                          data-toggle="tooltip">
                        ${deviceStatus.status}
                    </span>
                </td>
                <td>
                    <div class="last-seen">${lastSeenFormatted}</div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-edit btn-sm" onclick="editDevice(${device.id})" title="Edit Device" ${disabledAttr}>
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-delete btn-sm" onclick="deleteDevice(${device.id}, '${device.device_id}')" title="Delete Device" ${disabledAttr}>
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // Function to update the UI with device data
    function updateUI(devices) {
        if (!devices || devices.length === 0) {
            content.innerHTML = `
                <div class="error">
                    <i class="fas fa-exclamation-triangle"></i>
                    No device data available
                </div>
            `;
            return;
        }

        // Apply search filter
        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        filteredDevices = devices.filter(device => {
            const deviceId = (device.device_id || '').toLowerCase();
            const deviceName = (device.device_name || '').toLowerCase();
            const status = (device.status || '').toLowerCase();
            const details = (device.details || '').toLowerCase();
            
            return deviceId.includes(searchTerm) || 
                   deviceName.includes(searchTerm) || 
                   status.includes(searchTerm) || 
                   details.includes(searchTerm);
        });

        // Apply sorting
        filteredDevices.sort((a, b) => {
            let aValue = a[sortField] || '';
            let bValue = b[sortField] || '';
            
            // Handle special cases
            if (sortField === 'last_seen') {
                aValue = new Date(aValue);
                bValue = new Date(bValue);
            } else {
                aValue = aValue.toString().toLowerCase();
                bValue = bValue.toString().toLowerCase();
            }
            
            if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        const tableHTML = `
            <div class="table-info">
                Showing ${filteredDevices.length} of ${devices.length} devices
                ${searchTerm ? `(filtered by "${searchTerm}")` : ''}
            </div>
            <table class="plc-table">
                <thead>
                    <tr>
                        <th onclick="sortBy('device_id')" class="sortable">
                            Device ID <i class="fas fa-sort"></i>
                        </th>
                        <th onclick="sortBy('device_name')" class="sortable">
                            Device Name <i class="fas fa-sort"></i>
                        </th>
                        <th onclick="sortBy('status')" class="sortable">
                            Status <i class="fas fa-sort"></i>
                        </th>
                        <th onclick="sortBy('last_seen')" class="sortable">
                            Last Seen <i class="fas fa-sort"></i>
                        </th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredDevices.map(device => createTableRow(device)).join('')}
                </tbody>
            </table>
        `;

        content.innerHTML = tableHTML;

        // Initialize tooltips
        const tooltips = document.querySelectorAll('[data-toggle="tooltip"]');
        tooltips.forEach(element => {
            element.addEventListener('mouseenter', function() {
                this.setAttribute('title', this.getAttribute('title'));
            });
        });
    }

    // Function to fetch PLC status from API
    async function fetchPlcStatus() {
        try {
            const response = await fetch('/api/plc-status', {
                headers: getAuthHeaders()
            });
            
            const result = await response.json();

            if (result.success) {
                currentDevices = result.data; // Store devices globally
                updateUI(result.data);
            } else {
                content.innerHTML = `
                    <div class="error">
                        <i class="fas fa-exclamation-triangle"></i>
                        Error: ${result.message}
                    </div>
                `;
            }
        } catch (error) {
            content.innerHTML = `
                <div class="error">
                    <i class="fas fa-exclamation-triangle"></i>
                    Error: Cannot connect to the server
                </div>
            `;
        }
    }

    // Expose fetch function to global scope for CRUD handlers
    window.fetchPlcStatus = fetchPlcStatus;

    // Function to start auto-refresh
    function startAutoRefresh() {
        // Clear any existing interval
        if (refreshInterval) {
            clearInterval(refreshInterval);
        }

        // Fetch immediately
        fetchPlcStatus();

        // Set up interval for every 10 seconds
        refreshInterval = setInterval(fetchPlcStatus, 5000);
    }

    // Function to stop auto-refresh
    function stopAutoRefresh() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }

    // Start the monitoring
    startAutoRefresh();

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopAutoRefresh();
    });

    // Optional: Add manual refresh button functionality
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
            e.preventDefault();
            fetchPlcStatus();
        }
    });
});

// Global variables for CRUD operations
let currentDevices = [];
let deviceToDelete = null;
let filteredDevices = [];
let sortField = 'device_id';
let sortOrder = 'asc';

// CRUD Functions
async function openAddDeviceModal() {
    document.getElementById('modalTitle').textContent = 'Add New Device';
    document.getElementById('deviceForm').reset();
    document.getElementById('deviceId').value = '';
    
    // Load inspection tables and reset selection
    selectedTableAddresses = [];
    await loadInspectionTables();
    renderSelectedTables();
    
    document.getElementById('deviceModal').style.display = 'flex';
}

async function editDevice(deviceId) {
    const device = currentDevices.find(d => d.id == deviceId);
    if (!device) {
        alert('Device not found');
        return;
    }

    document.getElementById('modalTitle').textContent = 'Edit Device';
    document.getElementById('deviceId').value = device.id;
    document.getElementById('deviceIdInput').value = device.device_id;
    document.getElementById('deviceNameInput').value = device.device_name || '';
    document.getElementById('statusSelect').value = device.status;
    document.getElementById('detailsInput').value = device.details || '';
    
    // Load inspection tables and initialize selection
    await loadInspectionTables();
    initializeSelectedTables(device.controlled_tables || '');
    
    document.getElementById('deviceModal').style.display = 'flex';
}

function deleteDevice(deviceId, deviceName) {
    deviceToDelete = deviceId;
    document.getElementById('deleteDeviceName').textContent = deviceName;
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeviceModal() {
    document.getElementById('deviceModal').style.display = 'none';
    document.getElementById('deviceForm').reset();
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    deviceToDelete = null;
}

async function saveDevice() {
    const form = document.getElementById('deviceForm');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    // Remove empty fields
    Object.keys(data).forEach(key => {
        if (data[key] === '') {
            delete data[key];
        }
    });

    try {
        const isEdit = data.id && data.id !== '';
        const url = isEdit 
            ? `/api/plc-status/${data.id}`
            : '/api/plc-status';
        
        const method = isEdit ? 'PUT' : 'POST';
        
        // Add controlled_tables from selected table addresses
        data.controlled_tables = JSON.stringify(selectedTableAddresses);
        
        const response = await fetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            closeDeviceModal();
            fetchPlcStatus(); // Refresh the list
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error saving device:', error);
        alert('Error saving device: ' + error.message);
    }
}

async function confirmDelete() {
    if (!deviceToDelete) return;

    try {
        const response = await fetch(`/api/plc-status/${deviceToDelete}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            closeDeleteModal();
            fetchPlcStatus(); // Refresh the list
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Error deleting device:', error);
        alert('Error deleting device: ' + error.message);
    }
}

// Search and Sort Functions
function filterDevices() {
    updateUI(currentDevices);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    updateUI(currentDevices);
}

function sortDevices() {
    const sortSelect = document.getElementById('sortSelect');
    sortField = sortSelect.value;
    updateUI(currentDevices);
}

function sortBy(field) {
    if (sortField === field) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        sortField = field;
        sortOrder = 'asc';
    }
    
    // Update sort select
    document.getElementById('sortSelect').value = field;
    
    // Update sort icon
    updateSortIcon();
    
    updateUI(currentDevices);
}

function toggleSortOrder() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    updateSortIcon();
    updateUI(currentDevices);
}

function updateSortIcon() {
    const sortIcon = document.getElementById('sortIcon');
    if (sortOrder === 'asc') {
        sortIcon.className = 'fas fa-sort-amount-up';
        sortIcon.parentElement.classList.remove('desc');
        sortIcon.parentElement.classList.add('asc');
    } else {
        sortIcon.className = 'fas fa-sort-amount-down';
        sortIcon.parentElement.classList.remove('asc');
        sortIcon.parentElement.classList.add('desc');
    }
}

// Global variables for multi-select
let allInspectionTables = [];
let selectedTableAddresses = [];

// Load inspection tables when modal opens
async function loadInspectionTables() {
    console.log('Loading inspection tables...');
    try {
        const response = await fetch('/api/inspection-tables');
        console.log('Response status:', response.status);
        const result = await response.json();
        console.log('API result:', result);
        
        if (result.success) {
            allInspectionTables = result.data;
            console.log('Loaded tables:', allInspectionTables);
            renderTableOptions();
            return allInspectionTables;
        } else {
            console.error('Failed to load inspection tables:', result.message);
            document.getElementById('tableOptions').innerHTML = '<div class="loading-tables">Failed to load tables: ' + result.message + '</div>';
        }
    } catch (error) {
        console.error('Error loading inspection tables:', error);
        document.getElementById('tableOptions').innerHTML = '<div class="loading-tables">Error loading tables: ' + error.message + '</div>';
    }
    return [];
}

// Render table options
function renderTableOptions() {
    console.log('Rendering table options...');
    const container = document.getElementById('tableOptions');
    if (!container) {
        console.error('tableOptions container not found');
        return;
    }
    
    const searchTerm = document.getElementById('tableSearchInput').value.toLowerCase();
    console.log('Search term:', searchTerm);
    console.log('All tables:', allInspectionTables);
    
    const filteredTables = allInspectionTables.filter(table => 
        table.name.toLowerCase().includes(searchTerm) ||
        (table.line_name && table.line_name.toLowerCase().includes(searchTerm)) ||
        (table.address && table.address.toLowerCase().includes(searchTerm))
    );
    
    console.log('Filtered tables:', filteredTables);
    
    if (filteredTables.length === 0) {
        container.innerHTML = '<div class="loading-tables">No tables found</div>';
        return;
    }
    
    container.innerHTML = filteredTables.map(table => {
        const tableAddress = (table.address || '').toString();
        const isSelected = tableAddress && selectedTableAddresses.includes(tableAddress);
        const safeAddress = tableAddress.replace(/'/g, "\\'");
        return `
            <div class="table-option ${isSelected ? 'selected' : ''}" 
                 onclick="toggleTableSelection('${safeAddress}')">
                <input type="checkbox" ${isSelected ? 'checked' : ''} 
                       onchange="toggleTableSelection('${safeAddress}')">
                <div class="table-option-info">
                    <div class="table-option-name">${table.name}</div>
                    <div class="table-option-details">
                        Line: ${table.line_name || 'N/A'} | Division: ${table.division || 'N/A'} | Address: ${table.address}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Toggle table selection
function toggleTableSelection(tableAddress) {
    if (!tableAddress) return;
    const index = selectedTableAddresses.indexOf(tableAddress);
    if (index > -1) {
        selectedTableAddresses.splice(index, 1);
    } else {
        selectedTableAddresses.push(tableAddress);
    }
    renderTableOptions();
    renderSelectedTables();
}

// Render selected tables
function renderSelectedTables() {
    const container = document.getElementById('selectedList');
    if (selectedTableAddresses.length === 0) {
        container.innerHTML = '<span style="color: #999; font-style: italic;">No tables selected</span>';
        return;
    }
    
    container.innerHTML = selectedTableAddresses.map(address => {
        const tableInfo = allInspectionTables.find(table => table.address === address);
        const displayName = tableInfo ? tableInfo.name : address;
        const safeAddress = (address || '').replace(/'/g, "\\'");
        return `
        <div class="selected-item">
            ${displayName}
            <button type="button" class="remove-btn" onclick="removeTableSelection('${safeAddress}')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        `;
    }).join('');
}

// Remove table selection
function removeTableSelection(tableAddress) {
    if (!tableAddress) return;
    const index = selectedTableAddresses.indexOf(tableAddress);
    if (index > -1) {
        selectedTableAddresses.splice(index, 1);
        renderTableOptions();
        renderSelectedTables();
    }
}

// Filter tables based on search
function filterTables() {
    renderTableOptions();
}

// Clear table search
function clearTableSearch() {
    document.getElementById('tableSearchInput').value = '';
    renderTableOptions();
}

// Initialize selected tables from JSON
function initializeSelectedTables(jsonString) {
    selectedTableAddresses = [];
    if (jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed)) {
                const resolved = parsed.map(value => resolveTableAddress(value)).filter(Boolean);
                selectedTableAddresses = Array.from(new Set(resolved));
            }
        } catch (e) {
            console.warn('Failed to parse controlled_tables JSON:', e);
        }
    }
    renderTableOptions();
    renderSelectedTables();
}

function resolveTableAddress(value) {
    if (!value) return null;
    if (typeof value === 'object') {
        if (value.address) return value.address;
        if (value.name) return findAddressByName(value.name);
        return null;
    }
    const stringValue = value.toString().trim();
    if (!stringValue) return null;
    const matchByAddress = allInspectionTables.find(table => table.address === stringValue);
    if (matchByAddress) return matchByAddress.address;
    return findAddressByName(stringValue);
}

function findAddressByName(name) {
    const table = allInspectionTables.find(table => table.name === name);
    return table ? table.address : null;
}
