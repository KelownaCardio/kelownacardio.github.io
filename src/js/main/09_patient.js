// ── 09_patient.js ──
// ═══════════════════════════════════════════════════════
// 09_patient.js — Add patient (Step 1), sticker/Meditech
//                 chart photo OCR, ward/room selectors
// ═══════════════════════════════════════════════════════

// ── Hard duplicate block modal ────────────────────────────────────
// Shown when 2-of-3 (PHN / last name / DOB) match an existing patient.
// No bypass — user must dismiss and correct the form.
function openDuplicateBlockModal(existing, matchedFields) {
  var nameStr    = esc((existing.last || '') + ', ' + (existing.first || ''));
  var dobStr     = existing.dob ? dispDate(existing.dob) : '—';
  var phnStr     = existing.phn || '—';
  var wardStr    = existing.ward ? (existing.ward + (existing.bed ? ' Rm ' + existing.bed : '')) : '';
  var claimCount = st.claims.filter(function(c) { return samePhn(c.phn, existing.phn); }).length;
  var status     = existing.discharged
    ? '<span style="background:var(--amber-bg);color:var(--amber-t);padding:2px 8px;border-radius:var(--rpill);font-size:10px;font-weight:700">Previously discharged</span>'
    : '<span style="background:var(--red-bg);color:var(--red-t);padding:2px 8px;border-radius:var(--rpill);font-size:10px;font-weight:700">Currently on list</span>';

  var h = status +
    '<div style="margin:10px 0 4px;font-size:15px;font-weight:700">' + nameStr + '</div>' +
    '<div style="font-size:12px;color:var(--text2);line-height:1.6">' +
      'PHN: <b>' + esc(phnStr) + '</b><br>' +
      'DOB: <b>' + esc(dobStr) + '</b>' +
      (wardStr ? '<br>Location: <b>' + esc(wardStr) + '</b>' : '') +
      '<br>Claims: <b>' + claimCount + '</b>' +
    '</div>' +
    '<div style="margin-top:10px;padding:10px;background:var(--red-bg);border-radius:8px;font-size:12px;line-height:1.5">' +
      '<b>Duplicate detected</b> — ' + esc(matchedFields.join(' + ')) + ' match' +
      (matchedFields.length > 1 ? 'es' : '') + ' an existing patient.<br>' +
      'This patient cannot be added again.' +
    '</div>' +
    '<div style="margin-top:14px">' +
      '<button class="btn btn-p" style="margin:0" onclick="hideModal(\'merge-modal\')">Go back and correct</button>' +
    '</div>';

  document.getElementById('merge-title').textContent = 'Patient already exists';
  document.getElementById('merge-body').innerHTML = h;
  showModal('merge-modal');
}

// Called from ward "+ Add" button — pre-fills ward and jumps to Add Patient
function openAdd(ward, bed) {
  document.getElementById('f-ward').value = ward;
  wardChange();
  if (bed) document.getElementById('f-bed').value = String(bed);
  var w = WARDS[ward] || {};
  if (w.list) document.getElementById('f-list').value = w.list;
  if (w.care) document.getElementById('f-care').value = w.care;
  nav(1, document.querySelectorAll('.nb')[1]);
}

// ── Role/MRP/List linking rules (v1.10.0) ─────────────
// Role and MRP service are bidirectionally locked:
//   Role=MRP  ⇔ MRPservice=Cardiology
//   Role=Consulting ⇔ MRPservice=anything except Cardiology
// On/Off service auto-snaps when role/MRP changes, but is independent
// once the user manually toggles it.

function mrpChange() {
  // Bidirectional rule:
  //   MRP = Cardiology       → role = MRP
  //   MRP = anything else    → role = Consulting
  // `list` (on/off service) is NOT touched here — it is ward-driven
  // (see wardChange) and may be manually overridden by the user.
  var mrpSel  = document.getElementById('f-mrp');
  var roleSel = document.getElementById('f-role');
  var careFld = document.getElementById('f-care');
  var ward    = gv('f-ward');
  if (!mrpSel || !roleSel) return;
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (mrpSel.value === 'Cardiology') {
    roleSel.value = 'mrp';
    if (careFld) careFld.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    roleSel.value = 'consultant';
    if (careFld) careFld.value = 'directive';
  }
  syncApRolePills();
}

function roleChange() {
  // Bidirectional rule:
  //   role = MRP        → MRP = Cardiology
  //   role = Consulting → MRP becomes "Other" ONLY if it was Cardiology;
  //                        non-Cardiology values (e.g. Hospitalist from
  //                        Meditech import) are preserved.
  // `list` is NOT touched — ward-driven, see wardChange.
  var roleSel = document.getElementById('f-role');
  var mrpSel  = document.getElementById('f-mrp');
  var careFld = document.getElementById('f-care');
  var ward    = gv('f-ward');
  if (!roleSel || !mrpSel) return;
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (roleSel.value === 'mrp') {
    mrpSel.value = 'Cardiology';
    if (careFld) careFld.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    if (mrpSel.value === 'Cardiology') mrpSel.value = 'Other';
    if (careFld) careFld.value = 'directive';
  }
}

