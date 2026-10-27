// 13c_rounds_pdf.js — Meditech "SB Rounds List" PDF → room updates,
//                     discharge flags and QuickChart paste lists
// ═══════════════════════════════════════════════════════════════════
// v5.44 (2026-10-27) — Drop the PDF straight on the "Meditech rounds list"
//   button under the patient list (Kathryn 2026-10-27: no need to open the
//   box first). The button lights up while a file is dragged over it. The
//   drop-anywhere fallback now also accepts a file whose drag type is blank
//   (some Mac drag sources don't label PDFs); the .pdf name check on drop
//   still applies.
//   SCOPE CUT (Kathryn 2026-10-27 07:32): "you shouldn't change anything
//   except the patient location and flag people that are no longer on the
//   rounds list at all". So Apply now writes ward + bed ONLY:
//     • no "Move to off-service list" (27/10 07:14 it moved two
//       Cardiology-MRP ED patients off service and they lost the red);
//     • patients missing from the PDF are LISTED for the doctor to check —
//       no Discharge / Off-service buttons, nothing written for them;
//     • list / role / care / mrp / discharge are never touched.
//   QuickChart list also includes any patient already active in the app on
//   CICU/2S/2W, even if Meditech's MRP is an individual doctor's name.
//   Missing patients (Kathryn 07:37): default KEEP; a "Discharge" button per
//   patient runs the SAME flow as the card's D/C button (openDischModal:
//   DOB check, MRP-gap gate, private-pay step, confirm discharge date,
//   complex-discharge 78717 check). The rounds box closes while it runs and
//   reopens on the same list (kept 30 min) with discharged patients gone.
// v5.40 (2026-10-22) — ONE QuickChart list instead of three (Kathryn's
//   paste tests 2026-10-22 17:09/17:12): a single "KGH Cardiology" list,
//   CICU → 2W → 2S by bed, with the ward written into the bed field
//   ("2S 217", "CICU 1") because QuickChart's list view shows only the bed.
//   Location stays CICU / 2S / 2W. One Copy button replaces three.
// v5.37 (2026-10-22) — NEW. Kathryn's rounds workflow (2026-10-22):
//   1. Meditech: print the "SB Rounds List" report, save as PDF.
//   2. Billing app: drag the PDF onto the "Meditech rounds list" box
//      (or choose it). The app reads the PDF's own text — no AI, no OCR,
//      nothing leaves the phone/computer.
//   3. App patients only (Kathryn: "if they aren't in the app yet don't
//      add them — they are added when the consult is done"):
//        • room/ward changes for patients already in the app, any unit
//          (matched by PHN, else surname + DOB);
//        • an on-service patient now on a unit other than CICU/2S/2W gets
//          a pre-ticked "Move to off-service list" with the room update;
//        • active app patients NOT on the PDF are flagged as likely
//          discharged — Discharge / Off-service / Keep per patient;
//        • MRP Cardiology patients on the PDF but not in the app are LISTED
//          (information only — never added).
//      The PDF never creates a patient.
//   4. QuickChart: Copy for QuickChart (v5.38: one list, see top). Built straight from
//      the PDF — MRP "CardiologyMRP" OR Other "CardiologyConsult", on those
//      three units only — so patients not yet in the app are included for
//      dictation. Format proven by Kathryn's paste test 2026-10-22 13:27
//      (QuickChart matched by health card, set rooms, flagged discharges):
//        Last, First Middle | DOB yyyy-mm-dd | PHN nnnnnnnnnn | Location 2W | Bed 207
//
// WHY A HAND-WRITTEN PDF READER: the report is written by "Haru Free PDF
// Library" (MEDITECH Expanse) — every text item is a plain
// "x y Td (text) Tj" in a FlateDecode content stream with the standard
// Courier/Helvetica fonts. Reading that needs only the browser's built-in
// DecompressionStream; no library download (cdnjs is not reachable from
// every hospital network — unverified either way, so we don't depend on it).
// If Meditech ever changes the report's PDF writer, the reader reports
// "No patients found" rather than guessing.
//
// BEDS (Kathryn 2026-10-22): number only (207); the letter only for rooms
// KGH shares (225A/225B, 226A/226B) — taken from the WARDS room presets in
// 01_config.js so the app and QuickChart use the same room names.
// CCU: bed number 1–8 (KGHS2501-A → "1"), the app's own CCU convention.
// ═══════════════════════════════════════════════════════════════════

var RL_QC_WARDS = ['CCU', '2W', '2S'];   // wards on the QuickChart list, in this order
var _rl = null;                          // last parsed list + review state

