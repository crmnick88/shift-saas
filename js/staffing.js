// ===========================================
// staffing.js — מסך "דרישות שיבוץ"
// ===========================================

let mgrBranchKey = null;
let orgData = {};
let currentScope = 'weekday'; // weekday | friday | saturday
let staffingRules = {}; // { scope: { deptKey: { shiftKey: number } } }

function showMsg(elId, text, type = 'info') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'message ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }

  await loadBranch(user.uid);
  mgrBranchKey = getBranchKey();
  if (!mgrBranchKey) { window.location.href = 'index.html'; return; }

  // Load org (departments + shiftTypes)
  const orgSnap = await db.ref(`branches/${mgrBranchKey}/org`).once('value');
  orgData = orgSnap.val() || {};

  // Load existing rules
  const ruleSnap = await db.ref(`branches/${mgrBranchKey}/staffingRules`).once('value');
  staffingRules = ruleSnap.val() || {};

  setRuleScope('weekday');
});

function setRuleScope(scope) {
  currentScope = scope;

  // tabs style
  ['weekday','friday','saturday'].forEach(s => {
    const btn = document.getElementById('tab-' + s);
    if (!btn) return;
    btn.classList.remove('success');
    btn.classList.add('secondary');
  });
  const active = document.getElementById('tab-' + scope);
  if (active) {
    active.classList.remove('secondary');
    active.classList.add('success');
  }

  renderTable();
}

function getScopeData() {
  if (!staffingRules[currentScope]) staffingRules[currentScope] = {};
  return staffingRules[currentScope];
}

function renderTable() {
  const departments = orgData.departments || {};
  const shiftTypes = orgData.shiftTypes || {};

  const deptEntries = Object.entries(departments);
  const shiftEntries = Object.entries(shiftTypes);

  if (deptEntries.length === 0) {
    document.getElementById('staffing-thead').innerHTML = '';
    document.getElementById('staffing-tbody').innerHTML = '<tr><td style="padding:16px; color:#777;">אין מחלקות מוגדרות עדיין.</td></tr>';
    return;
  }
  if (shiftEntries.length === 0) {
    document.getElementById('staffing-thead').innerHTML = '';
    document.getElementById('staffing-tbody').innerHTML = '<tr><td style="padding:16px; color:#777;">אין סוגי משמרות מוגדרים עדיין.</td></tr>';
    return;
  }

  const scopeData = getScopeData();

  // Header
  let thead = '<tr><th style="min-width:220px;">מחלקה</th>';
  for (const [shiftKey, shift] of shiftEntries) {
    thead += `<th style="min-width:120px; text-align:center;">${shift.name || shiftKey}</th>`;
  }
  thead += '</tr>';
  document.getElementById('staffing-thead').innerHTML = thead;

  // Body
  let tbody = '';
  for (const [deptKey, dept] of deptEntries) {
    tbody += `<tr><td><strong>${dept.name || deptKey}</strong></td>`;
    if (!scopeData[deptKey]) scopeData[deptKey] = {};
    for (const [shiftKey] of shiftEntries) {
      const val = scopeData[deptKey][shiftKey] ?? 0;
      const inputId = `req_${currentScope}_${deptKey}_${shiftKey}`;
      tbody += `
        <td style="text-align:center;">
          <input type="number" min="0" step="1" id="${inputId}"
                 value="${val}"
                 style="width:90px; text-align:center;"
                 oninput="onReqChange('${deptKey}','${shiftKey}', this.value)">
        </td>`;
    }
    tbody += '</tr>';
  }
  document.getElementById('staffing-tbody').innerHTML = tbody;
}

function onReqChange(deptKey, shiftKey, value) {
  const n = parseInt(value, 10);
  const scopeData = getScopeData();
  if (!scopeData[deptKey]) scopeData[deptKey] = {};
  scopeData[deptKey][shiftKey] = Number.isFinite(n) && n > 0 ? n : 0;
}

async function saveStaffingRules() {
  try {
    // Clean zeros before saving (keep payload small)
    const cleaned = {};
    for (const [scope, scopeObj] of Object.entries(staffingRules || {})) {
      const scopeClean = {};
      for (const [deptKey, deptObj] of Object.entries(scopeObj || {})) {
        const deptClean = {};
        for (const [shiftKey, val] of Object.entries(deptObj || {})) {
          const n = parseInt(val, 10);
          if (Number.isFinite(n) && n > 0) deptClean[shiftKey] = n;
        }
        // keep dept even if empty? no
        if (Object.keys(deptClean).length > 0) scopeClean[deptKey] = deptClean;
      }
      if (Object.keys(scopeClean).length > 0) cleaned[scope] = scopeClean;
    }

    await db.ref(`branches/${mgrBranchKey}/staffingRules`).set(cleaned);
    staffingRules = cleaned;
    showMsg('staffing-msg', '✅ נשמר בהצלחה', 'success');
    renderTable();
  } catch (e) {
    showMsg('staffing-msg', '❌ ' + (e.message || e), 'error');
  }
}
