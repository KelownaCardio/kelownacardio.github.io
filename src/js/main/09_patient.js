// 09_patient.js — Add patient (Step 1), sticker/Meditech
//                 chart photo OCR, ward/room selectors
// ═══════════════════════════════════════════════════════

// ── Duplicate patient helper: 2-of-3 match on PHN / last / DOB ───
function _findDup2of3(patients, chkPhn, chkLast, chkDob) {
  var best = null, bestScore = 0, bestFields = [];
  (patients || []).forEach(function(x) {
    if (!x) return;
    var xPhn  = String(x.phn  || '').replace(/\D/g, '');
    var xLast = String(x.last || '').trim().toLowerCase();
    var xDob  = x.dob ? fmtClaimDate(x.dob) : '';
    var score = 0, fields = [];
    if (chkPhn  && xPhn  && chkPhn  === xPhn)  { score++; fields.push('PHN'); }
    if (chkLast && xLast && chkLast === xLast) { score++; fields.push('Last name'); }
    if (chkDob  && xDob  && chkDob  === xDob)  { score++; fields.push('DOB'); }
    if (score >= 2 && score > bestScore) {
      best = x; bestScore = score; bestFields = fields;
    }
  });
  return { match: best, fields: bestFields };
}

// ── Duplicate merge modal ─────────────────────────────────────────
// Shows side-by-side comparison pills for each differing demographic.
// Doctor taps the correct value for each, then merges or creates new.
function openDuplicateMergeModal(existing, matchedFields, newData) {
  // Store state for merge/create handlers
  window._dupExisting = existing;
  window._dupNewData  = newData;

  // Build per-field comparison data
  var demoFields = [
    { key: 'last',  label: 'Last Name' },
    { key: 'first', label: 'First Name' },
    { key: 'phn',   label: 'PHN' },
    { key: 'dob',   label: 'DOB' },
    { key: 'sex',   label: 'Sex' }
  ];
  window._dupFieldVals = {};
  window._dupSelections = {};
  demoFields.forEach(function(f) {
    var oldV = String(f.key === 'phn'
      ? (existing.phn || '').replace(/\D/g, '')
      : f.key === 'dob' && existing.dob ? fmtClaimDate(existing.dob)
      : (existing[f.key] || '')).trim();
    var newV = String(newData[f.key] || '').trim();
    window._dupFieldVals[f.key] = { old: oldV, 'new': newV };
    // Pre-select new value (unless blank, then keep old)
    window._dupSelections[f.key] = newV ? 'new' : 'old';
  });

  // Status badge
  var isDC = String(existing.discharged || '').toLowerCase() === 'true' || existing.discharged === true;
  var h = '<div style="margin-bottom:10px">';
  h += isDC
    ? '<span class="dup-badge dup-badge-dc">Previously discharged</span>'
    : '<span class="dup-badge dup-badge-active">Currently on list</span>';
  var via = existing.addedVia || '';
  if (via === 'PhoneConsult' || via === 'QuickChart')
    h += '<span class="dup-badge dup-badge-phone">Phone Consult</span>';
  h += '</div>';
  h += '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">Matched on: <b>' +
       esc(matchedFields.join(' + ')) + '</b></div>';

  // Comparison rows
  demoFields.forEach(function(f) {
    var vals = window._dupFieldVals[f.key];
    var oldV = vals.old, newV = vals['new'];
    var same = oldV.toLowerCase() === newV.toLowerCase();
    var dispOld = f.key === 'dob' && oldV ? dispDate(oldV) : oldV;
    var dispNew = f.key === 'dob' && newV ? dispDate(newV) : newV;

    h += '<div class="dup-row"><div class="dup-label">' + f.label + '</div>';
    if (same || (!oldV && !newV)) {
      h += '<div class="dup-match">\u2713 ' + esc(dispOld || '\u2014') + '</div>';
    } else if (!oldV) {
      h += '<div class="dup-match">+ ' + esc(dispNew) + '</div>';
    } else if (!newV) {
      window._dupSelections[f.key] = 'old';
      h += '<div class="dup-match">\u2713 ' + esc(dispOld) + '</div>';
    } else {
      var sel = window._dupSelections[f.key];
      h += '<div class="dup-pills">';
      h += '<button class="dup-pill' + (sel === 'old' ? ' selected' : '') +
           '" data-field="' + f.key + '" data-which="old" onclick="_tapDupPill(this)">' +
           esc(dispOld) + '<span class="dup-pill-tag">existing</span></button>';
      h += '<button class="dup-pill' + (sel === 'new' ? ' selected' : '') +
           '" data-field="' + f.key + '" data-which="new" onclick="_tapDupPill(this)">' +
           esc(dispNew) + '<span class="dup-pill-tag">new</span></button>';
      h += '</div>';
    }
    h += '</div>';
  });

  // Claim count
  var cc = st.claims.filter(function(c) { return samePhn(c.phn, existing.phn); }).length;
  if (cc) h += '<div style="font-size:11px;color:var(--text3);margin-top:8px">' +
               cc + ' existing claim' + (cc > 1 ? 's' : '') + ' linked</div>';

  h += '<div style="display:flex;gap:8px;margin-top:14px">';
  h += '<button class="btn btn-p" style="flex:1;margin:0" onclick="_mergeAndReadmit()">Readmit &amp; Merge</button>';
  h += '<button class="btn btn-s" style="flex:1;margin:0" onclick="_createNewPatient()">New Patient</button>';
  h += '</div>';

  document.getElementById('merge-title').textContent = 'Existing patient found';
  document.getElementById('merge-body').innerHTML = h;
  showModal('merge-modal');
}

// Pill tap handler — selects old or new value for a field
function _tapDupPill(el) {
  var field = el.dataset.field, which = el.dataset.which;
  window._dupSelections[field] = which;
  var pills = document.querySelectorAll('.dup-pill[data-field="' + field + '"]');
  for (var i = 0; i < pills.length; i++)
    pills[i].classList.toggle('selected', pills[i].dataset.which === which);
}

// Merge: reactivate existing patient with selected demographics
async function _mergeAndReadmit() {
  hideModal('merge-modal');
  var p = window._dupExisting;
  if (!p) return;
  var addToList = window._apPendingAddToList;

  // Apply selected demographics
  ['last', 'first', 'phn', 'dob', 'sex'].forEach(function(key) {
    var which = window._dupSelections[key] || 'new';
    var val = window._dupFieldVals[key][which];
    if (val) p[key] = (key === 'last' || key === 'first') ? fmtName(val) : val;
  });

  // Reactivate
  p.discharged = false;
  p.dischargedAt = '';
  p.dischargeDate = '';
  p.trueDischarge = false;
  p.consultOnly = false;

  if (addToList) {
    p.ward = gv('f-ward') || p.ward || 'OTHER';
    p.bed  = gv('f-bed')  || '';
    p.role = gv('f-role') || 'consultant';
    p.mrp  = gv('f-mrp')  || 'Other';
    p.list = gv('f-list') || 'on';
    p.care = gv('f-care') || 'directive';
    if (p.ward && p.bed) saveCustomRoom(p.ward, p.bed);
    if (new Date().getHours() >= 17) p.handover = 'new';
  } else {
    p.ward = ''; p.bed = ''; p.role = 'consultant';
    p.mrp  = 'Other'; p.list = 'consult-only'; p.care = 'directive';
    p.discharged    = true;
    p.trueDischarge = true;
    p.consultOnly   = true;
    p.dischargedAt  = Date.now();
    p.dischargeDate = fmtD(new Date());
  }

  // Update referrer / ICD from current form
  p.refby     = gv('cb-refby') || gv('oc-refby') || p.refby || '';
  p.refbyName = gv('cb-refby-name') || gv('oc-refby-name') || p.refbyName || '';
  p.icd       = gv('cb-icd') || gv('oc-icd') || p.icd || '';

  // Update or add to local state
  var idx = st.patients.findIndex(function(x) { return x && x.id === p.id; });
  if (idx >= 0) { st.patients[idx] = p; } else { st.patients.push(p); }
  sv('patients', st.patients);

  // Show overlay and save
  _submitGuard = true;
  _showSubmitOverlay();

  if (SHEETS_URL) {
    var ok = await push('savePatient', p);
    if (!ok) {
      showToast(window._lastPushError
        ? 'Not saved: ' + window._lastPushError
        : 'Could not save patient \u2014 check wifi and try again');
      _hideSubmitOverlay();
      return;
    }
  }
  logChange(p, 'Readmit (merged)', addToList ? (p.ward + (p.bed ? ' Rm ' + p.bed : '')) : 'Consult only');

  // Create claim — same flow as apSubmit
  if (st.doc) {
    var cPerf  = document.getElementById('cb-performing-doc');
    var cAlias = (cPerf && cPerf.value) ? cPerf.value : st.doc.alias;
    var billingLoc = (document.getElementById('f-billing-loc') || {}).value || 'I';

    if (_apClaimType === 'consult') {
      submitConsultClaims(p, cAlias, billingLoc);
    } else if (_apClaimType === 'ccu-admit') {
      var caDateISO = (document.getElementById('ap-ca-date')  || {}).value || '';
      var caNotes   = (document.getElementById('ap-ca-notes') || {}).value || '';
      if (caDateISO) {
        var caDateFmt = fmtD(parseISODate(caDateISO));
        addClaim(p, '1411', '1411', 1, caDateFmt, billingLoc, null, caNotes, null, cAlias);
        sv('claims', st.claims);
      }
    } else if (_apClaimType === 'other') {
      var ocLocEl = document.getElementById('oc-loc');
      if (ocLocEl) ocLocEl.value = billingLoc;
      submitOtherClaimFor(p, cAlias);
    }
  }

  showToast(p.last + ' readmitted (merged)');
  _hideSubmitOverlay();
  clearAddForm();
  if (addToList) { nav(0, document.querySelectorAll('.nb')[0]); }
  else { nav(2, document.querySelectorAll('.nb')[2]); }
}

// Skip dup check and create a genuinely new patient
function _createNewPatient() {
  hideModal('merge-modal');
  apSubmit(window._apPendingAddToList, true);
}

