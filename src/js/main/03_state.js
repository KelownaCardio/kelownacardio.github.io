// 03_state.js — App state, local storage, Google Sheets sync
// ═══════════════════════════════════════════════════════
// v4.99 (2026-08-15): ARCHIVE RECALL FIX. "Pull claims" on a >7-day
//        discharged patient loaded the claims but never the patient:
//        pullArchivedPatient guarded the push with `if (!getP(p.id))`, and
//        getP() returns `|| {}` — always truthy — so the push never ran.
//        Tapping the patient then hit openPatientSummary's own `!p.id`
//        early-return (nothing happened) or _openClaimScreen, which rendered
//        an empty context bar (the "blank patient card"). Fixed in
//        06b_discharged.js, plus: raw sheet rows are now normalised on pull
//        (ISO dates / numeric PHNs), both dead-ends now toast instead of
//        failing silently, the summary calendar opens on the month of the
//        newest claim rather than today, and a recalled patient carries an
//        amber "Recalled from archive" chip. No change in this file beyond
//        the version bump.
// v4.96 (2026-08-13): version bump only in this file. New fee code 00081
//        Emergency Bedside Care ($119.97 per 30-min unit or majority
//        portion ≥16 min; start/end + resuscitation note mandatory; Yes/No
//        "consult covers the first 30 min" sheet at submit). Changes live in
//        02_constants.js (FEES entry) + 06_claim_screen.js (form/units/
//        sheet). Backend Config.gs adds 00081 to VALID_FEE_CODES.
// v4.95 (2026-08-12): version bump only in this file. The fix lives in
//        09_patient.js (+13_meditech.js) — every new add now sends explicit
//        discharged:false so a server PHN-merge into a discharged
//        phone-consult stub can't resurrect discharged=TRUE and hide the
//        patient from the on-service list (Vankoesveld, 2026-08-11). Pairs
//        with Crud.gs v3.18 server-side backstop.
// v4.91 (2026-08-09): PULLED-ARCHIVE PIN (Simms "Pull claims does nothing"
//        bug). Archived/old-discharged patients are excluded from the
//        filtered getAll, so the remote-authoritative sync merge dropped a
//        just-pulled patient (and their pulled claims) within one 30s cycle —
//        openPatientSummary then silently returned. Fix: pullArchivedPatient
//        pins pulled ids/PHNs (window._pulledPin, session-lifetime) and both
//        merge keep-loops retain pinned rows WITHOUT re-pushing them. Plus a
//        "+ Claim" button on archive search results (06b_discharged.js:
//        pullArchivedAndClaim) so claims can be added to archived patients
//        without restoring them to a list.
// v4.90 (2026-08-09): ATOMIC ADD-PATIENT SAVE (dropped-consult fix, Cornish
//        2026-08-05). Add-Patient now builds ALL claims first, then commits
//        patient + claims in ONE awaited savePatientWithClaims request
//        (04_billing.js collector + 09_patient.js apSubmit/_addPatientCore).
//        No change in this file beyond the version bump — push() already
//        passes savePatientWithClaims through its guards (body.id present;
//        the empty-patient/claim guards are action-scoped) and fails
//        correctly on {ok:false} responses.
// v4.89 (2026-08-03): GAP-NOTE SYNC-STORM FIX. (1) Gap-note merge is now
//   SERVER-AUTHORITATIVE: a local-only note survives only while its push is
//   pending or it was created <24h ago (createdAt, stamped by 06c). The old
//   rule kept + re-pushed every orphan on EVERY sync; combined with the
//   backend's active-PHN filter on gap notes this re-saved the same aged-out
//   notes thousands of times/day (Aug 1: 2,716 saveGapNote vs 27 real notes),
//   keeping lastWriteAt permanently hot → every device's 30s ping triggered a
//   cold getAll → the 100s+ hangs/timeouts. (2) push() in-flight + pending
//   guards now cover saveGapNote (key 'g|phn|date' — notes have no id);
//   unguarded parallel note bursts were the 5-simultaneous-doPost pattern in
//   the execution log. Ships with Crud v3.16 (getAll returns ALL retained
//   notes) + Bigquery v3.25 (notes >30d archived nightly to BQ gap_notes).

var st = {
  doc:        null,  // { alias, num, name }
  role:       null,  // v5.08: 'md' | 'resident' — captured from the ping response at sign-in
  patients:   [],    // array of patient objects
  claims:     [],    // array of claim objects (including raw CCU_DAILY taps)
  refs:       [],    // referrer directory
  doctors:    [],    // doctor profiles
  changelog:  [],    // change log entries
  recentIcds: [],    // recently used ICD-9 codes
  recentRefs: [],    // recently used referrers
  loaded:     false
};

