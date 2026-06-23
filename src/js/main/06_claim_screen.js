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
    'Diagnostics':'var(--teal-t)','Event':'var(--teal-t)',      'Procedure':'var(--purple-t)',  'Rehab':'var(--green-t)',
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
  var result  = addClaim(pClone, fee, fee, 1, dateFmt, loc, start, notes, endTime || '', alias);
  if (!result) return false;  // dedup blocked — stay on form, error toast visible
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

// 06c_patient_summary.js — Patient summary "baseball card"
// Shows patient demographics + all claims chronologically.
// Opens as a bottom sheet modal.
// ═══════════════════════════════════════════════════════

// ── Patient Notes — free-text clinical narrative per patient ────────────
// Opened by tapping patient name on the rounds list card.
// Stored: summary (text), summaryUpdatedAt (epoch ms), summaryUpdatedBy (alias).

function openPatientNotes(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var displayName = esc(String(p.first || '')) + ' ' +
                    esc(String(p.last || '').toUpperCase()) +
                    '<span style="font-weight:500;font-size:14px;color:var(--text2);margin-left:8px">' + esc(calcAgeGender(p)) + '</span>';
  var summary = p.summary || '';
  var footerText = '';
  if (p.summaryUpdatedBy) {
    var ts = parseFloat(p.summaryUpdatedAt);
    var when = '';
    if (!isNaN(ts) && ts > 0) {
      var d = new Date(ts);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var hr = d.getHours(); var mn = d.getMinutes();
      var ampm = hr >= 12 ? 'pm' : 'am';
      hr = hr % 12 || 12;
      when = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
             ' ' + hr + ':' + (mn < 10 ? '0' : '') + mn + ampm;
    }
    footerText = 'Last edited by ' + esc(String(p.summaryUpdatedBy)) +
                 (when ? ' · ' + when : '');
  }

  var html = '';
  // Sticky close button — same pattern as claim summary modal
  html += '<div style="position:sticky;top:0;z-index:10;display:flex;justify-content:flex-end;margin-bottom:-28px;pointer-events:none">' +
          '<button onclick="hideModal(\'pt-notes-modal\')" ' +
          'style="pointer-events:auto;width:32px;height:32px;border-radius:50%;border:none;' +
          'background:rgba(0,0,0,.10);font-size:18px;cursor:pointer;color:var(--text2);' +
          'display:flex;align-items:center;justify-content:center;font-family:inherit;' +
          'box-shadow:0 1px 4px rgba(0,0,0,.12);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)"' +
          ' title="Close">✕</button></div>';

  html += '<div class="pn-header">' + displayName + '</div>';

  html += '<textarea class="pn-textarea" id="pn-text" placeholder="Add clinical notes…">' +
          esc(summary) + '</textarea>';

  if (footerText) {
    html += '<div class="pn-footer">' + footerText + '</div>';
  }

  html += '<div class="pn-actions">' +
          '<button class="btn btn-p" onclick="savePatientNotes(\'' + esc(p.id) + '\')">Save</button>' +
          '<button class="btn btn-s" onclick="hideModal(\'pt-notes-modal\')">Close</button>' +
          '</div>';

  document.getElementById('pt-notes-content').innerHTML = html;
  showModal('pt-notes-modal');

  // Focus textarea after modal renders
  setTimeout(function() {
    var ta = document.getElementById('pn-text');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 120);
}

function savePatientNotes(pid) {
  var p = getP(pid);
  if (!p) return;
  var ta = document.getElementById('pn-text');
  if (!ta) return;

  var newText = ta.value.trim();
  var alias   = (st.doc && st.doc.alias) || '';

  p.summary          = newText;
  p.summaryUpdatedAt = String(Date.now());
  p.summaryUpdatedBy = alias;

  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Summary updated', alias);

  hideModal('pt-notes-modal');
  showToast('Notes saved');
}

// ── Claim history view (existing) ──────────────────────────────────────

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

  // v4.25: Sticky close button — always visible in top-right while scrolling.
  // Fixes the issue where the bottom Close button fell under iPhone's dynamic
  // home bar. Uses position:sticky so it stays at the top of the scroll
  // container without blocking the demographics card content.
  html += '<div style="position:sticky;top:0;z-index:10;display:flex;justify-content:flex-end;margin-bottom:-28px;pointer-events:none">' +
          '<button onclick="hideModal(\'pt-summary-modal\')" ' +
          'style="pointer-events:auto;width:32px;height:32px;border-radius:50%;border:none;' +
          'background:rgba(0,0,0,.10);font-size:18px;cursor:pointer;color:var(--text2);' +
          'display:flex;align-items:center;justify-content:center;font-family:inherit;' +
          'box-shadow:0 1px 4px rgba(0,0,0,.12);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)"' +
          ' title="Close">✕</button></div>';

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
  // v4.26: Fall back to dischargedAt timestamp when dischargeDate is blank.
  // disch78717/dischSimple set dischargedAt but not dischargeDate — without
  // this fallback the span extends to today and shows false gaps.
  if (!endMs && p.discharged && p.dischargedAt) {
    var ts = typeof p.dischargedAt === 'number' ? p.dischargedAt : parseFloat(p.dischargedAt);
    if (ts > 0) {
      var dt = new Date(ts);
      endMs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    }
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
  var has = { consult:false, ccu:false, daily:false, directive:false, combined:false, procedure:false };
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
    // Bedside procedures (cardioversion, pericardiocentesis, temp pacemaker, central line)
    else if (c.fee === '33025' || c.fee === '33030' || c.fee === '00751' || c.fee === '00017') has.procedure = true;
    // 78717 (complex discharge) / 78720 (MOST) are extras that piggyback on a
    // regular visit — they fall through to the hasAny fallback below.
  });
  var out = ['consult','ccu','daily','directive','combined','procedure'].filter(function(t) { return has[t]; });
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

  // v4.26: Derive discharge date string for the red ring display. Falls back
  // to dischargedAt timestamp when dischargeDate is blank (same as _cvAdmitSpan).
  var _dischDateStr = p.dischargeDate || '';
  if (!_dischDateStr && p.discharged && p.dischargedAt) {
    var _dts = typeof p.dischargedAt === 'number' ? p.dischargedAt : parseFloat(p.dischargedAt);
    if (_dts > 0) {
      var _ddt = new Date(_dts);
      _dischDateStr = pad(_ddt.getDate()) + '/' + pad(_ddt.getMonth()+1) + '/' + _ddt.getFullYear();
    }
  }

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
    if (p.discharged && _dischDateStr === dateStr) cls += ' cv-discharged';

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
    // Match calendar legend: Consult=yellow, Daily=green, Combined=teal, Directive=skyblue, CCU=red, Modifier=blue, Procedure=purple, Discharge plan=green
    if (c.fee === '33010' || c.fee === '33012' || c.fee === '33014') typeColor = '#5a2700';            // consult yellow
    else if (c.fee === '33005')                                       typeColor = 'var(--red-t)';       // emergency consult
    else if (c.fee === 'CCU_DAILY' || c.fee === '1411' || c.fee === '1421' || c.fee === '1431' || c.fee === '1441') typeColor = 'var(--red-t)'; // CCU
    else if (c.fee === '33006')                                       typeColor = '#002461';            // directive sky-blue
    else if (c.fee === '33008' && c.notes)                            typeColor = 'var(--teal-t)';      // combined daily
    else if (c.fee === '33008')                                       typeColor = 'var(--green-t)';     // daily
    else if (c.fee === '33025' || c.fee === '33030' || c.fee === '00751' || c.fee === '00017') typeColor = 'var(--purple-t)'; // procedure
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

