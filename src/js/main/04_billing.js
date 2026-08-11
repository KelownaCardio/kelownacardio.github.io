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

    // v4.92: a trimmed consult's CALL-OUT WINDOW can outlast its body — the
    // base block alone covers start+30 even when the consult ended earlier
    // (majority-portion rule). CCFPP exists precisely for overlap with that
    // window, so extend the peer's end to its 12xx rows' latest end before
    // testing. (Roberts 9:14–9:33 trimmed: his 1202 still runs to 9:44, so
    // Reid starting 9:33 correctly gets "CCFPP: Roberts".)
    for (var _mj = 0; _mj < st.claims.length; _mj++) {
      var _mc = st.claims[_mj];
      if (_mc.alias !== alias || _mc.date !== c.date) continue;
      if (!_ccfppPhnEq(_mc.phn, c.phn)) continue;
      if (CCFPP_MODIFIER_FEES.indexOf(_mc.fee) === -1 || !_mc.endTime) continue;
      var _me = t2m(_mc.endTime);
      var _ms2 = _mc.startTime ? t2m(_mc.startTime) : _me;
      if (_me < _ms2) _me += 1440;
      if (_isPrev) _me -= 1440; else if (_isNext) _me += 1440;
      if (_me > prevEndM) prevEndM = _me;
    }

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
//
// v4.86 — 08:00 majority-portion cutoff (WEEKDAYS only).
// A call-out stipend covers a 30-min block "or the major portion thereof",
// which MSP treats as ≥15 min (see the Out-of-Office Hours Premiums guide:
// a service crossing a designated-time boundary is payable only if ≥15 min
// falls inside the window). A weekday night call-out that STARTS at 07:46 or
// later leaves ≤14 min before the 08:00 cutoff — less than the majority of
// the 30-min block sits inside the 1800–0800 window — so no call-out premium
// may be added. 07:45 (exactly 15 min) still qualifies.
// This applies ONLY on weekdays: on weekends/stat holidays the ENTIRE day is
// designated time (1800–0800 hours, weekends, and statutory holidays), so the
// 08:00 cutoff does not apply and an early-morning call-out stays billable.
var CALLOUT_AM_CUTOFF_MIN = 8 * 60;          // 08:00 — end of the night window
var CALLOUT_MIN_WINDOW    = 15;              // majority of a 30-min block
function getModifier(timeStr, dateStr) {
  if (!dateStr) return null;
  var mins = -1;
  if (timeStr) {
    var parts = timeStr.split(':');
    mins = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
  }
  var weekendStat = isWeekendOrStat(dateStr);
  // Weekday-only: suppress the night tier when the start is in the final
  // <15 min before 08:00 (i.e. 07:46–07:59). On weekends/stats this window is
  // still fully designated time, so the tier is NOT suppressed there.
  var nightTooLateWeekday = !weekendStat &&
        mins >  (CALLOUT_AM_CUTOFF_MIN - CALLOUT_MIN_WINDOW) &&   // > 07:45
        mins <   CALLOUT_AM_CUTOFF_MIN;                            // < 08:00
  if (mins >= 0 && (mins >= 23*60 || mins < 8*60) && !nightTooLateWeekday)
    return { type:'night',   base:'1201', inc:'1206', label:'Night call (23:00–07:59)',   cls:'mod-night'   };
  if (weekendStat)
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

// v4.86 — 08:00 cut-off applied to INCREMENT periods (weekdays only).
// A call-out premium block (base OR increment) may only be added when its
// 30-min period STARTS at least 15 min before the 08:00 night-window cut-off
// (i.e. by 07:45) — the same "major portion of 30 min" rule used for the base.
// This caps the increment-unit count so no increment period begins at 07:46 or
// later, EVEN when the consult runs well past 45 min (e.g. a 07:15 consult that
// runs to 09:00 bills 1201 + one 1206 only; the 08:15 period is not billable).
// Only the night tier on weekdays has an 08:00 loss boundary; weekends/stats
// (whole day is designated time) and the evening tier (rolls into night at
// 23:00) have no such boundary and are left uncapped.
function calloutIncUnitsCapped(startTimeStr, dateStr, rawUnits) {
  if (!rawUnits || rawUnits < 1) return 0;
  var mod = getModifier(startTimeStr, dateStr);
  if (!mod || mod.type !== 'night') return rawUnits;   // no 08:00 loss boundary
  if (isWeekendOrStat(dateStr))       return rawUnits;   // weekend night = billable all day
  var startM = t2m(startTimeStr);
  var CUT = 8 * 60, WIN = 15;                            // 08:00 cut-off; need ≥15 min in-window
  var allowed = 0;
  for (var n = 1; n <= rawUnits; n++) {
    var pStart = (startM + 30 * n) % (24 * 60);          // clock start of increment period n
    // Billable only if the period starts by 07:45 (≥15 min before 08:00).
    // A start in 07:46–07:59, or at/after 08:00 into daytime, is not billable.
    var inMorningCut = (pStart > (CUT - WIN) && pStart < CUT);   // 07:46–07:59
    var inDaytime    = (pStart >= CUT && pStart < 18 * 60);      // 08:00–17:59
    if (inMorningCut || inDaytime) break;                        // periods are sequential
    allowed = n;
  }
  return allowed;
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
  // v4.79: optional per-claim dollar amount (echo bundles stamp the
  // professional-only portion here). Lands in the Claims 'feeAmount' column;
  // Invoice.gs uses it as the authoritative MSP-value rate for that claim.
  if (overrides.feeAmount != null && overrides.feeAmount !== '') {
    c.feeAmount = overrides.feeAmount;
  }
  // Dedup guard: never create two claims with same phn+date+fee+alias.
  // v4.21: CCU family comparison — treat CCU_DAILY/1411/1421/1431 as the
  // same fee for dedup purposes (a manual 1421 should not bypass an
  // existing CCU_DAILY on the same day).
  // v4.26: CCU dedup is CROSS-PHYSICIAN — only one cardiologist may bill
  // CCU care per patient per date, regardless of who submits. Other fee
  // codes still dedup per-alias only.
  // v4.92: the combined-visit form's DELIBERATE second daily (33008 ×2 for an
  // unstable patient) passes allowSecondDaily to skip this guard — it was
  // silently blocking the second visit. Everything else is unchanged.
  var _ccuFamily = ['CCU_DAILY','1411','1421','1431'];
  var _isCCU = _ccuFamily.indexOf(c.fee) !== -1;
  var _dupClaim = null;
  // v4.94: an EXACT duplicate (same doctor, same patient, same day, same fee)
  // is no longer a dead end. The doctor is toasted, then asked for the real
  // service time + a MANDATORY note explaining the second service; with both
  // supplied the claim is created and a dup_claim_allowed audit row is written.
  // MSP pays a same-day repeat only when it is timed and justified — this
  // captures both while the doctor still remembers why.
  // (Kathryn 2026-08-11. CCU-family stays a HARD block: it is cross-physician
  // and a second CCU day is never a legitimate second service.)
  var _dupCheck = ((overrides.allowSecondDaily && c.fee === '33008') ||
                   (overrides.allowDuplicate && String(overrides.dupNote || '').trim() &&
                    ['CCU_DAILY','1411','1421','1431'].indexOf(c.fee) === -1)) ? false :
  st.claims.some(function(x) {
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
    if (_isCCU) {
      if (_dupClaim && _dupClaim.alias !== c.alias) {
        showToast('Another physician (' + _dupClaim.alias + ') has already claimed CCU for this date — blocked', 'error');
      } else {
        showToast('CCU already claimed for this patient on ' + c.date + ' — blocked', 'error');
      }
      console.warn('Duplicate CCU claim blocked:', c.fee, c.date, c.phn);
      return null;                                   // CCU: hard block, unchanged
    }
    // v4.94: non-CCU exact duplicate → toast, then the note-required sheet.
    showToast('Already billed ' + c.fee + ' for this patient on ' + c.date +
              ' — add a time and a note to bill it again', 'error');
    openDupClaimSheet({
      p: p, fee: fee, feeCode: feeCode, units: units, date: date, loc: loc,
      startTime: startTime, notes: notes, endTime: endTime,
      performingAlias: performingAlias, overrides: overrides
    }, _dupClaim, c);
    console.warn('Duplicate claim held for note:', c.fee, c.date, c.phn);
    return null; // held for a note — callers should check
  }
  // v4.94: an accepted duplicate carries its justification in `notes` (which
  // travels to MSP on the claim) and leaves a dup_claim_allowed row in the
  // ChangeLog — deliberately NOT a hidden Claims column, so the audit trail
  // lives where Kathryn already reads it and no schema change is forced on a
  // live billing sheet mid-quarter.
  if (overrides.allowDuplicate && String(overrides.dupNote || '').trim()) {
    c.notes          = String(overrides.dupNote).trim();
    c.allowDuplicate = true;                         // read server-side (Crud v3.17)
    c.dupOfId        = overrides.dupOfId || '';
    c.dupNoteAt      = new Date().toISOString();
    // Uses the EXISTING logChange action — no new Router endpoint. The
    // authoritative ISO-stamped row is written server-side by Crud v3.17
    // (dup_claim_allowed); this one puts it in the doctor's local log too.
    logChange(p, 'Second ' + c.fee + ' billed (duplicate)',
      c.date + ' at ' + (c.startTime || '(no time)') + ' — ' + c.notes);
  }
  st.claims.push(c);
  // v4.90 ATOMIC ADD-PATIENT: when the Add-Patient screen is building its
  // claim bundle, claims are COLLECTED instead of pushed one-by-one — the
  // caller sends patient + all claims in ONE savePatientWithClaims request.
  // Root cause (Cornish 2026-08-05): this fire-and-forget push() was the only
  // save the bundled consult ever got; a transient failure + app close lost
  // it silently while the awaited patient save landed. Outside the Add-Patient
  // flow (window._batchClaimCollect null) behaviour is unchanged.
  if (window._batchClaimCollect) {
    window._batchClaimCollect.push(c);
  } else if (SHEETS_URL) {
    push('saveClaim', c);
  }
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

// ── v4.92: same-doctor consult overlap + dynamic modifier rebuild ──────────
// Two claims by one doctor cannot be on the clock at once. Consult BODIES
// never overlap — the earlier consult's end is trimmed to the later one's
// start. Call-out modifier WINDOWS may overlap when the later claim carries
// a CCFPP note (that is what CCFPP exists for). All modifier arithmetic is
// re-derived from current times on EVERY change — tier (evening/night/
// weekend) from the new start, increment count from the new duration, the
// 07:45 weekday cap, and CCFPP notes. Nothing is cached.

// The latest-starting timed 33010/33012 of `alias` on dateFmt (± not
// cross-midnight — the guard covers same-day batch entry) that overlaps
// [startStr, endStr), excluding excludePhn's own claims. Null if none.
function consultOverlapPeer_(alias, dateFmt, startStr, endStr, excludePhn) {
  if (!alias || !dateFmt || !startStr || !endStr) return null;
  var s = t2m(startStr), e = t2m(endStr);
  if (e < s) e += 1440;
  var best = null, bestS = -1;
  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (c.alias !== alias || c.date !== dateFmt) continue;
    if (c.fee !== '33010' && c.fee !== '33012') continue;
    if (!c.startTime || !c.endTime) continue;
    if (excludePhn && _ccfppPhnEq(c.phn, excludePhn)) continue;
    var cs = t2m(c.startTime), ce = t2m(c.endTime);
    if (ce < cs) ce += 1440;
    if (s < ce && cs < e && cs > bestS) { best = c; bestS = cs; }
  }
  return best;
}

// Re-derive a consult's 12xx call-out claims from its CURRENT times.
// Updates rows in place where possible (dodges addClaim's dedup guard),
// deletes rows that no longer apply, adds ones that newly do. Does NOT
// sv/push the UPDATED rows — returns them for the caller to persist in one
// place; deletions and brand-new rows are pushed here (addClaim pushes its
// own row). Call ccfppRecomputeAround_ after persisting.
function rebuildConsultModifiers_(consult) {
  if (!consult || !consult.date) return [];
  var alias = consult.alias, dateFmt = consult.date;
  var d = parseDMY(dateFmt);
  if (!d || isNaN(d)) return [];
  var dateISO = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  var start = consult.startTime || '', end = consult.endTime || '';

  var mods = st.claims.filter(function(c){
    return c.alias === alias && c.date === dateFmt &&
           _ccfppPhnEq(c.phn, consult.phn) &&
           CCFPP_MODIFIER_FEES.indexOf(c.fee) !== -1;
  });
  var BASE_FEES = ['1200','1201','1202'], INC_FEES = ['1205','1206','1207'];
  var baseRows = mods.filter(function(c){ return BASE_FEES.indexOf(c.fee) !== -1; });
  var incRows  = mods.filter(function(c){ return INC_FEES.indexOf(c.fee)  !== -1; });

  var modBase  = (start && end) ? getModifier(start, dateISO) : null;
  var incRaw   = modBase ? consultIncUnits(start, end) : 0;
  var incUnits = modBase ? calloutIncUnitsCapped(start, dateISO, incRaw) : 0;
  var _sM = start ? t2m(start) : 0;
  var changed = [];

  function delRow(c) {
    st.claims = st.claims.filter(function(x){ return String(x.id) !== String(c.id); });
    if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) push('deleteClaim', { id: c.id });
  }
  baseRows.slice(1).forEach(delRow);          // never more than one of each
  incRows.slice(1).forEach(delRow);
  var baseRow = baseRows[0] || null, incRow = incRows[0] || null;

  // Patient object for addClaim — fall back to a synth from the claim row so
  // a pulled/archived patient still rebuilds correctly.
  var pat = (st.patients || []).find(function(pp){ return _ccfppPhnEq(pp.phn, consult.phn); }) ||
            { phn: consult.phn, last: consult.last, first: consult.first, dob: consult.dob,
              sex: consult.sex, icd: consult.icd, refby: consult.refby,
              refbyName: consult.refbyName, fac: consult.fac, ward: consult.ward,
              bed: consult.room };
  var userNote = _ccfppStrip(consult.notes);  // CCFPP re-stamped by recompute
  var ov = { icd: consult.icd, refby: consult.refby, refbyName: consult.refbyName };

  if (modBase) {
    var baseEnd = minsToTime((_sM + 30) % 1440);
    if (baseRow) {
      if (baseRow.fee !== modBase.base || baseRow.startTime !== start ||
          baseRow.endTime !== baseEnd || String(baseRow.units || 1) !== '1') {
        baseRow.fee = modBase.base; baseRow.feeCode = modBase.base;
        baseRow.startTime = start; baseRow.endTime = baseEnd; baseRow.units = 1;
        changed.push(baseRow);
      }
    } else {
      addClaim(pat, modBase.base, modBase.base, 1, dateFmt, consult.loc || 'I',
               start, userNote || null, baseEnd, alias, ov);
    }
    if (incUnits > 0) {
      var incStart = minsToTime((_sM + 30) % 1440);
      var incEnd   = (incUnits < incRaw)
        ? minsToTime((_sM + 30 + 30 * incUnits) % 1440)
        : end;
      if (incRow) {
        if (incRow.fee !== modBase.inc || incRow.startTime !== incStart ||
            incRow.endTime !== incEnd || String(incRow.units) !== String(incUnits)) {
          incRow.fee = modBase.inc; incRow.feeCode = modBase.inc;
          incRow.startTime = incStart; incRow.endTime = incEnd; incRow.units = incUnits;
          changed.push(incRow);
        }
      } else {
        addClaim(pat, modBase.inc, modBase.inc, incUnits, dateFmt, consult.loc || 'I',
                 incStart, userNote || null, incEnd, alias, ov);
      }
    } else if (incRow) {
      delRow(incRow);
    }
  } else {
    if (baseRow) delRow(baseRow);
    if (incRow)  delRow(incRow);
  }
  return changed;
}

// Apply new start/end to a consult claim and cascade everything dynamic:
// its own row, its 12xx blocks (rebuilt), and CCFPP notes for the whole
// alias/date neighbourhood. Persists all changed rows. Returns true.
function applyConsultTimes_(consult, newStart, newEnd) {
  if (!consult) return false;
  consult.startTime = newStart;
  consult.endTime   = newEnd;
  var changed = rebuildConsultModifiers_(consult);
  sv('claims', st.claims);
  if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) {
    push('saveClaim', consult);
    changed.forEach(function(mc){ push('saveClaim', mc); });
  }
  ccfppRecomputeAround_(consult.alias, consult.date);
  return true;
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

// ══════════════════════════════════════════════════════════════════════
// v4.94 — DUPLICATE CLAIM: TOAST → TIME + MANDATORY NOTE → BILL IT
// ══════════════════════════════════════════════════════════════════════
// Kathryn, 2026-08-11: an exact duplicate (same doctor, same patient, same
// day, same fee code) must not be a dead end — the second service is often
// real (patient re-reviewed, deteriorated, called back). MSP will pay it only
// if it is TIMED and JUSTIFIED, so both are captured here, at the moment the
// doctor still remembers why, and the claim is then created normally.
//
// Injected DOM (same approach as the v4.92 Day Timeline sheet) so no
// index.template.html change is needed and this ships frontend-only.
var _dupSheetArgs = null;

function openDupClaimSheet(args, existing, pending) {
  args.dupOfId = (existing && existing.id) || '';
  _dupSheetArgs = args;
  var el = document.getElementById('dup-claim-sheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dup-claim-sheet';
    el.className = 'overlay top';
    document.body.appendChild(el);
  }
  var name = [pending.last, pending.first].filter(Boolean).join(', ');
  var exTime = (existing && existing.startTime) ? existing.startTime : '';
  el.innerHTML =
    '<div class="modal">' +
      '<div class="modal-title">Already billed today</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-top:-8px;margin-bottom:10px">' +
        esc(name) + ' &middot; ' + esc(pending.fee) + ' &middot; ' + esc(pending.date) +
        ' &middot; ' + esc(pending.alias) +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2);background:var(--amber-bg);' +
           'border:.5px solid var(--amber-t);border-radius:8px;padding:8px 10px;margin-bottom:12px">' +
        'You already have a ' + esc(pending.fee) + ' on this patient for ' + esc(pending.date) +
        (exTime ? ' at <b>' + esc(exTime) + '</b>' : ' (no time recorded)') + '.<br>' +
        'To bill a second one, give the time of the second service and say why.' +
      '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">' +
        'TIME OF THIS SECOND SERVICE</div>' +
      '<input id="dup-time" type="time" class="inp" style="width:100%;margin-bottom:12px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">' +
        'WHY A SECOND ' + esc(pending.fee) + '? (required &mdash; goes on the claim)</div>' +
      '<textarea id="dup-note" class="inp" rows="3" style="width:100%;resize:vertical" ' +
        'placeholder="e.g. Recalled to ward 14:20 for new chest pain and ECG changes"></textarea>' +
      '<div id="dup-err" style="display:none;font-size:12px;color:var(--red-t);margin-top:8px"></div>' +
      '<div class="divider"></div>' +
      '<button class="btn" style="width:100%;margin:0 0 8px" onclick="confirmDupClaim()">' +
        'Bill the second ' + esc(pending.fee) + '</button>' +
      '<button class="btn btn-s" style="width:100%;margin:0" onclick="cancelDupClaim()">Cancel</button>' +
    '</div>';
  el.classList.add('on');
  // Prefill with the current clock time — the doctor corrects it if the
  // service was earlier. Never auto-accepted without them seeing it.
  var t = document.getElementById('dup-time');
  if (t) {
    var n = new Date();
    t.value = ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2);
  }
  var nt = document.getElementById('dup-note');
  if (nt) setTimeout(function() { try { nt.focus(); } catch (e) {} }, 80);
}

