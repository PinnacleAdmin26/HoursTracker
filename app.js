const SUPABASE_URL = window.ENV_SUPABASE_URL;
const SUPABASE_KEY = window.ENV_SUPABASE_KEY;

async function db(path, opts={}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...opts.headers
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(e);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

let CU = null;
let EMPLOYEES = [];
let CLIENTS = [];
let CYCLES = [];
let editingClientId = null;

async function loadEmployees() {
  EMPLOYEES = await db('employees?select=*&order=name');
}

async function loadClients() {
  CLIENTS = await db('clients?select=*,client_rates(*)&order=name');
}

async function loadCycles() {
  CYCLES = await db('billing_cycles?select=*&order=year,month');
}

function activeCycle() {
  return CYCLES.find(c => !c.closed) || CYCLES[CYCLES.length - 1];
}

function getRate(client, empId) {
  if (!client.client_rates) return null;
  const r = client.client_rates.find(r => r.employee_id === empId);
  return r ? r.rate : null;
}

async function doLogin() {
  const id = document.getElementById('lid').value.trim();
  const pw = document.getElementById('lpw').value;
  const err = document.getElementById('lerr');
  err.textContent = '';
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Signing in...';
  btn.disabled = true;
  try {
    if (id === 'Admin' && pw === 'admin2024') {
      CU = { id: 'Admin', role: 'admin' };
      await loadEmployees();
      await loadClients();
      await loadCycles();
      showScreen('adminScreen');
      initAdmin();
      return;
    }
    await loadEmployees();
    const emp = EMPLOYEES.find(e => e.id === id);
    if (!emp || emp.password !== pw) {
      err.textContent = 'Invalid username or password.';
      return;
    }
    if (emp.active === false) {
      err.textContent = 'Your account is inactive. Contact Admin.';
      return;
    }
    CU = emp;
    await loadClients();
    await loadCycles();
    showScreen('empScreen');
    initEmp();
  } catch(e) {
    err.textContent = 'Connection error. Please try again.';
  } finally {
    btn.textContent = 'Log in';
    btn.disabled = false;
  }
}

function doLogout() {
  CU = null;
  EMPLOYEES = []; CLIENTS = []; CYCLES = [];
  editingClientId = null;
  document.getElementById('lid').value = '';
  document.getElementById('lpw').value = '';
  showScreen('loginScreen');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  hideModal();
}

// ── EMPLOYEE SCREEN ──────────────────────────────────────────

function initEmp() {
  document.getElementById('empName').textContent = CU.name;
  document.getElementById('empBadge').textContent = CU.initials;
  document.getElementById('eDate').value = new Date().toISOString().split('T')[0];
  populateEmpCycleFilter();
  populateEmpClients();
  const ac = activeCycle();
  document.getElementById('empCycleLabel').textContent = ac ? ac.label : '';
  const closed = ac && ac.closed;
  document.getElementById('cycleClosedBanner').style.display = closed ? '' : 'none';
  document.getElementById('logFormWrap').style.display = closed ? 'none' : '';
  renderEmp();
}

function populateEmpCycleFilter() {
  const sel = document.getElementById('empCycleFilter');
  const sorted = CYCLES.slice().reverse();
  sel.innerHTML = sorted.map(c =>
    `<option value="${c.id}">${c.label}${c.closed ? ' (closed)' : ''}</option>`
  ).join('');
  const ac = activeCycle();
  if (ac) sel.value = ac.id;
}

function populateEmpClients() {
  const sel = document.getElementById('eClient');
  const active = CLIENTS.filter(c => c.active !== false);
  if (!active.length) {
    sel.innerHTML = '<option value="">No clients — contact Admin</option>';
    return;
  }
  sel.innerHTML = active.map(c =>
    `<option value="${c.id}">${esc(c.name)}</option>`
  ).join('');
  onClientChange();
}

function onClientChange() {
  const cid = document.getElementById('eClient').value;
  const client = CLIENTS.find(c => c.id === cid);
  if (!client) { document.getElementById('eRate').value = ''; return; }
  const rate = getRate(client, CU.id);
  if (rate) {
    document.getElementById('eRate').value = rate;
    document.getElementById('rateNote').textContent =
      `Default rate for ${client.name}: $${rate}/hr — you can override if needed.`;
  } else {
    document.getElementById('eRate').value = '';
    document.getElementById('rateNote').textContent =
      'No default rate set for this client — enter your rate manually.';
  }
  calcSub();
}

function calcSub() {
  const r = parseFloat(document.getElementById('eRate').value) || 0;
  const h = parseFloat(document.getElementById('eHours').value) || 0;
  document.getElementById('eSub').value = r && h ? '$' + (r * h).toFixed(2) : '';
}

async function addEntry() {
  const date = document.getElementById('eDate').value;
  const cid = document.getElementById('eClient').value;
  const desc = document.getElementById('eDesc').value.trim();
  const rate = parseFloat(document.getElementById('eRate').value);
  const hours = parseFloat(document.getElementById('eHours').value);
  const err = document.getElementById('eerr');
  if (!date || !cid || !desc || isNaN(rate) || isNaN(hours) || hours <= 0 || rate < 0) {
    err.textContent = 'Please fill in all fields with valid values.';
    return;
  }
  err.textContent = '';
  const client = CLIENTS.find(c => c.id === cid);
  const ac = activeCycle();
  const btn = document.getElementById('addBtn');
  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    await db('entries', {
      method: 'POST',
      body: {
        date, client_id: cid,
        client_name: client ? client.name : cid,
        description: desc,
        employee_id: CU.id,
        employee_initials: CU.initials,
        employee_name: CU.name,
        rate: parseFloat(rate.toFixed(2)),
        hours: parseFloat(hours.toFixed(2)),
        subtotal: parseFloat((rate * hours).toFixed(2)),
        cycle_id: ac ? ac.id : null
      }
    });
    document.getElementById('eDesc').value = '';
    document.getElementById('eHours').value = '';
    calcSub();
    renderEmp();
  } catch(e) {
    err.textContent = 'Error saving entry. Please try again.';
  } finally {
    btn.textContent = '+ Add'; btn.disabled = false;
  }
}

