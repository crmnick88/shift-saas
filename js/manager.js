// ===========================================
// manager.js — פורטל מנהל
// ===========================================

let mgrBranchKey = null;
let orgData      = {};
let currentWeekOffset = 0;
let currentWeekOffsetConstraints = 0;
let currentScheduleData = {};

// ===========================================
// INIT
// ===========================================
auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }

  await loadBranch(user.uid);
  mgrBranchKey = getBranchKey();

  if (!mgrBranchKey) { window.location.href = 'index.html'; return; }

  // Load all org data
const [orgSnap, nameSnap, subSnap, codeSnap] = await Promise.all([
  db.ref(`branches/${mgrBranchKey}/org`).once('value'),
  db.ref(`branches/${mgrBranchKey}/displayName`).once('value'),
  db.ref(`branches/${mgrBranchKey}/subscription`).once('value').catch(() => null),
  db.ref(`branches/${mgrBranchKey}/branchCode`).once('value'),
]);

orgData = orgSnap.val() || {};

document.getElementById('mgr-branch-name').textContent = '🏢 ' + (nameSnap.val() || 'פורטל ניהול');

const branchCode = codeSnap.val();
document.getElementById('mgr-branch-code').textContent =
  `קוד סניף לעובדים: ${branchCode || 'לא הוגדר עדיין'}`;

// Trial banner
checkTrial();

showScreen('screen-main');
renderWeekLabels();
renderEmployeeList();
renderBranchInfo();
});

function checkTrial() {
  try {
    const sub = orgData.subscription || {};
    if (sub.status === 'trial' && sub.trialEnds) {
      const daysLeft = Math.ceil((sub.trialEnds - Date.now()) / (1000*60*60*24));
      if (daysLeft > 0) {
        document.getElementById('trial-banner').style.display = 'block';
        document.getElementById('trial-days-left').textContent = daysLeft;
      }
    }
  } catch(e) {}
}

function showScreen(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const tabs = ['tab-schedule','tab-constraints','tab-employees','tab-settings'];
  document.querySelectorAll('.nav-tab')[tabs.indexOf(tabId)].classList.add('active');

  if (tabId === 'tab-constraints') loadConstraints();
  if (tabId === 'tab-employees')   renderEmployeeList();
}

// ===========================================
// WEEK HELPERS
// ===========================================
function getWeekKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(offset = 0) {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() + 1 + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('he-IL')} — ${end.toLocaleDateString('he-IL')}`;
}

function renderWeekLabels() {
  document.getElementById('schedule-week-label').textContent    = formatWeekLabel(currentWeekOffset);
  document.getElementById('constraints-week-label').textContent = formatWeekLabel(currentWeekOffsetConstraints);
}

function changeWeek(delta) {
  currentWeekOffset += delta;
  document.getElementById('schedule-week-label').textContent = formatWeekLabel(currentWeekOffset);
  loadExistingSchedule();
}

function changeWeekConstraints(delta) {
  currentWeekOffsetConstraints += delta;
  document.getElementById('constraints-week-label').textContent = formatWeekLabel(currentWeekOffsetConstraints);
  loadConstraints();
}

// ===========================================
// SCHEDULE
// ===========================================
async function loadExistingSchedule() {
  const weekKey = getWeekKey(currentWeekOffset);
  const snap    = await db.ref(`branches/${mgrBranchKey}/schedules/${weekKey}`).once('value');
  const data    = snap.val();

  if (data && Object.keys(data).length > 1) {
    currentScheduleData = data;
    renderScheduleTable(data);
  } else {
    document.getElementById('schedule-container').innerHTML =
      '<p style="color:#aaa; text-align:center; padding:40px;">לחץ "צור סידור אוטומטי" או בנה ידנית</p>';
  }
}

async function generateSchedule() {
  const weekKey    = getWeekKey(currentWeekOffset);
  const settings   = (await db.ref(`branches/${mgrBranchKey}/settings`).once('value')).val() || {};

  // Load constraints for this week
  const cSnap      = await db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}`).once('value');
  const constraints = cSnap.val() || {};

  showMsg('schedule-msg', '⚡ מחשב סידור...', 'info');

  try {
    const schedule = window.generateSchedule(orgData, constraints, settings);
    currentScheduleData = { ...schedule, status: 'draft', generatedAt: Date.now() };

    await db.ref(`branches/${mgrBranchKey}/schedules/${weekKey}`).set(currentScheduleData);
    renderScheduleTable(currentScheduleData);
    showMsg('schedule-msg', '✅ הסידור נוצר בהצלחה — תוכל לערוך לפני פרסום', 'success');
  } catch (e) {
    showMsg('schedule-msg', '❌ ' + e.message, 'error');
  }
}

