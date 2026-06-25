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

// Same-person guard — surname + DOB match. Stops CCFPP linking a patient
// to a duplicate record of themselves.
function ccfppSamePerson_(a, b) {
  var aLast = String((a && a.last) || '').trim().toLowerCase();
  var bLast = String((b && b.last) || '').trim().toLowerCase();
  if (!aLast || aLast !== bLast) return false;
  var aDob = String((a && a.dob) || '').replace(/\D/g, '');
  var bDob = String((b && b.dob) || '').replace(/\D/g, '');
  if (!aDob || !bDob) return false;      // missing DOB — do not block
  return aDob === bDob;
}

// 120x call-out modifier fee codes. CCFPP rides on these AND the 33010/33012 consult row (v4.49b); this list identifies the modifier rows.
var CCFPP_MODIFIER_FEES = ['1200','1201','1202','1205','1206','1207'];

// Format a patient's name as "Last, First" for CCFPP notes.
function _ccfppName(p) {
  var last  = String((p && p.last)  || '').trim();
  var first = String((p && p.first) || '').trim();
  return last ? (last + (first ? ', ' + first : '')) : (first || '(unknown)');
}

// Digit-only PHN equality (robust to formatting differences).
function _ccfppPhnEq(a, b) {
  var da = String(a || '').replace(/\D/g, '');
  var db = String(b || '').replace(/\D/g, '');
  return !!da && da === db;
}

// Strip every "CCFPP: ... (phn)" segment from a notes string while keeping
// the user's own notes. Segments are ' | '-joined.
function _ccfppStrip(notes) {
  return String(notes || '')
    .split('|')
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return s && s.slice(0, 6).toUpperCase() !== 'CCFPP:'; })
    .join(' | ');
}

// Merge a user-note part with a single CCFPP note (either may be empty).
function _ccfppMerge(userPart, ccfppNote) {
  return [userPart, ccfppNote].filter(function(s){ return s; }).join(' | ');
}

// Return the SINGLE most-recent overlapping predecessor for a consult, or
// null. Predecessor = another patient's same-alias 33010/33012 consult that
// is modifier-eligible, has times, overlaps this consult, and starts at or
// before it; among those, the one with the LATEST start. Cross-midnight
// aware (scans prev/next calendar day). `consult` may be a claim row or a
// synthesized {phn,last,first,dob,date,startTime,endTime} object.
function ccfppPredecessorFor_(consult, alias) {
  if (!consult || !consult.startTime || !consult.endTime) return null;
  var dateFmt = consult.date;
  if (!dateFmt) return null;

  var _curD   = parseDMY(dateFmt);
  var _curISO = _curD.getFullYear() + '-' + pad(_curD.getMonth() + 1) + '-' + pad(_curD.getDate());
  if (!getModifier(consult.startTime, _curISO)) return null;   // not a call-out window

  var thisStartM = t2m(consult.startTime);
  var thisEndM   = t2m(consult.endTime);
  if (thisEndM < thisStartM) thisEndM += 1440;

  var prevDateFmt = pad(new Date(_curD.getTime() - 86400000).getDate()) + '/' + pad(new Date(_curD.getTime() - 86400000).getMonth() + 1) + '/' + new Date(_curD.getTime() - 86400000).getFullYear();
  var nextDateFmt = pad(new Date(_curD.getTime() + 86400000).getDate()) + '/' + pad(new Date(_curD.getTime() + 86400000).getMonth() + 1) + '/' + new Date(_curD.getTime() + 86400000).getFullYear();

  var bestStartM = -1, bestPhn = null, bestName = null;

  for (var _i = 0; _i < st.claims.length; _i++) {
    var c = st.claims[_i];
    if (c.alias !== alias) continue;
    if (_ccfppPhnEq(c.phn, consult.phn)) continue;
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
      prevStartM -= 1440; prevEndM -= 1440;
    } else if (_isNext) {
      if (thisEndM <= 1440) continue;
      prevStartM += 1440; prevEndM += 1440;
    }

    var _peerRefD = parseDMY(c.date);
    var _peerISO  = _peerRefD.getFullYear() + '-' + pad(_peerRefD.getMonth() + 1) + '-' + pad(_peerRefD.getDate());
    if (!getModifier(c.startTime, _peerISO)) continue;   // peer must also be a call-out

    var _peerPat = (st.patients || []).find(function(pp){ return _ccfppPhnEq(pp.phn, c.phn); }) || {};
    if (ccfppSamePerson_(consult, _peerPat)) continue;

    // Overlap AND peer starts at/before this consult → peer is a predecessor.
    if (thisStartM < prevEndM && prevStartM < thisEndM && prevStartM <= thisStartM) {
      if (prevStartM > bestStartM) {
        bestStartM = prevStartM;
        bestPhn    = c.phn;
        bestName   = _ccfppName((_peerPat && _peerPat.last) ? _peerPat : c);
      }
    }
  }

  return bestPhn ? { phn: bestPhn, name: bestName } : null;
}