// ── Custom room persistence ────────────────────────────
function getSavedRooms(ward) {
  try {
    var raw = localStorage.getItem('kgh5:rooms:' + ward);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveCustomRoom(ward, room) {
  if (!ward || !room) return;
  room = String(room).trim();
  if (!room) return;
  var wdef = WARDS[ward] || {};
  var preset = wdef.rooms || [];
  if (preset.indexOf(room) !== -1) return; // already a preset, don't need to save
  var saved = getSavedRooms(ward);
  if (saved.indexOf(room) !== -1) return; // already saved
  saved.push(room);
  try { localStorage.setItem('kgh5:rooms:' + ward, JSON.stringify(saved)); } catch(e) {}
}

function getBedRooms(ward) {
  var wdef = WARDS[ward] || {};
  var preset = (wdef.rooms || []).slice();
  var saved = getSavedRooms(ward);
  var all = preset.slice();
  saved.forEach(function(r) { if (all.indexOf(r) === -1) all.push(r); });
  return all;
}

function getBedWard(inp) {
  if (inp.id === 'f-bed')  return gv('f-ward');
  if (inp.id === 'pe-bed') return (document.getElementById('pe-ward') || {}).value || '';
  return '';
}

function bedSearchEl(inp, ddId) {
  var dd = document.getElementById(ddId);
  if (!dd) return;
  var rooms = getBedRooms(getBedWard(inp));
  var q = (inp.value || '').trim().toLowerCase();
  var matches = q === '' ? rooms
    : rooms.filter(function(r) { return r.toLowerCase().indexOf(q) !== -1; });
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = matches.map(function(r) {
    return '<div class="bed-dd-row" onmousedown="selectBed(this)"' +
           ' data-inp="' + inp.id + '" data-val="' + esc(r) + '">' + esc(r) + '</div>';
  }).join('');
  dd.style.display = 'block';
}

function hideBedDd(ddId) {
  var dd = document.getElementById(ddId);
  if (dd) dd.style.display = 'none';
}

function selectBed(row) {
  var val = row.getAttribute('data-val');
  var inp = document.getElementById(row.getAttribute('data-inp'));
  if (inp) inp.value = val;
  if (row.parentElement) row.parentElement.style.display = 'none';
}

// Apply ward-default role / mrp / care / list to a set of form selects.
// CCU/2S/2W → MRP role, Cardiology, on-service, ccu-or-daily care.
// Everything else → Consulting role, Other mrp, off-service, directive care.
// Used by both wardChange (Add Patient) and peWardChange (Edit Patient).
// Caller passes the four element IDs; missing IDs are skipped.
function applyWardDefaults(ward, ids) {
  var wdef = WARDS[ward] || {};
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  var isMRPward = wdef.role === 'mrp';

  var listEl = ids.list && document.getElementById(ids.list);
  var roleEl = ids.role && document.getElementById(ids.role);
  var mrpEl  = ids.mrp  && document.getElementById(ids.mrp);
  var careEl = ids.care && document.getElementById(ids.care);

  if (listEl) listEl.value = wdef.list || 'off';
  if (roleEl) roleEl.value = isMRPward ? 'mrp' : 'consultant';
  if (mrpEl)  mrpEl.value  = isMRPward ? 'Cardiology' : 'Other';
  if (careEl) {
    if (isMRPward) careEl.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
    else           careEl.value = 'directive';
  }
}

function wardChange(opts) {
  // Set bed label, show/hide custom-ward input, clear bed, and (unless
  // preserveAll) snap list + role + mrp + care to ward defaults.
  // CCU/2S/2W → MRP/Cardiology/on; everything else → Consulting/Other/off.
  // User can manually override any field after; the next ward change
  // will reset them again.
  var w = gv('f-ward');
  var bedLbl = document.getElementById('bed-lbl');
  if (bedLbl) bedLbl.textContent = w === 'CCU' ? 'Bed #' : 'Room';

  // Show/hide Other ward text field
  var otherWrap = document.getElementById('f-ward-other-wrap');
  if (otherWrap) otherWrap.style.display = w === 'OTHER' ? 'block' : 'none';

  // Clear bed input when ward changes
  var bedInp = document.getElementById('f-bed');
  if (bedInp) bedInp.value = '';

  // Apply ward defaults unless explicitly suppressed
  if (!opts || !opts.preserveAll) {
    applyWardDefaults(w, { list:'f-list', role:'f-role', mrp:'f-mrp', care:'f-care' });
  }
  // Keep On/Off pills in sync with f-list
  syncApListPills();
}

function saveCustomWard() {
  var name = (document.getElementById('f-ward-other') || {}).value || '';
  name = name.trim();
  if (!name) { showToast('Enter a ward name'); return; }
  var key = name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8) || 'CUSTOM';
  if (WARDS[key]) key = key + '2';
  if (!WARDS[key]) {
    WARDS[key] = { label:name, list:'off', care:'directive', role:'consultant', rooms:[] };
    // Persist custom ward name to localStorage
    try {
      var cw = JSON.parse(localStorage.getItem('kgh5:customWards') || '[]');
      cw.push({ key:key, name:name });
      localStorage.setItem('kgh5:customWards', JSON.stringify(cw));
    } catch(e) {}
    // Add to all ward selects on the page
    ['f-ward','pe-ward'].forEach(function(selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var otherOpt = sel.querySelector('option[value="OTHER"]');
      var newOpt = document.createElement('option');
      newOpt.value = key; newOpt.text = name;
      if (otherOpt) sel.insertBefore(newOpt, otherOpt);
      else sel.appendChild(newOpt);
    });
    showToast(name + ' added to ward list');
  }
  var fWard = document.getElementById('f-ward');
  if (fWard) { fWard.value = key; wardChange(); }
  var otherWrap = document.getElementById('f-ward-other-wrap');
  if (otherWrap) otherWrap.style.display = 'none';
}


// ── Add-patient inline consult claim ─────────────────────

// ── Add-patient v2 — claim type selector + submit ──────────────────
var _apClaimType = 'consult';

function apSelectClaimType(type) {
  _apClaimType = type;
  var clsFor = { consult:'ct-on-consult', 'ccu-admit':'ct-on-ccu', other:'ct-on-consult' };
  ['consult','ccu-admit','other'].forEach(function(t) {
    var btn = document.getElementById('ap-ct-' + t);
    if (btn) btn.className = 'ct-btn' + (t === type ? ' ' + (clsFor[t] || 'ct-on-consult') : '');
  });
  var area = document.getElementById('ap-claim-area');
  if (!area) return;
  if (type === 'consult') {
    area.innerHTML = buildApConsultArea();
    initAddPatientConsult();
  } else if (type === 'ccu-admit') {
    area.innerHTML = buildApCCUAdmitArea();
    var caDateEl = document.getElementById('ap-ca-date');
    if (caDateEl) caDateEl.value = localISODate();
  } else {
    // Other claim — unified form self-inits its date + performing selector.
    area.innerHTML = buildApOtherClaimArea();
  }
}


function buildApConsultArea() {
  // Unified consult form, shared with the +Claim screen.
  // withSubmit:false — the Add Patient screen has its own submit buttons.
  return buildConsultForm({}, { withSubmit: false });
}
function buildApOtherClaimArea() {
  // Unified Other-claim form, shared with the +Claim screen.
  // withSubmit:false — the Add Patient screen has its own submit buttons.
  return buildOtherClaimForm({}, { withSubmit: false });
}

function buildApCCUAdmitArea() {
  // CCU admit (1411). Diagnosis / referring MD / performing physician use
  // the shared buildIcdRefCard (cb-* ids) — same as every other claim form.
  var h = '';
  h += '<label>Date</label><input type="date" id="ap-ca-date">';
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional)</span></label>';
  h += '<textarea id="ap-ca-notes" rows="2" placeholder="Optional" autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:6px"></textarea>';
  h += buildIcdRefCard({});
  return h;
}


