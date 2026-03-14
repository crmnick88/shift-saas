// ===========================================
// setup.js — אשף הגדרת סניף
// ===========================================

// Local state (saved to Firebase on each step)
const setupData = {
  step1: {},
  shiftTypes: {},       // { key: {name, start, end} }
  departments: {},      // { key: {name, min, max} }
  employees: {},        // { key: {displayName, password, dept, role} }
  constraintTypes: {},  // { key: {label, value, category, scope} }
  staffingRules:   {}   // { scope: { deptKey: { shiftKey: number } } }
};

let branchKey = null;

// ===========================================
// INIT — wait for auth
// ===========================================
auth.onAuthStateChanged(async (user) => {
  if (!user || user.isAnonymous) {
    window.location.href = 'index.html';
    return;
  }
  await loadBranch(user.uid);
  branchKey = user.uid;


  // Load branch code display (friendly numeric code)
const codeSnap = await db.ref(`branches/${user.uid}/branchCode`).once('value');
const branchCode = codeSnap.val();

document.getElementById('s1-branch-code').value = branchCode || '';


  // Load existing data (if coming back to setup)
  await loadExistingData();
  renderAll();
});

async function loadExistingData() {
  try {
    const snap = await db.ref(`branches/${branchKey}/org`).once('value');
    const org = snap.val() || {};
    if (org.shiftTypes)      Object.assign(setupData.shiftTypes,      org.shiftTypes);
    if (org.departments)     Object.assign(setupData.departments,     org.departments);
    if (org.employees)       Object.assign(setupData.employees,       org.employees);
    if (org.constraintTypes) Object.assign(setupData.constraintTypes, org.constraintTypes);

    const nameSnap = await db.ref(`branches/${branchKey}/displayName`).once('value');
    if (nameSnap.val()) {
      document.getElementById('s1-name').value = nameSnap.val();
    }
    const settSnap = await db.ref(`branches/${branchKey}/settings`).once('value');
    const sett = settSnap.val() || {};
    if (sett.workDays)           document.getElementById('s1-work-days').value           = sett.workDays;
    if (sett.lang)               document.getElementById('s1-lang').value               = sett.lang;
    if (sett.constraintsPerWeek) document.getElementById('s1-constraints-per-week').value = sett.constraintsPerWeek;

    const staffSnap = await db.ref(`branches/${branchKey}/staffingRules`).once('value');
    if (staffSnap.val()) Object.assign(setupData.staffingRules, staffSnap.val());
  } catch (e) { console.warn('loadExistingData:', e); }
}

// ===========================================
// NAVIGATION
// ===========================================
let currentStep = 1;

function showMsg(elId, text, type = 'info') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'message ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function goStep(n) {
  document.getElementById(`step-${currentStep}`).classList.remove('active');
  document.getElementById(`step-ind-${currentStep}`).classList.remove('active');
  document.getElementById(`step-ind-${currentStep}`).classList.add('done');

  currentStep = n;
  document.getElementById(`step-${currentStep}`).classList.add('active');
  document.getElementById(`step-ind-${currentStep}`).classList.add('active');
  document.getElementById(`step-ind-${currentStep}`).classList.remove('done');

  renderAll();
  window.scrollTo(0, 0);
}

let currentStaffingScope = 'weekday';

function renderAll() {
  renderShiftTypes();
  renderDepts();
  renderEmployees();
  renderConstraintTypes();
  updateDeptSelect();
  renderStaffingTable();
}

// ===========================================
// STEP 1 — Business Info
// ===========================================
async function saveStep1() {
  const name               = document.getElementById('s1-name').value.trim();
  const workDays           = document.getElementById('s1-work-days').value;
  const lang               = document.getElementById('s1-lang').value;
  const constraintsPerWeek = parseInt(document.getElementById('s1-constraints-per-week').value) || 2;

  if (!name) return showMsg('s1-msg', 'אנא הזן שם עסק', 'error');

  await db.ref(`branches/${branchKey}/displayName`).set(name);
  await db.ref(`branches/${branchKey}/settings`).update({ workDays: parseInt(workDays), lang, constraintsPerWeek });

  goStep(2);
}