async function publishSchedule() {
  const weekKey = getWeekKey(currentWeekOffset);
  if (!currentScheduleData || Object.keys(currentScheduleData).length === 0)
    return showMsg('schedule-msg', 'אין סידור לפרסם', 'error');

  await db.ref(`branches/${mgrBranchKey}/schedules/${weekKey}/status`).set('published');
  showMsg('schedule-msg', '📢 הסידור פורסם לעובדים', 'success');
}

function renderScheduleTable(schedule) {
  const workDays   = parseInt((orgData.settings || {}).workDays) || 6;
  const settings   = orgData.settings || {};
  const ws         = parseInt(settings.workDays) || 6;
  const departments = orgData.departments || {};
  const employees  = orgData.employees  || {};
  const shiftTypes = orgData.shiftTypes || {};
  const dayNames   = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  let html = `<table class="schedule-table"><thead><tr>
    <th>עובד</th>${Array.from({length: ws}, (_, i) => `<th>${dayNames[i]}</th>`).join('')}
  </tr></thead><tbody>`;

  for (const [deptKey, dept] of Object.entries(departments)) {
    html += `<tr class="dept-divider"><td colspan="${ws + 1}">🏬 ${dept.name}</td></tr>`;

    const deptEmps = dept.employees ? Object.keys(dept.employees) : [];
    for (const empKey of deptEmps) {
      const emp = employees[empKey] || {};
      html += `<tr><td style="font-weight:bold">${emp.displayName || empKey}</td>`;
      for (let d = 0; d < ws; d++) {
        const dayKey   = `day_${d}`;
        const shiftKey = schedule[dayKey]?.[empKey];
        if (shiftKey) {
          const st = shiftTypes[shiftKey] || { name: shiftKey };
          const idx = Object.keys(shiftTypes).indexOf(shiftKey);
          html += `<td><span class="shift-chip shift-color-${idx % 6}">${st.name}</span></td>`;
        } else {
          html += `<td><span style="color:#ccc">—</span></td>`;
        }
      }
      html += `</tr>`;
    }
  }

  html += `</tbody></table>`;
  document.getElementById('schedule-container').innerHTML = html;
}

