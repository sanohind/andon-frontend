document.addEventListener('DOMContentLoaded', () => {
    const addForm = document.getElementById('addTableForm');
    const tableBody = document.querySelector('#tablesTable tbody');

    // Handle Add Form
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = addForm.querySelector('[name="name"]').value;
        try {
            const response = await fetch('/api/inspect-tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
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
            const newName = prompt('Masukkan nama baru:', currentName);
            if (newName && newName !== currentName) {
                try {
                    const response = await fetch(`/api/inspect-tables/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName }),
                    });
                    if (!response.ok) throw new Error('Gagal mengupdate meja.');
                    alert('Meja berhasil diupdate!');
                    row.cells[0].textContent = newName;
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
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