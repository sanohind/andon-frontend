// public/js/analytics.js

// Teknisi PIC table state (global scope - must be defined before DOMContentLoaded)
let teknisiPicTableData = [];
let currentTeknisiPicDisplayedData = [];
let currentTeknisiPicSortColumn = null;
let currentTeknisiPicSortDirection = 'asc';

document.addEventListener('DOMContentLoaded', () => {
    // Get user role from data attribute
    const userDataEl = document.getElementById('userData');
    const userRole = userDataEl ? userDataEl.getAttribute('data-role') : null;
    const userLine = userDataEl ? userDataEl.getAttribute('data-line') : null;
    const userDivision = userDataEl ? userDataEl.getAttribute('data-division') : null;
    
    // DOM references - global division selector (applies to entire analytics page)
    const globalDivisionSelect = document.getElementById('globalDivisionSelect');
    const quantityPeriodSelect = document.getElementById('quantityPeriodSelect');
    const quantityDateInput = document.getElementById('quantityDateInput');
    const quantityMonthInput = document.getElementById('quantityMonthInput');
    const quantityYearInput = document.getElementById('quantityYearInput');
    const quantityDateGroup = document.getElementById('quantityDateGroup');
    const quantityMonthGroup = document.getElementById('quantityMonthGroup');
    const quantityYearGroup = document.getElementById('quantityYearGroup');
    const quantityShiftSelect = document.getElementById('quantityShiftSelect');
    const quantityChartsContainer = document.getElementById('quantityChartsContainer');
    const lineQuantityEmptyState = document.getElementById('lineQuantityEmptyState');

    // Determine what to show based on role
    const showCharts = ['admin', 'management', 'manager'].includes(userRole);
    const showTables = ['admin', 'management', 'maintenance', 'quality', 'engineering'].includes(userRole);

    const quantityFormatter = new Intl.NumberFormat('id-ID');
    
    // Helper function to get authentication headers
    function getAuthHeaders() {
        const token = getCookieValue('auth_token');
        return {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    // Helper function to get cookie value
    function getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // Konfigurasi awal untuk chart (hanya jika chart section ada)
    const chartConfigs = {};
    if (showCharts) {
        const frequencyEl = document.getElementById('frequencyChart');
        const downtimeEl = document.getElementById('downtimeChart');
        const problemTypeEl = document.getElementById('problemTypeChart');
        const mttrEl = document.getElementById('mttrChart');
        
        if (frequencyEl) chartConfigs.frequency = { ctx: frequencyEl.getContext('2d'), type: 'bar', chart: null };
        if (downtimeEl) chartConfigs.downtime = { ctx: downtimeEl.getContext('2d'), type: 'bar', chart: null };
        if (problemTypeEl) chartConfigs.problemType = { ctx: problemTypeEl.getContext('2d'), type: 'doughnut', chart: null };
        if (mttrEl) chartConfigs.mttr = { ctx: mttrEl.getContext('2d'), type: 'bar', chart: null };
        // Chart configs untuk quantity akan dibuat secara dinamis per line
        chartConfigs.lineQuantity = { charts: {} };
    }

    let lastSelectedRange = null;

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

    function formatTimestampDisplay(value) {
        if (!value) return '-';
        const parsed = moment(value, ['YYYY-MM-DD HH:mm:ss', moment.ISO_8601], true);
        if (!parsed.isValid()) {
            return value;
        }
        return parsed.format('DD/MM/YYYY HH:mm:ss');
    }

    function formatQuantityValue(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return '-';
        }
        return quantityFormatter.format(Math.round(value));
    }
    
    // Helper: get selected global division
    function getSelectedDivision() {
        return (globalDivisionSelect && globalDivisionSelect.value) ? globalDivisionSelect.value : null;
    }

    // Fungsi untuk mengambil data dari backend
    async function fetchAnalyticsData(startDate, endDate) {
        if (startDate && endDate) {
            lastSelectedRange = { start: startDate, end: endDate };
        }
        const division = getSelectedDivision();
        try {
            const qs = (path, start, end, div) => {
                const p = new URLSearchParams({ start_date: start, end_date: end });
                if (div) p.set('division', div);
                return `${path}?${p.toString()}`;
            };

            // Fetch basic analytics data (hanya jika showCharts)
            if (showCharts) {
                const analyticsResponse = await fetch(qs('/api/dashboard/analytics', startDate, endDate, division), {
                    headers: getAuthHeaders()
                });
                if (!analyticsResponse.ok) {
                    throw new Error('Failed to fetch analytics data');
                }
                const analyticsResult = await analyticsResponse.json();

                if (analyticsResult.success) {
                    updateUI(analyticsResult.data);
                } else {
                    console.error('Analytics API Error:', analyticsResult.message);
                }
            }

            // Fetch detailed forward analytics data untuk tabel (hanya jika showTables)
            if (showTables) {
                try {
                    const forwardResp = await fetch(qs('/api/dashboard/analytics/detailed-forward', startDate, endDate, division), {
                        headers: getAuthHeaders()
                    });
                    if (forwardResp.ok) {
                        const forwardJson = await forwardResp.json();
                        if (forwardJson.success && forwardJson.data) {
                            updateDetailedForwardAnalyticsTable(forwardJson.data);
                        }
                    }
                } catch (forwardErr) {
                    console.warn('Detailed forward analytics not available:', forwardErr);
                }
            }
        } catch (error) {
            console.error('Fetch Error:', error);
        }
    }

    function updateQuantityPeriodVisibility() {
        const period = (quantityPeriodSelect && quantityPeriodSelect.value) || 'daily';
        if (quantityDateGroup) quantityDateGroup.style.display = period === 'daily' ? 'flex' : 'none';
        if (quantityMonthGroup) quantityMonthGroup.style.display = period === 'monthly' ? 'flex' : 'none';
        if (quantityYearGroup) quantityYearGroup.style.display = period === 'yearly' ? 'flex' : 'none';
    }

    let lastLineQuantityData = null;
    let lastLineQuantityFilter = null;
    let lastLineQuantityParams = null;

    async function fetchLineQuantityAnalytics() {
        if (!showCharts || !chartConfigs.lineQuantity) return;

        const period = (quantityPeriodSelect && quantityPeriodSelect.value) || 'daily';
        const selectedShift = (quantityShiftSelect && quantityShiftSelect.value) || 'pagi';

        const params = new URLSearchParams({
            period: period,
            shift: selectedShift
        });

        if (period === 'daily') {
            const v = (quantityDateInput && quantityDateInput.value) || moment().format('YYYY-MM-DD');
            params.append('date', v);
        } else if (period === 'monthly') {
            const v = (quantityMonthInput && quantityMonthInput.value) || moment().format('YYYY-MM');
            params.append('month', v);
        } else {
            const v = (quantityYearInput && quantityYearInput.value) || moment().format('YYYY');
            params.append('year', v);
        }

        const selectedDivision = getSelectedDivision();
        if (selectedDivision) {
            params.append('division', selectedDivision);
        }

        try {
            const response = await fetch(`/api/dashboard/analytics/line-quantity?${params.toString()}`, {
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to fetch line quantity analytics');
            }

            const result = await response.json();
            if (!result.success || !result.data) {
                throw new Error(result.message || 'Invalid line quantity response');
            }

            const { lines = [] } = result.data;
            lastLineQuantityData = lines;
            lastLineQuantityFilter = result.data.filter || {};
            lastLineQuantityParams = { period, date: params.get('date'), month: params.get('month'), year: params.get('year'), shift: selectedShift };

            const hasLines = Array.isArray(lines) && lines.length > 0 && lines.some(l => l.machines && l.machines.length > 0);
            toggleLineQuantityEmptyState(!hasLines);

            if (hasLines) {
                updateLineQuantityCharts(lines, result.data.filter || {});
            } else {
                clearLineQuantityCharts();
            }
        } catch (error) {
            console.error('Error fetching line quantity analytics:', error);
            toggleLineQuantityEmptyState(true);
            clearLineQuantityCharts();
        }
    }

    function clearLineQuantityCharts() {
        if (chartConfigs.lineQuantity && chartConfigs.lineQuantity.charts) {
            Object.values(chartConfigs.lineQuantity.charts).forEach(chart => {
                if (chart && typeof chart.destroy === 'function') {
                    chart.destroy();
                }
            });
            chartConfigs.lineQuantity.charts = {};
        }
    }

    function toggleLineQuantityEmptyState(showEmpty) {
        if (lineQuantityEmptyState) {
            lineQuantityEmptyState.style.display = showEmpty ? 'flex' : 'none';
        }
        if (quantityChartsContainer) {
            quantityChartsContainer.style.display = showEmpty ? 'none' : 'block';
        }
    }

    function updateLineQuantityCharts(linesData, filterInfo) {
        if (!chartConfigs.lineQuantity || !quantityChartsContainer) return;

        if (!Array.isArray(linesData) || linesData.length === 0) {
            toggleLineQuantityEmptyState(true);
            clearLineQuantityCharts();
            return;
        }

        const filterLabel = filterInfo.filter_label || '';
        const shiftLabel = filterInfo.shift_label || '';

        toggleLineQuantityEmptyState(false);
        clearLineQuantityCharts();
        quantityChartsContainer.innerHTML = '';
        quantityChartsContainer.className = 'quantity-charts-by-line';
        quantityChartsContainer.style.display = 'grid';

        linesData.forEach((lineData) => {
            const lineName = lineData.line_name || 'Unknown';
            const machines = lineData.machines || [];
            if (machines.length === 0) return;

            const labels = machines.map(m => m.name);
            const targets = machines.map(m => Number(m.target_quantity) || 0);
            const actuals = machines.map(m => Number(m.actual_quantity) || 0);
            const actualsRegular = machines.map(m => Number(m.actual_quantity_regular) ?? Number(m.actual_quantity) ?? 0);
            const actualsOt = machines.map(m => Number(m.actual_quantity_ot) ?? 0);
            const targetsOt = machines.map(m => (m.ot_enabled && m.target_ot != null) ? Number(m.target_ot) : null);
            const hasOt = targetsOt.some(t => t != null && t > 0);

            const chartId = `lineQuantityChart_${lineName.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const card = document.createElement('div');
            card.className = 'line-quantity-chart-item';
            card.innerHTML = `
                <div class="line-chart-header">
                    <h4>Line: ${lineName}</h4>
                    <div class="line-chart-summary">${filterLabel} ${shiftLabel}</div>
                    <button class="btn btn-secondary btn-sm" data-line-export="${chartId}" type="button" title="Download Excel">
                        <i class="fas fa-file-excel"></i>
                    </button>
                </div>
                <div class="chart-wrapper" style="height: ${Math.max(200, machines.length * 32)}px;">
                    <canvas id="${chartId}"></canvas>
                </div>
            `;
            quantityChartsContainer.appendChild(card);

            const canvas = document.getElementById(chartId);
            if (!canvas) return;

            const datasets = [
                {
                    type: 'line',
                    label: 'Target',
                    data: targets,
                    borderColor: '#e67700',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0,
                    pointRadius: 5,
                    pointBackgroundColor: '#e67700',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    yAxisID: 'y'
                }
            ];
            if (hasOt) {
                datasets.push({
                    type: 'line',
                    label: 'Target OT',
                    data: targetsOt,
                    borderColor: '#d4a017',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [4, 2],
                    tension: 0,
                    pointRadius: 4,
                    pointBackgroundColor: '#d4a017',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    yAxisID: 'y'
                });
            }
            if (hasOt && actualsOt.some(v => v > 0)) {
                datasets.push({
                    type: 'bar',
                    label: 'Aktual Reguler',
                    data: actualsRegular,
                    backgroundColor: '#4c6ef5',
                    borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
                    maxBarThickness: 36,
                    stack: 'actual',
                    yAxisID: 'y'
                });
                datasets.push({
                    type: 'bar',
                    label: 'Aktual OT',
                    data: actualsOt,
                    backgroundColor: '#d4a017',
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
                    maxBarThickness: 36,
                    stack: 'actual',
                    yAxisID: 'y'
                });
            } else {
                datasets.push({
                    type: 'bar',
                    label: 'Aktual',
                    data: actuals,
                    backgroundColor: '#4c6ef5',
                    borderRadius: 6,
                    maxBarThickness: 36,
                    yAxisID: 'y'
                });
            }

            const chart = new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (evt, activeEls) => {
                        if (!activeEls.length) return;
                        const hit = activeEls[0];
                        const ds = chart.data.datasets[hit.datasetIndex];
                        const isBar = ds && ds.type === 'bar';
                        if (!isBar) return;
                        const period = (quantityPeriodSelect && quantityPeriodSelect.value) || 'daily';
                        if (period !== 'daily') {
                            alert('Pilih periode Harian untuk melihat grafik quantity per jam.');
                            return;
                        }
                        const machines = chart.quantityChartMachines;
                        const dataIndex = hit.index;
                        if (!machines || !machines[dataIndex]) return;
                        const machine = machines[dataIndex];
                        const date = (quantityDateInput && quantityDateInput.value) || moment().format('YYYY-MM-DD');
                        const shift = (quantityShiftSelect && quantityShiftSelect.value) || 'pagi';
                        openQuantityHourlyModal(
                            machine.name,
                            machine.address,
                            date,
                            shift,
                            Number(machine.target_quantity) || 0
                        );
                    },
                    plugins: {
                        legend: { display: true, position: 'top' },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    const rawValue = typeof context.parsed === 'object'
                                        ? (context.parsed.y != null ? context.parsed.y : context.parsed.x)
                                        : context.parsed;
                                    return `${context.dataset.label}: ${formatQuantityValue(rawValue)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            title: { display: false },
                            ticks: { maxRotation: 45, minRotation: 0 }
                        },
                        y: {
                            beginAtZero: true,
                            stacked: hasOt && actualsOt.some(v => v > 0),
                            title: { display: false },
                            ticks: { callback: (v) => formatQuantityValue(v) }
                        }
                    }
                }
            });

            chart.quantityChartMachines = machines;
            chart.quantityChartLineData = lineData;

            if (!chartConfigs.lineQuantity.charts) chartConfigs.lineQuantity.charts = {};
            chartConfigs.lineQuantity.charts[chartId] = chart;

            const exportBtn = card.querySelector(`[data-line-export="${chartId}"]`);
            if (exportBtn) {
                exportBtn.addEventListener('click', () => exportLineQuantityExcel(lineData, lastLineQuantityParams, lastLineQuantityFilter));
            }
        });
    }

    let quantityHourlyChartInstance = null;
    let lastQuantityHourlyData = null;
    let lastQuantityHourlyMeta = null;

    async function openQuantityHourlyModal(machineName, machineAddress, date, shift, targetPerShift) {
        const modal = document.getElementById('quantityHourlyModal');
        const titleEl = document.getElementById('quantityHourlyModalTitle');
        const emptyEl = document.getElementById('quantityHourlyChartEmpty');
        const loadingEl = document.getElementById('quantityHourlyChartLoading');
        const wrapperEl = document.getElementById('quantityHourlyChartWrapper');
        const canvas = document.getElementById('quantityHourlyChartCanvas');
        const exportBtn = document.getElementById('quantityHourlyExportBtn');
        if (!modal || !titleEl || !canvas) return;

        if (quantityHourlyChartInstance) {
            quantityHourlyChartInstance.destroy();
            quantityHourlyChartInstance = null;
        }

        titleEl.textContent = `Quantity per Jam - ${machineName}`;
        emptyEl.style.display = 'none';
        const emptyMsg = emptyEl.querySelector('p');
        if (emptyMsg) emptyMsg.textContent = 'Tidak ada data hourly untuk mesin ini pada tanggal dan shift yang dipilih.';
        wrapperEl.style.display = 'none';
        loadingEl.style.display = 'block';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.classList.add('show');

        // Reset state export
        lastQuantityHourlyData = null;
        lastQuantityHourlyMeta = null;
        if (exportBtn) {
            exportBtn.style.display = 'none';
            exportBtn.onclick = null;
        }

        try {
            const params = new URLSearchParams({ date, shift, machine_address: machineAddress });
            const res = await fetch(`/api/dashboard/analytics/quantity-hourly?${params.toString()}`, { headers: getAuthHeaders() });
            const json = await res.json();
            loadingEl.style.display = 'none';

            if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
                emptyEl.style.display = 'flex';
                wrapperEl.style.display = 'none';
                return;
            }

            lastQuantityHourlyData = json.data;
            lastQuantityHourlyMeta = {
                machineName,
                machineAddress,
                date,
                shift,
                target: Number(targetPerShift) || 0
            };

            const labels = json.data.map(d => d.snapshot_at);
            const quantities = json.data.map(d => d.quantity);
            const otEnabled = !!json.ot_enabled;

            const parseHourFromLabel = (label) => {
                if (!label) return -1;
                const s = String(label);
                const match = s.match(/(\d{1,2}):?\d{0,2}$/);
                if (match) return parseInt(match[1], 10);
                const parts = s.split(/\s+/);
                if (parts.length >= 2) {
                    const timePart = parts[1];
                    const h = parseInt(timePart.split(':')[0], 10);
                    return Number.isFinite(h) ? h : -1;
                }
                return -1;
            };

            const isPagi = shift === 'pagi';
            // Reguler: pagi sampai 15:58 (hour<=15), malam sampai 04:58 (hour>=20 atau hour<=4)
            // OT: pagi dari 16:58 (hour>=16), malam dari 05:58 (hour 5-6). Hanya jika ot_enabled.
            const isRegulerHour = (h) => {
                if (h < 0) return true;
                if (isPagi) return h <= 15;
                return h >= 20 || h <= 4;
            };
            const isOtHour = (h) => {
                if (h < 0) return false;
                if (isPagi) return h >= 16;
                return h >= 5 && h <= 6;
            };

            const dataReguler = quantities.map((q, i) => {
                const h = parseHourFromLabel(labels[i]);
                if (!otEnabled) return q; // Semua aktual reguler jika OT tidak diaktifkan
                return isRegulerHour(h) ? q : null;
            });
            const dataOt = otEnabled ? quantities.map((q, i) => {
                const h = parseHourFromLabel(labels[i]);
                return isOtHour(h) ? q : null;
            }) : null;
            const hasOtData = otEnabled && dataOt && dataOt.some(v => v != null && v > 0);

            wrapperEl.style.display = 'block';
            const ctx = canvas.getContext('2d');
            const hourlyDatasets = [
                {
                    label: otEnabled ? 'Aktual Reguler' : 'Quantity',
                    data: dataReguler,
                    borderColor: '#4c6ef5',
                    backgroundColor: 'rgba(76, 110, 245, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#4c6ef5',
                    segment: { borderColor: '#4c6ef5' }
                }
            ];
            if (hasOtData && dataOt) {
                hourlyDatasets.push({
                    label: 'Aktual OT',
                    data: dataOt,
                    borderColor: '#d4a017',
                    backgroundColor: 'rgba(212, 160, 23, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#d4a017',
                    segment: { borderColor: '#d4a017' }
                });
            }

            quantityHourlyChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: hourlyDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'top' },
                        tooltip: {
                            callbacks: {
                                label(c) { return `Quantity: ${formatQuantityValue(c.parsed.y)}`; }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            title: { display: true, text: 'Waktu' },
                            ticks: { maxRotation: 45, minRotation: 0 }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Quantity' },
                            ticks: { callback: v => formatQuantityValue(v) }
                        }
                    }
                }
            });

            if (exportBtn) {
                exportBtn.style.display = 'inline-flex';
                exportBtn.onclick = () => exportQuantityHourlyExcel();
            }
        } catch (err) {
            console.error('Fetch quantity hourly:', err);
            loadingEl.style.display = 'none';
            emptyEl.style.display = 'flex';
            emptyEl.querySelector('p').textContent = 'Gagal memuat data. Coba lagi.';
        }
    }

    function closeQuantityHourlyModal() {
        const modal = document.getElementById('quantityHourlyModal');
        if (quantityHourlyChartInstance) {
            quantityHourlyChartInstance.destroy();
            quantityHourlyChartInstance = null;
        }
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
    }

    (function initQuantityHourlyModal() {
        const closeBtn = document.getElementById('quantityHourlyModalClose');
        const modal = document.getElementById('quantityHourlyModal');
        if (closeBtn) closeBtn.addEventListener('click', closeQuantityHourlyModal);
        if (modal) {
            modal.addEventListener('click', (e) => { if (e.target === modal) closeQuantityHourlyModal(); });
        }
    })();

    function exportQuantityHourlyExcel() {
        if (!lastQuantityHourlyData || !Array.isArray(lastQuantityHourlyData) || !lastQuantityHourlyData.length) {
            alert('Tidak ada data hourly untuk diunduh.');
            return;
        }
        const meta = lastQuantityHourlyMeta || {};
        const shiftRaw = meta.shift || 'pagi';
        const shiftLabel = shiftRaw === 'malam' ? 'Malam' : 'Pagi';
        const ts = meta.date || '-';
        const target = Number(meta.target) || 0;

        const rows = [];
        let id = 1;
        lastQuantityHourlyData.forEach(d => {
            rows.push([
                id++,
                meta.machineName || '-',
                shiftLabel,
                d.snapshot_at || '-',
                target,
                Number(d.quantity) || 0
            ]);
        });
        if (!rows.length) {
            alert('Tidak ada data hourly untuk diunduh.');
            return;
        }
        const headers = ['ID', 'Nama Mesin', 'Shift', 'Timestamp', 'Quantity Target', 'Quantity Aktual'];
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'QuantityHourly');
        const safeName = (meta.machineName || 'mesin').toString().replace(/\s+/g, '_');
        const fileName = `quantity_hourly_${safeName}_${ts}_${shiftLabel}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    function exportLineQuantityExcel(lineData, params, filterInfo) {
        if (!lineData || !Array.isArray(lineData.machines)) {
            alert('Data tidak tersedia untuk line ini.');
            return;
        }
        const period = params?.period || 'daily';
        const ts = (period === 'daily')
            ? (params?.date || '-')
            : (filterInfo?.filter_label || '-');
        const shiftRaw = params?.shift || 'pagi';
        const shiftLabel = shiftRaw === 'malam' ? 'Malam' : 'Pagi';

        const rows = [];
        let id = 1;
        lineData.machines.forEach(m => {
            rows.push([
                id++,
                m.name || '-',
                shiftLabel,
                ts,
                Number(m.target_quantity) || 0,
                Number(m.actual_quantity) || 0
            ]);
        });
        if (!rows.length) {
            alert('Tidak ada data untuk diunduh.');
            return;
        }
        const headers = ['ID', 'Nama Mesin', 'Shift', 'Timestamp', 'Quantity Target', 'Quantity Aktual'];
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Quantity');
        const fileName = `quantity_line_${(lineData.line_name || 'line').replace(/\\s+/g, '_')}_${ts.replace(/\\s+/g, '_')}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    // Fungsi untuk memperbarui semua elemen UI
    function updateUI(data) {
        if (!showCharts) return;
        
        // Update KPI Cards (hanya jika elemen ada)
        const kpiTotalProblems = document.getElementById('kpi-total-problems');
        const kpiTotalDowntime = document.getElementById('kpi-total-downtime');
        const kpiMttr = document.getElementById('kpi-mttr');
        const kpiWorstMachine = document.getElementById('kpi-worst-machine');
        
        if (kpiTotalProblems) kpiTotalProblems.textContent = data.kpis.total_problems;
        if (kpiTotalDowntime) kpiTotalDowntime.textContent = formatSeconds(data.kpis.total_downtime_seconds);
        if (kpiMttr) kpiMttr.textContent = formatSeconds(data.kpis.average_resolution_time_seconds);
        if (kpiWorstMachine) kpiWorstMachine.textContent = data.kpis.most_problematic_machine;

        // Update Charts (hanya jika chart configs ada)
        if (chartConfigs.frequency) {
            updateChart(chartConfigs.frequency, data.problemFrequency.labels, data.problemFrequency.data);
        }
        if (chartConfigs.downtime) {
            updateChart(chartConfigs.downtime, data.downtime.labels, data.downtime.data.map(s => (s / 60).toFixed(2)), 'Downtime (menit)');
        }
        if (chartConfigs.problemType) {
            updateChart(chartConfigs.problemType, data.problemTypes.labels, data.problemTypes.data);
        }
        if (chartConfigs.mttr) {
            updateChart(chartConfigs.mttr, data.mttr.labels, data.mttr.data.map(s => (s / 60).toFixed(2)), 'MTTR (menit)');
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
                lastSelectedRange = { start: startDate, end: endDate };
                fetchAnalyticsData(startDate, endDate);
                if (showTables) {
                    fetchTicketingData(startDate, endDate);
                }
            });
        },
    });

    // Load divisions for global selector (from divisions-lines API)
    async function loadGlobalDivisions() {
        if (!globalDivisionSelect) return;

        // Manager: hanya boleh melihat divisinya sendiri
        if (userRole === 'manager' && userDivision) {
            globalDivisionSelect.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = userDivision;
            opt.textContent = userDivision;
            globalDivisionSelect.appendChild(opt);
            globalDivisionSelect.value = userDivision;
            globalDivisionSelect.disabled = true;
            return;
        }

        try {
            const resp = await fetch('/api/divisions-lines', { credentials: 'include', headers: getAuthHeaders() });
            if (!resp.ok) return;
            const json = await resp.json();
            const divisions = (json.success && json.data && Array.isArray(json.data)) ? json.data : [];
            const divisionNames = divisions.map(d => (d && d.name) ? d.name : String(d));
            globalDivisionSelect.innerHTML = '<option value="">Semua Divisi</option>';
            divisionNames.filter(Boolean).forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                globalDivisionSelect.appendChild(opt);
            });
            if (divisionNames.length > 0) {
                globalDivisionSelect.value = divisionNames[0];
            }
        } catch (e) {
            console.warn('Could not load divisions:', e);
            globalDivisionSelect.innerHTML = '<option value="">Semua Divisi</option>';
        }
    }

    if (globalDivisionSelect) {
        globalDivisionSelect.addEventListener('change', function() {
            const [start, end] = getEnsuredDateRange();
            fetchAnalyticsData(start, end);
            if (showTables) fetchTicketingData(start, end);
            if (showCharts) fetchLineQuantityAnalytics();
        });
    }

    if (quantityPeriodSelect) {
        quantityPeriodSelect.addEventListener('change', function() {
            updateQuantityPeriodVisibility();
            fetchLineQuantityAnalytics();
        });
    }

    if (quantityDateInput) {
        quantityDateInput.addEventListener('change', fetchLineQuantityAnalytics);
    }

    if (quantityMonthInput) {
        quantityMonthInput.addEventListener('change', fetchLineQuantityAnalytics);
    }

    if (quantityYearInput) {
        quantityYearInput.addEventListener('change', fetchLineQuantityAnalytics);
    }

    if (quantityShiftSelect) {
        quantityShiftSelect.addEventListener('change', fetchLineQuantityAnalytics);
    }

    // Helper untuk mengambil rentang tanggal yang sedang dipilih
    function getCurrentDateRange() {
        const dates = picker.getDateRange ? picker.getDateRange() : picker.getDate();
        if (dates && dates.start && dates.end) {
            return [moment(dates.start).format('YYYY-MM-DD'), moment(dates.end).format('YYYY-MM-DD')];
        }
        if (Array.isArray(dates) && dates.length === 2) {
            return [moment(dates[0]).format('YYYY-MM-DD'), moment(dates[1]).format('YYYY-MM-DD')];
        }
        if (lastSelectedRange && lastSelectedRange.start && lastSelectedRange.end) {
            return [lastSelectedRange.start, lastSelectedRange.end];
        }
        return null;
    }

    function getEnsuredDateRange() {
        const range = getCurrentDateRange();
        if (range) {
            return range;
        }
        const fallbackStart = lastSelectedRange?.start || moment().subtract(29, 'days').format('YYYY-MM-DD');
        const fallbackEnd = lastSelectedRange?.end || moment().format('YYYY-MM-DD');
        return [fallbackStart, fallbackEnd];
    }
    
    // Expose to window for global access
    window.getCurrentDateRange = getCurrentDateRange;

    // Global variables untuk tabel forward analytics
    let forwardTableData = [];
    let currentDisplayedData = [];
    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let forwardSearchInitialized = false;
    let forwardPageSize = 10;

    // Global variables untuk tabel ticketing analytics
    let ticketingTableData = [];
    let currentTicketingDisplayedData = [];
    let currentTicketingSortColumn = null;
    let currentTicketingSortDirection = 'asc';
    let ticketingSearchInitialized = false;
    let ticketingPageSize = 10;

    let ticketingEditHandlerAttached = false;

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
        const dataArray = Array.isArray(data) ? data : [];
        currentDisplayedData = dataArray;
        const visibleData = dataArray.slice(0, forwardPageSize || 10);
        
        tableBody.innerHTML = visibleData.map(problem => {
            const flowTypeClass = problem.flow_type.toLowerCase().replace(/\s+/g, '-');
            const problemTypeClass = problem.problem_type.toLowerCase();
            const users = problem.users || {};
            const forwardedBy = users.forwarded_by && users.forwarded_by.trim() !== '' ? users.forwarded_by : '-';
            const receivedBy = users.received_by && users.received_by.trim() !== '' ? users.received_by : '-';
            const feedbackBy = users.feedback_by && users.feedback_by.trim() !== '' ? users.feedback_by : '-';
            
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
                    <td><span class="timestamp">${formatTimestampDisplay(problem.timestamps.active_at)}</span></td>
                    <td><span class="timestamp">${formatTimestampDisplay(problem.timestamps.forwarded_at)}</span></td>
                    <td><span class="timestamp">${formatTimestampDisplay(problem.timestamps.received_at)}</span></td>
                    <td><span class="timestamp">${formatTimestampDisplay(problem.timestamps.feedback_resolved_at)}</span></td>
                    <td><span class="timestamp">${formatTimestampDisplay(problem.timestamps.final_resolved_at)}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.active_to_forward)}">${problem.durations_formatted.active_to_forward}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.forward_to_receive)}">${problem.durations_formatted.forward_to_receive}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.receive_to_feedback)}">${problem.durations_formatted.receive_to_feedback}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.feedback_to_final)}">${problem.durations_formatted.feedback_to_final}</span></td>
                    <td><span class="duration ${getDurationClass(problem.durations_minutes.total_duration)}">${problem.durations_formatted.total_duration}</span></td>
                    <td>
                        <div class="user-info">
                            <div><strong>Forward:</strong> ${forwardedBy}</div>
                            <div><strong>Receive:</strong> ${receivedBy}</div>
                            <div><strong>Feedback:</strong> ${feedbackBy}</div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Fungsi untuk setup search pada tabel forward analytics
    function setupForwardTableSearch() {
        if (forwardSearchInitialized) return;
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
        forwardSearchInitialized = true;
    }

    // Fungsi untuk setup search pada tabel ticketing analytics
    function setupTicketingTableSearch() {
        if (ticketingSearchInitialized) return;
        const searchInput = document.getElementById('ticketing-table-search');
        if (!searchInput) return;
        
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const baseData = ticketingTableData || [];
            const filteredData = baseData.filter(ticketing => {
                const machineValue = (
                    ticketing.machine_display_name ||
                    ticketing.machine_name ||
                    ticketing.machine ||
                    ticketing.machine_identifier ||
                    ''
                ).toString().toLowerCase();
                const problemTypeValue = (ticketing.problem_type || '').toLowerCase();
                const picValue = (ticketing.pic_technician || '').toLowerCase();
                const statusValue = (ticketing.status || '').toLowerCase();
                return ticketing.id.toString().includes(searchTerm) ||
                       ticketing.problem_id.toString().includes(searchTerm) ||
                       machineValue.includes(searchTerm) ||
                       problemTypeValue.includes(searchTerm) ||
                       picValue.includes(searchTerm) ||
                       statusValue.includes(searchTerm);
            });
            updateTicketingTable(filteredData, { skipBaseUpdate: true });
        });
        ticketingSearchInitialized = true;
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
                    const normalizeMachineValue = (entry) => (
                        entry.machine_display_name ||
                        entry.machine_name ||
                        entry.machine ||
                        entry.machine_identifier ||
                        ''
                    ).toString().toLowerCase();
            
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
                            aVal = normalizeMachineValue(a);
                            bVal = normalizeMachineValue(b);
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
            
                updateTicketingTable(sortedData, { skipBaseUpdate: true });
            });
        });

        // Setup sorting untuk teknisi PIC table
        const teknisiPicSortableHeaders = document.querySelectorAll('.teknisi-pic-table th.sortable');
        
        teknisiPicSortableHeaders.forEach(header => {
            header.addEventListener('click', function() {
                const column = this.dataset.column;
            
                // Toggle sort direction
                if (currentTeknisiPicSortColumn === column) {
                    currentTeknisiPicSortDirection = currentTeknisiPicSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentTeknisiPicSortDirection = 'asc';
                }
                currentTeknisiPicSortColumn = column;
            
                // Update header classes
                teknisiPicSortableHeaders.forEach(h => {
                    h.classList.remove('asc', 'desc');
                });
                this.classList.add(currentTeknisiPicSortDirection);
            
                // Sort data berdasarkan data yang sedang ditampilkan sekarang
                const baseData = currentTeknisiPicDisplayedData && currentTeknisiPicDisplayedData.length > 0 ? currentTeknisiPicDisplayedData : teknisiPicTableData;
                const sortedData = [...baseData].sort((a, b) => {
                    let aVal, bVal;
            
                    switch (column) {
                        case 'id':
                            aVal = a.id || 0;
                            bVal = b.id || 0;
                            break;
                        case 'nama':
                            aVal = (a.nama || '').toLowerCase();
                            bVal = (b.nama || '').toLowerCase();
                            break;
                        case 'departement':
                            aVal = (a.departement || '').toLowerCase();
                            bVal = (b.departement || '').toLowerCase();
                            break;
                        default:
                            return 0;
                    }
            
                    if (aVal < bVal) return currentTeknisiPicSortDirection === 'asc' ? -1 : 1;
                    if (aVal > bVal) return currentTeknisiPicSortDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            
                renderTeknisiPicTable(sortedData);
            });
        });
    }

    function setupPageSizeControls() {
        const forwardPageSizeSelect = document.getElementById('forward-table-page-size');
        if (forwardPageSizeSelect) {
            forwardPageSizeSelect.value = forwardPageSize.toString();
            forwardPageSizeSelect.addEventListener('change', () => {
                forwardPageSize = parseInt(forwardPageSizeSelect.value, 10) || 10;
                const baseData = currentDisplayedData && currentDisplayedData.length > 0 ? currentDisplayedData : forwardTableData;
                renderForwardTable(baseData);
            });
        }

        const ticketingPageSizeSelect = document.getElementById('ticketing-table-page-size');
        if (ticketingPageSizeSelect) {
            ticketingPageSizeSelect.value = ticketingPageSize.toString();
            ticketingPageSizeSelect.addEventListener('change', () => {
                ticketingPageSize = parseInt(ticketingPageSizeSelect.value, 10) || 10;
                const baseData = currentTicketingDisplayedData && currentTicketingDisplayedData.length > 0 ? currentTicketingDisplayedData : ticketingTableData;
                updateTicketingTable(baseData, { skipBaseUpdate: true });
            });
        }
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
        const tableData = exportData.map(problem => {
            const users = problem.users || {};
            return [
                problem.problem_id,
                problem.machine,
                problem.problem_type,
                problem.flow_type,
                formatTimestampDisplay(problem.timestamps.active_at),
                formatTimestampDisplay(problem.timestamps.forwarded_at),
                formatTimestampDisplay(problem.timestamps.received_at),
                formatTimestampDisplay(problem.timestamps.feedback_resolved_at),
                formatTimestampDisplay(problem.timestamps.final_resolved_at),
                problem.durations_formatted.active_to_forward,
                problem.durations_formatted.forward_to_receive,
                problem.durations_formatted.receive_to_feedback,
                problem.durations_formatted.feedback_to_final,
                problem.durations_formatted.total_duration,
                `${users.forwarded_by || '-'} | ${users.received_by || '-'} | ${users.feedback_by || '-'}`
            ];
        });

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
        if (startDate && endDate) {
            lastSelectedRange = { start: startDate, end: endDate };
        }
        const division = getSelectedDivision();
        const ticketingParams = new URLSearchParams({ start_date: startDate, end_date: endDate });
        if (division) ticketingParams.set('division', division);
        try {
            const response = await fetch(`/api/dashboard/analytics/ticketing?${ticketingParams.toString()}`, {
                headers: getAuthHeaders()
            });
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
    
    // Expose to window for global access
    window.fetchTicketingData = fetchTicketingData;

    // Fungsi untuk update tabel ticketing
    function updateTicketingTable(ticketingData, options = {}) {
        const { skipBaseUpdate = false } = options;
        const tbody = document.getElementById('ticketing-analytics-table-body');
        const emptyState = document.getElementById('ticketing-table-empty-state');

        if (!tbody) return;

        if (!skipBaseUpdate) {
            ticketingTableData = ticketingData || [];
        }

        const dataset = Array.isArray(ticketingData) ? [...ticketingData] : [];
        currentTicketingDisplayedData = dataset;

        tbody.innerHTML = '';

        if (dataset.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        const visibleData = dataset.slice(0, ticketingPageSize || 10);

        visibleData.forEach(ticketing => {
            // Prioritaskan nama mesin, jangan gunakan machine_identifier (address) sebagai fallback
            // Backend seharusnya sudah mengembalikan nama mesin di field 'machine'
            const machineName =
                (
                    ticketing.machine_display_name ||
                    ticketing.machine_name ||
                    ticketing.machine ||
                    ''
                ).toString().trim() || '-';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${ticketing.id}</td>
                <td>${ticketing.problem_id}</td>
                <td>${machineName}</td>
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
                <td>
                    <button class="btn-edit-ticketing" type="button" title="Edit ticketing" aria-label="Edit ticketing" data-ticketing-id="${ticketing.id}">
                        <i class="fas fa-edit" aria-hidden="true"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        if (!ticketingEditHandlerAttached) {
            tbody.addEventListener('click', function(e) {
                if (e.target.closest('.btn-edit-ticketing')) {
                    const btn = e.target.closest('.btn-edit-ticketing');
                    const ticketingId = btn.getAttribute('data-ticketing-id');
                    if (ticketingId) {
                        // Use window function to ensure it's accessible
                        const openModal = window.openEditTicketingModal || openEditTicketingModal;
                        if (typeof openModal === 'function') {
                            openModal(ticketingId);
                        } else {
                            console.error('openEditTicketingModal function not found');
                            alert('Fungsi edit tidak tersedia. Silakan refresh halaman.');
                        }
                    }
                }
            });
            ticketingEditHandlerAttached = true;
        }

        if (!ticketingSearchInitialized) {
            setupTicketingTableSearch();
        }
    }

    // Fungsi untuk export ticketing table ke Excel
    function exportTicketingTableToExcel() {
        const exportData = (currentTicketingDisplayedData && currentTicketingDisplayedData.length > 0)
            ? currentTicketingDisplayedData
            : ticketingTableData;

        if (!exportData || exportData.length === 0) {
            alert('Tidak ada data untuk diekspor');
            return;
        }

        // Prepare data untuk Excel dengan menambahkan kolom diagnosis dan result_repair
        const excelData = exportData.map(ticketing => {
            const machineName = (
                ticketing.machine_display_name ||
                ticketing.machine_name ||
                ticketing.machine ||
                ticketing.machine_identifier ||
                ''
            ).toString().trim();
            return [
                ticketing.id || '',
                ticketing.problem_id || '',
                machineName || '',
                ticketing.problem_type || '',
                ticketing.pic_technician || '',
                ticketing.status_label || '',
                ticketing.timestamps?.problem_received_at || '-',
                ticketing.timestamps?.diagnosis_started_at || '-',
                ticketing.timestamps?.repair_started_at || '-',
                ticketing.timestamps?.repair_completed_at || '-',
                ticketing.durations?.downtime || '-',
                ticketing.durations?.mttr || '-',
                ticketing.durations?.mttd || '-',
                ticketing.timestamps?.created_at || '-',
                ticketing.diagnosis || '', // Kolom diagnosis (hanya di export)
                ticketing.result_repair || '' // Kolom result repair (hanya di export)
            ];
        });

        // Header dengan kolom tambahan
        const headers = [
            'Ticketing ID',
            'Problem ID',
            'Mesin',
            'Tipe Problem',
            'PIC/Teknisi',
            'Status',
            'Problem Received',
            'Diagnosis Started',
            'Repair Started',
            'Repair Completed',
            'Downtime',
            'MTTR',
            'MTTD',
            'Created At',
            'Diagnosis', // Kolom diagnosis
            'Result Repair' // Kolom result repair
        ];

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet([headers, ...excelData]);

        // Set column widths
        const colWidths = [
            { wch: 12 }, // Ticketing ID
            { wch: 12 }, // Problem ID
            { wch: 15 }, // Mesin
            { wch: 15 }, // Tipe Problem
            { wch: 15 }, // PIC/Teknisi
            { wch: 12 }, // Status
            { wch: 20 }, // Problem Received
            { wch: 20 }, // Diagnosis Started
            { wch: 20 }, // Repair Started
            { wch: 20 }, // Repair Completed
            { wch: 15 }, // Downtime
            { wch: 12 }, // MTTR
            { wch: 12 }, // MTTD
            { wch: 20 }, // Created At
            { wch: 30 }, // Diagnosis (lebih lebar untuk teks panjang)
            { wch: 30 }  // Result Repair (lebih lebar untuk teks panjang)
        ];
        ws['!cols'] = colWidths;

        // Style header row
        const headerRange = XLSX.utils.decode_range(ws['!ref']);
        for (let C = 0; C <= headerRange.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[cellAddress]) continue;
            ws[cellAddress].s = {
                font: { bold: true },
                fill: { fgColor: { rgb: "E0E0E0" } },
                alignment: { horizontal: "center", vertical: "center" }
            };
        }

        // Create workbook
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
            const [start, end] = getEnsuredDateRange();
            fetchAnalyticsData(start, end);
            if (showCharts) fetchLineQuantityAnalytics();
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
            const [start, end] = getEnsuredDateRange();
            fetchTicketingData(start, end);
        });
    }

    // Teknisi PIC Management (only for admin)
    if (userRole === 'admin') {
        // Load teknisi PIC data on page load
        loadTeknisiPicData();

        // Event listeners for teknisi PIC buttons
        const addTeknisiPicBtn = document.getElementById('add-teknisi-pic-btn');
        const refreshTeknisiPicBtn = document.getElementById('refresh-teknisi-pic-btn');

        if (addTeknisiPicBtn) {
            addTeknisiPicBtn.addEventListener('click', function() {
                openTeknisiPicModal();
            });
        }

        if (refreshTeknisiPicBtn) {
            refreshTeknisiPicBtn.addEventListener('click', function() {
                loadTeknisiPicData();
            });
        }
    }

    setupPageSizeControls();

    // Setup table sorting
    setupTableSorting();

    // Panggilan data awal saat halaman dimuat (untuk 30 hari terakhir)
    const thirtyDaysAgo = moment().subtract(29, 'days').format('YYYY-MM-DD');
    const today = moment().format('YYYY-MM-DD');
    picker.setDateRange(thirtyDaysAgo, today);
    lastSelectedRange = { start: thirtyDaysAgo, end: today };

    (async function initAnalytics() {
        await loadGlobalDivisions();
        fetchAnalyticsData(thirtyDaysAgo, today);
        if (showTables) {
            fetchTicketingData(thirtyDaysAgo, today);
        }
        if (showCharts) {
            updateQuantityPeriodVisibility();
            if (quantityDateInput) quantityDateInput.value = moment().format('YYYY-MM-DD');
            if (quantityMonthInput) quantityMonthInput.value = moment().format('YYYY-MM');
            if (quantityYearInput) quantityYearInput.value = moment().format('YYYY');
            fetchLineQuantityAnalytics();
        }
    })();
});

// Helper function to get cookie value (global scope)
function getCookieValue(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Helper function to get authentication headers (global scope)
function getAuthHeadersGlobal() {
    const token = getCookieValue('auth_token');
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
}

// Function to create edit ticketing modal if it doesn't exist
function ensureEditTicketingModalExists() {
    let modal = document.getElementById('editTicketingModal');
    
    if (!modal) {
        // Create modal structure
        modal = document.createElement('div');
        modal.id = 'editTicketingModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        
        modal.innerHTML = `
            <div class="modal-content edit-ticketing-modal-content">
                <div class="modal-header">
                    <h3>Edit Ticketing Problem</h3>
                    <button class="modal-close" onclick="closeEditTicketingModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="editTicketingForm">
                        <input type="hidden" id="editTicketingId" name="ticketing_id">
                        
                        <div class="form-group">
                            <label for="editDiagnosis">Diagnosa/Analisis Masalah:</label>
                            <textarea id="editDiagnosis" name="diagnosis" rows="6" placeholder="Jelaskan diagnosa atau analisis masalah yang terjadi..." required></textarea>
                        </div>
                        
                        <div class="form-group" style="margin-top: 15px;">
                            <label for="editResultRepair">Result/Perbaikan yang Dilakukan:</label>
                            <textarea id="editResultRepair" name="result_repair" rows="6" placeholder="Jelaskan perbaikan yang telah dilakukan..."></textarea>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeEditTicketingModal()">Batal</button>
                    <button class="btn btn-primary" onclick="submitEditTicketingForm()">Simpan Perubahan</button>
                </div>
            </div>
        `;
        
        // Append to body
        document.body.appendChild(modal);
        console.log('Edit ticketing modal created dynamically');
    }
    
    return modal;
}

// Function to wait for element to be available
function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
        // Check immediately first
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }

        // If document is not ready, wait for it
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                } else {
                    reject(new Error(`Element ${selector} not found after DOMContentLoaded`));
                }
            });
            return;
        }

        // Use MutationObserver to watch for element
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            // Final check
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
            } else {
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }
        }, timeout);
    });
}

