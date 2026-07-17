// 05_render.js — Render rounds list (geo + alpha + off service)
//
// v4.19 change: alphaRow (on-service alphabetical view) now places
// the room/bed number on a dedicated second row — identical structure
// to offRow — rather than appended inline to the patient name.
// Also adds the lastSeenByGroup chip on that row (was absent from
// alphaRow previously). No change to offRow, wardHtml, or any
// billing/data logic.
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════

// Returns a small chart/summary button for a patient id
// Pencil edit button
function pencilBtn(pid) {
  return '<button class="row-icon-btn" data-pid="' + pid + '" title="Edit patient" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
         '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
         '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
}

// Clipboard (claim history) button
function chartBtn(pid) {
  return '<button class="row-icon-btn" data-pid="' + pid + '" title="Claim history" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
         '<svg viewBox="0 0 24 24">' +
           '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>' +
           '<rect x="9" y="3" width="6" height="4" rx="1"/>' +
           '<line x1="9" y1="12" x2="15" y2="12"/>' +
           '<line x1="9" y1="16" x2="13" y2="16"/>' +
         '</svg></button>';
}

// Discharge button
function dischBtn(pid) {
  return '<button class="row-icon-btn row-icon-disch" data-pid="' + pid + '" title="Discharge" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
         '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>' +
         '<polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>';
}

// Right-side icon column for every patient row
function rowIcons(pid) {
  return '<div class="row-icons">' + pencilBtn(pid) + chartBtn(pid) + dischBtn(pid) + '</div>';
}

// Dispatch function — avoids inline quote issues
function rowIconAction(btn, action) {
  var pid = btn.getAttribute('data-pid');
  if (action === 'edit')    openPatientEdit(pid);
  if (action === 'summary') openPatientSummary(pid);
  if (action === 'disch')   openDischModal(pid);
}

function wardAvCls(ward) {
  if (ward === 'CCU')  return 'av-ccu';
  if (ward === '2S')   return 'av-2s';
  if (ward === '2W')   return 'av-2w';
  return 'av-on';
}

// v4.32: Stranded patient — MRP Cardiology, on-service, but NOT on a
// Cardiology home ward (CCU/2S/2W). These patients are stuck in ED or
// another ward and must appear on BOTH the on-service and off-service
// lists for rounding safety. The off-service doctor rounds on them daily;
// on weekends the on-service doctor covers them.
function isStranded(p) {
  return p.list === 'on' && !p.discharged &&
         p.role === 'mrp' && p.mrp === 'Cardiology' &&
         !_isCardiologyMRPWard(p.ward);
}

// v4.37: Handover flag — new admissions or on-call issues flagged for handover.
// handover = 'new' (new patient admission) | 'oncall' (existing patient, on-call issue) | false
function isHandover(p) {
  return !p.discharged && !!p.handover && p.handover !== 'false';
}

function clearHandover(pid) {
  var p = getP(pid);
  if (!p) return;
  p.handover = false;
  stampFieldTs(p, 'handover');   // v4.72: tap-timestamp — newest tap wins on merge
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Handover acknowledged', (st.doc && st.doc.alias) || '');
  render();
}

// v4.61: Toggle handover flag on/off directly from a patient card
function toggleHandoverFlag(pid) {
  var p = getP(pid);
  if (!p) return;
  var wasOn = !!p.handover && p.handover !== 'false';
  p.handover = wasOn ? false : 'oncall';
  stampFieldTs(p, 'handover');   // v4.72: tap-timestamp — newest tap wins on merge
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, wasOn ? 'Handover flag cleared' : 'Flagged for handover', (st.doc && st.doc.alias) || '');
  render();
}

// v4.62: bordered footer row with the three card-level actions.
// Fixed order on every card (Handover / Claim Hx / D/C) for muscle memory.
// Names are a FIXED size in CSS (.wp-name) — the v4.61 JS auto-fit is gone.
function cardFootHtml(p) {
  var on = !!p.handover && p.handover !== 'false';
  return '<div class="card-foot">' +
    '<button class="foot-btn foot-flag' + (on ? ' on' : '') + '" data-pid="' + p.id + '"' +
      ' onclick="event.stopPropagation();toggleHandoverFlag(this.getAttribute(\'data-pid\'))"' +
      ' title="' + (on ? 'Clear handover flag' : 'Flag for handover') + '">' +
      '<svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' +
      '<span>Handover</span>' +
    '</button>' +
    '<button class="foot-btn foot-hx" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'summary\')">' +
      '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>' +
      '<span>Claim Hx</span>' +
    '</button>' +
    '<button class="foot-btn foot-dc" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'disch\')">' +
      '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
      '<span>D/C</span>' +
    '</button>' +
    '</div>';
}

function handoverSectionHtml(patients) {
  if (!patients.length) return '';
  return '<div class="handover-block">' +
    '<div class="ward-hdr">' +
      '<div class="ward-lbl" style="color:#7a6d00">\u2691 For Handover (' + patients.length + ')</div>' +
    '</div>' +
    '<div style="padding:0 12px 4px;font-size:10px;color:#7a6d00;line-height:1.4">' +
      'Tap the \u2691 Handover button to clear.' +
    '</div>' +
    safeRowMap(patients, handoverRow) +
    '</div>';
}

