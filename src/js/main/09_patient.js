// ── 09_patient.js ──
// ═══════════════════════════════════════════════════════
// 09_patient.js — Add patient (Step 1), sticker/Meditech
//                 chart photo OCR, ward/room selectors
// ═══════════════════════════════════════════════════════

// PHN duplicate merge modal
function openMergeModal(existing, isReadmit) {
  var newLast = (gv('f-last') || '').trim().toLowerCase();
  var newDob  = (gv('f-dob')  || '').trim();
  var lastMatch = existing.last && newLast && existing.last.toLowerCase() === newLast;
  var dobMatch  = existing.dob  && newDob  && fmtClaimDate(existing.dob) === fmtClaimDate(newDob);
  var matchScore = (lastMatch ? 1 : 0) + (dobMatch ? 1 : 0);

  var statusBadge = isReadmit
    ? '<span style="background:var(--amber-bg);color:var(--amber-t);padding:2px 8px;border-radius:var(--rpill);font-size:10px;font-weight:700">Previously discharged</span>'
    : '<span style="background:var(--red-bg);color:var(--red-t);padding:2px 8px;border-radius:var(--rpill);font-size:10px;font-weight:700">Currently on list</span>';

  var matchBadge = matchScore === 2
    ? '<div style="color:var(--green-t);font-weight:700;font-size:12px;margin-top:8px">✓ Last name and DOB both match — likely same patient</div>'
    : matchScore === 1
    ? '<div style="color:var(--amber-t);font-weight:700;font-size:12px;margin-top:8px">⚠ Partial match (' + (lastMatch ? 'last name' : 'DOB') + ' only) — review carefully</div>'
    : '<div style="color:var(--red-t);font-weight:700;font-size:12px;margin-top:8px">✗ Neither last name nor DOB match — likely wrong PHN</div>';

  var claimCount = st.claims.filter(function(c) { return samePhn(c.phn, existing.phn); }).length;

  var h = statusBadge +
    '<div style="margin:10px 0 4px;font-size:13px;font-weight:700">' + esc(existing.last) + ', ' + esc(existing.first) + '</div>' +
    '<div style="font-size:11px;color:var(--text2)">PHN: ' + esc(existing.phn) + ' &bull; DOB: ' + esc(existing.dob ? dispDate(existing.dob) : '—') + ' &bull; ' + claimCount + ' claim(s)</div>' +
    matchBadge +
    '<div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">';

  if (matchScore >= 1) {
    if (isReadmit) {
      h += '<button class="btn btn-p" style="margin:0" onclick="mergePatient(\'readmit\')">Re-admit — restore to rounds list</button>';
    } else {
      h += '<button class="btn btn-p" style="margin:0" onclick="mergePatient(\'merge\')">Merge — keep existing patient &amp; claims</button>';
    }
  }
  h += '<button class="btn btn-s" style="margin:0" onclick="mergePatient(\'review\')">Review PHN — may be entry error</button>';
  h += '</div>';

  document.getElementById('merge-title').textContent = 'PHN ' + existing.phn + ' already exists';
  document.getElementById('merge-body').innerHTML = h;
  showModal('merge-modal');
}

function mergePatient(action) {
  hideModal('merge-modal');
  if (action === 'review') {
    // Focus PHN field for correction
    var phnEl = document.getElementById('f-phn');
    if (phnEl) { phnEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; phnEl.select(); phnEl.focus(); }
    showToast('Check PHN — may be a transcription error');
    return;
  }
  if (action === 'merge') {
    // Just navigate to the existing patient's summary — no duplicate created
    var existing = st.patients.find(function(x) { return x.phn === gv('f-phn') && !x.discharged; });
    if (existing) {
      showToast(existing.last + ' already on list — opening their record');
      clearAddForm();
      nav(0, document.querySelectorAll('.nb')[0]);
      setTimeout(function() { openPatientSummary(existing.id); }, 300);
    }
    return;
  }
  if (action === 'readmit') {
    // Re-activate the discharged patient with new ward/bed from the form
    var existing = st.patients.find(function(x) { return x.phn === gv('f-phn') && x.discharged; });
    if (!existing) return;
    existing.discharged   = false;
    existing.dischargedAt = null;
    existing.dischargeDate = null;
    existing.ward         = gv('f-ward') || existing.ward;
    existing.bed          = gv('f-bed')  || existing.bed;
    existing.list         = gv('f-list') || 'on';
    // Update refby/icd if new values provided
    var newRefby = gv('f-refby-num') || gv('f-refby');
    var newIcd   = gv('f-icd');
    if (newRefby) { existing.refby = newRefby; existing.refbyName = gv('f-refby-name') || existing.refbyName; }
    if (newIcd)   existing.icd = newIcd;
    sv('patients', st.patients);
    if (SHEETS_URL) push('savePatient', existing);
    logChange(existing, 'Re-admitted', existing.ward + (existing.bed ? ' Bed/Rm ' + existing.bed : ''));
    showToast(existing.last + ' re-admitted');
    clearAddForm();
    nav(0, document.querySelectorAll('.nb')[0]);
    render();
  }
}

