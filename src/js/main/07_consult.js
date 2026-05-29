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
       '<div class="f1"><label>Start time</label>' +
       _cbTimeRow('start', sV) +
       '</div>' +
       '</div>';

  // End time — defaults to start + 50, doctor adjusts if shorter
  h += '<div class="fl" style="margin-bottom:9px">' +
       '<div class="f1"><label>End time' +
       '<span style="font-size:10px;color:var(--text3)"> — defaults to 50 min, adjust as needed</span></label>' +
       _cbTimeRow('end', eV) +
       '</div>' +
       '</div>';

  // Modifier banner
  h += '<div id="cb-mod"></div>';

  // Live CCFPP field — auto-populated when this consult overlaps another
  // call-out consult. Hidden until an overlap is detected. Read-only: the
  // note is appended to the 120x modifier claims automatically at submit.
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
    h += '<button class="btn btn-p" onclick="claimSubmitOnce(submitConsult)">Add consult claims</button>';
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
  cEl('cb-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  cEl('cb-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
  updateConsultUI();
}

function toggleMost() {
  _mostOn = !_mostOn;
  cEl('cb-most').className = 'most-btn' + (_mostOn ? ' on' : '');
}

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
  var hasInc   = consultHasIncrement(start, end);
  var modInc   = hasInc ? getModifierForIncrement(start, dateISO) : null;
  var incUnits = consultIncUnits(start, end);
  var modEl    = cEl('cb-mod');

  if (modBase) {
    var banner = '<div class="mod-box ' + modBase.cls + '" style="margin-bottom:0;border-radius:var(--rsm) var(--rsm) 0 0">' +
      '<span style="font-weight:700">' + modBase.label + '</span>' +
      '<span style="font-size:10px;opacity:.75;margin-left:6px">' + modBase.base + ' ×1</span>' +
      '</div>';
    if (incUnits > 0) {
      var incMod = modInc || modBase;
      banner += '<div class="mod-box ' + incMod.cls + '" style="margin-top:1px;border-radius:0 0 var(--rsm) var(--rsm);opacity:.85">' +
        '<span>Consult time &gt; 45 min</span>' +
        '<span style="font-size:10px;font-weight:700;margin-left:6px">' + incMod.inc + ' ×' + incUnits + '</span>' +
        '</div>';
    } else {
      banner += '<div style="font-size:11px;padding:5px 10px;color:var(--text3);' +
        'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
        'background:var(--surface2)">Consult ≤ 45 min — no increment</div>';
    }
    modEl.innerHTML = banner;
  } else if (start && dateISO) {
    modEl.innerHTML = '<div class="mod-box mod-day">✓ Daytime weekday — no call-out modifier</div>';
  } else {
    modEl.innerHTML = '';
  }

  // ── Live CCFPP field — always visible, three states ──
  //   1. no call-out window     → "Modifiers don't apply"
  //   2. window, no overlap     → "No overlapping consult"
  //   3. window + overlap       → "CCFPP: Last, First (PHN)"  (blue highlight)
  var ccEl  = cEl('cb-ccfpp');
  var ccVal = cEl('cb-ccfpp-val');
  if (ccEl && ccVal) {
    var ccText, ccMatch = false;
    if (!modBase) {
      ccText = "Modifiers don't apply";
    } else {
      var ccNote = (start && end && dateISO)
        ? ccfppPreviewNote(currentConsultPatient(), getPerformingAlias(),
                           dateISO, fmtD(parseISODate(dateISO)), start, end)
        : '';
      if (ccNote) { ccText = ccNote; ccMatch = true; }
      else        { ccText = 'No overlapping consult'; }
    }
    ccVal.textContent = ccText;
    if (ccMatch) {
      ccEl.style.border     = '1px solid var(--blue-t)';
      ccEl.style.background = 'var(--blue-bg)';
      ccVal.style.color     = 'var(--blue-t)';
    } else {
      ccEl.style.border     = '1px solid var(--border2)';
      ccEl.style.background = 'var(--surface2)';
      ccVal.style.color     = 'var(--text3)';
    }
  }
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
var _submitGuard = false;
function claimSubmitOnce(fn) {
  if (_submitGuard) return;
  _submitGuard = true;
  setTimeout(function() { _submitGuard = false; }, 1500);
  fn();
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
  var code    = cEl('cb-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
  var dateISO = cVal('cb-date');
  var start   = consultTime24('start');
  var end     = consultTime24('end');
  if (!dateISO) { showToast('Enter consult date'); return false; }
  if (!start)   { showToast('Start time required for ' + code); return false; }
  if (!end)     { showToast('End time required for ' + code); return false; }

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
  // CCFPP — one-directional detection. Note belongs on the 120x modifier
  // claims only, never on the consult row.
  var ccfppNote = ccfppDetectAndUpdate(p, alias, dateISO, dateFmt, start, end);
  var modNote   = [userNote, ccfppNote].filter(function(s) { return s; }).join(' | ');

  // Base consult — doctor's note only
  addClaim(p, code, code, 1, dateFmt, loc, start, userNote, end, alias, ov);

  // MOST — standalone item, no CCFPP, no times
  if (_mostOn) addClaim(p, '78720', '78720', 1, dateFmt, loc, null, null, null, alias, ov);

  // Call-out modifiers — CCFPP note rides on these
  var modBase  = getModifier(start, dateISO);
  var incUnits = consultIncUnits(start, end);
  var modInc   = incUnits > 0 ? getModifierForIncrement(start, dateISO) : null;
  if (modBase) {
    var modBaseEnd = minsToTime((t2m(start) + 30) % (24 * 60));
    addClaim(p, modBase.base, modBase.base, 1, dateFmt, loc, start, modNote, modBaseEnd, alias, ov);
    if (modInc) {
      var incStart = minsToTime((t2m(start) + 30) % (24 * 60));
      addClaim(p, modInc.inc, modInc.inc, incUnits, dateFmt, loc, incStart, modNote, end, alias, ov);
    }
  }
  sv('claims', st.claims);
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
// ── 08_daily.js ──
// ═══════════════════════════════════════════════════════
// ── 08_daily.js ──
// ═══════════════════════════════════════════════════════
