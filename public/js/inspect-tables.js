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

    // Elements for Set Running Hour Modal - removed

    // Elements for Set Cycle Threshold Modal
    const setCycleThresholdModal = document.getElementById('setCycleThresholdModal');
    const setCycleThresholdForm = document.getElementById('setCycleThresholdForm');
    const setCycleThresholdAddress = document.getElementById('setCycleThresholdAddress');
    const warningCycleCountInput = document.getElementById('warningCycleCountInput');
    const problemCycleCountInput = document.getElementById('problemCycleCountInput');
    const cancelSetCycleThresholdBtn = document.getElementById('cancelSetCycleThreshold');
    const cancelSetCycleThresholdFooterBtn = document.getElementById('cancelSetCycleThresholdFooter');

    // Elements for Part Configuration Modal
    const partConfigModal = document.getElementById('partConfigModal');
    const partConfigForm = document.getElementById('partConfigForm');
    const partConfigId = document.getElementById('partConfigId');
    const partConfigAddress = document.getElementById('partConfigAddress');
    const partConfigChannel = document.getElementById('partConfigChannel');
    const partConfigPartNumber = document.getElementById('partConfigPartNumber');
    const partConfigCycleTime = document.getElementById('partConfigCycleTime');
    const partConfigJumlahBending = document.getElementById('partConfigJumlahBending');
    const partConfigCavity = document.getElementById('partConfigCavity');
    const partConfigModalTitle = document.getElementById('partConfigModalTitle');
    const cancelPartConfigBtn = document.getElementById('cancelPartConfig');
    const cancelPartConfigFooterBtn = document.getElementById('cancelPartConfigFooter');

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
        
        // Update line options based on division
        updateLineOptions(editDivision, editLine);
        
        // Set the line value after options are updated
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
        if (e.target === setTargetModal) setTargetModal.classList.remove('show');
        if (e.target === setCycleModal) setCycleModal.classList.remove('show');
        // running hour modal removed
        if (e.target === setCycleThresholdModal) setCycleThresholdModal.classList.remove('show');
        if (e.target === partConfigModal) partConfigModal.classList.remove('show');
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
            console.log('Update payload:', { name, division, line_name: lineName });
            const response = await fetch(`/api/inspection-tables/address/${address}`, {
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
        // Get the button element if clicked on icon
        const button = target.closest('.btn-edit, .btn-delete, .btn-set-target, .btn-set-cycle, .btn-set-cycle-threshold') || target;
        const row = button.closest('tr');
        
        // Skip if row doesn't have data-id (e.g., part-config-row)
        if (!row || !row.dataset.id) return;
        
        const id = row.dataset.id;
        const address = row.dataset.address;

        if (button.classList.contains('btn-edit')) {
            const currentName = row.cells[0].textContent;
            const currentDivision = row.dataset.division;
            const currentLine = row.dataset.line;
            const currentAddress = row.dataset.address;
            openEditModal(id, currentAddress, currentName, currentDivision, currentLine);
        }

        if (button.classList.contains('btn-delete')) {
            if (confirm('Apakah Anda yakin ingin menghapus meja ini?')) {
                try {
                    const response = await fetch(`/api/inspection-tables/${id}`, { 
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    // Check if response is ok
                    if (!response.ok) {
                        let errorMessage = 'Gagal menghapus meja.';
                        try {
                            const errorData = await response.json();
                            errorMessage = errorData.message || errorData.error || errorMessage;
                        } catch (e) {
                            // If response is not JSON, use status text
                            errorMessage = response.statusText || errorMessage;
                        }
                        throw new Error(errorMessage);
                    }
                    
                    // Parse response
                    const result = await response.json();
                    if (result.success !== false) {
                        alert(result.message || 'Meja berhasil dihapus!');
                        row.remove();
                    } else {
                        throw new Error(result.message || 'Gagal menghapus meja.');
                    }
                } catch (error) {
                    console.error('Delete error:', error);
                    alert(`Error: ${error.message}`);
                }
            }
        }

        if (button.classList.contains('btn-set-target')) {
            setTargetAddress.value = address;
            targetQuantityInput.value = '';
            setTargetModal.classList.add('show');
        }

        if (button.classList.contains('btn-set-cycle')) {
            setCycleAddress.value = address;
            cycleTimeInput.value = '';
            setCycleModal.classList.add('show');
        }

        // btn-set-running-hour removed

        if (button.classList.contains('btn-set-cycle-threshold')) {
            setCycleThresholdAddress.value = address;
            warningCycleCountInput.value = '';
            problemCycleCountInput.value = '';
            setCycleThresholdModal.classList.add('show');
        }
    });

    // Close handlers for Set Target/Set Cycle/Set Running Hour/Set Cycle Threshold
    if (cancelSetTargetBtn) cancelSetTargetBtn.addEventListener('click', () => setTargetModal.classList.remove('show'));
    if (cancelSetTargetFooterBtn) cancelSetTargetFooterBtn.addEventListener('click', () => setTargetModal.classList.remove('show'));
    if (cancelSetCycleBtn) cancelSetCycleBtn.addEventListener('click', () => setCycleModal.classList.remove('show'));
    if (cancelSetCycleFooterBtn) cancelSetCycleFooterBtn.addEventListener('click', () => setCycleModal.classList.remove('show'));
    // running hour cancel handlers removed
    if (cancelSetCycleThresholdBtn) cancelSetCycleThresholdBtn.addEventListener('click', () => setCycleThresholdModal.classList.remove('show'));
    if (cancelSetCycleThresholdFooterBtn) cancelSetCycleThresholdFooterBtn.addEventListener('click', () => setCycleThresholdModal.classList.remove('show'));

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

    // running hour submit handler removed

    if (setCycleThresholdForm) setCycleThresholdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const address = setCycleThresholdAddress.value;
        const warningCycleCount = parseInt(warningCycleCountInput.value, 10);
        const problemCycleCount = parseInt(problemCycleCountInput.value, 10);
        
        if (Number.isNaN(warningCycleCount) || warningCycleCount < 1) {
            return alert('Warning Cycle Count harus >= 1.');
        }
        if (Number.isNaN(problemCycleCount) || problemCycleCount < 1) {
            return alert('Problem Cycle Count harus >= 1.');
        }
        if (problemCycleCount < warningCycleCount) {
            return alert('Problem Cycle Count harus >= Warning Cycle Count.');
        }
        
        try {
            const res = await fetch(`/api/inspection-tables/address/${encodeURIComponent(address)}/cycle-threshold`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ 
                    warning_cycle_count: warningCycleCount,
                    problem_cycle_count: problemCycleCount
                })
            });
            
            // Check if response is JSON
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await res.text();
                console.error('Non-JSON response received:', text);
                throw new Error('Server returned non-JSON response. Please check server logs.');
            }
            
            const json = await res.json();
            if (!res.ok) {
                // Handle validation errors
                if (json.errors) {
                    const errorMessages = Object.values(json.errors).flat().join(', ');
                    throw new Error(errorMessages || json.message || 'Gagal menyimpan cycle threshold.');
                }
                throw new Error(json.message || 'Gagal menyimpan cycle threshold.');
            }
            setCycleThresholdModal.classList.remove('show');
            alert('Cycle threshold tersimpan.');
        } catch (err) {
            console.error('Error saving cycle threshold:', err);
            alert(`Error: ${err.message}`);
        }
    });

    // ========== PART CONFIGURATIONS FUNCTIONS ==========
    
    // Load part configurations for a specific address
    async function loadPartConfigurations(address) {
        try {
            const response = await fetch(`/api/part-configurations?address=${encodeURIComponent(address)}`);
            const result = await response.json();
            
            if (result.success && result.data) {
                renderPartConfigurations(address, result.data);
            } else {
                renderPartConfigurations(address, []);
            }
        } catch (error) {
            console.error('Error loading part configurations:', error);
            renderPartConfigurations(address, []);
        }
    }

    // Render part configurations to table
    function renderPartConfigurations(address, configurations) {
        const tbody = document.querySelector(`.part-config-tbody[data-address="${address}"]`);
        if (!tbody) return;

        tbody.innerHTML = '';

        if (configurations.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-config-message">Tidak ada data part configuration</td>
                </tr>
            `;
            return;
        }

        configurations.forEach(config => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${config.channel !== null && config.channel !== undefined ? config.channel : '-'}</td>
                <td>${config.part_number || '-'}</td>
                <td>${config.cycle_time !== null && config.cycle_time !== undefined ? config.cycle_time : '-'}</td>
                <td>${config.jumlah_bending !== null && config.jumlah_bending !== undefined ? config.jumlah_bending : '-'}</td>
                <td>${config.cavity !== null && config.cavity !== undefined ? config.cavity : '-'}</td>
                <td>
                    <div class="part-config-actions-cell">
                        <button class="btn-part-edit" data-id="${config.id}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-part-delete" data-id="${config.id}" title="Hapus">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Toggle dropdown when table name is clicked
    document.addEventListener('click', (e) => {
        if (e.target.closest('.table-name-clickable')) {
            const clickable = e.target.closest('.table-name-clickable');
            const address = clickable.dataset.address;
            const row = clickable.closest('tr');
            const partConfigRow = row.nextElementSibling;
            
            if (partConfigRow && partConfigRow.classList.contains('part-config-row')) {
                const isExpanded = partConfigRow.classList.contains('show');
                
                if (!isExpanded) {
                    // Expand dropdown
                    partConfigRow.classList.add('show');
                    loadPartConfigurations(address);
                } else {
                    // Collapse dropdown
                    partConfigRow.classList.remove('show');
                }
            }
        }
    });

    // Handle Add Part Configuration button
    document.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('.btn-part-add') || (target.classList.contains('btn-part-add') ? target : null);
        if (button) {
            const address = button.dataset.address;
            openPartConfigModal(null, address);
        }
    });

    // Handle Export Excel button
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const button = target.closest('.btn-part-export') || (target.classList.contains('btn-part-export') ? target : null);
        if (button) {
            const address = button.dataset.address;
            await exportPartConfigurationsToExcel(address);
        }
    });

    // Handle Import Excel button
    document.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('.btn-part-import') || (target.classList.contains('btn-part-import') ? target : null);
        if (button) {
            const address = button.dataset.address;
            // Find the file input in the same part-config-actions container
            const actionsContainer = button.closest('.part-config-actions');
            if (actionsContainer) {
                const fileInput = actionsContainer.querySelector('input[type="file"]');
                if (fileInput) {
                    fileInput.click();
                }
            }
        }
    });

    // Handle file input change for import
    document.addEventListener('change', async (e) => {
        if (e.target.type === 'file' && e.target.hasAttribute('data-address')) {
            const file = e.target.files[0];
            const address = e.target.dataset.address;
            if (file) {
                await importPartConfigurationsFromExcel(file, address);
                e.target.value = ''; // Reset file input
            }
        }
    });

    // Handle Edit Part Configuration button
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const button = target.closest('.btn-part-edit') || (target.classList.contains('btn-part-edit') ? target : null);
        if (button) {
            const id = button.dataset.id;
            try {
                const response = await fetch(`/api/part-configurations/${id}`);
                const result = await response.json();
                
                if (result.success && result.data) {
                    openPartConfigModal(result.data, result.data.address);
                } else {
                    alert('Gagal memuat data part configuration');
                }
            } catch (error) {
                console.error('Error loading part configuration:', error);
                alert('Error: ' + error.message);
            }
        }
    });

    // Handle Delete Part Configuration button
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const button = target.closest('.btn-part-delete') || (target.classList.contains('btn-part-delete') ? target : null);
        if (button) {
            const id = button.dataset.id;
            
            if (!confirm('Apakah Anda yakin ingin menghapus part configuration ini?')) {
                return;
            }

            try {
                const response = await fetch(`/api/part-configurations/${id}`, {
                    method: 'DELETE'
                });
                const result = await response.json();
                
                if (result.success) {
                    // Reload configurations for the address
                    const row = button.closest('tr');
                    const tbody = row.closest('tbody');
                    const address = tbody.dataset.address;
                    await loadPartConfigurations(address);
                    alert('Part configuration berhasil dihapus');
                } else {
                    alert(result.message || 'Gagal menghapus part configuration');
                }
            } catch (error) {
                console.error('Error deleting part configuration:', error);
                alert('Error: ' + error.message);
            }
        }
    });

    // Open Part Configuration Modal
    function openPartConfigModal(config, address) {
        if (config) {
            // Edit mode
            partConfigModalTitle.textContent = 'Edit Part Configuration';
            partConfigId.value = config.id;
            partConfigAddress.value = config.address;
            partConfigChannel.value = config.channel || '';
            partConfigPartNumber.value = config.part_number || '';
            partConfigCycleTime.value = config.cycle_time || '';
            partConfigJumlahBending.value = config.jumlah_bending || '';
            partConfigCavity.value = config.cavity || '';
        } else {
            // Add mode
            partConfigModalTitle.textContent = 'Tambah Part Configuration';
            partConfigId.value = '';
            partConfigAddress.value = address;
            partConfigChannel.value = '';
            partConfigPartNumber.value = '';
            partConfigCycleTime.value = '';
            partConfigJumlahBending.value = '';
            partConfigCavity.value = '';
        }
        partConfigModal.classList.add('show');
    }

    // Close Part Configuration Modal
    function closePartConfigModal() {
        partConfigModal.classList.remove('show');
        partConfigForm.reset();
    }

    if (cancelPartConfigBtn) cancelPartConfigBtn.addEventListener('click', closePartConfigModal);
    if (cancelPartConfigFooterBtn) cancelPartConfigFooterBtn.addEventListener('click', closePartConfigModal);

    // Handle Part Configuration Form Submit
    if (partConfigForm) {
        partConfigForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = partConfigId.value;
            const address = partConfigAddress.value;
            const channel = parseInt(partConfigChannel.value, 10);
            const partNumber = partConfigPartNumber.value.trim();
            const cycleTime = partConfigCycleTime.value ? parseInt(partConfigCycleTime.value, 10) : null;
            const jumlahBending = parseInt(partConfigJumlahBending.value, 10);
            const cavity = parseInt(partConfigCavity.value, 10);

            if (!partNumber || isNaN(channel) || isNaN(jumlahBending) || isNaN(cavity)) {
                alert('Mohon isi semua field yang wajib diisi');
                return;
            }

            try {
                const payload = {
                    address: address,
                    channel: channel,
                    part_number: partNumber,
                    cycle_time: cycleTime,
                    jumlah_bending: jumlahBending,
                    cavity: cavity
                };

                let response;
                if (id) {
                    // Update
                    response = await fetch(`/api/part-configurations/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    // Create
                    response = await fetch('/api/part-configurations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const result = await response.json();
                
                if (result.success) {
                    closePartConfigModal();
                    await loadPartConfigurations(address);
                    alert(id ? 'Part configuration berhasil diupdate' : 'Part configuration berhasil ditambahkan');
                } else {
                    alert(result.message || 'Gagal menyimpan part configuration');
                }
            } catch (error) {
                console.error('Error saving part configuration:', error);
                alert('Error: ' + error.message);
            }
        });
    }

    // ========== EXCEL EXPORT/IMPORT FUNCTIONS ==========

    // Export part configurations to Excel
    async function exportPartConfigurationsToExcel(address) {
        try {
            // Load part configurations for the address
            const response = await fetch(`/api/part-configurations?address=${encodeURIComponent(address)}`);
            const result = await response.json();
            
            if (!result.success || !result.data || result.data.length === 0) {
                alert('Tidak ada data part configuration untuk diekspor');
                return;
            }

            // Prepare data for Excel
            const excelData = result.data.map(config => ({
                'CH (Channel)': config.channel !== null && config.channel !== undefined ? config.channel : '',
                'Part Number': config.part_number || '',
                'Cycle Time': config.cycle_time !== null && config.cycle_time !== undefined ? config.cycle_time : '',
                'Jumlah Bending': config.jumlah_bending !== null && config.jumlah_bending !== undefined ? config.jumlah_bending : '',
                'Cavity': config.cavity !== null && config.cavity !== undefined ? config.cavity : ''
            }));

            // Create workbook and worksheet
            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Part Configurations');

            // Set column widths
            ws['!cols'] = [
                { wch: 12 }, // CH
                { wch: 20 }, // Part Number
                { wch: 12 }, // Cycle Time
                { wch: 15 }, // Jumlah Bending
                { wch: 10 }  // Cavity
            ];

            // Generate filename with address and current date
            const date = new Date().toISOString().split('T')[0];
            const filename = `Part_Configuration_${address}_${date}.xlsx`;

            // Write file
            XLSX.writeFile(wb, filename);
            
            alert('Data berhasil diekspor ke Excel');
        } catch (error) {
            console.error('Error exporting to Excel:', error);
            alert('Error: ' + error.message);
        }
    }

    // Import part configurations from Excel
    async function importPartConfigurationsFromExcel(file, address) {
        try {
            // Read Excel file
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Get first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    // Convert to JSON
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);
                    
                    if (jsonData.length === 0) {
                        alert('File Excel kosong atau tidak memiliki data');
                        return;
                    }

                    // Validate and transform data
                    const configurations = [];
                    const errors = [];

                    jsonData.forEach((row, index) => {
                        const rowNum = index + 2; // +2 because index starts at 0 and Excel rows start at 2 (1 is header)
                        
                        // Map column names (handle variations)
                        const channel = row['CH (Channel)'] !== undefined ? row['CH (Channel)'] : 
                                       row['CH'] !== undefined ? row['CH'] : 
                                       row['Channel'] !== undefined ? row['Channel'] : null;
                        const partNumber = row['Part Number'] !== undefined ? row['Part Number'] : 
                                          row['PartNumber'] !== undefined ? row['PartNumber'] : 
                                          row['Part_Number'] !== undefined ? row['Part_Number'] : '';
                        const cycleTime = row['Cycle Time'] !== undefined ? row['Cycle Time'] : 
                                         row['CycleTime'] !== undefined ? row['CycleTime'] : 
                                         row['Cycle_Time'] !== undefined ? row['Cycle_Time'] : null;
                        const jumlahBending = row['Jumlah Bending'] !== undefined ? row['Jumlah Bending'] : 
                                             row['JumlahBending'] !== undefined ? row['JumlahBending'] : 
                                             row['Jumlah_Bending'] !== undefined ? row['Jumlah_Bending'] : null;
                        const cavity = row['Cavity'] !== undefined ? row['Cavity'] : null;

                        // Validate required fields
                        if (channel === null || channel === undefined || channel === '') {
                            errors.push(`Baris ${rowNum}: CH (Channel) wajib diisi`);
                            return;
                        }
                        if (!partNumber || partNumber.toString().trim() === '') {
                            errors.push(`Baris ${rowNum}: Part Number wajib diisi`);
                            return;
                        }
                        if (jumlahBending === null || jumlahBending === undefined || jumlahBending === '') {
                            errors.push(`Baris ${rowNum}: Jumlah Bending wajib diisi`);
                            return;
                        }
                        if (cavity === null || cavity === undefined || cavity === '') {
                            errors.push(`Baris ${rowNum}: Cavity wajib diisi`);
                            return;
                        }

                        // Parse numeric values
                        const channelNum = parseInt(channel, 10);
                        const cycleTimeNum = cycleTime !== null && cycleTime !== undefined && cycleTime !== '' ? parseInt(cycleTime, 10) : null;
                        const jumlahBendingNum = parseInt(jumlahBending, 10);
                        const cavityNum = parseInt(cavity, 10);

                        if (isNaN(channelNum) || channelNum < 0) {
                            errors.push(`Baris ${rowNum}: CH (Channel) harus berupa angka >= 0`);
                            return;
                        }
                        if (cycleTimeNum !== null && (isNaN(cycleTimeNum) || cycleTimeNum < 0)) {
                            errors.push(`Baris ${rowNum}: Cycle Time harus berupa angka >= 0`);
                            return;
                        }
                        if (isNaN(jumlahBendingNum) || jumlahBendingNum < 0) {
                            errors.push(`Baris ${rowNum}: Jumlah Bending harus berupa angka >= 0`);
                            return;
                        }
                        if (isNaN(cavityNum) || cavityNum < 0) {
                            errors.push(`Baris ${rowNum}: Cavity harus berupa angka >= 0`);
                            return;
                        }

                        configurations.push({
                            address: address,
                            channel: channelNum,
                            part_number: partNumber.toString().trim(),
                            cycle_time: cycleTimeNum,
                            jumlah_bending: jumlahBendingNum,
                            cavity: cavityNum
                        });
                    });

                    // Show errors if any
                    if (errors.length > 0) {
                        alert('Error validasi:\n' + errors.join('\n'));
                        return;
                    }

                    if (configurations.length === 0) {
                        alert('Tidak ada data valid untuk diimport');
                        return;
                    }

                    // Confirm import
                    const confirmed = confirm(`Apakah Anda yakin ingin mengimport ${configurations.length} part configuration?\n\nCatatan: Data yang sudah ada dengan CH dan Part Number yang sama akan diupdate.`);
                    if (!confirmed) {
                        return;
                    }

                    // Import configurations (bulk import)
                    const response = await fetch('/api/part-configurations/bulk-import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ configurations })
                    });

                    const result = await response.json();

                    if (result.success) {
                        alert(`Import berhasil!\n${result.created || 0} data ditambahkan\n${result.updated || 0} data diupdate`);
                        // Reload part configurations
                        await loadPartConfigurations(address);
                    } else {
                        alert(result.message || 'Gagal mengimport data');
                    }
                } catch (error) {
                    console.error('Error processing Excel file:', error);
                    alert('Error: ' + error.message);
                }
            };
            
            reader.onerror = function() {
                alert('Error membaca file Excel');
            };
            
            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('Error importing from Excel:', error);
            alert('Error: ' + error.message);
        }
    }
});
