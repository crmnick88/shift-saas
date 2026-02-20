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
  // MAIN SCHEDULING LOOP
  // =============================================
  for (let d = 0; d < workDays; d++) {
    const dayKey = `day_${d}`;

    // Process department by department
    for (const [deptKey, dept] of Object.entries(departments)) {
      const emps = deptEmployees[deptKey] || [];
      if (emps.length === 0) continue;

      
      const minRaw = parseInt(dept.min);
      const maxRaw = parseInt(dept.max);

      const deptMin = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 0;
      const deptMax = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : emps.length;

      // Sort employees: prefer those with fewer shifts assigned (fairness)
      const sorted = [...emps].sort((a, b) => empShiftCount[a] - empShiftCount[b]);

      // First pass: assign "want" preferences
      for (const empKey of sorted) {
        for (const shiftKey of shiftKeys) {
          if (wantsShift(empKey, dayKey, shiftKey) && !isBlocked(empKey, dayKey, shiftKey)) {
            result[dayKey][empKey] = shiftKey;
            empShiftCount[empKey]++;
            break;
          }
        }
      }

      // Second pass: fill remaining employees to meet minimum
      let assignedInDept = sorted.filter(e => result[dayKey][e]).length;

      for (const empKey of sorted) {
        if (result[dayKey][empKey]) continue; // already assigned
        if (assignedInDept >= deptMax) break;

        // Find first non-blocked shift
        let assigned = false;
        for (const shiftKey of shiftKeys) {
          if (!isBlocked(empKey, dayKey, shiftKey)) {
            result[dayKey][empKey] = shiftKey;
            empShiftCount[empKey]++;
            assignedInDept++;
            assigned = true;
            break;
          }
        }

        // If all shifts blocked → day off
        if (!assigned) {
          result[dayKey][empKey] = null; // day off
        }
      }

      // Mark rest as day off
      for (const empKey of sorted) {
        if (result[dayKey][empKey] === undefined) {
          result[dayKey][empKey] = null;
        }
      }
    }
  }

  return result;
}

window.generateSchedule = generateSchedule;
