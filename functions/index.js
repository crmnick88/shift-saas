// ===========================================
// ShiftSaaS — Cloud Functions
// ===========================================
const { onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp }  = require('firebase-admin/app');
const { getDatabase }    = require('firebase-admin/database');
const { getMessaging }   = require('firebase-admin/messaging');

initializeApp();

// ===========================================
// שליחת תזכורת push לכל עובדי הסניף
// מופעל כשהמנהל כותב ל: branches/{branchKey}/lastConstraintReminder
// ===========================================
exports.sendConstraintReminder = onValueWritten(
  {
    ref:    'branches/{branchKey}/lastConstraintReminder',
    region: 'europe-west1',  // אותו region כמו ה-Realtime Database
  },
  async (event) => {
    const branchKey = event.params.branchKey;
    const data      = event.data.after.val();

    if (!data || !data.sentAt) return null;

    const db = getDatabase();

    // שלוף את כל ה-FCM tokens של הסניף הזה בלבד
    const tokensSnap   = await db.ref(`branches/${branchKey}/fcmTokens`).get();
    const tokensObj    = tokensSnap.val() || {};
    const tokenEntries = Object.entries(tokensObj).filter(([, t]) => !!t);

    if (tokenEntries.length === 0) {
      console.log(`Branch ${branchKey}: no FCM tokens found`);
      return null;
    }

    const tokenList = tokenEntries.map(([, t]) => t);

    // שלח push לכל הטוקנים
    const messaging = getMessaging();
    const response  = await messaging.sendEachForMulticast({
      tokens: tokenList,
      notification: {
        title: '🔔 תזכורת — ShiftSaaS',
        body:  'הזמן להזין את האילוצים שלך לשבוע הבא',
      },
      webpush: {
        notification: {
          icon: '/icon-192.png',
          dir:  'rtl',
          lang: 'he',
        },
        fcmOptions: { link: '/employee.html' },
      },
    });

    console.log(
      `Branch ${branchKey}: ${response.successCount}/${tokenList.length} push sent`
    );

    // נקה טוקנים לא תקפים
    if (response.failureCount > 0) {
      const invalid = {};
      response.responses.forEach((resp, i) => {
        if (!resp.success) {
          const [empKey] = tokenEntries[i];
          invalid[empKey] = null;
          console.warn(`Invalid token for ${empKey}:`, resp.error?.message);
        }
      });
      if (Object.keys(invalid).length > 0) {
        await db.ref(`branches/${branchKey}/fcmTokens`).update(invalid);
      }
    }

    return null;
  }
);
