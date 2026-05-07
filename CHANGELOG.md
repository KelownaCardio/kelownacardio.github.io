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