function handoverRow(p) {
  // v4.63: no text label above the card \u2014 the yellow handover-card styling
  // and the solid flag pill in the footer already signal it.
  // Clearing is done via the card's own ⚑ flag button (toggleHandoverFlag).
  return alphaRow(p).replace('class="alpha-row', 'class="alpha-row handover-card');
}

function roleChip(p) {
  if (p.role === 'mrp') {
    return '<span class="chip chip-blue">Cardiology MRP</span>';
  }
  // Consultant — show who the MRP is if known
  var mrpLabel = p.mrp && p.mrp !== 'Other' ? p.mrp + ' MRP' : 'Consultant';
  var cls = p.care === 'directive' ? 'chip-amber' : p.care === 'combined' ? 'chip-teal' : 'chip-grey';
  return '<span class="chip ' + cls + '">' + mrpLabel + '</span>';
}

function render() {
  TODAY = todayStr(); // refresh in case app was open past midnight
  if (!st.loaded) return;
  updateDailyTotal();
  var all = st.patients.filter(function(p) { return !p.discharged; });
  var on  = all.filter(function(p) { return p.list === 'on';  }).length;
  var off = all.filter(function(p) { return p.list === 'off'; }).length;

  // Update tab counts
  var onCount  = document.getElementById('ls-on-count');
  var offCount = document.getElementById('ls-off-count');
  // v4.37: handover badge on on-service tab
  var _hoOnN = all.filter(function(p) { return p.list === 'on' && isHandover(p); }).length;
  if (onCount) onCount.innerHTML = (on ? '(' + on + ')' : '') +
    (_hoOnN ? ' <span style="color:#7a6d00;font-weight:800">\u2691' + _hoOnN + '</span>' : '');
  // v4.32: stranded patients (MRP Cardiology off home wards) shown on
  // both lists — red ⚠ badge on off-service tab when any exist.
  if (offCount) {
    var _strandedN = all.filter(isStranded).length;
    var _hoOffN    = all.filter(function(p) { return p.list === 'off' && isHandover(p); }).length;
    offCount.innerHTML = (off ? '(' + off + ')' : '') +
      (_hoOffN ? ' <span style="color:#7a6d00;font-weight:800">\u2691' + _hoOffN + '</span>' : '') +
      (_strandedN ? ' <span style="color:var(--red-t);font-weight:800">\u26A0' + _strandedN + '</span>' : '');
  }

  // Search overrides list selection — show unified results across On + Off Service
  if (_roundsQuery) {
    renderRoundsSearch();
    return;
  }

  // Not searching: hide search-view, show appropriate list view
  var searchView = document.getElementById('search-view');
  var onView     = document.getElementById('on-view');
  var offView    = document.getElementById('off-view');
  if (searchView) searchView.style.display = 'none';
  if (onView)     onView.style.display     = (_listView === 'on')  ? 'block' : 'none';
  if (offView)    offView.style.display    = (_listView === 'off') ? 'block' : 'none';

  if (_listView === 'on') {
    if (_geoView === 'geo') renderGeo();
    else renderAlpha();
  } else {
    renderOff();
  }
}

// Unified search view across both On and Off Service lists
function renderRoundsSearch() {
  var searchView = document.getElementById('search-view');
  var onView     = document.getElementById('on-view');
  var offView    = document.getElementById('off-view');
  if (searchView) searchView.style.display = 'block';
  if (onView)     onView.style.display     = 'none';
  if (offView)    offView.style.display    = 'none';

  var matches = st.patients
    .filter(function(p) {
      if (p.discharged) return false;
      var name = (p.last + ' ' + p.first).toLowerCase();
      return name.indexOf(_roundsQuery) !== -1 || (p.phn || '').indexOf(_roundsQuery) !== -1;
    })
    .sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });

  if (!matches.length) {
    searchView.innerHTML = '<div class="empty" style="padding:24px 0">No active patients matching &ldquo;' + esc(_roundsQuery) + '&rdquo;</div>';
    return;
  }

  // Group by list for clarity
  var onMatches  = matches.filter(function(p) { return p.list === 'on';  });
  var offMatches = matches.filter(function(p) { return p.list === 'off'; });

  var html = '';
  if (onMatches.length) {
    html += '<div class="sec-lbl">On Service (' + onMatches.length + ')</div>';
    html += safeRowMap(onMatches, alphaRow);
  }
  if (offMatches.length) {
    html += '<div class="sec-lbl" style="margin-top:10px">Off Service (' + offMatches.length + ')</div>';
    html += safeRowMap(offMatches, alphaRow);
  }
  searchView.innerHTML = html;
}

// Safe row mapper: wraps each renderer in try/catch so one bad row
// can't kill the whole list. Returns a placeholder for failing rows.
function safeRowMap(arr, renderFn) {
  return arr.map(function(p) {
    try { return renderFn(p); }
    catch (e) {
      console.error('[row render] failed for', p, e);
      return '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' +
        esc(String(p && p.last || '?')) + ', ' + esc(String(p && p.first || '?')) + '</div>';
    }
  }).join('');
}

// statBox removed — counts now shown in tab labels
var _offView = 'alpha'; // 'alpha' | 'location' — off-service view toggle

// ── Geographic view ────────────────────────────────────
function renderGeo() {
  // v4.37: Handover patients pinned to very top of geo view
  var _ho = st.patients.filter(function(p) { return p.list === 'on' && isHandover(p); })
    .sort(function(a, b) { return String(a.last || '').localeCompare(String(b.last || '')); });
  var h = handoverSectionHtml(_ho) + otherLocationsHtml() + wardHtml('CCU') + wardHtml('2S') + wardHtml('2W');
  document.getElementById('geo-view').innerHTML = h;
}

