// ===========================================
// employee.js — ממשק עובד
// ===========================================

// ⚠️ הכנס את ה-VAPID Key מ: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = 'BJq9fzPsJS1arouycz-bju92Wm_M2yEOL9WFBCSIJ2BLVhfKZCWmiFBhQheH5lVcdkp0_-MwAaW0mFLBWzZ-ECk';

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
let deptColleagueNames       = {}; // { empKey: displayName }
let colleagueListeners = []; // real-time listeners לניקוי בעת החלפת שבוע

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

      // טעינת שמות הקולגות
      const nameSnaps = await Promise.all(
        deptColleagueKeys.map(k => db.ref(`branches/${empBranchKey}/org/employees/${k}/displayName`).once('value'))
      );
      deptColleagueKeys.forEach((k, i) => {
        deptColleagueNames[k] = nameSnaps[i].val() || k;
      });
    }

    document.getElementById('emp-welcome').textContent = `שלום ${empDisplayName}! 👋`;
    document.getElementById('emp-branch-name').textContent = nameSnap.val() || '';

    showScreen('screen-main');
    loadConstraintDays();
    renderMySchedule();
    setupReminderListener();
    subscribeToPush();
  } catch (e) {
    alert('שגיאה בטעינה: ' + e.message);
  }
});

// ===========================================
// PUSH NOTIFICATIONS
// ===========================================

// האזנה ל-Firebase בזמן אמת — מציג באנר אם המנהל שלח תזכורת
function setupReminderListener() {
  db.ref(`branches/${empBranchKey}/lastConstraintReminder`).on('value', snap => {
    const data = snap.val();
    if (!data || !data.sentAt) return;
    const lastSeen = parseInt(localStorage.getItem('lastSeenReminder') || '0');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (data.sentAt > lastSeen && data.sentAt > sevenDaysAgo) {
      document.getElementById('reminder-banner').style.display = 'block';
      localStorage.setItem('lastSeenReminder', String(data.sentAt));
    }
  });
}