async function renderEmp() {
  const cid = document.getElementById('empCycleFilter').value;
  const wrap = document.getElementById('empEntries');
  wrap.innerHTML = '<div class="loading"><span class="spinner"></span>Loading...</div>';
  try {
    const rows = await db(
      `entries?employee_id=eq.${CU.id}&cycle_id=eq.${cid}&select=*&order=date`
    );
    const cycle = CYCLES.find(c => c.id === cid);
    const locked = cycle && cycle.closed;
    if (!rows.length) { wrap.innerHTML = '<div class="empty">No entries for this cycle.</div>'; return; }
    const totH = rows.reduce((s, e) => s + parseFloat(e.hours), 0);
    const totA = rows.reduce((s, e) => s + parseFloat(e.subtotal), 0);
    wrap.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="stat-lbl">Entries</div><div class="stat-val">${rows.length}</div></div>
        <div class="stat"><div class="stat-lbl">Total hours</div><div class="stat-val">${totH.toFixed(2)}</div></div>
        <div class="stat"><div class="stat-lbl">Amount</div><div class="stat-val">$${totA.toFixed(2)}</div></div>
      </div>
      <table class="tbl">
        <thead><tr>
          <th style="width:92px">Date</th><th>Client</th><th>Task</th>
          <th style="width:58px">Rate</th><th style="width:55px">Hours</th><th style="width:72px">Total</th>
          ${locked ? '' : '<th style="width:28px"></th>'}
        </tr></thead>
        <tbody>${rows.map(e => `<tr style="${locked ? 'color:#999' : ''}">
          <td>${e.date}</td>
          <td style="font-size:12px">${esc(e.client_name)}</td>
          <td style="font-size:12px">${esc(e.description)}</td>
          <td>$${parseFloat(e.rate).toFixed(2)}</td>
          <td>${parseFloat(e.hours).toFixed(2)}</td>
          <td>$${parseFloat(e.subtotal).toFixed(2)}</td>
          ${locked ? '' : `<td><button class="danger-sm" onclick="delEntry('${e.id}')">&#x2715;</button></td>`}
        </tr>`).join('')}</tbody>
        <tfoot><tr class="tbl-foot">
          <td colspan="4" style="color:#888">Total</td>
          <td>${totH.toFixed(2)}</td><td>$${totA.toFixed(2)}</td>
          ${locked ? '' : '<td></td>'}
        </tr></tfoot>
      </table>`;
  } catch(e) {
    wrap.innerHTML = '<div class="empty">Error loading entries.</div>';
  }
}

async function delEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await db(`entries?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (CU.role === 'admin') renderAdmin(); else renderEmp();
  } catch(e) { alert('Error deleting entry.'); }
}

// ── ADMIN SCREEN ─────────────────────────────────────────────

function initAdmin() {
  buildClientRateInputs();
  buildEmpPwList();
  populateAdminFilters();
  renderAdmin();
  renderClientList();
  renderCycleTab();
}

function populateAdminFilters() {
  const cs = document.getElementById('aCycleFilter');
  cs.innerHTML = CYCLES.slice().reverse().map(c =>
    `<option value="${c.id}">${c.label}${c.closed ? ' (closed)' : ''}</option>`
  ).join('');
  const ac = activeCycle();
  if (ac) cs.value = ac.id;

  const ps = document.getElementById('aClientFilter');
  ps.innerHTML = '<option value="">All clients</option>' +
    CLIENTS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function renderAdmin() {
  const cid = document.getElementById('aCycleFilter').value;
  const fid = document.getElementById('aClientFilter').value;
  const wrap = document.getElementById('billingOut');
  wrap.innerHTML = '<div class="loading"><span class="spinner"></span>Loading...</div>';
  try {
    let url = `entries?cycle_id=eq.${cid}&select=*&order=date`;
    if (fid) url += `&client_id=eq.${fid}`;
    const rows = await db(url);
    if (!rows.length) { wrap.innerHTML = '<div class="empty">No entries for this period.</div>'; return; }
    const cycle = CYCLES.find(c => c.id === cid);
    const cycleLabel = cycle ? cycle.label : cid;
    const byClient = {};
    rows.forEach(e => {
      if (!byClient[e.client_name]) byClient[e.client_name] = [];
      byClient[e.client_name].push(e);
    });
    const grandH = rows.reduce((s, e) => s + parseFloat(e.hours), 0);
    const grandA = rows.reduce((s, e) => s + parseFloat(e.subtotal), 0);
    let html = `
      <div class="stat-grid">
        <div class="stat"><div class="stat-lbl">Total entries</div><div class="stat-val">${rows.length}</div></div>
        <div class="stat"><div class="stat-lbl">Total hours</div><div class="stat-val">${grandH.toFixed(2)}</div></div>
        <div class="stat"><div class="stat-lbl">Total billed</div><div class="stat-val">$${grandA.toFixed(2)}</div></div>
      </div>`;
    Object.keys(byClient).sort().forEach(cname => {
      const cr = byClient[cname].sort((a, b) => a.date.localeCompare(b.date));
      const tH = cr.reduce((s, e) => s + parseFloat(e.hours), 0);
      const tA = cr.reduce((s, e) => s + parseFloat(e.subtotal), 0);
      const emps = [...new Set(cr.map(r => r.employee_initials))].join(', ');
      const tid = 'tbl_' + cname.replace(/[^a-z0-9]/gi, '_');
      html += `
        <div class="client-block">
          <div class="client-hdr">
            <div>
              <div class="client-name">${esc(cname)}</div>
              <div class="client-meta">${emps} · ${tH.toFixed(2)} hrs · $${tA.toFixed(2)}</div>
            </div>
            <button class="sm" onclick="copyTbl('${tid}','${esc(cname)}','${cycleLabel}')">&#x2398; Copy for invoice</button>
          </div>
          <table class="tbl" id="${tid}">
            <thead><tr>
              <th style="width:92px">Date</th><th>Task</th>
              <th style="width:40px">Emp</th><th style="width:58px">Rate</th>
              <th style="width:55px">Hours</th><th style="width:72px">Total</th>
              <th style="width:28px"></th>
            </tr></thead>
            <tbody>${cr.map(e => `<tr>
              <td>${e.date}</td>
              <td style="font-size:12px">${esc(e.description)}</td>
              <td>${e.employee_initials}</td>
              <td>$${parseFloat(e.rate).toFixed(2)}</td>
              <td>${parseFloat(e.hours).toFixed(2)}</td>
              <td>$${parseFloat(e.subtotal).toFixed(2)}</td>
              <td><button class="danger-sm" onclick="delEntry('${e.id}')">&#x2715;</button></td>
            </tr>`).join('')}</tbody>
            <tfoot><tr class="tbl-foot">
              <td colspan="3" style="color:#888">Total</td>
              <td></td><td>${tH.toFixed(2)}</td><td>$${tA.toFixed(2)}</td><td></td>
            </tr></tfoot>
          </table>
        </div>`;
    });
    wrap.innerHTML = html;
  } catch(e) {
    wrap.innerHTML = '<div class="empty">Error loading entries.</div>';
  }
}

function aTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['aBilling','aClients','aEmployees','aCycle'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  const map = {billing:'aBilling',clients:'aClients',employees:'aEmployees',cycle:'aCycle'};
  document.getElementById(map[tab]).style.display = '';
  if (tab === 'cycle') renderCycleTab();
  if (tab === 'clients') renderClientList();
  if (tab === 'employees') buildEmpPwList();
}

// ── CLIENTS ──────────────────────────────────────────────────

function buildClientRateInputs() {
  document.getElementById('clientRateInputs').innerHTML = EMPLOYEES.map(e =>
    `<div class="fl" style="margin-bottom:8px">
       <label>${e.name} (${e.initials})</label>
       <input type="number" id="cr_${e.id}" placeholder="0.00" min="0" step="0.01"/>
     </div>`
  ).join('');
}

async function saveClient() {
  const name = document.getElementById('cName').value.trim();
  const desc = document.getElementById('cDesc').value.trim();
  const err = document.getElementById('cerr');
  if (!name) { err.textContent = 'Client name is required.'; return; }
  err.textContent = '';
  const rates = [];
  EMPLOYEES.forEach(e => {
    const v = parseFloat(document.getElementById('cr_' + e.id).value);
    if (!isNaN(v) && v > 0) rates.push({ employee_id: e.id, rate: v });
  });
  try {
    if (editingClientId) {
      await db(`clients?id=eq.${editingClientId}`, {
        method: 'PATCH', body: { name, description: desc }, prefer: 'return=minimal'
      });
      await db(`client_rates?client_id=eq.${editingClientId}`, {
        method: 'DELETE', prefer: 'return=minimal'
      });
      if (rates.length) {
        await db('client_rates', {
          method: 'POST',
          body: rates.map(r => ({ ...r, client_id: editingClientId }))
        });
      }
      editingClientId = null;
      document.getElementById('cancelClientBtn').style.display = 'none';
      document.getElementById('clientFormTitle').textContent = 'Add client';
      document.getElementById('saveClientLabel').textContent = 'Save client';
    } else {
      const [newClient] = await db('clients', {
        method: 'POST', body: { name, description: desc, active: true }
      });
      if (rates.length && newClient) {
        await db('client_rates', {
          method: 'POST',
          body: rates.map(r => ({ ...r, client_id: newClient.id }))
        });
      }
    }
    document.getElementById('cName').value = '';
    document.getElementById('cDesc').value = '';
    EMPLOYEES.forEach(e => document.getElementById('cr_' + e.id).value = '');
    await loadClients();
    renderClientList();
    populateAdminFilters();
  } catch(e) {
    err.textContent = 'Error saving client. Please try again.';
  }
}

function editClient(id) {
  const c = CLIENTS.find(x => x.id === id);
  if (!c) return;
  editingClientId = id;
  document.getElementById('cName').value = c.name;
  document.getElementById('cDesc').value = c.description || '';
  EMPLOYEES.forEach(e => {
    const rate = getRate(c, e.id);
    document.getElementById('cr_' + e.id).value = rate || '';
  });
  document.getElementById('cancelClientBtn').style.display = '';
  document.getElementById('clientFormTitle').textContent = 'Edit client';
  document.getElementById('saveClientLabel').textContent = 'Update client';
  document.getElementById('aClients').scrollIntoView({ behavior: 'smooth' });
}

function cancelClientEdit() {
  editingClientId = null;
  document.getElementById('cancelClientBtn').style.display = 'none';
  document.getElementById('clientFormTitle').textContent = 'Add client';
  document.getElementById('saveClientLabel').textContent = 'Save client';
  document.getElementById('cName').value = '';
  document.getElementById('cDesc').value = '';
  EMPLOYEES.forEach(e => document.getElementById('cr_' + e.id).value = '');
}

async function toggleClient(id) {
  const c = CLIENTS.find(x => x.id === id);
  if (!c) return;
  try {
    await db(`clients?id=eq.${id}`, {
      method: 'PATCH', body: { active: !c.active }, prefer: 'return=minimal'
    });
    await loadClients();
    renderClientList();
  } catch(e) { alert('Error updating client.'); }
}

function renderClientList() {
  const wrap = document.getElementById('clientList');
  if (!CLIENTS.length) { wrap.innerHTML = '<div class="empty">No clients yet.</div>'; return; }
  wrap.innerHTML = CLIENTS.map(c => {
    const rlines = EMPLOYEES
      .filter(e => getRate(c, e.id))
      .map(e => `${e.initials}: $${getRate(c, e.id)}/hr`)
      .join(' · ') || '<span style="color:#aaa">No rates set</span>';
    return `
      <div class="client-block" style="${c.active === false ? 'opacity:.5' : ''}">
        <div class="client-hdr">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="client-name">${esc(c.name)}</div>
              <span class="pill ${c.active === false ? 'pill-closed' : 'pill-open'}">${c.active === false ? 'inactive' : 'active'}</span>
            </div>
            ${c.description ? `<div class="client-meta">${esc(c.description)}</div>` : ''}
            <div class="client-meta" style="margin-top:4px">${rlines}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="sm" onclick="editClient('${c.id}')">Edit</button>
            <button class="sm" onclick="toggleClient('${c.id}')">${c.active === false ? 'Activate' : 'Deactivate'}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── EMPLOYEES ────────────────────────────────────────────────

function buildEmpPwList() {
  const wrap = document.getElementById('empPwList');
  wrap.innerHTML = `
    <table class="tbl" style="margin-bottom:1rem">
      <thead><tr>
        <th>Name</th><th>Username</th><th>Password</th><th style="width:70px"></th>
      </tr></thead>
      <tbody>${EMPLOYEES.map(e => `<tr>
        <td>${e.name}</td>
        <td style="color:#888">${e.id}</td>
        <td><input type="text" id="pw_${e.id}" value="${esc(e.password)}" style="font-size:13px"/></td>
        <td><button class="sm" onclick="updatePw('${e.id}')">Save</button></td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="err" id="pwErr"></div>`;
}

async function updatePw(eid) {
  const val = document.getElementById('pw_' + eid).value.trim();
  if (!val) { document.getElementById('pwErr').textContent = 'Password cannot be empty.'; return; }
  document.getElementById('pwErr').textContent = '';
  try {
    await db(`employees?id=eq.${eid}`, {
      method: 'PATCH', body: { password: val }, prefer: 'return=minimal'
    });
    const emp = EMPLOYEES.find(e => e.id === eid);
    if (emp) emp.password = val;
    const inp = document.getElementById('pw_' + eid);
    inp.style.borderColor = '#1a7a45';
    setTimeout(() => inp.style.borderColor = '', 2000);
  } catch(e) { document.getElementById('pwErr').textContent = 'Error updating password.'; }
}

// ── BILLING CYCLE ────────────────────────────────────────────

async function renderCycleTab() {
  await loadCycles();
  const ac = activeCycle();
  const info = document.getElementById('cycleInfo');
  const actions = document.getElementById('cycleActions');
  if (!ac) { info.textContent = 'No active cycle.'; actions.innerHTML = ''; return; }
  let cnt = 0, amt = 0;
  try {
    const rows = await db(`entries?cycle_id=eq.${ac.id}&select=subtotal,hours`);
    cnt = rows.length;
    amt = rows.reduce((s, e) => s + parseFloat(e.subtotal), 0);
  } catch(e) {}
  info.innerHTML = `<strong>${ac.label}</strong> &nbsp;·&nbsp; ${cnt} entries &nbsp;·&nbsp; $${amt.toFixed(2)}`;
  if (ac.closed) {
    actions.innerHTML = `<div style="color:#a06000;font-size:13px">&#128274; Closed on ${ac.closed_at ? new Date(ac.closed_at).toLocaleDateString() : '—'}</div>`;
  } else {
    actions.innerHTML = `
      <div style="font-size:13px;color:#888;margin-bottom:1rem;line-height:1.6">
        Closing locks all entries for ${ac.label} and opens a new cycle for the following month.
      </div>
      <button class="warn" onclick="showCloseModal()">&#128274; Close ${ac.label}</button>`;
  }
  const past = CYCLES.filter(c => c.id !== ac.id).slice().reverse();
  const pw = document.getElementById('pastCycleList');
  if (!past.length) { pw.innerHTML = '<div class="empty">No past cycles yet.</div>'; return; }
  const pastRows = await Promise.all(past.map(async c => {
    let cnt = 0, amt = 0;
    try {
      const rows = await db(`entries?cycle_id=eq.${c.id}&select=subtotal`);
      cnt = rows.length;
      amt = rows.reduce((s, e) => s + parseFloat(e.subtotal), 0);
    } catch(e) {}
    return { ...c, cnt, amt };
  }));
  pw.innerHTML = pastRows.map(c => `
    <div class="client-block" style="display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-weight:600;font-size:14px">${c.label}</div>
        <div style="font-size:12px;color:#888;margin-top:2px">${c.cnt} entries · $${c.amt.toFixed(2)} · Closed ${c.closed_at ? new Date(c.closed_at).toLocaleDateString() : ''}</div>
      </div>
      <span class="badge badge-closed">&#128274; Closed</span>
    </div>`).join('');
}

function showCloseModal() {
  const ac = activeCycle();
  if (!ac) return;
  const next = new Date(ac.year, ac.month + 1, 1);
  const nextLabel = next.toLocaleString('default', { month: 'long', year: 'numeric' });
  document.getElementById('modalTitle').textContent = 'Close ' + ac.label + '?';
  document.getElementById('modalMsg').textContent =
    `This locks all entries for ${ac.label}. A new billing cycle (${nextLabel}) will open immediately. This cannot be undone.`;
  document.getElementById('modalOk').onclick = doClose;
  document.getElementById('confirmModal').classList.add('open');
}

async function doClose() {
  const ac = activeCycle();
  if (!ac) return;
  try {
    await db(`billing_cycles?id=eq.${ac.id}`, {
      method: 'PATCH',
      body: { closed: true, closed_at: new Date().toISOString() },
      prefer: 'return=minimal'
    });
    const next = new Date(ac.year, ac.month + 1, 1);
    const y = next.getFullYear(), m = next.getMonth();
    const newId = `${y}-${String(m + 1).padStart(2, '0')}`;
    const newLabel = next.toLocaleString('default', { month: 'long', year: 'numeric' });
    await db('billing_cycles', {
      method: 'POST',
      body: { id: newId, label: newLabel, year: y, month: m, closed: false }
    });
    await loadCycles();
    hideModal();
    populateAdminFilters();
    renderCycleTab();
    renderAdmin();
  } catch(e) { alert('Error closing cycle. Please try again.'); }
}

function hideModal() {
  document.getElementById('confirmModal').classList.remove('open');
}

// ── INVOICE COPY ─────────────────────────────────────────────

function copyTbl(tableId, cname, cycleLabel) {
  const tbl = document.getElementById(tableId);
  if (!tbl) return;
  let text = cname + '\n' + cycleLabel + '\nProfessional Services\n\n';
  tbl.querySelectorAll('tr').forEach(row => {
    const cells = [...row.querySelectorAll('th,td')].slice(0, -1).map(c => c.textContent.trim());
    text += cells.join('\t') + '\n';
  });
  navigator.clipboard.writeText(text).then(() => {
    const btn = tbl.closest('.client-block').querySelector('.sm');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
