// public/js/special-monitoring.js
// Machine Monitoring - Robust, Real-time Controller

document.addEventListener('DOMContentLoaded', () => {
  const connectionEl = document.getElementById('connectionStatus');
  const clockEl = document.getElementById('currentTime');
  const gridContainer = document.getElementById('spmGrid');

  const SHIFT_TZ = 'Asia/Jakarta';
  const ARC_LENGTH = 119.38; // Keliling 180 derajat untuk radius 38 (PI * 38)

  // Maps & Cache Data
  const metricsByAddress = new Map();
  const metricsByName = new Map();
  const statusByAddress = new Map();
  const statusByName = new Map();
  const chartInstances = new Map(); // chartId -> Chart.js instance

  function cleanStr(s) {
    return String(s || '').replace(/[\s\-_]/g, '').toLowerCase();
  }

  function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function getSafeId(str) {
    return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function fmtHHMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  // 1. Clock Update Real-time
  function updateClock() {
    if (!clockEl) return;
    const now = window.moment && moment.tz ? moment.tz(SHIFT_TZ) : (window.moment ? moment() : new Date());
    if (window.moment) {
      clockEl.textContent = now.format('HH:mm:ss');
    } else {
      const d = new Date();
      clockEl.textContent = d.toLocaleTimeString('id-ID', { hour12: false });
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // 2. Status Koneksi
  function setConnection(ok) {
    if (!connectionEl) return;
    const span = connectionEl.querySelector('span');
    const icon = connectionEl.querySelector('i');
    if (ok) {
      connectionEl.classList.remove('disconnected');
      if (span) span.textContent = 'Connected';
      if (icon) icon.className = 'fas fa-wifi';
    } else {
      connectionEl.classList.add('disconnected');
      if (span) span.textContent = 'Disconnected';
      if (icon) icon.className = 'fas fa-wifi-slash';
    }
  }

  // 3. Shift Info Helper
  function getShiftInfo() {
    const now = window.moment && moment.tz ? moment.tz(SHIFT_TZ) : moment();
    const h = now.hour();
    let shift = (h >= 7 && h < 20) ? 'pagi' : 'malam';
    let dateStr = now.format('YYYY-MM-DD');
    if (shift === 'malam' && h < 7) {
      dateStr = now.clone().subtract(1, 'day').format('YYYY-MM-DD');
    }
    return { shift, dateStr };
  }

  // 4. Parse Daftar Mesin dari URL (Immediate Turn-0 Parsing)
  function parseRequestedMachines() {
    const urlParams = new URLSearchParams(window.location.search);
    const q = urlParams.get('machines') || urlParams.get('machine') || urlParams.get('names');
    if (q) {
      const arr = q.split(',').map(m => m.trim()).filter(Boolean);
      if (arr.length > 0) return arr;
    }
    const bodyData = document.body && document.body.dataset && document.body.dataset.machines;
    if (bodyData) {
      try {
        const parsed = JSON.parse(bodyData);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    // Default fallback jika tanpa parameter
    return ['NIP2 01', 'NIP2 02', 'NIP2 03'];
  }

  let requestedMachines = parseRequestedMachines();

  // 5. Render Kartu Mesin ke DOM (Segera & Anti-Stuck)
  function renderCards(machineList) {
    if (!gridContainer) return;
    const count = machineList.length;
    let colClass = 'cols-3';
    if (count === 1) colClass = 'cols-1';
    else if (count === 2) colClass = 'cols-2';
    else colClass = 'cols-3';

    gridContainer.className = `spm-grid ${colClass}`;
    gridContainer.innerHTML = '';

    machineList.forEach((mName) => {
      const safeId = getSafeId(mName);
      const card = document.createElement('div');
      card.className = 'spm-card';
      card.id = `spm_card_${safeId}`;
      card.setAttribute('data-machinename', mName);

      card.innerHTML = `
        <!-- Header Kartu Mesin -->
        <div class="spm-card-header">
          <div class="spm-machine-title">
            <span class="spm-status-dot standby" id="spm_dot_${safeId}"></span>
            <span class="spm-machine-name">${mName}</span>
          </div>
          <div class="spm-header-tags">
            <span class="spm-badge status-running" id="spm_badge_status_${safeId}">STANDBY</span>
            <span class="spm-badge line-tag" id="spm_badge_line_${safeId}">Line -</span>
          </div>
        </div>

        <!-- Body Kartu Mesin: 2 Kolom (Kiri Lebih Lebar untuk Gauges & Chart, Kanan Lebih Ramping untuk Tabel) -->
        <div class="spm-card-body">
          <!-- SISI KIRI: Gauges & 2 Chart (OEE & 3 Parameter) -->
          <div class="spm-col">
            <!-- Jajaran 4 Gauges (Diperbesar & Beda Warna) -->
            <div class="spm-gauges-panel">
              <div class="spm-gauges-row">
                <!-- Gauge 1: OEE (Kuning Emas) -->
                <div class="spm-gauge-box gauge-type-oee">
                  <div class="spm-gauge-svg-wrap">
                    <svg class="spm-gauge-svg" viewBox="0 0 100 65">
                      <path class="spm-arc-bg" d="M 12 52 A 38 38 0 0 1 88 52" />
                      <path class="spm-arc-fill" id="spm_arc_oee_${safeId}" stroke="#ffff00"
                        stroke-dasharray="119.38" stroke-dashoffset="119.38"
                        d="M 12 52 A 38 38 0 0 1 88 52" />
                    </svg>
                    <div class="spm-gauge-center">
                      <span class="spm-gauge-val" id="spm_val_oee_${safeId}">0.0<small>%</small></span>
                    </div>
                  </div>
                  <span class="spm-gauge-title">OEE</span>
                </div>

                <!-- Gauge 2: Availability (Hijau Neon) -->
                <div class="spm-gauge-box gauge-type-avail">
                  <div class="spm-gauge-svg-wrap">
                    <svg class="spm-gauge-svg" viewBox="0 0 100 65">
                      <path class="spm-arc-bg" d="M 12 52 A 38 38 0 0 1 88 52" />
                      <path class="spm-arc-fill" id="spm_arc_avail_${safeId}" stroke="#00ff00"
                        stroke-dasharray="119.38" stroke-dashoffset="119.38"
                        d="M 12 52 A 38 38 0 0 1 88 52" />
                    </svg>
                    <div class="spm-gauge-center">
                      <span class="spm-gauge-val" id="spm_val_avail_${safeId}">0.0<small>%</small></span>
                    </div>
                  </div>
                  <span class="spm-gauge-title">Availability</span>
                </div>

                <!-- Gauge 3: Performance (Biru Elektrik) -->
                <div class="spm-gauge-box gauge-type-perf">
                  <div class="spm-gauge-svg-wrap">
                    <svg class="spm-gauge-svg" viewBox="0 0 100 65">
                      <path class="spm-arc-bg" d="M 12 52 A 38 38 0 0 1 88 52" />
                      <path class="spm-arc-fill" id="spm_arc_perf_${safeId}" stroke="#00d2ff"
                        stroke-dasharray="119.38" stroke-dashoffset="119.38"
                        d="M 12 52 A 38 38 0 0 1 88 52" />
                    </svg>
                    <div class="spm-gauge-center">
                      <span class="spm-gauge-val" id="spm_val_perf_${safeId}">0.0<small>%</small></span>
                    </div>
                  </div>
                  <span class="spm-gauge-title">Performance</span>
                </div>

                <!-- Gauge 4: Quality (Ungu/Magenta Neon) -->
                <div class="spm-gauge-box gauge-type-qual">
                  <div class="spm-gauge-svg-wrap">
                    <svg class="spm-gauge-svg" viewBox="0 0 100 65">
                      <path class="spm-arc-bg" d="M 12 52 A 38 38 0 0 1 88 52" />
                      <path class="spm-arc-fill" id="spm_arc_qual_${safeId}" stroke="#e879f9"
                        stroke-dasharray="119.38" stroke-dashoffset="119.38"
                        d="M 12 52 A 38 38 0 0 1 88 52" />
                    </svg>
                    <div class="spm-gauge-center">
                      <span class="spm-gauge-val" id="spm_val_qual_${safeId}">100<small>%</small></span>
                    </div>
                  </div>
                  <span class="spm-gauge-title">Quality</span>
                </div>
              </div>
            </div>

            <!-- Chart 1: OEE per Jam -->
            <div class="spm-chart-box">
              <div class="spm-chart-header">
                <span class="spm-chart-title"><i class="fas fa-chart-line"></i> OEE per Jam (%)</span>
              </div>
              <div class="spm-chart-canvas-wrap">
                <div class="spm-chart-spinner" id="spm_spin_oee_${safeId}"><i class="fas fa-spinner fa-spin"></i><span>Memuat data...</span></div>
                <div class="spm-chart-nodata" id="spm_nodata_oee_${safeId}" style="display:none;"><i class="fas fa-info-circle"></i><span>Tidak ada data OEE</span></div>
                <canvas id="spm_canvas_oee_${safeId}"></canvas>
              </div>
            </div>

            <!-- Chart 2: 3 Parameter Dibandingkan per Jam -->
            <div class="spm-chart-box">
              <div class="spm-chart-header">
                <span class="spm-chart-title"><i class="fas fa-layer-group"></i> Availability, Performance & Quality (%)</span>
              </div>
              <div class="spm-chart-canvas-wrap">
                <div class="spm-chart-spinner" id="spm_spin_params_${safeId}"><i class="fas fa-spinner fa-spin"></i><span>Memuat parameter...</span></div>
                <div class="spm-chart-nodata" id="spm_nodata_params_${safeId}" style="display:none;"><i class="fas fa-info-circle"></i><span>Tidak ada data</span></div>
                <canvas id="spm_canvas_params_${safeId}"></canvas>
              </div>
            </div>
          </div>

          <!-- SISI KANAN: Tabel Data Real-time (Lebar Ramping & Font Nilai Besar Center) & Chart Qty -->
          <div class="spm-col">
            <!-- Tabel Data Mesin Real-time -->
            <div class="spm-table-panel">
              <table class="spm-matrix-table">
                <tbody>
                  <tr>
                    <td class="col-lbl">Part Number</td>
                    <td class="col-val val-part" id="spm_val_part_${safeId}">-</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Ideal-Qty</td>
                    <td class="col-val val-ideal" id="spm_val_ideal_${safeId}">0</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Total Product</td>
                    <td class="col-val val-total" id="spm_val_total_${safeId}">0</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">No Good</td>
                    <td class="col-val val-ng" id="spm_val_ng_${safeId}">0</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Run-Time</td>
                    <td class="col-val val-time" id="spm_val_runtime_${safeId}">00:00:00</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Running Hour</td>
                    <td class="col-val val-time" id="spm_val_runninghour_${safeId}">00:00:00</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Target</td>
                    <td class="col-val val-target" id="spm_val_target_${safeId}">-</td>
                  </tr>
                  <tr>
                    <td class="col-lbl">Target OT</td>
                    <td class="col-val val-target-ot" id="spm_val_targetot_${safeId}">-</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Chart 3: Production Quantity per Jam -->
            <div class="spm-chart-box" style="flex:1;">
              <div class="spm-chart-header">
                <span class="spm-chart-title"><i class="fas fa-chart-bar"></i> Production Quantity per Jam (Aktual vs Ideal)</span>
              </div>
              <div class="spm-chart-canvas-wrap" style="min-height: 190px; flex: 1;">
                <div class="spm-chart-spinner" id="spm_spin_qty_${safeId}"><i class="fas fa-spinner fa-spin"></i><span>Memuat kuantitas...</span></div>
                <div class="spm-chart-nodata" id="spm_nodata_qty_${safeId}" style="display:none;"><i class="fas fa-info-circle"></i><span>Tidak ada data</span></div>
                <canvas id="spm_canvas_qty_${safeId}"></canvas>
              </div>
            </div>
          </div>
        </div>
      `;

      gridContainer.appendChild(card);
    });
  }

  // Update SVG Arc Gauge dengan Warna Khusus Tiap Tipe
  function updateGaugeArc(arcEl, valEl, percent, type) {
    if (!arcEl || !valEl) return;
    const p = Math.max(0, Math.min(100, safeNumber(percent)));
    const offset = ARC_LENGTH - (p / 100) * ARC_LENGTH;
    arcEl.style.strokeDashoffset = offset.toFixed(2);
    valEl.innerHTML = `${p.toFixed(1)}<small>%</small>`;

    if (type === 'oee') {
      arcEl.style.stroke = p >= 85 ? '#ffff00' : (p >= 65 ? '#eab308' : '#ff0000');
    } else if (type === 'avail') {
      arcEl.style.stroke = '#00ff00';
    } else if (type === 'perf') {
      arcEl.style.stroke = '#00d2ff';
    } else if (type === 'qual') {
      arcEl.style.stroke = '#e879f9';
    }
  }

  // 6. Pencari Multi-Arah Data Mesin
  function resolveMachineInfo(machineName) {
    const q = cleanStr(machineName);

    // Cari di Status
    let st = statusByName.get(q) || statusByAddress.get(q) || null;
    if (!st) {
      for (const [k, v] of statusByName.entries()) {
        if (k.includes(q) || q.includes(k)) { st = v; break; }
      }
    }

    // Cari di Metrics (Master Data: cycle_time, target_quantity, part_number, dll.)
    let metrics = null;
    if (st && st.machine_address) {
      metrics = metricsByAddress.get(cleanStr(st.machine_address));
    }
    if (!metrics && st && st.address) {
      metrics = metricsByAddress.get(cleanStr(st.address));
    }
    if (!metrics) {
      metrics = metricsByName.get(q) || metricsByAddress.get(q) || null;
    }
    if (!metrics) {
      for (const [k, v] of metricsByName.entries()) {
        if (k.includes(q) || q.includes(k)) { metrics = v; break; }
      }
    }

    st = st || {};
    metrics = metrics || {};

    const officialAddress = metrics.address || st.machine_address || st.address || machineName;
    const lineName = st.line_name || metrics.line_name || '';

    return { st, metrics, officialAddress, lineName };
  }

  // 7. Update Real-Time Nilai pada DOM
  function updateAllMachinesDOM() {
    requestedMachines.forEach((machineName) => {
      const safeId = getSafeId(machineName);
      const { st, metrics, officialAddress, lineName } = resolveMachineInfo(machineName);

      // Status Dot & Badge
      const statusNorm = String(st.status || st.machine_state || '').toLowerCase();
      const dotEl = document.getElementById(`spm_dot_${safeId}`);
      const badgeStatusEl = document.getElementById(`spm_badge_status_${safeId}`);
      const badgeLineEl = document.getElementById(`spm_badge_line_${safeId}`);

      if (badgeLineEl && lineName) {
        badgeLineEl.textContent = `Line ${lineName}`;
      }

      if (dotEl && badgeStatusEl) {
        dotEl.className = 'spm-status-dot';
        badgeStatusEl.className = 'spm-badge';

        if (statusNorm === 'problem') {
          dotEl.classList.add('problem');
          badgeStatusEl.classList.add('status-problem');
          badgeStatusEl.textContent = 'PROBLEM';
        } else if (statusNorm === 'idle' || st.is_idle) {
          dotEl.classList.add('idle');
          badgeStatusEl.classList.add('status-idle');
          badgeStatusEl.textContent = 'IDLE';
        } else if (st.machine_address || st.quantity != null) {
          badgeStatusEl.classList.add('status-running');
          badgeStatusEl.textContent = 'RUNNING';
        } else {
          dotEl.classList.add('standby');
          badgeStatusEl.textContent = 'STANDBY';
        }
      }

      // Kalkulasi Metrik Aktual
      const cycleTime = safeNumber(metrics.cycle_time);
      const cavity = safeNumber(st.cavity ?? metrics.cavity ?? 1);
      const actualQty = safeNumber(st.quantity);
      const totalProduct = actualQty * cavity;
      const runtimeSeconds = safeNumber(st.runtime_seconds || 0);
      const runningHourSec = safeNumber(st.running_hour_seconds || 0);

      // Ideal Qty: Running Hour (detik) / Cycle Time * Cavity
      const idealQtyBase = cycleTime > 0 ? Math.floor(runningHourSec / cycleTime) : 0;
      const idealQty = idealQtyBase * cavity;
      const idealQtyPerf = cycleTime > 0 ? (Math.floor(runtimeSeconds / cycleTime) * cavity) : 0;

      // OEE = (Total Product / Ideal Qty) * 100
      let oee = null;
      if (idealQty > 0) {
        oee = (totalProduct / idealQty) * 100;
      }

      // Availability = Run Time / Running Hour * 100
      let availability = null;
      if (runningHourSec > 0) {
        availability = (runtimeSeconds / runningHourSec) * 100;
      }

      // Performance = Total Product / Ideal Qty (perf) * 100
      let performance = null;
      if (idealQtyPerf > 0) {
        performance = (totalProduct / idealQtyPerf) * 100;
      }

      // Quality = ((Total - NG) / Total) * 100
      const ngQty = safeNumber(st.ng_quantity || st.no_good || st.ng || 0);
      let quality = 100;
      if (totalProduct > 0) {
        quality = Math.max(0, ((totalProduct - ngQty) / totalProduct) * 100);
      }

      // Update 4 Gauges (masing-masing punya warna khas tersendiri)
      updateGaugeArc(
        document.getElementById(`spm_arc_oee_${safeId}`),
        document.getElementById(`spm_val_oee_${safeId}`),
        oee,
        'oee'
      );
      updateGaugeArc(
        document.getElementById(`spm_arc_avail_${safeId}`),
        document.getElementById(`spm_val_avail_${safeId}`),
        availability,
        'avail'
      );
      updateGaugeArc(
        document.getElementById(`spm_arc_perf_${safeId}`),
        document.getElementById(`spm_val_perf_${safeId}`),
        performance,
        'perf'
      );
      updateGaugeArc(
        document.getElementById(`spm_arc_qual_${safeId}`),
        document.getElementById(`spm_val_qual_${safeId}`),
        quality,
        'qual'
      );

      // Update Tabel Sisi Kanan (Center-aligned values & font besar)
      const setVal = (id, text, isProblem = false) => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = text;
          if (isProblem) el.classList.add('is-problem');
          else el.classList.remove('is-problem');
        }
      };

      const partNum = metrics.part_number || st.part_number || '-';
      setVal(`spm_val_part_${safeId}`, partNum);
      setVal(`spm_val_ideal_${safeId}`, idealQty > 0 ? idealQty.toLocaleString('id-ID') : (idealQtyBase > 0 ? idealQtyBase.toLocaleString('id-ID') : '0'));
      setVal(`spm_val_total_${safeId}`, totalProduct.toLocaleString('id-ID'), statusNorm === 'problem');
      setVal(`spm_val_ng_${safeId}`, ngQty.toLocaleString('id-ID'));
      setVal(`spm_val_runtime_${safeId}`, fmtHHMMSS(runtimeSeconds));
      setVal(`spm_val_runninghour_${safeId}`, fmtHHMMSS(runningHourSec));

      const targetVal = metrics.target_quantity != null ? Number(metrics.target_quantity).toLocaleString('id-ID') : '-';
      setVal(`spm_val_target_${safeId}`, targetVal);

      const targetOtRaw = (metrics.target_ot != null && metrics.target_ot !== '') ? metrics.target_ot : st.target_ot;
      const targetOtVal = (targetOtRaw != null && targetOtRaw !== '') ? Number(targetOtRaw).toLocaleString('id-ID') : '-';
      setVal(`spm_val_targetot_${safeId}`, targetOtVal);
    });
  }

  // Helper fetch dengan timeout agar tidak hang/loading terus
  async function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return await res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  // 8. Load & Render Charts untuk Setiap Mesin (Paralel & Non-Blocking)
  async function loadMachineCharts(machineName) {
    const safeId = getSafeId(machineName);
    const { shift, dateStr } = getShiftInfo();
    const { officialAddress } = resolveMachineInfo(machineName);
    const addressToQuery = officialAddress || machineName;

    const spinOee = document.getElementById(`spm_spin_oee_${safeId}`);
    const noDataOee = document.getElementById(`spm_nodata_oee_${safeId}`);
    const spinParams = document.getElementById(`spm_spin_params_${safeId}`);
    const noDataParams = document.getElementById(`spm_nodata_params_${safeId}`);
    const spinQty = document.getElementById(`spm_spin_qty_${safeId}`);
    const noDataQty = document.getElementById(`spm_nodata_qty_${safeId}`);

    const urlOee = `/api/public/analytics/oee-hourly?date=${dateStr}&shift=${shift}&machine_address=${encodeURIComponent(addressToQuery)}`;
    const urlQty = `/api/public/analytics/quantity-drilldown?period=daily&date=${dateStr}&shift=${shift}&machine_address=${encodeURIComponent(addressToQuery)}`;

    try {
      // Jalankan kedua fetch secara paralel
      const [oeeJson, qtyJson] = await Promise.all([
        fetchWithTimeout(urlOee, 8000),
        fetchWithTimeout(urlQty, 8000)
      ]);

      // A. Handle OEE & 3 Parameter Charts
      if (oeeJson && oeeJson.success && Array.isArray(oeeJson.data) && oeeJson.data.length > 0) {
        if (noDataOee) noDataOee.style.display = 'none';
        if (noDataParams) noDataParams.style.display = 'none';

        const rows = oeeJson.data;
        const labels = rows.map(r => r.snapshot_at || r.label || '');
        const oeeVals = rows.map(r => r.oee_percent != null ? Number(r.oee_percent) : null);
        const aVals = rows.map(r => r.availability_percent != null ? Number(r.availability_percent) : null);
        const pVals = rows.map(r => r.performance_percent != null ? Number(r.performance_percent) : null);
        const qVals = rows.map(r => r.quality_percent != null ? Number(r.quality_percent) : null);

        // Chart 1: OEE Line Chart (Emas Cerah)
        const canvasOee = document.getElementById(`spm_canvas_oee_${safeId}`);
        if (canvasOee) {
          let inst = chartInstances.get(`oee_${safeId}`);
          if (inst) inst.destroy();

          inst = new Chart(canvasOee.getContext('2d'), {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: 'OEE (%)',
                data: oeeVals,
                borderColor: '#ffff00',
                backgroundColor: 'rgba(255, 255, 0, 0.12)',
                borderWidth: 2,
                tension: 0.2,
                spanGaps: true,
                pointRadius: 2.5,
                pointBackgroundColor: '#ffff00',
                fill: true
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (c) => `OEE: ${c.parsed.y != null ? c.parsed.y.toFixed(2) + '%' : '-'}`
                  }
                }
              },
              scales: {
                x: {
                  ticks: { color: '#94a3b8', font: { size: 9.5 } },
                  grid: { color: 'rgba(59, 130, 246, 0.12)' }
                },
                y: {
                  beginAtZero: true,
                  suggestedMax: 100,
                  ticks: { color: '#94a3b8', font: { size: 9.5 }, callback: v => `${v}%` },
                  grid: { color: 'rgba(59, 130, 246, 0.15)' }
                }
              }
            }
          });
          chartInstances.set(`oee_${safeId}`, inst);
        }

        // Chart 2: 3 Parameter Multi-line Chart
        const canvasParams = document.getElementById(`spm_canvas_params_${safeId}`);
        if (canvasParams) {
          let inst = chartInstances.get(`params_${safeId}`);
          if (inst) inst.destroy();

          inst = new Chart(canvasParams.getContext('2d'), {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: 'Availability',
                  data: aVals,
                  borderColor: '#00ff00',
                  backgroundColor: 'transparent',
                  borderWidth: 2,
                  tension: 0.2,
                  spanGaps: true,
                  pointRadius: 2,
                  pointBackgroundColor: '#00ff00'
                },
                {
                  label: 'Performance',
                  data: pVals,
                  borderColor: '#00d2ff',
                  backgroundColor: 'transparent',
                  borderWidth: 2,
                  tension: 0.2,
                  spanGaps: true,
                  pointRadius: 2,
                  pointBackgroundColor: '#00d2ff'
                },
                {
                  label: 'Quality',
                  data: qVals,
                  borderColor: '#e879f9',
                  backgroundColor: 'transparent',
                  borderWidth: 2,
                  tension: 0.2,
                  spanGaps: true,
                  pointRadius: 2,
                  pointBackgroundColor: '#e879f9'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: { color: '#cbd5e1', font: { size: 9 }, boxWidth: 10, padding: 6 }
                },
                tooltip: {
                  callbacks: {
                    label: (c) => `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(2) + '%' : '-'}`
                  }
                }
              },
              scales: {
                x: {
                  ticks: { color: '#94a3b8', font: { size: 9.5 } },
                  grid: { color: 'rgba(59, 130, 246, 0.12)' }
                },
                y: {
                  beginAtZero: true,
                  suggestedMax: 100,
                  ticks: { color: '#94a3b8', font: { size: 9.5 }, callback: v => `${v}%` },
                  grid: { color: 'rgba(59, 130, 246, 0.15)' }
                }
              }
            }
          });
          chartInstances.set(`params_${safeId}`, inst);
        }
      } else {
        if (noDataOee) noDataOee.style.display = 'flex';
        if (noDataParams) noDataParams.style.display = 'flex';
      }

      // B. Handle Production Quantity Chart
      if (qtyJson && qtyJson.success && Array.isArray(qtyJson.data) && qtyJson.data.length > 0) {
        if (noDataQty) noDataQty.style.display = 'none';

        const rows = qtyJson.data;
        const labels = rows.map(r => r.label || r.snapshot_at || '');
        const actuals = rows.map(r => Number(r.quantity ?? 0));
        const ideals = rows.map(r => Number(r.ideal_quantity ?? 0));

        const canvasQty = document.getElementById(`spm_canvas_qty_${safeId}`);
        if (canvasQty) {
          let inst = chartInstances.get(`qty_${safeId}`);
          if (inst) inst.destroy();

          inst = new Chart(canvasQty.getContext('2d'), {
            type: 'bar',
            data: {
              labels,
              datasets: [
                {
                  label: 'Aktual Qty',
                  data: actuals,
                  backgroundColor: 'rgba(0, 255, 0, 0.85)',
                  borderColor: '#00ff00',
                  borderWidth: 1,
                  borderRadius: 3,
                  barPercentage: 0.65,
                  categoryPercentage: 0.75
                },
                {
                  label: 'Ideal Qty',
                  data: ideals,
                  type: 'line',
                  borderColor: '#00bcd4',
                  backgroundColor: 'rgba(0, 188, 212, 0.15)',
                  borderWidth: 2,
                  tension: 0.2,
                  pointRadius: 2.5,
                  pointBackgroundColor: '#00bcd4'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: {
                  display: true,
                  position: 'top',
                  labels: { color: '#cbd5e1', font: { size: 9.5 }, boxWidth: 10, padding: 6 }
                },
                tooltip: {
                  callbacks: {
                    label: (c) => `${c.dataset.label}: ${Number(c.parsed.y).toLocaleString('id-ID')}`
                  }
                }
              },
              scales: {
                x: {
                  ticks: { color: '#94a3b8', font: { size: 9.5 } },
                  grid: { color: 'rgba(59, 130, 246, 0.12)' }
                },
                y: {
                  beginAtZero: true,
                  ticks: { color: '#94a3b8', font: { size: 9.5 } },
                  grid: { color: 'rgba(59, 130, 246, 0.15)' }
                }
              }
            }
          });
          chartInstances.set(`qty_${safeId}`, inst);
        }
      } else {
        if (noDataQty) noDataQty.style.display = 'flex';
      }
    } catch (err) {
      if (noDataOee) noDataOee.style.display = 'flex';
      if (noDataParams) noDataParams.style.display = 'flex';
      if (noDataQty) noDataQty.style.display = 'flex';
    } finally {
      // Pastikan seluruh spinner PASTI disembunyikan
      if (spinOee) spinOee.style.display = 'none';
      if (spinParams) spinParams.style.display = 'none';
      if (spinQty) spinQty.style.display = 'none';
    }
  }

  function reloadAllCharts() {
    requestedMachines.forEach(mName => loadMachineCharts(mName));
  }

  // 9. Fetch Data Master & Status Secara Paralel
  async function loadData() {
    // 1. Fetch Metrics (Master Data)
    try {
      const res = await fetch('/api/public/inspection-tables/metrics');
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        metricsByAddress.clear();
        metricsByName.clear();
        json.data.forEach((item) => {
          if (item.address) metricsByAddress.set(cleanStr(item.address), item);
          if (item.name) metricsByName.set(cleanStr(item.name), item);
          if (item.machine_id) metricsByAddress.set(cleanStr(item.machine_id), item);
        });
      }
    } catch (e) {
      console.warn('Gagal memuat master metrics:', e.message);
    }

    // 2. Fetch Dashboard Status
    try {
      const statusRes = await fetch('/api/public/dashboard/status');
      const statusJson = await statusRes.json();
      if (statusJson && statusJson.success && statusJson.data && statusJson.data.machine_statuses_by_line) {
        statusByAddress.clear();
        statusByName.clear();
        const groups = statusJson.data.machine_statuses_by_line;
        Object.keys(groups).forEach((line) => {
          const arr = groups[line] || [];
          arr.forEach((item) => {
            if (item.machine_address) statusByAddress.set(cleanStr(item.machine_address), item);
            if (item.address) statusByAddress.set(cleanStr(item.address), item);
            if (item.machine_name) statusByName.set(cleanStr(item.machine_name), item);
            if (item.name) statusByName.set(cleanStr(item.name), item);
            if (item.tipe_mesin) statusByName.set(cleanStr(item.tipe_mesin), item);
          });
        });
      }
    } catch (e) {
      console.warn('Gagal memuat dashboard status:', e.message);
    }

    // 3. Update DOM & Charts
    updateAllMachinesDOM();
    reloadAllCharts();
  }

  // 10. Socket.IO Real-Time Listener
  function initSocket() {
    if (typeof io === 'undefined') return;
    const socket = io();

    socket.on('connect', () => setConnection(true));
    socket.on('disconnect', () => setConnection(false));

    socket.on('dashboardUpdate', (payload) => {
      if (!payload || !payload.success || !payload.data || !payload.data.machine_statuses_by_line) return;
      const groups = payload.data.machine_statuses_by_line;
      Object.keys(groups).forEach((line) => {
        const arr = groups[line] || [];
        arr.forEach((item) => {
          if (item.machine_address) statusByAddress.set(cleanStr(item.machine_address), item);
          if (item.address) statusByAddress.set(cleanStr(item.address), item);
          if (item.machine_name) statusByName.set(cleanStr(item.machine_name), item);
          if (item.name) statusByName.set(cleanStr(item.name), item);
          if (item.tipe_mesin) statusByName.set(cleanStr(item.tipe_mesin), item);
        });
      });

      updateAllMachinesDOM();
    });
  }

  // Auto-refresh chart setiap 2 menit
  setInterval(() => {
    reloadAllCharts();
  }, 120000);

  // EKSEKUSI LANGSUNG (Turn-0: render kartu segera, lalu fetch data)
  renderCards(requestedMachines);
  loadData();
  initSocket();
});
