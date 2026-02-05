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

  const runtimePauseStorage = {
    key(addr, shiftKey) {
      return `rt_runtime_pause_${addr}_${shiftKey}`;
    },
    load(addr, shiftKey) {
      try {
        const raw = localStorage.getItem(this.key(addr, shiftKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.shiftKey === shiftKey && typeof parsed.value === 'number') return parsed.value;
      } catch (_) { /* ignore */ }
      return null;
    },
    save(addr, shiftKey, value) {
      try {
        localStorage.setItem(this.key(addr, shiftKey), JSON.stringify({ shiftKey, value }));
      } catch (_) { /* ignore */ }
    },
    clear(addr, shiftKey) {
      try { localStorage.removeItem(this.key(addr, shiftKey)); } catch (_) { /* ignore */ }
    }
  };

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

  function computeIdealQty(cycleSeconds, otExtraSeconds = 0) {
    const c = safeNumber(cycleSeconds);
    if (c <= 0) return 0;
    const totalSec = (RUNNING_HOUR * 3600) + safeNumber(otExtraSeconds);
    return Math.floor(totalSec / c);
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

      // Track downtime + runtime-pause state (per machine)
      if (!machineState.has(addr)) {
        machineState.set(addr, {
          lastShiftKey: shiftKey,
          downtimeStartIso: null,
          runtimePauseStartIso: null,
          runtimePauseAccumSeconds: 0,
          pausedValue: runtimePauseStorage.load(addr, shiftKey)
        });
      }
      const state = machineState.get(addr);

      // shift change -> reset tracking
      if (state.lastShiftKey !== shiftKey) {
        state.downtimeStartIso = null;
        state.runtimePauseStartIso = null;
        state.runtimePauseAccumSeconds = 0;
        state.pausedValue = null;
        runtimePauseStorage.clear(addr, state.lastShiftKey);
        state.lastShiftKey = shiftKey;
      }

      // Determine downtime active (only for machine/quality/engineering)
      const problemType = st.problem_type || st.tipe_problem || '';
      const statusNorm = String(st.status || '').toLowerCase(); // normal|warning|problem|idle (varies)
      const isProblem = statusNorm === 'problem';
      const isWarning = statusNorm === 'warning';
      const isDowntimeActive = isProblem && isDowntimeProblemType(problemType);
      const isIdle = statusNorm === 'idle' || st.is_idle === true || String(st.machine_state || '').toLowerCase() === 'idle';

      // Runtime should PAUSE for:
      // - idle, or
      // - cycle-time threshold problem (usually warning), or
      // - problem that is NOT downtime type (problem without machine/quality/engineering)
      // Downtime timer remains only for machine/quality/engineering.
      const isRuntimePaused = isIdle || (isWarning && !isDowntimeActive) || (isProblem && !isDowntimeActive);

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

      // Track runtime pause start/accum (does NOT affect downtime display)
      if (isRuntimePaused) {
        if (!state.runtimePauseStartIso) {
          state.runtimePauseStartIso = now.toISOString();
        }
      } else if (state.runtimePauseStartIso) {
        const ps = moment(state.runtimePauseStartIso);
        state.runtimePauseAccumSeconds += Math.max(0, now.diff(ps, 'seconds'));
        state.runtimePauseStartIso = null;
      }

      const runtimePauseSecCurrent = state.runtimePauseStartIso
        ? Math.max(0, now.diff(moment(state.runtimePauseStartIso), 'seconds'))
        : 0;
      const runtimePauseTotalSec = Math.max(0, (state.runtimePauseAccumSeconds || 0) + runtimePauseSecCurrent);

      // Run-time: compute from wall clock (persists across refresh)
      // elapsed since shift start minus downtime minus runtime-pause (idle / cycle-time threshold)
      const elapsedSinceShiftStart = Math.max(0, now.diff(shiftStart, 'seconds'));
      const runtimeRaw = Math.max(0, elapsedSinceShiftStart - downtimeSec - runtimePauseTotalSec);

      // Freeze runtime when paused, restore across refresh
      if (isRuntimePaused) {
        if (state.pausedValue == null) {
          state.pausedValue = runtimeRaw;
          runtimePauseStorage.save(addr, shiftKey, state.pausedValue);
        }
      } else if (state.pausedValue != null) {
        state.pausedValue = null;
        runtimePauseStorage.clear(addr, shiftKey);
      }

      const runtimeSeconds = (state.pausedValue != null) ? state.pausedValue : runtimeRaw;

      const cycle = safeNumber(metrics.cycle_time);
      const otActive = isOtActive(metrics, now);
      const otExtraSec = otActive ? getOtDurationSeconds(metrics.ot_duration_type) : 0;
      const idealQty = computeIdealQty(cycle, otExtraSec);
      const actualQty = safeNumber(st.quantity);
      const oee = computeOee(actualQty, cycle);
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
          if (otActive) idealEl.classList.add('rt-ideal-ot');
          else idealEl.classList.remove('rt-ideal-ot');
        }
        setText('total', String(actualQty));
        setText('ng', '0');
        setText('runtime', fmtHHMMSS(runtimeSeconds));
        setText('downtime', fmtHHMMSS(downtimeSec));
        setText('oee', (oee == null) ? '-' : oee.toFixed(2) + '%');
        const targetHtml = (target == null ? '-' : String(target)) +
          (targetOt != null && metrics.ot_enabled
            ? `<br><span class="rt-target-ot">${targetOt}</span>`
            : '');
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
      const userDataEl = document.getElementById('userData');
      const userRole = userDataEl ? userDataEl.dataset.role : null;
      const userDivision = userDataEl ? userDataEl.dataset.division : null;
      
      const qs = lineFilter ? `?${new URLSearchParams({ line_name: lineFilter }).toString()}` : '';
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-User-Role': userRole || '',
        'X-User-Division': userDivision || '',
        'X-Line-Name': lineFilter || ''
      };
      
      const res = await fetch(`/api/dashboard/status${qs}`, { headers });
      const json = await res.json();
      if (!res.ok || !json.success || !json.data) {
        console.warn('Failed to load initial status:', json.message || 'Unknown error');
        return;
      }
      
      // Ensure machine_statuses_by_line exists
      if (!json.data.machine_statuses_by_line) {
        console.warn('No machine_statuses_by_line in response');
        json.data.machine_statuses_by_line = {};
      }
      
      lastStatusPayload = json.data;
      machinesFlat = flattenMachines(json.data.machine_statuses_by_line);
      
      // Only render if we have machines
      if (machinesFlat.length > 0) {
        // Use 8 columns per block like screenshot
        blocks = chunkMachines(machinesFlat, 8);
        renderBoard();
      } else {
        console.warn('No machines found for current filter');
        if (boardEl) {
          boardEl.innerHTML = `<div style="color:#666; padding:12px; text-align:center;">Tidak ada mesin yang ditemukan untuk filter saat ini.</div>`;
        }
      }
    } catch (e) {
      console.error('Error loading initial status:', e);
    }
  }

  let fallbackIntervalId = null;

  function initSocket() {
    const token = getCookieValue('auth_token');
    const socket = io({
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    socket.on('connect', () => {
      setConnection(true);
      // Clear fallback interval if socket reconnects
      if (fallbackIntervalId) {
        clearInterval(fallbackIntervalId);
        fallbackIntervalId = null;
      }
      // Reload initial status when socket connects to ensure fresh data
      loadInitialStatus();
    });
    
    socket.on('disconnect', () => {
      setConnection(false);
      // Fallback: reload data periodically when socket is disconnected
      if (!fallbackIntervalId) {
        fallbackIntervalId = setInterval(() => {
          if (socket.connected) {
            clearInterval(fallbackIntervalId);
            fallbackIntervalId = null;
          } else {
            loadInitialStatus();
          }
        }, 30000); // Every 30 seconds
      }
    });

    socket.on('connect_error', (error) => {
      console.warn('Socket connection error:', error);
      setConnection(false);
      // PERBAIKAN: Load data immediately on connection error, then set up periodic reload
      loadInitialStatus();
      // Start fallback immediately on connection error
      if (!fallbackIntervalId) {
        fallbackIntervalId = setInterval(() => {
          if (socket.connected) {
            clearInterval(fallbackIntervalId);
            fallbackIntervalId = null;
          } else {
            loadInitialStatus();
          }
        }, 30000);
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setConnection(false);
      // Load data immediately on socket error
      loadInitialStatus();
    });

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