function apSexPill(val) {
  var hid = document.getElementById('f-sex');
  if (hid) hid.value = val;
  var m = document.getElementById('f-sex-m');
  var f = document.getElementById('f-sex-f');
  if (m) m.className = 'ap-list-pill' + (val === 'M' ? ' on' : '');
  if (f) f.className = 'ap-list-pill' + (val === 'F' ? ' on' : '');
}

function peSexPill(val) {
  var hid = document.getElementById('pe-sex');
  if (hid) hid.value = val;
  var m = document.getElementById('pe-sex-m');
  var f = document.getElementById('pe-sex-f');
  if (m) m.className = 'ap-list-pill' + (val === 'M' ? ' on' : '');
  if (f) f.className = 'ap-list-pill' + (val === 'F' ? ' on' : '');
}

function apListPill(val) {
  var listEl = document.getElementById('f-list');
  if (listEl) listEl.value = val;
  var pillOn  = document.getElementById('ap-pill-on');
  var pillOff = document.getElementById('ap-pill-off');
  if (pillOn)  pillOn.className  = 'ap-list-pill' + (val === 'on'  ? ' on' : '');
  if (pillOff) pillOff.className = 'ap-list-pill tone-amber' + (val === 'off' ? ' on' : '');
}

// Role pills — toggling auto-fills MRP service:
//   MRP        → Cardiology
//   Consulting → preserve current non-Cardiology mrp (from Meditech import etc.) else Other
function apRolePill(val) {
  var roleEl = document.getElementById('f-role');
  if (roleEl) roleEl.value = val;
  var mrpRole = document.getElementById('ap-role-mrp');
  var conRole = document.getElementById('ap-role-con');
  if (mrpRole) mrpRole.className = 'ap-list-pill' + (val === 'mrp'        ? ' on' : '');
  if (conRole) conRole.className = 'ap-list-pill' + (val === 'consultant' ? ' on' : '');
  // Auto-fill MRP service
  var mrpEl  = document.getElementById('f-mrp');
  var careEl = document.getElementById('f-care');
  var ward   = gv('f-ward');
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (val === 'mrp') {
    if (mrpEl)  mrpEl.value  = 'Cardiology';
    if (careEl) careEl.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    if (mrpEl && mrpEl.value === 'Cardiology') mrpEl.value = 'Other';
    // else leave existing non-Cardiology value (Meditech import preserved)
    if (careEl) careEl.value = 'directive';
  }
}

// Sync role pills with current f-role value (for ward changes etc.)
function syncApRolePills() {
  var val = gv('f-role') || 'consultant';
  var mrpRole = document.getElementById('ap-role-mrp');
  var conRole = document.getElementById('ap-role-con');
  if (mrpRole) mrpRole.className = 'ap-list-pill' + (val === 'mrp'        ? ' on' : '');
  if (conRole) conRole.className = 'ap-list-pill' + (val === 'consultant' ? ' on' : '');
}

// Sync pills after ward defaults applied
function syncApListPills() {
  var val = gv('f-list') || 'on';
  apListPill(val);
  syncApRolePills();
}

