# KGH Cardiology Billing — CHANGELOG

This file tracks every feature, fix, and architectural decision across all chat sessions. **Always upload this file at the start of a new chat** so changes from prior sessions aren't accidentally lost or undone.

**Format:** Each entry is dated, version-tagged, and groups related changes. New entries go at the **top**. When closing a session, append a "Session summary" block.

---

## How to maintain this file

**At the start of each chat:**
1. Upload the latest `index.html` from GitHub (or current working build)
2. Upload this `CHANGELOG.md`
3. Mention what you want to work on

**During the chat:**
- I will reference this file before making changes to avoid undoing prior work
- After each meaningful change, I add an entry under "## In progress" at the top

**At the end of each chat:**
- I move "In progress" entries into a dated **Session summary** block
- I deliver the updated `CHANGELOG.md` alongside the new `index.html`

---

## In progress
*(empty at session end)*

---

## Session 2026-05-10 — v3.29 (FEES trimmed to actual usage)

### v3.29 — Trimmed FEES from 56 codes to 20
- Per team confirmation, the cardiology group only bills the following service classes — everything else is billed by the hospital or other specialty groups (echo lab, EP, imaging, etc.). FEES picker now reflects exactly what gets billed.
- **Kept (20 codes):**
  - **Consultations** — 33010, 33012, 33014, 33005
  - **Continuing care** — 33006 (directive), 33008 (subseq hospital / MRP daily / combined)
  - **Procedures** — Y33025 (cardioversion), 00751 (pericardiocentesis)
  - **Discharge / planning** — 78717 (complex discharge), 78720 (advance care planning / MOST)
  - **CCU** — 1411, 1421, 1431, 1441
  - **Out-of-office hours** — 1200, 1201, 1202, 1205, 1206, 1207 (renamed in the picker from "Out-of-office hours premiums" to "Call-out modifiers"; descriptions restored to the older shorter style — "Evening call modifier — base 30 min", "Night call — increment per 30 min", etc. — to match team convention from earlier versions).
- **Removed (36 codes added in the v3.28 audit but not used by this group):**
  - All echo codes (33091, 08638, 08679, 08662, 33094, 33093) — billed by hospital echo lab
  - All ECG / Holter codes (33016, 33017, 33018, 33047, 33048)
  - All stress test codes (33034, 33035, 33036)
  - All pacemaker codes (33026, 33053, 33028, 33054, 33030, 33032, 33033) — billed by EP / device clinic
  - All remote monitoring codes (33174, 33175, 33176, 33177)
  - All event / loop recorder codes (33062, 33069, 33092)
  - Cardiac rehab (33020)
  - All telehealth variants (33110, 33112, 33106, 33107, 33108)
  - Subseq office visit (33007) and subseq home visit (33009)
- **LEGACY_FEE_LABELS unchanged** — still explains 14101/14105/14113 in case they appear in historical claims.
- **BUILD_ID** bumped to `v3.29-2026-05-10-fees-trimmed`. Header version label updated to v3.29.

### v3.28 outstanding items — resolved
- ~~Default ICD `3062` in `addClaim()`~~ → **Confirmed intentional by the team.** No change. (The ICD-9 decode of `306.2` is "cardiovascular malfunction in mental origin" but it is being used as a deliberate placeholder by the team and is acceptable.)
- ~~50% reduction rule for stress + exercise echo same-day~~ → **Not applicable** since the group doesn't bill stress tests or echo. Removing the follow-up.

### Notes for future
- If the group ever takes over billing for any of the removed services, the codes can be restored from `MSC_2026_audit.md` (kept in the repo as the canonical MSC 2026 reference).
- The MSC schedule moves annually (typically January 31). When the 2027 schedule releases, re-run the audit and adjust amounts where they've changed.

---

## Session 2026-05-10 — v3.28 (MSC fee schedule corrections)

### v3.28 — FEES array rebuilt against MSC Payment Schedule, January 31, 2026
- **Audited every code** in `FEES` against MSC 2026 Cardiology (§12), Critical Care (§6), and Out-of-Office Hours premiums (§2). Found 13 mis-labelled codes and 3 invalid codes.
- **Removed invalid codes:**
  - `14101` / `14105` — were labelled "Cardioversion elective/emergency DC". These are not real cardiology codes in MSC 2026. Real code is **Y33025** at $105.70.
  - `14113` — was labelled "Pacemaker insertion temporary transvenous". Real code is **33030** at $180.05.
