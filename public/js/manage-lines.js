// Manage Lines JavaScript

// Get API base from current origin
const LARAVEL_API_BASE = '/api';

let divisions = [];
let allDivisions = []; // For dropdown in edit line modal

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    loadDivisions();
    setupEventListeners();
});

function updateClock() {
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

function setupEventListeners() {
    // Add Division Form
    document.getElementById('addDivisionForm').addEventListener('submit', handleAddDivision);
    
    // Edit Division Modal
    document.getElementById('closeEditDivision').addEventListener('click', closeEditDivisionModal);
    document.getElementById('cancelEditDivision').addEventListener('click', closeEditDivisionModal);
    document.getElementById('editDivisionForm').addEventListener('submit', handleUpdateDivision);
    
    // Add Line Modal
    document.getElementById('closeAddLine').addEventListener('click', closeAddLineModal);
    document.getElementById('cancelAddLine').addEventListener('click', closeAddLineModal);
    document.getElementById('addLineForm').addEventListener('submit', handleAddLine);
    
    // Edit Line Modal
    document.getElementById('closeEditLine').addEventListener('click', closeEditLineModal);
    document.getElementById('cancelEditLine').addEventListener('click', closeEditLineModal);
    document.getElementById('editLineForm').addEventListener('submit', handleUpdateLine);
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        const modals = ['editDivisionModal', 'addLineModal', 'editLineModal'];
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (e.target === modal) {
                if (modalId === 'editDivisionModal') closeEditDivisionModal();
                if (modalId === 'addLineModal') closeAddLineModal();
                if (modalId === 'editLineModal') closeEditLineModal();
            }
        });
    });
}

async function loadDivisions() {
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load divisions');
        }
        
        const result = await response.json();
        if (result.success) {
            divisions = result.data;
            allDivisions = result.data; // Store for dropdown
            renderDivisions();
        } else {
            showError('Gagal memuat data divisi dan line');
        }
    } catch (error) {
        console.error('Error loading divisions:', error);
        showError('Terjadi kesalahan saat memuat data: ' + error.message);
    }
}

function renderDivisions() {
    const container = document.getElementById('divisionsList');
    
    if (divisions.length === 0) {
        container.innerHTML = `
            <div class="empty-lines">
                <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;"></i>
                <p>Tidak ada divisi. Silakan tambah divisi baru.</p>
            </div>
        `;
        return;
    }
    
    const html = divisions.map(division => {
        const linesHtml = division.lines && division.lines.length > 0
            ? division.lines.map(line => `
                <div class="line-item">
                    <span class="line-name">${escapeHtml(line.name)}</span>
                    <div class="line-actions">
                        <button class="btn-edit-line" onclick="openEditLineModal(${line.id}, ${line.division_id}, '${escapeHtml(line.name)}')" title="Edit Line">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete-line" onclick="deleteLine(${line.id}, '${escapeHtml(line.name)}')" title="Hapus Line">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('')
            : '<div class="empty-lines">Belum ada line</div>';
        
        return `
            <div class="division-item">
                <div class="division-header-row">
                    <div class="division-title">
                        <i class="fas fa-industry"></i>
                        ${escapeHtml(division.name)}
                    </div>
                    <div class="division-actions">
                        <button class="btn-edit-division" onclick="openEditDivisionModal(${division.id}, '${escapeHtml(division.name)}')" title="Edit Divisi">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-add-line" onclick="openAddLineModal(${division.id})" title="Tambah Line">
                            <i class="fas fa-plus"></i>
                        </button>
                        <button class="btn-delete-division" onclick="deleteDivision(${division.id}, '${escapeHtml(division.name)}')" title="Hapus Divisi">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="lines-list">
                    ${linesHtml}
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

async function handleAddDivision(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const name = formData.get('name').trim();
    
    if (!name) {
        Swal.fire('Error', 'Nama divisi harus diisi', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/divisions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ name })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Divisi berhasil ditambahkan', 'success');
            e.target.reset();
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal menambahkan divisi', 'error');
        }
    } catch (error) {
        console.error('Error adding division:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat menambahkan divisi', 'error');
    }
}

function openEditDivisionModal(id, name) {
    document.getElementById('editDivisionId').value = id;
    document.getElementById('editDivisionName').value = name;
    document.getElementById('editDivisionModal').classList.add('show');
}

function closeEditDivisionModal() {
    document.getElementById('editDivisionModal').classList.remove('show');
    document.getElementById('editDivisionForm').reset();
}

async function handleUpdateDivision(e) {
    e.preventDefault();
    const id = document.getElementById('editDivisionId').value;
    const name = document.getElementById('editDivisionName').value.trim();
    
    if (!name) {
        Swal.fire('Error', 'Nama divisi harus diisi', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/divisions/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ name })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Divisi berhasil diupdate', 'success');
            closeEditDivisionModal();
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal mengupdate divisi', 'error');
        }
    } catch (error) {
        console.error('Error updating division:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat mengupdate divisi', 'error');
    }
}