// ===========================================
// STEP 2 — Shift Types
// ===========================================
function addShiftType() {
  const name  = document.getElementById('new-shift-name').value.trim();
  const start = document.getElementById('new-shift-start').value;
  const end   = document.getElementById('new-shift-end').value;

  if (!name) return showMsg('s2-msg', 'הזן שם משמרת', 'error');

  const key = 'shift_' + Date.now();
  setupData.shiftTypes[key] = { name, start, end };
  renderShiftTypes();

  document.getElementById('new-shift-name').value = '';
}

function removeShiftType(key) {
  delete setupData.shiftTypes[key];
  renderShiftTypes();
}

function renderShiftTypes() {
  const el = document.getElementById('shift-types-list');
  if (!el) return;
  const entries = Object.entries(setupData.shiftTypes);
  if (entries.length === 0) {
    el.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px;">אין משמרות עדיין</p>';
    return;
  }
  el.innerHTML = entries.map(([key, s], i) => `
    <div class="list-item">
      <div>
        <div class="item-name"><span class="shift-chip shift-color-${i % 6}">${s.name}</span></div>
        <div class="item-meta">${s.start} — ${s.end}</div>
      </div>
      <div class="item-actions">
        <button class="btn sm danger" onclick="removeShiftType('${key}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function saveStep2() {
  if (Object.keys(setupData.shiftTypes).length === 0)
    return showMsg('s2-msg', 'הוסף לפחות סוג משמרת אחד', 'error');

  await db.ref(`branches/${branchKey}/org/shiftTypes`).set(setupData.shiftTypes);
  goStep(3);
}

// ===========================================
// STEP 3 — Departments
// ===========================================
function addDept() {
  const name = document.getElementById('new-dept-name').value.trim();
  const min  = parseInt(document.getElementById('new-dept-min').value) || 0;
  const max  = parseInt(document.getElementById('new-dept-max').value) || 0;

  if (!name) return showMsg('s3-msg', 'הזן שם מחלקה', 'error');

  const key = 'dept_' + Date.now();
  setupData.departments[key] = { name, min, max, employees: {} };
  renderDepts();
  updateDeptSelect();

  document.getElementById('new-dept-name').value = '';
}

function removeDept(key) {
  delete setupData.departments[key];
  renderDepts();
  updateDeptSelect();
}

function renderDepts() {
  const el = document.getElementById('dept-list');
  if (!el) return;
  const entries = Object.entries(setupData.departments);
  if (entries.length === 0) {
    el.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px;">אין מחלקות עדיין</p>';
    return;
  }
  el.innerHTML = entries.map(([key, d]) => `
    <div class="list-item">
      <div>
        <div class="item-name">🏬 ${d.name}</div>
        <div class="item-meta">מינימום: ${d.min} | מקסימום: ${d.max || 'ללא הגבלה'}</div>
      </div>
      <div class="item-actions">
        <button class="btn sm danger" onclick="removeDept('${key}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function saveStep3() {
  if (Object.keys(setupData.departments).length === 0)
    return showMsg('s3-msg', 'הוסף לפחות מחלקה אחת', 'error');

  await db.ref(`branches/${branchKey}/org/departments`).set(setupData.departments);
  goStep(4);
}

// ===========================================
// STEP 4 — Employees
// ===========================================
function updateDeptSelect() {
  const sel = document.getElementById('new-emp-dept');
  if (!sel) return;
  const entries = Object.entries(setupData.departments);
  sel.innerHTML = '<option value="">-- בחר מחלקה --</option>' +
    entries.map(([key, d]) => `<option value="${key}">${d.name}</option>`).join('');
}

function addEmployee() {
  const display = document.getElementById('new-emp-display').value.trim();
  const user    = document.getElementById('new-emp-user').value.trim().toUpperCase();
  const pass    = document.getElementById('new-emp-pass').value.trim();
  const dept    = document.getElementById('new-emp-dept').value;
  const role    = document.getElementById('new-emp-role').value.trim();

  if (!display || !user || !pass) return showMsg('s4-msg', 'שם תצוגה, שם משתמש וסיסמה הם שדות חובה', 'error');
  if (setupData.employees[user])   return showMsg('s4-msg', 'שם המשתמש כבר קיים', 'error');

  setupData.employees[user] = { displayName: display, password: pass, dept, role };

  // Add to department's employee list
  if (dept && setupData.departments[dept]) {
    if (!setupData.departments[dept].employees) setupData.departments[dept].employees = {};
    setupData.departments[dept].employees[user] = true;
  }

  renderEmployees();

  document.getElementById('new-emp-display').value = '';
  document.getElementById('new-emp-user').value    = '';
  document.getElementById('new-emp-pass').value    = '';
  document.getElementById('new-emp-role').value    = '';
}

function removeEmployee(key) {
  // Remove from dept
  const dept = setupData.employees[key]?.dept;
  if (dept && setupData.departments[dept]?.employees) {
    delete setupData.departments[dept].employees[key];
  }
  delete setupData.employees[key];
  renderEmployees();
}

function renderEmployees() {
  const el = document.getElementById('emp-list');
  if (!el) return;
  const entries = Object.entries(setupData.employees);
  if (entries.length === 0) {
    el.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px;">אין עובדים עדיין</p>';
    return;
  }
  el.innerHTML = entries.map(([key, e]) => {
    const deptName = e.dept && setupData.departments[e.dept] ? setupData.departments[e.dept].name : '—';
    return `
      <div class="list-item">
        <div>
          <div class="item-name">👤 ${e.displayName} <small style="color:#999">(${key})</small></div>
          <div class="item-meta">מחלקה: ${deptName}${e.role ? ' | ' + e.role : ''}</div>
        </div>
        <div class="item-actions">
          <button class="btn sm danger" onclick="removeEmployee('${key}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveStep4() {
  if (Object.keys(setupData.employees).length === 0)
    return showMsg('s4-msg', 'הוסף לפחות עובד אחד', 'error');

  await db.ref(`branches/${branchKey}/org/employees`).set(setupData.employees);
  await db.ref(`branches/${branchKey}/org/departments`).set(setupData.departments);
  goStep(5);
}

// ===========================================
// STEP 5 — Absence Types
// ===========================================
const DEFAULT_CONSTRAINT_TYPES = {
  'day-off': { label: '🏖️ חופש מלא', value: 'day-off', category: 'absence', scope: 'all' },
  'sick':    { label: '🤒 מחלה',      value: 'sick',    category: 'absence', scope: 'all' },
};

function loadDefaultConstraints() {
  if (Object.keys(setupData.constraintTypes).length === 0) {
    Object.assign(setupData.constraintTypes, DEFAULT_CONSTRAINT_TYPES);
    renderConstraintTypes();
    showMsg('s5-msg', '✅ נטענו היעדרויות בסיסיות', 'info');
  }
}

function addConstraintType() {
  const label = document.getElementById('new-ct-label').value.trim();
  const value = document.getElementById('new-ct-value').value.trim();

  if (!label || !value) return showMsg('s5-msg', 'תווית וערך הם שדות חובה', 'error');
  if (setupData.constraintTypes[value]) return showMsg('s5-msg', 'ערך זה כבר קיים', 'error');

  setupData.constraintTypes[value] = { label, value, category: 'absence', scope: 'all' };
  renderConstraintTypes();

  document.getElementById('new-ct-label').value = '';
  document.getElementById('new-ct-value').value = '';
}

function removeConstraintType(key) {
  delete setupData.constraintTypes[key];
  renderConstraintTypes();
}

function renderConstraintTypes() {
  const el = document.getElementById('constraint-types-list');
  if (!el) return;
  const entries = Object.entries(setupData.constraintTypes);
  if (entries.length === 0) {
    el.innerHTML = `
      <p style="color:#aaa; text-align:center; padding:10px;">אין סוגי היעדרות מוגדרים</p>
      <button class="btn secondary sm" onclick="loadDefaultConstraints()" style="display:block; margin:10px auto; width:auto">📋 טען היעדרויות בסיסיות</button>
    `;
    return;
  }
  el.innerHTML = entries.map(([key, ct]) => `
    <div class="list-item">
      <div>
        <div class="item-name">${ct.label}</div>
        <div class="item-meta">קוד: <code>${ct.value}</code></div>
      </div>
      <div class="item-actions">
        <button class="btn sm danger" onclick="removeConstraintType('${key}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function saveStep5() {
  if (Object.keys(setupData.constraintTypes).length === 0)
    return showMsg('s5-msg', 'הוסף לפחות סוג אילוץ אחד (או לחץ "טען אילוצים בסיסיים")', 'error');

  await db.ref(`branches/${branchKey}/org/constraintTypes`).set(setupData.constraintTypes);
  goStep(6);
}

// ===========================================
// STEP 6 — Staffing Rules
// ===========================================
function setStaffingScope(scope) {
  currentStaffingScope = scope;
  ['weekday', 'friday', 'saturday'].forEach(s => {
    const btn = document.getElementById('s6-tab-' + s);
    if (btn) btn.className = 'btn sm ' + (s === scope ? 'success' : 'secondary');
  });
  renderStaffingTable();
}

function renderStaffingTable() {
  const el = document.getElementById('s6-table-wrap');
  if (!el) return;
  const depts  = Object.entries(setupData.departments);
  const shifts = Object.entries(setupData.shiftTypes);
  if (depts.length === 0 || shifts.length === 0) {
    el.innerHTML = '<p style="color:#aaa; text-align:center; padding:16px;">חזור לשלבים הקודמים והגדר מחלקות ומשמרות תחילה</p>';
    return;
  }
  const scope = currentStaffingScope;
  if (!setupData.staffingRules[scope]) setupData.staffingRules[scope] = {};

  let html = '<table style="width:100%; border-collapse:collapse; font-size:14px;">';
  html += '<thead><tr><th style="text-align:right; padding:8px; border-bottom:2px solid #e2e8f0;">מחלקה</th>';
  for (const [, st] of shifts) {
    html += `<th style="text-align:center; padding:8px; border-bottom:2px solid #e2e8f0;">${st.name}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const [dk, dept] of depts) {
    if (!setupData.staffingRules[scope][dk]) setupData.staffingRules[scope][dk] = {};
    html += `<tr><td style="padding:8px; font-weight:bold; border-bottom:1px solid #f1f5f9;">${dept.name}</td>`;
    for (const [sk] of shifts) {
      const val = setupData.staffingRules[scope][dk][sk] || 0;
      html += `<td style="text-align:center; padding:6px; border-bottom:1px solid #f1f5f9;">
        <input type="number" min="0" step="1" value="${val}"
          style="width:60px; text-align:center; border:1.5px solid #e2e8f0; border-radius:6px; padding:4px;"
          oninput="onStaffingChange('${scope}','${dk}','${sk}',this.value)">
      </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function onStaffingChange(scope, deptKey, shiftKey, value) {
  const n = parseInt(value, 10);
  if (!setupData.staffingRules[scope]) setupData.staffingRules[scope] = {};
  if (!setupData.staffingRules[scope][deptKey]) setupData.staffingRules[scope][deptKey] = {};
  setupData.staffingRules[scope][deptKey][shiftKey] = Number.isFinite(n) && n > 0 ? n : 0;
}

async function finishSetup() {
  showMsg('s6-msg', '⏳ שומר...', 'info');
  try {
    // נקה אפסים לפני שמירה
    const cleaned = {};
    for (const [scope, scopeObj] of Object.entries(setupData.staffingRules)) {
      const scopeClean = {};
      for (const [dk, deptObj] of Object.entries(scopeObj)) {
        const deptClean = {};
        for (const [sk, val] of Object.entries(deptObj)) {
          const n = parseInt(val, 10);
          if (Number.isFinite(n) && n > 0) deptClean[sk] = n;
        }
        if (Object.keys(deptClean).length > 0) scopeClean[dk] = deptClean;
      }
      if (Object.keys(scopeClean).length > 0) cleaned[scope] = scopeClean;
    }

    if (Object.keys(cleaned).length > 0)
      await db.ref(`branches/${branchKey}/staffingRules`).set(cleaned);

    await db.ref(`branches/${branchKey}/setupComplete`).set(true);
    await db.ref(`branches/${branchKey}/setupCompletedAt`).set(Date.now());

    showMsg('s6-msg', '✅ הגדרה הושלמה! עובר לניהול...', 'success');
    setTimeout(() => { window.location.href = 'manager.html'; }, 1500);
  } catch (e) {
    showMsg('s6-msg', '❌ שגיאה: ' + e.message, 'error');
  }
}

// Init defaults check on load
window.addEventListener('load', () => {
  setTimeout(() => {
    if (currentStep === 5 && Object.keys(setupData.constraintTypes).length === 0) {
      loadDefaultConstraints();
    }
    if (currentStep === 6) renderStaffingTable();
  }, 500);
});