- **Fixed mis-labelled codes** (kept the code, corrected description to MSC truth):
  - `33007` — was "Out-of-office visit"; **is** Subsequent office visit ($82.51).
  - `33008` — was "Daily in-hospital care / combined daily"; **is** Subsequent hospital visit ($63.95) — note this is the SAME procedure used for MRP daily AND combined daily, but description now reflects the official MSC name.
  - `33016` — was "Holter monitor — interpretation"; **is** ECG and interpretation — office, each ($25.08).
  - `33018` — was "Nuclear cardiology — interpretation"; **is** ECG — professional fee, in-hospital read ($9.01).
  - `33028` — was "Treadmill stress test — interpretation only"; **is** Dual chamber pacemaker testing — professional fee ($70.93).
  - `33035` — was "Exercise stress test — supervision + interpretation"; **is** Graded exercise — professional fee only ($47.11). The supervision+interpretation code is **33034** ($79.42), now added separately.
  - `33047` — was "ECG — interpretation only"; **is** Holter monitor (24h ECG scan) — professional fee ($67.63).
  - `33062` — was "Echocardiogram — M-mode + 2D"; **is** Event/loop recorder (first strip) — professional fee ($37.03). Real echo is **33091** at $148.61, now added.
  - `33069` — was "Echocardiogram — Doppler addition"; **is** Event/loop recorder — each additional strip ($18.51). Real Doppler echo is **08679** at $47.78, now added.
  - `33107` — was "Pacemaker check — single chamber"; **is** Telehealth subsequent office visit ($82.51). Real single chamber pacemaker check is **33026** at $52.32, now added.
  - `33110` — was "Subsequent cardiology consultation"; **is** Telehealth consultation full ($186.14).
  - `33174` — was "Ambulatory BP monitoring — interpretation"; **is** Remote monitoring of single chamber implantable cardiac device — professional fee ($47.29).
  - `33176` — was "Ambulatory BP monitoring — technical only"; **is** Remote monitoring of dual chamber implantable cardiac device — professional fee ($70.93).
- **Added the real codes** for procedures whose labels were previously wrong: **Y33025** (cardioversion), **33030** (temp RV pacemaker), **33032/33033** (pacemaker standby / generator placement), **33091/08638/08679/08662/33093/33094** (echo variants), **33034/33036** (treadmill stress test full + technical), **33026/33053/33054** (single/dual chamber pacemaker testing tech fees), **33092** (event recorder tech fee).
- **Added other useful real codes:** **33014** (prolonged counselling, max 4/yr), **33017** (ECG home), **33009** (subsequent home visit), **33020** (cardiac rehab supervision per week), **33106/33108/33112** (telehealth directive / hospital subseq / repeat consult), **33175/33177** (remote monitoring technical fees), **01441** (CCU day 31 onward, $138.53).
- **Every fee in `FEES` now has an `amount` field**, displayed in the fee-search picker (right-aligned) and the claim preview (green, after the units). Doctors can see the $ they'll be paid before submitting.
- **`getFeeLabel()` refactored** to source from `FEES` first, then `LEGACY_FEE_LABELS` for historical claims that used 14101/14105/14113 — so old claims in Sheets still display with a meaningful explanation rather than a bare code.
- **New helper `getFeeAmount(code)`** returns `'$xx.xx'` or empty string for any code.
- **BUILD_ID** bumped to `v3.28-2026-05-10-msc-fee-corrections`. Forces all device caches to wipe on next load — important because FEES changed shape (new `amount` field).
- Header version label updated to v3.28. Top-of-file comment block updated with full v3.28 notes.

### Outstanding from v3.27 — addressed in v3.29
- ~~Default ICD `3062` in `addClaim()`~~ — confirmed intentional by team in v3.29 session.
- ~~MSC 50% rule for stress + exercise echo~~ — not applicable; group doesn't bill those services (v3.29).

### Confirmed from older outstanding work
- ~~Confirm 1202 weekend/stat base rate~~ → **$79.08** (same as 01200 evening base).
- ~~Confirm cardioversion 14101/14105 rates~~ → those codes don't exist as cardiology. Real code is **Y33025** at $105.70.

---

## Session 2026-05-10 — v3.27 (calendar view release)

### v3.27 — Calendar view in patient summary
- **Patient summary modal now opens on a calendar view by default**, with a List/Calendar toggle at the top of the claims section. List view is preserved verbatim — one tap away.
- **Calendar grid** renders the patient's month with one colour per day based on the dominant claim:
  - Amber = Consult (33010 / 33012)
  - Purple = CCU (CCU_DAILY / 1411 / 1421 / 1431), shows the band as a tag under the date
  - Green = Daily (33008 without notes)
  - Teal = Combined daily (33008 with notes)
  - Blue = Directive (33006)
  - Grey = gap day inside admission span (only when patient has a gap rule)
  - Blue ring = today; Red ring = discharge date
