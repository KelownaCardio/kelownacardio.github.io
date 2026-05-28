// 04_billing.js — Modifier logic, BC stat holidays,
//                 CCU consolidation, directive weekly limit
// ═══════════════════════════════════════════════════════

// ── BC Statutory Holidays ──────────────────────────────
function easterDate(y) {
  var a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4,
      f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3),
      h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4,
      l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
      mo=Math.floor((h+l-7*m+114)/31), da=((h+l-7*m+114)%31)+1;
  return new Date(y, mo-1, da);
}

function bcStatHolidays(year) {
  var y = year;
  function nthMon(n, m) { var d=new Date(y,m,1); d.setDate(1+(8-d.getDay())%7+(n-1)*7); return d; }
  // Victoria Day = the Monday STRICTLY BEFORE May 25. Start the search at
  // day-1 so a year where May 25 itself is a Monday (e.g. 2026) correctly
  // rolls back to the prior Monday instead of returning May 25.
  function monBefore(m, day) { var d=new Date(y,m,day-1); while(d.getDay()!==1) d.setDate(d.getDate()-1); return d; }
  var easter = easterDate(y);
  var goodFri = new Date(easter); goodFri.setDate(easter.getDate()-2);
  var easterMon = new Date(easter); easterMon.setDate(easter.getDate()+1);
  return [
    new Date(y,0,1),          // New Year's Day
    nthMon(3,1),              // Family Day — 3rd Monday Feb
    goodFri,                  // Good Friday
    easterMon,                // Easter Monday
    monBefore(4,25),          // Victoria Day — Monday before May 25
    new Date(y,6,1),          // Canada Day
    nthMon(1,7),              // BC Day — 1st Monday Aug
    nthMon(1,8),              // Labour Day — 1st Monday Sep
    new Date(y,8,30),         // National Day for Truth & Reconciliation
    nthMon(2,9),              // Thanksgiving — 2nd Monday Oct
    new Date(y,10,11),        // Remembrance Day
    new Date(y,11,25),        // Christmas Day
    new Date(y,11,26),        // Boxing Day
  ].map(function(d) {
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  });
}

function isBCStat(dateStr) {
  // 'T12:00:00' forces LOCAL-time parsing — a bare ISO date string
  // (YYYY-MM-DD) is otherwise parsed as UTC midnight, which lands on the
  // previous calendar day in Vancouver and shifts the weekday by one.
  var d = new Date(dateStr + 'T12:00:00');
  var key = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  return bcStatHolidays(d.getFullYear()).indexOf(key) !== -1;
}

function isWeekendOrStat(dateStr) {
  if (!dateStr) return false;
  // 'T12:00:00' forces LOCAL-time parsing — see isBCStat note above.
  var d = new Date(dateStr + 'T12:00:00'); var dow = d.getDay();
  return dow === 0 || dow === 6 || isBCStat(dateStr);
}

// ── CCFPP overlap detection (one-directional) ──────────
// CCFPP ("continuing care from a previous patient") applies only to the
// LATER of two overlapping call-out consults. The note is written to that
// later consult's 120x call-out MODIFIER claims — never to the 33010/33012
// consult row itself.
//
// ccfppDetectAndUpdate returns the note for the NEW consult's modifier
// claims when the new consult is the later of the pair. When the new
// consult is instead the EARLIER of the pair, the peer is the later one,
// so its existing 120x modifier claims are retroactively annotated and
// the function returns '' (new consult gets nothing).
//
// Triggers ONLY when:
//   1. The new 33010/33012 consult falls in a modifier (call-out) window
//   2. An existing same-doctor 33010/33012 consult also has a modifier
//   3. The two [start,end] intervals overlap (including cross-midnight)
// NOT applicable to 1411/1421/1431 CCU codes.
//
// newP        — the new patient object (must have first/last/phn)
// alias       — performing physician alias
// dateISO     — new consult's date (YYYY-MM-DD)
// dateFmt     — new consult's date (DD/MM/YYYY)
// startStr    — new consult's HH:MM start
// endStr      — new consult's HH:MM end

// True when two patient records almost certainly describe the same
// person — same surname (case-insensitive) and same date of birth.
// Used to stop CCFPP from linking a patient to a duplicate of itself
// (e.g. "Marie Ehman" and "Marie Kathleen Ehman" entered as two rows).
function ccfppSamePerson_(a, b) {
  var aLast = String((a && a.last) || '').trim().toLowerCase();
  var bLast = String((b && b.last) || '').trim().toLowerCase();
  if (!aLast || aLast !== bLast) return false;
  var aDob = String((a && a.dob) || '').replace(/\D/g, '');
  var bDob = String((b && b.dob) || '').replace(/\D/g, '');
  if (!aDob || !bDob) return false;      // missing DOB — do not block
  return aDob === bDob;
}

// 120x call-out modifier fee codes — CCFPP notes attach ONLY to these.
var CCFPP_MODIFIER_FEES = ['1200','1201','1202','1205','1206','1207'];

// Shared peer classifier — PURE, no side effects. Returns the overlapping
// peers split by who starts later, plus the prev/next date strings, or
// null when CCFPP cannot apply (no times, or not in a modifier window).
function _ccfppClassifyPeers(newP, alias, dateISO, dateFmt, startStr, endStr) {
  if (!startStr || !endStr) return null;
  if (!getModifier(startStr, dateISO)) return null;

  var thisStartM = t2m(startStr);
  var thisEndM   = t2m(endStr);
  if (thisEndM < thisStartM) thisEndM += 1440; // new consult crosses midnight

  var _curDateD  = parseDMY(dateFmt);
  var _prevDateD = new Date(_curDateD.getTime() - 86400000);
  var _nextDateD = new Date(_curDateD.getTime() + 86400000);
  var prevDateFmt = pad(_prevDateD.getDate()) + '/' + pad(_prevDateD.getMonth() + 1) + '/' + _prevDateD.getFullYear();
  var nextDateFmt = pad(_nextDateD.getDate()) + '/' + pad(_nextDateD.getMonth() + 1) + '/' + _nextDateD.getFullYear();

  var newIsSecond = [];  // peer PHNs where the NEW consult starts later
  var newIsFirst  = [];  // peer PHNs where the PEER starts later

  for (var _i = 0; _i < st.claims.length; _i++) {
    var c = st.claims[_i];
    if (c.alias !== alias) continue;
    if (c.phn   === newP.phn) continue;
    if (c.fee !== '33010' && c.fee !== '33012') continue;
    if (!c.startTime || !c.endTime) continue;

    var _isSame = c.date === dateFmt;
    var _isPrev = c.date === prevDateFmt;
    var _isNext = c.date === nextDateFmt;
    if (!_isSame && !_isPrev && !_isNext) continue;

    var prevStartM = t2m(c.startTime);
    var prevEndM   = t2m(c.endTime);
    if (prevEndM < prevStartM) prevEndM += 1440;

    if (_isPrev) {
      if (prevEndM <= 1440) continue;
      prevStartM -= 1440;
      prevEndM   -= 1440;
    } else if (_isNext) {
      if (thisEndM <= 1440) continue;
      prevStartM += 1440;
      prevEndM   += 1440;
    }

    var _prevRefD = parseDMY(c.date);
    var _prevISO  = _prevRefD.getFullYear() + '-' + pad(_prevRefD.getMonth() + 1) + '-' + pad(_prevRefD.getDate());
    if (!getModifier(c.startTime, _prevISO)) continue;

    var _peerPat = (st.patients || []).find(function(pp){ return pp.phn === c.phn; }) || {};
    if (ccfppSamePerson_(newP, _peerPat)) continue;

    if (thisStartM < prevEndM && prevStartM < thisEndM) {
      if (thisStartM >= prevStartM) {
        if (newIsSecond.indexOf(c.phn) === -1) newIsSecond.push(c.phn);
      } else {
        if (newIsFirst.indexOf(c.phn) === -1) newIsFirst.push(c.phn);
      }
    }
  }
  return {
    newIsSecond: newIsSecond, newIsFirst: newIsFirst,
    dateFmt: dateFmt, prevDateFmt: prevDateFmt, nextDateFmt: nextDateFmt
  };
}

// Format a patient's name as "Last, First" for CCFPP notes.
function _ccfppName(p) {
  var last  = String((p && p.last)  || '').trim();
  var first = String((p && p.first) || '').trim();
  return last ? (last + (first ? ', ' + first : '')) : (first || '(unknown)');
}

// Build the CCFPP note for a set of peer PHNs — one entry per peer.
function _ccfppNoteFor(peerPhns) {
  return peerPhns.map(function(peerPhn) {
    var pat = (st.patients || []).find(function(pp) { return pp.phn === peerPhn; }) || {};
    return 'CCFPP: ' + _ccfppName(pat) + ' (' + peerPhn + ')';
  }).join(' | ');
}

// PURE preview — the CCFPP note the NEW consult would carry on its 120x
// modifier claims if submitted now. No mutation; safe to call on every
// keystroke for the live consult-form field.
function ccfppPreviewNote(newP, alias, dateISO, dateFmt, startStr, endStr) {
  var cls = _ccfppClassifyPeers(newP, alias, dateISO, dateFmt, startStr, endStr);
  if (!cls || !cls.newIsSecond.length) return '';
  return _ccfppNoteFor(cls.newIsSecond);
}

// Detection + retroactive peer update — called at submit time.
function ccfppDetectAndUpdate(newP, alias, dateISO, dateFmt, startStr, endStr) {
  var cls = _ccfppClassifyPeers(newP, alias, dateISO, dateFmt, startStr, endStr);
  if (!cls) return '';

  // RETROACTIVE: the PEER starts later — annotate its existing 120x
  // modifier claims only (never the 33010/33012 consult).
  if (cls.newIsFirst.length) {
    var reverseNote = 'CCFPP: ' + _ccfppName(newP) + ' (' + (newP.phn || '—') + ')';
    var dateMatches = [cls.dateFmt, cls.prevDateFmt, cls.nextDateFmt];
    cls.newIsFirst.forEach(function(peerPhn) {
      st.claims.forEach(function(c) {
        if (c.phn   !== peerPhn) return;
        if (c.alias !== alias)   return;
        if (dateMatches.indexOf(c.date) === -1) return;
        if (CCFPP_MODIFIER_FEES.indexOf(c.fee) === -1) return;
        var existing = c.notes || '';
        if (existing.indexOf(reverseNote) !== -1) return; // idempotent
        c.notes = existing ? existing + ' | ' + reverseNote : reverseNote;
        if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) push('saveClaim', c);
      });
    });
    sv('claims', st.claims);
  }

  // FORWARD: the NEW consult starts later — return the note for its own
  // 120x modifier claims.
  return cls.newIsSecond.length ? _ccfppNoteFor(cls.newIsSecond) : '';
}

// ── Call-out Modifier Detection ────────────────────────
// Priority order per MSP rules:
//   1. Night (23:00–07:59) — time check
//   2. Weekend / stat holiday — entire day, any time
//   3. Evening (18:00–22:59) — time check
// Returns null or { type, base, inc, label, cls }
function getModifier(timeStr, dateStr) {
  if (!dateStr) return null;
  var mins = -1;
  if (timeStr) {
    var parts = timeStr.split(':');
    mins = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
  }
  if (mins >= 0 && (mins >= 23*60 || mins < 8*60))
    return { type:'night',   base:'1201', inc:'1206', label:'Night call (23:00–07:59)',   cls:'mod-night'   };
  if (isWeekendOrStat(dateStr))
    return { type:'weekend', base:'1202', inc:'1207', label:'Weekend / stat holiday',     cls:'mod-weekend' };
  if (mins >= 0 && mins >= 18*60)
    return { type:'evening', base:'1200', inc:'1205', label:'Evening call (18:00–22:59)', cls:'mod-evening' };
  return null;
}

// Modifier for an increment period — starts at startTime + 30 min
// (tier may differ from the base if consult crosses 23:00)
function getModifierForIncrement(startTimeStr, dateStr) {
  if (!startTimeStr) return null;
  var base = t2m(startTimeStr);
  var incStart = (base + 30) % (24 * 60);
  var incTime  = minsToTime(incStart);
  return getModifier(incTime, dateStr);
}

// Does the consult qualify for an increment?
// Increment is billable if end time > start + 45 min
// (= at least 15 min into the 30-min period after the 30-min base)
function consultHasIncrement(startTimeStr, endTimeStr) {
  if (!startTimeStr || !endTimeStr) return false;
  var startM = t2m(startTimeStr);
  var endM   = t2m(endTimeStr);
  if (endM < startM) endM += 24 * 60;
  return (endM - startM) >= 45;
}

// How many increment units? Each unit = one 30-min period (or major portion)
// after the base 30 min. Billable after 15 min into each period.
// e.g. duration 46-75 min = 1 unit, 76-105 min = 2 units, etc.
function consultIncUnits(startTimeStr, endTimeStr) {
  if (!startTimeStr || !endTimeStr) return 0;
  var startM = t2m(startTimeStr);
  var endM   = t2m(endTimeStr);
  if (endM < startM) endM += 24 * 60;
  var dur = endM - startM;
  if (dur < 45) return 0;
  // Period N is billable when duration >= 15 + N*30
  // e.g. period 1: dur>=45, period 2: dur>=75, period 3: dur>=105
  var units = 0;
  for (var n = 1; n <= 10; n++) {
    if (dur >= 15 + n * 30) units = n;
    else break;
  }
  return units;
}

