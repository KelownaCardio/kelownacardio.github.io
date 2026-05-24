// ── 10_location.js ──
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
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

  // Pre-select current ward
  selectLocWard(p.ward);
  document.getElementById('loc-list').value = p.list || 'on';
  document.getElementById('loc-care').value = p.care || 'daily';

  showPane('p-loc');
}

function selectLocWard(ward) {
  _locWard = ward;
  document.querySelectorAll('.loc-opt').forEach(function(el) { el.classList.remove('selected'); });
  var opt = document.getElementById('loc-opt-' + ward);
  if (opt) opt.classList.add('selected');

  var w = WARDS[ward] || {};
  var geoWards = ['CCU','2S','2W'];
  var listSel = document.getElementById('loc-list');
  var careSel = document.getElementById('loc-care');

  if (geoWards.indexOf(ward) === -1) {
    // Non-geographic ward — always snap to Off Service / directive for safety
    if (listSel) listSel.value = 'off';
    if (careSel) careSel.value = 'directive';
  } else {
    if (listSel) listSel.value = w.list || 'on';
    if (careSel) careSel.value = w.care || 'daily';
  }

  // Populate room selector
  var rooms = w.rooms || [];
  document.getElementById('loc-room').innerHTML =
    '<option value="">— select —</option>' +
    rooms.map(function(r) { return '<option value="' + r + '">' + r + '</option>'; }).join('');
}

function confirmLocChange() {
  var p    = getP(_locPid);
  var from = p.ward;
  p.ward   = _locWard;
  p.bed    = gv('loc-room');
  p.care   = gv('loc-care');

  // Safety rule: any ward outside the geographic view (CCU/2S/2W)
  // is forced to Off Service so the patient doesn't disappear from rounds.
  var geoWards = ['CCU','2S','2W'];
  var requestedList = gv('loc-list');
  if (geoWards.indexOf(_locWard) === -1 && requestedList === 'on') {
    p.list = 'off';
    p.care = 'directive';
  } else {
    p.list = requestedList;
  }

  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Location changed', from + ' → ' + _locWard);
  closeLocScreen();
  var suffix = (p.list === 'off' && requestedList === 'on')
    ? ' → moved to Off Service (not on geo view)' : '';
  showToast(p.last + ' moved to ' + wardLabel(_locWard) + suffix);
}

function closeLocScreen() {
  document.getElementById('p-loc').classList.remove('on');
  showPane('p0');
  document.querySelectorAll('.nb').forEach(function(b, i) { b.classList.toggle('on', i === 0); });
  render();
}

// ── Discharge Modal ────────────────────────────────────
// Flow:
//   Step 1 — if no visit billed today: offer visit type buttons (default by ward/role)
//   Step 2 — if Cardiology MRP, non-CCU ward, LOS > 4: complex discharge prompt
//   Step 3 — Confirm discharge & remove (single action, no error-removal path)
//
function openDischModal(pid) {
  _claimPid = pid;
  var p = getP(pid);
  document.getElementById('disch-title').textContent = p.last + ', ' + p.first;
  // v3.27 — surface admission-wide billing gaps before the today's-visit prompt
  _dischCheckGaps(pid);
  showModal('disch-modal');
}

// v3.27 — if any historical days inside the admission are unbilled (and the
// patient has a gap rule, i.e. CCU or MRP daily), prompt the doctor to fix
// them BEFORE the existing today's-visit + LOS>4 flow. If no gaps, fall
// straight through to _dischStep1 as before.
function _dischCheckGaps(pid) {
  var p = getP(pid);
  if (!p) { _dischStep1(pid); return; }
  var rule = _cvGapRuleForPatient(p);
  if (!rule) { _dischStep1(pid); return; }
  var claims = st.claims.filter(function(c) {
    return c.phn && p.phn && samePhn(c.phn, p.phn);
  });
  var gaps = _cvGapDays(p, claims);
  if (!gaps.length) { _dischStep1(pid); return; }

  // Render gap-warning step into the discharge modal body
  var gapStr = gaps.slice(0, 8).map(function(g) {
    var parts = g.split('/');
    return parseInt(parts[0]) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1])-1];
  }).join(', ') + (gaps.length > 8 ? '…' : '');

  var body = document.getElementById('disch-body');
  if (!body) { _dischStep1(pid); return; }

  body.innerHTML =
    '<div class="cv-warn" style="margin:6px 0 12px">' +
      '<div class="cv-warn-icon">⚠</div>' +
      '<div class="cv-warn-body">' +
        '<b>' + gaps.length + ' unbilled ' + (rule === 'ccu' ? 'CCU' : 'MRP') + ' day' + (gaps.length>1?'s':'') + ' in this admission</b>' +
        '<span>' + gapStr + '. Discharging now leaves them unbilled.</span>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" data-pid="' + pid + '" onclick="_dischIgnoreGaps(this)">Discharge anyway</button>' +
      '<button class="btn btn-p" style="flex:1;margin-bottom:0" data-pid="' + pid + '" onclick="_dischFixGaps(this)">Fix gaps first</button>' +
    '</div>';
}

