// ── 06b_discharged.js ──
// ═══════════════════════════════════════════════════════
// Recently Discharged pane + rounds search filter
// Pane shows discharged patients (last 21 days, or all when searching)
// Each row offers: tap to add a missed claim, restore (to On/Off Service)
// ═══════════════════════════════════════════════════════

function roundsSearch(query) {
  _roundsQuery = (query || '').toLowerCase().trim();
  var clearBtn = document.getElementById('rounds-search-clear');
  if (clearBtn) clearBtn.classList.toggle('on', !!_roundsQuery);
  // Hide geo/alpha toggle when searching (search shows unified flat list)
  var vtBar = document.getElementById('view-tog-bar');
  if (vtBar) vtBar.style.display = (!_roundsQuery && _listView === 'on') ? 'flex' : 'none';
  render();
}

function clearRoundsSearch() {
  var input = document.getElementById('rounds-search');
  if (input) { input.value = ''; input.focus(); }
  roundsSearch('');
}

// ═══════════════════════════════════════════════════════
// ── 06b_discharged.js ──
// ═══════════════════════════════════════════════════════
// Recently Discharged pane + rounds search filter
// Pane shows discharged patients (last 21 days, or all when searching)
// Each row offers: tap to add a missed claim, restore (to On/Off Service)
// ═══════════════════════════════════════════════════════

function roundsSearch(query) {
  _roundsQuery = (query || '').toLowerCase().trim();
  var clearBtn = document.getElementById('rounds-search-clear');
  if (clearBtn) clearBtn.classList.toggle('on', !!_roundsQuery);
  // Hide geo/alpha toggle when searching (search shows unified flat list)
  var vtBar = document.getElementById('view-tog-bar');
  if (vtBar) vtBar.style.display = (!_roundsQuery && _listView === 'on') ? 'flex' : 'none';
  render();
}

function clearRoundsSearch() {
  var input = document.getElementById('rounds-search');
  if (input) { input.value = ''; input.focus(); }
  roundsSearch('');
}

// ═══════════════════════════════════════════════════════
// ── 06b_discharged.js ──
// ═══════════════════════════════════════════════════════
// Recently Discharged pane + rounds search filter
// Pane shows discharged patients (last 21 days, or all when searching)
// Each row offers: tap to add a missed claim, restore (to On/Off Service)
// ═══════════════════════════════════════════════════════

function roundsSearch(query) {
  _roundsQuery = (query || '').toLowerCase().trim();
  var clearBtn = document.getElementById('rounds-search-clear');
  if (clearBtn) clearBtn.classList.toggle('on', !!_roundsQuery);
  // Hide geo/alpha toggle when searching (search shows unified flat list)
  var vtBar = document.getElementById('view-tog-bar');
  if (vtBar) vtBar.style.display = (!_roundsQuery && _listView === 'on') ? 'flex' : 'none';
  render();
}

function clearRoundsSearch() {
  var input = document.getElementById('rounds-search');
  if (input) { input.value = ''; input.focus(); }
  roundsSearch('');
}

// ═══════════════════════════════════════════════════════
// 06b — Recently Discharged pane
// Single-purpose tab. Reads st.patients (populated by syncFromSheets).
// Shows: discharged && trueDischarge==irrelevant && < 21 days (or all if searching)
// Each row: tap to bill missed claim, or restore to On/Off Service.
// ═══════════════════════════════════════════════════════

function initDischarged() {
  var input = document.getElementById('discharged-search');
  if (input) input.value = '';
  renderDischarged('');
}

function dischargedSearch(query) {
  renderDischarged(query);
}