// Called from ward "+ Add" button — pre-fills ward and jumps to Add Patient
function openAdd(ward, bed) {
  document.getElementById('f-ward').value = ward;
  wardChange();
  if (bed) {
    document.getElementById('f-bed').value = String(bed);
    renderRoomPills(ward, 'f-bed', 'f-room-pills');
  }
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

// ═══════════════════════════════════════════════════════
// SHARED "Location & list" card  (v4.03)
// ───────────────────────────────────────────────────────
// One builder + one set of handlers for the ward / room / role /
// MRP service / on-off card. Used by THREE entry points, each with
// its own element-id prefix so the instances never collide:
//   'f'  → Add Patient   (always in the page)
//   'pe' → pencil edit   (pt-edit modal)
//   'le' → bed-circle    (loc-edit modal)
// Every save/read function reads {prefix}-ward, {prefix}-bed, etc.
// The Add Patient legacy names (wardChange, mrpChange, apRolePill, …)
// are kept below as thin wrappers so existing callers keep working.
// ═══════════════════════════════════════════════════════
function buildLocationCard(prefix, p, requireChoice) {
  p = p || {};
  var X    = prefix;
  // v4.11: when requireChoice is true (Add Patient fresh form), all three
  // user-selectable fields start unselected — ward shows a "Select location…"
  // placeholder, role pills are both off, list pills are both off. The
  // submit validation in apSubmit then forces the doctor to make active
  // choices before adding to the rounds list. Pencil-edit / location-edit
  // callers don't pass requireChoice and keep the existing behaviour of
  // pre-filling from the patient record.
  var noWard = requireChoice && !p.ward;
  var noRole = requireChoice && !p.role;
  var noList = requireChoice && !p.list;

  var ward = p.ward || (requireChoice ? '' : 'CCU');
  var bed  = p.bed  || '';
  var role = noRole ? '' : (p.role === 'mrp' ? 'mrp' : 'consultant');
  var mrp  = p.mrp  || 'Other';
  var list = noList ? '' : (p.list === 'on' ? 'on' : 'off');
  var care = p.care || 'directive';

  var placeholder = noWard
    ? '<option value="" selected disabled>Select location…</option>'
    : '';
  var wardOpts = placeholder + Object.keys(WARDS).map(function(k) {
    return '<option value="' + k + '"' + (ward === k ? ' selected' : '') + '>' + WARDS[k].label + '</option>';
  }).join('');
  var mrpOpts = ['Cardiology','Other','Hospitalist','CTU','ICU','CSICU',
                 'Cardiac Surgery','General Surgery','Orthopedics','Neurology','Nephrology']
    .map(function(s) { return '<option value="' + s + '"' + (mrp === s ? ' selected' : '') + '>' + s + '</option>'; })
    .join('');

  var h = '<div class="card card-location">';
  h += '<div class="card-title">Location &amp; list</div>';
  // Row 1 — Ward + Bed/room
  h += '<div class="fl">';
  h += '<div class="f1"><label>Ward</label>';
  h += '<select id="' + X + '-ward" onchange="locWardChange(\'' + X + '\')">' + wardOpts + '</select>';
  h += '<div id="' + X + '-ward-other-wrap" style="display:' + (ward === 'OTHER' ? 'block' : 'none') + ';margin-top:-3px">';
  h += '<input id="' + X + '-ward-other" placeholder="Enter ward name…" autocorrect="off" autocapitalize="words" style="margin-bottom:4px">';
  h += '<button type="button" onclick="locSaveCustomWard(\'' + X + '\')" style="padding:5px 12px;font-size:11px;font-weight:700;border:.5px solid var(--border2);border-radius:var(--rpill);background:var(--blue-bg);color:var(--blue-t);cursor:pointer;font-family:inherit">Save to list</button>';
  h += '</div></div>';
  h += '<div class="f1"><label id="' + X + '-bed-lbl">' + (ward === 'CCU' ? 'Bed #' : 'Room') + '</label>';
  h += '<input id="' + X + '-bed" type="text" autocorrect="off" autocomplete="off" placeholder="Type room…" style="margin-bottom:0;display:none" value="' + esc(bed) + '">';
  h += '<div id="' + X + '-room-pills" class="room-pills"></div>';
  h += '</div></div>';
  // Row 2 — Cardiology role
  h += '<label style="margin-top:8px">Cardiology role</label>';
  h += '<div id="' + X + '-role-row" class="fl" style="gap:8px;margin-top:4px">';
  h += '<button type="button" class="ap-list-pill' + (role === 'mrp' ? ' on' : '') + '" id="' + X + '-role-mrp" onclick="locRolePill(\'' + X + '\',\'mrp\')">MRP</button>';
  h += '<button type="button" class="ap-list-pill' + (role === 'consultant' ? ' on' : '') + '" id="' + X + '-role-con" onclick="locRolePill(\'' + X + '\',\'consultant\')">Consulting</button>';
  h += '</div>';
  h += '<input id="' + X + '-role" type="hidden" value="' + role + '">';
  // Row 3 — MRP service
  h += '<label style="margin-top:8px">MRP service</label>';
  h += '<select id="' + X + '-mrp" onchange="locMrpChange(\'' + X + '\')">' + mrpOpts + '</select>';
  // Row 4 — On / Off service
  h += '<label style="margin-top:8px">On / Off service</label>';
  h += '<div id="' + X + '-list-row" class="fl" style="gap:8px;margin-top:4px">';
  h += '<button type="button" class="ap-list-pill' + (list === 'on' ? ' on' : '') + '" id="' + X + '-pill-on" onclick="locListPill(\'' + X + '\',\'on\')">On service</button>';
  h += '<button type="button" class="ap-list-pill tone-amber' + (list === 'off' ? ' on' : '') + '" id="' + X + '-pill-off" onclick="locListPill(\'' + X + '\',\'off\')">Off service</button>';
  h += '</div>';
  h += '<input id="' + X + '-list" type="hidden" value="' + list + '">';
  h += '<input id="' + X + '-care" type="hidden" value="' + esc(care) + '">';
  h += '</div>';
  return h;
}

// Ward change — set bed label, toggle custom-ward input, render room
// pills. On a real change (not preserveAll modal-open) clear the bed and
// snap role/mrp/list/care to ward defaults.
function locWardChange(prefix, opts) {
  var X = prefix;
  var w = (document.getElementById(X + '-ward') || {}).value || '';
  var bedLbl = document.getElementById(X + '-bed-lbl');
  if (bedLbl) bedLbl.textContent = w === 'CCU' ? 'Bed #' : 'Room';
  var otherWrap = document.getElementById(X + '-ward-other-wrap');
  if (otherWrap) otherWrap.style.display = w === 'OTHER' ? 'block' : 'none';
  if (!opts || !opts.preserveAll) {
    var bedInp = document.getElementById(X + '-bed');
    if (bedInp) bedInp.value = '';
    // v4.39: Ward change no longer snaps role/mrp/list/care.
    // Users choose each independently; stranded-card safety net handles visibility.
  }
  renderRoomPills(w, X + '-bed', X + '-room-pills');
  locSyncListPills(X);
  locSyncRolePills(X);
  leUpdateRuleHint();
}

// MRP service change — v4.39: no longer snaps role or care.
// User sets role and care independently.
function locMrpChange(prefix) {
  var X = prefix;
  var mrpSel  = document.getElementById(X + '-mrp');
  var roleSel = document.getElementById(X + '-role');
  if (!mrpSel || !roleSel) return;
  // Only update role pill to match MRP (Cardiology = MRP, other = Consultant)
  if (mrpSel.value === 'Cardiology') {
    roleSel.value = 'mrp';
  } else {
    roleSel.value = 'consultant';
  }
  locSyncRolePills(X);
}

// Role pill — v4.39: toggling only updates MRP binding (MRP→Cardiology;
// Consulting→keep non-Cardiology, else Other). Care is NOT touched.
function locRolePill(prefix, val) {
  var X = prefix;
  var roleEl = document.getElementById(X + '-role');
  if (roleEl) roleEl.value = val;
  locSyncRolePills(X);
  // v4.43: clear validation amber if user selects a role after a failed submit
  var roleRow = document.getElementById(X + '-role-row');
  if (roleRow) roleRow.style.cssText = 'gap:8px;margin-top:4px';
  var mrpEl  = document.getElementById(X + '-mrp');
  if (val === 'mrp') {
    if (mrpEl)  mrpEl.value  = 'Cardiology';
  } else {
    if (mrpEl && mrpEl.value === 'Cardiology') mrpEl.value = 'Other';
  }
}

function locListPill(prefix, val) {
  var X = prefix;
  var listEl = document.getElementById(X + '-list');
  if (listEl) listEl.value = val;
  var pillOn  = document.getElementById(X + '-pill-on');
  var pillOff = document.getElementById(X + '-pill-off');
  if (pillOn)  pillOn.className  = 'ap-list-pill' + (val === 'on'  ? ' on' : '');
  if (pillOff) pillOff.className = 'ap-list-pill tone-amber' + (val === 'off' ? ' on' : '');
  // v4.43: clear validation amber if user selects after a failed submit
  var listRow = document.getElementById(X + '-list-row');
  if (listRow) listRow.style.cssText = 'gap:8px;margin-top:4px';
  leUpdateRuleHint();
}

function locSyncRolePills(prefix) {
  var X = prefix;
  // v4.43: removed || 'consultant' fallback — when the hidden value is
  // empty (requireChoice fresh form), both pills must stay unselected so
  // the user sees they need to make an active choice.
  var val = (document.getElementById(X + '-role') || {}).value;
  var mrp = document.getElementById(X + '-role-mrp');
  var con = document.getElementById(X + '-role-con');
  if (mrp) mrp.className = 'ap-list-pill' + (val === 'mrp'        ? ' on' : '');
  if (con) con.className = 'ap-list-pill' + (val === 'consultant' ? ' on' : '');
}

function locSyncListPills(prefix) {
  // v4.43: removed || 'on' fallback — locListPill writes the value back
  // to the hidden input, so the fallback was silently setting f-list='on'
  // whenever the form started empty (requireChoice). Now respects empty.
  var val = (document.getElementById(prefix + '-list') || {}).value;
  if (val) {
    locListPill(prefix, val);
  } else {
    // Both pills off, hidden value stays empty
    var pillOn  = document.getElementById(prefix + '-pill-on');
    var pillOff = document.getElementById(prefix + '-pill-off');
    if (pillOn)  pillOn.className  = 'ap-list-pill';
    if (pillOff) pillOff.className = 'ap-list-pill tone-amber';
  }
}

// Add a user-typed ward to WARDS + localStorage + every ward select on
// the page, then select it in the calling card.
function locSaveCustomWard(prefix) {
  var X = prefix;
  var name = ((document.getElementById(X + '-ward-other') || {}).value || '').trim();
  if (!name) { showToast('Enter a ward name'); return; }
  var key = name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8) || 'CUSTOM';
  if (WARDS[key]) key = key + '2';
  if (!WARDS[key]) {
    WARDS[key] = { label:name, list:'off', care:'directive', role:'consultant', rooms:[] };
    try {
      var cw = JSON.parse(localStorage.getItem('kgh5:customWards') || '[]');
      cw.push({ key:key, name:name });
      localStorage.setItem('kgh5:customWards', JSON.stringify(cw));
    } catch(e) {}
    ['f-ward','pe-ward','le-ward'].forEach(function(selId) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var otherOpt = sel.querySelector('option[value="OTHER"]');
      var newOpt = document.createElement('option');
      newOpt.value = key; newOpt.text = name;
      if (otherOpt) sel.insertBefore(newOpt, otherOpt);
      else sel.appendChild(newOpt);
    });
    showToast(name + ' added to ward list');
    if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL)
      push('logNewRoom', { ward:key, room:'(new ward)', doctor:st.doc||'' });
  }
  var wardSel = document.getElementById(X + '-ward');
  if (wardSel) { wardSel.value = key; locWardChange(X); }
  var otherWrap = document.getElementById(X + '-ward-other-wrap');
  if (otherWrap) otherWrap.style.display = 'none';
}

// ── Legacy name wrappers (Add Patient, prefix 'f') ─────
// Bidirectional MRP↔role rule; `list` is ward-driven (not touched here).
function mrpChange() { return locMrpChange('f'); }

function roleChange() {
  // v4.39: Only MRP binding, no care snap.
  var roleSel = document.getElementById('f-role');
  var mrpSel  = document.getElementById('f-mrp');
  if (!roleSel || !mrpSel) return;
  if (roleSel.value === 'mrp') {
    mrpSel.value = 'Cardiology';
  } else {
    if (mrpSel.value === 'Cardiology') mrpSel.value = 'Other';
  }
}

