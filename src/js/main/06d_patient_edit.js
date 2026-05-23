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
  html += '<div class="f1"><label>DOB</label><input id="pe-dob" value="' + esc(p.dob||'') + '" autocorrect="off" placeholder="DD/MMM/YYYY"></div>';
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

  // ── Location & service ───────────────────────────────
  html += '<div class="card card-location">';
  html += '<div class="card-title">Location &amp; service</div>';

  // Row 1: Ward + Bed
  html += '<div class="fl">';
  html += '<div class="f1"><label>Ward</label><select id="pe-ward" onchange="peWardChange()">';
  Object.keys(WARDS).forEach(function(k) {
    html += '<option value="' + k + '"' + (p.ward === k ? ' selected' : '') + '>' + WARDS[k].label + '</option>';
  });
  html += '</select></div>';
  html += '<div class="f1"><label id="pe-bed-lbl">Bed / room</label>' +
          '<div style="position:relative">' +
          '<input id="pe-bed" autocorrect="off" autocomplete="off" placeholder="Select or type…" style="margin-bottom:0"' +
          ' oninput="bedSearchEl(this,\'pe-bed-dd\')" onfocus="bedSearchEl(this,\'pe-bed-dd\')"' +
          ' onblur="setTimeout(function(){hideBedDd(\'pe-bed-dd\')},200)">' +
          '<div class="bed-dd" id="pe-bed-dd"></div>' +
          '</div></div>';
  html += '</div>';

  // Row 2: Cardiology role pills
  var peCurRole = p.role === 'mrp' ? 'mrp' : 'consultant';
  html += '<label style="margin-top:8px">Cardiology role</label>';
  html += '<div class="fl" style="gap:8px;margin-top:4px">';
  html += '<button class="ap-list-pill' + (peCurRole==='mrp'?' on':'') + '" id="pe-role-mrp" onclick="peRolePill(\'mrp\')">MRP</button>';
  html += '<button class="ap-list-pill' + (peCurRole==='consultant'?' on':'') + '" id="pe-role-con" onclick="peRolePill(\'consultant\')">Consulting</button>';
  html += '</div>';
  html += '<input id="pe-role" type="hidden" value="' + peCurRole + '">';
  // Row 3: MRP service dropdown
  html += '<label style="margin-top:8px">MRP service</label>';
  html += '<select id="pe-mrp" onchange="peMrpChange()">' +
          ['Cardiology','Other','Hospitalist','CTU','ICU','CSICU',
           'Cardiac Surgery','General Surgery','Orthopedics','Neurology','Nephrology']
          .map(function(s) {
            return '<option value="' + s + '"' + ((p.mrp||'Other') === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
          '</select>';

  // Row 3: On/Off service pills
  var peList = p.list === 'on' ? 'on' : 'off';
  html += '<label style="margin-top:8px">On / Off service</label>';
  html += '<div class="fl" style="gap:8px;margin-top:4px">';
  html += '<button class="ap-list-pill' + (peList==='on'?' on':'') + '" id="pe-pill-on" onclick="pePill(\'on\')">On service</button>';
  html += '<button class="ap-list-pill tone-amber' + (peList==='off'?' on':'') + '" id="pe-pill-off" onclick="pePill(\'off\')">Off service</button>';
  html += '</div>';
  html += '<input id="pe-list" type="hidden" value="' + peList + '">';

  html += '<input id="pe-care" type="hidden" value="' + esc(p.care||'daily') + '">';
  html += '</div>'; // end location card

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

  // Populate bed options after render
  setTimeout(function() {
    // Preserve the patient's saved list / role / mrp / care — opening
    // edit must never clobber values with ward defaults. Only manual
    // ward changes inside the modal will reset them.
    peWardChange({preserveAll:true});
    // Restore current bed value into the input
    var bedInp = document.getElementById('pe-bed');
    if (bedInp && p.bed) bedInp.value = p.bed;
    // (No peRoleChange() here — preserveAll already kept role/mrp/care.
    //  Calling peRoleChange would overwrite the saved care value based
    //  on role, losing 'combined' on CSICU/ICU patients etc.)
  }, 50);
}

// Dynamic ward change in edit form
function pePill(val) {
  var el = document.getElementById('pe-list'); if (el) el.value = val;
  var on  = document.getElementById('pe-pill-on');
  var off = document.getElementById('pe-pill-off');
  if (on)  on.className  = 'ap-list-pill' + (val === 'on'  ? ' on' : '');
  if (off) off.className = 'ap-list-pill tone-amber' + (val === 'off' ? ' on' : '');
}

function peWardChange(opts) {
  var ward = (document.getElementById('pe-ward') || {}).value || 'CCU';
  var bedLbl = document.getElementById('pe-bed-lbl');
  if (bedLbl) bedLbl.textContent = ward === 'CCU' ? 'Bed #' : 'Room';

  // Apply ward defaults to list / role / mrp / care unless this call is
  // the edit-modal init (opts.preserveAll=true) — we don't want opening
  // edit on an existing patient to clobber their saved values.
  if (!opts || !opts.preserveAll) {
    applyWardDefaults(ward, { list:'pe-list', role:'pe-role', mrp:'pe-mrp', care:'pe-care' });
    // Sync pe pills (list + role)
    var peListVal = (document.getElementById('pe-list') || {}).value || 'on';
    var peOn  = document.getElementById('pe-pill-on');
    var peOff = document.getElementById('pe-pill-off');
    if (peOn)  peOn.className  = 'ap-list-pill' + (peListVal === 'on'  ? ' on' : '');
    if (peOff) peOff.className = 'ap-list-pill' + (peListVal === 'off' ? ' on' : '');
    syncPeRolePills();
  }
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

function peMrpChange() {
  // Same rules as mrpChange() — list is NOT touched.
  var mrpSel  = document.getElementById('pe-mrp');
  var roleSel = document.getElementById('pe-role');
  var careFld = document.getElementById('pe-care');
  var ward    = (document.getElementById('pe-ward') || {}).value || '';
  if (!mrpSel || !roleSel) return;
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (mrpSel.value === 'Cardiology') {
    roleSel.value = 'mrp';
    if (careFld) careFld.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    roleSel.value = 'consultant';
    if (careFld) careFld.value = 'directive';
  }
  syncPeRolePills();
}

function peRolePill(val) {
  var roleEl = document.getElementById('pe-role');
  if (roleEl) roleEl.value = val;
  syncPeRolePills();
  var mrpEl  = document.getElementById('pe-mrp');
  var careEl = document.getElementById('pe-care');
  var ward   = (document.getElementById('pe-ward') || {}).value || '';
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (val === 'mrp') {
    if (mrpEl)  mrpEl.value  = 'Cardiology';
    if (careEl) careEl.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    if (mrpEl && mrpEl.value === 'Cardiology') mrpEl.value = 'Other';
    if (careEl) careEl.value = 'directive';
  }
}

function syncPeRolePills() {
  var val = (document.getElementById('pe-role') || {}).value || 'consultant';
  var mrp = document.getElementById('pe-role-mrp');
  var con = document.getElementById('pe-role-con');
  if (mrp) mrp.className = 'ap-list-pill' + (val === 'mrp'        ? ' on' : '');
  if (con) con.className = 'ap-list-pill' + (val === 'consultant' ? ' on' : '');
}

function savePatientEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

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
  logChange(p, 'Demographics edited', '');
  hideModal('pt-edit-modal');
  render();
  showToast(p.last + ' updated');
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

function openLocationEdit(pid) {
  var p = getP(pid);
  if (!p || !p.id) return;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:13px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:-.3px">' + esc(p.last) + ', ' + esc(p.first) + '</div>' +
    '<span style="font-size:10px;color:var(--text3)">Location</span>' +
    '</div>';

  html += '<div class="card card-location" style="margin-bottom:10px">';

  // Row 1: Ward + Bed
  html += '<div class="fl">';
  html += '<div class="f1"><label>Ward</label><select id="le-ward" onchange="leWardChange()">';
  Object.keys(WARDS).forEach(function(k) {
    html += '<option value="' + k + '"' + (p.ward === k ? ' selected' : '') + '>' + WARDS[k].label + '</option>';
  });
  html += '</select></div>';
  html += '<div class="f1"><label id="le-bed-lbl">' + (p.ward === 'CCU' ? 'Bed #' : 'Room') + '</label>' +
          '<div style="position:relative">' +
          '<input id="le-bed" autocorrect="off" autocomplete="off" placeholder="Select or type…" style="margin-bottom:0"' +
          ' value="' + esc(p.bed || '') + '"' +
          ' oninput="bedSearchEl(this,\'le-bed-dd\')" onfocus="bedSearchEl(this,\'le-bed-dd\')"' +
          ' onblur="setTimeout(function(){hideBedDd(\'le-bed-dd\')},200)">' +
          '<div class="bed-dd" id="le-bed-dd"></div>' +
          '</div></div>';
  html += '</div>';

  // Row 2: Cardiology role pills
  var curRole = p.role === 'mrp' ? 'mrp' : 'consultant';
  html += '<label style="margin-top:8px">Cardiology role</label>';
  html += '<div class="fl" style="gap:8px;margin-top:4px">';
  html += '<button class="ap-list-pill' + (curRole==='mrp'?' on':'') + '" id="le-role-mrp" onclick="leRolePill(\'mrp\')">MRP</button>';
  html += '<button class="ap-list-pill' + (curRole==='consultant'?' on':'') + '" id="le-role-con" onclick="leRolePill(\'consultant\')">Consulting</button>';
  html += '</div>';
  html += '<input id="le-role" type="hidden" value="' + curRole + '">';
  // Row 3: MRP service dropdown
  var mrpOpts = ['Cardiology','Other','Hospitalist','CTU','ICU','CSICU','Cardiac Surgery','General Surgery','Orthopedics','Neurology','Nephrology'];
  html += '<label style="margin-top:8px">MRP service</label>';
  html += '<select id="le-mrp" onchange="leMrpChange()">' +
          mrpOpts.map(function(s) { return '<option value="' + s + '"' + ((p.mrp||'Other')===s?' selected':'') + '>' + s + '</option>'; }).join('') +
          '</select>';

  // Row 3: On/Off service pills
  var curList = p.list === 'on' ? 'on' : 'off';
  html += '<label style="margin-top:8px">On / Off service</label>';
  html += '<div class="fl" style="gap:8px;margin-top:4px">';
  html += '<button class="ap-list-pill' + (curList==='on'?' on':'') + '" id="le-pill-on" onclick="lePill(\'on\')">On service</button>';
  html += '<button class="ap-list-pill tone-amber' + (curList==='off'?' on':'') + '" id="le-pill-off" onclick="lePill(\'off\')">Off service</button>';
  html += '</div>';
  html += '<input id="le-list" type="hidden" value="' + curList + '">';
  html += '<input id="le-care" type="hidden" value="' + esc(p.care||'directive') + '">';
  html += '</div>';

  html += '<div id="le-rule-hint" style="font-size:11px;color:var(--text3);line-height:1.4;margin-bottom:12px;padding:0 4px"></div>';

  html += '<div class="fl" style="gap:8px">';
  html += '<button class="btn btn-p" style="margin:0;flex:1" data-pid="' + pid + '" onclick="saveLocationEdit(this.getAttribute(\'data-pid\'))">Save</button>';
  html += '<button class="btn btn-s" style="margin:0;flex:1" onclick="hideModal(\'loc-edit-modal\')">Cancel</button>';
  html += '</div>';

  document.getElementById('loc-edit-content').innerHTML = html;
  showModal('loc-edit-modal');

  setTimeout(function() {
    var bedInp = document.getElementById('le-bed');
    if (bedInp && p.bed) bedInp.value = p.bed;
    leUpdateRuleHint(p);
  }, 50);
}

function lePill(val) {
  var el = document.getElementById('le-list'); if (el) el.value = val;
  var on  = document.getElementById('le-pill-on');
  var off = document.getElementById('le-pill-off');
  if (on)  on.className  = 'ap-list-pill' + (val === 'on'  ? ' on' : '');
  if (off) off.className = 'ap-list-pill tone-amber' + (val === 'off' ? ' on' : '');
}

function leMrpChange() {
  var mrp  = (document.getElementById('le-mrp')  || {}).value || '';
  var role = document.getElementById('le-role');
  var care = document.getElementById('le-care');
  var ward = (document.getElementById('le-ward') || {}).value || '';
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (mrp === 'Cardiology') {
    if (role) role.value = 'mrp';
    if (care) care.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
    lePill('on');
  } else {
    if (role) role.value = 'consultant';
    if (care) care.value = 'directive';
  }
  syncLeRolePills();
  leUpdateRuleHint(null);
}

function leRolePill(val) {
  var roleEl = document.getElementById('le-role');
  if (roleEl) roleEl.value = val;
  syncLeRolePills();
  var mrpEl = document.getElementById('le-mrp');
  var careEl = document.getElementById('le-care');
  var ward = (document.getElementById('le-ward') || {}).value || '';
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (val === 'mrp') {
    if (mrpEl)  mrpEl.value  = 'Cardiology';
    if (careEl) careEl.value = icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily';
  } else {
    if (mrpEl && mrpEl.value === 'Cardiology') mrpEl.value = 'Other';
    if (careEl) careEl.value = 'directive';
  }
  leUpdateRuleHint(null);
}

function syncLeRolePills() {
  var val = (document.getElementById('le-role') || {}).value || 'consultant';
  var mrp = document.getElementById('le-role-mrp');
  var con = document.getElementById('le-role-con');
  if (mrp) mrp.className = 'ap-list-pill' + (val === 'mrp'        ? ' on' : '');
  if (con) con.className = 'ap-list-pill' + (val === 'consultant' ? ' on' : '');
}

// Whether a ward is a Cardiology MRP ward where this group is primary
function _isCardiologyMRPWard(ward) {
  return ward === 'CCU' || ward === '2S' || ward === '2W';
}

function leWardChange() {
  var ward   = (document.getElementById('le-ward') || {}).value || '';
  var bedLbl = document.getElementById('le-bed-lbl');
  if (bedLbl) bedLbl.textContent = ward === 'CCU' ? 'Bed #' : 'Room';
  var bedInp = document.getElementById('le-bed');
  if (bedInp) bedInp.value = '';
  // Apply defaults for new ward
  var isMRP = _isCardiologyMRPWard(ward);
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  var mrpEl  = document.getElementById('le-mrp');
  var roleEl = document.getElementById('le-role');
  var careEl = document.getElementById('le-care');
  if (mrpEl)  mrpEl.value  = isMRP ? 'Cardiology' : 'Other';
  if (roleEl) roleEl.value = isMRP ? 'mrp' : 'consultant';
  if (careEl) careEl.value = isMRP ? (icuWards.indexOf(ward) !== -1 ? 'ccu' : 'daily') : 'directive';
  lePill(isMRP ? 'on' : 'off');
  syncLeRolePills();
  leUpdateRuleHint(null);
}

function leUpdateRuleHint(p) {
  var hint = document.getElementById('le-rule-hint');
  if (!hint) return;
  var newWard = (document.getElementById('le-ward') || {}).value || '';
  var newList = (document.getElementById('le-list') || {}).value || 'on';
  var oldList = p ? p.list : null;

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

