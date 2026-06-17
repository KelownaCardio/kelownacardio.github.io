// 10_location.js — Location change screen + discharge modal
// ═══════════════════════════════════════════════════════
// LOS helper — days since admission (using first claim date or addedAt)
function losdays(p) {
  var patClaims = st.claims.filter(function(c) { return c.phn && samePhn(c.phn, p.phn); });

  // Priority 1: explicit admitDate on patient record
  if (p.admitDate) {
    var ad = parseDMYsafe(fmtClaimDate(p.admitDate));
    if (ad) return Math.floor((Date.now() - ad) / 86400000);
  }

  if (!patClaims.length) return 0;
  patClaims.sort(function(a, b) { return parseDMYsafe(a.date) - parseDMYsafe(b.date); });

  // Priority 2: date of earliest full consult (33010 or 33012) — marks admission
  var consultClaims = patClaims.filter(function(c) {
    return c.fee === '33010' || c.fee === '33012';
  });
  if (consultClaims.length) {
    var consultFirst = parseDMYsafe(consultClaims[0].date);
    if (consultFirst) return Math.floor((Date.now() - consultFirst) / 86400000);
  }

  // Priority 3: earliest claim of any type
  var first = parseDMYsafe(patClaims[0].date);
  if (!first) return 0;
  return Math.floor((Date.now() - first) / 86400000);
}

// ═══════════════════════════════════════════════════════

// ── Location Change Screen ─────────────────────────────
function openLocScreen(pid) {
  _locPid  = pid;
  var p    = getP(pid);

  document.getElementById('loc-pt-name').textContent = 'Change location — ' + p.last + ', ' + p.first;

  // Build location grid
  document.getElementById('loc-grid').innerHTML = Object.keys(WARDS).map(function(k) {
    var w   = WARDS[k];
    var sel = p.ward === k ? ' selected' : '';
    return '<div class="loc-opt' + sel + '" id="loc-opt-' + k + '" onclick="selectLocWard(\'' + k + '\')">' +
             '<div class="loc-opt-name">' + w.label + '</div>' +
             '<div class="loc-opt-sub">'  + (w.list === 'on' ? 'On service' : 'Off service') + '</div>' +
           '</div>';
  }).join('');

  // Pre-select current ward, then the patient's current room
  selectLocWard(p.ward);
  var locRoomInp = document.getElementById('loc-room');
  if (locRoomInp) locRoomInp.value = p.bed || '';
  renderRoomPills(p.ward, 'loc-room', 'loc-room-pills');
  document.getElementById('loc-list').value = p.list || 'on';
  document.getElementById('loc-care').value = p.care || 'daily';

  // v4.39: MRP toggle pill
  var mrpPill = document.getElementById('loc-mrp-pill');
  if (mrpPill) {
    mrpPill.classList.toggle('on', p.role === 'mrp');
    mrpPill.textContent = p.role === 'mrp' ? 'MRP ✓' : 'MRP';
  }
  var conPill = document.getElementById('loc-con-pill');
  if (conPill) {
    conPill.classList.toggle('on', p.role !== 'mrp');
    conPill.textContent = p.role !== 'mrp' ? 'Consultant ✓' : 'Consultant';
  }

  showPane('p-loc');
}

function selectLocWard(ward) {
  _locWard = ward;
  document.querySelectorAll('.loc-opt').forEach(function(el) { el.classList.remove('selected'); });
  var opt = document.getElementById('loc-opt-' + ward);
  if (opt) opt.classList.add('selected');

  // v4.39: Ward selection no longer snaps list/care/role.
  // The stranded-patient safety net (red cards) handles visibility.
  // Users choose location, MRP, and on/off service independently.

  // Render the ward's preset rooms as tap pills. Changing ward clears the
  // room — a room from the previous ward no longer applies.
  var locRoomInp = document.getElementById('loc-room');
  if (locRoomInp) locRoomInp.value = '';
  renderRoomPills(ward, 'loc-room', 'loc-room-pills');
}

function confirmLocChange() {
  var p    = getP(_locPid);
  var from = p.ward;
  p.ward   = _locWard;
  p.bed    = gv('loc-room');
  saveCustomRoom(_locWard, p.bed);   // persist an off-list room so it becomes a pill next time
  p.care   = gv('loc-care');
  p.list   = gv('loc-list');

  // v4.39: MRP toggle — read pill state
  var mrpPill = document.getElementById('loc-mrp-pill');
  if (mrpPill) {
    var isMrp = mrpPill.classList.contains('on');
    p.role = isMrp ? 'mrp' : 'consultant';
    p.mrp  = isMrp ? 'Cardiology' : p.mrp;
  }

  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Location changed', from + ' → ' + _locWard);
  closeLocScreen();
  showToast(p.last + ' moved to ' + wardLabel(_locWard));
}

function closeLocScreen() {
  document.getElementById('p-loc').classList.remove('on');
  showPane('p0');
  document.querySelectorAll('.nb').forEach(function(b, i) { b.classList.toggle('on', i === 0); });
  render();
}

// v4.39: Toggle MRP/Consultant pills on Location screen
function toggleLocRole(role) {
  var mrpPill = document.getElementById('loc-mrp-pill');
  var conPill = document.getElementById('loc-con-pill');
  var isMrp = (role === 'mrp');
  if (mrpPill) { mrpPill.classList.toggle('on', isMrp);  mrpPill.textContent = isMrp ? 'MRP ✓' : 'MRP'; }
  if (conPill) { conPill.classList.toggle('on', !isMrp); conPill.textContent = !isMrp ? 'Consultant ✓' : 'Consultant'; }
}

// ── Discharge Modal ────────────────────────────────────
// Flow:
//   Step 1 — if no visit billed today: offer visit type buttons (default by ward/role)
//   Step 2 — if LOS >= 4 (admit day=1, losdays>=4): complex discharge criteria checklist
//   Step 3 — Confirm discharge date & remove from list
//
function openDischModal(pid) {
  _claimPid = pid;
  var p = getP(pid);
  if (!p) return;

  // v4.20 — check for billing gaps first. If any exist, open the patient
  // summary calendar so the doctor can review and correct them before
  // discharging. The discharge modal is NOT opened in this case.
  var rule = _cvGapRuleForPatient(p);
  if (rule) {
    var claims = st.claims.filter(function(c) {
      return c.phn && p.phn && samePhn(c.phn, p.phn);
    });
    var gaps = _cvGapDays(p, claims);
    if (gaps.length) {
      showToast(gaps.length + ' unbilled ' + (rule === 'ccu' ? 'CCU' : 'MRP') + ' day' + (gaps.length > 1 ? 's' : '') + ' — review calendar before discharge', 'error');
      openPatientSummary(pid);
      return;
    }
  }

  // No gaps (or no gap rule) — proceed to discharge modal.
  document.getElementById('disch-title').textContent = p.last + ', ' + p.first;
  // v4.20 — skip the "add a claim?" prompt; go straight to complex
  // discharge check (step 2) or confirm date (step 3).
  _dischStep2(pid);
  showModal('disch-modal');
}