// ── Custom room persistence ────────────────────────────
function getSavedRooms(ward) {
  try {
    var raw = localStorage.getItem('kgh5:rooms:' + ward);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

// ── Grouped-room (subsection) persistence ──────────────
// For wards with roomGroups (e.g. ED), custom rooms are stored per
// subsection: kgh5:rooms:ED:C1 → ["5","12"]
function _getSavedSubRooms(ward, prefix) {
  try {
    var raw = localStorage.getItem('kgh5:rooms:' + ward + ':' + prefix);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}
function _saveSubRoom(ward, prefix, room, presetRooms) {
  room = String(room).trim();
  if (!room) return;
  if (presetRooms && presetRooms.indexOf(room) !== -1) return;
  var saved = _getSavedSubRooms(ward, prefix);
  if (saved.indexOf(room) !== -1) return;
  saved.push(room);
  try { localStorage.setItem('kgh5:rooms:' + ward + ':' + prefix, JSON.stringify(saved)); } catch(e) {}
}
function _getAllSubRooms(ward, group) {
  var preset = (group.rooms || []).slice();
  var saved  = _getSavedSubRooms(ward, group.prefix);
  saved.forEach(function(r) { if (preset.indexOf(r) === -1) preset.push(r); });
  return preset;
}
// Parse a composite value like "Trauma 2" → { groupIdx, prefix, room, presetRooms }
function _parseGroupedValue(wdef, val) {
  if (!val || !wdef.roomGroups) return { groupIdx:-1, prefix:'', room:'', presetRooms:[] };
  for (var i = 0; i < wdef.roomGroups.length; i++) {
    var g = wdef.roomGroups[i];
    if (val === g.prefix) return { groupIdx:i, prefix:g.prefix, room:'', presetRooms:g.rooms||[] };
    if (val.indexOf(g.prefix + ' ') === 0)
      return { groupIdx:i, prefix:g.prefix, room:val.slice(g.prefix.length + 1), presetRooms:g.rooms||[] };
  }
  return { groupIdx:-1, prefix:'', room:val, presetRooms:[] };
}

function saveCustomRoom(ward, room) {
  if (!ward || !room) return;
  room = String(room).trim();
  if (!room) return;
  var wdef = WARDS[ward] || {};

  // Grouped wards (e.g. ED): save the room part per subsection
  if (wdef.roomGroups && wdef.roomGroups.length) {
    var parsed = _parseGroupedValue(wdef, room);
    if (parsed.prefix && parsed.room) {
      _saveSubRoom(ward, parsed.prefix, parsed.room, parsed.presetRooms);
    }
    if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL)
      push('logNewRoom', { ward:ward, room:room, doctor:st.doc||'' });
    return;
  }

  var preset = wdef.rooms || [];
  if (preset.indexOf(room) !== -1) return; // already a preset, don't need to save
  var saved = getSavedRooms(ward);
  if (saved.indexOf(room) !== -1) return; // already saved
  saved.push(room);
  try { localStorage.setItem('kgh5:rooms:' + ward, JSON.stringify(saved)); } catch(e) {}
  // Log to backend learning database
  if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL)
    push('logNewRoom', { ward:ward, room:room, doctor:st.doc||'' });
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

// ── Room pills ─────────────────────────────────────────
// Renders a ward's preset (+ saved custom) rooms as tap pills, so the
// fixed 2S / 2W / CCU rooms are one tap. Wards with no preset rooms fall
// back to the plain text input. An "Other…" pill reveals the input for an
// off-list room. Shared by Add Patient (f-bed) and the location-change
// screen (loc-room). The text input always holds the value, so existing
// submit code (gv('f-bed') / gv('loc-room')) is unchanged.
//
// Two-level mode: wards with a `roomGroups` array (e.g. ED) render
// subsection pills first, then room pills for the selected subsection.
function renderRoomPills(ward, inputId, containerId) {
  var box = document.getElementById(containerId);
  var inp = document.getElementById(inputId);
  if (!box || !inp) return;

  var wdef = WARDS[ward] || {};

  // Two-level grouped pills (e.g. ED subsections)
  if (wdef.roomGroups && wdef.roomGroups.length) {
    _renderGroupedPills(ward, inputId, containerId);
    return;
  }

  var rooms = getBedRooms(ward);
  // Ward with no preset rooms — plain free-text entry, no pills.
  if (!rooms.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    inp.style.display = '';
    return;
  }
  box.style.display = 'flex';
  var cur     = String(inp.value || '').trim();
  var onList  = rooms.indexOf(cur) !== -1;
  var otherOn = !!cur && !onList;   // a value that isn't a preset/saved room
  var html = rooms.map(function(r) {
    return '<button type="button" class="room-pill' + (r === cur ? ' selected' : '') + '" ' +
           'data-room="' + esc(r) + '" ' +
           'onclick="pickRoomPill(this,\'' + inputId + '\',\'' + containerId + '\')">' +
           esc(r) + '</button>';
  }).join('');
  html += '<button type="button" class="room-pill room-pill-other' + (otherOn ? ' selected' : '') + '" ' +
          'onclick="pickRoomOther(\'' + inputId + '\',\'' + containerId + '\')">Other…</button>';
  box.innerHTML = html;
  // Text input is shown only in "Other" mode; otherwise the pills are the UI.
  inp.style.display = otherOn ? '' : 'none';
}

function pickRoomPill(btn, inputId, containerId) {
  var inp = document.getElementById(inputId);
  if (inp) { inp.value = btn.getAttribute('data-room'); inp.style.display = 'none'; }
  var box = document.getElementById(containerId);
  if (box) box.querySelectorAll('.room-pill').forEach(function(b) {
    b.classList.toggle('selected', b === btn);
  });
}

function pickRoomOther(inputId, containerId) {
  var box = document.getElementById(containerId);
  if (box) box.querySelectorAll('.room-pill').forEach(function(b) {
    b.classList.toggle('selected', b.classList.contains('room-pill-other'));
  });
  var inp = document.getElementById(inputId);
  if (inp) { inp.value = ''; inp.style.display = ''; inp.focus(); }
}

// ── Two-level grouped pills (ED subsections) ───────────
// Level 1: subsection pills (Trauma, Main, BCAS, …)
// Level 2: room pills for the active subsection (1, 2, 3, Other…)
// Tapping a subsection sets the value to the prefix ("Trauma").
// Tapping a room refines it ("Trauma 2"). Custom rooms learn per subsection.
// Colour: active subsection = green; level-2 pills = green (same tint,
// showing "pick one of these"); selected room = solid green to confirm.
var _GP_SEL  = 'background:var(--green-bg);border-color:var(--green);color:var(--green-t)';
var _GP_ROOM = 'background:var(--green-bg);border-color:var(--green);color:var(--green-t)';
var _GP_PICK = 'background:var(--green);border-color:var(--green);color:#fff';

function _renderGroupedPills(ward, inputId, containerId) {
  var box  = document.getElementById(containerId);
  var inp  = document.getElementById(inputId);
  var wdef = WARDS[ward] || {};
  var groups = wdef.roomGroups;
  var cur  = String(inp.value || '').trim();
  var parsed = _parseGroupedValue(wdef, cur);
  var activeIdx = parsed.groupIdx;

  box.style.display = 'block';

  // ── Level 1: subsection pills ──
  var html = '<div class="room-pills">';
  for (var j = 0; j < groups.length; j++) {
    var isSel = (j === activeIdx);
    html += '<button type="button" class="room-pill' +
            (isSel ? ' selected' : '') +
            '" style="font-weight:700;min-width:50px' +
            (isSel ? ';' + _GP_SEL : '') + '" ' +
            'onclick="_pickSubsection(' + j + ',\'' + esc(ward) + '\',\'' +
            inputId + '\',\'' + containerId + '\')">' +
            esc(groups[j].label) + '</button>';
  }
  html += '</div>';

  // ── Level 2: room pills for active subsection ──
  if (activeIdx >= 0) {
    var g = groups[activeIdx];
    var subRooms = _getAllSubRooms(ward, g);
    var activeRoom = parsed.room;

    html += '<div class="room-pills" style="margin-top:6px;padding-left:2px">';

    subRooms.forEach(function(r) {
      var isSel = (r === activeRoom);
      html += '<button type="button" class="room-pill' +
              (isSel ? ' selected' : '') + '" ' +
              'style="' + (isSel ? _GP_PICK : _GP_ROOM) + '" ' +
              'onclick="_pickSubRoom(' + activeIdx + ',\'' + esc(r) +
              '\',\'' + esc(ward) + '\',\'' + inputId + '\',\'' + containerId + '\')">' +
              esc(r) + '</button>';
    });

    // "Other…" for typing a custom room (always shown for learning)
    var otherOn = !!activeRoom && subRooms.indexOf(activeRoom) === -1;
    html += '<button type="button" class="room-pill room-pill-other' +
            (otherOn ? ' selected' : '') + '" ' +
            'style="' + (otherOn ? _GP_PICK : _GP_ROOM) + '" ' +
            'onclick="_pickSubRoomOther(' + activeIdx + ',\'' + esc(ward) +
            '\',\'' + inputId + '\',\'' + containerId + '\')">Other…</button>';
    html += '</div>';

    // Show text input only when "Other…" is active
    inp.style.display = otherOn ? '' : 'none';
  } else {
    inp.style.display = 'none';
  }

  box.innerHTML = html;
}

// Tap a subsection pill → set value to prefix, show level 2
function _pickSubsection(groupIdx, ward, inputId, containerId) {
  var wdef = WARDS[ward] || {};
  var g = (wdef.roomGroups || [])[groupIdx];
  if (!g) return;
  var inp = document.getElementById(inputId);
  if (inp) inp.value = g.prefix;
  _renderGroupedPills(ward, inputId, containerId);
}

// Tap a room pill in level 2 → set value to "prefix room"
function _pickSubRoom(groupIdx, room, ward, inputId, containerId) {
  var wdef = WARDS[ward] || {};
  var g = (wdef.roomGroups || [])[groupIdx];
  if (!g) return;
  var inp = document.getElementById(inputId);
  if (inp) { inp.value = g.prefix + ' ' + room; inp.style.display = 'none'; }
  _renderGroupedPills(ward, inputId, containerId);
}

// Tap "Other…" in level 2 → show text input for typing a custom room.
// On blur, the typed value is prepended with the prefix.
function _pickSubRoomOther(groupIdx, ward, inputId, containerId) {
  var wdef = WARDS[ward] || {};
  var g = (wdef.roomGroups || [])[groupIdx];
  if (!g) return;
  var inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = '';
  inp.style.display = '';
  inp.placeholder = g.prefix + ' bed #';
  inp.focus();
  // On blur: prepend prefix if user typed a bare number/letter
  inp._grpBlur = function() {
    var v = String(inp.value || '').trim();
    if (!v) { inp.value = g.prefix; }
    else if (v.indexOf(g.prefix) !== 0) { inp.value = g.prefix + ' ' + v; }
    inp.removeEventListener('blur', inp._grpBlur);
    inp._grpBlur = null;
    _renderGroupedPills(ward, inputId, containerId);
  };
  inp.addEventListener('blur', inp._grpBlur);
}

// v4.39: applyWardDefaults removed — fields are independent.
// Function kept as no-op in case any code path still references it.
function applyWardDefaults(ward, ids) { /* no-op */ }

function wardChange(opts) { return locWardChange('f', opts); }
function saveCustomWard()  { return locSaveCustomWard('f'); }


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
  // hideLoc:true — billing-loc pills above the submit buttons handle
  // the service location; the oc-loc dropdown is redundant here.
  return buildOtherClaimForm({}, { withSubmit: false, hideLoc: true });
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

// ── Billing location pills (I/P/Q) ──────────────────────
// Controls the MSP service-location code on all Add Patient claim types.
// Default is 'I' (Inpatient). The pills live in the template HTML below
// the submit buttons. The selected value is read in apSubmit() and passed
// to each claim-creation function.
function apBillingLocPill(code) {
  var el = document.getElementById('f-billing-loc');
  if (el) el.value = code;
  ['I','P','Q'].forEach(function(c) {
    var btn = document.getElementById('ap-bloc-' + c);
    if (btn) btn.className = 'ap-list-pill' + (c === code ? ' on' : '');
  });
}

// ── Out of Province (OOP) toggle + province handling ──────────────
function apToggleOOP() {
  var on = !!((document.getElementById('f-oop') || {}).checked);
  var box = document.getElementById('f-oop-fields');
  if (box) box.style.display = on ? 'block' : 'none';
  // v2.30: PHN (BC number) is optional when OOP — reflect that in the field.
  var phnEl = document.getElementById('f-phn');
  if (phnEl) phnEl.placeholder = on ? 'Optional for OOP — enter if BC number assigned' : '10 digits';
  if (!on) {
    // collapse → clear so a hidden OOP block never submits stale data
    ['f-home-province','f-home-hcn','f-home-address'].forEach(function(id) {
      var el = document.getElementById(id); if (el) { el.value = ''; el.style.cssText = ''; }
    });
    var qc = document.getElementById('f-qc-warn'); if (qc) qc.style.display = 'none';
  } else {
    var _priv = document.getElementById('f-private');
    if (_priv && _priv.checked) { _priv.checked = false; if (typeof apTogglePrivate === 'function') apTogglePrivate(); }
    apProvinceChange();
  }
}
function apProvinceChange() {
  var v = (document.getElementById('f-home-province') || {}).value || '';
  var qc = document.getElementById('f-qc-warn');
  if (qc) qc.style.display = (v === 'QC') ? 'block' : 'none';
}
// ── Private Pay toggle + rate selector ────────────────────────────
function apTogglePrivate() {
  var on = !!((document.getElementById('f-private') || {}).checked);
  var box = document.getElementById('f-private-fields');
  if (box) box.style.display = on ? 'block' : 'none';
  if (on) {
    // Private pay and Out-of-Province are mutually exclusive categories.
    var oop = document.getElementById('f-oop');
    if (oop && oop.checked) { oop.checked = false; if (typeof apToggleOOP === 'function') apToggleOOP(); }
    apPrivateRate((document.getElementById('f-private-rate') || {}).value || 'BCMA');
  } else {
    var rm = document.getElementById('f-private-rate'); if (rm) rm.value = 'BCMA';
    apPrivateRate('BCMA');
  }
}
function apPrivateRate(mode) {
  mode = (mode === 'MSP') ? 'MSP' : 'BCMA';
  var hid = document.getElementById('f-private-rate'); if (hid) hid.value = mode;
  var b = document.getElementById('f-private-rate-bcma');
  var m = document.getElementById('f-private-rate-msp');
  if (b) b.className = 'ap-list-pill' + (mode === 'BCMA' ? ' on' : '');
  if (m) m.className = 'ap-list-pill' + (mode === 'MSP' ? ' on' : '');
}

function peSexPill(val) {
  var hid = document.getElementById('pe-sex');
  if (hid) hid.value = val;
  var m = document.getElementById('pe-sex-m');
  var f = document.getElementById('pe-sex-f');
  if (m) m.className = 'ap-list-pill' + (val === 'M' ? ' on' : '');
  if (f) f.className = 'ap-list-pill' + (val === 'F' ? ' on' : '');
}

// ── Legacy pill wrappers (Add Patient, prefix 'f') ─────
function apListPill(val)    { return locListPill('f', val); }
function apRolePill(val)    { return locRolePill('f', val); }
function syncApRolePills()  { return locSyncRolePills('f'); }
function syncApListPills()  { locSyncListPills('f'); locSyncRolePills('f'); }

async function apSubmit(addToList, _skipDupCheck) {
  // v4.26: Submit overlay — reuse the same guard and overlay as claimSubmitOnce
  if (_submitGuard) return;
  window._apPendingAddToList = addToList;
  var last = (document.getElementById('f-last') || {}).value || '';
  var phn  = gv('f-phn');

  // v4.12: empty Last name no longer short-circuits the function. It used to
  // — but the early return prevented the PHN red-flag guard from running, so
  // a partial PHN went un-flagged whenever Last name was also blank.
  // Empty last is now treated as a missing-field (amber, in the aggregation
  // below alongside other blank-required fields). The OCR misread guards
  // below only fire when last has actual content.

  // v4.09/v4.10: Sticker-OCR sometimes misreads adjacent characters as the
  // surname. The most common misreads we've seen:
  //   v4.09: a printed number ends up in the last-name slot. Deborah
  //          Malone, age 57, was saved as last="57" because the Vision
  //          model picked her age off the sticker. Blocked by the all-
  //          digits / too-short / age-match checks below.
  //   v4.10: punctuation from an adjacent field (most often a location
  //          token like "KGHS0221-A" or "KGH/Bed/12") bleeds into the
  //          last-name slot. Slashes never appear in real surnames.
  // Each check has a specific toast so the doctor knows what to look at
  // on the sticker. Real legitimate-but-numeric-looking surnames like
  // "Smith the 3" (mixed letters + digits) are intentionally still allowed.
  // v4.12: the whole guard is wrapped in `if (_lastTrim)` so blank last
  // doesn't accidentally trip the "too short" branch with the OCR message.
  var _lastTrim = String(last).trim();
  if (_lastTrim) {
    var _lastErr  = null;
    if (/^\d+$/.test(_lastTrim)) {
      _lastErr = 'Last name "' + _lastTrim + '" is all digits \u2014 OCR likely misread the sticker. Tap Last name and correct it.';
    } else if (_lastTrim.length < 2) {
      _lastErr = 'Last name "' + _lastTrim + '" is too short \u2014 check the sticker and re-enter.';
    } else if (/[\/\\]/.test(_lastTrim)) {
      _lastErr = 'Last name "' + _lastTrim + '" contains a slash \u2014 OCR likely picked up an adjacent field. Correct the last name.';
    } else {
      // Age match check — only fires when DOB is filled and parses cleanly.
      var _dobRaw = gv('f-dob');
      if (_dobRaw) {
        var _dobIso  = fmtClaimDate(_dobRaw); // DD/MM/YYYY
        var _parts   = String(_dobIso).split('/');
        if (_parts.length === 3) {
          var _dobMs = new Date(parseInt(_parts[2], 10), parseInt(_parts[1], 10) - 1, parseInt(_parts[0], 10)).getTime();
          if (_dobMs && !isNaN(_dobMs)) {
            var _ageYears = Math.floor((Date.now() - _dobMs) / (1000 * 60 * 60 * 24 * 365.25));
            if (_ageYears > 0 && _ageYears < 130 && String(_ageYears) === _lastTrim) {
              _lastErr = 'Last name "' + _lastTrim + '" matches the patient\u2019s age \u2014 OCR likely picked the age off the sticker. Correct the last name.';
            }
          }
        }
      }
    }
    if (_lastErr) {
      var _lastEl = document.getElementById('f-last');
      if (_lastEl) {
        _lastEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
        _lastEl.focus();
        _lastEl.select && _lastEl.select();
      }
      showToast(_lastErr);
      return;
    }
  }

  // v4.11: PHN wrong-length guard with red treatment. A 10-digit PHN that
  // came back N≠10 digits is almost always OCR truncating or dropping a
  // digit — the user can't have typed exactly 9 by hand, but OCR returns
  // that all the time. Distinct from blank PHN, which gets the amber
  // missing-field treatment below alongside other blank-required fields.
  // Red border + red toast + 3.5s dwell so the digit count is readable.
  // Restores the red flag that lived in v3.75 and was downgraded to amber
  // during the v4.x refactors.
  if (phn) {
    var _phnDigits = String(phn).replace(/\D/g,'').length;
    if (_phnDigits !== 10) {
      var _phnEl = document.getElementById('f-phn');
      if (_phnEl) {
        _phnEl.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)';
        _phnEl.focus();
        _phnEl.select && _phnEl.select();
      }
      showToast('PHN is ' + _phnDigits + ' digit' + (_phnDigits === 1 ? '' : 's') +
                ' \u2014 must be 10. OCR likely misread \u2014 check the sticker.', 'error');
      return;
    }
    // v4.44: MOD 11 check digit hard guard — catches single-digit OCR errors
    if (!isValidPHN(phn)) {
      var _phnEl2 = document.getElementById('f-phn');
      if (_phnEl2) {
        _phnEl2.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)';
        _phnEl2.focus();
        _phnEl2.select && _phnEl2.select();
      }
      _phnErr('PHN check digit invalid \u2014 a digit is likely wrong. Verify against the sticker.');
      return;
    }
  }

  // Diagnosis / referring MD — every claim form now uses the unified
  // cb-* / oc-* ids.
  // Future-DOB guard (manual Add path): a DOB later than today is always a
  // typo / wrong year. The OCR path has its own check (v4.20); this covers
  // hand entry, which previously slipped through to save.
  var _dobFut = gv('f-dob');
  if (_dobFut) {
    var _dobFutMs = parseDMYsafe(fmtClaimDate(_dobFut));
    if (_dobFutMs && _dobFutMs > Date.now()) {
      var _dobFutEl = document.getElementById('f-dob');
      if (_dobFutEl) { _dobFutEl.style.cssText = 'border:1.5px solid var(--red-t);background:var(--red-bg)'; _dobFutEl.focus(); }
      showToast('Date of birth is in the future — check the year.', 'error');
      return;
    }
  }

  var icd = gv('cb-icd') || gv('oc-icd') || '';

  // Validate required fields. PHN wrong-length is handled above as its own
  // red-flag guard; here we only handle PHN missing (amber, alongside the
  // other blank-required fields). v4.12: blank Last name also lands here
  // (it used to short-circuit before any other validation could run).
  // v2.30: OOP makes the BC PHN optional (patient may have no BC-assigned
  // number). Submission is allowed without PHN provided home province +
  // home HCN are supplied (enforced in the OOP block below). Any PHN that
  // IS entered still passes the 10-digit + MOD-11 guards above.
  var _oop     = !!((document.getElementById('f-oop') || {}).checked);
  var _oopProv = gv('f-home-province');

  var addMissing = [];
  if (!_lastTrim)                              addMissing.push('last name');
  if (!phn && !_oop)                           addMissing.push('phn');
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

  // v4.11 NEW: When adding to the rounds list, the location card must be
  // fully filled in. Users have been skipping ward/role/list and landing on
  // defaults — patients then end up on the wrong list or invisible. The
  // submit-claim-only path is unaffected (those patients don't go on a
  // rounds list at all).
  if (addToList) {
    if (!gv('f-ward')) addMissing.push('location');
    if (!gv('f-role')) addMissing.push('role');
    if (!gv('f-list')) addMissing.push('list');
  }

  // ── Out of Province required fields (hard-stop on Add Patient) ─────
  // OOP needs home province + home address to bill the reciprocal claim
  // (or invoice Quebec directly). Home health number is required for the
  // reciprocal MSP submission but NOT for Quebec (invoiced directly).
  // (_oop / _oopProv are declared in 3a above.)
  if (_oop) {
    if (!_oopProv)             addMissing.push('home province');
    if (!gv('f-home-address')) addMissing.push('home address');
    // Non-QC needs the home-province HCN for the reciprocal MSP claim.
    // QC is invoiced directly (MSP-value invoice) — needs at least ONE
    // identifier: a BC PHN OR the home health number.
    if (_oopProv === 'QC') {
      if (!phn && !gv('f-home-hcn')) addMissing.push('home health number');
    } else if (!gv('f-home-hcn')) {
      addMissing.push('home health number');
    }
  }

  if (addMissing.length) {
    if (addMissing.indexOf('last name') !== -1) {
      var lastBlankEl = document.getElementById('f-last');
      if (lastBlankEl) { lastBlankEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; lastBlankEl.focus(); }
    }
    if (addMissing.indexOf('phn') !== -1) {
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
    // v4.11: highlight the location card fields when missing for add-to-list.
    if (addMissing.indexOf('location') !== -1) {
      var wardEl = document.getElementById('f-ward');
      if (wardEl) { wardEl.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; wardEl.focus(); }
    }
    if (addMissing.indexOf('role') !== -1) {
      var roleRow = document.getElementById('f-role-row');
      if (roleRow) { roleRow.style.cssText = 'gap:8px;margin-top:4px;border:1.5px solid var(--amber-t);background:var(--amber-bg);border-radius:var(--r);padding:4px'; }
    }
    if (addMissing.indexOf('list') !== -1) {
      var listRow = document.getElementById('f-list-row');
      if (listRow) { listRow.style.cssText = 'gap:8px;margin-top:4px;border:1.5px solid var(--amber-t);background:var(--amber-bg);border-radius:var(--r);padding:4px'; }
    }
    if (_oop) {
      [['home province','f-home-province'],
       ['home health number','f-home-hcn'],
       ['home address','f-home-address']].forEach(function(pair) {
        if (addMissing.indexOf(pair[0]) !== -1) {
          var el = document.getElementById(pair[1]);
          if (el) { el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)'; }
        }
      });
    }
    var msgs = [];
    if (addMissing.indexOf('last name')  !== -1) msgs.push('last name');
    if (addMissing.indexOf('phn')        !== -1) msgs.push('PHN');
    if (addMissing.indexOf('refby')      !== -1) msgs.push('referring MD');
    if (addMissing.indexOf('icd')        !== -1) msgs.push('diagnosis');
    if (addMissing.indexOf('fee')        !== -1) msgs.push('fee code');
    if (addMissing.indexOf('date')       !== -1) msgs.push('date');
    if (addMissing.indexOf('start time') !== -1) msgs.push('start time');
    if (addMissing.indexOf('end time')   !== -1) msgs.push('end time');
    if (addMissing.indexOf('location')   !== -1) msgs.push('location');
    if (addMissing.indexOf('role')       !== -1) msgs.push('Cardiology role');
    if (addMissing.indexOf('list')       !== -1) msgs.push('On/Off service');
    if (addMissing.indexOf('home province')      !== -1) msgs.push('home province');
    if (addMissing.indexOf('home health number') !== -1) msgs.push('home health number');
    if (addMissing.indexOf('home address')        !== -1) msgs.push('home address');
    showToast('Required: ' + msgs.join(', '));
    return;
  }

  // v4.46: Guard + overlay BEFORE async dup check — instant feedback,
  // prevents double-tap during the network round-trip.
  _submitGuard = true;
  _showSubmitOverlay();

  // ── Duplicate check — 2-of-3 match → merge or create new ────────
  // Fields: PHN (exact), last name (case-insensitive), DOB (formatted).
  // Checks local st.patients first (instant), then all patients via
  // listPatients (catches long-discharged + PhoneConsult stubs).
  if (!_skipDupCheck) {
    var chkPhn  = String(phn || '').replace(/\D/g,'');
    var chkLast = String(last || '').trim().toLowerCase();
    var chkDob  = fmtClaimDate(gv('f-dob') || '');

    // 1. Local check (instant — active + recently discharged patients)
    var dupResult = _findDup2of3(st.patients, chkPhn, chkLast, chkDob);

    // 2. If no local match, check ALL patients via server
    if (!dupResult.match && SHEETS_URL && (chkPhn || chkLast)) {
      try {
        var _dupResp = await fetch(SHEETS_URL + '?action=listPatients&key=' + SHARED_KEY + '&_t=' + Date.now());
        if (_dupResp.ok) {
          var _allPats = await _dupResp.json();
          if (Array.isArray(_allPats)) {
            dupResult = _findDup2of3(_allPats, chkPhn, chkLast, chkDob);
          }
        }
      } catch(_dupErr) {
        console.warn('[dup-check] server check failed, proceeding with local only', _dupErr);
      }
    }

    if (dupResult.match) {
      var _newData = {
        last:  fmtName(last),
        first: fmtName(gv('f-first')),
        phn:   chkPhn,
        dob:   chkDob,
        sex:   gv('f-sex')
      };
      openDuplicateMergeModal(dupResult.match, dupResult.fields, _newData);
      _hideSubmitOverlay();
      return;
    }
  }

  var p = {
    id: 'p' + Date.now(), fac: 'OA040', roundedToday: null,
    last: fmtName(last), first: fmtName(gv('f-first')),
    phn: phn, dob: fmtClaimDate(gv('f-dob')), sex: gv('f-sex'),
    refby:     gv('cb-refby') || gv('oc-refby'),
    refbyName: gv('cb-refby-name') || gv('oc-refby-name'),
    icd: icd,
    createdBy: (st.doc && st.doc.alias) || '',
    createdAt: Date.now()
  };

  // v2.30: Out of Province billing fields (only when ticked).
  if (_oop) {
    p.oop          = true;
    p.homeProvince = _oopProv;
    p.homeHCN      = gv('f-home-hcn');
    p.homeAddress  = gv('f-home-address');
  }
  // Private Pay billing (mutually exclusive with OOP). rateMode default BCMA.
  if ((document.getElementById('f-private') || {}).checked) {
    p.privatePay = true;
    p.rateMode   = gv('f-private-rate') || 'BCMA';
  }

  if (addToList) {
    var ward = gv('f-ward') || 'OTHER';
    p.ward  = ward;
    p.bed   = gv('f-bed')  || '';
    p.role  = gv('f-role') || 'consultant';
    p.mrp   = gv('f-mrp')  || 'Other';
    p.list  = gv('f-list') || 'on';
    p.care  = gv('f-care') || 'directive';
    if (p.ward && p.bed) saveCustomRoom(p.ward, p.bed);
    // v4.37: Auto-flag for handover when patient added after 17:00
    if (new Date().getHours() >= 17) p.handover = 'new';
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

  // v4.46: Guard + overlay already shown before dup check (see above).

  if (SHEETS_URL) {
    var ok = await push('savePatient', p);
    if (!ok) {
      st.patients = st.patients.filter(function(x) { return x.id !== p.id; });
      sv('patients', st.patients);
      showToast(window._lastPushError
        ? 'Not saved: ' + window._lastPushError
        : 'Could not save patient — check wifi and try again');
      _hideSubmitOverlay();
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

    // v4.19: billing location from the pills (I/P/Q), default 'I'.
    var billingLoc = (document.getElementById('f-billing-loc') || {}).value || 'I';

    if (_apClaimType === 'consult') {
      // Unified shared submit — reads the cb-* consult form, runs CCFPP,
      // and creates the consult + MOST + modifier claims.
      submitConsultClaims(p, cAlias, billingLoc);
    } else if (_apClaimType === 'ccu-admit') {
      var caDateISO = (document.getElementById('ap-ca-date')  || {}).value || '';
      var caNotes   = (document.getElementById('ap-ca-notes') || {}).value || '';
      if (caDateISO) {
        var caDateFmt = fmtD(parseISODate(caDateISO));
        addClaim(p, '1411', '1411', 1, caDateFmt, billingLoc, null, caNotes, null, cAlias);
        sv('claims', st.claims);
      }
    } else if (_apClaimType === 'other') {
      // Sync the Other Claim form's oc-loc to match the billing location pills.
      var ocLocEl = document.getElementById('oc-loc');
      if (ocLocEl) ocLocEl.value = billingLoc;
      // Unified shared submit — reads the oc-* form, validates 33005,
      // and creates the single claim.
      submitOtherClaimFor(p, cAlias);
    }
  }

  var listLabel = addToList ? (p.list === 'on' ? 'On' : 'Off') + ' Service' : 'claim only';
  showToast(last + ' added — ' + listLabel);
  _hideSubmitOverlay();
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



// v4.13: Real-time OCR-error flagging for the PHN and Last name fields.
// Fires on every keystroke (via oninput on the static inputs) and once
// explicitly after OCR fills the fields. Red = a definite OCR error the
// doctor should look at immediately, BEFORE submitting:
//   - PHN with content but not exactly 10 digits (OCR truncated/dropped)
//   - Last name that is all digits (age/room picked off the sticker)
//   - Last name containing a slash (adjacent field bled in)
// Empty fields are NOT flagged (nothing typed yet is not an error). The
// flag clears itself the moment the field becomes valid. This is purely
// visual; the apSubmit guards remain as the hard backstop.
var _LIVE_RED = 'border:1.5px solid var(--red-t);background:var(--red-bg)';

// v4.44: BC PHN MOD 11 check digit validation.
// BC PHNs are 10 digits, always start with 9. Digit 10 is a check digit
// derived from digits 2-9 using weights [2,4,8,5,10,9,7,3] and MOD 11.
// Source: BC Professional and Software Conformance Standards, Vol 4B §1.3.
// Catches single-digit OCR errors instantly with no server call.
function isValidPHN(phn) {
  var d = String(phn).replace(/\D/g, '');
  if (d.length !== 10 || d[0] !== '9') return false;
  var w = [2, 4, 8, 5, 10, 9, 7, 3];
  var sum = 0;
  for (var i = 0; i < 8; i++) sum += (parseInt(d[i + 1], 10) * w[i]) % 11;
  var chk = 11 - (sum % 11);
  return chk < 10 && chk === parseInt(d[9], 10);
}

// PHN single-swap repair. When MOD-11 fails, try ONE common OCR digit
// confusion at ONE position and re-check MOD-11. Returns the corrected PHN
// only if EXACTLY ONE candidate passes — zero or >=2 are ambiguous and fall
// through to the red/manual path (never auto-suggest a guess).
// Pairs are frequency-ordered from observed OCR Corrections (3<->8 dominant);
// widen this set only when the corrections log justifies it.
var _PHN_CONFUSIONS = [['3', '8'], ['9', '3'], ['6', '8']];
function repairPHN(phn) {
  var d = String(phn).replace(/\D/g, '');
  if (d.length !== 10) return null;
  var hits = [];
  for (var i = 0; i < 10; i++) {
    for (var p = 0; p < _PHN_CONFUSIONS.length; p++) {
      var a = _PHN_CONFUSIONS[p][0], b = _PHN_CONFUSIONS[p][1];
      var sub = null;
      if (d[i] === a) sub = b;
      else if (d[i] === b) sub = a;
      if (sub === null) continue;
      var cand = d.slice(0, i) + sub + d.slice(i + 1);
      if (isValidPHN(cand) && hits.indexOf(cand) === -1) hits.push(cand);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

// Apply an amber-confirmed PHN correction: write it into the field and
// re-run live validation so the corrected value flows through the normal
// valid path (clears styling, runs the duplicate check).
function _phnApplyFix(corrected) {
  var el = document.getElementById('f-phn');
  if (!el) return;
  el.value = corrected;
  validatePhnLive();
}

function _liveClear(el) {
  // Only clear styling we applied — leave the field's default look.
  if (el) el.style.cssText = '';
}

// v4.44: Show/hide persistent error message below PHN field
function _phnErr(msg) {
  var div = document.getElementById('phn-chk-err');
  if (!div) return;
  // Restore red styling (a prior correction banner may have set it amber).
  div.style.background = 'var(--red-bg)';
  div.style.borderColor = 'var(--red-t)';
  div.style.color = 'var(--red-t)';
  if (msg) { div.textContent = msg; div.style.display = ''; }
  else     { div.textContent = '';  div.style.display = 'none'; }
}

function validatePhnLive() {
  var el = document.getElementById('f-phn');
  if (!el) return;
  var digits = String(el.value || '').replace(/\D/g,'');
  if (digits.length > 0 && digits.length !== 10) {
    el.style.cssText = _LIVE_RED;
    _phnErr('PHN is ' + digits.length + ' digit' + (digits.length === 1 ? '' : 's') + ' \u2014 must be 10');
    return;
  }
  // v4.44: MOD 11 check digit validation when PHN is 10 digits
  if (digits.length === 10) {
    if (!isValidPHN(digits)) {
      var fixed = repairPHN(digits);
      if (fixed) {
        // Exactly one single-swap candidate passes MOD-11 — offer it amber.
        // Highlight the changed digit; require a tap to accept (never auto-apply).
        el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
        var diffIdx = -1;
        for (var _k = 0; _k < 10; _k++) { if (digits[_k] !== fixed[_k]) { diffIdx = _k; break; } }
        var pretty = fixed.slice(0, diffIdx) + '<b style="color:var(--amber-t)">' + fixed[diffIdx] + '</b>' + fixed.slice(diffIdx + 1);
        var div = document.getElementById('phn-chk-err');
        if (div) {
          // Recolor the banner amber (the div defaults to red for errors).
          div.style.background = 'var(--amber-bg)';
          div.style.borderColor = 'var(--amber-t)';
          div.style.color = 'var(--amber-t)';
          div.innerHTML = 'PHN corrected to ' + pretty +
            ' <button type="button" class="btn btn-s" style="margin:0 0 0 6px;padding:2px 8px" ' +
            'onclick="_phnApplyFix(\'' + fixed + '\')">Click to confirm</button>';
          div.style.display = '';
        }
        return;
      }
      // Zero or >=2 candidates — ambiguous. Red, manual fix.
      el.style.cssText = _LIVE_RED;
      _phnErr('PHN check digit invalid \u2014 a digit is likely wrong. Verify against the sticker.');
      return;
    }
    _liveClear(el);
    _phnErr(null);
    // Existing patient check — local first, then server
    var localMatch = (st.patients || []).filter(function(x) {
      return x && String(x.phn || '').replace(/\D/g, '').slice(0, 10) === digits;
    })[0];
    if (localMatch) {
      showExistingPatientBanner(localMatch);
      return;
    }
    // Server check (catches long-discharged + PhoneConsult stubs)
    if (SHEETS_URL && !window._phnLiveCheckInFlight) {
      window._phnLiveCheckInFlight = digits;
      fetch(SHEETS_URL + '?action=listPatients&key=' + SHARED_KEY + '&_t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(all) {
          var cur = String((document.getElementById('f-phn') || {}).value || '').replace(/\D/g, '');
          if (cur !== window._phnLiveCheckInFlight) return;
          if (!Array.isArray(all)) return;
          var match = all.filter(function(x) {
            return x && String(x.phn || '').replace(/\D/g, '').slice(0, 10) === cur;
          })[0];
          if (match) showExistingPatientBanner(match);
        })
        .catch(function() {})
        .finally(function() { window._phnLiveCheckInFlight = null; });
    }
  } else {
    _liveClear(el);
    _phnErr(null);
    dismissExistingPatientBanner();
  }
}

function validateLastLive() {
  var el = document.getElementById('f-last');
  if (!el) return;
  var v = String(el.value || '').trim();
  // Flag definite OCR errors: all-digits or contains a slash. A single
  // stray character ("X") or generational suffix ("Smith the 3") is not
  // flagged live — those are caught at submit if truly wrong.
  if (v.length > 0 && (/^\d+$/.test(v) || /[\/\\]/.test(v))) {
    el.style.cssText = _LIVE_RED;
  } else {
    _liveClear(el);
  }
}

// Called by handleOCRResult after it sets field values (setting .value
// programmatically does not fire the oninput handlers).
function validatePatientFieldsLive() {
  validatePhnLive();
  validateLastLive();
}

function clearAddForm() {
  // v4.33: Cancel any in-flight OCR background loop and unlock fields.
  _ocrGeneration++;
  _unlockDemoFields();

  ['f-last','f-first','f-phn','f-dob'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.value = '';
      // v4.11: clear any leftover red/amber validation styling so the field
      // returns to its normal appearance for the next patient.
      el.style.cssText = '';
    }
  });
  _phnErr(null); // v4.44: clear check digit error
  var sx = document.getElementById('f-sex'); if (sx) sx.value = '';
  var sxm = document.getElementById('f-sex-m'); if (sxm) sxm.className = 'ap-list-pill';
  var sxf = document.getElementById('f-sex-f'); if (sxf) sxf.className = 'ap-list-pill';
  // v2.30: reset Out of Province tick box + collapse/clear its fields.
  var oopCb = document.getElementById('f-oop'); if (oopCb) oopCb.checked = false;
  if (typeof apToggleOOP === 'function') apToggleOOP();
  var privCb = document.getElementById('f-private'); if (privCb) privCb.checked = false;
  if (typeof apTogglePrivate === 'function') apTogglePrivate();
  // v4.19: reset billing location pills to Inpatient default.
  apBillingLocPill('I');
  var ocr = document.getElementById('ocr-bar'); if (ocr) ocr.style.display = 'none';
  // v4.11: rebuild the Location & list card in fresh unselected state — no
  // ward, no role, no list. Otherwise the next Add Patient inherits the last
  // patient's location card values, defeating the add-to-list guard.
  var apLocHost = document.getElementById('ap-loc-host');
  if (apLocHost) {
    apLocHost.innerHTML = buildLocationCard('f', null, true);
  }
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
  dismissExistingPatientBanner();
  var pz = document.getElementById('photo-zone');
  pz.style.padding = '';
  pz.innerHTML =
    '<div class="pz-btns">' +
      '<button class="pz-btn" onclick="event.stopPropagation();document.getElementById(\'f-photo-cam\').click()">' +
        '<svg style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.5" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
        'Take Photo' +
      '</button>' +
      '<button class="pz-btn" onclick="event.stopPropagation();document.getElementById(\'f-photo-gal\').click()">' +
        '<svg style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
        'Choose Photo' +
      '</button>' +
    '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Auto-fills name, PHN, DOB, ward, room</span>';
}
// ── Sticker / Meditech photo capture → crop → OCR ──
// _cropPending holds: { dataUrl, mode, callback }
//   mode = 'sticker' | 'meditech'
//   callback receives the cropped JPEG dataUrl
var _cropPending = null;
var _cropState = null;

// ── OCR background retry state ─────────────────────────────────────
// Generation counter: each new photo bumps it. The background retry loop
// checks its own generation against the current one — if they differ
// (doctor cleared the form or took a new photo), the loop self-cancels.
var _ocrGeneration = 0;
var _ocrInFlight   = false;

// Lock the demographic fields (name/PHN/DOB/sex) while OCR works in the
// background. Doctor can fill diagnosis, referring MD, location, claim
// type immediately — only these auto-extracted fields are held.
function _lockDemoFields() {
  _ocrInFlight = true;
  ['f-last', 'f-first', 'f-phn', 'f-dob'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.disabled = true;
      el.dataset.ocrLocked = '1';
      el.placeholder = 'Extracting…';
      el.style.cssText = 'background:var(--surface2);color:var(--text3);border:.5px solid var(--border);';
    }
  });
  ['f-sex-m', 'f-sex-f'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
  });
}

// Unlock the demographic fields — called on OCR success OR timeout.
function _unlockDemoFields() {
  _ocrInFlight = false;
  ['f-last', 'f-first', 'f-phn', 'f-dob'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.disabled = false;
      delete el.dataset.ocrLocked;
      el.style.cssText = '';
    }
  });
  // Restore default placeholders
  var phEl = document.getElementById('f-phn');
  if (phEl) phEl.placeholder = '10 digits';
  var dbEl = document.getElementById('f-dob');
  if (dbEl) dbEl.placeholder = 'DD/MMM/YYYY';
  var lnEl = document.getElementById('f-last');
  if (lnEl) lnEl.placeholder = '';
  var fnEl = document.getElementById('f-first');
  if (fnEl) fnEl.placeholder = '';
  ['f-sex-m', 'f-sex-f'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.disabled = false; el.style.opacity = ''; el.style.pointerEvents = ''; }
  });
}

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
  dismissExistingPatientBanner();
  var pz = document.getElementById('photo-zone');
  if (pz) {
    pz.innerHTML = '<img src="' + croppedDataUrl + '" style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;display:block">';
    pz.style.padding = '0';
  }

  // v4.33: Lock demographic fields while OCR works in the background.
  // Doctor can fill diagnosis, referring MD, location, etc. immediately.
  _lockDemoFields();
  if (bar) {
    bar.style.display = 'block';
    bar.className = 'ocr-bar ocr-ok';
    bar.innerHTML = '<span style="display:inline-block;animation:pulse 1s infinite">\uD83D\uDCF7</span> Extracting data from photo\u2026';
  }

  var img = new Image();
  img.onerror = function() {
    _unlockDemoFields();
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Could not decode cropped image'; }
  };
  img.onload = function() {
    // v4.42: tightened from 1600px/0.88 — phone photos over hospital WiFi
    // were producing 300-600KB base64 payloads that timed out. 1200px at
    // 0.75 quality cuts payload ~60% with no OCR accuracy loss on sticker text.
    var MAX = 1200;
    var w = img.width, h = img.height;
    if (w > h && w > MAX)      { h = Math.round(h * MAX / w); w = MAX; }
    else if (h > MAX)           { w = Math.round(w * MAX / h); h = MAX; }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var jpegDataUrl = canvas.toDataURL('image/jpeg', 0.75);
    var b64 = jpegDataUrl.split(',')[1];
    // Cache for retry button — allows re-attempt without re-photographing.
    window._lastOCRPayload = { b64: b64, mediaType: 'image/jpeg' };
    setTimeout(function() { sendToOCR(b64, 'image/jpeg', bar); }, 0);
  };
  img.src = croppedDataUrl;
}

