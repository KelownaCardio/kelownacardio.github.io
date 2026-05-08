// ===================================================================
// ocr_offline.js  —  KGH offline OCR engine
// -------------------------------------------------------------------
// Standalone module. Lifts the v0.3 parser from the test app and
// wraps it in a single Promise-returning entry point.
//
// Usage from index.html:
//   <script src="ocr_offline.js"></script>
//   ...
//   const result = await window.OCROffline.run(jpegBase64, mediaType);
//   // result shape matches the Cloudflare Worker output:
//   //   { last, first, phn, dob, sex, ward, room, mrp,
//   //     _engine, _meta: {...} }
//
// Public API:
//   window.OCROffline.run(b64, mediaType, opts) -> Promise<result>
//   window.OCROffline.detectEngine()            -> Promise<'mlkit'|'tesseract'>
//   window.OCROffline.preload()                 -> Promise<void>
//   window.OCROffline.isReady()                 -> bool
//
// opts (optional):
//   { mode: 'auto' | 'sticker' | 'labvial' | 'meditech' }
//   default: 'auto'
// ===================================================================

(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  var state = {
    engine: null,           // 'mlkit' | 'tesseract' | null
    tesseractWorker: null,
    tesseractLoading: null  // Promise while loading
  };

  // ------------------------------------------------------------------
  // Engine detection
  // ------------------------------------------------------------------
  function detectEngine() {
    if (state.engine) return Promise.resolve(state.engine);
    // ML Kit / Shape Detection API (Android Chrome)
    if (typeof root.TextDetector === 'function') {
      try {
        new root.TextDetector();
        state.engine = 'mlkit';
        return Promise.resolve('mlkit');
      } catch (e) { /* fall through */ }
    }
    state.engine = 'tesseract';
    return Promise.resolve('tesseract');
  }

  function loadTesseract() {
    if (state.tesseractWorker) return Promise.resolve();
    if (state.tesseractLoading) return state.tesseractLoading;

    state.tesseractLoading = new Promise(function (resolve, reject) {
      // If Tesseract global already loaded, skip script injection
      function createWorker() {
        if (typeof root.Tesseract === 'undefined') {
          reject(new Error('Tesseract not loaded'));
          return;
        }
        root.Tesseract.createWorker('eng').then(function (w) {
          w.setParameters({
            tessedit_pageseg_mode: '11',
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 /.,:-()\'*#@'
          }).then(function () {
            state.tesseractWorker = w;
            resolve();
          }).catch(reject);
        }).catch(reject);
      }
      if (typeof root.Tesseract !== 'undefined') {
        createWorker();
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = createWorker;
      s.onerror = function () { reject(new Error('Could not load Tesseract.js — first-time setup needs internet')); };
      document.head.appendChild(s);
    });
    return state.tesseractLoading;
  }

  function preload() {
    return detectEngine().then(function (eng) {
      if (eng === 'tesseract') return loadTesseract();
    });
  }

  function isReady() {
    if (state.engine === 'mlkit') return true;
    if (state.engine === 'tesseract' && state.tesseractWorker) return true;
    return false;
  }

  // ------------------------------------------------------------------
  // Image loading + preprocessing
  // ------------------------------------------------------------------
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image decode failed')); };
      img.src = src;
    });
  }

  // Convert raw base64 (no data: prefix) to a data URL
  function toDataURL(b64, mediaType) {
    if (!b64) return '';
    if (b64.indexOf('data:') === 0) return b64;
    return 'data:' + (mediaType || 'image/jpeg') + ';base64,' + b64;
  }

  // Apply grayscale + contrast bump (matches test app preprocessing)
  function preprocessForOCR(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = imageData.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var v = ((lum - 128) * 1.5) + 128;
      if (v < 0) v = 0; else if (v > 255) v = 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ------------------------------------------------------------------
  // OCR engine dispatch
  // ------------------------------------------------------------------
  function runOCR(canvas) {
    if (state.engine === 'mlkit') return runMLKit(canvas);
    return runTesseract(canvas);
  }

  function runMLKit(canvas) {
    return loadImage(canvas.toDataURL('image/jpeg', 0.92)).then(function (img) {
      var detector = new root.TextDetector();
      return detector.detect(img).then(function (blocks) {
        blocks.sort(function (a, b) { return a.boundingBox.top - b.boundingBox.top; });
        return blocks.map(function (b) { return b.rawValue; }).join('\n');
      });
    });
  }

  function runTesseract(canvas) {
    var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return loadTesseract().then(function () {
      return state.tesseractWorker.recognize(dataUrl);
    }).then(function (result) {
      return result.data.text;
    });
  }

  // ==================================================================
  // PARSER  —  lifted verbatim from index__2_.html v0.3, with
  // local variables instead of module globals. Logic unchanged.
  // ==================================================================

  // -- DOB rescue ----------------------------------------------------
  var DOB_OCR_COST = {
    '0-8': 1, '8-0': 1, '0-6': 1, '6-0': 1, '1-7': 1, '7-1': 1,
    '3-9': 1, '9-3': 1, '5-6': 1, '6-5': 1, '2-3': 1, '3-2': 1,
    '0-9': 2, '9-0': 2, '1-4': 2, '4-1': 2, '5-8': 2, '8-5': 2
  };

  function isValidDOB(d, m, y) {
    d = parseInt(d, 10); m = parseInt(m, 10); y = parseInt(y, 10);
    if (!d || !m || !y) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    if (y < 1900 || y > new Date().getFullYear()) return false;
    return d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function ocrDigitDist(a, b) {
    if (a.length !== b.length) return 999;
    var total = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      var c = DOB_OCR_COST[a[i] + '-' + b[i]];
      total += (c === undefined) ? 5 : c;
    }
    return total;
  }

  function validateAndRescueDOB(dobStr) {
    if (!dobStr) return null;
    var parts = dobStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!parts) return null;
    var dd = parts[1].padStart ? parts[1].padStart(2, '0') : ('00' + parts[1]).slice(-2);
    var mm = parts[2].padStart ? parts[2].padStart(2, '0') : ('00' + parts[2]).slice(-2);
    var yy = parts[3];

    if (isValidDOB(dd, mm, yy)) {
      return { dob: dd + '/' + mm + '/' + yy, change: 'valid', valid: true, rescued: false, ambiguous: false };
    }
    if (parseInt(dd, 10) === 0 && parseInt(mm, 10) === 0) return null;

    var candidates = [];
    for (var m2 = 1; m2 <= 12; m2++) {
      var dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m2 - 1];
      for (var d2 = 1; d2 <= dim; d2++) {
        var cd = ('0' + d2).slice(-2);
        var cm = ('0' + m2).slice(-2);
        if (!isValidDOB(cd, cm, yy)) continue;
        var dist = ocrDigitDist(dd, cd) + ocrDigitDist(mm, cm);
        if (dist < 5) candidates.push({ cd: cd, cm: cm, dist: dist });
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return a.dist - b.dist; });
    var best = candidates[0];
    var ambiguous = candidates.length > 1 && candidates[1].dist <= best.dist;
    return {
      dob: best.cd + '/' + best.cm + '/' + yy,
      change: dd + '/' + mm + ' \u2192 ' + best.cd + '/' + best.cm + ' (cost ' + best.dist + ')',
      valid: false, rescued: true, ambiguous: ambiguous
    };
  }

  // -- BC PHN checksum + rescue --------------------------------------
  function isValidBCPHN(phn) {
    if (!phn) return false;
    var s = String(phn).replace(/\D/g, '');
    if (s.length !== 10) return false;
    if (s[0] !== '9') return false;
    var weights = [2, 4, 8, 5, 10, 9, 7, 3];
    var total = 0;
    for (var i = 0; i < 8; i++) total += parseInt(s[i + 1], 10) * weights[i];
    var check = (11 - (total % 11)) % 11;
    return check === parseInt(s[9], 10);
  }

  function tryRescuePHN(raw) {
    if (!raw) return null;
    var s = raw.replace(/[^0-9OlISBGZ]/gi, '');
    if (s.length !== 10) return null;
    var normalised = s
      .replace(/O/g, '0').replace(/o/g, '0')
      .replace(/l/gi, '1').replace(/I/g, '1')
      .replace(/S/g, '5').replace(/B/g, '8')
      .replace(/G/g, '6').replace(/Z/g, '2');
    if (isValidBCPHN(normalised)) return { phn: normalised, swaps: 'auto-normalised digit chars' };

    var digits = normalised.split('');
    var subs = [['0', '8'], ['8', '0'], ['3', '9'], ['9', '3'], ['1', '7'], ['7', '1'],
      ['4', '9'], ['9', '4'], ['0', '6'], ['6', '0']];
    for (var pos = 0; pos < 10; pos++) {
      for (var k = 0; k < subs.length; k++) {
        var from = subs[k][0], to = subs[k][1];
        if (digits[pos] === from) {
          var candidate = digits.slice();
          candidate[pos] = to;
          var str = candidate.join('');
          if (isValidBCPHN(str)) return { phn: str, swaps: 'pos ' + pos + ': ' + from + '\u2192' + to };
        }
      }
    }
    return null;
  }

  // -- Sticker type detection ---------------------------------------
  function detectStickerType(text) {
    var hasBD = /\bBD\s+\d/i.test(text);
    var hasHCN = /\bHCN\s+\d/i.test(text);
    var hasFAM = /\bFAM\b/i.test(text);
    if (hasBD && hasHCN && hasFAM) return 'labvial';

    var hasKELKGH = /KELKGH/i.test(text);
    var hasADM = /\bADM\b/i.test(text);
    if (hasKELKGH && hasADM && !/ACT\s+KG/i.test(text)) return 'meditech';

    return 'sticker';
  }

  // -- Helpers -------------------------------------------------------
  var MONTH_MAP = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };
  var MONTH_VARIANTS = {
    'rpr': '04', 'apt': '04', '4pr': '04', 'npr': '04', 'arp': '04',
    'jvl': '07', 'ju1': '07', 'jvi': '07', 'jui': '07',
    'fub': '02', 'feo': '02', 'fe8': '02',
    'oet': '10', 'ocl': '10', '0ct': '10',
    'novn': '11', 'nov': '11',
    'mqr': '03', 'tnar': '03', 'mar': '03',
    'auq': '08', 'rug': '08', 'aug': '08',
    'sup': '09', 'scp': '09'
  };
  function normaliseMonthAny(m) {
    if (!m) return null;
    var k = m.toLowerCase().slice(0, 4);
    if (MONTH_MAP[k.slice(0, 3)]) return MONTH_MAP[k.slice(0, 3)];
    if (MONTH_VARIANTS[k.slice(0, 3)]) return MONTH_VARIANTS[k.slice(0, 3)];
    if (MONTH_VARIANTS[k]) return MONTH_VARIANTS[k];
    var fuzzed = k.replace(/0/g, 'o').replace(/1/g, 'l').replace(/8/g, 'b');
    return MONTH_MAP[fuzzed.slice(0, 3)] || null;
  }
  function fixNameOCR(s) {
    if (!s) return s;
    return s.replace(/LL/g, 'tt').replace(/Lh/g, 'th').replace(/lh/g, 'th');
  }
  function stripLeadingNoise(s) {
    if (!s) return s;
    return s.replace(/^[^A-Za-z0-9*]+/, '').trim();
  }

  function decodeMeditechLocation(lines) {
    var WARDS = {
      'KELKGHSCCU': 'CCU', 'KELKGHICSI': 'CSICU', 'KELKGHCSI': 'CSICU',
      'KELKGHS2S': '2S', 'KELKGHS2W': '2W', 'KELKGHS3E': '3E', 'KELKGHS3W': '3W',
      'KELKGHS4E': '4E', 'KELKGHS4W': '4W', 'KELKGHS3MU': '3MU',
      'KELKGHR4A': '4A', 'KELKGHR4B': '4B', 'KELKGHR5B': '5B',
      'KELKGHC6W': '6W', 'KELKGHC1C': 'C1C', 'KELKGHCEOF': 'ED', 'KELKGHCMT': 'ED',
      'KELKGHAREH': 'REH', 'KELKGHSHAH': 'HAH'
    };
    var ward = '', room = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var wm = line.match(/KELKGH[A-Z0-9]+/);
      if (wm && WARDS[wm[0]]) ward = WARDS[wm[0]];
      var rm = line.match(/KGH[A-Z]+(\d{4})\s*-?\s*([A-Z])?/);
      if (rm) {
        var num = rm[1], bed = rm[2] || '';
        if (ward === 'CCU') room = String(parseInt(num.slice(2), 10));
        else if (num.charAt(0) === '0') room = num.replace(/^0+/, '') + bed;
        else room = num + bed;
      }
    }
    return { ward: ward, room: room };
  }

  // -- Dual-PHN reconciliation --------------------------------------
  function reconcileDualPHN(hcnRaw, bccRaw, log) {
    var hcn = (hcnRaw || '').replace(/\D/g, '');
    var bcc = (bccRaw || '').replace(/\D/g, '');
    if (!hcn && !bcc) return null;

    function assess(raw, label) {
      if (!raw || raw.length === 0) return null;
      if (raw.length < 10) {
        return { phn: raw, confidence: 'clipped', clipped: true, rescued: false, invalid: false,
                 note: label + ' short (' + raw.length + '/10 digits)' };
      }
      var s = raw.slice(0, 10);
      if (isValidBCPHN(s)) {
        return { phn: s, confidence: 'valid', clipped: false, rescued: false, invalid: false,
                 note: label + ' checksum OK' };
      }
      var rescue = tryRescuePHN(s);
      if (rescue) {
        return { phn: rescue.phn, confidence: 'rescued', clipped: false, rescued: true, invalid: false,
                 note: label + ' rescued (' + rescue.swaps + ')' };
      }
      return { phn: s, confidence: 'invalid', clipped: false, rescued: false, invalid: true,
               note: label + ' checksum FAILED' };
    }

    var hcnA = assess(hcn, 'HCN copy');
    var bccA = assess(bcc, 'BCC copy');

    if (hcnA && bccA) {
      if (!hcnA.clipped && !bccA.clipped && hcnA.phn === bccA.phn && hcnA.confidence === 'valid') {
        log('Both copies match and valid');
        var copy = Object.assign({}, bccA, { confidence: 'verified', note: 'Both copies match \u2713' });
        return copy;
      }
      if (bccA.confidence === 'valid') {
        if (hcnA.confidence !== 'valid') log('BCC valid; HCN copy discarded (' + hcnA.note + ')');
        var c1 = Object.assign({}, bccA);
        c1.note = hcnA.confidence === 'valid' ? 'Both valid, using BCC' : 'BCC valid; HCN ' + hcnA.note;
        return c1;
      }
      if (hcnA.confidence === 'valid') {
        log('HCN valid; BCC copy discarded (' + bccA.note + ')');
        var c2 = Object.assign({}, hcnA);
        c2.note = 'HCN valid; BCC ' + bccA.note;
        return c2;
      }
      if (bccA.confidence === 'rescued') return Object.assign({}, bccA);
      if (hcnA.confidence === 'rescued') return Object.assign({}, hcnA);
      if (hcnA.clipped && bccA.clipped) {
        var hDigits = hcnA.phn, bDigits = bccA.phn;
        for (var k = Math.max(0, hDigits.length - 4); k <= hDigits.length; k++) {
          var candidate = hDigits.slice(0, k) + bDigits.slice(-(10 - k));
          if (candidate.length === 10 && isValidBCPHN(candidate)) {
            log('Cross-stitched: HCN[0:' + k + '] + BCC[-' + (10 - k) + ':] = ' + candidate);
            return { phn: candidate, confidence: 'reconstructed', clipped: false, rescued: true,
                     invalid: false, note: 'Cross-stitched from both copies' };
          }
        }
        log('Cross-stitch failed \u2014 both copies too short');
      }
      var longer = hcn.length >= bcc.length ? hcnA : bccA;
      return Object.assign({}, longer, { confidence: 'clipped' });
    }
    return hcnA || bccA;
  }

  // -- Lab vial parser ----------------------------------------------
  function parseLabVial(rawText, log) {
    log('Mode: lab vial');
    var lines = rawText.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    var last = '', first = '';
    if (lines.length > 0) {
      var nameLine = lines[0];
      var sep = nameLine.search(/[.,]/);
      if (sep > 0) {
        last = fixNameOCR(nameLine.slice(0, sep).trim());
        var afterSep = nameLine.slice(sep + 1).trim();
        first = fixNameOCR(afterSep.split(/\s+/)[0] || afterSep);
      } else {
        last = fixNameOCR(nameLine);
      }
      log('Name line: ' + nameLine + ' \u2192 last=' + last + ' first=' + first);
    }

    var phn = '';
    var hcnMatch = rawText.match(/HCN\s+(\d[\d\s]{8,11})/i);
    if (hcnMatch) {
      phn = hcnMatch[1].replace(/\s/g, '');
      if (phn.length > 10) phn = phn.slice(0, 10);
      log('PHN from HCN anchor: ' + phn);
    }

    var dob = '';
    var bdMatch = rawText.match(/\bBD\s+(\d{1,2})[\/\-\s](\d{1,2}|\w{3})[\/\-\s](\d{4})/i);
    if (bdMatch) {
      var day = ('0' + bdMatch[1]).slice(-2);
      var month = normaliseMonthAny(bdMatch[2]);
      var year = bdMatch[3];
      if (month) { dob = day + '/' + month + '/' + year; log('DOB from BD anchor: ' + dob); }
    }
    if (!dob) {
      var bdLine = lines.find ? lines.find(function (l) { return /^BD\b/i.test(l); }) : null;
      if (bdLine) {
        var mm2 = bdLine.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
        if (mm2) { dob = ('0' + mm2[1]).slice(-2) + '/' + mm2[2] + '/' + mm2[3]; log('DOB fallback on BD line: ' + dob); }
      }
    }

    var sex = '';
    var famLine = null;
    for (var li = 0; li < lines.length; li++) {
      if (/\bFAM\b/i.test(lines[li])) { famLine = lines[li]; break; }
    }
    if (famLine) {
      var sm = famLine.match(/L\s*[:.]\s*([MF])/i);
      if (sm) { sex = sm[1].toUpperCase(); log('Sex from FAM line: ' + sex); }
    }

    // PHN validation + rescue
    var phnRescued = false, phnInvalid = false;
    if (phn && phn.length === 10) {
      if (!isValidBCPHN(phn)) {
        var rescue = tryRescuePHN(phn);
        if (rescue) {
          log('PHN rescued via digit sub: ' + phn + ' \u2192 ' + rescue.phn + ' (' + rescue.swaps + ')');
          phn = rescue.phn;
          phnRescued = true;
        } else {
          phnInvalid = true;
          log('PHN checksum failed, no rescue found: ' + phn);
        }
      } else {
        log('PHN checksum VALID');
      }
    }

    // DOB validation
    var dobRescued = false, dobAmbiguous = false;
    if (dob) {
      var dr = validateAndRescueDOB(dob);
      if (dr) {
        if (dr.rescued) {
          log('DOB rescued: ' + dr.change + (dr.ambiguous ? ' [AMBIGUOUS]' : ''));
          dob = dr.dob; dobRescued = true; dobAmbiguous = dr.ambiguous;
        }
      } else {
        log('DOB invalid and unrecoverable: ' + dob);
        dob = '';
      }
    }

    return {
      last: last, first: first, phn: phn, dob: dob, sex: sex,
      mrp: '', ward: '', room: '',
      _flags: { phnClipped: false, phnRescued: phnRescued, phnInvalid: phnInvalid,
                dobRescued: dobRescued, dobAmbiguous: dobAmbiguous, nameClipped: false }
    };
  }

  // -- Sticker / Meditech parser ------------------------------------
  function parseStickerOrHeader(rawText, effectiveMode, log) {
    log('Mode: ' + effectiveMode);

    var text = rawText;
    // Strip KG-prefixed MRN numbers (Meditech headers carry both)
    var noKG = text.replace(/KG-?\s*\d{6,}/gi, '');
    var col = noKG.replace(/(\d)\s+(\d)/g, '$1$2').replace(/(\d)\s+(\d)/g, '$1$2');

    // PHN extraction
    var hcnRaw = null;
    var hcnMatch = col.match(/HCN\s*(\d{7,12})\b/i);
    if (hcnMatch) {
      hcnRaw = hcnMatch[1].slice(0, 10);
      log('HCN copy raw: ' + hcnRaw + (hcnRaw.length < 10 ? ' [SHORT]' : ''));
    }
    var bccRaw = null;
    var insMatch = col.match(/INS\s*(\d{7,12})\b/i);
    if (insMatch) {
      bccRaw = insMatch[1].slice(0, 10);
      log('INS/BCC copy raw: ' + bccRaw + (bccRaw.length < 10 ? ' [SHORT]' : ''));
    }
    if (!bccRaw) {
      var bccOnly = col.match(/(\d{7,12})\s*(?:BCC|WCB|BCG)\b/i);
      if (bccOnly) {
        bccRaw = bccOnly[1].slice(0, 10);
        log('BCC-only fallback: ' + bccRaw);
      }
    }

    var phn = '', phnClipped = false, phnRescued = false, phnInvalid = false, phnNote = '';
    var bestPHN = reconcileDualPHN(hcnRaw, bccRaw, log);
    if (bestPHN) {
      phn = bestPHN.phn; phnClipped = bestPHN.clipped;
      phnRescued = bestPHN.rescued; phnInvalid = bestPHN.invalid; phnNote = bestPHN.note;
      log('PHN final: ' + phn + ' [' + bestPHN.confidence + '] ' + bestPHN.note);
    } else {
      log('PHN: NOT FOUND');
    }

    // DOB extraction
    var dateRegex = /(\d{1,2})\s+([A-Za-z0-9]{3,4})\s+(\d{4})/g;
    var dob = '', dobYear = 9999;
    var dobValid = false, dobRescued = false, dobAmbiguous = false;
    var m;
    while ((m = dateRegex.exec(text)) !== null) {
      var day = ('0' + m[1]).slice(-2);
      var month = normaliseMonthAny(m[2]);
      var year = m[3];
      if (month && year >= '1900' && year <= '2030') {
        var yn = parseInt(year, 10);
        if (yn < dobYear) {
          dobYear = yn;
          dob = day + '/' + month + '/' + year;
          log('DOB candidate: ' + dob);
        } else {
          log('Other date (ADM?): ' + day + '/' + month + '/' + year);
        }
      }
    }
    if (dob) {
      var dr = validateAndRescueDOB(dob);
      if (dr) {
        if (dr.rescued) {
          log('DOB rescued: ' + dr.change + (dr.ambiguous ? ' [AMBIGUOUS]' : ''));
          dob = dr.dob; dobRescued = true; dobAmbiguous = dr.ambiguous;
        } else {
          dobValid = true;
        }
      } else {
        log('DOB invalid and unrecoverable: ' + dob);
        dob = '';
      }
    }

    // Lines for anchored extraction
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    // Name extraction (first comma/period line in first 8, with wrap detection)
    var ROUTING = /^(MOS|REN|AGG|EDC|ACIN|MHL|D\s*MOS|ID\s*MOS|ACT|ADM|HCN|INS|MRP|FRM|FAM|DOB|BD|RCIN|SPEC)\b/i;
    var NAME_PATTERN = /^[A-Za-z*][A-Za-z\s\-']{1,30}[,.][A-Za-z]/;

    var nameLineIdx = -1;
    var nameRaw = '';
    var maxLines = Math.min(lines.length, 8);
    for (var i = 0; i < maxLines; i++) {
      if (ROUTING.test(lines[i])) { log('Skip routing: ' + lines[i]); continue; }
      if (/^[\d\s]+$/.test(lines[i]) || lines[i].length < 4) {
        log('Skip noise line: "' + lines[i] + '"');
        continue;
      }
      if (NAME_PATTERN.test(lines[i])) {
        nameLineIdx = i;
        nameRaw = lines[i];
        log('Name line found at ' + i + ': ' + nameRaw);
        break;
      }
    }
    // Wrap-continuation detection
    if (nameLineIdx >= 0 && nameLineIdx + 1 < lines.length) {
      var nextLine = lines[nameLineIdx + 1];
      var isContinuation = !ROUTING.test(nextLine)
        && /^[a-z]/.test(nextLine)
        && nextLine.length < 25
        && !/[,.]/.test(nextLine);
      if (isContinuation) {
        log('Detected wrap continuation: "' + nameRaw + '" + "' + nextLine + '"');
        nameRaw = nameRaw + nextLine;
      }
    }
    if (nameRaw) nameRaw = nameRaw.replace(/\s*ACT\s+KG.*/i, '').trim();

    var last = '', first = '', nameClipped = false;
    if (nameRaw) {
      var sep = nameRaw.search(/[,.]/);
      if (sep > 0) {
        last = nameRaw.slice(0, sep).trim();
        first = nameRaw.slice(sep + 1).trim();
      } else {
        last = nameRaw.trim();
      }
      var prefMatch = first.match(/\(([^)]+)\)/);
      if (prefMatch) { first = prefMatch[1]; log('Preferred name used: ' + first); }
      last = stripLeadingNoise(fixNameOCR(last));
      first = stripLeadingNoise(fixNameOCR(first));
      if (last && !/^[A-Z*]/i.test(last)) {
        nameClipped = true; last = '*' + last;
        log('Name clipped (no leading capital)');
      }
    }
    if (!last) log('Name extraction FAILED');

    // Sex
    var sex = '';
    var sexMatch = text.match(/L\s*[:.]\s*([MF])/i);
    if (sexMatch) { sex = sexMatch[1].toUpperCase(); log('Sex: ' + sex); }

    // MRP
    var KNOWN_SERVICES = ['Cardiology', 'Hospitalist', 'CTU', 'ICU', 'CSICU', 'Cardiac Surgery',
      'General Surgery', 'Orthopedics', 'Neurology', 'Nephrology', 'Internal Medicine',
      'Respirology', 'GIM', 'Gastroenterology', 'Oncology', 'Palliative'];
    var mrp = '';
    for (var lj = 0; lj < lines.length; lj++) {
      var line = lines[lj];
      if (/(?:^|\W)FAM\b/i.test(line)) continue;
      var mm3 = line.match(/(?:^|\W)MRP\b\s*(.+)$/i);
      if (mm3) {
        var value = mm3[1].trim();
        log('MRP raw: ' + value);
        var matched = null;
        for (var ks = 0; ks < KNOWN_SERVICES.length; ks++) {
          if (value.toLowerCase().indexOf(KNOWN_SERVICES[ks].toLowerCase()) !== -1) {
            matched = KNOWN_SERVICES[ks]; break;
          }
        }
        mrp = matched || 'Other';
        log('MRP: ' + mrp);
        break;
      }
    }

    // Ward / room (Meditech only)
    var ward = '', room = '';
    if (effectiveMode === 'meditech') {
      var dec = decodeMeditechLocation(lines);
      ward = dec.ward; room = dec.room;
      if (ward) log('Ward: ' + ward);
      if (room) log('Room: ' + room);
    }

    return {
      last: last, first: first, phn: phn, dob: dob, sex: sex,
      mrp: mrp, ward: ward, room: room,
      _flags: { nameClipped: nameClipped, phnClipped: phnClipped,
                phnRescued: phnRescued, phnInvalid: phnInvalid, phnNote: phnNote,
                dobRescued: dobRescued, dobAmbiguous: dobAmbiguous, dobValid: dobValid }
    };
  }

  // -- Top-level parse dispatcher -----------------------------------
  function parse(rawText, mode) {
    var logLines = [];
    function log(s) { logLines.push(s); }

    var effective = mode || 'auto';
    if (effective === 'auto') effective = detectStickerType(rawText);
    log('Auto-detected: ' + effective);

    var result;
    if (effective === 'labvial') result = parseLabVial(rawText, log);
    else result = parseStickerOrHeader(rawText, effective, log);

    result._stickerType = effective;
    result._parseLog = logLines;
    result._rawText = rawText;
    return result;
  }

  // ==================================================================
  // Public entry point
  // ==================================================================
  function run(b64, mediaType, opts) {
    opts = opts || {};
    var mode = opts.mode || 'auto';

    return detectEngine().then(function (eng) {
      return loadImage(toDataURL(b64, mediaType)).then(function (img) {
        var canvas = preprocessForOCR(img);
        return runOCR(canvas).then(function (rawText) {
          var parsed = parse(rawText, mode);
          // Shape that matches the Cloudflare Worker output for drop-in use:
          var out = {
            last: parsed.last || '',
            first: parsed.first || '',
            phn: parsed.phn || '',
            dob: parsed.dob || '',
            sex: parsed.sex || '',
            ward: parsed.ward || '',
            room: parsed.room || '',
            mrp: parsed.mrp || '',
            _engine: eng,
            _meta: {
              stickerType: parsed._stickerType,
              parseLog: parsed._parseLog,
              flags: parsed._flags || {},
              rawText: parsed._rawText
            }
          };
          return out;
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  root.OCROffline = {
    run: run,
    detectEngine: detectEngine,
    preload: preload,
    isReady: isReady,
    // Expose internals for the regression harness / unit tests
    _internal: {
      isValidBCPHN: isValidBCPHN,
      tryRescuePHN: tryRescuePHN,
      validateAndRescueDOB: validateAndRescueDOB,
      detectStickerType: detectStickerType,
      parse: parse
    }
  };

})(typeof window !== 'undefined' ? window : this);