// Soft duplicate check — fires when last name + DOB match an existing
// patient but PHN differs (suggests a PHN typo). Does NOT block: gives
// the doctor the choice to fix the PHN or proceed as a new patient.
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

function openPossibleDuplicateModal(existing, withClaim) {
  // Legacy — route through hard block instead
  openDuplicateBlockModal(existing, ['Last name', 'DOB']);
}

// ── Add patient — entry points ────────────────────────────
function addPatientWithConsult() {
  // Validate consult date before proceeding
  var cDateISO = (document.getElementById('f-c-date') || {}).value || '';
  if (!cDateISO) { showToast('Enter consult date'); return; }
  _addPatientCore(true);
}

function addPatientOnly() {
  _addPatientCore(false);
}

// Shared patient validation, creation and optional consult claim.
// skipNameDobDup: set true when the user already saw the soft duplicate
// warning and chose "Continue — different patient".
async function _addPatientCore(withClaim, skipNameDobDup) {
  var last = gv('f-last');
  var phn  = gv('f-phn');
  if (!last) { showToast('Enter patient last name'); return; }

  var ward = gv('f-ward');
  var icd  = gv('f-icd') || '';

  var addMissing = [];
  if (!phn)                                    addMissing.push('phn');
  else if (String(phn).replace(/\D/g,'').length !== 10) addMissing.push('phn-len');
  if (!gv('f-refby-num') && !gv('f-refby'))   addMissing.push('refby');
  if (!icd)                                    addMissing.push('icd');
  if (addMissing.length) {
    if (addMissing.indexOf('phn') !== -1) {
      var phnEl = document.getElementById('f-phn');
      if (phnEl) { phnEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; phnEl.focus(); }
    }
    if (addMissing.indexOf('refby') !== -1) {
      var refEl = document.getElementById('f-ref-search');
      if (refEl) { refEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; refEl.placeholder = 'Required — type name or doctor #'; if (addMissing.indexOf('phn') === -1) refEl.focus(); }
    }
    if (addMissing.indexOf('icd') !== -1) {
      var icdEl = document.getElementById('f-icd-search');
      if (icdEl) { icdEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; icdEl.placeholder = 'Required — type diagnosis or code'; if (addMissing.indexOf('phn') === -1 && addMissing.indexOf('refby') === -1) icdEl.focus(); }
    }
    var msgs = [];
    if (addMissing.indexOf('phn')     !== -1) msgs.push('PHN');
    if (addMissing.indexOf('phn-len') !== -1) msgs.push('PHN must be 10 digits');
    if (addMissing.indexOf('refby')   !== -1) msgs.push('referring MD');
    if (addMissing.indexOf('icd')     !== -1) msgs.push('diagnosis');
    showToast('Required: ' + msgs.join(', '));
    return;
  }

  // PHN duplicate check — offer merge if last name and/or DOB match
  var existing = st.patients.find(function(x) { return x.phn === phn && !x.discharged; });
  if (existing) {
    openMergeModal(existing);
    return;
  }
  // Discharged patient with same PHN — offer to re-admit
  var dischExisting = st.patients.find(function(x) { return x.phn === phn && x.discharged; });
  if (dischExisting) {
    openMergeModal(dischExisting, true);
    return;
  }

  // Soft duplicate check: same LAST NAME + DOB but DIFFERENT PHN.
  // Likely a PHN typo. Warn the user but allow them to proceed.
  if (!skipNameDobDup) {
    var lastLc = String(last || '').trim().toLowerCase();
    var dobFmt = fmtClaimDate(gv('f-dob') || '');
    if (lastLc && dobFmt) {
      var nameDobMatch = st.patients.find(function(x) {
        if (!x || x.phn === phn) return false;
        var xLast = String(x.last || '').trim().toLowerCase();
        var xDob  = x.dob ? fmtClaimDate(x.dob) : '';
        return xLast === lastLc && xDob === dobFmt;
      });
      if (nameDobMatch) {
        openPossibleDuplicateModal(nameDobMatch, withClaim);
        return;
      }
    }

    // v3.37: Typo-PHN catcher. Same last+first name as an existing patient,
    // PHN differs by 1-2 digits → almost certainly a transcription error
    // (e.g. 9050828076 vs 9050328076 — single-digit '8' vs '3'). Catches
    // typos even when DOB is missing or also typo'd, which the name+DOB
    // check above doesn't. Still soft — the doctor can override if the
    // similar PHN is genuinely a different person.
    var firstLc = String(gv('f-first') || '').trim().toLowerCase();
    if (lastLc && firstLc && phn && phn.length === 10) {
      var phnTypoMatch = st.patients.find(function(x) {
        if (!x || !x.phn || x.phn === phn) return false;
        var xPhn = String(x.phn);
        if (xPhn.length !== phn.length) return false;
        var xLast  = String(x.last  || '').trim().toLowerCase();
        var xFirst = String(x.first || '').trim().toLowerCase();
        if (xLast !== lastLc || xFirst !== firstLc) return false;
        // Count digit differences
        var diffs = 0;
        for (var i = 0; i < phn.length; i++) if (phn[i] !== xPhn[i]) diffs++;
        return diffs >= 1 && diffs <= 2;
      });
      if (phnTypoMatch) {
        openPossibleDuplicateModal(phnTypoMatch, withClaim);
        return;
      }
    }
  }

  var p = {
    id:           'p' + Date.now(),
    last:         fmtName(last),
    first:        fmtName(gv('f-first')),
    phn:          phn,
    dob:          gv('f-dob'),
    sex:          gv('f-sex'),
    ward:         ward,
    bed:          gv('f-bed'),
    fac:          'OA040',
    refby:        gv('f-refby-num') || gv('f-refby'),
    refbyName:    gv('f-refby-name'),
    role:         gv('f-role')   || 'consultant',
    mrp:          gv('f-mrp')    || 'Cardiology',
    list:         gv('f-list')   || 'on',
    care:         gv('f-care')   || (gv('f-role') === 'mrp' ? 'daily' : 'directive'),
    icd:          icd,
    roundedToday: null,
    createdBy:    (st.doc && st.doc.alias) || '',
    createdAt:    Date.now()
  };

  saveCustomRoom(ward, p.bed);
  st.patients.push(p);
  sv('patients', st.patients);

  // v3.36: AWAIT savePatient before creating claims. If the patient-row push
  // fails (e.g. wifi hiccup), we'll know immediately and can refuse to write
  // orphan claims. Previously this was fire-and-forget and a transient
  // network failure would leave claims on Sheets but no matching patient row.
  if (SHEETS_URL) {
    var ok = await push('savePatient', p);
    if (!ok) {
      // Push failed — back the local state out and warn the user.
      st.patients = st.patients.filter(function(x) { return x.id !== p.id; });
      showToast('Could not save patient — check wifi and try again');
      return;
    }
  }
  logChange(p, 'Admitted', ward + (p.bed ? ' Bed/Rm ' + p.bed : ''));

  // OCR corrections capture — if this patient was OCR'd, diff what the OCR
  // produced against what was actually saved and log any corrections.
  // Same pattern as upload.html. Cleared after each successful save so it
  // doesn't bleed into the next patient.
  if (window._ocrOriginal) {
    var corrections = buildOCRCorrections(p);
    if (corrections.length && SHEETS_URL) push('logOCRCorrections', { corrections: corrections });
    window._ocrOriginal = null;
  }

  // Optionally create a consult claim at the same time
  if (withClaim && st.doc) {
    var cCode    = document.getElementById('f-c-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
    var cDateISO = (document.getElementById('f-c-date')  || {}).value || '';
    var cStart   = (document.getElementById('f-c-start') || {}).value || '';
    var cEnd     = (document.getElementById('f-c-end')   || {}).value || '';
    var cNotes   = (document.getElementById('f-c-notes') || {}).value || '';
    var cPerf    = document.getElementById('f-c-performing-doc');
    var cAlias   = (cPerf && cPerf.value) ? cPerf.value : st.doc.alias;
    if (cDateISO) {
      var cDateFmt = fmtD(parseISODate(cDateISO));
      var cLoc     = p.ward === 'ED' ? 'E' : 'I';
      // CCFPP — same one-directional detection as the +Claim consult path.
      // Previously the Add Patient path skipped this entirely. The note
      // belongs on the 120x modifier claims only, never on the consult row.
      var cCcfppNote = ccfppDetectAndUpdate(p, cAlias, cDateISO, cDateFmt, cStart, cEnd);
      var cModNote   = [cNotes, cCcfppNote].filter(function(s) { return s; }).join(' | ');
      addClaim(p, cCode, cCode, 1, cDateFmt, cLoc, cStart, cNotes, cEnd, cAlias);
      if (_apMostOn) addClaim(p, '78720', '78720', 1, cDateFmt, cLoc, null, null, null, cAlias);
      var cModBase  = getModifier(cStart, cDateISO);
      var cIncUnits = consultIncUnits(cStart, cEnd);
      var cModInc   = cIncUnits > 0 ? getModifierForIncrement(cStart, cDateISO) : null;
      if (cModBase) {
        var cModBaseEnd = minsToTime((t2m(cStart) + 30) % (24 * 60));
        addClaim(p, cModBase.base, cModBase.base, 1, cDateFmt, cLoc, cStart, cModNote, cModBaseEnd, cAlias);
        if (cModInc) {
          var cIncStart = minsToTime((t2m(cStart) + 30) % (24 * 60));
          addClaim(p, cModInc.inc, cModInc.inc, cIncUnits, cDateFmt, cLoc, cIncStart, cModNote, cEnd, cAlias);
        }
      }
      sv('claims', st.claims);
    }
  }

  var claimMsg = withClaim ? ' + consult claim' : '';
  showToast(last + (p.list === 'consult-only' ? ' — claim only' : ' added to ' + (p.list === 'on' ? 'On' : 'Off') + ' Service') + claimMsg);
  clearAddForm();
  nav(0, document.querySelectorAll('.nb')[0]);
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
var _apMostOn = true;

// Called when the Add Patient pane opens and after clearAddForm.
// Pre-fills date/time and injects the performing physician selector.
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
    injectApPerformingDoc();
  } else {
    area.innerHTML = buildApOtherClaimArea();
    var dateEl = document.getElementById('ap-oc-date');
    if (dateEl) dateEl.value = localISODate();
    injectApPerformingDoc();
  }
}