// ── OCR routing ────────────────────────────────────────────────────
// v4.28: Redesigned cascade with visible diagnostics, auto-retry,
// and empty-extraction detection.
//
// Priority (cascades on failure, with one retry per cloud tier):
//   1. Apps Script → Anthropic  (hospital WiFi)
//   2. Cloudflare Worker        (cellular / off-site)
//   3. Offline OCR (Tesseract / ML Kit)  (on-device fallback)
//   4. RED STOP — "OCR unavailable — tap ↻ to retry"
//
// Each cloud tier is tried twice (most blips resolve in 2-5s). Tier 3
// (offline) runs once. Only after all three fail does the retry button
// appear.
//
// The status bar shows a live diagnostic trail:
//   "Apps Script: timeout → Apps Script retry: ✓"
// so the user (and Kathryn debugging) can see exactly what happened.
//
// handleOCRResult also detects empty extractions (last+first+phn all
// blank) — shows amber "Could not read sticker" with retry button
// instead of the misleading green "✓ Extracted: ?, ?".

var STICKER_PROMPT =
  'Hospital patient sticker or Meditech chart header from Kelowna ' +
  'General Hospital (KGH). Extract the printed fields ONLY — ignore ' +
  'any handwriting.\n\n' +
  'Return a single JSON object with exactly these fields:\n' +
  '  last, first, phn, dob, sex, mrp, admitDate, locationCode, roomBed\n\n' +
  'Rules:\n' +
  '  last / first  — from "Last,First" name line\n' +
  '  phn           — the HCN number (10 digits after "HCN")\n' +
  '  dob           — date after "DOB". IMPORTANT: KGH Meditech dates are\n' +
  '                  DD/MM/YYYY (day first, month second — Canadian format).\n' +
  '                  A screen date "03/09/1934" means 3rd September 1934.\n' +
  '                  Always return as DD Mon YYYY e.g. "03 Sep 1934".\n' +
  '                  NEVER assume American MM/DD order.\n' +
  '  sex           — M or F (from "L:M" or "L:F" field, or "Sex: M/F")\n' +
  '  mrp           — text after "MRP" e.g. "CardiologyMRP,KGH Kelowna"\n' +
  '  admitDate     — date after "ADM", same DD Mon YYYY format as dob\n' +
  '  locationCode  — ward / unit on the admission line, e.g. "KELKGHS2S",\n' +
  '                  "KELKGHICSI", or worded forms like\n' +
  '                  "KGH Emergency Department". Blank if not shown.\n' +
  '  roomBed       — room-bed token beside it, e.g. "KGHS0221-A",\n' +
  '                  "KGHI2607-A", "KGH-Main-7". Blank if not shown.\n\n' +
  'On a Meditech chart header the location is one line, e.g.\n' +
  '  "ADM ACIN, KELKGHS2S  KGHS0221 -A"\n' +
  '  → locationCode "KELKGHS2S", roomBed "KGHS0221-A".\n' +
  'Return ONLY valid JSON, no markdown, no explanation.';