// ── Directive Weekly Limit (Sun–Sat) ───────────────────
// Returns number of 33006 claims already billed in the Sun–Sat week that
// contains isoDate (YYYY-MM-DD). If isoDate is omitted, uses today.
// Pass the claim's own date so historical entries are checked against the
// correct week instead of the current week.
function dirCountThisWeek(phn, isoDate) {
  var ref = (isoDate ? parseISODate(isoDate) : null) || new Date();
  var dayOfWeek = ref.getDay(); // 0=Sun
  var weekStart = new Date(ref);
  weekStart.setDate(ref.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return st.claims.filter(function(c) {
    if (c.phn !== phn || c.fee !== '33006') return false;
    var p = c.date.split('/');
    if (p.length !== 3) return false;
    var cd = parseDMYsafe(c.date) ? new Date(parseDMYsafe(c.date)) : new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
    return cd >= weekStart && cd <= weekEnd;
  }).length;
}



// Returns the correct CCU fee code for a given date based on consecutive
// episode length ending at that date.
//   Day 1 of episode → 1411 | Days 2–7 → 1421 | Days 8+ → 1431
// Episode resets on any gap > 1 calendar day in CCU claims.
// dateStr is DD/MM/YYYY (Sheet storage format). Defaults to TODAY.
// v3.59: generalized from ccuFeeForToday; CCU_DAILY is now a deprecated tag
// (still recognized in history scan so existing rows don't break banding logic).
function ccuFeeForDate(p, dateStr) {
  var CCU_FEES = ['CCU_DAILY','1411','1421','1431'];
  var DAY_MS   = 86400000;
  var targetMs = parseDMYsafe(dateStr || TODAY);
  if (!targetMs) return '1411';
  var taps = st.claims
    .filter(function(c) { return samePhn(c.phn, p.phn) && CCU_FEES.indexOf(c.fee) !== -1; });
  if (!taps.length) return '1411';
  var dateMsSet = {};
  taps.forEach(function(c) {
    var ms = parseDMYsafe(c.date);
    // Only count days STRICTLY before the target — we're computing the
    // band FOR the target date, so it doesn't count itself.
    if (ms && ms < targetMs) dateMsSet[ms] = true;
  });
  var consec = 0;
  var checkMs = targetMs - DAY_MS;
  while (dateMsSet[checkMs]) { consec++; checkMs -= DAY_MS; }
  var dayNum = consec + 1;
  if (dayNum === 1) return '1411';
  if (dayNum <= 7)  return '1421';
  return '1431';
}

// Backward-compat wrapper — TODAY band for patient p.
function ccuFeeForToday(p) { return ccuFeeForDate(p, TODAY); }

// ── Add Claim Helper ───────────────────────────────────
function addClaim(p, fee, feeCode, units, date, loc, startTime, notes, endTime, performingAlias, overrides) {
  // overrides: optional { icd, refby, refbyName } — per-claim diagnosis /
  // referring MD that ride on THIS claim row only. They never modify the
  // patient record. When absent, the claim inherits the patient's values.
  overrides = overrides || {};
  // v3.60: CCU_DAILY is the canonical placeholder for CCU days. The
  // Apps Script ccuConsolidateForExport() groups them by patient+alias,
  // segments into consecutive episodes, and emits properly-banded
  // 1411/1421/1431 rows with units at export time. So we DELIBERATELY
  // do not re-band CCU_DAILY at write time anymore — the per-day band
  // is meaningless until consolidation runs. Reverts the v3.59 guard.
  // Guard: never write an MRP service string into refby/refbyName
  if (looksLikeMRPService(p.refbyName)) {
    p.refbyName = '';
    p.refby     = '';
  }
  // Inherit refby/icd from patient's prior claims if currently blank
  var _patUpdated = false;
  if (!p.refby || !p.refbyName || !p.icd) {
    var inherited = inheritRefAndDxFromHistory(p);
    if (!p.refby     && inherited.refby)     { p.refby     = inherited.refby;     _patUpdated = true; }
    if (!p.refbyName && inherited.refbyName) { p.refbyName = inherited.refbyName; _patUpdated = true; }
    if (!p.icd       && inherited.icd)       { p.icd       = inherited.icd;       _patUpdated = true; }
  }
  // Start time only for consults (33010/33012) and emergency visits (33005)
  var _start = startTime || '';
  var c = {
    id:        'c' + Date.now() + Math.floor(Math.random() * 9999),
    alias:     performingAlias || st.doc.alias,
    last:      p.last  || '',
    first:     p.first || '',
    phn:       p.phn,
    fee:       fee,
    icd:       (overrides.icd != null && overrides.icd !== '') ? overrides.icd : (p.icd || '3062'),
    units:     units || 1,
    date:      date,
    refby:     (overrides.refby     != null && overrides.refby     !== '') ? overrides.refby     : (p.refby     || ''),
    refbyName: (overrides.refbyName != null && overrides.refbyName !== '') ? overrides.refbyName : (p.refbyName || ''),
    notes:     notes       || '',
    startTime: _start,
    endTime:   endTime || '',
    createdBy: (st.doc && st.doc.alias) || '',
    createdAt: Date.now()
  };
  // Dedup guard: never create two claims with same phn+date+fee+alias
  var _dupCheck = st.claims.some(function(x) {
    return samePhn(x.phn, c.phn) && x.date === c.date &&
           x.fee === c.fee && x.alias === c.alias &&
           x.id  !== c.id;
  });
  if (_dupCheck) {
    console.warn('Duplicate claim blocked:', c.fee, c.date, c.phn);
    return c; // return without saving
  }
  st.claims.push(c);
  if (SHEETS_URL) push('saveClaim', c);
  // If we back-filled refby/icd onto the patient object, persist to Sheets
  if (_patUpdated) {
    var realP = st.patients.find(function(x) { return x.id === p.id; });
    if (realP) {
      if (!realP.refby     && p.refby)     realP.refby     = p.refby;
      if (!realP.refbyName && p.refbyName) realP.refbyName = p.refbyName;
      if (!realP.icd       && p.icd)       realP.icd       = p.icd;
      if (SHEETS_URL) push('savePatient', realP);
    }
  }
  return c;
}

// ── Log Change ─────────────────────────────────────────
function logChange(p, action, detail) {
  var entry = {
    patName: (p.last || '') + (p.first ? ', ' + p.first : ''),
    phn:     p.phn || '',
    action:  action,
    detail:  detail || '',
    doctor:  st.doc ? st.doc.alias : '—',
    ts:      new Date().toLocaleString('en-CA', {
      hour12:false, year:'2-digit', month:'2-digit',
      day:'2-digit', hour:'2-digit', minute:'2-digit'
    })
  };
  st.changelog.unshift(entry);
  if (st.changelog.length > 200) st.changelog = st.changelog.slice(0, 200);
  sv('changelog', st.changelog);
  if (SHEETS_URL) push('logChange', entry);
}

// Normalise Sheets boolean strings ('True'/'False') to real JS booleans
function parseBool(v) {
  if (v === true  || v === 1) return true;
  if (v === false || v === 0) return false;
  if (v === null || v === undefined || v === '') return false;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

// Parse dischargedAt to epoch ms regardless of whether Sheets returned
// a number, an ISO string, or a Date-formatted string.
function parseDischargedAt(v) {
  if (!v && v !== 0) return 0;
  if (typeof v === 'number') return v;
  // ISO string: "2026-05-06T21:39:57.176Z" or "2026-05-06T21:39:57Z"
  var n = Number(new Date(String(v)));
  if (!isNaN(n) && n > 1000000000000) return n; // sanity: must be after year 2001
  // Plain number stored as string: "1778078397176" or "1778702261108.0"
  var direct = parseFloat(String(v));
  if (!isNaN(direct) && direct > 1000000000000) return Math.round(direct);
  return 0;
}

// Returns true if any claim exists for this patient today from any doctor.
// Drives the green card tint — claim-based, syncs across all devices.
// Type-safe PHN equality. Sheets returns PHN as either string or number depending
// on how the row was written, so === would silently fail for cross-type comparisons.
function samePhn(a, b) {
  if (a == null || b == null || a === '' || b === '') return false;
  return String(a) === String(b);
}

function claimedToday(p) {
  if (!p || !p.phn) return false;
  var pPhn = String(p.phn);
  return st.claims.some(function(c) {
    return String(c.phn || '') === pPhn && fmtClaimDate(c.date) === TODAY;
  });
}

// Returns true if any claim of the given fee types exists today from ANY doctor.
// Used to drive quick-tap button done-state across devices.
function claimedTodayFee(p, feeTypes) {
  if (!p || !p.phn) return false;
  var pPhn = String(p.phn);
  return st.claims.some(function(c) {
    return String(c.phn || '') === pPhn && fmtClaimDate(c.date) === TODAY && feeTypes.indexOf(c.fee) !== -1;
  });
}

// ── 05_render.js ──
// ═══════════════════════════════════════════════════════
// 05_render.js — Render rounds list (geo + alpha + off service)
// ═══════════════════════════════════════════════════════

// Returns a small chart/summary button for a patient id
// Pencil edit button
function pencilBtn(pid) {
  return '<button class="row-icon-btn" data-pid="' + pid + '" title="Edit patient" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
         '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
         '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
}

// Clipboard (claim history) button
function chartBtn(pid) {
  return '<button class="row-icon-btn" data-pid="' + pid + '" title="Claim history" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
         '<svg viewBox="0 0 24 24">' +
           '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>' +
           '<rect x="9" y="3" width="6" height="4" rx="1"/>' +
           '<line x1="9" y1="12" x2="15" y2="12"/>' +
           '<line x1="9" y1="16" x2="13" y2="16"/>' +
         '</svg></button>';
}

// Discharge button
function dischBtn(pid) {
  return '<button class="row-icon-btn row-icon-disch" data-pid="' + pid + '" title="Discharge" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
         '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>' +
         '<polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>';
}

// Right-side icon column for every patient row
function rowIcons(pid) {
  return '<div class="row-icons">' + pencilBtn(pid) + chartBtn(pid) + dischBtn(pid) + '</div>';
}

// Dispatch function — avoids inline quote issues
function rowIconAction(btn, action) {
  var pid = btn.getAttribute('data-pid');
  if (action === 'edit')    openPatientEdit(pid);
  if (action === 'summary') openPatientSummary(pid);
  if (action === 'disch')   openDischModal(pid);
}

function wardAvCls(ward) {
  if (ward === 'CCU')  return 'av-ccu';
  if (ward === '2S')   return 'av-2s';
  if (ward === '2W')   return 'av-2w';
  return 'av-on';
}

function roleChip(p) {
  if (p.role === 'mrp') {
    return '<span class="chip chip-blue">Cardiology MRP</span>';
  }
  // Consultant — show who the MRP is if known
  var mrpLabel = p.mrp && p.mrp !== 'Other' ? p.mrp + ' MRP' : 'Consultant';
  var cls = p.care === 'directive' ? 'chip-amber' : p.care === 'combined' ? 'chip-teal' : 'chip-grey';
  return '<span class="chip ' + cls + '">' + mrpLabel + '</span>';
}

function render() {
  TODAY = todayStr(); // refresh in case app was open past midnight
  if (!st.loaded) return;
  updateDailyTotal();
  var all = st.patients.filter(function(p) { return !p.discharged; });
  var on  = all.filter(function(p) { return p.list === 'on';  }).length;
  var off = all.filter(function(p) { return p.list === 'off'; }).length;

  // Update tab counts
  var onCount  = document.getElementById('ls-on-count');
  var offCount = document.getElementById('ls-off-count');
  if (onCount)  onCount.textContent  = on  ? '(' + on  + ')' : '';
  if (offCount) offCount.textContent = off ? '(' + off + ')' : '';

  // Search overrides list selection — show unified results across On + Off Service
  if (_roundsQuery) {
    renderRoundsSearch();
    return;
  }

  // Not searching: hide search-view, show appropriate list view
  var searchView = document.getElementById('search-view');
  var onView     = document.getElementById('on-view');
  var offView    = document.getElementById('off-view');
  if (searchView) searchView.style.display = 'none';
  if (onView)     onView.style.display     = (_listView === 'on')  ? 'block' : 'none';
  if (offView)    offView.style.display    = (_listView === 'off') ? 'block' : 'none';

  if (_listView === 'on') {
    if (_geoView === 'geo') renderGeo();
    else renderAlpha();
  } else {
    renderOff();
  }
}

// Unified search view across both On and Off Service lists
function renderRoundsSearch() {
  var searchView = document.getElementById('search-view');
  var onView     = document.getElementById('on-view');
  var offView    = document.getElementById('off-view');
  if (searchView) searchView.style.display = 'block';
  if (onView)     onView.style.display     = 'none';
  if (offView)    offView.style.display    = 'none';

  var matches = st.patients
    .filter(function(p) {
      if (p.discharged) return false;
      var name = (p.last + ' ' + p.first).toLowerCase();
      return name.indexOf(_roundsQuery) !== -1 || (p.phn || '').indexOf(_roundsQuery) !== -1;
    })
    .sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });

  if (!matches.length) {
    searchView.innerHTML = '<div class="empty" style="padding:24px 0">No active patients matching &ldquo;' + esc(_roundsQuery) + '&rdquo;</div>';
    return;
  }

  // Group by list for clarity
  var onMatches  = matches.filter(function(p) { return p.list === 'on';  });
  var offMatches = matches.filter(function(p) { return p.list === 'off'; });

  var html = '';
  if (onMatches.length) {
    html += '<div class="sec-lbl">On Service (' + onMatches.length + ')</div>';
    html += safeRowMap(onMatches, alphaRow);
  }
  if (offMatches.length) {
    html += '<div class="sec-lbl" style="margin-top:10px">Off Service (' + offMatches.length + ')</div>';
    html += safeRowMap(offMatches, alphaRow);
  }
  searchView.innerHTML = html;
}

// Safe row mapper: wraps each renderer in try/catch so one bad row
// can't kill the whole list. Returns a placeholder for failing rows.
function safeRowMap(arr, renderFn) {
  return arr.map(function(p) {
    try { return renderFn(p); }
    catch (e) {
      console.error('[row render] failed for', p, e);
      return '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' +
        esc(String(p && p.last || '?')) + ', ' + esc(String(p && p.first || '?')) + '</div>';
    }
  }).join('');
}

// statBox removed — counts now shown in tab labels
var _offView = 'alpha'; // 'alpha' | 'location' — off-service view toggle

// ── Geographic view ────────────────────────────────────
function renderGeo() {
  var h = otherLocationsHtml() + wardHtml('CCU') + wardHtml('2S') + wardHtml('2W');
  document.getElementById('geo-view').innerHTML = h;
}

// v4.09: Safety net — on-service patients on wards outside CCU/2S/2W
// were previously invisible. renderGeo only renders those three wards,
// and the off-service list filters by p.list === 'off', so an on-service
// patient on ED/3E/3W/ICU/CSICU/etc. fell into a blind spot — visible only
// to whoever opened the alphabetical view or searched. This block lists
// them above CCU when any exist and is suppressed when empty.
function otherLocationsHtml() {
  var pts = st.patients.filter(function(p) {
    return p.list === 'on' && !p.discharged &&
           p.ward !== 'CCU' && p.ward !== '2S' && p.ward !== '2W';
  });
  if (!pts.length) return '';
  pts = pts.slice().sort(function(a, b) {
    var wa = String(a.ward || ''), wb = String(b.ward || '');
    if (wa !== wb) return wa.localeCompare(wb);
    return String(a.last || '').localeCompare(String(b.last || ''));
  });
  return '<div class="ward-block" style="border-left:3px solid var(--amber-t)">' +
    '<div class="ward-hdr">' +
      '<div class="ward-lbl">\u26A0 Other Locations (' + pts.length + ')</div>' +
    '</div>' +
    '<div style="padding:0 12px 8px;font-size:11px;color:var(--text3);line-height:1.4">' +
      'On-service patients outside CCU / 2S / 2W \u2014 verify each location is correct.' +
    '</div>' +
    safeRowMap(pts, alphaRow) +
    '</div>';
}

function wardHtml(ward) {
  var pts   = st.patients.filter(function(p) { return p.ward === ward && p.list === 'on' && !p.discharged; });
  var wdef  = WARDS[ward] || {};
  var isCCU = ward === 'CCU';
  var isWard = ward === '2S' || ward === '2W';

  var wardCls = ward === 'CCU' ? 'ward-block-ccu' : ward === '2S' ? 'ward-block-2s' : ward === '2W' ? 'ward-block-2w' : '';
  var h = '<div class="ward-block ' + wardCls + '">' +
    '<div class="ward-hdr">' +
      '<div class="ward-lbl">' + wdef.label + '</div>' +
    '</div>';

  // Sort beds in ascending order.
  // Normalise by stripping trailing single letter suffix for numeric comparison
  // so 217A and 217 sort together, 225A before 225B.
  function _bedKey(bed) {
    var s = String(bed || '').trim();
    // Extract leading number and optional letter suffix: "225A" -> [225, "A"]
    var m = s.match(/^(\d+)([A-Za-z]?)(.*)$/);
    if (m) return [parseInt(m[1], 10), m[2].toUpperCase(), m[3]];
    // CCU single digits 1-8
    var n = parseInt(s, 10);
    if (!isNaN(n)) return [n, '', ''];
    // Hallway / non-numeric — sort last
    return [99999, s, ''];
  }
  pts = pts.slice().sort(function(a, b) {
    var ak = _bedKey(a.bed), bk = _bedKey(b.bed);
    if (ak[0] !== bk[0]) return ak[0] - bk[0];
    if (ak[1] !== bk[1]) return ak[1] < bk[1] ? -1 : 1;
    return ak[2].localeCompare(bk[2]);
  });

  if (!pts.length) {
    h += '<div class="empty">No patients on ' + wdef.label + '</div>';
  } else {
    h += '<div class="ward-list">';
    pts.forEach(function(p, i) {
      try {
        var dn  = claimedToday(p);
        // Circle label: bed # for CCU, room # for 2S/2W, index for others
        var pos = isCCU  ? (p.bed || (i+1))
                : isWard ? (p.bed || (i+1))
                :          (i+1);
        h += '<div class="wp' + (dn ? ' done' : '') + '">' +
             '<div class="wp-pos-wrap">' +
               '<div class="wp-pos' + (dn ? ' done' : '') + '" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' + esc(String(pos)) + '</div>' +
             '</div>' +
             '<div class="wp-main">' +
               '<div class="wp-name-row">' +
                 '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' +
                   esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) +
                 '</span>' +
                 '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')" title="Edit">' +
                   '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                 '</button>' +
               '</div>' +
               '<div class="wp-meta">' + calcAgeGender(p) + ' &bull; ' + mrpLabel(p) + '</div>' +
               '<div class="wp-acts">' +
                 wardActBtns(p) +
                 '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
               '</div>' +
             '</div>' +
             '<div class="wp-side-btns">' +
               '<button class="side-btn side-btn-hx" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
                 '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>' +
                 '<span>Claim Hx</span>' +
               '</button>' +
               '<button class="side-btn side-btn-dc" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
                 '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
                 '<span>D/C</span>' +
               '</button>' +
             '</div>' +
             '</div>';
      } catch (e) {
        console.error('[wardHtml] failed for', p, e);
        h += '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' +
             esc(String(p && p.last || '?')) + ', ' + esc(String(p && p.first || '?')) + '</div>';
      }
    });
    h += '</div>';
  }

  var notYet = pts.filter(function(p) { return !claimedToday(p); }).length;
  if (isCCU) {
    h += '<button class="batch-btn" style="margin-top:8px" onclick="batchRoundWard(this)" data-ward="' + ward + '">' +
         '<span>Round all ' + wdef.label + (notYet ? ' (' + notYet + ' pending)' : ' \u2713 all done') + '</span>' +
         '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
         '</button>';
  }

  return h + '</div>';
}

// ── Alphabetical view ──────────────────────────────────
function renderAlpha() {
  var on = st.patients
    .filter(function(p) { return p.list === 'on' && !p.discharged; })
    .sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });
  document.getElementById('alpha-view').innerHTML =
    on.length ? safeRowMap(on, alphaRow) : '<div class="empty">No on-service patients.</div>';
}

// ── Off service view ───────────────────────────────────
var _offView = 'alpha'; // 'alpha' | 'location'

function setOffView(v) {
  _offView = v;
  renderOff();
}

function renderOff() {
  var off = st.patients.filter(function(p) { return p.list === 'off' && !p.discharged; });

  var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<div class="ward-lbl">Off Service</div></div>';

  // View toggle — named functions avoid inline quote issues
  var onAlpha = _offView === 'alpha'    ? ' on' : '';
  var onLoc   = _offView === 'location' ? ' on' : '';
  h += '<div class="view-tog" style="margin-bottom:10px">' +
    '<button class="vt' + onAlpha + '" onclick="setOffViewAlpha()">' +
      '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>Alphabetical</button>' +
    '<button class="vt' + onLoc + '" onclick="setOffViewLoc()">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>By location</button>' +
    '</div>';

  if (!off.length) {
    h += '<div class="empty">No off-service patients.</div>';
    document.getElementById('off-list').innerHTML = h;
    return;
  }

  if (_offView === 'alpha') {
    var sorted = off.slice().sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });
    h += safeRowMap(sorted, offRow);
  } else {
    // By location: clinical priority — ED, ICU, CSICU, then numbered wards.
    // Within numbered wards: A/B together, then E/W together.
    function _wardSortKey(w) {
      if (!w) return [99, '', ''];
      if (w === 'ED') return [0, '', ''];
      if (w === 'ICUA' || w === 'ICUB' || w === 'ICUD') return [1, w.slice(3), ''];
      if (w === 'CSICU') return [2, '', ''];
      var m = w.match(/^(\d+)([A-Z]+)?$/);
      if (m) {
        var floor = parseInt(m[1], 10);
        var suffix = m[2] || '';
        var grp = (suffix === 'A' || suffix === 'B') ? 0
                : (suffix === 'E' || suffix === 'W') ? 1 : 2;
        return [10 + floor, grp, suffix];
      }
      return [90, w, ''];
    }
    var sorted = off.slice().sort(function(a, b) {
      var ka = _wardSortKey(a.ward), kb = _wardSortKey(b.ward);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
      if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
      return String(a.last || "").localeCompare(String(b.last || ""));
    });
    var curWard = null;
    sorted.forEach(function(p) {
      if (p.ward !== curWard) {
        curWard = p.ward;
        h += '<div style="font-size:10px;font-weight:700;color:var(--text3);' +
             'text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px">' +
             wardLabel(p.ward) + '</div>';
      }
      h += offRow(p);
    });
  }

  document.getElementById('off-list').innerHTML = h;
}

// Find the most recent claim for this patient by any cardiologist in the group.
// Returns chip HTML like "Last seen by KB May 1" or empty string if never billed.
function lastSeenByGroup(p) {
  if (!p.phn) return '';
  var newest = null;
  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (c.phn !== p.phn) continue;
    if (!c.date) continue;
    var t = parseDMYsafe(c.date);
    if (!t) continue;
    if (!newest || t > newest.t) newest = { t: t, claim: c };
  }
  if (!newest) return '';

  var d = new Date(newest.t);
  var monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var label = monthsShort[d.getMonth()] + ' ' + d.getDate();
  var alias = newest.claim.alias || '?';

  // Days since — thresholds tied to directive care intervals (2/week ~= every 3-4 days)
  var days = Math.floor((Date.now() - newest.t) / 86400000);
  var color, weight;
  if (days > 5) {
    color = 'var(--red-t)';     weight = '700';   // overdue
  } else if (days >= 3) {
    color = 'var(--amber-t)';   weight = '700';   // approaching limit
  } else {
    color = 'var(--text3)';     weight = '500';   // recent (<= 2 days)
  }

  return '<span style="font-size:10px;color:' + color + ';font-weight:' + weight +
    ';margin-left:2px;white-space:nowrap">Last seen by ' + esc(alias) + ' ' + label + '</span>';
}

// Age + sex only, e.g. "72M" or "—"  (used on off-service row 3)
function ageGenderShort(p) {
  if (!p.dob) return p.sex || '—';
  var dobClean = fmtClaimDate(p.dob);
  var parts = dobClean.split('/');
  if (parts.length !== 3) return p.sex || '—';
  var dob = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
  var now = new Date();
  var yr  = now.getFullYear() - dob.getFullYear();
  var mo  = now.getMonth()    - dob.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < dob.getDate())) yr--;
  if (isNaN(yr) || yr < 0 || yr > 130) return p.sex || '—';
  return yr + (p.sex || '');
}

