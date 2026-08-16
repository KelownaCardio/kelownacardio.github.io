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
        + '<div style="display:flex;gap:6px">'
        + '<button class="btn btn-p" style="margin:0;font-size:12px;padding:6px 12px" onclick="pullArchivedPatient(\'' + esc(p.id) + '\')">Pull claims</button>'
        + '<button class="btn btn-s" style="margin:0;font-size:12px;padding:6px 12px" onclick="pullArchivedAndClaim(\'' + esc(p.id) + '\')">+ Claim</button>'
        + '</div>'
        + '</div>';
    }).join('');
    box.innerHTML = '<div style="font-size:11px;color:var(--text3);margin:4px 2px 6px">Archive matches (loads into the calendar for editing):</div>' + rows;
  } catch (e) {
    box.innerHTML = '<div style="font-size:12px;color:var(--amber-t);padding:8px 2px">Archive search failed — check connection and retry.</div>';
  }
}
// v4.99: normalise a raw Patients-sheet row into the shape the app expects.
// getAllForDataCheck returns UNTOUCHED cell values (Dates serialise to ISO
// strings, all-digit cells to numbers, checkboxes to booleans). syncFromSheets
// normalises the getAll payload the same way; the archive pull never did, so a
// recalled patient carried ISO dobs/discharge dates and a numeric PHN into the
// calendar — dischargeDaysAgo() then read off dischargedAt and reported the
// wrong age.
function _normArchivePatient(raw) {
  var p = Object.assign({}, raw);
  delete p._row;
  if (p.dob)           p.dob           = fmtClaimDate(p.dob);
  if (p.admitDate)     p.admitDate     = fmtClaimDate(p.admitDate);
  if (p.dischargeDate) p.dischargeDate = fmtClaimDate(p.dischargeDate);
  if (p.roundedToday)  p.roundedToday  = fmtClaimDate(p.roundedToday);
  if (p.dischargedAt)  p.dischargedAt  = parseDischargedAt(p.dischargedAt);
  p.discharged = parseBool(p.discharged);
  if (p.phn   != null) p.phn   = String(p.phn);
  if (p.bed   != null) p.bed   = String(p.bed);
  if (p.refby != null) p.refby = String(p.refby);
  if (p.icd   != null) p.icd   = String(p.icd);
  if (p.last  != null) p.last  = fmtName(p.last);
  if (p.first != null) p.first = fmtName(p.first);
  try { sanitizeReferrer(p); } catch (e) {}
  return p;
}

// v4.99: same treatment for a raw Claims-sheet row.
function _normArchiveClaim(raw) {
  var c = Object.assign({}, raw);
  delete c._row;
  if (c.date)      c.date      = fmtClaimDate(c.date);
  if (c.dob)       c.dob       = fmtClaimDate(c.dob);
  if (c.startTime) c.startTime = fmtStartTime(c.startTime);
  if (c.endTime)   c.endTime   = fmtStartTime(c.endTime);
  if (c.phn     != null) c.phn     = String(c.phn);
  if (c.fee     != null) c.fee     = String(c.fee).trim();
  if (c.feeCode != null) c.feeCode = String(c.feeCode).trim();
  if (c.icd     != null) c.icd     = String(c.icd).trim();
  return c;
}