function cancelDupClaim() {
  _dupSheetArgs = null;
  var el = document.getElementById('dup-claim-sheet');
  if (el) el.classList.remove('on');
}

function confirmDupClaim() {
  var a = _dupSheetArgs;
  if (!a) return cancelDupClaim();
  var note = (document.getElementById('dup-note') || {}).value || '';
  var time = (document.getElementById('dup-time') || {}).value || '';
  var err  = document.getElementById('dup-err');
  var show = function(m) { if (err) { err.textContent = m; err.style.display = 'block'; } };

  // MANDATORY — both. No note, no claim.
  if (!String(note).trim()) return show('A note is required to bill a second ' + a.fee + '.');
  if (String(note).trim().length < 8) return show('Give a little more detail — this note is what justifies the repeat claim to MSP.');
  if (!time) return show('Enter the time of the second service.');

  var ov = {};
  for (var k in (a.overrides || {})) ov[k] = a.overrides[k];
  ov.allowDuplicate = true;
  ov.dupNote        = String(note).trim();
  ov.dupOfId        = (a.dupOfId || '');

  cancelDupClaim();
  var made = addClaim(a.p, a.fee, a.feeCode, a.units, a.date, a.loc,
                      time,                       // service time -> startTime
                      String(note).trim(),
                      a.endTime, a.performingAlias, ov);
  if (made) {
    sv('claims', st.claims);
    showToast('Second ' + a.fee + ' billed at ' + time + ' with your note');
  }
}