// v5.08: true only for the resident (read-only) login. Devices that signed
// in before this build have st.role === null/undefined, which this treats
// as 'md' — unchanged behaviour for every existing device.
function isResident() { return st.role === 'resident'; }

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
// v4.74 (2026-07-15): NOTES REFRESH-ON-OPEN. Opening the patient notes
// shows the saved LOCAL version immediately with a "Checking for newer
// notes…" banner while a background sync runs. If a newer version exists:
// untouched textarea → swapped in + re-baselined ("Updated — latest version
// by X"); doctor already typing → draft left alone, amber banner, and the
// v4.73 collision warning handles the merge on Save. (06c + banner CSS in
// index.template.html.) No cache-format change.
// v4.75 (2026-07-15): PING SYNC — all-day sub-minute updates at lower server
// cost. Backend (Router v3.05 / Crud v3.15) stamps lastWriteAt on every data
// write and returns it from the cheap `ping` action (no sheet reads, ~0.3s).
// 14_init now pings every 30s whenever the app is visible and triggers a
// full sync ONLY when the marker changed; the Mon–Fri handover-window fast
// poll is retired (superseded — this is faster and runs all day). The 5-min
// full sync stays as the safety net for writers that don't stamp the marker
// (PhoneAdvice project, email processor). getAll responses are additionally
// served from a 10s server-side cache, so a burst of devices pulling after
// one save costs one sheet read. Graceful on an un-upgraded backend: ping
// returns no lastWriteAt → loop no-ops, 5-min sync carries on. Also: every
// request is counted server-side; nightly job archives per-day totals to
// the new Stats sheet (the daily execution ledger the dashboard lacks).
// v4.76 (2026-07-16): (1) push() now treats ANY response carrying `error` as
// a failure — closes the hole where a thrown backend exception (bare {error},
// no ok:false) masqueraded as success and silently ate the Kluserits readmit.
// Pairs with Router v3.06 (ok:false in catch) and v3.07 (transient flag →
// lock timeouts stay in the pending queue and auto-retry; validation rejects
// are dropped as before). (2) New WARDS: Race Admit + Post Cath — holding
// areas where patients wait for a bed (neutral defaults, MD picks list/care).
// v4.77 (2026-07-17): geo-view dedup — a patient flagged for handover AND on
// an off-site location no longer shows twice at the top (yellow handover block
// + red Off Regular Wards block). While flagged: yellow only. Once the ⚑ flag
// is acknowledged: red (or normal list position). Frontend-only, no BUILD_ID
// bump (no cache-format change, no re-login).
// v4.78 (2026-07-17): OOP/Private-Pay survives the "patient already exists"
// path. apSubmit only read f-oop/f-home-* in its NEW-patient branch, so when
// the duplicate modal fired, _mergeAndReadmit dropped every OOP field the
// doctor had typed (Rivard, QC — Dr Massie's address/billing data discarded
// silently). _mergeAndReadmit now carries those form fields, additively
// (an untouched checkbox never clears existing data; clearing stays in the
// Edit Patient modal). Frontend-only, no BUILD_ID bump.
// v4.79 (2026-07-17): Echo bundles for OOP / Private-Pay billing. New
// Diagnostics picker entries "Echo with Doppler" (33091 + 08679) and
// "Stress Echo" (08662 + 08679) — one tap creates both component claims,
// each stamped with its MSP professional-only feeAmount (bundle totals
// $90.00 / $122.57 per Kathryn 2026-07-17). Restricted to OOP/private
// patients. Backend pair: Invoice.gs v1.1 adds the 3 codes to BCMA_RATES,
// INV_MSP_FALLBACK and FEE_DESC. addClaim gains overrides.feeAmount.
// v4.80 (2026-07-19): Phone Advice tab (BETA, hidden). Tiny 📞 in the footer
// build stamp opens a phone-advice form: MBMD screenshot → OCR auto-fill
// (caller, facility, call-back #, patient, PHN) via the existing ocrSticker
// action with a new prompt; tap-to-dial tel: link; dictation-friendly advice
// field. Submits to the PhoneAdvice(Personal) web app's NEW doPost JSON
// endpoint (PhoneAdviceApi.gs v1.0) which reuses processWebFormSubmission —
// identical downstream pipeline to the standalone webform (claim + patient
// stub + PdfQueue → letter PDF → email + EMR SFTP + iClinic CSV billing).
// Endpoint URL is pasted once per device (localStorage kgh5:paUrl). The
// standalone webform is untouched and stays live. Frontend-only in THIS
// repo (new node 13b_phoneadvice.js); no BUILD_ID bump (no cache change).
// v4.81 (2026-07-19): Phone Advice tab polish (Kathryn, same day):
// (1) Calling physician now uses the consult card's 3-tier directory
// search (refSearchEl incl. "+ Add new physician"); a selected match
// sends its MSP # as manualRefNum so the claim is matched without
// server-side name guessing, and OCR drops the caller into the search
// box with the match list open. (2) ICD-9 free-text replaced by the
// webform's 12 quick-tap pills (first tap = primary) + two optional
// icdSearchEl fields; ≥1 diagnosis required. (3) Background + Advice
// merged into one "Summary of Phone Advice" box (sent as adviceGiven,
// background blank). Frontend-only: 13b_phoneadvice.js, 12_referrers
// (dropdown outside-click whitelist), no BUILD_ID bump.
// v4.82 (2026-07-19): DISCHARGE FLOW REORDER (Kathryn). The doctor now
// confirms the DISCHARGE DATE first; complex-discharge (78717) screening
// runs after, with LOS measured to the confirmed date (retroactive
// discharges now screen correctly). Checklist header shows the ACTUAL
// stay-day count inclusive of admission day ("LOS 5 days · admission day
// = day 1"); eligibility = stay >= 5 days, numerically identical to the
// old losdays() >= 4 when discharging today. The 78717 claim is dated to
// the confirmed discharge date (was: today). Short stays (<5 days)
// discharge in one tap from the date screen; checklist gains a "Back —
// change discharge date" button. Frontend-only: 10_location.js.
// v4.83 (2026-07-19): RACE ADMIT workflow (Kathryn). Patients admitted from
// the RACE clinic had their consult billed there, but still need the full
// admit workflow (referring MD, dx, location, list) plus a MOST. New third
// consult-card mode "RACE admit — consult billed in clinic": no 33010/33012,
// no times/modifiers/CCFPP; MOST (78720) togglable as usual and carries the
// referrer/dx override + doctor's note. Auto-selected when ward = Race Admit
// (Add-Patient locWardChange + +Claim selCT hooks); switching to another ward
// reverts to 33010 so a real consult fee is never silently skipped. Stamps
// admitVia='RACE' on the patient row (Config v2.37 column) so DataCheck
// v2.36 MISSING_CONSULT skips these patients.
// v4.88 (2026-08-01): RACE-admit stamp-persist fix. The v4.83 admitVia='RACE'
// stamp was set on the in-memory patient AFTER the caller's push('savePatient')
// had already written the row, and the following sv('patients') never pushes
// (clinical keys early-return) — so the tag never reached the sheet and every
// button-entered RACE admit was wrongly flagged MISSING_CONSULT (Gerlinsky).
// Fix in 07_consult.js: explicit push('savePatient', p) right after the stamp.
// NOTE: based on live v4.86; does NOT include the staged-but-undeployed v4.87
// last-seen-visit change (05_render.js). Version jumps 4.86 -> 4.88.
// v4.92 (2026-08-10): TIMED-CLAIMS OVERHAUL — from the 2026-08-09 export audit.
// 1. DAY TIMELINE ("Your claims" sheet, injected modal): one box per patient
//    on a shared clock, consult body left + its 12xx call-out blocks banded
//    inside the right edge, per-patient colours. Tap a box → adjust start/
//    finish; EVERYTHING re-derives dynamically on every change (tier from the
//    new start, increment count, 07:45 weekday cap, majority-portion
//    keep/drop, CCFPP notes) — nothing cached. openDayTimeline() in
//    07_consult.js; rebuildConsultModifiers_/applyConsultTimes_ in 04_billing.
// 2. OVERLAP GUARD: live warning + toast the moment an entered start time
//    lands on another of the doctor's timed consults that day (the batch-
//    entry pattern found in the audit: forms keep the now/+50 prefill), and
//    a submit gate. Consult BODIES never overlap — the earlier consult's end
//    trims to the later one's start; call-out windows MAY overlap and carry
//    the CCFPP note automatically (ccfppPredecessorFor_ now tests against
//    the peer's call-out WINDOW, which can outlast a trimmed body).
// 3. 33008 ENTRY-TIME STAMP: today-dated dailies get the entry time as
//    startTime (retroactive fills + multi-day claims stay blank), so a
//    deliberate second daily on a complex patient is distinguishable.
// 4. COMBINED-VISIT FIX: the "2 visits (unstable)" second 33008 was silently
//    blocked by addClaim's v4.21 dedup guard — allowSecondDaily override
//    lets exactly this path through; its note always carries the literal
//    "Second visit" marker for DataCheck v2.38.
// v4.93 (2026-08-10): CLAIM-EDIT MODIFIER CASCADE. Kathryn's invariant:
// modifiers are DERIVED data — any edit to a consult's date, time, alias or
// fee via the claim-edit modal now re-derives its 12xx blocks dynamically
// (tier, increments, 07:45 cap, majority-portion, CCFPP), exactly like the
// v4.92 timeline does for time edits. Date/alias moves carry the blocks to
// the new key first so no strays are left behind; a fee change away from a
// consult deletes its blocks; a direct edit of a 12xx row's own times warns
// (derived — edit the consult instead). Also: standing "Day timeline" button
// in the claim-edit modal (was reachable only from the overlap warning).
// The stranded-Massey mechanism (consult corrected, 1202 left behind) is
// closed. 06c_patient_summary.js only + this bump.
// v4.94 (2026-08-11): MANDATORY SIGN-IN + NEVER-SILENT CLAIMS. st.doc lives in
// localStorage, so a new/shared device starts null. v4.93 and earlier wrapped
// the whole Add-Patient claim block in `if (st.doc)` — with no sign-in the
// block was skipped SILENTLY (the in-card performing-doctor pick was never
// even read) and the patient saved with claims:[] behind an "added to list"
// toast. Live evidence: ChangeLog `edit_patient_batch ... claims=0` by user
// `unknown` — Bernard/Spencer/Verwey 2026-08-09, Wilton 2026-08-11 07:16 PT
// (FHalperin then re-keyed all 4 Wilton claims by hand at 07:41 once signed
// in; his logChange rows are blank in the `by` column before 07:41 and read
// FHalperin after — st.doc was null for that window).
// Fix: (1) the doctor picker is forced and non-dismissible when st.doc is null
// (14_init.js _forceSignIn/_releaseSignIn + hideModal guard); (2) the billing
// alias now resolves as in-card pick -> signed-in doctor, so a card pick
// stands on its own if the login is ever lost (09_patient.js
// _billingAliasForAdd); (3) "no billing doctor" is a blocked submit with a
// named missing field, never a dropped claim, on BOTH the new-patient and
// merge/readmit paths. Frontend-only; no cache-format change.
// v4.94 (cont.): DUPLICATE CLAIM = TOAST + TIME + MANDATORY NOTE (Kathryn).
// An exact duplicate (same doctor, same patient, same day, same fee) used to
// be a dead-end toast in addClaim's dedup guard — the second service simply
// could not be billed. It now toasts, then opens an injected bottom sheet
// demanding (a) the TIME of the second service, prefilled with the clock but
// editable, and (b) a MANDATORY note >=8 chars, which is written to the
// claim's `notes` and therefore travels to MSP as the justification. The
// accepted claim carries allowDuplicate + dupOfId + dupNoteAt; Crud v3.17
// honours the marker and logs `dup_claim_allowed` with the time, note and
// repeated-claim id. CCU family (CCU_DAILY/1411/1421/1431) can NEVER be
// overridden — it is cross-physician and a second CCU day is not a service.
// v5.03 (2026-08-17): FRICTIONLESS EXISTING-PATIENT FLOW + ACTIONABLE
// MODIFIER NOTE (Kathryn).
// (1) The post-OCR "Patient already exists in Database → ↩ Restore to list"
// banner is GONE (09_patient.js showExistingPatientBanner). It saved no time
// and derailed claim + location entry. The doctor now just finishes the form;
// at submit, when the dup check matches and every filled demographic field
// AGREES, the merge runs silently (_dupPrep + direct _mergeAndReadmit — no
// modal) and the normal "added to list / added" toast reports it. The
// side-by-side reconcile modal appears ONLY when a filled field genuinely
// disagrees. The "Patient already on the list → Go to patient" banner for
// currently-active patients is KEPT (Kathryn's call, 2026-08-17).
// (2) The "Increment starts after 08:00 — not billable" dead-end note
// (07_consult.js) is now actionable: "Note — second modifier will not apply:
// < 45 min from end of modifier interval (08:00). Should start time be
// adjusted?" with an inline time picker that rewrites the start field
// (_incAdjustStart) and recomputes the banner. End time deliberately stays.
// Frontend-only; no cache-format change.
// v5.06 (2026-08-22): version bump only in this file — makes every open
// phone show the update banner so it picks up the 22/08 Call-out Decision
// deployment (proximity/overlap decision card, sequential-claims CCFPP
// billing, Day Timeline decision card, Add-Patient submit gating). That
// deployment shipped in 02_constants/04_billing/07_consult/09_patient/
// index.template without touching this file, so cached sessions saw
// v5.05 == v5.05 and were never prompted — Dr Hoskin's phone ran the old
// build all of 22/08 as a result (the Shunter stray-CCFPP incident; the
// new build's recompute self-healed the data at first use that evening).
// No cache-format change; BUILD_ID deliberately NOT bumped (no re-login).
// v5.08 (2026-08-24): RESIDENT (READ-ONLY) ROLE. New generic shared login
// (separate password, no per-person picker) that can view the patient list,
// edit the clinical summary (tap name → same notes modal as MDs use), and
// edit ward/bed/on-off-service + Cardiology role (tap the ward chip →
// trimmed location screen, MRP-service dropdown hidden) — nothing else. No claims, no billing $,
// no add-patient tab, no discharge, no exports/leaderboard. Enforcement is
// backend (Router v3.14 + Crud v3.19 residentSavePatient_ + Config v2.48) —
// this build only hides the surfaces a resident login isn't meant to use;
// the server rejects everything outside the allowlist regardless of what
// the client sends. New `st.role` ('md'|'resident'), captured from the
// ping response at sign-in and persisted like st.doc. See
// 14_init.js/05_render.js/06_claim_screen.js/06c_patient_summary.js/
// 05_render.js (card footer, + Claim, quick-daily/CCU/Directive buttons,
// row pencil, Round-all), 06_claim_screen.js, 06b_discharged.js (restore +
// archive pull), 06c_patient_summary.js, 06d_patient_edit.js (Edit Patient),
// 09_patient.js (buildLocationCard omits role/MRP for residents; Add
// Patient), 10_location.js, 11_export.js and 14_init.js for the per-screen
// gating. 14_init.js also re-stamps st.role from every 30s ping, so a device
// that loses its stored role self-heals instead of falling back to MD chrome.
// No cache-format change to EXISTING keys; BUILD_ID not bumped (no
// re-login) — st.role is simply null/undefined on devices that predate it,
// which the isResident() helper treats as role='md' (unchanged behaviour).
var APP_VERSION = 'v5.09';
var APP_BUILT   = '2026-08-28';

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
      var preserve = ['kgh5:doc', 'kgh5:role', 'kgh5:recentIcds', 'kgh5:recentRefs', 'kgh5:customWards', APP_PW_LS_KEY];
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
  // v5.08: 'role' added — plain string, not JSON, so it's read/written
  // directly (see below) rather than through the JSON.parse branch used by
  // the object/array keys.
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
  try {
    // v5.08: written via the normal sv('role', st.role) — same JSON-string
    // convention as every other sv() key — so it must be parsed the same way.
    var rRole = await LS.get(STORAGE_PREFIX + 'role');
    if (rRole && rRole.value) st.role = JSON.parse(rRole.value);
  } catch (e) {}
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
      // v5.08: the backend drops refbyName from a resident's save (not on the
      // whitelist), so this would re-push the same no-op fix on EVERY sync —
      // each one stamping lastWriteAt and evicting the shared getAll cache,
      // making every MD device do a cold full pull. MD devices still heal it.
      if (hadBadRef && SHEETS_URL && !isResident()) push('savePatient', p);  // push the clean version back to Sheets
    });
  }
}