// ── PDF → text items ─────────────────────────────────────────────────
// Bytes → "binary string" (one char per byte, codes 0-255). TextDecoder
// 'latin1' is NOT safe here: browsers map that label to windows-1252,
// which rewrites bytes 0x80-0x9F and would corrupt compressed data.
function _rlBin(bytes) {
  var s = '', CH = 0x8000;
  for (var i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return s;
}
function _rlBytes(bin) {
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i) & 255;
  return u;
}

// Every stream in the file: { dict, bin } — bin = raw (still compressed)
// bytes as a binary string. /Length is honoured when it is a number or an
// indirect "N 0 R"; otherwise the data runs to "endstream" minus its EOL.
function _rlStreams(bin) {
  var out = [];
  var re = /<<((?:[^<>]|<<(?:[^<>]|<<[^<>]*>>)*>>)*)>>\s*stream\r?\n/g;
  var m;
  while ((m = re.exec(bin))) {
    var dict  = m[1];
    var start = m.index + m[0].length;
    var len   = -1;
    var lm    = dict.match(/\/Length\s+(\d+)(\s+(\d+)\s+R)?/);
    if (lm && !lm[2]) len = parseInt(lm[1], 10);
    else if (lm && lm[2]) {
      var om = new RegExp('(?:^|[\\r\\n\\s])' + lm[1] + '\\s+' + lm[3] + '\\s+obj\\s*(\\d+)\\s*endobj').exec(bin);
      if (om) len = parseInt(om[1], 10);
    }
    var data;
    if (len >= 0 && start + len <= bin.length) {
      data = bin.substr(start, len);
    } else {
      var end = bin.indexOf('endstream', start);
      if (end < 0) break;
      data = bin.substring(start, end).replace(/\r?\n$/, '');
    }
    out.push({ dict: dict, bin: data });
    re.lastIndex = start + data.length;
  }
  return out;
}

// zlib/deflate → binary string. Browser: DecompressionStream('deflate').
// (Node test harness passes its own inflater as rlInflate.)
async function _rlInflate(bin) {
  if (typeof window !== 'undefined' && window.rlInflate) return window.rlInflate(bin);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack PDFs (needs Chrome 80+ / Safari 16.4+).');
  }
  var ds = new DecompressionStream('deflate');
  var buf = await new Response(new Blob([_rlBytes(bin)]).stream().pipeThrough(ds)).arrayBuffer();
  return _rlBin(new Uint8Array(buf));
}

// PDF literal string → text (octal \ddd, \n \r \t \b \f \( \) \\).
function _rlUnescape(s) {
  return s.replace(/\\([0-7]{1,3}|[nrtbf()\\]|\r?\n)/g, function (_m, c) {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8) & 255);
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] || '';
  });
}

// One content stream → [{x, y, t}] for every "x y Td (text) Tj".
function _rlItems(content) {
  var items = [];
  var re = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s*\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g;
  var m;
  while ((m = re.exec(content))) {
    var t = _rlUnescape(m[3]).trim();
    if (t) items.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), t: t });
  }
  return items;
}

// File bytes → pages of text items (pages = content streams that hold text,
// in file order; images and fonts are skipped).
async function rlPdfPages(bytes) {
  var bin = _rlBin(bytes);
  if (bin.slice(0, 5) !== '%PDF-') throw new Error('Not a PDF file.');
  var pages = [];
  var streams = _rlStreams(bin);
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (/\/Subtype\s*\/Image/.test(s.dict)) continue;
    var text;
    if (/\/FlateDecode/.test(s.dict)) {
      try { text = await _rlInflate(s.bin); } catch (e) { continue; }
    } else if (!/\/Filter/.test(s.dict)) {
      text = s.bin;
    } else {
      continue;   // other compression — not used by this report
    }
    if (text.indexOf('Tj') < 0) continue;
    pages.push(_rlItems(text));
  }
  return pages;
}

// ── Text items → patient records ─────────────────────────────────────
// Layout of one SB Rounds List record (page units, 50 per line):
//   line 0  KELKGHS2W  KGHS0207-A  Compeau,Jerry Patrick  IHA Alerts:…  M 57 21/04/1969
//   line 1  Reason for Visit:   <reason>
//   line 2  Health Care Num:    <PHN>            MRP:       <MRP>
//   line 3  Account Number:     <acct>           Admitting: <name>
//   line 4  Med Rec Number:     <MRN>            Family:    <name>
//   line 5  Admit Date/Time:    <dd/mm/yy hh:mm> Other:     <consult/name>
//   line 6  Discharge Date/Time:                 ELOS:      LOS: <n>
//   line 7  MOST: <code>
// Values sit on the same y as their label; left values start x≈617,
// right values x≈1639. Labels are matched by text, not by fixed y, so
// small layout shifts still read correctly.
var RL_LEFT_LABELS  = { 'Reason for Visit:': 'reason', 'Health Care Num:': 'phn',
                        'Account Number:': 'acct', 'Med Rec Number:': 'mrn',
                        'Admit Date/Time:': 'admit', 'MOST:': 'most' };