// Function to open edit ticketing modal
async function openEditTicketingModal(ticketingId) {
    try {
        const headers = getAuthHeadersGlobal();
        const response = await fetch(`/api/ticketing/${ticketingId}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error('Failed to fetch ticketing data');
        }

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch ticketing data');
        }

        const ticketing = result.data;
        
        // Ensure modal exists (create if needed)
        const editTicketingModalEl = ensureEditTicketingModalExists();
        
        // Get form elements - query from modal directly to ensure we get them
        let editTicketingIdEl = editTicketingModalEl.querySelector('#editTicketingId');
        let editDiagnosisEl = editTicketingModalEl.querySelector('#editDiagnosis');
        let editResultRepairEl = editTicketingModalEl.querySelector('#editResultRepair');
        
        // If elements still not found, try getElementById as fallback
        if (!editTicketingIdEl) editTicketingIdEl = document.getElementById('editTicketingId');
        if (!editDiagnosisEl) editDiagnosisEl = document.getElementById('editDiagnosis');
        if (!editResultRepairEl) editResultRepairEl = document.getElementById('editResultRepair');
        
        // If elements still not found after ensuring modal exists, wait a bit for DOM to update
        if (!editTicketingIdEl || !editDiagnosisEl || !editResultRepairEl) {
            // Wait a moment for DOM to update
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Try again
            editTicketingIdEl = editTicketingModalEl.querySelector('#editTicketingId') || document.getElementById('editTicketingId');
            editDiagnosisEl = editTicketingModalEl.querySelector('#editDiagnosis') || document.getElementById('editDiagnosis');
            editResultRepairEl = editTicketingModalEl.querySelector('#editResultRepair') || document.getElementById('editResultRepair');
            
            // If still not found, there's a real problem
            if (!editTicketingIdEl || !editDiagnosisEl || !editResultRepairEl) {
                console.error('Form elements not found even after creating modal:', {
                    editTicketingId: !!editTicketingIdEl,
                    editDiagnosis: !!editDiagnosisEl,
                    editResultRepair: !!editResultRepairEl,
                    modalExists: !!editTicketingModalEl,
                    modalHasContent: editTicketingModalEl ? editTicketingModalEl.innerHTML.length > 0 : false
                });
                throw new Error('Form elements tidak ditemukan. Silakan refresh halaman dan coba lagi.');
            }
        }
        
        // Fill form with current data
        editTicketingIdEl.value = ticketing.id;
        editDiagnosisEl.value = ticketing.diagnosis || '';
        editResultRepairEl.value = ticketing.result_repair || '';
        
        // Show modal - ensure it's centered
        editTicketingModalEl.style.display = 'flex';
        editTicketingModalEl.style.alignItems = 'center';
        editTicketingModalEl.style.justifyContent = 'center';
    } catch (error) {
        console.error('Error opening edit modal:', error);
        alert('Gagal memuat data ticketing: ' + error.message);
    }
}

// Expose functions to window for global access
window.openEditTicketingModal = openEditTicketingModal;

// Function to close edit ticketing modal
function closeEditTicketingModal() {
    const modal = document.getElementById('editTicketingModal');
    const form = document.getElementById('editTicketingForm');
    
    if (modal) {
        modal.style.display = 'none';
    }
    
    if (form) {
        form.reset();
}
}

// Expose functions to window for global access
window.closeEditTicketingModal = closeEditTicketingModal;

// Function to submit edit ticketing form
async function submitEditTicketingForm() {
    try {
        const form = document.getElementById('editTicketingForm');
        
        if (!form) {
            throw new Error('Form tidak ditemukan');
        }
        
        const formData = new FormData(form);
        
        const data = {
            diagnosis: formData.get('diagnosis'),
            result_repair: formData.get('result_repair') || ''
        };
        
        // Validate required fields - diagnosis is required, result_repair is optional
        if (!data.diagnosis || !data.diagnosis.trim()) {
            alert('Mohon isi field Diagnosa/Analisis Masalah');
            return;
        }
        
        const ticketingId = formData.get('ticketing_id');
        
        if (!ticketingId) {
            throw new Error('Ticketing ID tidak ditemukan');
        }
        
        const headers = getAuthHeadersGlobal();
        
        // Show loading
        const submitBtn = document.querySelector('#editTicketingModal .btn-primary');
        
        if (!submitBtn) {
            throw new Error('Tombol submit tidak ditemukan');
        }
        
        const originalText = submitBtn.textContent;
        submitBtn.setAttribute('data-original-text', originalText);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan...';
        
        let response;
        let result;
        
        try {
            response = await fetch(`/api/ticketing/${ticketingId}`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(data)
        });

            result = await response.json();
        } finally {
            // Always reset button state
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        }
        
        if (result.success) {
            alert('Ticketing berhasil diupdate');
            closeEditTicketingModal();
            
            // Refresh ticketing table - use window object to access functions from DOMContentLoaded scope
            if (window.getCurrentDateRange && window.fetchTicketingData) {
                const range = window.getCurrentDateRange();
                if (range) {
                    window.fetchTicketingData(range[0], range[1]);
                }
            } else {
                // Fallback: reload page if functions not available
                location.reload();
            }
        } else {
            throw new Error(result.message || 'Failed to update ticketing');
        }
    } catch (error) {
        console.error('Error updating ticketing:', error);
        alert('Gagal mengupdate ticketing: ' + error.message);
    }
}

// Expose functions to window for global access
window.submitEditTicketingForm = submitEditTicketingForm;

// ========================================
// TEKNISI PIC MANAGEMENT FUNCTIONS
// ========================================

// Load teknisi PIC data
async function loadTeknisiPicData() {
    try {
        const headers = getAuthHeadersGlobal();
        const response = await fetch('/api/teknisi-pic', {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error('Failed to fetch teknisi PIC data');
        }

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch teknisi PIC data');
        }

        const teknisiPics = result.data || [];
        teknisiPicTableData = teknisiPics;
        currentTeknisiPicDisplayedData = teknisiPics;
        renderTeknisiPicTable(teknisiPics);
    } catch (error) {
        console.error('Error loading teknisi PIC data:', error);
        const tbody = document.getElementById('teknisi-pic-table-body');
        const emptyState = document.getElementById('teknisi-pic-empty-state');
        
        if (tbody) {
            tbody.innerHTML = '';
        }
        
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Error</h4>
                <p>Gagal memuat data teknisi PIC: ${error.message}</p>
            `;
        }
    }
}

