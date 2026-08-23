// 07_consult.js — Unified consult form (33010/33012)
//
// ONE consult form, shared by the +Claim screen and the Add Patient
// screen. Built on the Add Patient template: flat layout, no claims-
// preview card. Diagnosis + referring MD pre-fill from the patient but
// are editable per-claim — a per-claim change rides on the claim row
// only and never rewrites the patient's baseline record.
// ═══════════════════════════════════════════════════════

// MOST toggle state — reset to ON every time a fresh consult form builds.
var _mostOn = true;

// Which screen the consult form is on — set by the caller (+Claim vs Add
// Patient) so the live CCFPP field can resolve the right patient context.
var _consultCtx = 'claim';

// ── v4.93 Call-out Decision card state — reset by buildConsultForm ────────
// _codChoice: the doctor's pick in the proximity card (Scenario B) —
//   null (none yet, submit blocked) | 'ccfpp' | 'newcall'.
// _codChoicePhn: the predecessor phn _codChoice was made against — if the
//   doctor edits times such that the predecessor changes, the stale choice
//   is discarded and they're asked again (see updateConsultUI).
// _codOverlapOrigin: sticky — set the first time THIS consult entry hits a
//   genuine time overlap (Scenario C). Once true, this consult is ALWAYS
//   sequential/CCFPP once the conflict resolves — no "new call-back" option
//   is ever offered for it, matching Kathryn's "these are sequential claims"
//   rule. Cleared only by a fresh buildConsultForm.
// _codChoice1Open: whether Scenario C's "Shorten predecessor's consult"
//   pill is expanded to show its Apply control.
var _codChoice = null;
var _codChoicePhn = null;
var _codOverlapOrigin = false;
var _codChoice1Open = false;

// ── Element scoping (v3.97) ────────────────────────────────────────
// buildConsultForm renders FIXED ids (cb-33010, cb-33012, cb-date,
// cb-start, …) and is instantiated in TWO screens that both stay in the
// DOM at once — the +Claim screen (#claim-body) and the Add Patient
// screen (#ap-claim-area). So document.getElementById('cb-…') is
// AMBIGUOUS: it returns whichever form is first in document order, not
// the one the user is actually filling in.
//
// That was the consult-corruption bug: a consult entered on the +Claim
// screen was submitted by reading the OTHER screen's stale form — whose
// date input still held its default (today) and whose 33010 button had
// been stripped of its selected class — so the claim wrote out as
// 33012 + today regardless of what was typed.
//
// Fix: every cb-* lookup is scoped to the active form's container,
// chosen by _consultCtx (set to 'claim' by selCT, 'addpatient' by
// initAddPatientConsult). Use cEl / cVal for EVERY cb-* element — never
// document.getElementById or the global gv() for a cb-* id.
function consultRoot() {
  var id = (_consultCtx === 'addpatient') ? 'ap-claim-area' : 'claim-body';
  return document.getElementById(id) || document;
}
function cEl(id)  { return consultRoot().querySelector('#' + id); }
function cVal(id) { var e = cEl(id); return e ? e.value : ''; }

// The patient the consult form is currently for.
function currentConsultPatient() {
  if (_consultCtx === 'addpatient') {
    // Add Patient — patient not created yet; build it from the form fields.
    return { phn: gv('f-phn') || '', last: gv('f-last') || '', first: gv('f-first') || '' };
  }
  return getP(_claimPid) || {};
}

// p may be a real patient object (+Claim screen) or {} on the Add Patient
// screen (the patient does not exist yet — fields simply render blank).
// opts.withSubmit — +Claim shows its own submit button; Add Patient uses
// the screen's own submit buttons, so it passes { withSubmit:false }.
function buildConsultForm(p, opts) {
  p    = p    || {};
  opts = opts || {};
  var withSubmit = opts.withSubmit !== false;

  // A freshly-built form always renders MOST as ON — keep the global in sync.
  _mostOn = true;
  // v4.93: a freshly-built form always starts with no Call-out Decision made.
  _codChoice = null; _codChoicePhn = null; _codOverlapOrigin = false; _codChoice1Open = false;

  var now      = new Date();
  var todayISO = localISODate(now);
  var nowTime  = pad(now.getHours()) + ':' + pad(now.getMinutes());
  var endTime  = minsToTime(now.getHours() * 60 + now.getMinutes() + 50);
  // 12-hour clock display + AM/PM pill state for the prefilled now / now+50.
  var sV = _cbTo12(nowTime);
  var eV = _cbTo12(endTime);

  var h = '<div class="card">';
  h += '<div class="card-title">Consult</div>';

  // 33010 / 33012 toggle
  h += '<div class="fl" style="margin-bottom:9px">' +
       '<button id="cb-33010" class="ct-btn ct-on-consult" style="flex:1" onclick="toggleConsultCode(\'33010\')">33010 — Full</button>' +
       '<button id="cb-33012" class="ct-btn" style="flex:1" onclick="toggleConsultCode(\'33012\')">33012 — Limited</button>' +
       '</div>';

  // v4.83: RACE admit — the consult was billed in the RACE clinic, so this
  // mode adds NO consult fee. Full workflow otherwise (referring MD, dx,
  // location, list); the MOST button below still adds the 78720.
  // Auto-selected when the ward is Race Admit (locWardChange / selCT hooks).
  h += '<button id="cb-race" class="ct-btn" style="width:100%;margin-bottom:9px" onclick="toggleConsultCode(\'RACE\')">' +
       'RACE admit — consult billed in clinic (no consult fee)</button>';
  h += '<div id="cb-race-note" style="display:none;font-size:11px;color:var(--text3);' +
       'border:.5px solid var(--border2);border-radius:var(--rsm);padding:7px 9px;margin-bottom:9px">' +
       'No 33010/33012 will be added — the consult is billed through the RACE clinic. ' +
       'Referring MD and diagnosis below ride on the MOST (78720) claim.</div>';

  // MOST button
  h += '<button class="most-btn on" id="cb-most" onclick="toggleMost()">' +
       '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
       '+ MOST (78720)</button>';

  // Date + Start time (pre-filled with now).
  // Time field: numeric keypad (inputmode), tap-to-clear on focus (the prior
  // value is restored on a blank blur so a stray tap can't wipe it), and an
  // AM / PM pill pair. Type 24h (e.g. 1430) and the PM pill locks itself and
  // the field normalises to the 12h clock number; type an ambiguous clock
  // number (e.g. 7) and the pill keeps the smart default — see _cbReadMeridiem.
  h += '<div class="fl">' +
       '<div class="f1"><label>Date</label>' +
       '<input type="date" id="cb-date" value="' + todayISO + '" oninput="updateConsultUI()"></div>' +
       '<div class="f1" id="cb-start-wrap"><label>Start time</label>' +
       _cbTimeRow('start', sV) +
       '</div>' +
       '</div>';

  // End time — defaults to start + 50, doctor adjusts if shorter
  h += '<div class="fl" id="cb-end-row" style="margin-bottom:9px">' +
       '<div class="f1"><label>End time' +
       '<span style="font-size:10px;color:var(--text3)"> — defaults to 50 min, adjust as needed</span></label>' +
       _cbTimeRow('end', eV) +
       '</div>' +
       '</div>';

  // Modifier banner
  h += '<div id="cb-mod"></div>';

  // v4.93: the "Call-out decision" card — replaces the passive CCFPP box
  // whenever a nearby same-doctor call-out consult makes CCFPP an explicit
  // choice (Scenario B, ≤60 min proximity) or a genuine time conflict needs
  // resolving before this claim can be saved (Scenario C). Empty until
  // updateConsultUI decides which (if either) applies.
  h += '<div id="cb-cod"></div>';

  // Live CCFPP field — passive fallback for the case NEITHER of the above
  // applies (predecessor, if any, is >60 min away or none exists). Hidden
  // whenever cb-cod is showing a card. Read-only: the note is appended to
  // the 120x modifier claims automatically at submit.
  h += '<div id="cb-ccfpp" style="margin-top:9px;padding:8px 10px;border-radius:var(--rsm);' +
       'border:1px solid var(--border2);background:var(--surface2)">' +
       '<div style="font-size:10px;font-weight:700;color:var(--text3);' +
       'text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">CCFPP — continuing care</div>' +
       '<div id="cb-ccfpp-val" style="font-size:13px;color:var(--text3);font-weight:600">—</div>' +
       '</div>';

  // Notes — folded into the consult card (Add Patient template style)
  h += '<label style="margin-top:9px">Notes <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></label>';
  h += '<textarea id="cb-notes" rows="2" placeholder="Add any claim notes..." autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:0"></textarea>';
  h += '</div>'; // end consult card

  // Diagnosis + referring MD + performing physician.
  // Pre-filled from the patient; editable per-claim (rides on the claim row,
  // does not overwrite the patient baseline).
  h += buildIcdRefCard(p);

  if (withSubmit) {
    h += '<button class="btn btn-p" id="cb-submit-btn" onclick="claimSubmitOnce(submitConsult)">Add consult claims</button>';
  }
  return h;
}

// ── Time field + AM/PM pill helpers ────────────────────────────────
// The visible time field holds a 12-hour clock number ("2:30"); the AM/PM
// pill carries the meridiem. The canonical 24-hour value the rest of the
// app reads is always recomputed from field + pill by consultTime24().
//
// All element lookups are container-scoped via cEl (v3.97), so the +Claim
// and Add Patient forms — both live in the DOM at once — never read each
// other's pills. Pill ids: cb-{which}-am / cb-{which}-pm; the selected one
// carries the ct-on-consult class (the existing blue "on" style).

// Current half of the day — the smart default for an ambiguous clock number.
function _cbCurrentHalf() { return (new Date()).getHours() >= 12 ? 'pm' : 'am'; }

// 24h "HH:MM" → { disp:"h:mm" (12h clock), ap:"am"|"pm" }.
function _cbTo12(t24) {
  var p = String(t24 || '').split(':');
  var h = parseInt(p[0], 10);
  var m = p[1] || '00';
  if (isNaN(h)) return { disp: '', ap: '' };
  var ap = h >= 12 ? 'pm' : 'am';
  var ch = h % 12; if (ch === 0) ch = 12;
  return { disp: ch + ':' + m, ap: ap };
}

