// ── 06d_patient_edit.js ──
// ═══════════════════════════════════════════════════════
// 06d_patient_edit.js — Edit patient demographics/location
// Double-tap patient name opens an edit sheet
// ═══════════════════════════════════════════════════════

// Edit opened via pencil icon on claim screen banner


function openPatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:-.3px">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Edit patient</span>' +
    '</div>';

  // ── Demographics ─────────────────────────────────────

  html += '<div class="card card-patient">';
  html += '<div class="card-title">Demographics</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>Last name</label><input id="pe-last" value="' + esc(p.last||'') + '" autocorrect="off" autocapitalize="words"></div>';
  html += '<div class="f1"><label>First name</label><input id="pe-first" value="' + esc(p.first||'') + '" autocorrect="off" autocapitalize="words"></div>';
  html += '</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>PHN</label><input id="pe-phn" value="' + esc(p.phn||'') + '" inputmode="numeric" maxlength="10" autocorrect="off"></div>';
  html += '<div class="f1"><label>DOB</label><input id="pe-dob" value="' + esc(p.dob||'') + '" autocorrect="off" placeholder="DD/MM/YYYY" inputmode="numeric" oninput="dobAutoSlash(this)"></div>';
  html += '</div>';
  html += '<div class="fl">';
  html += '<div class="f1"><label>Sex</label>' +
          '<div class="fl" style="gap:6px">' +
            '<button class="ap-list-pill' + (p.sex==='M'?' on':'') + '" id="pe-sex-m" onclick="peSexPill(\'M\')">M</button>' +
            '<button class="ap-list-pill' + (p.sex==='F'?' on':'') + '" id="pe-sex-f" onclick="peSexPill(\'F\')">F</button>' +
          '</div>' +
          '<input id="pe-sex" type="hidden" value="' + esc(p.sex||'') + '">' +
          '</div>';
  html += '</div>';
  html += '</div>'; // end demographics card

  // ── Location & list (shared component) ───────────────
  html += buildLocationCard('pe', p);

  // ── Audit footer (who added the patient) ─────────────
  if (p.createdBy || p.createdAt) {
    html += '<div style="font-size:10px;color:var(--text3);text-align:center;margin:8px 0 12px">' +
            'Added by ' + esc(p.createdBy || '—') +
            (p.createdAt ? ' &middot; ' + auditTs(p.createdAt) : '') +
            '</div>';
  }

  // ── Save / Cancel ────────────────────────────────────
  html += '<div class="fl" style="gap:8px">';
  html += '<button class="btn btn-p" style="margin:0;flex:1" ' +
          'data-pid="' + pid + '" onclick="savePatientEdit(this.getAttribute(\'data-pid\'))">Save</button>';
  html += '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideModal(\'pt-edit-modal\')">Cancel</button>';
  html += '</div>';

  document.getElementById('pt-edit-content').innerHTML = html;
  showModal('pt-edit-modal');

  // Render the ward's room pills after the card is in the DOM. Ward,
  // role, MRP, list, care and bed are all baked into the card by
  // buildLocationCard, so nothing else needs restoring here.
  setTimeout(function() {
    renderRoomPills(p.ward, 'pe-bed', 'pe-room-pills');
  }, 50);
}

// Clear a search field and its hidden value fields
function clearSearchField(searchId, hiddenId, hiddenNameId, ddId) {
  var s = document.getElementById(searchId);
  if (s) { s.value = ''; s.focus(); }
  var h = document.getElementById(hiddenId);
  if (h) h.value = '';
  if (hiddenNameId) {
    var hn = document.getElementById(hiddenNameId);
    if (hn) hn.value = '';
  }
  var dd = document.getElementById(ddId);
  if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
}

