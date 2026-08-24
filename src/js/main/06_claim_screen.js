// 06_claim_screen.js — Tap-patient claim screen controller
// ═══════════════════════════════════════════════════════
// v4.96 (2026-08-13): 00081 Emergency Bedside Care (Kathryn spec).
//   - $119.97 per 30-min unit or MAJORITY portion (≥16 min) thereof; units
//     auto-calculated from the mandatory start/end times.
//   - Resuscitation-details note mandatory.
//   - On submit (from the +Claim screen) a Yes/No sheet asks "Add an initial
//     consult covering the first 30 minutes?". Yes → the consult form opens
//     pre-filled start→start+30 and the 00081 claim starts at the next
//     minute, units re-calculated on the remaining time. No → 00081 alone
//     covers the whole window. From Add Patient (batch path — no modal
//     possible) the full window is billed and a reminder toast shown.
//   - Exported fee code is the literal string '00081' (Crud writes all cells
//     with '@' text format, so the leading zeros survive the Sheet + CSV).

// ── 00081 Emergency Bedside Care ───────────────────────────────────
var EBC_CODE = '00081';
var EBC_EXPLANATION = 'Per 30 minutes of life threatening cardiac event ' +
  '(note: if billing an initial consult also, that consult fee covers the first 30 min)';

// One unit per 30 min or majority portion (≥16 min) thereof.
// 16–45 min → 1, 46–75 → 2, 76–105 → 3 … (<16 min → 0, not billable)
function ebcUnitsFromDur(durMins) {
  if (!durMins || durMins <= 0) return 0;
  var full = Math.floor(durMins / 30);
  var rem  = durMins - full * 30;
  return full + (rem >= 16 ? 1 : 0);
}

// Bedside duration in minutes from 24h "HH:MM" strings (handles midnight wrap).
function ebcDurMins(start24, end24) {
  if (!start24 || !end24) return 0;
  var s = t2m(start24), e = t2m(end24);
  if (e < s) e += 24 * 60;
  return e - s;
}

// 24h "HH:MM" + n minutes (wraps at midnight).
function ebcAddMins(t24, n) {
  return minsToTime((t2m(t24) + n) % (24 * 60));
}

// 12h display for the modal ("14:35" → "2:35pm").
function ebcDisp(t24) {
  var v = _ocTo12(t24);
  return v.disp ? v.disp + v.ap : t24;
}

function _openClaimScreen(pid) {
  // v5.08: single choke point for every "+Claim" entry (card, summary
  // screen, discharged list) — residents never bill (Kathryn 2026-08-24).
  // The backend would reject saveClaim anyway (Router v3.14 allowlist), but
  // this keeps a resident from ever seeing a form they can't submit.
  if (isResident()) { showToast('Not available for this login'); return; }
  _claimPid = pid;
  _incUnits = 1;
  _mostOn   = true;
  // Default: opened directly from a list — do not reopen the summary.
  // ptSummaryAddClaim sets this flag again *after* calling us.
  _claimReturnSummaryPid = null;

  var p = getP(pid);
  // v4.99: getP() returns {} for an unknown id, so this used to render a
  // nameless, claim-less "blank patient card" that looked like a data-loss
  // event. Bail out loudly instead.
  if (!p || !p.id) {
    showToast('That patient is not loaded — search the archive and tap Recall.');
    return;
  }

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

  // v4.20: +Claim screen only offers Consult and Other — always default to Consult.
  selCT('consult');
}

