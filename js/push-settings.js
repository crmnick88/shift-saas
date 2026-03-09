// ===========================================
// push-settings.js — הגדרות התראות פוש
// ===========================================

var psBranchKey = null;

var DAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

auth.onAuthStateChanged(async function(user) {
  if (!user) { window.location.href = 'index.html'; return; }
  await loadBranch(user.uid);
  psBranchKey = getBranchKey();
  if (!psBranchKey) { window.location.href = 'index.html'; return; }
  await renderSchedules();
  registerForegroundPushHandler();
});

function registerForegroundPushHandler() {
  try {
    var cap = window.Capacitor;
    var isNative = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
    var pushPlugin = isNative && cap.Plugins && cap.Plugins.PushNotifications;
    if (!isNative || !pushPlugin) return;
    pushPlugin.addListener('pushNotificationReceived', async function(notification) {
      try {
        var localPlugin = cap.Plugins && cap.Plugins.LocalNotifications;
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
  } catch (e) {
    console.warn('[Push] registerForegroundPushHandler failed:', e);
  }
}

async function renderSchedules() {
  var snap = await db.ref('branches/' + psBranchKey + '/pushSchedules').once('value');
  var schedules = snap.val() || {};
  var container = document.getElementById('schedules-container');
  container.innerHTML = '';

  var keys = Object.keys(schedules);
  if (keys.length === 0) {
    container.innerHTML = '<p style="color:#aaa; text-align:center; padding:40px;">אין תזמונים. לחץ "הוסף תזמון חדש" כדי ליצור אחד.</p>';
    return;
  }

  keys.forEach(function(key) {
    container.appendChild(buildCard(key, schedules[key]));
  });
}

function buildCard(key, s) {
  var div = document.createElement('div');
  div.className = 'card';
  div.dataset.key = key;
  div.style.marginBottom = '16px';

  var daysHtml = DAY_LABELS.map(function(label, i) {
    var checked = s.days && s.days[String(i)] ? 'checked' : '';
    return '<label style="font-weight:normal; display:flex; align-items:center; gap:4px; white-space:nowrap;">' +
      '<input type="checkbox" class="s-day" value="' + i + '" ' + checked + '> ' + label +
      '</label>';
  }).join('');

  div.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">' +
      '<span style="font-weight:bold; color:#444; font-size:15px;">⏰ תזמון</span>' +
      '<label style="font-weight:normal; display:flex; align-items:center; gap:6px; margin:0; font-size:14px;">' +
        '<input type="checkbox" class="s-enabled"' + (s.enabled ? ' checked' : '') + '> פעיל' +
      '</label>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>כותרת ההודעה</label>' +
      '<input type="text" class="s-title" value="' + escHtml(s.title || '') + '" maxlength="60" placeholder="לדוגמא: תזכורת אילוצים">' +
    '</div>' +
    '<div class="form-group">' +
      '<label>תוכן ההודעה</label>' +
      '<textarea class="s-body" rows="2" maxlength="200" style="resize:none;" placeholder="לדוגמא: אנא הזן את האילוצים שלך לשבוע הבא">' + escHtml(s.body || '') + '</textarea>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>ימי שליחה</label>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">' + daysHtml + '</div>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>שעת שליחה</label>' +
      '<input type="time" class="s-time" value="' + escHtml(s.time || '') + '" style="width:auto; min-width:130px;">' +
    '</div>' +
    '<div class="btn-row">' +
      '<button class="btn success" onclick="saveSchedule(this)">💾 שמור</button>' +
      '<button class="btn" onclick="sendNow(this)" style="background:#f6ad55; color:#fff; flex:none;">🔔 שלח עכשיו</button>' +
      '<button class="btn danger" onclick="deleteSchedule(this)" style="flex:none;">🗑️ מחק</button>' +
    '</div>' +
    '<div class="s-msg message" style="display:none;"></div>';

  return div;
}

function addSchedule() {
  var key = 'sched_' + Date.now();
  var container = document.getElementById('schedules-container');
  var placeholder = container.querySelector('p');
  if (placeholder) container.innerHTML = '';
  var card = buildCard(key, {});
  container.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth' });
}

async function saveSchedule(btn) {
  var card = btn.closest('.card');
  var key = card.dataset.key;
  var title = card.querySelector('.s-title').value.trim();
  var body = card.querySelector('.s-body').value.trim();
  var time = card.querySelector('.s-time').value;
  var enabled = card.querySelector('.s-enabled').checked;
  var days = {};
  card.querySelectorAll('.s-day').forEach(function(cb) {
    if (cb.checked) days[cb.value] = true;
  });

  if (!title || !body) {
    showCardMsg(card, 'יש למלא כותרת ותוכן הודעה', 'error');
    return;
  }

  await db.ref('branches/' + psBranchKey + '/pushSchedules/' + key).set({ title: title, body: body, time: time, enabled: enabled, days: days });
  showCardMsg(card, '✅ נשמר בהצלחה', 'success');
}

async function sendNow(btn) {
  var card = btn.closest('.card');
  var title = card.querySelector('.s-title').value.trim();
  var body = card.querySelector('.s-body').value.trim();

  if (!title || !body) {
    showCardMsg(card, 'יש למלא כותרת ותוכן לפני שליחה', 'error');
    return;
  }

  await db.ref('branches/' + psBranchKey + '/lastPushSent').set({ sentAt: Date.now(), title: title, body: body });
  showCardMsg(card, '🔔 ההודעה נשלחה לעובדים', 'success');
}

async function deleteSchedule(btn) {
  if (!confirm('למחוק תזמון זה?')) return;
  var card = btn.closest('.card');
  var key = card.dataset.key;
  await db.ref('branches/' + psBranchKey + '/pushSchedules/' + key).remove();
  card.remove();
  var container = document.getElementById('schedules-container');
  if (container.children.length === 0) {
    container.innerHTML = '<p style="color:#aaa; text-align:center; padding:40px;">אין תזמונים. לחץ "הוסף תזמון חדש" כדי ליצור אחד.</p>';
  }
}

function showCardMsg(card, text, type) {
  var el = card.querySelector('.s-msg');
  el.textContent = text;
  el.className = 'message ' + type;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 4000);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