function _dischIgnoreGaps(btn) {
  var pid = btn.getAttribute('data-pid');
  _dischStep1(pid);
}

function _dischFixGaps(btn) {
  var pid = btn.getAttribute('data-pid');
  hideModal('disch-modal');
  // Open patient summary on the calendar tab — that's where the doc fixes gaps
  openPatientSummary(pid);
}

// Has any visit been billed today for this patient?
function _visitBilledToday(p) {
  var visitFees = ['33008','33006','CCU_DAILY','33010','33012'];
  return st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) && c.date === TODAY && visitFees.indexOf(c.fee) !== -1;
  });
}

// Step 1: Prompt to add today's visit if none yet
function _dischStep1(pid) {
  var p = getP(pid);
  if (_visitBilledToday(p)) {
    _dischStep2(pid);
    return;
  }

  var isCCUWard = ['CCU','CSICU','ICUA','ICUB','ICUD'].indexOf(p.ward) !== -1;
  var isMRP  = p.role === 'mrp';
  var isComb = p.care === 'combined';

  function vbtn(label, fee, feeCode, isDefault) {
    var bg  = isDefault ? 'var(--blue)'  : 'var(--surface)';
    var col = isDefault ? '#fff'         : 'var(--text)';
    var bdr = isDefault ? 'var(--blue)'  : 'var(--border2)';
    return '<button style="padding:10px 6px;border:1.5px solid ' + bdr + ';border-radius:var(--rsm);' +
      'background:' + bg + ';color:' + col + ';font-size:11px;font-weight:700;' +
      'cursor:pointer;font-family:inherit;text-align:center;line-height:1.3" ' +
      'data-pid="' + pid + '" data-fee="' + fee + '" data-feecode="' + feeCode + '" ' +
      'onclick="dischAddVisit(this)">' + label + '</button>';
  }

  var btns = '';
  if (isCCUWard && isMRP) {
    // CCU/ICU ward, MRP role → CCU Daily default
    // v3.60: write CCU_DAILY placeholder; export consolidates.
    btns += vbtn('CCU Daily',      'CCU_DAILY', 'CCU_DAILY', true);
    btns += vbtn('Daily\n33008',   '33008',     '33008',     false);
    btns += vbtn('Directive',      '33006',     '33006',     false);
  } else if (isMRP) {
    // Ward MRP → Daily 33008 default always
    btns += vbtn('Daily\n33008',   '33008',     '33008',     true);
    // v3.60: write CCU_DAILY placeholder; export consolidates.
    btns += vbtn('CCU Daily',      'CCU_DAILY', 'CCU_DAILY', false);
    btns += vbtn('Directive',      '33006',     '33006',     false);
  } else {
    // Consultant role → Combined Daily or Directive only (no CCU Daily)
    btns += vbtn('Combined\nDaily','33008',     '33008',     false);
    btns += vbtn('Directive',      '33006',     '33006',     true);
  }

  var h = '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">' +
    'Add visit for today?</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px">' + btns + '</div>' +
    '<button class="btn btn-s" style="margin:0;width:100%" data-pid="' + pid + '" ' +
    'onclick="_dischStep2(this.getAttribute(\'data-pid\'))">Skip — no visit</button>';
  document.getElementById('disch-body').innerHTML = h;
}

// Tapping a visit type button bills it then advances to step 2
function dischAddVisit(btn) {
  var pid     = btn.getAttribute('data-pid');
  var fee     = btn.getAttribute('data-fee');
  var feeCode = btn.getAttribute('data-feecode');
  var p = getP(pid);
  if (!checkDoc()) return;
  addClaim(p, fee, feeCode, 1, TODAY, 'I');
  sv('patients', st.patients);
  sv('claims', st.claims);
  _dischStep2(pid);
}

// ── Complex Discharge (78717) — criteria checklist ──────
// Qualifies when LOS > 4 AND Cardiology MRP AND clinical criteria:
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
    '<div style="font-size:13px;color:var(--amber-t);font-weight:700;margin-bottom:4px">' +
      '\u26a0 Review for Complex D/C criteria</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">' +
      'LOS ' + los + ' days. Rule: 2 major, or 1 major + 1 minor, or 1 major + malignancy.</div>' +
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

// Step 2: Complex discharge — Cardiology MRP + LOS > 4 -> criteria checklist
function _dischStep2(pid) {
  var p   = getP(pid);
  var los = losdays(p);
  // Complex discharge applies to ALL Cardiology MRP patients with LOS > 4, including CCU/ICU
  var isCardioMRP = p.role === 'mrp' && p.mrp === 'Cardiology';
  if (isCardioMRP && los > 4) {
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

// Step 3: Final confirm — with editable discharge date (defaults to today)
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
    'onclick="dischConfirmRemove(this)">Confirm discharge &amp; remove</button>' +
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