function injectApPerformingDoc() {
  var perfWrap = document.getElementById('f-c-performing-wrap');
  if (!perfWrap) return;
  if (!st.doctors || !st.doctors.length) { perfWrap.innerHTML = ''; return; }
  var curAlias = st.doc ? st.doc.alias : '';
  var opts = st.doctors.map(function(d) {
    return '<option value="' + esc(d.alias) + '"' + (d.alias === curAlias ? ' selected' : '') + '>' +
           esc(d.name || d.alias) + ' (' + esc(d.alias) + ')</option>';
  }).join('');
  perfWrap.innerHTML = '<label style="margin-top:6px">Performing physician</label>' +
                       '<select id="f-c-performing-doc">' + opts + '</select>';
  // Explicitly set value — guarantees default even when selected attribute is ignored
  var sel = document.getElementById('f-c-performing-doc');
  if (sel && curAlias) sel.value = curAlias;
}

function buildApConsultArea() {
  var h = '';
  h += '<div class="fl" style="margin-bottom:9px">';
  h += '<button id="f-c-33010" class="ct-btn ct-on-consult" style="flex:1" onclick="toggleApConsultCode(\'33010\')">33010 — Full</button>';
  h += '<button id="f-c-33012" class="ct-btn" style="flex:1" onclick="toggleApConsultCode(\'33012\')">33012 — Limited</button>';
  h += '</div>';
  h += '<button class="most-btn on" id="f-c-most" onclick="toggleApMost()">' +
       '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
       '+ MOST (78720)</button>';
  h += '<div id="f-c-mod" style="margin-top:6px"></div>';
  h += '<div class="fl" style="margin-top:4px">';
  h += '<div class="f1"><label>Date</label><input type="date" id="f-c-date" oninput="updateApConsultUI()"></div>';
  h += '<div class="f1"><label>Start time</label><input type="text" id="f-c-start" placeholder="14:30 or 2:30pm" oninput="updateApConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateApConsultUI();}"></div>';
  h += '</div>';
  h += '<div class="fl"><div class="f1"><label>End time <span style="font-size:10px;color:var(--text3)">— Defaults to 50min, adjust as needed</span></label><input type="text" id="f-c-end" placeholder="14:30 or 2:30pm" oninput="updateApConsultUI()" onblur="var v=parseTime24(this.value);if(v){this.value=v;updateApConsultUI();}"></div></div>';
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional)</span></label>';
  h += '<textarea id="f-c-notes" rows="2" placeholder="Optional" autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:6px"></textarea>';
  h += '<div style="border-top:.5px solid var(--border);margin:4px 0 10px"></div>';
  h += _buildApRefIcdHtml();
  h += '<div id="f-c-performing-wrap"></div>';
  return h;
}

