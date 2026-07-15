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
var BUILD_ID    = 'v4.51-2026-06-28-dedup-export';

// Human-readable version strings used by the visible footer and startup log.
// Bump these together with BUILD_ID on every meaningful change.
// v4.50 (2026-06-25): CCFPP-persist fix — note now baked in before the first
// saveClaim push so it persists on new consults. BUILD_ID intentionally NOT
// bumped (would wipe kgh5:* localStorage incl. the app password → re-login).
// v4.51 (2026-06-28): src re-modularized from the v4.50 production build;
// de-duplicated 11_export.js (kept the newer copy). BUILD_ID bumped to force a
// clean cache wipe (devices will re-enter the app password on next load).
// v4.52 (2026-06-28): room-detection learning log — every chart-header scan
// with a KGH location code logs raw code + decoded vs final ward/room to the
// "Room Detection" sheet (needs backend Crud v3.08 + Router v3.03). No cache
// format change, so BUILD_ID NOT bumped (no re-login).
// v4.53 (2026-06-29): decoder update from the 29/06 baseline — new ward
// KELKGHI1 -> IHSC1 (bed Other), plus room formats for HAH/ED-Main/3MU/4A-
// hallway/REHAB. parseLocCode + LOC_MAP + WARDS. No cache-format change.
// v4.54 (2026-06-29): Leaderboard — added 5th trophy "The Cleaner" (most
// MRP-cardiology discharges in one calendar day). Frontend compute from
// patient records; BigQuery all-time via last MRP-daily claim date. No
// cache-format change.
// v4.56 (2026-06-30): Claim history — (1) phone-advice consults (10001 /
// PhoneAdvice web-form) render dark-blue in the list + calendar (vs yellow
// in-person consults); (2) "Discharged by (initials) on (date)" line, with
// dischargedBy captured at discharge going forward; (3) claim history now
// auto-pulls a patient's older submitted claims from BigQuery (action=
// claimHistory) and shows them read-only. Additive field (dischargedBy);
// no cache-format change, BUILD_ID not bumped.
// v4.57 (2026-07-04): gap-scope fix. Discharge billing-gap gate
// (_cvGapRuleForPatient) now fires ONLY for MRP Cardiology patients; consulting
// & directive-care patients no longer prompt for gap explanations. Pairs with
// backend DataCheck v2.34. Includes the pending v4.56 claim-history changes
// (they share 06c_patient_summary.js). No cache-format change, BUILD_ID not bumped.
// v4.58 (2026-07-05): call-out modifier hardening (07_consult.js). (1) FIX —
// the increment modifier (1205/1206/1207) now inherits the base call-out tier
// instead of being re-clocked at start+30; re-clocking silently dropped the
// increment when its start fell outside the after-hours window (e.g. 07:39
// night consult, increment 08:09 = daytime → 1206 lost). (2) Three pre-save
// confirm() gates on submitConsultClaims: abnormal/midnight end time, consult
// < 30 min, and increment period crossing the after-hours boundary. All are
// user-confirmations, not auto-fixes. No cache-format change, BUILD_ID not bumped.
// v4.59 (2026-07-06): Add-Patient DOB safety check — a live age readout now
// sits under the DOB field and recomputes on every keystroke and after an OCR
// sticker scan fills the DOB. A mis-read date of birth shows an obviously wrong
// age (grey = plausible 17–105, amber = <17 or >105, red = unparseable)
// before the claim is submitted. UI-only, additive; no cache-format change,
// BUILD_ID not bumped. (index.template.html + 14_init.js + 09_patient.js)
//
// v4.60 (2026-07-06): Duplicate-patient "Existing patient found" modal —
// (1) added the missing CSS for its comparison rows (.dup-row/.dup-label/
// .dup-pills/.dup-pill/.dup-pill-tag/.dup-confirm). The old→new
// choice pills were previously unstyled and jammed together; they now render
// as clearly separated, tappable buttons with a highlighted selection.
// (2) The primary button now names WHY the record already exists: a record
// ever on the on/off service list → "Readmit to service"; a phone-consult
// stub → "Move to active service (phone consult)"; anything else (procedure/
// consult-only) → "Move to active service (procedure)". Toast/log verbs follow.
// (3) When demographics disagree, a header line now reads "Inconsistent
// <fields> — please confirm the correct demographics below."; the confirmed
// (new-admission) values are written back over the prior record on merge.
// (4) Removed the top "Currently on list" / "Phone Consult" status badges
// (confusing next to the button wording). Phone-consult button now reads
// "Move to active service (prior phone consult)". UI-only, additive;
// BUILD_ID not bumped. (index.template.html + 09_patient.js)
// v4.62 (2026-07-06): Patient-card redesign — readability + consistent type.
// (1) FIXED name size (17px) on every card; removed the v4.61 fitCardNames()
// JS auto-shrink that produced heterogeneous name sizes. Long names ellipse;
// tap the name for the full summary. (2) Pencil follows the name on a
// no-wrap row so it can never drop onto its own line. (3) Handover /
// Claim Hx / D/C moved from the right-side column into a bordered card
// footer (fixed order, ≥40px tall). (4) Room number now sits under the
// ward circle in the left column (alpha + off-service views; geographic
// view circle already shows the bed). Last-seen chip joined the meta row.
// (5) Labels: "Directive" / "Combined daily" (no +), "+ Other Claim" →
// "+ Claim". (05_render.js + index.template.html; discharged-list rows
// keep the old horizontal .alpha-row layout via the .pt-card modifier.)
// v4.63 (2026-07-06): card-redesign tweaks after live review — ICU wards no
// longer compressed in the ward circle (ICUB not ICB); "Last seen by" chip
// down to 12px/600 to match the meta row (colour still = recency: grey ≤2d,
// amber 3-4d, red >5d); card border strengthened to 1px so card + footer
// read as one unit against the page.
// v4.64 (2026-07-07): SAME-ID PATIENT DEDUP — fix for the Swite duplicate
// (two Patients rows, identical id p1781025811483, handover=false vs
// oncall). Root cause: the bulk savePatients rewrite (fired by reorder)
// persisted a duplicated local array verbatim — no id-dedup, no logging —
// and sync then returned both rows, making the duplicate self-sustaining.
// Fix: new dedupById() (keeps the LAST occurrence = freshest write, at its
// position) applied (a) to remote patients on every sync merge and (b) to
// st.patients before the reorder bulk push. Backend mirror: Crud.gs v3.09
// dedups + ChangeLog-logs inside saveAll itself.
// v4.65 (2026-07-07): Room-detection decoder fixes from the first week of the
// Room Detection log (25 rows, only 4 fully correct). (1) LOC_MAP: KELKGHSCCJ
// → CCU (logged 07-05, corrected to CCU bed 7). (2) ED main-department
// "KGH-Main-<N>" roomBed now parses to "Main N" (3/3 ED rows needed this).
// (3) "ACIN" — on every inpatient ADM line, carries NO location info (Kathryn
// 2026-07-07) — is stripped in parseLocCode, excluded from the learning log
// when captured alone, and the OCR prompt now tells the engine it is not the
// locationCode. Decoder block also mirrored into import.html (hand-uploaded).
// (13_meditech.js + 09_patient.js + import.html.) No cache-format change.
// v4.66 (2026-07-10): app-password persistence. (1) purgeIfBuildChanged now
// preserves APP_PW_LS_KEY so a build bump no longer re-prompts every device.
// (2) handleUnauthorized ignores a single transient 'unauthorized' (flaky wifi);
// only two consecutive hits wipe the stored password + prompt. resetUnauthCount
// clears the counter on any authorized sync and on new-password entry.
// (03_state.js + 14_init.js.) No cache-format change; BUILD_ID unchanged.
// v4.67 (2026-07-10): Add-referring-physician — MSP # now optional. A doctor
// may save a new physician with EITHER the MSP # (preferred) OR both specialty
// AND city; no-number entries save with a blank num + needsLookup and the
// backend emails Kathryn to look the number up. New City field maps to the
// existing Physicians.city column; button relabelled "Save to database". Pairs
// with backend addPhysician email patch. (12_referrers.js.) No cache-format
// change; BUILD_ID unchanged.
// v4.68 (2026-07-10): Add-new-physician form moved into its own bottom-sheet
// modal (#add-phys-modal) so it's not cramped/scrollable inside the Add-Patient
// card on iPhone. (12_referrers.js + index.template.html.) No cache-format
// change; BUILD_ID unchanged.
// v4.69 (2026-07-13): DUP-MODAL REWORK — restoring a patient who only ever had
// a phone consult was clunky and left bad data behind. (1) Banner is now the
// plain question "Patient already exists in database — add to list?" (or "— add
// claim?" on the consult-only path); the Readmit / Move-to-active-service
// (prior phone consult) / (procedure) button labels are gone. (2) The primary
// button reads "Update patient info" whenever the demographics disagree, so the
// tap says what it does. (3) THE DATA FIX: claim rows carry a denormalized copy
// of last/first/phn/dob/sex and link to the patient by PHN ONLY, so correcting a
// PHN used to orphan every prior claim under the old number. The merge now posts
// the confirmed patient + the OLD phn to the new backend route
// mergePatientDemographics (Crud v3.12 / Router v3.04), which in ONE locked pass
// dedups the patient row (absorbing any other row on the old/new PHN) and retags
// every prior claim. The original PHN is stashed on the record (_mergeOldPhn,
// not a sheet header) until the server confirms, so a failed save can be retried
// without losing the retag key. (09_patient.js.) Requires backend v3.12 —
// deploy backend FIRST. No cache-format change; BUILD_ID unchanged.
// v4.70 (2026-07-13): "STUCK PULSING YELLOW" FIX. After the v4.69 deploy the app
// sat on a pulsing amber dot and would not sync. It was not a broken build and not
// the network: the backend was answering 'unauthorized', and THAT path was the one
// exit in syncFromSheets that returned without calling setSyncState — so the dot
// kept the 'syncing' class it was given at the top of the attempt. A rejected
// password was pixel-identical to a sync in progress. Three fixes:
//   1. New 'auth' sync state (red + pulsing) with its own banner text ("App
//      password needed" + an Enter-password button) — the unauthorized branch now
//      sets it, so this can never again masquerade as a busy sync. (03_state.js,
//      index.template.html.)
//   2. handleUnauthorized no longer DELETES the stored password. v4.66 wiped it
//      after 2 consecutive rejections — which is what locked the device out when an
//      Apps Script version switch mid-deploy answered unauthorized twice. It now
//      takes 3 strikes with a 1.5s/3s backoff (a redeploy blip passes in seconds)
//      and only ever REPLACES the credential, never removes it. (14_init.js.)
//   3. submitAppPassword VERIFIES the password against the server (ping is behind
//      the same key gate) before storing it. Previously a typo was written to
//      localStorage and the modal closed — straight back to a silent pulse.
//      Wrong password now says so, in the modal, and keeps the old one. Also a
//      re-entrancy guard so a second prompt can't orphan the first one's promise.
// No cache-format change; BUILD_ID unchanged.
// v4.71 (2026-07-14): "DISCHARGED TODAY" DATE FIX. Both discharge chips (the
// grey chip on discharged-list cards and the badge on the patient-summary card)
// computed days-since-discharge as Math.floor((Date.now() - dischargedAt)/86400000)
// — that is elapsed 24h PERIODS, not calendar days. dischargedAt is a UTC epoch and
// discharges are entered afternoon/evening Pacific (~22:00-00:00 UTC), so when viewed
// the next morning <24h had elapsed and yesterday's discharges read "today"; every
// older count was skewed a day too recent. New shared helper dischargeDaysAgo(p)
// counts CALENDAR days, preferring the authoritative dischargeDate (DD/MM/YYYY, local)
// and falling back to dischargedAt reduced to its local date. (06b_discharged.js,
// 06c_patient_summary.js.) No cache-format change.
// v4.72 (2026-07-15): HANDOVER FLAG MULTI-DEVICE FIX (hot-field last-write-
// wins). During handover two doctors have the app open; every push rebuilds
// the WHOLE patient row, so a device holding a stale copy (5-min poll) pushed
// its old handover value back over a flag the other doctor had just cleared —
// cleared flags "repopulated". Fix, four parts (backend: Crud v3.13 + Config
// v2.35 add a Patients 'fieldTs' JSON column enforcing the same rule server-
// side):
//   1. Every flag/clear (tap, edit sheet, auto-flag) stamps
//      fieldTs.handover = Date.now() via stampFieldTs().
//   2. Sync merge: for HOT_FIELDS the NEWER tap wins regardless of which
//      side (local/remote) is otherwise authoritative; if the local tap is
//      newer AND the value differs, the winner is re-pushed to Sheets.
//   3. Pending-push confirmation now also compares handover — it previously
//      checked only the discharged fields, so a clear was "confirmed" by a
//      sync snapshot taken BEFORE the clear landed, and remote-wins brought
//      the flag straight back on the clearing device itself.
//   4. 14_init: 60s fast poll Mon–Fri 06:50–09:00 + 14:00–15:00 (the real
//      handover/peak windows) so the other open device sees taps within a
//      minute instead of five.
// No cache-format change.
// v4.73 (2026-07-15): HOT-FIELD PROTECTION EXTENDED (same-day rev of v4.72
// before deploy) + RESUME SYNC-GUARD + NOTES COLLISION CHECK.
//   1. Timestamp protection now covers the four things doctors change during
//      handover, as GROUPS under one tap-timestamp each (see HOT_GROUPS):
//      handover flag; summary note (+updatedAt/By); location (ward/bed/list);
//      discharge status (discharged/dischargedAt/dischargeDate/dischargedBy).
//      A group is stamped ONLY when its values actually change (snapHot /
//      stampChangedGroups) so an untouched field never wins a conflict by
//      accident. Backend counterpart: Crud v3.14 HOT_GROUPS_.
//   2. Resume sync-guard (14_init + index.template): reopening the app after
//      >2 min away dims the screen with a "Refreshing…" banner and blocks
//      taps until the first sync lands (8s failsafe) — no more acting on a
//      stale list in the seconds after resume.
//   3. Patient-notes collision check (06c): if the summary was edited on
//      another device while the notes modal was open, Save warns and offers
//      to show the latest text instead of silently overwriting it.
var APP_VERSION = 'v4.73';
var APP_BUILT   = '2026-07-15';

