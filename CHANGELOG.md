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

## Session 2026-05-07 — v3.14

### v3.14 — Defensive sweep + daily claims list

**Two things:**

#### 1. Defensive sweep (carrying lessons from v3.12 forward)

After fixing the silent `.slice()` crash in `dischargedRow`, audited every other patient row renderer for the same bug class. Found and fixed:

- **Deleted `phnOrWarn(p)`** — defined at line 2888, never called. Had the same `p.phn.slice(-4)` bug. Dead code, gone.
- **`p.mrp.toLowerCase()`** in form prefill — wrapped in `String(p.mrp || '')` even though guarded by `if (p.mrp)`. A non-zero numeric `mrp` would have crashed.
- **`ep.last.toLowerCase()` / `ep.first.toLowerCase()`** in Meditech import duplicate detection — wrapped in `String(... || '')`.
- **All four `a.last.localeCompare(b.last)` sort callers** — wrapped each side in `String(... || '')`. Numeric or undefined `last` would have crashed every sort.

**New helper:** `safeRenderRows(patients, rowFn)`. Wraps each row render in try/catch — one bad patient renders as a small ⚠ placeholder instead of killing the entire list. All four `.map(alphaRow)` and `.map(offRow)` callers now use it.

**`wardHtml`'s `pts.forEach` loop** — also wrapped in try/catch with the same placeholder pattern. (It wasn't a `.map`-able pattern because it appends to `h` inline.)

Net effect: any future Sheets data quirk (a number where a string was expected, an unexpected null, etc.) renders a placeholder for that row but the rest of the list remains visible.

#### 2. Daily claims list (new feature)

Tap the green **`$X (N claims)`** in the header to open a modal showing:
- Every claim billed today by the signed-in doctor
- Sorted by patient last name → start time
- Format: `Last, First` — `Fee description (start time)` — `$amount`
- CCU rollup taps shown muted with note "(rolls up at export)"
- Title bar shows total claims count and total dollars

Quick visual check at end of day that nothing's been missed. Single modal, no edit functionality (read-only — use the patient summary or claim screen for changes). Scrollable up to 60% of viewport height.

Both sides (`$X` and `(N claims)`) are tappable. Cursor pointer on hover.

---

## Session 2026-05-07 — v3.13

### v3.13 — Defensive sweep across all row renderers and PHN comparisons

Same root cause as v3.12 but applied across every other patient row renderer and lookup site, before they bite.

**Defensive coercion at the sync boundary** — `syncFromSheets` and `loadLocal` now coerce `phn`, `bed`, `last`, `first` to strings as patients arrive. Sheets returns these as numbers when the cell happens to be all-digits. Doing this once at the boundary means downstream code can rely on string semantics.

**Type-safe PHN equality** — added `samePhn(a, b)` helper that does `String(a) === String(b)` with null guards. Replaced 14 sites across the codebase that used `c.phn === p.phn` (which silently returned false when one side was a string and the other a number). This was a meaningful bug — could have caused inconsistent "Seen today" green chips, missed dedup of duplicate claims, and broken back-fill from claim history. Worth its own bullet.

**PHN-keyed hash maps coerce keys** — `_localByPhn` and `_patByPhn` now use `String(phn)` for both writes and reads, preventing miss-on-typo lookups.

**Self-defending `wardLabel`** — now always returns a string (`String((WARDS[w] && WARDS[w].label) || w || '')`) so callers can safely chain `.replace`, `.slice`, etc.

**Self-defending row renderers**:
- `alphaRow`, `offRow`: every patient field that goes into HTML is wrapped in `String(p.x || '')` — `last`, `first`, `bed`, ward labels, etc.
- `wardHtml`: each per-patient render in the ward `forEach` is wrapped in try/catch. One bad patient row no longer kills the whole ward's render.
- New `safeRowMap(arr, renderFn)` helper used at all 4 callsites of `alphaRow` and `offRow`. Same pattern as `renderDischarged` from v3.12.

**Misc fixes**:
- `mrpLower = String(p.mrp || '').toLowerCase()` — was unguarded against numeric `mrp`.
- Meditech import existing-patient check coerces `ep.last`/`ep.first` to string before `.toLowerCase()`.
- All `a.last.localeCompare(b.last)` sorts now use `String(a.last || '')` etc.
- Removed unused `phnOrWarn(p)` helper that had the same `.slice(-4)` bug.

