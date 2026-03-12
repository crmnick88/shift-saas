// ===========================================
// ShiftSaaS — Super Admin Panel
// ===========================================

const ADMIN_UID = 'AgyppSpe0qZ6WZLf6zyBsDb0a5k1';

let _allBranches  = [];
let _sortKey      = 'createdAt';
let _sortDir      = -1;   // -1 = desc, 1 = asc
let _activeFilter = 'all';
let _noteUid      = null;

// ===========================================
// AUTH GUARD
// ===========================================
auth.onAuthStateChanged(async (user) => {
  if (!user || user.uid !== ADMIN_UID) {
    showScreen('screen-denied');
    return;
  }
  showScreen('screen-main');
  await loadBranches();
});

function showScreen(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ===========================================
// LOAD ALL BRANCHES
// ===========================================
async function loadBranches() {
  showMsg('', '');
  const tbody = document.getElementById('branches-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:24px;">טוען...</td></tr>';

  try {
    const snap = await db.ref('branches').once('value');
    const data = snap.val() || {};
    const now  = Date.now();

    _allBranches = Object.entries(data).map(([uid, branch]) => {
      const sub    = branch.subscription || { status: 'trial', trialEnds: 0 };
      const status = calcStatus(sub, now);
      return {
        uid,
        displayName:   branch.displayName || '(ללא שם)',
        ownerEmail:    branch.ownerEmail || branch.managerEmail || '',
        createdAt:     branch.createdAt  || 0,
        note:          branch.adminNote  || '',
        lastLogin:     branch.lastLogin  || 0,
        empCount:      Object.keys(branch.org?.employees  || {}).length,
        scheduleCount: Object.keys(branch.schedules       || {}).length,
        sub,
        status,
        trialEnds: sub.trialEnds || sub.paidUntil || 0
      };
    });

    renderStats(_allBranches, now);
    renderChart(_allBranches);
    applyFilters();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px;">שגיאה בטעינה: ${e.message}</td></tr>`;
  }
}

// ===========================================
// STATS
// ===========================================
function renderStats(branches, now) {
  const weekAgo  = now - 7  * 86400000;
  const monthAgo = now - 30 * 86400000;
  let active = 0, trial = 0, expired = 0, blocked = 0, week = 0, month = 0;

  for (const b of branches) {
    if (b.status === 'active')  active++;
    else if (b.status === 'blocked') blocked++;
    else if (b.status === 'expired') expired++;
    else trial++;
    if (b.createdAt > weekAgo)  week++;
    if (b.createdAt > monthAgo) month++;
  }

  document.getElementById('stat-total').textContent   = branches.length;
  document.getElementById('stat-active').textContent  = active;
  document.getElementById('stat-trial').textContent   = trial;
  document.getElementById('stat-expired').textContent = expired;
  document.getElementById('stat-blocked').textContent = blocked;
  document.getElementById('stat-week').textContent    = week;
  document.getElementById('stat-month').textContent   = month;
}

// ===========================================
// FILTER + SORT + SEARCH
// ===========================================
function setFilter(filter) {
  _activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  applyFilters();
}

function applyFilters() {
  const q = (document.getElementById('admin-search').value || '').trim().toLowerCase();
  let list = _allBranches.slice();

  // Status filter
  if (_activeFilter !== 'all') {
    list = list.filter(b => b.status === _activeFilter);
  }

  // Search
  if (q) {
    list = list.filter(b =>
      b.displayName.toLowerCase().includes(q) ||
      b.ownerEmail.toLowerCase().includes(q) ||
      b.uid.toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((a, b) => {
    let va = a[_sortKey] || 0;
    let vb = b[_sortKey] || 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -_sortDir;
    if (va > vb) return  _sortDir;
    return 0;
  });

  renderTable(list);
}

function sortBy(key) {
  if (_sortKey === key) {
    _sortDir *= -1;
  } else {
    _sortKey = key;
    _sortDir = key === 'displayName' ? 1 : -1;
  }
  // Update header icons
  document.querySelectorAll('.branches-table th').forEach(th => th.classList.remove('sorted'));
  const icon = document.getElementById('sort-icon-' + key);
  if (icon) {
    icon.textContent = _sortDir === 1 ? '▲' : '▼';
    icon.closest('th').classList.add('sorted');
  }
  applyFilters();
}

// ===========================================
// RENDER TABLE
// ===========================================
function renderTable(branches) {
  const tbody = document.getElementById('branches-tbody');
  if (!branches.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:30px;">אין תוצאות</td></tr>';
    return;
  }

  const now = Date.now();
  tbody.innerHTML = branches.map(b => {
    const { uid, displayName, ownerEmail, createdAt, sub, status, note, empCount, scheduleCount, lastLogin } = b;
    const badge      = statusBadge(status, sub, now);
    const created    = createdAt  ? new Date(createdAt).toLocaleDateString('he-IL')  : '—';
    const expiry     = b.trialEnds ? new Date(b.trialEnds).toLocaleDateString('he-IL') : '—';
    const lastLoginStr = lastLogin ? timeAgo(lastLogin, now) : '—';
    const noteHtml   = note
      ? `<div class="note-chip" title="${escHtml(note)}">📝 ${escHtml(note)}</div>`
      : '';

    return `<tr>
      <td>
        <div style="font-weight:600;">${escHtml(displayName)}</div>
        <div style="font-size:11px;color:#64748b;">${escHtml(ownerEmail || '')}</div>
        <div style="font-size:10px;color:#94a3b8;word-break:break-all;">${escHtml(uid)}</div>
        ${noteHtml}
      </td>
      <td style="font-size:12px;">${escHtml(ownerEmail || '—')}</td>
      <td style="text-align:center;">
        <div style="font-weight:600;">${empCount}</div>
        <div style="font-size:10px;color:#94a3b8;">${scheduleCount} סידורים</div>
      </td>
      <td style="font-size:12px;">${lastLoginStr}</td>
      <td>${badge}</td>
      <td style="font-size:12px;">${created}</td>
      <td style="font-size:12px;">${expiry}</td>
      <td>
        <div class="action-row">
          <div class="extend-wrap">
            <button class="btn sm success" onclick="toggleExtendMenu(this)">+ימים ▾</button>
            <div class="extend-menu">
              <button onclick="extendTrial('${uid}', 7);  closeExtendMenus()">+7 ימים</button>
              <button onclick="extendTrial('${uid}', 14); closeExtendMenus()">+14 ימים</button>
              <button onclick="extendTrial('${uid}', 30); closeExtendMenus()">+30 ימים</button>
            </div>
          </div>
          <button class="btn sm" onclick="setStatus('${uid}','active')"  style="background:#22c55e;color:#fff;">פעיל</button>
          <button class="btn sm danger" onclick="setStatus('${uid}','blocked')">חסום</button>
          <button class="btn sm secondary" onclick="openNoteModal('${uid}','${escHtml(displayName)}')">📝</button>
          <button class="btn sm danger" onclick="deleteBranch('${uid}','${escHtml(displayName)}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ===========================================
// CHART — הרשמות לפי חודש
// ===========================================
let _chart = null;

function renderChart(branches) {
  const canvas = document.getElementById('reg-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Build last 6 months
  const now    = new Date();
  const labels = [];
  const counts = {};
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(key);
    counts[key] = 0;
  }

  for (const b of branches) {
    if (!b.createdAt) continue;
    const d   = new Date(b.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key in counts) counts[key]++;
  }

  const data = labels.map(k => counts[k]);
  const heLabels = labels.map(k => {
    const [y, m] = k.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
  });

  if (_chart) _chart.destroy();
  _chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: heLabels,
      datasets: [{
        label: 'הרשמות',
        data,
        backgroundColor: '#4a6cf7cc',
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function timeAgo(ts, now) {
  const diff = now - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'עכשיו';
  if (mins  < 60)  return `לפני ${mins} דק'`;
  if (hours < 24)  return `לפני ${hours} שע'`;
  if (days  < 30)  return `לפני ${days} ימים`;
  return new Date(ts).toLocaleDateString('he-IL');
}

// ===========================================
// STATUS HELPERS
// ===========================================
function calcStatus(sub, now) {
  if (sub.status === 'active')  return 'active';
  if (sub.status === 'blocked') return 'blocked';
  if (sub.trialEnds && sub.trialEnds < now) return 'expired';
  return 'trial';
}

function statusBadge(status, sub, now) {
  if (status === 'active')  return '<span class="badge active">פעיל</span>';
  if (status === 'blocked') return '<span class="badge blocked">חסום</span>';
  if (status === 'expired') return '<span class="badge expired">פג תוקף</span>';
  const daysLeft = sub.trialEnds ? Math.max(0, Math.ceil((sub.trialEnds - now) / 86400000)) : '?';
  return `<span class="badge trial">ניסיון (${daysLeft} ימים)</span>`;
}

// ===========================================
// ACTIONS
// ===========================================
async function extendTrial(uid, days) {
  try {
    const ref  = db.ref(`branches/${uid}/subscription`);
    const snap = await ref.once('value');
    const sub  = snap.val() || {};
    const base = Math.max(Date.now(), sub.trialEnds || Date.now());
    await ref.update({ status: 'trial', trialEnds: base + days * 86400000 });
    showMsg('success', `הוארך ב-${days} ימים`);
    await loadBranches();
  } catch (e) {
    showMsg('error', 'שגיאה: ' + e.message);
  }
}

async function setStatus(uid, status) {
  try {
    const update = { status };
    if (status === 'active') update.paidUntil = Date.now() + 30 * 86400000;
    await db.ref(`branches/${uid}/subscription`).update(update);
    showMsg('success', `סטטוס עודכן ל-${status}`);
    await loadBranches();
  } catch (e) {
    showMsg('error', 'שגיאה: ' + e.message);
  }
}

async function deleteBranch(uid, name) {
  if (!confirm(`למחוק את הסניף "${name}"?\nפעולה זו בלתי הפיכה!`)) return;
  if (!confirm(`אישור סופי — למחוק את "${name}" לצמיתות?`)) return;
  try {
    await db.ref(`branches/${uid}`).remove();
    showMsg('success', `סניף "${name}" נמחק`);
    await loadBranches();
  } catch (e) {
    showMsg('error', 'שגיאה: ' + e.message);
  }
}

// ===========================================
// NOTE MODAL
// ===========================================
function openNoteModal(uid, name) {
  _noteUid = uid;
  document.getElementById('note-branch-name').textContent = name;
  const branch = _allBranches.find(b => b.uid === uid);
  document.getElementById('note-text').value = branch ? branch.note : '';
  document.getElementById('note-modal').classList.add('open');
}

function closeNoteModal() {
  _noteUid = null;
  document.getElementById('note-modal').classList.remove('open');
}

async function saveNote() {
  if (!_noteUid) return;
  const text = document.getElementById('note-text').value.trim();
  try {
    await db.ref(`branches/${_noteUid}/adminNote`).set(text || null);
    closeNoteModal();
    showMsg('success', 'הערה נשמרה');
    await loadBranches();
  } catch (e) {
    showMsg('error', 'שגיאה: ' + e.message);
  }
}

// Close note modal when clicking backdrop
document.getElementById('note-modal').addEventListener('click', function(e) {
  if (e.target === this) closeNoteModal();
});

// ===========================================
// EXTEND DROPDOWN
// ===========================================
function toggleExtendMenu(btn) {
  const menu = btn.nextElementSibling;
  const wasOpen = menu.classList.contains('open');
  closeExtendMenus();
  if (!wasOpen) menu.classList.add('open');
}

function closeExtendMenus() {
  document.querySelectorAll('.extend-menu.open').forEach(m => m.classList.remove('open'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.extend-wrap')) closeExtendMenus();
});

// ===========================================
// EXPORT EXCEL
// ===========================================
async function exportExcel() {
  if (!_allBranches.length) { showMsg('error', 'אין נתונים לייצוא'); return; }

  const rows = [['שם סניף', 'אימייל', 'סטטוס', 'תאריך הרשמה', 'תוקף', 'UID', 'הערה']];
  for (const b of _allBranches) {
    const created = b.createdAt ? new Date(b.createdAt).toLocaleDateString('he-IL') : '';
    const expiry  = b.trialEnds ? new Date(b.trialEnds).toLocaleDateString('he-IL') : '';
    rows.push([b.displayName, b.ownerEmail, b.status, created, expiry, b.uid, b.note]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [22, 28, 10, 12, 12, 32, 20].map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Branches');

  let array, blob;
  try {
    array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    blob  = new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } catch (e) {
    showMsg('error', 'שגיאה ביצירת הקובץ: ' + e.message); return;
  }

  const fileName = `ShiftSaaS_Branches_${new Date().toISOString().slice(0,10)}.xlsx`;

  // 1. Capacitor native (Android APK)
  if (await _shareWithCapacitor(blob, fileName)) return;

  // 2. Web Share API (Android Chrome / iOS Safari)
  if (window.File && navigator.canShare && navigator.share) {
    try {
      const fileObj = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare({ files: [fileObj] })) {
        await navigator.share({ files: [fileObj], title: 'סניפי ShiftSaaS' });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  // 3. Fallback: anchor download (desktop)
  try {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    showMsg('error', 'הורדה נכשלה: ' + e.message);
  }
}

function _isNativeCapacitor() {
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  return false;
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      if (!base64) return reject(new Error('encode failed'));
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function _shareWithCapacitor(blob, fileName) {
  if (!_isNativeCapacitor()) return false;
  try {
    const plugins    = window.Capacitor?.Plugins || {};
    const Filesystem = plugins.Filesystem;
    const Share      = plugins.Share;
    if (!Filesystem || !Share) return false;
    const safeName = fileName.replace(/[^\w.\-]+/g, '_');
    const base64   = await _blobToBase64(blob);
    const saved    = await Filesystem.writeFile({
      path: `exports/${Date.now()}_${safeName}`, data: base64,
      directory: 'CACHE', recursive: true
    });
    await Share.share({ title: 'סניפי ShiftSaaS', url: saved.uri, dialogTitle: 'ייצוא' });
    return true;
  } catch (e) {
    if (String(e?.message || '').toLowerCase().includes('cancel')) return true;
    console.warn('Capacitor share failed:', e);
    return false;
  }
}

// ===========================================
// HELPERS
// ===========================================
function showMsg(type, text) {
  const el = document.getElementById('admin-msg');
  if (!text) { el.style.display = 'none'; return; }
  el.className = 'message ' + (type === 'error' ? 'error' : 'success');
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
