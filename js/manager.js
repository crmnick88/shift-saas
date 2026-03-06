// ===========================================
// manager.js — פורטל מנהל
// ===========================================

let mgrBranchKey = null;
let orgData      = {};
let mgrSettings  = {};
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
const [orgSnap, nameSnap, subSnap, codeSnap, settSnap] = await Promise.all([
  db.ref(`branches/${mgrBranchKey}/org`).once('value'),
  db.ref(`branches/${mgrBranchKey}/displayName`).once('value'),
  db.ref(`branches/${mgrBranchKey}/subscription`).once('value').catch(() => null),
  db.ref(`branches/${mgrBranchKey}/branchCode`).once('value'),
  db.ref(`branches/${mgrBranchKey}/settings`).once('value'),
]);

orgData     = orgSnap.val()  || {};
mgrSettings = settSnap.val() || {};

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
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(offset = 0) {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() + offset * 7);
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
  const settSnap = await db.ref(`branches/${mgrBranchKey}/settings`).once('value');
  mgrSettings = settSnap.val() || mgrSettings;
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

async function runAutoSchedule() {
  const weekKey = getWeekKey(currentWeekOffset);
  showMsg('schedule-msg', '⚡ טוען נתונים...', 'info');

  // טוען הכל מחדש — כולל orgData — כדי לא להשתמש בנתונים ישנים מהכניסה לדף
  const [freshOrgSnap, settSnap, staffSnap, cSnap] = await Promise.all([
    db.ref(`branches/${mgrBranchKey}/org`).once('value'),
    db.ref(`branches/${mgrBranchKey}/settings`).once('value'),
    db.ref(`branches/${mgrBranchKey}/staffingRules`).once('value'),
    db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}`).once('value'),
  ]);

  orgData     = freshOrgSnap.val() || orgData;
  mgrSettings = settSnap.val()     || mgrSettings;

  const settings = { ...mgrSettings };
  settings.staffingRules = staffSnap.val() || {};
  settings.weekKey = weekKey;

  const constraints = cSnap.val() || {};

  showMsg('schedule-msg', '⚡ מחשב סידור...', 'info');

  try {
    const schedule = window.generateSchedule(orgData, constraints, settings);
    currentScheduleData = { ...schedule, status: 'draft', generatedAt: Date.now() };
    await db.ref(`branches/${mgrBranchKey}/schedules/${weekKey}`).set(currentScheduleData);
    renderScheduleTable(currentScheduleData);
    showMsg('schedule-msg', '✅ הסידור נוצר — תוכל לערוך לפני פרסום', 'success');
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
  const ws = parseInt(mgrSettings.workDays) || 6;
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
        const shiftVal = schedule[dayKey]?.[empKey];
        if (shiftVal) {
          const chips = String(shiftVal).split('|').map(sk => {
            const st  = shiftTypes[sk] || { name: sk };
            const idx = Object.keys(shiftTypes).indexOf(sk);
            return `<span class="shift-chip shift-color-${idx % 6}">${st.name}</span>`;
          }).join(' ');
          html += `<td>${chips}</td>`;
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
  const shiftTypes  = orgData.shiftTypes || {};
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
      html += `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">`;
      for (let d = 0; d < workDays; d++) {
        const dayKey = `day_${d}`;
        const entry  = empCons[dayKey] || {};
        const c1     = entry.c1;
        if (!c1) continue;

        if (shiftTypes[c1]) {
          // משמרת מועדפת — badge פשוט
          html += `<span class="badge" style="background:#ebf8ff; color:#2b6cb0; border:1px solid #bee3f8;
            padding:4px 10px; border-radius:20px; font-size:0.85em;">
            יום ${dayNames[d]}: ⭐ ${shiftTypes[c1].name}
          </span>`;
        } else {
          // בקשת היעדרות — כרטיס עם כפתורי אישור/דחייה
          const ctDef  = ctypes[c1] || {};
          const label  = ctDef.label || c1;
          const status = entry.status;
          let statusLabel, statusColor;
          if (!status || status === 'approved') {
            statusLabel = '✅ אושר';  statusColor = '#276749';
          } else if (status === 'rejected') {
            statusLabel = '❌ נדחה';  statusColor = '#c53030';
          } else {
            statusLabel = '⏳ ממתין לאישור';  statusColor = '#b7791f';
          }

          html += `
            <div style="background:#fff5f5; border:1px solid #fed7d7; border-radius:8px;
                        padding:8px 12px; min-width:160px;">
              <div style="font-size:0.9em; margin-bottom:4px;">
                <strong>יום ${dayNames[d]}</strong>: ${label}
              </div>
              <div style="font-size:0.82em; color:${statusColor}; margin-bottom:6px;">${statusLabel}</div>
              <div style="display:flex; gap:4px;">
                <button onclick="approveAbsence('${empKey}','${dayKey}')"
                  style="padding:3px 10px; border-radius:5px; border:none; background:#c6f6d5;
                         color:#276749; cursor:pointer; font-size:0.82em;">✅ אשר</button>
                <button onclick="rejectAbsence('${empKey}','${dayKey}')"
                  style="padding:3px 10px; border-radius:5px; border:none; background:#fed7d7;
                         color:#c53030; cursor:pointer; font-size:0.82em;">❌ דחה</button>
              </div>
            </div>`;
        }
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html || '<p style="color:#aaa; text-align:center;">אין אילוצים לשבוע זה</p>';
}

// ===========================================
// MANAGER MANUAL CONSTRAINT ENTRY
// ===========================================
function toggleMgrConstraintForm() {
  const form = document.getElementById('mgr-constraint-form');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  if (isHidden) populateMgrConstraintForm();
}

function populateMgrConstraintForm() {
  const employees  = orgData.employees  || {};
  const shiftTypes = orgData.shiftTypes || {};
  const ctypes     = orgData.constraintTypes || {};
  const workDays   = parseInt(mgrSettings.workDays) || 6;
  const dayNames   = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // Employees
  const empSel = document.getElementById('mc-emp');
  empSel.innerHTML = Object.entries(employees)
    .map(([k, e]) => `<option value="${k}">${e.displayName || k}</option>`)
    .join('');

  // Days
  const daySel = document.getElementById('mc-day');
  daySel.innerHTML = Array.from({ length: workDays }, (_, i) =>
    `<option value="day_${i}">יום ${dayNames[i]}</option>`
  ).join('');

  // Constraint options: shifts + absences
  const valSel = document.getElementById('mc-value');
  const shiftOpts = Object.entries(shiftTypes)
    .map(([k, s]) => `<option value="shift:${k}">⭐ משמרת מועדפת: ${s.name}</option>`)
    .join('');
  const absOpts = Object.entries(ctypes)
    .map(([k, ct]) => `<option value="absence:${k}">${ct.label || k}</option>`)
    .join('');
  valSel.innerHTML =
    '<option value="">-- בחר אילוץ --</option>' +
    (shiftOpts ? `<optgroup label="משמרת מועדפת">${shiftOpts}</optgroup>` : '') +
    (absOpts   ? `<optgroup label="היעדרות">${absOpts}</optgroup>` : '');
}

async function saveMgrConstraint() {
  const empKey = document.getElementById('mc-emp').value;
  const dayKey = document.getElementById('mc-day').value;
  const raw    = document.getElementById('mc-value').value;

  if (!empKey || !dayKey || !raw)
    return showMsg('mc-msg', 'אנא בחר עובד, יום ואילוץ', 'error');

  const weekKey = getWeekKey(currentWeekOffsetConstraints);
  const [type, val] = raw.split(':');
  const entry = type === 'shift'
    ? { c1: val }
    : { c1: val, status: 'approved' };  // היעדרות שמנהל מזין — מאושרת אוטומטית

  await db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}/${empKey}/${dayKey}`).set(entry);
  showMsg('mc-msg', '✅ נשמר בהצלחה', 'success');
  loadConstraints();
}

async function deleteMgrConstraint() {
  const empKey = document.getElementById('mc-emp').value;
  const dayKey = document.getElementById('mc-day').value;

  if (!empKey || !dayKey)
    return showMsg('mc-msg', 'אנא בחר עובד ויום', 'error');

  const weekKey = getWeekKey(currentWeekOffsetConstraints);
  await db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}/${empKey}/${dayKey}`).remove();
  showMsg('mc-msg', '🗑️ האילוץ נמחק', 'info');
  loadConstraints();
}

