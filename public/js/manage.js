(function () {
    'use strict';

    const API = '/api';
    const DAY_NAMES = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
    const BREAK_SLOTS = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 4, 6: 2, 7: 2 };

    function getAuthHeaders() {
        const value = `; ${document.cookie}`;
        const parts = value.split('; auth_token=');
        const token = parts.length === 2 ? parts.pop().split(';').shift() : null;
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    }

    function normalizeTime(s) {
        if (!s || typeof s !== 'string') return '';
        const m = String(s).trim().match(/^(\d{1,2}):(\d{2})/);
        if (!m) return s;
        return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + String(parseInt(m[2], 10)).padStart(2, '0');
    }

    function showScheduleSuccess(message) {
        const msg = message || 'Data Schedule berhasil disimpan.';
        if (typeof Swal !== 'undefined') {
            Swal.fire('Berhasil', msg, 'success');
        } else {
            alert(msg);
        }
    }

    // --- Section detection
    const sectionEl = document.querySelector('.manage-section[style*="block"]') || document.querySelector('[data-section]');
    const currentSection = sectionEl ? sectionEl.getAttribute('data-section') : 'machine';

    // User role (management = view only, no add/edit/delete/config)
    const userRole = (() => {
        const el = document.getElementById('userData');
        return el ? (el.getAttribute('data-role') || '') : '';
    })();
    const isManagementViewOnly = userRole === 'management';
    const leaderLineName = (() => {
        const el = document.getElementById('userData');
        return el ? (el.getAttribute('data-line') || '') : '';
    })();

    // ========== MACHINE ==========
    let allMachines = [];
    let machinePage = 1;
    let machinePageSize = 10;
    let machineFilter = { name: '', division: '', line: '' };

    async function loadDivisionsForMachine() {
        try {
            const res = await fetch(`${API}/division-lines`, { credentials: 'include', headers: getAuthHeaders() });
            const data = await res.json();
            if (!data.success || !data.data) return {};
            const map = {};
            data.data.forEach(d => {
                map[d.name] = (d.lines || []).map(l => l.name);
            });
            return map;
        } catch (e) {
            return {};
        }
    }

    function populateMachineDropdowns(divisionLineMap, divisionSelectId, lineSelectId, selectedDivision, selectedLine) {
        const divSelect = document.getElementById(divisionSelectId);
        const lineSelect = document.getElementById(lineSelectId);
        if (!divSelect || !lineSelect) return;
        divSelect.innerHTML = '<option value="">Pilih Divisi</option>';
        Object.keys(divisionLineMap).forEach(div => {
            const opt = document.createElement('option');
            opt.value = div;
            opt.textContent = div;
            if (selectedDivision === div) opt.selected = true;
            divSelect.appendChild(opt);
        });
        const lines = divisionLineMap[selectedDivision] || [];
        lineSelect.innerHTML = '<option value="">Pilih Line</option>';
        lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = line;
            opt.textContent = line;
            if (selectedLine === line) opt.selected = true;
            lineSelect.appendChild(opt);
        });
    }

    async function loadMachines() {
        try {
            const res = await fetch(`${API}/inspect-tables`, { credentials: 'include', headers: getAuthHeaders() });
            const data = await res.json();
            allMachines = Array.isArray(data) ? data : (data.data || data) || [];
        } catch (e) {
            allMachines = [];
        }
        renderMachinesTable();
    }

    function getFilteredMachines() {
        let list = allMachines.slice();
        if (machineFilter.name) {
            const q = machineFilter.name.toLowerCase();
            list = list.filter(m =>
                (m.name || '').toLowerCase().includes(q) ||
                String(m.machine_id || '').toLowerCase().includes(q)
            );
        }
        if (machineFilter.division) list = list.filter(m => (m.division || '') === machineFilter.division);
        if (machineFilter.line) list = list.filter(m => (m.line_name || m.line) === machineFilter.line);
        return list;
    }

    function renderMachinesTable() {
        const tbody = document.querySelector('#machinesTable tbody');
        const infoEl = document.getElementById('machinePaginationInfo');
        const ctrlEl = document.getElementById('machinePaginationControls');
        if (!tbody) return;
        const filtered = getFilteredMachines();
        const total = filtered.length;
        const start = (machinePage - 1) * machinePageSize;
        const pageData = filtered.slice(start, start + machinePageSize);

        const actionCellHtml = isManagementViewOnly
            ? '<td class="text-muted">—</td>'
            : `<td>
                    <div class="action-buttons-container">
                        <button class="btn-edit" type="button" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-delete" type="button" title="Hapus"><i class="fas fa-trash"></i></button>
                        <button class="btn-config-gear" type="button" title="Konfigurasi"><i class="fas fa-gear"></i></button>
                    </div>
                </td>`;
        tbody.innerHTML = pageData.map(m => `
            <tr data-id="${m.id}" data-machine-id="${escapeHtml(m.machine_id || '')}" data-address="${m.address || ''}" data-name="${escapeHtml(m.name || '')}" data-division="${m.division || ''}" data-line="${m.line_name || m.line || ''}" data-cycle="${m.cycle_time || ''}" data-cavity="${m.cavity || ''}" data-warning="${m.warning_cycle_count || ''}" data-problem="${m.problem_cycle_count || ''}">
                <td>${escapeHtml(m.machine_id || '')}</td>
                <td>${escapeHtml(m.name || '')}</td>
                <td>${escapeHtml(m.division || '')}</td>
                <td>${escapeHtml(m.line_name || m.line || '')}</td>
                <td>${(m.cycle_time ?? '') === '' ? '-' : m.cycle_time}</td>
                <td>${(m.cavity ?? '') === '' ? '-' : m.cavity}</td>
                <td>${m.address || ''}</td>
                ${actionCellHtml}
            </tr>
        `).join('') || '<tr><td colspan="8" style="text-align:center;">Tidak ada data</td></tr>';

        if (infoEl) infoEl.textContent = `Menampilkan ${start + 1}-${Math.min(start + machinePageSize, total)} dari ${total} mesin`;
        if (ctrlEl) {
            const lastPage = Math.max(1, Math.ceil(total / machinePageSize));
            ctrlEl.innerHTML = `
                <button type="button" data-page="prev" ${machinePage <= 1 ? 'disabled' : ''}>Prev</button>
                <span>${machinePage} / ${lastPage}</span>
                <button type="button" data-page="next" ${machinePage >= lastPage ? 'disabled' : ''}>Next</button>
            `;
            ctrlEl.querySelector('[data-page="prev"]').addEventListener('click', () => { machinePage = Math.max(1, machinePage - 1); renderMachinesTable(); });
            ctrlEl.querySelector('[data-page="next"]').addEventListener('click', () => { machinePage = Math.min(lastPage, machinePage + 1); renderMachinesTable(); });
        }

        if (!isManagementViewOnly) {
            tbody.querySelectorAll('.btn-edit').forEach(btn => {
                btn.addEventListener('click', () => openEditMachine(btn.closest('tr')));
            });
            tbody.querySelectorAll('.btn-delete').forEach(btn => {
                btn.addEventListener('click', () => deleteMachine(btn.closest('tr')));
            });
            tbody.querySelectorAll('.btn-config-gear').forEach(btn => {
                btn.addEventListener('click', () => openConfigMachine(btn.closest('tr')));
            });
        }
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    async function openEditMachine(tr) {
        if (!tr) return;
        const id = tr.dataset.id;
        const name = tr.dataset.name;
        const division = tr.dataset.division;
        const line = tr.dataset.line;
        const machineId = tr.dataset.machineId || '';
        const divisionLineMap = await loadDivisionsForMachine();
        document.getElementById('editMachineId').value = id;
        const midEl = document.getElementById('editMachineMachineId');
        if (midEl) midEl.value = machineId;
        document.getElementById('editMachineName').value = name;
        populateMachineDropdowns(divisionLineMap, 'editMachineDivision', 'editMachineLine', division, line);
        document.getElementById('editMachineModal').classList.add('show');
    }

    async function openConfigMachine(tr) {
        if (!tr) return;
        const address = tr.dataset.address;
        document.getElementById('configMachineAddress').value = address;
        document.getElementById('configCycleAddress').value = address;
        document.getElementById('configCavityAddress').value = address;
        document.getElementById('configCycleThresholdAddress').value = address;
        document.getElementById('configCycleTimeInput').value = tr.dataset.cycle || '';
        document.getElementById('configCavityInput').value = tr.dataset.cavity || '1';
        document.getElementById('configWarningCycleCountInput').value = tr.dataset.warning || '';
        document.getElementById('configProblemCycleCountInput').value = tr.dataset.problem || '';
        document.getElementById('configMachineModal').classList.add('show');
    }

    async function deleteMachine(tr) {
        if (!tr || !confirm('Hapus mesin ini?')) return;
        const id = tr.dataset.id;
        try {
            const res = await fetch(`${API}/inspect-tables/${id}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
            loadMachines();
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    // --- SHIFT ---
    function renderBreakTable(data) {
        const tbody = document.getElementById('breakScheduleTbody');
        if (!tbody) return;
        const byKey = {};
        (data || []).forEach(r => { byKey[`${r.day_of_week}_${r.shift}`] = r; });
        let html = '';
        for (let day = 1; day <= 7; day++) {
            for (const shift of ['pagi', 'malam']) {
                const row = byKey[`${day}_${shift}`] || {};
                const slots = BREAK_SLOTS[day] || 3;
                html += '<tr data-day="' + day + '" data-shift="' + shift + '">';
                html += '<td>' + DAY_NAMES[day] + '</td><td>' + (shift === 'pagi' ? 'Pagi' : 'Malam') + '</td>';
                for (let b = 1; b <= 4; b++) {
                    const show = b <= slots;
                    const start = normalizeTime(row['break_' + b + '_start'] || '');
                    const end = normalizeTime(row['break_' + b + '_end'] || '');
                    html += '<td>' + (show ? '<input type="time" data-field="break_' + b + '_start" value="' + start + '"> – <input type="time" data-field="break_' + b + '_end" value="' + end + '">' : '–') + '</td>';
                }
                html += '</tr>';
            }
        }
        tbody.innerHTML = html;
    }

    function renderShiftWorkTable(data) {
        const tbody = document.getElementById('shiftWorkTbody');
        if (!tbody) return;
        const byKey = {};
        (data || []).forEach(r => { byKey[`${r.day_of_week}_${r.shift}`] = r; });
        let html = '';
        for (let day = 1; day <= 7; day++) {
            for (const shift of ['pagi', 'malam']) {
                const row = byKey[`${day}_${shift}`] || {};
                html += '<tr data-day="' + day + '" data-shift="' + shift + '">';
                html += '<td>' + DAY_NAMES[day] + '</td><td>' + (shift === 'pagi' ? 'Pagi' : 'Malam') + '</td>';
                html += '<td><input type="time" data-field="work_start" value="' + normalizeTime(row.work_start || '') + '"></td>';
                html += '<td><input type="time" data-field="work_end" value="' + normalizeTime(row.work_end || '') + '"></td>';
                html += '</tr>';
            }
        }
        tbody.innerHTML = html;
    }

    async function loadBreakSchedules() {
        try {
            const res = await fetch(`${API}/break-schedules`, { headers: getAuthHeaders() });
            const json = await res.json();
            const data = (json.success && json.data) ? json.data : [];
            renderBreakTable(data);
            renderShiftWorkTable(data);
        } catch (e) {
            renderBreakTable([]);
            renderShiftWorkTable([]);
        }
    }

    function collectSchedulesFromBreakTable() {
        const rows = document.querySelectorAll('#breakScheduleTbody tr[data-day][data-shift]');
        const schedules = [];
        rows.forEach(tr => {
            const day = parseInt(tr.dataset.day, 10);
            const shift = tr.dataset.shift;
            const o = { day_of_week: day, shift, work_start: null, work_end: null };
            for (let b = 1; b <= 4; b++) {
                o['break_' + b + '_start'] = (tr.querySelector('input[data-field="break_' + b + '_start"]') || {}).value || null;
                o['break_' + b + '_end'] = (tr.querySelector('input[data-field="break_' + b + '_end"]') || {}).value || null;
            }
            schedules.push(o);
        });
        return schedules;
    }

    function collectSchedulesFromWorkTable() {
        const rows = document.querySelectorAll('#shiftWorkTbody tr[data-day][data-shift]');
        const byKey = {};
        rows.forEach(tr => {
            const day = parseInt(tr.dataset.day, 10);
            const shift = tr.dataset.shift;
            const work_start = (tr.querySelector('input[data-field="work_start"]') || {}).value || null;
            const work_end = (tr.querySelector('input[data-field="work_end"]') || {}).value || null;
            byKey[`${day}_${shift}`] = { day_of_week: day, shift, work_start, work_end };
        });
        return byKey;
    }

    async function saveBreakSchedules() {
        const breakRows = document.querySelectorAll('#breakScheduleTbody tr[data-day][data-shift]');
        const workRows = document.querySelectorAll('#shiftWorkTbody tr[data-day][data-shift]');
        const byKey = {};
        workRows.forEach(tr => {
            const day = parseInt(tr.dataset.day, 10);
            const shift = tr.dataset.shift;
            byKey[`${day}_${shift}`] = {
                work_start: (tr.querySelector('input[data-field="work_start"]') || {}).value || null,
                work_end: (tr.querySelector('input[data-field="work_end"]') || {}).value || null
            };
        });
        const schedules = [];
        breakRows.forEach(tr => {
            const day = parseInt(tr.dataset.day, 10);
            const shift = tr.dataset.shift;
            const work = byKey[`${day}_${shift}`] || {};
            const o = { day_of_week: day, shift, work_start: work.work_start, work_end: work.work_end };
            for (let b = 1; b <= 4; b++) {
                o['break_' + b + '_start'] = (tr.querySelector('input[data-field="break_' + b + '_start"]') || {}).value || null;
                o['break_' + b + '_end'] = (tr.querySelector('input[data-field="break_' + b + '_end"]') || {}).value || null;
            }
            schedules.push(o);
        });
        try {
            const res = await fetch(`${API}/break-schedules`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ schedules }) });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message || 'Gagal');
            alert('Jadwal berhasil disimpan.');
            if (json.data) { renderBreakTable(json.data); renderShiftWorkTable(json.data); }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    // --- OEE ---
    async function loadOeeSettings() {
        const input = document.getElementById('oeeWarningThresholdInput');
        if (!input) return;
        try {
            const res = await fetch(`${API}/oee-settings`, { headers: getAuthHeaders() });
            const json = await res.json();
            if (json.success && json.data && typeof json.data.warning_threshold_percent !== 'undefined') {
                input.value = Number(json.data.warning_threshold_percent);
            }
        } catch (e) {}
    }

    async function saveOeeThreshold() {
        const input = document.getElementById('oeeWarningThresholdInput');
        if (!input) return;
        const val = Number(input.value);
        if (Number.isNaN(val) || val < 0 || val > 100) {
            alert('Nilai 0–100.');
            return;
        }
        try {
            const res = await fetch(`${API}/oee-settings`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ warning_threshold_percent: val }) });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || 'Gagal');
            alert('Threshold OEE disimpan.');
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    // --- SCHEDULE ---
    let schedulePage = 1;
    let schedulePageSize = 10;
    let scheduleAppliedFilter = { schedule_date: '', machine_address: '', shift: '' };
    let scheduleDraftFilter = { schedule_date: '', machine_address: '', shift: '' };

    /** Nilai internal tetap 2h_pagi / 3.5h_pagi / 2h_malam (selaras RunningHourOtExtension). */
    function scheduleOtOptionsForShift(shift) {
        const s = shift === 'malam' ? 'malam' : 'pagi';
        if (s === 'malam') {
            return [{ value: '2h_malam', label: '2 jam' }];
        }
        return [
            { value: '2h_pagi', label: '2 jam' },
            { value: '3.5h_pagi', label: '3,5 jam' }
        ];
    }

    function fillScheduleOtDurationSelect(selectId, shift, preferredValue) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const opts = scheduleOtOptionsForShift(shift);
        const allowed = opts.map(o => o.value);
        let html = '<option value="">-- Pilih --</option>';
        opts.forEach(o => {
            html += `<option value="${o.value}">${escapeHtml(o.label)}</option>`;
        });
        sel.innerHTML = html;
        const pick = preferredValue && allowed.includes(preferredValue) ? preferredValue : '';
        sel.value = pick;
    }

    function scheduleOtDurationTableLabel(shift, otDurationType) {
        if (!otDurationType) return '';
        const s = shift === 'malam' ? 'malam' : 'pagi';
        if (s === 'malam') {
            return otDurationType === '2h_malam' ? '2 jam' : String(otDurationType);
        }
        if (otDurationType === '2h_pagi') return '2 jam';
        if (otDurationType === '3.5h_pagi') return '3,5 jam';
        return String(otDurationType);
    }

    async function loadScheduleMachines() {
        try {
            const res = await fetch(`${API}/inspect-tables`, { credentials: 'include', headers: getAuthHeaders() });
            const data = await res.json();
            let list = Array.isArray(data) ? data : (data.data || data) || [];
            if (userRole === 'leader' && leaderLineName) {
                list = list.filter(m => String(m.line_name || m.line || '') === String(leaderLineName));
            }
            const sel = document.getElementById('scheduleMachine');
            const editSel = document.getElementById('editScheduleMachine');
            const filterSel = document.getElementById('filterScheduleMachine');
            const weekSel = document.getElementById('weekScheduleMachine');

            // Add & Edit & Week dropdowns
            [sel, editSel, weekSel].forEach(select => {
                if (!select) return;
                const cur = select.value;
                select.innerHTML = '<option value="">Pilih Mesin</option>';
                list.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.address || m.id;
                    opt.textContent = m.name || m.address;
                    if (cur === (m.address || m.id)) opt.selected = true;
                    select.appendChild(opt);
                });
            });

            // Filter dropdown
            if (filterSel) {
                const cur = filterSel.value;
                filterSel.innerHTML = '<option value="">Semua Mesin</option>';
                list.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.address || m.id;
                    opt.textContent = m.name || m.address;
                    if (cur === (m.address || m.id)) opt.selected = true;
                    filterSel.appendChild(opt);
                });
            }
        } catch (e) {}
    }

    async function loadSchedules() {
        const tbody = document.querySelector('#scheduleTable tbody');
        const infoEl = document.getElementById('schedulePaginationInfo');
        const ctrlEl = document.getElementById('schedulePaginationControls');
        if (!tbody) return;
        try {
            const params = new URLSearchParams({ page: schedulePage, per_page: schedulePageSize });
            if (scheduleAppliedFilter.schedule_date) params.set('schedule_date', scheduleAppliedFilter.schedule_date);
            if (scheduleAppliedFilter.machine_address) params.set('machine_address', scheduleAppliedFilter.machine_address);
            if (scheduleAppliedFilter.shift) params.set('shift', scheduleAppliedFilter.shift);
            const res = await fetch(`${API}/machine-schedules?${params}`, { credentials: 'include', headers: getAuthHeaders() });
            const json = await res.json();
            if (!json.success) throw new Error(json.message || 'Gagal');
            const list = json.data || [];
            const total = json.total || 0;
            const lastPage = json.last_page || 1;
            const scheduleActionCell = isManagementViewOnly
                ? '<td class="text-muted">—</td>'
                : `<td>
                        <div class="action-buttons-container">
                            <button class="btn-edit btn-schedule-edit" type="button" title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="btn-delete btn-schedule-delete" type="button" title="Hapus"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>`;
            tbody.innerHTML = list.map(s => {
                const shiftKey = (s.shift || 'pagi') === 'malam' ? 'malam' : 'pagi';
                const shiftLabel = shiftKey === 'malam' ? 'Malam' : 'Pagi';
                const otLabel = s.ot_enabled ? 'Aktif' : 'Nonaktif';
                const durasiLabel = s.ot_enabled ? scheduleOtDurationTableLabel(shiftKey, s.ot_duration_type) : '';
                const targetOtLabel = s.target_ot != null ? s.target_ot : '-';
                return `
                <tr data-id="${s.id}">
                    <td>${s.schedule_date}</td>
                    <td>${escapeHtml(s.machine_name || s.machine_address)}</td>
                    <td>${shiftLabel}</td>
                    <td>${s.target_quantity}</td>
                    <td>${otLabel}</td>
                    <td>${durasiLabel || '-'}</td>
                    <td>${targetOtLabel}</td>
                    <td><span class="status-${s.status.toLowerCase()}">${s.status}</span></td>
                    ${scheduleActionCell}
                </tr>
                `;
            }).join('') || '<tr><td colspan="9">Tidak ada data</td></tr>';

            if (infoEl) infoEl.textContent = `Menampilkan ${list.length} dari ${total} schedule`;
            if (ctrlEl) {
                ctrlEl.innerHTML = `
                    <button type="button" data-page="prev" ${schedulePage <= 1 ? 'disabled' : ''}>Prev</button>
                    <span>${schedulePage} / ${lastPage}</span>
                    <button type="button" data-page="next" ${schedulePage >= lastPage ? 'disabled' : ''}>Next</button>
                `;
                ctrlEl.querySelector('[data-page="prev"]').addEventListener('click', () => { schedulePage--; loadSchedules(); });
                ctrlEl.querySelector('[data-page="next"]').addEventListener('click', () => { schedulePage++; loadSchedules(); });
            }

            if (!isManagementViewOnly) {
                tbody.querySelectorAll('.btn-schedule-edit').forEach(btn => {
                    btn.addEventListener('click', () => openEditSchedule(btn.closest('tr'), list));
                });
                tbody.querySelectorAll('.btn-schedule-delete').forEach(btn => {
                    btn.addEventListener('click', () => deleteSchedule(btn.closest('tr')));
                });
            }
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="9">Error: ' + escapeHtml(e.message) + '</td></tr>';
        }
    }

    function openEditSchedule(tr, list) {
        if (!tr) return;
        const id = tr.dataset.id;
        const row = (list || []).find(r => String(r.id) === id);
        if (!row) return;
        document.getElementById('editScheduleId').value = id;
        document.getElementById('editScheduleDate').value = row.schedule_date;
        document.getElementById('editScheduleShift').value = row.shift || 'pagi';
        document.getElementById('editScheduleTarget').value = row.target_quantity;
        document.getElementById('editScheduleOtEnabled').checked = row.ot_enabled || false;
        fillScheduleOtDurationSelect('editScheduleOtDuration', row.shift || 'pagi', row.ot_duration_type || '');
        document.getElementById('editScheduleTargetOt').value = row.target_ot || '';
        const otWrap = document.getElementById('editScheduleOtFields');
        const otTargetWrap = document.getElementById('editScheduleTargetOtWrap');
        otWrap.style.display = row.ot_enabled ? 'block' : 'none';
        otTargetWrap.style.display = row.ot_enabled ? 'block' : 'none';
        loadScheduleMachines().then(() => {
            const sel = document.getElementById('editScheduleMachine');
            if (sel) sel.value = row.machine_address || '';
        });
        document.getElementById('editScheduleModal').classList.add('show');
    }

    async function deleteSchedule(tr) {
        if (!tr || !confirm('Hapus schedule ini?')) return;
        const id = tr.dataset.id;
        try {
            const res = await fetch(`${API}/machine-schedules/${id}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
            loadSchedules();
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    // --- LINES (reuse manage-lines logic via global functions from manage-lines.js is not included; we implement minimal here)
    let divisions = [];
    async function loadDivisions() {
        const container = document.getElementById('divisionsList');
        if (!container) return;
        try {
            const res = await fetch(`${API}/division-lines`, { credentials: 'include', headers: getAuthHeaders() });
            const result = await res.json();
            if (result.success && result.data) {
                divisions = result.data;
                renderDivisions();
            } else {
                container.innerHTML = '<p>Gagal memuat data.</p>';
            }
        } catch (e) {
            container.innerHTML = '<p>Error: ' + e.message + '</p>';
        }
    }

    function renderDivisions() {
        const container = document.getElementById('divisionsList');
        if (!container) return;
        if (divisions.length === 0) {
            container.innerHTML = '<div class="empty-lines"><i class="fas fa-inbox"></i><p>Tidak ada divisi.</p></div>';
            return;
        }
        container.innerHTML = divisions.map(division => {
            const linesHtml = (division.lines || []).map(line => `
                <div class="line-item">
                    <span class="line-name">${escapeHtml(line.name)}</span>
                    <div class="line-actions">
                        <button class="btn-edit-line" data-line-id="${line.id}" data-division-id="${line.division_id}" data-name="${escapeHtml(line.name)}" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-delete-line" data-line-id="${line.id}" data-name="${escapeHtml(line.name)}" title="Hapus"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('') || '<div class="empty-lines">Belum ada line</div>';
            return `
                <div class="division-item">
                    <div class="division-header-row">
                        <div class="division-title"><i class="fas fa-industry"></i> ${escapeHtml(division.name)}</div>
                        <div class="division-actions">
                            <button class="btn-edit-division" data-division-id="${division.id}" data-name="${escapeHtml(division.name)}" title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="btn-add-line" data-division-id="${division.id}" title="Tambah Line"><i class="fas fa-plus"></i></button>
                            <button class="btn-delete-division" data-division-id="${division.id}" data-name="${escapeHtml(division.name)}" title="Hapus"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="lines-list">${linesHtml}</div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-edit-division').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('editDivisionId').value = btn.dataset.divisionId;
                document.getElementById('editDivisionName').value = btn.dataset.name;
                document.getElementById('editDivisionModal').classList.add('show');
            });
        });
        container.querySelectorAll('.btn-add-line').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('addLineDivisionId').value = btn.dataset.divisionId;
                document.getElementById('addLineName').value = '';
                document.getElementById('addLineModal').classList.add('show');
            });
        });
        container.querySelectorAll('.btn-delete-division').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus divisi ' + btn.dataset.name + '?')) return;
                try {
                    const res = await fetch(`${API}/division-lines/divisions/${btn.dataset.divisionId}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
                    if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                    loadDivisions();
                } catch (e) { alert(e.message); }
            });
        });
        container.querySelectorAll('.btn-edit-line').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('editLineId').value = btn.dataset.lineId;
                document.getElementById('editLineName').value = btn.dataset.name;
                const divSel = document.getElementById('editLineDivisionId');
                divSel.innerHTML = divisions.map(d => `<option value="${d.id}" ${d.id == btn.dataset.divisionId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
                document.getElementById('editLineModal').classList.add('show');
            });
        });
        container.querySelectorAll('.btn-delete-line').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus line ' + btn.dataset.name + '?')) return;
                try {
                    const res = await fetch(`${API}/division-lines/lines/${btn.dataset.lineId}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
                    if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                    loadDivisions();
                } catch (e) { alert(e.message); }
            });
        });
    }

    // --- Modals close
    function closeModal(id) {
        document.getElementById(id).classList.remove('show');
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Machine
        const addMachineForm = document.getElementById('addMachineForm');
        if (addMachineForm) {
            addMachineForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(addMachineForm);
                const payload = { name: fd.get('name'), division: fd.get('division'), line_name: fd.get('line_name') };
                if (!payload.name || !payload.division || !payload.line_name) return alert('Isi semua field.');
                try {
                    const res = await fetch(`${API}/inspect-tables`, { method: 'POST', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify(payload) });
                    if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                    addMachineForm.reset();
                    loadMachines();
                } catch (err) { alert(err.message); }
            });
        }
        const editMachineForm = document.getElementById('editMachineForm');
        if (editMachineForm) {
            editMachineForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const id = document.getElementById('editMachineId').value;
                const machineId = (document.getElementById('editMachineMachineId')?.value || '').trim();
                const payload = {
                    machine_id: machineId,
                    name: document.getElementById('editMachineName').value,
                    division: document.getElementById('editMachineDivision').value,
                    line_name: document.getElementById('editMachineLine').value
                };
                if (!machineId) return alert('Isi ID Mesin.');
                try {
                    const res = await fetch(`${API}/inspect-tables/${id}`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify(payload) });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        const msg = body.message || body.errors?.machine_id?.[0] || body.errors?.name?.[0] || 'Gagal';
                        throw new Error(typeof msg === 'string' ? msg : 'Gagal validasi.');
                    }
                    closeModal('editMachineModal');
                    loadMachines();
                } catch (err) { alert(err.message); }
            });
        }
        document.getElementById('machineDivisionSelect')?.addEventListener('change', async function () {
            const map = await loadDivisionsForMachine();
            populateMachineDropdowns(map, 'machineDivisionSelect', 'machineLineSelect', this.value, '');
        });
        document.getElementById('editMachineDivision')?.addEventListener('change', async function () {
            const map = await loadDivisionsForMachine();
            populateMachineDropdowns(map, 'editMachineDivision', 'editMachineLine', this.value, '');
        });
        document.getElementById('machinePageSize')?.addEventListener('change', function () {
            machinePageSize = parseInt(this.value, 10);
            machinePage = 1;
            renderMachinesTable();
        });
        document.getElementById('filterMachineName')?.addEventListener('input', function () {
            machineFilter.name = this.value;
            machinePage = 1;
            renderMachinesTable();
        });
        document.getElementById('filterMachineDivision')?.addEventListener('change', async function () {
            machineFilter.division = this.value;
            const map = await loadDivisionsForMachine();
            const lineSel = document.getElementById('filterMachineLine');
            if (lineSel) {
                lineSel.innerHTML = '<option value="">Semua Line</option>';
                (map[this.value] || []).forEach(line => {
                    lineSel.innerHTML += '<option value="' + escapeHtml(line) + '">' + escapeHtml(line) + '</option>';
                });
            }
            machinePage = 1;
            renderMachinesTable();
        });
        document.getElementById('filterMachineLine')?.addEventListener('change', function () {
            machineFilter.line = this.value;
            machinePage = 1;
            renderMachinesTable();
        });
        document.getElementById('clearMachineFilters')?.addEventListener('click', async () => {
            machineFilter = { name: '', division: '', line: '' };
            document.getElementById('filterMachineName').value = '';
            document.getElementById('filterMachineDivision').value = '';
            document.getElementById('filterMachineLine').value = '';
            machinePage = 1;
            const map = await loadDivisionsForMachine();
            const divSel = document.getElementById('filterMachineDivision');
            const lineSel = document.getElementById('filterMachineLine');
            if (divSel) {
                divSel.innerHTML = '<option value="">Semua Divisi</option>';
                Object.keys(map).forEach(d => { divSel.innerHTML += '<option value="' + escapeHtml(d) + '">' + escapeHtml(d) + '</option>'; });
            }
            if (lineSel) lineSel.innerHTML = '<option value="">Semua Line</option>';
            renderMachinesTable();
        });

        document.getElementById('closeEditMachine')?.addEventListener('click', () => closeModal('editMachineModal'));
        document.getElementById('cancelEditMachine')?.addEventListener('click', () => closeModal('editMachineModal'));
        document.getElementById('closeConfigMachine')?.addEventListener('click', () => closeModal('configMachineModal'));
        document.getElementById('configCycleForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const address = document.getElementById('configCycleAddress').value;
            const cycle_time = parseInt(document.getElementById('configCycleTimeInput').value, 10);
            try {
                const res = await fetch(`${API}/inspection-tables/address/${address}/cycle`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ cycle_time }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                alert('Cycle time disimpan.');
                loadMachines();
            } catch (err) { alert(err.message); }
        });
        document.getElementById('configCavityForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const address = document.getElementById('configCavityAddress').value;
            const cavity = parseInt(document.getElementById('configCavityInput').value, 10);
            try {
                const res = await fetch(`${API}/inspection-tables/address/${address}/cavity`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ cavity }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                alert('Cavity disimpan.');
                loadMachines();
            } catch (err) { alert(err.message); }
        });
        document.getElementById('configCycleThresholdForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const address = document.getElementById('configCycleThresholdAddress').value;
            const warning_cycle_count = parseInt(document.getElementById('configWarningCycleCountInput').value, 10);
            const problem_cycle_count = parseInt(document.getElementById('configProblemCycleCountInput').value, 10);
            try {
                const res = await fetch(`${API}/inspection-tables/address/${address}/cycle-threshold`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ warning_cycle_count, problem_cycle_count }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                alert('Threshold disimpan.');
                loadMachines();
            } catch (err) { alert(err.message); }
        });

        // Shift
        document.getElementById('saveBreakSchedulesBtn')?.addEventListener('click', saveBreakSchedules);
        document.getElementById('saveShiftWorkBtn')?.addEventListener('click', saveBreakSchedules);

        // OEE
        document.getElementById('saveOeeThresholdBtn')?.addEventListener('click', saveOeeThreshold);

        // Schedule
        const addScheduleForm = document.getElementById('addScheduleForm');
        if (addScheduleForm) {
            const initAddOtSelect = () => {
                const sh = document.getElementById('scheduleShift')?.value || 'pagi';
                fillScheduleOtDurationSelect('scheduleOtDuration', sh, '');
            };
            initAddOtSelect();
            document.getElementById('scheduleShift')?.addEventListener('change', function () {
                const cur = document.getElementById('scheduleOtDuration')?.value || '';
                fillScheduleOtDurationSelect('scheduleOtDuration', this.value || 'pagi', cur);
            });
            document.getElementById('scheduleOtEnabled')?.addEventListener('change', function () {
                const show = this.checked;
                document.getElementById('scheduleOtFields').style.display = show ? 'block' : 'none';
                document.getElementById('scheduleOtTargetWrap').style.display = show ? 'block' : 'none';
                if (show) {
                    const sh = document.getElementById('scheduleShift')?.value || 'pagi';
                    const cur = document.getElementById('scheduleOtDuration')?.value || '';
                    fillScheduleOtDurationSelect('scheduleOtDuration', sh, cur);
                }
            });
            addScheduleForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const otEl = document.getElementById('scheduleOtEnabled');
                const payload = {
                    schedule_date: document.getElementById('scheduleDate').value,
                    machine_address: document.getElementById('scheduleMachine').value,
                    shift: document.getElementById('scheduleShift').value || 'pagi',
                    target_quantity: parseInt(document.getElementById('scheduleTarget').value, 10),
                    ot_enabled: otEl ? otEl.checked : false,
                    ot_duration_type: otEl && otEl.checked ? (document.getElementById('scheduleOtDuration').value || null) : null,
                    target_ot: otEl && otEl.checked && document.getElementById('scheduleTargetOt').value ? parseInt(document.getElementById('scheduleTargetOt').value, 10) : null
                };
                if (!payload.schedule_date || !payload.machine_address) return alert('Isi Tanggal dan Mesin.');
                try {
                    const res = await fetch(`${API}/machine-schedules`, { method: 'POST', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify(payload) });
                    if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                    addScheduleForm.reset();
                    document.getElementById('scheduleOtFields').style.display = 'none';
                    document.getElementById('scheduleOtTargetWrap').style.display = 'none';
                    initAddOtSelect();
                    loadSchedules();
                    showScheduleSuccess('Data Schedule berhasil disimpan.');
                } catch (err) { alert(err.message); }
            });
        }
        document.getElementById('editScheduleOtEnabled')?.addEventListener('change', function () {
            const show = this.checked;
            document.getElementById('editScheduleOtFields').style.display = show ? 'block' : 'none';
            document.getElementById('editScheduleTargetOtWrap').style.display = show ? 'block' : 'none';
            if (show) {
                const sh = document.getElementById('editScheduleShift')?.value || 'pagi';
                const cur = document.getElementById('editScheduleOtDuration')?.value || '';
                fillScheduleOtDurationSelect('editScheduleOtDuration', sh, cur);
            }
        });
        document.getElementById('editScheduleShift')?.addEventListener('change', function () {
            const cur = document.getElementById('editScheduleOtDuration')?.value || '';
            fillScheduleOtDurationSelect('editScheduleOtDuration', this.value || 'pagi', cur);
        });
        document.getElementById('editScheduleForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editScheduleId').value;
            const otEl = document.getElementById('editScheduleOtEnabled');
            const payload = {
                schedule_date: document.getElementById('editScheduleDate').value,
                machine_address: document.getElementById('editScheduleMachine').value,
                shift: document.getElementById('editScheduleShift').value || 'pagi',
                target_quantity: parseInt(document.getElementById('editScheduleTarget').value, 10),
                ot_enabled: otEl ? otEl.checked : false,
                ot_duration_type: otEl && otEl.checked ? (document.getElementById('editScheduleOtDuration').value || null) : null,
                target_ot: otEl && otEl.checked && document.getElementById('editScheduleTargetOt').value ? parseInt(document.getElementById('editScheduleTargetOt').value, 10) : null
            };
            try {
                const res = await fetch(`${API}/machine-schedules/${id}`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify(payload) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                closeModal('editScheduleModal');
                loadSchedules();
                showScheduleSuccess('Data Schedule berhasil diperbarui.');
            } catch (err) { alert(err.message); }
        });
        document.getElementById('closeEditSchedule')?.addEventListener('click', () => closeModal('editScheduleModal'));
        document.getElementById('cancelEditSchedule')?.addEventListener('click', () => closeModal('editScheduleModal'));
        document.getElementById('schedulePageSize')?.addEventListener('change', function () {
            schedulePageSize = parseInt(this.value, 10);
            schedulePage = 1;
            loadSchedules();
        });
        // Draft filter changes should NOT reload table until "Filter" clicked
        document.getElementById('filterScheduleDate')?.addEventListener('change', function () {
            scheduleDraftFilter.schedule_date = this.value || '';
        });
        document.getElementById('filterScheduleMachine')?.addEventListener('change', function () {
            scheduleDraftFilter.machine_address = this.value || '';
        });
        document.getElementById('filterScheduleShift')?.addEventListener('change', function () {
            scheduleDraftFilter.shift = this.value || '';
        });
        document.getElementById('applyScheduleFilters')?.addEventListener('click', () => {
            scheduleAppliedFilter = { ...scheduleDraftFilter };
            schedulePage = 1;
            loadSchedules();
        });
        document.getElementById('clearScheduleFilters')?.addEventListener('click', () => {
            // Always clear inputs, but only reload table if filters were already applied
            const hadApplied =
                !!(scheduleAppliedFilter.schedule_date || scheduleAppliedFilter.machine_address || scheduleAppliedFilter.shift);
            scheduleDraftFilter = { schedule_date: '', machine_address: '', shift: '' };
            document.getElementById('filterScheduleDate').value = '';
            document.getElementById('filterScheduleMachine').value = '';
            document.getElementById('filterScheduleShift').value = '';
            if (hadApplied) {
                scheduleAppliedFilter = { schedule_date: '', machine_address: '', shift: '' };
                schedulePage = 1;
                loadSchedules();
            }
        });

        // Add week schedule modal
        const openWeekBtn = document.getElementById('openAddWeekSchedule');
        openWeekBtn?.addEventListener('click', async () => {
            await loadScheduleMachines();
            document.getElementById('addWeekScheduleModal')?.classList.add('show');
        });
        document.getElementById('closeAddWeekSchedule')?.addEventListener('click', () => closeModal('addWeekScheduleModal'));
        document.getElementById('cancelAddWeekSchedule')?.addEventListener('click', () => closeModal('addWeekScheduleModal'));
        document.getElementById('addWeekScheduleForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                start_date: document.getElementById('weekScheduleStartDate').value,
                machine_address: document.getElementById('weekScheduleMachine').value,
                shift: document.getElementById('weekScheduleShift')?.value || 'pagi',
                target_quantity: parseInt(document.getElementById('weekScheduleTarget').value, 10)
            };
            if (!payload.start_date || !payload.machine_address) return alert('Isi Tanggal Mulai dan Mesin.');
            if (Number.isNaN(payload.target_quantity)) return alert('Target tidak valid.');
            try {
                const res = await fetch(`${API}/machine-schedules/week`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.message || 'Gagal');
                closeModal('addWeekScheduleModal');
                document.getElementById('addWeekScheduleForm').reset();
                loadSchedules();
                showScheduleSuccess(json.message || 'Schedule 1 minggu berhasil dibuat.');
            } catch (err) {
                alert(err.message);
            }
        });

        // Lines
        document.getElementById('addDivisionForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.querySelector('#addDivisionForm input[name="name"]').value.trim();
            if (!name) return;
            try {
                const res = await fetch(`${API}/division-lines/divisions`, { method: 'POST', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ name }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                loadDivisions();
                e.target.reset();
            } catch (err) { alert(err.message); }
            return false;
        });
        document.getElementById('editDivisionForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editDivisionId').value;
            const name = document.getElementById('editDivisionName').value.trim();
            try {
                const res = await fetch(`${API}/division-lines/divisions/${id}`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ name }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                closeModal('editDivisionModal');
                loadDivisions();
            } catch (err) { alert(err.message); }
            return false;
        });
        document.getElementById('addLineForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const division_id = document.getElementById('addLineDivisionId').value;
            const name = document.getElementById('addLineName').value.trim();
            if (!name) return;
            try {
                const res = await fetch(`${API}/division-lines/lines`, { method: 'POST', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ division_id, name }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                closeModal('addLineModal');
                loadDivisions();
                e.target.reset();
            } catch (err) { alert(err.message); }
            return false;
        });
        document.getElementById('editLineForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editLineId').value;
            const division_id = document.getElementById('editLineDivisionId').value;
            const name = document.getElementById('editLineName').value.trim();
            try {
                const res = await fetch(`${API}/division-lines/lines/${id}`, { method: 'PUT', credentials: 'include', headers: getAuthHeaders(), body: JSON.stringify({ division_id, name }) });
                if (!res.ok) throw new Error((await res.json()).message || 'Gagal');
                closeModal('editLineModal');
                loadDivisions();
            } catch (err) { alert(err.message); }
            return false;
        });
        document.getElementById('closeEditDivision')?.addEventListener('click', () => closeModal('editDivisionModal'));
        document.getElementById('cancelEditDivision')?.addEventListener('click', () => closeModal('editDivisionModal'));
        document.getElementById('closeAddLine')?.addEventListener('click', () => closeModal('addLineModal'));
        document.getElementById('cancelAddLine')?.addEventListener('click', () => closeModal('addLineModal'));
        document.getElementById('closeEditLine')?.addEventListener('click', () => closeModal('editLineModal'));
        document.getElementById('cancelEditLine')?.addEventListener('click', () => closeModal('editLineModal'));

        // Init by section
        if (currentSection === 'machine') {
            loadDivisionsForMachine().then(map => {
                populateMachineDropdowns(map, 'machineDivisionSelect', 'machineLineSelect', '', '');
                const fDiv = document.getElementById('filterMachineDivision');
                const fLine = document.getElementById('filterMachineLine');
                if (fDiv) { fDiv.innerHTML = '<option value="">Semua Divisi</option>'; Object.keys(map).forEach(d => { fDiv.innerHTML += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; }); }
                if (fLine) { fLine.innerHTML = '<option value="">Semua Line</option>'; }
            });
            loadMachines();
        } else if (currentSection === 'shift') {
            loadBreakSchedules();
        } else if (currentSection === 'oee') {
            loadOeeSettings();
        } else if (currentSection === 'schedule') {
            loadScheduleMachines();
            loadSchedules();
        } else if (currentSection === 'lines') {
            loadDivisions();
        }
    });
})();
