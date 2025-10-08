// public/js/analytics.js

document.addEventListener('DOMContentLoaded', () => {
    // Konfigurasi awal untuk chart
    const chartConfigs = {
        frequency: { ctx: document.getElementById('frequencyChart').getContext('2d'), type: 'bar', chart: null },
        downtime: { ctx: document.getElementById('downtimeChart').getContext('2d'), type: 'bar', chart: null },
        problemType: { ctx: document.getElementById('problemTypeChart').getContext('2d'), type: 'doughnut', chart: null },
        mttr: { ctx: document.getElementById('mttrChart').getContext('2d'), type: 'bar', chart: null },
        duration: { ctx: document.getElementById('durationChart').getContext('2d'), type: 'bar', chart: null },
        flowType: { ctx: document.getElementById('flowTypeChart').getContext('2d'), type: 'doughnut', chart: null },
    };

    // Fungsi untuk mengubah detik menjadi format Jam:Menit:Detik
    function formatSeconds(seconds) {
        if (isNaN(seconds) || seconds < 0) return 'N/A';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const parts = [];
        if (hours > 0) {
            parts.push(`${hours} Jam`);
        }
        if (minutes > 0) {
            parts.push(`${minutes} Menit`);
        }
        if (secs > 0 || (hours === 0 && minutes === 0 && secs === 0)) {
            parts.push(`${secs} Detik`);
        }

        return parts.join(' ');
    }
    
    // Fungsi untuk mengambil data dari backend
    async function fetchAnalyticsData(startDate, endDate) {
        try {
            // Fetch basic analytics data (prioritas utama)
            const analyticsResponse = await fetch(`/api/dashboard/analytics?start_date=${startDate}&end_date=${endDate}`);
            if (!analyticsResponse.ok) {
                throw new Error('Failed to fetch analytics data');
            }
            const analyticsResult = await analyticsResponse.json();

            if (analyticsResult.success) {
                // Update UI dengan data analytics utama terlebih dahulu
                updateUI(analyticsResult.data);
                
                // Coba fetch duration data (opsional)
                try {
                    const durationResponse = await fetch(`/api/dashboard/analytics/duration?start_date=${startDate}&end_date=${endDate}`);
                    if (durationResponse.ok) {
                        const durationResult = await durationResponse.json();
                        if (durationResult.success && durationResult.data) {
                            // Tampilkan section duration analytics
                            document.getElementById('duration-analytics-section').style.display = 'block';
                            document.getElementById('duration-chart-card').style.display = 'block';
                            document.getElementById('flow-type-chart-card').style.display = 'block';
                            updateDurationAnalytics(durationResult.data);
                            updateDurationCharts(durationResult.data);
                        }
                    }
                } catch (durationError) {
                    console.warn('Duration analytics not available:', durationError);
                    // Sembunyikan section duration analytics
                    document.getElementById('duration-analytics-section').style.display = 'none';
                    document.getElementById('duration-chart-card').style.display = 'none';
                    document.getElementById('flow-type-chart-card').style.display = 'none';
                }

                // Fetch detailed forward analytics data untuk tabel
                try {
                    const forwardResp = await fetch(`/api/dashboard/analytics/detailed-forward?start_date=${startDate}&end_date=${endDate}`);
                    if (forwardResp.ok) {
                        const forwardJson = await forwardResp.json();
                        if (forwardJson.success && forwardJson.data) {
                            updateDetailedForwardAnalyticsTable(forwardJson.data);
                        }
                    }
                } catch (forwardErr) {
                    console.warn('Detailed forward analytics not available:', forwardErr);
                }
            } else {
                console.error('Analytics API Error:', analyticsResult.message);
            }
        } catch (error) {
            console.error('Fetch Error:', error);
        }
    }

    // Fungsi untuk memperbarui semua elemen UI
    function updateUI(data) {
        // Update KPI Cards
        document.getElementById('kpi-total-problems').textContent = data.kpis.total_problems;
        document.getElementById('kpi-total-downtime').textContent = formatSeconds(data.kpis.total_downtime_seconds);
        document.getElementById('kpi-mttr').textContent = formatSeconds(data.kpis.average_resolution_time_seconds);
        document.getElementById('kpi-worst-machine').textContent = data.kpis.most_problematic_machine;

        // Update Charts (chart lama - prioritas utama)
        updateChart(chartConfigs.frequency, data.problemFrequency.labels, data.problemFrequency.data);
        updateChart(chartConfigs.downtime, data.downtime.labels, data.downtime.data.map(s => (s / 60).toFixed(2)), 'Downtime (menit)');
        updateChart(chartConfigs.problemType, data.problemTypes.labels, data.problemTypes.data);
        updateChart(chartConfigs.mttr, data.mttr.labels, data.mttr.data.map(s => (s / 60).toFixed(2)), 'MTTR (menit)');
    }

    // Fungsi untuk memperbarui analytics durasi
    function updateDurationAnalytics(durationData) {
        try {
            if (!durationData || !durationData.summary) {
                console.warn('Duration data not available');
                return;
            }
            
            const summary = durationData.summary;
            
            // Update Active to Receive
            if (summary.active_to_receive) {
                document.getElementById('active-to-receive-avg').textContent = summary.active_to_receive.average_formatted || 'N/A';
                document.getElementById('active-to-receive-count').textContent = summary.active_to_receive.count || '0';
            }
            
            // Update Receive to Feedback
            if (summary.receive_to_feedback) {
                document.getElementById('receive-to-feedback-avg').textContent = summary.receive_to_feedback.average_formatted || 'N/A';
                document.getElementById('receive-to-feedback-count').textContent = summary.receive_to_feedback.count || '0';
            }
            
            // Update Feedback to Final
            if (summary.feedback_to_final) {
                document.getElementById('feedback-to-final-avg').textContent = summary.feedback_to_final.average_formatted || 'N/A';
                document.getElementById('feedback-to-final-count').textContent = summary.feedback_to_final.count || '0';
            }
            
            // Update Total Resolution
            if (summary.total_resolution) {
                document.getElementById('total-resolution-avg').textContent = summary.total_resolution.average_formatted || 'N/A';
                document.getElementById('total-resolution-count').textContent = summary.total_resolution.count || '0';
            }
        } catch (error) {
            console.error('Error updating duration analytics:', error);
        }
    }

    // Fungsi untuk memperbarui chart durasi
    function updateDurationCharts(durationData) {
        try {
            if (!durationData || !durationData.summary) {
                console.warn('Duration chart data not available');
                return;
            }
            
            // Duration stages chart
            const durationLabels = ['Active → Receive', 'Receive → Feedback', 'Feedback → Final', 'Total Resolution'];
            const durationDataValues = [
                (durationData.summary.active_to_receive?.average_seconds || 0) / 60, // Convert to minutes
                (durationData.summary.receive_to_feedback?.average_seconds || 0) / 60,
                (durationData.summary.feedback_to_final?.average_seconds || 0) / 60,
                (durationData.summary.total_resolution?.average_seconds || 0) / 60
            ];
            updateChart(chartConfigs.duration, durationLabels, durationDataValues, 'Durasi (menit)');

            // Flow type distribution chart
            if (durationData.total_resolution && Array.isArray(durationData.total_resolution)) {
                const flowTypeData = {};
                durationData.total_resolution.forEach(problem => {
                    const flowType = problem.flow_type;
                    if (!flowTypeData[flowType]) {
                        flowTypeData[flowType] = 0;
                    }
                    flowTypeData[flowType]++;
                });
                
                const flowTypeLabels = Object.keys(flowTypeData);
                const flowTypeValues = Object.values(flowTypeData);
                updateChart(chartConfigs.flowType, flowTypeLabels, flowTypeValues);
            }
        } catch (error) {
            console.error('Error updating duration charts:', error);
        }
    }

    // Fungsi generik untuk membuat/update chart
    function updateChart(config, labels, data, label = 'Jumlah') {
        if (config.chart) {
            config.chart.destroy();
        }
        config.chart = new Chart(config.ctx, {
            type: config.type,
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    backgroundColor: [
                        getComputedStyle(document.documentElement).getPropertyValue('--primary-color'),
                        getComputedStyle(document.documentElement).getPropertyValue('--warning-color'),
                        getComputedStyle(document.documentElement).getPropertyValue('--danger-color'),
                        getComputedStyle(document.documentElement).getPropertyValue('--success-color'),
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: config.type === 'bar' ? { y: { beginAtZero: true } } : {},
                plugins: { legend: { display: config.type !== 'bar' } }
            }
        });
    }

    // Inisialisasi Date Range Picker
    const picker = new Litepicker({
        element: document.getElementById('date-range-picker'),
        singleMode: false,
        format: 'YYYY-MM-DD',
        setup: (picker) => {
            picker.on('selected', (date1, date2) => {
                const startDate = moment(date1.dateInstance).format('YYYY-MM-DD');
                const endDate = moment(date2.dateInstance).format('YYYY-MM-DD');
                fetchAnalyticsData(startDate, endDate);
                fetchTicketingData(startDate, endDate);
            });
        },
    });

    // Helper untuk mengambil rentang tanggal yang sedang dipilih
    function getCurrentDateRange() {
        const dates = picker.getDateRange ? picker.getDateRange() : picker.getDate();
        if (dates && dates.start && dates.end) {
            return [moment(dates.start).format('YYYY-MM-DD'), moment(dates.end).format('YYYY-MM-DD')];
        }
        if (Array.isArray(dates) && dates.length === 2) {
            return [moment(dates[0]).format('YYYY-MM-DD'), moment(dates[1]).format('YYYY-MM-DD')];
        }
        return null;
    }

    // Global variables untuk tabel forward analytics
    let forwardTableData = [];
    let currentDisplayedData = [];
    let currentSortColumn = null;
    let currentSortDirection = 'asc';

    // Global variables untuk tabel ticketing analytics
    let ticketingTableData = [];
    let currentTicketingDisplayedData = [];
    let currentTicketingSortColumn = null;
    let currentTicketingSortDirection = 'asc';

    // Fungsi untuk mengupdate tabel detail forward analytics
    function updateDetailedForwardAnalyticsTable(data) {
        const tableBody = document.getElementById('forward-analytics-table-body');
        const emptyState = document.getElementById('forward-table-empty-state');
        
        if (!data || !data.problems || data.problems.length === 0) {
            tableBody.innerHTML = '';
            emptyState.style.display = 'block';
            forwardTableData = [];
            return;
        }
        
        emptyState.style.display = 'none';
        forwardTableData = data.problems;
        
        renderForwardTable(forwardTableData);
        setupForwardTableSearch();
    }

    // Fungsi untuk render tabel forward analytics
    function renderForwardTable(data) {
        const tableBody = document.getElementById('forward-analytics-table-body');
        // Simpan data yang sedang ditampilkan (hasil filter/sort)
        currentDisplayedData = Array.isArray(data) ? data : [];
        
        tableBody.innerHTML = currentDisplayedData.map(problem => {
            const flowTypeClass = problem.flow_type.toLowerCase().replace(/\s+/g, '-');
            const problemTypeClass = problem.problem_type.toLowerCase();
            
            // Tentukan class durasi berdasarkan nilai
            const getDurationClass = (minutes) => {
                if (minutes === null || minutes === undefined) return '';
                if (minutes > 60) return 'high';
                if (minutes > 30) return 'medium';
                return 'low';
            };
            
            return `
                <tr>
                    <td><span class="problem-id">#${problem.problem_id}</span></td>
                    <td><span class="machine-info">${problem.machine}</span></td>
                    <td><span class="problem-type ${problemTypeClass}">${problem.problem_type}</span></td>
                    <td><span class="flow-type ${flowTypeClass}">${problem.flow_type}</span></td>
                    <td><span class="timestamp">${problem.timestamps.active_at}</span></td>
                    <td><span class="timestamp">${problem.timestamps.forwarded_at || '-'}</span></td>
                    <td><span class="timestamp">${problem.timestamps.received_at || '-'}</span></td>
                    <td><span class="timestamp">${problem.timestamps.feedback_resolved_at || '-'}</span></td>
                    <td><span class="timestamp">${problem.timestamps.final_resolved_at}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.active_to_forward)}">${problem.durations_formatted.active_to_forward}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.forward_to_receive)}">${problem.durations_formatted.forward_to_receive}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.receive_to_feedback)}">${problem.durations_formatted.receive_to_feedback}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.feedback_to_final)}">${problem.durations_formatted.feedback_to_final}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.total_duration)}">${problem.durations_formatted.total_duration}</span></td>
                    <td>
                        <div class="user-info">
                            ${problem.users.forwarded_by ? `<div><strong>Forward:</strong> ${problem.users.forwarded_by}</div>` : ''}
                            ${problem.users.received_by ? `<div><strong>Receive:</strong> ${problem.users.received_by}</div>` : ''}
                            ${problem.users.feedback_by ? `<div><strong>Feedback:</strong> ${problem.users.feedback_by}</div>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Fungsi untuk setup search pada tabel forward analytics
    function setupForwardTableSearch() {
        const searchInput = document.getElementById('forward-table-search');
        if (!searchInput) return;
        
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const baseData = forwardTableData || [];
            const filteredData = baseData.filter(problem => {
                return problem.problem_id.toString().includes(searchTerm) ||
                       problem.machine.toLowerCase().includes(searchTerm) ||
                       problem.problem_type.toLowerCase().includes(searchTerm) ||
                       problem.flow_type.toLowerCase().includes(searchTerm);
            });
            renderForwardTable(filteredData);
        });
    }

    // Fungsi untuk setup search pada tabel ticketing analytics
    function setupTicketingTableSearch() {
        const searchInput = document.getElementById('ticketing-table-search');
        if (!searchInput) return;
        
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const baseData = ticketingTableData || [];
            const filteredData = baseData.filter(ticketing => {
                return ticketing.id.toString().includes(searchTerm) ||
                       ticketing.problem_id.toString().includes(searchTerm) ||
                       ticketing.machine.toLowerCase().includes(searchTerm) ||
                       ticketing.problem_type.toLowerCase().includes(searchTerm) ||
                       ticketing.pic_technician.toLowerCase().includes(searchTerm) ||
                       ticketing.status.toLowerCase().includes(searchTerm);
            });
            updateTicketingTable(filteredData);
            currentTicketingDisplayedData = filteredData;
        });
    }

    // Fungsi untuk sorting tabel
    function setupTableSorting() {
        // Setup sorting untuk forward analytics table
        const sortableHeaders = document.querySelectorAll('.forward-analytics-table th.sortable');
        
        sortableHeaders.forEach(header => {
            header.addEventListener('click', function() {
                const column = this.dataset.column;
            
                // Toggle sort direction
                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortDirection = 'asc';
                }
                currentSortColumn = column;
            
                // Update header classes
                sortableHeaders.forEach(h => {
                    h.classList.remove('asc', 'desc');
                });
                this.classList.add(currentSortDirection);
            
                // Sort data berdasarkan data yang sedang ditampilkan sekarang
                const baseData = currentDisplayedData && currentDisplayedData.length > 0 ? currentDisplayedData : forwardTableData;
                const sortedData = [...baseData].sort((a, b) => {
                    let aVal, bVal;
            
                    switch (column) {
                        case 'problem_id':
                            aVal = a.problem_id;
                            bVal = b.problem_id;
                            break;
                        case 'machine':
                            aVal = a.machine;
                            bVal = b.machine;
                            break;
                        case 'problem_type':
                            aVal = a.problem_type;
                            bVal = b.problem_type;
                            break;
                        case 'flow_type':
                            aVal = a.flow_type;
                            bVal = b.flow_type;
                            break;
                        case 'active_at':
                        case 'forwarded_at':
                        case 'received_at':
                        case 'feedback_at':
                        case 'resolved_at':
                            const timestampKey = column === 'active_at' ? 'active_at' :
                                               column === 'forwarded_at' ? 'forwarded_at' :
                                               column === 'received_at' ? 'received_at' :
                                               column === 'feedback_at' ? 'feedback_resolved_at' :
                                               'final_resolved_at';
                            aVal = a.timestamps[timestampKey] || '';
                            bVal = b.timestamps[timestampKey] || '';
                            break;
                        case 'active_to_forward':
                        case 'forward_to_receive':
                        case 'receive_to_feedback':
                        case 'feedback_to_final':
                        case 'total_duration':
                            const durationKey = column === 'active_to_forward' ? 'active_to_forward' :
                                              column === 'forward_to_receive' ? 'forward_to_receive' :
                                              column === 'receive_to_feedback' ? 'receive_to_feedback' :
                                              column === 'feedback_to_final' ? 'feedback_to_final' :
                                              'total_duration';
                            aVal = a.durations_minutes[durationKey] || 0;
                            bVal = b.durations_minutes[durationKey] || 0;
                            break;
                        default:
                            return 0;
                    }
            
                    if (aVal < bVal) return currentSortDirection === 'asc' ? -1 : 1;
                    if (aVal > bVal) return currentSortDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            
                renderForwardTable(sortedData);
            });
        });

        // Setup sorting untuk ticketing analytics table
        const ticketingSortableHeaders = document.querySelectorAll('.ticketing-analytics-table th.sortable');
        
        ticketingSortableHeaders.forEach(header => {
            header.addEventListener('click', function() {
                const column = this.dataset.column;
            
                // Toggle sort direction
                if (currentTicketingSortColumn === column) {
                    currentTicketingSortDirection = currentTicketingSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentTicketingSortDirection = 'asc';
                }
                currentTicketingSortColumn = column;
            
                // Update header classes
                ticketingSortableHeaders.forEach(h => {
                    h.classList.remove('sort-asc', 'sort-desc');
                });
                this.classList.add(`sort-${currentTicketingSortDirection}`);
            
                // Sort data berdasarkan data yang sedang ditampilkan sekarang
                const baseData = currentTicketingDisplayedData && currentTicketingDisplayedData.length > 0 ? currentTicketingDisplayedData : ticketingTableData;
                const sortedData = [...baseData].sort((a, b) => {
                    let aVal, bVal;
            
                    switch (column) {
                        case 'id':
                            aVal = a.id;
                            bVal = b.id;
                            break;
                        case 'problem_id':
                            aVal = a.problem_id;
                            bVal = b.problem_id;
                            break;
                        case 'machine':
                            aVal = a.machine;
                            bVal = b.machine;
                            break;
                        case 'problem_type':
                            aVal = a.problem_type;
                            bVal = b.problem_type;
                            break;
                        case 'pic_technician':
                            aVal = a.pic_technician;
                            bVal = b.pic_technician;
                            break;
                        case 'status':
                            aVal = a.status;
                            bVal = b.status;
                            break;
                        case 'problem_received_at':
                        case 'diagnosis_started_at':
                        case 'repair_started_at':
                        case 'repair_completed_at':
                        case 'created_at':
                            const timestampKey = column;
                            aVal = a.timestamps[timestampKey] || '';
                            bVal = b.timestamps[timestampKey] || '';
                            break;
                        case 'downtime':
                        case 'mttr':
                        case 'mttd':
                            const durationKey = column;
                            aVal = a.durations_seconds[`${durationKey}_seconds`] || 0;
                            bVal = b.durations_seconds[`${durationKey}_seconds`] || 0;
                            break;
                        default:
                            return 0;
                    }
            
                    if (aVal < bVal) return currentTicketingSortDirection === 'asc' ? -1 : 1;
                    if (aVal > bVal) return currentTicketingSortDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            
                updateTicketingTable(sortedData);
                currentTicketingDisplayedData = sortedData;
            });
        });
    }

    // Fungsi untuk export PDF
    function exportForwardTableToPDF() {
        const exportData = (currentDisplayedData && currentDisplayedData.length > 0) ? currentDisplayedData : forwardTableData;
        if (!exportData || exportData.length === 0) {
            alert('Tidak ada data untuk diekspor');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a3'); // Lebar lebih besar agar kolom tidak terpotong

        // Siapkan header info agar bisa dicetak di setiap halaman
        const range = getCurrentDateRange();
        const headerLines = [
            'Data Detail Forward Problem Resolution',
            range ? `Rentang: ${range[0]} s/d ${range[1]}` : null,
            `Tanggal Export: ${moment().format('DD/MM/YYYY HH:mm:ss')}`,
            `Total Data: ${exportData.length} problem`
        ].filter(Boolean);

        // Prepare table data
        const tableData = exportData.map(problem => [
            problem.problem_id,
            problem.machine,
            problem.problem_type,
            problem.flow_type,
            problem.timestamps.active_at,
            problem.timestamps.forwarded_at || '-',
            problem.timestamps.received_at || '-',
            problem.timestamps.feedback_resolved_at || '-',
            problem.timestamps.final_resolved_at,
            problem.durations_formatted.active_to_forward,
            problem.durations_formatted.forward_to_receive,
            problem.durations_formatted.receive_to_feedback,
            problem.durations_formatted.feedback_to_final,
            problem.durations_formatted.total_duration,
            `${problem.users.forwarded_by || '-'} | ${problem.users.received_by || '-'} | ${problem.users.feedback_by || '-'}`
        ]);

        // Table headers
        const headers = [
            'Problem ID',
            'Mesin',
            'Tipe Problem',
            'Flow Type',
            'Active At',
            'Forwarded At',
            'Received At',
            'Feedback At',
            'Resolved At',
            'Active → Forward',
            'Forward → Receive',
            'Receive → Feedback',
            'Feedback → Final',
            'Total Duration',
            'Users'
        ];

        // Create table
        doc.autoTable({
            head: [headers],
            body: tableData,
            // Gunakan margin top yang sedikit besar untuk header setiap halaman
            margin: { top: 40, left: 10, right: 10, bottom: 15 },
            tableWidth: 'auto',
            styles: {
                fontSize: 8,
                cellPadding: 1.5,
                overflow: 'linebreak',
                halign: 'left',
                valign: 'top'
            },
            headStyles: {
                fillColor: [0, 123, 255],
                textColor: 255,
                fontStyle: 'bold'
            },
            alternateRowStyles: {
                fillColor: [248, 249, 250]
            },
            columnStyles: {
                // Biarkan auto width, hanya kolom Users yang diberi lebar lebih besar
                14: { cellWidth: 60 }
            },
            didDrawPage: (data) => {
                // Header per halaman
                doc.setFontSize(16);
                doc.setFont(undefined, 'bold');
                doc.text(headerLines[0], data.settings.margin.left, 20);

                doc.setFontSize(10);
                doc.setFont(undefined, 'normal');
                let y = 26;
                for (let i = 1; i < headerLines.length; i++) {
                    doc.text(headerLines[i], data.settings.margin.left, y);
                    y += 6;
                }

                // Footer nomor halaman
                const pageCount = doc.getNumberOfPages();
                const pageSize = doc.internal.pageSize;
                const pageWidth = pageSize.getWidth();
                doc.setFontSize(9);
                doc.text(
                    `Halaman ${doc.internal.getCurrentPageInfo().pageNumber} dari ${pageCount}`,
                    pageWidth - data.settings.margin.right - 50,
                    pageSize.getHeight() - 8
                );
            }
        });

        // Save PDF
        const fileName = `forward_problem_analytics_${moment().format('YYYY-MM-DD_HH-mm-ss')}.pdf`;
        doc.save(fileName);
    }

    // Fungsi untuk fetch data ticketing
    async function fetchTicketingData(startDate, endDate) {
        try {
            const response = await fetch(`/api/dashboard/analytics/ticketing?start_date=${startDate}&end_date=${endDate}`);
            if (!response.ok) {
                throw new Error('Failed to fetch ticketing data');
            }
            const result = await response.json();

            if (result.success) {
                updateTicketingTable(result.data.ticketing);
            } else {
                console.error('Error fetching ticketing data:', result.message);
            }
        } catch (error) {
            console.error('Error fetching ticketing data:', error);
        }
    }

    // Fungsi untuk update tabel ticketing
    function updateTicketingTable(ticketingData) {
        const tbody = document.getElementById('ticketing-analytics-table-body');
        const emptyState = document.getElementById('ticketing-table-empty-state');

        if (!tbody) return;

        // Simpan data ke variabel global
        ticketingTableData = ticketingData || [];

        // Clear existing rows
        tbody.innerHTML = '';

        if (!ticketingData || ticketingData.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        ticketingData.forEach(ticketing => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${ticketing.id}</td>
                <td>${ticketing.problem_id}</td>
                <td>${ticketing.machine}</td>
                <td>${ticketing.problem_type}</td>
                <td>${ticketing.pic_technician}</td>
                <td><span class="status-badge ${ticketing.status}">${ticketing.status_label}</span></td>
                <td>${ticketing.timestamps.problem_received_at || '-'}</td>
                <td>${ticketing.timestamps.diagnosis_started_at || '-'}</td>
                <td>${ticketing.timestamps.repair_started_at || '-'}</td>
                <td>${ticketing.timestamps.repair_completed_at || '-'}</td>
                <td>${ticketing.durations.downtime || '-'}</td>
                <td>${ticketing.durations.mttr || '-'}</td>
                <td>${ticketing.durations.mttd || '-'}</td>
                <td>${ticketing.timestamps.created_at}</td>
            `;
            tbody.appendChild(row);
        });

        // Setup search functionality
        setupTicketingTableSearch();
    }

    // Fungsi untuk export ticketing table ke Excel
    function exportTicketingTableToExcel() {
        const table = document.getElementById('ticketing-analytics-table');
        if (!table) return;

        const ws = XLSX.utils.table_to_sheet(table);
        
        // Set column widths untuk timestamp columns
        const timestampColumns = ['I', 'J', 'K', 'L', 'M']; // Columns untuk timestamps
        timestampColumns.forEach(col => {
            if (ws[col + '1']) {
                ws[col + '1'].z = 'yyyy-mm-dd hh:mm:ss'; // Set format untuk header
            }
        });
        
        // Set format dan width untuk semua timestamp cells
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            timestampColumns.forEach(col => {
                const cell = ws[col + R];
                if (cell && cell.v && typeof cell.v === 'string' && cell.v !== '-') {
                    // Set format untuk timestamp cells
                    cell.z = 'yyyy-mm-dd hh:mm:ss';
                }
            });
        }
        
        // Set column widths - auto width untuk semua columns
        const colWidths = [];
        const numCols = range.e.c + 1;
        for (let C = 0; C < numCols; ++C) {
            let maxWidth = 10; // Default width
            for (let R = range.s.r; R <= range.e.r; ++R) {
                const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
                if (cell && cell.v) {
                    const cellValue = String(cell.v);
                    // Untuk timestamp columns, set width lebih besar
                    if (timestampColumns.includes(XLSX.utils.encode_col(C))) {
                        maxWidth = Math.max(maxWidth, 20);
                    } else {
                        maxWidth = Math.max(maxWidth, cellValue.length + 2);
                    }
                }
            }
            colWidths.push({wch: maxWidth});
        }
        ws['!cols'] = colWidths;
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ticketing Data');

        const fileName = `ticketing_analytics_${moment().format('YYYY-MM-DD_HH-mm-ss')}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    // Fungsi untuk export forward table ke Excel
    function exportForwardTableToExcel() {
        const table = document.getElementById('forward-analytics-table');
        if (!table) return;

        const ws = XLSX.utils.table_to_sheet(table);
        
        // Set format untuk timestamp columns di forward table
        const timestampColumns = ['G', 'H']; // Columns untuk timestamps di forward table
        timestampColumns.forEach(col => {
            if (ws[col + '1']) {
                ws[col + '1'].z = 'yyyy-mm-dd hh:mm:ss';
            }
        });
        
        // Set format dan width untuk semua timestamp cells
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            timestampColumns.forEach(col => {
                const cell = ws[col + R];
                if (cell && cell.v && typeof cell.v === 'string' && cell.v !== '-') {
                    cell.z = 'yyyy-mm-dd hh:mm:ss';
                }
            });
        }
        
        // Set column widths - auto width untuk semua columns
        const colWidths = [];
        const numCols = range.e.c + 1;
        for (let C = 0; C < numCols; ++C) {
            let maxWidth = 10; // Default width
            for (let R = range.s.r; R <= range.e.r; ++R) {
                const cell = ws[XLSX.utils.encode_cell({r: R, c: C})];
                if (cell && cell.v) {
                    const cellValue = String(cell.v);
                    // Untuk timestamp columns, set width lebih besar
                    if (timestampColumns.includes(XLSX.utils.encode_col(C))) {
                        maxWidth = Math.max(maxWidth, 20);
                    } else {
                        maxWidth = Math.max(maxWidth, cellValue.length + 2);
                    }
                }
            }
            colWidths.push({wch: maxWidth});
        }
        ws['!cols'] = colWidths;
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Forward Problem Data');

        const fileName = `forward_problem_analytics_${moment().format('YYYY-MM-DD_HH-mm-ss')}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    // Global functions untuk ticketing actions
    window.viewTicketingDetail = function(ticketingId) {
        // Implementasi untuk view ticketing detail
        console.log('View ticketing detail:', ticketingId);
        // Bisa ditambahkan modal atau redirect ke halaman detail
    };

    window.editTicketing = function(ticketingId) {
        // Implementasi untuk edit ticketing
        console.log('Edit ticketing:', ticketingId);
        // Bisa ditambahkan modal edit atau redirect ke halaman edit
    };

    // Event listeners untuk tombol tabel forward analytics (langsung, karena sudah di dalam DOMContentLoaded)
    const exportExcelForwardBtn = document.getElementById('export-excel-forward-btn');
    const refreshForwardBtn = document.getElementById('refresh-forward-table-btn');

    if (exportExcelForwardBtn) {
        exportExcelForwardBtn.addEventListener('click', exportForwardTableToExcel);
    }

    if (refreshForwardBtn) {
        refreshForwardBtn.addEventListener('click', function() {
            const range = getCurrentDateRange();
            if (range) {
                fetchAnalyticsData(range[0], range[1]);
            }
        });
    }

    // Event listeners untuk tombol tabel ticketing analytics
    const exportExcelTicketingBtn = document.getElementById('export-excel-ticketing-btn');
    const refreshTicketingBtn = document.getElementById('refresh-ticketing-table-btn');

    if (exportExcelTicketingBtn) {
        exportExcelTicketingBtn.addEventListener('click', exportTicketingTableToExcel);
    }

    if (refreshTicketingBtn) {
        refreshTicketingBtn.addEventListener('click', function() {
            const range = getCurrentDateRange();
            if (range) {
                fetchTicketingData(range[0], range[1]);
            }
        });
    }

    // Setup table sorting
    setupTableSorting();

    // Panggilan data awal saat halaman dimuat (untuk 30 hari terakhir)
    const thirtyDaysAgo = moment().subtract(29, 'days').format('YYYY-MM-DD');
    const today = moment().format('YYYY-MM-DD');
    picker.setDateRange(thirtyDaysAgo, today);
    // Pastikan langsung fetch data untuk range default
    fetchAnalyticsData(thirtyDaysAgo, today);
    fetchTicketingData(thirtyDaysAgo, today);
});