// Single off-service patient row
function offRow(p) {
  var dn       = claimedToday(p);
  // Circle shows ward abbreviation for off-service
  var wardAbbr = String(wardLabel(p.ward) || '').replace('Ward ', '').replace('ICU ', 'IC').slice(0, 5);
  // Row 2: room number (prominent) + last-seen chip
  var roomStr  = p.bed ? esc(String(p.bed)) : (esc(wardLabel(p.ward) || '—'));
  var lastSeen = lastSeenByGroup(p);
  // Row 3: Age (Sex) · MRP · Dx
  var ageSex   = ageGenderShort(p);
  var row3     = esc(ageSex) + ' &bull; ' + mrpLabel(p) + lastBilledChip(p);
  return '<div class="alpha-row' + (dn ? ' done' : '') + '">' +
    '<div class="alpha-av av-off" style="font-size:9px;font-weight:800;letter-spacing:-.3px" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' + esc(wardAbbr) + '</div>' +
    '<div class="wp-main">' +
      '<div class="wp-name-row">' +
        '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' + esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) + '</span>' +
        '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
          '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:baseline;gap:7px;margin-top:1px;margin-bottom:2px">' +
        '<span style="font-size:11px;font-weight:700;color:var(--text2)">' + roomStr + '</span>' +
        lastSeen +
      '</div>' +
      '<div class="wp-meta">' + row3 + '</div>' +
      '<div class="wp-acts">' + quickActBtns(p) +
        '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
      '</div>' +
    '</div>' +
    '<div class="wp-side-btns">' +
      '<button class="side-btn side-btn-hx" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
        '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>' +
        '<span>Claim Hx</span>' +
      '</button>' +
      '<button class="side-btn side-btn-dc" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
        '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        '<span>D/C</span>' +
      '</button>' +
    '</div>' +
    '</div>';
}

// Age in years + sex from patient record, e.g. "72F", "55M", "—"
function calcAgeGender(p) {
  var age = '';
  if (p.dob) {
    // Normalise DOB defensively in case it wasn't caught on load/sync
    var dobClean = fmtClaimDate(p.dob);
    var parts = dobClean.split('/');
    if (parts.length === 3) {
      var dob = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
      var now = new Date();
      var yr  = now.getFullYear() - dob.getFullYear();
      var mo  = now.getMonth() - dob.getMonth();
      if (mo < 0 || (mo === 0 && now.getDate() < dob.getDate())) yr--;
      if (!isNaN(yr) && yr >= 0 && yr < 130) age = String(yr);
    }
  }
  // Format: AgeGender  e.g. "77M"  (DOB removed — age+gender already shown)
  var ageGender = (age + (p.sex || '')) || '';
  return ageGender || '—';
}

function alphaRow(p) {
  var dn      = claimedToday(p);
  var avCls   = wardAvCls(p.ward);
  // Circle shows ward abbreviation (same as off-service)
  var wardAbbr = String(wardLabel(p.ward) || '').replace('Ward ', '').replace('ICU ', 'IC').slice(0, 5);
  return '<div class="alpha-row' + (dn ? ' done' : '') + '">' +
    '<div class="alpha-av ' + avCls + '" style="font-size:9px;font-weight:800;letter-spacing:-.3px" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' + esc(wardAbbr) + '</div>' +
    '<div class="wp-main">' +
      '<div class="wp-name-row">' +
        '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' + esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) +
          (p.bed ? ' <span style="font-size:10px;color:var(--text3)">Rm </span><span style="font-size:10px;font-weight:700;color:var(--text2)">' + esc(String(p.bed)) + '</span>' : '') +
        '</span>' +
        '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
          '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="wp-meta">' + calcAgeGender(p) + ' &bull; ' + mrpLabel(p) + lastBilledChip(p) + '</div>' +
      '<div class="wp-acts">' + quickActBtns(p) +
        '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
      '</div>' +
    '</div>' +
    '<div class="wp-side-btns">' +
      '<button class="side-btn side-btn-hx" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
        '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>' +
        '<span>Claim Hx</span>' +
      '</button>' +
      '<button class="side-btn side-btn-dc" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
        '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        '<span>D/C</span>' +
      '</button>' +
    '</div>' +
    '</div>';
}

// Quick action buttons shown on each patient card
// MRP label for patient meta line — replaces PHN tail
function mrpLabel(p) {
  if (p.role === 'mrp') return 'MRP: Cardiology';
  if (p.mrp && p.mrp !== 'Other') return 'MRP: ' + p.mrp;
  return 'Consulting';
}

// One-tap buttons for ward rows based on role + MRP
// - Cardiology MRP   → + Daily
// - CCU/ICU MRP      → + CCU daily
// - Consulting       → + Directive  + Combined daily
function wardActBtns(p) {
  if (showsCCUDaily(p)) {
    var ccuDone = claimedTodayFee(p, ['CCU_DAILY','1411','1421','1431']);
    return ccuDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickCCUBtn(this)" title="Tap to undo">✓ CCU daily</button>'
      : '<button class="bb bb-ccu" data-pid="' + p.id + '" onclick="event.stopPropagation();quickCCUBtn(this)">+ CCU daily</button>';
  }
  if (p.role === 'mrp') {
    var dailyDone = claimedTodayFee(p, ['33008']);
    return dailyDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)" title="Tap to undo">✓ Daily</button>'
      : '<button class="bb bb-rnd" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)">+ Daily</button>';
  }
  // Consulting
  var dirDone  = claimedTodayFee(p, ['33006']);
  var combDone = claimedTodayFee(p, ['33008']);
  return (dirDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDirectiveBtn(this)" title="Tap to undo">✓ Directive</button>'
      : '<button class="bb bb-dir" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDirectiveBtn(this)">+ Directive</button>') +
    (combDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)" title="Tap to undo">✓ Combined daily</button>'
      : '<button class="bb bb-comb" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)">+ Combined daily</button>');
}

function showsCCUDaily(p) {
  // CCU daily only when Cardiology is MRP — consulting cardiologists get Directive/Combined daily
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (icuWards.indexOf(p.ward) === -1) return false;
  return p.role === 'mrp';
}

// Instantly style a quick-tap button as done (dark green ✓) before render().
// This gives immediate visual feedback without waiting for DOM re-render.
function bbDone(btn, label) {
  btn.className = 'bb bb-done';
  btn.textContent = '✓ ' + label;
  btn.disabled = true;
}

function quickActBtns(p) {
  // Alpha and off-service views reuse same role logic as ward rows
  return wardActBtns(p);
}
// ── Batch round ────────────────────────────────────────
function batchRound(ward) {
  if (!checkDoc()) return;
  var pts = st.patients.filter(function(p) {
    return p.ward === ward && p.list === 'on' && !claimedToday(p);
  });
  if (!pts.length) { showToast('All ' + wardLabel(ward) + ' patients already rounded'); return; }
  pts.forEach(function(p) {
    // v3.60: CCU_DAILY placeholder for CCU ward. Export-time consolidation
    // assigns the correct 1411/1421/1431 band based on episode position.
    var fee = ward === 'CCU' ? 'CCU_DAILY' : '33008';
    addClaim(p, fee, fee, 1, TODAY, 'I');
  });
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('Rounded ' + pts.length + ' on ' + ward + ' — tap any to adjust');
  render();
}

// ── Reorder ward patients ──────────────────────────────
function reorder(ward, pid, dir) {
  var wPts = st.patients.filter(function(p) { return p.ward === ward && p.list === 'on'; });
  var idx  = wPts.findIndex(function(p) { return p.id === pid; });
  var nIdx = idx + dir;
  if (nIdx < 0 || nIdx >= wPts.length) return;
  var gA = st.patients.indexOf(wPts[idx]);
  var gB = st.patients.indexOf(wPts[nIdx]);
  var tmp = st.patients[gA]; st.patients[gA] = st.patients[gB]; st.patients[gB] = tmp;
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatients', { patients: st.patients });
  render();
}

// ── Quick one-tap claims ───────────────────────────────
// quickClaim replaced by data-pid button handlers


// quickCCU replaced by data-pid button handlers


// ── One-tap billing handlers (use data-pid, no inline quote issues) ──

function alreadyBilledToday(pid, feeTypes) {
  var p = getP(pid);
  if (!st.doc) return false;
  return st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) &&
           c.alias === st.doc.alias &&
           c.date === TODAY &&
           feeTypes.indexOf(c.fee) !== -1;
  });
}

// Remove today's claim for this patient+fee — returns true if removed
function unbillToday(pid, feeTypes) {
  var p = getP(pid);
  if (!st.doc) return false;
  var idx = -1;
  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (samePhn(c.phn, p.phn) && c.alias === st.doc.alias &&
        c.date === TODAY && feeTypes.indexOf(c.fee) !== -1) {
      idx = i; break;
    }
  }
  if (idx === -1) return false;
  var removed = st.claims.splice(idx, 1)[0];
  if (SHEETS_URL) push('deleteClaim', { id: removed.id });
  var stillHasClaims = st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) && c.alias === st.doc.alias && c.date === TODAY;
  });
  if (!stillHasClaims) {
    p.lastBilled   = null;
  } else {
    p.lastBilled = null;
  }
  sv('patients', st.patients);
  sv('claims', st.claims);
  return true;
}

// ── Required-field guard ────────────────────────────────
// Per MSP rules: every claim needs a referring MD and a diagnosis.
// If a patient is missing either, the quick-tap shortcut routes them
// into the full claim form with the missing fields highlighted as required.
function needsRefAndDx(p) {
  var missing = [];
  if (!p) return missing;
  if (!p.refby || !p.refbyName) missing.push('refby');
  if (!p.icd) missing.push('icd');
  return missing;
}

// Open full claim screen with the chosen claim type pre-selected and
// missing required fields flagged. Used by quick-tap shortcuts when
// the patient is missing required referring MD or diagnosis.
function openClaimWithRequiredFields(pid, claimType) {
  _requiredFieldsPending = needsRefAndDx(getP(pid));
  openClaimScreen(pid);
  setTimeout(function() {
    selCT(claimType);
    setTimeout(highlightMissingFields, 50);
  }, 50);
}

function highlightMissingFields() {
  if (!_requiredFieldsPending || !_requiredFieldsPending.length) return;
  var bodyEl = document.getElementById('claim-body');
  if (!bodyEl) return;

  // Banner at top of claim body
  var banner = document.getElementById('required-field-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'required-field-banner';
    banner.style.cssText = 'background:var(--amber-bg);color:var(--amber-t);' +
      'padding:10px 12px;border-radius:var(--rsm);font-size:12px;font-weight:700;' +
      'margin-bottom:10px;border:.5px solid var(--amber-t)';
    var msgs = [];
    if (_requiredFieldsPending.indexOf('refby') !== -1) msgs.push('referring MD');
    if (_requiredFieldsPending.indexOf('icd') !== -1) msgs.push('diagnosis (ICD-9)');
    banner.textContent = 'Required for billing: please add ' + msgs.join(' and ') + ' before saving.';
    bodyEl.insertBefore(banner, bodyEl.firstChild);
  }

  // Highlight any matching ref/icd search inputs in the form
  ['cb-ref-search','ce-ref-search','pe-ref-search','oc-ref-search'].forEach(function(id) {
    if (_requiredFieldsPending.indexOf('refby') !== -1) {
      var el = document.getElementById(id);
      if (el) el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
    }
  });
  ['cb-icd-search','ce-icd-search','pe-icd-search','oc-icd-search'].forEach(function(id) {
    if (_requiredFieldsPending.indexOf('icd') !== -1) {
      var el = document.getElementById(id);
      if (el) el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
    }
  });
}

var _requiredFieldsPending = [];

// Validate a patient has required fields BEFORE adding any claim.
// Returns true if OK to proceed, false if missing fields (caller should NOT submit).
// Shows a toast naming what's missing.
function validateRequiredForClaim(p) {
  var missing = needsRefAndDx(p);
  if (!missing.length) return true;
  var labels = [];
  if (missing.indexOf('refby') !== -1) labels.push('referring MD');
  if (missing.indexOf('icd')   !== -1) labels.push('diagnosis');
  showToast('Missing ' + labels.join(' & ') + ' - required for billing');
  return false;
}

function quickDailyBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed — toggle off (undo)
  if (alreadyBilledToday(pid, ['33008'])) {
    if (unbillToday(pid, ['33008'])) {
      showToast('Daily removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  if (alreadyBilledToday(pid, ['CCU_DAILY','1411','1421','1431','33006'])) {
    showToast('A different visit already claimed today');
    return;
  }
  // Required field check — open full form if missing
  var p0 = getP(pid);
  if (needsRefAndDx(p0).length) {
    var t = p0.care === 'combined' ? 'combined' : 'daily';
    openClaimWithRequiredFields(pid, t);
    return;
  }
  var p = getP(pid);
  if (p.care === 'combined') {
    // First combined daily for this patient — need reason on file
    if (!p.combinedDailyReason) {
      openCombinedReasonModal(pid, function() {
        // After reason saved, fire the quick claim
        var p2 = getP(pid);
        bbDone(btn, 'Combined daily');
        addClaim(p2, '33008', '33008', 1, TODAY, 'I', null, p2.combinedDailyReason || '');
        p2.lastBilled = 'Combined daily';
        sv('patients', st.patients); sv('claims', st.claims);
        showToast('✓ Combined daily — ' + p2.last);
        requestAnimationFrame(render);
      });
      return;
    }
    bbDone(btn, 'Combined daily');
    addClaim(p, '33008', '33008', 1, TODAY, 'I', null, p.combinedDailyReason || '');
    p.lastBilled = 'Combined daily';
    sv('patients', st.patients); sv('claims', st.claims);
    showToast('✓ Combined daily — ' + p.last);
    requestAnimationFrame(render);
    return;
  }
  var label = 'Daily';
  bbDone(btn, label);
  addClaim(p, '33008', '33008', 1, TODAY, 'I');
  p.lastBilled   = label;
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ ' + label + ' — ' + p.last);
  requestAnimationFrame(render);
}

function quickDirectiveBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed today — toggle off (undo), same as daily/CCU
  if (alreadyBilledToday(pid, ['33006'])) {
    if (unbillToday(pid, ['33006'])) {
      showToast('Directive removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  // Hard limit: 2 directives per week, no exceptions
  var cnt = dirCountThisWeek(getP(pid).phn);
  if (cnt >= 2) {
    showToast('2 directive visits already claimed this week');
    openPatientSummary(pid);
    return;
  }
  // Required field check — open full form if missing
  if (needsRefAndDx(getP(pid)).length) {
    openClaimWithRequiredFields(pid, 'directive');
    return;
  }
  var p = getP(pid);
  bbDone(btn, 'Directive');
  addClaim(p, '33006', '33006', 1, TODAY, 'I');
  p.lastBilled   = 'Directive';
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ Directive — ' + p.last);
  requestAnimationFrame(render);
}

function quickCCUBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed — toggle off (undo)
  if (alreadyBilledToday(pid, ['CCU_DAILY','1411','1421','1431'])) {
    if (unbillToday(pid, ['CCU_DAILY','1411','1421','1431'])) {
      showToast('CCU daily removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  if (alreadyBilledToday(pid, ['33008','33006'])) {
    showToast('A different visit already claimed today');
    return;
  }
  // Required field check — open full form if missing
  if (needsRefAndDx(getP(pid)).length) {
    openClaimWithRequiredFields(pid, 'ccu');
    return;
  }
  var p   = getP(pid);
  // v3.60: write CCU_DAILY placeholder; export consolidates to 1411/1421/1431
  // based on consecutive episode position. The user-facing label stays
  // friendly ("CCU day") since the per-day band isn't meaningful until export.
  var fee = 'CCU_DAILY';
  bbDone(btn, 'CCU day');
  addClaim(p, fee, fee, 1, TODAY, 'I');
  p.lastBilled   = 'CCU day';
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ CCU day — ' + p.last);
  requestAnimationFrame(render);
}

// Show what was last billed as a chip on the done card
function lastBilledChip(p) {
  if (!p.lastBilled || !claimedToday(p)) return '';
  return '<span class="chip chip-green" style="font-size:9px;padding:1px 6px">' + esc(p.lastBilled) + '</span>';
}

// Named wrappers for data-ward buttons (avoid inline quote issues)
function batchRoundWard(btn) { batchRound(btn.getAttribute('data-ward')); }
function openAddWard(btn)    { openAdd(btn.getAttribute('data-ward')); }

function wpAddClaim(btn) {
  openClaimScreen(btn.getAttribute('data-pid'));
}

// ── 06_claim_screen.js ──
// ═══════════════════════════════════════════════════════
// 06_claim_screen.js — Tap-patient claim screen controller
// ═══════════════════════════════════════════════════════

function _openClaimScreen(pid) {
  _claimPid = pid;
  _incUnits = 1;
  _mostOn   = true;
  // Default: opened directly from a list — do not reopen the summary.
  // ptSummaryAddClaim sets this flag again *after* calling us.
  _claimReturnSummaryPid = null;

  var p = getP(pid);

  // Context bar at top — with pencil edit icon
  document.getElementById('claim-ctx').innerHTML =
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div class="claim-ctx-name">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
        '<div class="claim-ctx-meta">' +
          wardLabel(p.ward) + (p.bed ? ' Rm ' + p.bed : '') +
          ' &bull; ' + mrpLabel(p) +
          (!p.phn ? ' &bull; <span style="color:var(--amber-t);font-weight:700">⚠ no PHN</span>' : '') +
        '</div>' +
      '</div>' +
      '<button class="ctx-edit-btn" data-pid="' + p.id + '" onclick="ctxEditBtn(this)" title="Edit patient">' +
        '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
        '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      '</button>' +
    '</div>';

  // Claim type buttons
  document.getElementById('claim-type-sel').innerHTML = buildTypeButtons(p);

  // Patient action buttons — Change location + Discharge, sit below claim form
  document.getElementById('claim-pt-actions').innerHTML =
    '<button class="btn" style="flex:1;margin:0;background:var(--teal-bg);color:var(--teal-t);' +
    'border:.5px solid var(--teal-t)" onclick="openLocScreen(\'' + p.id + '\')">Change location</button>' +
    '<button class="btn" style="flex:1;margin:0;background:var(--red-bg);color:var(--red-t);' +
    'border:.5px solid var(--red-t)" onclick="openDischModal(\'' + p.id + '\')">Discharge / transfer</button>';

  // Show claim pane, hide all others
  showPane('p-claim');

  // Default claim type based on location
  var defaultType = p.ward === 'CCU' ? 'ccu' : (p.care || 'daily');
  selCT(defaultType);
}

function buildTypeButtons(p) {
  var isCCU   = p.ward === 'CCU';
  var isOff   = p.list === 'off';
  var types   = [];

  var isMRP = p.role === 'mrp' || p.care === 'daily' || p.care === 'ccu';
  if (showsCCUDaily(p)) {
    // CCU or ICU ward where we are MRP
    types = [
      { id:'ccu',     label:'CCU daily' },
      { id:'consult', label:'Consult (33010/12)' }
    ];
  } else if (isMRP) {
    // Ward MRP — daily rounds, no directive
    types = [
      { id:'daily',   label:'Daily rounds' },
      { id:'consult', label:'Consult (33010/12)' }
    ];
  } else {
    // Consultant role
    types = [
      { id:'consult',  label:'Consult (33010/12)' },
      { id:'directive',label:'Directive visit' },
      { id:'combined', label:'Combined daily' }
    ];
  }

  var h = types.map(function(t) {
    return '<button class="ct-btn" id="ctb-' + t.id + '" onclick="selCT(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');

  // Other claim spans full width
  h += '<button class="ct-btn" id="ctb-other" style="grid-column:1/-1;color:var(--blue-t);border-color:var(--blue-bg)" ' +
       'onclick="selCT(\'other\')">+ Other claim type</button>';

  return h;
}

function feeSearch(query) {
  var dd = document.getElementById('oc-fee-dd');
  if (!dd) return;
  var q = (query || '').toLowerCase().trim();

  // 33010 / 33012 are entered via the consult card, not the Other form.
  // 33005 (emergency visit) and 33014 (counselling) stay available here.
  var isConsultCardCode = function(f) { return f.code === '33010' || f.code === '33012'; };
  var matches = q.length === 0
    ? FEES.filter(function(f) { return f.cat !== 'Modifier' && f.cat !== 'CCU' && !isConsultCardCode(f); }).slice(0, 20)
    : FEES.filter(function(f) {
        if (isConsultCardCode(f)) return false;
        return f.code.toLowerCase().indexOf(q) !== -1 ||
               f.desc.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 15);

  if (!matches.length) {
    dd.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text2)">No matching fee codes</div>';
    dd.style.display = 'block';
    return;
  }

  var catColors = {
    'Consult':'var(--blue-t)',    'Daily':'var(--blue-t)',     'Directive':'var(--amber-t)',
    'Telehealth':'var(--blue-t)', 'ECG':'var(--teal-t)',       'Stress':'var(--teal-t)',
    'Echo':'var(--teal-t)',       'Pacemaker':'var(--teal-t)', 'Remote':'var(--teal-t)',
    'Event':'var(--teal-t)',      'Procedure':'var(--red-t)',  'Rehab':'var(--green-t)',
    'Discharge':'var(--green-t)', 'CCU':'var(--red-t)',        'Modifier':'var(--text3)',
    'Other':'var(--teal-t)'
  };

  dd.innerHTML = matches.map(function(f) {
    var col = catColors[f.cat] || 'var(--text2)';
    var amt = f.amount ? '<span style="font-size:11px;font-weight:700;color:var(--text2);margin-left:auto;padding-left:8px">' + esc(f.amount) + '</span>' : '';
    return '<div class="ref-dd-row" data-code="' + esc(f.code) + '" data-desc="' + esc(f.desc) + '" ' +
      'onclick="selectFeeCode(this.getAttribute(\'data-code\'),this.getAttribute(\'data-desc\'))" ' +
      'style="display:flex;align-items:center;gap:4px">' +
      '<span style="font-weight:700;color:' + col + ';margin-right:6px;min-width:50px">' + esc(f.code) + '</span>' +
      '<span style="flex:1;min-width:0">' + esc(f.desc) + '</span>' +
      (f.cat && f.cat !== 'Consult' ? '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + esc(f.cat) + '</span>' : '') +
      amt +
      '</div>';
  }).join('');
  dd.style.display = 'block';
}

function selectFeeCode(code, desc) {
  var inp = document.getElementById('oc-fee');
  if (inp) inp.value = code;
  var search = document.getElementById('oc-fee-search');
  if (search) search.value = desc + ' (' + code + ')';
  var disp = document.getElementById('oc-fee-display');
  if (disp) disp.textContent = '';
  var dd = document.getElementById('oc-fee-dd');
  if (dd) dd.style.display = 'none';
  var endWrap = document.getElementById('oc-end-wrap');
  var notesEl = document.getElementById('oc-notes');
  var startLbl = document.getElementById('oc-start-lbl');
  if (code === '33005') {
    if (endWrap)  endWrap.style.display = 'block';
    if (startLbl) startLbl.innerHTML = 'Start time <span style="color:var(--red-t)">*</span>';
    if (notesEl) {
      notesEl.placeholder = 'Describe emergency care provided (mandatory by MSP)';
      notesEl.style.cssText = 'border:1.5px solid var(--amber-t)';
      notesEl.setAttribute('data-required', '1');
    }
  } else {
    if (endWrap)  endWrap.style.display = 'none';
    if (startLbl) startLbl.innerHTML = 'Start time <span style="font-size:10px;color:var(--text3)">(if required)</span>';
    if (notesEl) {
      notesEl.placeholder = 'Optional';
      notesEl.style.cssText = '';
      notesEl.removeAttribute('data-required');
    }
  }
  updateOtherPreview();
}

function buildOtherClaimForm(p, opts) {
  var withSubmit = !opts || opts.withSubmit !== false;
  var now      = new Date();
  var todayISO = localISODate(now);
  var nowTime  = pad(now.getHours()) + ':' + pad(now.getMinutes());

  // Pre-fill ICD and referring MD from patient record
  var curDx  = DIAGNOSES.find(function(d) { return String(d.code) === String(p.icd || ''); });
  var icdVal = curDx ? curDx.label : (p.icd || '');
  var refVal = p.refbyName || '';
  var refNum = p.refby     || '';

  var h = '<div class="card">';
  h += '<div class="card-title">Other claim</div>';

  // Fee code search
  h += '<label>Fee code</label>';
  h += '<input id="oc-fee-search" placeholder="Search by description or code number..." ' +
       'autocorrect="off" autocapitalize="none" ' +
       'oninput="feeSearch(this.value)" onfocus="feeSearch(this.value)">';
  h += '<div class="ref-dd" id="oc-fee-dd"></div>';
  h += '<input id="oc-fee" type="hidden">';
  h += '<div id="oc-fee-display" style="font-size:11px;color:var(--text2);margin-top:-4px;margin-bottom:6px"></div>';

  // Date + start time
  h += '<div class="fl">';
  h +=   '<div class="f1"><label>Date</label>' +
         '<input type="date" id="oc-date" value="' + todayISO + '" oninput="updateOtherPreview()"></div>';
  h +=   '<div class="f1"><label id="oc-start-lbl">Start time <span style="font-size:10px;color:var(--text3)">(if required)</span></label>' +
         '<input type="text" id="oc-start" value="' + nowTime + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>';
  h += '</div>';
  h += '<div id="oc-end-wrap" style="display:none;margin-bottom:6px">' +
       '<label>End time <span style="color:var(--red-t)">*</span></label>' +
       '<input type="text" id="oc-end" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;" style="width:100%;padding:10px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px">' +
       '</div>';

  // Location
  h += '<label>Service location</label>';
  h += '<select id="oc-loc" style="margin-bottom:9px">' +
       '<option value="I" selected>I — Inpatient</option>' +
       '<option value="E">E — Emergency</option>' +
       '<option value="O">O — Outpatient</option>' +
       '</select>';

  h += '</div>'; // end card

  // ICD — pre-filled but editable
  h += '<div class="card">';
  h += '<label>Diagnosis (ICD-9)</label>';
  h += '<div style="position:relative">' +
       '<input id="oc-icd-search" placeholder="Type diagnosis or code..." autocorrect="off" autocomplete="off" style="padding-right:32px" ' +
       'value="' + esc(icdVal) + '" ' +
       'data-dd="oc-icd-dd" data-hidden="oc-icd" ' +
       'oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
       '<button type="button" tabindex="-1" onclick="clearSearchField(\'oc-icd-search\',\'oc-icd\',null,\'oc-icd-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'oc-icd-search\',\'oc-icd\',null,\'oc-icd-dd\')" ' +
       'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
       '</div>';
  h += '<div class="ref-dd" id="oc-icd-dd"></div>';
  h += '<input id="oc-icd" type="hidden" value="' + esc(p.icd || '') + '">';

  // Referring MD — pre-filled but editable
  h += '<label style="margin-top:4px">Referring MD</label>';
  h += '<div style="position:relative">' +
       '<input id="oc-ref-search" placeholder="Type name or doctor #..." autocorrect="off" style="padding-right:32px" ' +
       'value="' + esc(refVal) + '" ' +
       'data-dd="oc-ref-dd" data-hidden="oc-refby" data-name="oc-refby-name" ' +
       'oninput="refSearchEl(this)" onfocus="refSearchEl(this)">' +
       '<button type="button" tabindex="-1" onclick="clearSearchField(\'oc-ref-search\',\'oc-refby\',\'oc-refby-name\',\'oc-ref-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'oc-ref-search\',\'oc-refby\',\'oc-refby-name\',\'oc-ref-dd\')" ' +
       'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
       '</div>';
  h += '<div class="ref-dd" id="oc-ref-dd"></div>';
  h += '<input id="oc-refby"      type="hidden" value="' + esc(refNum) + '">';
  h += '<input id="oc-refby-name" type="hidden" value="' + esc(refVal) + '">';

  // Notes
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional)</span></label>';
  h += '<input id="oc-notes" placeholder="Optional" autocorrect="off">';

  h += buildPerformingPhysSelector();
  h += '</div>';

  // Preview
  h += '<div class="cp" id="oc-preview"><div class="cp-title">Claim preview</div></div>';

  if (withSubmit) {
    h += '<button class="btn btn-p" onclick="claimSubmitOnce(submitOtherClaim)">Add claim</button>';
  }
  return h;
}

function updateOtherPreview() {
  var fee   = ((document.getElementById('oc-fee') || {}).value || '').trim();
  var prev  = document.getElementById('oc-preview');
  if (!prev) return;
  if (!fee) {
    prev.innerHTML = '<div class="cp-title">Search and select a fee code above</div>';
    return;
  }
  var knownFee = FEES.find(function(f) { return f.code === fee; });
  var amt      = knownFee && knownFee.amount ? '<span class="cp-amount" style="margin-left:8px;font-weight:700;color:var(--green-t)">' + esc(knownFee.amount) + '</span>' : '';
  prev.innerHTML = '<div class="cp-title">Claim to add</div>' +
    '<div class="cp-row" style="display:flex;align-items:center;gap:6px">' +
    '<span class="cp-code">' + esc(fee) + '</span>' +
    '<span class="cp-desc" style="flex:1;min-width:0">' + esc(knownFee ? knownFee.desc : 'Custom fee code') + '</span>' +
    amt +
    '</div>';
}

// Shared Other-claim submit — reads the oc-* form, validates 33005, and
// creates the single claim. Used by both the +Claim screen and Add Patient.
// Per-claim ICD / referring-MD ride on the claim only (via pClone); the
// patient's baseline is never rewritten — consistent with the consult form.
// Returns true on success, false if validation blocked the save.
function submitOtherClaimFor(p, alias) {
  var fee     = ((document.getElementById('oc-fee')   || {}).value || '').trim();
  var dateISO = (document.getElementById('oc-date')  || {}).value || '';
  var start   = (document.getElementById('oc-start') || {}).value || '';
  var endTime = (document.getElementById('oc-end')   || {}).value || '';
  var loc     = (document.getElementById('oc-loc')   || {}).value || 'I';
  var notes   = (document.getElementById('oc-notes') || {}).value || '';
  var icd     = (document.getElementById('oc-icd')   || {}).value || p.icd || '3062';
  var refby   = (document.getElementById('oc-refby') || {}).value || p.refby || '';
  var refName = (document.getElementById('oc-refby-name') || {}).value || p.refbyName || '';

  if (!fee)     { showToast('Enter a fee code'); return false; }
  if (!dateISO) { showToast('Enter a date');     return false; }

  // 33005 (emergency visit) — start, end, and a description are mandatory.
  if (fee === '33005') {
    var em = [];
    if (!start)   em.push('start time');
    if (!endTime) em.push('end time');
    if (!notes)   em.push('description of emergency care');
    if (em.length) {
      if (!start)   { var _se = document.getElementById('oc-start'); if (_se) _se.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!endTime) { var _ee = document.getElementById('oc-end');   if (_ee) _ee.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!notes)   { var _ne = document.getElementById('oc-notes'); if (_ne) _ne.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      showToast('Required for 33005: ' + em.join(', '));
      return false;
    }
  }

  var dateFmt = fmtD(parseISODate(dateISO));
  // Units are always 1 for an Other claim.
  var pClone  = Object.assign({}, p, { icd: icd, refby: refby, refbyName: refName });
  addClaim(pClone, fee, fee, 1, dateFmt, loc, start, notes, endTime || '', alias);
  sv('claims', st.claims);
  return true;
}

// +Claim screen wrapper — validates the doctor + required fields, then
// delegates to the shared submit and closes the claim screen.
function submitOtherClaim() {
  var p = getP(_claimPid);
  if (!checkDoc()) return;

  var fee     = ((document.getElementById('oc-fee')   || {}).value || '').trim();
  var icd     = (document.getElementById('oc-icd')   || {}).value || p.icd || '';
  var refby   = (document.getElementById('oc-refby') || {}).value || p.refby || '';
  var refName = (document.getElementById('oc-refby-name') || {}).value || p.refbyName || '';

  // Diagnosis + referring MD must be present.
  var validateP = Object.assign({}, p, { icd: icd, refby: refby, refbyName: refName });
  if (!validateRequiredForClaim(validateP)) { highlightMissingFields(); return; }

  if (!submitOtherClaimFor(p, getPerformingAlias())) return;

  showToast((fee || 'Claim') + ' claim added for ' + p.last);
  closeClaimScreen();
}

function selCT(type) {
  // Highlight selected button
  var clsMap = { consult:'ct-on-consult', daily:'ct-on-daily', combined:'ct-on-combined', directive:'ct-on-directive', ccu:'ct-on-ccu' };
  document.querySelectorAll('.ct-btn').forEach(function(b) {
    Object.values(clsMap).forEach(function(c) { b.classList.remove(c); });
  });
  var btn = document.getElementById('ctb-' + type);
  if (btn) btn.classList.add(clsMap[type] || 'ct-on-daily');

  // Render the appropriate claim form
  var p = getP(_claimPid);
  var html = '';
  if      (type === 'consult')   html = buildConsultForm(p);
  else if (type === 'daily')     html = buildDailyForm(p);
  else if (type === 'combined')  html = buildCombinedForm(p);
  else if (type === 'directive') html = buildDirectiveForm(p);
  else if (type === 'ccu')       html = buildCCUForm(p);
  else if (type === 'other')     html = buildOtherClaimForm(p);
  document.getElementById('claim-body').innerHTML = html;

  // Post-render setup for consult form
  if (type === 'consult') {
    _consultCtx = 'claim';
    consultFormOpened();
  }
}

// Track which pane opened the claim screen so back button returns there
var _claimOriginPane  = 'p0';
var _claimOriginNavIdx = 0;

// When the claim screen was opened from the patient-summary calendar
// ("+ Add claim"), this holds that patient's id so a successful submit
// returns to the calendar instead of the rounds list. Null = normal flow
// (claim screen opened directly from a list — return to that list).
var _claimReturnSummaryPid = null;

function openClaimScreen(pid) {
  // Record which pane we came from so back button returns there
  ALL_PANES.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.classList.contains('on')) {
      _claimOriginPane   = id;
      _claimOriginNavIdx = ['p0','p1','p-discharged'].indexOf(id);
      if (_claimOriginNavIdx < 0) _claimOriginNavIdx = 0;
    }
  });
  _openClaimScreen(pid);
}

function closeClaimScreen() {
  document.getElementById('p-claim').classList.remove('on');
  // Capture and clear the return-to-summary flag before restoring panes.
  var returnPid = _claimReturnSummaryPid;
  _claimReturnSummaryPid = null;
  showPane(_claimOriginPane);
  document.querySelectorAll('.nb').forEach(function(b, i) {
    b.classList.toggle('on', i === _claimOriginNavIdx);
  });
  if (_claimOriginPane === 'p0') render();
  if (_claimOriginPane === 'p-discharged') renderDischarged(document.getElementById('discharged-search').value || '');
  // Opened from the patient-summary calendar — reopen it so the user lands
  // back on the calendar (the summary always opens on the calendar view).
  if (returnPid) openPatientSummary(returnPid);
}

// Explicit "← Back to rounds" exit: cancelling a claim should always return
// to the list, never reopen the patient summary — so clear the flag first.
function backToRoundsFromClaim() {
  _claimReturnSummaryPid = null;
  closeClaimScreen();
}

// ── 06b_discharged.js ──
// ═══════════════════════════════════════════════════════
// Recently Discharged pane + rounds search filter
// Pane shows discharged patients (last 21 days, or all when searching)
// Each row offers: tap to add a missed claim, restore (to On/Off Service)
// ═══════════════════════════════════════════════════════

function roundsSearch(query) {
  _roundsQuery = (query || '').toLowerCase().trim();
  var clearBtn = document.getElementById('rounds-search-clear');
  if (clearBtn) clearBtn.classList.toggle('on', !!_roundsQuery);
  // Hide geo/alpha toggle when searching (search shows unified flat list)
  var vtBar = document.getElementById('view-tog-bar');
  if (vtBar) vtBar.style.display = (!_roundsQuery && _listView === 'on') ? 'flex' : 'none';
  render();
}

function clearRoundsSearch() {
  var input = document.getElementById('rounds-search');
  if (input) { input.value = ''; input.focus(); }
  roundsSearch('');
}

// ═══════════════════════════════════════════════════════
// 06b — Recently Discharged pane
// Single-purpose tab. Reads st.patients (populated by syncFromSheets).
// Shows: discharged && trueDischarge==irrelevant && < 21 days (or all if searching)
// Each row: tap to bill missed claim, or restore to On/Off Service.
// ═══════════════════════════════════════════════════════

function initDischarged() {
  var input = document.getElementById('discharged-search');
  if (input) input.value = '';
  renderDischarged('');
}

function dischargedSearch(query) {
  renderDischarged(query);
}

// Render the discharged pane. Pure function over st.patients.
// Defensive about field types — patients arrive from Sheets with mixed types
// (phn could be string or number, dischargedAt could be number or string, etc.).
function renderDischarged(query) {
  var container = document.getElementById('discharged-results');
  if (!container) return;
  var q = String(query || '').toLowerCase().trim();

  // Filter for discharged patients. Treat any truthy variant as discharged.
  var pool = (st.patients || []).filter(function(p) {
    return isDischarged(p);
  });

  // Sort newest-first by dischargedAt
  pool.sort(function(a, b) {
    return (toEpochMs(b.dischargedAt) || 0) - (toEpochMs(a.dischargedAt) || 0);
  });

  // Apply 21-day filter unless searching
  var cutoff = Date.now() - (21 * 24 * 60 * 60 * 1000);
  var visible = q ? pool : pool.filter(function(p) {
    var ms = toEpochMs(p.dischargedAt);
    return !ms || ms > cutoff;  // missing timestamps still show
  });

  // Apply search query
  if (q) {
    visible = visible.filter(function(p) {
      var name = String((p.last || '') + ' ' + (p.first || '')).toLowerCase();
      var phn  = String(p.phn || '');
      return name.indexOf(q) !== -1 || phn.indexOf(q) !== -1;
    });
  }

  if (!visible.length) {
    container.innerHTML = q
      ? '<div class="empty" style="padding:18px 0">No match for &ldquo;' + esc(query) + '&rdquo;</div>'
      : '<div class="empty" style="padding:18px 0">No patients discharged in the last 21 days.</div>';
    return;
  }

  // Render each row defensively — wrap in try so one bad row doesn't kill the whole list.
  var rows = visible.map(function(p) {
    try { return dischargedRow(p); }
    catch (e) {
      console.error('[discharged] row render failed for', p, e);
      return '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' + esc(p.last || '?') + ', ' + esc(p.first || '?') + '</div>';
    }
  });

  container.innerHTML = rows.join('');
}

// Type-safe truthy check on the discharged flag.
// Sheets returns variants: boolean true, "true", "TRUE", 1, "1", etc.
function isDischarged(p) {
  if (!p) return false;
  var v = p.discharged;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

// Type-safe epoch ms parser. Accepts number, numeric string, or ISO string.
function toEpochMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? v : 0;
  var s = String(v).trim();
  // Numeric string like "1778182118783" or "1778702261108.0"
  var pf = parseFloat(s);
  if (!isNaN(pf) && pf > 1e12) return Math.round(pf);
  // ISO date string
  var d = Date.parse(s);
  return isNaN(d) ? 0 : d;
}

// Render one discharged-patient row. Defensive about every field type.
function dischargedRow(p) {
  var last  = String(p.last  || '');
  var first = String(p.first || '');
  var phn   = String(p.phn   || '');
  var ward  = String(p.ward  || '');
  var bed   = String(p.bed   || '');
  var pid   = String(p.id    || '');

  var isCCU = ward === 'CCU';
  var avCls = isCCU ? 'av-ccu' : (p.list === 'off' ? 'av-off' : 'av-on');
  var ini   = (first.charAt(0) || '') + (last.charAt(0) || '');

  var ms = toEpochMs(p.dischargedAt);
  var daysAgo = ms ? Math.floor((Date.now() - ms) / 86400000) : null;
  var daysLabel = daysAgo === null ? '' : daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : daysAgo + ' days ago';
  var statusChip = '<span class="chip chip-grey">Discharged' + (daysLabel ? ' ' + daysLabel : '') + '</span>';

  var phnDisplay = phn ? 'PHN …' + phn.slice(-4) : '<span class="warn-tag">⚠ no PHN</span>';
  var bedDisplay = bed ? ' Rm ' + esc(bed) : '';

  var careChip = isCCU                    ? '<span class="chip chip-red">CCU</span>'
               : p.care === 'directive'   ? '<span class="chip chip-amber">Directive</span>'
               : p.care === 'combined'    ? '<span class="chip chip-teal">Combined</span>'
               :                             '<span class="chip chip-blue">MRP</span>';

  return '<div class="alpha-row" onclick="openClaimFromDischarged(\'' + esc(pid) + '\')">' +
    '<div class="alpha-av ' + avCls + '">' + esc(ini.toUpperCase()) + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="wp-name">' + esc(last) + ', ' + esc(first) + '</div>' +
      '<div class="wp-meta">' + esc(wardLabel(ward)) + bedDisplay + ' &bull; ' + phnDisplay + '</div>' +
      '<div class="wp-chips" style="margin-top:4px">' + careChip + ' ' + statusChip + '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;padding-top:8px">' +
      '<button class="bb bb-rnd" style="font-size:10px;padding:5px 9px" ' +
        'onclick="event.stopPropagation();restorePatient(\'' + esc(pid) + '\')">↩ Restore</button>' +
      chartBtn(pid) +
    '</div>' +
  '</div>';
}

function openClaimFromDischarged(pid) {
  _claimOriginPane   = 'p-discharged';
  _claimOriginNavIdx = 2;
  _openClaimScreen(pid);
}

// Restore — show on/off service choice using data attributes (no inline quote nesting)
function restorePatient(pid) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p || !isDischarged(p)) return;
  var prevWard = wardLabel(p.ward) || '';
  var prevList = p.list === 'on' ? 'On Service' : 'Off Service';
  var body  = document.getElementById('merge-body');
  var title = document.getElementById('merge-title');
  if (!body || !title) { _doRestore(pid, p.list || 'off'); return; }
  title.textContent = 'Restore ' + p.last + ', ' + p.first;
  body.innerHTML =
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">' +
      'Previously: <strong>' + prevList + '</strong>' +
      (prevWard ? ' — ' + esc(prevWard) : '') +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button class="btn btn-p" style="margin:0" data-pid="' + esc(pid) + '" data-list="on" onclick="_doRestore(this.dataset.pid,this.dataset.list)">Restore to On Service list</button>' +
      '<button class="btn btn-s" style="margin:0" data-pid="' + esc(pid) + '" data-list="off" onclick="_doRestore(this.dataset.pid,this.dataset.list)">Restore to Off Service list</button>' +
    '</div>';
  showModal('merge-modal');
}

function _doRestore(pid, list) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  hideModal('merge-modal');
  p.discharged    = false;
  p.dischargedAt  = null;
  p.dischargeDate = null;
  p.list          = list;
  if (list === 'on' && !p.ward) p.ward = 'OTHER';
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Restored', 'Returned to ' + (list === 'on' ? 'On Service' : 'Off Service'));
  showToast(p.last + ' restored to ' + (list === 'on' ? 'on-service' : 'off-service') + ' list');
  renderDischarged(document.getElementById('discharged-search') ? document.getElementById('discharged-search').value : '');
  render();
}

