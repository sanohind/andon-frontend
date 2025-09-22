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
            });
        },
    });

    // Panggilan data awal saat halaman dimuat (untuk 30 hari terakhir)
    const thirtyDaysAgo = moment().subtract(29, 'days').format('YYYY-MM-DD');
    const today = moment().format('YYYY-MM-DD');
    picker.setDateRange(thirtyDaysAgo, today);
});