// v4.09: Safety net — on-service patients on wards outside CCU/2S/2W
// were previously invisible. renderGeo only renders those three wards,
// and the off-service list filters by p.list === 'off', so an on-service
// patient on ED/3E/3W/ICU/CSICU/etc. fell into a blind spot — visible only
// to whoever opened the alphabetical view or searched. This block lists
// them above CCU when any exist and is suppressed when empty.
// v4.32: split into stranded (MRP Cardiology → red) and other (amber).
// Stranded patients also appear on the off-service list for rounding safety.
// v4.77: handover-flagged patients are excluded here — they're already pinned
// in the yellow handover block at the very top of the geo view, so they were
// showing twice (yellow then red). Once the ⚑ flag is acknowledged/cleared,
// isHandover() goes false and they drop back into the red/amber block below.
// (Alphabetical view already worked this way — this matches it.)
function otherLocationsHtml() {
  var pts = st.patients.filter(function(p) {
    return p.list === 'on' && !p.discharged && !isHandover(p) &&
           p.ward !== 'CCU' && p.ward !== '2S' && p.ward !== '2W';
  });
  if (!pts.length) return '';
  function _sortByWardName(arr) {
    return arr.slice().sort(function(a, b) {
      var wa = String(a.ward || ''), wb = String(b.ward || '');
      if (wa !== wb) return wa.localeCompare(wb);
      return String(a.last || '').localeCompare(String(b.last || ''));
    });
  }
  var stranded = _sortByWardName(pts.filter(isStranded));
  var other    = _sortByWardName(pts.filter(function(p) { return !isStranded(p); }));
  var h = '';
  if (stranded.length) {
    h += '<div class="ward-block" style="border-left:3px solid var(--red-t);background:var(--red-bg)">' +
      '<div class="ward-hdr">' +
        '<div class="ward-lbl" style="color:var(--red-t)">\u26A0 Cardiology MRP \u2014 Off Regular Wards (' + stranded.length + ')</div>' +
      '</div>' +
      '<div style="padding:0 12px 8px;font-size:11px;color:var(--red-t);line-height:1.4">' +
        'Also shown on off-service list for rounding safety.' +
      '</div>' +
      safeRowMap(stranded, alphaRow) +
      '</div>';
  }
  if (other.length) {
    h += '<div class="ward-block" style="border-left:3px solid var(--amber-t)">' +
      '<div class="ward-hdr">' +
        '<div class="ward-lbl">\u26A0 Other Locations (' + other.length + ')</div>' +
      '</div>' +
      '<div style="padding:0 12px 8px;font-size:11px;color:var(--text3);line-height:1.4">' +
        'On-service patients outside CCU / 2S / 2W \u2014 verify each location is correct.' +
      '</div>' +
      safeRowMap(other, alphaRow) +
      '</div>';
  }
  return h;
}

function wardHtml(ward) {
  var pts   = st.patients.filter(function(p) { return p.ward === ward && p.list === 'on' && !p.discharged; });
  var wdef  = WARDS[ward] || {};
  var isCCU = ward === 'CCU';
  var isWard = ward === '2S' || ward === '2W';

  var wardCls = ward === 'CCU' ? 'ward-block-ccu' : ward === '2S' ? 'ward-block-2s' : ward === '2W' ? 'ward-block-2w' : '';
  var h = '<div class="ward-block ' + wardCls + '">' +
    '<div class="ward-hdr">' +
      '<div class="ward-lbl">' + wdef.label + '</div>' +
    '</div>';

  // Sort beds in ascending order.
  // Normalise by stripping trailing single letter suffix for numeric comparison
  // so 217A and 217 sort together, 225A before 225B.
  function _bedKey(bed) {
    var s = String(bed || '').trim();
    // Extract leading number and optional letter suffix: "225A" -> [225, "A"]
    var m = s.match(/^(\d+)([A-Za-z]?)(.*)$/);
    if (m) return [parseInt(m[1], 10), m[2].toUpperCase(), m[3]];
    // CCU single digits 1-8
    var n = parseInt(s, 10);
    if (!isNaN(n)) return [n, '', ''];
    // Hallway / non-numeric — sort last
    return [99999, s, ''];
  }
  pts = pts.slice().sort(function(a, b) {
    var ak = _bedKey(a.bed), bk = _bedKey(b.bed);
    if (ak[0] !== bk[0]) return ak[0] - bk[0];
    if (ak[1] !== bk[1]) return ak[1] < bk[1] ? -1 : 1;
    return ak[2].localeCompare(bk[2]);
  });

  if (!pts.length) {
    h += '<div class="empty">No patients on ' + wdef.label + '</div>';
  } else {
    h += '<div class="ward-list">';
    pts.forEach(function(p, i) {
      try {
        var dn  = claimedToday(p);
        // Circle label: bed # for CCU, room # for 2S/2W, index for others
        var pos = isCCU  ? (p.bed || (i+1))
                : isWard ? (p.bed || (i+1))
                :          (i+1);
        h += '<div class="wp' + (dn ? ' done' : '') + '">' +
             '<div class="card-body">' +
             '<div class="wp-pos-wrap">' +
               '<div class="wp-pos' + (dn ? ' done' : '') + '" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' + esc(String(pos)) + '</div>' +
             '</div>' +
             '<div class="wp-main">' +
               '<div class="wp-name-row">' +
                 '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' +
                   esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) +
                 '</span>' +
                 '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')" title="Edit">' +
                   '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                 '</button>' +
               '</div>' +
               '<div class="wp-meta">' + calcAgeGender(p) + ' &bull; ' + mrpLabel(p) + '</div>' +
               '<div class="wp-acts">' +
                 wardActBtns(p) +
                 '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
               '</div>' +
             '</div>' +
             '</div>' +
             cardFootHtml(p) +
             '</div>';
      } catch (e) {
        console.error('[wardHtml] failed for', p, e);
        h += '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' +
             esc(String(p && p.last || '?')) + ', ' + esc(String(p && p.first || '?')) + '</div>';
      }
    });
    h += '</div>';
  }

  var notYet = pts.filter(function(p) { return !claimedToday(p); }).length;
  if (isCCU) {
    h += '<button class="batch-btn" style="margin-top:8px" onclick="batchRoundWard(this)" data-ward="' + ward + '">' +
         '<span>Round all ' + wdef.label + (notYet ? ' (' + notYet + ' pending)' : ' \u2713 all done') + '</span>' +
         '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' +
         '</button>';
  }

  return h + '</div>';
}