// ===========================================
// CONSTRAINTS VIEW
// ===========================================
async function loadConstraints() {
  const weekKey = getWeekKey(currentWeekOffsetConstraints);
  const [cSnap, settSnap] = await Promise.all([
    db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}`).once('value'),
    db.ref(`branches/${mgrBranchKey}/settings`).once('value'),
  ]);

  const constraints = cSnap.val() || {};
  const settings    = settSnap.val() || {};
  const workDays    = parseInt(settings.workDays) || 6;
  const employees   = orgData.employees || {};
  const ctypes      = orgData.constraintTypes || {};
  const dayNames    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  const container = document.getElementById('constraints-container');
  const empKeys   = Object.keys(employees);

  if (empKeys.length === 0) {
    container.innerHTML = '<p style="color:#aaa; text-align:center;">אין עובדים מוגדרים</p>';
    return;
  }

  let html = '';
  for (const empKey of empKeys) {
    const emp     = employees[empKey] || {};
    const empCons = constraints[empKey] || {};
    const hasAny  = Object.keys(empCons).length > 0;

    html += `<div class="emp-constraint-card">
      <h4>👤 ${emp.displayName || empKey} ${hasAny ? '' : '<span style="color:#aaa; font-weight:normal;">(לא הגיש)</span>'}</h4>`;

    if (hasAny) {
      html += `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">`;
      for (let d = 0; d < workDays; d++) {
        const dayKey  = `day_${d}`;
        const dayData = empCons[dayKey] || {};
        const parts   = [dayData.c1, dayData.c2].filter(Boolean);
        if (parts.length > 0) {
          const labels = parts.map(v => ctypes[v]?.label || v);
          html += `<span class="badge yellow">יום ${dayNames[d]}: ${labels.join(', ')}</span>`;
        }
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html || '<p style="color:#aaa; text-align:center;">אין אילוצים לשבוע זה</p>';
}

// ===========================================
// EMPLOYEES
// ===========================================
function renderEmployeeList() {
  const employees  = orgData.employees  || {};
  const departments = orgData.departments || {};
  const container  = document.getElementById('employees-container');

  const entries = Object.entries(employees);
  if (entries.length === 0) {
    container.innerHTML = '<p style="color:#aaa; text-align:center; padding:20px;">אין עובדים</p>';
    return;
  }

  container.innerHTML = entries.map(([key, emp]) => {
    const deptName = emp.dept && departments[emp.dept] ? departments[emp.dept].name : '—';
    return `
      <div class="list-item">
        <div>
          <div class="item-name">👤 ${emp.displayName || key} <small style="color:#999">(${key})</small></div>
          <div class="item-meta">מחלקה: ${deptName}${emp.role ? ' | ' + emp.role : ''}</div>
        </div>
        <div class="item-actions">
          <button class="btn sm danger" onclick="removeEmployee('${key}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  // Update dept select in add form
  const sel = document.getElementById('ae-dept');
  if (sel) {
    sel.innerHTML = '<option value="">-- בחר מחלקה --</option>' +
      Object.entries(departments).map(([k,d]) => `<option value="${k}">${d.name}</option>`).join('');
  }
}

function showAddEmpModal() {
  const form = document.getElementById('add-emp-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function addEmpFromManager() {
  const display = document.getElementById('ae-display').value.trim();
  const user    = document.getElementById('ae-user').value.trim().toUpperCase();
  const pass    = document.getElementById('ae-pass').value.trim();
  const dept    = document.getElementById('ae-dept').value;

  if (!display || !user || !pass) return showMsg('ae-msg', 'שדות חובה חסרים', 'error');
  if (orgData.employees?.[user]) return showMsg('ae-msg', 'שם המשתמש כבר קיים', 'error');

  const empData = { displayName: display, password: pass, dept };
  await db.ref(`branches/${mgrBranchKey}/org/employees/${user}`).set(empData);

  if (dept && orgData.departments?.[dept]) {
    await db.ref(`branches/${mgrBranchKey}/org/departments/${dept}/employees/${user}`).set(true);
    if (!orgData.departments[dept].employees) orgData.departments[dept].employees = {};
    orgData.departments[dept].employees[user] = true;
  }

  if (!orgData.employees) orgData.employees = {};
  orgData.employees[user] = empData;

  renderEmployeeList();
  document.getElementById('add-emp-form').style.display = 'none';
  showMsg('ae-msg', '✅ עובד נוסף בהצלחה', 'success');
}

async function removeEmployee(key) {
  if (!confirm(`למחוק את ${orgData.employees?.[key]?.displayName || key}?`)) return;

  const dept = orgData.employees?.[key]?.dept;
  await db.ref(`branches/${mgrBranchKey}/org/employees/${key}`).remove();
  if (dept) await db.ref(`branches/${mgrBranchKey}/org/departments/${dept}/employees/${key}`).remove();

  delete orgData.employees[key];
  if (dept && orgData.departments?.[dept]?.employees) {
    delete orgData.departments[dept].employees[key];
  }

  renderEmployeeList();
}

// ===========================================
// SETTINGS TAB
// ===========================================
async function renderBranchInfo() {
  const [nameSnap, emailSnap, branchCodeSnap] = await Promise.all([
    db.ref(`branches/${mgrBranchKey}/displayName`).once('value'),
    db.ref(`branches/${mgrBranchKey}/ownerEmail`).once('value'),
    db.ref(`branches/${mgrBranchKey}/branchCode`).once('value'),
  ]);

  document.getElementById('settings-branch-info').innerHTML = `
    <div style="margin-bottom:8px;">🏪 <strong>שם עסק:</strong> ${nameSnap.val() || '—'}</div>
    <div style="margin-bottom:8px;">📧 <strong>אימייל:</strong> ${emailSnap.val() || '—'}</div>
    <div style="margin-bottom:8px;">🔑 <strong>קוד סניף לעובדים:</strong>
      <code style="background:#f0f0f0; padding:3px 8px; border-radius:4px;">
        ${branchCodeSnap.val() || 'לא הוגדר עדיין'}
      </code>
    </div>
    <div>👥 <strong>מספר עובדים:</strong> ${Object.keys(orgData.employees || {}).length}</div>
  `;
}


// ===========================================
// HELPERS
// ===========================================
function showMsg(elId, text, type = 'info') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'message ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function logout() {
  auth.signOut().then(() => { window.location.href = 'index.html'; });
}

// Load schedule on init
loadExistingSchedule();