- **Gap rule** (only patients matching this get grey gap shading and the warning banner):
  - `p.ward ∈ {CCU, CSICU, ICUA, ICUB, ICUD}` AND `p.role === 'mrp'` → expects CCU each day
  - `p.role === 'mrp'` on any other ward → expects 33008 daily
  - All other patients (consultants, off-service) → no gap shading; calendar still works for tap-to-add
- **Tap a coloured day** → bottom sheet showing every claim on that date with inline Edit / Delete buttons that route through the existing `openClaimEdit` / `deleteClaimBtn` handlers.
- **Tap a gap (or any empty in-admit) day** → 4-button picker: CCU / Daily / Directive / Combined daily. The rule-recommended type wears an amber "RECOMMENDED" ribbon and a coloured border, but all 4 are tappable so the doctor can override.
  - CCU: auto-computes 1411/1421/1431 from consecutive prior CCU days, one tap → claim created via `addClaim(p, 'CCU_DAILY', ...)`.
  - Daily: one tap → `addClaim(p, '33008', ...)`.
  - Directive: one tap → `addClaim(p, '33006', ...)`.
  - Combined daily: opens a sub-form requiring **ICD-9 code** (pre-filled from `p.icd`, editable) AND **reason text**. Saved as `33008` with `notes = "ICD — reason"`. Both fields validate red on save if blank.