The geographic ward view, alphabetical view, off-service view, search results across both lists, and Recently Discharged are now all defensive against mixed-type field data. One bad row in any of them produces a "⚠ Could not render X, Y" placeholder instead of a blank pane.

No behavioral changes for the user — purely robustness.

---

## Session 2026-05-07 — v3.12

### v3.12 — Tabula rasa: clean rewrite of discharged pane

**Cause of the original bug** (now confirmed): `dischargedRow` called `p.phn.slice(-4)` but `p.phn` could be a number (not a string) when returned from Sheets. `.slice` on a number throws TypeError, kills the entire `recent.map()` loop silently, leaves `container.innerHTML` unchanged, and the pane appears empty.

**Wholesale rewrite** of all discharged-pane code:

- **Deleted** ~302 lines: old `renderDischargedList`, old `dischargedRow`, `trialDirectFetch`, all the diagnostic checkpoint scaffolding, all the verbose console logging, the trial button, the trial-results container.
- **Added** ~190 lines of clean, defensive code:
  - `renderDischarged(query)` — pure function over `st.patients`. Filters → sorts → date filter → search filter → render.
  - `dischargedRow(p)` — coerces every field to a safe type before use (`String(p.phn || '')` etc.). Wrapped in try/catch in the caller so one bad row can't kill the whole list.
  - `isDischarged(p)` — type-safe truthy check on `discharged` field.
  - `toEpochMs(v)` — type-safe parser for `dischargedAt` (handles number, numeric string, ISO string).
  - `restorePatient(pid)` and `_doRestore(pid, list)` — kept clean, no surprises.

**No more:** `_pendingPush` references in this code path, no merge logic, no diagnostic scaffolding, no checkpoint tracking, no trial button, no `_lastSyncResponse` mutations. The pane reads `st.patients` (populated by `syncFromSheets`) and renders. Period.

**The sync mutex from v3.11 stays** (prevents concurrent syncs from racing). The `syncFromSheets` function itself is unchanged from v3.11.

**Restored existing v2.81 behavior:** restore button on each row, tap row to bill missed claim, all working through the same well-tested paths.

---

## Session 2026-05-07 — v3.11

### v3.11 — Trial proves data is fine; isolating sync vs render

**Trial succeeded**: HTTP 200 in 7.5s, 45 patients returned, 16 discharged correctly identified. Apps Script and Sheets are 100% fine. The bug is in the client-side sync flow.

**v3.11 changes:**

1. **Sync mutex (`window._syncInFlight`)** — prevents concurrent syncs from racing each other. iOS Safari may fire `pageshow`, `visibilitychange`, and init's sync close together, kicking off multiple parallel `getAll` requests. Each one mutates `st.patients` independently and the result depends on which finishes last. The mutex serializes them.

2. **Simplified patient merge** — replaced the complex pending-push protection with a simpler "remote wins; keep local-only with pending pushes" logic. Less surface area for bugs.

3. **Trial button now also injects results into `st.patients`** — proves whether the bug is in sync OR in render. After tapping the trial button:
   - If the discharged list below populates with 16 patients → bug is 100% in `syncFromSheets` (data + render are fine)
   - If the discharged list is still empty → bug is in `renderDischargedList` itself

**For testing v3.11:**
1. Load it
2. Wait for first sync to complete (sync dot goes green)
3. If discharged list is empty → tap **🧪 Trial: direct fetch from Sheets**
4. The discharged list should now populate with 16 patients
5. Report back what you see

### Note on dischargeDate vs dischargedAt
Both fields exist in the schema. `dischargedAt` (epoch ms, set by `removePatient`) is the authoritative timestamp. `dischargeDate` (DD/MM/YYYY string, set by `dischConfirmRemove`) is for human display only. Some patients have only `dischargedAt` because they were discharged via flows that didn't set the human-readable string. The app's filtering uses `dischargedAt` exclusively, so this isn't the bug — but worth fixing later for cleanliness.

---

## Session 2026-05-07 — v3.10

### v3.10 — Trial: direct fetch bypassing all sync/merge layers

**User insight:** Claims read/write works (quick-tap buttons persist, green tints work, $516/5 claims in header is correct). So the Sheets ↔ App connection is NOT broken. Something specific to the discharge-list path is failing.