async function apSubmit(addToList, _skipDupCheck) {
  window._apPendingAddToList = addToList;
  var last = (document.getElementById('f-last') || {}).value || '';
  var phn  = gv('f-phn');
  if (!last) { showToast('Enter patient last name'); return; }
  // Diagnosis / referring MD — every claim form now uses the unified
  // cb-* / oc-* ids.
  var icd = gv('cb-icd') || gv('oc-icd') || '';

  // Validate required fields
  var addMissing = [];
  if (!phn)                                    addMissing.push('phn');
  else if (String(phn).replace(/\D/g,'').length !== 10) addMissing.push('phn-len');
  if (!gv('cb-refby') && !gv('oc-refby')) addMissing.push('refby');
  if (!icd)                                    addMissing.push('icd');
  if (_apClaimType === 'consult') {
    if (!(document.getElementById('cb-date')  || {}).value) addMissing.push('date');
    if (!(document.getElementById('cb-start') || {}).value) addMissing.push('start time');
    if (!(document.getElementById('cb-end')   || {}).value) addMissing.push('end time');
  } else if (_apClaimType === 'ccu-admit') {
    if (!(document.getElementById('ap-ca-date') || {}).value) addMissing.push('date');
  } else if (_apClaimType === 'other') {
    if (!gv('oc-fee')) addMissing.push('fee');
    if (!(document.getElementById('oc-date') || {}).value) addMissing.push('date');
  }

  if (addMissing.length) {
    if (addMissing.indexOf('phn') !== -1 || addMissing.indexOf('phn-len') !== -1) {
      var phnEl = document.getElementById('f-phn');
      if (phnEl) { phnEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; phnEl.focus(); }
    }
    if (addMissing.indexOf('refby') !== -1) {
      var refEl = document.getElementById('cb-ref-search') || document.getElementById('oc-ref-search');
      if (refEl) { refEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; refEl.placeholder = 'Required — type name or doctor #'; }
    }
    if (addMissing.indexOf('icd') !== -1) {
      var icdEl2 = document.getElementById('cb-icd-search') || document.getElementById('oc-icd-search');
      if (icdEl2) { icdEl2.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; icdEl2.placeholder = 'Required — type diagnosis or code'; }
    }
    var msgs = [];
    if (addMissing.indexOf('phn')        !== -1) msgs.push('PHN');
    if (addMissing.indexOf('phn-len')    !== -1) msgs.push('PHN must be 10 digits');
    if (addMissing.indexOf('refby')      !== -1) msgs.push('referring MD');
    if (addMissing.indexOf('icd')        !== -1) msgs.push('diagnosis');
    if (addMissing.indexOf('fee')        !== -1) msgs.push('fee code');
    if (addMissing.indexOf('date')       !== -1) msgs.push('date');
    if (addMissing.indexOf('start time') !== -1) msgs.push('start time');
    if (addMissing.indexOf('end time')   !== -1) msgs.push('end time');
    showToast('Required: ' + msgs.join(', '));
    return;
  }

  // ── Duplicate check — 2-of-3 hard block ─────────────────────────
  // Fields: PHN (exact), last name (case-insensitive), DOB (formatted).
  // If any 2 of the 3 match an existing patient → hard stop, no bypass.
  var chkPhn  = String(phn || '').replace(/\D/g,'');
  var chkLast = String(last || '').trim().toLowerCase();
  var chkDob  = fmtClaimDate(gv('f-dob') || '');

  var dupMatch = null;
  var dupScore = 0;
  var dupFields = [];

  st.patients.forEach(function(x) {
    if (!x) return;
    var xPhn  = String(x.phn  || '').replace(/\D/g,'');
    var xLast = String(x.last || '').trim().toLowerCase();
    var xDob  = x.dob ? fmtClaimDate(x.dob) : '';
    var score = 0;
    var fields = [];
    if (chkPhn  && xPhn  && chkPhn  === xPhn)  { score++; fields.push('PHN');      }
    if (chkLast && xLast && chkLast === xLast)  { score++; fields.push('Last name'); }
    if (chkDob  && xDob  && chkDob  === xDob)  { score++; fields.push('DOB');      }
    if (score >= 2 && score > dupScore) {
      dupMatch  = x;
      dupScore  = score;
      dupFields = fields;
    }
  });

  if (dupMatch) {
    openDuplicateBlockModal(dupMatch, dupFields);
    return;
  }

  var p = {
    id: 'p' + Date.now(), fac: 'OA040', roundedToday: null,
    last: fmtName(last), first: fmtName(gv('f-first')),
    phn: phn, dob: gv('f-dob'), sex: gv('f-sex'),
    refby:     gv('cb-refby') || gv('oc-refby'),
    refbyName: gv('cb-refby-name') || gv('oc-refby-name'),
    icd: icd,
    createdBy: (st.doc && st.doc.alias) || '',
    createdAt: Date.now()
  };

  if (addToList) {
    var ward = gv('f-ward') || 'OTHER';
    p.ward  = ward;
    p.bed   = gv('f-bed')  || '';
    p.role  = gv('f-role') || 'consultant';
    p.mrp   = gv('f-mrp')  || 'Other';
    p.list  = gv('f-list') || 'on';
    p.care  = gv('f-care') || 'directive';
    if (p.ward && p.bed) saveCustomRoom(p.ward, p.bed);
  } else {
    // Consult-only patient — not added to rounds; lives in Recently Discharged
    p.ward  = ''; p.bed = ''; p.role = 'consultant';
    p.mrp   = 'Other'; p.list = 'consult-only'; p.care = 'directive';
    p.discharged    = true;
    p.trueDischarge = true;
    p.consultOnly   = true;
    p.dischargedAt  = Date.now();
    p.dischargeDate = fmtD(new Date());
  }

  st.patients.push(p);
  sv('patients', st.patients);

  if (SHEETS_URL) {
    var ok = await push('savePatient', p);
    if (!ok) {
      st.patients = st.patients.filter(function(x) { return x.id !== p.id; });
      sv('patients', st.patients);
      showToast(window._lastPushError
        ? 'Not saved: ' + window._lastPushError
        : 'Could not save patient — check wifi and try again');
      return;
    }
  }
  logChange(p, addToList ? 'Admitted' : 'Consult only',
    addToList ? (p.ward + (p.bed ? ' Rm ' + p.bed : '')) : 'No rounds list');

  if (window._ocrOriginal) {
    var corrections = buildOCRCorrections(p);
    if (corrections.length && SHEETS_URL) push('logOCRCorrections', { corrections: corrections });
    window._ocrOriginal = null;
  }

  // Create claim
  if (st.doc) {
    // Performing physician — consult area uses cb-performing-doc (unified
    // form) — all claim forms now render cb-performing-doc.
    var cPerf  = document.getElementById('cb-performing-doc');
    var cAlias = (cPerf && cPerf.value) ? cPerf.value : st.doc.alias;

    if (_apClaimType === 'consult') {
      // Unified shared submit — reads the cb-* consult form, runs CCFPP,
      // and creates the consult + MOST + modifier claims.
      submitConsultClaims(p, cAlias);
    } else if (_apClaimType === 'ccu-admit') {
      var caDateISO = (document.getElementById('ap-ca-date')  || {}).value || '';
      var caNotes   = (document.getElementById('ap-ca-notes') || {}).value || '';
      if (caDateISO) {
        var caDateFmt = fmtD(parseISODate(caDateISO));
        var caLoc = p.ward === 'ED' ? 'E' : 'I';
        addClaim(p, '1411', '1411', 1, caDateFmt, caLoc, null, caNotes, null, cAlias);
        sv('claims', st.claims);
      }
    } else if (_apClaimType === 'other') {
      // Unified shared submit — reads the oc-* form, validates 33005,
      // and creates the single claim.
      submitOtherClaimFor(p, cAlias);
    }
  }

  var listLabel = addToList ? (p.list === 'on' ? 'On' : 'Off') + ' Service' : 'claim only';
  showToast(last + ' added — ' + listLabel);
  clearAddForm();
  if (addToList) {
    nav(0, document.querySelectorAll('.nb')[0]);
  } else {
    nav(2, document.querySelectorAll('.nb')[2]);
  }
}

function initAddPatientConsult() {
  // The unified consult form self-initialises date/time/toggles when built.
  _consultCtx = 'addpatient';
  var area = document.getElementById('ap-claim-area');
  if (area && !area.querySelector('#cb-date')) {
    area.innerHTML = buildConsultForm({}, { withSubmit: false });
  }
  consultFormOpened();
}