function buildTypeButtons(p) {
  // v4.20: Daily/CCU/directive/combined are quick-tapped from the rounds
  // card — the +Claim screen only needs Consult and Other.
  var h = '<button class="ct-btn" id="ctb-consult" onclick="selCT(\'consult\')">Consult (33010/12)</button>';

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
    'Diagnostics':'var(--teal-t)','Event':'var(--teal-t)',      'Procedure':'var(--purple-t)',  'Rehab':'var(--green-t)',
    'Discharge':'var(--green-t)', 'CCU':'var(--red-t)',        'Modifier':'var(--text3)',
    'Emergency':'var(--red-t)',   'Other':'var(--teal-t)'
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
  if (code === '33005' || code === EBC_CODE) {
    if (endWrap)  endWrap.style.display = 'block';
    if (startLbl) startLbl.innerHTML = 'Start time <span style="color:var(--red-t)">*</span>';
    if (notesEl) {
      notesEl.placeholder = code === EBC_CODE
        ? 'Resuscitation details (mandatory)'
        : 'Describe emergency care provided (mandatory by MSP)';
      notesEl.style.cssText = 'border:1.5px solid var(--amber-t)';
      notesEl.setAttribute('data-required', '1');
    }
    // 00081: surface the billing rule right under the fee-code picker.
    if (code === EBC_CODE && disp) disp.textContent = EBC_EXPLANATION;
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

// ── Other Claim time-field + AM/PM pill helpers ───────────────────
// Mirrors the consult _cbTimeRow pattern but uses document.getElementById
// with oc- prefix (the OC form is not inside the consult container).

function _ocTo12(t24) {
  var p = String(t24 || '').split(':');
  var h = parseInt(p[0], 10);
  var m = p[1] || '00';
  if (isNaN(h)) return { disp: '', ap: '' };
  var ap = h >= 12 ? 'pm' : 'am';
  var ch = h % 12; if (ch === 0) ch = 12;
  return { disp: ch + ':' + m, ap: ap };
}

function _ocTimeRow(which, v) {
  function pill(ap, label) {
    var on = (v && v.ap === ap) ? ' ct-on-consult' : '';
    return '<button type="button" id="oc-' + which + '-' + ap + '" class="ct-btn' + on + '" ' +
           'style="flex:0 0 42px;padding:10px 0;font-size:12px" ' +
           'onclick="ocSetMeridiem(\'' + which + '\',\'' + ap + '\')">' + label + '</button>';
  }
  return '<div style="display:flex;gap:5px;align-items:stretch">' +
         '<input type="text" id="oc-' + which + '" inputmode="numeric" autocorrect="off" ' +
         'value="' + ((v && v.disp) || '') + '" placeholder="2:30" ' +
         'style="flex:1;min-width:0;font-size:16px" ' +
         'onblur="ocTimeBlur(\'' + which + '\')">' +
         pill('am', 'AM') + pill('pm', 'PM') +
         '</div>';
}

function ocSetMeridiem(which, ap) {
  var am = document.getElementById('oc-' + which + '-am');
  var pm = document.getElementById('oc-' + which + '-pm');
  if (am) am.className = 'ct-btn' + (ap === 'am' ? ' ct-on-consult' : '');
  if (pm) pm.className = 'ct-btn' + (ap === 'pm' ? ' ct-on-consult' : '');
  updateOtherPreview();   // v4.96: 00081 units live-recalculate on time edits
}

function ocMeridiem(which) {
  var pm = document.getElementById('oc-' + which + '-pm');
  if (pm && pm.classList.contains('ct-on-consult')) return 'pm';
  var am = document.getElementById('oc-' + which + '-am');
  if (am && am.classList.contains('ct-on-consult')) return 'am';
  return '';
}

function ocTimeBlur(which) {
  var el = document.getElementById('oc-' + which);
  if (!el) return;
  var t = parseTime24(el.value);
  if (!t) return;
  var h = parseInt(t.split(':')[0], 10);
  if (h >= 13 || h === 0) {
    // Unambiguous 24h → convert to 12h display + lock pill
    var info = _ocTo12(t);
    el.value = info.disp;
    if (info.ap) ocSetMeridiem(which, info.ap);
  } else {
    // Ambiguous 1–12 → tidy display, ensure a pill is selected
    el.value = h + ':' + t.split(':')[1];
    if (!ocMeridiem(which)) {
      ocSetMeridiem(which, (new Date()).getHours() >= 12 ? 'pm' : 'am');
    }
  }
  updateOtherPreview();   // v4.96: 00081 units live-recalculate on time edits
}

// Canonical 24h "HH:MM" from OC field text + pill.
function ocTime24(which) {
  var el = document.getElementById('oc-' + which);
  var t = parseTime24(el ? el.value : '');
  if (!t) return '';
  var p = t.split(':');
  var h = parseInt(p[0], 10);
  var m = p[1];
  if (h >= 13) return t;                         // unambiguous PM
  if (h === 0) return '00:' + m;                 // midnight
  var ap = ocMeridiem(which) || ((new Date()).getHours() >= 12 ? 'pm' : 'am');
  var H  = h % 12;
  if (ap === 'pm') H += 12;
  return pad(H) + ':' + m;
}

function buildOtherClaimForm(p, opts) {
  var withSubmit = !opts || opts.withSubmit !== false;
  var now      = new Date();
  var todayISO = localISODate(now);
  var nowT24   = pad(now.getHours()) + ':' + pad(now.getMinutes());
  var nowV     = _ocTo12(nowT24);

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

  // Date + start time (with AM/PM pills matching consult pattern)
  h += '<div class="fl">';
  h +=   '<div class="f1"><label>Date</label>' +
         '<input type="date" id="oc-date" value="' + todayISO + '" oninput="updateOtherPreview()"></div>';
  h +=   '<div class="f1"><label id="oc-start-lbl">Start time <span style="font-size:10px;color:var(--text3)">(if required)</span></label>' +
         _ocTimeRow('start', nowV) + '</div>';
  h += '</div>';
  h += '<div id="oc-end-wrap" style="display:none;margin-bottom:6px">' +
       '<label>End time <span style="color:var(--red-t)">*</span></label>' +
       _ocTimeRow('end', null) +
       '</div>';

  // Location — hidden on Add Patient screen where billing-loc pills handle it
  if (!opts || !opts.hideLoc) {
    h += '<label>Service location</label>';
    h += '<select id="oc-loc" style="margin-bottom:9px">' +
         '<option value="I" selected>Inpatient</option>' +
         '<option value="P">KGH Outpatient</option>' +
         '<option value="Q">Office</option>' +
         '</select>';
  }

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

  // v4.96: 00081 — live unit calculation from the start/end times.
  var extra = '';
  if (fee === EBC_CODE) {
    var s   = ocTime24('start');
    var e   = ocTime24('end');
    var dur = ebcDurMins(s, e);
    var u   = ebcUnitsFromDur(dur);
    var rate = FEE_RATES[EBC_CODE] || 0;
    if (dur > 0) {
      extra = '<div class="cp-row" style="font-size:12px;margin-top:4px">Bedside ' + dur +
        ' min &rarr; ' + u + ' &times; 30-min unit' + (u === 1 ? '' : 's') +
        (u ? ' = <b>$' + (u * rate).toFixed(2) + '</b>'
           : ' &mdash; <span style="color:var(--red-t)">under 16 min, not billable</span>') +
        '</div>';
    } else {
      extra = '<div style="font-size:11px;color:var(--text3);margin-top:4px">Enter start and end time &mdash; ' +
        'billed per 30 min (or majority portion, &ge;16 min) at the bedside.</div>';
    }
    extra += '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + esc(EBC_EXPLANATION) + '</div>';
  }

  prev.innerHTML = '<div class="cp-title">Claim to add</div>' +
    '<div class="cp-row" style="display:flex;align-items:center;gap:6px">' +
    '<span class="cp-code">' + esc(fee) + '</span>' +
    '<span class="cp-desc" style="flex:1;min-width:0">' + esc(knownFee ? knownFee.desc : 'Custom fee code') + '</span>' +
    amt +
    '</div>' + extra;
}

// Shared Other-claim submit — reads the oc-* form, validates 33005, and
// creates the single claim. Used by both the +Claim screen and Add Patient.
// Per-claim ICD / referring-MD ride on the claim only (via pClone); the
// patient's baseline is never rewritten — consistent with the consult form.
// Returns true on success, false if validation blocked the save.
// v4.96: opts.interactive (set by the +Claim screen wrapper) enables the
// 00081 "add a consult for the first 30 min?" sheet. The Add-Patient batch
// path stays 2-arg / non-interactive: full window billed, reminder toasted.
function submitOtherClaimFor(p, alias, opts) {
  opts = opts || {};
  var fee     = ((document.getElementById('oc-fee')   || {}).value || '').trim();
  var dateISO = (document.getElementById('oc-date')  || {}).value || '';
  var start   = ocTime24('start');
  var endTime = ocTime24('end');
  var loc     = (document.getElementById('oc-loc')   || {}).value || 'I';
  var notes   = (document.getElementById('oc-notes') || {}).value || '';
  var icd     = (document.getElementById('oc-icd')   || {}).value || p.icd || '3062';
  var refby   = (document.getElementById('oc-refby') || {}).value || p.refby || '';
  var refName = (document.getElementById('oc-refby-name') || {}).value || p.refbyName || '';

  if (!fee)     { showToast('Enter a fee code'); return false; }
  if (!dateISO) { showToast('Enter a date');     return false; }

  // 33005 (emergency visit) / 00081 (emergency bedside care) —
  // start, end, and a description are mandatory.
  if (fee === '33005' || fee === EBC_CODE) {
    var em = [];
    if (!start)   em.push('start time');
    if (!endTime) em.push('end time');
    if (!notes)   em.push(fee === EBC_CODE ? 'resuscitation details' : 'description of emergency care');
    if (em.length) {
      if (!start)   { var _se = document.getElementById('oc-start'); if (_se) _se.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!endTime) { var _ee = document.getElementById('oc-end');   if (_ee) _ee.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!notes)   { var _ne = document.getElementById('oc-notes'); if (_ne) _ne.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      showToast('Required for ' + fee + ': ' + em.join(', '));
      return false;
    }
  }

  var dateFmt = fmtD(parseISODate(dateISO));
  // Units are always 1 for an Other claim — except 00081 (per-30-min).
  var pClone  = Object.assign({}, p, { icd: icd, refby: refby, refbyName: refName });

  // v4.96: 00081 Emergency Bedside Care — units from the bedside window;
  // interactive path asks whether an initial consult covers the first 30 min.
  if (fee === EBC_CODE) {
    return _ebcSubmit(p, pClone, alias, opts, {
      dateISO: dateISO, dateFmt: dateFmt, start: start, end: endTime,
      loc: loc, notes: notes
    });
  }

  // v4.79: Echo bundles — one tap creates each component claim with its
  // professional-fee amount stamped. Restricted to OOP / Private-Pay
  // patients (that is what these rates are built for; MSP in-patients
  // keep using the existing individual codes).
  if (typeof ECHO_BUNDLES !== 'undefined' && ECHO_BUNDLES[fee]) {
    var _isOop  = (p.oop === true        || String(p.oop).toLowerCase()        === 'true');
    var _isPriv = (p.privatePay === true || String(p.privatePay).toLowerCase() === 'true');
    if (!_isOop && !_isPriv) {
      showToast(ECHO_BUNDLES[fee].label + ' is for Out-of-Province or Private-Pay patients only — set coverage via Edit Patient first');
      return false;
    }
    var _made = 0;
    ECHO_BUNDLES[fee].parts.forEach(function(part) {
      var r = addClaim(pClone, part.code, part.code, 1, dateFmt, loc, start, notes,
                       endTime || '', alias, { feeAmount: part.msp });
      if (r) _made++;
    });
    if (!_made) return false;   // every component blocked as duplicate — toast already shown
    sv('claims', st.claims);
    showToast(ECHO_BUNDLES[fee].label + ' — ' + _made + ' claim' + (_made > 1 ? 's' : '') + ' added');
    return true;
  }

  var result  = addClaim(pClone, fee, fee, 1, dateFmt, loc, start, notes, endTime || '', alias);
  if (!result) return false;  // dedup blocked — stay on form, error toast visible
  sv('claims', st.claims);
  return true;
}

// ── v4.96: 00081 submit + consult-split sheet ──────────────────────
// f = { dateISO, dateFmt, start, end, loc, notes }; times are 24h "HH:MM".
function _ebcSubmit(p, pClone, alias, opts, f) {
  var dur = ebcDurMins(f.start, f.end);
  if (dur <= 0) { showToast('00081: end time must be after start time'); return false; }
  var fullUnits = ebcUnitsFromDur(dur);
  if (!fullUnits) {
    showToast('00081 needs at least 16 min at the bedside (billed per 30 min or majority portion)');
    return false;
  }

  if (!opts.interactive) {
    // Add-Patient batch path — no modal possible mid-batch. Bill the full
    // window; the consult-covers-first-30-min rule is surfaced as a reminder
    // (an Add-Patient submission carries EITHER a consult OR an Other claim,
    // never both, so no same-batch double-billing is possible).
    var r0 = addClaim(pClone, EBC_CODE, EBC_CODE, fullUnits, f.dateFmt, f.loc,
                      f.start, f.notes, f.end, alias);
    if (!r0) return false;
    sv('claims', st.claims);
    showToast('00081 × ' + fullUnits + ' unit' + (fullUnits > 1 ? 's' : '') +
      ' added. If an initial consult is billed too, it covers the first 30 min.');
    return true;
  }

  _ebcShowConsultSheet(p, pClone, alias, f, dur, fullUnits);
  return false;  // caller stays open — the sheet's buttons finish the flow
}

var _ebcPending = null;

function _ebcEnsureModal() {
  if (document.getElementById('ebc-modal')) return;
  var d = document.createElement('div');
  d.className = 'overlay top';
  d.id = 'ebc-modal';
  d.style.zIndex = '10000';  // above the submit overlay (9999)
  d.innerHTML = '<div class="modal">' +
    '<div class="modal-title">Emergency Bedside Care &mdash; 00081</div>' +
    '<div id="ebc-modal-body"></div></div>';
  d.addEventListener('click', function(ev) { if (ev.target === d) _ebcCancel(); });
  document.body.appendChild(d);
}

function _ebcShowConsultSheet(p, pClone, alias, f, dur, fullUnits) {
  _ebcEnsureModal();
  var afterUnits = ebcUnitsFromDur(dur - 30);
  var rate = FEE_RATES[EBC_CODE] || 0;
  _ebcPending = { p: p, pClone: pClone, alias: alias, f: f,
                  fullUnits: fullUnits, afterUnits: afterUnits };

  var yesDetail = afterUnits
    ? 'consult ' + ebcDisp(f.start) + '&ndash;' + ebcDisp(ebcAddMins(f.start, 30)) +
      ', then 00081 &times; ' + afterUnits + ' unit' + (afterUnits > 1 ? 's' : '') +
      ' ($' + (afterUnits * rate).toFixed(2) + ')'
    : 'consult only &mdash; the remaining ' + Math.max(0, dur - 30) +
      ' min is under the 16-min minimum, so no 00081 will be billed';

  document.getElementById('ebc-modal-body').innerHTML =
    '<div style="font-size:13px;color:var(--text2);margin-bottom:8px">Bedside ' +
      ebcDisp(f.start) + '&ndash;' + ebcDisp(f.end) + ' (' + dur + ' min).</div>' +
    '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">' + esc(EBC_EXPLANATION) + '</div>' +
    '<div style="font-size:14px;font-weight:700;margin-bottom:12px">Add a consult covering the first 30 minutes?</div>' +
    '<button class="btn btn-p" style="width:100%;margin:0 0 8px" onclick="_ebcYes()">Yes &mdash; ' + yesDetail + '</button>' +
    '<button class="btn" style="width:100%;margin:0 0 8px;background:var(--red-bg);color:var(--red-t);border:.5px solid var(--red-t)" ' +
      'onclick="_ebcNo()">No &mdash; 00081 only, ' + fullUnits + ' unit' + (fullUnits > 1 ? 's' : '') +
      ' ($' + (fullUnits * rate).toFixed(2) + ')</button>' +
    '<button class="btn btn-s" style="width:100%;margin:0" onclick="_ebcCancel()">Cancel &mdash; back to the form</button>';

  showModal('ebc-modal');
}

// Yes — the consult covers start→start+30; 00081 starts at the next minute
// and bills the remaining time. Then the consult form opens pre-filled so
// call-out modifiers / MOST / 33010-vs-33012 all go through the normal flow.
function _ebcYes() {
  var x = _ebcPending; if (!x) return;
  _ebcPending = null;
  hideModal('ebc-modal');

  if (x.afterUnits > 0) {
    var ebcStart = ebcAddMins(x.f.start, 31);   // "next minute" after the consult's 30
    var r = addClaim(x.pClone, EBC_CODE, EBC_CODE, x.afterUnits, x.f.dateFmt,
                     x.f.loc, ebcStart, x.f.notes, x.f.end, x.alias);
    if (!r) return;  // dedup blocked — its toast is showing; stay on the form
    sv('claims', st.claims);
    showToast('00081 × ' + x.afterUnits + ' added — now confirm the consult (first 30 min)');
  } else {
    showToast('No 00081 billed (remaining time under 16 min) — enter the consult');
  }

  // Switch the claim screen to the consult form, pre-filled with the first
  // 30 minutes of the bedside window (doctor adjusts / submits as usual).
  selCT('consult');
  var dEl = cEl('cb-date'); if (dEl) dEl.value = x.f.dateISO;
  cbSetTime('start', x.f.start);
  cbSetTime('end',   ebcAddMins(x.f.start, 30));
  updateConsultUI();
}

// No — 00081 alone covers the whole bedside window.
function _ebcNo() {
  var x = _ebcPending; if (!x) return;
  _ebcPending = null;
  hideModal('ebc-modal');
  var r = addClaim(x.pClone, EBC_CODE, EBC_CODE, x.fullUnits, x.f.dateFmt,
                   x.f.loc, x.f.start, x.f.notes, x.f.end, x.alias);
  if (!r) return;  // dedup blocked — stay on the form
  sv('claims', st.claims);
  showToast('00081 × ' + x.fullUnits + ' unit' + (x.fullUnits > 1 ? 's' : '') +
    ' added for ' + x.p.last);
  closeClaimScreen();
}

function _ebcCancel() {
  _ebcPending = null;
  hideModal('ebc-modal');
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

  if (!submitOtherClaimFor(p, getPerformingAlias(), { interactive: true })) return;

  // 00081 finishes via its own sheet (submitOtherClaimFor returned false
  // while it is open), so this toast/close only runs for ordinary codes.
  showToast((fee || 'Claim') + ' claim added for ' + p.last);
  closeClaimScreen();
}

function selCT(type) {
  // Highlight selected button — only Consult and Other have buttons now.
  // Daily/CCU/directive/combined forms are still rendered when called by
  // openClaimWithRequiredFields (patient missing refby/dx).
  document.querySelectorAll('.ct-btn').forEach(function(b) {
    b.classList.remove('ct-on-consult');
  });
  var btn = document.getElementById('ctb-' + type);
  if (btn) btn.classList.add('ct-on-consult');

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
    // v4.83: +Claim consult on a Race Admit patient defaults to RACE mode
    // (consult billed in clinic — no fee); tap 33010/33012 to override.
    if (p && p.ward === 'RACE') toggleConsultCode('RACE');
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