// ── 06c_patient_summary.js ──
// ═══════════════════════════════════════════════════════
// 06c_patient_summary.js — Patient summary "baseball card"
// Shows patient demographics + all claims chronologically.
// Opens as a bottom sheet modal.
// ═══════════════════════════════════════════════════════

function openPatientSummary(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;
  _cvActiveType = null;  // reset legend pill selection for fresh open
  _cvDocAlias   = null;  // reset calendar performing-doctor to signed-in default

  // All claims for this patient, sorted oldest → newest
  var claims = st.claims
    .filter(function(c) { return c.phn && p.phn && samePhn(c.phn, p.phn); })
    .sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });

  // Also check by name if no PHN match (sticker not yet scanned)
  if (!claims.length || !p.phn) {
    var nameClaims = st.claims.filter(function(c) {
      return samePhn(c.phn, p.phn);
    }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
    if (nameClaims.length > claims.length) claims = nameClaims;
  }

  var html = '';

  // ── Demographics card ────────────────────────────────
  html += '<div style="background:var(--blue-bg);border-radius:var(--r);padding:13px 14px;margin-bottom:13px;border:.5px solid #a8c4e8">';
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between">';
  html +=   '<div>';
  html +=     '<div style="display:flex;align-items:center;gap:7px">' +
              '<div style="font-size:17px;font-weight:800;letter-spacing:-.4px;color:var(--blue-t)">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
              '<button class="summary-pencil-btn" data-pid3="' + p.id + '" onclick="ptSummaryEdit(this)" title="Edit patient">' +
                '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
                '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
              '</button>' +
              '</div>';
  if (p.dob)  html += '<div style="font-size:12px;color:var(--blue-t);opacity:.8;margin-top:2px">DOB ' + esc(dispDate(p.dob)) + (p.sex ? ' &bull; ' + p.sex : '') + '</div>';
  if (p.phn)  html += '<div style="font-size:12px;color:var(--blue-t);opacity:.8;margin-top:1px">PHN ' + esc(p.phn) + '</div>';
  html +=   '</div>';
  // Discharge badge if applicable
  if (p.discharged) {
    var daysAgo = Math.floor((Date.now() - parseDischargedAt(p.dischargedAt)) / 86400000);
    html += '<span class="chip chip-grey" style="margin-top:3px">Discharged ' + (daysAgo === 0 ? 'today' : daysAgo + 'd ago') + '</span>';
  }
  html += '</div>';

  // Location / care row
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
  if (p.consultOnly) html += '<span class="chip chip-blue" style="background:var(--purple-bg,#eeeaf8);color:var(--purple-t,#3b2d6e)">Consult only</span>';
  if (p.ward) html += '<span class="chip chip-blue">' + wardLabel(p.ward) + (p.bed ? ' Rm ' + p.bed : '') + '</span>';
  var careLabel = { daily:'MRP daily', directive:'Directive', combined:'Combined daily', ccu:'CCU daily' };
  if (p.mrp) html += '<div style="font-size:11px;color:var(--blue-t);opacity:.8;margin-top:4px">MRP: ' + esc(p.mrp) + '</div>';
  if (p.care) html += '<span class="chip chip-grey">' + (careLabel[p.care] || p.care) + '</span>';
  if (p.list === 'off') html += '<span class="chip chip-amber">Off service</span>';
  html += '</div>';

  // Referring MD + diagnosis
  if (p.refbyName || p.refby) {
    html += '<div style="font-size:11px;color:var(--blue-t);opacity:.8;margin-top:7px">Referred by ' + esc(p.refbyName || p.refby) + (p.refby ? ' #' + p.refby : '') + '</div>';
  }
  if (p.icd) {
  }
  html += '</div>'; // end demographics card

  // ── Claims section — toggle (Calendar default) + List/Calendar views (v3.27) ─
  var addClaimFn2 = p.discharged ? 'openClaimFromDischarged' : 'openClaimScreen';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">';
  html +=   '<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">' +
            claims.length + ' claim' + (claims.length !== 1 ? 's' : '') + ' on record</div>';
  html +=   '<div style="display:flex;gap:6px">' +
              '<button class="pt-addclaim-btn" data-pid2="' + p.id + '" data-fn2="' + addClaimFn2 + '" onclick="ptSummaryAddClaim(this)">+ Add claim</button>' +
            '</div>';
  html += '</div>';

  // Calendar (90% width, centred) + list below — no toggle
  html += '<div id="cv-view-cal" style="width:90%;margin:0 auto 0">' + _ptSummaryCalendarHTML(p, claims) + '</div>';

  html += '<div id="cv-view-list" style="margin-top:14px">' + _ptSummaryListHTML(p, claims) + '</div>';

  // Close button
  html += '<button class="btn btn-s" style="margin-top:12px;margin-bottom:0" onclick="hideModal(\'pt-summary-modal\')">Close</button>';

  document.getElementById('pt-summary-content').innerHTML = html;
  showModal('pt-summary-modal');

  // Stash the patient id for calendar interactions
  window._cvPid = p.id;
  // Default calendar month: most recent of (today's month, admit month)
  var admitMs = p.admitDate ? parseDMYsafe(p.admitDate) : null;
  var nowD = new Date();
  if (admitMs) {
    var aD = new Date(admitMs);
    // Show month containing today by default; user can navigate back to admit
    window._cvMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  } else {
    window._cvMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// v3.27 — Calendar view of patient claims
// ═════════════════════════════════════════════════════════════════════════

// Switch between list & calendar inside the patient summary modal
function togglePtSummaryView(view) {
  var listEl = document.getElementById('cv-view-list');
  var calEl  = document.getElementById('cv-view-cal');
  var tL = document.getElementById('cv-tog-list');
  var tC = document.getElementById('cv-tog-cal');
  if (!listEl || !calEl) return;
  if (view === 'list') {
    listEl.style.display = '';
    calEl.style.display  = 'none';
    if (tL) tL.classList.add('on');
    if (tC) tC.classList.remove('on');
  } else {
    listEl.style.display = 'none';
    calEl.style.display  = '';
    if (tL) tL.classList.remove('on');
    if (tC) tC.classList.add('on');
  }
}

// ── Existing list rendering — extracted into a helper so it can live in a div ──
function _ptSummaryListHTML(p, claims) {
  if (!claims.length) {
    return '<div class="empty" style="padding:16px 0">No claims recorded yet for this patient.</div>';
  }
  // Group by date for easier reading (oldest → newest, since claims arrive sorted that way)
  var byDate = {};
  var dateOrder = [];
  claims.forEach(function(c) {
    if (!byDate[c.date]) { byDate[c.date] = []; dateOrder.push(c.date); }
    byDate[c.date].push(c);
  });

  var html = '';
  dateOrder.forEach(function(date) {
    var dayClaims = byDate[date];
    html += '<div style="font-size:11px;font-weight:700;color:var(--text2);margin:10px 0 5px;padding-bottom:4px;border-bottom:.5px solid var(--border)">' + dispDate(date) + '</div>';
    dayClaims.forEach(function(c) {
      var feeLabel = getFeeLabel(c.fee);
      var dxLabel  = icdShortLabel(c.icd);
      if (dxLabel.length > 45) dxLabel = dxLabel.slice(0, 42) + '…';
      var isCCU = c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431';
      var feeMeta  = FEES.find(function(f) { return f.code === c.fee; });
      var feeChip  = (isCCU ? 'chip-red' : (feeMeta && feeMeta.clr) || 'chip-grey');

      html += '<div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:.5px solid var(--border)">';
      html +=   '<div style="min-width:52px;flex-shrink:0">';
      html +=     '<span class="' + feeChip + '" style="font-size:11px;font-weight:700;font-family:monospace;padding:2px 6px;border-radius:4px;display:inline-block">' + esc(c.fee === 'CCU_DAILY' ? '1411/21/31' : c.fee) + '</span>';
      if (c.units && c.units > 1) html += '<div style="font-size:9px;color:var(--text3);margin-top:2px">×' + c.units + '</div>';
      html +=   '</div>';
      html +=   '<div style="flex:1;min-width:0">';
      html +=     '<div style="font-size:12px;font-weight:600">' + esc(feeLabel) + '</div>';
      html +=     '<div style="font-size:10px;color:var(--text2);margin-top:2px">' + esc(dxLabel) + '</div>';
      if (c.notes) html += '<div style="font-size:10px;color:var(--amber-t);margin-top:2px;font-style:italic">' + esc(c.notes) + '</div>';
      html +=   '</div>';
      html +=   '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">';
      html +=     '<div style="font-size:10px;color:var(--text3);text-align:right">' + esc(c.alias || '—');
      if (c.startTime) {
        var displayTime = fmtStartTime(c.startTime);
        if (displayTime && displayTime.length <= 5 && !/T|Z|\d{4}-/.test(displayTime)) {
          html += '<div style="margin-top:1px">' + esc(displayTime) + '</div>';
        }
      }
      html +=     '</div>';
      html +=     '<div style="display:flex;gap:4px">';
      html +=       '<button class="claim-action-btn claim-edit-btn" data-cid="' + c.id + '" data-pid="' + p.id + '" onclick="openClaimEdit(this)" title="Edit claim">✎</button>';
      html +=       '<button class="claim-action-btn claim-del-btn"  data-cid="' + c.id + '" data-pid="' + p.id + '" onclick="deleteClaimBtn(this)" title="Delete claim">✕</button>';
      html +=     '</div>';
      html +=   '</div>';
      html += '</div>';
    });
  });
  return html;
}

// ── Calendar view ─────────────────────────────────────────────────────────
// Returns 'ccu' (CCU/ICU ward + MRP role) | 'daily' (MRP role, non-CCU ward) | null
function _cvGapRuleForPatient(p) {
  if (!p) return null;
  if (p.role !== 'mrp' && p.care !== 'daily' && p.care !== 'ccu') return null;
  var ccuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (ccuWards.indexOf(p.ward) !== -1) return 'ccu';
  if (p.role === 'mrp' || p.care === 'daily') return 'daily';
  return null;
}

// Returns { startMs, endMs } — admission span as epoch ms, end = dischargeDate or today
function _cvAdmitSpan(p) {
  if (!p || !p.admitDate) return null;
  var startMs = parseDMYsafe(p.admitDate);
  if (!startMs) return null;
  var endMs;
  if (p.discharged && p.dischargeDate) {
    endMs = parseDMYsafe(p.dischargeDate);
  }
  if (!endMs) {
    // Fall back to today
    var now = new Date();
    endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  return { startMs: startMs, endMs: endMs };
}

// Cell-colour background per claim type — MUST match the .cv-day.cv-<type>
// CSS rules exactly, so a 2-claim diagonal split aligns with the solid cells.
var CV_TYPE_BG = {
  consult:'#ffcf73', ccu:'#f08585', daily:'#3fa658',
  directive:'#8eb5fa', combined:'#b8e6c4'
};

// All distinct claim-colour types present on a day, in priority order
// (consult > ccu > daily > directive > combined). Single classification
// used for both the dominant cell colour and the 2-claim diagonal split.
function _cvDayTypes(dayClaims) {
  if (!dayClaims || !dayClaims.length) return [];
  var has = { consult:false, ccu:false, daily:false, directive:false, combined:false };
  var hasAny = false;
  dayClaims.forEach(function(c) {
    hasAny = true;
    // Consults (full / limited / emergency / prolonged counselling)
    if (c.fee === '33010' || c.fee === '33012' || c.fee === '33005' || c.fee === '33014') has.consult = true;
    // CCU bands (raw tap + days 1 / 2-7 / 8-30 / 31+)
    else if (c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431' || c.fee === '1441') has.ccu = true;
    // Directive visit
    else if (c.fee === '33006') has.directive = true;
    // 33008 is both daily AND combined daily — differentiate by note presence
    // (combined daily care from the calendar always adds an "<icd> — <reason>" note)
    else if (c.fee === '33008') {
      if (c.notes && String(c.notes).trim()) has.combined = true;
      else has.daily = true;
    }
    // Bedside procedures (cardioversion, pericardiocentesis) — consult-coloured.
    else if (c.fee === 'Y33025' || c.fee === '00751') has.consult = true;
    // 78717 (complex discharge) / 78720 (MOST) are extras that piggyback on a
    // regular visit — they fall through to the hasAny fallback below.
  });
  var out = ['consult','ccu','daily','directive','combined'].filter(function(t) { return has[t]; });
  // Fallback — any claim on the day deserves *some* colour so the doctor sees it
  if (!out.length && hasAny) out.push('consult');
  return out;
}

// Single dominant cell-colour key, or null. Priority order per _cvDayTypes.
function _cvDominantType(dayClaims) {
  return _cvDayTypes(dayClaims)[0] || null;
}

// Build the list of gap days (DD/MM/YYYY strings) for a patient
function _cvGapDays(p, claims) {
  var span = _cvAdmitSpan(p);
  var rule = _cvGapRuleForPatient(p);
  if (!span || !rule) return [];
  var DAY_MS = 86400000;
  var todayMs = parseDMYsafe(TODAY);
  // Build a set of claimed days (any visit fee counts as occupying the day)
  var claimedSet = {};
  claims.forEach(function(c) {
    var ms = parseDMYsafe(c.date);
    if (ms) claimedSet[ms] = true;
  });
  var gaps = [];
  // Don't flag today as a gap — doctor may still be rounding
  var endMs = Math.min(span.endMs, todayMs - DAY_MS);
  for (var d = span.startMs; d <= endMs; d += DAY_MS) {
    if (!claimedSet[d]) {
      var dt = new Date(d);
      gaps.push(pad(dt.getDate()) + '/' + pad(dt.getMonth()+1) + '/' + dt.getFullYear());
    }
  }
  return gaps;
}

// CCU fee for a specific date based on consecutive prior CCU days
function _cvCcuFeeForDate(p, dateStr) {
  var CCU_FEES = ['CCU_DAILY','1411','1421','1431'];
  var DAY_MS = 86400000;
  var targetMs = parseDMYsafe(dateStr);
  if (!targetMs) return '1411';
  // Count consecutive CCU days immediately preceding targetMs
  var ccuDateSet = {};
  st.claims.forEach(function(c) {
    if (samePhn(c.phn, p.phn) && CCU_FEES.indexOf(c.fee) !== -1) {
      var ms = parseDMYsafe(c.date);
      if (ms && ms < targetMs) ccuDateSet[ms] = true;
    }
  });
  var consec = 0;
  var checkMs = targetMs - DAY_MS;
  while (ccuDateSet[checkMs]) { consec++; checkMs -= DAY_MS; }
  var dayNum = consec + 1;
  if (dayNum === 1) return '1411';
  if (dayNum <= 7)  return '1421';
  return '1431';
}

// Build calendar HTML
function _ptSummaryCalendarHTML(p, claims) {
  // Index claims by DD/MM/YYYY — normalize each claim's date first since
  // claims that round-trip through Sheets may come back as a Date object or
  // ISO string instead of DD/MM/YYYY (see fmtClaimDate defensive logic).
  var byDate = {};
  claims.forEach(function(c) {
    var dateKey = fmtClaimDate(c.date);  // always DD/MM/YYYY after this
    if (!dateKey) return;
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(c);
  });

  var span = _cvAdmitSpan(p);
  var rule = _cvGapRuleForPatient(p);
  var gaps = _cvGapDays(p, claims);
  var month = window._cvMonth || (function() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  })();

  var monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month.getMonth()];
  var year = month.getFullYear();

  var html = '';

  // Legend — Gap is view-only; Consult opens the consult card; CCU/Daily/
  // Directive/Combined daily are sticky type-selector pills.
  html += '<div class="cv-legend">' +
            '<button class="cv-lg-pill cv-lgp-consult"  id="cv-lgp-consult"  onclick="_cvOpenConsultCard()"><div class="cv-sw" style="background:#ffcf73"></div>Consult</button>' +
            '<button class="cv-lg-pill cv-lgp-ccu"       id="cv-lgp-ccu"       onclick="_cvSelectLegend(\'ccu\',this)"><div class="cv-sw" style="background:#f08585"></div>CCU</button>' +
            '<button class="cv-lg-pill cv-lgp-daily"     id="cv-lgp-daily"     onclick="_cvSelectLegend(\'daily\',this)"><div class="cv-sw" style="background:#3fa658"></div>Daily</button>' +
            '<button class="cv-lg-pill cv-lgp-directive" id="cv-lgp-directive" onclick="_cvSelectLegend(\'directive\',this)"><div class="cv-sw" style="background:#8eb5fa"></div>Directive</button>' +
            '<button class="cv-lg-pill cv-lgp-combined"  id="cv-lgp-combined"  onclick="_cvSelectLegend(\'combined\',this)"><div class="cv-sw" style="background:#b8e6c4"></div>Combined daily</button>' +
            (rule ? '<div class="cv-lg"><div class="cv-sw" style="background:#d4d4d8;border:1px dashed #8a8a92"></div>Gap</div>' : '') +
          '</div>' +
          '<div class="cv-tap-hint" id="cv-tap-hint"></div>';

  // Restore active pill highlight if a type was already selected
  if (window._cvActiveType) {
    var _restoreHint = html; // keep ref; actual DOM restore happens after render via _cvRestoreActivePill()
  }

  // Month nav
  html += '<div style="max-width:420px;margin:0 auto">';  // desktop width cap

  // Performing-doctor selector — applies to claims added by tapping a day
  // (legend-pill quick-add or the gap-fill picker). Defaults to the
  // signed-in doctor; change it when back-populating another doctor's days.
  var _cvCurDoc  = _cvDocAlias || (st.doc ? st.doc.alias : '');
  var _cvDocOpts = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === _cvCurDoc ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + '</option>';
  }).join('');
  if (_cvDocOpts) {
    html += '<div style="display:flex;align-items:center;gap:8px;margin:2px 0 10px">' +
              '<span style="font-size:11px;font-weight:600;color:var(--text2);white-space:nowrap">Performing doctor</span>' +
              '<select id="cv-legend-doc" onchange="_cvSetDoc(this.value)" ' +
                'style="flex:1;padding:6px 9px;border:.5px solid var(--border2);border-radius:8px;' +
                'font-size:12px;font-family:inherit;background:var(--surface2);color:var(--text)">' +
                _cvDocOpts +
              '</select>' +
            '</div>';
  }

  html += '<div class="cv-nav">' +
            '<button onclick="_cvChangeMonth(-1)">‹</button>' +
            '<div class="cv-month">' + monthName + ' ' + year + '</div>' +
            '<button onclick="_cvChangeMonth(1)">›</button>' +
          '</div>';

  // Grid
  html += '<div class="cv-grid">';
  html +=   '<div class="cv-dow">Su</div><div class="cv-dow">Mo</div><div class="cv-dow">Tu</div>' +
            '<div class="cv-dow">We</div><div class="cv-dow">Th</div><div class="cv-dow">Fr</div>' +
            '<div class="cv-dow">Sa</div>';

  var firstDow = new Date(year, month.getMonth(), 1).getDay();
  var daysIn   = new Date(year, month.getMonth() + 1, 0).getDate();
  for (var i = 0; i < firstDow; i++) html += '<div class="cv-day cv-outside"></div>';

  var todayKey = TODAY;
  for (var d = 1; d <= daysIn; d++) {
    var dateStr = pad(d) + '/' + pad(month.getMonth()+1) + '/' + year;
    var dayClaims = byDate[dateStr] || [];
    var dayTypes = _cvDayTypes(dayClaims);
    var dominant = dayTypes[0] || null;
    var dayMs = new Date(year, month.getMonth(), d).getTime();
    var inSpan = span && dayMs >= span.startMs && dayMs <= span.endMs;
    var isGap = inSpan && rule && !dayClaims.length && dateStr !== todayKey;

    var cls = 'cv-day';
    var styleAttr = '';
    if (dayTypes.length >= 2) {
      // Two (or more) claim types on this day — split the cell diagonally so
      // both colours show. Top-left triangle = highest-priority type; only
      // the top two are shown (a diagonal has two halves). A thin white seam
      // keeps the split clear even between the two similar greens.
      var cA = CV_TYPE_BG[dayTypes[0]], cB = CV_TYPE_BG[dayTypes[1]];
      styleAttr = ' style="background:linear-gradient(135deg,' +
                  cA + ' 0%,' + cA + ' 49.4%,#ffffff 49.4%,#ffffff 50.6%,' +
                  cB + ' 50.6%,' + cB + ' 100%);color:#1a1128"';
    } else if (dominant) {
      cls += ' cv-' + dominant;
    } else if (isGap) {
      cls += ' cv-gap';
    }
    if (dateStr === todayKey) cls += ' cv-today';
    if (p.discharged && p.dischargeDate === dateStr) cls += ' cv-discharged';

    var tag = '';
    if (dominant === 'ccu') {
      // Show the band (1411 / 1421 / 1431)
      var ccuClaim = dayClaims.find(function(c) {
        return c.fee === '1411' || c.fee === '1421' || c.fee === '1431';
      });
      if (ccuClaim) tag = ccuClaim.fee;
    }

    var tappable = true;  // all in-month days tappable — active pill mode needs this
    var onclick = ' onclick="tapCalDay(\'' + dateStr + '\')"';
    html += '<div class="' + cls + '"' + styleAttr + onclick + '>' +
              '<div class="cv-num">' + d + '</div>' +
              (tag ? '<div class="cv-tag">' + tag + '</div>' : '') +
            '</div>';
  }

  html += '</div>'; // close cv-grid

  // Gap warning banner
  if (rule) {
    if (gaps.length === 0) {
      html += '<div class="cv-warn cv-warn-ok">' +
                '<div class="cv-warn-icon">✓</div>' +
                '<div class="cv-warn-body"><b>No billing gaps</b>' +
                '<span>Every ' + (rule === 'ccu' ? 'CCU' : 'MRP') + ' day in this admission has a claim.</span></div>' +
              '</div>';
    } else {
      var gapStr = gaps.slice(0, 4).map(function(g) {
        var parts = g.split('/');
        return parseInt(parts[0]) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1])-1];
      }).join(', ') + (gaps.length > 4 ? '…' : '');
      html += '<div class="cv-warn">' +
                '<div class="cv-warn-icon">⚠</div>' +
                '<div class="cv-warn-body"><b>' + gaps.length + ' billing gap' + (gaps.length>1?'s':'') + ' in this admission</b>' +
                '<span>' + gapStr + '. Tap a grey day to fill.</span></div>' +
              '</div>';
    }
  }

  html += '</div>'; // close max-width wrapper

  return html;
}