// ── Alphabetical view ──────────────────────────────────
function renderAlpha() {
  var on = st.patients
    .filter(function(p) { return p.list === 'on' && !p.discharged; })
    .sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });
  // v4.37: handover patients pinned to very top
  var handover = on.filter(isHandover);
  var rest     = on.filter(function(p) { return !isHandover(p); });
  // v4.34: stranded patients pinned to top of alpha view (same as geo + off)
  var stranded = rest.filter(isStranded);
  var regular  = rest.filter(function(p) { return !isStranded(p); });
  var h = handoverSectionHtml(handover);
  if (stranded.length) {
    h += '<div class="ward-block" style="border-left:3px solid var(--red-t);background:var(--red-bg);margin-bottom:12px">' +
      '<div class="ward-hdr">' +
        '<div class="ward-lbl" style="color:var(--red-t)">\u26A0 Cardiology MRP \u2014 Off Regular Wards (' + stranded.length + ')</div>' +
      '</div>' +
      '<div style="padding:0 12px 8px;font-size:11px;color:var(--red-t);line-height:1.4">' +
        'Round daily \u2014 also shown on off-service list.' +
      '</div>' +
      safeRowMap(stranded, alphaRow) +
      '</div>';
  }
  h += regular.length ? safeRowMap(regular, alphaRow) : (!stranded.length && !handover.length ? '<div class="empty">No on-service patients.</div>' : '');
  document.getElementById('alpha-view').innerHTML = h;
}

// ── Off service view ───────────────────────────────────
var _offView = 'alpha'; // 'alpha' | 'location'

function setOffView(v) {
  _offView = v;
  renderOff();
}

function renderOff() {
  var off = st.patients.filter(function(p) { return p.list === 'off' && !p.discharged; });

  // v4.37: handover patients pinned to very top of off-service
  var _hoOff = off.filter(isHandover)
    .sort(function(a, b) { return String(a.last || '').localeCompare(String(b.last || '')); });

  // v4.32: stranded patients — MRP Cardiology stuck outside home wards.
  // Shown at the top of the off-service list so the rounding doctor sees them.
  var stranded = st.patients.filter(isStranded)
    .sort(function(a, b) { return String(a.last || '').localeCompare(String(b.last || '')); });

  var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<div class="ward-lbl">Off Service</div></div>';

  h += handoverSectionHtml(_hoOff);

  if (stranded.length) {
    h += '<div class="ward-block" style="border-left:3px solid var(--red-t);background:var(--red-bg);margin-bottom:12px">' +
      '<div class="ward-hdr">' +
        '<div class="ward-lbl" style="color:var(--red-t)">\u26A0 Cardiology MRP \u2014 Off Regular Wards (' + stranded.length + ')</div>' +
      '</div>' +
      '<div style="padding:0 12px 8px;font-size:11px;color:var(--red-t);line-height:1.4">' +
        'On-service patients outside CCU / 2S / 2W \u2014 round daily.' +
      '</div>' +
      safeRowMap(stranded, alphaRow) +
      '</div>';
  }

  // View toggle — named functions avoid inline quote issues
  var onAlpha = _offView === 'alpha'    ? ' on' : '';
  var onLoc   = _offView === 'location' ? ' on' : '';
  h += '<div class="view-tog" style="margin-bottom:10px">' +
    '<button class="vt' + onAlpha + '" onclick="setOffViewAlpha()">' +
      '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>Alphabetical</button>' +
    '<button class="vt' + onLoc + '" onclick="setOffViewLoc()">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>By location</button>' +
    '</div>';

  if (!off.length) {
    h += '<div class="empty">No off-service patients.</div>';
    document.getElementById('off-list').innerHTML = h;
    return;
  }

  if (_offView === 'alpha') {
    var sorted = off.slice().sort(function(a, b) { return String(a.last || "").localeCompare(String(b.last || "")); });
    h += safeRowMap(sorted, offRow);
  } else {
    // By location: clinical priority — ED, ICU, CSICU, then numbered wards.
    // Within numbered wards: A/B together, then E/W together.
    function _wardSortKey(w) {
      if (!w) return [99, '', ''];
      if (w === 'ED') return [0, '', ''];
      if (w === 'ICUA' || w === 'ICUB' || w === 'ICUD') return [1, w.slice(3), ''];
      if (w === 'CSICU') return [2, '', ''];
      var m = w.match(/^(\d+)([A-Z]+)?$/);
      if (m) {
        var floor = parseInt(m[1], 10);
        var suffix = m[2] || '';
        var grp = (suffix === 'A' || suffix === 'B') ? 0
                : (suffix === 'E' || suffix === 'W') ? 1 : 2;
        return [10 + floor, grp, suffix];
      }
      return [90, w, ''];
    }
    var sorted = off.slice().sort(function(a, b) {
      var ka = _wardSortKey(a.ward), kb = _wardSortKey(b.ward);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
      if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
      return String(a.last || "").localeCompare(String(b.last || ""));
    });
    var curWard = null;
    sorted.forEach(function(p) {
      if (p.ward !== curWard) {
        curWard = p.ward;
        h += '<div style="font-size:10px;font-weight:700;color:var(--text3);' +
             'text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px">' +
             wardLabel(p.ward) + '</div>';
      }
      h += offRow(p);
    });
  }

  document.getElementById('off-list').innerHTML = h;
}

