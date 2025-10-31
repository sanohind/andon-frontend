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

    // Elements for Set Target Modal
    const setTargetModal = document.getElementById('setTargetModal');
    const setTargetForm = document.getElementById('setTargetForm');
    const setTargetAddress = document.getElementById('setTargetAddress');
    const targetQuantityInput = document.getElementById('targetQuantityInput');
    const cancelSetTargetBtn = document.getElementById('cancelSetTarget');
    const cancelSetTargetFooterBtn = document.getElementById('cancelSetTargetFooter');

    // Elements for Set Cycle Modal
    const setCycleModal = document.getElementById('setCycleModal');
    const setCycleForm = document.getElementById('setCycleForm');
    const setCycleAddress = document.getElementById('setCycleAddress');
    const cycleTimeInput = document.getElementById('cycleTimeInput');
    const cancelSetCycleBtn = document.getElementById('cancelSetCycle');
    const cancelSetCycleFooterBtn = document.getElementById('cancelSetCycleFooter');

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

    function openEditModal(id, address, name, division, lineName) {
        editId.value = id;
        editId.setAttribute('data-address', address);
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
        if (e.target === setTargetModal) setTargetModal.classList.remove('show');
        if (e.target === setCycleModal) setCycleModal.classList.remove('show');
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
        const address = editId.getAttribute('data-address');
        const name = editName.value.trim();
        const division = editDivision.value;
        const lineName = editLine.value;
        if (!name || !division || !lineName) return;
        try {
            console.log('Updating table with address:', address);
            console.log('Update payload:', { name });
            const response = await fetch(`/api/inspection-tables/address/${address}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
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
            const response = await fetch('/api/inspection-tables', {
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
        const address = row.dataset.address;

        if (target.classList.contains('btn-edit')) {
            const currentName = row.cells[0].textContent;
            const currentDivision = row.dataset.division;
            const currentLine = row.dataset.line;
            const currentAddress = row.dataset.address;
            openEditModal(id, currentAddress, currentName, currentDivision, currentLine);
        }

        if (target.classList.contains('btn-delete')) {
            if (confirm('Apakah Anda yakin ingin menghapus meja ini?')) {
                try {
                    const response = await fetch(`/api/inspection-tables/${id}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Gagal menghapus meja.');
                    alert('Meja berhasil dihapus!');
                    row.remove();
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        }

        if (target.classList.contains('btn-set-target')) {
            setTargetAddress.value = address;
            targetQuantityInput.value = '';
            setTargetModal.classList.add('show');
        }

        if (target.classList.contains('btn-set-cycle')) {
            setCycleAddress.value = address;
            cycleTimeInput.value = '';
            setCycleModal.classList.add('show');
        }
    });

    // Close handlers for Set Target/Set Cycle
    if (cancelSetTargetBtn) cancelSetTargetBtn.addEventListener('click', () => setTargetModal.classList.remove('show'));
    if (cancelSetTargetFooterBtn) cancelSetTargetFooterBtn.addEventListener('click', () => setTargetModal.classList.remove('show'));
    if (cancelSetCycleBtn) cancelSetCycleBtn.addEventListener('click', () => setCycleModal.classList.remove('show'));
    if (cancelSetCycleFooterBtn) cancelSetCycleFooterBtn.addEventListener('click', () => setCycleModal.classList.remove('show'));

    // Submit handlers for Set Target/Set Cycle
    if (setTargetForm) setTargetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = setTargetAddress.value;
        const val = parseInt(targetQuantityInput.value, 10);
        if (Number.isNaN(val) || val < 0) return alert('Nilai tidak valid.');
        try {
            const res = await fetch(`/api/inspection-tables/address/${encodeURIComponent(address)}/target`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_quantity: val })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message || 'Gagal menyimpan target.');
            setTargetModal.classList.remove('show');
            alert('Target tersimpan.');
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    });

    if (setCycleForm) setCycleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = setCycleAddress.value;
        const val = parseInt(cycleTimeInput.value, 10);
        if (Number.isNaN(val) || val < 0) return alert('Nilai tidak valid.');
        try {
            const res = await fetch(`/api/inspection-tables/address/${encodeURIComponent(address)}/cycle`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cycle_time: val })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message || 'Gagal menyimpan cycle time.');
            setCycleModal.classList.remove('show');
            alert('Cycle time tersimpan.');
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    });
});
