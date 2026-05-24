// ── 06_claim_screen.js ──
// ═══════════════════════════════════════════════════════
// 06_claim_screen.js — Tap-patient claim screen controller
// ═══════════════════════════════════════════════════════

function _openClaimScreen(pid) {
  _claimPid = pid;
  _incUnits = 1;
  _mostOn   = true;

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

  // Default claim type based on location
  var defaultType = p.ward === 'CCU' ? 'ccu' : (p.care || 'daily');
  selCT(defaultType);
}

function buildTypeButtons(p) {
  var isCCU   = p.ward === 'CCU';
  var isOff   = p.list === 'off';
  var types   = [];

  var isMRP = p.role === 'mrp' || p.care === 'daily' || p.care === 'ccu';
  if (showsCCUDaily(p)) {
    // CCU or ICU ward where we are MRP
    types = [
      { id:'ccu',     label:'CCU daily' },
      { id:'consult', label:'Consult (33010/12)' }
    ];
  } else if (isMRP) {
    // Ward MRP — daily rounds, no directive
    types = [
      { id:'daily',   label:'Daily rounds' },
      { id:'consult', label:'Consult (33010/12)' }
    ];
  } else {
    // Consultant role
    types = [
      { id:'consult',  label:'Consult (33010/12)' },
      { id:'directive',label:'Directive visit' },
      { id:'combined', label:'Combined daily' }
    ];
  }

  var h = types.map(function(t) {
    return '<button class="ct-btn" id="ctb-' + t.id + '" onclick="selCT(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');

  // Other claim spans full width
  h += '<button class="ct-btn" id="ctb-other" style="grid-column:1/-1;color:var(--blue-t);border-color:var(--blue-bg)" ' +
       'onclick="selCT(\'other\')">+ Other claim type</button>';

  return h;
}

function feeSearch(query) {
  var dd = document.getElementById('oc-fee-dd');
  if (!dd) return;
  var q = (query || '').toLowerCase().trim();

  var matches = q.length === 0
    ? FEES.filter(function(f) { return f.cat !== 'Modifier' && f.cat !== 'CCU'; }).slice(0, 20)
    : FEES.filter(function(f) {
        return f.code.toLowerCase().indexOf(q) !== -1 ||
               f.desc.toLowerCase().indexOf(q) !== -1 ||
               (f.cat  || '').toLowerCase().indexOf(q) !== -1;
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
    'Event':'var(--teal-t)',      'Procedure':'var(--red-t)',  'Rehab':'var(--green-t)',
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
      '<span style="font-size:10px;color:var(--text3);margin-left:6px">' + esc(f.cat) + '</span>' +
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

function buildOtherClaimForm(p) {
  var now      = new Date();
  var todayISO = localISODate(now);
  var nowTime  = pad(now.getHours()) + ':' + pad(now.getMinutes());

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

  h += '<div style="width:80px"><label>Units</label>' +
       '<input id="oc-units" type="number" value="1" min="1" max="99" ' +
       'oninput="updateOtherPreview()"></div>';

  // Date + start time
  h += '<div class="fl">';
  h +=   '<div class="f1"><label>Date</label>' +
         '<input type="date" id="oc-date" value="' + todayISO + '" oninput="updateOtherPreview()"></div>';
  h +=   '<div class="f1"><label id="oc-start-lbl">Start time <span style="font-size:10px;color:var(--text3)">(if required)</span></label>' +
         '<input type="text" id="oc-start" value="' + nowTime + '" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;"></div>';
  h += '</div>';
  h += '<div id="oc-end-wrap" style="display:none;margin-bottom:6px">' +
       '<label>End time <span style="color:var(--red-t)">*</span></label>' +
       '<input type="text" id="oc-end" placeholder="14:30 or 2:30pm" onblur="var v=parseTime24(this.value);if(v)this.value=v;" style="width:100%;padding:10px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px">' +
       '</div>';

  // Location
  h += '<label>Service location</label>';
  h += '<select id="oc-loc" style="margin-bottom:9px">' +
       '<option value="I" selected>I — Inpatient</option>' +
       '<option value="E">E — Emergency</option>' +
       '<option value="O">O — Outpatient</option>' +
       '</select>';

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
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional — CCFPP auto-added)</span></label>';
  h += '<input id="oc-notes" placeholder="Optional" autocorrect="off">';

  h += buildPerformingPhysSelector();
  h += '</div>';

  // Preview
  h += '<div class="cp" id="oc-preview"><div class="cp-title">Claim preview</div></div>';

  h += '<button class="btn btn-p" onclick="claimSubmitOnce(submitOtherClaim)">Add claim</button>';
  return h;
}

function updateOtherPreview() {
  var fee   = ((document.getElementById('oc-fee') || {}).value || '').trim();
  var units = (document.getElementById('oc-units') || {}).value || '1';
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
    '<span class="cp-units">×' + units + '</span>' +
    amt +
    '</div>';
}

function submitOtherClaim() {
  var p = getP(_claimPid);
  if (!checkDoc()) return;
  var _fee = ((document.getElementById('oc-fee') || {}).value || '').trim();
  if (_fee === '33005') {
    var _s = ((document.getElementById('oc-start') || {}).value || '').trim();
    var _e = ((document.getElementById('oc-end')   || {}).value || '').trim();
    var _n = ((document.getElementById('oc-notes') || {}).value || '').trim();
    var _em = [];
    if (!_s) _em.push('start time');
    if (!_e) _em.push('end time');
    if (!_n) _em.push('description of emergency care');
    if (_em.length) {
      if (!_s) { var _se = document.getElementById('oc-start'); if (_se) _se.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!_e) { var _ee = document.getElementById('oc-end');   if (_ee) _ee.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      if (!_n) { var _ne = document.getElementById('oc-notes'); if (_ne) _ne.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; }
      showToast('Required for 33005: ' + _em.join(', '));
      return;
    }
  }

  var fee   = ((document.getElementById('oc-fee')   || {}).value || '').trim();
  var units = parseInt((document.getElementById('oc-units') || {}).value || '1') || 1;
  var dateISO = (document.getElementById('oc-date')  || {}).value || '';
  var start   = (document.getElementById('oc-start') || {}).value || '';
  var endTime = (document.getElementById('oc-end')   || {}).value || '';
  var loc     = (document.getElementById('oc-loc')   || {}).value || 'I';
  var notes   = (document.getElementById('oc-notes') || {}).value || '';
  var icd     = (document.getElementById('oc-icd')   || {}).value || p.icd || '3062';
  var refby   = (document.getElementById('oc-refby') || {}).value || p.refby || '';
  var refName = (document.getElementById('oc-refby-name') || {}).value || p.refbyName || '';

  if (!fee)     { showToast('Enter a fee code'); return; }
  if (!dateISO) { showToast('Enter a date');     return; }

  // Validate: must have referring MD and ICD before submitting
  var validateP = Object.assign({}, p, { icd: icd, refby: refby, refbyName: refName });
  if (!validateRequiredForClaim(validateP)) { highlightMissingFields(); return; }

  var dateFmt = fmtD(parseISODate(dateISO));

  // Back-populate to patient record so subsequent claims inherit
  var patientUpdated = false;
  if (icd && icd !== p.icd)                   { p.icd = icd; patientUpdated = true; }
  if (refby && refby !== p.refby)             { p.refby = refby; p.refbyName = refName; patientUpdated = true; }
  else if (refName && refName !== p.refbyName){ p.refbyName = refName; patientUpdated = true; }

  var pClone = Object.assign({}, p, { icd: icd, refby: refby, refbyName: refName });

  var alias = getPerformingAlias();
  var c = addClaim(pClone, fee, fee, units, dateFmt, loc, start, notes, endTime || '', alias);
  sv('patients', st.patients);
  sv('claims',   st.claims);
  if (patientUpdated && SHEETS_URL) push('savePatient', p);
  showToast(fee + ' claim added for ' + p.last);
  closeClaimScreen();
}

function selCT(type) {
  // Highlight selected button
  var clsMap = { consult:'ct-on-consult', daily:'ct-on-daily', combined:'ct-on-combined', directive:'ct-on-directive', ccu:'ct-on-ccu' };
  document.querySelectorAll('.ct-btn').forEach(function(b) {
    Object.values(clsMap).forEach(function(c) { b.classList.remove(c); });
  });
  var btn = document.getElementById('ctb-' + type);
  if (btn) btn.classList.add(clsMap[type] || 'ct-on-daily');

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
  showPane(_claimOriginPane);
  document.querySelectorAll('.nb').forEach(function(b, i) {
    b.classList.toggle('on', i === _claimOriginNavIdx);
  });
  if (_claimOriginPane === 'p0') render();
  if (_claimOriginPane === 'p-discharged') renderDischarged(document.getElementById('discharged-search').value || '');
}

