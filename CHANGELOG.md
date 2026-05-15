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

### index.html v3.58 — Patient card style improvements (Kathryn's work, version constants bumped retroactively)

UI changes Kathryn made directly:
- DOB removed from patient card meta line (age+sex already shown — DOB was redundant noise).
- Dx (ICD description + code) added after MRP on all card views (ward list, alphabetical, off-service). Format: "Dx: Description (code)" via new `icdDescOnly()` helper that strips the trailing `(code)` from `icdShortLabel()`.
- Quick-tap action buttons (Directive / Combined daily / + Claim) now share a single full-width row using `flex:1` on each button (`nowrap`). New CSS rule `.wp-acts .bb { flex:1; min-width:0; text-align:center; padding:4px 2px; font-size:clamp(8px,1.15vw,10px); overflow:hidden; text-overflow:ellipsis; }`. Wrapper `<div style="width:100%">` around the `+ Claim` button removed.
- `showsCCUDaily()` tightened: now returns `p.role === 'mrp'` only. Dropped the legacy `|| p.care === 'ccu'` fallback. CCU/CSICU/ICU consulting cardiologists now correctly see Directive + Combined daily quick-tap buttons (not CCU Daily — we only claim CCU daily when Cardiology is MRP).
- Ward room-number circle vertically centered in card (`align-items:center` on `.wp`, removed `margin-top:2px` on `.wp-pos` and `.wp-pos-wrap`). Room number font reduced 10px → 8px for clearer name hierarchy. Color shifted text → text2.

**Note:** Kathryn had already authored these changes and updated the file header comment to v3.58, but the `BUILD_ID` and `APP_VERSION` constants were left at v3.57 — meaning these changes never flushed device caches. The v3.59 work below bumps the constants properly so both v3.58 UI changes AND v3.59 CCU_DAILY work go out together.

### index.html v3.59 — CCU_DAILY elimination

CCU_DAILY was a synthetic intermediate fee tag (banded at export-time by `ccuConsolidate()`). It is **no longer written** to the fee column anywhere. All CCU billing paths now write the correct 1411/1421/1431 band directly at tap time using a new date-aware helper.

**Trigger:** a phantom CCU_DAILY claim appeared in change history (yesterday 10:08 via "App") that the user did not deliberately enter. Investigation found two write paths that hard-coded `CCU_DAILY`:
  1. `_cvFillClaim()` calendar gap-fill picker
  2. `dischAddVisit()` discharge modal "CCU Daily" button — pre-styled as the blue default for CCU/ICU MRP patients, easily mistapped on iPad
The user confirmed: CCU_DAILY is not a real fee code; only 1411/1421/1431 are valid. `quickCCUBtn` already wrote banded fees correctly — these two paths were the laggards.

**Changes:**
- New `ccuFeeForDate(p, dateStr)` — generalized from `ccuFeeForToday()`. Counts consecutive CCU days STRICTLY before the target date (excludes the target itself) and returns the correct band: day 1 → 1411, days 2–7 → 1421, day 8+ → 1431. `dateStr` is DD/MM/YYYY (Sheet storage format).
- `ccuFeeForToday(p)` kept as a thin wrapper for backward compatibility.
- Hard guard added at the top of `addClaim()` — if `fee === 'CCU_DAILY'` or `feeCode === 'CCU_DAILY'`, recompute via `ccuFeeForDate(p, date)`, log a console.warn, and substitute. Defence in depth: catches any future regression or call site we missed.
- `_cvFillClaim('ccu', …)` now computes `ccuFeeForDate(p, dateStr)` and writes that.
- Discharge modal CCU Daily buttons (both branches: CCU/ICU MRP default + ward MRP non-default) compute `ccuFeeForDate(p, TODAY)` at render time and embed it in `data-fee`. The user-facing label still reads "CCU Daily" — the band is invisible at the tap surface but correct in the saved row.
- Claim edit fee dropdown no longer includes `{code:'CCU_DAILY', label:'CCU daily tap'}` — can't be selected as a fee from the edit modal anymore.

**What was NOT changed:**
- `ccuConsolidate()` is left intact. It is now effectively a no-op because no new CCU_DAILY rows are written, but legacy CCU_DAILY rows already in the Sheet still pass through it correctly at export. A future migration (to land with Data Check Stage B) will re-band the legacy rows in place; until then, `ccuConsolidate` handles them.
- Display-side CCU_DAILY recognition (feeDesc lookup, alreadyBilledToday filters, claimedTodayFee CCU_FEES array, etc.) is left intact so legacy rows render correctly in the daily list, daily claims modal, calendar, etc.

**Files:** `index.html` (BUILD_ID `v3.59-2026-05-15-no-more-ccu-daily`, APP_VERSION `v3.59`, APP_BUILT `2026-05-15`)