// ===========================================
// CONSTRAINT REMINDER PUSH NOTIFICATION
// ===========================================
async function sendConstraintReminder() {
  showMsg('schedule-msg', '⏳ שולח תזכורת...', 'info');

  // כתיבה ל-Firebase מפעילה את ה-Cloud Function שמשלח push לכל עובדי הסניף
  const tokensSnap = await db.ref(`branches/${mgrBranchKey}/fcmTokens`).once('value');
  const tokenCount = Object.keys(tokensSnap.val() || {}).length;

  await db.ref(`branches/${mgrBranchKey}/lastConstraintReminder`).set({ sentAt: Date.now() });

  const msg = tokenCount > 0
    ? `✅ תזכורת נשלחה ל-${tokenCount} עובדים`
    : '✅ תזכורת נשלחה (עובדים יראו אותה בפתיחת האפליקציה)';
  showMsg('schedule-msg', msg, 'success');
}

async function approveAbsence(empKey, dayKey) {
  const weekKey = getWeekKey(currentWeekOffsetConstraints);
  await db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}/${empKey}/${dayKey}/status`).set('approved');
  loadConstraints();
}

async function rejectAbsence(empKey, dayKey) {
  const weekKey = getWeekKey(currentWeekOffsetConstraints);
  await db.ref(`branches/${mgrBranchKey}/constraints/${weekKey}/${empKey}/${dayKey}/status`).set('rejected');
  loadConstraints();
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
// EXCEL EXPORT
// ===========================================
function exportToExcel() {
  if (!currentScheduleData || Object.keys(currentScheduleData).length === 0)
    return showMsg('schedule-msg', 'אין סידור לייצוא', 'error');

  const ws_data = parseInt(mgrSettings.workDays) || 6;
  const departments = orgData.departments || {};
  const employees   = orgData.employees   || {};
  const shiftTypes  = orgData.shiftTypes  || {};
  const shiftKeys   = Object.keys(shiftTypes);
  const dayNames    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // Shift color palette: bg / font — matches shift-color-0..5
  const SHIFT_COLORS = [
    { bg: 'FFF3CD', font: '856404' },
    { bg: 'FFD4A3', font: '7A4100' },
    { bg: 'D1ECF1', font: '0C5460' },
    { bg: 'D4EDDA', font: '155724' },
    { bg: 'E7D4F5', font: '5A1A7A' },
    { bg: 'FCE4EC', font: '880E4F' },
  ];

  const HEADER_BG   = '667EEA';
  const DEPT_BG     = 'EEF0FF';
  const OFF_BG      = 'F0F0F0';
  const BORDER      = { style: 'thin', color: { rgb: 'CCCCCC' } };
  const cellBorder  = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  function makeCell(v, opts = {}) {
    return {
      v,
      t: 's',
      s: {
        font:      { name: 'Arial', sz: 11, bold: opts.bold || false, color: { rgb: opts.fontColor || '333333' } },
        fill:      opts.bg ? { fgColor: { rgb: opts.bg }, patternType: 'solid' } : { patternType: 'none' },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true, readingOrder: 2 },
        border:    cellBorder,
      }
    };
  }

  const rows = [];
  const deptRowIndices = [];

  // ── Header row ──────────────────────────────────
  const headerRow = [makeCell('עובד', { bold: true, bg: HEADER_BG, fontColor: 'FFFFFF' })];
  for (let d = 0; d < ws_data; d++) {
    headerRow.push(makeCell(dayNames[d], { bold: true, bg: HEADER_BG, fontColor: 'FFFFFF' }));
  }
  rows.push(headerRow);

  // ── Department + employee rows ───────────────────
  for (const [, dept] of Object.entries(departments)) {
    // Dept divider — track row index for merging
    deptRowIndices.push(rows.length);
    const deptRow = [makeCell('🏬 ' + dept.name, { bold: true, bg: DEPT_BG, fontColor: '3D3D8F' })];
    for (let d = 0; d < ws_data; d++) {
      deptRow.push(makeCell('', { bg: DEPT_BG }));
    }
    rows.push(deptRow);

    const deptEmps = dept.employees ? Object.keys(dept.employees) : [];
    for (const empKey of deptEmps) {
      const emp = employees[empKey] || {};
      const row = [makeCell(emp.displayName || empKey, { bold: true })];

      for (let d = 0; d < ws_data; d++) {
        const dayKey   = `day_${d}`;
        const shiftVal = currentScheduleData[dayKey]?.[empKey];

        if (shiftVal) {
          // May be "shift_A|shift_B" for double
          const parts = String(shiftVal).split('|');
          const names = parts.map(sk => shiftTypes[sk]?.name || sk).join(' + ');
          // Use color of first shift
          const idx   = shiftKeys.indexOf(parts[0]);
          const col   = SHIFT_COLORS[idx >= 0 ? idx % 6 : 0];
          row.push(makeCell(names, { bg: col.bg, fontColor: col.font }));
        } else {
          row.push(makeCell('חופש', { bg: OFF_BG, fontColor: '999999' }));
        }
      }
      rows.push(row);
    }
  }

  // ── Build worksheet ──────────────────────────────
  const ws = {};
  const range = { s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: ws_data } };

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = cell;
    });
  });

  ws['!ref'] = XLSX.utils.encode_range(range);

  // Merge dept divider rows across all columns
  ws['!merges'] = deptRowIndices.map(r => ({ s: { r, c: 0 }, e: { r, c: ws_data } }));

  // Column widths (10 chars each)
  ws['!cols'] = Array.from({ length: ws_data + 1 }, () => ({ wch: 10 }));

  // Row heights (30pt)
  ws['!rows'] = rows.map(() => ({ hpt: 30 }));

  // ── Workbook ─────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'סידור');

  const weekLabel = formatWeekLabel(currentWeekOffset).replace(' — ', '_').replace(/\//g, '-');
  const fileName = `סידור_${weekLabel}.xlsx`;

  let array, blob, fileObj;
  try {
    array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    blob = new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fileObj = new File([blob], fileName, { type: blob.type });
  } catch (e) {
    return showMsg('schedule-msg', 'שגיאה ביצירת הקובץ: ' + e.message, 'error');
  }

  // Web Share API — works on Android Chrome & iOS Safari (file sharing)
  if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
    navigator.share({ files: [fileObj], title: 'סידור עבודה' })
      .catch(err => {
        if (err.name === 'AbortError') return; // user cancelled — that's fine
        // share failed — fall back to anchor download
        _downloadBlob(blob, fileName);
      });
    return;
  }

  // Fallback: anchor download (desktop browsers, older Android)
  _downloadBlob(blob, fileName);
}

function _downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