async function deleteDivision(id, name) {
    const result = await Swal.fire({
        title: 'Hapus Divisi?',
        text: `Apakah Anda yakin ingin menghapus divisi "${name}"? Semua line dalam divisi ini juga akan dihapus.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Ya, Hapus',
        cancelButtonText: 'Batal'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/divisions/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Divisi berhasil dihapus', 'success');
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal menghapus divisi', 'error');
        }
    } catch (error) {
        console.error('Error deleting division:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat menghapus divisi', 'error');
    }
}

function openAddLineModal(divisionId) {
    document.getElementById('addLineDivisionId').value = divisionId;
    document.getElementById('addLineName').value = '';
    document.getElementById('addLineModal').classList.add('show');
}

function closeAddLineModal() {
    document.getElementById('addLineModal').classList.remove('show');
    document.getElementById('addLineForm').reset();
}

async function handleAddLine(e) {
    e.preventDefault();
    const divisionId = document.getElementById('addLineDivisionId').value;
    const name = document.getElementById('addLineName').value.trim();
    
    if (!name) {
        Swal.fire('Error', 'Nama line harus diisi', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/lines`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ division_id: divisionId, name })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Line berhasil ditambahkan', 'success');
            closeAddLineModal();
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal menambahkan line', 'error');
        }
    } catch (error) {
        console.error('Error adding line:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat menambahkan line', 'error');
    }
}

function openEditLineModal(id, divisionId, name) {
    document.getElementById('editLineId').value = id;
    document.getElementById('editLineName').value = name;
    
    // Populate division dropdown
    const select = document.getElementById('editLineDivisionId');
    select.innerHTML = '';
    allDivisions.forEach(div => {
        const option = document.createElement('option');
        option.value = div.id;
        option.textContent = div.name;
        option.selected = div.id == divisionId;
        select.appendChild(option);
    });
    
    document.getElementById('editLineModal').classList.add('show');
}

function closeEditLineModal() {
    document.getElementById('editLineModal').classList.remove('show');
    document.getElementById('editLineForm').reset();
}

async function handleUpdateLine(e) {
    e.preventDefault();
    const id = document.getElementById('editLineId').value;
    const divisionId = document.getElementById('editLineDivisionId').value;
    const name = document.getElementById('editLineName').value.trim();
    
    if (!name) {
        Swal.fire('Error', 'Nama line harus diisi', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/lines/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ division_id: divisionId, name })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Line berhasil diupdate', 'success');
            closeEditLineModal();
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal mengupdate line', 'error');
        }
    } catch (error) {
        console.error('Error updating line:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat mengupdate line', 'error');
    }
}

async function deleteLine(id, name) {
    const result = await Swal.fire({
        title: 'Hapus Line?',
        text: `Apakah Anda yakin ingin menghapus line "${name}"?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Ya, Hapus',
        cancelButtonText: 'Batal'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        const response = await fetch(`${LARAVEL_API_BASE}/division-lines/lines/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire('Berhasil', 'Line berhasil dihapus', 'success');
            await loadDivisions();
            // Trigger custom event to notify other pages
            window.dispatchEvent(new CustomEvent('divisionsUpdated'));
            // Also use localStorage for cross-tab communication
            localStorage.setItem('divisionsUpdated', Date.now().toString());
        } else {
            Swal.fire('Error', result.message || 'Gagal menghapus line', 'error');
        }
    } catch (error) {
        console.error('Error deleting line:', error);
        Swal.fire('Error', 'Terjadi kesalahan saat menghapus line', 'error');
    }
}

function showError(message) {
    const container = document.getElementById('divisionsList');
    container.innerHTML = `
        <div class="empty-lines">
            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem; color: #dc3545;"></i>
            <p>${escapeHtml(message)}</p>
            <button onclick="loadDivisions()" style="margin-top: 1rem; padding: 0.75rem 1.5rem; background: var(--primary-color); color: white; border: none; border-radius: var(--border-radius); cursor: pointer;">
                Coba Lagi
            </button>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

