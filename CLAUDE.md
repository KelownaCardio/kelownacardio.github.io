# KGH Cardiology Billing — Claude Code Context

## What this repo is
Single-file vanilla JS billing tool for KGH Cardiology group (OA040).
Hosted at `kelownacardio.github.io`. Two main files:

- **`index.html`** — main rounding app (iPad Safari primary)
- **upload.html** — desktop historical billing catchup tool

Backend: Google Sheets + Google Apps Script. OCR via Cloudflare Worker (`kgh_worker.js`) using Claude Vision.

---

## Physician roster
| Alias | Name |
|-------|------|
| KBrown | Kathryn Brown (owner of this tool) |
| DPatton | Daniel Patton |
| FH | Frank Halperin |
| JW | Jordan Webber |
| LH | Laura Halperin |
| SB | Sandra Baker |
| ASodhi | Amit Sodhi |
| EMMassie | Emmanuelle Menard-Massie |
| KHoskin | Kurt Hoskin |
| AKhosla | Amit Khosla |
| KT | Karen Tarhuni (or similar) |
| KP | Kevin Pistawka |

---

## Version & commit conventions

### Versioning
- `APP_VERSION` and `BUILD_ID` constants live near the top of `index.html`
- `BUILD_ID` format: `'v{N}-{YYYY-MM-DD}-{slug}'` e.g. `'v3.65-2026-05-22-meditech-discharge-note'`
- Bump both on every meaningful change
- Prepend a changelog block to the HTML comment header at the top of the file

### Git workflow (ALWAYS follow this order)
1. **Tag the current version before editing**
   ```bash
   git tag v{current_version}   # e.g. git tag v3.65
   ```
2. **Make the changes** to `index.html` (or other files)
3. **Commit**
   ```bash
   git add -A
   git commit -m "v{new_version}: {short description}"
   ```
4. **Push both the commit and the tag**
   ```bash
   git push origin main
   git push origin v{current_version}
   ```

### Rollback
```bash
git checkout v3.64 -- index.html   # restore a specific version
git push origin main
```

---

## Key architecture notes

### index.html internal structure
The file is divided into numbered JS sections (inline, no bundler):
- `13_meditech.js` — Meditech rounds list import, discharge detection
- `14_init.js` — app init, navigation, fee codes, utility helpers

### State
- `st.patients` — active patient array (localStorage + Sheets)
- `_mitPats` / `_mitDisch` — Meditech import staging arrays

### Patient object key fields
`id, last, first, phn, dob, sex, ward, bed, fac, care, list, role, icd, mrp, discharged, dischargeDate, dischargedAt, dischargeNote`

### UI conventions
- Tap buttons over dropdowns
- On = blue / Off = amber
- Three card tints: patient=lavender, claim=cream, location=teal
- DOB display: `DD Mon YYYY` / storage: `DD/MM/YYYY`
- ICD displayed as `Description (code)` via `icdShortLabel`

### Critical patterns
- `appendRow` bypasses number formatting — use `getRange().setNumberFormat('@').setValues([row])`
- `.slice` on numeric fields throws silent TypeError — always coerce with `String(x || '')`
- `safeRowMap`: wrap every `.map(rowFn)` in per-row try/catch
- No auto-fix or silent inference on unclear data — ask rather than guess
- No automatic date-swapping logic
- BUILD_ID change force-wipes all device caches on next load

### Fee codes
`33006` directive, `33008` daily, `33010` consult, `33012` limited consult,
`1411` CCU day 1, `1421` CCU days 2–7, `1431` CCU day 8+,
`78720`, `00751`, `33035`

### Meditech import (13_meditech.js)
- Discharge reason for missing patients: `"No longer on Meditech Import List"`
- `dischargeNote` field stamped on patient before `savePatient` push (non-billing)
- Cardiac surgery handoff reason: `"→ Cardiac Surgery (attendingName)"`
- CCFPP folds into consult notes — no separate claim row

### Apps Script actions
`saveRow`, `savePatient`, `searchPhysicians`, `saveHistorical`, `bulkUpsertPatients`,
`getCombinedExport`, `searchICD`, `lookupPatient`, `saveClaim`, `deleteClaim`

---

## Sheets structure
- **Physicians tab** — 15,958 rows: Last(A), Given(B), billing#(C), Specialty(E), City(F)
- **Doctors tab** — 11 performing physician aliases
- **Claims tab** — active claims
- **Uploaded Claims tab** — historical claims (formerly "Historical")
- **Patients tab** — patient demographics + audit fields

---

## Current versions (update this when bumping)
- `index.html` — v3.66
- `upload.html` — v1.16
- Apps Script — v2.20
- `kgh_worker.js` — v2.1

---

## What NOT to do
- Never swap or infer dates silently
- Never overwrite existing patient demographics on import
- Never stack fixes on broken scaffolding — rewrite from known-working baseline
- Never use `sudo npm install`
- Don't create separate claim rows for CCFPP

---

## Recent changes
One line per `index.html` version. Newest first.

- **v3.66** (2026-05-22) — Meditech import MRP transition detection: flags patients whose MRP changed between the stored record and the imported list, with a red "left Cardiology" / amber "joined Cardiology" section at the top of the import modal that rewires `list/role/care/mrp` on confirm.