// v4.42: single timeout for the server-side OCR call. Covers the full
// round trip (upload image → Apps Script → Anthropic → response). Apps
// Script execution alone can take 10-20s for Vision, so this is generous.
var OCR_SERVER_TIMEOUT_MS = 45000;

// v4.33: Background retry — Apps Script only, no Cloudflare, no Tesseract.
// v4.42: Exponential backoff — fixed 3s delays meant all 5 retries could
// land inside the same network congestion window (observed 11/06: 5
// consecutive timeouts then instant success minutes later). Backoff
// spreads attempts across ~75s so transient congestion clears.
var OCR_BG_MAX_RETRIES   = 5;
var OCR_BG_BACKOFF_MS    = [3000, 6000, 12000, 25000];  // delay AFTER attempt N fails (N=1..4)

// Shared AbortController-based fetch timeout (used by both sticker and
// Meditech OCR paths).
function fetchWithTimeout(url, opts, ms, label) {
  var ctrl  = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ms);
  var o = opts || {};
  o.signal = ctrl.signal;
  return fetch(url, o).then(function(r) {
    clearTimeout(timer);
    return r;
  }, function(err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error((label || 'request') + ' timed out after ' + ms + 'ms');
    }
    throw err;
  });
}

// ── Status trail helper ──────────────────────────────────────────
// Builds a one-line diagnostic: "Apps Script: timeout 5s → Cloud: ok ✓"
function _ocrTrail(steps) {
  return steps.map(function(s) { return s; }).join(' \u2192 ');
}
function _updateOCRBar(bar, steps, extra) {
  if (!bar) return;
  bar.style.display = 'block';
  bar.className = 'ocr-bar ocr-ok';
  bar.textContent = _ocrTrail(steps) + (extra ? ' ' + extra : '');
}
// ── OCR diagnostic logging ──────────────────────────────────────
// Fires on EVERY OCR completion — success, empty, error, or exhausted.
// Two destinations:
//   1. window._ocrLog (in-memory, last 20) — viewable from console
//   2. push('logOCRDiagnostic', ...) — persistent to sheet
//      (silently no-ops until the backend route is added to Router.gs)
//
// No PII in the log: field presence is boolean (had_last: true), not values.
if (!window._ocrLog) window._ocrLog = [];