// Markup for one time field: numeric input + AM/PM pills, pill v pre-selected.
function _cbTimeRow(which, v) {
  function pill(ap, label) {
    var on = (v && v.ap === ap) ? ' ct-on-consult' : '';
    return '<button id="cb-' + which + '-' + ap + '" class="ct-btn' + on + '" ' +
           'style="flex:0 0 42px;padding:10px 0;font-size:12px" ' +
           'onclick="cbSetMeridiem(\'' + which + '\',\'' + ap + '\')">' + label + '</button>';
  }
  return '<div style="display:flex;gap:5px;align-items:stretch">' +
         '<input type="text" id="cb-' + which + '" inputmode="numeric" autocorrect="off" ' +
         'value="' + ((v && v.disp) || '') + '" placeholder="2:30" ' +
         'style="flex:1;min-width:0;font-size:16px" ' +
         'onfocus="this.dataset.prev=this.value;this.value=\'\'" ' +
         'oninput="updateConsultUI()" onblur="cbTimeBlur(\'' + which + '\')">' +
         pill('am', 'AM') + pill('pm', 'PM') +
         '</div>';
}

// Which meridiem pill is selected for this field — '' if neither (shouldn't
// happen after a blur, but consultTime24 falls back to the smart default).
function cbMeridiem(which) {
  var pm = cEl('cb-' + which + '-pm');
  if (pm && pm.classList.contains('ct-on-consult')) return 'pm';
  var am = cEl('cb-' + which + '-am');
  if (am && am.classList.contains('ct-on-consult')) return 'am';
  return '';
}

// Set the meridiem pill (and recolour the pair). silent=true skips the UI
// refresh — used while building/normalising to avoid recursion.
function cbSetMeridiem(which, ap, silent) {
  var am = cEl('cb-' + which + '-am');
  var pm = cEl('cb-' + which + '-pm');
  if (am) am.className = 'ct-btn' + (ap === 'am' ? ' ct-on-consult' : '');
  if (pm) pm.className = 'ct-btn' + (ap === 'pm' ? ' ct-on-consult' : '');
  if (!silent) updateConsultUI();
}

// Ensure a pill is chosen for an ambiguous entry: smart default if none yet.
function _cbEnsureMeridiem(which) {
  if (!cbMeridiem(which)) cbSetMeridiem(which, _cbCurrentHalf(), true);
}

// Write a 24h value into the field as a 12h display + matching pill.
function cbSetTime(which, t24) {
  var v  = _cbTo12(t24);
  var el = cEl('cb-' + which);
  if (el) el.value = v.disp;
  if (v.ap) cbSetMeridiem(which, v.ap, true);
}

// Canonical 24h "HH:MM" from field text + pill. '' if the field is blank or
// unparseable. An explicit 24h hour (13–23, or 00) is honoured as typed; a
// 1–12 clock number is combined with the pill (smart default if unset).
function consultTime24(which) {
  var t = parseTime24(cVal('cb-' + which));
  if (!t) return '';
  var p = t.split(':');
  var h = parseInt(p[0], 10);
  var m = p[1];
  if (h >= 13) return t;                         // 1430 → 14:30, unambiguous PM
  var ap = cbMeridiem(which) || _cbCurrentHalf();
  var H  = h % 12;                               // 12 → 0
  if (ap === 'pm') H += 12;                       // 7pm → 19, 12pm → 12 (noon)
  return pad(H) + ':' + m;                        // 12am/0 → 00 (midnight)
}

// Blur handler: restore a stray-cleared field, then normalise the display.
function cbTimeBlur(which) {
  var el = cEl('cb-' + which);
  if (!el) return;
  if (el.value.trim() === '' && el.dataset.prev) el.value = el.dataset.prev; // undo accidental clear
  var t = parseTime24(el.value);
  if (!t) { updateConsultUI(); return; }          // blank/garbage: leave for validation
  var h = parseInt(t.split(':')[0], 10);
  if (h >= 13 || h === 0) {
    cbSetTime(which, t);                          // unambiguous 24h → 12h + locked pill
  } else {
    _cbEnsureMeridiem(which);                     // ambiguous → keep/seed smart-default pill
    el.value = h + ':' + t.split(':')[1];         // tidy to a clean clock number
  }
  updateConsultUI();
}


