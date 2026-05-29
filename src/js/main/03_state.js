// 03_state.js — App state, local storage, Google Sheets sync
// ═══════════════════════════════════════════════════════

var st = {
  doc:        null,  // { alias, num, name }
  patients:   [],    // array of patient objects
  claims:     [],    // array of claim objects (including raw CCU_DAILY taps)
  refs:       [],    // referrer directory
  doctors:    [],    // doctor profiles
  changelog:  [],    // change log entries
  recentIcds: [],    // recently used ICD-9 codes
  recentRefs: [],    // recently used referrers
  loaded:     false
};

// UI state
var _listView = 'on';   // 'on' | 'off'
var _geoView  = 'geo';  // 'geo' | 'alpha'
var _roundsQuery = '';  // active search filter on rounds pane
var _claimPid = null;   // patient id open in claim screen
var _locPid   = null;   // patient id open in location screen
var _locWard  = null;   // selected ward in location screen
var _mitPats  = [];     // meditech import staging
var _mitDisch = [];     // meditech: on-service patients flagged for discharge
var _incUnits = 1;      // modifier increment units on consult form
var _mostOn   = true;   // MOST toggle state

var TODAY = todayStr();
var STORAGE_PREFIX = 'kgh5:';

// ── Local storage (falls back to artifact storage or localStorage) ──
var LS = window.storage || {
  get: async function(k) {
    try { var v = localStorage.getItem(k); return v ? { value: v } : null; } catch(e) { return null; }
  },
  set: async function(k, v) {
    try { localStorage.setItem(k, v); return { ok: true }; } catch(e) { return null; }
  },
  delete: async function(k) {
    try { localStorage.removeItem(k); return { ok: true }; } catch(e) { return null; }
  }
};

// Bump this any time you need to force-wipe every device's localStorage cache.
// On load, if the stored buildId doesn't match, ALL kgh5:* keys are wiped before
// loadLocal runs. This is the central kill-switch for stuck stale data.
var BUILD_ID    = 'v4.19-2026-05-29-consult-end-time-editable';

// Human-readable version strings used by the visible footer and startup log.
// Bump these together with BUILD_ID on every meaningful change.
var APP_VERSION = 'v4.19';
var APP_BUILT   = '2026-05-29';

console.log('%c[KGH Billing] ' + APP_VERSION + ' · built ' + APP_BUILT,
            'color:#1a5fa8;font-weight:600');

(function purgeIfBuildChanged() {
  try {
    var stored = localStorage.getItem('kgh5:buildId');
    if (stored !== BUILD_ID) {
      // Wipe every kgh5:* key EXCEPT user-preference keys that should survive a build bump
      var preserve = ['kgh5:doc', 'kgh5:recentIcds', 'kgh5:recentRefs', 'kgh5:customWards'];
      var toWipe = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('kgh5:') === 0 && preserve.indexOf(k) === -1) toWipe.push(k);
      }
      toWipe.forEach(function(k) { localStorage.removeItem(k); });
      localStorage.setItem('kgh5:buildId', BUILD_ID);
      console.log('[kgh] Build changed → wiped', toWipe.length, 'localStorage keys (preserved:', preserve.length, ')');
    }
  } catch(e) {}
})();