// Change month and re-render calendar in-place
function _cvChangeMonth(delta) {
  var m = window._cvMonth || new Date();
  window._cvMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;
  var claims = st.claims.filter(function(c) {
    return c.phn && p.phn && samePhn(c.phn, p.phn);
  }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
  var calEl = document.getElementById('cv-view-cal');
  if (calEl) { calEl.innerHTML = _ptSummaryCalendarHTML(p, claims); _cvRestoreActivePill(); }
}

// Legend pill selection — sticky type mode
var _cvActiveType = null;

// Calendar performing-doctor — sticky across month navigation within a
// single summary open. Null means "use the signed-in doctor". Reset on
// every openPatientSummary() so it always starts at the logged-in user.
var _cvDocAlias = null;

// Record the calendar performing-doctor dropdown choice.
function _cvSetDoc(alias) { _cvDocAlias = alias || null; }

// Resolve the performing doctor for a calendar quick-add: live dropdown
// value first, then the remembered choice, then the signed-in doctor.
function _cvCurrentDocAlias() {
  var sel = document.getElementById('cv-legend-doc');
  if (sel && sel.value) return sel.value;
  return _cvDocAlias || (st.doc ? st.doc.alias : '');
}

function _cvSelectLegend(type, btn) {
  var wasActive = _cvActiveType === type;
  _cvActiveType = wasActive ? null : type;
  document.querySelectorAll('.cv-lg-pill').forEach(function(b) { b.classList.remove('active'); });
  if (!wasActive && btn) btn.classList.add('active');
  var hint = document.getElementById('cv-tap-hint');
  if (hint) {
    var labelMap = { ccu:'CCU', daily:'Daily', directive:'Directive', combined:'Combined daily' };
    hint.style.display = _cvActiveType ? '' : 'none';
    hint.style.color = _cvActiveType ? 'var(--blue-t)' : '';
    hint.textContent = _cvActiveType ? '↑ Tap any day to add ' + (labelMap[_cvActiveType] || _cvActiveType) + ' — tap pill again to cancel' : '';
  }
}

function _cvRestoreActivePill() {
  if (!_cvActiveType) return;
  var pill = document.getElementById('cv-lgp-' + _cvActiveType);
  if (pill) pill.classList.add('active');
  var hint = document.getElementById('cv-tap-hint');
  if (hint) {
    var labelMap = { ccu:'CCU', daily:'Daily', directive:'Directive', combined:'Combined daily' };
    hint.style.display = '';
    hint.style.color = 'var(--blue-t)';
    hint.textContent = '↑ Tap any day to add ' + (labelMap[_cvActiveType] || _cvActiveType) + ' — tap pill again to cancel';
  }
}

// Consult legend pill — opens the full consult card for the current patient.
// A consult is not a one-tap day add (it needs start/end times, MOST, CCFPP),
// so unlike the CCU/Daily/Directive pills it opens the consult form directly
// rather than arming a sticky day-tap mode.
function _cvOpenConsultCard() {
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;
  hideModal('pt-summary-modal');
  if (p.discharged) openClaimFromDischarged(pid);
  else              openClaimScreen(pid);
  selCT('consult');
}

// Tap a day — open details or the gap-fill picker
function tapCalDay(dateStr) {
  var pid = window._cvPid;
  if (!pid) return;
  var p = getP(pid);
  if (!p) return;

  // Active legend pill mode — add that type directly without opening picker
  if (_cvActiveType) {
    var alias = _cvCurrentDocAlias();
    if (_cvActiveType === 'combined') {
      // Combined daily: reuse this patient's reason if one is already on file;
      // only prompt the first time (see _cvPriorCombinedReason).
      var prc = _cvPriorCombinedReason(p);
      if (prc) _cvFillClaim(pid, dateStr, 'combined', prc.note, prc.icd, alias);
      else     _cvShowCombinedForm(pid, dateStr, alias);
    } else {
      _cvFillClaim(pid, dateStr, _cvActiveType, '', null, alias);
    }
    return;
  }

  var dayClaims = st.claims.filter(function(c) {
    return samePhn(c.phn, p.phn) && c.date === dateStr;
  });
  if (dayClaims.length) {
    _cvShowDayDetails(pid, dateStr, dayClaims);
  } else {
    _cvShowPicker(pid, dateStr, _cvCurrentDocAlias());
  }
}

// Sheet showing all claims on a single day with edit/delete
function _cvShowDayDetails(pid, dateStr, dayClaims) {
  var rows = dayClaims.map(function(c) {
    var feeLabel = getFeeLabel(c.fee);
    var dxLabel  = icdShortLabel(c.icd);
    if (dxLabel.length > 45) dxLabel = dxLabel.slice(0, 42) + '…';
    var typeColor = 'var(--text)';
    // Match calendar legend: Consult=yellow, Daily=green, Combined=teal, Directive=skyblue, CCU=red, Modifier=blue, Procedure=red, Discharge plan=green
    if (c.fee === '33010' || c.fee === '33012' || c.fee === '33014') typeColor = '#5a2700';            // consult yellow
    else if (c.fee === '33005')                                       typeColor = 'var(--red-t)';       // emergency consult
    else if (c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431' || c.fee === '1441') typeColor = 'var(--red-t)'; // CCU
    else if (c.fee === '33006')                                       typeColor = '#002461';            // directive sky-blue
    else if (c.fee === '33008' && c.notes)                            typeColor = 'var(--teal-t)';      // combined daily
    else if (c.fee === '33008')                                       typeColor = 'var(--green-t)';     // daily
    else if (c.fee === 'Y33025' || c.fee === '00751')                 typeColor = 'var(--red-t)';       // procedure
    else if (c.fee === '78717' || c.fee === '78720')                  typeColor = 'var(--green-t)';     // MOST / discharge plan
    else if (['1200','1201','1202','1205','1206','1207'].indexOf(c.fee) !== -1) typeColor = 'var(--blue-t)'; // modifiers
    return (
      '<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;color:' + typeColor + '">' +
          '<span>' + esc(feeLabel) + ' &bull; ' + esc(c.fee) + '</span>' +
          '<span>' + esc(c.alias || '—') + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:4px">' + esc(dxLabel) + '</div>' +
        (c.notes ? '<div style="font-size:11px;color:var(--amber-t);margin-top:4px;font-style:italic">' + esc(c.notes) + '</div>' : '') +
        (c.createdBy ? '<div style="font-size:10px;color:var(--text3);margin-top:4px">Submitted by ' + esc(c.createdBy) + (c.createdAt ? ' &middot; ' + auditTs(c.createdAt) : '') + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<button class="claim-action-btn claim-edit-btn" data-cid="' + c.id + '" data-pid="' + pid + '" onclick="_cvEditFromSheet(this)" title="Edit">✎ Edit</button>' +
          '<button class="claim-action-btn claim-del-btn"  data-cid="' + c.id + '" data-pid="' + pid + '" onclick="_cvDeleteFromSheet(this)" title="Delete">✕ Delete</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  var html =
    '<div style="font-size:14px;font-weight:700;margin-bottom:2px">' + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:12px">' + dayClaims.length + ' claim' + (dayClaims.length>1?'s':'') + ' on this day</div>' +
    rows +
    '<button class="btn btn-s" style="margin-top:6px;margin-bottom:0" onclick="hideModal(\'cv-picker-modal\')">Close</button>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
}

function _cvEditFromSheet(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  hideModal('cv-picker-modal');
  hideModal('pt-summary-modal');
  // Reuse existing edit flow
  var fakeBtn = { getAttribute: function(k) { return k === 'data-cid' ? cid : (k === 'data-pid' ? pid : null); } };
  openClaimEdit(fakeBtn);
}

function _cvDeleteFromSheet(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  hideModal('cv-picker-modal');
  var fakeBtn = { getAttribute: function(k) { return k === 'data-cid' ? cid : (k === 'data-pid' ? pid : null); } };
  deleteClaimBtn(fakeBtn);
  // Re-render the calendar after the delete is processed
  setTimeout(function() {
    if (window._cvPid) {
      var p = getP(window._cvPid);
      if (p) openPatientSummary(p.id);
    }
  }, 100);
}

// Gap-fill picker — 4 options, rule-recommended type highlighted
function _cvShowPicker(pid, dateStr, preselectedAlias) {
  var p = getP(pid);
  if (!p) return;
  var rec = _cvGapRuleForPatient(p);   // 'ccu' | 'daily' | null

  var ccuFee  = _cvCcuFeeForDate(p, dateStr);
  var ccuBand = ccuFee === '1411' ? 'day 1' : (ccuFee === '1421' ? 'day 2–7' : 'day 8+');
  var typeOpts = [
    { id:'ccu',       label:'CCU',            sub:ccuBand + ' • ' + ccuFee, cls:'cv-pk-ccu' },
    { id:'daily',     label:'Daily',          sub:'33008',                  cls:'cv-pk-daily' },
    { id:'directive', label:'Directive',      sub:'33006',                  cls:'cv-pk-directive' },
    { id:'combined',  label:'Combined daily', sub:'needs reason',           cls:'cv-pk-combined' }
  ];
  var btns = typeOpts.map(function(o) {
    var recCls = (o.id === rec) ? ' cv-pk-rec' : '';
    return '<button class="cv-pick-btn ' + o.cls + recCls + '" data-pid="' + pid + '" data-date="' + dateStr + '" data-type="' + o.id + '" onclick="_cvPickType(this)">' +
             '<div class="cv-pk-l">' + o.label + '</div>' +
             '<div class="cv-pk-s">' + o.sub + '</div>' +
             (o.id === rec ? '<div class="cv-pk-flag">Recommended</div>' : '') +
           '</button>';
  }).join('');

  var headerColor = rec ? 'var(--amber-t)' : 'var(--text)';
  var headerIcon  = rec ? '⚠ ' : '+ ';
  var hint = rec
    ? p.last + ' was ' + (rec === 'ccu' ? 'in CCU' : 'MRP') + ' this day — pick a type to backfill.'
    : 'No claim on file. Pick a visit type to add for this date.';

  // Build performing doctor dropdown (unique id cv-performing-doc to avoid conflict with claim builder)
  var curAlias = preselectedAlias || (st.doc ? st.doc.alias : '');
  var docOpts = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === curAlias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');
  var docRow = docOpts
    ? '<div style="margin-bottom:10px">' +
        '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:4px">Performing doctor</label>' +
        '<select id="cv-performing-doc" style="width:100%;padding:8px 10px;border:.5px solid var(--border2);border-radius:8px;font-size:13px;font-family:inherit;background:var(--surface2)">' +
        docOpts + '</select></div>'
    : '';

  var html =
    '<div style="font-size:14px;font-weight:700;color:' + headerColor + ';margin-bottom:2px">' + headerIcon + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">' + hint + '</div>' +
    docRow +
    '<div class="cv-pick-grid">' + btns + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" onclick="hideModal(\'cv-picker-modal\')">Cancel</button>' +
    '</div>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
}

function _cvPickType(btn) {
  var pid     = btn.getAttribute('data-pid');
  var dateStr = btn.getAttribute('data-date');
  var type    = btn.getAttribute('data-type');
  var sel = document.getElementById('cv-performing-doc');
  var alias = (sel && sel.value) ? sel.value : (st.doc ? st.doc.alias : '');
  if (type === 'combined') {
    // Combined daily: reuse this patient's reason if already on file; only
    // prompt the first time.
    var prc = _cvPriorCombinedReason(getP(pid));
    if (prc) return _cvFillClaim(pid, dateStr, 'combined', prc.note, prc.icd, alias);
    return _cvShowCombinedForm(pid, dateStr, alias);
  }
  _cvFillClaim(pid, dateStr, type, '', null, alias);
}

// Combined daily — the reason is entered ONCE per patient, then reused.
// Returns { note, icd } from the most recent combined-daily claim (a 33008
// row carrying a note) on file for this patient, or null if there is none
// yet. Derived from claim history, so it needs no extra storage and works no
// matter which screen the first combined daily was entered on. To change the
// reason later, edit the note on any combined-daily claim — the most recent
// one wins.
function _cvPriorCombinedReason(p) {
  if (!p || !p.phn) return null;
  var best = null;
  st.claims.forEach(function(c) {
    if (c.fee !== '33008') return;
    if (!c.notes || !String(c.notes).trim()) return;   // note-less 33008 = plain daily
    if (!c.phn || !samePhn(c.phn, p.phn)) return;
    if (!best || parseDMY(c.date) >= parseDMY(best.date)) best = c;
  });
  return best
    ? { note: String(best.notes).trim(), icd: String(best.icd || p.icd || '').trim() }
    : null;
}

// Combined daily sub-form — ICD + reason. Shown only the FIRST time a combined
// daily is added for a patient; after that _cvPriorCombinedReason reuses it.
function _cvShowCombinedForm(pid, dateStr, alias) {
  var p = getP(pid);
  if (!p) return;
  var defaultIcd = String(p.icd || '').trim();
  var safeAlias = alias || (st.doc ? st.doc.alias : '');
  var html =
    '<div style="font-size:14px;font-weight:700;color:var(--teal-t);margin-bottom:2px">Combined daily — ' + dispDate(dateStr) + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:12px">Entered once — this reason is reused for every future combined daily on this patient.</div>' +

    '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin:0 0 4px">ICD-9 diagnostic code</label>' +
    '<input id="cv-cb-icd" type="text" value="' + esc(defaultIcd) + '" placeholder="e.g. 428.0" autocomplete="off" ' +
    'style="width:100%;padding:11px;border:.5px solid var(--border2);border-radius:8px;font-size:14px;font-family:inherit;background:var(--surface2)">' +

    '<label style="display:block;font-size:11px;font-weight:600;color:var(--text2);margin:12px 0 4px">Reason for combined daily care</label>' +
    '<textarea id="cv-cb-reason" rows="3" autocomplete="off" placeholder="e.g. CHF — co-managed with hospitalist for renal optimization" ' +
    'style="width:100%;padding:11px;border:.5px solid var(--border2);border-radius:8px;font-size:14px;font-family:inherit;background:var(--surface2);resize:vertical"></textarea>' +

    '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" data-pid="' + pid + '" data-date="' + dateStr + '" data-alias="' + esc(safeAlias) + '" onclick="_cvBackFromCombined(this)">‹ Back</button>' +
      '<button class="btn btn-p" style="flex:1;margin-bottom:0" data-pid="' + pid + '" data-date="' + dateStr + '" data-alias="' + esc(safeAlias) + '" onclick="_cvConfirmCombined(this)">Add combined daily</button>' +
    '</div>';
  document.getElementById('cv-picker-content').innerHTML = html;
  showModal('cv-picker-modal');
  setTimeout(function() {
    var el = document.getElementById('cv-cb-reason');
    if (el) el.focus();
  }, 200);
}

function _cvBackFromCombined(btn) {
  var alias = btn.getAttribute('data-alias') || (st.doc ? st.doc.alias : '');
  _cvShowPicker(btn.getAttribute('data-pid'), btn.getAttribute('data-date'), alias);
}

function _cvConfirmCombined(btn) {
  var pid     = btn.getAttribute('data-pid');
  var dateStr = btn.getAttribute('data-date');
  var alias   = btn.getAttribute('data-alias') || (st.doc ? st.doc.alias : '');
  var icdEl    = document.getElementById('cv-cb-icd');
  var reasonEl = document.getElementById('cv-cb-reason');
  var icd    = (icdEl    ? icdEl.value    : '').trim();
  var reason = (reasonEl ? reasonEl.value : '').trim();
  if (!icd)    { if (icdEl)    icdEl.style.borderColor    = 'var(--red)'; return; }
  if (!reason) { if (reasonEl) reasonEl.style.borderColor = 'var(--red)'; return; }
  var note = icd + ' — ' + reason;
  _cvFillClaim(pid, dateStr, 'combined', note, icd, alias);
}

// Create the gap-fill claim and refresh the calendar
function _cvFillClaim(pid, dateStr, type, note, icdOverride, alias) {
  var p = getP(pid);
  if (!p) return;
  if (!checkDoc()) return;
  // Temporarily override patient ICD for the addClaim call if provided
  var origIcd = p.icd;
  if (icdOverride) p.icd = icdOverride;

  var performingAlias = alias || st.doc.alias;
  if (type === 'ccu') {
    // v3.60: write CCU_DAILY placeholder; export consolidates to 1411/1421/1431.
    addClaim(p, 'CCU_DAILY', 'CCU_DAILY', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'daily') {
    addClaim(p, '33008', '33008', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'directive') {
    addClaim(p, '33006', '33006', 1, dateStr, 'I', null, note || null, null, performingAlias);
  } else if (type === 'combined') {
    addClaim(p, '33008', '33008', 1, dateStr, 'I', null, note, null, performingAlias);
  }
  // Restore original ICD (the claim copy already captured it)
  if (icdOverride) p.icd = origIcd;

  sv('patients', st.patients);
  sv('claims',   st.claims);
  hideModal('cv-picker-modal');
  showToast(type === 'combined' ? 'Combined daily added — ' + p.last : 'Claim added — ' + p.last);

  // Refresh the calendar in-place
  var claims = st.claims.filter(function(c) {
    return c.phn && p.phn && samePhn(c.phn, p.phn);
  }).sort(function(a, b) { return parseDMY(a.date) - parseDMY(b.date); });
  var calEl = document.getElementById('cv-view-cal');
  if (calEl) { calEl.innerHTML = _ptSummaryCalendarHTML(p, claims); _cvRestoreActivePill(); }
  var listEl = document.getElementById('cv-view-list');
  if (listEl) listEl.innerHTML = _ptSummaryListHTML(p, claims);
  render();
}

// Get short ICD-9 label: "Description (code)"
// Format a startTime value from any source (HH:MM string, Date object, ISO string)
// to display HH:MM only. Sheets stores time-only as 1899-12-30T<HH>:<MM>:00.000Z
// Normalise claim date — Sheets may serialise DD/MM/YYYY back as
// ISO timestamps, JS Date strings, or pandas Timestamps. Always
// produce DD/MM/YYYY for storage and display.
// Force Title Case on names — capitalize the first letter after each space,
// hyphen, or apostrophe. Mirrors fmtClaimDate's normalization role but for
// patient/claim last/first fields. Used at every layer where names enter the
// app (sync, OCR, form input, claim creation) so we never store mixed-casing.
// Caveat: Mc/Mac/O' prefixes are partially handled (O'Brien works, McMillan
// becomes "Mcmillan" — manual override still possible for those).
function fmtName(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(
    /(^|[\s'\-])([a-z])/g,
    function(_, sep, c) { return sep + c.toUpperCase(); }
  );
}

function fmtClaimDate(d) {
  if (!d) return '';
  // Already clean DD/MM/YYYY — return immediately, no further parsing
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  // ISO date string or timestamp (from Sheets) — YYYY-MM-DD[T...] — flip to DD/MM/YYYY
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    var m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var yr = parseInt(m[1]), mo = parseInt(m[2]), dy = parseInt(m[3]);
      // Sanity check: if the ISO date is in the future (month hasn't arrived yet)
      // and swapping day/month would give a past/present date, it's the UTC-offset
      // bug where toISOString() crossed midnight and swapped DD and MM.
      // e.g. 2026-06-05 with today in May 2026 → swap to 2026-05-06 → 06/05/2026
      var now = new Date();
      var isFuture = (yr > now.getFullYear()) ||
                     (yr === now.getFullYear() && mo > now.getMonth() + 1);
      if (isFuture && dy <= 12) {
        // Try swapping day and month
        var swappedMo = dy, swappedDy = mo;
        var swapFuture = (yr > now.getFullYear()) ||
                         (yr === now.getFullYear() && swappedMo > now.getMonth() + 1);
        if (!swapFuture) {
          // Swapped version is not in the future — use it
          return pad(swappedDy) + '/' + pad(swappedMo) + '/' + yr;
        }
      }
      return pad(dy) + '/' + pad(mo) + '/' + yr;
    }
  }
  // Date object (already local) — extract local day/month/year
  if (d instanceof Date && !isNaN(d)) {
    return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear();
  }
  // v3.92: named-month dates — "18 Jan 1944", "18/Jan/1944", "18-January-1944".
  // The month is spelled out, so this is unambiguous (no day/month inference) —
  // safe to normalise to DD/MM/YYYY. Both OCR display formatting and manual
  // entry following the "DD/MMM/YYYY" field hint produce this shape.
  if (typeof d === 'string') {
    var _tm = d.trim().match(/^(\d{1,2})[\s\/.\-]+([A-Za-z]{3,9})[\s\/.\-]+(\d{4})$/);
    if (_tm) {
      var _mon = _tm[2].charAt(0).toUpperCase() + _tm[2].slice(1,3).toLowerCase();
      var _mi  = _MONTHS.indexOf(_mon);
      if (_mi !== -1) return pad(parseInt(_tm[1],10)) + '/' + pad(_mi+1) + '/' + _tm[3];
    }
  }
  // Unknown format — return as-is rather than risk MM/DD mis-parse via new Date(string)
  return String(d);
}

function fmtStartTime(t) {
  if (!t && t !== 0) return '';
  // Decimal day-fraction from Sheets time cell (e.g. 0.029861 = 00:43, 0.919444 = 22:04)
  if (typeof t === 'number') {
    if (t > 0 && t < 1) {
      var totalMins = Math.round(t * 24 * 60);
      return pad(Math.floor(totalMins / 60)) + ':' + pad(totalMins % 60);
    }
    return ''; // other numbers not meaningful as time
  }
  // Already a clean HH:MM string?
  if (typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t)) return t;
  // ISO date string with the Sheets 1899 epoch placeholder
  if (typeof t === 'string' && t.indexOf('1899-12-30') !== -1) {
    var m = t.match(/T(\d{2}):(\d{2})/);
    if (m) return m[1] + ':' + m[2];
  }
  // Generic ISO string — extract HH:MM from time part
  if (typeof t === 'string' && t.indexOf('T') !== -1) {
    var m2 = t.match(/T(\d{2}):(\d{2})/);
    if (m2) return m2[1] + ':' + m2[2];
  }
  // Date object
  if (t instanceof Date && !isNaN(t)) {
    return pad(t.getHours()) + ':' + pad(t.getMinutes());
  }
  // Fallback
  return String(t);
}

function icdShortLabel(code) {
  if (!code) return '—';
  var c = String(code).trim();
  var dx = DIAGNOSES.find(function(d) { return String(d.code).trim() === c; });
  if (dx) return dx.label; // already "Description (code)" format
  return 'ICD-9 ' + c;    // fallback for custom/unknown codes
}

// Returns only the text description, no code suffix — e.g. "Heart Failure"
function icdDescOnly(code) {
  var full = icdShortLabel(code);
  return full.replace(/\s*\([^)]+\)\s*$/, '').trim() || full;
}

// Get short human label for a fee code
function getFeeLabel(fee) {
  // CCU pre-rollup tap (not a real MSC code)
  if (fee === 'CCU_DAILY') return 'CCU Daily Visit (App will assign 1411/21/31)';
  // Look up canonical FEES first
  var f = FEES.find(function(x) { return x.code === fee; });
  if (f) return f.desc;
  // Fall back to legacy labels for historical claims that used invalid codes
  if (LEGACY_FEE_LABELS[fee]) return LEGACY_FEE_LABELS[fee];
  // Unknown — return the raw code so doctor can investigate
  return fee;
}

// Returns the $ amount for a fee code (e.g. '$186.14'), or empty string
function getFeeAmount(fee) {
  if (fee === 'CCU_DAILY') return '';  // band not yet assigned
  var f = FEES.find(function(x) { return x.code === fee; });
  return f ? (f.amount || '') : '';
}

function ptSummaryAddClaim(btn) {
  var pid = btn.getAttribute('data-pid2');
  var fn  = btn.getAttribute('data-fn2');
  hideModal('pt-summary-modal');
  if (fn === 'openClaimFromDischarged') openClaimFromDischarged(pid);
  else openClaimScreen(pid);
  // Set AFTER the open call (which clears the flag) so a successful submit
  // returns to this patient's calendar instead of the rounds list.
  _claimReturnSummaryPid = pid;
}

function ptSummaryEdit(btn) {
  var pid = btn.getAttribute('data-pid3');
  hideModal('pt-summary-modal');
  openPatientEdit(pid);
}

// ── Claim edit / delete ────────────────────────────────

// Find most recent referring MD and ICD from patient's prior claims.
// Used to pre-populate new claim entry (e.g. CCU daily inherits from earlier consult).
function inheritRefAndDxFromHistory(p) {
  var inherited = { refby: p.refby || '', refbyName: p.refbyName || '', icd: p.icd || '' };
  if (!p.phn) return inherited;
  // Walk claims in reverse chronological order
  var claims = st.claims.filter(function(c) { return samePhn(c.phn, p.phn); })
    .sort(function(a, b) {
      var da = parseDMYsafe(a.date), db = parseDMYsafe(b.date);
      return db - da;
    });
  for (var i = 0; i < claims.length; i++) {
    var c = claims[i];
    if (!inherited.refby && c.refby && !looksLikeMRPService(c.refbyName)) {
      inherited.refby = c.refby;
      inherited.refbyName = c.refbyName || '';
    }
    if (!inherited.icd && c.icd) {
      inherited.icd = String(c.icd).trim();
    }
    if (inherited.refby && inherited.icd) break;
  }
  return inherited;
}

function parseDMYsafe(s) {
  if (!s) return 0;
  var p = String(s).split('/');
  if (p.length !== 3) return 0;
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0])).getTime();
}

// ── Edit-claim fee-code picker ──────────────────────────
// A full search-as-you-type picker over the entire FEES catalogue, plus the
// CCU_DAILY placeholder. Unlike the Other-claim card it imposes NO category
// restrictions — consult, CCU and modifier codes are all selectable, because
// editing a claim must be able to reach any code the claim could legitimately
// carry. Replaces the old hard-coded 10-option <select>, which had no entry
// for unlisted fees (e.g. 00751) and so let the browser default the <select>
// to its first option (33010) — silently overwriting the real fee on save.
//
// Elements built into the Edit-claim modal by openClaimEdit():
//   ce-fee          hidden input — selected fee code (read by saveClaimEdit)
//   ce-fee-search   visible search input
//   ce-fee-dd       results dropdown
//   ce-fee-display  small confirmation line
var CE_FEE_EXTRA = [
  { code:'CCU_DAILY',
    desc:'CCU day (placeholder — export bands to 1411/1421/1431)',
    amount:'', cat:'CCU' }
];

// Whole searchable pool: every catalogued fee plus the CCU_DAILY placeholder.
function ceFeePool() { return FEES.concat(CE_FEE_EXTRA); }

// Resolve a stored fee code to display info. Falls back to LEGACY_FEE_LABELS,
// then to the bare code — so a claim's current code is ALWAYS shown and can
// never be dropped just because it is not in the active catalogue.
function ceFeeInfo(code) {
  var c = String(code || '').trim();
  if (!c) return null;
  var hit = ceFeePool().find(function(f) { return f.code === c; });
  if (hit) return { code:c, desc:hit.desc || '', amount:hit.amount || '', cat:hit.cat || '' };
  var legacy = (typeof LEGACY_FEE_LABELS !== 'undefined' && LEGACY_FEE_LABELS) ? LEGACY_FEE_LABELS[c] : '';
  return { code:c, desc:legacy || ('Fee code ' + c), amount:'', cat:'' };
}

// Build the picker markup, pre-filled with the claim's current fee.
function ceFeePickerHTML(currentCode) {
  var info = ceFeeInfo(currentCode);
  var searchVal = info ? (info.desc + ' (' + info.code + ')') : '';
  return '<input id="ce-fee" type="hidden" value="' + esc(currentCode || '') + '">' +
         '<input id="ce-fee-search" autocorrect="off" autocomplete="off" ' +
           'placeholder="Search fee code or description…" value="' + esc(searchVal) + '" ' +
           'oninput="ceFeeSearch(this.value)" onfocus="this.select();ceFeeSearch(\'\')">' +
         '<div class="ref-dd" id="ce-fee-dd"></div>' +
         '<div id="ce-fee-display" style="font-size:11px;color:var(--text2);margin-top:-4px;margin-bottom:6px"></div>';
}

var CE_FEE_CAT_COLORS = {
  'Consult':'var(--blue-t)',   'Daily':'var(--blue-t)',     'Directive':'var(--amber-t)',
  'Procedure':'var(--red-t)',  'Discharge':'var(--green-t)','CCU':'var(--red-t)',
  'Modifier':'var(--text3)',   'Other':'var(--teal-t)'
};

// Populate the dropdown. Empty query => the full list, no truncation.
function ceFeeSearch(query) {
  var dd = document.getElementById('ce-fee-dd');
  if (!dd) return;
  var q = (query || '').toLowerCase().trim();
  var pool = ceFeePool();
  var matches = q.length === 0
    ? pool.slice()
    : pool.filter(function(f) {
        return f.code.toLowerCase().indexOf(q) !== -1 ||
               (f.desc || '').toLowerCase().indexOf(q) !== -1;
      });
  if (!matches.length) {
    dd.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text2)">No matching fee codes</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = matches.map(function(f) {
    var col = CE_FEE_CAT_COLORS[f.cat] || 'var(--text2)';
    var amt = f.amount ? '<span style="font-size:11px;font-weight:700;color:var(--text2);margin-left:auto;padding-left:8px">' + esc(f.amount) + '</span>' : '';
    return '<div class="ref-dd-row" data-code="' + esc(f.code) + '" data-desc="' + esc(f.desc || '') + '" ' +
      'onclick="ceFeeSelect(this.getAttribute(\'data-code\'),this.getAttribute(\'data-desc\'))" ' +
      'style="display:flex;align-items:center;gap:4px">' +
      '<span style="font-weight:700;color:' + col + ';margin-right:6px;min-width:62px">' + esc(f.code) + '</span>' +
      '<span style="flex:1;min-width:0">' + esc(f.desc || '') + '</span>' +
      (f.cat ? '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + esc(f.cat) + '</span>' : '') +
      amt +
      '</div>';
  }).join('');
  dd.style.display = 'block';
}

// Commit a selection into the hidden input + search box.
function ceFeeSelect(code, desc) {
  var inp = document.getElementById('ce-fee');
  if (inp) inp.value = code;
  var search = document.getElementById('ce-fee-search');
  if (search) search.value = (desc ? desc + ' ' : '') + '(' + code + ')';
  var dd = document.getElementById('ce-fee-dd');
  if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
}

function openClaimEdit(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  var p   = getP(pid);
  if (!c) return;

  var feePicker = ceFeePickerHTML(c.fee);

  var curDx = DIAGNOSES.find(function(d) { return d.code === c.icd; });

  // Build doctor options for performing physician selector
  var docOptions = doctorsSorted().map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (c.alias === d.alias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');

  // Convert DD/MM/YYYY to YYYY-MM-DD for the date input
  var cleanDate = fmtClaimDate(c.date || '');
  var dateISO = '';
  if (cleanDate && /^\d{2}\/\d{2}\/\d{4}$/.test(cleanDate)) {
    var dp = cleanDate.split('/');
    dateISO = dp[2] + '-' + dp[1] + '-' + dp[0];
  }
  var startTimeClean = fmtStartTime(c.startTime || '');

  var refLabel = c.refbyName ? c.refbyName + (c.refby ? ' #' + c.refby : '') : '';

  var html =
    '<div style="font-size:14px;font-weight:800;margin-bottom:12px">Edit claim — ' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<div class="card" style="padding:12px">' +
      '<div class="fl">' +
        '<div class="f1"><label>Date</label>' +
          '<input id="ce-date" type="date" value="' + esc(dateISO) + '"></div>' +
        '<div class="f1"><label>Start time</label>' +
          '<input id="ce-time" type="text" value="' + esc(startTimeClean) + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>' +
        '<div class="f1"><label>End time</label>' +
          '<input id="ce-end-time" type="text" value="' + esc(fmtStartTime(c.endTime || '')) + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>' +
      '</div>' +
      '<label style="margin-top:7px">Performing physician</label>' +
      '<select id="ce-alias" style="margin-bottom:7px">' + docOptions + '</select>' +
      '<label>Fee code</label>' + feePicker +
      '<label style="margin-top:10px">Referring MD</label>' +
      '<div style="position:relative">' +
      '<input id="ce-ref-search" value="' + esc(refLabel) + '" style="padding-right:32px" ' +
      'placeholder="Type name or doctor #..." autocorrect="off" autocomplete="off" ' +
      'data-dd="ce-ref-dd" data-hidden="ce-refby" data-name="ce-refby-name" ' +
      'oninput="refSearchEl(this)" onfocus="refSearchEl(this)">' +
      '<button type="button" tabindex="-1" onclick="clearSearchField(\'ce-ref-search\',\'ce-refby\',\'ce-refby-name\',\'ce-ref-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'ce-ref-search\',\'ce-refby\',\'ce-refby-name\',\'ce-ref-dd\')" ' +
      'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
      '</div>' +
      '<input id="ce-refby"      type="hidden" value="' + esc(c.refby || '') + '">' +
      '<input id="ce-refby-name" type="hidden" value="' + esc(c.refbyName || '') + '">' +
      '<div class="ref-dd" id="ce-ref-dd"></div>' +
      '<label style="margin-top:10px">Diagnosis</label>' +
      '<div style="position:relative">' +
      '<input id="ce-icd-search" value="' + esc(curDx ? curDx.label : (c.icd || '')) + '" style="padding-right:32px" ' +
      'placeholder="Type diagnosis or code..." autocorrect="off" autocomplete="off" ' +
      'data-dd="ce-icd-dd" data-hidden="ce-icd" oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">' +
      '<button type="button" tabindex="-1" onclick="clearSearchField(\'ce-icd-search\',\'ce-icd\',null,\'ce-icd-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'ce-icd-search\',\'ce-icd\',null,\'ce-icd-dd\')" ' +
      'style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>' +
      '</div>' +
      '<input id="ce-icd" type="hidden" value="' + esc(c.icd || '') + '">' +
      '<div class="ref-dd" id="ce-icd-dd"></div>' +
      '<label style="margin-top:10px">Notes</label>' +
      '<input id="ce-notes" value="' + esc(c.notes || '') + '" placeholder="Optional notes…" autocorrect="off">' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn btn-p" style="margin:0;flex:1" data-cid="' + cid + '" data-pid="' + pid + '" onclick="saveClaimEdit(this)">Save</button>' +
      '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideClaimEditModal()">Cancel</button>' +
    '</div>';

  document.getElementById('claim-edit-content').innerHTML = html;
  showModal('claim-edit-modal');
}

function saveClaimEdit(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  var p   = getP(pid);
  if (!c) return;

  // Non-coercive: if the picker value is somehow blank, keep the claim's
  // existing fee rather than overwriting it (never silently drop a fee).
  var newFee   = ((document.getElementById('ce-fee') || {}).value || '').trim() || c.fee;
  var newIcd   = document.getElementById('ce-icd').value || c.icd;
  var newAlias = document.getElementById('ce-alias').value;
  var newDateISO = (document.getElementById('ce-date') || {}).value || '';
  var newTime    = (document.getElementById('ce-time')     || {}).value || '';
  var newEndTime = (document.getElementById('ce-end-time') || {}).value || '';
  var newNotes = (document.getElementById('ce-notes') || {}).value || '';
  var newRefby     = (document.getElementById('ce-refby')      || {}).value || '';
  var newRefName   = (document.getElementById('ce-refby-name') || {}).value || '';

  // Convert YYYY-MM-DD back to DD/MM/YYYY for storage
  var newDate = c.date;
  if (newDateISO && /^\d{4}-\d{2}-\d{2}$/.test(newDateISO)) {
    var dp = newDateISO.split('-');
    newDate = dp[2] + '/' + dp[1] + '/' + dp[0];
  }

  c.fee     = newFee;

  c.icd     = newIcd;
  c.date    = newDate;
  c.startTime = newTime;
  c.endTime   = newEndTime;
  c.notes   = newNotes;
  // Block writing service strings as referring MD
  if (newRefby && newRefName && !looksLikeMRPService(newRefName)) {
    c.refby     = newRefby;
    c.refbyName = newRefName;
  }
  if (newAlias) {
    var doc = st.doctors.find(function(d) { return d.alias === newAlias; });
    c.alias  = newAlias;
  }

  sv('claims', st.claims);
  if (SHEETS_URL) push('saveClaim', c);
  hideClaimEditModal();

  // Reopen summary to show updated claim
  openPatientSummary(pid);
  showToast('Claim updated');
}

function deleteClaimBtn(btn) {
  var cid = btn.getAttribute('data-cid');
  var pid = btn.getAttribute('data-pid');
  var c   = st.claims.find(function(x) { return x.id != null && x.id !== '' && String(x.id) === String(cid); });
  if (!c) return;

  if (!confirm('Delete ' + getFeeLabel(c.fee) + ' on ' + dispDate(c.date) + '?')) return;

  st.claims = st.claims.filter(function(x) { return String(x.id) !== String(cid); });
  sv('claims', st.claims);
  if (SHEETS_URL) push('deleteClaim', { id: cid });

  openPatientSummary(pid);
  showToast('Claim deleted');
}

function hideClaimEditModal() { hideModal('claim-edit-modal'); }

// ── 06d_patient_edit.js ──
// ═══════════════════════════════════════════════════════
// 06d_patient_edit.js — Edit patient demographics/location
// Double-tap patient name opens an edit sheet
// ═══════════════════════════════════════════════════════

// Edit opened via pencil icon on claim screen banner


function openPatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:-.3px">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Edit patient</span>' +
    '</div>';

  // ── Demographics ─────────────────────────────────────

  html += '<div class="card card-patient">';
  html += '<div class="card-title">Demographics</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>Last name</label><input id="pe-last" value="' + esc(p.last||'') + '" autocorrect="off" autocapitalize="words"></div>';
  html += '<div class="f1"><label>First name</label><input id="pe-first" value="' + esc(p.first||'') + '" autocorrect="off" autocapitalize="words"></div>';
  html += '</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>PHN</label><input id="pe-phn" value="' + esc(p.phn||'') + '" inputmode="numeric" maxlength="10" autocorrect="off"></div>';
  html += '<div class="f1"><label>DOB</label><input id="pe-dob" value="' + esc(p.dob||'') + '" autocorrect="off" placeholder="DD/MMM/YYYY"></div>';
  html += '</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>Sex</label>' +
          '<div class="fl" style="gap:6px">' +
            '<button class="ap-list-pill' + (p.sex==='M'?' on':'') + '" id="pe-sex-m" onclick="peSexPill(\'M\')">M</button>' +
            '<button class="ap-list-pill' + (p.sex==='F'?' on':'') + '" id="pe-sex-f" onclick="peSexPill(\'F\')">F</button>' +
          '</div>' +
          '<input id="pe-sex" type="hidden" value="' + esc(p.sex||'') + '">' +
          '</div>';
  html += '</div>';
  html += '</div>'; // end demographics card

  // ── Location & list (shared component) ───────────────
  html += buildLocationCard('pe', p);

  // ── Audit footer (who added the patient) ─────────────
  if (p.createdBy || p.createdAt) {
    html += '<div style="font-size:10px;color:var(--text3);text-align:center;margin:8px 0 12px">' +
            'Added by ' + esc(p.createdBy || '—') +
            (p.createdAt ? ' &middot; ' + auditTs(p.createdAt) : '') +
            '</div>';
  }

  // ── Save / Cancel ────────────────────────────────────
  html += '<div class="fl" style="gap:8px">';
  html += '<button class="btn btn-p" style="margin:0;flex:1" ' +
          'data-pid="' + pid + '" onclick="savePatientEdit(this.getAttribute(\'data-pid\'))">Save</button>';
  html += '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideModal(\'pt-edit-modal\')">Cancel</button>';
  html += '</div>';

  document.getElementById('pt-edit-content').innerHTML = html;
  showModal('pt-edit-modal');

  // Render the ward's room pills after the card is in the DOM. Ward,
  // role, MRP, list, care and bed are all baked into the card by
  // buildLocationCard, so nothing else needs restoring here.
  setTimeout(function() {
    renderRoomPills(p.ward, 'pe-bed', 'pe-room-pills');
  }, 50);
}

// Clear a search field and its hidden value fields
function clearSearchField(searchId, hiddenId, hiddenNameId, ddId) {
  var s = document.getElementById(searchId);
  if (s) { s.value = ''; s.focus(); }
  var h = document.getElementById(hiddenId);
  if (h) h.value = '';
  if (hiddenNameId) {
    var hn = document.getElementById(hiddenNameId);
    if (hn) hn.value = '';
  }
  var dd = document.getElementById(ddId);
  if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
}

// Dynamic role change in edit form
function peRoleChange() {
  // Same rules as roleChange() — role ↔ MRP binding, care updates,
  // list (on/off service) is NOT touched (ward-driven only).
  var roleSel = document.getElementById('pe-role');
  var mrpSel  = document.getElementById('pe-mrp');
  var careFld = document.getElementById('pe-care');
  var ward    = (document.getElementById('pe-ward') || {}).value || '';
  if (!roleSel || !mrpSel) return;
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (roleSel.value === 'mrp') {
    mrpSel.value = 'Cardiology';
    if (careFld) careFld.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    if (mrpSel.value === 'Cardiology') mrpSel.value = 'Other';
    if (careFld) careFld.value = 'directive';
  }
}

function savePatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  // v4.09: capture pre-edit name so we can propagate a rename to existing
  // claim rows. Background: addClaim snapshots p.last/p.first onto each
  // claim row at write time. Before v4.09 a rename here only updated the
  // patient record, leaving historical claim rows stuck with the original
  // (often OCR-misread) name — exactly the failure pattern that landed
  // last="57" on Malone, Deborah's claims.
  var _oldLast  = p.last  || '';
  var _oldFirst = p.first || '';

  var role = (document.getElementById('pe-role') || {}).value || 'consultant';
  var ward = (document.getElementById('pe-ward') || {}).value || p.ward;

  p.last      = fmtName((document.getElementById('pe-last')  || {}).value || p.last);
  p.first     = fmtName((document.getElementById('pe-first') || {}).value || p.first);
  p.phn       = (document.getElementById('pe-phn')   || {}).value || p.phn;
  p.dob       = fmtClaimDate((document.getElementById('pe-dob') || {}).value || p.dob);
  p.sex       = (document.getElementById('pe-sex')   || {}).value || p.sex;
  p.ward      = ward;
  var _peBed = document.getElementById('pe-bed');
  if (_peBed) p.bed = _peBed.value;
  p.role      = role;
  p.mrp       = (document.getElementById('pe-mrp')  || {}).value || '';
  p.list      = (document.getElementById('pe-list') || {}).value || p.list;
  p.care      = (document.getElementById('pe-care') || {}).value || p.care;

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // v4.09: propagate name change to ALL claim rows for this PHN. Each row
  // is re-pushed via saveClaim so the Sheet is updated. The set of changed
  // claims is also reported in the changelog detail and a separate toast
  // so the doctor can see what was touched.
  var _claimsTouched = 0;
  if ((p.last !== _oldLast || p.first !== _oldFirst) && p.phn) {
    st.claims.forEach(function(c) {
      if (!samePhn(c.phn, p.phn)) return;
      if (c.last === p.last && c.first === p.first) return;
      c.last  = p.last;
      c.first = p.first;
      if (SHEETS_URL) push('saveClaim', c);
      _claimsTouched++;
    });
    if (_claimsTouched > 0) {
      sv('claims', st.claims);
      try { console.log('[v4.09] Propagated name change to ' + _claimsTouched + ' claim row(s) for PHN ' + p.phn); } catch (e) {}
    }
  }

  var _renameDetail = '';
  if (p.last !== _oldLast || p.first !== _oldFirst) {
    var _oldDisplay = _oldLast + (_oldFirst ? ', ' + _oldFirst : '');
    _renameDetail = 'Renamed from "' + _oldDisplay + '"' +
      (_claimsTouched > 0 ? ' \u2014 updated ' + _claimsTouched + ' claim row(s)' : '');
  }
  logChange(p, 'Demographics edited', _renameDetail);
  hideModal('pt-edit-modal');
  render();
  showToast(p.last + ' updated' + (_claimsTouched > 0 ? ' (\u2713 ' + _claimsTouched + ' claim row(s) renamed)' : ''));
}

// ═══════════════════════════════════════════════════════
// Location edit — quick ward/bed/on-off-service change
// Opened by tapping the ward/bed circle on any patient row.
// Rule: if the new ward isn't a Cardiology MRP ward (CCU/2S/2W)
// OR the list flips on→off, force role=consultant + mrp=Other.
// ═══════════════════════════════════════════════════════
function openLocationEditEl(el) {
  var pid = el.getAttribute('data-pid') || (el.closest('[data-pid]') && el.closest('[data-pid]').getAttribute('data-pid'));
  if (pid) openLocationEdit(pid);
}

var _leEditP = null;

function openLocationEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;
  _leEditP = p;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:-.3px">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Location</span>' +
    '</div>';

  // Shared "Location & list" card — same component as Add Patient.
  html += buildLocationCard('le', p);
  html += '<div id="le-rule-hint" style="font-size:11px;color:var(--text3);line-height:1.4;margin:8px 0 12px;padding:0 4px"></div>';

  html += '<div class="fl" style="gap:8px">';
  html += '<button class="btn btn-p" style="margin:0;flex:1" data-pid="' + pid + '" onclick="saveLocationEdit(this.getAttribute(\'data-pid\'))">Save</button>';
  html += '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideModal(\'loc-edit-modal\')">Cancel</button>';
  html += '</div>';

  document.getElementById('loc-edit-content').innerHTML = html;
  showModal('loc-edit-modal');

  setTimeout(function() {
    renderRoomPills(p.ward, 'le-bed', 'le-room-pills');
    leUpdateRuleHint();
  }, 50);
}


// Whether a ward is a Cardiology MRP ward where this group is primary.
// Used by saveLocationEdit and leUpdateRuleHint.
function _isCardiologyMRPWard(ward) {
  return ward === 'CCU' || ward === '2S' || ward === '2W';
}

function leUpdateRuleHint() {
  var hint = document.getElementById('le-rule-hint');
  if (!hint) return;
  var newWard = (document.getElementById('le-ward') || {}).value || '';
  var newList = (document.getElementById('le-list') || {}).value || 'on';
  var oldList = _leEditP ? _leEditP.list : null;

  var movedOff       = oldList === 'on' && newList === 'off';
  var leftCardiology = !_isCardiologyMRPWard(newWard);
  if (movedOff || leftCardiology) {
    hint.innerHTML = '<b style="color:var(--amber-t)">Note:</b> role will change to ' +
      '<b>Consulting</b> and MRP to <b>Other</b>. Open full edit if you need to keep them as MRP/Cardiology.';
  } else {
    hint.textContent = '';
  }
}

function saveLocationEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var newWard = (document.getElementById('le-ward') || {}).value || p.ward;
  var newBed  = (document.getElementById('le-bed')  || {}).value || '';
  var newList = (document.getElementById('le-list') || {}).value || p.list;
  var newMrp  = (document.getElementById('le-mrp')  || {}).value || '';
  var newRole = (document.getElementById('le-role') || {}).value || '';
  var newCare = (document.getElementById('le-care') || {}).value || '';

  var oldWard = p.ward;
  var oldBed  = p.bed || '';
  var oldList = p.list;

  // Apply the rule: leaving cardiology wards OR going on→off → consultant + Other
  var leftCardiology = !_isCardiologyMRPWard(newWard);
  var movedOff       = oldList === 'on' && newList === 'off';
  var snappedRole    = false;
  if (leftCardiology || movedOff) {
    if (p.role === 'mrp' || (p.mrp && p.mrp === 'Cardiology')) snappedRole = true;
    p.role = 'consultant';
    p.mrp  = 'Other';
    // Care code stays user-controlled via full edit; default to directive for consultants
    if (p.care !== 'combined') p.care = 'directive';
  }

  p.ward = newWard;
  p.bed  = newBed;
  p.list = newList;
  if (newMrp)  p.mrp  = newMrp;
  if (newRole) p.role = newRole;
  if (newCare) p.care = newCare;

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // Concise change-log entry
  var bits = [];
  if (oldWard !== newWard) bits.push(((WARDS[oldWard]||{}).label || oldWard || '—') + ' → ' + ((WARDS[newWard]||{}).label || newWard));
  if (oldBed  !== newBed)  bits.push('bed ' + (oldBed || '—') + ' → ' + (newBed || '—'));
  if (oldList !== newList) bits.push((oldList === 'on' ? 'On' : 'Off') + ' → ' + (newList === 'on' ? 'On' : 'Off') + ' service');
  if (snappedRole)         bits.push('role→Consulting, MRP→Other');
  logChange(p, 'Moved', bits.join('; ') || 'no change');

  hideModal('loc-edit-modal');
  render();
  var toastBits = [];
  if (oldWard !== newWard || oldBed !== newBed) toastBits.push((WARDS[newWard]||{}).label || newWard);
  if (newBed) toastBits.push(newBed);
  showToast(p.last + ' moved' + (toastBits.length ? ' → ' + toastBits.join(' ') : ''));
}

