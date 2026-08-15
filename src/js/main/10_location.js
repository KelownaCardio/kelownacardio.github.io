// 10_location.js — Location change screen + discharge modal
// ═══════════════════════════════════════════════════════
// LOS helpers — v4.82 refactor: admitMs(p) resolves the admission timestamp
// once (same priority order as before); losdays(p) keeps its old meaning
// (whole days elapsed since admission, admission day = day 0).
function admitMs(p) {
  // Priority 1: explicit admitDate on patient record
  if (p.admitDate) {
    var ad = parseDMYsafe(fmtClaimDate(p.admitDate));
    if (ad) return ad;
  }

  var patClaims = st.claims.filter(function(c) { return c.phn && samePhn(c.phn, p.phn); });
  if (!patClaims.length) return 0;
  patClaims.sort(function(a, b) { return parseDMYsafe(a.date) - parseDMYsafe(b.date); });

  // Priority 2: date of earliest full consult (33010 or 33012) — marks admission
  var consultClaims = patClaims.filter(function(c) {
    return c.fee === '33010' || c.fee === '33012';
  });
  if (consultClaims.length) {
    var consultFirst = parseDMYsafe(consultClaims[0].date);
    if (consultFirst) return consultFirst;
  }

  // Priority 3: earliest claim of any type
  return parseDMYsafe(patClaims[0].date) || 0;
}

function losdays(p) {
  var a = admitMs(p);
  return a ? Math.floor((Date.now() - a) / 86400000) : 0;
}

// v4.82: length of stay in CALENDAR DAYS INCLUSIVE of the admission day,
// measured to a specific discharge date (ms at midnight). Admission day = day 1,
// so admitted Monday & discharged Friday = 5 days. This is the number shown on
// (and gating) the Complex Discharge checklist: eligible when stay >= 5 days —
// same threshold as the old losdays() >= 4, but now anchored to the discharge
// date the doctor just confirmed instead of "today".
function stayDaysAt(p, dischMs) {
  var a = admitMs(p);
  if (!a || !dischMs) return 0;
  var d = Math.round((dischMs - a) / 86400000);
  return d < 0 ? 0 : d + 1;
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
  var _hotSnap = snapHot(p);   // v4.73
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

  stampChangedGroups(p, _hotSnap);   // v4.73: location move gets a tap timestamp
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
// Flow (v4.82 — date FIRST, then complex d/c):
//   Step 0 — billing-gap gate (unchanged)
//   Step 0b — v4.97 private-pay / OOP interpretation gate (ECG / Holter /
//            echo interp), shown ONLY for privatePay or oop patients. Cancel
//            exits so claims can be added; Done falls through to Step 1.
//   Step 1 — doctor confirms the DISCHARGE DATE
//   Step 2 — if stay >= 5 days measured to that date (admission day = day 1):
//            complex discharge (78717) criteria checklist, showing actual LOS days
//   Finalize — patient removed from list; 78717 (if added) is dated to the
//            confirmed discharge date
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
  _dischDate = '';                // fresh open — default the date picker to today
  // v4.97 STEP 0: private-pay / OOP interpretation gate, shown once per
  // patient per session before anything else. ppInterpDone() sets _ppAckPid
  // and calls back into here, which then falls through to the date step.
  // Everything below is unchanged for normal MSP patients.
  if (_ppIsPrivateOrOOP(p) && window._ppAckPid !== pid) {
    _ppStepInterp(pid);
    showModal('disch-modal');
    return;
  }
  _dischStepDate(pid);            // v4.82: confirm discharge date FIRST
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
// v4.82: shown AFTER the discharge date is confirmed. Qualifies when the stay is
// >= 5 calendar days incl. admission day, measured to the CONFIRMED discharge
// date (stayDaysAt >= 5 — same threshold as the old losdays() >= 4), AND
// Cardiology MRP AND clinical criteria:
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
var _cdStay  = 0;    // v4.82: stay days (incl. admission day) to confirmed d/c date
var _dischDate = ''; // v4.82: confirmed discharge date DD/MM/YYYY (set in step 1)

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
  _cdRender(_cdStay);   // v4.82: stay is fixed to the confirmed d/c date
}

