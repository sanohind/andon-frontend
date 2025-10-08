document.addEventListener('DOMContentLoaded', () => {
    const roleSelect = document.getElementById('roleSelect');
    const lineNameInput = document.getElementById('lineNameInput');
    const addUserForm = document.getElementById('addUserForm');
    const userTableBody = document.querySelector('#userTable tbody');

    // Edit Modal Elements
    const editUserModal = document.getElementById('editUserModal');
    const editUserForm = document.getElementById('editUserForm');
    const editUserId = document.getElementById('editUserId');
    const editUserName = document.getElementById('editUserName');
    const editUserUsername = document.getElementById('editUserUsername');
    const editUserPassword = document.getElementById('editUserPassword');
    const editUserRole = document.getElementById('editUserRole');
    const editUserLineName = document.getElementById('editUserLineName');
    const editUserLineGroup = document.getElementById('editUserLineGroup');
    const cancelEditUserBtn = document.getElementById('cancelEditUser');
    const cancelEditUserFooterBtn = document.getElementById('cancelEditUserFooter');

    function openEditUserModal(user) {
        editUserId.value = user.id;
        editUserName.value = user.name || '';
        editUserUsername.value = user.username || '';
        editUserPassword.value = '';
        editUserRole.value = user.role || '';
        editUserLineName.value = user.line_name || '';
        editUserLineGroup.style.display = (user.role === 'leader') ? 'block' : 'none';
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

    editUserRole.addEventListener('change', () => {
        editUserLineGroup.style.display = (editUserRole.value === 'leader') ? 'block' : 'none';
        editUserLineName.required = (editUserRole.value === 'leader');
    });

    roleSelect.addEventListener('change', () => {
        lineNameInput.style.display = (roleSelect.value === 'leader') ? 'block' : 'none';
        lineNameInput.required = (roleSelect.value === 'leader');
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
        const row = target.closest('tr');
        if (!row) return;
        const id = row.dataset.id;

        if (target.classList.contains('btn-edit-user')) {
            const user = {
                id,
                name: row.cells[0].textContent,
                username: row.cells[1].textContent,
                role: row.cells[2].textContent,
                line_name: row.dataset.line || ''
            };
            openEditUserModal(user);
        }

        if (target.classList.contains('btn-delete-user')) {
            if (!confirm('Apakah Anda yakin ingin menghapus user ini?')) return;
            try {
                const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || 'Gagal menghapus user.');
                row.remove();
                alert('User berhasil dihapus.');
            } catch (error) {
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
            line_name: editUserRole.value === 'leader' ? editUserLineName.value : null,
        };
        if (editUserPassword.value) payload.password = editUserPassword.value;

        try {
            const response = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Gagal mengupdate user.');
            closeEditUserModal();
            location.reload();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });
});