### upload.html v1.16 — MOST fee code correction (03701 → 78720)

One-line fix to `upload.html` consult submit handler. The MOST add-on claim was being written with `fee:'03701'` which is not a valid BC MSP fee code. The PWA `index.html` correctly uses `78720` (the actual MOST advance care code) — this brings the upload tool into alignment. The mistake had been baked in since v1.8 (2026-05-12).

**Files:** `upload.html` (v1.15 → v1.16, version badge bumped, two changelog notes updated to mark the correction)
**Backend:** Apps Script v2.20 unchanged.

---

## Session 2026-05-15 — index.html v3.43 → v3.57 + Apps Script v2.16 → v2.20 + upload.html v1.13 → v1.16

This session was a major UX/architecture polish pass plus validation hardening across the whole stack.

### index.html v3.44 — Major Add Patient redesign
- **New layout**: PHN first (full width, larger font), Last/First row, DOB/Sex row. No more MRP field on the patient demographics section.
- **Claim card** with three toggle buttons: [Consult] [Lmtd Consult] [Other Claim] — swaps the form area dynamically. Consult/Lmtd pre-select 33010/33012.
- **Two submit paths**:
  - Primary blue: "Submit claim and add patient to list" → `apSubmit(true)` (creates patient + claim, navigates to Rounds)
  - Secondary: "Submit claim only — not following" → `apSubmit(false)` (creates claim, marks patient `discharged: true, trueDischarge: true, consultOnly: true`, navigates to Recently Discharged)
- **Location card always visible** when add-to-list path is chosen, with Ward/Bed, MRP service, Cardiology Role, and On/Off pills.
- New `apSubmit(addToList, _skipDupCheck)` async function handles everything end-to-end.
- Pencil-icon patient edit modal simplified — removed consult info section.
- Ward-badge tap → location modal now has MRP/Role/pills (was Ward/Bed/On-Off only).

### v3.45 — Default to add-to-list
- Swapped button order: top primary is "Submit claim and add patient to list"; bottom secondary is "Submit claim only — not following".
- Location card always visible (no more toggle).
- Performing physician injection refactored into `injectApPerformingDoc()` helper. Explicitly sets `select.value = curAlias` after rendering options so the logged-in doctor always defaults correctly.

