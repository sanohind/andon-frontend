// public/js/realtime-oee.js
document.addEventListener('DOMContentLoaded', () => {
  const boardEl = document.getElementById('rtOeeBoard');
  const connectionEl = document.getElementById('connectionStatus');
  const lineFilter = (document.body && document.body.dataset && document.body.dataset.lineFilter)
    ? String(document.body.dataset.lineFilter).trim()
    : '';

  const RUNNING_HOUR = 8; // fixed per requirement & existing OEE logic
  const SHIFT_TZ = 'Asia/Jakarta';

  // Maps
  const metricsByAddress = new Map(); // address -> { cycle_time, target_quantity, oee, name, line_name }
  const machineState = new Map(); // address -> runtimeSecondsAccumulated, downtimeStartIso, lastShiftKey

  let lastStatusPayload = null;
  let machinesFlat = []; // [{ address, name, line_name }]
  let blocks = []; // chunked

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

  function computeIdealQty(cycleSeconds) {
    const c = safeNumber(cycleSeconds);
    if (c <= 0) return 0;
    return Math.floor((RUNNING_HOUR * 3600) / c);
  }

  function computeOee(actualQty, cycleSeconds) {
    const cycle = safeNumber(cycleSeconds);
    const actual = safeNumber(actualQty);
    if (cycle <= 0) return null;
    const oee = ((actual * cycle) / (RUNNING_HOUR * 3600)) * 100;
    return Number.isFinite(oee) ? oee : null;
  }

  function normalizeProblemType(v) {
    return String(v || '').trim().toLowerCase();
  }

  function isDowntimeProblemType(problemType) {
    const t = normalizeProblemType(problemType);
    // match common variants
    return t === 'machine' || t === 'quality' || t === 'engineering' ||
      t === 'tipe machine' || t === 'tipe mesin' ||
      t.includes('machine') || t.includes('quality') || t.includes('engineering');
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
      { key: 'downtime', label: 'Down-Time' },
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
    const now = nowTz();
    const { shiftStart, shiftKey } = getShiftInfo(now);

    // Build quick lookup by address from status payload
    const machineLookup = new Map(); // address -> status object
    Object.keys(lastStatusPayload.machine_statuses_by_line || {}).forEach((ln) => {
      const arr = lastStatusPayload.machine_statuses_by_line[ln] || [];
      arr.forEach((m) => {
        const addr = String(m.machine_address || m.address || m.tipe_mesin || m.machine_name || '').trim();
        if (!addr) return;
        machineLookup.set(addr, m);
      });
    });

    machinesFlat.forEach((m) => {
      const addr = String(m.address).trim();
      const st = machineLookup.get(addr) || {};
      const metrics = metricsByAddress.get(addr) || {};

      // Track downtime start for current problem (per machine)
      if (!machineState.has(addr)) {
        machineState.set(addr, { lastShiftKey: shiftKey, downtimeStartIso: null });
      }
      const state = machineState.get(addr);

      // shift change -> reset downtime tracking
      if (state.lastShiftKey !== shiftKey) {
        state.downtimeStartIso = null;
        state.lastShiftKey = shiftKey;
      }

      // Determine downtime active (only for machine/quality/engineering)
      const problemType = st.problem_type || st.tipe_problem || '';
      const statusNorm = String(st.status || '').toLowerCase(); // normal|warning|problem
      const isProblem = statusNorm === 'problem';
      const isWarning = statusNorm === 'warning';
      const isDowntimeActive = isProblem && isDowntimeProblemType(problemType);

      // Downtime start timestamp: use st.timestamp when available, clipped to shiftStart
      let downtimeSec = 0;
      if (isDowntimeActive) {
        const tsRaw = st.timestamp || st.problem_timestamp || null;
        const ts = tsRaw ? moment.tz(tsRaw, ['YYYY-MM-DD HH:mm:ss', moment.ISO_8601], SHIFT_TZ) : null;
        const start = ts && ts.isValid() ? moment.max(ts, shiftStart) : shiftStart;
        if (!state.downtimeStartIso) state.downtimeStartIso = start.toISOString();
        const ds = moment(state.downtimeStartIso);
        downtimeSec = Math.max(0, now.diff(ds, 'seconds'));
      } else {
        state.downtimeStartIso = null;
      }

      // Run-time: compute from wall clock (persists across refresh)
      // elapsed since shift start minus downtime
      const elapsedSinceShiftStart = Math.max(0, now.diff(shiftStart, 'seconds'));
      const runtimeSeconds = Math.max(0, elapsedSinceShiftStart - downtimeSec);

      // Values
      const cycle = safeNumber(metrics.cycle_time);
      const actualQty = safeNumber(st.quantity);
      const idealQty = computeIdealQty(cycle);
      const oee = computeOee(actualQty, cycle);
      const target = (metrics.target_quantity != null) ? safeNumber(metrics.target_quantity) : null;

      // write to DOM for each block cell
      blocks.forEach((block, blockIdx) => {
        if (!block.find(x => x.address === addr)) return;
        const keyAddr = encodeURIComponent(addr);
        const setText = (rowKey, text) => {
          const el = document.getElementById(`b${blockIdx}_${rowKey}_${keyAddr}`);
          if (el) el.textContent = text;
        };

        setText('ideal', String(idealQty));
        setText('total', String(actualQty));
        setText('ng', '0');
        setText('runtime', fmtHHMMSS(runtimeSeconds));
        setText('downtime', fmtHHMMSS(downtimeSec));
        setText('oee', (oee == null) ? '-' : oee.toFixed(2) + '%');
        setText('target', (target == null) ? '-' : String(target));
      });

      // dot status
      const dot = document.querySelector(`[data-dot="${CSS.escape(addr)}"]`);
      if (dot) {
        dot.classList.remove('ok', 'warn', 'bad');
        if (isDowntimeActive) dot.classList.add('bad');
        else if (isWarning) dot.classList.add('warn');
        else dot.classList.add('ok');
      }
    });
  }

  async function loadMetrics() {
    try {
      const res = await fetch('/api/inspection-tables/metrics', { headers: getAuthHeaders() });
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
      const qs = lineFilter ? `?${new URLSearchParams({ line_name: lineFilter }).toString()}` : '';
      const res = await fetch(`/api/dashboard/status${qs}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) return;
      lastStatusPayload = json.data;
      machinesFlat = flattenMachines(json.data.machine_statuses_by_line);
      // Use 8 columns per block like screenshot
      blocks = chunkMachines(machinesFlat, 8);
      renderBoard();
    } catch (e) {
      // ignore
    }
  }

  function initSocket() {
    const token = getCookieValue('auth_token');
    const socket = io({
      auth: { token }
    });

    socket.on('connect', () => setConnection(true));
    socket.on('disconnect', () => setConnection(false));

    socket.on('dashboardUpdate', (payload) => {
      if (!payload || !payload.success || !payload.data) return;
      // Filter payload by selected line (client-side) so board stays per-line
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
      // If machine list changed (rare), rebuild
      const flat = flattenMachines(payload.data.machine_statuses_by_line);
      if (flat.length && (flat.length !== machinesFlat.length)) {
        machinesFlat = flat;
        blocks = chunkMachines(machinesFlat, 8);
        renderBoard();
      }
    });
  }

  // Update current time display (header-common also does this, but keep safe)
  setInterval(() => {
    const el = document.getElementById('currentTime');
    if (el) el.textContent = nowTz().format('HH:mm:ss');
  }, 1000);


  (async function init() {
    await loadMetrics();
    await loadInitialStatus();
    initSocket();
    // Refresh metrics periodically
    setInterval(loadMetrics, 60000);
    // Tick every second
    setInterval(updateValues, 1000);
  })();
});