// PURE preview — the CCFPP note the NEW consult would carry on its 120x
// modifier claims if submitted now. No mutation; safe on every keystroke.
function ccfppPreviewNote(newP, alias, dateISO, dateFmt, startStr, endStr) {
  if (!startStr || !endStr || !dateFmt) return '';
  var pred = ccfppPredecessorFor_({
    phn: newP.phn, last: newP.last, first: newP.first, dob: newP.dob,
    date: dateFmt, startTime: startStr, endTime: endStr
  }, alias);
  return pred ? ('CCFPP: ' + pred.name + ' (' + pred.phn + ')') : '';
}

// Recompute + REPLACE CCFPP notes for every modifier-eligible consult of
// `alias` whose date is in dateFmts. Pass the changed consult's date ±1 day
// (cross-midnight). For each consult, set its 120x modifier claims' CCFPP to
// the single most-recent overlapping predecessor — or clear it. Pushes only
// the claims that actually changed. Call after any consult add/edit/delete.
function ccfppRecomputeForAliasDates_(alias, dateFmts) {
  if (!alias || !dateFmts || !dateFmts.length) return;
  var dateSet = {};
  dateFmts.forEach(function(d){ if (d) dateSet[d] = true; });

  var consults = st.claims.filter(function(c){
    return c.alias === alias &&
           (c.fee === '33010' || c.fee === '33012') &&
           c.startTime && c.endTime && dateSet[c.date];
  });

  var changed = [];
  consults.forEach(function(consult){
    var pred = ccfppPredecessorFor_(consult, alias);
    var note = pred ? ('CCFPP: ' + pred.name + ' (' + pred.phn + ')') : '';
    for (var j = 0; j < st.claims.length; j++) {
      var mc = st.claims[j];
      if (mc.alias !== alias) continue;
      if (mc.date  !== consult.date) continue;
      if (!_ccfppPhnEq(mc.phn, consult.phn)) continue;
      // v4.49b: CCFPP is a non-rejection flag, so stamp it on ALL of this
      // consult's time-based claims — the 33010/33012 row AND the 12xx
      // modifier claims (was 12xx-only).
      if (CCFPP_MODIFIER_FEES.indexOf(mc.fee) === -1 &&
          mc.fee !== '33010' && mc.fee !== '33012') continue;
      var merged = _ccfppMerge(_ccfppStrip(mc.notes), note);
      if (merged !== String(mc.notes || '')) {
        mc.notes = merged;
        changed.push(mc);
      }
    }
  });

  if (changed.length) {
    sv('claims', st.claims);
    if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) {
      changed.forEach(function(mc){ push('saveClaim', mc); });
    }
  }
}