function clearAddForm() {
  ['f-last','f-first','f-phn','f-dob'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var sx = document.getElementById('f-sex'); if (sx) sx.value = '';
  var sxm = document.getElementById('f-sex-m'); if (sxm) sxm.className = 'ap-list-pill';
  var sxf = document.getElementById('f-sex-f'); if (sxf) sxf.className = 'ap-list-pill';
  var ocr = document.getElementById('ocr-bar'); if (ocr) ocr.style.display = 'none';
  // Reset claim type to consult and rebuild claim area
  _apClaimType = 'consult';
  ['consult','ccu-admit','other'].forEach(function(t) {
    var b = document.getElementById('ap-ct-' + t);
    if (b) b.className = 'ct-btn' + (t === 'consult' ? ' ct-on-consult' : '');
  });
  var area = document.getElementById('ap-claim-area');
  if (area) { area.innerHTML = buildApConsultArea(); }
  // Re-initialise consult card (date/time, toggles, performing physician)
  initAddPatientConsult();
  resetPhotoZone();
}

function resetPhotoZone() {
  document.getElementById('photo-zone').innerHTML =
    '<svg style="width:26px;height:26px;stroke:var(--text3);fill:none;stroke-width:1.5" viewBox="0 0 24 24">' +
      '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>' +
      '<circle cx="12" cy="13" r="4"/>' +
    '</svg>' +
    '<span style="font-size:12px;color:var(--text2)">Tap to photograph sticker or chart header</span>' +
    '<span style="font-size:10px;color:var(--text3)">Auto-fills name, PHN, DOB, ward, room</span>';
}
// ── Sticker / Meditech photo capture → crop → OCR ──
// _cropPending holds: { dataUrl, mode, callback }
//   mode = 'sticker' | 'meditech'
//   callback receives the cropped JPEG dataUrl
var _cropPending = null;
var _cropState = null;

// Handle paste of a screenshot (Ctrl+V / Cmd+V) from clipboard.
// Called both from the photo-zone paste listener and the global paste
// listener when the Add Patient pane is visible.
function handleClipboardPaste(e) {
  var items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData) || {}).items;
  if (!items) return false;

  var imageItem = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) { imageItem = items[i]; break; }
  }
  if (!imageItem) return false;

  e.preventDefault();

  var bar = document.getElementById('ocr-bar');
  if (bar) { bar.style.display = 'block'; bar.className = 'ocr-bar ocr-ok'; bar.textContent = 'Reading pasted image…'; }

  var file = imageItem.getAsFile();
  if (!file) {
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not read clipboard image'; }
    return true;
  }

  var reader = new FileReader();
  reader.onerror = function() {
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not read pasted image'; }
  };
  reader.onload = function(ev) {
    var dataUrl = ev.target.result || '';
    // Show preview immediately in photo zone without crop (desktop screenshots
    // are usually already well-framed — but open crop modal so user can trim if needed)
    openCropModal(dataUrl, 'sticker', function(croppedDataUrl) {
      processStickerOCR(croppedDataUrl, bar);
    }, function() {
      if (bar) { bar.style.display = 'none'; bar.textContent = ''; }
      resetPhotoZone();
    });
  };
  reader.readAsDataURL(file);
  return true;
}

// Attach paste listener to photo zone element (for focused paste)
// and to document when Add Patient pane is active (for unfocused paste)
(function() {
  function attachPhotoZonePaste() {
    var pz = document.getElementById('photo-zone');
    if (!pz || pz._pasteAttached) return;
    pz._pasteAttached = true;
    pz.setAttribute('tabindex', '0'); // make focusable
    pz.addEventListener('paste', function(e) { handleClipboardPaste(e); });
  }

  // Global paste: only fire when Add Patient pane (p1) is the visible pane
  document.addEventListener('paste', function(e) {
    var p1 = document.getElementById('p1');
    if (!p1 || !p1.classList.contains('on')) return;
    handleClipboardPaste(e);
  });

  // Attach to photo zone once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachPhotoZonePaste);
  } else {
    attachPhotoZonePaste();
  }
})();

function handleStickerPhoto(inp) {
  var file = inp && inp.files && inp.files[0];
  if (!file) return;
  inp.value = ''; // allow re-selecting same file later

  var bar = document.getElementById('ocr-bar');
  if (bar) {
    bar.style.display = 'block';
    bar.className = 'ocr-bar ocr-ok';
    bar.textContent = 'Reading photo…';
  }

  var reader = new FileReader();
  reader.onerror = function() {
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not read photo file'; }
  };
  reader.onload = function(e) {
    var dataUrl = e.target.result || '';
    openCropModal(dataUrl, 'sticker', function(croppedDataUrl) {
      processStickerOCR(croppedDataUrl, bar);
    }, function() {
      // Cancel — clear bar
      if (bar) { bar.style.display = 'none'; bar.textContent = ''; }
      var pz = document.getElementById('photo-zone');
      if (pz) resetPhotoZone();
    });
  };
  reader.readAsDataURL(file);
}

function processStickerOCR(croppedDataUrl, bar) {
  var pz = document.getElementById('photo-zone');
  if (pz) {
    pz.innerHTML = '<img src="' + croppedDataUrl + '" style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;display:block">';
    pz.style.padding = '0';
  }
  if (bar) bar.textContent = 'Compressing image…';

  var img = new Image();
  img.onerror = function() {
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not decode cropped image'; }
  };
  img.onload = function() {
    var MAX = 1600;
    var w = img.width, h = img.height;
    if (w > h && w > MAX)      { h = Math.round(h * MAX / w); w = MAX; }
    else if (h > MAX)           { w = Math.round(w * MAX / h); h = MAX; }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var jpegDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    var b64 = jpegDataUrl.split(',')[1];
    setTimeout(function() { sendToOCR(b64, 'image/jpeg', bar); }, 0);
  };
  img.src = croppedDataUrl;
}

// ── OCR routing ────────────────────────────────────────────────────
// Priority:
//   1. Apps Script → Anthropic  (works on hospital WiFi — no Cloudflare needed)
//   2. Cloudflare Worker        (works off hospital WiFi)
//   3. Tesseract / ML Kit       (last resort, offline)
//
// Session cache: _appsScriptOCRReachable, _cloudOCRReachable
// Both reset to null on page load; set false on first failure so
// subsequent scans skip straight to the next tier without probing.

function sendToOCR(b64, mediaType, bar) {
  if (bar) bar.textContent = 'Extracting (' + Math.round(b64.length / 1024) + ' KB)…';

  if (typeof window._appsScriptOCRReachable === 'undefined') window._appsScriptOCRReachable = null;
  if (typeof window._cloudOCRReachable      === 'undefined') window._cloudOCRReachable      = null;

  // Tier 1 — Apps Script → Anthropic
  if (window._appsScriptOCRReachable !== false) {
    sendToAppsScriptOCR(b64, mediaType, bar);
    return;
  }

  // Tier 2 — Cloudflare Worker
  if (window._cloudOCRReachable !== false) {
    sendToCloudflareOCR(b64, mediaType, bar);
    return;
  }

  // Tier 3 — Offline (Tesseract / ML Kit)
  if (bar) bar.textContent = 'Extracting (offline)…';
  runOfflineOCR(b64, mediaType, bar);
}