// רישום ל-FCM לקבלת הודעות פוש לטלפון (גם כשהאפליקציה סגורה)
async function subscribeToPush() {
  try {
    const cap = window.Capacitor;
    const isNative = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
    const pushPlugin = isNative && cap.Plugins && cap.Plugins.PushNotifications;

    if (isNative && pushPlugin) {
      // --- נייטיב אנדרואיד: שימוש בפלאגין Capacitor ---
      const result = await pushPlugin.requestPermissions();
      if (result.receive !== 'granted') return;

      // יצירת notification channel (דרוש Android 8+)
      await pushPlugin.createChannel({
        id: 'default',
        name: 'ShiftSaaS',
        importance: 5,
        sound: 'default',
        vibration: true,
        visibility: 1,
      });

      await pushPlugin.register();

      pushPlugin.addListener('registration', async (token) => {
        if (token && token.value) {
          await db.ref('branches/' + empBranchKey + '/fcmTokens/' + empUsername).set(token.value);
        }
      });

      pushPlugin.addListener('registrationError', (err) => {
        console.error('[Push] registration error:', err);
      });

      pushPlugin.addListener('pushNotificationReceived', async (notification) => {
        try {
          const localPlugin = cap.Plugins && cap.Plugins.LocalNotifications;
          if (localPlugin) {
            await localPlugin.schedule({
              notifications: [{
                id: Date.now() % 2147483647,
                title: notification.title || 'ShiftSaaS',
                body:  notification.body  || '',
                channelId: 'default',
                sound: 'default',
              }],
            });
          }
        } catch (e) {
          console.warn('[Push] local notification failed:', e);
        }
      });

    } else {
      // --- דפדפן: שימוש ב-Firebase Web Messaging ---
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
      if (VAPID_KEY === 'VAPID_KEY_FROM_FIREBASE_CONSOLE') return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const swReg = await navigator.serviceWorker.ready;
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });

      if (token) {
        await db.ref('branches/' + empBranchKey + '/fcmTokens/' + empUsername).set(token);
      }

      messaging.onMessage(payload => {
        const banner = document.getElementById('reminder-banner');
        if (banner) banner.style.display = 'block';
      });
    }
  } catch (e) {
    console.warn('[Push] subscription failed:', e);
  }
}

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  if (tabId === 'tab-schedule') requestAnimationFrame(scaleEmpScheduleTable);
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

  // ניקוי listeners ישנים
  colleagueListeners.forEach(({ ref, handler }) => ref.off('value', handler));
  colleagueListeners = [];

  // טעינת האילוצים של העובד עצמו
  const mySnap = await db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${empUsername}`).once('value');
  savedConstraints = mySnap.val() || {};
  deptColleagueConstraints = {};

  if (deptColleagueKeys.length === 0) {
    renderConstraintDays();
    return;
  }

  // הגדרת real-time listeners לקולגות — מתעדכן מיידית כשקולגה שומר
  let initialLoads = deptColleagueKeys.length;
  deptColleagueKeys.forEach(k => {
    const ref = db.ref(`branches/${empBranchKey}/constraints/${weekKey}/${k}`);
    const handler = snap => {
      deptColleagueConstraints[k] = snap.val() || {};
      if (initialLoads > 0) {
        initialLoads--;
        if (initialLoads === 0) renderConstraintDays();
      } else {
        renderConstraintDays(); // עדכון real-time
      }
    };
    ref.on('value', handler);
    colleagueListeners.push({ ref, handler });
  });
}

function _colleagueWhoTookConstraint(dayKey, val) {
  if (!val) return null;
  const key = deptColleagueKeys.find(k => (deptColleagueConstraints[k]?.[dayKey] || {}).c1 === val);
  return key ? (deptColleagueNames[key] || key) : null;
}

function renderConstraintDays() {
  document.getElementById('constraint-week-label').textContent = formatWeekLabel(currentWeekOffset);

  const container   = document.getElementById('constraint-days-container');
  const workDays    = parseInt(branchSettings.workDays) || 6;
  const maxAbsences = parseInt(branchSettings.constraintsPerWeek) || 2;
  const dayNames    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const absenceVals = _getAbsenceValues();

  let usedConstraints = 0;
  for (let i = 0; i < workDays; i++) {
    const c1 = (savedConstraints[`day_${i}`] || {}).c1;
    if (c1) usedConstraints++;
  }

  const relevantShiftKeys = getRelevantShiftKeys();
  const shifts = relevantShiftKeys.map(key => [key, branchShiftTypes[key]]).filter(([, v]) => v);
  const absenceTypes = Object.values(branchConstraintTypes).filter(ct => ct.category === 'absence');

  let html = `
    <div style="background:#f0f3ff; border-radius:10px; padding:12px 16px; margin-bottom:16px; text-align:center;">
      <div style="font-weight:bold; font-size:1.05em;">
        אילוצים שבחרת: <span id="used-absences">${usedConstraints}</span> / ${maxAbsences}
      </div>
    </div>`;

  for (let i = 0; i < workDays; i++) {
    const dayKey    = `day_${i}`;
    const daySaved  = savedConstraints[dayKey] || {};
    const savedC1   = daySaved.c1 || '';
    const savedStat = daySaved.status || '';

    const shiftBtns = shifts.map(([key, shift]) => {
      const active       = savedC1 === key;
      const takenBy      = !active ? _colleagueWhoTookConstraint(dayKey, key) : null;
      const limitReached = !active && !savedC1 && usedConstraints >= maxAbsences;
      const canSelect    = active || (!takenBy && !limitReached);
      let onclick = '';
      if (canSelect) onclick = `selectDayPref('${dayKey}','${key}')`;
      else if (takenBy) onclick = `showTakenByMsg(this)`;
      else onclick = `showLimitMsg(${maxAbsences})`;
      return `<button onclick="${onclick}" ${takenBy ? `data-taken-by="${takenBy}"` : ''}
        style="padding:7px 14px; border-radius:7px; border:2px solid ${active ? '#667eea' : takenBy ? '#f6ad55' : '#e2e8f0'};
               background:${active ? '#667eea' : '#fff'}; color:${active ? '#fff' : '#4a5568'};
               cursor:pointer; margin:3px; font-size:0.9em;
               font-weight:${active ? 'bold' : 'normal'};
               ${limitReached && !takenBy ? 'opacity:0.4;' : ''}">
        ${shift.name}${takenBy ? `<br><span style="font-size:0.7em;color:#b7791f;">🔒 ${takenBy}</span>` : ''}
      </button>`;
    }).join('');

    const absenceBtns = absenceTypes.map(ct => {
      const active       = savedC1 === ct.value;
      const takenBy      = !active ? _colleagueWhoTookConstraint(dayKey, ct.value) : null;
      const limitReached = !active && !savedC1 && usedConstraints >= maxAbsences;
      const canSelect    = active || (!takenBy && !limitReached);

      let statusBadge = '';
      if (active && savedStat) {
        if (savedStat === 'approved')  statusBadge = ' ✅';
        else if (savedStat === 'rejected') statusBadge = ' ❌';
        else statusBadge = ' ⏳';
      }

      let onclick = '';
      if (canSelect) onclick = `selectDayPref('${dayKey}','${ct.value}')`;
      else if (takenBy) onclick = `showTakenByMsg(this)`;
      else onclick = `showLimitMsg(${maxAbsences})`;

      return `<button onclick="${onclick}" ${takenBy ? `data-taken-by="${takenBy}"` : ''}
        style="padding:7px 14px; border-radius:7px; border:2px solid ${active ? '#e53e3e' : takenBy ? '#f6ad55' : '#e2e8f0'};
               background:${active ? '#e53e3e' : '#fff'};
               color:${active ? '#fff' : '#4a5568'};
               cursor:pointer; margin:3px; font-size:0.9em;
               font-weight:${active ? 'bold' : 'normal'};
               ${limitReached && !takenBy ? 'opacity:0.4;' : ''}">
        ${ct.label}${statusBadge}${takenBy ? `<br><span style="font-size:0.7em;color:#b7791f;">🔒 ${takenBy}</span>` : ''}
      </button>`;
    }).join('');

    const clearBtn = savedC1
      ? `<button onclick="selectDayPref('${dayKey}','')"
           style="padding:5px 10px; border-radius:6px; border:1px solid #e2e8f0; background:#f7fafc;
                  color:#999; cursor:pointer; margin:3px; font-size:0.82em;">✕ נקה</button>`
      : '';

    const colleagueWarning = '';

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
  const absenceVals = _getAbsenceValues();
  const maxAbsences = parseInt(branchSettings.constraintsPerWeek) || 2;
  const workDays    = parseInt(branchSettings.workDays) || 6;
  const prev        = savedConstraints[dayKey] || {};
  const prevVal     = prev.c1 || '';
  const newIsAbsence = val && absenceVals.has(val);

  // בדיקת מגבלת אילוצים שבועית — רק אם היום עדיין ריק (לא מחליפים קיים)
  if (val && !prevVal) {
    let count = 0;
    for (let i = 0; i < workDays; i++) {
      if ((savedConstraints[`day_${i}`] || {}).c1) count++;
    }
    if (count >= maxAbsences) {
      showMsg('constraints-msg', `❌ הגעת למגבלת האילוצים השבועיים (${maxAbsences})`, 'error');
      return;
    }
  }

  // בדיקת התנגשות עם קולגה — לכל סוג אילוץ
  if (val && val !== prevVal) {
    const takenBy = _colleagueWhoTookConstraint(dayKey, val);
    if (takenBy) {
      showMsg('constraints-msg', `❌ אילוץ זה תפוס על ידי ${takenBy}`, 'error');
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
  const weekKey   = getWeekKey(currentWeekOffsetSchedule);
  document.getElementById('schedule-week-label').textContent = formatWeekLabel(currentWeekOffsetSchedule);

  const container = document.getElementById('my-schedule-container');
  container.innerHTML = '<p style="color:#aaa; text-align:center; padding:30px;">⏳ טוען...</p>';

  const [schedSnap, orgSnap] = await Promise.all([
    db.ref(`branches/${empBranchKey}/schedules/${weekKey}`).once('value'),
    db.ref(`branches/${empBranchKey}/org`).once('value'),
  ]);

  const schedule = schedSnap.val();
  if (!schedule || schedule.status !== 'published') {
    container.innerHTML = '<p style="color:#aaa; text-align:center; padding:30px;">📭 הסידור טרם פורסם לשבוע זה</p>';
    return;
  }

  const org         = orgSnap.val() || {};
  const departments = org.departments || {};
  const employees   = org.employees   || {};
  const shiftTypes  = branchShiftTypes;
  const workDays    = parseInt(branchSettings.workDays) || 6;
  const dayNames    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  let html = `<table class="schedule-table"><thead><tr>
    <th>עובד</th>${Array.from({length: workDays}, (_, i) => `<th>${dayNames[i]}</th>`).join('')}
  </tr></thead><tbody>`;

  for (const [, dept] of Object.entries(departments)) {
    html += `<tr class="dept-divider"><td colspan="${workDays + 1}">🏬 ${dept.name}</td></tr>`;
    const deptEmps = dept.employees ? Object.keys(dept.employees) : [];
    for (const empKey of deptEmps) {
      const emp = employees[empKey] || {};
      const isMe = empKey === empUsername;
      html += `<tr${isMe ? ' style="background:#fffbe6;"' : ''}>
        <td style="font-weight:bold">${emp.displayName || empKey}${isMe ? ' 👤' : ''}</td>`;
      for (let d = 0; d < workDays; d++) {
        const shiftVal = schedule[`day_${d}`]?.[empKey];
        if (shiftVal) {
          const chips = String(shiftVal).split('|').map(sk => {
            const st  = shiftTypes[sk] || { name: sk };
            const idx = Object.keys(shiftTypes).indexOf(sk);
            const hours = (st.start && st.end) ? `<br><small style="font-size:0.75em;opacity:0.8;">${st.start}–${st.end}</small>` : '';
            return `<span class="shift-chip shift-color-${idx % 6}">${st.name}${hours}</span>`;
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
  container.innerHTML = html;
  requestAnimationFrame(scaleEmpScheduleTable);
}

let _schedNaturalH = 0;
let _schedScale    = 1;
let _pinchDist0    = 0;
let _pinchScale0   = 1;

function scaleEmpScheduleTable() {
  const container = document.getElementById('my-schedule-container');
  const table = container ? container.querySelector('table') : null;
  if (!table) return;

  table.style.transform = '';
  table.style.transformOrigin = 'top right';
  table.style.width = '';
  container.style.height = '';

  const tableRect  = table.getBoundingClientRect();
  const targetRect = container.getBoundingClientRect();

  _schedNaturalH = tableRect.height;
  _schedScale    = 1;

  if (tableRect.width > targetRect.width + 1) {
    _schedScale = targetRect.width / tableRect.width;
  }

  table.style.transform = `scale(${_schedScale})`;
  container.style.height = (_schedNaturalH * _schedScale) + 'px';

  _initSchedulePinchZoom(container);
}

function _initSchedulePinchZoom(container) {
  if (container._pinchInited) return;
  container._pinchInited = true;

  const dist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  container.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _pinchDist0  = dist(e.touches[0], e.touches[1]);
      _pinchScale0 = _schedScale;
    }
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const d = dist(e.touches[0], e.touches[1]);
    if (!_pinchDist0) return;
    const newScale = Math.max(0.3, Math.min(3.0, _pinchScale0 * (d / _pinchDist0)));
    _schedScale = newScale;
    const tbl = container.querySelector('table');
    if (tbl) {
      tbl.style.transform = `scale(${newScale})`;
      tbl.style.transformOrigin = 'top right';
      container.style.height = (_schedNaturalH * newScale) + 'px';
    }
  }, { passive: false });
}

// ===========================================
// HELPERS
// ===========================================
function showTakenByMsg(btn) {
  const name = btn.getAttribute('data-taken-by');
  showToast(`❌ אילוץ זה תפוס על ידי ${name}`, 'error');
}

function showLimitMsg(max) {
  showToast(`❌ הגעת למגבלת האילוצים השבועיים (${max})`, 'error');
}

function showToast(text, type = 'info') {
  let toast = document.getElementById('emp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'emp-toast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: 9999; padding: 12px 20px; border-radius: 10px;
      font-size: 15px; font-weight: bold; text-align: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25); max-width: 90vw;
      direction: rtl;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.background = type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda' : '#cce5ff';
  toast.style.color      = type === 'error' ? '#721c24' : type === 'success' ? '#155724' : '#004085';
  toast.style.display    = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

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