// ── Complex Discharge (78717) — criteria checklist ──────
// Qualifies when LOS > 4 (admit day = day 1, so losdays() >= 4) AND Cardiology MRP AND clinical criteria:
//   (2 from A) OR (1 from A + 1 from B) OR (1 from A + C)
// Note written to the 78717 claim mirrors the clerk's format:
//   "Complex Discharge: CHF, BMI > 35, Age > 75"
var CD_CRITERIA = {
  A: [
    { id:'cad',   label:'CAD' },
    { id:'chf',   label:'CHF' },
    { id:'dm',    label:'Diabetes' },
    { id:'ckd',   label:'CKD' },
    { id:'cvd',   label:'Cerebrovascular Dz' },
    { id:'liver', label:'Liver Dz w/ synthetic dysfunction' },
    { id:'neuro', label:'Chronic Neuro Dz' }
  ],
  B: [
    { id:'age75',   label:'Age > 75' },
    { id:'bmi35',   label:'BMI > 35' },
    { id:'frail',   label:'Frail elderly' },
    { id:'readmit', label:'High readmission rate' },
    { id:'mobil',   label:'Mobility/Accessibility issues' },
    { id:'adl',     label:'Dependency for ADLs' },
    { id:'ses',     label:'Poor socioeconomic status' },
    { id:'home',    label:'Unstable home environment' }
  ],
  C: [
    { id:'malig',   label:'Malignancy' }
  ]
};
// Patient.icd -> criterion id, for auto pre-tick (exact ICD-9 match only)
var CD_ICD_MAP = {
  '414':'cad', '428':'chf', '250':'dm', '585':'ckd',
  '438':'cvd', '571':'liver', 'V800':'neuro', '199':'malig'
};
var _cdState = {};   // { criterionId: true } — ticked boxes
var _cdPid   = '';   // patient id the checklist is open for

// Age in whole years from DOB (DD/MM/YYYY storage format)
function _cdAge(p) {
  var ms = parseDMYsafe(fmtClaimDate((p && p.dob) || ''));
  if (!ms) return 0;
  return Math.floor((Date.now() - ms) / (365.25 * 86400000));
}

// Count ticked items per group and apply the qualifying rule
function _cdEvaluate() {
  function cnt(grp) {
    return CD_CRITERIA[grp].filter(function(x) { return _cdState[x.id]; }).length;
  }
  var a = cnt('A'), b = cnt('B'), c = cnt('C');
  return {
    a: a, b: b, c: c,
    qualifies: (a >= 2) || (a >= 1 && b >= 1) || (a >= 1 && c >= 1)
  };
}

// Build the claim note from ticked boxes — mirrors the clerk's format
function _cdNote() {
  var picked = [];
  ['A', 'B', 'C'].forEach(function(grp) {
    CD_CRITERIA[grp].forEach(function(x) {
      if (_cdState[x.id]) picked.push(x.label);
    });
  });
  return 'Complex Discharge: ' + picked.join(', ');
}

function _cdToggle(id) {
  _cdState[id] = !_cdState[id];
  _cdRender(losdays(getP(_cdPid)));
}

// Render the criteria checklist into the discharge modal body
function _cdRender(los) {
  var ev = _cdEvaluate();

  function chip(x) {
    var on  = !!_cdState[x.id];
    var css = on
      ? 'border:1px solid var(--blue-t);background:var(--blue-bg);color:var(--blue-t);font-weight:700'
      : 'border:1px solid var(--border2);background:var(--surface2);color:var(--text2)';
    return '<button onclick="_cdToggle(\'' + x.id + '\')" ' +
      'style="text-align:left;padding:9px 11px;border-radius:var(--rsm);font-size:13px;' +
      'font-family:inherit;cursor:pointer;line-height:1.25;' + css + '">' +
      (on ? '\u2713 ' : '') + esc(x.label) + '</button>';
  }
  function group(grp, title) {
    return '<div style="font-size:11px;font-weight:700;color:var(--text3);' +
      'text-transform:uppercase;letter-spacing:.4px;margin:11px 0 5px">' + title + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:5px">' +
      CD_CRITERIA[grp].map(chip).join('') + '</div>';
  }

  var verdict;
  if (ev.qualifies) {
    verdict = '<div style="background:var(--green-bg);color:var(--green-t);font-weight:700;' +
      'font-size:13px;padding:9px 11px;border-radius:var(--rsm)">' +
      '\u2713 Qualifies — complex discharge surcharge applies</div>';
  } else if (ev.a === 0) {
    verdict = '<div style="background:var(--amber-bg);color:var(--amber-t);font-weight:600;' +
      'font-size:12px;padding:9px 11px;border-radius:var(--rsm)">' +
      'Select at least one major comorbidity (group A) to begin.</div>';
  } else {
    verdict = '<div style="background:var(--amber-bg);color:var(--amber-t);font-weight:600;' +
      'font-size:12px;padding:9px 11px;border-radius:var(--rsm)">' +
      'Add one more — a 2nd major comorbidity, any minor criterion, or malignancy.</div>';
  }

  var addBtn = ev.qualifies
    ? '<button class="btn btn-g" style="margin:0" data-pid="' + _cdPid + '" ' +
      'onclick="dischComplex(this)">Add 78717 &amp; continue</button>'
    : '<button class="btn btn-g" style="margin:0;opacity:.4;pointer-events:none">' +
      'Add 78717 &amp; continue</button>';

  var h =
    '<div style="font-size:15px;font-weight:700;color:var(--text1);margin-bottom:2px">' +
      'Age ' + _cdAge(getP(_cdPid)) + ' · LOS ' + los + ' days</div>' +
    '<div style="font-size:13px;color:var(--amber-t);font-weight:700;margin-bottom:4px">' +
      '\u26a0 Review for Complex D/C criteria</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">' +
      'Rule: 2 major, or 1 major + 1 minor, or 1 major + malignancy.</div>' +
    '<div style="max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
      'border:.5px solid var(--border2);border-radius:var(--rsm);padding:4px 9px 11px">' +
      group('A', 'A — Major comorbidities') +
      group('B', 'B — Minor criteria') +
      group('C', 'C — Malignancy') +
    '</div>' +
    '<div style="margin:9px 0 4px">' + verdict + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      addBtn +
      '<button class="btn btn-s" style="margin:0" data-pid="' + _cdPid + '" ' +
      'onclick="dischConfirmRemove(this)">Doesn\'t qualify — discharge without surcharge</button>' +
      '<button class="btn btn-s" style="margin:0" ' +
      'onclick="hideModal(\'disch-modal\')">Cancel — exit to review chart</button>' +
    '</div>';
  document.getElementById('disch-body').innerHTML = h;
}