// Convenience: recompute the 3-day window around one date (the caller's
// consult date), covering cross-midnight predecessors/successors.
function ccfppRecomputeAround_(alias, dateFmt) {
  if (!alias || !dateFmt) return;
  var d = parseDMY(dateFmt);
  if (!d || isNaN(d)) { ccfppRecomputeForAliasDates_(alias, [dateFmt]); return; }
  var prev = pad(new Date(d.getTime() - 86400000).getDate()) + '/' + pad(new Date(d.getTime() - 86400000).getMonth() + 1) + '/' + new Date(d.getTime() - 86400000).getFullYear();
  var next = pad(new Date(d.getTime() + 86400000).getDate()) + '/' + pad(new Date(d.getTime() + 86400000).getMonth() + 1) + '/' + new Date(d.getTime() + 86400000).getFullYear();
  ccfppRecomputeForAliasDates_(alias, [prev, dateFmt, next]);
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

// v4.26: Normalize referring physician names to "Dr. Last, First" format.
// The Physicians tab returns this format; the local hardcoded list sometimes
// wrote "Last,First" (no "Dr.", no space after comma). This catches both
// paths so exported data is consistent regardless of lookup source.
function normalizeRefName(name) {
  if (!name) return name;
  var n = String(name).trim();
  if (!n) return '';
  // Already prefixed — just ensure space after comma
  if (/^Dr[\.\s]/i.test(n)) return n.replace(/,(\S)/, ', $1');
  // Looks like "Last,First" or "Last, First" — add "Dr. " prefix + ensure spacing
  if (/^[A-Z][a-zA-Z' -]+,/.test(n)) return 'Dr. ' + n.replace(/,(\S)/, ', $1');
  // Unknown format — return as-is (manual entry, etc.)
  return n;
}

// ── Add Claim Helper ───────────────────────────────────
function addClaim(p, fee, feeCode, units, date, loc, startTime, notes, endTime, performingAlias, overrides) {
  // overrides: optional { icd, refby, refbyName } — per-claim diagnosis /
  // referring MD that ride on THIS claim row only. They never modify the
  // patient record. When absent, the claim inherits the patient's values.
  overrides = overrides || {};

  // v4.29: Calculate the correct CCU band at creation time using
  // cross-provider episode logic (ccuFeeForDate scans ALL providers).
  // Stores 1411/1421/1431 directly — no more CCU_DAILY placeholder.
  // Episode day 1 = 1411, days 2–7 = 1421, days 8–30 = 1431.
  // A gap (no CCU from anyone) resets to day 1.
  if (fee === 'CCU_DAILY' || fee === '1411' || fee === '1421' || fee === '1431') {
    fee     = ccuFeeForDate(p, date);
    feeCode = fee;
    units   = 1;
  }
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
    refbyName: normalizeRefName((overrides.refbyName != null && overrides.refbyName !== '') ? overrides.refbyName : (p.refbyName || '')),
    notes:     notes       || '',
    startTime: _start,
    endTime:   endTime || '',
    // v4.31: fields previously dropped — loc was accepted as a parameter
    // but never written; ward/room/dob/sex/fac/source were never captured.
    // Blank loc/fac/ward/room on 940+ existing claims trace to this gap.
    loc:       loc || 'I',
    fac:       p.fac || 'OA040',
    ward:      p.ward || '',
    room:      p.bed  || '',
    dob:       p.dob  || '',
    sex:       p.sex  || '',
    source:    'App',
    createdBy: (st.doc && st.doc.alias) || '',
    createdAt: Date.now()
  };
  // Dedup guard: never create two claims with same phn+date+fee+alias.
  // v4.21: CCU family comparison — treat CCU_DAILY/1411/1421/1431 as the
  // same fee for dedup purposes (a manual 1421 should not bypass an
  // existing CCU_DAILY on the same day).
  // v4.26: CCU dedup is CROSS-PHYSICIAN — only one cardiologist may bill
  // CCU care per patient per date, regardless of who submits. Other fee
  // codes still dedup per-alias only.
  var _ccuFamily = ['CCU_DAILY','1411','1421','1431'];
  var _isCCU = _ccuFamily.indexOf(c.fee) !== -1;
  var _dupClaim = null;
  var _dupCheck = st.claims.some(function(x) {
    if (!samePhn(x.phn, c.phn) || x.date !== c.date) return false;
    if (x.id === c.id) return false;
    if (_isCCU) {
      // Cross-physician: skip alias check for CCU family
      if (_ccuFamily.indexOf(x.fee) !== -1) { _dupClaim = x; return true; }
      return false;
    }
    // Non-CCU: per-alias dedup only
    if (x.alias !== c.alias) return false;
    return x.fee === c.fee;
  });
  if (_dupCheck) {
    // Signal block to callers (return null) and to showToast (suppress
    // success toasts that fire immediately after, before caller checks)
    window._claimBlockedAt = Date.now();
    if (_isCCU && _dupClaim && _dupClaim.alias !== c.alias) {
      showToast('Another physician (' + _dupClaim.alias + ') has already claimed CCU for this date — blocked', 'error');
    } else if (_isCCU) {
      showToast('CCU already claimed for this patient on ' + c.date + ' — blocked', 'error');
    } else {
      showToast('Duplicate ' + c.fee + ' already exists for ' + c.date + ' — blocked', 'error');
    }
    console.warn('Duplicate claim blocked:', c.fee, c.date, c.phn, _dupClaim ? 'existing alias=' + _dupClaim.alias : '');
    return null; // blocked — callers should check
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

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════