- **Discharge integration:** new `_dischCheckGaps()` runs ahead of the existing `_dischStep1` today's-visit prompt. If the patient has a gap rule AND any historical admit days are unbilled, the discharge modal opens on a banner listing the missed days with two options:
  - **Fix gaps first** → closes discharge modal, opens patient summary on the calendar so the doctor can tap each gap day.
  - **Discharge anyway** → falls straight through to the original `_dischStep1` (today's-visit prompt → LOS>4 prompt → confirm discharge).
  - Patients with no gap rule skip the check entirely; existing flow unchanged.
- **BUILD_ID** bumped to `v3.27-2026-05-10-calendar-view` (forces device localStorage wipe on next load — important since this release touches the patient summary modal that depends on `st.claims` shape).
- Header version label updated to `v3.27`. File top-comment block updated.

### Schema reference unchanged
No new patient/claim columns. Calendar reads existing fields:
- `p.admitDate`, `p.dischargeDate` (DD/MM/YYYY)
- `p.ward`, `p.role`, `p.care` (gap rule)
- `c.phn`, `c.date`, `c.fee`, `c.notes` (cell colour + day details)

### New JS functions added (all prefixed `_cv` or `tapCalDay` / `togglePtSummaryView` so they're easy to grep for)
`togglePtSummaryView`, `_ptSummaryListHTML`, `_ptSummaryCalendarHTML`, `_cvGapRuleForPatient`, `_cvAdmitSpan`, `_cvDominantType`, `_cvGapDays`, `_cvCcuFeeForDate`, `_cvChangeMonth`, `tapCalDay`, `_cvShowDayDetails`, `_cvEditFromSheet`, `_cvDeleteFromSheet`, `_cvShowPicker`, `_cvPickType`, `_cvShowCombinedForm`, `_cvBackFromCombined`, `_cvConfirmCombined`, `_cvFillClaim`, `_dischCheckGaps`, `_dischIgnoreGaps`, `_dischFixGaps`.

### New HTML
- One new modal: `<div id="cv-picker-modal">` sits next to `pt-summary-modal`. Uses the existing `.overlay` / `.modal` / `.modal-handle` classes — same bottom-sheet pattern as every other modal in the app.

### New CSS
- ~70 lines under `/* ═══ v3.27 — calendar view in patient summary ═══ */` immediately before `</style>`. All class names prefixed `cv-` for clean grep / future cleanup.

---

## Sessions 2026-05-07 → 2026-05-10 — v2.96 through v3.26
*(placeholder — versions bumped across multiple sessions without CHANGELOG entries)*

Live BUILD_ID prior to v3.27 was `v3.26-2026-05-10-meditech-detection-broader`. Known major work in this gap based on the in-file comment block at the top of `index.html`:
- **v3.20** — OCR corrections capture.
- **v3.21** — Debug panel + version-aware Service Worker.
- **v3.22** — Debug panel minimisable (small pill in corner).
- **v3.23** — Meditech-aware empty-OCR ward/room corrections logged with rawText.
- **v3.24** — Multi-pass Tesseract (paper + screen preprocessing).
- **v3.25** — ocr_offline.js v1.2 (Meditech parser fixes — HCN# variant, inline DD/MM/YYYY DOB, bare M/F sex, edge-artifact prefix strip).
- **v3.26** — Meditech detection broader (per BUILD_ID string).

Other intermediate changes (v2.96 → v3.19) are not tracked here; reconstruct from git history if needed.

---

## Session 2026-05-07 — v2.82

### v2.82 — Cleanup pass before offline OCR work
- **Removed diagnostic logging** from `claimedToday()` (the `[no-green]` console.log added in v2.77 for debugging the null-PHN issue) and the `window._dbgGreen` flag set in `render()`
- **Removed orphan panes** `p2` (fee codes search) and `p3` (referrers search) — these HTML panes existed but weren't reachable from any nav button. They were leftovers from an older nav layout.
- **Removed `p2`/`p3` from `ALL_PANES`** array
- **Removed dead functions:** `signOff()`, `removeOnly()`, `losDischNo()`, `losDischClose()`, `_openDischModalInner()` — never called from anywhere
- **Kept `signOffConfirm()`** — still used by the los-modal length-of-stay flow
- **Removed `populateBedDatalist()`** no-op stub and its two callers (replaced by custom dropdown in v2.74)
- **Made `renderRefs()` and `renderFees()` null-safe** — they're still called at init but now no-op if their DOM target was removed
- 68 lines net reduction (6921 → 6853 lines)
- **Verified:** Node.js syntax check clean, all retained functions intact

---

## Session 2026-05-07 — v2.83 → v2.95 + Apps Script v3

### v2.95 — Recently discharged: strict 21-day filter
- **Bug:** filter said `return ms > cutoff21 || !ms` — i.e. include if within 21 days OR if no valid `dischargedAt`. The "no dischargedAt" leak meant patients with missing/corrupt discharge timestamps showed indefinitely.
- **Fix:** changed to `return ms && ms > cutoff21`. Patients with no valid timestamp are hidden (can't prove they're recent). Search override still shows all true-discharges regardless of age.
- BUILD_ID bumped to v2.95 to force device cache wipe — ensures any patients with stale `discharged: true` flags from earlier sessions get reloaded fresh from Sheets.

## Session 2026-05-07 — v2.83 → v2.94 + Apps Script v3

### v2.94 — Central kill-switch: BUILD_ID localStorage wipe
- **Need:** "Wipe every device's localStorage" must be doable from a single GitHub push, since users on phones/tablets can't be hand-cleaned.
- **Fix:** Added `BUILD_ID = 'v2.94-2026-05-07'` constant. On every page load, if the stored `kgh5:buildId` doesn't match, ALL `kgh5:*` keys are wiped before `loadLocal()` runs. Then the new `BUILD_ID` is stored.
- **How to use:** In any future commit where stale localStorage might break things, bump the BUILD_ID string. Every device, on next page load, will purge its cache and start fresh from Sheets.
- This is independent of the version number in the title — that's user-facing; BUILD_ID is the cache-buster. They happen to match this time.

## Session 2026-05-07 — v2.83 → v2.93 + Apps Script v3

### v2.93 — Force-clean stale localStorage on every load
- **Bug:** v2.68 was supposed to stop persisting `patients`/`claims`/`doctors`/`changelog` to localStorage and clear any stale entries. The clearing call used `LS.delete && LS.delete(...)` — but the LS fallback object had no `delete` method, so the call was a silent no-op. Stale `kgh5:claims` from before v2.68 sat in localStorage indefinitely, pre-loading old data into `st.claims` on every page load before sync ran.
- **Fix:** 
  1. Added `delete` method to LS fallback object
  2. Switched stale-cleanup to direct `localStorage.removeItem()` (synchronous, always works)
  3. Now also purges legacy `confirmedClaims`/`confirmedPatients` keys (replaced by `window._pendingPush` in v2.83)
  4. Also purges `refs` (no longer used in v2.78+)
- Result: every page load now starts with a clean localStorage for clinical data, fully relying on Sheets sync.

## Session 2026-05-07 — v2.83 → v2.92 + Apps Script v3

### v2.92 — `roundedToday` is now derived from claims
- **Bug:** `p.roundedToday` was a denormalised flag set when a quick-tap fired and persisted to Sheets. It could drift from the truth (claims) and showed false-positive "already rounded" state after wiping claims, across devices, etc.
- **Fix:** All `p.roundedToday === TODAY` / `!== TODAY` checks replaced with `claimedToday(p)` which queries `st.claims` directly. The writes (`p.roundedToday = TODAY`) are removed — the field is no longer set anywhere.
- Single source of truth: claims drive UI state. Wiping claims correctly resets all "already rounded" indicators.
- Sync merge no longer cares about `roundedToday` from Sheets — it's stale by definition. Old field values left in Sheets are ignored.

## Session 2026-05-07 — v2.83 → v2.91 + Apps Script v3

### Apps Script v3 — Fix new-row date corruption
- **Bug:** v2 used `appendRow(row)` for new claim rows. `appendRow` ignores the `setNumberFormat('@')` we set on the row range — it appends at lastRow+1 with the column's default format. So Sheets reinterpreted DD/MM/YYYY date strings as US-format MM/DD on every new claim insert.
- **Fix:** Replaced `appendRow` with explicit `getRange(newRowIdx,...).setNumberFormat('@').setValues([row])` so the format applies to the exact cells we write into, BEFORE the write.
- This is the root cause of the `05/07/2026` rewrites you've been seeing — the previous Apps Script update only fixed UPDATES, not new-row INSERTS.

## Session 2026-05-07 — v2.83 → v2.91 + Apps Script v2

### v2.91 — × clear button: add onpointerdown for iOS
- **Bug:** v2.89 fixed the HTML escape but × button still didn't fire on iOS Safari. The `tabindex="-1"` + click event ordering caused taps to be swallowed.
- **Fix:** Added `onpointerdown="event.preventDefault();clearSearchField(...)"` alongside the existing `onclick`. Pointer events fire reliably on iOS before any blur/focus interference.

### v2.90 — selectRefRow walks up to row from child elements
- **Bug:** Tapping a referrer dropdown row often hit a child `<span>` or `<div>` (the doctor number suffix or specialty subtitle), not the outer `<div class="ref-dd-row">`. `el.getAttribute('data-num')` returned null because the child has no data attributes. ICD rows had flat content so this didn't hit them.
- **Fix:** `selectRefRow` now calls `el.closest('.ref-dd-row')` if the tapped element doesn't have `data-num`. Same defensive walk-up added to `selectIcdRow` and `openAddPhysicianForm` for consistency.

## Session 2026-05-07 — v2.83 → v2.89 + Apps Script v2

### v2.89 — Fix × clear button (HTML escape bug)
- **Bug:** v2.84 wrote `clearSearchField(\'X\',\'Y\',...)` directly into HTML attributes. Inside `onclick="..."`, the `\'` is parsed as a literal backslash followed by a quote — which terminates the attribute string at the first quote, breaking the entire JS handler. The × button silently did nothing.
- **Fix:** All 10 `clearSearchField` onclick handlers cleaned up. Direct HTML now uses `'X'` (plain quotes inside `"..."`). JS-string-built variants use `\'X\'` (backslash-escaped) so the resulting HTML still ends up with plain quotes.

## Session 2026-05-07 — v2.83 → v2.88 + Apps Script v2

### v2.88 — Fix referrer dropdown selection (real cause)
- **Root cause found:** v2.84 wrapped each search input in `<div style="position:relative">` to position the × clear button. `selectRef` used `dd.previousElementSibling` to find the input — which became the wrapper div, not the input. Result: hidden value got set, but the visible input stayed empty.
- **Fix:** `selectRef` now derives the input ID from the dropdown ID (`f-ref-dd` → `f-ref-search`) and looks it up directly. No reliance on DOM sibling order.
- v2.87's `onmousedown` change is kept (still good practice for dropdowns) but wasn't the actual fix.

## Session 2026-05-07 — v2.83 → v2.87 + Apps Script v2

### v2.87 — Fix dropdown selection on iOS/mobile
- **Bug:** Tapping a referrer/diagnosis/fee dropdown row didn't populate the field. v2.84 added the × clear button wrapper which somehow interferes with `onclick` event ordering on iOS Safari.
- **Fix:** Changed all dropdown row handlers from `onclick` to `onmousedown` with `event.preventDefault()`. This fires before the input's blur and before the global click-outside-closes-dropdown listener, ensuring the selection completes. Same pattern as the bed dropdown which has always worked.
- Applied to: `selectIcdRow`, `selectRefRow`, `openAddPhysicianForm`, `selectFeeFromDd`

## Session 2026-05-07 — v2.83 → v2.86 + Apps Script v2

### Apps Script — text-format enforcement on writes
- **Bug:** Sheets was reinterpreting DD/MM/YYYY date strings as US-locale dates (MM/DD) on write, even with column formatted as Plain text. Cause: `setValues()` reinterprets values according to spreadsheet locale.
- **Fix:** `saveRow` now calls `setNumberFormat('@')` on the row range BEFORE `setValues()`, forcing text storage that bypasses any reinterpretation. Same fix applied to `saveAll`.
- **Hardening:** `sheetToObjects` now converts any `Date` object back to DD/MM/YYYY string via `Utilities.formatDate(v,'America/Vancouver','dd/MM/yyyy')` — protects against legacy data that slipped through as a date type.

### Fresh start workbook
- `KGH_Cardiology_Billing_FRESH.xlsx` provided for clean rebuild
- Patients tab: 42 patients, all PHNs filled
- Claims tab: empty (headers only)
- Doctors, Referrers, ChangeLog tabs: empty (headers only)

## Session 2026-05-07 — v2.83 → v2.86

### v2.86 — Add last+first to Claims tab for visual reconciliation
- Schema: claim columns now `id, alias, last, first, phn, fee, ...` (16 cols)
- `addClaim` writes `c.last = p.last` and `c.first = p.first` from patient at creation
- CSV export still derives from `st.patients[phn]` lookup at export time (always current)
- CLEAN.xlsx Claims tab updated with names populated from PHN lookup

## Session 2026-05-07 — v2.83 → v2.85

### v2.85 — batchRound writes real CCU codes
- **Bug:** "Round all" / batchRound on CCU was writing `CCU_DAILY` as a placeholder fee code to Sheets, expecting consolidation at CSV export. Result: Sheets showed `CCU_DAILY` instead of 1411/1421/1431.
- **Fix:** `batchRound` now calls `ccuFeeForToday(p)` per patient, same logic as the individual quick-tap button. Real fee codes (1411/1421/1431) write directly to Sheets.

## Session 2026-05-07 — v2.83 → v2.84

### v2.84 — Off-service ward order + complete clear-button coverage
- **Off-service location view sort:** clinical priority order — ED → ICUA/B/D → CSICU → numbered floors. Within numbered floors: A/B together (single rooms) before E/W together (E/W blocks). Implemented via `_wardSortKey()` returning `[groupNum, subKey, suffix]`.
- **× clear buttons added to all remaining search inputs:**
  - Add Patient form: `f-ref-search`, `f-icd-search`
  - Consult form: `cb-ref-search`, `cb-icd-search` (via `buildIcdRefCard`)
  - Claim Edit modal: `ce-ref-search`, `ce-icd-search`
  - Other Claim form: `oc-ref-search`, `oc-icd-search`
  - (Edit Patient form `pe-*` already had them since v2.66)
- All use the existing `clearSearchField()` helper from v2.66
- Confirmed `trueDischarge` filter still in place for Recently Discharged (no changes needed — already correct from v2.81)

### v2.83 — Critical: claims no longer lost on sync if push fails
- **Bug:** quick-tap directive/daily/CCU claims were being deleted on next sync if the initial `push('saveClaim')` failed silently (hospital wifi). The 2-minute grace window was the only retention mechanism — anything older that wasn't yet in Sheets got dropped permanently.
- **Fix:** added `window._pendingPush` tracker. Every `push()` call records the item until a sync confirms it appears in Sheets data. Pending items are NEVER dropped on sync, regardless of age.
- **`push()` now returns** true/false based on HTTP response (also checks `resp.ok`)
- **Sync merge logic:** keep local claim/patient if in-flight (< 2 min) OR in pending set
- Applies to both patients and claims merge

## Session 2026-05-06 (evening) — v2.79 → v2.82

### v2.82 — Dead code cleanup (~160 lines removed)
- **Export pane (p4)** removed entirely — was unreachable from nav since v2.81
- **Removed orphan functions:** `switchExpTab`, `renderSubmitted`, `editSubmittedClaim`, `renderExport`, `signOffConfirm`, `hideLosModal`, `renderFees`, `filterFees`, `filterRefs`
- **Removed `los-modal`** HTML (never shown)
- **Removed `ALL_PANES['p4']`**
- **Kept** `_buildAndDownloadCSV`, `exportCSV`, `clearQueue`, `removeClaim`, `purgeSubmittedClaims`, `reexportSubmitted` — still callable from console as a fallback
- **Kept** `renderRefs` (no-op, called on init) and `FEES` constant (used for fee code metadata lookups)

### v2.81 — Restore lost features from prior chat (b85711ed-8cb8-4de7-91b8)
- **Nav: removed Export button** — claims auto-sync to Google, iClinic export pane still exists internally but unreachable from nav
- **Nav: kept "Recently discharged"** rename (already done in v2.80)
- **`trueDischarge` flag** — only set by "Confirm discharge & remove"; "Remove from list - added in error" no longer pollutes Recently Discharged tab
- **`renderAddClaimResults`** filters by `discharged && trueDischarge`
- **`_doRestore`** clears `trueDischarge` on restore

### v2.80 — Nav rename
- "Recent patients" → "Recently discharged"

### v2.79 — Notes on consult form
- Added 2-row textarea below Claims preview
- User notes merged with auto-CCFPP note via ` | ` separator
- Notes propagate to base consult, modifier base, and increment claims

---

## Session 2026-05-06 (afternoon) — v2.25 → v2.78

### v2.78 — Streamlined schema
- **Removed 6 patient columns:** `fac`, `needsSticker`, `updatedBy`, `updatedAt`, `addedVia`, `needsReview`
- **Removed 10 claim columns:** `docnum`, `last`, `first`, `dob`, `sex`, `feeCode`, `loc`, `fac`, `ward`, `createdAt`
- **Derived at runtime:** `docnum` ← `st.doctors[alias]`, `last`/`first`/`dob`/`sex`/`ward` ← `st.patients[phn]`, `loc` ← `pat.ward === 'ED' ? 'E' : 'I'`, `fac` ← hardcoded `'OA040'`
- Updated `_buildAndDownloadCSV`, `submitConsult` (CCFPP note), `renderSubmitted`, `editSubmittedClaim`

### v2.77 — Diagnostic logging (still present, marked for removal)
- Added `[no-green]` console.log to `claimedToday()` when patient has claims but none match TODAY
- Used to identify the null-PHN issue — `st.patients[].phn === null` due to column-order mismatch on paste

### v2.76 — Init re-render
- `init()` calls `render()` after `await syncFromSheets()` so green tints draw with live claims

### v2.74 — Custom bed dropdown
- Replaced unreliable `<datalist>` with custom `bedSearchEl` / `selectBed` / `hideBedDd`
- Type "21" filters to 217, 218, 219... live; works on Add Patient and Edit Patient forms

### v2.73 — Smart bed sort
- `_bedKey()` strips trailing letter for numeric sort: `217A` and `217` sort together
- Hallway sorts last (key `[99999, 'Hallway', '']`)
- Replaces canonical-rooms-array sort

### v2.72 — 2W rooms
- Updated to 201–216 single occupancy + Hallway (was 201–214 + Hallway A/B)

### v2.71 — 2S rooms
- Removed trailing `A` on single-occupancy beds: `217, 218, 219, 220, 221, 222, 223, 224, 225A, 225B, 226A, 226B, 227–234, Hallway A/B`

### v2.70 — Geographic ward sort
- Patients within each ward block sort by canonical `rooms` array order
- Then numeric, then alphabetic for unknown beds

### v2.69 — Wifi error banner
- Red sticky banner at top with retry button when sync fails
- Triggered by `setSyncState('error')`, hidden on success

### v2.68 — **MAJOR: Sheets is single source of truth**
- `loadLocal` only reads `doc`, `recentIcds`, `recentRefs` from localStorage
- `sv()` is no-op for `patients`/`claims`/`doctors`/`changelog`
- `init()` awaits `syncFromSheets()` before rendering
- Sync merge: keep only in-flight local items < 2 minutes old
- Removed `_confP` / `_confirmedClaims` localStorage tracking entirely

### v2.67 — Stale localStorage fix
- Cleared stale `_confP` causing discharged patients to be dropped after sheet cleans
- 21-day window for default Recent list, search covers all

### v2.66 — Edit modal fixes
- × clear buttons on Referred by and Diagnosis fields
- Bed save: removed `|| p.bed` fallback that prevented "2" from overwriting "2502A"
- `clearSearchField()` helper for reuse

### v2.65 — push() guards
- Blocks patient/claim with no `id`
- Blocks empty patient (no last/first/phn)
- Blocks claim missing `phn`/`fee`/`date`

### v2.64 — Search bar fix
- Recent Patients pane gets `padding-top:52px` to clear sticky nav
- Inline `parseBool` on `discharged` in `renderAddClaimResults`
- Sort uses `parseDischargedAt`

### v2.63 — Consult submit fix
- Removed redundant `if (_submitGuard) return;` from `submitConsult` (was blocking all consult submits)

### v2.62 — Display dates as "06 May 2026"
- New `dispDate()` formatter — `DD/MM/YYYY` → `DD Mon YYYY`
- Applied to claim row q-sub, q-row date chip, delete confirm, DOB display
- Storage stays `DD/MM/YYYY`; CSV export stays `DD/MM/YYYY`

### v2.61 — `localISODate()` everywhere
- Replaces `new Date().toISOString().slice(0,10)` (UTC bug after 17:00 PDT)
- Applied to 6 date input pre-fills (directive, daily, combined, consult, other claim, discharge modal)

### v2.60 — Export pane sub-tabs
- Pending / Submitted / Log tabs
- Exported claims marked `submitted=TRUE`, get `submittedAt` timestamp
- 90-day auto-purge of submitted claims via `purgeSubmittedClaims()`
- Re-export button on Submitted tab

### v2.59 — Local-only claim retry
- Claims that failed to push to Sheets are kept locally and re-pushed on next sync

### v2.58 — `parseBool` + restore modal
- Sheets returns `'True'`/`'False'` strings; `parseBool()` normalises to JS boolean
- Restore patient modal asks: On Service or Off Service? (with `data-pid`/`data-list` to avoid quote nesting)
- Applied to `discharged`, `needsSticker` on every load and sync

### v2.57 — `localISODate()` introduced
- Earlier scaffolding for v2.61

### v2.56 — `parseDischargedAt`
- Normalises ISO timestamp strings from Sheets to epoch ms

### v2.50–v2.51 — Restore button + Recent Patients
- Restore button on discharged patient rows
- Removed 21-day cutoff initially (later restored as display-only filter)

### v2.43 — Patient PHN duplicate check
- `openMergeModal` triggers when adding a patient with existing PHN

### v2.40 — `ccuFeeForToday()`
- Auto-selects 1411 / 1421 / 1431 based on consecutive prior CCU days

### Earlier (v2.25 baseline)
- Foundation patches, KCA branding, ward layout, quick-tap buttons, CCU codes, consult submit guard, CCFPP notes with PHN, 00751 Pericardiocentesis, 33005 mandatory fields

---

## Architectural Principles (current as of v2.81)

### Sheets is single source of truth
- `patients`, `claims`, `doctors`, `changelog` never cached in localStorage
- Every page load awaits `syncFromSheets()` before rendering
- Sync merge: Sheets wins; keep only in-flight local items < 2 minutes old

### Date handling
| Context | Format | Example | Function |
|---|---|---|---|
| Storage | DD/MM/YYYY | `06/05/2026` | `fmtClaimDate()` |
| UI display | DD Mon YYYY | `06 May 2026` | `dispDate()` |
| iClinic CSV | DD/MM/YYYY | `06/05/2026` | `_buildAndDownloadCSV()` |
| Today's ISO | YYYY-MM-DD local | `2026-05-06` | `localISODate()` |

**Never:** `new Date(isoString)`, `toISOString().slice(0,10)`
**Always:** `localISODate()` for today, `parseISODate()` for date input values
**Sheets columns** must be **Plain text** to prevent auto-conversion

### Discharge flags
- `discharged: true` — patient hidden from active rounds
- `trueDischarge: true` — also shown in Recently Discharged tab (real discharge, not error removal)
- `dischargedAt` — epoch ms timestamp
- `dischargeDate` — DD/MM/YYYY for human display

### App-side push guards (v2.65)
- No id → blocked
- Empty patient (no last/first/phn) → blocked
- Empty claim (no phn/fee/date) → blocked

### Apps Script guards
- `saveRow`: blocks null/empty key, empty patient, empty claim
- `appendRow`: blocks empty objects
- `sheetToObjects`: skips entirely-blank rows

---

## Schema reference (v2.78)

**Patients (20 cols):** `id, last, first, phn, dob, sex, ward, bed, refby, refbyName, care, list, icd, roundedToday, discharged, dischargedAt, role, admitDate, mrp, dischargeDate`

(plus `trueDischarge` runtime flag — stored if present, optional)

**Claims (14 cols):** `id, alias, phn, fee, icd, units, date, refby, refbyName, notes, startTime, endTime, submitted, submittedAt`

---

## Lessons learned
1. Don't trust column order after pandas `groupby`/`reindex` — verify with `df.columns` before saving
2. `toISOString()` is poison — always use `localISODate()`
3. Sheets auto-formats DD/MM/YYYY as date types unless columns are pre-formatted as Plain text
4. `<datalist>` is unreliable on Safari/iOS — custom dropdowns are worth the extra code
5. Self-blocking guards are a recurring bug pattern — exactly one debounce guard at the outermost layer
6. Sheets-as-source-of-truth eliminates whole categories of "stale data on device X" bugs
7. **Always check past conversations before starting work** — features can be lost across chats if not documented here

---

## Outstanding work
- [x] ~~Remove `[no-green]` diagnostic~~ — already removed (no longer in code)
- [ ] Confirm 1202 weekend/stat base rate
- [ ] Confirm cardioversion 14101/14105 rates
- [ ] Rotate Anthropic API key (Cloudflare Worker)
- [ ] Build `email_intake.gs` for email-based patient intake
- [ ] Decide: email-added patients live immediately or pending-review state?
- [x] ~~Fully remove Export pane HTML~~ — done in v2.82
