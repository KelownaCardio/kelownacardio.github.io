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

function buildOtherClaimForm(p, opts) {
  var withSubmit = !opts || opts.withSubmit !== false;
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
  var start   = (document.getElementById('oc-start') || {}).value || '';
  var endTime = (document.getElementById('oc-end')   || {}).value || '';
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