function pullArchivedPatient(pid) {
  if (!_archiveCache) return;
  var raw = _archiveCache.patients.filter(function(x){ return String(x.id) === String(pid); })[0];
  if (!raw) { showToast('Could not load that patient — re-run the search.'); return; }
  var p = _normArchivePatient(raw);          // v4.99
  p._recalled = true;                        // v4.99: drives the archive chip

  // v4.91: PIN the pulled patient (and their claims, by PHN) so the 30s sync
  // merge keeps them. Archived patients are excluded from the filtered getAll,
  // so the remote-authoritative merge used to DROP them from st.patients
  // seconds after the pull. Pins live for the session only; a reload clears them.
  if (!window._pulledPin) window._pulledPin = { pids: {}, phns: {} };
  window._pulledPin.pids[String(p.id)] = Date.now();
  var _pinPhn = String(p.phn || '').replace(/\D/g, '');
  if (_pinPhn) window._pulledPin.phns[_pinPhn] = Date.now();

  // ── v4.99 THE BUG ──────────────────────────────────────────────────────
  // Was: `if (!getP(p.id)) st.patients.push(p);`
  // getP() returns `... || {}` — an empty object, which is TRUTHY — so the
  // negation was ALWAYS false and the recalled patient was NEVER added to
  // st.patients. The claims below were added regardless, so the toast
  // truthfully reported "n claims loaded" while the patient itself was
  // missing. openPatientSummary() then hit its own `if (!p.id) return` and
  // exited silently ("nothing happens"), and the +Claim route rendered a
  // context bar with no name ("blank patient card"). Test .id, not the object.
  var existing = getP(p.id);
  if (!existing || !existing.id) st.patients.push(p);
  // else: already loaded (e.g. pulled earlier this session) — keep the loaded
  // object untouched. The archive cache can be up to 2 min stale, and a
  // recalled patient's edits can't be re-fetched through the filtered getAll,
  // so overwriting here would silently revert session edits.

  var have = {}; st.claims.forEach(function(c){ if (c.id) have[String(c.id)] = true; });
  var pulled = 0;
  _archiveCache.claims.forEach(function(c){
    if (samePhn(c.phn, p.phn) && !have[String(c.id)]) {
      st.claims.push(_normArchiveClaim(c)); pulled++;
    }
  });
  sv('patients', st.patients); sv('claims', st.claims);
  showToast('Recalled ' + p.last + ' — ' + pulled + ' claim' + (pulled === 1 ? '' : 's') + ' loaded');
  hideModal('pt-summary-modal');
  openPatientSummary(p.id);
  renderDischarged((document.getElementById('discharged-search') || {}).value || '');
}

// v4.91: pull an archived patient and go straight to the +Claim screen —
// the "add missing claims to an archived patient" path that previously
// required restoring to a list or the browser console.
function pullArchivedAndClaim(pid) {
  pullArchivedPatient(pid);
  var p = getP(pid);
  if (!p || !p.id) return;             // v4.99: .id test (see note above)
  hideModal('pt-summary-modal');
  openClaimFromDischarged(pid);
}

// v4.99: is this patient a session recall (absent from the filtered getAll)?
function isRecalled(p) {
  if (!p) return false;
  if (p._recalled) return true;
  return !!(window._pulledPin && window._pulledPin.pids && window._pulledPin.pids[String(p.id)]);
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
  // v4.99: make a session recall obvious — it is not on the server's active list
  if (isRecalled(p)) statusChip += ' <span class="chip chip-amber">Recalled from archive</span>';

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

// ══ v5.02: READMISSION CONFIRM ═════════════════════════════════════
// WHY (Kathryn, 2026-08-16, after Hubli / Brown / Verwey): a patient who
// leaves the service and comes back later has TWO admissions — but every
// restore path wiped dischargeDate/dischargedAt/dischargedBy to null, so
// nothing downstream could ever see that a discharge had happened.
// DataCheck's CCU_GAP / DAILY_GAP suppressor is CLAIM-based (78717 /
// 33010 / outpatient) and a simple discharge produces no claim at all
// (78717 needs LOS >= 5), so the days between a real discharge and a
// later readmission were reported as unbilled care — three false MEDIUM
// CCU_GAPs in the 16/08/2026 run (Hubli went to the OR under cardiac
// surgery on 12/08 and was re-consulted on 15/08; nothing was missed).
// Restoring now asks whether this is a NEW admission and, if so, files
// the finished stay in `stayHistory` and stamps a fresh admitDate.
// DataCheck v2.45 reads both as discharge evidence.
//
// SCOPE (Kathryn's rule): INPATIENTS ONLY — MRP cardiology AND at least
// one daily / CCU claim on file. A patient whose whole history is phone
// advice (10001) must never see this prompt.
var _READMIT_INPATIENT_FEES = {
  '33008':1, '33006':1, 'CCU_DAILY':1, '1411':1, '1421':1, '1431':1, '1441':1
};

function needsReadmitConfirm(p) {
  if (!p) return false;
  var isMrpCard = String(p.role || '').toLowerCase() === 'mrp' ||
                  String(p.mrp  || '').toLowerCase() === 'cardiology';
  if (!isMrpCard) return false;
  return (st.claims || []).some(function(c) {
    return samePhn(c.phn, p.phn) &&
           _READMIT_INPATIENT_FEES[String(c.fee || '').trim()] === 1;
  });
}

// File the stay that just ended onto the patient record, so the discharge
// survives the restore. Newest last, capped at 10 entries.
function _recordPriorStay(p) {
  if (!p || !p.dischargeDate) return;
  var d = fmtClaimDate(p.dischargeDate);
  if (!d) return;
  var hist = [];
  try { hist = JSON.parse(p.stayHistory || '[]'); } catch (e) { hist = []; }
  if (!Array.isArray(hist)) hist = [];
  var last = hist.length ? hist[hist.length - 1] : null;
  if (!last || last.d !== d) {
    hist.push({ a: p.admitDate ? fmtClaimDate(p.admitDate) : '', d: d });
  }
  if (hist.length > 10) hist = hist.slice(hist.length - 10);
  p.stayHistory = JSON.stringify(hist);
}

// 'YYYY-MM-DD' (native date input) -> 'DD/MM/YYYY'. Blank/bad input -> ''.
function _isoToDMY(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
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

// v5.02: inpatients are asked the readmission question first; everyone
// else (phone-advice-only, non-MRP) restores exactly as before.
function _doRestore(pid, list) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  if (needsReadmitConfirm(p)) { _askReadmit(pid, list); return; }
  _doRestoreCommit(pid, list, 'same', '');
}

function _askReadmit(pid, list) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  var body  = document.getElementById('merge-body');
  var title = document.getElementById('merge-title');
  // No modal shell (shouldn't happen) — never block the restore over it.
  if (!body || !title) { _doRestoreCommit(pid, list, 'same', ''); return; }

  var n = new Date();
  var iso = n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2)
                            + '-' + ('0' + n.getDate()).slice(-2);
  var dOut = p.dischargeDate ? fmtClaimDate(p.dischargeDate) : '';

  title.textContent = 'Readmission?';
  body.innerHTML =
    '<div style="font-size:13px;margin-bottom:6px">' +
      esc(p.last + ', ' + p.first) + ' was discharged' +
      (dOut ? ' <strong>' + esc(dOut) + '</strong>' : '') +
      (p.dischargedBy ? ' by ' + esc(p.dischargedBy) : '') + '.' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">' +
      'Is this a new admission, or was that discharge entered by mistake?' +
    '</div>' +
    '<label style="font-size:12px;color:var(--text2)">Readmitted on</label>' +
    '<input type="date" id="rd-date" value="' + iso + '" ' +
      'style="width:100%;margin:4px 0 14px;padding:10px;font-size:15px;' +
      'border:1px solid var(--line);border-radius:8px">' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button class="btn btn-p" style="margin:0" data-pid="' + esc(pid) + '" data-list="' + esc(list) + '" ' +
        'onclick="_doRestoreCommit(this.dataset.pid,this.dataset.list,\'new\',(document.getElementById(\'rd-date\')||{}).value||\'\')">' +
        'New admission — start a new stay</button>' +
      '<button class="btn btn-s" style="margin:0" data-pid="' + esc(pid) + '" data-list="' + esc(list) + '" ' +
        'onclick="_doRestoreCommit(this.dataset.pid,this.dataset.list,\'same\',\'\')">' +
        'Same stay — the discharge was a mistake</button>' +
    '</div>';
  showModal('merge-modal');
}