**Approach:** Add a "🧪 Trial" button on the Recently Discharged pane that:
1. Fires its own `fetch(..../getAll...)` — independent of `syncFromSheets()`, `_pendingPush`, `st.patients`
2. Parses the response
3. Filters `patients` for `discharged=true` (handles boolean `true`, string `'true'`/`'TRUE'`, etc.)
4. Renders the matches as a plain list with raw field values

This isolates the question: does the data ARRIVE from Sheets correctly, or does it arrive but get lost in our local processing?

**Three possible outcomes when you tap the Trial button:**

1. **Trial shows the 16 discharged patients** → Sheets and Apps Script are fine; the bug is in our local `syncFromSheets` / merge / `_pendingPush` logic. We can fix that with high confidence.

2. **Trial shows 0 discharged patients but does show all 45 patients** → Apps Script is returning data but the `discharged` field is being lost somewhere on the wire. The diagnostic will show what `discharged` field actually looks like (e.g., empty string, undefined).

3. **Trial fails to fetch / shows 0 patients total** → The fetch itself is broken for this specific user/device, despite claims working. (Unlikely given claims work, but possible.)

**Tap the button and screenshot the result.** That will tell us which of the three failure modes is actually happening.

---

## Session 2026-05-07 — v3.09

### v3.09 — iOS Safari BFCache fix: prevent hung fetch promise restoration

**Apps Script analysis (with full source from user):** The Apps Script is fine. `getAll()` reads 4 sheets via `sheetToObjects`, max ~46 actual rows of patient data. Should respond in under a second normally.

**Real diagnosis:** iOS Safari is **caching the page state including in-flight fetch promises** in BFCache. When the user "refreshes" on iPad:
1. Safari froze the JS heap when navigating away (including `st.claims` with 5 items, `_syncAttempts: 1`, and the in-progress `await fetch(...)` for `getAll`)
2. Safari restored the entire JS heap on "refresh" — variables come back populated, but the network request was severed and the fetch promise hangs forever
3. Diagnostic shows `Checkpoint: fetch-start` because the awaited fetch never resolves
4. Header shows `5 claims` because `st.claims` was restored from BFCache memory, not re-synced

**Two fixes:**

1. **Disable BFCache caching of this page.** Adding an empty `unload` event listener prevents iOS Safari/Firefox from freezing the page state. This forces a true reload on every navigation and prevents the "in-flight fetch never resumes" pathology. Trade-off: page reloads are slightly slower (no BFCache speedup), but state is always fresh.

2. **Fire `syncFromSheets()` on EVERY pageshow**, not just persisted ones. Defensive — even on a hard reload, this catches edge cases.

3. **Explicit fetch options** to fix iOS Safari Apps Script redirect issues:
   - `redirect: 'follow'` — Apps Script returns 302 to `googleusercontent.com`
   - `cache: 'no-store'` — prevents iOS Safari from intercepting with cached fetch responses
   - `credentials: 'omit'` — Apps Script doesn't need cookies; including them confuses CORS
   - URL cache-bust query param `&_t=<now>` — defeats any URL-keyed cache

**Apps Script does NOT need changes** — the issue is entirely client-side in iOS Safari's BFCache behavior interacting with cross-origin fetch promises.

**Please test v3.09:**
1. Load it
2. Hard refresh (or close + reopen the tab)
3. Navigate to Recently Discharged
4. Diagnostic should show `Checkpoint: completed` with patient counts populated
5. The 16 discharged patients in your Sheets should appear

If checkpoint is still `fetch-start` after 45 seconds, the fetch timeout will fire and show "Fetch aborted after 45s timeout" — at which point the issue is genuinely network-side, not BFCache-side.

---

## Session 2026-05-07 — v3.08

### v3.08 — Surface stalled fetches; handle iOS BFCache restores

**v3.07 finding from screenshot:** Checkpoint stuck at `fetch-start`. Header shows 5 claims loaded ($516). Total attempts: 1. This is contradictory — only one sync ran, it never completed, yet data is loaded.

**Diagnosis:** The `await fetch(...)` is hanging indefinitely. The Apps Script is taking too long to respond (or never responding). The 5 claims in the header are from a PRIOR session whose state was restored by **iOS Safari BFCache** (back/forward cache). When iPad Safari "refreshes" without a hard reload, it can restore the entire JavaScript heap from cache, including in-memory state, while a stalled in-flight fetch continues from where it was interrupted.

**Two fixes:**