// ── Claim-edit time-field + AM/PM pill helpers ───────────────────
// Mirrors the consult (_cb) and Other Claim (_oc) time-pill pattern
// so all three entry points show a consistent numeric input + AM/PM
// pill pair. Elements use ce- prefix to avoid collisions.

function _ceTo12(t24) {
  var p = String(t24 || '').split(':');
  var h = parseInt(p[0], 10);
  var m = p[1] || '00';
  if (isNaN(h)) return { disp: '', ap: '' };
  var ap = h >= 12 ? 'pm' : 'am';
  var ch = h % 12; if (ch === 0) ch = 12;
  return { disp: ch + ':' + m, ap: ap };
}

function _ceTimeRow(which, v) {
  function pill(ap, label) {
    var on = (v && v.ap === ap) ? ' ct-on-consult' : '';
    return '<button type="button" id="ce-' + which + '-' + ap + '" class="ct-btn' + on + '" ' +
           'style="flex:0 0 42px;padding:10px 0;font-size:12px" ' +
           'onclick="ceSetMeridiem(\'' + which + '\',\'' + ap + '\')">' + label + '</button>';
  }
  return '<div style="display:flex;gap:5px;align-items:stretch">' +
         '<input type="text" id="ce-' + which + '" inputmode="numeric" autocorrect="off" ' +
         'value="' + ((v && v.disp) || '') + '" placeholder="2:30" ' +
         'style="flex:1;min-width:0;font-size:16px" ' +
         'onblur="ceTimeBlur(\'' + which + '\')">' +
         pill('am', 'AM') + pill('pm', 'PM') +
         '</div>';
}