// Step 2: Complex discharge — any patient with LOS >= 4 gets criteria checklist
function _dischStep2(pid) {
  var p   = getP(pid);
  var los = losdays(p);
  if (los >= 4) {
    _cdPid   = pid;
    _cdState = {};
    // Pre-tick only what the app can determine itself — MD still confirms each box
    if (_cdAge(p) > 75) _cdState['age75'] = true;
    var icdKey = String(p.icd || '').trim().toUpperCase();
    if (CD_ICD_MAP[icdKey]) _cdState[CD_ICD_MAP[icdKey]] = true;
    _cdRender(los);
  } else {
    _dischStep3(pid);
  }
}

// Add 78717 with the criteria note, then go to step 3
function dischComplex(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  if (!checkDoc()) return;
  addClaim(p, '78717', '78717', 1, TODAY, 'I', null, _cdNote());
  sv('claims', st.claims);
  _dischStep3(pid);
}

// Step 3: Final confirm — date picker + remove from list
function _dischStep3(pid) {
  var todayISO = (function() {
    var p = TODAY.split('/'); return p[2] + '-' + p[1] + '-' + p[0];
  })();
  var h = '<div style="margin-bottom:10px">' +
    '<label style="font-size:11px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Discharge date</label>' +
    '<input type="date" id="disch-date-input" value="' + todayISO + '" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px">' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    '<button class="btn btn-p" style="margin:0" data-pid="' + pid + '" ' +
    'onclick="dischConfirmRemove(this)">Remove from list</button>' +
    '<button class="btn btn-s" style="margin:0" onclick="hideModal(\'disch-modal\')">Cancel</button>' +
    '</div>';
  document.getElementById('disch-body').innerHTML = h;
}

function dischConfirmRemove(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  var dateInput = document.getElementById('disch-date-input');
  var dcDate = TODAY;
  if (dateInput && dateInput.value) {
    var dp = dateInput.value.split('-');
    if (dp.length === 3) dcDate = dp[2] + '/' + dp[1] + '/' + dp[0];
  }
  p.dischargeDate = dcDate;   // DD/MM/YYYY — human-readable, pushed to Sheets
  logChange(p, 'Discharged', 'D/C ' + dcDate);
  removePatient(pid);
  hideModal('disch-modal');
  closeClaimScreen();
  showToast(p.last + ' discharged');
}

function dopt(color, label, sub, fn) {
  var bg = { green:'var(--green-bg)', blue:'var(--blue-bg)', amber:'var(--amber-bg)', teal:'var(--teal-bg)', red:'var(--red-bg)' };
  var tc = { green:'var(--green-t)',  blue:'var(--blue-t)',  amber:'var(--amber-t)',  teal:'var(--teal-t)',  red:'var(--red-t)'  };
  return '<div class="move-opt" onclick="' + fn + '">' +
    '<div class="move-ico" style="background:' + bg[color] + ';color:' + tc[color] + '">' +
      '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
    '</div>' +
    '<div><div class="move-lbl">' + label + '</div><div class="move-sub">' + sub + '</div></div>' +
    '</div>';
}

function disch78717() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  addClaim(p, '33008', '33008', 1, TODAY, 'I');
  addClaim(p, '78717', '78717', 1, TODAY, 'I');
  logChange(p, 'Discharged (33008 + 78717)', '');
  removePatient(_claimPid);
  hideModal('disch-modal');
  closeClaimScreen();
  showToast('33008 + 78717 billed — ' + p.last + ' discharged');
}

function dischSimple() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  addClaim(p, '33008', '33008', 1, TODAY, 'I');
  logChange(p, 'Discharged (33008)', '');
  removePatient(_claimPid);
  hideModal('disch-modal');
  closeClaimScreen();
  showToast('33008 billed — ' + p.last + ' discharged');
}

function transferToDir() {
  var p = getP(_claimPid);
  p.care = 'directive';
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Transferred MRP → Directive', '');
  hideModal('disch-modal');
  closeClaimScreen();
  showToast(p.last + ' now on directive care');
}


function removePatient(pid) {
  var p = st.patients.find(function(p) { return p.id === pid; });
  if (!p) return;
  // Soft delete — keep for 21 days for "Recent patients" claims, then purge
  // v4.26: Safety net — ensure dischargeDate is always set. disch78717() and
  // dischSimple() call removePatient without setting dischargeDate first,
  // which left the calendar span unbounded (gaps shown after discharge).
  if (!p.dischargeDate) p.dischargeDate = TODAY;
  p.dischargedAt = Date.now();
  p.discharged   = true;
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p); // update on sheets too
  render();
  // If the discharged pane is currently visible, refresh it too
  var dischPane = document.getElementById('p-discharged');
  if (dischPane && dischPane.classList.contains('on')) {
    var searchEl = document.getElementById('discharged-search');
    renderDischarged(searchEl ? searchEl.value : '');
  }
}

function purgeOldPatients() {
  // Keep all discharged patients — Recent Patients tab shows them with Restore button.
  // Only purge if dischargedAt is somehow zero/invalid (data corruption guard).
  // The 21-day local cache limit is removed: Sheets is the long-term store.
  var before = st.patients.length;
  st.patients = st.patients.filter(function(p) {
    if (!p.discharged) return true;         // active — always keep
    var ms = parseDischargedAt(p.dischargedAt);
    return ms > 0;                          // keep if valid timestamp; drop if corrupt
  });
  if (st.patients.length < before) {
    sv('patients', st.patients);
  }
}

// 11_export.js — export queue helpers (CSV export removed v3.75;
//   all CSV generation handled by Google Sheets Apps Script)
// ═══════════════════════════════════════════════════════

function purgeSubmittedClaims() {
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-90);
  var cutoffStr = cutoff.toISOString().slice(0,10);
  var before = st.claims.length;
  st.claims = st.claims.filter(function(c) {
    if (!parseBool(c.submitted)) return true;
    if (!c.submittedAt) return true;
    return c.submittedAt.slice(0,10) >= cutoffStr;
  });
  if (st.claims.length < before) sv('claims', st.claims);
}

function removeClaim(id) {
  st.claims = st.claims.filter(function(c) { return c.id !== id; });
  sv('claims', st.claims);
}

function clearQueue() {
  st.claims = [];
  sv('claims', st.claims);
  showToast('Queue cleared');
}

// ═══════════════════════════════════════════════════════
// QuickChart export — patient list for QuickChart MD AI scribe
// Generates a print-ready page with patient name, DOB, PHN,
// sex, and appointment time. User prints / saves as PDF.
// ═══════════════════════════════════════════════════════

var _qcListMode = 'on';   // 'on' | 'off'
var _qcCcuOrder = 'desc'; // 'desc' | 'asc'
var _qcWards    = { CCU: true, '2S': true, '2W': true };

function openQuickChartExport() {
  _qcListMode = 'on';
  _qcCcuOrder = 'desc';
  _qcWards    = { CCU: true, '2S': true, '2W': true };
  _qcRenderModal();
  showModal('qc-modal');
}

