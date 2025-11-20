document.addEventListener('DOMContentLoaded', () => {
    const roleSelect = document.getElementById('roleSelect');
    const divisionInput = document.getElementById('divisionInput');
    const lineNameInput = document.getElementById('lineNameInput');
    const addUserForm = document.getElementById('addUserForm');
    const userTableBody = document.querySelector('#userTable tbody');

    // Get user role from data attribute
    const userDataElement = document.getElementById('userData');
    const currentUserRole = userDataElement ? userDataElement.dataset.role : null;
    
    // Disable write operations for management role
    if (currentUserRole === 'management') {
        // Hide add form
        if (addUserForm) {
            addUserForm.closest('.form-container').style.display = 'none';
        }
        // Disable edit/delete buttons
        const editButtons = document.querySelectorAll('.btn-edit-user');
        const deleteButtons = document.querySelectorAll('.btn-delete-user');
        editButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Role management hanya dapat melihat data';
        });
        deleteButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Role management hanya dapat melihat data';
        });
    }


    // Edit Modal Elements
    const editUserModal = document.getElementById('editUserModal');
    const editUserForm = document.getElementById('editUserForm');
    const editUserId = document.getElementById('editUserId');
    const editUserName = document.getElementById('editUserName');
    const editUserUsername = document.getElementById('editUserUsername');
    const editUserPassword = document.getElementById('editUserPassword');
    const editUserRole = document.getElementById('editUserRole');
    const editUserDivision = document.getElementById('editUserDivision');
    const editUserLineName = document.getElementById('editUserLineName');
    const editUserDivisionGroup = document.getElementById('editUserDivisionGroup');
    const editUserLineGroup = document.getElementById('editUserLineGroup');
    const cancelEditUserBtn = document.getElementById('cancelEditUser');
    const cancelEditUserFooterBtn = document.getElementById('cancelEditUserFooter');

    // Load divisions and lines from API
    let divisionLineMapping = {};
    let divisions = [];

    async function loadDivisionsAndLines() {
        try {
            const response = await fetch('/api/division-lines', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to load divisions and lines');
            }
            
            const result = await response.json();
            if (result.success && result.data) {
                divisions = result.data;
                // Build mapping
                divisionLineMapping = {};
                divisions.forEach(division => {
                    divisionLineMapping[division.name] = division.lines.map(line => line.name);
                });
                
                // Populate division dropdowns
                populateDivisionDropdowns();
            }
        } catch (error) {
            console.error('Error loading divisions and lines:', error);
            // Fallback to empty mapping if API fails
            divisionLineMapping = {};
        }
    }

    function populateDivisionDropdowns() {
        // Populate add form division dropdown
        const divisionInput = document.getElementById('divisionInput');
        if (divisionInput) {
            const currentValue = divisionInput.value;
            divisionInput.innerHTML = '<option value="">Pilih Divisi</option>';
            divisions.forEach(division => {
                const option = document.createElement('option');
                option.value = division.name;
                option.textContent = division.name;
                if (currentValue === division.name) {
                    option.selected = true;
                }
                divisionInput.appendChild(option);
            });
        }
        
        // Populate edit form division dropdown
        const editUserDivision = document.getElementById('editUserDivision');
        if (editUserDivision) {
            const currentValue = editUserDivision.value;
            editUserDivision.innerHTML = '<option value="">Pilih Divisi</option>';
            divisions.forEach(division => {
                const option = document.createElement('option');
                option.value = division.name;
                option.textContent = division.name;
                if (currentValue === division.name) {
                    option.selected = true;
                }
                editUserDivision.appendChild(option);
            });
        }
    }

    function updateLineOptions(divisionSelect, lineSelect) {
        const selectedDivision = divisionSelect.value;
        lineSelect.innerHTML = '<option value="">Pilih Line</option>';
        
        if (selectedDivision && divisionLineMapping[selectedDivision]) {
            divisionLineMapping[selectedDivision].forEach(line => {
                const option = document.createElement('option');
                option.value = line;
                option.textContent = line;
                lineSelect.appendChild(option);
            });
        }
    }

    // Load divisions and lines on page load
    loadDivisionsAndLines();
    
    // Listen for divisions updated event from manage-lines page
    window.addEventListener('divisionsUpdated', () => {
        console.log('Divisions updated event received, reloading divisions and lines...');
        loadDivisionsAndLines();
    });
    
    // Listen for localStorage changes (cross-tab communication)
    window.addEventListener('storage', (e) => {
        if (e.key === 'divisionsUpdated') {
            console.log('Divisions updated in another tab, reloading divisions and lines...');
            loadDivisionsAndLines();
        }
    });
    
    // Check localStorage periodically for updates (fallback)
    let lastDivisionsUpdate = null;
    setInterval(() => {
        const lastUpdate = localStorage.getItem('divisionsUpdated');
        if (lastUpdate && (!lastDivisionsUpdate || parseInt(lastUpdate) > lastDivisionsUpdate)) {
            lastDivisionsUpdate = parseInt(lastUpdate);
            console.log('Divisions updated detected, reloading divisions and lines...');
            loadDivisionsAndLines();
        }
    }, 2000);

    function openEditUserModal(user) {
        editUserId.value = user.id;
        editUserName.value = user.name || '';
        editUserUsername.value = user.username || '';
        editUserPassword.value = '';
        editUserRole.value = user.role || '';
        editUserDivision.value = user.division || '';
        
        // Show/hide division and line groups based on role
        const showDivision = user.role === 'manager' || user.role === 'leader';
        editUserDivisionGroup.style.display = showDivision ? 'block' : 'none';
        editUserLineGroup.style.display = (user.role === 'leader') ? 'block' : 'none';
        
        // Update line options based on division
        if (showDivision) {
            updateLineOptions(editUserDivision, editUserLineName);
        }
        
        editUserLineName.value = user.line_name || '';
        editUserLineName.required = (user.role === 'leader');
        editUserModal.classList.add('show');
    }

    function closeEditUserModal() {
        editUserModal.classList.remove('show');
    }

    cancelEditUserBtn.addEventListener('click', closeEditUserModal);
    if (cancelEditUserFooterBtn) cancelEditUserFooterBtn.addEventListener('click', closeEditUserModal);
    window.addEventListener('click', (e) => {
        if (e.target === editUserModal) closeEditUserModal();
    });

    // Role change handler for edit modal
    editUserRole.addEventListener('change', () => {
        const showDivision = editUserRole.value === 'manager' || editUserRole.value === 'leader';
        editUserDivisionGroup.style.display = showDivision ? 'block' : 'none';
        editUserLineGroup.style.display = (editUserRole.value === 'leader') ? 'block' : 'none';
        editUserLineName.required = (editUserRole.value === 'leader');
        
        if (showDivision) {
            updateLineOptions(editUserDivision, editUserLineName);
        }
    });

    // Division change handler for edit modal
    editUserDivision.addEventListener('change', () => {
        updateLineOptions(editUserDivision, editUserLineName);
    });

    // Role change handler for add form
    roleSelect.addEventListener('change', () => {
        const showDivision = roleSelect.value === 'manager' || roleSelect.value === 'leader';
        divisionInput.style.display = showDivision ? 'block' : 'none';
        lineNameInput.style.display = (roleSelect.value === 'leader') ? 'block' : 'none';
        divisionInput.required = showDivision;
        lineNameInput.required = (roleSelect.value === 'leader');
        
        if (showDivision) {
            updateLineOptions(divisionInput, lineNameInput);
        }
    });

    // Division change handler for add form
    divisionInput.addEventListener('change', () => {
        updateLineOptions(divisionInput, lineNameInput);
    });

    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(addUserForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Gagal menambah user.');

            alert('User berhasil ditambahkan!');
            location.reload();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });

    // Handle edit/delete buttons
    userTableBody.addEventListener('click', async (e) => {
        const target = e.target;
        // Get the button element if clicked on icon
        const button = target.closest('.btn-edit-user, .btn-delete-user') || target;
        const row = button.closest('tr');
        if (!row) return;
        const id = row.dataset.id;

        if (button.classList.contains('btn-edit-user')) {
            const user = {
                id,
                name: row.cells[0].textContent,
                username: row.cells[1].textContent,
                role: row.cells[2].textContent,
                division: row.dataset.division || '',
                line_name: row.dataset.line || ''
            };
            openEditUserModal(user);
        }

        if (button.classList.contains('btn-delete-user')) {
            if (!confirm('Apakah Anda yakin ingin menghapus user ini?')) return;
            try {
                console.log('Deleting user with ID:', id);
                const response = await fetch(`/api/users/${id}`, { 
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                console.log('Delete response status:', response.status);
                const result = await response.json();
                console.log('Delete response data:', result);
                if (!response.ok) throw new Error(result.message || 'Gagal menghapus user.');
                row.remove();
                alert('User berhasil dihapus.');
            } catch (error) {
                console.error('Delete error:', error);
                alert(`Error: ${error.message}`);
            }
        }
    });

    // Submit edit user
    editUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editUserId.value;
        const payload = {
            name: editUserName.value,
            username: editUserUsername.value,
            role: editUserRole.value,
            division: (editUserRole.value === 'manager' || editUserRole.value === 'leader') ? editUserDivision.value : null,
            line_name: editUserRole.value === 'leader' ? editUserLineName.value : null,
        };
        if (editUserPassword.value) payload.password = editUserPassword.value;

        try {
            console.log('Updating user with ID:', id);
            console.log('Update payload:', payload);
            const response = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
            });
            console.log('Update response status:', response.status);
            const result = await response.json();
            console.log('Update response data:', result);
            if (!response.ok) throw new Error(result.message || 'Gagal mengupdate user.');
            closeEditUserModal();
            location.reload();
        } catch (error) {
            console.error('Update error:', error);
            alert(`Error: ${error.message}`);
        }
    });
});
