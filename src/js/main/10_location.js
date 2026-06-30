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
      // 2026-06-28: hard-gate — show the calendar (visual claim history) with a
      // sticky discharge banner that tracks remaining gaps. Discharge stays
      // blocked behind the banner's Confirm button until every gap day is
      // filled or explained for billing.
      window._dischResolvePid = pid;
      showToast('Gaps in MRP care exist — fill in gaps or write a note explaining gaps to the billing team', 'error');
      openPatientSummary(pid);
      return;
    }
  }
  _cvProceedDischarge(pid);
}

// Continue into the actual discharge modal (no gaps / all resolved).
function _cvProceedDischarge(pid) {
  window._dischResolvePid = null;
  var p = getP(pid);
  if (!p) return;
  hideModal('cv-picker-modal');
  hideModal('pt-summary-modal');
  document.getElementById('disch-title').textContent = p.last + ', ' + p.first;
  _dischStep2(pid);
  showModal('disch-modal');
}

// Resolve-gaps screen — lists each unbilled day with Fill + Explain. Re-shown
// after each action; when no gaps remain it offers "Continue discharge".
// Sticky discharge banner shown at the TOP of the patient-summary while
// resolving gaps. Two paths: (a) fill individual days by tapping the highlighted
// calendar days below, and/or (b) the primary button writes ONE billing note
// covering every still-unbilled day and proceeds to discharge. Confirm is
// ALWAYS available — the doctor is never trapped behind unbillable days.
function _cvDischBannerHTML(p, claims) {
  if (window._dischResolvePid !== p.id) return '';
  var gaps = _cvGapDays(p, claims);
  var n = gaps.length, ready = (n === 0);
  var col = ready ? 'var(--green-t,#1a7f37)' : 'var(--amber-t)';
  var primary = ready
    ? '<button class="btn btn-p" style="flex:1.4;margin:0" data-pid="' + p.id + '" onclick="_cvProceedDischarge(this.getAttribute(\'data-pid\'))">Confirm &amp; discharge ›</button>'
    : '<button class="btn btn-p" style="flex:1.4;margin:0" data-pid="' + p.id + '" onclick="_cvNoteAllGapsAndDischarge(this.getAttribute(\'data-pid\'))">Confirm claims &amp; note gaps for billing ›</button>';
  return '<div style="position:sticky;top:0;z-index:9;background:' + (ready ? '#d4f4dd' : '#fff3cd') + ';border:1px solid ' + col + ';border-radius:var(--r);padding:11px 13px;margin:0 0 13px;box-shadow:0 2px 8px rgba(0,0,0,.12)">' +
    '<div style="font-size:13px;font-weight:800;color:' + col + '">' +
      (ready ? '✓ All days billed or noted — ready to discharge ' + esc(p.last)
             : '⚠ ' + n + ' unbilled day' + (n > 1 ? 's' : '') + ' before discharging ' + esc(p.last)) + '</div>' +
    (ready ? '' : '<div style="font-size:11px;color:var(--text2);margin-top:3px">Tap the highlighted days in the calendar below to bill any you can — then add one note for the rest and confirm.</div>') +
    '<div style="display:flex;gap:8px;margin-top:9px">' +
      '<button class="btn btn-s" style="flex:1;margin:0" onclick="_cvCancelDischarge()">Cancel</button>' +
      primary +
    '</div></div>';
}
function _cvCancelDischarge() {
  var pid = window._dischResolvePid;
  window._dischResolvePid = null;
  if (pid) openPatientSummary(pid);   // re-render the summary without the banner
}

// Write ONE billing note covering every still-unbilled day, then discharge.
function _cvNoteAllGapsAndDischarge(pid) {
  var p = getP(pid); if (!p) return;
  var claims = st.claims.filter(function(c){ return c.phn && p.phn && samePhn(c.phn, p.phn); });
  var gaps = _cvGapDays(p, claims);
  if (!gaps.length) { _cvProceedDischarge(pid); return; }
  document.getElementById('cv-picker-content').innerHTML =
    '<div style="font-size:14px;font-weight:700;margin-bottom:2px">Note for billing — ' + gaps.length + ' unbilled day' + (gaps.length > 1 ? 's' : '') + '</div>' +
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">Explain why these days aren\'t billed. This note is recorded against all ' + gaps.length + ' remaining day' + (gaps.length > 1 ? 's' : '') + ' for the billing team.</div>' +
    '<textarea id="cv-allgap-note" rows="3" autocomplete="off" placeholder="e.g. In CCU — daily care billed by intensivist / patient off-ward / palliative" ' +
    'style="width:100%;padding:11px;border:.5px solid var(--border2);border-radius:8px;font-size:14px;font-family:inherit;background:var(--surface2);resize:vertical"></textarea>' +
    '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn btn-s" style="flex:1;margin-bottom:0" data-pid="' + pid + '" onclick="openPatientSummary(this.getAttribute(\'data-pid\'))">‹ Back</button>' +
      '<button class="btn btn-p" style="flex:1;margin-bottom:0" data-pid="' + pid + '" onclick="_cvConfirmAllGapNote(this)">Save note &amp; discharge ›</button>' +
    '</div>';
  showModal('cv-picker-modal');
  setTimeout(function(){ var el = document.getElementById('cv-allgap-note'); if (el) el.focus(); }, 200);
}
function _cvConfirmAllGapNote(btn) {
  var pid = btn.getAttribute('data-pid'); var p = getP(pid); if (!p) return;
  var el = document.getElementById('cv-allgap-note');
  var note = (el && el.value || '').trim();
  if (!note) { showToast('Enter a note explaining the gaps', 'error'); return; }
  var claims = st.claims.filter(function(c){ return c.phn && p.phn && samePhn(c.phn, p.phn); });
  var gaps = _cvGapDays(p, claims);
  var alias = _cvCurrentDocAlias();
  if (!st.gapNotes) st.gapNotes = [];
  gaps.forEach(function(dt){
    var rec = { phn:String(p.phn||'').replace(/\D/g,''), date:dt, patName:(p.last||'')+', '+(p.first||''), alias:alias, note:note, by:(st.doc?st.doc.alias:'')||alias };
    var idx = -1;
    for (var i = 0; i < st.gapNotes.length; i++) { if (samePhn(st.gapNotes[i].phn, rec.phn) && String(st.gapNotes[i].date) === String(dt)) { idx = i; break; } }
    if (idx >= 0) st.gapNotes[idx] = rec; else st.gapNotes.push(rec);
    if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) push('saveGapNote', rec);
  });
  sv('gapNotes', st.gapNotes);
  hideModal('cv-picker-modal');
  showToast(gaps.length + ' day' + (gaps.length > 1 ? 's' : '') + ' noted for billing');
  _cvProceedDischarge(pid);
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
  // Capture who discharged (signed-in doctor's initials) — shown in claim history.
  if (!p.dischargedBy && st.doc && st.doc.alias) p.dischargedBy = st.doc.alias;
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

