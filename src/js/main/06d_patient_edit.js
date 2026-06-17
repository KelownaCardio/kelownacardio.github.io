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
  html += '<div class="f1"><label>DOB</label><input id="pe-dob" value="' + esc(dispDate(p.dob)||'') + '" autocorrect="off" placeholder="DD Mon YYYY" oninput="dobAutoSlash(this)"></div>';
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

  // ── Handover flag ────────────────────────────────────
  var _hoOn = !!p.handover && p.handover !== 'false' && p.handover !== false;
  html += '<div class="card" style="padding:10px 12px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div style="font-size:13px;font-weight:700;color:var(--text)">Flag for handover — on call issue</div>' +
      '<button class="ap-list-pill' + (_hoOn ? ' on' : '') + '" id="pe-handover" ' +
        'onclick="this.classList.toggle(\'on\')" ' +
        'style="min-width:0;padding:4px 12px;font-size:11px;text-align:center">Flag</button>' +
    '</div>' +
    '</div>';

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

// Dynamic role change in edit form — v4.39: only updates MRP binding.
// Care type is NOT auto-changed.
function peRoleChange() {
  var roleSel = document.getElementById('pe-role');
  var mrpSel  = document.getElementById('pe-mrp');
  if (!roleSel || !mrpSel) return;
  if (roleSel.value === 'mrp') {
    mrpSel.value = 'Cardiology';
  } else {
    if (mrpSel.value === 'Cardiology') mrpSel.value = 'Other';
  }
}

function savePatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  // v4.09: capture pre-edit values so we can propagate to existing claim rows.
  // v4.31: expanded from name-only to PHN + DOB + sex. Without this,
  // fixing a typo'd PHN on the patient tab left claim rows stuck with the
  // old (wrong) PHN, and the next sync overwrote the correction.
  var _oldLast  = p.last  || '';
  var _oldFirst = p.first || '';
  var _oldPhn   = p.phn   || '';
  var _oldDob   = p.dob   || '';
  var _oldSex   = p.sex   || '';

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

  // v4.37: handover flag — 'oncall' when toggled on from edit, preserve 'new' if untouched
  var _hoPill = document.getElementById('pe-handover');
  if (_hoPill) {
    var _wasOn = !!p.handover && p.handover !== 'false' && p.handover !== false;
    var _nowOn = _hoPill.classList.contains('on');
    if (_nowOn && !_wasOn)      p.handover = 'oncall';   // newly flagged
    else if (!_nowOn && _wasOn) p.handover = false;       // cleared
    // else: unchanged — keep existing value ('new' or 'oncall')
  }

  saveCustomRoom(p.ward, p.bed);
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);

  // v4.31: propagate ALL demographic changes to claim rows.
  // Claims are found by the OLD PHN (in case PHN itself changed), then
  // each changed field is updated. Each touched claim is re-pushed.
  var _nameChanged = (p.last !== _oldLast || p.first !== _oldFirst);
  var _phnChanged  = (p.phn !== _oldPhn);
  var _dobChanged  = (p.dob !== _oldDob);
  var _sexChanged  = (p.sex !== _oldSex);
  var _anyDemoChanged = _nameChanged || _phnChanged || _dobChanged || _sexChanged;

  var _claimsTouched = 0;
  if (_anyDemoChanged && (_oldPhn || p.phn)) {
    // Use old PHN to find claims (it's what the claim rows currently hold)
    var searchPhn = _oldPhn || p.phn;
    st.claims.forEach(function(c) {
      if (!samePhn(c.phn, searchPhn)) return;
      var touched = false;
      if (_nameChanged && (c.last !== p.last || c.first !== p.first)) {
        c.last  = p.last;
        c.first = p.first;
        touched = true;
      }
      if (_phnChanged && c.phn !== p.phn) {
        c.phn = p.phn;
        touched = true;
      }
      if (_dobChanged && c.dob !== p.dob) {
        c.dob = p.dob;
        touched = true;
      }
      if (_sexChanged && c.sex !== p.sex) {
        c.sex = p.sex;
        touched = true;
      }
      if (touched) {
        if (SHEETS_URL) push('saveClaim', c);
        _claimsTouched++;
      }
    });
    if (_claimsTouched > 0) {
      sv('claims', st.claims);
      try { console.log('[v4.31] Propagated demographic edit to ' + _claimsTouched + ' claim row(s) for PHN ' + searchPhn + (_phnChanged ? ' → ' + p.phn : '')); } catch (e) {}
    }
  }

  var _detailParts = [];
  if (_nameChanged) {
    var _oldDisplay = _oldLast + (_oldFirst ? ', ' + _oldFirst : '');
    _detailParts.push('Renamed from "' + _oldDisplay + '"');
  }
  if (_phnChanged) _detailParts.push('PHN ' + _oldPhn + ' → ' + p.phn);
  if (_dobChanged) _detailParts.push('DOB ' + (dispDate(_oldDob) || '(blank)') + ' → ' + dispDate(p.dob));
  if (_sexChanged) _detailParts.push('Sex ' + (_oldSex || '(blank)') + ' → ' + p.sex);
  if (_claimsTouched > 0) _detailParts.push(_claimsTouched + ' claim row(s) updated');
  logChange(p, 'Demographics edited', _detailParts.join(' \u2014 '));
  hideModal('pt-edit-modal');
  render();
  showToast(p.last + ' updated' + (_claimsTouched > 0 ? ' (\u2713 ' + _claimsTouched + ' claim row(s) updated)' : ''));
}

// ═══════════════════════════════════════════════════════
// Location edit — quick ward/bed/on-off-service change
// Opened by tapping the ward/bed circle on any patient row.
// v4.39: No forced role/care snaps. User controls all fields independently.
// Stranded-card safety net handles visibility for patients on unexpected wards.
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
  if (hint) hint.textContent = '';
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

  // v4.39: No forced role/care snaps. Save user's choices directly.
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
  logChange(p, 'Moved', bits.join('; ') || 'no change');

  hideModal('loc-edit-modal');
  render();
  var toastBits = [];
  if (oldWard !== newWard || oldBed !== newBed) toastBits.push((WARDS[newWard]||{}).label || newWard);
  if (newBed) toastBits.push(newBed);
  showToast(p.last + ' moved' + (toastBits.length ? ' → ' + toastBits.join(' ') : ''));
}