1. **45-second fetch timeout via AbortController.** `await fetch(...)` no longer hangs forever — if no response in 45s, the fetch is aborted and the diagnostic shows `Fetch error: Fetch aborted after 45s timeout — Apps Script may be slow or unreachable`. This prevents the silent hang and makes the failure visible.

2. **`pageshow` event handler with `e.persisted` check.** When iOS Safari restores the page from BFCache, this fires. If we're being restored from cache, force a fresh `syncFromSheets()` immediately — the in-memory state could be from another session and is untrustworthy.

**Likely root cause of the original problem:** The `getAll` request to Apps Script is timing out for the patients sheet specifically. Apps Script reads 1000-row Patients sheet × 27 columns and applies `setNumberFormat` operations — on slow networks or a busy Apps Script instance, this can stall past iOS Safari's default fetch timeout.

**To address the actual underlying performance**, you may need to optimize the Apps Script's `getAll` to:
- Only read non-empty rows (use `getDataRange()` instead of `getRange(1, 1, lastRow, lastCol)` if possible)
- Avoid unnecessary per-cell formatting calls during reads
- Maybe split into separate `getPatients` and `getClaims` endpoints to fail/succeed independently

For now: load v3.08, navigate to Recently Discharged, share the diagnostic. With the timeout in place, you'll see a definitive answer (either it succeeds → data appears, or it shows "Fetch error: aborted after 45s" → Apps Script side issue confirmed).

---

## Session 2026-05-07 — v3.07

### v3.07 — Checkpoint-based sync diagnostic

**v3.06 finding:** Diagnostic showed "Attempts: 1, No response captured yet" while header showed 5 claims loaded ($516). That's contradictory unless the sync that loaded claims was somehow not captured by my diagnostic. Most likely cause: the capture happened mid-sync and the function exited via an early `return` (HTTP not-ok) before reaching the response-capture code.

**v3.07 fix:** Captures sync state at every checkpoint, not just at successful completion:
- `attemptN` — which attempt number this is
- `startedAt` — timestamp when sync began
- `checkpoint` — current stage: `fetch-start` → `fetch-returned` → `parsing-json` → `json-parsed` → `merge-patients-running` → `completed`, or `EXCEPTION at <stage>` if it threw
- `httpStatus` / `httpOk` — captured immediately after fetch returns, even if not-ok
- `exception` — if caught
- `completedAt`, `stPatientsFinal`, `stClaimsFinal` — final results if sync completed

The diagnostic panel now shows whichever checkpoint was last reached, even if sync exited early. This will tell us the EXACT stage where things go wrong on the user's device.

**Please load v3.07 and share what the diagnostic shows.** Specifically the "Checkpoint" line — that pinpoints exactly where in the sync function execution stopped.

---

## Session 2026-05-07 — v3.06

### v3.06 — Diagnostic was self-erasing; preserve sync history across attempts

**Bug in v3.05 diagnostic:** I was resetting `window._lastSyncResponse = null` at the start of every `syncFromSheets()` call. This meant: a second sync (triggered by `visibilitychange` or push retry) would wipe the diagnostic from the first successful sync before failing, leaving "No sync has run yet" displayed even when sync had clearly run (claims loaded, dot turned green earlier).

**Fix:** Removed the reset. `_lastSyncResponse` now persists across syncs — diagnostic always shows the latest CAPTURED response, regardless of whether subsequent attempts succeed or fail. `_lastSyncError` is reset per-attempt as before (it's about THIS attempt's outcome).

**Additional diagnostic added:**
- `window._syncAttempts` — counts total sync calls since page load
- `lastResp.patientsMergeRan` — explicit flag for whether the patient-merge block ran
- `lastResp.patientsMergeSkipReason` — why it was skipped (`d.patients is falsy` or `d.patients is not an array`)
- `lastResp.patientsAfterMerge` — `st.patients.length` after merge completes

This will show definitively whether:
1. Apps Script returned valid `d.patients` (then merge would have populated `st.patients`)
2. `d.patients` came back malformed (merge skipped, st.patients stayed empty)
3. Merge ran but ended with 0 patients (logic bug in my code)

**Please load v3.06 and share what the diagnostic shows now.** Specifically the "Sync history" block — d.patients type/length, merge ran true/false, st.patients after merge.

---

## Session 2026-05-07 — v3.05

### v3.05 — Capture sync response shape (claims load but not patients)

**New finding:** v3.04 diagnostic shows: signed in as KBrown, **5 claims loaded** ($516 in header), but **0 patients in memory**, sync dot **red**.