// mode 'new'  = readmission: the finished stay is filed in stayHistory and a
//               fresh admitDate is stamped, so billing gaps between the two
//               stays are correctly ignored.
// mode 'same' = the discharge was an error: nothing is filed, because the
//               patient never left and those days ARE billable.
function _doRestoreCommit(pid, list, mode, isoDate) {
  var p = (st.patients || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  hideModal('merge-modal');
  var _hotSnap = snapHot(p);   // v4.73
  var prevDisch = p.dischargeDate ? fmtClaimDate(p.dischargeDate) : '';

  if (mode === 'new') {
    _recordPriorStay(p);                       // must run BEFORE the wipe below
    p.admitDate = _isoToDMY(isoDate) || fmtD(new Date());
  }

  p.discharged    = false;
  p.dischargedAt  = null;
  p.dischargeDate = null;
  p.dischargedBy  = '';
  p.list          = list;
  if (list === 'on' && !p.ward) p.ward = 'OTHER';
  stampChangedGroups(p, _hotSnap);   // v4.73: restore = discharge+location tap
  sv('patients', st.patients);
  if (SHEETS_URL) push('savePatient', p);
  logChange(p,
    mode === 'new' ? 'Readmitted' : 'Restored',
    mode === 'new'
      ? 'New admission ' + p.admitDate +
        (prevDisch ? ' — previous stay closed ' + prevDisch : '')
      : 'Returned to ' + (list === 'on' ? 'On Service' : 'Off Service'));
  showToast(mode === 'new'
    ? p.last + ' readmitted — new stay from ' + p.admitDate
    : p.last + ' restored to ' + (list === 'on' ? 'on-service' : 'off-service') + ' list');
  renderDischarged(document.getElementById('discharged-search') ? document.getElementById('discharged-search').value : '');
  render();
}