function ceSetMeridiem(which, ap) {
  var am = document.getElementById('ce-' + which + '-am');
  var pm = document.getElementById('ce-' + which + '-pm');
  if (am) am.className = 'ct-btn' + (ap === 'am' ? ' ct-on-consult' : '');
  if (pm) pm.className = 'ct-btn' + (ap === 'pm' ? ' ct-on-consult' : '');
}

function ceMeridiem(which) {
  var pm = document.getElementById('ce-' + which + '-pm');
  if (pm && pm.classList.contains('ct-on-consult')) return 'pm';
  var am = document.getElementById('ce-' + which + '-am');
  if (am && am.classList.contains('ct-on-consult')) return 'am';
  return '';
}

function ceTimeBlur(which) {
  var el = document.getElementById('ce-' + which);
  if (!el) return;
  var t = parseTime24(el.value);
  if (!t) return;
  var h = parseInt(t.split(':')[0], 10);
  if (h >= 13 || h === 0) {
    var info = _ceTo12(t);
    el.value = info.disp;
    if (info.ap) ceSetMeridiem(which, info.ap);
  } else {
    el.value = h + ':' + t.split(':')[1];
    if (!ceMeridiem(which)) {
      ceSetMeridiem(which, (new Date()).getHours() >= 12 ? 'pm' : 'am');
    }
  }
}

