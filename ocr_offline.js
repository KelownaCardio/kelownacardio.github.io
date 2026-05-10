// ===================================================================
// ocr_offline.js  —  KGH offline OCR engine
// -------------------------------------------------------------------
// Version:    v1.1
// Built:      2026-05-10 21:00 UTC
// Repo:       github.com/KelownaCardio/kelownacardio.github.io
// -------------------------------------------------------------------
// Changes in v1.1:
//   - Multi-pass Tesseract: now runs TWO preprocessing strategies
//     (paper-tuned and screen-tuned) and picks the result with more
//     recognisable KGH content. Specifically:
//       * Paper pass: grayscale+contrast, PSM 11 (sparse text)
//       * Screen pass: 3x downscale-upscale (defeats moiré from
//         photographing displays) + Otsu binarisation, PSM 6 (block)
//     Result includes _meta.preprocessor='paper'|'screen' and scores
//     so the debug bundle shows which strategy won on each image.
//   - This adds ~1-2s to offline scans but means a single code path
//     handles BOTH paper chart stickers AND photos-of-screens
//     (Meditech headers), which doctors must photograph because
//     screenshots aren't always available from the hospital network.
//
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
//   window.OCROffline.VERSION                   -> 'v1.0'
//   window.OCROffline.BUILT                     -> '2026-05-08 13:30 UTC'
//
// opts (optional):
//   { mode: 'auto' | 'sticker' | 'labvial' | 'meditech' }
//   default: 'auto'
// ===================================================================