// Find the most recent claim for this patient by any cardiologist in the group.
// Returns chip HTML like "Last seen by KB May 1" or empty string if never billed.
function lastSeenByGroup(p) {
  if (!p.phn) return '';
  var newest = null;
  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (c.phn !== p.phn) continue;
    if (!c.date) continue;
    var t = parseDMYsafe(c.date);
    if (!t) continue;
    if (!newest || t > newest.t) newest = { t: t, claim: c };
  }
  if (!newest) return '';

  var d = new Date(newest.t);
  var monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var label = monthsShort[d.getMonth()] + ' ' + d.getDate();
  var alias = newest.claim.alias || '?';

  // Days since — thresholds tied to directive care intervals (2/week ~= every 3-4 days)
  var days = Math.floor((Date.now() - newest.t) / 86400000);
  var color;
  if (days > 5)       color = 'var(--red-t)';    // overdue
  else if (days >= 3) color = 'var(--amber-t)';  // approaching limit
  else                color = 'var(--text3)';    // recent (<= 2 days)

  // v4.62.1: match the meta-row size (12px), lightly bolded; colour still
  // encodes recency (grey ≤2d, amber 3-4d, red >5d overdue).
  return '<span style="font-size:12px;color:' + color + ';font-weight:600' +
    ';margin-left:2px;white-space:nowrap">Last seen by ' + esc(alias) + ' ' + label + '</span>';
}

// Age + sex only, e.g. "72M" or "—"  (used on off-service row 3)
function ageGenderShort(p) {
  if (!p.dob) return p.sex || '—';
  var dobClean = fmtClaimDate(p.dob);
  var parts = dobClean.split('/');
  if (parts.length !== 3) return p.sex || '—';
  var dob = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
  var now = new Date();
  var yr  = now.getFullYear() - dob.getFullYear();
  var mo  = now.getMonth()    - dob.getMonth();
  if (mo < 0 || (mo === 0 && now.getDate() < dob.getDate())) yr--;
  if (isNaN(yr) || yr < 0 || yr > 130) return p.sex || '—';
  return yr + (p.sex || '');
}

// Single off-service patient row
function offRow(p) {
  var dn       = claimedToday(p);
  // Circle shows ward abbreviation for off-service
  var wardAbbr = String(wardLabel(p.ward) || '').replace('Ward ', '').replace('ICU ', 'ICU').slice(0, 5);
  // v4.62: room lives under the ward circle (loc-col); last-seen joins row 3
  var lastSeen = lastSeenByGroup(p);
  // Row 3: Age (Sex) · MRP · Dx
  var ageSex   = ageGenderShort(p);
  var row3     = esc(ageSex) + ' &bull; ' + mrpLabel(p) + lastBilledChip(p);
  return '<div class="alpha-row pt-card' + (dn ? ' done' : '') + '">' +
    '<div class="card-body">' +
    '<div class="loc-col" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' +
      '<div class="alpha-av av-off" style="font-size:9px;font-weight:800;letter-spacing:-.3px">' + esc(wardAbbr) + '</div>' +
      (p.bed ? '<span class="loc-room">' + esc(String(p.bed)) + '</span>' : '') +
    '</div>' +
    '<div class="wp-main">' +
      '<div class="wp-name-row">' +
        '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' + esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) + '</span>' +
        '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
          '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="wp-meta">' + row3 + lastSeen + '</div>' +
      '<div class="wp-acts">' + quickActBtns(p) +
        '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
      '</div>' +
    '</div>' +
    '</div>' +
    cardFootHtml(p) +
    '</div>';
}

// Age in years + sex from patient record, e.g. "72F", "55M", "—"
function calcAgeGender(p) {
  var age = '';
  if (p.dob) {
    // Normalise DOB defensively in case it wasn't caught on load/sync
    var dobClean = fmtClaimDate(p.dob);
    var parts = dobClean.split('/');
    if (parts.length === 3) {
      var dob = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
      var now = new Date();
      var yr  = now.getFullYear() - dob.getFullYear();
      var mo  = now.getMonth() - dob.getMonth();
      if (mo < 0 || (mo === 0 && now.getDate() < dob.getDate())) yr--;
      if (!isNaN(yr) && yr >= 0 && yr < 130) age = String(yr);
    }
  }
  // Format: AgeGender  e.g. "77M"  (DOB removed — age+gender already shown)
  var ageGender = (age + (p.sex || '')) || '';
  return ageGender || '—';
}