// Tier 1: fetch API key from Apps Script, then call Anthropic directly.
// Same network path as import.html — works on hospital WiFi.
function sendToAppsScriptOCR(b64, mediaType, bar) {
  if (bar) bar.textContent = 'Extracting (via Apps Script)…';

  var STICKER_PROMPT =
    'Hospital patient sticker from Kelowna General Hospital (KGH). ' +
    'Extract the printed fields from the sticker ONLY — ignore any handwriting.\n\n' +
    'Return a single JSON object with exactly these fields:\n' +
    '  last, first, phn, dob, sex, mrp, admitDate\n\n' +
    'Rules:\n' +
    '  last / first  — from "Last,First" name line\n' +
    '  phn           — the HCN number (10 digits after "HCN")\n' +
    '  dob           — date after "DOB", format DD Mon YYYY e.g. "26 Oct 1958"\n' +
    '  sex           — M or F (from "L:M" or "L:F" field, or "Sex: M/F")\n' +
    '  mrp           — text after "MRP" e.g. "CardiologyMRP,KGH Kelowna"\n' +
    '  admitDate     — date after "ADM", same format as dob\n\n' +
    'Return ONLY valid JSON, no markdown, no explanation.';

  // Step 1: get API key from Apps Script
  fetch(SHEETS_URL + '?action=getAnthropicKey&key=' + SHARED_KEY, { redirect: 'follow' })
    .then(function(r) {
      if (!r.ok) throw new Error('Apps Script key fetch: HTTP ' + r.status);
      return r.json();
    })
    .then(function(j) {
      if (!j.ok) throw new Error(j.error || 'No API key returned');
      var apiKey = j.key || '';
      if (!apiKey) throw new Error('No API key returned');

      // Step 2: call Anthropic directly
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: STICKER_PROMPT }
          ]}]
        })
      });
    })
    .then(function(r) {
      if (!r.ok) throw new Error('Anthropic HTTP ' + r.status);
      return r.json();
    })
    .then(function(j) {
      var raw = (j.content || []).map(function(c) { return c.text || ''; }).join('');
      var clean = raw.replace(/```json|```/g, '').trim();
      var p = JSON.parse(clean);
      p._engine = 'apps-script';
      window._appsScriptOCRReachable = true;
      handleOCRResult(p, bar);
    })
    .catch(function(err) {
      console.warn('[OCR] Apps Script path failed:', err.message, '— trying Cloudflare');
      window._appsScriptOCRReachable = false;
      if (bar) bar.textContent = 'Extracting (cloud fallback)…';
      sendToCloudflareOCR(b64, mediaType, bar);
    });
}