This is impossible if sync was wholly failing — claims wouldn't have loaded either. So sync GET succeeded and returned data, but `d.patients` was either falsy, null, undefined, or non-array (which is why the patient merge block at line 1668 was skipped while claims merge ran). Possibilities:
- Apps Script `getAll` is partially failing — returning `claims` but not `patients`
- Apps Script `getAll` is hitting a quota/timeout reading the Patients sheet
- `d.patients` is being returned as something unexpected (object instead of array, etc.)

**This release captures the actual response shape** in `window._lastSyncResponse`:
- Type of `d.patients` and length
- Type of `d.claims` and length
- All top-level keys in the response
- Timestamp of the sync

**The Recently Discharged diagnostic panel now shows this data**, so we can see exactly what the Apps Script returned. This is the missing piece — the parsed-JSON shape.

**Please:** Load v3.05, navigate to Recently Discharged, expand the diagnostic, and share what "Last sync response" says. That'll definitively tell us whether the issue is on the Apps Script end or the parsing end.

---

## Session 2026-05-07 — v3.04

### v3.04 — Diagnose-and-recover: sync error capture + preserve sign-in across builds

**Diagnostic finding:** v3.03's UI diagnostic showed total patients in memory = 0. So the discharged list isn't broken — **sync is silently failing** and the app has no patient data. The red sync dot stays red. This is why no discharged patients show up: there are no patients at all in `st.patients`.

The user is also signed out — "Sign in" button is visible. This was a side-effect of every BUILD_ID bump wiping the entire `kgh5:*` localStorage namespace, including `kgh5:doc` which holds the doctor signin.

**Fixes:**

1. **Preserve safe local-only keys across BUILD_ID changes.** The cache-buster now wipes everything EXCEPT `kgh5:doc`, `kgh5:recentIcds`, `kgh5:recentRefs`, and `kgh5:customWards`. Doctors stay signed in across version bumps. Clinical data (patients/claims) still gets cleared since Sheets is the source of truth.

2. **Capture sync errors in `window._lastSyncError`.** Every failure path of `syncFromSheets` now records what went wrong: HTTP status, Apps Script error message, or thrown exception text.

3. **Visible error in Recently Discharged diagnostic.** The diagnostic panel now shows the last sync error in red (Apps Script error message, HTTP code, or network exception).

4. **Retry button** in the diagnostic panel — taps re-run sync and re-render.

5. **Diagnostic auto-expands** (open by default) so user sees it immediately.

**For the user:** Load v3.04. Open Recently Discharged. The diagnostic will show what went wrong with sync. Tap "Retry sync" to attempt again. Share the error text and I can pinpoint exactly what's failing.

---

## Session 2026-05-07 — v3.03

### v3.03 — Visible UI diagnostic for empty Recently Discharged

**Status of investigation:** User uploaded their actual Sheets data. The data is **correct** — Sheets has 16 patients with `discharged='true'` and valid `dischargedAt` timestamps within the last 21 days, including a patient discharged just minutes before the export. None show up in the user's app.

**What this rules out:**
- Apps Script not saving data correctly (it is)
- `parseBool` / `parseDischargedAt` parser bugs (the data formats are handled)
- Sync race wiping discharge updates (the data persisted correctly)

**What's left to investigate:**
- Whether `st.patients` on the user's device actually contains these 16 patients with `discharged: true` at the moment of viewing
- Whether the merge step is returning correct data
- Whether something between sync and render is re-flipping the flag

**This release adds visible UI diagnostic** in the empty state of the Recently Discharged pane:
- Total patients in memory
- Number with `discharged=true`
- Number with `dischargedAt` timestamp set
- Number passing pool filter
- Number passing 21-day filter
- Plus an ANOMALY warning to console if dischargedAt is set but discharged isn't true

**Please reproduce on your device, navigate to Recently Discharged, expand the "Diagnostic info" panel that appears in the empty state, and share those numbers with me.** They will tell me definitively where the data is being lost.

If "Total patients in memory" is way less than 45 → sync didn't pull all data.
If "Total patients" is correct but "discharged=true" is 0 → discharge flag is being lost in transit.
If "discharged=true" is correct but "passed pool filter" is 0 → there's a bug in the filter (unlikely but possible).

---

## Session 2026-05-07 — v3.02 (version label fix)