function _logOCR(outcome, steps, engine, fields) {
  var entry = {
    ts:         new Date().toISOString(),
    outcome:    outcome,        // 'success' | 'empty' | 'error' | 'exhausted'
    trail:      steps ? _ocrTrail(steps) : '',
    engine:     engine || '',
    had_last:   !!(fields && fields.last),
    had_first:  !!(fields && fields.first),
    had_phn:    !!(fields && fields.phn),
    had_dob:    !!(fields && fields.dob),
    online:     navigator.onLine,
    connection: (navigator.connection || {}).effectiveType || '',
    doctor:     (typeof st !== 'undefined' && st.doc) ? st.doc : ''
  };

  // In-memory ring buffer (last 20)
  window._ocrLog.push(entry);
  if (window._ocrLog.length > 20) window._ocrLog.shift();

  // Console — always log for bedside debugging
  var style = outcome === 'success' ? 'color:green' : 'color:red;font-weight:bold';
  console.log('%c[OCR ' + outcome + '] ' + entry.trail +
    (engine ? ' (' + engine + ')' : '') +
    (entry.online ? '' : ' [OFFLINE]'),
    style);

  // Persistent to sheet — fire-and-forget. If the route doesn't exist
  // yet, push() returns {ok:false} which we ignore.
  if (typeof SHEETS_URL !== 'undefined' && SHEETS_URL) {
    try { push('logOCRDiagnostic', entry); } catch(e) {}
  }
}

