// ── 04_billing.js ──
// ═══════════════════════════════════════════════════════
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
  function monBefore(m, day) { var d=new Date(y,m,day); while(d.getDay()!==1) d.setDate(d.getDate()-1); return d; }
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
  var d = new Date(dateStr);
  var key = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  return bcStatHolidays(d.getFullYear()).indexOf(key) !== -1;
}

function isWeekendOrStat(dateStr) {
  if (!dateStr) return false;
  var d = new Date(dateStr); var dow = d.getDay();
  return dow === 0 || dow === 6 || isBCStat(dateStr);
}

// ── CCFPP detection + retroactive peer note update ─────
// When a same-doctor 33010/33012 consult overlaps another same-doctor
// 33010/33012 consult (both in a modifier window), CCFPP applies in
// BOTH directions:
//   - new patient gets a note listing each overlapping peer
//   - each peer's consult + modifier claims get a retro note added
// Returns the CCFPP note string for the new patient (empty if no overlap).
// Side effect: mutates and pushes peer claims to Sheets.
function ccfppDetectAndUpdate(newP, alias, dateISO, dateFmt, startStr, endStr) {
  if (!startStr || !endStr) return '';
  var thisMod = getModifier(startStr, dateISO);
  if (!thisMod) return '';

  var thisStartM = t2m(startStr);
  var thisEndM   = t2m(endStr);
  if (thisEndM < thisStartM) thisEndM += 1440;

  var curD  = parseDMY(dateFmt);
  var prevD = new Date(curD.getTime() - 86400000);
  var nextD = new Date(curD.getTime() + 86400000);
  var prevDateFmt = pad(prevD.getDate()) + '/' + pad(prevD.getMonth() + 1) + '/' + prevD.getFullYear();
  var nextDateFmt = pad(nextD.getDate()) + '/' + pad(nextD.getMonth() + 1) + '/' + nextD.getFullYear();

  var peers = [];
  var seenPhn = {};

  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (c.alias !== alias) continue;
    if (c.phn === newP.phn) continue;
    if (c.fee !== '33010' && c.fee !== '33012') continue;
    if (!c.startTime || !c.endTime) continue;

    var isSame = c.date === dateFmt;
    var isPrev = c.date === prevDateFmt;
    var isNext = c.date === nextDateFmt;
    if (!isSame && !isPrev && !isNext) continue;

    var pStartM = t2m(c.startTime);
    var pEndM   = t2m(c.endTime);
    if (pEndM < pStartM) pEndM += 1440;

    if (isPrev) {
      if (pEndM <= 1440) continue; // didn't cross midnight
      pStartM -= 1440; pEndM -= 1440;
    } else if (isNext) {
      if (thisEndM <= 1440) continue; // new claim doesn't cross midnight
      pStartM += 1440; pEndM += 1440;
    }

    var pRefD = parseDMY(c.date);
    var pISO  = pRefD.getFullYear() + '-' + pad(pRefD.getMonth() + 1) + '-' + pad(pRefD.getDate());
    if (!getModifier(c.startTime, pISO)) continue;

    // Real interval overlap
    if (thisStartM < pEndM && pStartM < thisEndM) {
      if (seenPhn[c.phn]) continue;
      seenPhn[c.phn] = true;
      peers.push(c);
    }
  }

  if (!peers.length) return '';

  // Build new patient's CCFPP note (one entry per peer)
  var noteParts = peers.map(function(c) {
    var pp = (st.patients || []).find(function(_pp) { return _pp.phn === c.phn; }) || {};
    var name = ((pp.first || '') + ' ' + (pp.last || '')).trim() || '(unknown)';
    return 'CCFPP ' + name + ' (' + (c.phn || '—') + ')';
  });
  var newPatientNote = noteParts.join(' | ');

  // Retroactively add note to each peer's consult + modifier claims
  var newName = ((newP.first || '') + ' ' + (newP.last || '')).trim() || '(unknown)';
  var newFragment = 'CCFPP ' + newName + ' (' + (newP.phn || '—') + ')';
  var peerFees = ['33010', '33012', '1200', '1201', '1202', '1205', '1206', '1207'];

  peers.forEach(function(peer) {
    st.claims.forEach(function(c) {
      if (c.phn !== peer.phn) return;
      if (c.alias !== alias) return;
      if (c.date !== peer.date) return;
      if (peerFees.indexOf(c.fee) === -1) return;
      if (c.notes && c.notes.indexOf(newFragment) !== -1) return; // already noted
      c.notes = c.notes ? c.notes + ' | ' + newFragment : newFragment;
      if (SHEETS_URL) push('saveClaim', c);
    });
  });
  sv('claims', st.claims);

  return newPatientNote;
}