function alphaRow(p) {
  var dn      = claimedToday(p);
  var avCls   = wardAvCls(p.ward);
  // v4.34: red border on stranded patient cards for safety visibility
  var _stranded = isStranded(p) ? ' stranded-card' : '';
  // Circle shows ward abbreviation (same as off-service)
  var wardAbbr = String(wardLabel(p.ward) || '').replace('Ward ', '').replace('ICU ', 'ICU').slice(0, 5);
  // v4.62: room lives under the ward circle (loc-col); last-seen joins meta row
  var lastSeen = lastSeenByGroup(p);
  return '<div class="alpha-row pt-card' + (dn ? ' done' : '') + _stranded + '">' +
    '<div class="card-body">' +
    '<div class="loc-col" data-pid="' + p.id + '" onclick="openLocationEditEl(this)" title="Tap to move patient">' +
      '<div class="alpha-av ' + avCls + '" style="font-size:9px;font-weight:800;letter-spacing:-.3px">' + esc(wardAbbr) + '</div>' +
      (p.bed ? '<span class="loc-room">' + esc(String(p.bed)) + '</span>' : '') +
    '</div>' +
    '<div class="wp-main">' +
      '<div class="wp-name-row">' +
        '<span class="wp-name" data-pid="' + p.id + '" onclick="openSummaryEl(this)">' + esc(String(p.last || '')) + ', ' + esc(String(p.first || '')) + '</span>' +
        '<button class="row-pencil-btn" data-pid="' + p.id + '" onclick="event.stopPropagation();rowIconAction(this,\'edit\')">' +
          '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="wp-meta">' + calcAgeGender(p) + ' &bull; ' + mrpLabel(p) + lastBilledChip(p) + lastSeen + '</div>' +
      '<div class="wp-acts">' + quickActBtns(p) +
        '<button class="bb bb-add" data-pid="' + p.id + '" onclick="event.stopPropagation();wpAddClaim(this)">+ Claim</button>' +
      '</div>' +
    '</div>' +
    '</div>' +
    cardFootHtml(p) +
    '</div>';
}

// Quick action buttons shown on each patient card
// MRP label for patient meta line — replaces PHN tail
function mrpLabel(p) {
  if (p.role === 'mrp') return 'MRP: Cardiology';
  if (p.mrp && p.mrp !== 'Other') return 'MRP: ' + p.mrp;
  return 'Consulting';
}

// One-tap buttons for ward rows based on role + MRP
// - Cardiology MRP   → + Daily
// - CCU/ICU MRP      → + CCU daily
// - Consulting       → + Directive  + Combined daily
function wardActBtns(p) {
  if (showsCCUDaily(p)) {
    var ccuDone = claimedTodayFee(p, ['CCU_DAILY','1411','1421','1431']);
    return ccuDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickCCUBtn(this)" title="Tap to undo">✓ CCU daily</button>'
      : '<button class="bb bb-ccu" data-pid="' + p.id + '" onclick="event.stopPropagation();quickCCUBtn(this)">+ CCU daily</button>';
  }
  if (p.role === 'mrp') {
    var dailyDone = claimedTodayFee(p, ['33008']);
    return dailyDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)" title="Tap to undo">✓ Daily</button>'
      : '<button class="bb bb-rnd" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)">+ Daily</button>';
  }
  // Consulting
  var dirDone  = claimedTodayFee(p, ['33006']);
  var combDone = claimedTodayFee(p, ['33008']);
  return (dirDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDirectiveBtn(this)" title="Tap to undo">✓ Directive</button>'
      : '<button class="bb bb-dir" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDirectiveBtn(this)">Directive</button>') +
    (combDone
      ? '<button class="bb bb-done" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)" title="Tap to undo">✓ Combined daily</button>'
      : '<button class="bb bb-comb" data-pid="' + p.id + '" onclick="event.stopPropagation();quickDailyBtn(this)">Combined daily</button>');
}

function showsCCUDaily(p) {
  // CCU daily only when Cardiology is MRP — consulting cardiologists get Directive/Combined daily
  var icuWards = ['CCU','CSICU','ICUA','ICUB','ICUD'];
  if (icuWards.indexOf(p.ward) === -1) return false;
  return p.role === 'mrp';
}

// Instantly style a quick-tap button as done (dark green ✓) before render().
// This gives immediate visual feedback without waiting for DOM re-render.
function bbDone(btn, label) {
  btn.className = 'bb bb-done';
  btn.textContent = '✓ ' + label;
  btn.disabled = true;
}

function quickActBtns(p) {
  // Alpha and off-service views reuse same role logic as ward rows
  return wardActBtns(p);
}
// ── Batch round ────────────────────────────────────────
function batchRound(ward) {
  if (!checkDoc()) return;
  var pts = st.patients.filter(function(p) {
    return p.ward === ward && p.list === 'on' && !claimedToday(p);
  });
  if (!pts.length) { showToast('All ' + wardLabel(ward) + ' patients already rounded'); return; }
  pts.forEach(function(p) {
    // v3.60: CCU_DAILY placeholder for CCU ward. Export-time consolidation
    // assigns the correct 1411/1421/1431 band based on episode position.
    var fee = ward === 'CCU' ? 'CCU_DAILY' : '33008';
    addClaim(p, fee, fee, 1, TODAY, 'I');
  });
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('Rounded ' + pts.length + ' on ' + ward + ' — tap any to adjust');
  render();
}