// Render the criteria checklist into the discharge modal body
// stay = actual LOS in days INCLUSIVE of admission day, to the confirmed d/c date
function _cdRender(stay) {
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
      'onclick="dischComplex(this)">Add 78717 &amp; discharge</button>'
    : '<button class="btn btn-g" style="margin:0;opacity:.4;pointer-events:none">' +
      'Add 78717 &amp; discharge</button>';

  var h =
    '<div style="font-size:15px;font-weight:700;color:var(--text1);margin-bottom:2px">' +
      'Age ' + _cdAge(getP(_cdPid)) + ' · LOS ' + stay + ' day' + (stay === 1 ? '' : 's') + '</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:2px">' +
      'Admission day = day 1 · discharge date ' + esc(_dischDate) + '</div>' +
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
      '<button class="btn btn-s" style="margin:0" data-pid="' + _cdPid + '" ' +
      'onclick="_dischStepDate(this.getAttribute(\'data-pid\'))">‹ Back — change discharge date</button>' +
      '<button class="btn btn-s" style="margin:0" ' +
      'onclick="hideModal(\'disch-modal\')">Cancel — exit to review chart</button>' +
    '</div>';
  document.getElementById('disch-body').innerHTML = h;
}

// Step 1 (v4.82): the doctor confirms the DISCHARGE DATE first. Complex-
// discharge eligibility is then assessed against the confirmed date. The date
// defaults to today; if the discharge is entered retroactively the LOS and the
// 78717 claim both follow the chosen date.
function _dischStepDate(pid) {
  var todayISO = (function() {
    var p = TODAY.split('/'); return p[2] + '-' + p[1] + '-' + p[0];
  })();
  // Preserve an already-confirmed date if the doctor taps "Back" from the checklist
  var curISO = todayISO;
  if (_dischDate) {
    var cp = _dischDate.split('/');
    if (cp.length === 3) curISO = cp[2] + '-' + cp[1] + '-' + cp[0];
  }
  var h = '<div style="margin-bottom:10px">' +
    '<label style="font-size:11px;font-weight:700;color:var(--text2);display:block;margin-bottom:4px">Discharge date</label>' +
    '<input type="date" id="disch-date-input" value="' + curISO + '" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px">' +
    '<div style="font-size:11px;color:var(--text3);margin-top:5px">Stays of 5+ days (admission day = day 1) are screened for Complex Discharge (78717) next; shorter stays discharge immediately.</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    '<button class="btn btn-p" style="margin:0" data-pid="' + pid + '" ' +
    'onclick="dischDateConfirmed(this)">Confirm date &amp; discharge ›</button>' +
    '<button class="btn btn-s" style="margin:0" onclick="hideModal(\'disch-modal\')">Cancel</button>' +
    '</div>';
  document.getElementById('disch-body').innerHTML = h;
}

// Date confirmed → compute stay to that date. 5+ days (incl. admission day)
// → complex-discharge checklist (Step 2); otherwise finalize immediately.
function dischDateConfirmed(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  if (!p) return;
  var dateInput = document.getElementById('disch-date-input');
  var dcDate = TODAY;
  if (dateInput && dateInput.value) {
    var dp = dateInput.value.split('-');
    if (dp.length === 3) dcDate = dp[2] + '/' + dp[1] + '/' + dp[0];
  }
  _dischDate = dcDate;
  var stay = stayDaysAt(p, parseDMYsafe(dcDate));
  if (stay >= 5) {
    // Step 2: complex-discharge criteria checklist, LOS anchored to confirmed date
    _cdPid   = pid;
    _cdStay  = stay;
    _cdState = {};
    // Pre-tick only what the app can determine itself — MD still confirms each box
    if (_cdAge(p) > 75) _cdState['age75'] = true;
    var icdKey = String(p.icd || '').trim().toUpperCase();
    if (CD_ICD_MAP[icdKey]) _cdState[CD_ICD_MAP[icdKey]] = true;
    _cdRender(stay);
  } else {
    _dischFinalize(pid);
  }
}

// Add 78717 (dated to the confirmed discharge date) with the criteria note,
// then finalize the discharge.
function dischComplex(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  if (!checkDoc()) return;
  addClaim(p, '78717', '78717', 1, _dischDate || TODAY, 'I', null, _cdNote());
  sv('claims', st.claims);
  _dischFinalize(pid);
}

// Finalize: stamp the confirmed discharge date + remove from list.
function _dischFinalize(pid) {
  var p = getP(pid);
  if (!p) return;
  var dcDate = _dischDate || TODAY;
  _dischDate = '';
  window._ppAckPid = null;    // v4.97: clear the interpretation ack — a readmit
                              // of the same patient must be prompted again
  p.dischargeDate = dcDate;   // DD/MM/YYYY — human-readable, pushed to Sheets
  logChange(p, 'Discharged', 'D/C ' + dcDate);
  removePatient(pid);
  hideModal('disch-modal');
  closeClaimScreen();
  showToast(p.last + ' discharged');
}