function _qcRenderModal() {
  var html = '';
  // List mode pills
  html += '<div style="margin-bottom:12px">';
  html += '<label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Patient list</label>';
  html += '<div class="fl" style="gap:6px">';
  html += '<button class="ap-list-pill' + (_qcListMode === 'on'  ? ' on' : '') + '" onclick="_qcSetList(\'on\')">On Service</button>';
  html += '<button class="ap-list-pill' + (_qcListMode === 'off' ? ' on' : '') + '" onclick="_qcSetList(\'off\')">Off Service</button>';
  html += '</div></div>';

  // Ward selection + CCU order (only for on-service)
  if (_qcListMode === 'on') {
    // Ward toggles
    html += '<div style="margin-bottom:12px">';
    html += '<label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">Wards to include</label>';
    html += '<div class="fl" style="gap:6px">';
    html += '<button class="ap-list-pill' + (_qcWards.CCU ? ' on' : '') + '" onclick="_qcToggleWard(\'CCU\')">CCU</button>';
    html += '<button class="ap-list-pill' + (_qcWards['2S'] ? ' on' : '') + '" onclick="_qcToggleWard(\'2S\')">2S</button>';
    html += '<button class="ap-list-pill' + (_qcWards['2W'] ? ' on' : '') + '" onclick="_qcToggleWard(\'2W\')">2W</button>';
    html += '</div></div>';

    // CCU bed order (only when CCU is selected)
    if (_qcWards.CCU) {
      html += '<div style="margin-bottom:12px">';
      html += '<label style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px">CCU bed order</label>';
      html += '<div class="fl" style="gap:6px">';
      html += '<button class="ap-list-pill' + (_qcCcuOrder === 'desc' ? ' on' : '') + '" onclick="_qcSetCcu(\'desc\')">Descending (8\u21921)</button>';
      html += '<button class="ap-list-pill' + (_qcCcuOrder === 'asc'  ? ' on' : '') + '" onclick="_qcSetCcu(\'asc\')">Ascending (1\u21928)</button>';
      html += '</div></div>';
    }
  }

  // Patient count preview
  var pts = _qcGetPatients();
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;padding:8px 10px;background:var(--surface2);border-radius:var(--rsm)">';
  html += '<b>' + pts.length + '</b> patient' + (pts.length !== 1 ? 's' : '') + ' will be exported';
  if (_qcListMode === 'on' && pts.length > 0) {
    var wardCounts = {};
    pts.forEach(function(p) { var w = p.ward || 'Other'; wardCounts[w] = (wardCounts[w] || 0) + 1; });
    var bits = [];
    Object.keys(wardCounts).forEach(function(w) { bits.push(w + ': ' + wardCounts[w]); });
    html += ' (' + bits.join(', ') + ')';
  }
  html += '</div>';

  // Export button
  html += '<button class="btn btn-p" style="width:100%" onclick="_qcGenerate()"' +
          (pts.length === 0 ? ' disabled style="width:100%;opacity:.4;pointer-events:none"' : '') +
          '>Export PDF</button>';

  document.getElementById('qc-content').innerHTML = html;
}

function _qcSetList(mode) {
  _qcListMode = mode;
  _qcRenderModal();
}

function _qcSetCcu(order) {
  _qcCcuOrder = order;
  _qcRenderModal();
}

function _qcToggleWard(ward) {
  _qcWards[ward] = !_qcWards[ward];
  _qcRenderModal();
}

function _qcGetPatients() {
  var list = _qcListMode;
  var pts = st.patients.filter(function(p) {
    return p.list === list && !p.discharged;
  });
  // On-service: filter to selected wards only
  if (list === 'on') {
    pts = pts.filter(function(p) {
      var w = p.ward || '';
      // If ward is one of the toggleable wards, check the toggle
      if (w === 'CCU' || w === '2S' || w === '2W') return !!_qcWards[w];
      // Other wards: include only if at least one main ward is selected
      // (they always round on "other" patients when rounding at all)
      return _qcWards.CCU || _qcWards['2S'] || _qcWards['2W'];
    });
  }
  return pts;
}

function _qcSortOnService(pts) {
  var WARD_PRI = { 'CCU': 0, '2S': 1, '2W': 2 };
  var ccuOrder = _qcCcuOrder;

  return pts.slice().sort(function(a, b) {
    var wA = String(a.ward || '');
    var wB = String(b.ward || '');
    var priA = WARD_PRI[wA] != null ? WARD_PRI[wA] : 3;
    var priB = WARD_PRI[wB] != null ? WARD_PRI[wB] : 3;

    if (priA !== priB) return priA - priB;

    if (priA === 3) {
      if (wA !== wB) return wA.localeCompare(wB);
      return _qcBedCompare(a.bed, b.bed, 'asc');
    }

    var bedOrder = (wA === 'CCU') ? ccuOrder : 'asc';
    return _qcBedCompare(a.bed, b.bed, bedOrder);
  });
}

function _qcBedCompare(bedA, bedB, order) {
  var nA = parseInt(String(bedA || ''), 10);
  var nB = parseInt(String(bedB || ''), 10);
  var cmp;
  if (!isNaN(nA) && !isNaN(nB)) {
    cmp = nA - nB;
  } else {
    cmp = String(bedA || '').localeCompare(String(bedB || ''));
  }
  return order === 'desc' ? -cmp : cmp;
}

