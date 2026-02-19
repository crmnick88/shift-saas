# ShiftSaaS — מערכת ניהול סידור עבודה

## הגדרה ראשונית

### 1. צור פרויקט Firebase חדש
1. לך ל-https://console.firebase.google.com
2. לחץ "Add Project" → תן שם → צור
3. הפעל **Authentication** → Email/Password + Anonymous
4. הפעל **Realtime Database** → תבחר אזור → התחל במצב "test mode" בינתיים

### 2. הכנס את הגדרות Firebase
פתח את `js/firebase.js` וחפש את `firebaseConfig` — החלף את כל ה-`REPLACE_WITH_...` עם הערכים האמיתיים מה-Firebase Console.

תמצא אותם ב: Project Settings → Your apps → Config

### 3. הרץ מקומית
1. פתח VS Code
2. התקן תוסף **Live Server**
3. לחץ ימני על `index.html` → "Open with Live Server"

## מבנה הקבצים

```
shift-saas/
├── index.html          ← כניסה / הרשמה
├── setup.html          ← אשף הגדרת הסניף (5 שלבים)
├── manager.html        ← פורטל מנהל
├── employee.html       ← ממשק עובד
├── style.css           ← עיצוב
├── manifest.json       ← PWA
├── service-worker.js   ← PWA cache
└── js/
    ├── firebase.js     ← Firebase init + helpers
    ├── setup.js        ← לוגיקת אשף ההגדרה
    ├── manager.js      ← לוגיקת פורטל מנהל
    ├── employee.js     ← לוגיקת ממשק עובד
    └── scheduler.js    ← אלגוריתם סידור גנרי
```

## תהליך לקוח חדש

1. לקוח נרשם ב-`index.html` → מגיע ל-`setup.html`
2. מגדיר בשלבים: פרטי עסק → משמרות → מחלקות → עובדים → אילוצים
3. מגיע ל-`manager.html`
4. מקבל **קוד סניף** (Firebase uid שלו) → מעביר לעובדים
5. עובדים נכנסים ב-`index.html` עם קוד הסניף + שם משתמש + סיסמה

## Firebase Security Rules (חובה לפרודקשן!)

החלף את rules ב-Firebase Console:

```json
{
  "rules": {
    "branches": {
      "$branchId": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid == $branchId"
      }
    }
  }
}
```