### Caught: missing version bump
- Through v2.96 → v3.02, I updated the CHANGELOG entries but forgot to update the user-facing `BUILD_ID` constant and the header version label, which were both stuck at `v2.95`.
- This means devices loading the file weren't triggering the BUILD_ID cache wipe — they kept stale localStorage from v2.95.
- **Fix:** bumped both to `v3.02-2026-05-07`. On next load, every device wipes localStorage and re-pulls from Sheets.
- **Side effect:** any unsynced local changes get wiped. Patients/claims that successfully synced to Sheets are unaffected.

---

## Session 2026-05-07 — v3.02

### v3.02 — Diagnostic + lenient timestamp filter for Recently Discharged

**User report:** Recently Discharged list still empty after v3.00 fix.

**Likely cause:** Patients discharged BEFORE the v3.00 sync race fix had their `discharged=true` clobbered back to `discharged=false` on Sheets. The v3.00 fix is forward-looking only — it can't recover patients whose discharge state was lost in the race. The user would need to re-discharge them.

**Defensive changes to make this more robust:**

1. **Lenient timestamp filter:** `renderDischargedList` no longer hides discharged patients with missing/invalid `dischargedAt`. If `discharged=true` but timestamp is bad, show them anyway (better than silently hiding them — likely a sync glitch).

2. **Diagnostic empty state:** When the list is empty and there ARE discharged patients in storage but none passed the date filter, show a hint: "N discharged patient in storage but none have a recent timestamp." Helps surface sync/timestamp issues.

3. **Console diagnostic:** Every render of the discharged list logs `[discharged-list]` with total patient count, discharged count, and a sample of the first 3 discharged patients (showing their `dischargedAt` raw value and parsed value). Open console to see what's actually in memory.

4. **`removePatient` now re-renders the discharged pane** if it's currently visible (forward-looking — covers any flow where discharge happens while user is on that pane).

**For testing:**
- Re-discharge a patient that should be discharged. The v3.00 race fix should let it stick.
- If empty list persists, check browser console for `[discharged-list]` log to see what's in `st.patients`.

---

## Session 2026-05-07 — v3.01

### v3.01 — Rounds search: unified On + Off Service results, × clear button

**Behavior changes:**
- Placeholder text: "Search patients…" → "Search active patients"
- Search now spans **both On Service and Off Service lists**, not just whichever list is currently selected
- Results are grouped under "On Service (n)" and "Off Service (n)" section headers
- Added × clear button on the right of the search input — appears when search has text, click to clear and refocus input
- Search persists across On/Off Service toggle (was being cleared on toggle)
- View toggle (Geographic/Alphabetical) hides while searching since results are a unified flat list

**Implementation:**
- Added `#search-view` container in rounds pane, hidden by default
- New `renderRoundsSearch()` function builds unified results
- `render()` now routes to `renderRoundsSearch()` whenever `_roundsQuery` is non-empty, otherwise shows the appropriate on-view or off-view
- Removed dead per-render search filters from `wardHtml`, `renderAlpha`, `renderOff` (no longer needed since search routes to its own view)
- New `clearRoundsSearch()` helper handles × button click; uses both `onclick` and `onpointerdown` for iOS reliability
- × button uses CSS `.on` class toggle to show/hide based on input content

**No regressions to claim-from-row, summary-from-row, discharge-from-row** — `alphaRow` is reused, all action handlers continue to work.

---

## Session 2026-05-07 — v3.00

### v3.00 — Fix sync race condition that wiped discharge updates

**Bug reported:** Newly discharged patient didn't appear in Recently Discharged list. Search returned no hits.

**Root cause:** Sync race condition.
1. User discharges patient → `removePatient` sets `p.discharged = true` locally and fires `push('savePatient', p)`. Push goes into `_pendingPush[pid]`.
2. Before that push reaches Sheets, the `visibilitychange` event handler (line 6762) triggers `syncFromSheets()` (e.g., user switches tabs, app regains focus, etc.).
3. Sync pulls Sheets state. Sheets still has the stale row with `discharged = false` because the push hasn't completed yet.
4. Old merge code: `var out = Object.assign({}, rp)` — remote always wins for existing patients. Local `discharged = true` gets clobbered back to `false`.
5. Old pending-clear: `delete _pendingPush[p.id]` for any patient that came back from remote, regardless of whether the remote row reflected the pending change. So the next sync also has nothing to protect against.

**The pending-push mechanism only guarded against new patients not yet on Sheets — it didn't protect field updates on existing patients.**

