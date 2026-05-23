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

// Step 2: Complex discharge prompt — Cardiology MRP, non-CCU/ICU ward, LOS > 4 only
function _dischStep2(pid) {
  var p   = getP(pid);
  var los = losdays(p);
  // Complex discharge applies to ALL Cardiology MRP patients with LOS > 4, including CCU/ICU
  var isCardioMRP = p.role === 'mrp' && p.mrp === 'Cardiology';
  if (isCardioMRP && los > 4) {
    var h = '<div style="font-size:13px;color:var(--amber-t);font-weight:700;margin-bottom:10px">' +
      '⚠ LOS ' + los + ' days — does complex discharge apply?</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button class="btn btn-g" style="margin:0" data-pid="' + pid + '" ' +
      'onclick="dischComplex(this)">Yes — add 78717</button>' +
      '<button class="btn btn-s" style="margin:0" data-pid="' + pid + '" ' +
      'onclick="dischConfirmRemove(this)">No — patient doesn\'t qualify</button>' +
      '</div>';
    document.getElementById('disch-body').innerHTML = h;
  } else {
    _dischStep3(pid);
  }
}

// Add 78717 then go to step 3
function dischComplex(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  if (!checkDoc()) return;
  addClaim(p, '78717', '78717', 1, TODAY, 'I');
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