console.log('%c[KGH Billing] ' + APP_VERSION + ' · built ' + APP_BUILT,
            'color:#1a5fa8;font-weight:600');

// ── Same-id dedup (v4.64) ──────────────────────────────────────────────────
// Collapses duplicate ids in a patient array, keeping the LAST
// occurrence (freshest write) at its position. Guards the sync merge
// and the bulk savePatients push (reorder) against the self-sustaining
// duplicate-row loop (Swite, 2026-07-07). Backend mirror: Crud.gs v3.09.
function dedupById(list) {
  if (!Array.isArray(list) || list.length < 2) return list;
  var lastIdx = {};
  list.forEach(function(o, i) {
    var id = (o && o.id != null) ? String(o.id) : '';
    if (id) lastIdx[id] = i;
  });
  var out = list.filter(function(o, i) {
    var id = (o && o.id != null) ? String(o.id) : '';
    return !id || lastIdx[id] === i;
  });
  if (out.length !== list.length) {
    console.warn('[dedupById] removed ' + (list.length - out.length) +
                 ' same-id duplicate patient row(s)');
  }
  return out;
}

(function purgeIfBuildChanged() {
  try {
    var stored = localStorage.getItem('kgh5:buildId');
    if (stored !== BUILD_ID) {
      // Wipe every kgh5:* key EXCEPT user-preference keys that should survive a build bump.
      // v4.66: keep the app password (APP_PW_LS_KEY = 'kgh5:appPw') too — otherwise every
      // deploy re-prompts every device for the KCA password (2026-07-10).
      var preserve = ['kgh5:doc', 'kgh5:recentIcds', 'kgh5:recentRefs', 'kgh5:customWards', APP_PW_LS_KEY];
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
// v4.70: THREE visible states, not two. Before, an 'unauthorized' response left
// the dot on whatever it was last set to — 'syncing' — so a rejected password
// looked identical to a sync in progress: a dot pulsing amber forever, with no
// banner and no clue that the app was sitting on a password prompt. New 'auth'
// state: red pulsing dot + its own banner, so "the app needs the password" can
// never again be mistaken for "the app is busy".
function setSyncState(s) {
  var dot = document.getElementById('sync-dot');
  if (dot) dot.className = 'sync-dot ' + s;

  var banner = document.getElementById('wifi-banner');
  if (!banner) return;
  var txt = document.getElementById('wifi-banner-text');
  var btn = document.getElementById('wifi-banner-btn');

  if (s === 'auth') {
    if (txt) txt.textContent = 'App password needed';
    if (btn) {
      btn.textContent = 'Enter password';
      btn.onclick = function() {
        promptAppPassword('Re-enter the app password to reconnect.')
          .then(function() { syncFromSheets().catch(function() {}); });
      };
    }
    banner.style.display = 'flex';
  } else if (s === 'error') {
    if (txt) txt.textContent = "Can't connect — switch to cellular data";
    if (btn) {
      btn.textContent = 'Retry';
      btn.onclick = function() { setSyncState('syncing'); syncFromSheets(); };
    }
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// ─── v4.72/v4.73: HOT-FIELD LAST-WRITE-WINS (grouped) ────────────────
// Field groups protected by per-tap timestamps — fields that travel
// together move as a group under one timestamp. Keep in sync with
// HOT_GROUPS_ in the backend Crud.gs (v3.14).
var HOT_GROUPS = {
  handover:  ['handover'],
  summary:   ['summary', 'summaryUpdatedAt', 'summaryUpdatedBy'],
  location:  ['ward', 'bed', 'list'],
  discharge: ['discharged', 'dischargedAt', 'dischargeDate', 'dischargedBy']
};

function _parseFieldTs(v) {
  if (v && typeof v === 'object') return v;
  try {
    var o = JSON.parse(String(v || '') || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}

// Stamp a hot-GROUP change with the tap time. fieldTs is kept as a JSON
// STRING on the patient object so it round-trips Sheets unchanged.
function stampFieldTs(p, group) {
  var fts = _parseFieldTs(p.fieldTs);
  fts[group] = Date.now();
  p.fieldTs = JSON.stringify(fts);
}

// v4.73: snapshot every hot field BEFORE a mutation block, then stamp only
// the groups whose values actually changed — an untouched field must never
// win a future conflict just because the patient was saved.
function snapHot(p) {
  var snap = {};
  Object.keys(HOT_GROUPS).forEach(function(g) {
    HOT_GROUPS[g].forEach(function(f) { snap[f] = p[f]; });
  });
  return snap;
}
function stampChangedGroups(p, snap) {
  Object.keys(HOT_GROUPS).forEach(function(g) {
    var changed = HOT_GROUPS[g].some(function(f) {
      return String(p[f] == null ? '' : p[f]) !== String(snap[f] == null ? '' : snap[f]);
    });
    if (changed) stampFieldTs(p, g);
  });
}

// Overlay `other`'s hot groups onto `base` wherever other's tap is newer.
// Returns true if a hot-field VALUE actually changed on base (i.e. base's
// copy was stale) — the caller uses that to decide whether to re-push.
function mergeHotFieldsFrom(base, other) {
  var bts = _parseFieldTs(base.fieldTs);
  var ots = _parseFieldTs(other.fieldTs);
  var valueChanged = false;
  Object.keys(HOT_GROUPS).forEach(function(g) {
    if ((Number(ots[g]) || 0) > (Number(bts[g]) || 0)) {
      HOT_GROUPS[g].forEach(function(f) {
        if (String(base[f] == null ? '' : base[f]) !== String(other[f] == null ? '' : other[f])) valueChanged = true;
        base[f] = other[f];
      });
      bts[g] = Number(ots[g]);
    }
  });
  base.fieldTs = JSON.stringify(bts);
  return valueChanged;
}

// ─── v4.73: RESUME SYNC-GUARD ────────────────────────────────────────
// Reopening the app shows the pre-suspend screen for the seconds until the
// resume-sync lands; a doctor tapping a flag/discharge in that window acts
// on stale data. When the last good sync is >2 min old, dim the app and
// block taps until the sync completes (8s failsafe so an offline device is
// never bricked — the wifi banner takes over from there).
function showSyncGuard() {
  var g = document.getElementById('sync-guard');
  if (!g) return;
  g.style.display = 'flex';
  clearTimeout(window._syncGuardTimer);
  window._syncGuardTimer = setTimeout(hideSyncGuard, 8000);
}
function hideSyncGuard() {
  clearTimeout(window._syncGuardTimer);
  var g = document.getElementById('sync-guard');
  if (g) g.style.display = 'none';
}
function syncWithGuardIfStale() {
  var stale = !window._lastSyncOkAt ||
              (Date.now() - window._lastSyncOkAt) > 2 * 60 * 1000;
  if (stale) showSyncGuard();
  return syncFromSheets()
    .catch(function() {})
    .then(function() { hideSyncGuard(); });
}

var _syncInFlight = false;
async function syncFromSheets() {
  if (!SHEETS_URL) return;
  // v4.46: Dedup guard — visibilitychange + pageshow both fire on iOS resume,
  // causing two simultaneous getAll calls (8s instead of 4s). Drop the second.
  if (_syncInFlight) { console.log('[sync] already in flight — skipping'); return; }
  _syncInFlight = true;
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
    // v4.70: show the 'auth' state BEFORE handing off. This is the one exit path
    // that used to return without touching the dot, leaving it stuck on 'syncing'
    // (pulsing amber forever). handleUnauthorized() decides whether this is a
    // transient blip (retry, quietly) or a real rejection (prompt) — either way
    // the user can now see that the app is waiting on credentials, not on wifi.
    if (d.error === 'unauthorized') {
      setSyncState('auth');
      handleUnauthorized().then(function () { syncFromSheets().catch(function(){}); });
      return;
    }
    if (typeof resetUnauthCount === 'function') resetUnauthCount();  // v4.66: authorized → clear transient-unauth counter
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
      d.patients = dedupById(d.patients);   // v4.64: collapse same-id sheet rows (keep last)
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
        if (isPending) {
          // v4.72: even while local is pending, a NEWER remote tap on a hot
          // field (the other doctor flagged/cleared after us) wins that field.
          var keep = Object.assign({}, lp);
          mergeHotFieldsFrom(keep, rp);
          return keep;
        }
        // Otherwise remote wins — EXCEPT hot fields where the local tap is
        // newer (v4.72): our clear/flag hasn't landed on Sheets yet (push
        // lost, or the getAll snapshot predates it). Keep the newer local
        // value and re-assert it on Sheets.
        var out = Object.assign({}, rp);
        if (mergeHotFieldsFrom(out, lp) && SHEETS_URL) {
          push('savePatient', out);
        }
        return out;
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
        // v4.72: also require the handover flag to match. Previously only the
        // discharged fields were compared, so a handover clear was "confirmed"
        // by a getAll snapshot taken BEFORE the clear landed — remote-wins then
        // resurrected the flag on the very device that cleared it.
        var _hoNorm = function(v) { return (!!v && v !== 'false') ? String(v) : ''; };
        var hoMatch = _hoNorm(rp.handover) === _hoNorm(pending.handover);
        // Generous timeout fallback: clear pending after 60s regardless
        var stale = (Date.now() - (window._pendingPush[rp.id].ts || 0)) > 60000;
        if ((dischMatch && dischAtMatch && hoMatch) || stale) {
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
    //
    // v4.36: Skip when getAll() returns pre-filtered data (d.filtered===true).
    // Filtered responses intentionally exclude old discharged patients — the
    // healer would misread those absent patients as orphans and create
    // duplicate stubs. The healer still runs on any unfiltered sync.
    if (!d.filtered && Array.isArray(st.patients) && Array.isArray(st.claims)) {
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
    // Gap notes (billing-gap explanations, hard-gate). Merge server truth with
    // any LOCAL note not yet on the server, and re-push those — so a saveGapNote
    // that failed (offline) isn't lost when the sync response overwrites state.
    if (d.gapNotes) {
      var _srvGap = {};
      d.gapNotes.forEach(function(g) { _srvGap[String(g.phn||'').replace(/\D/g,'') + '|' + String(g.date||'')] = true; });
      var _localGap = (st.gapNotes || []).filter(function(g) {
        return !_srvGap[String(g.phn||'').replace(/\D/g,'') + '|' + String(g.date||'')];
      });
      if (SHEETS_URL) _localGap.forEach(function(g) { push('saveGapNote', g); });
      st.gapNotes = d.gapNotes.concat(_localGap);
    }
    if (d.changelog) st.changelog = d.changelog;

    ['patients','claims','doctors','gapNotes','changelog'].forEach(function(k) { sv(k, st[k]); });
    window._lastSyncResponse.checkpoint = 'completed';
    window._lastSyncResponse.completedAt = new Date().toISOString();
    window._lastSyncResponse.stPatientsFinal = st.patients.length;
    window._lastSyncResponse.stClaimsFinal = st.claims.length;
    window._lastSyncOkAt = Date.now();   // v4.73: resume-guard staleness marker
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
  } finally {
    _syncInFlight = false;
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

// v4.25: In-flight guard — prevents a second fetch for the same ID while
// the first is still running. This was the root cause of the 31/05 duplicates:
// batchRound fired push() for 5 CCU claims, then syncFromSheets retried them
// from _pendingPush before the originals returned. Two concurrent saveClaim
// requests for the same ID raced past the server lock.
if (!window._pushInFlight) window._pushInFlight = {};

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
  // v4.25: In-flight guard — if a fetch for this exact ID is already running,
  // skip silently. The pending retry will catch it on the next sync cycle
  // once the in-flight request completes.
  if ((action === 'savePatient' || action === 'saveClaim') && body && body.id) {
    if (window._pushInFlight[body.id]) {
      return true;  // true = don't trigger error handling
    }
    window._pushInFlight[body.id] = true;
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
    // v4.25: clear in-flight flag on completion (success or server rejection)
    if (body && body.id) delete window._pushInFlight[body.id];
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
    // v4.25: clear in-flight flag on network failure too — the next sync
    // cycle will retry from _pendingPush.
    if (body && body.id) delete window._pushInFlight[body.id];
    // Network / transport failure — transient. Leave it in _pendingPush so
    // the next sync retries it.
    window._lastPushError = e.message || String(e);
    setSyncState('error');
    return false;
  }
}