// Dynamic role change in edit form
function peRoleChange() {
  // Same rules as roleChange() — role ↔ MRP binding, care updates,
  // list (on/off service) is NOT touched (ward-driven only).
  var roleSel = document.getElementById('pe-role');
  var mrpSel  = document.getElementById('pe-mrp');
  var careFld = document.getElementById('pe-care');
  var ward    = (document.getElementById('pe-ward') || {}).value || '';
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

function savePatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  // v4.09: capture pre-edit name so we can propagate a rename to existing
  // claim rows. Background: addClaim snapshots p.last/p.first onto each
  // claim row at write time. Before v4.09 a rename here only updated the
  // patient record, leaving historical claim rows stuck with the original
  // (often OCR-misread) name — exactly the failure pattern that landed
  // last="57" on Malone, Deborah's claims.
  var _oldLast  = p.last  || '';
  var _oldFirst = p.first || '';

  var role = (document.getElementById('pe-role') || {}).value || 'consultant';
  var ward = (document.getElementById('pe-ward') || {}).value || p.ward;

  p.last      = fmtName((document.getElementById('pe-last')  || {}).value || p.last);
  p.first     = fmtName((document.getElementById('pe-first') || {}).value || p.first);
  p.phn       = (document.getElementById('pe-phn')   || {}).value || p.phn;
  p.dob       = fmtClaimDate((document.getElementById('pe-dob') || {}).value || p.dob);
  p.sex       = (document.getElementById('pe-sex')   || {}).value || p.sex;
  p.ward      = ward;
  var _peBed = document.getElementById('pe-bed');
  if (_peBed) p.bed = _peBed.value;
  p.role      = role;
  p.mrp       = (document.getElementById('pe-mrp')  || {}).value || '';
  p.list      = (document.getElementById('pe-list') || {}).value || p.list;
  p.care      = (document.getElementById('pe-care') || {}).value || p.care;

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // v4.09: propagate name change to ALL claim rows for this PHN. Each row
  // is re-pushed via saveClaim so the Sheet is updated. The set of changed
  // claims is also reported in the changelog detail and a separate toast
  // so the doctor can see what was touched.
  var _claimsTouched = 0;
  if ((p.last !== _oldLast || p.first !== _oldFirst) && p.phn) {
    st.claims.forEach(function(c) {
      if (!samePhn(c.phn, p.phn)) return;
      if (c.last === p.last && c.first === p.first) return;
      c.last  = p.last;
      c.first = p.first;
      if (SHEETS_URL) push('saveClaim', c);
      _claimsTouched++;
    });
    if (_claimsTouched > 0) {
      sv('claims', st.claims);
      try { console.log('[v4.09] Propagated name change to ' + _claimsTouched + ' claim row(s) for PHN ' + p.phn); } catch (e) {}
    }
  }

  var _renameDetail = '';
  if (p.last !== _oldLast || p.first !== _oldFirst) {
    var _oldDisplay = _oldLast + (_oldFirst ? ', ' + _oldFirst : '');
    _renameDetail = 'Renamed from "' + _oldDisplay + '"' +
      (_claimsTouched > 0 ? ' \u2014 updated ' + _claimsTouched + ' claim row(s)' : '');
  }
  logChange(p, 'Demographics edited', _renameDetail);
  hideModal('pt-edit-modal');
  render();
  showToast(p.last + ' updated' + (_claimsTouched > 0 ? ' (\u2713 ' + _claimsTouched + ' claim row(s) renamed)' : ''));
}

// ═══════════════════════════════════════════════════════
// Location edit — quick ward/bed/on-off-service change
// Opened by tapping the ward/bed circle on any patient row.
// Rule: if the new ward isn't a Cardiology MRP ward (CCU/2S/2W)
// OR the list flips on→off, force role=consultant + mrp=Other.
// ═══════════════════════════════════════════════════════
function openLocationEditEl(el) {
  var pid = el.getAttribute('data-pid') || (el.closest('[data-pid]') && el.closest('[data-pid]').getAttribute('data-pid'));
  if (pid) openLocationEdit(pid);
}

var _leEditP = null;

function openLocationEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;
  _leEditP = p;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:-.3px">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Location</span>' +
    '</div>';

  // Shared "Location & list" card — same component as Add Patient.
  html += buildLocationCard('le', p);
  html += '<div id="le-rule-hint" style="font-size:11px;color:var(--text3);line-height:1.4;margin:8px 0 12px;padding:0 4px"></div>';

  html += '<div class="fl" style="gap:8px">';
  html += '<button class="btn btn-p" style="margin:0;flex:1" data-pid="' + pid + '" onclick="saveLocationEdit(this.getAttribute(\'data-pid\'))">Save</button>';
  html += '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideModal(\'loc-edit-modal\')">Cancel</button>';
  html += '</div>';

  document.getElementById('loc-edit-content').innerHTML = html;
  showModal('loc-edit-modal');

  setTimeout(function() {
    renderRoomPills(p.ward, 'le-bed', 'le-room-pills');
    leUpdateRuleHint();
  }, 50);
}


// Whether a ward is a Cardiology MRP ward where this group is primary.
// Used by saveLocationEdit and leUpdateRuleHint.
function _isCardiologyMRPWard(ward) {
  return ward === 'CCU' || ward === '2S' || ward === '2W';
}

function leUpdateRuleHint() {
  var hint = document.getElementById('le-rule-hint');
  if (!hint) return;
  var newWard = (document.getElementById('le-ward') || {}).value || '';
  var newList = (document.getElementById('le-list') || {}).value || 'on';
  var oldList = _leEditP ? _leEditP.list : null;

  var movedOff       = oldList === 'on' && newList === 'off';
  var leftCardiology = !_isCardiologyMRPWard(newWard);
  if (movedOff || leftCardiology) {
    hint.innerHTML = '<b style="color:var(--amber-t)">Note:</b> role will change to ' +
      '<b>Consulting</b> and MRP to <b>Other</b>. Open full edit if you need to keep them as MRP/Cardiology.';
  } else {
    hint.textContent = '';
  }
}

function saveLocationEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var newWard = (document.getElementById('le-ward') || {}).value || p.ward;
  var newBed  = (document.getElementById('le-bed')  || {}).value || '';
  var newList = (document.getElementById('le-list') || {}).value || p.list;
  var newMrp  = (document.getElementById('le-mrp')  || {}).value || '';
  var newRole = (document.getElementById('le-role') || {}).value || '';
  var newCare = (document.getElementById('le-care') || {}).value || '';

  var oldWard = p.ward;
  var oldBed  = p.bed || '';
  var oldList = p.list;

  // Apply the rule: leaving cardiology wards OR going on→off → consultant + Other
  var leftCardiology = !_isCardiologyMRPWard(newWard);
  var movedOff       = oldList === 'on' && newList === 'off';
  var snappedRole    = false;
  if (leftCardiology || movedOff) {
    if (p.role === 'mrp' || (p.mrp && p.mrp === 'Cardiology')) snappedRole = true;
    p.role = 'consultant';
    p.mrp  = 'Other';
    // Care code stays user-controlled via full edit; default to directive for consultants
    if (p.care !== 'combined') p.care = 'directive';
  }

  p.ward = newWard;
  p.bed  = newBed;
  p.list = newList;
  if (newMrp)  p.mrp  = newMrp;
  if (newRole) p.role = newRole;
  if (newCare) p.care = newCare;

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // Concise change-log entry
  var bits = [];
  if (oldWard !== newWard) bits.push(((WARDS[oldWard]||{}).label || oldWard || '—') + ' → ' + ((WARDS[newWard]||{}).label || newWard));
  if (oldBed  !== newBed)  bits.push('bed ' + (oldBed || '—') + ' → ' + (newBed || '—'));
  if (oldList !== newList) bits.push((oldList === 'on' ? 'On' : 'Off') + ' → ' + (newList === 'on' ? 'On' : 'Off') + ' service');
  if (snappedRole)         bits.push('role→Consulting, MRP→Other');
  logChange(p, 'Moved', bits.join('; ') || 'no change');

  hideModal('loc-edit-modal');
  render();
  var toastBits = [];
  if (oldWard !== newWard || oldBed !== newBed) toastBits.push((WARDS[newWard]||{}).label || newWard);
  if (newBed) toastBits.push(newBed);
  showToast(p.last + ' moved' + (toastBits.length ? ' → ' + toastBits.join(' ') : ''));
}

