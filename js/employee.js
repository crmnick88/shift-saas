// ===========================================
// employee.js — ממשק עובד
// ===========================================

let empBranchKey = localStorage.getItem('empBranchKey');
let empUsername  = localStorage.getItem('empUsername');
let empDisplayName = localStorage.getItem('empDisplayName') || empUsername;

let branchSettings   = {};
let branchShiftTypes = {};
let branchConstraintTypes = {};
let currentWeekOffset = 0;
let currentWeekOffsetSchedule = 0;

// ===========================================
// INIT
// ===========================================
window.addEventListener('load', async () => {
  if (!empBranchKey || !empUsername) {
    window.location.href = 'index.html';
    return;
  }

  try {
    // Load branch data
    const [settingsSnap, shiftSnap, ctSnap, nameSnap] = await Promise.all([
      db.ref(`branches/${empBranchKey}/settings`).once('value'),
      db.ref(`branches/${empBranchKey}/org/shiftTypes`).once('value'),
      db.ref(`branches/${empBranchKey}/org/constraintTypes`).once('value'),
      db.ref(`branches/${empBranchKey}/displayName`).once('value'),
    ]);

    branchSettings        = settingsSnap.val() || {};
    branchShiftTypes      = shiftSnap.val()    || {};
    branchConstraintTypes = ctSnap.val()       || {};

    document.getElementById('emp-welcome').textContent = `שלום ${empDisplayName}! 👋`;
    document.getElementById('emp-branch-name').textContent = nameSnap.val() || '';

    showScreen('screen-main');
    renderConstraintDays();
    renderMySchedule();
  } catch (e) {
    alert('שגיאה בטעינה: ' + e.message);
  }
});

function showScreen(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===========================================
// WEEK HELPERS
// ===========================================
function getWeekKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1 + offset * 7); // Monday
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(offset = 0) {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() + 1 + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('he-IL')} — ${end.toLocaleDateString('he-IL')}`;
}

// ===========================================
// TABS
// ===========================================
function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const idx = ['tab-constraints','tab-schedule'].indexOf(tabId);
  document.querySelectorAll('.nav-tab')[idx].classList.add('active');
}

// ===========================================
// CONSTRAINTS
// ===========================================
let savedConstraints = {}; // { dayKey: { c1: value, c2: value } }

function changeWeek(delta) {
  currentWeekOffset += delta;
  renderConstraintDays();
}

async function renderConstraintDays() {
  const weekKey = getWeekKey(currentWeekOffset);
  document.getElementById('constraint-week-label').textContent = formatWeekLabel(currentWeekOffset);

  // Load existing constraints for this week
  const snap = await db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${empUsername}`).once('value');
  savedConstraints = snap.val() || {};

  const container = document.getElementById('constraint-days-container');
  const workDays  = parseInt(branchSettings.workDays) || 6;
  const dayNames  = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const ctOptions = Object.values(branchConstraintTypes);

  const optionsHTML = `<option value="">-- אין --</option>` +
    ctOptions.map(ct => `<option value="${ct.value}">${ct.label}</option>`).join('');

  let html = '';
  for (let i = 0; i < workDays; i++) {
    const dayKey = `day_${i}`;
    const saved  = savedConstraints[dayKey] || {};
    html += `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-weight:bold; margin-bottom:10px; color:#667eea;">📅 יום ${dayNames[i]}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0">
            <label>אילוץ 1</label>
            <select id="c1-${dayKey}">${optionsHTML}</select>
          </div>
          <div class="form-group" style="margin:0">
            <label>אילוץ 2</label>
            <select id="c2-${dayKey}">${optionsHTML}</select>
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;

  // Restore saved values
  for (let i = 0; i < workDays; i++) {
    const dayKey = `day_${i}`;
    const saved  = savedConstraints[dayKey] || {};
    const c1 = document.getElementById(`c1-${dayKey}`);
    const c2 = document.getElementById(`c2-${dayKey}`);
    if (c1 && saved.c1) c1.value = saved.c1;
    if (c2 && saved.c2) c2.value = saved.c2;
  }
}

async function saveConstraints() {
  const weekKey  = getWeekKey(currentWeekOffset);
  const workDays = parseInt(branchSettings.workDays) || 6;
  const data     = {};

  for (let i = 0; i < workDays; i++) {
    const dayKey = `day_${i}`;
    const c1 = document.getElementById(`c1-${dayKey}`)?.value || '';
    const c2 = document.getElementById(`c2-${dayKey}`)?.value || '';
    if (c1 || c2) data[dayKey] = { c1, c2, savedAt: Date.now() };
  }

  try {
    await db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${empUsername}`).set(data);
    showMsg('constraints-msg', '✅ האילוצים נשמרו בהצלחה', 'success');
  } catch (e) {
    showMsg('constraints-msg', '❌ שגיאה בשמירה: ' + e.message, 'error');
  }
}

// ===========================================
// SCHEDULE VIEW
// ===========================================
function changeWeekSchedule(delta) {
  currentWeekOffsetSchedule += delta;
  renderMySchedule();
}

async function renderMySchedule() {
  const weekKey = getWeekKey(currentWeekOffsetSchedule);
  document.getElementById('schedule-week-label').textContent = formatWeekLabel(currentWeekOffsetSchedule);

  const snap = await db.ref(`branches/${empBranchKey}/schedules/${weekKey}`).once('value');
  const schedule = snap.val();
  const container = document.getElementById('my-schedule-container');

  if (!schedule || schedule.status !== 'published') {
    container.innerHTML = '<p style="color:#aaa; text-align:center; padding:30px;">📭 הסידור טרם פורסם לשבוע זה</p>';
    return;
  }

  const workDays = parseInt(branchSettings.workDays) || 6;
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const shifts   = branchShiftTypes;

  let html = '';
  for (let i = 0; i < workDays; i++) {
    const dayKey   = `day_${i}`;
    const dayData  = schedule[dayKey] || {};
    const myShift  = dayData[empUsername] || null;

    if (myShift) {
      const st = shifts[myShift] || { name: myShift };
      html += `
        <div class="card" style="margin-bottom:10px;">
          <strong>📅 יום ${dayNames[i]}</strong>
          <div style="margin-top:8px">
            <span class="shift-chip shift-color-0">${st.name}${st.start ? ` ${st.start}–${st.end}` : ''}</span>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="card" style="margin-bottom:10px; background:#fafafa;">
          <strong>📅 יום ${dayNames[i]}</strong>
          <div style="margin-top:8px; color:#aaa;">יום חופש 🏖️</div>
        </div>
      `;
    }
  }

  container.innerHTML = html || '<p style="color:#aaa">אין נתונים</p>';
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
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function logout() {
  localStorage.removeItem('empBranchKey');
  localStorage.removeItem('empUsername');
  localStorage.removeItem('empDisplayName');
  window.location.href = 'index.html';
}
