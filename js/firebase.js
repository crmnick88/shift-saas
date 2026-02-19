// ===========================================
// ShiftSaaS — Firebase Init & Branch State
// ===========================================
// ⚠️ החלף את firebaseConfig בהגדרות הפרויקט שלך מ-Firebase Console
// ===========================================

const firebaseConfig = {
  apiKey: "AIzaSyDQ101ga04UwKYUALbNOJy8LeeF7EFEOIs",
  authDomain: "shift-saas.firebaseapp.com",
  databaseURL: "https://shift-saas-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shift-saas",
  storageBucket: "shift-saas.firebasestorage.app",
  messagingSenderId: "957350830489",
  appId: "1:957350830489:web:fe458f5333fa93c5ce7308",
  

};

if (!firebase.apps || firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

const db   = firebase.database();
const auth = firebase.auth();

// ===========================================
// BRANCH STATE
// ===========================================
let _branchId  = null;   // auth uid of manager
let _branchKey = null;   // same as uid (each manager = one branch)
let _isAdmin   = false;  // reserved for super-admin later

// ===========================================
// PATHS — all scoped to branches/{branchKey}
// ===========================================

function branchPath(subPath) {
  if (!_branchKey) throw new Error('Branch not initialized');
  return `branches/${_branchKey}/${subPath}`;
}

function branchRef(subPath) {
  return db.ref(branchPath(subPath));
}

// Specific helpers
function orgRef(sub)         { return branchRef(`org/${sub}`); }
function constraintsRef(sub) { return sub ? branchRef(`constraints/${sub}`) : branchRef('constraints'); }
function schedulesRef(sub)   { return sub ? branchRef(`schedules/${sub}`)   : branchRef('schedules');   }
function settingsRef(sub)    { return sub ? branchRef(`settings/${sub}`)    : branchRef('settings');    }

// ===========================================
// BRANCH INIT
// ===========================================
async function ensureBranchExists(uid) {
  const ref = db.ref(`branches/${uid}`);
  const snap = await ref.once('value');

  if (snap.exists()) {
    _branchKey = uid;
    return;
  }

  // Branch doesn't exist yet — create skeleton
  await ref.set({
    managerUid:  uid,
    displayName: 'סניף חדש',
    createdAt:   Date.now(),
    subscription: { status: 'trial', trialEnds: Date.now() + 14 * 24 * 60 * 60 * 1000 },
    org: {
      employees:       {},
      departments:     {},
      shiftTypes:      {},
      constraintTypes: {},
      rules:           {}
    },
    settings: {}
  });

  _branchKey = uid;
  console.log('New branch created for uid:', uid);
}

async function loadBranch(uid) {
  _branchId = uid;
  await ensureBranchExists(uid);
  console.log('Branch loaded:', _branchKey);
}

// ===========================================
// SUBSCRIPTION CHECK
// ===========================================
async function getSubscriptionStatus() {
  try {
    const snap = await settingsRef('subscription').once('value');
    // Check under settings first, then root branch
    const branchSnap = await db.ref(`branches/${_branchKey}/subscription`).once('value');
    const sub = branchSnap.val() || snap.val() || {};
    return sub.status || 'trial';
  } catch (e) {
    return 'unknown';
  }
}

// ===========================================
// AUTH STATE
// ===========================================
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    // Sign in anonymously for employees / unauthenticated reads
    try { await auth.signInAnonymously(); } catch (e) {}
    return;
  }

  _branchId = user.uid;

  // Check if this is a manager (has a branch) or anonymous employee
  const branchSnap = await db.ref(`branches/${user.uid}`).once('value').catch(() => null);
  if (branchSnap && branchSnap.exists()) {
    await loadBranch(user.uid);
  }
  // Employees set their branch via localStorage (set during login)
});

// ===========================================
// EXPORTS
// ===========================================
window.db             = db;
window.auth           = auth;
window.branchRef      = branchRef;
window.orgRef         = orgRef;
window.constraintsRef = constraintsRef;
window.schedulesRef   = schedulesRef;
window.settingsRef    = settingsRef;
window.loadBranch     = loadBranch;
window.getBranchKey   = () => _branchKey;
window.getBranchId    = () => _branchId;
window.isAdmin        = () => _isAdmin;
window.getSubscriptionStatus = getSubscriptionStatus;