// Render teknisi PIC table
function renderTeknisiPicTable(teknisiPics) {
    const tbody = document.getElementById('teknisi-pic-table-body');
    const emptyState = document.getElementById('teknisi-pic-empty-state');
    
    if (!tbody) return;
    
    // Update displayed data
    currentTeknisiPicDisplayedData = teknisiPics || [];
    
    if (!teknisiPics || teknisiPics.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        return;
    }
    
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    // Format departement name
    const formatDepartement = (dept) => {
        const deptMap = {
            'maintenance': 'Maintenance',
            'quality': 'Quality',
            'engineering': 'Engineering'
        };
        return deptMap[dept] || dept;
    };
    
    tbody.innerHTML = teknisiPics.map(teknisi => `
        <tr>
            <td>${teknisi.id || '-'}</td>
            <td>${teknisi.nama || '-'}</td>
            <td><span class="departement-badge ${teknisi.departement || ''}">${formatDepartement(teknisi.departement || '')}</span></td>
            <td>
                <button class="btn-edit" onclick="editTeknisiPic(${teknisi.id})" title="Edit" aria-label="Edit teknisi PIC">
                    <i class="fas fa-edit" aria-hidden="true"></i>
                </button>
                <button class="btn-delete" onclick="deleteTeknisiPic(${teknisi.id}, '${(teknisi.nama || '').replace(/'/g, "\\'")}')" title="Hapus" aria-label="Hapus teknisi PIC">
                    <i class="fas fa-trash" aria-hidden="true"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Open teknisi PIC modal (for add or edit)
function openTeknisiPicModal(id = null) {
    const modal = document.getElementById('teknisiPicModal');
    const title = document.getElementById('teknisiPicModalTitle');
    const form = document.getElementById('teknisiPicForm');
    const namaInput = document.getElementById('teknisiPicNama');
    const departementInput = document.getElementById('teknisiPicDepartement');
    const idInput = document.getElementById('teknisiPicId');
    
    if (!modal || !form || !namaInput || !departementInput || !idInput) {
        console.error('Modal elements not found');
        return;
    }
    
    // Reset form
    form.reset();
    idInput.value = '';
    
    if (id) {
        // Edit mode - load data
        if (title) title.textContent = 'Edit Teknisi PIC';
        
        // Fetch data
        fetch(`/api/teknisi-pic`, {
            method: 'GET',
            headers: getAuthHeadersGlobal()
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const teknisi = result.data.find(t => t.id === id);
                if (teknisi) {
                    idInput.value = teknisi.id;
                    namaInput.value = teknisi.nama || '';
                    departementInput.value = teknisi.departement || '';
                }
            }
        })
        .catch(error => {
            console.error('Error loading teknisi data:', error);
            alert('Gagal memuat data teknisi PIC');
        });
    } else {
        // Add mode
        if (title) title.textContent = 'Tambah Teknisi PIC';
    }
    
    modal.style.display = 'flex';
    modal.classList.add('show');
}

// Close teknisi PIC modal
function closeTeknisiPicModal() {
    const modal = document.getElementById('teknisiPicModal');
    const form = document.getElementById('teknisiPicForm');
    
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
    }
    
    if (form) {
        form.reset();
    }
}

// Submit teknisi PIC form
async function submitTeknisiPicForm() {
    try {
        const form = document.getElementById('teknisiPicForm');
        const idInput = document.getElementById('teknisiPicId');
        const namaInput = document.getElementById('teknisiPicNama');
        const departementInput = document.getElementById('teknisiPicDepartement');
        const submitBtn = document.querySelector('#teknisiPicModal .btn-primary');
        
        if (!form || !namaInput || !departementInput) {
            throw new Error('Form elements not found');
        }
        
        const nama = namaInput.value.trim();
        const departement = departementInput.value;
        const id = idInput.value ? parseInt(idInput.value) : null;
        
        // Validation
        if (!nama) {
            alert('Nama wajib diisi');
            return;
        }
        
        if (!departement) {
            alert('Departement wajib dipilih');
            return;
        }
        
        const data = {
            nama: nama,
            departement: departement
        };
        
        const headers = getAuthHeadersGlobal();
        const originalText = submitBtn ? submitBtn.textContent : 'Simpan';
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan...';
        }
        
        let response;
        let result;
        
        try {
            if (id) {
                // Update
                response = await fetch(`/api/teknisi-pic/${id}`, {
                    method: 'PUT',
                    headers: headers,
                    body: JSON.stringify(data)
                });
            } else {
                // Create
                response = await fetch('/api/teknisi-pic', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(data)
                });
            }
            
            result = await response.json();
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
        
        if (result.success) {
            alert(id ? 'Teknisi PIC berhasil diperbarui' : 'Teknisi PIC berhasil ditambahkan');
            closeTeknisiPicModal();
            loadTeknisiPicData();
        } else {
            throw new Error(result.message || 'Failed to save teknisi PIC');
        }
    } catch (error) {
        console.error('Error saving teknisi PIC:', error);
        alert('Gagal menyimpan teknisi PIC: ' + error.message);
    }
}

// Edit teknisi PIC
function editTeknisiPic(id) {
    openTeknisiPicModal(id);
}

// Delete teknisi PIC
async function deleteTeknisiPic(id, nama) {
    if (!confirm(`Apakah Anda yakin ingin menghapus teknisi PIC "${nama}"?`)) {
        return;
    }
    
    try {
        const headers = getAuthHeadersGlobal();
        const response = await fetch(`/api/teknisi-pic/${id}`, {
            method: 'DELETE',
            headers: headers
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Teknisi PIC berhasil dihapus');
            loadTeknisiPicData();
        } else {
            throw new Error(result.message || 'Failed to delete teknisi PIC');
        }
    } catch (error) {
        console.error('Error deleting teknisi PIC:', error);
        alert('Gagal menghapus teknisi PIC: ' + error.message);
    }
}

// Expose functions to window for global access
window.closeTeknisiPicModal = closeTeknisiPicModal;
window.submitTeknisiPicForm = submitTeknisiPicForm;
window.editTeknisiPic = editTeknisiPic;
window.deleteTeknisiPic = deleteTeknisiPic;