async function sv(key, val) {
  // v4.84: keep the header daily-total chip in sync on EVERY claims mutation,
  // no matter which screen added the claim. Previously updateDailyTotal() ran
  // only inside render(), and several submit paths (CCU daily, daily rounds,
  // claims added from the patient-summary view, bulk "Round all") save via
  // sv('claims',…) without a full re-render — so the header stayed stale and
  // under-reported while the "Today's claims" modal (which recomputes on open)
  // showed the true, higher total. Refreshing here fixes that mismatch.
  if (key === 'claims') { try { updateDailyTotal(); } catch (e) {} }
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
// v5.04: optional 2nd arg `detail` — {code:'transport'|'timeout'|'http_502'|...}
// so the banner can name the actual cause instead of the old one-size
// "switch to cellular data" (which was actively wrong advice for anyone
// already ON cellular — Kathryn, 2026-08-18). Callers that pass nothing
// fall back to the last recorded netlog event, so every existing call
// site keeps working and still gets a better message than before.
function setSyncState(s, detail) {
  var dot = document.getElementById('sync-dot');
  if (dot) dot.className = 'sync-dot ' + s;

  var banner = document.getElementById('wifi-banner');
  if (!banner) return;
  var txt = document.getElementById('wifi-banner-text');
  var btn = document.getElementById('wifi-banner-btn');
  var rbtn = document.getElementById('wifi-banner-report');
  if (rbtn) rbtn.style.display = 'none';   // only shown on 'error'

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
    // v5.04: name the cause. `netlogExplain` is the single source of this
    // wording — the same string goes into the report email, so what the
    // doctor saw and what lands in the inbox can never disagree.
    var _code = (detail && detail.code) ||
                (window._netlogLast && window._netlogLast.code) || '';
    if (txt) txt.textContent = netlogExplain(_code);
    if (btn) {
      btn.textContent = (_code === 'offline') ? 'Try anyway' : 'Retry';
      btn.onclick = function() { setSyncState('syncing'); syncFromSheets(); };
    }
    // One tap, sends itself, nothing for them to describe or remember.
    // Also re-labelled on every error so a previous "Reported ✓" does not
    // stick around and imply THIS failure was already sent.
    if (rbtn) {
      rbtn.style.display = 'inline-block';
      rbtn.disabled = false;
      rbtn.textContent = 'Report to KB';
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
    // ─── v5.04: AUTO-RETRY + TELEMETRY ────────────────────────────────
    // Was: one attempt, 45s timeout, straight to the red banner on any
    // failure. That surfaced a transient dropped leg to the doctor as a
    // hard error AND left no record anywhere (Apps Script logs nothing
    // for a request it never received, or whose reply was lost on the
    // googleusercontent redirect).
    //
    // Now: two attempts, ~1.2s apart, 20s each. 20s not 45s deliberately
    // — two attempts at 20s is still under the old single 45s wait, so
    // nobody waits longer than before, and observed getAll runs top out
    // around 12s. Every attempt is recorded either way, so the "Client
    // Errors" sheet shows exactly how many of these attempt 2 rescues.
    var r = null, _parsed = null;
    var _lastCode = '', _lastErr = null, _attempts = 0;
    var NETLOG_SYNC_TIMEOUT_MS = 20000;
    for (var _try = 1; _try <= 2; _try++) {
      _attempts = _try;
      var _t0 = Date.now();
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = setTimeout(function() {
        if (ctrl) ctrl.abort();
      }, NETLOG_SYNC_TIMEOUT_MS);
      var fetchOpts = ctrl ? {
        signal: ctrl.signal,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      } : { redirect: 'follow', cache: 'no-store', credentials: 'omit' };
      var _resp = null, _err = null;
      try {
        // Cache-bust URL with timestamp to defeat any iOS BFCache fetch interception
        var url = SHEETS_URL + '?action=getAll&key=' + SHARED_KEY + '&_t=' + Date.now();
        _resp = await fetch(url, fetchOpts);
        // Parse INSIDE the loop, not after it. A response that arrives
        // truncated — the exact failure this whole change is chasing —
        // throws here, and in the first draft that landed in the outer
        // catch with no retry attempt at all. Now a half-delivered body
        // gets the second attempt it deserves.
        if (_resp && _resp.ok) {
          window._lastSyncResponse.checkpoint = 'parsing-json';
          _parsed = await _resp.json();
        }
      } catch (fetchErr) {
        _err  = fetchErr;
        _resp = null;   // a body that died mid-parse is not a usable response
      }
      clearTimeout(timeoutId);

      if (_resp && _resp.ok) {
        // Success. If this was attempt 2, record the rescue — that row is
        // the whole point of the exercise: it proves the failure was a
        // transient transport drop and not a backend fault.
        if (_try > 1) {
          netlogRecord('sync', {
            action: 'getAll', checkpoint: 'fetch-returned', code: _lastCode,
            errName: _lastErr ? String(_lastErr.name || '') : '',
            errMsg:  _lastErr ? String(_lastErr.message || _lastErr) : '',
            attempt: _try, recovered: true, durationMs: Date.now() - _t0
          });
        }
        r = _resp;
        break;
      }

      _lastErr  = _err;
      _lastCode = netlogClassify(_err, _resp);
      netlogRecord('sync', {
        action: 'getAll', checkpoint: _err ? 'fetch-failed' : 'http-error',
        code: _lastCode,
        errName: _err ? String(_err.name || '') : '',
        errMsg:  _err ? String(_err.message || _err)
                      : ('HTTP ' + _resp.status + ' ' + (_resp.statusText || '')),
        httpStatus: _resp ? _resp.status : '',
        attempt: _try, recovered: false, durationMs: Date.now() - _t0
      });

      // Give up early when a second attempt provably cannot help (4xx,
      // offline) — no point making the doctor wait another 20s for the
      // same answer.
      if (_try >= 2 || !netlogWorthRetry(_lastCode)) {
        window._lastSyncError = _err
          ? (_err.name === 'AbortError'
              ? 'Fetch aborted after ' + (NETLOG_SYNC_TIMEOUT_MS / 1000) + 's timeout — Apps Script may be slow or unreachable'
              : 'Fetch failed: ' + (_err.message || _err))
          : ('HTTP ' + _resp.status + ' ' + _resp.statusText);
        window._lastSyncResponse.checkpoint = _err ? 'fetch-failed' : 'http-error';
        window._lastSyncResponse.fetchError = window._lastSyncError;
        window._lastSyncResponse.attempts   = _attempts;
        setSyncState('error', { code: _lastCode });
        return;
      }
      await _netlogSleep(NETLOG_RETRY_DELAY_MS);
    }

    window._lastSyncResponse.checkpoint = 'fetch-returned';
    window._lastSyncResponse.httpStatus = r.status;
    window._lastSyncResponse.httpOk = r.ok;
    window._lastSyncResponse.attempts = _attempts;
    var d = _parsed;   // parsed inside the retry loop above
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
      // v5.04: a clean 200 carrying {error} is a BACKEND fault, not a
      // network one. Tagged 'rejected' so the banner says so and the
      // sheet separates these from transport drops — they need opposite
      // fixes and used to look identical to the user.
      netlogRecord('sync', {
        action: 'getAll', checkpoint: 'server-error', code: 'rejected',
        errName: 'AppsScript', errMsg: String(d.error),
        httpStatus: 200, attempt: 1, recovered: false
      });
      setSyncState('error', { code: 'rejected' });
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
        // v5.08: the backend drops refbyName from a resident's save (not on the
        // whitelist), so this would re-push the same no-op fix on EVERY sync —
        // each one stamping lastWriteAt and evicting the shared getAll cache,
        // making every MD device do a cold full pull. MD devices still heal it.
        if (hadBadRef && SHEETS_URL && !isResident()) push('savePatient', p);  // overwrite stale bad data on Sheets
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
          // v4.91: pulled-archive pin — archived patients are excluded from the
          // filtered getAll, so without this the merge dropped a just-pulled
          // patient within one sync cycle (Pull claims → summary silently
          // failed). Pinned patients are KEPT but never re-pushed: they still
          // exist on the Patients sheet; they're only absent from the
          // filtered response.
          var isPinned = window._pulledPin && window._pulledPin.pids &&
                         window._pulledPin.pids[String(lp.id)];
          if (age < GRACE_MS || isPending) {
            merged.push(lp);
            if (SHEETS_URL) push('savePatient', lp); // retry
          } else if (isPinned) {
            merged.push(lp);                         // keep, no re-push
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
        if (hadBadRef && SHEETS_URL && !isResident()) push('saveClaim', c);   // v5.08: saveClaim is blocked for residents anyway
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
          // v4.91: keep pulled-archive claims (their patient is pinned by PHN).
          // Archived claims are absent from the filtered getAll response, not
          // deleted — keep them visible in the summary calendar, never re-push.
          var isPinnedClaim = window._pulledPin && window._pulledPin.phns &&
                              window._pulledPin.phns[String(lc.phn || '').replace(/\D/g, '')];
          if (age < GRACE_MS || isPending) {
            mergedClaims.push(lc);
            if (SHEETS_URL) push('saveClaim', lc); // retry
          } else if (isPinnedClaim) {
            mergedClaims.push(lc);                 // keep, no re-push
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
    // Gap notes — v4.89 STORM FIX: the server is now AUTHORITATIVE. A local-
    // only note survives (and re-pushes) ONLY while its push is pending or it
    // was created <24h ago (covers an offline discharge). The old rule kept +
    // re-pushed EVERY orphan forever; because the pre-v3.16 backend filtered
    // gap notes to active patients, aged-out notes could never match and the
    // same 27 notes were re-saved thousands of times/day, keeping lastWriteAt
    // hot so every 30s ping forced a cold getAll on every device. The 24h
    // window also makes future server-side deletion safe: notes archived to
    // BigQuery by the nightly flush (v3.25) simply drop from local state here
    // instead of being resurrected.
    if (d.gapNotes) {
      var _gapKey = function(g) { return 'g|' + String(g.phn||'').replace(/\D/g,'') + '|' + String(g.date||''); };
      var _srvGap = {};
      d.gapNotes.forEach(function(g) {
        _srvGap[_gapKey(g)] = true;
        if (window._pendingPush) delete window._pendingPush[_gapKey(g)];   // confirmed on server
      });
      var _GAP_FRESH_MS = 24 * 60 * 60 * 1000;
      var _localGap = (st.gapNotes || []).filter(function(g) {
        if (_srvGap[_gapKey(g)]) return false;
        var _pend  = window._pendingPush && window._pendingPush[_gapKey(g)];
        var _fresh = g.createdAt && (Date.now() - g.createdAt) < _GAP_FRESH_MS;
        return !!(_pend || _fresh);   // else stale orphan — server wins, drop it
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
    if (d.lastWriteAt) window._lastSeenWriteAt = String(d.lastWriteAt);   // v4.75: ping-sync re-baseline
    setSyncState('synced');
    // v5.04: we are demonstrably online RIGHT NOW — the one safe moment to
    // ship any buffered failure records. Fire-and-forget; a flush that
    // fails leaves the buffer intact for the next sync and is never itself
    // logged, so this cannot storm.
    // v5.08: logClientErrors is not on the resident allowlist, so a flush from
    // a resident device is refused and the buffer is dropped. Skip it — the
    // telemetry stays buffered locally rather than being thrown away.
    try { if (!isResident()) netlogFlush(); } catch (eNl) {}
    render();
    // If user is currently viewing the Recently Discharged pane, refresh it too
    var dischPane = document.getElementById('p-discharged');
    if (dischPane && dischPane.classList.contains('on')) {
      var searchEl = document.getElementById('discharged-search');
      renderDischarged(searchEl ? searchEl.value : '');
    }
  } catch(e) {
    window._lastSyncError = e.message || String(e);
    var _cpt = (window._lastSyncResponse && window._lastSyncResponse.checkpoint) || 'unknown';
    if (window._lastSyncResponse) {
      window._lastSyncResponse.checkpoint = 'EXCEPTION at ' + _cpt;
      window._lastSyncResponse.exception = e.message || String(e);
    }
    // v5.04: this is where a truncated/garbled body lands (r.json() throws
    // mid-parse). Previously indistinguishable from "no signal"; now it is
    // logged with the checkpoint that was in progress, which is what
    // identifies a response that arrived only partially.
    var _c = netlogClassify(e, null);
    netlogRecord('sync', {
      action: 'getAll', checkpoint: 'EXCEPTION at ' + _cpt, code: _c,
      errName: String(e && e.name || ''), errMsg: String(e && e.message || e),
      attempt: 1, recovered: false
    });
    setSyncState('error', { code: _c });
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
  // v4.89: saveGapNote joins both guards — keyed 'g|phn|date' (notes have no
  // id). Unguarded parallel note re-pushes were half the Aug-2026 sync storm.
  var _pKey = null;
  if ((action === 'savePatient' || action === 'saveClaim') && body && body.id) _pKey = body.id;
  if (action === 'saveGapNote' && body) {
    _pKey = 'g|' + String(body.phn || '').replace(/\D/g, '') + '|' + String(body.date || '');
  }
  if (_pKey) {
    if (window._pushInFlight[_pKey]) {
      // v5.04: the in-flight window grew (retry + 20s abort ceiling), so
      // "skip silently" now has teeth it did not have when a failure came
      // back in ~1s. Queue the NEWER body before returning, otherwise a
      // doctor who corrects a fee mid-retry gets a success toast for a
      // value that was never sent anywhere.
      window._pendingPush[_pKey] = { action: action, body: body, ts: Date.now() };
      return true;  // true = don't trigger error handling
    }
    window._pushInFlight[_pKey] = true;
  }
  // Mark as pending until next successful sync confirms it
  var _pStart = Date.now();
  if (_pKey) {
    window._pendingPush[_pKey] = { action: action, body: body, ts: _pStart };
  }
  // v5.04 review fix: with the retry chain, this push can be in flight for
  // up to ~25s — long enough for the doctor to save the SAME record again.
  // That newer save is queued into _pendingPush (see the in-flight guard
  // above). This push's completion must then leave the entry alone, or a
  // gap-note confirm / permanent-reject cleanup would silently discard an
  // edit whose caller was already told "saved".
  var _pendingIsNewer = function () {
    var q = _pKey && window._pendingPush[_pKey];
    return !!(q && q.ts > _pStart);
  };
  setSyncState('syncing');
  try {
    // ─── v5.04: AUTO-RETRY + TELEMETRY (writes) ─────────────────────
    // Two things were wrong here. (1) No timeout at all — a hung POST sat
    // forever with the amber dot pulsing. (2) Any transport blip went
    // straight to the red banner with no record of what happened.
    // Retry is gated on NETLOG_IDEMPOTENT: a lost reply may mean the write
    // LANDED, so only upsert-by-key actions may be replayed. Append-only
    // actions fall through to _pendingPush exactly as before.
    var _pUrl = SHEETS_URL + '?action=' + action + '&key=' + SHARED_KEY;
    var _pMax = NETLOG_IDEMPOTENT[action] ? 2 : 1;
    var resp = null, _pCode = '';
    for (var _pt = 1; _pt <= _pMax; _pt++) {
      var _pt0 = Date.now(), _pr = null, _pe = null;
      // v5.05: 12s → 20s. The first two days of Client Errors data
      // (18–19/08) showed 57 write timeouts hitting the 12s ceiling —
      // saves at peak routinely need longer (every write holds the script
      // lock and sorts inside it, so 7am writes queue behind each other).
      // Data said 12s was cutting off requests that would have succeeded;
      // 20s matches the sync ceiling. Worst case 20 + 1.35 + 20 ~= 41s,
      // still under the old single 45s wait.
      var _pCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var _pTid  = setTimeout(function() { if (_pCtrl) _pCtrl.abort(); }, 20000);
      try {
        _pr = await fetch(_pUrl, _pCtrl
          ? { method: 'POST', body: JSON.stringify(body), signal: _pCtrl.signal }
          : { method: 'POST', body: JSON.stringify(body) });
      } catch (_pex) { _pe = _pex; }
      clearTimeout(_pTid);

      if (_pr && _pr.ok) {
        if (_pt > 1) {
          netlogRecord('push', {
            action: action, checkpoint: 'post-returned', code: _pCode,
            attempt: _pt, recovered: true, durationMs: Date.now() - _pt0
          });
        }
        resp = _pr;
        break;
      }

      _pCode = netlogClassify(_pe, _pr);
      netlogRecord('push', {
        action: action, checkpoint: _pe ? 'post-failed' : 'http-error', code: _pCode,
        errName: _pe ? String(_pe.name || '') : '',
        errMsg:  _pe ? String(_pe.message || _pe)
                     : ('HTTP ' + _pr.status + ' ' + (_pr.statusText || '')),
        httpStatus: _pr ? _pr.status : '',
        attempt: _pt, recovered: false, durationMs: Date.now() - _pt0
      });

      if (_pt >= _pMax || !netlogWorthRetry(_pCode)) {
        // v4.25 behaviour preserved: clear in-flight, leave the record in
        // _pendingPush so the next sync cycle retries it.
        if (_pKey) delete window._pushInFlight[_pKey];
        window._lastPushError = _pe ? (_pe.message || String(_pe))
                                    : ('HTTP ' + _pr.status);
        setSyncState('error', { code: _pCode });
        return false;
      }
      await _netlogSleep(NETLOG_RETRY_DELAY_MS);
    }
    // v4.25: clear in-flight flag on completion (success or server rejection)
    if (_pKey) delete window._pushInFlight[_pKey];
    // v3.91: inspect the response BODY, not just the HTTP status. Apps Script
    // returns HTTP 200 even when saveRow rejects a record ({ok:false,error}).
    // Treating that as success let rejected patient saves pass silently — the
    // row never landed, and the orphan-claim healer then rebuilt it blank.
    var data = null, _parseErr = null;
    try { data = await resp.json(); } catch (_pj) { data = null; _parseErr = _pj; }
    // v5.04: a body that will not parse used to fall straight through to
    // setSyncState('synced') + return true — a save reported as succeeded
    // on the strength of a reply nobody could read. Treat it as transient:
    // the record stays in _pendingPush and the next sync re-sends it, which
    // is safe because every action that reaches _pendingPush is upsert-keyed.
    if (_parseErr) {
      window._lastPushError = 'Unreadable reply: ' + (_parseErr.message || _parseErr);
      netlogRecord('push', {
        action: action, checkpoint: 'post-parse', code: 'bad_json',
        errName: String(_parseErr.name || ''), errMsg: String(_parseErr.message || _parseErr),
        httpStatus: resp.status, attempt: 1, recovered: false
      });
      setSyncState('error', { code: 'bad_json' });
      return false;
    }
    // v4.76: a response carrying `error` is a FAILURE even without ok:false.
    // Router ≤v3.05 returned bare {error} for thrown backend exceptions (lock
    // timeout) and this branch missed it — the app treated the failed save as
    // success (Kluserits case, 2026-07-16). Router v3.06+ adds ok:false; v3.07
    // adds transient:true on thrown exceptions so we can tell "retry will
    // work" (lock timeout) from "retry can never work" (validation reject).
    if (data && (data.ok === false || (data.error && data.ok !== true))) {
      window._lastPushError = data.error || 'Server rejected the save';
      // Permanent validation rejection → never succeeds on retry → drop it
      // from the pending-retry queue. Transient (thrown exception / bare
      // {error} from an old Router — assume transient) → KEEP it pending so
      // the next sync cycle retries automatically.
      var _transient = !!(data.transient || data.ok === undefined);
      if (_pKey && !_transient && !_pendingIsNewer()) {
        delete window._pendingPush[_pKey];   // v4.89: covers gap notes too
      }
      console.warn('push rejected by server — ' + action + ': ' + window._lastPushError +
                    (_transient ? ' (transient — will retry)' : ' (permanent)'));
      // Connection is fine — we got a clean 200 + JSON. This is a data
      // rejection, not a connectivity failure, so do NOT raise the wifi
      // banner; the caller surfaces the specific error to the user.
      setSyncState('synced');
      return false;
    }
    window._lastPushError = null;
    // v4.89: a gap-note save is confirmed by the server's locked write+flush
    // ({ok:true}) — clear its pending entry now rather than waiting for the
    // note to appear in a sync response.
    if (action === 'saveGapNote' && _pKey && !_pendingIsNewer()) delete window._pendingPush[_pKey];
    setSyncState('synced');
    return true;
  } catch(e) {
    // v4.25: clear in-flight flag on network failure too — the next sync
    // cycle will retry from _pendingPush.
    if (_pKey) delete window._pushInFlight[_pKey];
    // Network / transport failure — transient. Leave it in _pendingPush so
    // the next sync retries it.
    window._lastPushError = e.message || String(e);
    // v5.04: the transport attempts and the JSON-parse guard above handle
    // and log their own failures, so this is the last-resort net for
    // anything unforeseen after the response arrived.
    var _ec = netlogClassify(e, null);
    netlogRecord('push', {
      action: action, checkpoint: 'post-parse', code: _ec,
      errName: String(e && e.name || ''), errMsg: String(e && e.message || e),
      attempt: 1, recovered: false
    });
    setSyncState('error', { code: _ec });
    return false;
  }
}