function _showOCRExhausted(bar, steps) {
  _logOCR('exhausted', steps, '', {});
  // v4.33: unlock fields so doctor can type manually from the sticker photo.
  _unlockDemoFields();
  // v4.42: also fire a long-duration toast — the bar alone was too easy
  // to miss/misread at the bedside (JW incident 11/06/2026).
  showToast('Photo extraction failed \u2014 type name, PHN & DOB from the sticker photo, or tap Retry', 'error');
  if (!bar) return;
  bar.style.display = 'block';
  bar.className = 'ocr-bar ocr-warn';
  // v4.42: larger text, explicit instruction, stays until acted on.
  bar.innerHTML =
    '<div style="font-size:13px;font-weight:700;line-height:1.4;padding:2px 0">' +
    '\u26A0\uFE0F Could not read the sticker photo</div>' +
    '<div style="font-size:12px;line-height:1.4;margin-bottom:6px">' +
    'Type the name, PHN and DOB from the photo above \u2014 or retry:</div>' +
    '<button onclick="ocrRetry()" style="' +
    'background:var(--blue);color:#fff;border:none;border-radius:14px;' +
    'padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer' +
    '">\u21BB Retry photo extraction</button>';
}

// Global retry — re-sends the cached image through the background loop.
function ocrRetry() {
  var p = window._lastOCRPayload;
  if (!p || !p.b64) {
    showToast('No image to retry \u2014 take a new photo', 'error');
    return;
  }
  _lockDemoFields();
  var bar = document.getElementById('ocr-bar');
  sendToOCR(p.b64, p.mediaType, bar);
}

// ── Entry point: background retry loop ──────────────────────────
// v4.33: Apps Script only, up to OCR_BG_MAX_RETRIES attempts with
// exponential backoff (OCR_BG_BACKOFF_MS) between each. No Cloudflare
// (always blocked on hospital WiFi), no Tesseract (unreliable first-letter
// errors). Fields are locked; doctor works on diagnosis/refMD/location
// while this runs. On success → fields populate and unlock. On
// exhaustion → fields unlock for manual entry.
function sendToOCR(b64, mediaType, bar) {
  if (bar) { bar.style.display = 'block'; bar.className = 'ocr-bar ocr-ok'; }
  var steps = [];
  window._ocrSteps = steps;

  // Bump generation — any prior background loop self-cancels.
  var gen = ++_ocrGeneration;

  _ocrBackgroundLoop(b64, mediaType, bar, steps, 1, gen);
}

// Single-tier retry loop: Apps Script → Anthropic, up to N attempts.
function _ocrBackgroundLoop(b64, mediaType, bar, steps, attempt, gen) {
  // Stale generation — doctor cleared/retook photo. Abort silently.
  if (gen !== _ocrGeneration) return;

  var label = 'Attempt ' + attempt + '/' + OCR_BG_MAX_RETRIES;
  if (bar) {
    bar.style.display = 'block';
    bar.className = 'ocr-bar ocr-ok';
    bar.innerHTML = '<span style="display:inline-block;animation:pulse 1s infinite">\uD83D\uDCF7</span> Extracting data from photo\u2026 <span style="font-size:10px;opacity:.6">(' + label + ')</span>';
  }

  _runAppsScriptOCR(b64, mediaType, STICKER_PROMPT, 500)
    .then(function(p) {
      if (gen !== _ocrGeneration) return; // stale
      p._engine = 'apps-script';
      window._appsScriptOCRReachable = true;
      steps.push(label + ': \u2713');
      handleOCRResult(p, bar);
    })
    .catch(function(err) {
      if (gen !== _ocrGeneration) return; // stale
      var reason = _shortErr(err);
      steps.push(label + ': ' + reason);
      console.warn('[OCR] ' + label + ' failed:', err.message);

      if (attempt < OCR_BG_MAX_RETRIES) {
        // v4.42: exponential backoff — delay grows with each failure
        var delay = OCR_BG_BACKOFF_MS[attempt - 1] || 25000;
        if (bar) {
          bar.innerHTML = '<span style="display:inline-block;animation:pulse 1s infinite">\uD83D\uDCF7</span> Extracting data from photo\u2026 <span style="font-size:10px;opacity:.6">(retrying in ' + Math.round(delay / 1000) + 's\u2026)</span>';
        }
        setTimeout(function() {
          _ocrBackgroundLoop(b64, mediaType, bar, steps, attempt + 1, gen);
        }, delay);
      } else {
        // All retries exhausted — unlock fields for manual entry.
        _showOCRExhausted(bar, steps);
      }
    });
}

// Reusable: single POST to Apps Script, which calls Anthropic Vision
// server-side (v4.42 / Crud.gs v2.38). Returns a Promise that resolves
// to the parsed JSON patient object.
// Used by both sticker OCR and Meditech OCR.
//
// v4.42: Replaces the old two-hop flow (key fetch -> browser calls
// api.anthropic.com directly). The browser->Anthropic leg was the one
// timing out on hospital WiFi; browser->Google is reliable (sync always
// works) and Google->Anthropic runs on datacenter network. Also closes
// the security hole where getAnthropicKey handed the API key to any
// caller with the shared key.
function _runAppsScriptOCR(b64, mediaType, prompt, maxTokens) {
  return fetchWithTimeout(
    SHEETS_URL,
    {
      method: 'POST',
      redirect: 'follow',
      // text/plain avoids a CORS preflight to Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action:    'ocrSticker',
        key:       SHARED_KEY,
        image:     b64,
        mediaType: mediaType,
        prompt:    prompt,
        maxTokens: maxTokens || 500
      })
    },
    OCR_SERVER_TIMEOUT_MS,
    'OCR server call'
  )
    .then(function(r) {
      if (!r.ok) throw new Error('OCR HTTP ' + r.status);
      return r.json();
    })
    .then(function(j) {
      if (!j.ok) throw new Error(j.error || 'OCR failed');
      return j.result;
    });
}

