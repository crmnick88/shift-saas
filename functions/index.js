// ===========================================
// ShiftSaaS — Cloud Functions
// ===========================================
const { onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule }     = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }  = require('firebase-admin/app');
const { getDatabase }    = require('firebase-admin/database');
const { getMessaging }   = require('firebase-admin/messaging');
const { getAuth }        = require('firebase-admin/auth');

initializeApp();

const ADMIN_UID = 'AgyppSpe0qZ6WZLf6zyBsDb0a5k1';

// ===========================================
// מחיקת סניף מלאה (DB + Auth + branchCodes)
// ===========================================
exports.adminDeleteBranch = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID) {
    throw new HttpsError('permission-denied', 'גישה נדחתה');
  }

  const uid = request.data.uid;
  if (!uid) throw new HttpsError('invalid-argument', 'חסר uid');

  const db = getDatabase();

  // מצא את קוד הסניף לפני המחיקה
  const codeSnap = await db.ref('branches/' + uid + '/branchCode').get();
  const branchCode = codeSnap.val();

  // מחק נתוני הסניף מה-Database
  await db.ref('branches/' + uid).remove();

  // מחק את קוד הסניף
  if (branchCode) {
    await db.ref('branchCodes/' + branchCode).remove();
  }

  // מחק את חשבון ה-Auth
  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    // אם המשתמש כבר לא קיים — לא שגיאה
    if (e.code !== 'auth/user-not-found') throw e;
  }

  return { success: true };
});

// ===========================================
// עזר: שליחת push לכל עובדי הסניף
// ===========================================
async function sendPushToBranch(branchKey, title, body) {
  const db           = getDatabase();
  const tokensSnap   = await db.ref('branches/' + branchKey + '/fcmTokens').get();
  const tokensObj    = tokensSnap.val() || {};
  const tokenEntries = Object.entries(tokensObj).filter(function([, t]) { return !!t; });

  if (tokenEntries.length === 0) {
    console.log('Branch ' + branchKey + ': no FCM tokens found');
    return;
  }

  const tokenList = tokenEntries.map(function([, t]) { return t; });
  const messaging = getMessaging();
  const response  = await messaging.sendEachForMulticast({
    tokens: tokenList,
    notification: { title: title, body: body },
    android: {
      notification: { channelId: 'default', sound: 'default' },
    },
    webpush: {
      notification: { icon: '/icon-192.png', dir: 'rtl', lang: 'he' },
      fcmOptions:   { link: '/employee.html' },
    },
  });

  console.log('Branch ' + branchKey + ': ' + response.successCount + '/' + tokenList.length + ' push sent');

  if (response.failureCount > 0) {
    const invalid = {};
    response.responses.forEach(function(resp, i) {
      if (!resp.success) {
        const empKey = tokenEntries[i][0];
        invalid[empKey] = null;
        console.warn('Invalid token for ' + empKey + ':', resp.error && resp.error.message);
      }
    });
    if (Object.keys(invalid).length > 0) {
      await db.ref('branches/' + branchKey + '/fcmTokens').update(invalid);
    }
  }
}

// ===========================================
// שליחת תזכורת אילוצים (קיימת)
// מופעל כשהמנהל כותב ל: branches/{branchKey}/lastConstraintReminder
// ===========================================
exports.sendConstraintReminder = onValueWritten(
  { ref: 'branches/{branchKey}/lastConstraintReminder', region: 'europe-west1' },
  async function(event) {
    const branchKey = event.params.branchKey;
    const data      = event.data.after.val();
    if (!data || !data.sentAt) return null;
    await sendPushToBranch(branchKey, '🔔 תזכורת — ShiftSaaS', 'הזמן להזין את האילוצים שלך לשבוע הבא');
    return null;
  }
);

// ===========================================
// שליחת push ידנית עם הודעה מותאמת אישית
// מופעל כשהמנהל כותב ל: branches/{branchKey}/lastPushSent
// title ו-body נלקחים ישירות מה-event
// ===========================================
exports.sendManualPush = onValueWritten(
  { ref: 'branches/{branchKey}/lastPushSent', region: 'europe-west1' },
  async function(event) {
    const branchKey = event.params.branchKey;
    const data      = event.data.after.val();
    if (!data || !data.sentAt) return null;
    const title = data.title || '🔔 ShiftSaaS';
    const body  = data.body  || 'הודעה מהמנהל';
    await sendPushToBranch(branchKey, title, body);
    return null;
  }
);

// ===========================================
// שליחת push כשמנהל מפרסם סידור
// מופעל כשנכתב: branches/{branchKey}/schedules/{weekKey}/status = 'published'
// ===========================================
exports.onSchedulePublished = onValueWritten(
  { ref: 'branches/{branchKey}/schedules/{weekKey}/status', region: 'europe-west1' },
  async function(event) {
    const after = event.data.after.val();
    if (after !== 'published') return null;

    const branchKey = event.params.branchKey;
    const weekKey   = event.params.weekKey; // format: YYYY-MM-DD (Sunday)

    // Format week label in Hebrew
    let weekLabel = '';
    try {
      const d     = new Date(weekKey + 'T12:00:00');
      const start = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
      const end   = new Date(d.getTime() + 6 * 86400000)
                      .toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
      weekLabel = start + ' – ' + end;
    } catch (e) {
      weekLabel = weekKey;
    }

    await sendPushToBranch(
      branchKey,
      '📅 סידור עבודה פורסם',
      'הסידור לשבוע ' + weekLabel + ' זמין כעת לצפייה'
    );
    return null;
  }
);

// ===========================================
// שליחת push אוטומטית לפי תזמונים שהמנהל הגדיר
// רץ כל שעה ובודק את כל הסניפים וכל התזמונים
// נתוני תזמון: branches/{branchKey}/pushSchedules/{key}
//   { title, body, time: "HH:MM", days: {"0":true,...}, enabled: true }
// ===========================================
exports.scheduledPushNotifications = onSchedule(
  { schedule: 'every 60 minutes', region: 'europe-west1', timeZone: 'Asia/Jerusalem' },
  async function() {
    const db = getDatabase();

    // זמן נוכחי בישראל
    const now    = new Date();
    const parts  = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(now);
    const p       = {};
    parts.forEach(function(x) { p[x.type] = x.value; });
    const hourNow = p.hour.replace('24', '00');
    const dayMap  = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayNow  = dayMap[p.weekday];

    const branchesSnap = await db.ref('branches').get();
    const branches     = branchesSnap.val() || {};

    for (const branchKey of Object.keys(branches)) {
      const schedSnap = await db.ref('branches/' + branchKey + '/pushSchedules').get();
      const schedules = schedSnap.val() || {};

      for (const sched of Object.values(schedules)) {
        if (!sched.enabled || !sched.title || !sched.body || !sched.time) continue;
        if (!sched.days || !sched.days[String(dayNow)]) continue;
        if (sched.time.substring(0, 2) !== hourNow) continue;
        await sendPushToBranch(branchKey, sched.title, sched.body);
      }
    }

    return null;
  }
);