async function loadLocal() {
  var localOnlyKeys = ['doc','recentIcds','recentRefs'];
  for (var i = 0; i < localOnlyKeys.length; i++) {
    var k = localOnlyKeys[i];
    try {
      var r = await LS.get(STORAGE_PREFIX + k);
      if (r) {
        if (k === 'doc') st.doc = JSON.parse(r.value);
        else st[k] = JSON.parse(r.value);
      }
    } catch(e) {}
  }
  // Clear any stale clinical data from localStorage to avoid confusion.
  // Use direct localStorage.removeItem since it's synchronous and always available.
  ['patients','claims','doctors','changelog','refs'].forEach(function(k) {
    try { localStorage.removeItem(STORAGE_PREFIX + k); } catch(e) {}
  });
  // Legacy confirmed-tracking keys (replaced by window._pendingPush in v2.83) — purge.
  try {
    localStorage.removeItem(STORAGE_PREFIX + 'confirmedClaims');
    localStorage.removeItem(STORAGE_PREFIX + 'confirmedPatients');
  } catch(e) {}
  // Normalise and patch locally-saved claims
  if (Array.isArray(st.claims)) {
    var _localByPhn = {};
    if (Array.isArray(st.patients)) {
      st.patients.forEach(function(p) { if (p.phn) _localByPhn[String(p.phn)] = p; });
    }
    st.claims.forEach(function(c) {
      if (c.startTime) c.startTime = fmtStartTime(c.startTime);
      if (c.date)      c.date      = fmtClaimDate(c.date);
      if (c.dob)       c.dob       = fmtClaimDate(c.dob);
      if (c.fee)       c.fee       = String(c.fee).trim();
      if (c.feeCode)   c.feeCode   = String(c.feeCode).trim();
      if (c.icd)       c.icd       = String(c.icd).trim();
      sanitizeReferrer(c);
      // Back-fill missing fields from patient record
      var pat = _localByPhn[String(c.phn || '')];
      if (pat) {
        if (!c.refby     && pat.refby)     c.refby     = pat.refby;
        if (!c.refbyName && pat.refbyName && !looksLikeMRPService(pat.refbyName)) c.refbyName = pat.refbyName;
        if (!c.icd       && pat.icd)       c.icd       = pat.icd;
      }
      if (!c.icd)       c.icd       = '3062';
      if (c.endTime) c.endTime = fmtStartTime(c.endTime);
    });
  }
  if (Array.isArray(st.patients)) {
    st.patients.forEach(function(p) {
      // Normalise DOB — Sheets may store as ISO timestamp (1943-05-05T07:00:00.000Z)
      if (p.dob) p.dob = fmtClaimDate(p.dob);
      if (p.roundedToday) p.roundedToday = fmtClaimDate(p.roundedToday);
      if (p.dischargedAt) p.dischargedAt = parseDischargedAt(p.dischargedAt);
      p.discharged   = parseBool(p.discharged);
      // Coerce string-y fields — see sync block for rationale
      if (p.phn   != null) p.phn   = String(p.phn);
      if (p.bed   != null) p.bed   = String(p.bed);
      if (p.last  != null) p.last  = fmtName(p.last);
      if (p.first != null) p.first = fmtName(p.first);
      var hadBadRef = looksLikeMRPService(p.refbyName);
      sanitizeReferrer(p);
      if (hadBadRef && SHEETS_URL) push('savePatient', p);  // push the clean version back to Sheets
    });
  }
}

async function sv(key, val) {
  // Never persist clinical data locally — Sheets is the source of truth.
  // Only persist non-clinical preferences.
  if (key === 'patients' || key === 'claims' || key === 'doctors' || key === 'changelog') return;
  try { await LS.set(STORAGE_PREFIX + key, JSON.stringify(val)); } catch(e) {}
}

// ── Refby sanitiser ────────────────────────────────────
// Strip MRP service strings that have been wrongly written into refbyName.
// A real referring MD is a person's name like "Dr. Smith, John #62289" — never
// a service like "Hospitalist", "Cardiology", or "Hospitalist,KGH Kelowna".
// This runs on every load + sync to clean stale bad data.
var KNOWN_SERVICE_TOKENS = [
  'cardiology','hospitalist','ctu','csicu','icu','cardiac surgery','cardiac surg',
  'general surgery','general surg','orthopedics','orthop','neurology','neurol',
  'nephrology','nephr','internal medicine','respirology','respir','gim',
  'gastroenterology','gastro','oncology','oncol','palliative','palliat',
  'critical care'
];
function looksLikeMRPService(value) {
  if (!value) return false;
  var v = String(value).toLowerCase().trim();
  // Strip everything from first comma onward (handles "Hospitalist,KGH Kelowna")
  var head = v.split(',')[0].trim();
  for (var i = 0; i < KNOWN_SERVICE_TOKENS.length; i++) {
    if (head === KNOWN_SERVICE_TOKENS[i] || head.indexOf(KNOWN_SERVICE_TOKENS[i]) === 0) {
      return true;
    }
  }
  // Also catch combined-form tokens like "CardiologyMRP"
  for (var j = 0; j < KNOWN_SERVICE_TOKENS.length; j++) {
    if (head.indexOf(KNOWN_SERVICE_TOKENS[j] + 'mrp') !== -1) return true;
  }
  return false;
}
function sanitizeReferrer(obj) {
  if (!obj) return;
  if (obj.refbyName && looksLikeMRPService(obj.refbyName)) {
    obj.refbyName = '';
    obj.refby     = '';
  }
}