var RL_RIGHT_LABELS = { 'MRP:': 'mrp', 'Admitting:': 'admitting',
                        'Family:': 'family', 'Other:': 'other' };

function rlParseRecords(pages) {
  var recs = [];
  pages.forEach(function (items, pg) {
    // Record headers: a Meditech unit code in the far-left column.
    var heads = items.filter(function (it) {
      return it.x < 250 && /^KEL[A-Z0-9]{3,}$/.test(it.t);
    }).sort(function (a, b) { return b.y - a.y; });
    heads.forEach(function (h, hi) {
      var top = h.y;
      var bottom = hi + 1 < heads.length ? heads[hi + 1].y : -Infinity;
      var mine = items.filter(function (it) { return it.y <= top + 1 && it.y > bottom + 1; });
      var row0 = mine.filter(function (it) { return Math.abs(it.y - top) < 2; })
                     .sort(function (a, b) { return a.x - b.x; });
      var r = { pg: pg + 1, locCode: h.t, roomBed: '', name: '', last: '', first: '',
                sex: '', age: '', dob: '', alerts: '',
                reason: '', phn: '', acct: '', mrn: '', admit: '', most: '',
                mrp: '', admitting: '', family: '', other: '', los: '' };
      row0.forEach(function (it) {
        if (it === h) return;
        if (/^KGH[A-Z0-9]+-?[A-Z0-9]*$/.test(it.t) && it.x < 650 && !r.roomBed) { r.roomBed = it.t; return; }
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(it.t)) { r.dob = it.t; return; }
        if (/^[MFUX]$/.test(it.t) && it.x > 1700) { r.sex = it.t; return; }
        if (/^\d{1,3}$/.test(it.t) && it.x > 1700) { r.age = it.t; return; }
        if (it.t === 'IHA Alerts:') return;
        if (it.x > 600 && it.x < 1300 && !r.name) { r.name = it.t; return; }
        if (it.x >= 1300 && it.x < 1900) { r.alerts = (r.alerts ? r.alerts + ' ' : '') + it.t; }
      });
      var nm = r.name.split(',');
      r.last  = (nm[0] || '').trim();
      r.first = nm.slice(1).join(',').trim();
      // Labelled fields: value = item on the label's line in its column.
      mine.forEach(function (lab) {
        var key = RL_LEFT_LABELS[lab.t], right = false;
        if (!key) { key = RL_RIGHT_LABELS[lab.t]; right = true; }
        if (!key) {
          if (lab.t === 'LOS:') {
            var v = mine.filter(function (it) { return Math.abs(it.y - lab.y) < 2 && it.x > lab.x; })
                        .sort(function (a, b) { return a.x - b.x; })[0];
            if (v) r.los = v.t;
          }
          return;
        }
        var cands = mine.filter(function (it) {
          if (Math.abs(it.y - lab.y) >= 2 || it.x <= lab.x) return false;
          if (RL_LEFT_LABELS[it.t] || RL_RIGHT_LABELS[it.t] || it.t === 'ELOS:' || it.t === 'LOS:') return false;
          return right ? true : it.x < 1350;    // left values stop before the right column
        }).sort(function (a, b) { return a.x - b.x; });
        if (cands[0]) r[key] = cands[0].t;
      });
      r.phn = String(r.phn || '').replace(/\D/g, '');
      if (r.last) recs.push(r);
    });
  });
  return recs;
}

// Header "Date: 22/10/26 12:11" → epoch ms (local time), or 0.
function rlReportTime(pages) {
  var all = pages[0] || [];
  for (var i = 0; i < all.length; i++) {
    var m = String(all[i].t).match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      var yr = parseInt(m[3], 10); if (yr < 100) yr += 2000;
      return new Date(yr, parseInt(m[2], 10) - 1, parseInt(m[1], 10),
                      parseInt(m[4], 10), parseInt(m[5], 10)).getTime();
    }
  }
  return 0;
}

// Report owner (the name under the date, top right of page 1).
function rlReportOwner(pages) {
  var all = (pages[0] || []).filter(function (it) { return it.x > 1700 && /^[A-Za-z' -]+,[A-Za-z' -]+$/.test(it.t); })
                            .sort(function (a, b) { return b.y - a.y; });
  return all[0] ? all[0].t : '';
}