// Render the discharged pane. Pure function over st.patients.
// Defensive about field types — patients arrive from Sheets with mixed types
// (phn could be string or number, dischargedAt could be number or string, etc.).
// ── Archive pull: find + load a >7-day discharged patient into the calendar ──
// Uses getAllForDataCheck (all patients + all sheet claims, incl. unsubmitted).
var _archiveCache = null;   // { patients:[], claims:[], at: ts }
async function archiveSearch() {
  var term = ((document.getElementById('discharged-search') || {}).value || '').trim();
  var box  = document.getElementById('archive-results');
  if (!box) return;
  if (term.length < 2) { box.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:6px 2px">Type at least 2 letters of a last name (or a PHN) in the box above, then tap Search.</div>'; return; }
  box.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px 2px">Searching archive…</div>';
  try {
    if (!_archiveCache || (Date.now() - _archiveCache.at) > 120000) {
      var r = await fetch(SHEETS_URL + '?action=getAllForDataCheck&key=' + SHARED_KEY + '&_t=' + Date.now());
      var j = await r.json();
      if (j && j.error === 'unauthorized') { if (typeof handleUnauthorized === 'function') handleUnauthorized(); box.innerHTML = ''; return; }
      _archiveCache = { patients: (j.patients || []), claims: (j.claims || []), at: Date.now() };
    }
    var tl = term.toLowerCase(), td = term.replace(/\D/g, '');
    var loaded = {}; (st.patients || []).forEach(function(p){ if (p.id) loaded[String(p.id)] = true; });
    var matches = _archiveCache.patients.filter(function(p){
      var nameF = (String(p.last || '') + ' ' + String(p.first || '')).toLowerCase();
      var phnD  = String(p.phn || '').replace(/\D/g, '');
      var hit = (tl && nameF.indexOf(tl) !== -1) || (td.length >= 3 && phnD.indexOf(td) !== -1);
      return hit && !loaded[String(p.id)];
    }).slice(0, 30);
    if (!matches.length) { box.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 2px">No off-list patient matches that.</div>'; return; }
    var rows = matches.map(function(p){
      var claimN = _archiveCache.claims.filter(function(c){ return samePhn(c.phn, p.phn); }).length;
      var dd = p.dischargeDate ? (' &middot; D/C ' + esc(p.dischargeDate)) : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border-radius:8px;padding:9px 11px;margin-bottom:6px">'
        + '<div><div style="font-weight:700;font-size:13px">' + esc(p.last) + ', ' + esc(p.first) + '</div>'
        + '<div style="font-size:11px;color:var(--text2)">PHN …' + esc(String(p.phn || '').slice(-4)) + dd + ' &middot; ' + claimN + ' claim' + (claimN === 1 ? '' : 's') + '</div></div>'
        + '<button class="btn btn-p" style="margin:0;font-size:12px;padding:6px 12px" onclick="pullArchivedPatient(\'' + esc(p.id) + '\')">Pull claims</button>'
        + '</div>';
    }).join('');
    box.innerHTML = '<div style="font-size:11px;color:var(--text3);margin:4px 2px 6px">Archive matches (loads into the calendar for editing):</div>' + rows;
  } catch (e) {
    box.innerHTML = '<div style="font-size:12px;color:var(--amber-t);padding:8px 2px">Archive search failed — check connection and retry.</div>';
  }
}
function pullArchivedPatient(pid) {
  if (!_archiveCache) return;
  var p = _archiveCache.patients.filter(function(x){ return String(x.id) === String(pid); })[0];
  if (!p) { showToast('Could not load that patient — re-run the search.'); return; }
  if (!getP(p.id)) st.patients.push(p);
  var have = {}; st.claims.forEach(function(c){ if (c.id) have[String(c.id)] = true; });
  var pulled = 0;
  _archiveCache.claims.forEach(function(c){
    if (samePhn(c.phn, p.phn) && !have[String(c.id)]) { st.claims.push(c); pulled++; }
  });
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('Pulled ' + p.last + ' — ' + pulled + ' claim' + (pulled === 1 ? '' : 's') + ' loaded');
  hideModal('pt-summary-modal');
  openPatientSummary(p.id);
}
function renderDischarged(query) {
  var container = document.getElementById('discharged-results');
  if (!container) return;
  var q = String(query || '').toLowerCase().trim();

  // Filter for discharged patients. Treat any truthy variant as discharged.
  var pool = (st.patients || []).filter(function(p) {
    return isDischarged(p);
  });

  // Sort newest-first by dischargedAt
  pool.sort(function(a, b) {
    return (toEpochMs(b.dischargedAt) || 0) - (toEpochMs(a.dischargedAt) || 0);
  });

  // Apply 21-day filter unless searching
  var cutoff = Date.now() - (21 * 24 * 60 * 60 * 1000);
  var visible = q ? pool : pool.filter(function(p) {
    var ms = toEpochMs(p.dischargedAt);
    return !ms || ms > cutoff;  // missing timestamps still show
  });

  // Apply search query
  if (q) {
    visible = visible.filter(function(p) {
      var name = String((p.last || '') + ' ' + (p.first || '')).toLowerCase();
      var phn  = String(p.phn || '');
      return name.indexOf(q) !== -1 || phn.indexOf(q) !== -1;
    });
  }

  if (!visible.length) {
    container.innerHTML = q
      ? '<div class="empty" style="padding:18px 0">No match for &ldquo;' + esc(query) + '&rdquo;</div>'
      : '<div class="empty" style="padding:18px 0">No patients discharged in the last 21 days.</div>';
    return;
  }

  // Render each row defensively — wrap in try so one bad row doesn't kill the whole list.
  var rows = visible.map(function(p) {
    try { return dischargedRow(p); }
    catch (e) {
      console.error('[discharged] row render failed for', p, e);
      return '<div class="empty" style="padding:6px 10px;font-size:11px">⚠ Could not render ' + esc(p.last || '?') + ', ' + esc(p.first || '?') + '</div>';
    }
  });

  container.innerHTML = rows.join('');
}

// Type-safe truthy check on the discharged flag.
// Sheets returns variants: boolean true, "true", "TRUE", 1, "1", etc.
function isDischarged(p) {
  if (!p) return false;
  var v = p.discharged;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

// Type-safe epoch ms parser. Accepts number, numeric string, or ISO string.
function toEpochMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? v : 0;
  var s = String(v).trim();
  // Numeric string like "1778182118783" or "1778702261108.0"
  var pf = parseFloat(s);
  if (!isNaN(pf) && pf > 1e12) return Math.round(pf);
  // ISO date string
  var d = Date.parse(s);
  return isNaN(d) ? 0 : d;
}

// Whole calendar days between a patient's discharge and today.
// Counts CALENDAR dates (local), not elapsed 24h periods — a patient
// discharged yesterday evening must read "1 day ago", never "today".
// Prefers the authoritative dischargeDate (DD/MM/YYYY, local); falls back
// to the dischargedAt timestamp reduced to its local calendar date.
// Returns null when neither is present.
function dischargeDaysAgo(p) {
  var dcMs = null;
  if (p && p.dischargeDate) {
    var pd = parseDMYsafe(p.dischargeDate);      // local midnight of that date
    if (pd) dcMs = pd;
  }
  if (dcMs == null && p && p.dischargedAt) {
    var ms = parseDischargedAt(p.dischargedAt);
    if (ms) {
      var dt = new Date(ms);                     // reduce timestamp to local date
      dcMs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    }
  }
  if (dcMs == null) return null;
  var now = new Date();
  var todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((todayMid - dcMs) / 86400000);
}

// Render one discharged-patient row. Defensive about every field type.
function dischargedRow(p) {
  var last  = String(p.last  || '');
  var first = String(p.first || '');
  var phn   = String(p.phn   || '');
  var ward  = String(p.ward  || '');
  var bed   = String(p.bed   || '');
  var pid   = String(p.id    || '');

  var isCCU = ward === 'CCU';
  var avCls = isCCU ? 'av-ccu' : (p.list === 'off' ? 'av-off' : 'av-on');
  var ini   = (first.charAt(0) || '') + (last.charAt(0) || '');

  var daysAgo = dischargeDaysAgo(p);
  var daysLabel = daysAgo === null ? '' : daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1 day ago' : daysAgo + ' days ago';
  var statusChip = '<span class="chip chip-grey">Discharged' + (daysLabel ? ' ' + daysLabel : '') + '</span>';

  var phnDisplay = phn ? 'PHN …' + phn.slice(-4) : '<span class="warn-tag">⚠ no PHN</span>';
  var bedDisplay = bed ? ' Rm ' + esc(bed) : '';

  var careChip = isCCU                    ? '<span class="chip chip-red">CCU</span>'
               : p.care === 'directive'   ? '<span class="chip chip-amber">Directive</span>'
               : p.care === 'combined'    ? '<span class="chip chip-teal">Combined</span>'
               :                             '<span class="chip chip-blue">MRP</span>';

  return '<div class="alpha-row" onclick="openClaimFromDischarged(\'' + esc(pid) + '\')">' +
    '<div class="alpha-av ' + avCls + '">' + esc(ini.toUpperCase()) + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div class="wp-name">' + esc(last) + ', ' + esc(first) + '</div>' +
      '<div class="wp-meta">' + esc(wardLabel(ward)) + bedDisplay + ' &bull; ' + phnDisplay + '</div>' +
      '<div class="wp-chips" style="margin-top:4px">' + careChip + ' ' + statusChip + '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;padding-top:8px">' +
      '<button class="bb bb-rnd" style="font-size:10px;padding:5px 9px" ' +
        'onclick="event.stopPropagation();restorePatient(\'' + esc(pid) + '\')">↩ Restore</button>' +
      chartBtn(pid) +
    '</div>' +
  '</div>';
}

function openClaimFromDischarged(pid) {
  _claimOriginPane   = 'p-discharged';
  _claimOriginNavIdx = 2;
  _openClaimScreen(pid);
}

// Restore — show on/off service choice using data attributes (no inline quote nesting)
function restorePatient(pid) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p || !isDischarged(p)) return;
  var prevWard = wardLabel(p.ward) || '';
  var prevList = p.list === 'on' ? 'On Service' : 'Off Service';
  var body  = document.getElementById('merge-body');
  var title = document.getElementById('merge-title');
  if (!body || !title) { _doRestore(pid, p.list || 'off'); return; }
  title.textContent = 'Restore ' + p.last + ', ' + p.first;
  body.innerHTML =
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">' +
      'Previously: <strong>' + prevList + '</strong>' +
      (prevWard ? ' — ' + esc(prevWard) : '') +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button class="btn btn-p" style="margin:0" data-pid="' + esc(pid) + '" data-list="on" onclick="_doRestore(this.dataset.pid,this.dataset.list)">Restore to On Service list</button>' +
      '<button class="btn btn-s" style="margin:0" data-pid="' + esc(pid) + '" data-list="off" onclick="_doRestore(this.dataset.pid,this.dataset.list)">Restore to Off Service list</button>' +
    '</div>';
  showModal('merge-modal');
}

function _doRestore(pid, list) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  hideModal('merge-modal');
  var _hotSnap = snapHot(p);   // v4.73
  p.discharged    = false;
  p.dischargedAt  = null;
  p.dischargeDate = null;
  p.dischargedBy  = '';
  p.list          = list;
  if (list === 'on' && !p.ward) p.ward = 'OTHER';
  stampChangedGroups(p, _hotSnap);   // v4.73: restore = discharge+location tap
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p, 'Restored', 'Returned to ' + (list === 'on' ? 'On Service' : 'Off Service'));
  showToast(p.last + ' restored to ' + (list === 'on' ? 'on-service' : 'off-service') + ' list');
  renderDischarged(document.getElementById('discharged-search') ? document.getElementById('discharged-search').value : '');
  render();
}