function buildApOtherClaimArea() {
  var h = '';
  h += '<div class="fl">';
  h += '<div class="f1"><label>Fee code</label><input id="ap-oc-fee" placeholder="e.g. 14101" autocorrect="off" autocomplete="off" style="text-transform:uppercase"></div>';
  h += '<div class="f1"><label>Units</label><input id="ap-oc-units" inputmode="numeric" value="1"></div>';
  h += '</div>';
  h += '<label>Date</label><input type="date" id="ap-oc-date">';
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional)</span></label>';
  h += '<textarea id="ap-oc-notes" rows="2" placeholder="Optional" autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:6px"></textarea>';
  h += '<div style="border-top:.5px solid var(--border);margin:4px 0 10px"></div>';
  h += _buildApRefIcdHtml();
  h += '<div id="f-c-performing-wrap"></div>';
  return h;
}

function buildApCCUAdmitArea() {
  var h = '';
  h += '<label>Date</label><input type="date" id="ap-ca-date">';
  h += '<label style="margin-top:4px">Notes <span style="font-size:10px;color:var(--text3)">(optional)</span></label>';
  h += '<textarea id="ap-ca-notes" rows="2" placeholder="Optional" autocorrect="off" style="width:100%;padding:8px;border:.5px solid var(--border2);border-radius:var(--rsm);font-size:14px;font-family:inherit;resize:vertical;margin-bottom:6px"></textarea>';
  h += '<div style="border-top:.5px solid var(--border);margin:4px 0 10px"></div>';
  h += _buildApRefIcdHtml();
  h += '<div id="f-c-performing-wrap"></div>';
  return h;
}

