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
    'Diagnostics':'var(--teal-t)','Event':'var(--teal-t)',      'Procedure':'var(--red-t)',  'Rehab':'var(--green-t)',
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
  var start   = ocTime24('start');
  var endTime = ocTime24('end');
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

