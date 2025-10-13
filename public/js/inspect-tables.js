document.addEventListener('DOMContentLoaded', () => {
    const addForm = document.getElementById('addTableForm');
    const tableBody = document.querySelector('#tablesTable tbody');
    const divisionSelect = document.getElementById('divisionSelect');
    const lineNameSelect = document.getElementById('lineNameSelect');

    // Elements for Edit Modal
    const editModal = document.getElementById('editTableModal');
    const editForm = document.getElementById('editTableForm');
    const editId = document.getElementById('editTableId');
    const editName = document.getElementById('editTableName');
    const editDivision = document.getElementById('editDivision');
    const editLine = document.getElementById('editLineName');
    const cancelEditBtn = document.getElementById('cancelEditTable');
    const cancelEditFooterBtn = document.getElementById('cancelEditTableFooter');

    // Mapping divisi ke line
    const divisionLineMapping = {
        'Brazing': ['Leak Test Inspection', 'Support', 'Hand Bending', 'Welding'],
        'Chassis': ['Cutting', 'Flaring', 'MF/TK', 'LRFD', 'Assy'],
        'Nylon': ['Injection/Extrude', 'Roda Dua', 'Roda Empat']
    };

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

    function openEditModal(id, name, division, lineName) {
        editId.value = id;
        editName.value = name;
        editDivision.value = division || '';
        editLine.value = lineName || '';
        
        // Update line options based on division
        updateLineOptions(editDivision, editLine);
        
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

    // Division change handler for add form
    divisionSelect.addEventListener('change', () => {
        updateLineOptions(divisionSelect, lineNameSelect);
    });

    // Division change handler for edit modal
    editDivision.addEventListener('change', () => {
        updateLineOptions(editDivision, editLine);
    });

    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editId.value;
        const name = editName.value.trim();
        const division = editDivision.value;
        const lineName = editLine.value;
        if (!name || !division || !lineName) return;
        try {
            console.log('Updating table with ID:', id);
            console.log('Update payload:', { name, division, line_name: lineName });
            const response = await fetch(`/api/inspect-tables/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, division, line_name: lineName }),
            });
            console.log('Update response status:', response.status);
            const result = await response.json();
            console.log('Update response data:', result);
            if (!response.ok) throw new Error(result.message || 'Gagal mengupdate meja.');
            closeEditModal();
            location.reload();
        } catch (error) {
            console.error('Update error:', error);
            alert(`Error: ${error.message}`);
        }
    });

    // Handle Add Form
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = addForm.querySelector('[name="name"]').value;
        const division = addForm.querySelector('[name="division"]').value;
        const lineName = addForm.querySelector('[name="line_name"]').value;
        try {
            const response = await fetch('/api/inspect-tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, division, line_name: lineName }),
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
            const currentDivision = row.dataset.division;
            const currentLine = row.dataset.line;
            openEditModal(id, currentName, currentDivision, currentLine);
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