function _buildApRefIcdHtml() {
  var h = '';
  h += '<label>Diagnosis</label>';
  h += '<div style="position:relative">';
  h += '<input id="f-icd-search" placeholder="Type diagnosis or code..." autocorrect="off" autocomplete="off" style="padding-right:32px" data-dd="f-icd-dd" data-hidden="f-icd" oninput="icdSearchEl(this)" onfocus="icdSearchEl(this)">';
  h += '<button type="button" tabindex="-1" onclick="clearSearchField(\'f-icd-search\',\'f-icd\',null,\'f-icd-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'f-icd-search\',\'f-icd\',null,\'f-icd-dd\')" style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>';
  h += '</div>';
  h += '<input id="f-icd" type="hidden"><div class="ref-dd" id="f-icd-dd"></div>';
  h += '<label style="margin-top:4px">Referred by</label>';
  h += '<div style="position:relative">';
  h += '<input id="f-ref-search" placeholder="Type name or doctor #..." autocorrect="off" style="padding-right:32px" data-dd="f-ref-dd" data-hidden="f-refby" data-name="f-refby-name" oninput="refSearchEl(this)" onfocus="refSearchEl(this)">';
  h += '<button type="button" tabindex="-1" onclick="clearSearchField(\'f-ref-search\',\'f-refby\',\'f-refby-name\',\'f-ref-dd\')" onpointerdown="event.preventDefault();clearSearchField(\'f-ref-search\',\'f-refby\',\'f-refby-name\',\'f-ref-dd\')" style="position:absolute;right:8px;top:9px;background:none;border:none;font-size:18px;line-height:1;color:var(--text3);cursor:pointer;padding:2px 4px;z-index:5">&times;</button>';
  h += '</div>';
  h += '<div class="ref-dd" id="f-ref-dd"></div>';
  h += '<input id="f-refby" type="hidden"><input id="f-refby-name" type="hidden"><input id="f-refby-num" type="hidden">';
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
  var icd = gv('f-icd') || '';

  // Validate required fields
  var addMissing = [];
  if (!phn)                                    addMissing.push('phn');
  else if (String(phn).replace(/\D/g,'').length !== 10) addMissing.push('phn-len');
  if (!gv('f-refby-num') && !gv('f-refby'))   addMissing.push('refby');
  if (!icd)                                    addMissing.push('icd');
  if (_apClaimType === 'consult') {
    if (!(document.getElementById('f-c-date')  || {}).value) addMissing.push('date');
    if (!(document.getElementById('f-c-start') || {}).value) addMissing.push('start time');
    if (!(document.getElementById('f-c-end')   || {}).value) addMissing.push('end time');
  } else if (_apClaimType === 'ccu-admit') {
    if (!(document.getElementById('ap-ca-date') || {}).value) addMissing.push('date');
  } else if (_apClaimType === 'other') {
    if (!gv('ap-oc-fee')) addMissing.push('fee');
    if (!(document.getElementById('ap-oc-date') || {}).value) addMissing.push('date');
  }

  if (addMissing.length) {
    if (addMissing.indexOf('phn') !== -1 || addMissing.indexOf('phn-len') !== -1) {
      var phnEl = document.getElementById('f-phn');
      if (phnEl) { phnEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; phnEl.focus(); }
    }
    if (addMissing.indexOf('refby') !== -1) {
      var refEl = document.getElementById('f-ref-search');
      if (refEl) { refEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; refEl.placeholder = 'Required — type name or doctor #'; }
    }
    if (addMissing.indexOf('icd') !== -1) {
      var icdEl2 = document.getElementById('f-icd-search');
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
    refby:     gv('f-refby-num') || gv('f-refby'),
    refbyName: gv('f-refby-name'),
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
      showToast('Could not save patient — check wifi and try again');
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
    var cAlias = st.doc.alias;
    var cPerf = document.getElementById('f-c-performing-doc');
    if (cPerf && cPerf.value) cAlias = cPerf.value;

    if (_apClaimType === 'consult') {
      var cCode    = (document.getElementById('f-c-33010') || {}).classList && document.getElementById('f-c-33010').classList.contains('ct-on-consult') ? '33010' : '33012';
      var cDateISO = (document.getElementById('f-c-date')  || {}).value || '';
      var cStart   = (document.getElementById('f-c-start') || {}).value || '';
      var cEnd     = (document.getElementById('f-c-end')   || {}).value || '';
      var cNotes   = (document.getElementById('f-c-notes') || {}).value || '';
      if (cDateISO) {
        var cDateFmt = fmtD(parseISODate(cDateISO));
        var cLoc     = p.ward === 'ED' ? 'E' : 'I';
        // CCFPP — detect + retroactively update peer claims
        var ccfppN   = ccfppDetectAndUpdate(p, cAlias, cDateISO, cDateFmt, cStart, cEnd);
        var fullN    = [cNotes, ccfppN].filter(function(s) { return s; }).join(' | ');
        addClaim(p, cCode, cCode, 1, cDateFmt, cLoc, cStart, fullN, cEnd, cAlias);
        if (_apMostOn) addClaim(p, '78720', '78720', 1, cDateFmt, cLoc, null, null, null, cAlias);
        var cModBase  = getModifier(cStart, cDateISO);
        var cIncUnits = consultIncUnits(cStart, cEnd);
        var cModInc   = cIncUnits > 0 ? getModifierForIncrement(cStart, cDateISO) : null;
        if (cModBase) {
          var cModBaseEnd2 = minsToTime((t2m(cStart) + 30) % (24 * 60));
          addClaim(p, cModBase.base, cModBase.base, 1, cDateFmt, cLoc, cStart, fullN, cModBaseEnd2, cAlias);
          if (cModInc) {
            var cIncStart = minsToTime((t2m(cStart) + 30) % (24 * 60));
            addClaim(p, cModInc.inc, cModInc.inc, cIncUnits, cDateFmt, cLoc, cIncStart, fullN, cEnd, cAlias);
          }
        }
        sv('claims', st.claims);
      }
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
      var ocFee     = gv('ap-oc-fee') || '';
      var ocUnits   = parseInt(gv('ap-oc-units')) || 1;
      var ocDateISO = (document.getElementById('ap-oc-date')  || {}).value || '';
      var ocNotes   = (document.getElementById('ap-oc-notes') || {}).value || '';
      if (ocFee && ocDateISO) {
        var ocDateFmt = fmtD(parseISODate(ocDateISO));
        var ocLoc = p.ward === 'ED' ? 'E' : 'I';
        addClaim(p, ocFee, ocFee, ocUnits, ocDateFmt, ocLoc, null, ocNotes, null, cAlias);
        sv('claims', st.claims);
      }
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
  // Build the claim area if it's empty (first load or after clear)
  var area = document.getElementById('ap-claim-area');
  if (area && !area.querySelector('#f-c-date')) {
    area.innerHTML = buildApConsultArea();
  }
  var now = new Date();
  var dateEl  = document.getElementById('f-c-date');
  var startEl = document.getElementById('f-c-start');
  var endEl   = document.getElementById('f-c-end');
  if (dateEl)  dateEl.value  = localISODate(now);
  if (startEl) startEl.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
  if (endEl)   endEl.value   = minsToTime(now.getHours() * 60 + now.getMinutes() + 50);
  // Reset toggles
  _apMostOn = true;
  var mostEl = document.getElementById('f-c-most');
  if (mostEl) mostEl.className = 'most-btn on';
  var el10 = document.getElementById('f-c-33010');
  var el12 = document.getElementById('f-c-33012');
  if (el10) el10.className = 'ct-btn ct-on-consult';
  if (el12) el12.className = 'ct-btn';
  injectApPerformingDoc();
  updateApConsultUI();
}

function toggleApConsultCode(code) {
  document.getElementById('f-c-33010').className = 'ct-btn' + (code === '33010' ? ' ct-on-consult' : '');
  document.getElementById('f-c-33012').className = 'ct-btn' + (code === '33012' ? ' ct-on-consult' : '');
}

function toggleApMost() {
  _apMostOn = !_apMostOn;
  document.getElementById('f-c-most').className = 'most-btn' + (_apMostOn ? ' on' : '');
}

function updateApConsultUI() {
  var start   = gv('f-c-start');
  var end     = gv('f-c-end');
  var dateISO = gv('f-c-date');

  // If start time changed, auto-update end to start + 50 min
  var changed = (typeof event !== 'undefined' && event && event.target) ? event.target.id : '';
  if (start && changed === 'f-c-start') {
    var endEl = document.getElementById('f-c-end');
    if (endEl) endEl.value = minsToTime(t2m(start) + 50);
    end = gv('f-c-end');
  }

  var modBase  = getModifier(start, dateISO);
  var hasInc   = consultHasIncrement(start, end);
  var modInc   = hasInc ? getModifierForIncrement(start, dateISO) : null;
  var incUnits = consultIncUnits(start, end);
  var modEl    = document.getElementById('f-c-mod');
  if (!modEl) return;

  if (modBase) {
    var banner = '<div class="mod-box ' + modBase.cls + '" style="margin-bottom:0;border-radius:var(--rsm) var(--rsm) 0 0">' +
      '<span style="font-weight:700">' + modBase.label + '</span>' +
      '<span style="font-size:10px;opacity:.75;margin-left:6px">' + modBase.base + ' ×1</span>' +
      '</div>';
    if (incUnits > 0) {
      var incMod = modInc || modBase;
      banner += '<div class="mod-box ' + incMod.cls + '" style="margin-top:1px;border-radius:0 0 var(--rsm) var(--rsm);opacity:.85">' +
        '<span>Consult time &gt; 45 min</span>' +
        '<span style="font-size:10px;font-weight:700;margin-left:6px">' + incMod.inc + ' ×' + incUnits + '</span>' +
        '</div>';
    } else {
      banner += '<div style="font-size:11px;padding:5px 10px;color:var(--text3);' +
        'border:.5px solid var(--border);border-top:none;border-radius:0 0 var(--rsm) var(--rsm);' +
        'background:var(--surface2)">Consult ≤ 45 min — no increment</div>';
    }
    modEl.innerHTML = banner;
  } else if (start && dateISO) {
    modEl.innerHTML = '<div class="mod-box mod-day">✓ Daytime weekday — no call-out modifier</div>';
  } else {
    modEl.innerHTML = '';
  }
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
  if (p.dob)   document.getElementById('f-dob').value   = dispDate(fmtClaimDate(p.dob));
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


