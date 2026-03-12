// ===========================================
// scheduler.js — אלגוריתם גנרי לסידור עבודה
// ===========================================

function generateSchedule(orgData, constraints, settings) {
  const workDays    = parseInt(settings.workDays) || 6;
  const employees   = orgData.employees   || {};
  const departments = orgData.departments || {};
  const shiftTypes  = orgData.shiftTypes  || {};
  const constraintTypes = orgData.constraintTypes || {};

  const shiftKeys = Object.keys(shiftTypes);
  if (shiftKeys.length === 0) throw new Error('אין סוגי משמרות מוגדרים');

  // ==== ניתוח משמרות: בודד / כפולה, מיין לפי שעת התחלה ====
  const toMins = t => {
    if (!t || !t.includes(':')) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const shiftDuration = key => {
    const s = shiftTypes[key];
    const st = toMins(s?.start);
    const en = toMins(s?.end);
    if (st === null || en === null) return 0;
    return en >= st ? en - st : 1440 - st + en;
  };

  // מפתח כפולה = המשמרת הארוכה ביותר; בשוויון — האחרונה שהוגדרה (key גדול = timestamp גבוה)
  const doubleShiftKey = [...shiftKeys].sort((a, b) => {
    const da = shiftDuration(a), db = shiftDuration(b);
    if (da !== db) return db - da;   // ארוכה יותר — קודם
    return b.localeCompare(a);       // הוגדרה אחרונה — קודם
  })[0] || null;

  // משמרות בודדות = כל השאר חוץ מהכפולה, ממוינות לפי שעת התחלה
  const singleShiftKeys = shiftKeys
    .filter(k => k !== doubleShiftKey && toMins(shiftTypes[k]?.start) !== null)
    .sort((a, b) => (shiftTypes[a].start || '99:99').localeCompare(shiftTypes[b].start || '99:99'));

  // Build result skeleton
  const result = {};
  for (let d = 0; d < workDays; d++) result[`day_${d}`] = {};

  // Per-dept employee lists
  const deptEmployees = {};
  for (const [deptKey, dept] of Object.entries(departments)) {
    deptEmployees[deptKey] = dept.employees ? Object.keys(dept.employees) : [];
  }

  // Employee → dept map
  const empDept = {};
  for (const [deptKey, emps] of Object.entries(deptEmployees)) {
    for (const empKey of emps) empDept[empKey] = deptKey;
  }
  for (const empKey of Object.keys(employees)) {
    if (!empDept[empKey]) empDept[empKey] = null;
  }

  // Constraint lookup
  function getConstraints(empKey, dayKey) {
    return constraints[empKey]?.[dayKey] || {};
  }

  // האם העובד נעדר ביום זה (היעדרות מאושרת)?
  function isAbsent(empKey, dayKey) {
    const constraint = getConstraints(empKey, dayKey);
    const val = constraint.c1;
    if (!val) return false;
    if (shiftTypes[val]) return false;
    const ctDef = constraintTypes[val] || {};
    const isAbsence = ctDef.category === 'absence' || val === 'day-off' || val === 'sick';
    if (!isAbsence) return false;
    const status = constraint.status;
    return !status || status === 'approved';
  }

  function isBlocked(empKey, dayKey) {
    if ((empDayCount[empKey] || 0) >= maxDaysPerEmp) return true;
    return isAbsent(empKey, dayKey);
  }

  function wantsShift(empKey, dayKey, shiftKey) {
    return getConstraints(empKey, dayKey).c1 === shiftKey;
  }

  // ===================================================
  // מעקב הוגנות: ספירה לפי סוג משמרת (לא רק סה"כ)
  // כך כל עובד מקבל חלוקה שווה של בוקר / ערב לאורך השבוע
  // ===================================================
  const empShiftTypeCount = {};
  for (const empKey of Object.keys(employees)) empShiftTypeCount[empKey] = {};

  // מגבלת ימי עבודה: עובד לא יעבוד יותר מ-(workDays-1) ימים בשבוע
  // (מבטיח לפחות יום מנוחה אחד)
  const maxDaysPerEmp = workDays >= 7 ? workDays - 1 : workDays;
  const empDayCount   = {};
  for (const empKey of Object.keys(employees)) empDayCount[empKey] = 0;

  // סה"כ משמרות לעובד (לצורך מיון כללי)
  function totalShiftCount(empKey) {
    return Object.values(empShiftTypeCount[empKey] || {}).reduce((s, v) => s + v, 0);
  }

  // מיין רשימת עובדים לפי מספר הפעמים שעבדו shuftKey ספציפי (עולה)
  // תיקו: לפי סה"כ משמרות (עולה)
  function sortByShiftTypeFairness(empKeys, shiftKey) {
    return [...empKeys].sort((a, b) => {
      const diff = (empShiftTypeCount[a][shiftKey] || 0) - (empShiftTypeCount[b][shiftKey] || 0);
      if (diff !== 0) return diff;
      return totalShiftCount(a) - totalShiftCount(b);
    });
  }

  function recordShift(empKey, shiftKey) {
    empShiftTypeCount[empKey][shiftKey] = (empShiftTypeCount[empKey][shiftKey] || 0) + 1;
  }

  const staffingRules = settings.staffingRules || {};
  const weekKey       = settings.weekKey || null;

  // מספר שבוע — לשימוש בסיבוב רשימת עובדים (rotation) לחלוקה הוגנת בין שבועות
  const weekNumber = weekKey
    ? Math.floor(new Date(weekKey + 'T12:00:00').getTime() / (7 * 24 * 60 * 60 * 1000))
    : 0;

  // סיבוב מערך עובדים לפי offset כדי לשנות סדר עדיפות מדי שבוע
  function rotateArray(arr, offset) {
    if (arr.length <= 1) return arr;
    const n = ((offset % arr.length) + arr.length) % arr.length;
    return [...arr.slice(n), ...arr.slice(0, n)];
  }

  // הפוך את רשימות העובדים לכל מחלקה — כך עובד אחר פותח כל שבוע
  for (const deptKey of Object.keys(deptEmployees)) {
    deptEmployees[deptKey] = rotateArray(deptEmployees[deptKey], weekNumber);
  }

  function getScopeForDayIndex(dayIndex) {
    if (weekKey) {
      const base = new Date(weekKey);
      if (!isNaN(base.getTime())) {
        const dt = new Date(base);
        dt.setDate(dt.getDate() + dayIndex);
        const dow = dt.getDay();
        if (dow === 5) return 'friday';
        if (dow === 6) return 'saturday';
        return 'weekday';
      }
    }
    if (workDays >= 7) return (dayIndex === 5 ? 'friday' : dayIndex === 6 ? 'saturday' : 'weekday');
    if (workDays === 6) return (dayIndex === 5 ? 'friday' : 'weekday');
    return 'weekday';
  }

  // חישוב דרישות אוטומטיות לפי מספר עובדים זמינים + גודל מחלקה מקורי
  function autoDeptRequirements(effectiveCount, totalCount) {
    const req = {};
    if (effectiveCount <= 0) return req;

    const base  = singleShiftKeys.length >= 2 ? singleShiftKeys : shiftKeys;
    const first = base[0];
    const last  = base[base.length - 1];
    const mid   = base[Math.floor(base.length / 2)];

    // מחלקה של 2: עובד אחד נעדר → הנותר מקבל כפולה
    if (totalCount === 2 && effectiveCount === 1) {
      const dk = doubleShiftKey || last;
      req[dk] = 1;
      return req;
    }

    // מחלקה של 3+: עובד אחד נעדר → רק בוקר + ערב לנותרים
    if (totalCount >= 3 && effectiveCount === totalCount - 1) {
      req[first] = 1;
      req[last]  = 1;
      return req;
    }

    // נורמלי
    if (effectiveCount === 1) { req[first] = 1; return req; }
    if (effectiveCount === 2) { req[first] = 1; req[last] = 1; return req; }
    // 3+
    req[first] = 1;
    if (base.length >= 3) req[mid] = 1;
    req[last] = 1;
    return req;
  }

  for (let d = 0; d < workDays; d++) {
    const dayKey     = `day_${d}`;
    const scope      = getScopeForDayIndex(d);
    const scopeRules = staffingRules[scope] || {};

    for (const [deptKey, dept] of Object.entries(departments)) {
      const emps = deptEmployees[deptKey] || [];
      if (emps.length === 0) continue;

      const effectiveCount = emps.filter(e => !isAbsent(e, dayKey)).length;

      const deptRule = scopeRules[deptKey] || {};
      let required = {};
      if (deptRule && Object.keys(deptRule).length > 0) {
        for (const [sk, val] of Object.entries(deptRule)) {
          const n = parseInt(val);
          if (shiftTypes[sk] && Number.isFinite(n) && n > 0) required[sk] = n;
        }
      } else {
        required = autoDeptRequirements(effectiveCount, emps.length);
      }

      if (Object.keys(required).length === 0) {
        for (const empKey of emps) result[dayKey][empKey] = null;
        continue;
      }

      // מיון ראשוני לפי סה"כ משמרות (עובדים עם פחות משמרות — קודם)
      const sorted     = [...emps].sort((a, b) => totalShiftCount(a) - totalShiftCount(b));
      const unassigned = new Set(sorted);

      function wantsOtherShift(empKey, shiftKey) {
        return shiftKeys.some(sk => sk !== shiftKey && wantsShift(empKey, dayKey, sk));
      }

      // Pass 1: עובדים שביקשו את המשמרת הספציפית הזו
      // מיון: מי עבד פחות בסוג זה — קודם
      for (const shiftKey of Object.keys(required)) {
        let need = required[shiftKey];
        const candidates = sortByShiftTypeFairness([...unassigned], shiftKey);
        for (const empKey of candidates) {
          if (need <= 0) break;
          if (wantsShift(empKey, dayKey, shiftKey) && !isBlocked(empKey, dayKey)) {
            result[dayKey][empKey] = shiftKey;
            recordShift(empKey, shiftKey);
            unassigned.delete(empKey);
            need--;
          }
        }
      }

      // Pass 2: עובדים ללא העדפה ספציפית (שיבוץ חופשי — מיון לפי סוג משמרת)
      for (const shiftKey of Object.keys(required)) {
        const alreadyIn = sorted.filter(e => result[dayKey][e] === shiftKey).length;
        let need = required[shiftKey] - alreadyIn;
        const candidates = sortByShiftTypeFairness([...unassigned], shiftKey);
        for (const empKey of candidates) {
          if (need <= 0) break;
          if (isBlocked(empKey, dayKey)) continue;
          if (wantsOtherShift(empKey, shiftKey)) continue;
          result[dayKey][empKey] = shiftKey;
          recordShift(empKey, shiftKey);
          unassigned.delete(empKey);
          need--;
        }
      }

      // Pass 3: גיבוי — עובדים שביקשו משמרת אחרת אך לא קיבלו אותה
      for (const shiftKey of Object.keys(required)) {
        const alreadyIn = sorted.filter(e => result[dayKey][e] === shiftKey).length;
        let need = required[shiftKey] - alreadyIn;
        const candidates = sortByShiftTypeFairness([...unassigned], shiftKey);
        for (const empKey of candidates) {
          if (need <= 0) break;
          if (!isBlocked(empKey, dayKey)) {
            result[dayKey][empKey] = shiftKey;
            recordShift(empKey, shiftKey);
            unassigned.delete(empKey);
            need--;
          }
        }
      }

      // Pass 4: כפולה — ממלא חוסרים עם עובדים שכבר משובצים
      for (const shiftKey of Object.keys(required)) {
        const filled = sorted.filter(empK => {
          const v = result[dayKey][empK];
          return v && (v === shiftKey || String(v).split('|').includes(shiftKey));
        }).length;
        let need = required[shiftKey] - filled;
        for (const empKey of sorted) {
          if (need <= 0) break;
          const current = result[dayKey][empKey];
          if (!current) continue;
          const currentShifts = String(current).split('|');
          if (currentShifts.includes(shiftKey)) continue;
          if (!isBlocked(empKey, dayKey)) {
            result[dayKey][empKey] = current + '|' + shiftKey;
            need--;
          }
        }
      }

      // שאר העובדים → חופש
      for (const empKey of sorted) {
        if (result[dayKey][empKey] === undefined) result[dayKey][empKey] = null;
      }
    }

    // עובדים שלא במחלקה → חופש
    for (const empKey of Object.keys(employees)) {
      if (empDept[empKey] === null && result[dayKey][empKey] === undefined) {
        result[dayKey][empKey] = null;
      }
    }

    // עדכון מונה ימי עבודה לכל עובד שקיבל משמרת היום
    for (const empKey of Object.keys(employees)) {
      if (result[dayKey][empKey]) empDayCount[empKey] = (empDayCount[empKey] || 0) + 1;
    }
  }

  return result;
}

window.generateSchedule = generateSchedule;
