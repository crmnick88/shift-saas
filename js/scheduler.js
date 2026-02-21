// ===========================================
// scheduler.js — אלגוריתם גנרי לסידור עבודה
// עובד עם כל מספר משמרות, מחלקות ועובדים
// ===========================================

/**
 * generateSchedule(orgData, constraints, settings)
 * 
 * @param {object} orgData - { departments, employees, shiftTypes, constraintTypes, rules }
 * @param {object} constraints - { [empKey]: { [dayKey]: { c1, c2 } } }
 * @param {object} settings - { workDays }
 * 
 * @returns {object} schedule - { day_0: { [empKey]: shiftTypeKey|null }, day_1: {...}, ... }
 */
function generateSchedule(orgData, constraints, settings) {
  const workDays   = parseInt(settings.workDays) || 6;
  const employees  = orgData.employees  || {};
  const departments = orgData.departments || {};
  const shiftTypes = orgData.shiftTypes || {};
  const rules      = orgData.rules      || {};

  const shiftKeys = Object.keys(shiftTypes);
  if (shiftKeys.length === 0) {
    throw new Error('אין סוגי משמרות מוגדרים');
  }

  // Build result skeleton
  const result = {};
  for (let d = 0; d < workDays; d++) {
    result[`day_${d}`] = {};
  }

  // Build per-dept employee lists
  const deptEmployees = {}; // { deptKey: [empKey, ...] }
  for (const [deptKey, dept] of Object.entries(departments)) {
    deptEmployees[deptKey] = dept.employees ? Object.keys(dept.employees) : [];
  }

  // Employee → dept map
  const empDept = {};
  for (const [deptKey, emps] of Object.entries(deptEmployees)) {
    for (const empKey of emps) {
      empDept[empKey] = deptKey;
    }
  }

  // Also add employees not in any dept
  for (const empKey of Object.keys(employees)) {
    if (!empDept[empKey]) empDept[empKey] = null;
  }

  // Constraint lookup: empKey → dayKey → [c1, c2]
  function getConstraints(empKey, dayKey) {
    return constraints[empKey]?.[dayKey] || {};
  }

  // Check if constraint blocks a shift
  function isBlocked(empKey, dayKey, shiftKey) {
    const c = getConstraints(empKey, dayKey);
    const vals = [c.c1, c.c2].filter(Boolean);
    const shift = shiftTypes[shiftKey] || {};

    for (const val of vals) {
      if (val === 'day-off') return true;
      if (val === 'no-morning'  && shiftKey === shiftKeys[0]) return true;
      if (val === 'no-evening'  && shiftKey === shiftKeys[shiftKeys.length - 1]) return true;
      // Dynamic: if constraint value is "no-{shiftName}" check shift name
      if (val.startsWith('no-') && shift.name && val === `no-${shift.name.toLowerCase()}`) return true;
    }
    return false;
  }

  // Check if employee WANTS a specific shift (positive constraint)
  function wantsShift(empKey, dayKey, shiftKey) {
    const c = getConstraints(empKey, dayKey);
    const vals = [c.c1, c.c2].filter(Boolean);
    const shift = shiftTypes[shiftKey] || {};

    for (const val of vals) {
      if (val === `want-${shift.name?.toLowerCase()}`) return true;
      if (val === 'want-morning' && shiftKey === shiftKeys[0]) return true;
      if (val === 'want-evening' && shiftKey === shiftKeys[shiftKeys.length - 1]) return true;
    }
    return false;
  }

  // Track how many shifts each employee gets (for fairness)
  const empShiftCount = {};
  for (const empKey of Object.keys(employees)) {
    empShiftCount[empKey] = 0;
  }

  // =============================================
  // MAIN SCHEDULING LOOP (per-department staffing rules)
  // =============================================
  const staffingRules = settings.staffingRules || {};
  const weekKey = settings.weekKey || null;

  function getScopeForDayIndex(dayIndex) {
    // If weekKey provided: decide by actual weekday (Sun..Sat)
    if (weekKey) {
      const base = new Date(weekKey);
      if (!isNaN(base.getTime())) {
        const dt = new Date(base);
        dt.setDate(dt.getDate() + dayIndex);
        const dow = dt.getDay(); // 0=Sun ... 5=Fri ... 6=Sat
        if (dow === 5) return 'friday';
        if (dow === 6) return 'saturday';
        return 'weekday'; // Sun-Thu
      }
    }
    // Fallback (no dates): treat last 2 days as Fri/Sat when workDays>=6/7
    if (workDays >= 7) return (dayIndex === 5 ? 'friday' : dayIndex === 6 ? 'saturday' : 'weekday');
    if (workDays === 6) return (dayIndex === 4 ? 'friday' : 'weekday');
    return 'weekday';
  }

  function autoDeptRequirements(empCount) {
    // Default behavior if manager didn't define staffing rules yet.
    // 1 employee  => first shift
    // 2 employees => first + last
    // 3+         => first + middle + last (if exists) otherwise first + last
    const req = {};
    if (empCount <= 0) return req;
    if (empCount === 1) {
      req[shiftKeys[0]] = 1;
      return req;
    }
    if (empCount === 2) {
      req[shiftKeys[0]] = 1;
      req[shiftKeys[shiftKeys.length - 1]] = 1;
      return req;
    }
    // 3+
    req[shiftKeys[0]] = 1;
    if (shiftKeys.length >= 3) {
      // "middle" = the second shift in order (manager controls ordering)
      req[shiftKeys[1]] = 1;
    }
    req[shiftKeys[shiftKeys.length - 1]] = 1;
    return req;
  }

  for (let d = 0; d < workDays; d++) {
    const dayKey = `day_${d}`;
    const scope = getScopeForDayIndex(d);
    const scopeRules = staffingRules[scope] || {};

    // Process department by department
    for (const [deptKey, dept] of Object.entries(departments)) {
      const emps = deptEmployees[deptKey] || [];
      if (emps.length === 0) continue;

      // Required slots per shift for this department
      const deptRule = scopeRules[deptKey] || {};
      let required = {};
      if (deptRule && Object.keys(deptRule).length > 0) {
        // keep only valid shift keys
        for (const [shiftKey, val] of Object.entries(deptRule)) {
          const n = parseInt(val);
          if (shiftTypes[shiftKey] && Number.isFinite(n) && n > 0) required[shiftKey] = n;
        }
      } else {
        required = autoDeptRequirements(emps.length);
      }

      // If no requirements, everyone off for the day
      if (Object.keys(required).length === 0) {
        for (const empKey of emps) result[dayKey][empKey] = null;
        continue;
      }

      // Sort employees: prefer those with fewer shifts assigned (fairness)
      const sorted = [...emps].sort((a, b) => empShiftCount[a] - empShiftCount[b]);
      const unassigned = new Set(sorted);

      // Assign per shiftKey required count:
      for (const shiftKey of Object.keys(required)) {
        let need = required[shiftKey];

        // Pass 1: wants
        for (const empKey of sorted) {
          if (need <= 0) break;
          if (!unassigned.has(empKey)) continue;
          if (wantsShift(empKey, dayKey, shiftKey) && !isBlocked(empKey, dayKey, shiftKey)) {
            result[dayKey][empKey] = shiftKey;
            empShiftCount[empKey]++;
            unassigned.delete(empKey);
            need--;
          }
        }

        // Pass 2: any available
        for (const empKey of sorted) {
          if (need <= 0) break;
          if (!unassigned.has(empKey)) continue;
          if (!isBlocked(empKey, dayKey, shiftKey)) {
            result[dayKey][empKey] = shiftKey;
            empShiftCount[empKey]++;
            unassigned.delete(empKey);
            need--;
          }
        }
      }

      // Any remaining employees in department are day off / not scheduled
      for (const empKey of sorted) {
        if (result[dayKey][empKey] === undefined) {
          result[dayKey][empKey] = null;
        }
      }
    }

    // Also mark employees not in any dept (optional): day off
    for (const empKey of Object.keys(employees)) {
      if (empDept[empKey] === null && result[dayKey][empKey] === undefined) {
        result[dayKey][empKey] = null;
      }
    }
  }

  return result;
}

window.generateSchedule = generateSchedule;