// ── Google Sheets sync ──
function setSyncState(s) {
  document.getElementById('sync-dot').className = 'sync-dot ' + s;
  var banner = document.getElementById('wifi-banner');
  if (banner) banner.style.display = s === 'error' ? 'flex' : 'none';
}

async function syncFromSheets() {
  if (!SHEETS_URL) return;
  setSyncState('syncing');
  window._syncAttempts = (window._syncAttempts || 0) + 1;
  window._lastSyncError = null;
  // Initialize/update with checkpoint tracking — overwrites prior to show latest attempt's progress
  window._lastSyncResponse = window._lastSyncResponse || {};
  window._lastSyncResponse.attemptN = window._syncAttempts;
  window._lastSyncResponse.checkpoint = 'fetch-start';
  window._lastSyncResponse.startedAt = new Date().toISOString();
  try {
    // Wrap fetch in a 45s timeout so a stalled request is detectable instead of hanging forever
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = setTimeout(function() {
      if (ctrl) ctrl.abort();
    }, 45000);
    var fetchOpts = ctrl ? {
      signal: ctrl.signal,
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit'
    } : { redirect: 'follow', cache: 'no-store', credentials: 'omit' };
    var r;
    try {
      // Cache-bust URL with timestamp to defeat any iOS BFCache fetch interception
      var url = SHEETS_URL + '?action=getAll&key=' + SHARED_KEY + '&_t=' + Date.now();
      r = await fetch(url, fetchOpts);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      var errMsg = fetchErr.name === 'AbortError'
        ? 'Fetch aborted after 45s timeout — Apps Script may be slow or unreachable'
        : 'Fetch failed: ' + (fetchErr.message || fetchErr);
      window._lastSyncError = errMsg;
      window._lastSyncResponse.checkpoint = 'fetch-failed';
      window._lastSyncResponse.fetchError = errMsg;
      setSyncState('error');
      return;
    }
    clearTimeout(timeoutId);
    window._lastSyncResponse.checkpoint = 'fetch-returned';
    window._lastSyncResponse.httpStatus = r.status;
    window._lastSyncResponse.httpOk = r.ok;
    if (!r.ok) {
      window._lastSyncError = 'HTTP ' + r.status + ' ' + r.statusText;
      setSyncState('error');
      return;
    }
    window._lastSyncResponse.checkpoint = 'parsing-json';
    var d = await r.json();
    window._lastSyncResponse.checkpoint = 'json-parsed';
    window._lastSyncResponse.hasError = !!d.error;
    window._lastSyncResponse.error = d.error || null;
    window._lastSyncResponse.patientsType = Array.isArray(d.patients) ? 'array' : (d.patients === null ? 'null' : typeof d.patients);
    window._lastSyncResponse.patientsLength = Array.isArray(d.patients) ? d.patients.length : 'n/a';
    window._lastSyncResponse.claimsType = Array.isArray(d.claims) ? 'array' : (d.claims === null ? 'null' : typeof d.claims);
    window._lastSyncResponse.claimsLength = Array.isArray(d.claims) ? d.claims.length : 'n/a';
    window._lastSyncResponse.keys = Object.keys(d || {});
    window._lastSyncResponse.ts = new Date().toISOString();
    console.log('[sync] response shape:', window._lastSyncResponse);
    if (d.error) {
      window._lastSyncError = 'Apps Script: ' + d.error;
      setSyncState('error');
      return;
    }

    var NOW_MS      = Date.now();
    var GRACE_MS    = 2 * 60 * 1000; // 2 min — anything older than this is not "in flight"

    // ── Merge patients ────────────────────────────────────
    // Remote is authoritative. Local-only patients are kept only
    // if they were created within the last 2 min (push still in flight).
    // Anything older that isn't on Sheets was deliberately removed — drop it.
    if (d.patients && Array.isArray(d.patients)) {
      window._lastSyncResponse.patientsMergeRan = true;
      d.patients.forEach(function(p) {
        // Normalise DOB from Sheets ISO timestamp
        if (p.dob) p.dob = fmtClaimDate(p.dob);
        if (p.roundedToday) p.roundedToday = fmtClaimDate(p.roundedToday);
        if (p.dischargedAt) p.dischargedAt = parseDischargedAt(p.dischargedAt);
        p.discharged   = parseBool(p.discharged);
        // Coerce phn/bed/last/first to string — Sheets returns them as numbers when
        // the cell happens to be all-digits, breaking string ops like .slice and lookup keys.
        if (p.phn   != null) p.phn   = String(p.phn);
        if (p.bed   != null) p.bed   = String(p.bed);
        if (p.last  != null) p.last  = fmtName(p.last);
        if (p.first != null) p.first = fmtName(p.first);
        var hadBadRef = looksLikeMRPService(p.refbyName);
        sanitizeReferrer(p);
        if (hadBadRef && SHEETS_URL) push('savePatient', p);  // overwrite stale bad data on Sheets
      });

      // Back-fill blank refby/refbyName on patient from their claim history
      d.patients.forEach(function(p) {
        if (!p.refby || !p.refbyName) {
          var patClaims = (d.claims || []).filter(function(c) {
            return samePhn(c.phn, p.phn) && c.refby && c.refbyName && !looksLikeMRPService(c.refbyName);
          });
          patClaims.sort(function(a, b) { return (b.id || '').localeCompare(a.id || ''); });
          if (patClaims.length) {
            var best = patClaims[0];
            if (!p.refby)     p.refby     = best.refby;
            if (!p.refbyName) p.refbyName = best.refbyName;
            if (SHEETS_URL) push('savePatient', p);
          }
        }
      });
      var remoteById = {};
      d.patients.forEach(function(p) { remoteById[p.id] = true; });

      var merged = d.patients.map(function(rp) {
        var lp = st.patients.find(function(p) { return p.id === rp.id; });
        if (!lp) return rp;
        // If a push for this patient is still pending (not yet confirmed by Sheets),
        // the local version reflects an unconfirmed update — prefer local.
        // This prevents discharge / restore / field updates from being clobbered
        // by a stale remote row when sync runs before the push completes.
        var isPending = window._pendingPush && window._pendingPush[lp.id];
        if (isPending) return Object.assign({}, lp);
        // Otherwise remote wins.
        return Object.assign({}, rp);
      });

      // Clear pending entries ONLY if the remote row reflects the pending update.
      // We compare a few key fields that update-style pushes touch.
      d.patients.forEach(function(rp) {
        if (!window._pendingPush || !window._pendingPush[rp.id]) return;
        var pending = window._pendingPush[rp.id].body;
        // Confirm by checking the discharged flag (most common update) and dischargedAt timestamp
        var dischMatch = parseBool(rp.discharged) === parseBool(pending.discharged);
        var dischAtMatch = !pending.dischargedAt ||
          (parseDischargedAt(rp.dischargedAt) === parseDischargedAt(pending.dischargedAt));
        // Generous timeout fallback: clear pending after 60s regardless
        var stale = (Date.now() - (window._pendingPush[rp.id].ts || 0)) > 60000;
        if ((dischMatch && dischAtMatch) || stale) {
          delete window._pendingPush[rp.id];
        }
      });

      // Keep local patients that are either in-flight OR pending unconfirmed push.
      st.patients.forEach(function(lp) {
        if (!remoteById[lp.id]) {
          var age = NOW_MS - (parseInt(String(lp.id).replace('p','').slice(0,13)) || 0);
          var isPending = window._pendingPush && window._pendingPush[lp.id];
          if (age < GRACE_MS || isPending) {
            merged.push(lp);
            if (SHEETS_URL) push('savePatient', lp); // retry
          }
        }
      });

      st.patients = merged;
      window._lastSyncResponse.patientsAfterMerge = st.patients.length;
    } else {
      window._lastSyncResponse = window._lastSyncResponse || {};
      window._lastSyncResponse.patientsMergeRan = false;
      window._lastSyncResponse.patientsMergeSkipReason =
        !d.patients ? 'd.patients is falsy' : 'd.patients is not an array';
    }

    // ── Merge claims ──────────────────────────────────────
    // Remote is authoritative. Local-only claims kept only within
    // the grace window (push in flight). Orphaned old local claims dropped.
    if (d.claims && Array.isArray(d.claims)) {
      d.claims.forEach(function(c) {
        var hadBadRef = looksLikeMRPService(c.refbyName);
        sanitizeReferrer(c);
        if (c.date)      c.date      = fmtClaimDate(c.date);
        if (c.startTime) c.startTime = fmtStartTime(c.startTime);
        if (c.fee)       c.fee       = String(c.fee).trim();
        if (c.feeCode)   c.feeCode   = String(c.feeCode).trim();
        if (c.icd)       c.icd       = String(c.icd).trim();
        if (c.phn != null) c.phn = String(c.phn);
        if (hadBadRef && SHEETS_URL) push('saveClaim', c);
      });
      // Normalise startTime — Sheets returns time-only fields as ISO with 1899 epoch
      d.claims.forEach(function(c) {
        if (c.startTime) c.startTime = fmtStartTime(c.startTime);
      });
      var remoteClaimIds = {};
      d.claims.forEach(function(c) { remoteClaimIds[c.id] = true; });

      var mergedClaims = d.claims.slice();

      // Clear pending entries that now appear in Sheets (push succeeded)
      d.claims.forEach(function(c) {
        if (window._pendingPush && window._pendingPush[c.id]) delete window._pendingPush[c.id];
      });

      // Keep local claims that are either in-flight (< 2 min) OR pending unconfirmed push.
      // Never drop a claim that hasn't been confirmed on Sheets yet — retry instead.
      st.claims.forEach(function(lc) {
        if (!remoteClaimIds[lc.id]) {
          var age = NOW_MS - (parseInt(String(lc.id).replace('c','').slice(0,13)) || 0);
          var isPending = window._pendingPush && window._pendingPush[lc.id];
          if (age < GRACE_MS || isPending) {
            mergedClaims.push(lc);
            if (SHEETS_URL) push('saveClaim', lc); // retry
          }
          // else: not on Sheets, not in flight, not pending — safe to drop (was deleted remotely)
        }
      });

      // Patch claim rows that are missing refby/refbyName/icd/startTime.
      // IMPORTANT: Only push back claims that came from Sheets (not local-only new claims).
      // This prevents re-pushing claims that the Apps Script would append as duplicates.
      var _patByPhn = {};
      st.patients.forEach(function(p) { if (p.phn) _patByPhn[String(p.phn)] = p; });
      // Build set of claim IDs that exist in Sheets data (d.claims)
      var _sheetsClaimIds = {};
      (d.claims || []).forEach(function(c) { if (c.id) _sheetsClaimIds[c.id] = true; });
      mergedClaims.forEach(function(c) {
        var needsPatch = !c.refby || !c.refbyName || !c.icd || !c.startTime;
        if (!needsPatch) return;
        // Only push back if this claim already exists in Sheets — otherwise
        // saveClaim will be called naturally when it's first created.
        if (!_sheetsClaimIds[c.id]) return;
        var pat = _patByPhn[String(c.phn || '')];
        var changed = false;
        if (pat) {
          if (!c.refby     && pat.refby)     { c.refby     = pat.refby;     changed = true; }
          if (!c.refbyName && pat.refbyName && !looksLikeMRPService(pat.refbyName))
                                             { c.refbyName = pat.refbyName; changed = true; }
          if (!c.icd       && pat.icd)       { c.icd       = pat.icd;       changed = true; }
        }
        if (!c.icd)       { c.icd = '3062'; changed = true; }
        if (c.endTime) c.endTime = fmtStartTime(c.endTime);
        if (c.dob) {
          var cleanDob = fmtClaimDate(c.dob);
          if (cleanDob !== c.dob) { c.dob = cleanDob; changed = true; }
        }
        if (changed && SHEETS_URL) push('saveClaim', c);
      });
      st.claims = mergedClaims;
    }

    // v3.36: Orphan-claim self-healer. If main-app claims (c-prefix IDs) exist
    // for a PHN that has NO patient row, reconstruct a minimal patient stub
    // from the claim data and push savePatient. This recovers from the race
    // bug fixed above for any pre-existing orphans, and provides defence in
    // depth for future races. Upload-tool claims (8-char IDs) are skipped —
    // historical billing is allowed to lack a patient row by design.
    if (Array.isArray(st.patients) && Array.isArray(st.claims)) {
      var phnHasPatient = {};
      st.patients.forEach(function(p) { if (p.phn) phnHasPatient[String(p.phn)] = true; });
      var orphansByPhn = {};
      st.claims.forEach(function(c) {
        var phn = String(c.phn || '');
        if (!phn || phnHasPatient[phn]) return;
        if (!String(c.id || '').startsWith('c')) return; // skip upload-tool claims
        if (!orphansByPhn[phn]) orphansByPhn[phn] = c;
      });
      Object.keys(orphansByPhn).forEach(function(phn) {
        var src = orphansByPhn[phn];
        // v3.57: don't create a nameless stub — bad data into Sheets
        if (!String(src.last || '').trim()) {
          console.warn('Orphan-claim healer: SKIPPED stub for PHN ' + phn + ' — source claim has no last name');
          return;
        }
        var stub = {
          id:           'p' + Date.now() + Math.floor(Math.random() * 9999),
          last:         fmtName(src.last || ''),
          first:        fmtName(src.first || ''),
          phn:          phn,
          dob:          '',
          sex:          '',
          ward:         '',
          bed:          '',
          fac:          'OA040',
          refby:        src.refby || '',
          refbyName:    src.refbyName || '',
          role:         'consultant',
          mrp:          'Other',
          list:         'off',
          care:         'directive',
          icd:          src.icd || '3062',
          admitDate:    src.date || '',
          roundedToday: null,
          // v3.91: tag healer-built stubs so their blank demographics surface
          // for review instead of masquerading as a complete patient record.
          addedVia:     'app-orphan-healer',
          needsReview:  true,
          createdBy:    '',
          createdAt:    Date.now()
        };
        st.patients.push(stub);
        if (SHEETS_URL) push('savePatient', stub);
        console.warn('Orphan-claim healer: recreated missing patient row for PHN ' + phn + ' (' + stub.last + ', ' + stub.first + ')');
      });
    }

    if (d.doctors)   st.doctors   = d.doctors;
    if (d.changelog) st.changelog = d.changelog;

    ['patients','claims','doctors','changelog'].forEach(function(k) { sv(k, st[k]); });
    window._lastSyncResponse.checkpoint = 'completed';
    window._lastSyncResponse.completedAt = new Date().toISOString();
    window._lastSyncResponse.stPatientsFinal = st.patients.length;
    window._lastSyncResponse.stClaimsFinal = st.claims.length;
    setSyncState('synced');
    render();
    // If user is currently viewing the Recently Discharged pane, refresh it too
    var dischPane = document.getElementById('p-discharged');
    if (dischPane && dischPane.classList.contains('on')) {
      var searchEl = document.getElementById('discharged-search');
      renderDischarged(searchEl ? searchEl.value : '');
    }
  } catch(e) {
    window._lastSyncError = e.message || String(e);
    if (window._lastSyncResponse) {
      window._lastSyncResponse.checkpoint = 'EXCEPTION at ' + (window._lastSyncResponse.checkpoint || 'unknown');
      window._lastSyncResponse.exception = e.message || String(e);
    }
    setSyncState('error');
  }
}