// ── Reorder ward patients ──────────────────────────────
function reorder(ward, pid, dir) {
  st.patients = dedupById(st.patients);   // v4.64: never bulk-push same-id duplicates
  var wPts = st.patients.filter(function(p) { return p.ward === ward && p.list === 'on'; });
  var idx  = wPts.findIndex(function(p) { return p.id === pid; });
  var nIdx = idx + dir;
  if (nIdx < 0 || nIdx >= wPts.length) return;
  var gA = st.patients.indexOf(wPts[idx]);
  var gB = st.patients.indexOf(wPts[nIdx]);
  var tmp = st.patients[gA]; st.patients[gA] = st.patients[gB]; st.patients[gB] = tmp;
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatients', { patients: st.patients });
  render();
}

// ── Quick one-tap claims ───────────────────────────────
// quickClaim replaced by data-pid button handlers


// quickCCU replaced by data-pid button handlers


// ── One-tap billing handlers (use data-pid, no inline quote issues) ──

function alreadyBilledToday(pid, feeTypes) {
  var p = getP(pid);
  if (!st.doc) return false;
  return st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) &&
           c.alias === st.doc.alias &&
           c.date === TODAY &&
           feeTypes.indexOf(c.fee) !== -1;
  });
}

// Remove today's claim for this patient+fee — returns true if removed
function unbillToday(pid, feeTypes) {
  var p = getP(pid);
  if (!st.doc) return false;
  var idx = -1;
  for (var i = 0; i < st.claims.length; i++) {
    var c = st.claims[i];
    if (samePhn(c.phn, p.phn) && c.alias === st.doc.alias &&
        c.date === TODAY && feeTypes.indexOf(c.fee) !== -1) {
      idx = i; break;
    }
  }
  if (idx === -1) return false;
  var removed = st.claims.splice(idx, 1)[0];
  if (SHEETS_URL) push('deleteClaim', { id: removed.id });
  // v4.49: refresh CCFPP for peers after an unbill.
  if (removed) ccfppRecomputeAround_(removed.alias, removed.date);
  var stillHasClaims = st.claims.some(function(c) {
    return samePhn(c.phn, p.phn) && c.alias === st.doc.alias && c.date === TODAY;
  });
  if (!stillHasClaims) {
    p.lastBilled   = null;
  } else {
    p.lastBilled = null;
  }
  sv('patients', st.patients);
  sv('claims', st.claims);
  return true;
}

// ── Required-field guard ────────────────────────────────
// Per MSP rules: every claim needs a referring MD and a diagnosis.
// If a patient is missing either, the quick-tap shortcut routes them
// into the full claim form with the missing fields highlighted as required.
function needsRefAndDx(p) {
  var missing = [];
  if (!p) return missing;
  if (!p.refby || !p.refbyName) missing.push('refby');
  if (!p.icd) missing.push('icd');
  return missing;
}

// Open full claim screen with the chosen claim type pre-selected and
// missing required fields flagged. Used by quick-tap shortcuts when
// the patient is missing required referring MD or diagnosis.
function openClaimWithRequiredFields(pid, claimType) {
  _requiredFieldsPending = needsRefAndDx(getP(pid));
  openClaimScreen(pid);
  setTimeout(function() {
    selCT(claimType);
    setTimeout(highlightMissingFields, 50);
  }, 50);
}

function highlightMissingFields() {
  if (!_requiredFieldsPending || !_requiredFieldsPending.length) return;
  var bodyEl = document.getElementById('claim-body');
  if (!bodyEl) return;

  // Banner at top of claim body
  var banner = document.getElementById('required-field-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'required-field-banner';
    banner.style.cssText = 'background:var(--amber-bg);color:var(--amber-t);' +
      'padding:10px 12px;border-radius:var(--rsm);font-size:12px;font-weight:700;' +
      'margin-bottom:10px;border:.5px solid var(--amber-t)';
    var msgs = [];
    if (_requiredFieldsPending.indexOf('refby') !== -1) msgs.push('referring MD');
    if (_requiredFieldsPending.indexOf('icd') !== -1) msgs.push('diagnosis (ICD-9)');
    banner.textContent = 'Required for billing: please add ' + msgs.join(' and ') + ' before saving.';
    bodyEl.insertBefore(banner, bodyEl.firstChild);
  }

  // Highlight any matching ref/icd search inputs in the form
  ['cb-ref-search','ce-ref-search','pe-ref-search','oc-ref-search'].forEach(function(id) {
    if (_requiredFieldsPending.indexOf('refby') !== -1) {
      var el = document.getElementById(id);
      if (el) el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
    }
  });
  ['cb-icd-search','ce-icd-search','pe-icd-search','oc-icd-search'].forEach(function(id) {
    if (_requiredFieldsPending.indexOf('icd') !== -1) {
      var el = document.getElementById(id);
      if (el) el.style.cssText = 'border:1.5px solid var(--amber-t);background:var(--amber-bg)';
    }
  });
}