// ── Location + rules ─────────────────────────────────────────────────
// Meditech code → app ward + bed, beds named like the WARDS room presets.
function rlLocation(rec) {
  var loc = parseLocCode(rec.locCode, rec.roomBed);
  var ward = loc.ward, bed = loc.room;
  if ((ward === '2S' || ward === '2W') && bed) {
    var presets = (WARDS[ward] && WARDS[ward].rooms) || [];
    var m = String(bed).match(/^(\d+)([A-Z]?)$/);
    if (m) {
      if (m[2] && presets.indexOf(m[1] + m[2]) !== -1) bed = m[1] + m[2];   // shared room: 226A
      else bed = m[1];                                                     // single room: 207
    } else if (/^Hallway/.test(bed) && presets.indexOf(bed) === -1 && presets.indexOf('Hallway') !== -1) {
      bed = 'Hallway';                                                     // 2W has one hallway preset
    }
  }
  return { ward: ward, bed: bed, suspect: loc.suspect };
}

// Kathryn 2026-10-22: QuickChart list = MRP CardiologyMRP or Other CardiologyConsult.
function rlIsCardiology(rec) {
  return /cardiologymrp/i.test(rec.mrp || '') || /cardiologyconsult/i.test(rec.other || '');
}

function _rlDobIso(dmy) {
  var m = String(dmy || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : '';
}

// QuickChart paste text — one list, ward in the bed field (format proven
// by Kathryn's paste test 2026-10-22 17:12).
function rlQuickChartText(recs) {
  var lines = recs.map(function (r) {
    var w = wardLabel(r._ward);
    return r.last + ', ' + r.first +
      ' | DOB ' + (_rlDobIso(r.dob) || 'unknown') +
      ' | PHN ' + (r.phn || 'unknown') +
      ' | Location ' + w +
      ' | Bed ' + w + (r._bed ? ' ' + r._bed : '');
  });
  return 'KGH Cardiology patient list\n' + lines.join('\n');
}

function _rlBedSort(a, b) {
  var na = parseInt(a._bed, 10), nb = parseInt(b._bed, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
  return String(a._bed).localeCompare(String(b._bed));
}

// Same person? PHN first; surname + DOB only when either PHN is missing.
function _rlSamePatient(p, r) {
  var pp = String(p.phn || '').replace(/\D/g, '');
  if (pp && r.phn) return pp === r.phn;
  var pd = String(p.dob || '').trim();
  return !!(pd && r.dob && pd === r.dob &&
            String(p.last || '').toLowerCase().trim() === r.last.toLowerCase());
}

// Already in the right place? Same ward, and the same bed allowing for a
// missing bed letter on one side (doctor typed "616", decoder says "616A").
// A blank decoded bed never wipes a bed the doctor entered.
function _rlSameSpot(p, r) {
  if (String(p.ward || '') !== r._ward) return false;
  var a = String(p.bed || '').trim().toUpperCase();
  var b = String(r._bed || '').trim().toUpperCase();
  if (!b || a === b) return true;
  var ma = a.match(/^(\d+)([A-Z]?)$/), mb = b.match(/^(\d+)([A-Z]?)$/);
  if (ma && mb && ma[1] === mb[1] && (!ma[2] || !mb[2])) return true;
  return false;
}

// Patient-creation time from the app id ("p" + Date.now()) — 0 if unknown.
function _rlCreatedMs(p) {
  var m = String(p.id || '').match(/^p(\d{13})/);
  return m ? parseInt(m[1], 10) : 0;
}

// ── Build the review (pure — no UI, no writes) ───────────────────────
function rlBuildReview(recs, patients, reportMs, nowMs) {
  recs.forEach(function (r) {
    var l = rlLocation(r);
    r._ward = l.ward; r._bed = l.bed; r._suspect = l.suspect;
    r._cardio = rlIsCardiology(r);
  });

  var active = patients.filter(function (p) { return p && p.id && !p.discharged; });

  // v5.44: a patient already active in the app goes on the QuickChart list
  // too, whatever Meditech's MRP/Other says — a clerk may have registered
  // them under one doctor's name instead of CardiologyMRP (Kathryn
  // 2026-10-27). The app's own settings are never changed by the PDF.
  recs.forEach(function (r) {
    if (!r._cardio && active.some(function (p) { return _rlSamePatient(p, r); })) r._cardio = true;
  });

  // QuickChart list: CICU, then 2W, then 2S, each by bed.
  var qc = [];
  RL_QC_WARDS.forEach(function (w) {
    qc = qc.concat(recs.filter(function (r) { return r._cardio && r._ward === w; }).sort(_rlBedSort));
  });

  // Room changes for patients already in the app.
  var moves = [], matchedIds = {};
  var notInApp = [];
  recs.forEach(function (r) {
    var hits = active.filter(function (p) { return _rlSamePatient(p, r); });
    if (!hits.length && /cardiologymrp/i.test(r.mrp || '')) {
      // Kathryn 2026-10-22: list MRP Cardiology patients not yet in the app -
      // information only, never added (they come in when the consult is done).
      var anyApp = patients.some(function (p) { return p && _rlSamePatient(p, r); });
      notInApp.push({ last: r.last, first: r.first, ward: r._ward, bed: r._bed,
                      admit: r.admit, reason: r.reason, discharged: anyApp });
    }
    if (hits.length !== 1) return;            // 0 = not in app; 2+ = duplicate, leave alone
    var p = hits[0];
    matchedIds[p.id] = true;
    if (r._ward === 'OTHER' || !r._ward) return;   // unknown unit — never overwrite
    if (_rlSameSpot(p, r)) return;
    // Kathryn 2026-10-22: an on-service patient now on a unit other than
    // CICU / 2S / 2W -> prompt "Move to off-service list" (pre-ticked).
    // v5.44: NEVER for a Cardiology-MRP patient — off the home wards they are
    // "stranded" (05_render.js isStranded) and must stay on service so they
    // show red on both lists. 27/10 07:14 the pre-ticked box moved Neufeld
    // and Pajak (MRP Cardiology, in ED) off service and they lost the red.
    // v5.44: location only — never offered (see header).
    var offPrompt = false;
    moves.push({ pid: p.id, last: p.last, first: p.first,
                 fromWard: p.ward || '', fromBed: p.bed || '',
                 toWard: r._ward, toBed: r._bed || '', _on: true,
                 offPrompt: offPrompt, _off: offPrompt });
  });

  // Active app patients missing from the PDF.
  var missing = active.filter(function (p) {
    if (matchedIds[p.id]) return false;
    if (!p.ward || p.ward === 'OTHER') return false;          // not placed at KGH
    var made = _rlCreatedMs(p);
    if (reportMs && made && made > reportMs) return false;    // added after the list was printed
    return true;
  }).map(function (p) {
    var stay = (typeof losdays === 'function') ? losdays(p) + 1 : 0;   // calendar days incl. admit day
    var pp   = (typeof _ppIsPrivateOrOOP === 'function') && _ppIsPrivateOrOOP(p);
    var cardOnly = pp || stay >= 5;
    return { pid: p.id, last: p.last, first: p.first, ward: p.ward || '', bed: p.bed || '',
             list: p.list, stay: stay, privatePay: !!pp, cardOnly: cardOnly,
             action: 'keep' };
  });

  // Default actions. Discharge is pre-selected only when the list looks
  // trustworthy: printed today, and not flagging an unusual share of the app.
  var today = new Date(nowMs || Date.now());
  var rep   = reportMs ? new Date(reportMs) : null;
  var fresh = !!rep && rep.toDateString() === today.toDateString();
  var plausible = missing.length <= 10 && missing.length <= Math.max(3, Math.ceil(active.length * 0.3));
  // v5.44: listed only — the import never discharges or moves anyone.

  notInApp.sort(function (a, b) {
    var ia = RL_QC_WARDS.indexOf(a.ward), ib = RL_QC_WARDS.indexOf(b.ward);
    if (ia < 0) ia = 9; if (ib < 0) ib = 9;
    return (ia - ib) || String(a.ward).localeCompare(String(b.ward)) || _rlBedSort({ _bed: a.bed }, { _bed: b.bed });
  });

  return { recs: recs, qc: qc, moves: moves, missing: missing, notInApp: notInApp,
           fresh: fresh, plausible: plausible, activeCount: active.length };
}

// ── UI ───────────────────────────────────────────────────────────────
function openRoundsPdf() {
  if (typeof isResident === 'function' && isResident()) { showToast('Not available for this login'); return; }
  // v5.44: reopening within 30 min shows the same list (e.g. after a
  // Discharge from the "Not on the Meditech list" section).
  if (!_rl || !_rl.readAt || (Date.now() - _rl.readAt) > 30 * 60 * 1000) _rl = null;
  _rlRender();
  showModal('rl-modal');
}

function rlPickFile(inp) {
  var f = inp.files && inp.files[0];
  inp.value = '';
  if (f) rlHandleFile(f);
}

function rlDragOver(e) { e.preventDefault(); var z = document.getElementById('rl-drop'); if (z) z.classList.add('rl-hot'); }
function rlDragLeave() { var z = document.getElementById('rl-drop'); if (z) z.classList.remove('rl-hot'); }
function rlDrop(e) {
  e.preventDefault();
  rlDragLeave();
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) rlHandleFile(f);
}

// v5.44: footer button as a drop target.
function rlFootDragOver(e) {
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'copy'; } catch (eD) {}
  var b = document.getElementById('rl-foot-btn'); if (b) b.classList.add('rl-hot');
  var l = document.getElementById('rl-foot-lbl'); if (l) l.textContent = 'Drop the SB Rounds List PDF here';
}
function rlFootDragLeave(e) {
  var b = document.getElementById('rl-foot-btn');
  if (e && b && e.relatedTarget && b.contains(e.relatedTarget)) return;   // moving onto the icon/label
  if (b) b.classList.remove('rl-hot');
  var l = document.getElementById('rl-foot-lbl');
  if (l) l.innerHTML = 'Meditech rounds list (PDF) &rarr; rooms &amp; QuickChart &mdash; tap or drop PDF here';
}
function rlFootDrop(e) {
  e.preventDefault();
  e.stopPropagation();   // the document-level fallback must not read it twice
  rlFootDragLeave(null);
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  var modal = document.getElementById('rl-modal');
  if (!modal || !modal.classList.contains('on')) openRoundsPdf();
  rlHandleFile(f);
}