function _qcGenerate() {
  var pts = _qcGetPatients();
  if (!pts.length) { showToast('No patients to export', 'error'); return; }

  if (_qcListMode === 'on') {
    pts = _qcSortOnService(pts);
  } else {
    pts = pts.slice().sort(function(a, b) {
      return String(a.last || '').localeCompare(String(b.last || ''));
    });
  }

  var isOn = _qcListMode === 'on';
  var baseHour = 7, baseMin = 0;
  var rows = pts.map(function(p, i) {
    var mins = isOn ? (baseMin + i * 10) : 0;
    var h = baseHour + Math.floor(mins / 60);
    var m = mins % 60;
    var timeStr = pad(h) + ':' + pad(m);

    var dobDisplay = dispDate(p.dob);

    return {
      name: (p.last || '') + ', ' + (p.first || ''),
      dob:  dobDisplay,
      phn:  p.phn || '',
      sex:  p.sex || '',
      time: timeStr,
      ward: p.ward || '',
      bed:  p.bed  || ''
    };
  });

  var today = new Date();
  var dateStr = today.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  var listLabel = isOn ? 'On Service' : 'Off Service';

  var wardLabel = '';
  if (isOn) {
    var sel = [];
    if (_qcWards.CCU) sel.push('CCU');
    if (_qcWards['2S']) sel.push('2S');
    if (_qcWards['2W']) sel.push('2W');
    wardLabel = sel.join(' + ');
  }

  // --- Build the generated HTML page ---
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>QuickChart \u2014 ' + listLabel + ' \u2014 ' + dateStr + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,system-ui,sans-serif;margin:20px;color:#222;font-size:13px}' +
    'h1{font-size:16px;margin:0 0 4px;font-weight:800}' +
    '.subtitle{font-size:12px;color:#666;margin-bottom:14px}' +
    '#pt-table{width:100%;border-collapse:collapse}' +
    'th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;' +
    'border-bottom:2px solid #333;padding:5px 8px;font-weight:700}' +
    'td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;vertical-align:top}' +
    'tr:last-child td{border-bottom:none}' +
    '.ward-label{font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;' +
    'padding:10px 8px 4px;background:none;border:none}' +
    '.time{font-family:monospace;font-size:12px;white-space:nowrap}' +
    '.phn{font-family:monospace;letter-spacing:.5px}' +
    '.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}' +
    '.act-btn{display:flex;align-items:center;gap:6px;padding:10px 16px;border:none;border-radius:8px;' +
    'font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;color:#fff;flex:1;justify-content:center;min-width:140px}' +
    '.act-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}' +
    '.btn-blue{background:#2563eb}.btn-blue:active{background:#1d4ed8}' +
    '.btn-green{background:#16a34a}.btn-green:active{background:#15803d}' +
    '.btn-gray{background:#475569}.btn-gray:active{background:#334155}' +
    '.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;' +
    'padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;opacity:0;transition:opacity .3s;pointer-events:none;z-index:99}' +
    '.toast.show{opacity:1}' +
    '@media print{.actions,.toast{display:none!important}body{margin:10px}h1{font-size:14px}}' +
    '</style></head><body>';

  html += '<h1>QuickChart \u2014 ' + _qcEsc(listLabel) + '</h1>';
  html += '<div class="subtitle">' + _qcEsc(dateStr);
  if (isOn) {
    html += ' \u00b7 ' + _qcEsc(wardLabel);
    if (_qcWards.CCU) html += ' \u00b7 CCU ' + (_qcCcuOrder === 'desc' ? 'descending' : 'ascending');
  }
  html += ' \u00b7 ' + rows.length + ' patient' + (rows.length !== 1 ? 's' : '');
  html += '</div>';

  html += '<table id="pt-table"><thead><tr>';
  html += '<th>Time</th><th>Name</th><th>DOB</th><th>PHN</th><th>Sex</th>';
  if (isOn) html += '<th>Ward</th><th>Bed</th>';
  html += '</tr></thead><tbody>';

  var lastWard = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (isOn && r.ward !== lastWard) {
      html += '<tr><td colspan="7" class="ward-label">' + _qcEsc(r.ward || 'Other') + '</td></tr>';
      lastWard = r.ward;
    }
    html += '<tr>';
    html += '<td class="time">' + _qcEsc(r.time) + '</td>';
    html += '<td><b>' + _qcEsc(r.name) + '</b></td>';
    html += '<td>' + _qcEsc(r.dob) + '</td>';
    html += '<td class="phn">' + _qcEsc(r.phn) + '</td>';
    html += '<td>' + _qcEsc(r.sex) + '</td>';
    if (isOn) {
      html += '<td>' + _qcEsc(r.ward) + '</td>';
      html += '<td>' + _qcEsc(r.bed) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  // Action buttons
  html += '<div class="actions">';
  html += '<button class="act-btn btn-blue" onclick="copyImage()">' +
    '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
    'Copy as Image</button>';
  html += '<button class="act-btn btn-green" onclick="saveImage()">' +
    '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
    'Save as Image</button>';
  html += '<button class="act-btn btn-gray" onclick="window.print()">' +
    '<svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
    'Print / PDF</button>';
  html += '</div>';

  html += '<div class="toast" id="toast"></div>';

  // Canvas rendering script — draws the table as a clean image
  html += '<script>';
  html += 'var _rows=' + JSON.stringify(rows) + ';';
  html += 'var _isOn=' + (isOn ? 'true' : 'false') + ';';
  html += 'var _title="QuickChart \\u2014 ' + listLabel + '";';
  html += 'var _sub="' + _qcEsc(dateStr);
  if (isOn) {
    html += ' \\u00b7 ' + _qcEsc(wardLabel);
    if (_qcWards.CCU) html += ' \\u00b7 CCU ' + (_qcCcuOrder === 'desc' ? 'desc' : 'asc');
  }
  html += ' \\u00b7 ' + rows.length + 'pt";';

  html += 'function _toast(msg){var t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(function(){t.classList.remove("show")},2200);}';

  // renderCanvas: draws the patient table onto a canvas and returns it
  html += 'function renderCanvas(){' +
    'var dpr=window.devicePixelRatio||2;' +
    'var pad=20,rowH=28,hdrH=36,subH=20,gap=10;' +
    // Column config
    'var cols=_isOn?["Time","Name","DOB","PHN","Sex","Ward","Bed"]:["Time","Name","DOB","PHN","Sex"];' +
    'var cw=_isOn?[60,180,100,110,40,50,40]:[60,200,110,120,50];' +
    'var totalW=cw.reduce(function(a,b){return a+b},0)+pad*2;' +
    // Count total rows (including ward headers)
    'var nRows=_rows.length;' +
    'if(_isOn){var lw=null;_rows.forEach(function(r){if(r.ward!==lw){nRows++;lw=r.ward;}});}' +
    'var totalH=pad+hdrH+subH+gap+rowH+nRows*rowH+pad;' +
    'var c=document.createElement("canvas");' +
    'c.width=totalW*dpr;c.height=totalH*dpr;' +
    'var ctx=c.getContext("2d");ctx.scale(dpr,dpr);' +
    // White background
    'ctx.fillStyle="#fff";ctx.fillRect(0,0,totalW,totalH);' +
    // Title
    'ctx.fillStyle="#222";ctx.font="bold 15px -apple-system,system-ui,sans-serif";' +
    'ctx.fillText(_title,pad,pad+16);' +
    // Subtitle
    'ctx.fillStyle="#888";ctx.font="11px -apple-system,system-ui,sans-serif";' +
    'ctx.fillText(_sub,pad,pad+16+subH);' +
    // Table header
    'var y=pad+hdrH+subH+gap;' +
    'ctx.fillStyle="#666";ctx.font="bold 9px -apple-system,system-ui,sans-serif";' +
    'var x=pad;' +
    'cols.forEach(function(h,i){ctx.fillText(h.toUpperCase(),x,y);x+=cw[i];});' +
    'y+=4;ctx.strokeStyle="#333";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(totalW-pad,y);ctx.stroke();' +
    'y+=rowH-4;' +
    // Rows
    'var lastW=null;' +
    '_rows.forEach(function(r){' +
    '  if(_isOn&&r.ward!==lastW){' +
    '    ctx.fillStyle="#888";ctx.font="bold 9px -apple-system,system-ui,sans-serif";' +
    '    ctx.fillText(r.ward||"Other",pad,y);' +
    '    lastW=r.ward;y+=rowH;' +
    '  }' +
    '  ctx.fillStyle="#222";' +
    '  var x=pad;' +
    '  ctx.font="11px monospace";ctx.fillText(r.time,x,y);x+=cw[0];' +
    '  ctx.font="bold 12px -apple-system,system-ui,sans-serif";ctx.fillText(r.name,x,y);x+=cw[1];' +
    '  ctx.font="11px -apple-system,system-ui,sans-serif";ctx.fillText(r.dob,x,y);x+=cw[2];' +
    '  ctx.font="11px monospace";ctx.fillText(r.phn,x,y);x+=cw[3];' +
    '  ctx.font="11px -apple-system,system-ui,sans-serif";ctx.fillText(r.sex,x,y);x+=cw[4];' +
    '  if(_isOn){ctx.fillText(r.ward,x,y);x+=cw[5];ctx.fillText(r.bed,x,y);}' +
    '  ctx.strokeStyle="#e5e5e5";ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(pad,y+6);ctx.lineTo(totalW-pad,y+6);ctx.stroke();' +
    '  y+=rowH;' +
    '});' +
    'return c;}';

  // Copy as image to clipboard
  html += 'function copyImage(){' +
    'var c=renderCanvas();' +
    'c.toBlob(function(blob){' +
    '  if(!blob){_toast("Could not render image");return;}' +
    '  if(navigator.clipboard&&window.ClipboardItem){' +
    '    navigator.clipboard.write([new ClipboardItem({"image/png":blob})]).then(' +
    '      function(){_toast("Copied to clipboard!");},' +
    '      function(){_toast("Clipboard blocked \\u2014 try Save as Image");}' +
    '    );' +
    '  }else{_toast("Clipboard not supported \\u2014 try Save as Image");}' +
    '},"image/png");}';

  // Save as image (download PNG)
  html += 'function saveImage(){' +
    'var c=renderCanvas();' +
    'c.toBlob(function(blob){' +
    '  if(!blob){_toast("Could not render image");return;}' +
    '  var url=URL.createObjectURL(blob);' +
    '  var a=document.createElement("a");' +
    '  a.href=url;a.download="quickchart_' + today.toISOString().slice(0,10) + '.png";' +
    '  document.body.appendChild(a);a.click();document.body.removeChild(a);' +
    '  URL.revokeObjectURL(url);' +
    '  _toast("Image saved!");' +
    '},"image/png");}';

  html += '<\/script>';
  html += '</body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  var url = URL.createObjectURL(blob);
  window.open(url, '_blank');

  hideModal('qc-modal');
  showToast(rows.length + ' patient' + (rows.length !== 1 ? 's' : '') + ' exported for QuickChart');
}

// Escape helper for generated HTML (avoids collision with the main app's esc())
function _qcEsc(s) { return esc(s); }

// ═══════════════════════════════════════════════════════
// LEADERBOARD — retro arcade high-score board
// ═══════════════════════════════════════════════════════
//
// Four categories, each showing top-3 single-day records:
//   1. High Acuity    — most CCU admissions (resolved 1411) in one day
//   2. Busy Bee       — most consults (33010/33012/1411) in one day
//   3. Tax Man Cometh — highest SUM($) in one day
//   4. The Shepherd   — most distinct patients on MRP Cardiology service
//
// Hybrid data source:
//   - Local st.claims renders instantly (covers recent ~2 weeks)
//   - BigQuery fetch merges in historical all-time records
//   Best of both is shown.

var _lbInjected = false;

// ── Doctor alias → 2-char arcade initials (JKT is the exception) ─
var LB_INITIALS = {
  'KBrown':'KB', 'DPatton':'DP', 'FH':'FH', 'JW':'JW',
  'LH':'LH', 'SB':'SB', 'ASodhi':'AS', 'EMMassie':'EM',
  'KHoskin':'KH', 'AKhosla':'AK', 'AK':'AK', 'KT':'JKT', 'KP':'KP'
};

function _lbInitials(alias) {
  if (LB_INITIALS[alias]) return LB_INITIALS[alias];
  var s = String(alias || '??').toUpperCase();
  return s.length >= 2 ? s.slice(0,2) : (s + '\u00B7').slice(0,2);
}

// ── Compute leaderboard from local claims ────────────
// Fee codes that always count for shepherd (CCU family)
var LB_CCU_FEES = { 'CCU_DAILY':1, '1411':1, '1421':1, '1431':1, '1441':1 };

// Return the Monday that starts this DD/MM/YYYY's Mon-Sun week ("YYYY-MM-DD")
function _lbWeekKey(dateStr) {
  var parts = String(dateStr).split('/');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  d.setHours(12); // avoid DST edge
  var day = d.getDay(); // 0=Sun 1=Mon ... 6=Sat
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _computeLeaderboard() {
  if (!st.claims || !st.claims.length) return null;

  // Build PHN → patient lookup for shepherd MRP check
  var patByPhn = {};
  (st.patients || []).forEach(function(p) {
    if (p.phn) patByPhn[String(p.phn)] = p;
  });

  // Group claims by (alias, date)
  var groups = {};
  st.claims.forEach(function(c) {
    if (!c.alias || !c.date) return;
    var key = c.alias + '|' + c.date;
    if (!groups[key]) groups[key] = { alias: c.alias, date: c.date, claims: [] };
    groups[key].claims.push(c);
  });

  // Score each doctor-day
  var entries = [];
  for (var key in groups) {
    var g = groups[key];
    var ccuAdmits = 0;
    var consults  = 0;
    var revenue   = 0;
    var shepherdPHNs = {};

    g.claims.forEach(function(c) {
      var fee = c.fee;
      var resolved = fee;
      var rate;
      if (fee === 'CCU_DAILY') {
        resolved = ccuFeeForDate({ phn: c.phn }, c.date);
        rate = FEE_RATES[resolved] || 0;
      } else {
        rate = FEE_RATES[fee] || 0;
      }
      if (resolved === '1411') ccuAdmits++;
      if (resolved === '33010' || resolved === '33012' || resolved === '1411') consults++;
      revenue += rate * (c.units || 1);

      // Shepherd: CCU family always counts
      if (LB_CCU_FEES[fee] && c.phn) {
        shepherdPHNs[c.phn] = true;
      }
      // Daily (33008) counts only if patient is MRP Cardiology
      if (fee === '33008' && c.phn) {
        var pat = patByPhn[String(c.phn)];
        if (pat && /cardiology/i.test(pat.mrp) && pat.role === 'mrp') {
          shepherdPHNs[c.phn] = true;
        }
      }
    });

    var shepherdCount = 0;
    for (var _p in shepherdPHNs) shepherdCount++;

    entries.push({
      alias: g.alias, date: g.date,
      ccuAdmits: ccuAdmits, consults: consults,
      revenue: revenue, shepherd: shepherdCount
    });
  }

  // Top 3 per category
  var byAdmits = entries.filter(function(e) { return e.ccuAdmits > 0; })
    .sort(function(a, b) { return b.ccuAdmits - a.ccuAdmits; }).slice(0, 3);
  var byConsults = entries.filter(function(e) { return e.consults > 0; })
    .sort(function(a, b) { return b.consults - a.consults; }).slice(0, 3);
  var byRevenue = entries.filter(function(e) { return e.revenue > 0; })
    .sort(function(a, b) { return b.revenue - a.revenue; }).slice(0, 3);
  var byShepherd = (function() {
    // One entry per doctor per Mon-Sun rotation week (best day wins)
    var weekBest = {};  // key: "alias|weekStart" → { alias, date, shepherd }
    entries.filter(function(e) { return e.shepherd > 0; }).forEach(function(e) {
      var wk = _lbWeekKey(e.date);
      var key = e.alias + '|' + wk;
      if (!weekBest[key] || e.shepherd > weekBest[key].shepherd) {
        weekBest[key] = e;
      }
    });
    var arr = [];
    for (var k in weekBest) arr.push(weekBest[k]);
    arr.sort(function(a, b) { return b.shepherd - a.shepherd; });
    return arr.slice(0, 3);
  })();

  return {
    ccuAdmits: byAdmits.map(function(e) { return [e.alias, e.date, e.ccuAdmits]; }),
    consults:  byConsults.map(function(e) { return [e.alias, e.date, e.consults]; }),
    revenue:   byRevenue.map(function(e) { return [e.alias, e.date, Math.round(e.revenue * 100) / 100]; }),
    shepherd:  byShepherd.map(function(e) { return [e.alias, e.date, e.shepherd]; })
  };
}

// ── Normalize dates for merge dedup (DD/MM/YYYY vs YYYY-MM-DD) ──
function _lbNormDate(d) {
  var s = String(d || '');
  // Already DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  // YYYY-MM-DD → DD/MM/YYYY
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return parseInt(m[3],10) + '/' + parseInt(m[2],10) + '/' + m[1];
  return s;
}

// ── Merge local + BQ results ─────────────────────────
function _mergeLeaderboards(local, bq) {
  return {
    ccuAdmits: _mergeCat(local ? local.ccuAdmits : [], bq ? bq.ccuAdmits : [], 3),
    consults:  _mergeCat(local ? local.consults  : [], bq ? bq.consults  : [], 3),
    revenue:   _mergeCat(local ? local.revenue   : [], bq ? bq.revenue   : [], 3),
    shepherd:  _mergeShepherd(local ? local.shepherd : [], bq ? bq.shepherd : [])
  };
}

function _mergeCat(a, b, limit) {
  var map = {};
  (a || []).concat(b || []).forEach(function(r) {
    var normD = _lbNormDate(r[1]);
    var key = r[0] + '|' + normD;
    var score = Number(r[2]) || 0;
    if (!map[key] || score > Number(map[key][2])) {
      map[key] = [r[0], normD, r[2]];
    }
  });
  var out = [];
  for (var k in map) out.push(map[k]);
  out.sort(function(x, y) { return Number(y[2]) - Number(x[2]); });
  return out.slice(0, limit || 3);
}

// Shepherd merge: one entry per doctor per Mon-Sun week
function _mergeShepherd(a, b) {
  var map = {};
  (a || []).concat(b || []).forEach(function(r) {
    var normD = _lbNormDate(r[1]);
    var key = r[0] + '|' + normD;
    var score = Number(r[2]) || 0;
    if (!map[key] || score > Number(map[key][2])) {
      map[key] = [r[0], normD, r[2]];
    }
  });
  var all = [];
  for (var k in map) all.push(map[k]);
  all.sort(function(x, y) { return Number(y[2]) - Number(x[2]); });
  // Dedup: one entry per doctor per Mon-Sun week
  var seen = {};
  var out = [];
  for (var i = 0; i < all.length && out.length < 3; i++) {
    var wk = all[i][0] + '|' + _lbWeekKey(all[i][1]);
    if (!seen[wk]) {
      seen[wk] = true;
      out.push(all[i]);
    }
  }
  return out;
}

// ── Async BQ fetch — returns data (or null on failure) ──
async function _fetchBQLeaderboard() {
  if (!SHEETS_URL) return null;
  try {
    var url = SHEETS_URL + '?action=getLeaderboard&key=' + SHARED_KEY + '&_t=' + Date.now();
    var resp = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) return null;
    var bqData = await resp.json();
    if (bqData.error) return null;
    return bqData;
  } catch(e) {
    console.warn('[Leaderboard] BQ fetch failed:', e.message);
    return null;
  }
}

// ── CSS — injected once on first open ────────────────
var LB_CSS =
  '.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:200;' +
    'display:none;flex-direction:column;align-items:center;overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch}' +
  '.lb-overlay.open{display:flex}' +

  /* CRT scanlines */
  '.lb-scan{position:fixed;inset:0;pointer-events:none;z-index:201;' +
    'background:repeating-linear-gradient(0deg,transparent,transparent 2px,' +
    'rgba(0,255,0,.035) 2px,rgba(0,255,0,.035) 4px)}' +

  /* CRT vignette */
  '.lb-vignette{position:fixed;inset:0;pointer-events:none;z-index:201;' +
    'background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.5) 100%)}' +

  '.lb-screen{width:100%;max-width:420px;padding:24px 16px 40px;position:relative;z-index:201}' +

  /* Power-on flicker */
  '@keyframes lb-poweron{0%{opacity:0}5%{opacity:.8}10%{opacity:.2}' +
    '20%{opacity:.9}30%{opacity:.4}50%{opacity:1}100%{opacity:1}}' +
  '.lb-screen.animating{animation:lb-poweron .6s ease-out}' +

  /* Title */
  '.lb-title{font-family:"Courier New",Courier,monospace;font-size:22px;font-weight:900;' +
    'text-align:center;color:#0f0;text-shadow:0 0 10px #0f0,0 0 20px #0f0,0 0 40px #080;' +
    'letter-spacing:4px;margin-bottom:2px;text-transform:uppercase}' +
  '.lb-subtitle{font-family:"Courier New",monospace;font-size:10px;text-align:center;' +
    'color:#0a0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase}' +

  /* Category headers */
  '.lb-cat{margin-bottom:22px}' +
  '.lb-cat-hdr{font-family:"Courier New",monospace;font-size:12px;font-weight:700;' +
    'color:#ff0;text-shadow:0 0 8px rgba(255,255,0,.6);letter-spacing:2px;text-align:center;' +
    'text-transform:uppercase;border-top:1px solid #333;border-bottom:1px solid #333;' +
    'padding:6px 0;margin-bottom:2px}' +

  /* Category subtitles */
  '.lb-cat-sub{font-family:"Courier New",monospace;font-size:9px;color:#070;' +
    'text-align:center;letter-spacing:1px;margin-bottom:8px;text-transform:uppercase}' +

  /* Score rows */
  '.lb-row{display:flex;align-items:center;padding:5px 2px;gap:6px}' +
  '.lb-medal{font-size:20px;width:30px;text-align:center;flex-shrink:0}' +
  '.lb-ini{font-family:"Courier New",monospace;font-size:17px;color:#0f0;' +
    'text-shadow:0 0 6px #0f0;letter-spacing:3px;font-weight:700;width:60px}' +
  '.lb-dots{flex:1;font-family:"Courier New",monospace;font-size:12px;color:#040;' +
    'overflow:hidden;white-space:nowrap;letter-spacing:2px}' +
  '.lb-score{font-family:"Courier New",monospace;font-size:17px;color:#fff;' +
    'text-align:right;font-weight:700;text-shadow:0 0 4px rgba(255,255,255,.5);' +
    'white-space:nowrap}' +
  '.lb-date{font-family:"Courier New",monospace;font-size:9px;color:#070;' +
    'text-align:right;margin-top:1px;letter-spacing:1px}' +
  '.lb-score-wrap{text-align:right;flex-shrink:0}' +

  /* Empty */
  '.lb-msg{font-family:"Courier New",monospace;font-size:12px;text-align:center;' +
    'padding:16px;color:#0a0}' +

  /* Close button */
  '.lb-close{position:fixed;top:14px;right:14px;z-index:202;width:36px;height:36px;' +
    'border-radius:50%;border:2px solid #0f0;background:rgba(0,0,0,.8);color:#0f0;' +
    'font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'text-shadow:0 0 6px #0f0;font-family:"Courier New",monospace}' +
  '.lb-close:active{background:#0f0;color:#000}' +

  /* Footer */
  '.lb-footer{font-family:"Courier New",monospace;font-size:10px;color:#040;' +
    'text-align:center;letter-spacing:3px;margin-top:20px;text-transform:uppercase}' +

  /* Trophy header button */
  '.lb-trophy-btn{display:flex;align-items:center;justify-content:center;' +
    'width:30px;height:30px;border:.5px solid var(--border2);border-radius:50%;' +
    'cursor:pointer;background:var(--surface);font-size:15px;' +
    'transition:border-color .15s,background .15s}' +
  '.lb-trophy-btn:active{border-color:var(--amber-t);background:var(--amber-bg)}' +

  /* Loading banner */
  '.lb-loading{text-align:center;padding:60px 16px}' +
  '.lb-loading-text{font-family:"Courier New",monospace;font-size:14px;color:#0a0;' +
    'letter-spacing:3px;text-transform:uppercase;text-shadow:0 0 8px rgba(0,255,0,.4)}' +
  '@keyframes lb-cursor{0%,49%{opacity:1}50%,100%{opacity:0}}' +
  '.lb-blink{animation:lb-cursor .8s step-end infinite}';


// ── HTML — the modal shell ───────────────────────────
function _lbModalHtml() {
  return '<div class="lb-overlay" id="lb-overlay" onclick="_lbOverlayTap(event)">' +
    '<div class="lb-scan"></div>' +
    '<div class="lb-vignette"></div>' +
    '<div class="lb-close" onclick="hideLeaderboard()">\u2715</div>' +
    '<div class="lb-screen" id="lb-screen">' +
      '<div class="lb-title">HIGH SCORES</div>' +
      '<div class="lb-subtitle">KGH Cardiology</div>' +
      '<div id="lb-body"></div>' +
      '<div class="lb-footer">\u2014 24hr clinical day \u2014</div>' +
    '</div>' +
  '</div>';
}

// ── Inject UI into DOM — called once from init() ─────
function _injectLeaderboardUI() {
  if (_lbInjected) return;
  _lbInjected = true;

  var style = document.createElement('style');
  style.textContent = LB_CSS;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', _lbModalHtml());

  var hdrRight = document.querySelector('.hdr > div:last-child');
  if (hdrRight) {
    var btn = document.createElement('div');
    btn.className = 'lb-trophy-btn';
    btn.title = 'Leaderboard';
    btn.onclick = showLeaderboard;
    btn.textContent = '\uD83C\uDFC6';
    hdrRight.insertBefore(btn, hdrRight.firstChild);
  }
}

// ── Show / hide ──────────────────────────────────────
async function showLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  var screen = document.getElementById('lb-screen');
  if (screen) {
    screen.classList.remove('animating');
    void screen.offsetWidth;
    screen.classList.add('animating');
  }

  // 1. Show loading banner
  var body = document.getElementById('lb-body');
  if (body) {
    body.innerHTML =
      '<div class="lb-loading">' +
        '<div class="lb-loading-text">DUSTING OFF THE ARCHIVES<span class="lb-blink">_</span></div>' +
      '</div>';
  }

  // 2. Fetch BQ (authoritative), fall back to local-only on failure
  var bqData = await _fetchBQLeaderboard();

  // 3. Compute local (covers unsynced active-patient claims)
  var localData = _computeLeaderboard();

  // 4. Merge: BQ authoritative for any date it covers, local fills gaps
  var merged = _mergeLeaderboards(localData, bqData);
  _renderLeaderboard(merged);
}

