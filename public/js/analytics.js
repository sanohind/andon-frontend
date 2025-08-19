// public/js/analytics.js

document.addEventListener('DOMContentLoaded', () => {
    // Konfigurasi awal untuk chart
    const chartConfigs = {
        frequency: { ctx: document.getElementById('frequencyChart').getContext('2d'), type: 'bar', chart: null },
        downtime: { ctx: document.getElementById('downtimeChart').getContext('2d'), type: 'bar', chart: null },
        problemType: { ctx: document.getElementById('problemTypeChart').getContext('2d'), type: 'doughnut', chart: null },
        mttr: { ctx: document.getElementById('mttrChart').getContext('2d'), type: 'bar', chart: null },
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
            const response = await fetch(`/api/dashboard/analytics?start_date=${startDate}&end_date=${endDate}`);
            if (!response.ok) {
                throw new Error('Failed to fetch data');
            }
            const result = await response.json();

            if (result.success) {
                updateUI(result.data);
            } else {
                console.error('API Error:', result.message);
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

        // Update Charts
        updateChart(chartConfigs.frequency, data.problemFrequency.labels, data.problemFrequency.data);
        updateChart(chartConfigs.downtime, data.downtime.labels, data.downtime.data.map(s => (s / 60).toFixed(2)), 'Downtime (menit)');
        updateChart(chartConfigs.problemType, data.problemTypes.labels, data.problemTypes.data);
        updateChart(chartConfigs.mttr, data.mttr.labels, data.mttr.data.map(s => (s / 60).toFixed(2)), 'MTTR (menit)');
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