function toggleConsultCode(code) {
  // v4.83: third mode 'RACE' — no consult fee (billed in the RACE clinic).
  // Hides the time fields + modifier banner (nothing here carries times);
  // the date stays because it dates the MOST claim.
  var race = (code === 'RACE');
  cEl('cb-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  cEl('cb-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
  var rBtn = cEl('cb-race');
  if (rBtn) rBtn.className = 'ct-btn' + (race ? ' ct-on-consult' : '');
  ['cb-start-wrap', 'cb-end-row', 'cb-mod', 'cb-cod'].forEach(function(id) {
    var el = cEl(id);
    if (el) el.style.display = race ? 'none' : '';
  });
  var note = cEl('cb-race-note');
  if (note) note.style.display = race ? 'block' : 'none';
  if (!race) updateConsultUI();
  // v4.95: entering RACE mode hides the Call-out Decision card without
  // re-running updateConsultUI — if the card had submit disabled, nothing
  // would ever re-enable it (RACE has no times, so no decision applies).
  // Re-enable explicitly; leaving RACE re-evaluates via updateConsultUI above.
  else _codUpdateSubmitBtn(false);
}

// v5.03: inline start-time adjust from the "second modifier will not apply"
// banner (see updateConsultUI). Writes the picked 24h time into the start
// field via cbSetTime (12h display + am/pm pill), then re-renders — the
// modifier banner recomputes immediately. End time is left untouched on
// purpose: the doctor is correcting when the consult BEGAN.
function _incAdjustStart(t24) {
  if (!t24) return;
  cbSetTime('start', t24);
  updateConsultUI();
}

function toggleMost() {
  _mostOn = !_mostOn;
  cEl('cb-most').className = 'most-btn' + (_mostOn ? ' on' : '');
}

// 24h "HH:MM" (minutes may exceed 1440 for a past-midnight extension) → a
// 12h clock display, e.g. "12:42 AM". Shared by the Call-out Decision card.
function _codFmt12(mins) {
  var m = ((mins % 1440) + 1440) % 1440;
  var v = _cbTo12(minsToTime(m));
  return v.disp + ' ' + v.ap.toUpperCase();
}

// The consult claim row for a given phn on this alias/date (used to look up
// a decision-card predecessor's own display fields).
function _codConsultRow(alias, dateFmt, phn) {
  return st.claims.find(function(c){
    return c.alias === alias && c.date === dateFmt &&
           (c.fee === '33010' || c.fee === '33012') && _ccfppPhnEq(c.phn, phn);
  }) || null;
}

// Live reference to the current overlap peer's claim row — set on every
// updateConsultUI pass so the Scenario C handlers below can act on it.
var _codOverlapPeerClaim = null;
// Which side of the overlap this consult is on — 'later' (this consult is
// the one that would run into an EARLIER-starting peer; the normal case:
// this consult links to the peer as its predecessor) or 'earlier' (this
// consult was entered starting BEFORE an already-saved later consult; no
// CCFPP forcing on THIS consult — only the raw time conflict is resolved,
// the other consult's own linkage is re-derived by ccfppRecomputeAround_
// once this one saves).
var _codOverlapSide = null;

function updateConsultUI() {
  if (!cEl('cb-mod')) return; // form not on screen
  var start   = consultTime24('start');
  var end     = consultTime24('end');
  var dateISO = cVal('cb-date');

  // End follows start (start + 50 min) unless the doctor edited end directly.
  var changed = (typeof event !== 'undefined' && event && event.target) ? event.target.id : '';
  var startChanged = changed === 'cb-start' || changed === 'cb-start-am' || changed === 'cb-start-pm';
  if (start && startChanged) {
    cbSetTime('end', minsToTime(t2m(start) + 50));
    end = consultTime24('end');
  }

  var modBase  = getModifier(start, dateISO);
  var modEl    = cEl('cb-mod');
  var codEl    = cEl('cb-cod');
  var ccEl     = cEl('cb-ccfpp');
  var alias    = getPerformingAlias();
  var pat      = currentConsultPatient();
  var dateFmtNow = dateISO ? fmtD(parseISODate(dateISO)) : null;

  // ── v4.93: Call-out Decision — figure out which (if either) card applies
  // BEFORE rendering the modifier banner, so banner + card always agree. ──
  var overlapPeer = (start && end && dateFmtNow)
    ? consultOverlapPeer_(alias, dateFmtNow, start, end, pat.phn) : null;
  _codOverlapPeerClaim = overlapPeer;

  if (overlapPeer) {
    _codOverlapSide = (t2m(overlapPeer.startTime) <= t2m(start)) ? 'later' : 'earlier';
    if (_codOverlapSide === 'later') _codOverlapOrigin = true;
  }

  var decisionPred = (!overlapPeer && modBase && start && dateFmtNow)
    ? calloutDecisionPredecessor_({ phn: pat.phn, last: pat.last, first: pat.first,
        dob: pat.dob, date: dateFmtNow, startTime: start }, alias)
    : null;

  // Nothing left to link to — drop any stale state so a later re-entry into
  // proximity starts clean.
  if (!overlapPeer && !decisionPred) { _codOverlapOrigin = false; _codOverlapSide = null; }

  // Stale-choice guard: the predecessor the doctor chose against no longer
  // matches current geometry (times moved) — ask again.
  if (_codChoicePhn && (!decisionPred || decisionPred.phn !== _codChoicePhn)) {
    _codChoice = null; _codChoicePhn = null;
  }
  if (_codChoice && !_codChoicePhn && decisionPred) _codChoicePhn = decisionPred.phn;

  var cMode = (overlapPeer || (_codOverlapOrigin && _codOverlapSide === 'later' && decisionPred))
    ? 'C' : (decisionPred ? 'B' : null);

  var linked = false, linkPred = null;
  if (cMode === 'C') {
    linked = !overlapPeer && !!decisionPred;
    linkPred = decisionPred;
  } else if (cMode === 'B') {
    linked = (_codChoice === 'ccfpp');
    linkPred = linked ? decisionPred : null;
  }

  // ── Modifier banner — reflects the linkage decision above ──────────────
  var hasInc, modInc, incRaw, incUnits;
  if (linked) {
    incRaw   = modBase ? ccfppContinuingUnits(start, end) : 0;
    incUnits = modBase ? ccfppContinuingUnitsCapped(start, dateISO, incRaw) : 0;
    modInc   = incUnits > 0 ? modBase : null;
  } else {
    hasInc   = consultHasIncrement(start, end);
    modInc   = hasInc ? getModifierForIncrement(start, dateISO) : null;
    incRaw   = consultIncUnits(start, end);
    incUnits = calloutIncUnitsCapped(start, dateISO, incRaw);   // v4.86: 07:45 cut-off
  }

  if (cMode === 'C' && overlapPeer) {
    // Time conflict unresolved — the decision card below owns all
    // messaging; the normal banner would be misleading right now.
    modEl.innerHTML = '';
  } else if (modBase) {
    var baseTagTxt = linked ? (modBase.base + ' not billed — same call-out') : (modBase.base + ' ×1');
    var banner = '<div class="mod-box ' + modBase.cls + '" style="margin-bottom:0;border-radius:var(--rsm) var(--rsm) 0 0">' +
      '<span style="font-weight:700">' + modBase.label + '</span>' +
      '<span style="font-size:10px;opacity:' + (linked ? '1' : '.75') + ';margin-left:6px">' + baseTagTxt + '</span>' +
      '</div>';
    if (incUnits > 0) {
      var incMod = modInc || modBase;
      var incLabelTxt = linked ? 'CCFPP — 30-min lapse waived' : 'Consult time &gt; 45 min';
      var _capNote = (incUnits < incRaw)
        ? '<span style="font-size:9px;opacity:.7;margin-left:6px">(+' + (incRaw - incUnits) + ' after 08:00 not billable)</span>'
        : '';
      banner += '<div class="mod-box ' + incMod.cls + '" style="margin-top:1px;border-radius:0 0 var(--rsm) var(--rsm);opacity:.85">' +
        '<span>' + incLabelTxt + '</span>' +
        '<span style="font-size:10px;font-weight:700;margin-left:6px">' + incMod.inc + ' ×' + incUnits + '</span>' + _capNote +
        '</div>';
    } else if (incRaw > 0 && !linked) {
      // Consult IS > 45 min but the increment period starts after the 07:45
      // cut-off, so no increment (second modifier) is billable.
      // v5.03 (Kathryn): the dead-end note is now ACTIONABLE — if the consult
      // actually began earlier than entered, correcting the start time right
      // here restores the increment. The inline picker rewrites cb-start
      // (12h display + am/pm pill) and re-renders this banner; the end time
      // deliberately stays put (the +50-min end-follow only fires on direct
      // cb-start edits), so an earlier start lengthens the consult.
      banner += '<div style="font-size:11px;padding:6px 10px;color:var(--text2);' +
        'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
        'background:var(--surface2)">' +
        'Note — second modifier will not apply: &lt; 45 min from end of ' +
        'modifier interval (08:00). Should start time be adjusted?' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:6px">' +
        '<input type="time" id="cb-inc-adjust" value="' + start + '" ' +
        'onchange="_incAdjustStart(this.value)" ' +
        'style="padding:4px 8px;border:1px solid var(--border2);border-radius:var(--rsm);' +
        'background:var(--surface);color:var(--text);font-size:13px">' +
        '<span style="font-size:10px;color:var(--text3)">adjusts start only — end time stays</span>' +
        '</div></div>';
    } else if (incRaw > 0 && linked) {
      banner += '<div style="font-size:11px;padding:5px 10px;color:var(--text3);' +
        'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
        'background:var(--surface2)">Continuing-care periods past 08:00 aren\'t billable — none billed here</div>';
    } else {
      banner += '<div style="font-size:11px;padding:5px 10px;color:var(--text3);' +
        'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
        'background:var(--surface2)">' +
        (linked ? 'Under 15 min so far — no continuing-care surcharge yet' : 'Consult ≤ 45 min — no increment') +
        '</div>';
    }
    modEl.innerHTML = banner;
  } else if (start && dateISO) {
    modEl.innerHTML = '<div class="mod-box mod-day">✓ Daytime weekday — no call-out modifier</div>';
  } else {
    modEl.innerHTML = '';
  }

  // ── Call-out Decision card / passive CCFPP box ──────────────────────
  if (codEl) {
    if (cMode === 'B') {
      if (ccEl) ccEl.style.display = 'none';
      var predRow = _codConsultRow(alias, dateFmtNow, decisionPred.phn);
      var predName = decisionPred.name;
      var predEnd12 = _codFmt12(decisionPred.endM);
      codEl.innerHTML =
        '<div class="cod">' +
          '<div class="cod-hdr"><span class="cod-title">Call-out decision</span>' +
            '<span class="cod-req">' + (_codChoice === 'ccfpp' ? 'CCFPP selected' :
              (_codChoice === 'newcall' ? 'New call-back selected' : 'Choice needed')) + '</span></div>' +
          '<div class="cod-context">Your last consult (<b>' + esc(predName) + '</b>) ended <b>' + predEnd12 +
            '</b> — ' + decisionPred.gapMin + ' min before this one started. Is this the same trip?</div>' +
          '<button class="cod-pill' + (_codChoice === 'ccfpp' ? ' sel' : '') + '" onclick="_codSelectPill(\'ccfpp\')">' +
            '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
            '<span class="cod-pill-lbl">CCFPP from ' + esc(predName) + '</span>' +
            '<span class="cod-pill-sub">This claim will carry on continuing care (120x) and add CCFPP information.</span>' +
            '</span></button>' +
          '<button class="cod-pill' + (_codChoice === 'newcall' ? ' sel' : '') + '" onclick="_codSelectPill(\'newcall\')">' +
            '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
            '<span class="cod-pill-lbl">New call-back to KGH</span>' +
            '<span class="cod-pill-sub">Left and was specially called back. Bills a fresh ' + modBase.base +
            ' call-out charge plus ' + modBase.inc + ', same as the first patient of the night.</span>' +
            '</span></button>' +
        '</div>';
      _codUpdateSubmitBtn(!_codChoice, 'Choose an option above to continue');
    } else if (cMode === 'C') {
      if (ccEl) ccEl.style.display = 'none';
      if (overlapPeer && _codOverlapSide === 'later') {
        var peerMod = getModifier(overlapPeer.startTime,
          (function(){ var _d = parseDMY(overlapPeer.date); return _d.getFullYear()+'-'+pad(_d.getMonth()+1)+'-'+pad(_d.getDate()); })());
        var targetM = t2m(start) - 1;
        var target24 = minsToTime(((targetM % 1440) + 1440) % 1440);
        var target12 = _codFmt12(targetM);
        var peerStart12 = _codFmt12(t2m(overlapPeer.startTime));
        var peerEnd12 = _codFmt12(t2m(overlapPeer.endTime) < t2m(overlapPeer.startTime) ? t2m(overlapPeer.endTime) + 1440 : t2m(overlapPeer.endTime));
        var thisStart12 = _codFmt12(t2m(start));
        var newDur = targetM - t2m(overlapPeer.startTime);
        codEl.innerHTML =
          '<div class="cod">' +
            '<div class="cod-hdr"><span class="cod-title">Call-out decision</span><span class="cod-req">Choice needed</span></div>' +
            '<div class="cod-context">Your last consult (<b>' + esc(overlapPeer.last) + '</b>) is entered as lasting until <b>' +
              peerEnd12 + '</b>. This consult is entered as starting at <b>' + thisStart12 + '</b>. What would you like to adjust?</div>' +
            '<div class="cod-pill-adj">' +
              '<button class="cod-pill' + (_codChoice1Open ? ' sel' : '') + '" onclick="_codSelectChoice1()">' +
                '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
                '<span class="cod-pill-lbl">Shorten ' + esc(overlapPeer.last) + '\'s consult</span>' +
                '<span class="cod-pill-sub">Adjust to ' + target12 + ' (1 minute before this consult starts)</span>' +
                '</span></button>' +
              '<div class="cod-adjust" style="display:' + (_codChoice1Open ? 'block' : 'none') + '">' +
                '<div class="cod-adjust-note">' + esc(overlapPeer.last) + ' becomes ' + peerStart12 + '–' + target12 +
                  ' (' + newDur + ' min) — its call-out charges re-derive from the shorter time. ' +
                  'This consult continues the same call-out (CCFPP noted).</div>' +
                '<button class="cod-apply-btn" onclick="_codApplyChoice1()">Apply — trim ' + esc(overlapPeer.last) + ' to ' + target12 + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="cod-hint" onclick="_codFocusStart()"><span class="cod-hint-icn">↑</span>' +
              '<span class="cod-hint-lbl">Or adjust the start of this consult above</span></div>' +
          '</div>';
        _codUpdateSubmitBtn(true, 'Resolve the time conflict above to continue');
      } else if (overlapPeer) {
        // This consult was entered starting BEFORE an already-saved later
        // consult — the rarer direction. Only the raw conflict is resolved
        // here; no CCFPP forcing on THIS consult (see _codOverlapSide note).
        var eM = t2m(overlapPeer.startTime) - 1;
        var target12b = _codFmt12(eM);
        codEl.innerHTML =
          '<div class="cod">' +
            '<div class="cod-hdr"><span class="cod-title">Call-out decision</span><span class="cod-req">Choice needed</span></div>' +
            '<div class="cod-context">Your <b>' + esc(overlapPeer.last) + '</b> consult is entered as starting at <b>' +
              _codFmt12(t2m(overlapPeer.startTime)) + '</b>. This consult would run past that. What would you like to adjust?</div>' +
            '<div class="cod-pill-adj">' +
              '<button class="cod-pill' + (_codChoice1Open ? ' sel' : '') + '" onclick="_codSelectChoice1()">' +
                '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
                '<span class="cod-pill-lbl">Shorten this consult\'s end</span>' +
                '<span class="cod-pill-sub">Adjust to ' + target12b + ' (1 minute before ' + esc(overlapPeer.last) + '\'s consult starts)</span>' +
                '</span></button>' +
              '<div class="cod-adjust" style="display:' + (_codChoice1Open ? 'block' : 'none') + '">' +
                '<button class="cod-apply-btn" onclick="_codApplyChoice1()">Apply — end this consult at ' + target12b + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="cod-hint" onclick="openDayTimeline(\'' + alias + '\',\'' + dateFmtNow + '\')"><span class="cod-hint-icn">↑</span>' +
              '<span class="cod-hint-lbl">Or adjust ' + esc(overlapPeer.last) + '\'s consult in the Day Timeline</span></div>' +
          '</div>';
        _codUpdateSubmitBtn(true, 'Resolve the time conflict above to continue');
      } else {
        // Resolved — always sequential/CCFPP for a consult that originated
        // as a genuine overlap (Kathryn: "these are sequential claims").
        var predRow2 = _codConsultRow(alias, dateFmtNow, linkPred.phn);
        var predMod = predRow2 ? getModifier(predRow2.startTime,
          (function(){ var _d = parseDMY(predRow2.date); return _d.getFullYear()+'-'+pad(_d.getMonth()+1)+'-'+pad(_d.getDate()); })()) : null;
        codEl.innerHTML =
          '<div class="c-ccfpp-linked"><div class="c-ccfpp-linked-lbl">CCFPP — continuing care from ' + esc(linkPred.name) + '</div>' +
          '<div class="c-ccfpp-linked-val">No separate call-out charge (' + (predMod ? predMod.base : modBase.base) +
            ') — continuing the same call-out.' +
            (incUnits > 0 ? ' <b>' + modBase.inc + ' ×' + incUnits + '</b>' : ' Under 15 min so far — no continuing-care surcharge yet.') +
            '</div></div>' +
          '<div class="c-harrison-note">' + esc(linkPred.name) + '\'s own claim is unchanged — each patient bills their own time (CCFPP noted on both).</div>';
        _codUpdateSubmitBtn(false);
      }
    } else {
      codEl.innerHTML = '';
      if (ccEl) ccEl.style.display = '';
      _codUpdateSubmitBtn(false);
    }
  }

  // ── Passive CCFPP field — only rendered when neither card applies ─────
  if (ccEl && cMode === null) {
    var ccVal = cEl('cb-ccfpp-val');
    if (ccVal) {
      var ccText;
      if (!modBase) {
        ccText = "Modifiers don't apply";
      } else {
        var ccNote = (start && end && dateISO)
          ? ccfppPreviewNote(pat, alias, dateISO, dateFmtNow, start, end) : '';
        ccText = ccNote || 'No overlapping consult';
      }
      ccVal.textContent = ccText;
      ccEl.style.border     = '1px solid var(--border2)';
      ccEl.style.background = 'var(--surface2)';
      ccVal.style.color     = 'var(--text3)';
    }
  }
}

// Enable/disable the +Claim screen's submit button in step with the
// Call-out Decision card above. text is only used when disabling.
// v4.95 — also greys out the Add-Patient screen's two submit buttons when
// the consult form is embedded there (_consultCtx === 'addpatient'). Those
// buttons live outside the consult form's own root (#ap-claim-area), so
// cEl() can't reach them — document.getElementById() is used instead. Their
// own wording ("...add patient to list" / "...not following") is left
// alone; only the disabled state + grey styling toggles, same visual
// treatment as the +Claim screen's button via the shared .cod-btn-disabled
// class. submitConsultClaims()'s own guard is still the real gate — this is
// belt-and-suspenders so the doctor sees it can't be tapped, not just why.
function _codUpdateSubmitBtn(disabled, text) {
  var btn = cEl('cb-submit-btn');
  if (btn) {
    if (disabled) {
      btn.disabled = true;
      btn.className = 'btn cod-btn-disabled';
      btn.textContent = text || 'Resolve the above to continue';
    } else {
      btn.disabled = false;
      btn.className = 'btn btn-p';
      btn.textContent = 'Add consult claims';
    }
  }
  if (_consultCtx === 'addpatient') {
    var apList = document.getElementById('ap-submit-list');
    var apOnly = document.getElementById('ap-submit-only');
    if (apList) {
      apList.disabled = disabled;
      apList.className = disabled ? 'btn cod-btn-disabled' : 'btn btn-p';
    }
    if (apOnly) {
      apOnly.disabled = disabled;
      apOnly.className = disabled ? 'btn cod-btn-disabled' : 'btn btn-s';
    }
  }
}

// Scenario B — proximity choice pill tap.
function _codSelectPill(which) {
  _codChoice = which;
  updateConsultUI();
}

// Scenario C — expand/collapse the "Shorten ...'s consult" pill.
function _codSelectChoice1() {
  _codChoice1Open = !_codChoice1Open;
  updateConsultUI();
}

// Scenario C, "later" side — point the doctor at the Start field above
// instead of duplicating a control inside the card.
function _codFocusStart() {
  var el = cEl('cb-start');
  if (!el) return;
  el.focus();
  el.classList.remove('c-field-flash');
  void el.offsetWidth;
  el.classList.add('c-field-flash');
}

// Scenario C — apply the "shorten" fix immediately (both directions).
// 'later' side: trims the PEER's end to exactly 1 min before this consult's
// start (peer.startTime unchanged) via the same applyConsultTimes_ cascade
// Day Timeline uses. 'earlier' side: trims THIS consult's own end field.
function _codApplyChoice1() {
  var peer = _codOverlapPeerClaim;
  var start = consultTime24('start');
  if (!peer || !start) return;
  if (_codOverlapSide === 'later') {
    var targetM = t2m(start) - 1;
    var target = minsToTime(((targetM % 1440) + 1440) % 1440);
    applyConsultTimes_(peer, peer.startTime, target);
  } else {
    var endTarget = minsToTime(((t2m(peer.startTime) - 1) % 1440 + 1440) % 1440);
    cbSetTime('end', endTarget);
  }
  _codChoice1Open = false;
  updateConsultUI();
}

// Called when the consult form is shown (either screen). Renders from local
// data immediately, then fires ONE background cloud refresh so a consult
// entered on another device is picked up. Skipped if a sync ran in the last
// 60s — in a rapid consult-to-consult session local data is already fresh.
var _lastConsultSync = 0;
function consultFormOpened() {
  updateConsultUI();
  if (typeof syncFromSheets === 'function' && (Date.now() - _lastConsultSync > 60000)) {
    _lastConsultSync = Date.now();
    Promise.resolve(syncFromSheets()).then(function() {
      updateConsultUI();
    }).catch(function() {});
  }
}

// Submit guard — prevents double/triple tap on mobile from firing twice.
// v4.26: Submit overlay — covers the entire claim form after submit is tapped.
// Blocks all interaction until pending pushes resolve or timeout fires.
// Also serves as UX training ("don't tap again").
var _submitGuard = false;
var _submitOverlayEl = null;
function _ensureOverlayEl() {
  if (_submitOverlayEl) return _submitOverlayEl;
  var el = document.createElement('div');
  el.id = 'submit-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;' +
    'background:rgba(0,0,0,0.45);backdrop-filter:blur(3px);' +
    'align-items:center;justify-content:center;flex-direction:column;gap:10px;' +
    'color:#fff;font-size:15px;text-align:center;padding:24px;';
  el.innerHTML = '<div style="font-size:28px">🔒</div>' +
    '<div style="font-weight:700">Submitting claim securely…</div>' +
    '<div style="font-size:12px;opacity:0.8">This takes a few seconds — please don\'t tap again</div>';
  document.body.appendChild(el);
  _submitOverlayEl = el;
  return el;
}
function _showSubmitOverlay() {
  var el = _ensureOverlayEl();
  el.style.display = 'flex';
}
function _hideSubmitOverlay() {
  if (_submitOverlayEl) _submitOverlayEl.style.display = 'none';
  _submitGuard = false;
}
function claimSubmitOnce(fn) {
  if (_submitGuard) return;
  _submitGuard = true;
  _showSubmitOverlay();
  // Run the submit function
  fn();
  // Poll _pushInFlight — hide overlay when all pushes resolve
  var _elapsed = 0;
  var _poll = setInterval(function() {
    _elapsed += 300;
    var keys = Object.keys(window._pushInFlight || {});
    if (keys.length === 0 || _elapsed >= 8000) {
      clearInterval(_poll);
      // Minimum 1.2s display for UX training + network latency
      var remaining = Math.max(0, 1200 - _elapsed);
      setTimeout(_hideSubmitOverlay, remaining);
    }
  }, 300);
}

// ── Shared consult-claim creation ──────────────────────
// Reads the unified consult form (cb-* ids) and creates the consult,
// MOST, and call-out modifier claims for patient p. Used by BOTH the
// +Claim screen (submitConsult) and the Add Patient screen
// (_addPatientCore). Returns true on success, false if validation failed.
//
// Diagnosis / referring MD are read from the form and ride on the claim
// rows as a per-claim override — they do NOT modify the patient record.
// CCFPP detection runs here, so it now fires from BOTH entry points.
function submitConsultClaims(p, alias, locOverride) {
  // v4.83: RACE mode — read from the button (same pattern as the 33010 read)
  // so a stale global can never desync from what the doctor sees selected.
  var isRace  = !!(cEl('cb-race') && cEl('cb-race').classList.contains('ct-on-consult'));
  var code    = cEl('cb-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
  var dateISO = cVal('cb-date');
  var start   = consultTime24('start');
  var end     = consultTime24('end');
  if (!dateISO) { showToast('Enter consult date'); return false; }
  if (!isRace && !start) { showToast('Start time required for ' + code); return false; }
  if (!isRace && !end)   { showToast('End time required for ' + code); return false; }

  var dateFmt = fmtD(parseISODate(dateISO));
  var loc     = locOverride || (p.ward === 'ED' ? 'E' : 'I');

  // Per-claim diagnosis / referring MD — pre-filled from the patient but
  // editable on the form. Rides on the claim rows only (override object).
  var ov = {
    icd:       getClaimIcd(p),
    refby:     cVal('cb-refby')      || p.refby     || '',
    refbyName: cVal('cb-refby-name') || p.refbyName || ''
  };

  var userNote  = (cVal('cb-notes') || '').trim();

  // ── v4.83 RACE admit — no consult fee, no times, no modifiers, no CCFPP ──
  // The consult itself is billed through the RACE clinic. All that is added
  // here is the MOST (78720, if toggled on) carrying the referring MD /
  // diagnosis override — plus the doctor's note, which would otherwise ride
  // on the consult row. admitVia='RACE' is stamped on the patient so
  // DataCheck's MISSING_CONSULT rule (v2.36) knows the consult exists
  // elsewhere and never flags this patient's dailies.
  if (isRace) {
    if (!_mostOn && !confirm('No MOST selected.\n\nThe consult is billed in the ' +
        'RACE clinic, so this will add the patient with NO claims at all. Continue?')) {
      return false;
    }
    if (_mostOn) addClaim(p, '78720', '78720', 1, dateFmt, loc, null, userNote || null, null, alias, ov);
    p.admitVia = 'RACE';
    sv('patients', st.patients);
    sv('claims', st.claims);
    showToast(_mostOn ? 'RACE admit — MOST (78720) added, no consult fee'
                      : 'RACE admit — no claims added (consult billed in RACE clinic)');
    return true;
  }
  // CCFPP — one-directional detection (single most-recent overlapping
  // predecessor). v4.50 FIX: compute the note HERE, BEFORE the first
  // saveClaim push, and bake it onto the consult + 120x rows so it persists
  // on the initial save. v4.49 deferred this to ccfppRecomputeAround_, whose
  // second saveClaim for the same id was silently dropped by push()'s
  // _pushInFlight de-dupe guard — so the CCFPP note never reached the sheet
  // on a newly-entered consult. (Recompute still runs at the end to update
  // neighbours; it's a no-op for these rows since the note is already set.)
  // v4.92: ccNote is now computed AFTER the sanity gates — the overlap gate
  // below may trim a peer consult, which changes what CCFPP should say.

  // ── Pre-save sanity gates (v4.58) ─────────────────────────────────
  // Catch the three edge cases that historically produced malformed call-out
  // modifier blocks. Each is a confirm() so the user VERIFIES the times — not
  // a silent auto-fix. Cancelling any prompt aborts the whole save (no rows
  // are written yet — all addClaim calls are below).
  var _sM  = t2m(start), _eM = t2m(end);
  var _dur = _eM - _sM; if (_dur < 0) _dur += 24 * 60;      // cross-midnight aware
  var modBase  = getModifier(start, dateISO);
  var incRaw   = consultIncUnits(start, end);
  // v4.86: cap increments so no half-hour period starts after the 07:45 cut-off.
  var incUnits = calloutIncUnitsCapped(start, dateISO, incRaw);

  // (Harris) Midnight / abnormally long end. end==00:00 is the classic
  // 12am-vs-12pm meridiem slip; a span > 180 min is implausibly long.
  if (end === '00:00' || _dur > 180) {
    if (!confirm('Check the END time.\n\n' + code + ':  ' + start + '–' + end +
        '   (' + _dur + ' min)\n\nThat looks unusual — a midnight end or a very long ' +
        'span, often a 12am/12pm mix-up. Save these times as entered?')) return false;
  }

  // (Altenhofen) Consult shorter than the 30-min call-out minimum. The base
  // modifier alone bills a full 30 min, so a sub-30-min consult with a call-out
  // makes no sense and is usually a mistyped end time.
  if (_dur < 30) {
    if (!confirm('Check the consult LENGTH.\n\n' + code + ':  ' + start + '–' + end +
        '   (' + _dur + ' min)\n\n' + (modBase
          ? 'The after-hours call-out modifier bills a 30-min minimum, so a shorter ' +
            'consult is usually a typo. '
          : '') + 'Save this duration as entered?')) return false;
  }

  // (White) Increment period runs past the 08:00 cut-off. v4.86: increment
  // half-hours whose period STARTS after 07:45 are no longer billable
  // (calloutIncUnitsCapped drops them). When that drops one or more units,
  // surface it so the doctor verifies the times — cancelling aborts the save.
  if (modBase && incRaw > incUnits) {
    var _dropped = incRaw - incUnits;
    if (!confirm('Call-out runs past 08:00.\n\n' + modBase.label + ':  ' +
        start + '–' + end + '\n\nThe 30-min base' +
        (incUnits > 0 ? ' and ' + incUnits + ' increment half-hour' + (incUnits > 1 ? 's' : '') : '') +
        ' before 08:00 will be billed. ' + _dropped + ' later half-hour' +
        (_dropped > 1 ? 's' : '') + ' cannot be billed — call-out premiums end at ' +
        '08:00. Save?')) return false;
  }

  // ── v4.93: same-doctor consult overlap — resolved IN-FORM ─────────────
  // Two consult BODIES can never be on the clock at once. Through v4.92 this
  // was a native confirm() gate sprung at submit time; Kathryn (2026-08-22)
  // asked for it to become the same in-form "Call-out decision" card used
  // for the proximity choice below, resolved BEFORE the doctor ever taps
  // submit — see updateConsultUI's cb-cod rendering. So by the time we get
  // here the card should already have resolved any conflict (submit is
  // disabled in the UI until it has). This is a defensive backstop only —
  // it should never actually fire in normal use.
  var _peer = consultOverlapPeer_(alias, dateFmt, start, end, p.phn);
  if (_peer) {
    showToast('Resolve the time conflict with ' + _peer.last + '\'s consult above before saving', 'error');
    return false;
  }

  // ── v4.93: Call-out DECISION — proximity choice (Scenario B) ──────────
  // A same-doctor call-out consult that ended within CCFPP_DECISION_MAX_GAP_MIN
  // of this one's start is ambiguous — same trip (sequential CCFPP care, no
  // separate 1200-series charge) or a genuine new call-back (fresh charge) —
  // only the doctor knows. The in-form card (updateConsultUI) requires an
  // explicit pill choice and disables submit until one is made; _codChoice
  // carries that choice here. A genuine overlap (just resolved above) is
  // ALWAYS sequential — no choice needed, see _codOverlapOrigin.
  var _decisionPred = modBase ? calloutDecisionPredecessor_(
    { phn: p.phn, last: p.last, first: p.first, dob: p.dob, date: dateFmt, startTime: start }, alias) : null;

  var linked = false, linkPred = null;
  if (_codOverlapOrigin) {
    // This consult started life as a genuine overlap (Scenario C) — always
    // sequential/CCFPP, regardless of which fix resolved the time conflict.
    linked = !!_decisionPred;
    linkPred = _decisionPred;
  } else if (_decisionPred) {
    if (!_codChoice) {
      showToast('Choose an option in the Call-out decision card above before saving', 'error');
      return false;
    }
    linked   = (_codChoice === 'ccfpp');
    linkPred = linked ? _decisionPred : null;
  }

  var ccNote = linked
    ? _ccfppMerge(userNote, 'CCFPP: ' + linkPred.name + ' (' + linkPred.phn + ')')
    : _ccfppMerge(userNote, ccfppPreviewNote(p, alias, dateISO, dateFmt, start, end));

  // Base consult — doctor's note + CCFPP (v4.49b: stamped on 33010/33012 too)
  var consultRow = addClaim(p, code, code, 1, dateFmt, loc, start, ccNote, end, alias, ov);

  // MOST — standalone item, no CCFPP, no times
  if (_mostOn) addClaim(p, '78720', '78720', 1, dateFmt, loc, null, null, null, alias, ov);

  // Call-out modifiers (1200-series) — derived from the just-created consult
  // row's own notes via the SAME rebuild path used for every later edit
  // (Day Timeline, overlap trims), so submit-time and edit-time billing can
  // never diverge. Handles the normal case, the CCFPP-linked case (no base,
  // shifted continuing-care ladder), and — for the predecessor named in
  // ccNote — the "absorbed" case (its own continuing care moves here) once
  // ccfppRecomputeAround_ below re-derives amounts across the neighbourhood.
  if (consultRow) {
    var modChanged = rebuildConsultModifiers_(consultRow);
    modChanged.forEach(function(mc) {
      if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) push('saveClaim', mc);
    });
  }
  sv('claims', st.claims);
  // v4.49: compute/refresh CCFPP notes + (v4.93) amounts for this consult +
  // cross-midnight neighbours — this is what suppresses the predecessor's
  // own continuing-care row when this consult links to it.
  ccfppRecomputeAround_(alias, dateFmt);
  return true;
}

// +Claim screen consult submit.
function submitConsult() {
  var p = getP(_claimPid);
  if (!checkDoc()) return;
  if (!validateRequiredForClaim(p)) { highlightMissingFields(); return; }
  if (!submitConsultClaims(p, getPerformingAlias())) return;
  sv('patients', st.patients);
  showToast('Consult claims added for ' + p.last);
  closeClaimScreen();
}

// ═══════════════════════════════════════════════════════════════════
// v4.92 — DAY TIMELINE ("Your claims" sheet)
// One box per patient on a shared clock: consult body on the left of the
// box, its 12xx call-out blocks as a band inside the box's right edge.
// Tap a box → adjust start/finish; everything downstream re-derives
// DYNAMICALLY on every change (tier, increment count, 07:45 weekday cap,
// majority-portion keep/drop, CCFPP notes). Consult bodies never overlap —
// the earlier one's end trims to the later one's start; call-out windows
// may overlap and carry the CCFPP note automatically.
// The modal + styles are injected at first open (no template change).
// ═══════════════════════════════════════════════════════════════════

var _tlCtx = null;   // { alias, dateFmt }
var _tlSel = null;   // selected consult claim id
// v4.95 — Call-out Decision state for the Day Timeline's own edit panel.
// Mirrors the +Claim screen's _cod* state but scoped to whichever consult
// is currently selected (_tlSel): null (no decision pending) | { mode:'B',
// ns, ne, pred, choice } (proximity choice, mirrors Scenario B) | { mode:'C',
// ns, ne, trims } (genuine overlap — trims is the list of OTHER consults
// being trimmed to make room; a self-only trim never reaches here, see
// tlSaveTimes). Reset whenever a different consult is selected or the
// timeline is reopened.
var _tlCod = null;
var _TL_COLORS = [   // per-patient palette, cycled by group order
  // v5.07 (Kathryn, 2026-08-23): txt/sub were pale pastels (a dark-theme
  // leftover) — nearly invisible on the light band fills, worst on the
  // green/amber cards. Now dark shades of each card's own hue, so the fee
  // codes and times in the modifier bands read clearly on every colour.
  { bd:'#3a5fa8', bg1:'rgba(79,140,255,.20)',  bg2:'rgba(79,140,255,.08)',  seg:'rgba(79,140,255,.30)',  txt:'#1e3a70', sub:'#44639e' },
  { bd:'#2a8f77', bg1:'rgba(62,207,142,.18)',  bg2:'rgba(62,207,142,.07)',  seg:'rgba(62,207,142,.26)',  txt:'#125c3e', sub:'#2e7d5f' },
  { bd:'#8a63c9', bg1:'rgba(168,120,255,.18)', bg2:'rgba(168,120,255,.07)', seg:'rgba(168,120,255,.26)', txt:'#4e3387', sub:'#7457ad' },
  { bd:'#a8843a', bg1:'rgba(255,196,79,.16)',  bg2:'rgba(255,196,79,.06)',  seg:'rgba(255,196,79,.24)',  txt:'#6e4f16', sub:'#96733a' }
];
var _TL_PXMIN = 3;   // pixels per minute

function _tlEnsureDom() {
  if (document.getElementById('tl-modal')) return;
  var css = document.createElement('style');
  css.id = 'tl-style';
  css.textContent =
    '#tl-modal{position:fixed;inset:0;z-index:9500;display:none;background:rgba(0,0,0,.55)}' +
    '#tl-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88vh;overflow-y:auto;' +
      'background:var(--surface);border-top:1px solid var(--border2);border-radius:18px 18px 0 0;' +
      'padding:12px 0 max(14px, env(safe-area-inset-bottom))}' +
    '.tl-grab{width:38px;height:4px;border-radius:2px;background:var(--border2);margin:0 auto 10px}' +
    '.tl-head{padding:0 16px 8px}.tl-head h2{font-size:16px;font-weight:700;margin:0}' +
    '.tl-sub{font-size:12px;color:var(--text3);margin-top:2px;line-height:1.5}' +
    '.tl-wrap{position:relative;margin:4px 12px 10px}' +
    '.tl-hour{position:absolute;left:0;right:0;border-top:1px dashed var(--border);color:var(--text3);font-size:10px}' +
    '.tl-hour span{position:absolute;top:-7px;left:0;background:var(--surface);padding-right:6px}' +
    '.tl-lane{position:absolute;left:48px;right:6px;top:0;bottom:0}' +
    '.tl-card{position:absolute;border-radius:10px;overflow:visible;cursor:pointer;display:flex}' +
    '.tl-card .tl-body{flex:1;padding:6px 8px;min-width:0;overflow:hidden}' +
    '.tl-nm{font-size:12.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.tl-meta{font-size:10px;color:var(--text2);line-height:1.35}' +
    '.tl-band{width:52px;flex:none;display:flex;flex-direction:column}' +
    '.tl-seg{flex:none;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;overflow:hidden}' +
    '.tl-seg b{font-size:10px;font-weight:800}.tl-seg i{font-size:8px;font-style:normal;line-height:1.2}' +
    '.tl-ccfpp{margin-top:1px;font-size:7.5px;font-weight:800;color:#231500;background:#ffd9a0;border-radius:3px;padding:0 3px}' +
    '.tl-dot{position:absolute;left:0;right:0;height:2px;background:var(--text3);opacity:.55}' +
    '.tl-dot span{position:absolute;left:4px;top:-13px;font-size:9px;color:var(--text3)}' +
    '.tl-ghost{border:1.5px dashed #b78a2f !important}' +
    '.tl-edit{margin:2px 12px 10px;background:var(--surface2);border:1px solid var(--blue-t,#4f8cff);border-radius:10px;padding:10px 12px}' +
    '.tl-edit .tl-who{font-size:12.5px;font-weight:700;margin-bottom:2px}' +
    '.tl-edit .tl-exp{font-size:11px;color:var(--text3);margin-bottom:8px;line-height:1.45}' +
    '.tl-row{display:flex;gap:8px;align-items:flex-end}' +
    '.tl-tf{flex:1}.tl-tf label{display:block;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}' +
    '.tl-tf input{width:100%;background:var(--bg,#0f1115);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 9px;font-size:15px;font-weight:700;text-align:center}' +
    '.tl-save{margin-top:10px;width:100%}' +
    '.tl-sum{margin:0 12px 12px;background:rgba(62,207,142,.08);border:1px solid #245c40;border-radius:10px;padding:10px 12px}' +
    '.tl-sum .tl-st{font-size:12px;font-weight:800;color:#3ecf8e;margin-bottom:5px}' +
    '.tl-sum .tl-sl{font-size:11.5px;line-height:1.6;color:var(--text2)}.tl-sum b{color:var(--text)}' +
    '.tl-foot{padding:0 16px 12px;font-size:10.5px;color:var(--text3);line-height:1.55}';
  document.head.appendChild(css);
  var m = document.createElement('div');
  m.id = 'tl-modal';
  m.innerHTML = '<div id="tl-sheet"></div>';
  m.addEventListener('click', function(ev){ if (ev.target === m) closeDayTimeline(); });
  document.body.appendChild(m);
}

function openDayTimeline(alias, dateFmt) {
  _tlEnsureDom();
  _tlCtx = {
    alias:   alias || getPerformingAlias(),
    dateFmt: dateFmt || (typeof TODAY !== 'undefined' ? TODAY : fmtD(new Date()))
  };
  _tlSel = null;
  _tlCod = null;
  _tlRender();
  document.getElementById('tl-modal').style.display = 'block';
}
function closeDayTimeline() {
  var m = document.getElementById('tl-modal');
  if (m) m.style.display = 'none';
  _tlSel = null;
  _tlCod = null;
}

// ── data assembly ──────────────────────────────────────────────────
// Per-patient groups of the doctor's TIMED claims that day.
function _tlGroups() {
  var a = _tlCtx.alias, dt = _tlCtx.dateFmt;
  var byPhn = {};
  st.claims.forEach(function(c){
    if (c.alias !== a || c.date !== dt) return;
    var g = byPhn[c.phn] || (byPhn[c.phn] = { phn: c.phn, last: c.last, first: c.first,
                                              consult: null, mods: [], phones: [] });
    if ((c.fee === '33010' || c.fee === '33012' || c.fee === '33005') && c.startTime && c.endTime)
      g.consult = c;
    else if (CCFPP_MODIFIER_FEES.indexOf(c.fee) !== -1 && c.startTime && c.endTime)
      g.mods.push(c);
    else if (c.fee === '10001' && c.startTime)
      g.phones.push(c);
  });
  return Object.keys(byPhn).map(function(k){ return byPhn[k]; })
    .filter(function(g){ return g.consult || g.mods.length || g.phones.length; })
    .sort(function(x, y){
      var xs = x.consult ? t2m(x.consult.startTime) : (x.phones[0] ? t2m(x.phones[0].startTime) : 0);
      var ys = y.consult ? t2m(y.consult.startTime) : (y.phones[0] ? t2m(y.phones[0].startTime) : 0);
      return xs - ys;
    });
}

// Pending (unsaved) entry from the open consult form — display-only ghost.
function _tlPending() {
  try {
    if (!cEl('cb-mod')) return null;
    var s = consultTime24('start'), e = consultTime24('end');
    var dISO = cVal('cb-date');
    if (!s || !e || !dISO) return null;
    if (fmtD(parseISODate(dISO)) !== _tlCtx.dateFmt) return null;
    var p = currentConsultPatient();
    // v4.95: GHOST FIX (Bernard, 2026-08-12). The dashed "entering now — not
    // saved yet" card mirrors whatever sits in the consult form. If a saved
    // claim for the SAME patient + date + start time already exists, the
    // entry HAS been saved — the form is just still holding the values — and
    // the ghost renders as a confusing phantom next to the real card. Only
    // show the ghost while no matching saved claim exists.
    var _gPhn = String((p && p.phn) || '').replace(/\D/g, '');
    var _gLast = String((p && p.last) || '').trim().toLowerCase();
    var _saved = (st.claims || []).some(function(x) {
      if (String(x.date) !== _tlCtx.dateFmt) return false;
      if (String(x.startTime || '') !== s) return false;
      var xPhn = String(x.phn || '').replace(/\D/g, '');
      if (_gPhn && xPhn) return xPhn === _gPhn;
      return _gLast && String(x.last || '').trim().toLowerCase() === _gLast;
    });
    if (_saved) return null;
    return { last: (p.last || '(this entry)'), start: s, end: e };
  } catch (err) { return null; }
}

function _tlDateISO() {
  var d = parseDMY(_tlCtx.dateFmt);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// What the group's call-out arithmetic says RIGHT NOW (never cached).
function _tlDerived(g) {
  // v5.07 (Kathryn, 2026-08-23): built from the ACTUAL saved 12xx claim
  // rows, not re-derived from the standard-ladder formula. The old version
  // always drew base+inc per the normal math, so a CCFPP-linked consult
  // (no base row, shifted-ladder units) or any just-recomputed claim showed
  // stale/wrong bands even though the claim rows themselves were correct —
  // the timeline now shows exactly what bills.
  if (!g.consult) return null;
  var c = g.consult;
  var segs = (g.mods || [])
    .filter(function(m){ return m.startTime && m.endTime; })
    .map(function(m){ return { fee: m.fee, units: parseInt(m.units, 10) || 1,
                               start: m.startTime, end: m.endTime }; })
    .sort(function(a, b){ return t2m(a.start) - t2m(b.start); });
  if (!segs.length) return null;
  return {
    segs: segs,
    ccfpp: (function(){ var m = /CCFPP:\s*([^|]+)/.exec(String(c.notes || '')); return m ? m[1].trim() : ''; })()
  };
}

// ── render ─────────────────────────────────────────────────────────
function _tlRender() {
  var sheet = document.getElementById('tl-sheet');
  if (!sheet) return;
  var groups  = _tlGroups();
  var pending = _tlPending();

  // clock window: 15 min padding around everything shown
  var lo = 24 * 60, hi = 0;
  function seeRange(s, e) {
    var a = t2m(s); lo = Math.min(lo, a); hi = Math.max(hi, e ? t2m(e) : a);
    if (e && t2m(e) < a) hi = Math.max(hi, t2m(e) + 1440);
  }
  groups.forEach(function(g){
    if (g.consult) { seeRange(g.consult.startTime, g.consult.endTime); }
    g.mods.forEach(function(m){ seeRange(m.startTime, m.endTime); });
    g.phones.forEach(function(ph){ seeRange(ph.startTime, null); });
  });
  if (pending) seeRange(pending.start, pending.end);
  if (lo > hi) { lo = 8 * 60; hi = 10 * 60; }
  lo = Math.max(0, Math.floor((lo - 15) / 30) * 30);
  hi = Math.min(30 * 60, Math.ceil((hi + 15) / 30) * 30);
  var H = (hi - lo) * _TL_PXMIN + 20;
  function Y(t) { var m2 = t2m(t); if (m2 < lo - 60) m2 += 1440; return (m2 - lo) * _TL_PXMIN + 10; }

  var docName = (function(){
    var d = (st.doctors || []).find(function(x){ return x.alias === _tlCtx.alias; });
    return d ? ('Dr. ' + (d.last || d.alias)) : _tlCtx.alias;
  })();

  var h = '<div class="tl-grab"></div><div class="tl-head">' +
    '<h2>Your claims — ' + dispDate(_tlCtx.dateFmt) + ' · ' + docName + '</h2>' +
    '<div class="tl-sub">Tap any box to correct its times. A consult can\'t run past the start ' +
    'of your next consult — call-out blocks may overlap, and CCFPP is noted for you.</div></div>';

  h += '<div class="tl-wrap" style="height:' + H + 'px">';
  for (var t = lo; t <= hi; t += 30) {
    var lbl = minsToTime(t % 1440);
    h += '<div class="tl-hour" style="top:' + ((t - lo) * _TL_PXMIN + 10) + 'px"><span>' + lbl + '</span></div>';
  }
  h += '<div class="tl-lane">';

  // side-by-side columns for overlapping cards: 2 columns, alternate
  var lastEndM = -1, col = 0;
  var cardsHtml = '', dotsHtml = '';
  groups.forEach(function(g, gi){
    var C = _TL_COLORS[gi % _TL_COLORS.length];
    g.phones.forEach(function(ph){
      dotsHtml += '<div class="tl-dot" style="top:' + Y(ph.startTime) + 'px">' +
        '<span>' + g.last + ' · phone 10001 · ' + ph.startTime + '</span></div>';
    });
    if (!g.consult) return;
    var c = g.consult;
    var top = Y(c.startTime), bot = Y(c.endTime);
    if (bot <= top) bot = top + 20;
    var sM = t2m(c.startTime);
    if (sM < lastEndM) col = 1 - col; else col = 0;
    var eM = t2m(c.endTime); if (eM < sM) eM += 1440;
    lastEndM = Math.max(lastEndM, eM);
    var leftCss = col === 0 ? 'left:0;width:49%' : 'left:51%;width:49%';
    var der = _tlDerived(g);
    var selCss = (_tlSel === c.id) ? ';box-shadow:0 0 0 1.5px ' + C.bd : '';

    var band = '';
    if (der) {
      // v5.07: one segment per ACTUAL saved 12xx row (a linked consult has
      // no base seg; units render as ×N) — never the re-derived formula.
      var winTop = Y(der.segs[0].start);
      var winBot = Y(der.segs[der.segs.length - 1].end);
      var bandH = Math.max(winBot - winTop, 20);
      var segsHtml = der.segs.map(function(sg, si){
        var isLast = si === der.segs.length - 1;
        var h = Math.max(Y(sg.end) - Y(sg.start), 12);
        return '<div class="tl-seg" style="' +
          (isLast ? 'flex:1' : 'height:' + Math.round(100 * h / bandH) + '%') +
          ';background:' + C.seg + (isLast ? '' : ';border-bottom:1px solid ' + C.bd) + '">' +
          '<b style="color:' + C.txt + '">' + sg.fee + (sg.units > 1 ? ' ×' + sg.units : '') + '</b>' +
          '<i style="color:' + C.sub + '">' + sg.start + '–' + sg.end + '</i>' +
          (si === 0 && der.ccfpp ? '<span class="tl-ccfpp">CCFPP ' + der.ccfpp.split('(')[0].trim() + '</span>' : '') +
          '</div>';
      }).join('');
      band = '<div class="tl-band" style="border-left:1px solid ' + C.bd + '">' + segsHtml + '</div>';
      if (winBot > bot) bot = winBot;   // box covers the whole call-out window
    }

    cardsHtml += '<div class="tl-card" onclick="tlSelect(\'' + c.id + '\')" style="top:' + top +
      'px;height:' + (bot - top) + 'px;' + leftCss + ';border:1px solid ' + C.bd +
      ';background:linear-gradient(180deg,' + C.bg1 + ',' + C.bg2 + ')' + selCss + '">' +
      '<div class="tl-body"><div class="tl-nm">' + g.last + '</div>' +
      '<div class="tl-meta">' + c.fee + (function(){
        var most = st.claims.some(function(x){ return x.alias === c.alias && x.date === c.date &&
          x.fee === '78720' && _ccfppPhnEq(x.phn, c.phn); });
        return most ? ' + MOST' : '';
      })() + '<br>' + c.startTime + ' – ' + c.endTime + '</div></div>' + band + '</div>';
  });

  if (pending) {
    cardsHtml += '<div class="tl-card tl-ghost" style="top:' + Y(pending.start) + 'px;height:' +
      Math.max(Y(pending.end) - Y(pending.start), 20) + 'px;left:51%;width:49%;' +
      'background:rgba(255,176,32,.08)"><div class="tl-body">' +
      '<div class="tl-nm" style="color:#ffd9a0">' + pending.last + ' — entering now</div>' +
      '<div class="tl-meta">' + pending.start + ' – ' + pending.end + ' · not saved yet</div></div></div>';
  }

  h += dotsHtml + cardsHtml + '</div></div>';

  // edit panel for the selected consult
  if (_tlSel) {
    var sel = st.claims.find(function(x){ return String(x.id) === String(_tlSel); });
    if (sel) {
      h += '<div class="tl-edit"><div class="tl-who">Adjust times — ' + sel.last + ', consult ' + sel.fee + '</div>';
      if (_tlCod && _tlCod.mode === 'C') {
        // v4.95 — genuine overlap, resolved in-panel (no native confirm()),
        // same posture as the +Claim screen's Scenario C.
        var _trimList = _tlCod.trims.map(function(t){
          return esc(t.who) + ' trims to end at ' + t.ne + (t.drop || '');
        }).join('; ');
        // Same both-sides-consult rule as _tlApplyCod — the wording and the
        // button label only promise the CCFPP link when it will actually
        // happen (a 33005 on either side still trims, but never links).
        var _tlCanLink = (sel.fee === '33010' || sel.fee === '33012') &&
          _tlCod.trims.some(function(t){ return t.c.fee === '33010' || t.c.fee === '33012'; });
        h += '<div class="cod"><div class="cod-hdr"><span class="cod-title">Call-out decision</span>' +
          '<span class="cod-req">Choice needed</span></div>' +
          '<div class="cod-context">' + esc(sel.last) + ' would now run ' + _tlCod.ns + '–' + _tlCod.ne +
          ', which overlaps another consult already on the clock. ' + _trimList + '.' +
          (_tlCanLink
            ? ' This is treated as one continuous call-out (sequential claims) — ' + esc(sel.last) +
              ' will carry a CCFPP note naming the trimmed consult and bill its own time on the ' +
              'continuing-care ladder with no separate call-out charge; the trimmed consult\'s ' +
              'own charges just re-derive from its shorter time.'
            : '') + '</div>' +
          '<button class="cod-apply-btn" onclick="_tlApplyCod()">' +
            (_tlCanLink ? 'Apply — trim and link CCFPP' : 'Apply — trim the times') + '</button>' +
          '<div class="cod-hint" onclick="_tlCancelCod()"><span class="cod-hint-icn">↩</span>' +
          '<span class="cod-hint-lbl">Cancel and adjust the times instead</span></div>' +
          '</div>';
      } else if (_tlCod && _tlCod.mode === 'B') {
        // v4.95 — proximity choice, same as the +Claim screen's Scenario B.
        // Day Timeline displays times in 24h format throughout, unlike the
        // +Claim screen's 12h picker, so this keeps that same convention.
        var _predEnd24 = minsToTime(_tlCod.pred.endM);
        h += '<div class="cod"><div class="cod-hdr"><span class="cod-title">Call-out decision</span>' +
          '<span class="cod-req">Choice needed</span></div>' +
          '<div class="cod-context">' + esc(sel.last) + ' would now start ' + _tlCod.ns + ' — <b>' +
          esc(_tlCod.pred.name) + '</b>\'s consult ended <b>' + _predEnd24 + '</b>, ' + _tlCod.pred.gapMin +
          ' min before. Is this the same trip?</div>' +
          '<button class="cod-pill" onclick="_tlCodSelectPill(\'ccfpp\')">' +
          '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
          '<span class="cod-pill-lbl">CCFPP from ' + esc(_tlCod.pred.name) + '</span>' +
          '<span class="cod-pill-sub">Continuing care off the same call-out — no separate call-out charge.</span>' +
          '</span></button>' +
          '<button class="cod-pill" onclick="_tlCodSelectPill(\'newcall\')">' +
          '<span class="cod-pill-radio"></span><span class="cod-pill-body">' +
          '<span class="cod-pill-lbl">New call-back</span>' +
          '<span class="cod-pill-sub">Genuine second trip — bills its own fresh call-out charge.</span>' +
          '</span></button>' +
          '<div class="cod-hint" onclick="_tlCancelCod()"><span class="cod-hint-icn">↩</span>' +
          '<span class="cod-hint-lbl">Cancel and adjust the times instead</span></div>' +
          '</div>';
      } else {
        h += '<div class="tl-exp">Call-out blocks and CCFPP re-build from these times automatically — ' +
          'you never edit them directly. If the new times run into your next consult, the earlier ' +
          'one is trimmed to the later one\'s start.</div>' +
          '<div class="tl-row">' +
          '<div class="tl-tf"><label>Start</label><input id="tl-start" inputmode="numeric" value="' + sel.startTime + '"></div>' +
          '<div class="tl-tf"><label>End</label><input id="tl-end" inputmode="numeric" value="' + sel.endTime + '"></div>' +
          '</div>' +
          '<button class="btn btn-p tl-save" onclick="tlSaveTimes()">Save times</button>';
      }
      h += '</div>';
    }
  }

  // dynamic "what bills" summary
  var sum = '';
  groups.forEach(function(g){
    if (!g.consult) return;
    var c = g.consult, der = _tlDerived(g);
    sum += '<b>' + g.last + '</b> · ' + c.fee + ' ' + c.startTime + '–' + c.endTime;
    if (der) {
      // v5.07: the actual saved rows, not the formula.
      der.segs.forEach(function(sg){
        sum += ' · ' + sg.fee + (sg.units > 1 ? ' ×' + sg.units : '') +
               ' (' + sg.start + '–' + sg.end + ')';
      });
      if (der.ccfpp) sum += ' · noted "CCFPP: ' + der.ccfpp + '"';
    } else {
      sum += ' · no call-out';
    }
    sum += '<br>';
  });
  if (sum) h += '<div class="tl-sum"><div class="tl-st">What bills right now</div>' +
                '<div class="tl-sl">' + sum + '</div></div>';

  h += '<div class="tl-foot">Why this matters: MSP audits start/end times on claims with ' +
    'call-out modifiers (1200-series). Two of your claims can\'t be on the clock at once — ' +
    'overlapping call-out blocks are fine only when the CCFPP note names the earlier patient ' +
    '(added for you). Claims without times (dailies, MOST) aren\'t shown.</div>';

  sheet.innerHTML = h;
}

function tlSelect(id) {
  _tlSel = (_tlSel === id) ? null : id;
  _tlCod = null;
  _tlRender();
}

// Accept "9:14", "914", "0914", "21:30". Values < 8:00 with no explicit
// meridiem follow the field's current value's half of the day.
function _tlParse(v, prevT24) {
  v = String(v || '').trim().replace(/[^\d:]/g, '');
  if (!v) return null;
  var hh, mm;
  if (v.indexOf(':') !== -1) {
    var p2 = v.split(':'); hh = parseInt(p2[0], 10); mm = parseInt(p2[1] || '0', 10);
  } else if (v.length <= 2) { hh = parseInt(v, 10); mm = 0; }
  else { hh = parseInt(v.slice(0, v.length - 2), 10); mm = parseInt(v.slice(-2), 10); }
  if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) return null;
  // 12h-style entry: infer half of day from the previous value
  if (hh >= 1 && hh <= 12 && prevT24) {
    var prevH = parseInt(prevT24.split(':')[0], 10);
    var pm = prevH >= 12;
    if (pm  && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  return pad(hh) + ':' + pad(mm);
}

// What the Call-out Decision card should ask about a PROPOSED (ns, ne) for
// `sel` — mirrors updateConsultUI's cMode logic on the +Claim screen, but
// against sel's own alias/date/phn rather than the open consult form.
// Only called once no overlap-trim is needed (a genuine overlap always
// takes priority — see tlSaveTimes).
function _tlDecisionFor(sel, ns) {
  // Same scope as the +Claim screen's card: consult codes only. A 33005
  // emergency visit shows on the timeline and can be trimmed, but never
  // links CCFPP (consultOverlapPeer_/calloutDecisionPredecessor_ likewise
  // only match 33010/33012 — this guards sel's own side).
  if (sel.fee !== '33010' && sel.fee !== '33012') return null;
  var dISO = _tlDateISO();
  if (!getModifier(ns, dISO)) return null;   // not a call-out window — nothing to decide
  var pred = calloutDecisionPredecessor_(
    { phn: sel.phn, last: sel.last, first: sel.first, dob: sel.dob, date: sel.date, startTime: ns }, sel.alias);
  return pred ? { mode: 'B', pred: pred } : null;
}

function tlSaveTimes() {
  var sel = st.claims.find(function(x){ return String(x.id) === String(_tlSel); });
  if (!sel) return;
  var ns = _tlParse(gv('tl-start'), sel.startTime);
  var ne = _tlParse(gv('tl-end'),   sel.endTime);
  if (!ns || !ne) { showToast('Enter times as HH:MM', 'error'); return; }
  var sM = t2m(ns), eM = t2m(ne); if (eM < sM) eM += 1440;
  if (eM - sM < 5)   { showToast('End must be after start', 'error'); return; }
  if (eM - sM > 300) { showToast('Over 5 hours — check the times', 'error'); return; }

  // Trim cascade: consult BODIES never overlap. Earlier end → later start.
  var trims = [];
  _tlGroups().forEach(function(g){
    if (!g.consult || String(g.consult.id) === String(sel.id)) return;
    var o = g.consult;
    var oS = t2m(o.startTime), oE = t2m(o.endTime); if (oE < oS) oE += 1440;
    if (sM < oE && oS < eM) {
      if (oS <= sM) trims.push({ c: o, ns: o.startTime, ne: ns, who: o.last });  // other first → trim other
      else          { ne = o.startTime; eM = t2m(ne); if (eM < sM) eM += 1440;   // this first → trim this
                      trims.push({ c: sel, self: true, who: sel.last }); }
    }
  });

  var otherTrims = trims.filter(function(t){ return !t.self; });
  if (otherTrims.length) {
    // v4.95 — genuine overlap that trims an OTHER consult: resolved via the
    // in-panel Call-out Decision card (same as the +Claim screen's Scenario
    // C), not a native confirm(). A self-only trim (sel itself is the
    // earlier consult being nudged to fit before an already-saved later
    // one) still applies immediately below with no card — matches the
    // +Claim form's "no CCFPP forcing in this direction" rule, since sel
    // isn't the later side of that pair.
    otherTrims.forEach(function(t){
      // v4.92.1 drop-detection — name the specific modifier being lost.
      var _d = parseDMY(t.c.date);
      var _iso = _d.getFullYear() + '-' + pad(_d.getMonth() + 1) + '-' + pad(_d.getDate());
      var _mod = getModifier(t.ns, _iso);
      var _was = _mod ? calloutIncUnitsCapped(t.ns, _iso, consultIncUnits(t.ns, t.c.endTime)) : 0;
      var _now = _mod ? calloutIncUnitsCapped(t.ns, _iso, consultIncUnits(t.ns, t.ne))       : 0;
      t.drop = (_was > 0 && _now === 0) ? (' (drops ' + _mod.inc + ')')
             : (_now < _was ? (' (' + _mod.inc + ' ' + _was + '→' + _now + ')') : '');
    });
    _tlCod = { mode: 'C', ns: ns, ne: ne, trims: otherTrims };
    _tlRender();
    return;
  }

  // No overlap — check the proximity window (Scenario B equivalent).
  // Skip if sel already carries an explicit CCFPP tag or is itself an
  // absorbed predecessor — an already-resolved link isn't re-litigated by
  // just nudging times a few minutes; the amounts sweep below still keeps
  // it correct either way.
  // v5.07: the old "absorbed predecessor" skip is gone — being named in a
  // successor's note no longer affects this consult's own billing, so only
  // its OWN existing link suppresses the card.
  if (!/CCFPP:\s*[^|]+/i.test(String(sel.notes || ''))) {
    var decision = _tlDecisionFor(sel, ns);
    if (decision) {
      _tlCod = { mode: 'B', ns: ns, ne: ne, pred: decision.pred, choice: null };
      _tlRender();
      return;
    }
  }

  _tlCommitTimes(sel, ns, ne, null);
  trims.forEach(function(t){ if (!t.self) applyConsultTimes_(t.c, t.ns, t.ne); });
  showToast('Times updated — call-out blocks re-built');
  _tlSel = null;
  _tlCod = null;
  _tlRender();
}

// Apply the Scenario-C card: trim(s) + link sel to the (first) trimmed
// predecessor with an explicit CCFPP note, matching the +Claim screen's
// "these are sequential claims" rule for a resolved overlap.
function _tlApplyCod() {
  if (!_tlCod || _tlCod.mode !== 'C') return;
  var sel = st.claims.find(function(x){ return String(x.id) === String(_tlSel); });
  if (!sel) { _tlCod = null; _tlRender(); return; }
  // CCFPP only links consult-to-consult (33010/33012 both sides) — a 33005
  // emergency visit on either side still gets the trim, just no note.
  var predTrim = _tlCod.trims.filter(function(t){
    return t.c.fee === '33010' || t.c.fee === '33012';
  })[0];
  var canLink = predTrim && (sel.fee === '33010' || sel.fee === '33012');
  var ccNote = canLink
    ? _ccfppMerge(_ccfppStrip(sel.notes), 'CCFPP: ' + _ccfppName(predTrim.c) + ' (' + predTrim.c.phn + ')')
    : null;
  _tlCommitTimes(sel, _tlCod.ns, _tlCod.ne, ccNote);
  _tlCod.trims.forEach(function(t){ applyConsultTimes_(t.c, t.ns, t.ne); });
  showToast(canLink ? 'Times updated — call-out blocks re-built, CCFPP noted'
                    : 'Times updated — call-out blocks re-built');
  _tlSel = null;
  _tlCod = null;
  _tlRender();
}

// Apply the Scenario-B card: the doctor's pick decides whether sel links to
// the nearby predecessor (CCFPP) or bills a fresh call-back charge.
function _tlCodSelectPill(which) {
  if (!_tlCod || _tlCod.mode !== 'B') return;
  var sel = st.claims.find(function(x){ return String(x.id) === String(_tlSel); });
  if (!sel) { _tlCod = null; _tlRender(); return; }
  var ccNote = (which === 'ccfpp')
    ? _ccfppMerge(_ccfppStrip(sel.notes), 'CCFPP: ' + _tlCod.pred.name + ' (' + _tlCod.pred.phn + ')')
    : (_ccfppStrip(sel.notes) || null);
  _tlCommitTimes(sel, _tlCod.ns, _tlCod.ne, ccNote);
  showToast(which === 'ccfpp' ? 'Times updated — linked as continuing care (CCFPP)'
                               : 'Times updated — billed as a new call-back');
  _tlSel = null;
  _tlCod = null;
  _tlRender();
}

function _tlCancelCod() {
  _tlCod = null;
  _tlRender();
}

// Shared commit: stamp an explicit note (when given) directly on the
// consult row BEFORE the rebuild/recompute pass, same reasoning as
// submitConsultClaims (v4.50) — set it before ccfppRecomputeAround_ runs so
// it can't be lost to that sweep's "already resolved, don't touch" skip,
// which only refreshes stale notes and never manufactures a new one.
function _tlCommitTimes(sel, ns, ne, ccNoteOverride) {
  if (ccNoteOverride !== null && ccNoteOverride !== undefined) sel.notes = ccNoteOverride;
  applyConsultTimes_(sel, ns, ne);
}
