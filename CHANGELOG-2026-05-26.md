# Session Summary — 2026-05-26 — v3.94 (consolidation)

v3.94 is a **merge build**. Today produced several divergent `index.html`
variants from separate chats, all branched off a stale base. v3.94
consolidates every genuine change into one verified build and re-syncs the
module tree. It supersedes every earlier 3.9x build, the v3.92 changelog
from earlier today, and the v3.93 handover.

A clean `node build.js` reproduces `index.html` byte-for-byte from the
`src/` tree in the accompanying zip.

---

## v3.94 — 2026-05-26 — `index.html`

Base = v3.93. Merged in: the Meditech location decoder (from the
`meditech-location-decoder` v3.92 branch) and two UI changes (from a third
chat). Nothing from any branch was dropped.

### Carried from v3.93 (the data-integrity base)

- **DOB-data-loss fixes** — Add Patient saves DOB through `fmtClaimDate`
  (`DD/MM/YYYY`); `push()` inspects the response body so a server
  `{ok:false}` rejection surfaces an error instead of looking successful;
  orphan-healer stubs tagged `addedVia='app-orphan-healer'` /
  `needsReview=true`.
- **Weekend / stat-holiday fixes** — `monBefore` starts at `day-1` (25 May
  2026 is a Monday → Victoria Day correctly resolves to 18 May);
  `isBCStat` / `isWeekendOrStat` parse with `T12:00:00`.
- `fmtClaimDate` normalises named-month dates ("18 Jan 1944" → "18/01/1944").

### Merged in — Meditech location decoder (from the v3.92 meditech branch)

- `13_meditech.js` — `LOC_MAP` + `parseLocCode()` decode a Meditech unit
  code + room-bed token into `{ward, room, suspect}`.
- `01_config.js` — two ward definitions added: `C1C`, `HAH`.
- `09_patient.js` — the sticker/chart OCR prompt now also requests
  `locationCode` / `roomBed`; `handleOCRResult` decodes them via
  `parseLocCode` to fill ward/room when OCR did not already supply them.
- Verified: `parseLocCode("KELKGHS2S","KGHS0221-A")` → ward 2S, room 221A;
  `parseLocCode("KELKGHICSI","KGHI2607-A")` → ward CSICU, bed 7.

### Merged in — UI changes (from a third chat)

- `05_render.js` — the in-list "+ Add" buttons are removed (ward headers
  and the Off Service header). Add Patient is reached only via the top
  menu. `openAddWard` / `openAddOff` / `openAdd` remain defined but
  unreferenced.
- `09_patient.js` — sticker existing-patient banner: after OCR, a PHN
  match against `st.patients` shows a banner above the form — discharged
  patient → Restore (opens the On/Off Service chooser); patient still on a
  list → Go to patient.

### Files that carry changes

`01_config.js`, `03_state.js` (version bump), `04_billing.js`,
`05_render.js`, `06c_patient_summary.js`, `09_patient.js`, `13_meditech.js`.
All other modules are unchanged.

### Verified

- Full embedded script passes `node --check`.
- Victoria Day 2026 → 18 May; 25 May 2026 → not a stat.
- `parseLocCode` decodes ward beds and critical-care beds correctly.
- `node build.js` from the `src/` tree reproduces `index.html` byte-exact.

---

## Companion files — verified against the current GitHub repo

- **`build.js`** — current GitHub copy is correct; no change.
- **`manifest.json`** — current GitHub copy already has the fix
  (`start_url`/`scope` = `"./"`); no change.
- **`import.html`** — its `parseLocCode` / `LOC_MAP` decoder block is
  byte-identical to v3.94's `13_meditech.js`; the "single source of truth"
  requirement is satisfied; no change.
- **`upload.html` → v1.25** — the GitHub copy was v1.24 ("audit trail") and
  still carried the Victoria Day bug (`monBefore` without `day-1`). v1.25
  is that exact file with the `day-1` fix applied; `isBCStat` /
  `isWeekendOrStat` already had the `T12:00:00` fix. Verified: Victoria Day
  2026 → 18 May. **This file must be pushed.**

## Action items

1. Push `index.html` (v3.94) and `upload.html` (v1.25).
2. Replace the repo `src/` with the contents of the accompanying zip.
3. Leave `build.js`, `manifest.json`, `import.html` unchanged — verified
   correct as they stand on GitHub.
4. Review the Claims tab for 25 May 2026 consults for stray `1202`
   weekend modifiers (any consult billed under a build without the
   Victoria Day fix).
5. Re-run the Data Check tab so its status reflects current state.