var _requiredFieldsPending = [];

// Validate a patient has required fields BEFORE adding any claim.
// Returns true if OK to proceed, false if missing fields (caller should NOT submit).
// Shows a toast naming what's missing.
function validateRequiredForClaim(p) {
  var missing = needsRefAndDx(p);
  if (!missing.length) return true;
  var labels = [];
  if (missing.indexOf('refby') !== -1) labels.push('referring MD');
  if (missing.indexOf('icd')   !== -1) labels.push('diagnosis');
  showToast('Missing ' + labels.join(' & ') + ' - required for billing');
  return false;
}

function quickDailyBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed — toggle off (undo)
  if (alreadyBilledToday(pid, ['33008'])) {
    if (unbillToday(pid, ['33008'])) {
      showToast('Daily removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  if (alreadyBilledToday(pid, ['CCU_DAILY','1411','1421','1431','33006'])) {
    showToast('A different visit already claimed today');
    return;
  }
  // Required field check — open full form if missing
  var p0 = getP(pid);
  if (needsRefAndDx(p0).length) {
    var t = p0.care === 'combined' ? 'combined' : 'daily';
    openClaimWithRequiredFields(pid, t);
    return;
  }
  var p = getP(pid);
  if (p.care === 'combined') {
    // First combined daily for this patient — need reason on file
    if (!p.combinedDailyReason) {
      openCombinedReasonModal(pid, function() {
        // After reason saved, fire the quick claim
        var p2 = getP(pid);
        bbDone(btn, 'Combined daily');
        addClaim(p2, '33008', '33008', 1, TODAY, 'I', null, p2.combinedDailyReason || '');
        p2.lastBilled = 'Combined daily';
        sv('patients', st.patients); sv('claims', st.claims);
        showToast('✓ Combined daily — ' + p2.last);
        requestAnimationFrame(render);
      });
      return;
    }
    bbDone(btn, 'Combined daily');
    addClaim(p, '33008', '33008', 1, TODAY, 'I', null, p.combinedDailyReason || '');
    p.lastBilled = 'Combined daily';
    sv('patients', st.patients); sv('claims', st.claims);
    showToast('✓ Combined daily — ' + p.last);
    requestAnimationFrame(render);
    return;
  }
  var label = 'Daily';
  bbDone(btn, label);
  addClaim(p, '33008', '33008', 1, TODAY, 'I');
  p.lastBilled   = label;
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ ' + label + ' — ' + p.last);
  requestAnimationFrame(render);
}

function quickDirectiveBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed today — toggle off (undo), same as daily/CCU
  if (alreadyBilledToday(pid, ['33006'])) {
    if (unbillToday(pid, ['33006'])) {
      showToast('Directive removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  // Hard limit: 2 directives per week, no exceptions
  var cnt = dirCountThisWeek(getP(pid).phn);
  if (cnt >= 2) {
    showToast('2 directive visits already claimed this week');
    openPatientSummary(pid);
    return;
  }
  // Required field check — open full form if missing
  if (needsRefAndDx(getP(pid)).length) {
    openClaimWithRequiredFields(pid, 'directive');
    return;
  }
  var p = getP(pid);
  bbDone(btn, 'Directive');
  addClaim(p, '33006', '33006', 1, TODAY, 'I');
  p.lastBilled   = 'Directive';
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ Directive — ' + p.last);
  requestAnimationFrame(render);
}

function quickCCUBtn(btn) {
  var pid = btn.getAttribute('data-pid');
  if (!checkDoc()) return;
  // If already billed — toggle off (undo)
  if (alreadyBilledToday(pid, ['CCU_DAILY','1411','1421','1431'])) {
    if (unbillToday(pid, ['CCU_DAILY','1411','1421','1431'])) {
      showToast('CCU daily removed — ' + getP(pid).last);
      render();
    }
    return;
  }
  if (alreadyBilledToday(pid, ['33008','33006'])) {
    showToast('A different visit already claimed today');
    return;
  }
  // Required field check — open full form if missing
  if (needsRefAndDx(getP(pid)).length) {
    openClaimWithRequiredFields(pid, 'ccu');
    return;
  }
  var p   = getP(pid);
  // v3.60: write CCU_DAILY placeholder; export consolidates to 1411/1421/1431
  // based on consecutive episode position. The user-facing label stays
  // friendly ("CCU day") since the per-day band isn't meaningful until export.
  var fee = 'CCU_DAILY';
  bbDone(btn, 'CCU day');
  addClaim(p, fee, fee, 1, TODAY, 'I');
  p.lastBilled   = 'CCU day';
  sv('patients', st.patients);
  sv('claims', st.claims);
  showToast('✓ CCU day — ' + p.last);
  requestAnimationFrame(render);
}

// Show what was last billed as a chip on the done card
function lastBilledChip(p) {
  if (!p.lastBilled || !claimedToday(p)) return '';
  return '<span class="chip chip-green" style="font-size:9px;padding:1px 6px">' + esc(p.lastBilled) + '</span>';
}

// Named wrappers for data-ward buttons (avoid inline quote issues)
function batchRoundWard(btn) { batchRound(btn.getAttribute('data-ward')); }
function openAddWard(btn)    { openAdd(btn.getAttribute('data-ward')); }

function wpAddClaim(btn) {
  openClaimScreen(btn.getAttribute('data-pid'));
}