function ceTime24(which) {
  var el = document.getElementById('ce-' + which);
  var t = parseTime24(el ? el.value : '');
  if (!t) return '';
  var p = t.split(':');
  var h = parseInt(p[0], 10);
  var m = p[1];
  if (h >= 13) return t;
  if (h === 0) return '00:' + m;
  var ap = ceMeridiem(which) || ((new Date()).getHours() >= 12 ? 'pm' : 'am');
  var H  = h % 12;
  if (ap === 'pm') H += 12;
  return pad(H) + ':' + m;
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
  var endTimeClean   = fmtStartTime(c.endTime || '');
  var ceStartV = startTimeClean ? _ceTo12(startTimeClean) : null;
  var ceEndV   = endTimeClean   ? _ceTo12(endTimeClean)   : null;

  var refLabel = c.refbyName ? c.refbyName + (c.refby ? ' #' + c.refby : '') : '';

  var html =
    '<div style="font-size:14px;font-weight:800;margin-bottom:12px">Edit claim — ' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<div class="card" style="padding:12px">' +
      '<div class="fl">' +
        '<div class="f1"><label>Date</label>' +
          '<input id="ce-date" type="date" value="' + esc(dateISO) + '"></div>' +
        '<div class="f1"><label>Start time</label>' +
          _ceTimeRow('start', ceStartV) + '</div>' +
      '</div>' +
      '<div class="fl" style="margin-bottom:9px">' +
        '<div class="f1"><label>End time</label>' +
          _ceTimeRow('end', ceEndV) + '</div>' +
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
  var newTime    = ceTime24('start');
  var newEndTime = ceTime24('end');
  var newNotes = (document.getElementById('ce-notes') || {}).value || '';
  var newRefby     = (document.getElementById('ce-refby')      || {}).value || '';
  var newRefName   = (document.getElementById('ce-refby-name') || {}).value || '';

  // Convert YYYY-MM-DD back to DD/MM/YYYY for storage
  var newDate = c.date;
  if (newDateISO && /^\d{4}-\d{2}-\d{2}$/.test(newDateISO)) {
    var dp = newDateISO.split('-');
    newDate = dp[2] + '/' + dp[1] + '/' + dp[0];
  }

  var _ccfppOldDate = c.date, _ccfppOldAlias = c.alias;
  c.fee     = newFee;

  c.icd     = newIcd;
  c.date    = newDate;
  // v4.26: Never blank out an existing time on edit. If the edit form
  // returns empty but the claim had a stored time, keep the original.
  // This prevents the claim-edit modal from silently clearing modifier
  // times (e.g. base modifier 1200 start time).
  c.startTime = newTime || c.startTime || '';
  c.endTime   = newEndTime || c.endTime || '';
  c.notes   = newNotes;
  // Block writing service strings as referring MD
  if (newRefby && newRefName && !looksLikeMRPService(newRefName)) {
    c.refby     = newRefby;
    c.refbyName = normalizeRefName(newRefName);
  }
  if (newAlias) {
    var doc = st.doctors.find(function(d) { return d.alias === newAlias; });
    c.alias  = newAlias;
  }

  sv('claims', st.claims);
  if (SHEETS_URL) push('saveClaim', c);
  // v4.49: refresh CCFPP for the edited claim's window (and old date/alias if moved).
  ccfppRecomputeAround_(c.alias, c.date);
  if (_ccfppOldDate && (_ccfppOldDate !== c.date || _ccfppOldAlias !== c.alias))
    ccfppRecomputeAround_(_ccfppOldAlias, _ccfppOldDate);
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
  // v4.49: refresh CCFPP for peers after a delete.
  if (c) ccfppRecomputeAround_(c.alias, c.date);

  openPatientSummary(pid);
  showToast('Claim deleted');
}

function hideClaimEditModal() { hideModal('claim-edit-modal'); }

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
  html += '<div class="f1"><label>DOB</label><input id="pe-dob" value="' + esc(dispDate(p.dob)||'') + '" autocorrect="off" placeholder="DD Mon YYYY" oninput="dobAutoSlash(this)"></div>';
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

  // ── Handover flag ────────────────────────────────────
  var _hoOn = !!p.handover && p.handover !== 'false' && p.handover !== false;
  html += '<div class="card" style="padding:10px 12px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div style="font-size:13px;font-weight:700;color:var(--text)">Flag for handover — on call issue</div>' +
      '<button class="ap-list-pill' + (_hoOn ? ' on' : '') + '" id="pe-handover" ' +
        'onclick="this.classList.toggle(\'on\')" ' +
        'style="min-width:0;padding:4px 12px;font-size:11px;text-align:center">Flag</button>' +
    '</div>' +
    '</div>';

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

// Dynamic role change in edit form — v4.39: only updates MRP binding.
// Care type is NOT auto-changed.
function peRoleChange() {
  var roleSel = document.getElementById('pe-role');
  var mrpSel  = document.getElementById('pe-mrp');
  if (!roleSel || !mrpSel) return;
  if (roleSel.value === 'mrp') {
    mrpSel.value = 'Cardiology';
  } else {
    if (mrpSel.value === 'Cardiology') mrpSel.value = 'Other';
  }
}

function savePatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  // v4.09: capture pre-edit values so we can propagate to existing claim rows.
  // v4.31: expanded from name-only to PHN + DOB + sex. Without this,
  // fixing a typo'd PHN on the patient tab left claim rows stuck with the
  // old (wrong) PHN, and the next sync overwrote the correction.
  var _oldLast  = p.last  || '';
  var _oldFirst = p.first || '';
  var _oldPhn   = p.phn   || '';
  var _oldDob   = p.dob   || '';
  var _oldSex   = p.sex   || '';

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

  // v4.37: handover flag — 'oncall' when toggled on from edit, preserve 'new' if untouched
  var _hoPill = document.getElementById('pe-handover');
  if (_hoPill) {
    var _wasOn = !!p.handover && p.handover !== 'false' && p.handover !== false;
    var _nowOn = _hoPill.classList.contains('on');
    if (_nowOn && !_wasOn)      p.handover = 'oncall';   // newly flagged
    else if (!_nowOn && _wasOn) p.handover = false;       // cleared
    // else: unchanged — keep existing value ('new' or 'oncall')
  }

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // v4.31: propagate ALL demographic changes to claim rows.
  // Claims are found by the OLD PHN (in case PHN itself changed), then
  // each changed field is updated. Each touched claim is re-pushed.
  var _nameChanged = (p.last !== _oldLast || p.first !== _oldFirst);
  var _phnChanged  = (p.phn !== _oldPhn);
  var _dobChanged  = (p.dob !== _oldDob);
  var _sexChanged  = (p.sex !== _oldSex);
  var _anyDemoChanged = _nameChanged || _phnChanged || _dobChanged || _sexChanged;

  var _claimsTouched = 0;
  if (_anyDemoChanged && (_oldPhn || p.phn)) {
    // Use old PHN to find claims (it's what the claim rows currently hold)
    var searchPhn = _oldPhn || p.phn;
    st.claims.forEach(function(c) {
      if (!samePhn(c.phn, searchPhn)) return;
      var touched = false;
      if (_nameChanged && (c.last !== p.last || c.first !== p.first)) {
        c.last  = p.last;
        c.first = p.first;
        touched = true;
      }
      if (_phnChanged && c.phn !== p.phn) {
        c.phn = p.phn;
        touched = true;
      }
      if (_dobChanged && c.dob !== p.dob) {
        c.dob = p.dob;
        touched = true;
      }
      if (_sexChanged && c.sex !== p.sex) {
        c.sex = p.sex;
        touched = true;
      }
      if (touched) {
        if (SHEETS_URL) push('saveClaim', c);
        _claimsTouched++;
      }
    });
    if (_claimsTouched > 0) {
      sv('claims', st.claims);
      try { console.log('[v4.31] Propagated demographic edit to ' + _claimsTouched + ' claim row(s) for PHN ' + searchPhn + (_phnChanged ? ' → ' + p.phn : '')); } catch (e) {}
    }
  }

  var _detailParts = [];
  if (_nameChanged) {
    var _oldDisplay = _oldLast + (_oldFirst ? ', ' + _oldFirst : '');
    _detailParts.push('Renamed from "' + _oldDisplay + '"');
  }
  if (_phnChanged) _detailParts.push('PHN ' + _oldPhn + ' → ' + p.phn);
  if (_dobChanged) _detailParts.push('DOB ' + (dispDate(_oldDob) || '(blank)') + ' → ' + dispDate(p.dob));
  if (_sexChanged) _detailParts.push('Sex ' + (_oldSex || '(blank)') + ' → ' + p.sex);
  if (_claimsTouched > 0) _detailParts.push(_claimsTouched + ' claim row(s) updated');
  logChange(p, 'Demographics edited', _detailParts.join(' \u2014 '));
  hideModal('pt-edit-modal');
  render();
  showToast(p.last + ' updated' + (_claimsTouched > 0 ? ' (\u2713 ' + _claimsTouched + ' claim row(s) updated)' : ''));
}

// ═══════════════════════════════════════════════════════
// Location edit — quick ward/bed/on-off-service change
// Opened by tapping the ward/bed circle on any patient row.
// v4.39: No forced role/care snaps. User controls all fields independently.
// Stranded-card safety net handles visibility for patients on unexpected wards.
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
  if (hint) hint.textContent = '';
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

  // v4.39: No forced role/care snaps. Save user's choices directly.
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
  logChange(p, 'Moved', bits.join('; ') || 'no change');

  hideModal('loc-edit-modal');
  render();
  var toastBits = [];
  if (oldWard !== newWard || oldBed !== newBed) toastBits.push((WARDS[newWard]||{}).label || newWard);
  if (newBed) toastBits.push(newBed);
  showToast(p.last + ' moved' + (toastBits.length ? ' → ' + toastBits.join(' ') : ''));
}
