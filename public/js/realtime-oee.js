// public/js/realtime-oee.js
document.addEventListener('DOMContentLoaded', () => {
  const boardEl = document.getElementById('rtOeeBoard');
  const connectionEl = document.getElementById('connectionStatus');
  const lineFilter = (document.body && document.body.dataset && document.body.dataset.lineFilter)
    ? String(document.body.dataset.lineFilter).trim()
    : '';

  const SHIFT_TZ = 'Asia/Jakarta';

  // Maps
  const metricsByAddress = new Map(); // address -> { cycle_time, target_quantity, oee, name, line_name }

  let lastStatusPayload = null;
  let machinesFlat = []; // [{ address, name, line_name }]
  let blocks = []; // chunked

  // Server time sync: offset (ms) = server time - device time, agar semua device menampilkan waktu sama
  let lastServerTimeOffsetMs = 0;
  let lastPayloadServerTimeIso = null;

  function getCookieValue(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function getAuthHeaders() {
    const token = getCookieValue('auth_token');
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

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

  function nowTz() {
    return window.moment && moment.tz ? moment.tz(SHIFT_TZ) : moment();
  }

  /** Waktu "sekarang" menurut server (untuk Run Time / Running Hour yang konsisten di semua device). */
  function serverNow() {
    const deviceMs = Date.now();
    const serverMs = deviceMs + lastServerTimeOffsetMs;
    return window.moment && moment.tz ? moment(serverMs).tz(SHIFT_TZ) : moment(serverMs);
  }

  async function fetchServerTime() {
    try {
      const res = await fetch('/api/server-time', { headers: getAuthHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success || !json.server_time) return;
      const serverMs = moment(json.server_time).valueOf();
      const deviceMs = Date.now();
      lastServerTimeOffsetMs = serverMs - deviceMs;
    } catch (e) {
      // ignore; tetap pakai device time
    }
  }

  function getShiftInfo(now) {
    // Shift pagi: 07:00-19:59, shift malam: 20:00-06:59 (next day)
    const h = now.hour();
    const m = now.minute();
    // Shift pagi: 07:00-19:59 (inclusive), shift malam: 20:00-06:59
    let shift = 'malam';
    if (h >= 7 && h < 20) shift = 'pagi';
    if (h === 6 && m <= 59) shift = 'malam';
    if (h < 7) shift = 'malam';
    if (h >= 20) shift = 'malam';

    let shiftStart = now.clone();
    if (shift === 'pagi') {
      shiftStart = now.clone().hour(7).minute(0).second(0);
      // same day
    } else {
      // malam starts at 20:00 of "shift start date"
      if (h < 7) {
        // after midnight before 07:00 -> shift started yesterday 20:00
        shiftStart = now.clone().subtract(1, 'day').hour(20).minute(0).second(0);
      } else {
        // 20:00-23:59 -> starts today 20:00
        shiftStart = now.clone().hour(20).minute(0).second(0);
      }
    }

    const shiftKey = `${shiftStart.format('YYYY-MM-DD')}_${shift}_${shiftStart.format('HHmm')}`;
    return { shift, shiftStart, shiftKey };
  }

  function fmtHHMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function getOtDurationSeconds(otDurationType) {
    if (!otDurationType) return 0;
    switch (String(otDurationType)) {
      case '2h_pagi': case '2h_malam': return 2 * 3600;
      case '3.5h_pagi': return Math.floor(3.5 * 3600);
      default: return 0;
    }
  }

  /** OT aktif jika: ot_enabled, jam sudah lewat akhir shift reguler (pagi 16:00, malam 05:00), dan masih dalam jendela OT (max 19:59 pagi, 06:59 malam). */
  function isOtActive(metrics, now) {
    if (!metrics || !metrics.ot_enabled || !metrics.ot_duration_type) return false;
    const h = now.hour();
    const m = now.minute();
    const type = String(metrics.ot_duration_type);
    if (type === '2h_pagi' || type === '3.5h_pagi') {
      if (h < 16) return false;
      if (h > 19) return false;
      if (h === 19 && m >= 59) return false;
      if (type === '2h_pagi' && (h > 18 || (h === 18 && m > 0))) return false;
      if (type === '3.5h_pagi' && (h > 19 || (h === 19 && m >= 30))) return false;
      return true;
    }
    if (type === '2h_malam') {
      if (h >= 7) return false;
      return (h > 5) || (h === 5 && m >= 0);
    }
    return false;
  }

  /** Ideal Qty = Running Hour (detik) / Cycle Time. Menggunakan running_hour_seconds dari backend. */
  function computeIdealQty(cycleSeconds, runtimeSeconds) {
    const c = safeNumber(cycleSeconds);
    const r = Math.max(0, safeNumber(runtimeSeconds));
    if (c <= 0) return 0;
    return Math.floor(r / c);
  }

  /** OEE = (Actual Qty / Ideal Qty) * 100, dengan Ideal Qty = Run Time / Cycle Time. */
  function computeOee(actualQty, idealQty) {
    const actual = safeNumber(actualQty);
    const ideal = Math.max(0, safeNumber(idealQty));
    if (ideal <= 0) return null;
    const oee = (actual / ideal) * 100;
    return Number.isFinite(oee) ? oee : null;
  }

  /** Parse "HH:mm" to { h, m }. */
  function parseTimeStr(s) {
    if (!s || typeof s !== 'string') return null;
    const parts = s.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!parts) return null;
    return { h: parseInt(parts[1], 10), m: parseInt(parts[2], 10) };
  }

  async function loadBreakSchedules() {
    try {
      const token = getCookieValue('auth_token');
      const url = token ? '/api/break-schedules' : '/api/public/break-schedules';
      const options = token ? { headers: getAuthHeaders() } : {};
      const res = await fetch(url, options);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) return;
      const byKey = {};
      json.data.forEach((row) => {
        const key = `${row.day_of_week}_${row.shift}`;
        byKey[key] = {
          work_start: row.work_start,
          work_end: row.work_end,
          breaks: row.breaks || []
        };
      });
      breakSchedulesByKey = byKey;
    } catch (e) {
      // ignore
    }
  }

  function flattenMachines(machineStatusesByLine) {
    const out = [];
    const lines = machineStatusesByLine || {};
    Object.keys(lines).forEach((lineName) => {
      if (lineFilter && String(lineName) !== lineFilter) return;
      const arr = Array.isArray(lines[lineName]) ? lines[lineName] : [];
      arr.forEach((m) => {
        const address = m.machine_address || m.address || m.machine_name || m.name || null;
        // In backend status, machine_name may be display name, address might be machine_name in production_data.
        // Prefer address field if provided; else fall back to tipe_mesin-like identifier.
        out.push({
          address: m.machine_address || m.address || m.tipe_mesin || m.machine_name || null,
          name: m.machine_name_display || m.machine_name || m.name || (m.machine_address || m.address) || 'Unknown',
          line_name: m.line_name || lineName || ''
        });
      });
    });
    // unique by address
    const seen = new Set();
    return out.filter((m) => {
      const key = String(m.address || '').trim();
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
  }

  function chunkMachines(list, chunkSize) {
    const chunks = [];
    for (let i = 0; i < list.length; i += chunkSize) {
      chunks.push(list.slice(i, i + chunkSize));
    }
    return chunks;
  }

  function renderBoard() {
    if (!boardEl) return;
    if (!machinesFlat.length) {
      boardEl.innerHTML = `<div style="color:#fff; padding:12px;">Memuat data mesin...</div>`;
      return;
    }

    const metricsRows = [
      { key: 'ideal', label: 'Ideal-Qty' },
      { key: 'total', label: 'Total Product' },
      { key: 'ng', label: 'No-Good' },
      { key: 'runtime', label: 'Run-Time' },
      { key: 'runninghour', label: 'Running Hour' },
      { key: 'oee', label: 'OEE' },
      { key: 'target', label: 'Target' }
    ];

    const blocksHtml = blocks.map((block, blockIdx) => {
      const cols = block.length;
      const templateCols = `160px repeat(${cols}, 1fr)`;
      const cells = [];

      // Header row
      cells.push(`<div class="rt-cell rt-header rt-label"></div>`);
      block.forEach((m) => {
        cells.push(`
          <div class="rt-cell rt-header rt-header-centered" data-addr="${m.address}">
            <span class="rt-header-name">${m.name}</span>
            <span class="rt-dot ok" data-dot="${m.address}"></span>
          </div>
        `);
      });

      // Metric rows
      metricsRows.forEach((r) => {
        cells.push(`<div class="rt-cell rt-label">${r.label}</div>`);
        block.forEach((m) => {
          const id = `b${blockIdx}_${r.key}_${encodeURIComponent(m.address)}`;
          const cls = `rt-value ${r.key === 'ideal' ? 'ideal' : r.key === 'total' ? 'total' : r.key === 'ng' ? 'ng' : r.key === 'oee' ? 'oee' : r.key === 'target' ? 'target' : 'time'}`;
          cells.push(`<div class="rt-cell"><span class="${cls}" id="${id}">-</span></div>`);
        });
      });

      return `
        <div class="rt-oee-block">
          <div class="rt-matrix" style="grid-template-columns:${templateCols}">
            ${cells.join('')}
          </div>
        </div>
      `;
    }).join('');

    boardEl.innerHTML = `<div class="rt-oee-blocks">${blocksHtml}</div>`;
  }

  function updateValues() {
    if (!lastStatusPayload) return;

    const machineLookup = new Map();
    Object.keys(lastStatusPayload.machine_statuses_by_line || {}).forEach((ln) => {
      const arr = lastStatusPayload.machine_statuses_by_line[ln] || [];
      arr.forEach((m) => {
        const addr = String(m.machine_address || m.address || m.tipe_mesin || m.machine_name || '').trim();
        if (!addr) return;
        machineLookup.set(addr, m);
      });
    });

    machinesFlat.forEach((m) => {
      try {
      const addr = String(m.address).trim();
      const st = machineLookup.get(addr) || {};
      const metrics = metricsByAddress.get(addr) || {};

      // Ambil runtime dan running hour langsung dari backend (sudah dihitung di server)
      // Backend menghitung runtime dan running hour dengan state management di database,
      // sehingga tidak terpengaruh localStorage atau browser refresh.
      const runtimeSeconds = safeNumber(st.runtime_seconds || 0);
      const runningHourSec = safeNumber(st.running_hour_seconds || 0);

      // Determine status untuk UI (dot indicator, ideal qty styling)
      const problemType = st.problem_type || st.tipe_problem || '';
      const statusNorm = String(st.status || '').toLowerCase();
      const isProblem = statusNorm === 'problem';
      const isWarning = statusNorm === 'warning';
      const isIdle = statusNorm === 'idle' || st.is_idle === true || String(st.machine_state || '').toLowerCase() === 'idle';

      const cycle = safeNumber(metrics.cycle_time);
      const actualQty = safeNumber(st.quantity);
      const cavity = safeNumber(st.cavity ?? metrics.cavity ?? 1);
      const totalProduct = actualQty * cavity;
      const idealQtyBase = computeIdealQty(cycle, runningHourSec);
      const idealQty = idealQtyBase * cavity;
      const oee = computeOee(totalProduct, idealQty);
      const target = (metrics.target_quantity != null) ? safeNumber(metrics.target_quantity) : null;
      const targetOt = (metrics.target_ot != null && metrics.target_ot !== '') ? safeNumber(metrics.target_ot) : null;

      // write to DOM for each block cell
      blocks.forEach((block, blockIdx) => {
        if (!block.find(x => x.address === addr)) return;
        const keyAddr = encodeURIComponent(addr);
        const setText = (rowKey, text) => {
          const el = document.getElementById(`b${blockIdx}_${rowKey}_${keyAddr}`);
          if (el) el.textContent = text;
        };
        setText('ideal', String(idealQty));
        const idealEl = document.getElementById(`b${blockIdx}_ideal_${keyAddr}`);
        if (idealEl) {
          idealEl.classList.remove('rt-ideal-warn', 'rt-ideal-bad');
          if (isProblem) idealEl.classList.add('rt-ideal-bad');
          else if (isIdle || isWarning) idealEl.classList.add('rt-ideal-warn');
        }
        setText('total', String(totalProduct));
        setText('ng', '0');
        setText('runtime', fmtHHMMSS(runtimeSeconds));
        setText('runninghour', fmtHHMMSS(runningHourSec));
        const oeeEl = document.getElementById(`b${blockIdx}_oee_${keyAddr}`);
        if (oeeEl) {
          if (oee == null) {
            oeeEl.textContent = '-';
            oeeEl.classList.remove('rt-oee-low');
          } else {
            oeeEl.textContent = oee.toFixed(2) + '%';
            if (oee < 85) {
              oeeEl.classList.add('rt-oee-low');
            } else {
              oeeEl.classList.remove('rt-oee-low');
            }
          }
        }
        const targetEl = document.getElementById(`b${blockIdx}_target_${keyAddr}`);
        if (targetEl) {
          if (targetOt != null && metrics.ot_enabled) {
            targetEl.innerHTML = (target != null ? String(target) : '-') + `<br><span class="rt-target-ot">${targetOt}</span>`;
            targetEl.classList.add('rt-has-ot-target');
          } else {
            targetEl.textContent = (target == null) ? '-' : String(target);
            targetEl.classList.remove('rt-has-ot-target');
          }
        }
      });

      // dot status: problem (termasuk cycle time) -> red, idle/warning -> yellow, normal -> green (sesuai dashboard line)
      const dot = document.querySelector(`[data-dot="${CSS.escape(addr)}"]`);
      if (dot) {
        dot.classList.remove('ok', 'warn', 'bad');
        if (isProblem) dot.classList.add('bad');
        else if (isIdle || isWarning) dot.classList.add('warn');
        else dot.classList.add('ok');
      }
      } catch (err) {
        console.warn('realtime-oee updateValues error for machine:', m && m.address, err);
      }
    });
  }

  async function loadMetrics() {
    try {
      const token = getCookieValue('auth_token');
      const url = token ? '/api/inspection-tables/metrics' : '/api/public/inspection-tables/metrics';
      const options = token ? { headers: getAuthHeaders() } : {};
      const res = await fetch(url, options);
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.data)) return;
      metricsByAddress.clear();
      json.data.forEach((item) => {
        if (item && item.address) metricsByAddress.set(String(item.address).trim(), item);
      });
    } catch (e) {
      // ignore
    }
  }

  async function loadInitialStatus() {
    try {
      const token = getCookieValue('auth_token');
      const userDataEl = document.getElementById('userData');
      const userRole = userDataEl ? userDataEl.dataset.role : null;
      const userDivision = userDataEl ? userDataEl.dataset.division : null;
      const qs = lineFilter ? `?${new URLSearchParams({ line_name: lineFilter }).toString()}` : '';
      const url = token ? `/api/dashboard/status${qs}` : `/api/public/dashboard/status${qs}`;
      const headers = token ? {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-User-Role': userRole || '',
        'X-User-Division': userDivision || '',
        'X-Line-Name': lineFilter || ''
      } : {};
      const res = await fetch(url, { headers });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) return;
      lastStatusPayload = json.data;
      if (json.data.server_time) lastPayloadServerTimeIso = json.data.server_time;
      machinesFlat = flattenMachines(json.data.machine_statuses_by_line);
      blocks = chunkMachines(machinesFlat, 8);
      renderBoard();
    } catch (e) {
      // ignore
    }
  }

  function initSocket() {
    const token = getCookieValue('auth_token');
    const options = token ? { auth: { token } } : {};
    const socket = io(options);

    socket.on('connect', () => setConnection(true));
    socket.on('disconnect', () => setConnection(false));

    socket.on('dashboardUpdate', (payload) => {
      if (!payload || !payload.success || !payload.data) return;
      if (lineFilter && payload.data.machine_statuses_by_line) {
        lastStatusPayload = {
          ...payload.data,
          machine_statuses_by_line: {
            [lineFilter]: payload.data.machine_statuses_by_line[lineFilter] || []
          }
        };
      } else {
        lastStatusPayload = payload.data;
      }
      if (lastStatusPayload.server_time) lastPayloadServerTimeIso = lastStatusPayload.server_time;
      // If machine list changed (rare), rebuild
      const flat = flattenMachines(payload.data.machine_statuses_by_line);
      if (flat.length && (flat.length !== machinesFlat.length)) {
        machinesFlat = flat;
        blocks = chunkMachines(machinesFlat, 8);
        renderBoard();
      }
    });
  }

  setInterval(() => {
    const el = document.getElementById('currentTime');
    if (el) el.textContent = serverNow().format('HH:mm:ss');
  }, 1000);

  (async function init() {
    await fetchServerTime();
    await loadMetrics();
    await loadInitialStatus();
    // Selalu gunakan socket: untuk user login memakai token, untuk single page publik tanpa token (public socket)
    initSocket();

    setInterval(fetchServerTime, 60000);
    setInterval(loadMetrics, 60000);
    setInterval(updateValues, 1000);
  })();
});

