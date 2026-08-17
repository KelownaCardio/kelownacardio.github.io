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
  // v4.83: third mode 'RACE' — no consult fee (billed in the RACE clinic).
  // Hides the time fields + modifier banner (nothing here carries times);
  // the date stays because it dates the MOST claim.
  var race = (code === 'RACE');
  cEl('cb-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  cEl('cb-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
  var rBtn = cEl('cb-race');
  if (rBtn) rBtn.className = 'ct-btn' + (race ? ' ct-on-consult' : '');
  ['cb-start-wrap', 'cb-end-row', 'cb-mod'].forEach(function(id) {
    var el = cEl(id);
    if (el) el.style.display = race ? 'none' : '';
  });
  var note = cEl('cb-race-note');
  if (note) note.style.display = race ? 'block' : 'none';
  if (!race) updateConsultUI();
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
  var incRaw   = consultIncUnits(start, end);
  // v4.86: drop increment periods that start after the 07:45 cut-off.
  var incUnits = calloutIncUnitsCapped(start, dateISO, incRaw);
  var modEl    = cEl('cb-mod');

  if (modBase) {
    var banner = '<div class="mod-box ' + modBase.cls + '" style="margin-bottom:0;border-radius:var(--rsm) var(--rsm) 0 0">' +
      '<span style="font-weight:700">' + modBase.label + '</span>' +
      '<span style="font-size:10px;opacity:.75;margin-left:6px">' + modBase.base + ' ×1</span>' +
      '</div>';
    if (incUnits > 0) {
      var incMod = modInc || modBase;
      var _capNote = (incUnits < incRaw)
        ? '<span style="font-size:9px;opacity:.7;margin-left:6px">(+' + (incRaw - incUnits) + ' after 08:00 not billable)</span>'
        : '';
      banner += '<div class="mod-box ' + incMod.cls + '" style="margin-top:1px;border-radius:0 0 var(--rsm) var(--rsm);opacity:.85">' +
        '<span>Consult time &gt; 45 min</span>' +
        '<span style="font-size:10px;font-weight:700;margin-left:6px">' + incMod.inc + ' ×' + incUnits + '</span>' + _capNote +
        '</div>';
    } else if (incRaw > 0) {
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

  // ── v4.92: live same-doctor overlap warning ──────────────────────
  // Fires the moment the entered times land on top of another of THIS
  // doctor's timed consults that day (the batch-entry pattern: several
  // patients entered minutes apart, each keeping the now/+50 prefill).
  // Warning banner + one toast per distinct collision; the Timeline button
  // opens the day view to sort the times out.
  if (start && end && dateISO && modEl) {
    var _ovDateFmt = fmtD(parseISODate(dateISO));
    var _ovPeer = (typeof consultOverlapPeer_ === 'function')
      ? consultOverlapPeer_(getPerformingAlias(), _ovDateFmt, start, end,
                            currentConsultPatient().phn)
      : null;
    if (_ovPeer) {
      var _ovHasCo = getModifier(_ovPeer.startTime,
        (function(){ var _d = parseDMY(_ovPeer.date);
          return _d.getFullYear()+'-'+pad(_d.getMonth()+1)+'-'+pad(_d.getDate()); })());
      modEl.innerHTML += '<div class="mod-box" style="margin-top:6px;background:#2b1d10;' +
        'border:1px solid #6b4a1f;color:#ffd9a0;display:flex;align-items:center;gap:8px">' +
        '<span style="flex:1;min-width:0"><b>Start time overlaps an existing claim</b><br>' +
        '<span style="font-size:11px">' + _ovPeer.last + ' — consult ' +
        _ovPeer.startTime + '–' + _ovPeer.endTime +
        (_ovHasCo ? ' with call-out billed' : '') +
        '. Adjust one of the two before saving.</span></span>' +
        '<button class="ct-btn" style="flex:none" ' +
        'onclick="openDayTimeline(null,\'' + _ovDateFmt + '\')">Timeline ›</button></div>';
      var _ovKey = _ovPeer.id + '|' + start;
      if (window._tlWarnKey !== _ovKey) {
        window._tlWarnKey = _ovKey;
        showToast('Start time overlaps existing claim — ' + _ovPeer.last + ' ' +
                  _ovPeer.startTime + '–' + _ovPeer.endTime, 'error');
      }
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

  // ── v4.92: same-doctor consult overlap gate ───────────────────────
  // Two consult BODIES can never be on the clock at once. Whichever consult
  // starts first gets its end trimmed to the other's start — call-out blocks
  // are NOT trimmed (majority-portion rule keeps/drops them) and re-compute
  // dynamically; CCFPP is noted where blocks still overlap. Cancelling
  // aborts the save so the doctor can adjust times instead.
  var _peer = consultOverlapPeer_(alias, dateFmt, start, end, p.phn);
  if (_peer) {
    if (t2m(_peer.startTime) <= _sM) {
      // Existing consult started first → trim ITS end to this start.
      if (!confirm('Your ' + _peer.last + ' consult runs ' + _peer.startTime + '–' +
          _peer.endTime + ' — past the start of this one.\n\nTwo consults can\'t be ' +
          'on the clock at once. OK trims ' + _peer.last + ' to end at ' + start +
          ' (its call-out blocks re-compute; CCFPP is noted where they still ' +
          'overlap this consult). Cancel goes back so you can adjust the times.'))
        return false;
      applyConsultTimes_(_peer, _peer.startTime, start);
    } else {
      // The NEW consult starts first → its end can't pass the existing start.
      if (!confirm('This consult would run past the start of your ' + _peer.last +
          ' consult (' + _peer.startTime + ').\n\nOK sets this consult\'s end to ' +
          _peer.startTime + ' (call-out blocks re-compute). Cancel goes back so ' +
          'you can adjust the times.'))
        return false;
      end = _peer.startTime;
      try { cbSetTime('end', end); } catch (e) {}
      // Everything derived from the end time re-computes — nothing cached.
      _eM = t2m(end); _dur = _eM - _sM; if (_dur < 0) _dur += 24 * 60;
      incRaw   = consultIncUnits(start, end);
      incUnits = calloutIncUnitsCapped(start, dateISO, incRaw);
    }
  }

  // CCFPP note — computed against post-trim times (v4.92; see note above).
  var ccNote = _ccfppMerge(userNote, ccfppPreviewNote(p, alias, dateISO, dateFmt, start, end));

  // Base consult — doctor's note + CCFPP (v4.49b: stamped on 33010/33012 too)
  addClaim(p, code, code, 1, dateFmt, loc, start, ccNote, end, alias, ov);

  // MOST — standalone item, no CCFPP, no times
  if (_mostOn) addClaim(p, '78720', '78720', 1, dateFmt, loc, null, null, null, alias, ov);

  // Call-out modifiers — CCFPP note rides on these too.
  // v4.58 FIX: the increment INHERITS the base tier instead of being re-clocked
  // at start+30. Re-clocking dropped the modifier whenever the increment start
  // fell outside the after-hours window (e.g. a 07:39 night consult whose
  // increment began 08:09 = daytime → getModifier returned null → 1206 lost).
  var modInc = (modBase && incUnits > 0) ? modBase.inc : null;
  if (modBase) {
    var modBaseEnd = minsToTime((_sM + 30) % (24 * 60));
    addClaim(p, modBase.base, modBase.base, 1, dateFmt, loc, start, ccNote, modBaseEnd, alias, ov);
    if (modInc) {
      var incStart = minsToTime((_sM + 30) % (24 * 60));
      // v4.86: when later half-hours are dropped at the 08:00 cut-off, end the
      // increment claim at the last billable period rather than the raw end.
      var incEnd = (incUnits < incRaw)
        ? minsToTime((_sM + 30 + 30 * incUnits) % (24 * 60))
        : end;
      addClaim(p, modInc, modInc, incUnits, dateFmt, loc, incStart, ccNote, incEnd, alias, ov);
    }
  }
  sv('claims', st.claims);
  // v4.49: compute/refresh CCFPP for this consult + cross-midnight neighbours.
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
var _TL_COLORS = [   // per-patient palette, cycled by group order
  { bd:'#3a5fa8', bg1:'rgba(79,140,255,.20)',  bg2:'rgba(79,140,255,.08)',  seg:'rgba(79,140,255,.30)',  txt:'#cfe0ff', sub:'#9dbdff' },
  { bd:'#2a8f77', bg1:'rgba(62,207,142,.18)',  bg2:'rgba(62,207,142,.07)',  seg:'rgba(62,207,142,.26)',  txt:'#b8f0d8', sub:'#7fd6b4' },
  { bd:'#8a63c9', bg1:'rgba(168,120,255,.18)', bg2:'rgba(168,120,255,.07)', seg:'rgba(168,120,255,.26)', txt:'#e2d4ff', sub:'#bfa3f2' },
  { bd:'#a8843a', bg1:'rgba(255,196,79,.16)',  bg2:'rgba(255,196,79,.06)',  seg:'rgba(255,196,79,.24)',  txt:'#ffe6b8', sub:'#dfc08a' }
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
  _tlRender();
  document.getElementById('tl-modal').style.display = 'block';
}
function closeDayTimeline() {
  var m = document.getElementById('tl-modal');
  if (m) m.style.display = 'none';
  _tlSel = null;
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
  if (!g.consult) return null;
  var c = g.consult, iso = _tlDateISO();
  var mod = getModifier(c.startTime, iso);
  if (!mod) return null;
  var raw = consultIncUnits(c.startTime, c.endTime);
  var cap = calloutIncUnitsCapped(c.startTime, iso, raw);
  var sM  = t2m(c.startTime);
  return {
    mod: mod, incUnits: cap, incRaw: raw,
    baseStart: c.startTime, baseEnd: minsToTime((sM + 30) % 1440),
    incStart: minsToTime((sM + 30) % 1440),
    incEnd: cap > 0 ? (cap < raw ? minsToTime((sM + 30 + 30 * cap) % 1440) : c.endTime) : null,
    winEndM: sM + 30 * (1 + cap),
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
      var winTop = Y(der.baseStart), winBot = Y(der.incEnd || der.baseEnd);
      var bandH = Math.max(winBot - winTop, 20);
      var baseH = Math.max(Y(der.baseEnd) - winTop, 12);
      band = '<div class="tl-band" style="border-left:1px solid ' + C.bd + '">' +
        '<div class="tl-seg" style="height:' + Math.round(100 * baseH / bandH) + '%;background:' + C.seg +
          ';border-bottom:1px solid ' + C.bd + '"><b style="color:' + C.txt + '">' + der.mod.base + '</b>' +
          '<i style="color:' + C.sub + '">' + der.baseStart + '–' + der.baseEnd + '</i>' +
          (der.ccfpp ? '<span class="tl-ccfpp">CCFPP ' + der.ccfpp.split('(')[0].trim() + '</span>' : '') +
        '</div>' +
        (der.incUnits > 0
          ? '<div class="tl-seg" style="flex:1;background:' + C.seg + '"><b style="color:' + C.txt + '">' +
            der.mod.inc + (der.incUnits > 1 ? ' ×' + der.incUnits : '') + '</b>' +
            '<i style="color:' + C.sub + '">' + der.incStart + '–' + der.incEnd + '</i></div>'
          : '') +
        '</div>';
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
      h += '<div class="tl-edit"><div class="tl-who">Adjust times — ' + sel.last + ', consult ' + sel.fee + '</div>' +
        '<div class="tl-exp">Call-out blocks and CCFPP re-build from these times automatically — ' +
        'you never edit them directly. If the new times run into your next consult, the earlier ' +
        'one is trimmed to the later one\'s start.</div>' +
        '<div class="tl-row">' +
        '<div class="tl-tf"><label>Start</label><input id="tl-start" inputmode="numeric" value="' + sel.startTime + '"></div>' +
        '<div class="tl-tf"><label>End</label><input id="tl-end" inputmode="numeric" value="' + sel.endTime + '"></div>' +
        '</div>' +
        '<button class="btn btn-p tl-save" onclick="tlSaveTimes()">Save times</button></div>';
    }
  }

  // dynamic "what bills" summary
  var sum = '';
  groups.forEach(function(g){
    if (!g.consult) return;
    var c = g.consult, der = _tlDerived(g);
    sum += '<b>' + g.last + '</b> · ' + c.fee + ' ' + c.startTime + '–' + c.endTime;
    if (der) {
      sum += ' · ' + der.mod.base + ' (' + der.baseStart + '–' + der.baseEnd + ')';
      if (der.incUnits > 0) sum += ' + ' + der.mod.inc +
        (der.incUnits > 1 ? ' ×' + der.incUnits : '') + ' (' + der.incStart + '–' + der.incEnd + ')';
      if (der.incRaw > der.incUnits) sum += ' — ' + (der.incRaw - der.incUnits) + ' half-hour' +
        ((der.incRaw - der.incUnits) > 1 ? 's' : '') + ' past the cut-off dropped';
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
  if (trims.some(function(t){ return !t.self; })) {
    var msg = trims.filter(function(t){ return !t.self; }).map(function(t){
      return t.who + ' trims to end at ' + t.ne;
    }).join('; ');
    if (!confirm('Consults can\'t overlap — ' + msg + '. Call-out blocks re-compute and ' +
                 'CCFPP is noted where blocks still overlap. Apply?')) return;
  }

  applyConsultTimes_(sel, ns, ne);
  trims.forEach(function(t){ if (!t.self) applyConsultTimes_(t.c, t.ns, t.ne); });
  showToast('Times updated — call-out blocks re-built');
  _tlSel = null;
  _tlRender();
}