// Sync everything to Sheets then reload for a fresh session.
// st.doc is kept in localStorage so the doctor stays signed in.
async function logoutAndRefresh() {
  var btn = document.getElementById('logout-btn');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }

  // Save all local state to device storage
  try {
    await sv('patients',  st.patients);
    await sv('claims',    st.claims);
    await sv('changelog', st.changelog);
    await sv('doctors',   st.doctors);
  } catch(e) {}

  // Trigger a single full sync to Sheets (non-blocking — fire and move on)
  if (SHEETS_URL) {
    setSyncState('syncing');
    syncFromSheets().catch(function() {});
  }

  // Short pause for visual feedback, then hard reload for a clean session
  // Note: PWAs cannot programmatically close themselves — reload gives a fresh state
  // with all data preserved in localStorage (including st.doc for auto sign-in).
  showToast('Syncing and reloading…');
  setTimeout(function() {
    location.reload(true);
  }, 1200);
}

// Track items that haven't yet been confirmed on Sheets — never dropped on sync.
// Cleared once the item appears in a sync response.
if (!window._pendingPush) window._pendingPush = {};

async function push(action, body) {
  if (!SHEETS_URL) return false;
  // Guard: never push a patient or claim with no id — prevents blank row creation
  if ((action === 'savePatient' || action === 'saveClaim') && (!body || !body.id)) {
    console.warn('push blocked — no id on', action, body);
    return false;
  }
  // Guard: never push a structurally empty patient
  if (action === 'savePatient' && body && !body.last && !body.first && !body.phn) {
    console.warn('push blocked — empty patient record', body);
    return false;
  }
  // Guard: never push a structurally empty claim
  if (action === 'saveClaim' && body && (!body.phn || !body.fee || !body.date)) {
    console.warn('push blocked — empty claim record', body);
    return false;
  }
  // Mark as pending until next successful sync confirms it
  if (action === 'savePatient' || action === 'saveClaim') {
    window._pendingPush[body.id] = { action: action, body: body, ts: Date.now() };
  }
  setSyncState('syncing');
  try {
    var resp = await fetch(SHEETS_URL + '?action=' + action + '&key=' + SHARED_KEY, {
      method: 'POST', body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    // v3.91: inspect the response BODY, not just the HTTP status. Apps Script
    // returns HTTP 200 even when saveRow rejects a record ({ok:false,error}).
    // Treating that as success let rejected patient saves pass silently — the
    // row never landed, and the orphan-claim healer then rebuilt it blank.
    var data = null;
    try { data = await resp.json(); } catch (_) { data = null; }
    if (data && data.ok === false) {
      // Permanent server-side rejection (validation failure). It will never
      // succeed on retry, so drop it from the pending-retry queue and report.
      window._lastPushError = data.error || 'Server rejected the save';
      if (action === 'savePatient' || action === 'saveClaim') {
        delete window._pendingPush[body.id];
      }
      console.warn('push rejected by server — ' + action + ': ' + window._lastPushError);
      // Connection is fine — we got a clean 200 + JSON. This is a data
      // rejection, not a connectivity failure, so do NOT raise the wifi
      // banner; the caller surfaces the specific error to the user.
      setSyncState('synced');
      return false;
    }
    window._lastPushError = null;
    setSyncState('synced');
    return true;
  } catch(e) {
    // Network / transport failure — transient. Leave it in _pendingPush so
    // the next sync retries it.
    window._lastPushError = e.message || String(e);
    setSyncState('error');
    return false;
  }
}

// ── 04_billing.js ──
// ═══════════════════════════════════════════════════════