// Kept for compatibility with button handlers (checklist "Doesn't qualify")
function dischConfirmRemove(btn) {
  _dischFinalize(btn.getAttribute('data-pid'));
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
  window._ppAckPid = null;   // v4.97
  removePatient(_claimPid);
  hideModal('disch-modal');
  closeClaimScreen();
  showToast('33008 + 78717 billed — ' + p.last + ' discharged');
}

function dischSimple() {
  var p = getP(_claimPid); if (!checkDoc()) return;
  addClaim(p, '33008', '33008', 1, TODAY, 'I');
  logChange(p, 'Discharged (33008)', '');
  window._ppAckPid = null;   // v4.97
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
  var _hotSnap = snapHot(p);   // v4.73
  if (!p.dischargeDate) p.dischargeDate = TODAY;
  p.dischargedAt = Date.now();
  p.discharged   = true;
  // Capture who discharged (signed-in doctor's initials) — shown in claim history.
  if (!p.dischargedBy && st.doc && st.doc.alias) p.dischargedBy = st.doc.alias;
  stampChangedGroups(p, _hotSnap);   // v4.73: discharge gets a tap timestamp
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

// ── v4.97: PRIVATE-PAY / OOP INTERPRETATION GATE ─────────────────────
// WHY: private-pay and OOP invoices are built from whatever claims are on
// the sheet 24h after discharge. ECG / Holter / echo interpretations are the
// codes most often remembered late, and every late addition means rebuilding
// and re-issuing an invoice the patient may already be holding (Mazzoco
// 2026-431 → 431_UPDATED). Cheapest place to catch it is BEFORE the doctor
// commits the discharge, while they are still on the patient.
//
// This is STEP 0 of the discharge flow, rendered into the same disch-modal:
//   step 0  interpretation gate   (private pay / OOP only — this file)
//   step 1  confirm discharge date        (_dischStepDate)
//   step 2  complex-discharge checklist   (_cdRender, LOS >= 5 only)
//   finalize                              (_dischFinalize)
// Cancel closes the modal so they can go add the missing claims; Done sets
// _ppAckPid and re-enters _cvProceedDischarge, which then falls straight
// through to the normal date step. Normal MSP discharges never see it.
var PP_INTERP_CODES = {
  '33091': 'Echo — complete',
  '08679': 'Echo — Doppler',
  '8679':  'Echo — Doppler',
  '08662': 'Stress echo',
  '8662':  'Stress echo',
  '08638': 'TEE',
  '8638':  'TEE',
  '33057': 'Contrast echo',
  '33018': 'ECG interpretation',
  '00081': 'Emergency bedside care',
  '81':    'Emergency bedside care'
};

// Which of the interpretation codes are already billed for this patient?
function _ppBilledInterps(p) {
  var pd = String((p && p.phn) || '').replace(/\D/g, '');
  var have = {}, out = [];
  (st.claims || []).forEach(function(c) {
    if (!c) return;
    if (String(c.phn || '').replace(/\D/g, '') !== pd) return;
    var code = String(c.feeCode || c.fee || '').replace(/\.0+$/, '');
    var lbl = PP_INTERP_CODES[code];
    if (lbl && !have[lbl]) { have[lbl] = 1; out.push(lbl); }
  });
  return out;
}

function _ppIsPrivateOrOOP(p) {
  if (!p) return false;
  return (p.privatePay === true || String(p.privatePay).toLowerCase() === 'true') ||
         (p.oop === true || String(p.oop).toLowerCase() === 'true');
}

// Step 0 body. Rendered into disch-body by _cvProceedDischarge.
function _ppStepInterp(pid) {
  var p = getP(pid);
  if (!p) return;
  var isPriv = (p.privatePay === true || String(p.privatePay).toLowerCase() === 'true');
  var label  = isPriv ? 'PRIVATE PAY' : 'OUT OF PROVINCE';
  // Red line ONLY when nothing is billed at all. When something IS billed we
  // say nothing — Kathryn 2026-08-15: listing what is already there invites a
  // glance-and-go, and the doctor should close out and check the chart either
  // way. So the card is silent unless it has a hard warning to give.
  var billed = _ppBilledInterps(p);
  var status = billed.length ? '' :
    '<div style="font-size:12px;color:var(--red-t,#c42828);font-weight:700;margin-top:8px">' +
      'No ECG, Holter or echo interpretation is billed for this patient.</div>';

  document.getElementById('disch-body').innerHTML =
    '<div style="background:#fff3cd;border:1px solid var(--amber-t);border-radius:var(--r);' +
      'padding:12px 13px;margin-bottom:12px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.4px;color:var(--amber-t)">' +
        '\u26a0 ' + label + '</div>' +
      '<div style="font-size:13px;font-weight:700;margin-top:5px;line-height:1.4;color:var(--text)">' +
        'Private Pay / OOP \u2014 ensure all ECGs, holters, echo interp etc have been added ' +
        'before discharge</div>' +
      status +
    '</div>' +
    _ppDemogBlock(p) +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      _ppDoneButton(p) +
      '<button class="btn btn-s" style="margin:0" ' +
        'onclick="hideModal(\'disch-modal\')">Cancel \u2014 go back and add claims</button>' +
    '</div>';
}

// "Done" \u2014 acknowledge for this patient and fall through to the normal
// discharge flow. The ack is per-patient and lives only for this app session,
// so a later discharge of a different private-pay patient prompts again.
function ppInterpDone(btn) {
  var pid = btn.getAttribute('data-pid');
  var p   = getP(pid);
  // v4.98: HARD GATE (Kathryn 2026-08-15) — an OOP / private-pay patient may
  // not be discharged while a billing-critical field is still missing. The
  // information is in Meditech and the patient is still here; six weeks later
  // neither is true (Hutsebaut).
  if (p && _ppMissingDemogFields(p).length) {
    showToast('Missing billing details \u2014 capture or type them first', 'error');
    var z = document.getElementById('pp-demog');
    if (z && z.scrollIntoView) z.scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }
  window._ppAckPid = pid;
  _cvProceedDischarge(pid);
}

// The Done button is disabled-looking while fields are outstanding, so the
// block is visible BEFORE it is hit rather than as a rejection afterwards.
function _ppDoneButton(p) {
  var blocked = _ppMissingDemogFields(p).length;
  return '<button class="btn ' + (blocked ? 'btn-s' : 'btn-p') + '" ' +
    'style="margin:0' + (blocked ? ';opacity:.55' : '') + '" data-pid="' + p.id + '" ' +
    'onclick="ppInterpDone(this)">Done \u2014 continue to discharge \u203a</button>';
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



// ═══════════════════════════════════════════════════════════════════
// v4.98 — MEDITECH DEMOGRAPHICS CAPTURE (inside the Step 0 discharge gate)
// ───────────────────────────────────────────────────────────────────
// Kathryn, 2026-08-15: "most docs don't know where any of this is or who has
// entered what info so far. they will need prompts and to be able to do it
// from their phone." And: all fields must be completed before discharge —
// that IS the best time, because the information is in Meditech and the
// patient is still here. Six weeks later neither is true: Hutsebaut, George H
// carried homeHCN = "Do not have the info" from 30/06 to 15/08/2026 with two
// claims that MSP could never have accepted.
//
// Design consequences of those two sentences:
//   • PHONE FIRST. Meditech runs on the IT-locked hospital desktop; the app
//     is on their phone. There is no clipboard between the two, so the
//     primary action is a CAMERA PHOTO of the Meditech screen, reusing the
//     same capture + crop + OCR path as the patient sticker. Paste is kept
//     as a desktop convenience, not the main route.
//   • PER-FIELD PROMPTS. The data is split across two screens and nobody
//     remembers which. So we do not say "paste your demographics" — we name
//     the exact field that is missing, the exact clicks to reach it, and
//     draw a labelled sample of what they are looking for.
//   • SHOW WHAT IS ALREADY THERE. Otherwise two doctors photograph the same
//     screen on consecutive days, neither knowing the other did.
//   • TYPING IS ALWAYS AVAILABLE. That is what makes a hard gate safe: the
//     block is on the DATA being present, never on the method. A doctor who
//     cannot reach a terminal but knows the number is never stuck.
// ═══════════════════════════════════════════════════════════════════
var PP_PROV_CODES = {AB:1,BC:1,MB:1,NB:1,NL:1,NS:1,NT:1,NU:1,ON:1,PE:1,QC:1,SK:1,YT:1};

// Placeholder text counts as MISSING. "Do not have the info" is what actually
// gets typed, and it is worse than a blank because it looks filled in. Kept
// identical to the DataCheck v2.43 NONMSP_MISSING_INFO rule so the app and
// the check can never disagree about who is outstanding.
var PP_PLACEHOLDER_RE = /^(n\/?a|na|none|nil|unknown|unk|pending|tbd|tba|\?+|-+|do ?n(o|')t have.*|not (available|known|provided).*|do not have.*)$/i;
function _ppBlankish(v) {
  var t = String(v == null ? '' : v).trim();
  return !t || PP_PLACEHOLDER_RE.test(t);
}

// Deliberately permissive: something@something.tld with no spaces. A stricter
// pattern rejects real addresses and a doctor mid-discharge will not argue
// with it — they will type a fake one to get past the gate, which is worse
// than a slightly malformed real one.
function _ppValidEmail(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t || PP_PLACEHOLDER_RE.test(t)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

function _ppMissingDemogFields(p) {
  if (!p || !_ppIsPrivateOrOOP(p)) return [];
  var priv = (p.privatePay === true || String(p.privatePay).toLowerCase() === 'true');
  var oop  = (p.oop === true || String(p.oop).toLowerCase() === 'true');
  var qc   = /^(qc|pq|quebec)/i.test(String(p.homeProvince || '').trim());
  var out  = [];
  // Reciprocal OOP bills MSP by hand-keyed Claim Summary — needs the home
  // province and its health number or the claim is not submittable at all.
  if (oop && !qc) {
    if (_ppBlankish(p.homeProvince)) out.push('province');
    if (_ppBlankish(p.homeHCN))      out.push('hcn');
  }
  // Private pay and Quebec are invoiced to the patient — the invoice has to
  // have somewhere to go. (Mazzoco's 2026-431 was issued with no address.)
  if (priv || qc) {
    if (_ppBlankish(p.homeAddress))  out.push('address');
    // v4.98b: the invoice has to reach the patient. Email is the only field
    // here that is NOT in Meditech — no email appears on the MAIN tab or the
    // Demographic Data sidebar — so it can only be asked for, and discharge
    // is the last moment anyone is in a position to ask.
    if (!_ppValidEmail(p.homeEmail)) out.push('email');
  }
  return out;
}

// ── Labelled samples of the two Meditech screens ────────────────────
// Drawn rather than screenshotted: no PHI, a few hundred bytes, and it
// renders identically on every phone. The point is recognition — the doctor
// should spot the same block on their own screen without reading a word.
function _ppSampleMain() {
  return '<div style="border:1px solid var(--border2);border-radius:var(--rsm);overflow:hidden;' +
      'margin-top:8px;font-size:10px;line-height:1.5;background:#fff">' +
    '<div style="background:#1a73e8;color:#fff;padding:4px 7px;font-weight:700">More Patient Information</div>' +
    '<div style="display:flex;border-bottom:1px solid var(--border)">' +
      '<div style="padding:3px 8px;font-weight:800;color:#1a73e8;border-bottom:2px solid #1a73e8">MAIN</div>' +
      '<div style="padding:3px 8px;color:var(--text3)">CONTACT</div>' +
    '</div>' +
    '<div style="padding:4px 7px;color:#b9b4c4;text-decoration:line-through">' +
      'Health Care Num: 9641944584, British Columbia</div>' +
    '<div style="padding:0 7px 5px;font-size:9px;color:var(--red-t,#c42828);font-weight:700">' +
      '↑ NOT this one — temporary BC number</div>' +
    '<div style="padding:4px 7px;border-top:1px solid var(--border)">' +
      '<div style="font-style:italic;color:var(--text2)">Insurances</div>' +
      '<div style="background:#fff3a3;font-weight:800;display:inline-block;padding:1px 3px">' +
        'Province Manitoba - 104407495</div>' +
      '<div style="color:var(--text2)">Self Pay</div>' +
    '</div>' +
  '</div>';
}
function _ppSampleSidebar() {
  return '<div style="border:1px solid var(--border2);border-radius:var(--rsm);overflow:hidden;' +
      'margin-top:8px;font-size:10px;line-height:1.5;background:#fffdf2;max-width:230px">' +
    '<div style="padding:4px 7px;font-weight:700;color:#1a6b52;border-bottom:1px solid var(--border)">' +
      '▾  ● Demographic Data</div>' +
    '<div style="padding:5px 7px;display:flex;gap:6px">' +
      '<div style="color:var(--text2);width:62px;flex:none">Mailing Address</div>' +
      '<div style="background:#fff3a3;font-weight:800;padding:1px 3px">1702-55 Nassau St N<br>Winnipeg, MB<br>R3L 2G8</div>' +
    '</div>' +
    '<div style="padding:0 7px 5px;display:flex;gap:6px">' +
      '<div style="color:var(--text2);width:62px;flex:none">Insurance</div><div>OOP</div>' +
    '</div>' +
  '</div>';
}

// ── The block itself ────────────────────────────────────────────────
function _ppDemogBlock(p) {
  var missing = _ppMissingDemogFields(p);
  var need = {}; missing.forEach(function(k){ need[k] = true; });

  // What is already on file, so nobody re-photographs a screen for nothing.
  var have = [];
  if (!_ppBlankish(p.homeProvince)) have.push('Province <b>' + esc(String(p.homeProvince).trim()) + '</b>');
  if (!_ppBlankish(p.homeHCN))      have.push('Health # <b>' + esc(String(p.homeHCN).trim()) + '</b>');
  if (!_ppBlankish(p.homeAddress))  have.push('Address <b>' + esc(String(p.homeAddress).trim()) + '</b>');
  if (_ppValidEmail(p.homeEmail))   have.push('Email <b>' + esc(String(p.homeEmail).trim()) + '</b>');
  var by = String(p.updatedBy || '').trim();
  var onFile = have.length
    ? '<div style="font-size:11px;color:var(--green-t,#1a7a4a);margin-top:6px;line-height:1.5">' +
        '✓ On file: ' + have.join(' · ') +
        (by ? '<span style="color:var(--text3)"> — last edited by ' + esc(by) + '</span>' : '') +
      '</div>'
    : '';

  if (!missing.length) {
    return have.length
      ? '<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:var(--r);' +
          'padding:10px 13px;margin-bottom:12px">' +
          '<div style="font-size:12px;font-weight:800;color:var(--green-t,#1a7a4a)">' +
            'Billing details complete</div>' + onFile + '</div>'
      : '';
  }

  var cards = '';

  // ── Card A: province + home health number  ->  MAIN tab ───────────
  if (need.province || need.hcn) {
    cards +=
      '<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">' +
        '<div style="font-size:12px;font-weight:800;color:var(--text)">' +
          'Need: home province &amp; health number</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:4px;line-height:1.5">' +
          'In Meditech tap the <b>ⓘ</b> beside the patient name → <b>MAIN</b> tab → ' +
          'the <b>Insurances</b> block. Photograph just that block.</div>' +
        _ppSampleMain() +
        _ppCaptureRow(p.id, 'main') +
        '<div style="display:flex;gap:7px;margin-top:8px">' +
          '<input id="pp-d-prov" type="text" value="' + esc(String(p.homeProvince || '').trim()) + '" ' +
            'placeholder="Prov (MB)" style="width:96px;padding:8px;border:.5px solid var(--border2);' +
            'border-radius:var(--rsm);font-size:14px;text-transform:uppercase">' +
          '<input id="pp-d-hcn" type="text" inputmode="numeric" ' +
            'value="' + esc(String(p.homeHCN || '').trim()) + '" placeholder="Health # e.g. 104407495" ' +
            'style="flex:1;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px">' +
        '</div>' +
      '</div>';
  }

  // ── Card B: mailing address  ->  Demographic Data sidebar ─────────
  if (need.address || need.email) {
    cards +=
      '<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">' +
        '<div style="font-size:12px;font-weight:800;color:var(--text)">Need: ' +
          (need.address && need.email ? 'mailing address &amp; email'
                                      : (need.email ? 'email address' : 'mailing address')) + '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-top:4px;line-height:1.5">' +
          'In Meditech open the <b>Demographic Data</b> panel in the right-hand sidebar → ' +
          '<b>Mailing Address</b>. Photograph that panel.</div>' +
        _ppSampleSidebar() +
        _ppCaptureRow(p.id, 'side') +
        '<input id="pp-d-addr" type="text" value="' + esc(String(p.homeAddress || '').trim()) + '" ' +
          'placeholder="Street, City, Prov, Postal" ' +
          'style="width:100%;margin-top:8px;padding:8px;border:.5px solid var(--border2);' +
          'border-radius:var(--rsm);font-size:14px">' +
        '<div style="font-size:11px;color:var(--text2);margin-top:9px;line-height:1.5">' +
          '<b>Email</b> \u2014 not in Meditech, ask the patient. This is where their ' +
          'invoice gets sent.</div>' +
        '<input id="pp-d-email" type="email" inputmode="email" autocapitalize="off" ' +
          'spellcheck="false" value="' + esc(String(p.homeEmail || '').trim()) + '" ' +
          'placeholder="name@example.com" ' +
          'style="width:100%;margin-top:5px;padding:8px;border:.5px solid var(--border2);' +
          'border-radius:var(--rsm);font-size:14px">' +
      '</div>';
  }

  return '<div id="pp-demog" style="background:var(--surface2);border:1px solid var(--amber-t);' +
      'border-radius:var(--r);padding:12px 13px;margin-bottom:12px">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:.4px;color:var(--amber-t)">' +
      'REQUIRED BEFORE DISCHARGE</div>' +
    _ppHowTo() +
    onFile +
    cards +
    '<div id="pp-demog-status" style="font-size:11px;margin-top:9px;min-height:14px;color:var(--text3)"></div>' +
    '<button class="btn btn-s" style="margin:8px 0 0" data-pid="' + p.id + '" ' +
      'onclick="ppDemogSave(this)">Save details</button>' +
  '</div>';
}

// All three routes stated ONCE, at the top of the block (Kathryn 2026-08-15:
// "so all instructions (cell or pc) are in one spot"). Previously the phone
// route was implied by a camera button while the PC route was a grey footnote
// underneath it, so a doctor on a desktop had to read past the thing they
// could not use to reach the thing they could.
// KGH desktops are Windows (Expanse), so Win+Shift+S leads; the Mac shortcut
// follows for anyone on one.
function _ppHowTo() {
  return '<div style="background:var(--surface);border:.5px solid var(--border2);' +
      'border-radius:var(--rsm);padding:9px 10px;margin-top:8px;font-size:11px;' +
      'line-height:1.6;color:var(--text2)">' +
    '<div style="font-weight:800;color:var(--text);margin-bottom:3px">Three ways \u2014 whichever is quickest</div>' +
    '<div><b>\u2328\ufe0f Type it</b> into the boxes below.</div>' +
    '<div><b>\ud83d\udcf7 Photograph</b> just that block with your phone.</div>' +
    '<div><b>\ud83d\udcbb On a PC</b> press <b>Win+Shift+S</b> (Mac: <b>\u2318\u21e74</b>), ' +
      'drag over that block, then press <b>Ctrl+V</b> / <b>\u2318V</b> anywhere on this screen.</div>' +
  '</div>';
}

// Camera / gallery / paste row. capture="environment" opens the rear camera
// straight away on a phone, which is the whole point.
function _ppCaptureRow(pid, which) {
  return '<div style="display:flex;gap:7px;margin-top:8px;align-items:center">' +
    '<input type="file" accept="image/*" capture="environment" style="display:none" ' +
      'id="pp-cam-' + which + '" onchange="ppDemogPhoto(this)">' +
    '<input type="file" accept="image/*" style="display:none" ' +
      'id="pp-gal-' + which + '" onchange="ppDemogPhoto(this)">' +
    '<button class="btn btn-p" style="margin:0;flex:1;padding:9px" ' +
      'onclick="document.getElementById(\'pp-cam-' + which + '\').click()">📷 Photo</button>' +
    '<button class="btn btn-s" style="margin:0;padding:9px 11px" ' +
      'onclick="document.getElementById(\'pp-gal-' + which + '\').click()">🖼</button>' +
  '</div>';
}

function ppDemogPhoto(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  var r = new FileReader();
  r.onload = function(ev) { _ppReadShot(String(ev.target.result || '')); };
  r.readAsDataURL(file);
}

// Paste route (desktop). Scoped to the open discharge modal so it can never
// collide with the Add-Patient sticker paste listener.
document.addEventListener('paste', function(e) {
  if (!document.getElementById('pp-demog')) return;
  var modal = document.getElementById('disch-modal');
  if (!modal || !modal.classList.contains('on')) return;
  var items = (e.clipboardData || {}).items;
  if (!items) return;
  var img = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) { img = items[i]; break; }
  }
  if (!img) return;
  e.preventDefault();
  var file = img.getAsFile();
  if (!file) return;
  var r = new FileReader();
  r.onload = function(ev) { _ppReadShot(String(ev.target.result || '')); };
  r.readAsDataURL(file);
}, true);

// Crop first — a phone photo of a whole monitor is mostly furniture, and
// trimming to the Insurances block materially improves the read.
function _ppReadShot(dataUrl) {
  if (!dataUrl) return;
  if (typeof openCropModal === 'function') {
    openCropModal(dataUrl, 'sticker', function(cropped) { _ppApplyDemogOCR(cropped); }, function() {});
  } else {
    _ppApplyDemogOCR(dataUrl);
  }
}

function _ppStatus(msg, colour) {
  var el = document.getElementById('pp-demog-status');
  if (!el) return;
  el.style.color = colour || 'var(--text3)';
  el.innerHTML = msg;
}

function _ppApplyDemogOCR(dataUrl) {
  var btn = document.querySelector('#pp-demog button[data-pid]');
  var p   = btn ? getP(btn.getAttribute('data-pid')) : null;
  if (!p) return;
  _ppStatus('Reading screenshot…', 'var(--text2)');

  runDemogOCR(dataUrl).then(function(r) {
    r = r || {};
    var got = [];
    var prov = String(r.homeProvince || '').trim();
    if (prov) {
      var up = prov.toUpperCase();
      p.homeProvince = PP_PROV_CODES[up] ? up : prov;   // 2-letter code, or a country name
      got.push('province ' + p.homeProvince);
    }
    var hcn = String(r.homeHCN || '').trim();
    if (hcn) { p.homeHCN = hcn; got.push('health # ' + hcn); }
    var addr = String(r.homeAddress || '').trim();
    if (addr) { p.homeAddress = addr; got.push('address'); }

    // Payer type free from the Insurance line — the flag that is currently
    // hand-ticked on the Add form and sits upstream of every invoicing bug.
    var payer = String(r.payer || '').trim().toUpperCase();
    if (payer === 'OOP')      { p.oop = true; p.privatePay = false; got.push('OOP'); }
    else if (payer === 'OOC') { p.privatePay = true; p.oop = false;
                                if (!p.rateMode) p.rateMode = 'BCMA'; got.push('private pay'); }

    if (!got.length) {
      _ppStatus('Nothing readable there — try the other Meditech screen, or type it below.',
                'var(--amber-t)');
      return;
    }
    _ppCommitPatient(p);
    _ppStatus('✓ Read: ' + esc(got.join(', ')), 'var(--green-t,#1a7a4a)');
    _ppStepInterp(p.id);            // re-render: solved cards disappear
  }).catch(function(err) {
    _ppStatus('Could not read it (' + esc((err && err.message) || String(err)) +
              ') — type it below instead.', 'var(--red-t,#c42828)');
  });
}

function ppDemogSave(btn) {
  var p = getP(btn.getAttribute('data-pid'));
  if (!p) return;
  var prov = document.getElementById('pp-d-prov');
  var hcn  = document.getElementById('pp-d-hcn');
  var addr = document.getElementById('pp-d-addr');
  if (prov && String(prov.value || '').trim()) p.homeProvince = String(prov.value).trim().toUpperCase();
  if (hcn  && String(hcn.value  || '').trim()) p.homeHCN      = String(hcn.value).trim();
  if (addr && String(addr.value || '').trim()) p.homeAddress  = String(addr.value).trim();
  var em = document.getElementById('pp-d-email');
  if (em) {
    var ev = String(em.value || '').trim();
    if (ev && !_ppValidEmail(ev)) {
      showToast('That email does not look right \u2014 check it', 'error');
      return;                                   // do not save a typo silently
    }
    if (ev) p.homeEmail = ev;
  }
  _ppCommitPatient(p);
  var left = _ppMissingDemogFields(p);
  showToast(left.length ? 'Saved — still missing ' + left.join(', ') : 'Billing details complete');
  _ppStepInterp(p.id);
}

function _ppCommitPatient(p) {
  var _hotSnap = (typeof snapHot === 'function') ? snapHot(p) : {};
  if (st.doc && st.doc.alias) p.updatedBy = st.doc.alias;
  p.updatedAt = Date.now();
  if (typeof stampChangedGroups === 'function') stampChangedGroups(p, _hotSnap);
  var idx = st.patients.findIndex(function(x){ return x && x.id === p.id; });
  if (idx >= 0) st.patients[idx] = p;
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  if (typeof logChange === 'function') {
    logChange(p, 'OOP/private details captured',
      [p.homeProvince, p.homeHCN, p.homeAddress, p.homeEmail].filter(Boolean).join(' | '));
  }
}
