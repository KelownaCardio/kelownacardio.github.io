// ── 07_consult.js ──
// ═══════════════════════════════════════════════════════
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

  // Date + Start time (pre-filled with now)
  h += '<div class="fl">' +
       '<div class="f1"><label>Date</label>' +
       '<input type="date" id="cb-date" value="' + todayISO + '" oninput="updateConsultUI()"></div>' +
       '<div class="f1"><label>Start time</label>' +
       '<input type="text" id="cb-start" value="' + nowTime + '" placeholder="14:30 or 2:30pm" oninput="updateConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateConsultUI();}"></div>' +
       '</div>';

  // End time — defaults to start + 50, doctor adjusts if shorter
  h += '<div class="fl" style="margin-bottom:9px">' +
       '<div class="f1"><label>End time' +
       '<span style="font-size:10px;color:var(--text3)"> — defaults to 50 min, adjust as needed</span></label>' +
       '<input type="text" id="cb-end" value="' + endTime + '" placeholder="14:30 or 2:30pm" oninput="updateConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateConsultUI();}"></div>' +
       '</div>';

  // Modifier banner
  h += '<div id="cb-mod"></div>';

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

function toggleConsultCode(code) {
  document.getElementById('cb-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  document.getElementById('cb-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
  updateConsultUI();
}

function toggleMost() {
  _mostOn = !_mostOn;
  document.getElementById('cb-most').className = 'most-btn' + (_mostOn ? ' on' : '');
}

function updateConsultUI() {
  var start   = gv('cb-start');
  var end     = gv('cb-end');
  var dateISO = gv('cb-date');
  if (!document.getElementById('cb-mod')) return; // form not on screen

  // End follows start (start + 50 min) unless the doctor edited end directly.
  var endEl   = document.getElementById('cb-end');
  var changed = (typeof event !== 'undefined' && event && event.target) ? event.target.id : '';
  if (start && (changed === 'cb-start' || !end)) {
    if (endEl) endEl.value = minsToTime(t2m(start) + 50);
    end = gv('cb-end');
  }

  var modBase  = getModifier(start, dateISO);
  var hasInc   = consultHasIncrement(start, end);
  var modInc   = hasInc ? getModifierForIncrement(start, dateISO) : null;
  var incUnits = consultIncUnits(start, end);
  var modEl    = document.getElementById('cb-mod');

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
function submitConsultClaims(p, alias) {
  var code    = document.getElementById('cb-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
  var dateISO = gv('cb-date');
  var start   = gv('cb-start');
  var end     = gv('cb-end');
  if (!dateISO) { showToast('Enter consult date'); return false; }
  if (!start)   { showToast('Start time required for ' + code); return false; }
  if (!end)     { showToast('End time required for ' + code); return false; }

  var dateFmt = fmtD(parseISODate(dateISO));
  var loc     = p.ward === 'ED' ? 'E' : 'I';

  // Per-claim diagnosis / referring MD — pre-filled from the patient but
  // editable on the form. Rides on the claim rows only (override object).
  var ov = {
    icd:       getClaimIcd(p),
    refby:     gv('cb-refby')      || p.refby     || '',
    refbyName: gv('cb-refby-name') || p.refbyName || ''
  };

  var userNote  = (gv('cb-notes') || '').trim();
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