### v3.46 — Card tints for visual continuity
- Three CSS classes: `.card-patient` (pale lavender #f4f2f9), `.card-claim` (soft cream #fff8e8 + amber border), `.card-location` (teal).
- Applied across Add Patient pane, pencil-edit modal, and ward-badge → location modal so the same card color appears regardless of how you arrived.

### v3.47 — Room badge → dynamic pill
- `.wp-pos` converted from fixed 21px circle to flexible pill: `min-width:24px; height:22px; padding:0 6px; border-radius:11px; letter-spacing:-.2px`.
- Short rooms ("2", "6") still appear round; long rooms ("208A", "226B", "1C17A") expand horizontally without truncation.

### v3.48 — Cardiology role pills
- Location card: replaced role dropdown with [MRP] / [Consulting] pill toggle in all three contexts (Add Patient, pencil edit, ward-badge edit).
- Tap MRP → MRP service snaps to "Cardiology", care snaps to ccu/daily based on ward.
- Tap Consulting → if MRP service is Cardiology, switch to "Other"; if it's non-Cardiology (e.g. Hospitalist from Meditech), preserve existing value.
- New `apRolePill`, `leRolePill`, `peRolePill` functions plus matching sync helpers. `mrpChange` calls `syncApRolePills` so manual MRP service changes update the pill.

### v3.49 — Smaller pill buttons
- `.ap-list-pill` shrunk ~20%: padding 9→7px, font 13→11px. All On/Off, role, and sex pills affected.

### v3.50 — Polish pass: dates, colors, ICDs, spacing
- **All DOB displays** flow through `dispDate()` → "31 May 1945" format. Storage and CSV stay DD/MM/YYYY. Fixed three raw-DOB leaks (recently-discharged row, merge modal, soft-duplicate modal).
- **Claim chip colors match calendar legend** — added `.chip-yellow` and `.chip-skyblue` classes. FEES array now uses: Consult=yellow (33010/33012/33014), Daily=green (33008), Directive=skyblue (33006), CCU=red (1411/1421/1431/1441), MOST/Discharge plan=green (78717/78720), Modifiers=blue (1200/1201/1202/1205/1206/1207), Procedures=red (Y33025/00751), Emergency consult=red (33005).
- **List view and day-details color mapping** synchronized so calendar and list show identical colors per fee code.
- **ICD displays** use `icdShortLabel()` everywhere → "Description (code)" format. Fixed combined-daily reason modal which was showing raw code.
- **Patient row spacing tightened**: `.wp-name` 14→13px, removed duplicate definition. wp-meta/wp-chips/wp-acts margins reduced 1-2px. Row padding 9→8px.
- **Sex selection → pills**: M/F dropdown replaced with pill toggle in both Add Patient and Patient Edit. OCR auto-fill activates the right pill.

### v3.51 — On/Off color convention + CCFPP simplification
- **Blue = On, Amber = Off everywhere**: top tabs (`#ls-on` blue tint, `#ls-off` amber tint when active) and all pills (new `.tone-amber.on` modifier class for the Off pill). Role and Sex pills stay blue when active (not on/off indicators).
- **CCFPP note text simplified**: was `'CCFPP added for overlapping claims'`, became dynamic per actual peer detected.

### v3.52 — CCFPP names the preceding patient
- CCFPP note format: `CCFPP <first> <last> (<PHN>)` for the overlapped patient (BC billing requirement). Loop only matches when prev consult starts before new one, so identification is correct.

### v3.53 — Real interval overlap, mandatory times
- **Start/end times mandatory** on 33010/33012. Both `submitConsult` and `apSubmit` block submission with toast if either is empty (they auto-fill but can't be empty).
- **Interval overlap math** replaces the old 75-min proxy: ranges `[a,b]` and `[c,d]` overlap iff `a<d AND c<b`. Past-midnight handled by `+1440` shift. 1411/1421/1431 CCU codes excluded (filtered by fee).

### v3.54 — Cross-midnight CCFPP
- Fixed gap: prev `c.date === dateFmt` filter excluded cross-midnight cases. New logic builds prev/next date strings via `parseDMY ± 86400000ms` and normalises all ranges into the new consult's minute-frame.
- Patient A 23:30→00:20 May 11 and Patient B 00:10 May 12 now correctly flag as overlapping regardless of which gets entered first.

### v3.55 — CCFPP retroactive peer updates
- Extracted `ccfppDetectAndUpdate(newP, alias, dateISO, dateFmt, startStr, endStr)` helper.
- Collects ALL overlapping peers (deduplicated by PHN) — not just the first.
- New claim's note lists every peer found, joined by ` | `.
- **Retroactively updates** each peer's existing consult + modifier claims (fees: 33010/33012/1200/1201/1202/1205/1206/1207 — NOT MOST/78720 or CCU) with `'CCFPP <newP first> <newP last> (<newP phn>)'`. Idempotent — checks `existing.indexOf(reverseNote) !== -1` before appending. Pushes each update via `push('saveClaim', c)`.
- Helper called from both `submitConsult` and `apSubmit` consult branch.

### v3.56 — Audit trail (createdBy / createdAt)
- Every new claim stamped in `addClaim` with `createdBy = st.doc.alias` and `createdAt = Date.now()`.
- Every new patient stamped at both creation points (`_addPatientCore`, `apSubmit`).
- New `auditTs(ms)` formatter — "today HH:MM" for today, "DD Mon YYYY HH:MM" otherwise.
- Displayed in day-details claim list ("Submitted by KBrown · today 14:32") and patient edit modal footer ("Added by KBrown · 14 May 2026").
- Fields immutable once set; never overwritten on subsequent edits.

### v3.57 — Validation hardening (frontend)
- **`apSubmit` and `_addPatientCore`** now reject PHNs that aren't exactly 10 digits. Visual amber border + toast "PHN must be 10 digits".
- **Orphan-claim healer** in sync code: skips creating stub patients when source claim has no last name (was silently inserting nameless stubs as "fix" for data inconsistency).

---

### Apps Script v2.17 — Server-side validation hardening
- **`saveRow` for Patients** requires `last` AND a 10-digit PHN. Previous validation accepted `last OR first OR phn` — too loose. Rejects nameless rows with a specific per-field error message.
- **`bulkUpsertPatients`** skips rows missing last name or with non-10-digit PHN, with per-row error messages.
- **`runDataCheck`** new `MISSING_NAME` HIGH-severity check flags any existing nameless patient row.
- Root cause investigation found 8 weird patient rows from upload.html OCR-fast-tap edge cases (PHN/DOB/ward filled but no name; 3 of them duplicates of PHN 9089051589).

### v2.18 — Cleanup tool for existing data
- New menu item: **"🩹 Clean up nameless patients"**.
- For each nameless patient row, looks in Claims tab for a same-PHN claim with a name; copies it over.
- Removes PHN-duplicate patient rows (keeps earliest, deletes the rest).
- Result dialog summarises recovered / duplicates / unrecoverable.

### v2.19 — Meditech demographic healing + smarter cleanup
- **`bulkUpsertPatients`** now fills blank `last/first/dob/sex` on existing rows from Meditech payload. Already-populated values are NEVER overwritten. Meditech import becomes a passive cleanup tool for incomplete rows.
- **`cleanupNamelessPatients`** now:
  - Skips OCR routing-code garbage as a "last name" source (blacklist: MOS/REN/AGG/EDC/ACIN/MHL with or without digit suffix)
  - Strips trailing punctuation from recovered names ("Keith :" → "Keith")
  - Also recovers DOB and sex from Claims tab when those exist on a claim

### v2.20 — Cleanup tool also heals nameless claims
- Third pass added to `cleanupNamelessPatients`: scans Claims tab for rows with blank `last`/`first` whose PHN matches a named patient on the (now-cleaned) Patients tab, and backfills the name.
- Common case: historical upload pushed claims to Sheets before patient row got its name filled in.
- Menu item renamed to **"🩹 Clean up nameless patients & claims"**.
- Result dialog: patients healed / duplicates removed / claims healed / still-nameless count.

---

### upload.html v1.16 — Validation hardening
- **`exportSheets` blocks submit** if any claim has no last name. Clear toast: "X claims missing patient last name (PHN ...). Fill in the patient last name before exporting."
- **`exportSheets` blocks submit** if any PHN isn't exactly 10 digits.
- **"New patient — not found" banner** now amber + bold with explicit instruction to type the name themselves (was subtle grey, easy to miss — this is what allowed the 8 nameless rows to slip through).

### Root cause of nameless rows (investigation)
- Apps Script `lookupPatient` only searches Patients tab. If PHN exists in Claims tab but not yet in Patients (e.g. previously uploaded historical claim), lookup returns `found: false`.
- Pre-fill `_fill('f-last', p.last)` doesn't run (no `p`).
- Old subtle banner read "New patient — not found in Patients tab, no existing claims." Easy to miss.
- User submits with empty name field, assuming the lookup had it.
- `buildClaims` creates claims with `last:''`, `first:''`.
- `buildPatientsFromClaims` creates patient row with empty name.
- Old `savePatient` validation only required ONE of last/first/phn → saved.

---

## Key engineering principles reinforced this session

- **Server validation is authoritative**: tight validation in Apps Script protects against any frontend hole. v2.17 hardening + v2.20 cleanup tool together make data corruption nearly impossible.
- **Three-layer defense**: client input validation (visual feedback) + client submit check (toast) + server save guard (rejection with specific error message).
- **Heal, don't overwrite**: Meditech bulkUpsert fills only blank fields. Patient names from upload.html user-typed input are preserved.
- **Cleanup tools are idempotent**: re-running the cleanup is safe — checks for already-present values, doesn't duplicate notes.
- **CCFPP requires both consults to have modifiers**: not just any overlap, but overlapping CALL-OUT windows.
- **Date-range overlap math**: `a<d AND c<b` is the canonical formula. Past-midnight handled by minute-frame normalisation, not date logic.
- **Audit fields are immutable**: `createdBy`/`createdAt` set once at creation, never overwritten.

---

## Schema reference (current as of v3.57 + v2.20)

**Patients (incremental from prior):** add `createdBy`, `createdAt` columns when ready. v2.20 doesn't yet write them but `addClaim` and `apSubmit` set them in the JS object. They'll flow through `push('savePatient', p)` and `push('saveClaim', c)` — Apps Script `saveRow` writes whatever fields match the column headers. Add the columns to your Patients and Claims tabs when ready to capture going forward.

**Claims columns (current):** `id, alias, docnum, last, first, phn, dob, sex, fee, feeCode, icd, units, date, loc, fac, refby, refbyName, notes, startTime, endTime, ward, room, claimType, createdAt, submitted, submittedAt, source, savedAt` — note `createdAt` already in schema.

---

## Outstanding work
- [ ] Add `createdBy` column to Claims tab (Apps Script HEADERS array)
- [ ] Add `createdBy` and `createdAt` columns to Patients tab
- [ ] After deploying v2.20: re-run "🩹 Clean up nameless patients & claims" to heal the 24 nameless claims
- [ ] After deploying v2.19+: do a Meditech import to heal Ehman/Vagar/Colletti DOB/sex (if still admitted)
- [ ] Manual lookup of PHN 9011235231 (OCR captured routing code "Mos 99" only)
- [ ] Manual strip of trailing " :" on Colletti row OR re-run cleanup (v2.19+ does this automatically)
- [ ] Rotate Anthropic API key (Cloudflare Worker)
- [ ] Build `email_intake.gs` for email-based patient intake
- [ ] Decide: email-added patients live immediately or pending-review state?

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