(function (root) {
  'use strict';

  var VERSION = 'v1.1';
  var BUILT   = '2026-05-10 21:00 UTC';

  try {
    console.log('%c[KGH OCR offline] ' + VERSION + ' · built ' + BUILT,
                'color:#1a5fa8;font-weight:600');
  } catch (e) {}

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
  // ------------------------------------------------------------------
  // Image preprocessing strategies
  // ------------------------------------------------------------------
  // PAPER strategy (the original): grayscale + linear contrast bump.
  // Works well for chart stickers and lab vials where the OCR input is
  // a flat printed surface with crisp lettering.
  function preprocessPaper(img) {
    var canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth  || img.width;
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

  // SCREEN strategy (new): defeats moiré patterns from photographing a
  // display. Moiré is a frequency artifact — when an iPhone camera
  // captures an LCD screen, the sensor grid and pixel grid interfere
  // to produce wavy patterns that destroy character edges. The fix:
  //   1. Downscale by ~3x — averages multiple screen pixels into one,
  //      eliminating the moiré frequency
  //   2. Then upscale back so Tesseract sees a normally-sized image
  //   3. Apply Otsu-style threshold (auto-pick the right cutoff) to
  //      produce clean black/white output without losing thin strokes
  // This is the well-known "scale down to lose the pattern" trick used
  // in printing and image-stabilization pipelines.
  function preprocessScreen(img) {
    var srcW = img.naturalWidth  || img.width;
    var srcH = img.naturalHeight || img.height;

    // Step 1: downscale by 3x with bilinear smoothing
    var DOWNSCALE = 3;
    var small = document.createElement('canvas');
    small.width  = Math.max(1, Math.floor(srcW / DOWNSCALE));
    small.height = Math.max(1, Math.floor(srcH / DOWNSCALE));
    var sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, small.width, small.height);

    // Step 2: upscale back to roughly original size
    var canvas = document.createElement('canvas');
    canvas.width  = srcW;
    canvas.height = srcH;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, srcW, srcH);

    // Step 3: convert to grayscale, build histogram, find Otsu threshold
    var imageData = ctx.getImageData(0, 0, srcW, srcH);
    var d = imageData.data;
    var hist = new Array(256).fill(0);
    var lums = new Uint8Array(d.length / 4);

    for (var i = 0, j = 0; i < d.length; i += 4, j++) {
      var lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      lums[j] = lum;
      hist[lum]++;
    }

    // Otsu's method: find the threshold that maximises between-class variance
    var total = lums.length;
    var sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, maxVar = 0, threshold = 128;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += hist[t2];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += t2 * hist[t2];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; threshold = t2; }
    }

    // Step 4: binarise. Foreground (text) → 0 (black), background → 255 (white).
    // Heuristic: dark-on-light is typical, so values below threshold are text.
    for (var k = 0, m = 0; k < d.length; k += 4, m++) {
      var bw = lums[m] < threshold ? 0 : 255;
      d[k] = d[k + 1] = d[k + 2] = bw;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // Legacy single-strategy preprocessor — kept for any external callers.
  function preprocessForOCR(img) { return preprocessPaper(img); }

  // ------------------------------------------------------------------
  // OCR engine dispatch
  // ------------------------------------------------------------------
  // Tesseract path now runs TWO passes — one paper-tuned, one screen-tuned —
  // and picks the result with more recognisable KGH content. This adds
  // ~1-2 seconds to offline scans but means a single code path handles
  // both paper chart stickers AND photos-of-screens (Meditech headers).
  //
  // ML Kit path runs single-pass with paper preprocessing — the native
  // TextDetector on Android handles screen text robustly without the
  // moiré-defeating downscale trick.
  //
  // Returns { text, strategy } so the caller can log which preprocessor
  // won. strategy is one of: 'paper', 'screen', 'mlkit'.
  function runOCR(img) {
    if (state.engine === 'mlkit') {
      var canvas = preprocessPaper(img);
      return runMLKit(canvas).then(function (text) {
        return { text: text, strategy: 'mlkit' };
      });
    }
    return runTesseractMultiPass(img);
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

  // Score raw OCR text by how many KGH-recognisable anchor tokens it
  // contains. Higher = more confident we got real characters out.
  // Used to pick the winning preprocessing strategy in multi-pass mode.
  function scoreTesseractOutput(text) {
    if (!text) return 0;
    var t = text.toUpperCase();
    var score = 0;
    if (/HCN\s*#?/.test(t))    score += 30;
    if (/MRN\s*#?/.test(t))    score += 30;
    if (/KELKGH/.test(t))      score += 30;
    if (/KGH[A-Z]\d/.test(t))  score += 20;
    if (/\bACT\b/.test(t))     score += 10;
    if (/\bADM\b/.test(t))     score += 10;
    if (/\bMRP\b/.test(t))     score += 10;
    if (/\bFAM\b/.test(t))     score += 10;
    if (/\bDOB\b/.test(t))     score += 10;
    if (/\b9\d{9}\b/.test(t))                  score += 20;  // BC PHN
    if (/\d{2}\/\d{2}\/\d{4}/.test(t))         score += 10;  // DOB
    var words = (t.match(/[A-Z]{4,}/g) || []);
    score += Math.min(words.length, 10);
    return score;
  }

  // Run Tesseract with an explicit PSM mode on a pre-processed canvas.
  function runTesseractPass(canvas, psm) {
    var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return loadTesseract().then(function () {
      return state.tesseractWorker.setParameters({ tessedit_pageseg_mode: String(psm) });
    }).then(function () {
      return state.tesseractWorker.recognize(dataUrl);
    }).then(function (result) {
      return (result && result.data && result.data.text) || '';
    }).catch(function (err) {
      // Don't fail the whole multi-pass on one pass error
      return '';
    });
  }

  // Multi-pass Tesseract: run both preprocessing strategies + appropriate
  // PSM, score each result, return the better one. Adds tracing so we can
  // see in the debug bundle which strategy won.
  function runTesseractMultiPass(img) {
    var paperCanvas  = preprocessPaper(img);
    var screenCanvas = preprocessScreen(img);

    // PSM 11 = sparse text (good for sticker labels with scattered text)
    // PSM 6  = uniform block of text (good for Meditech screen headers)
    var paperPromise  = runTesseractPass(paperCanvas,  '11');
    var screenPromise = runTesseractPass(screenCanvas, '6');

    return Promise.all([paperPromise, screenPromise]).then(function (results) {
      var paperText  = results[0];
      var screenText = results[1];
      var paperScore  = scoreTesseractOutput(paperText);
      var screenScore = scoreTesseractOutput(screenText);

      // Pick the higher-scoring result. Ties go to paper (the proven path).
      var winner, winnerText, winnerScore, loserScore;
      if (screenScore > paperScore) {
        winner = 'screen';  winnerText = screenText;
        winnerScore = screenScore; loserScore = paperScore;
      } else {
        winner = 'paper';   winnerText = paperText;
        winnerScore = paperScore;  loserScore = screenScore;
      }

      return {
        text:     winnerText,
        strategy: winner,
        scores:   { paper: paperScore, screen: screenScore }
      };
    });
  }

  // Legacy single-pass entry point — kept for any external callers.
  // Internal code now uses runOCR(img) which returns {text, strategy}.
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
        return runOCR(img).then(function (ocrResult) {
          var rawText = ocrResult.text;
          var parsed = parse(rawText, mode);
          // Surface multi-pass diagnostic info into the parse log so the
          // debug bundle shows which preprocessing strategy won.
          if (ocrResult.strategy) {
            parsed._parseLog = parsed._parseLog || [];
            var pre = '[preprocessor: ' + ocrResult.strategy;
            if (ocrResult.scores) {
              pre += ' · scores paper=' + ocrResult.scores.paper +
                     ' screen=' + ocrResult.scores.screen;
            }
            pre += ']';
            parsed._parseLog.unshift(pre);
          }
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
              rawText: parsed._rawText,
              preprocessor: ocrResult.strategy || null,
              scores: ocrResult.scores || null
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
    VERSION: VERSION,
    BUILT:   BUILT,
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
