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

// פרטי מחלקה של העובד
let empDeptKey          = null;
let empDeptEmpCount     = 0;
let deptColleagueKeys   = []; // שמות משתמש של קולגות באותה מחלקה

// אילוצי קולגות לצורך בדיקת התנגשויות
let deptColleagueConstraints = {}; // { empKey: { day_0: {...}, ... } }

// ===========================================
// INIT
// ===========================================
window.addEventListener('load', async () => {
  if (!empBranchKey || !empUsername) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const [settingsSnap, shiftSnap, ctSnap, nameSnap, empDataSnap] = await Promise.all([
      db.ref(`branches/${empBranchKey}/settings`).once('value'),
      db.ref(`branches/${empBranchKey}/org/shiftTypes`).once('value'),
      db.ref(`branches/${empBranchKey}/org/constraintTypes`).once('value'),
      db.ref(`branches/${empBranchKey}/displayName`).once('value'),
      db.ref(`branches/${empBranchKey}/org/employees/${empUsername}`).once('value'),
    ]);

    branchSettings        = settingsSnap.val() || {};
    branchShiftTypes      = shiftSnap.val()    || {};
    branchConstraintTypes = ctSnap.val()       || {};

    // טעינת פרטי מחלקה + קולגות
    const empData = empDataSnap.val() || {};
    empDeptKey = empData.dept || null;
    if (empDeptKey) {
      const deptSnap = await db.ref(`branches/${empBranchKey}/org/departments/${empDeptKey}/employees`).once('value');
      const deptEmpsObj = deptSnap.val() || {};
      empDeptEmpCount   = Object.keys(deptEmpsObj).length;
      deptColleagueKeys = Object.keys(deptEmpsObj).filter(k => k !== empUsername);
    }

    document.getElementById('emp-welcome').textContent = `שלום ${empDisplayName}! 👋`;
    document.getElementById('emp-branch-name').textContent = nameSnap.val() || '';

    showScreen('screen-main');
    loadConstraintDays();
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
let savedConstraints = {}; // { dayKey: { c1: shiftKey | absenceValue, status?: string } }

function _getAbsenceValues() {
  const keys = new Set(['day-off', 'sick']);
  Object.values(branchConstraintTypes).forEach(ct => {
    if (ct.category === 'absence') keys.add(ct.value);
  });
  return keys;
}

// מחזיר את מפתחות המשמרות הרלוונטיות לפי גודל המחלקה של העובד
// כפולה = המשמרת הארוכה ביותר (בשוויון — האחרונה שהוגדרה) — לא מוצגת כבחירה
function getRelevantShiftKeys() {
  const allEntries = Object.entries(branchShiftTypes);
  if (allEntries.length === 0) return [];
  if (empDeptEmpCount === 0) return allEntries.map(([k]) => k);

  const toMins = t => {
    if (!t || !t.includes(':')) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const getDur = ([, s]) => {
    const st = toMins(s.start), en = toMins(s.end);
    if (st === null || en === null) return 0;
    return en >= st ? en - st : 1440 - st + en;
  };

  // כפולה = ארוכה ביותר; בשוויון — האחרונה שהוגדרה (key גדול = timestamp גבוה)
  const doubleEntry = [...allEntries].sort((a, b) => {
    const da = getDur(a), db = getDur(b);
    if (da !== db) return db - da;
    return b[0].localeCompare(a[0]);
  })[0];

  // משמרות בודדות = כל השאר, ממוינות לפי שעת התחלה
  const base = allEntries
    .filter(([k]) => k !== doubleEntry[0])
    .sort(([, a], [, b]) => (a.start || '99:99').localeCompare(b.start || '99:99'));

  if (empDeptEmpCount <= 2) {
    if (base.length <= 2) return base.map(([k]) => k);
    return [base[0][0], base[base.length - 1][0]];
  }
  if (base.length <= 3) return base.map(([k]) => k);
  const mid = Math.floor(base.length / 2);
  return [base[0][0], base[mid][0], base[base.length - 1][0]];
}

function changeWeek(delta) {
  currentWeekOffset += delta;
  loadConstraintDays();
}

async function loadConstraintDays() {
  const weekKey = getWeekKey(currentWeekOffset);

  // טעינת האילוצים של העובד + כל הקולגות במקביל
  const allKeys = [empUsername, ...deptColleagueKeys];
  const snaps = await Promise.all(
    allKeys.map(k => db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${k}`).once('value'))
  );

  savedConstraints = snaps[0].val() || {};
  deptColleagueConstraints = {};
  deptColleagueKeys.forEach((k, i) => {
    deptColleagueConstraints[k] = snaps[i + 1].val() || {};
  });

  renderConstraintDays();
}

function _colleagueHasAbsenceOnDay(dayKey) {
  const absenceVals = _getAbsenceValues();
  return deptColleagueKeys.some(k => {
    const c1 = (deptColleagueConstraints[k]?.[dayKey] || {}).c1;
    return c1 && absenceVals.has(c1);
  });
}

function renderConstraintDays() {
  document.getElementById('constraint-week-label').textContent = formatWeekLabel(currentWeekOffset);

  const container   = document.getElementById('constraint-days-container');
  const workDays    = parseInt(branchSettings.workDays) || 6;
  const maxAbsences = parseInt(branchSettings.constraintsPerWeek) || 2;
  const dayNames    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const absenceVals = _getAbsenceValues();

  let usedAbsences = 0;
  for (let i = 0; i < workDays; i++) {
    const c1 = (savedConstraints[`day_${i}`] || {}).c1;
    if (c1 && absenceVals.has(c1)) usedAbsences++;
  }

  const relevantShiftKeys = getRelevantShiftKeys();
  const shifts = relevantShiftKeys.map(key => [key, branchShiftTypes[key]]).filter(([, v]) => v);
  const absenceTypes = Object.values(branchConstraintTypes).filter(ct => ct.category === 'absence');

  let html = `
    <div style="background:#f0f3ff; border-radius:10px; padding:12px 16px; margin-bottom:16px; text-align:center;">
      <div style="font-weight:bold; font-size:1.05em;">
        בקשות היעדרות: <span id="used-absences">${usedAbsences}</span> / ${maxAbsences}
      </div>
      <div style="color:#888; font-size:0.85em; margin-top:4px;">בחירת משמרת מועדפת — ללא הגבלה</div>
    </div>`;

  for (let i = 0; i < workDays; i++) {
    const dayKey    = `day_${i}`;
    const daySaved  = savedConstraints[dayKey] || {};
    const savedC1   = daySaved.c1 || '';
    const savedStat = daySaved.status || '';

    const colleagueBlocked = _colleagueHasAbsenceOnDay(dayKey);

    const shiftBtns = shifts.map(([key, shift]) => {
      const active = savedC1 === key;
      return `<button onclick="selectDayPref('${dayKey}','${key}')"
        style="padding:7px 14px; border-radius:7px; border:2px solid ${active ? '#667eea' : '#e2e8f0'};
               background:${active ? '#667eea' : '#fff'}; color:${active ? '#fff' : '#4a5568'};
               cursor:pointer; margin:3px; font-size:0.9em; font-weight:${active ? 'bold' : 'normal'};">
        ${shift.name}
      </button>`;
    }).join('');

    const absenceBtns = absenceTypes.map(ct => {
      const active = savedC1 === ct.value;
      // חסום: הגיע למגבלה שבועית, או קולגה כבר ביקש חופש ביום זה
      const limitReached = !active && usedAbsences >= maxAbsences;
      const blocked      = !active && colleagueBlocked;
      const canSelect    = active || (!limitReached && !blocked);

      let errorMsg = '';
      if (limitReached) errorMsg = `❌ הגעת למגבלת ההיעדרויות השבועיות (${maxAbsences})`;
      if (blocked)      errorMsg = '❌ עובד אחר מאותה מחלקה כבר ביקש חופש ביום זה';

      let statusBadge = '';
      if (active && savedStat) {
        if (savedStat === 'approved')  statusBadge = ' ✅';
        else if (savedStat === 'rejected') statusBadge = ' ❌';
        else statusBadge = ' ⏳';
      }

      return `<button onclick="${canSelect
          ? `selectDayPref('${dayKey}','${ct.value}')`
          : `showMsg('constraints-msg','${errorMsg}','error')`}"
        style="padding:7px 14px; border-radius:7px; border:2px solid ${active ? '#e53e3e' : '#e2e8f0'};
               background:${active ? '#e53e3e' : blocked ? '#f7f7f7' : '#fff'};
               color:${active ? '#fff' : '#4a5568'};
               cursor:${canSelect ? 'pointer' : 'not-allowed'}; margin:3px; font-size:0.9em;
               font-weight:${active ? 'bold' : 'normal'};
               ${!canSelect && !active ? 'opacity:0.4;' : ''}">
        ${ct.label}${statusBadge}
      </button>`;
    }).join('');

    const clearBtn = savedC1
      ? `<button onclick="selectDayPref('${dayKey}','')"
           style="padding:5px 10px; border-radius:6px; border:1px solid #e2e8f0; background:#f7fafc;
                  color:#999; cursor:pointer; margin:3px; font-size:0.82em;">✕ נקה</button>`
      : '';

    // הצג אזהרה אם קולגה כבר ביקש חופש ביום זה
    const colleagueWarning = colleagueBlocked
      ? `<div style="font-size:0.78em; color:#b7791f; margin-top:4px;">⚠️ קולגה ביקש חופש — היעדרות חסומה</div>`
      : '';

    html += `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-weight:bold; margin-bottom:10px; color:#667eea;">📅 יום ${dayNames[i]}</div>
        <div style="font-size:0.82em; color:#888; margin-bottom:6px;">משמרת מועדפת:</div>
        <div>${shiftBtns}${clearBtn}</div>
        ${absenceTypes.length > 0 ? `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
            <div style="font-size:0.82em; color:#888; margin-bottom:6px;">היעדרות:</div>
            <div>${absenceBtns}</div>
            ${colleagueWarning}
          </div>` : ''}
      </div>`;
  }

  container.innerHTML = html;
}

function selectDayPref(dayKey, val) {
  const absenceVals    = _getAbsenceValues();
  const maxAbsences    = parseInt(branchSettings.constraintsPerWeek) || 2;
  const workDays       = parseInt(branchSettings.workDays) || 6;
  const prev           = savedConstraints[dayKey] || {};
  const prevVal        = prev.c1 || '';
  const prevWasAbsence = prevVal && absenceVals.has(prevVal);
  const newIsAbsence   = val && absenceVals.has(val);

  if (newIsAbsence) {
    // בדיקת מגבלת היעדרויות שבועית
    if (!prevWasAbsence) {
      let count = 0;
      for (let i = 0; i < workDays; i++) {
        const c1 = (savedConstraints[`day_${i}`] || {}).c1;
        if (c1 && absenceVals.has(c1)) count++;
      }
      if (count >= maxAbsences) {
        showMsg('constraints-msg', `❌ הגעת למגבלת ההיעדרויות השבועיות (${maxAbsences})`, 'error');
        return;
      }
    }

    // בדיקת התנגשות עם קולגות
    if (_colleagueHasAbsenceOnDay(dayKey)) {
      showMsg('constraints-msg', '❌ עובד אחר מאותה מחלקה כבר ביקש חופש ביום זה', 'error');
      return;
    }
  }

  if (!val) {
    delete savedConstraints[dayKey];
  } else if (newIsAbsence) {
    const keepApproved = prevVal === val && prev.status === 'approved';
    savedConstraints[dayKey] = { c1: val, status: keepApproved ? 'approved' : 'pending' };
  } else {
    savedConstraints[dayKey] = { c1: val };
  }
  renderConstraintDays();
}

async function saveConstraints() {
  const weekKey = getWeekKey(currentWeekOffset);
  try {
    await db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${empUsername}`).set(savedConstraints);
    showMsg('constraints-msg', '✅ ההעדפות נשמרו בהצלחה', 'success');
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
    const dayKey  = `day_${i}`;
    const dayData = schedule[dayKey] || {};
    const myShift = dayData[empUsername] || null;

    if (myShift) {
      const shiftChips = String(myShift).split('|').map(sk => {
        const st = shifts[sk] || { name: sk };
        return `<span class="shift-chip shift-color-0">${st.name}${st.start ? ` ${st.start}–${st.end}` : ''}</span>`;
      }).join(' ');
      html += `
        <div class="card" style="margin-bottom:10px;">
          <strong>📅 יום ${dayNames[i]}</strong>
          <div style="margin-top:8px">${shiftChips}</div>
        </div>`;
    } else {
      html += `
        <div class="card" style="margin-bottom:10px; background:#fafafa;">
          <strong>📅 יום ${dayNames[i]}</strong>
          <div style="margin-top:8px; color:#aaa;">יום חופש 🏖️</div>
        </div>`;
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