function hideLeaderboard() {
  var overlay = document.getElementById('lb-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _lbOverlayTap(e) {
  if (e.target.id === 'lb-overlay') hideLeaderboard();
}

// ── Render the four categories ───────────────────────
var LB_MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

function _renderLeaderboard(data) {
  var body = document.getElementById('lb-body');
  if (!body) return;

  if (!data) {
    body.innerHTML = '<div class="lb-msg">NO CLAIMS DATA \u2014 SYNC FIRST</div>';
    return;
  }

  var html = '';
  html += _renderCategory('\u2764\uFE0F HIGH ACUITY', 'Most CCU admissions in 24hrs', data.ccuAdmits || [], false);
  html += _renderCategory('\uD83D\uDC1D BUSY BEE', 'Most consults in 24hrs', data.consults || [], false);
  html += _renderCategory('\uD83D\uDCB0 THE TAX MAN COMETH', 'Highest $ billed in 24hrs', data.revenue || [], true);
  html += _renderCategory('\uD83D\uDC11 THE SHEPHERD', 'Most patients on service in 24hrs', data.shepherd || [], false);

  body.innerHTML = html;
}

function _renderCategory(title, subtitle, rows, isDollar) {
  if (!rows.length) {
    return '<div class="lb-cat">' +
      '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
      '<div class="lb-cat-sub">' + esc(subtitle) + '</div>' +
      '<div class="lb-msg">\u2014 NO ENTRIES \u2014</div>' +
    '</div>';
  }
  var html = '<div class="lb-cat">' +
    '<div class="lb-cat-hdr">' + esc(title) + '</div>' +
    '<div class="lb-cat-sub">' + esc(subtitle) + '</div>';
  for (var i = 0; i < rows.length && i < 3; i++) {
    var r = rows[i];
    var alias = r[0] || '???';
    var dt    = r[1] || '';
    var score = isDollar
      ? ('$' + Number(r[2] || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0}))
      : String(r[2] || 0);
    var ini   = _lbInitials(alias);

    html += '<div class="lb-row">' +
      '<div class="lb-medal">' + LB_MEDALS[i] + '</div>' +
      '<div class="lb-ini">' + esc(ini) + '</div>' +
      '<div class="lb-dots">\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7</div>' +
      '<div class="lb-score-wrap">' +
        '<div class="lb-score">' + esc(score) + '</div>' +
        '<div class="lb-date">' + esc(dt) + '</div>' +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
}
// ── 12_referrers.js ──
// ═══════════════════════════════════════════════════════
