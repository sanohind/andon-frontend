document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('plc-monitoring-grid');

    async function fetchPlcStatus() {
        try {
            const response = await fetch('/api/dashboard/plc-status');
            const result = await response.json();

            if (result.success) {
                updateUI(result.data);
            } else {
                grid.innerHTML = `<p style="color:red;">Error: ${result.message}</p>`;
            }
        } catch (error) {
            grid.innerHTML = `<p style="color:red;">Error: Cannot connect to the dashboard server.</p>`;
        }
    }

    function updateUI(data) {
        // Hapus konten lama
        grid.innerHTML = '';

        // Loop melalui setiap mesin di data (contoh: "Mesin 1", "Mesin 2")
        for (const machineName in data) {
            const plcData = data[machineName];

            let statusClass = 'unknown';
            if (plcData.status === 'Connected') statusClass = 'connected';
            if (plcData.status === 'Error' || plcData.status === 'Unreachable') statusClass = 'error';
            
            // Buat HTML untuk setiap mesin
            const machineCardHTML = `
                <div class="plc-card" style="grid-column: 1 / -1;">
                    <h2>${machineName}</h2>
                    <div class="status-box">
                        <div class="status-indicator ${statusClass}">${plcData.status}</div>
                    </div>
                    <div class="details-grid">
                        <div class="detail-card">
                            <h3><i class="fas fa-clock"></i> Last Successful Read</h3>
                            <p>${plcData.last_successful_read}</p>
                        </div>
                        <div class="detail-card">
                            <h3><i class="fas fa-exclamation-triangle"></i> Last Error Message</h3>
                            <p>${plcData.last_error}</p>
                        </div>
                        <div class="detail-card" style="grid-column: 1 / -1;">
                            <h3><i class="fas fa-database"></i> Last Raw Data (Buffer)</h3>
                            <p>${plcData.last_raw_data}</p>
                        </div>
                    </div>
                </div>
            `;
            grid.innerHTML += machineCardHTML;
        }
    }

    // Panggil saat halaman dimuat, lalu setiap 5 detik
    fetchPlcStatus();
    setInterval(fetchPlcStatus, 5000);
});