// Tier 2: Cloudflare Worker (original path — works off hospital WiFi).
function sendToCloudflareOCR(b64, mediaType, bar) {
  if (bar) bar.textContent = 'Extracting (cloud)…';

  var xhr = new XMLHttpRequest();
  xhr.open('POST', OCR_WORKER_URL, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.timeout = 10000;

  var fellBack = false;
  function fallback(reason) {
    if (fellBack) return;
    fellBack = true;
    window._cloudOCRReachable = false;
    if (bar) bar.textContent = 'Extracting (offline)…';
    runOfflineOCR(b64, mediaType, bar);
  }

  xhr.onload = function() {
    if (xhr.status < 200 || xhr.status >= 300) { fallback('http ' + xhr.status); return; }
    var data;
    try { data = JSON.parse(xhr.responseText); }
    catch (e) { fallback('bad json'); return; }
    if (data && data.error) { fallback('worker error'); return; }
    window._cloudOCRReachable = true;
    if (data) data._engine = 'cloud';
    handleOCRResult(data, bar);
  };
  xhr.onerror   = function() { fallback('network'); };
  xhr.ontimeout = function() { fallback('timeout'); };
  xhr.send(JSON.stringify({ image: b64, mediaType: mediaType }));
}

// Run the offline OCR engine (Tesseract.js on iOS, ML Kit on Android).
// Result shape matches the Cloudflare worker output, so handleOCRResult
// consumes it unchanged.
function runOfflineOCR(b64, mediaType, bar) {
  if (!window.OCROffline) {
    if (bar) {
      bar.className = 'ocr-bar ocr-warn';
      bar.textContent = 'Offline OCR module not loaded — refresh the page';
    }
    return;
  }
  window.OCROffline.run(b64, mediaType).then(function(data) {
    handleOCRResult(data, bar);
  }).catch(function(err) {
    if (bar) {
      bar.className = 'ocr-bar ocr-warn';
      bar.textContent = 'Offline OCR failed: ' + (err && err.message || err);
    }
  });
}

// ── Crop modal ─────────────────────────────────────────
function openCropModal(dataUrl, mode, onUse, onCancel) {
  _cropPending = { dataUrl: dataUrl, mode: mode, onUse: onUse, onCancel: onCancel };

  var ov = document.getElementById('crop-overlay');
  if (!ov) { ov = createCropOverlay(); document.body.appendChild(ov); }

  var img = document.getElementById('crop-img');
  img.onload = function() {
    initCropFrame();
  };
  img.src = dataUrl;
  document.getElementById('crop-title').textContent =
    mode === 'meditech' ? 'Crop Meditech list' : 'Crop sticker / chart';
  ov.classList.add('on');
}

function createCropOverlay() {
  var ov = document.createElement('div');
  ov.id = 'crop-overlay';
  ov.className = 'crop-overlay';
  ov.innerHTML =
    '<div class="crop-hdr">' +
      '<button class="crop-hdr-btn" onclick="cropCancel()">Cancel</button>' +
      '<div class="crop-hdr-title" id="crop-title">Crop</div>' +
      '<button class="crop-hdr-btn" onclick="cropReset()">Reset</button>' +
    '</div>' +
    '<div class="crop-hint">Drag the two corners to fit just the patient sticker or list</div>' +
    '<div class="crop-stage" id="crop-stage">' +
      '<div class="crop-img-wrap" id="crop-img-wrap">' +
        '<img id="crop-img" class="crop-img" alt="">' +
        '<div class="crop-overlay-mask" id="crop-mask-t"></div>' +
        '<div class="crop-overlay-mask" id="crop-mask-b"></div>' +
        '<div class="crop-overlay-mask" id="crop-mask-l"></div>' +
        '<div class="crop-overlay-mask" id="crop-mask-r"></div>' +
        '<div class="crop-frame" id="crop-frame"></div>' +
        '<div class="crop-handle" id="crop-handle-tl"></div>' +
        '<div class="crop-handle" id="crop-handle-br"></div>' +
      '</div>' +
    '</div>' +
    '<div class="crop-actions">' +
      '<button class="crop-btn-cancel" onclick="cropCancel()">Cancel</button>' +
      '<button class="crop-btn-use" onclick="cropUse()">Use this region</button>' +
    '</div>';
  return ov;
}

function initCropFrame() {
  var img = document.getElementById('crop-img');
  // Default to 80% of image, centered
  var iw = img.clientWidth, ih = img.clientHeight;
  var pad = 0.10; // 10% padding each side
  _cropState = {
    imgW: iw, imgH: ih,
    x1: Math.round(iw * pad),
    y1: Math.round(ih * pad),
    x2: Math.round(iw * (1 - pad)),
    y2: Math.round(ih * (1 - pad)),
    naturalW: img.naturalWidth, naturalH: img.naturalHeight
  };
  attachCropHandlers();
  updateCropFrame();
}

function attachCropHandlers() {
  var stage = document.getElementById('crop-stage');
  if (stage._handlersAttached) return;
  stage._handlersAttached = true;

  var dragging = null; // 'tl' | 'br' | null
  var tl = document.getElementById('crop-handle-tl');
  var br = document.getElementById('crop-handle-br');

  function pointerToImg(e) {
    var img = document.getElementById('crop-img');
    var rect = img.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function onStart(handle) {
    return function(e) {
      e.preventDefault();
      dragging = handle;
    };
  }

  function onMove(e) {
    if (!dragging || !_cropState) return;
    e.preventDefault();
    var p = pointerToImg(e);
    var s = _cropState;
    var minSize = 40;
    if (dragging === 'tl') {
      s.x1 = Math.max(0, Math.min(s.x2 - minSize, p.x));
      s.y1 = Math.max(0, Math.min(s.y2 - minSize, p.y));
    } else {
      s.x2 = Math.min(s.imgW, Math.max(s.x1 + minSize, p.x));
      s.y2 = Math.min(s.imgH, Math.max(s.y1 + minSize, p.y));
    }
    updateCropFrame();
  }

  function onEnd() { dragging = null; }

  tl.addEventListener('touchstart', onStart('tl'), { passive: false });
  br.addEventListener('touchstart', onStart('br'), { passive: false });
  tl.addEventListener('mousedown',  onStart('tl'));
  br.addEventListener('mousedown',  onStart('br'));

  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchend', onEnd);
  document.addEventListener('mouseup',  onEnd);
}

function updateCropFrame() {
  var s = _cropState; if (!s) return;
  var frame = document.getElementById('crop-frame');
  var tl = document.getElementById('crop-handle-tl');
  var br = document.getElementById('crop-handle-br');
  var mt = document.getElementById('crop-mask-t');
  var mb = document.getElementById('crop-mask-b');
  var ml = document.getElementById('crop-mask-l');
  var mr = document.getElementById('crop-mask-r');

  frame.style.left   = s.x1 + 'px';
  frame.style.top    = s.y1 + 'px';
  frame.style.width  = (s.x2 - s.x1) + 'px';
  frame.style.height = (s.y2 - s.y1) + 'px';

  tl.style.left = s.x1 + 'px'; tl.style.top = s.y1 + 'px';
  br.style.left = s.x2 + 'px'; br.style.top = s.y2 + 'px';

  // Darken outside the crop region
  mt.style.left = '0'; mt.style.top = '0';
  mt.style.width = s.imgW + 'px'; mt.style.height = s.y1 + 'px';
  mb.style.left = '0'; mb.style.top = s.y2 + 'px';
  mb.style.width = s.imgW + 'px'; mb.style.height = (s.imgH - s.y2) + 'px';
  ml.style.left = '0'; ml.style.top = s.y1 + 'px';
  ml.style.width = s.x1 + 'px'; ml.style.height = (s.y2 - s.y1) + 'px';
  mr.style.left = s.x2 + 'px'; mr.style.top = s.y1 + 'px';
  mr.style.width = (s.imgW - s.x2) + 'px'; mr.style.height = (s.y2 - s.y1) + 'px';
}

function cropReset() {
  if (!_cropState) return;
  var s = _cropState;
  var pad = 0.10;
  s.x1 = Math.round(s.imgW * pad);
  s.y1 = Math.round(s.imgH * pad);
  s.x2 = Math.round(s.imgW * (1 - pad));
  s.y2 = Math.round(s.imgH * (1 - pad));
  updateCropFrame();
}

function cropCancel() {
  var ov = document.getElementById('crop-overlay');
  if (ov) ov.classList.remove('on');
  var p = _cropPending;
  _cropPending = null; _cropState = null;
  if (p && p.onCancel) p.onCancel();
}

function cropUse() {
  if (!_cropPending || !_cropState) return;
  var s = _cropState;
  // Map display coords → natural image coords
  var sx = s.naturalW / s.imgW;
  var sy = s.naturalH / s.imgH;
  var nx1 = Math.round(s.x1 * sx);
  var ny1 = Math.round(s.y1 * sy);
  var nx2 = Math.round(s.x2 * sx);
  var ny2 = Math.round(s.y2 * sy);
  var cw = nx2 - nx1, ch = ny2 - ny1;

  var img = document.getElementById('crop-img');
  var canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, nx1, ny1, cw, ch, 0, 0, cw, ch);
  var croppedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  var ov = document.getElementById('crop-overlay');
  if (ov) ov.classList.remove('on');
  var p = _cropPending;
  _cropPending = null; _cropState = null;
  if (p && p.onUse) p.onUse(croppedDataUrl);
}
// Worker returns the parsed patient JSON directly — no Apps Script roundtrip.
function handleOCRResult(data, bar) {
  if (!data || data.error) {
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'OCR: ' + ((data && data.error) || 'unknown error'); }
    return;
  }

  // Worker returns the patient object directly. Older worker code may wrap it
  // as { text: "..." } — handle both shapes.
  var p = data;
  if (typeof data.text === 'string') {
    var match = data.text.match(/\{[\s\S]*\}/);
    if (!match) { if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'No data in response'; } return; }
    try { p = JSON.parse(match[0]); }
    catch (e) { if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Bad JSON in response'; } return; }
  }

  // Persist the full OCR result for two purposes:
  //   1. window._lastOCR — debug from console: console.log(window._lastOCR._meta)
  //   2. window._ocrOriginal — snapshot of what OCR produced, used by
  //      buildOCRCorrections() at save time to compute a diff against
  //      the doctor's final form values. Same shape as upload.html.
  window._lastOCR     = p;
  window._ocrOriginal = {
    last:   p.last  || '',
    first:  p.first || '',
    phn:    p.phn   || '',
    dob:    p.dob   || '',
    sex:    p.sex   || '',
    mrp:    p.mrp   || '',
    ward:   p.ward  || '',
    room:   p.room  || '',
    engine: p._engine || 'worker',
    capturedAt: Date.now()
  };

  if (p.last)  document.getElementById('f-last').value  = p.last;
  if (p.first) document.getElementById('f-first').value = p.first;
  if (p.phn)   document.getElementById('f-phn').value   = (p.phn + '').replace(/\D/g,'').slice(0,10);
  if (p.dob)   document.getElementById('f-dob').value   = fmtClaimDate(p.dob);
  if (p.sex)   { apSexPill(p.sex); }
  if (p.ward && WARDS[p.ward]) { document.getElementById('f-ward').value = p.ward; wardChange(); }
  if (p.mrp) {
    var mrpSel = document.getElementById('f-mrp');
    if (mrpSel) {
      var mrpMap = [
        ['cardiology','Cardiology'],['hospitalist','Hospitalist'],['ctu','CTU'],
        ['icu','ICU'],['csicu','CSICU'],['cardiac surg','Cardiac Surgery'],
        ['general surg','General Surgery'],['orthop','Orthopedics'],
        ['neurol','Neurology'],['nephr','Nephrology']
      ];
      var mrpLower = String(p.mrp || '').toLowerCase();
      var mrpVal = '';
      for (var mi = 0; mi < mrpMap.length; mi++) {
        if (mrpLower.indexOf(mrpMap[mi][0]) !== -1) { mrpVal = mrpMap[mi][1]; break; }
      }
      if (mrpVal) { mrpSel.value = mrpVal; mrpChange(); }
    }
  }
  if (p.room) {
    // Strip Meditech prefix and leading zeros: KGHS0226-A → 226A
    var roomRaw = String(p.room).toUpperCase().replace(/^KGHS/,'').replace(/-/g,'');
    var roomMatch = roomRaw.match(/^0*([1-9]\d{0,3})([A-Z]?)$/);
    var roomClean = roomMatch ? (roomMatch[1] + roomMatch[2]) : roomRaw;
    var bedInp = document.getElementById('f-bed');
    if (bedInp) bedInp.value = roomClean;
    saveCustomRoom(gv('f-ward'), roomClean);
  }
  if (bar) {
    bar.className = 'ocr-bar ocr-ok';
    var engineTag = '';
    if (p._engine === 'cloud')          engineTag = '☁️ ';
    else if (p._engine === 'apps-script') engineTag = '🏥 ';
    else if (p._engine === 'tesseract') engineTag = '📱 ';
    else if (p._engine === 'mlkit')     engineTag = '📱 ';
    bar.textContent = engineTag + '✓ Extracted: ' + (p.last||'?') + ', ' + (p.first||'?') + (p.phn ? ' · ' + p.phn : '');
  }
}