async function rlHandleFile(file) {
  var status = document.getElementById('rl-status');
  function say(cls, msg) { if (status) { status.style.display = 'block'; status.className = 'ocr-bar ' + cls; status.textContent = msg; } }
  if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
    say('ocr-warn', 'Please choose the SB Rounds List saved as a PDF.');
    return;
  }
  say('ocr-ok', 'Reading ' + (file.name || 'PDF') + '…');
  try {
    var bytes = new Uint8Array(await file.arrayBuffer());
    var pages = await rlPdfPages(bytes);
    var recs  = rlParseRecords(pages);
    if (!recs.length) {
      say('ocr-warn', 'No patients found. Is this the Meditech "SB Rounds List" PDF?');
      return;
    }
    var repMs = rlReportTime(pages);
    _rl = rlBuildReview(recs, st.patients, repMs, Date.now());
    _rl.fileName = file.name || '';
    _rl.reportMs = repMs;
    _rl.owner    = rlReportOwner(pages);
    _rl.copied   = false;
    _rl.readAt   = Date.now();
    status.style.display = 'none';
    _rlRender();
  } catch (e) {
    console.warn('[rounds pdf]', e);
    say('ocr-warn', 'Could not read this PDF: ' + (e && e.message ? e.message : e));
  }
}

function _rlFmtTime(ms) {
  if (!ms) return 'unknown time';
  var d = new Date(ms);
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function _rlRender() {
  var box = document.getElementById('rl-body');
  if (!box) return;
  var html = '';

  // Drop zone — always shown so a newer PDF can replace this one.
  html += '<div id="rl-drop" class="rl-drop" ondragover="rlDragOver(event)" ondragleave="rlDragLeave()" ondrop="rlDrop(event)">' +
            '<div style="font-weight:700;margin-bottom:4px">' + (_rl ? 'Drop a newer PDF to replace' : 'Drop the SB Rounds List PDF here') + '</div>' +
            '<div style="font-size:11px;color:var(--text2);margin-bottom:8px">Meditech → SB Rounds List → save as PDF</div>' +
            '<label class="btn btn-s" style="display:inline-block;margin:0;cursor:pointer">Choose PDF' +
              '<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="rlPickFile(this)">' +
            '</label>' +
          '</div>';
  html += '<div class="ocr-bar ocr-ok" id="rl-status" style="display:none"></div>';

  if (!_rl) { box.innerHTML = html; return; }

  var R = _rl;
  html += '<div class="imp-sum" style="margin:8px 0">' +
            R.recs.length + ' patients read · list printed ' + esc(_rlFmtTime(R.reportMs)) +
            (R.owner ? ' · ' + esc(R.owner) : '') +
          '</div>';
  if (!R.fresh) {
    html += '<div class="ocr-bar ocr-warn" style="display:block;margin-bottom:8px">This list was not printed today — check the rooms below before applying. Print a fresh one if you can.</div>';
  } else if (!R.plausible) {
    html += '<div class="ocr-bar ocr-warn" style="display:block;margin-bottom:8px">' + R.missing.length +
            ' app patients are missing from this list — more than usual. Check it is the full cardiology list.</div>';
  }

  // 1. QuickChart copy buttons.
  html += '<div class="sec-lbl" style="margin-top:6px">Copy for QuickChart</div>' +
          '<div style="font-size:10px;color:var(--text2);margin-bottom:6px;line-height:1.4">' +
            'CardiologyMRP or CardiologyConsult on CICU, 2W and 2S. In QuickChart: open the KGH Cardiology list → Scan list → “Paste it here instead”.' +
          '</div>' +
          '<div class="fl" style="gap:6px;margin-bottom:12px">';
  var qcCounts = RL_QC_WARDS.map(function (w) {
    return wardLabel(w) + ' ' + R.qc.filter(function (r) { return r._ward === w; }).length;
  }).join(' · ');
  html += '<button class="ap-list-pill' + (R.copied ? ' on' : '') + '" style="flex:1"' +
          (R.qc.length ? '' : ' disabled') + ' onclick="rlCopy()">' +
          (R.copied ? '✓ Copied ' : 'Copy ') + R.qc.length + ' patients (' + qcCounts + ')</button>';
  html += '</div>';

  // 2. Room changes.
  if (R.moves.length) {
    html += '<div class="sec-lbl">Room changes (' + R.moves.length + ')</div>';
    R.moves.forEach(function (m, i) {
      html += '<div class="imp-row' + (m._on ? '' : ' excluded') + '">' +
                '<div class="imp-chk' + (m._on ? ' on' : '') + '" onclick="rlToggleMove(' + i + ')">' +
                  (m._on ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
                '</div>' +
                '<div class="imp-info">' +
                  '<div class="imp-name">' + esc(m.last) + ', ' + esc(m.first) + '</div>' +
                  '<div class="imp-meta">' + esc(wardLabel(m.fromWard) || '—') + (m.fromBed ? ' ' + esc(m.fromBed) : '') +
                    ' → <b>' + esc(wardLabel(m.toWard)) + (m.toBed ? ' ' + esc(m.toBed) : '') + '</b></div>' +
                '</div>' +
              '</div>';
    });
  }

  // v5.44: Apply (rooms only) sits right under the room list.
  var nMoves = R.moves.filter(function (m) { return m._on; }).length;
  if (R.moves.length) {
    html += '<button class="btn btn-p" style="width:100%;margin-top:10px" onclick="rlApply()"' +
            (nMoves ? '' : ' disabled') + '>Update ' + nMoves + ' room' + (nMoves === 1 ? '' : 's') + '</button>';
  } else {
    html += '<div class="imp-meta" style="margin-top:8px">App rooms already match Meditech — nothing to change.</div>';
  }

  // 3. Not on the Meditech list — default Keep; Discharge runs the card's D/C flow.
  var miss = R.missing.filter(function (m) {
    var p = st.patients.find(function (pp) { return pp.id === m.pid; });
    return p && !p.discharged;
  });
  if (miss.length) {
    html += '<div class="sec-lbl" style="color:var(--red-t);margin-top:12px">\u26A0 Not on the Meditech list (' + miss.length + ')</div>' +
            '<div style="font-size:10px;color:var(--text2);margin-bottom:6px;line-height:1.4">Kept unless you choose Discharge. Discharge opens the usual discharge steps (date, billing gaps, complex discharge).</div>';
    miss.forEach(function (m) {
      html += '<div class="imp-row" style="padding:8px 10px">' +
                '<div class="imp-info">' +
                  '<div class="imp-name">' + esc(m.last) + ', ' + esc(m.first) + '</div>' +
                  '<div class="imp-meta">' + esc(wardLabel(m.ward)) + (m.bed ? ' ' + esc(m.bed) : '') +
                    ' · ' + (m.list === 'on' ? 'on service' : 'off service') + '</div>' +
                  '<div class="fl" style="gap:6px;margin-top:6px">' +
                    '<button class="ap-list-pill on">Keep</button>' +
                    '<button class="ap-list-pill" onclick="rlDischarge(\'' + esc(m.pid) + '\')">Discharge</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
    });
  }

  if (R.notInApp && R.notInApp.length) {
    html += '<div class="sec-lbl" style="margin-top:8px">MRP Cardiology — not yet in app (' + R.notInApp.length + ')</div>' +
            '<div style="font-size:10px;color:var(--text2);margin-bottom:6px;line-height:1.4">For information only — not added. Add via Add Patient when seen.</div>';
    R.notInApp.forEach(function (n) {
      html += '<div class="imp-row" style="padding:8px 10px">' +
                '<div class="imp-info">' +
                  '<div class="imp-name">' + esc(n.last) + ', ' + esc(n.first) + '</div>' +
                  '<div class="imp-meta">' + esc(wardLabel(n.ward)) + (n.bed ? ' ' + esc(n.bed) : '') +
                    (n.admit ? ' · admitted ' + esc(n.admit) : '') +
                    (n.reason ? ' · ' + esc(n.reason) : '') + '</div>' +
                  (n.discharged ? '<div class="imp-meta" style="color:var(--amber-t)">In the app as discharged — Restore from Discharged if readmitted</div>' : '') +
                '</div>' +
              '</div>';
    });
  }

  box.innerHTML = html;
}

// v5.44: Discharge from the "Not on the Meditech list" section = exactly the
// patient card's D/C button. The rounds box closes so the discharge steps
// (and the patient summary, if there are billing gaps) are on top; reopen
// the box to carry on with the same list.
function rlDischarge(pid) {
  if (typeof openDischModal !== 'function') return;
  hideModal('rl-modal');
  openDischModal(pid);
}

function rlToggleMove(i) { var m = _rl && _rl.moves[i]; if (!m) return; m._on = !m._on; _rlRender(); }
function rlToggleOff(i)  { var m = _rl && _rl.moves[i]; if (!m || !m.offPrompt) return; m._off = !m._off; _rlRender(); }
function rlSetAction(i, a) {
  var m = _rl && _rl.missing[i]; if (!m) return;
  if (a === 'disch' && m.cardOnly) return;
  m.action = a; _rlRender();
}

function _rlCopyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return _rlCopyFallback(text); });
  }
  return Promise.resolve(_rlCopyFallback(text));
}
function _rlCopyFallback(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function rlCopy() {
  if (!_rl || !_rl.qc || !_rl.qc.length) return;
  var text = rlQuickChartText(_rl.qc);
  _rlCopyText(text).then(function (ok) {
    if (ok) {
      _rl.copied = true;
      _rlRender();
      showToast('List copied — paste it into QuickChart');
    } else {
      showToast('Copy blocked by this browser', 'error');
    }
  });
}

function rlApply() {
  if (!_rl) return;
  if (typeof checkDoc === 'function' && !checkDoc()) return;
  var nMove = 0, nDisch = 0, nOff = 0;

  _rl.moves.forEach(function (m) {
    if (!m._on) return;
    var p = st.patients.find(function (pp) { return pp.id === m.pid; });
    if (!p || p.discharged) return;
    var snap = snapHot(p);
    var from = (p.ward || '') + (p.bed ? ' ' + p.bed : '');
    p.ward = m.toWard;
    p.bed  = m.toBed;
    var goOff = false;   // v5.44: location only
    stampChangedGroups(p, snap);
    if (SHEETS_URL) push('savePatient', p);
    logChange(p, 'Location changed (Meditech list)' + (goOff ? ' + moved off service' : ''),
              from + ' → ' + m.toWard + (m.toBed ? ' ' + m.toBed : ''));
    nMove++;
    if (goOff) nOff++;
  });

  // v5.44: patients missing from the PDF are listed only — nothing written.

  sv('patients', st.patients);
  render();
  var bits = [];
  if (nMove)  bits.push(nMove + ' room' + (nMove === 1 ? '' : 's') + ' updated');
  if (nDisch) bits.push(nDisch + ' discharged');
  if (nOff)   bits.push(nOff + ' moved off service');
  // Keep the modal open on the copy buttons; drop the applied sections.
  _rl.moves = [];
  // (missing list kept on screen as a reminder)
  _rlRender();
  showToast(bits.length ? bits.join(', ') : 'Nothing changed');
}

// Drop the PDF anywhere on the app (desktop): opens the modal and reads it.
// Only acts on a PDF that no other drop zone has already handled.
(function () {
  if (typeof document === 'undefined') return;
  function isPdfDrag(e) {
    var dt = e.dataTransfer; if (!dt) return false;
    var items = dt.items || [];
    for (var i = 0; i < items.length; i++) {
      // v5.44: blank type allowed (some Mac drag sources leave it empty).
      if (items[i].kind === 'file' && (!items[i].type || /pdf/i.test(items[i].type))) return true;
    }
    return false;
  }
  document.addEventListener('dragover', function (e) {
    if (!e.defaultPrevented && isPdfDrag(e)) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    if (e.defaultPrevented) return;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !(/\.pdf$/i.test(f.name || '') || f.type === 'application/pdf')) return;
    e.preventDefault();
    var modal = document.getElementById('rl-modal');
    if (!modal || !modal.classList.contains('on')) openRoundsPdf();
    rlHandleFile(f);
  });
})();
