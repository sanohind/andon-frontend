document.addEventListener('DOMContentLoaded', () => {
    const addForm = document.getElementById('addTableForm');
    const tableBody = document.querySelector('#tablesTable tbody');

    // Elements for Edit Modal
    const editModal = document.getElementById('editTableModal');
    const editForm = document.getElementById('editTableForm');
    const editId = document.getElementById('editTableId');
    const editName = document.getElementById('editTableName');
    const editLine = document.getElementById('editLineName');
    const cancelEditBtn = document.getElementById('cancelEditTable');
    const cancelEditFooterBtn = document.getElementById('cancelEditTableFooter');

    function openEditModal(id, name, lineName) {
        editId.value = id;
        editName.value = name;
        editLine.value = lineName || '';
        editModal.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
    }

    cancelEditBtn.addEventListener('click', closeEditModal);
    if (cancelEditFooterBtn) cancelEditFooterBtn.addEventListener('click', closeEditModal);
    window.addEventListener('click', (e) => {
        if (e.target === editModal) closeEditModal();
    });

    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editId.value;
        const name = editName.value.trim();
        const lineName = editLine.value;
        if (!name || !lineName) return;
        try {
            const response = await fetch(`/api/inspect-tables/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, line_name: lineName }),
            });
            if (!response.ok) throw new Error('Gagal mengupdate meja.');
            closeEditModal();
            location.reload();
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });

    // Handle Add Form
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = addForm.querySelector('[name="name"]').value;
        const lineName = addForm.querySelector('[name="line_name"]').value;
        try {
            const response = await fetch('/api/inspect-tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, line_name: lineName }),
            });
            if (!response.ok) throw new Error('Gagal menambah meja.');
            alert('Meja baru berhasil ditambahkan!');
            location.reload(); // Reload halaman untuk melihat perubahan
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });

    // Handle Edit and Delete Buttons
    tableBody.addEventListener('click', async (e) => {
        const target = e.target;
        const row = target.closest('tr');
        const id = row.dataset.id;

        if (target.classList.contains('btn-edit')) {
            const currentName = row.cells[0].textContent;
            const currentLine = row.dataset.line; // Ambil line dari data-attribute
            openEditModal(id, currentName, currentLine);
        }

        if (target.classList.contains('btn-delete')) {
            if (confirm('Apakah Anda yakin ingin menghapus meja ini?')) {
                try {
                    const response = await fetch(`/api/inspect-tables/${id}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Gagal menghapus meja.');
                    alert('Meja berhasil dihapus!');
                    row.remove();
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        }
    });
});