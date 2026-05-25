# Session Summary — 2026-05-25

Two call-out modifier bugs found and fixed. Both affect weekend/stat
detection. Prepend this block to the top of CHANGELOG.md, or keep as a
standalone handover.

---

## v3.92 — 2026-05-25 — Victoria Day calculation fix

**Reported:** With v3.91 loaded, a weekend/stat modifier (1202) still showed
for a daytime weekday consult dated Monday 25 May 2026.

**Cause:** Separate from the v3.91 timezone bug. In `bcStatHolidays()` the
helper `monBefore(4,25)` computes Victoria Day by starting at 25 May and
walking back to the first Monday. Victoria Day is the Monday *strictly
before* 25 May. In any year where 25 May is itself a Monday (2026 is one),
the loop never runs and the function returns 25 May instead of the prior
Monday (18 May 2026). `isBCStat('2026-05-25')` therefore returned true and
the weekend/stat modifier fired for every consult dated that day.

**Fix:** Start the search one day earlier — `new Date(y,m,day-1)`. Verified
across 2025–2028: only 2026 changes (25 May → 18 May); all other years are
unchanged. Victoria Day always falls 18–24 May, never the 25th.

**Files changed:**
- `04_billing.js` — `monBefore` in `bcStatHolidays()`
- `upload.html` — its own copy of `monBefore` (same bug)
- `03_state.js` — BUILD_ID / APP_VERSION / APP_BUILT → v3.92

**Verify:** Any consult billed on 25 May 2026 under v3.90 or v3.91 has a
wrongly attached 1202 weekend modifier. Check the Claims tab and remove
before iClinic export if any are real (non-test) claims.

---

## v3.91 — 2026-05-25 — Weekend modifier timezone fix

**Reported:** Weekend modifiers appearing for weekday regular-hours consults.

**Cause:** `isWeekendOrStat()` and `isBCStat()` parsed the consult date with
`new Date(dateStr)`. A bare ISO date string (YYYY-MM-DD) is parsed as UTC
midnight; in Vancouver (UTC-7/-8) that lands on the previous calendar day,
so `.getDay()` was off by one. Effect: Mondays read as Sunday → false
weekend modifier; Saturdays read as Friday → weekend modifier silently
missing (under-billing).

**Fix:** Parse with `new Date(dateStr + 'T12:00:00')` to force local-time
parsing at noon — the same pattern `upload.html` already used. Verified in
the Vancouver timezone that all seven weekdays now resolve correctly.

**Files changed:**
- `04_billing.js` — `isWeekendOrStat`, `isBCStat`
- `03_state.js` — version bump (v3.90 → v3.91)
- `upload.html` — no change; already used the `T12:00:00` pattern.

**Verify:** Saturday consults billed before v3.91 may be missing the
weekend modifier and could be under-billed.

---

## Deployment notes

- `index.html` is built from the `src/js/` modules via `node build.js`.
  The two module changes above (`04_billing.js`, `03_state.js`) require a
  rebuild; do not hand-edit `index.html`.
- `upload.html` is a standalone file — edited directly. Displayed version
  bumped to v1.24.
- After deploy, users must fully reload (the BUILD_ID bump forces a local
  cache wipe and a fresh Sheets re-sync; sign-in is preserved). Home-screen
  PWA users may need to force-close and reopen, or re-add the icon.

## Current versions after this session

- `index.html` — v3.92
- `upload.html` — v1.24
- `04_billing.js`, `03_state.js` — carry the v3.92 changes
- Apps Script, `kgh_worker.js` — unchanged this session