// ── CCFPP overlap detection + retroactive peer update ──
// Returns the CCFPP note string for the NEW consult's claims, and
// retroactively appends a CCFPP note to each overlapping peer's
// existing consult + modifier claims, pushing the updates to Sheets.
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
function ccfppDetectAndUpdate(newP, alias, dateISO, dateFmt, startStr, endStr) {
  if (!startStr || !endStr) return '';
  if (!getModifier(startStr, dateISO)) return '';

  // New consult range in minutes from midnight of dateFmt
  var thisStartM = t2m(startStr);
  var thisEndM   = t2m(endStr);
  if (thisEndM < thisStartM) thisEndM += 1440; // new consult crosses midnight

  // Compute DD/MM/YYYY strings for prev and next dates
  var _curDateD  = parseDMY(dateFmt);
  var _prevDateD = new Date(_curDateD.getTime() - 86400000);
  var _nextDateD = new Date(_curDateD.getTime() + 86400000);
  var prevDateFmt = pad(_prevDateD.getDate()) + '/' + pad(_prevDateD.getMonth() + 1) + '/' + _prevDateD.getFullYear();
  var nextDateFmt = pad(_nextDateD.getDate()) + '/' + pad(_nextDateD.getMonth() + 1) + '/' + _nextDateD.getFullYear();

  // Collect all overlapping peer PHNs (deduplicated)
  var peerPhns = [];
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

    // Prev claim must also be in a modifier window (use its own date)
    var _prevRefD = parseDMY(c.date);
    var _prevISO  = _prevRefD.getFullYear() + '-' + pad(_prevRefD.getMonth() + 1) + '-' + pad(_prevRefD.getDate());
    if (!getModifier(c.startTime, _prevISO)) continue;

    // Interval overlap
    if (thisStartM < prevEndM && prevStartM < thisEndM) {
      if (peerPhns.indexOf(c.phn) === -1) peerPhns.push(c.phn);
    }
  }

  if (!peerPhns.length) return '';

  // Build CCFPP note string for the NEW consult — one entry per peer
  var newClaimNote = peerPhns.map(function(peerPhn) {
    var pat = (st.patients || []).find(function(pp) { return pp.phn === peerPhn; }) || {};
    var name = ((pat.first || '') + ' ' + (pat.last || '')).trim() || '(unknown)';
    return 'CCFPP ' + name + ' (' + peerPhn + ')';
  }).join(' | ');

  // RETROACTIVELY update each peer's existing consult + modifier claims
  // Append "CCFPP <newP first> <newP last> (<newP phn>)" to their notes.
  var reverseNote = 'CCFPP ' + ((newP.first || '') + ' ' + (newP.last || '')).trim() + ' (' + (newP.phn || '—') + ')';
  var feesForCcfpp = ['33010','33012','1200','1201','1202','1205','1206','1207'];
  var dateMatches = [dateFmt, prevDateFmt, nextDateFmt];

  peerPhns.forEach(function(peerPhn) {
    st.claims.forEach(function(c) {
      if (c.phn   !== peerPhn) return;
      if (c.alias !== alias)   return;
      if (dateMatches.indexOf(c.date) === -1) return;
      if (feesForCcfpp.indexOf(c.fee) === -1) return;
      var existing = c.notes || '';
      if (existing.indexOf(reverseNote) !== -1) return; // idempotent
      c.notes = existing ? existing + ' | ' + reverseNote : reverseNote;
      if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) push('saveClaim', c);
    });
  });
  sv('claims', st.claims);

  return newClaimNote;
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
function addClaim(p, fee, feeCode, units, date, loc, startTime, notes, endTime, performingAlias) {
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
  // Start time only for consults (33010/33012) and emergency care (33035)
  var _start = startTime || '';
  var c = {
    id:        'c' + Date.now() + Math.floor(Math.random() * 9999),
    alias:     performingAlias || st.doc.alias,
    last:      p.last  || '',
    first:     p.first || '',
    phn:       p.phn,
    fee:       fee,
    icd:       p.icd || '3062',
    units:     units || 1,
    date:      date,
    refby:     p.refby     || '',
    refbyName: p.refbyName || '',
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