**Fix (sync merge logic):**
- Merge step now checks `_pendingPush[lp.id]` before letting remote win. If a push is pending for this patient, the local version is preserved (it reflects an unconfirmed update).
- Pending-clear step now confirms the remote row actually reflects the pending change before clearing. Compares `discharged` and `dischargedAt`. Falls back to a 60s stale timeout to prevent stuck pending entries.
- Added explicit re-render of the Recently Discharged pane at the end of `syncFromSheets()` if the user is currently viewing it (so post-sync data corrections become visible immediately, not on next user action).

**This fix protects all field updates on existing patients, not just discharge** — restore, ward changes, MRP/care toggles, etc. all benefit.

---

## Session 2026-05-07 — v2.99

### v2.99 — Discharge model simplification + naming cleanup

**Discharge flag system simplified:**
- **Removed `trueDischarge` flag entirely.** Two-flag system (`discharged` + `trueDischarge`) was technical debt — easy to drift, hard to reason about.
- **Removed "Remove from list (added in error)" path** as user requested. Discharge is now a single action: "Confirm discharge & remove". Patients added in error are corrected by editing the patient or simply not actioning them.
- Step 3 of the discharge modal now shows: "Confirm discharge & remove" + "Cancel" — no third destructive option.
- Recently Discharged filter simplified: was `p.discharged && p.trueDischarge`, now just `p.discharged`.
- `_doRestore` no longer touches `trueDischarge` (field deleted).
- `dischRemoveError` function deleted entirely.

**Naming cleanup — `p-addclaim` was misleading after v2.98:**
- Pane ID: `p-addclaim` → `p-discharged`
- Search input ID: `addclaim-search` → `discharged-search`
- Results container ID: `addclaim-results` → `discharged-results`
- Functions: `initAddClaim` → `initDischarged`, `addClaimSearch` → `dischargedSearch`, `renderAddClaimResults` → `renderDischargedList`, `addClaimRow` → `dischargedRow`, `openClaimFromSearch` → `openClaimFromDischarged`
- Section comment block updated: "06b_add_claim.js" → "06b_discharged.js"
- `pt-addclaim-btn` (the "+ Add claim" button on patient summaries) **kept** — accurately named.

**Dead code removal:**
- `needsSticker` field — was set during patient creation/import but never read anywhere. UI warning for missing PHN uses `p.phn` ternary directly, not the flag. Removed all reads/writes (5 sites total). Was supposed to be removed in v2.78 schema cleanup but the runtime field persisted.

**Net: -17 lines, simpler mental model, no orphaned references.**

**Notes for testing:**
- Existing patients in Sheets with stale `trueDischarge` columns are harmless — just ignored by the new code.
- Existing patients with `needsSticker` columns are harmless — just ignored.
- No Apps Script changes needed.

---

## Session 2026-05-07 — v2.98

### v2.98 — Nav restructure: Rounds/Add Patient/Recently Discharged moves to top; clean separation of concerns

**Layout change (sticky header stack, top → bottom):**
1. App title bar (unchanged, top:0)
2. **Rounds / Add Patient / Recently Discharged** nav (moved up, now top:54px, z-index:49)
3. **On Service / Off Service + rounds search bar + Geo/Alpha toggle** (below nav, top:88px, z-index:48, only visible on Rounds tab)

**Rounds pane:**
- `list-sel` bar now contains: On Service/Off Service buttons + live search input + Geo/Alpha toggle
- Geo/Alpha toggle hidden when Off Service is active (not relevant there)
- Rounds search filters across all three render paths: `wardHtml`, `renderAlpha`, `renderOff`
- Search cleared when switching On/Off Service
- `view-tog` removed from inside pane HTML; now lives permanently in `list-sel` sticky bar

**Recently Discharged pane:**
- `p-addclaim` is now purely and exclusively a recently discharged view
- No more dual-mode / `dischargedOnly` flag complexity
- Shows `discharged && trueDischarge && < 21 days` by default; search expands to all time
- Actions available per row: restore to On Service, restore to Off Service, add missed claim
- `renderAddClaimResults()` simplified by ~40 lines

**Removed:**
- `dischargedOnly` parameter from `renderAddClaimResults` (no longer needed)
- Active patient sections from the discharged pane entirely
- `padding-top:52px` from `p-addclaim` (was a workaround for the old dual nav stack)

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