// v4.33: Cloudflare Worker and Tesseract offline tiers REMOVED.
// Cloudflare is always blocked on hospital WiFi. Tesseract produced
// unreliable first-letter errors on KGH sticker fonts. The background
// retry loop now retries Apps Script exclusively — if all attempts
// fail, fields unlock for manual entry from the sticker photo.

// Shorten an error message for the status trail (keep it terse).
function _shortErr(err) {
  var m = (err && err.message) || String(err);
  if (m.indexOf('timed out') !== -1) return 'timeout';
  if (m.indexOf('network') !== -1)   return 'network';
  if (m.indexOf('HTTP 4') !== -1)    return m.replace(/.*HTTP /, 'HTTP ');
  if (m.indexOf('HTTP 5') !== -1)    return m.replace(/.*HTTP /, 'HTTP ');
  if (m.length > 20) return m.slice(0, 20) + '…';
  return m;
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
  // v4.33: Unlock demographic fields — OCR got a response (good or bad),
  // so the waiting is over. Must happen before any early return.
  _unlockDemoFields();

  if (!data || data.error) {
    _logOCR('error', window._ocrSteps || [], (data && data._engine) || '', {});
    if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'OCR: ' + ((data && data.error) || 'unknown error'); }
    return;
  }

  // Worker returns the patient object directly. Older worker code may wrap it
  // as { text: "..." } — handle both shapes.
  var p = data;
  if (typeof data.text === 'string') {
    var match = data.text.match(/\{[\s\S]*\}/);
    if (!match) {
      _logOCR('error', window._ocrSteps || [], '', {});
      if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'No data in response'; } return;
    }
    try { p = JSON.parse(match[0]); }
    catch (e) {
      _logOCR('error', window._ocrSteps || [], '', {});
      if (bar) { bar.className = 'ocr-bar ocr-warn'; bar.textContent = 'Bad JSON in response'; } return;
    }
  }

  // Meditech chart headers carry a location line ("ADM …, <unit> <room-bed>")
  // that single-photo OCR now returns as locationCode + roomBed. Decode it
  // with the shared parseLocCode() — fill ward/room only when OCR did not
  // already supply them and the decode is meaningful.
  if ((p.locationCode || p.roomBed) && typeof parseLocCode === 'function') {
    var _loc = parseLocCode(p.locationCode || '', p.roomBed || '');
    if (!p.ward && _loc.ward && _loc.ward !== 'OTHER') p.ward = _loc.ward;
    if (!p.room && _loc.room) p.room = _loc.room;
  }

  // Persist the full OCR result for debugging:
  //   window._lastOCR — inspect from console: console.log(window._lastOCR._meta)
  window._lastOCR = p;

  // v4.20: DOB sanity check — reject if age < 2 or date is in the future.
  // KGH stickers have admission date adjacent to DOB; OCR sometimes grabs
  // the wrong line. A 2026 date as DOB yields age 0 and is rejected here.
  // The field is left blank for manual entry; a toast warns the doctor.
  if (p.dob) {
    var _dobFmt = fmtClaimDate(p.dob);
    var _dobMs  = parseDMYsafe(_dobFmt);
    if (_dobMs) {
      var _dobAge = Math.floor((Date.now() - _dobMs) / (365.25 * 86400000));
      if (_dobAge < 2 || _dobMs > Date.now()) {
        showToast('DOB "' + p.dob + '" rejected (age ' + _dobAge + ') — likely admission date', 'error');
        p.dob = '';  // Don't populate — leave blank for manual entry
      }
    }
  }

  if (p.last)  document.getElementById('f-last').value  = p.last;
  if (p.first) document.getElementById('f-first').value = p.first;
  if (p.phn)   document.getElementById('f-phn').value   = (p.phn + '').replace(/\D/g,'').slice(0,10);
  if (p.dob)   document.getElementById('f-dob').value   = dispDate(p.dob);
  // v4.13: setting .value above does not fire the oninput handlers, so run
  // the live OCR-error flag explicitly. If OCR truncated the PHN or pulled
  // a number/slash into the last name, the field turns red immediately —
  // the doctor sees it the moment the scan lands, not at submit.
  validatePatientFieldsLive();
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
    // Reflect the prefilled room in the pills (it's now saved, so it shows
    // as a pill — or as "Other" if it didn't normalise to a known room).
    renderRoomPills(gv('f-ward'), 'f-bed', 'f-room-pills');
  }

  // v4.20: _ocrOriginal snapshot now reads from the FORM after all fields
  // are populated, not from raw OCR data. This ensures buildOCRCorrections
  // compares normalized values (e.g. DOB as DD/MM/YYYY, MRP as dropdown
  // value) against the saved patient's normalized values — so only real
  // doctor edits register as corrections. Previously the raw OCR format
  // ("26 Oct 1958") always differed from the stored format ("26/10/1958"),
  // causing every DOB to appear as a false correction.
  // v4.48: DOB form field now displays "DD Mon YYYY"; normalise back to
  // DD/MM/YYYY for the snapshot so the comparison still works.
  window._ocrOriginal = {
    last:   (document.getElementById('f-last')  || {}).value || '',
    first:  (document.getElementById('f-first') || {}).value || '',
    phn:    (document.getElementById('f-phn')   || {}).value || '',
    dob:    fmtClaimDate((document.getElementById('f-dob') || {}).value || ''),
    sex:    (document.getElementById('f-sex')   || {}).value || '',
    mrp:    (document.getElementById('f-mrp')   || {}).value || '',
    ward:   (document.getElementById('f-ward')  || {}).value || '',
    room:   (document.getElementById('f-bed')   || {}).value || '',
    engine: p._engine || 'worker',
    capturedAt: Date.now()
  };
  if (bar) {
    // v4.28: Detect empty extraction — OCR succeeded (valid response) but
    // found nothing useful. Show amber bar with retry instead of the
    // misleading green "✓ Extracted: ?, ?".
    var _gotSomething = !!(p.last || p.first || p.phn);
    var _ocrFields = { last: p.last, first: p.first, phn: p.phn, dob: p.dob };
    if (!_gotSomething) {
      _logOCR('empty', window._ocrSteps || [], p._engine || '', _ocrFields);
      bar.className = 'ocr-bar ocr-warn';
      var engineTag2 = p._engine ? (p._engine + ': ') : '';
      bar.innerHTML = engineTag2 + 'Could not read sticker \u2014 fields empty ' +
        '<button onclick="ocrRetry()" style="' +
        'background:var(--blue);color:#fff;border:none;border-radius:12px;' +
        'padding:2px 10px;font-size:11px;margin-left:6px;cursor:pointer' +
        '">\u21BB Retry</button>';
    } else {
      _logOCR('success', window._ocrSteps || [], p._engine || '', _ocrFields);
      bar.className = 'ocr-bar ocr-ok';
      var engineTag = '';
      if (p._engine === 'cloud')          engineTag = '\u2601\uFE0F ';
      else if (p._engine === 'apps-script') engineTag = '\uD83C\uDFE5 ';
      else if (p._engine === 'tesseract') engineTag = '\uD83D\uDCF1 ';
      else if (p._engine === 'mlkit')     engineTag = '\uD83D\uDCF1 ';
      bar.textContent = engineTag + '\u2713 Extracted: ' + p.last + ', ' + p.first + (p.phn ? ' \u00B7 ' + p.phn : '');
    }
  }

  // ── Existing-patient fast-path ──────────────────────────────────
  // If the sticker PHN already matches a patient in the database, show a
  // banner offering Restore / Go-to-patient so the doctor can skip
  // re-entering the whole form.
  var _ocrPhn = String(p.phn || '').replace(/\D/g, '').slice(0, 10);
  if (_ocrPhn.length === 10 && typeof st !== 'undefined' && st.patients) {
    var _existing = st.patients.filter(function(x) {
      return x && String(x.phn || '').replace(/\D/g, '').slice(0, 10) === _ocrPhn;
    })[0];
    if (_existing) showExistingPatientBanner(_existing);
  }
}

// ── Existing-patient banner (sticker fast-path) ─────────────────────
// Rendered into the Add Patient pane when an OCR'd sticker PHN matches a
// patient already in st.patients. Discharged → offer Restore (reuses the
// On/Off Service chooser). Still on a list → offer to jump to them.
function showExistingPatientBanner(match) {
  dismissExistingPatientBanner();
  var bar = document.getElementById('ocr-bar');
  if (!bar || !bar.parentNode) return;

  var nameStr = ((match.last || '') + ', ' + (match.first || '')).replace(/^,\s*|,\s*$/g, '');
  var discharged = (typeof isDischarged === 'function') ? isDischarged(match) : !!match.discharged;

  var div = document.createElement('div');
  div.id = 'existing-pt-banner';
  div.style.cssText = 'margin-top:6px;padding:10px;border-radius:8px;' +
    'background:var(--surface2);border:1px solid var(--border2)';

  if (discharged) {
    var detail = esc(nameStr) + (match.phn ? ' · ' + esc(String(match.phn)) : '') + ' · discharged';
    div.innerHTML =
      '<div style="font-weight:600;margin-bottom:4px">Patient already exists in Database</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-bottom:8px">' + detail + '</div>' +
      '<button class="btn btn-p" style="margin:0" data-pid="' + esc(match.id) + '" ' +
        'onclick="dismissExistingPatientBanner();restorePatient(this.getAttribute(\'data-pid\'))">' +
        '↩ Restore to list</button>';
  } else {
    var wardStr = match.ward ? ((typeof wardLabel === 'function' && wardLabel(match.ward)) || match.ward) : '';
    div.innerHTML =
      '<div style="font-weight:600;margin-bottom:4px">Patient already on the list</div>' +
      '<div style="font-size:12px;color:var(--text2);margin-bottom:8px">' +
        esc(nameStr) + (wardStr ? ' — ' + esc(wardStr) : '') + '</div>' +
      '<button class="btn btn-p" style="margin:0" data-pid="' + esc(match.id) + '" ' +
        'onclick="dismissExistingPatientBanner();goToExistingPatient(this.getAttribute(\'data-pid\'))">' +
        'Go to patient</button>';
  }
  bar.parentNode.insertBefore(div, bar.nextSibling);
}

function dismissExistingPatientBanner() {
  var el = document.getElementById('existing-pt-banner');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function goToExistingPatient(pid) {
  if (typeof openPatientSummary === 'function') openPatientSummary(pid);
}

// ─── OCR corrections diff ──────────────────────────────────────────
// Compares the OCR snapshot (window._ocrOriginal, set by handleOCRResult)
// against the patient as actually saved. Returns an array of
// {ts, phn, patientName, field, ocr_value, corrected_value, engine, source}
// for every field the doctor changed. Schema matches the live Apps Script
// 'OCR Corrections' sheet exactly (8 cols).
//
// v4.20: _ocrOriginal now reads from the form DOM after OCR populates the
// fields, so both sides are in the same normalized format (DD/MM/YYYY for
// DOB, dropdown values for MRP, digits-only for PHN). This fixes the
// format-mismatch bug where every DOB appeared as a false "correction".
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