// ─── OCR corrections diff ──────────────────────────────────────────
// Compares the OCR snapshot (window._ocrOriginal, set by handleOCRResult)
// against the patient as actually saved. Returns an array of
// {ts, phn, patientName, field, ocr_value, corrected_value, engine, source}
// for every field the doctor changed. Schema matches the live Apps Script
// 'OCR Corrections' sheet exactly (8 cols).
//
// Sent to Apps Script via push('logOCRCorrections', { corrections }).
// upload.html uses the same backend (action name and schema) — corrections
// from both apps land in one shared sheet, tagged by `source`.
//
// Only logs CORRECTIONS — fields where OCR produced something AND the doctor
// changed it. Empty-OCR-then-doctor-typed-something is NOT a correction
// (OCR didn't claim anything to be wrong about) — EXCEPT for ward and
// room, where empty often means "decoder map missing an entry" and the
// doctor's value is exactly the signal we need to fix that.

var OCR_CORRECTION_FIELDS = ['last','first','phn','dob','sex','mrp','ward','room'];

// Fields where empty→typed IS a useful learning signal:
//   ward/room: empty usually means decodeMeditechLocation missed a code.
//              The doctor's value tells us what code maps to what ward/room.
var LOG_EMPTY_AS_CORRECTION = { ward: true, room: true };

function buildOCRCorrections(savedPatient) {
  if (!window._ocrOriginal) return [];
  var orig = window._ocrOriginal;
  var corrections = [];

  // Pull stickerType from the last OCR result so we know whether this scan
  // was a chart sticker, lab vial, or Meditech header — useful for slicing
  // the corrections corpus later.
  var stickerType = '';
  if (window._lastOCR && window._lastOCR._meta) {
    stickerType = window._lastOCR._meta.stickerType || '';
  }

  // Pull raw OCR text for ward/room corrections — lets us see what code
  // the OCR captured that the decoder failed on (e.g. KELKGHX123 -> ward=X).
  // Stored under ocr_value when the original ward/room is blank, so the
  // next chat can extend decodeMeditechLocation accordingly.
  var rawText = '';
  if (window._lastOCR && window._lastOCR._meta) {
    rawText = window._lastOCR._meta.rawText || '';
  }

  OCR_CORRECTION_FIELDS.forEach(function(field) {
    var ov = String(orig[field]   || '').trim();
    var cv = String(savedPatient[field] || '').trim();
    // PHN: normalise both sides to digits-only before comparing
    if (field === 'phn') {
      ov = ov.replace(/\D/g,'');
      cv = cv.replace(/\D/g,'');
    }

    var isStandardCorrection = (ov && cv && ov !== cv);
    // Empty→typed ward/room is signal ONLY on Meditech headers,
    // where the decoder SHOULD have produced a ward/room. On chart
    // stickers, ward is always entered manually — not a correction.
    var isEmptyOcrLearning   = (!ov && cv
                                && LOG_EMPTY_AS_CORRECTION[field]
                                && stickerType === 'meditech');

    if (isStandardCorrection || isEmptyOcrLearning) {
      // For empty-OCR ward/room: stash the raw KELKGH/KGH line from OCR
      // in ocr_value so we can see what the decoder should have matched.
      var ocrValForLog = ov;
      if (isEmptyOcrLearning) {
        var hint = '';
        if (field === 'ward' && rawText) {
          var wm = rawText.match(/KELKGH[A-Z0-9]+/);
          if (wm) hint = '(rawText: ' + wm[0] + ')';
        } else if (field === 'room' && rawText) {
          var rm = rawText.match(/KGH[A-Z]+\d{3,4}[\s-]?[A-Z]?/);
          if (rm) hint = '(rawText: ' + rm[0] + ')';
        }
        ocrValForLog = '[empty] ' + hint;
      }

      corrections.push({
        ts:              new Date().toISOString(),
        phn:             savedPatient.phn || cv,
        patientName:     (savedPatient.last || '') + ', ' + (savedPatient.first || ''),
        field:           field,
        ocr_value:       ocrValForLog,
        corrected_value: cv,
        engine:          orig.engine || 'worker',
        source:          stickerType ? 'main:' + stickerType : 'main'
      });
    }
  });
  return corrections;
}


